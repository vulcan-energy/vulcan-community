// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! The floor calculation: a ground floor's U-value (W/m²K) by BS EN ISO 13370 from its
//! construction resistance and drawing, read off the merged HEM ground element. A port of the
//! editor's `groundUValueCalculator.ts` (`computeGroundUValueFromElementModel` and
//! `calculateGroundUValue`), with the same constants, inputs and rounding, so the converter and
//! the editor give one value. HEM uses the U-value for the floor's steady heat loss and the
//! resistance only to split it (`hem_engine_upstream/src/core/units.rs`), so a resistance from the
//! element or the fabric preset needs the U-value worked out from it.

use serde_json::{Map, Value};
use std::f64::consts::PI;

const R_SI: f64 = 0.17;
const R_SE: f64 = 0.04;
const LAMBDA_G: f64 = 1.5;
/// Wind speed for the suspended-floor ventilation term (BR 497 §4.7.2), m/s.
const DEFAULT_WIND_SPEED_MPS: f64 = 5.0;
/// Basement air change rate permitted by BS EN ISO 13370 §7.4, ach.
const DEFAULT_BASEMENT_VENTILATION_RATE_ACH: f64 = 0.3;
/// Volumetric heat capacity of air, Wh/(m³·K).
const AIR_HEAT_CAPACITY_WH_PER_M3K: f64 = 0.33;

fn positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

fn number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(n) => n.as_f64().filter(|n| n.is_finite()),
        Value::String(s) if !s.trim().is_empty() => {
            s.trim().parse::<f64>().ok().filter(|n| n.is_finite())
        }
        _ => None,
    }
}

/// BS EN ISO 13370 eq. (4) family: U_g from characteristic length b and equivalent thickness d_t.
fn ground_u_from_dt(b: f64, d_t: f64) -> Option<f64> {
    (positive(b) && positive(d_t))
        .then(|| 2.0 * LAMBDA_G * ((PI * b) / d_t + 1.0).ln() / (PI * b + d_t))
}

/// Inputs already checked positive by the caller.
fn basement_floor_u(b: f64, thickness_walls: f64, r_floor: f64, depth: f64) -> Option<f64> {
    ground_u_from_dt(
        b,
        thickness_walls + depth + LAMBDA_G * (R_SI + r_floor + R_SE),
    )
}

fn basement_wall_u(depth: f64, r_walls: f64) -> Option<f64> {
    if !positive(depth) || !positive(r_walls) {
        return None;
    }
    let d_t_wall = LAMBDA_G * (R_SI + r_walls + R_SE);
    let u = (2.0 * LAMBDA_G) / (PI * depth)
        * (1.0 + (0.5 * d_t_wall) / depth)
        * (depth / d_t_wall + 1.0).ln();
    positive(u).then_some(u)
}

fn soil_u(b: f64, thickness_walls: f64) -> Option<f64> {
    if !positive(thickness_walls) {
        return None;
    }
    ground_u_from_dt(b, thickness_walls + LAMBDA_G * (R_SI + R_SE))
}

fn edge_resistance_adjustment(edge_insulation: Option<&Value>, b: f64) -> f64 {
    let Some(edges) = edge_insulation.and_then(Value::as_array) else {
        return 0.0;
    };
    edges
        .iter()
        .filter_map(|edge| {
            let edge_r = number(edge.get("edge_thermal_resistance")).filter(|r| positive(*r))?;
            let extent_key = if edge.get("type").and_then(Value::as_str) == Some("horizontal") {
                "width"
            } else {
                "depth"
            };
            let coverage = number(edge.get(extent_key))
                .filter(|e| positive(*e))
                .map_or(0.0, |extent| (extent / b).min(1.0));
            Some(edge_r * coverage)
        })
        .fold(0.0, f64::max)
}

fn shield_factor(location: Option<&Value>) -> f64 {
    match location.and_then(Value::as_str) {
        Some("Sheltered") => 0.02,
        Some("Exposed") => 0.1,
        _ => 0.05,
    }
}

/// The inputs the floor calculation needs for this floor type, in words, for the error that says
/// it could not run.
pub(crate) fn required_inputs(floor_type: &str) -> &'static str {
    match floor_type {
        "Suspended_floor" => "a total area, perimeter, wall thickness, height of the floor above ground and U-value of the underfloor walls",
        "Heated_basement" => "a total area, perimeter, wall thickness and basement depth",
        "Unheated_basement" => "a total area, perimeter, wall thickness, basement depth, U-value of the floor above the basement, basement wall U-value, height and resistance",
        _ => "a total area, perimeter and wall thickness",
    }
}

/// The element's U-value from the floor calculation, rounded to four decimals as the editor
/// stores it; None when an input it needs is missing or the result is not a positive number.
/// `wind_speed_mps` is the row's own wind speed for a suspended floor (not a HEM input).
pub(crate) fn ground_u_value(
    element: &Map<String, Value>,
    wind_speed_mps: Option<f64>,
) -> Option<f64> {
    let field = |key: &str| number(element.get(key));
    let total_area = field("total_area").filter(|v| positive(*v))?;
    let perimeter = field("perimeter").filter(|v| positive(*v))?;
    let thickness_walls = field("thickness_walls").filter(|v| positive(*v))?;
    let r_floor = field("thermal_resistance_floor_construction").filter(|v| positive(*v))?;
    let floor_type = element
        .get("floor_type")
        .and_then(Value::as_str)
        .unwrap_or("Slab_no_edge_insulation");
    let b = 2.0 * total_area / perimeter;

    let u = match floor_type {
        "Suspended_floor" => {
            let height_upper_surface = field("height_upper_surface").unwrap_or(0.0);
            let walls_u = field("thermal_transm_walls").unwrap_or(0.0);
            let vent = field("area_per_perimeter_vent").unwrap_or(0.0);
            let wind = wind_speed_mps.unwrap_or(DEFAULT_WIND_SPEED_MPS);
            if !positive(height_upper_surface) || !positive(walls_u) || vent < 0.0 || wind < 0.0 {
                return None;
            }
            let r_insul = field("thermal_resist_insul").unwrap_or(0.0).max(0.0);
            let u_g_raw = soil_u(b, thickness_walls)?;
            let u_g = if r_insul > 0.0 {
                u_g_raw / (1.0 + u_g_raw * r_insul)
            } else {
                u_g_raw
            };
            let u_x = (2.0 * height_upper_surface * walls_u) / b
                + (1450.0 * vent * shield_factor(element.get("shield_fact_location")) * wind) / b;
            let combined = u_g + u_x.max(0.0);
            if !positive(combined) {
                return None;
            }
            1.0 / (2.0 * R_SI + r_floor + 1.0 / combined)
        }
        "Heated_basement" => {
            let depth = field("depth_basement_floor").filter(|v| positive(*v))?;
            basement_floor_u(b, thickness_walls, r_floor, depth)?
        }
        "Unheated_basement" => {
            let depth = field("depth_basement_floor").filter(|v| positive(*v))?;
            let u_fs = field("thermal_transm_envi_base").filter(|v| positive(*v))?;
            let u_w = field("thermal_transm_walls").filter(|v| positive(*v))?;
            let h = field("height_basement_walls").filter(|v| positive(*v))?;
            let r_walls = field("thermal_resist_walls_base").filter(|v| positive(*v))?;
            let u_floor = basement_floor_u(b, thickness_walls, r_floor, depth)?;
            let u_wall = basement_wall_u(depth, r_walls)?;
            let transfer = total_area * u_floor
                + depth * perimeter * u_wall
                + h * perimeter * u_w
                + AIR_HEAT_CAPACITY_WH_PER_M3K
                    * DEFAULT_BASEMENT_VENTILATION_RATE_ACH
                    * total_area
                    * (depth + h);
            if !positive(transfer) {
                return None;
            }
            let inverse = 1.0 / u_fs + total_area / transfer;
            if !positive(inverse) {
                return None;
            }
            1.0 / inverse
        }
        _ => {
            let u_g = soil_u(b, thickness_walls)?;
            let edge = if floor_type == "Slab_edge_insulation" {
                edge_resistance_adjustment(element.get("edge_insulation"), b)
            } else {
                0.0
            };
            1.0 / (R_SI + r_floor + edge + 1.0 / u_g)
        }
    };
    positive(u).then(|| (u * 1e4).round() / 1e4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn u(element: Value) -> Option<f64> {
        ground_u_value(element.as_object().unwrap(), None)
    }

    #[test]
    fn matches_the_editor_calculator() {
        // Values from `groundUValueCalculator.ts` for the same inputs.
        let slab = json!({"floor_type": "Slab_no_edge_insulation", "total_area": 35.6,
            "perimeter": 25.8, "thickness_walls": 0.2, "thermal_resistance_floor_construction": 4.5});
        assert_eq!(u(slab.clone()), Some(0.1744));
        let mut no_perimeter = slab.clone();
        no_perimeter.as_object_mut().unwrap().remove("perimeter");
        assert_eq!(u(no_perimeter), None);
        let suspended = json!({"floor_type": "Suspended_floor", "total_area": 35.6,
            "perimeter": 25.8, "thickness_walls": 0.2, "thermal_resistance_floor_construction": 4.5,
            "height_upper_surface": 0.5, "thermal_transm_walls": 0.5, "area_per_perimeter_vent": 0.0015,
            "shield_fact_location": "Average"});
        assert_eq!(u(suspended), Some(0.1786));
        let basement = json!({"floor_type": "Heated_basement", "total_area": 35.6,
            "perimeter": 25.8, "thickness_walls": 0.2, "thermal_resistance_floor_construction": 4.5,
            "depth_basement_floor": 2});
        assert_eq!(u(basement), Some(0.1105));
        let unheated = json!({"floor_type": "Unheated_basement", "total_area": 35.6,
            "perimeter": 25.8, "thickness_walls": 0.2, "thermal_resistance_floor_construction": 4.5,
            "depth_basement_floor": 2, "thermal_transm_envi_base": 0.5, "thermal_transm_walls": 0.5,
            "height_basement_walls": 0.5, "thermal_resist_walls_base": 1});
        assert_eq!(u(unheated), Some(0.3601));
        let edge = json!({"floor_type": "Slab_edge_insulation", "total_area": 35.6,
            "perimeter": 25.8, "thickness_walls": 0.2, "thermal_resistance_floor_construction": 4.5,
            "edge_insulation": [{"type": "horizontal", "width": 1, "edge_thermal_resistance": 1.5}]});
        assert_eq!(u(edge), Some(0.1593));
    }
}
