// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! The floor calculation: a ground floor's U-value (W/m²K) from its construction resistance and
//! drawing, by BS EN ISO 13370:2017 as BR 443 (2019) "Conventions for U-value calculations"
//! §9-§10 directs. HEM takes `u_value` as the "steady-state thermal transmittance of floor,
//! including the effect of the ground" and uses the resistance only to split it
//! (`hem_engine_upstream/src/core/units.rs`), so a floor that states R without U needs U derived
//! by the method HEM names. This is the one implementation: the converter calls it, and the
//! editor reaches it through the web WASM (`wasm_wrapper::ground_floor_u_value`).
//!
//! Clause references are to BS EN ISO 13370:2017 unless marked BR 443.

use serde_json::{Map, Value};
use std::f64::consts::PI;

/// λ_g, thermal conductivity of the ground, W/(m·K): clay or silt, ISO 13370 §6.4.1 Table 7.
/// BR 443 §9: "The ground type in the UK is most commonly clay". HEM uses the same value
/// (`BuildingElementGround`, "same as BR 443 and SAP 10").
const LAMBDA_G: f64 = 1.5;
/// R_si for a floor (downward heat flow), m²K/W: ISO 13370 §6.4.3 takes it from ISO 6946
/// Table 7. BR 443 §9.1 (slab) and §9.2 (0.17 at both surfaces of a suspended deck). HEM's
/// ground element uses 0.17.
const R_SI_FLOOR: f64 = 0.17;
/// R_si for a basement wall (horizontal heat flow), m²K/W: ISO 6946 Table 7; BR 443 §10.1.
const R_SI_WALL: f64 = 0.13;
/// R_se, m²K/W: ISO 13370 §6.4.3 takes it from ISO 6946 Table 7 (0.04); RdSAP 10 §6.12 uses the
/// same value in its transcription of ISO 13370.
const R_SE: f64 = 0.04;
/// Mean wind speed at 10 m over the heating season when the row gives none, m/s: BR 443 §9.2
/// "in the absence of specific information use the UK average of 5 m/s".
const DEFAULT_WIND_SPEED_MPS: f64 = 5.0;
/// Basement ventilation rate when no specific value is known, ach: ISO 13370 §7.4; BR 443 §10.2.
const BASEMENT_VENTILATION_RATE_ACH: f64 = 0.3;
/// ρc of air in the §7.4 ventilation term, Wh/(m³·K): ISO 13370 §7.4 (0.33·n·V). HEM uses the
/// same constant in its unheated-basement coefficients.
const AIR_HEAT_CAPACITY_WH_PER_M3K: f64 = 0.33;

fn positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

fn non_negative(value: f64) -> bool {
    value.is_finite() && value >= 0.0
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

/// B', characteristic dimension of the floor, m: §6.7.1, B' = A / (0.5·P).
fn characteristic_dimension(area: f64, perimeter: f64) -> f64 {
    area / (0.5 * perimeter)
}

/// d_t, total equivalent thickness of a floor on the ground, m: §6.7.2,
/// d_t = w + λ·(R_si + R_f + R_se).
fn floor_equivalent_thickness(w: f64, r_f: f64) -> f64 {
    w + LAMBDA_G * (R_SI_FLOOR + r_f + R_SE)
}

/// U of a floor on the ground from B' and an equivalent thickness d, W/(m²K). §7.1 for a slab
/// (d = d_t); §7.3.2 for a basement floor (d = d_t + 0.5·z).
/// - d < B' (uninsulated or moderately insulated): U = 2λ/(πB' + d) · ln(πB'/d + 1)
/// - d ≥ B' (well insulated): U = λ/(0.457·B' + d)
fn floor_on_ground_u(b: f64, d: f64) -> f64 {
    if d < b {
        2.0 * LAMBDA_G / (PI * b + d) * ((PI * b) / d + 1.0).ln()
    } else {
        LAMBDA_G / (0.457 * b + d)
    }
}

/// Ψ_ge of one edge insulation, W/(m·K): Annex D. d' = R'·λ is the additional equivalent
/// thickness, where Annex D defines R' = R_n − d_n/λ (the edge insulation's resistance less that
/// of the ground it replaces). R_n is `edge_thermal_resistance`, or d_n/λ_n from a stated
/// `thickness` and `thermal_conductivity`. HEM's `EdgeInsulation` has no thickness; an editor
/// entry may state one (`thickness`, m). Without it, R' = R_n: see [`edge_thickness_missing`].
/// - horizontal, width D (eq. D.5): Ψ = −λ/π · [ln(D/d_t + 1) − ln(D/(d_t + d') + 1)]
/// - vertical, depth D (eq. D.6):   Ψ = −λ/π · [ln(2D/d_t + 1) − ln(2D/(d_t + d') + 1)]
fn edge_psi(edge: &Value, d_t: f64) -> Option<f64> {
    let d_n = number(edge.get("thickness")).filter(|v| positive(*v));
    let r_n = number(edge.get("edge_thermal_resistance"))
        .filter(|r| positive(*r))
        .or_else(|| {
            Some(d_n? / number(edge.get("thermal_conductivity")).filter(|v| positive(*v))?)
        })?;
    let d_extra = (r_n - d_n.map_or(0.0, |d| d / LAMBDA_G)) * LAMBDA_G;
    let (extent_key, factor) = match edge.get("type").and_then(Value::as_str)? {
        "horizontal" => ("width", 1.0),
        "vertical" => ("depth", 2.0),
        _ => return None,
    };
    let d = factor * number(edge.get(extent_key)).filter(|v| positive(*v))?;
    if !positive(d_t + d_extra) {
        return None;
    }
    Some(-LAMBDA_G / PI * ((d / d_t + 1.0).ln() - (d / (d_t + d_extra) + 1.0).ln()))
}

/// Vulcan conversion rule (pending owner confirmation): an edge insulation that states no
/// thickness d_n counts its whole resistance, R' = R_n, in place of Annex D's R_n − d_n/λ. True
/// when the floor calculation applied that rule to this element, so the converter can say so.
pub(crate) fn edge_thickness_missing(element: &Map<String, Value>) -> bool {
    element.get("floor_type").and_then(Value::as_str) == Some("Slab_edge_insulation")
        && element
            .get("edge_insulation")
            .and_then(Value::as_array)
            .is_some_and(|edges| {
                edges.iter().any(|edge| {
                    number(edge.get("thickness"))
                        .filter(|v| positive(*v))
                        .is_none()
                        && number(edge.get("edge_thermal_resistance")).is_some_and(positive)
                })
            })
}

/// U of a basement wall below ground, W/(m²K): §7.3.3, with d_w = λ·(R_si + R_w + R_se) and
/// U_bw = 2λ/(πz) · (1 + 0.5·d/(d + z)) · ln(z/d_w + 1), where d = d_t when d_w ≥ d_t and
/// d = d_w when d_w < d_t.
fn basement_wall_u(z: f64, r_w: f64, d_t: f64) -> f64 {
    let d_w = LAMBDA_G * (R_SI_WALL + r_w + R_SE);
    let d = d_w.min(d_t);
    2.0 * LAMBDA_G / (PI * z) * (1.0 + 0.5 * d / (d + z)) * (z / d_w + 1.0).ln()
}

fn shield_factor(location: Option<&Value>) -> f64 {
    // f_w, wind shielding factor: §7.2 (Sheltered 0.02, Average 0.05, Exposed 0.10). BR 443
    // §9.2: use Average "unless a local U-value is specifically required".
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
        "Suspended_floor" => "a total area, perimeter, wall thickness, height of the floor above ground, U-value of the underfloor walls, vent area per perimeter and resistance of the insulation under the void",
        "Heated_basement" => "a total area, perimeter, wall thickness and basement depth",
        "Unheated_basement" => "a total area, perimeter, wall thickness, basement depth, U-value of the floor above the basement, basement wall U-value, height and resistance",
        _ => "a total area, perimeter and wall thickness",
    }
}

/// The floor's U-value before rounding; None when an input it needs is missing or out of range.
fn unrounded(element: &Map<String, Value>, wind_speed_mps: Option<f64>) -> Option<f64> {
    let field = |key: &str| number(element.get(key));
    let area = field("total_area").filter(|v| positive(*v))?;
    let perimeter = field("perimeter").filter(|v| positive(*v))?;
    let w = field("thickness_walls").filter(|v| positive(*v))?;
    let r_f = field("thermal_resistance_floor_construction").filter(|v| non_negative(*v))?;
    let floor_type = element
        .get("floor_type")
        .and_then(Value::as_str)
        .unwrap_or("Slab_no_edge_insulation");
    let b = characteristic_dimension(area, perimeter);
    let d_t = floor_equivalent_thickness(w, r_f);

    let u = match floor_type {
        // §7.2. Valid for an underfloor space no more than 0.5 m below ground (BR 443 §9.2);
        // HEM carries no void depth, so this is not checked.
        "Suspended_floor" => {
            let h = field("height_upper_surface").filter(|v| positive(*v))?;
            let u_w = field("thermal_transm_walls").filter(|v| positive(*v))?;
            let epsilon = field("area_per_perimeter_vent")?;
            let r_g = field("thermal_resist_insul")?;
            let v = wind_speed_mps.unwrap_or(DEFAULT_WIND_SPEED_MPS);
            if !non_negative(epsilon) || !non_negative(r_g) || !non_negative(v) {
                return None;
            }
            // U_f, floor deck between inside and the underfloor space: 1/(R_si + R_f + R_si),
            // R_si = 0.17 at both surfaces (BR 443 §9.2).
            let u_f = 1.0 / (2.0 * R_SI_FLOOR + r_f);
            // d_g = w + λ·(R_si + R_g + R_se), R_g the insulation on the ground under the void.
            let d_g = w + LAMBDA_G * (R_SI_FLOOR + r_g + R_SE);
            // U_g = 2λ/(πB' + d_g) · ln(πB'/d_g + 1) (eq. 10, as BR 443 §9.2 cites it).
            let u_g = 2.0 * LAMBDA_G / (PI * b + d_g) * ((PI * b) / d_g + 1.0).ln();
            // U_x = 2·h·U_w/B' + 1450·ε·v·f_w/B'.
            let u_x = 2.0 * h * u_w / b
                + 1450.0 * epsilon * v * shield_factor(element.get("shield_fact_location")) / b;
            // 1/U = 1/U_f + 1/(U_g + U_x).
            1.0 / (1.0 / u_f + 1.0 / (u_g + u_x))
        }
        // §7.3.2: the basement floor, with z the depth of the basement floor below ground. The
        // element is the floor, so its U is U_bf; the walls below ground (§7.3.3) are not in it.
        "Heated_basement" => {
            let z = field("depth_basement_floor").filter(|v| positive(*v))?;
            floor_on_ground_u(b, d_t + 0.5 * z)
        }
        // §7.4: 1/U = 1/U_f + A/(A·U_bf + z·P·U_bw + h·P·U_w + 0.33·n·V), U_f the floor over the
        // basement (`thermal_transm_envi_base`). V = A·(z + h), the basement air volume HEM uses
        // for the same element (`init_unheated_basement`). R_f is the element's own construction,
        // the deck over the basement (HEM's r_vi split takes it so); HEM's basement-floor term
        // `d_eq` uses the same R_f, and so does U_bf here.
        "Unheated_basement" => {
            let z = field("depth_basement_floor").filter(|v| positive(*v))?;
            let u_f = field("thermal_transm_envi_base").filter(|v| positive(*v))?;
            let u_w = field("thermal_transm_walls").filter(|v| positive(*v))?;
            let h = field("height_basement_walls").filter(|v| positive(*v))?;
            let r_w = field("thermal_resist_walls_base").filter(|v| non_negative(*v))?;
            let u_bf = floor_on_ground_u(b, d_t + 0.5 * z);
            let u_bw = basement_wall_u(z, r_w, d_t);
            let volume = area * (z + h);
            let transfer = area * u_bf
                + z * perimeter * u_bw
                + h * perimeter * u_w
                + AIR_HEAT_CAPACITY_WH_PER_M3K * BASEMENT_VENTILATION_RATE_ACH * volume;
            1.0 / (1.0 / u_f + area / transfer)
        }
        // §7.1, then Annex D for edge insulation: U = U_0 + 2·Ψ_ge/B'. Where horizontal and
        // vertical edge insulation are both given, only the one with the greater effect counts
        // (Annex D; BR 443 §9.1).
        _ => {
            let u_0 = floor_on_ground_u(b, d_t);
            let psi = if floor_type == "Slab_edge_insulation" {
                element
                    .get("edge_insulation")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .map(|edge| edge_psi(edge, d_t))
                    // An entry the calculation cannot read leaves the floor without a U-value
                    // (E068), never with the U-value of a floor without that insulation.
                    .try_fold(0.0, |best: f64, psi| Some(best.min(psi?)))?
            } else {
                0.0
            };
            u_0 + 2.0 * psi / b
        }
    };
    positive(u).then_some(u)
}

/// The element's U-value from the floor calculation, rounded to four decimals; None when an
/// input it needs is missing or out of range. `wind_speed_mps` is the row's own wind speed for a
/// suspended floor (not a HEM input).
pub fn ground_floor_u_value(
    element: &Map<String, Value>,
    wind_speed_mps: Option<f64>,
) -> Option<f64> {
    unrounded(element, wind_speed_mps).map(|u| (u * 1e4).round() / 1e4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn exact(element: Value) -> Option<f64> {
        unrounded(element.as_object().unwrap(), None)
    }

    fn u(element: Value) -> Option<f64> {
        ground_floor_u_value(element.as_object().unwrap(), None)
    }

    fn slab(area: f64, perimeter: f64, r_f: f64) -> Value {
        json!({"floor_type": "Slab_no_edge_insulation", "total_area": area, "perimeter": perimeter,
            "thickness_walls": 0.3, "thermal_resistance_floor_construction": r_f})
    }

    #[test]
    fn slab_matches_the_rdsap_transcription_of_iso_13370() {
        // RdSAP 10 §6.12 restates ISO 13370 §7.1 with the same constants; sap-calculator's
        // `inferred_ground_floor_u_value` implements it and gives 0.6705115590422333 for
        // A 80 m², P 36 m, w 0.25 m, no insulation.
        let floor = json!({"total_area": 80, "perimeter": 36, "thickness_walls": 0.25,
            "thermal_resistance_floor_construction": 0});
        assert!((exact(floor).unwrap() - 0.6705115590422333).abs() < 1e-12);
    }

    #[test]
    fn suspended_floor_matches_the_rdsap_transcription_of_iso_13370() {
        // RdSAP 10 §6.12 suspended floor: R_f 0.2, h 0.3 m, U_w 1.5, ε 0.003 m²/m, v 5 m/s,
        // f_w 0.05; sap-calculator gives 0.697012152479731 for A 80 m², P 36 m, w 0.25 m.
        let floor = json!({"floor_type": "Suspended_floor", "total_area": 80, "perimeter": 36,
            "thickness_walls": 0.25, "thermal_resistance_floor_construction": 0.2,
            "height_upper_surface": 0.3, "thermal_transm_walls": 1.5,
            "area_per_perimeter_vent": 0.003, "shield_fact_location": "Average",
            "thermal_resist_insul": 0});
        assert!((exact(floor).unwrap() - 0.697012152479731).abs() < 1e-12);
    }

    #[test]
    fn slab_switches_to_the_well_insulated_equation_at_b() {
        // A 20 m², P 18 m: B' = 2.222 m. R_f 1.5 gives d_t = 0.3 + 1.5·1.71 = 2.865 ≥ B'.
        let b: f64 = 20.0 / 9.0;
        let d_t: f64 = 0.3 + 1.5 * (0.17 + 1.5 + 0.04);
        assert!(d_t >= b);
        assert!((exact(slab(20.0, 18.0, 1.5)).unwrap() - 1.5 / (0.457 * b + d_t)).abs() < 1e-12);
        // R_f 0.5: d_t = 1.365 < B', the logarithmic equation.
        let d_t: f64 = 0.3 + 1.5 * (0.17 + 0.5 + 0.04);
        let expected = 3.0 / (PI * b + d_t) * (PI * b / d_t + 1.0).ln();
        assert!((exact(slab(20.0, 18.0, 0.5)).unwrap() - expected).abs() < 1e-12);
        // The two equations meet closely at d_t = B' (ISO 13370 chose 0.457 for that).
        let at_b_log = 3.0 / (PI * b + b) * (PI + 1.0).ln();
        let at_b_insulated = 1.5 / (0.457 * b + b);
        assert!((at_b_log / at_b_insulated - 1.0).abs() < 0.01);
    }

    #[test]
    fn edge_insulation_lowers_u_by_two_psi_over_b() {
        let mut floor = slab(35.6, 25.8, 0.0);
        floor["floor_type"] = json!("Slab_edge_insulation");
        let u_0: f64 = exact(slab(35.6, 25.8, 0.0)).unwrap();
        let b: f64 = 35.6 / (0.5 * 25.8);
        let d_t: f64 = 0.3 + 1.5 * (0.17 + 0.04);
        let d_extra: f64 = 1.5 * 1.5;
        let psi_h = -1.5 / PI * ((1.0 / d_t + 1.0).ln() - (1.0 / (d_t + d_extra) + 1.0).ln());
        let psi_v = -1.5 / PI * ((2.0 / d_t + 1.0).ln() - (2.0 / (d_t + d_extra) + 1.0).ln());
        floor["edge_insulation"] =
            json!([{"type": "horizontal", "width": 1, "edge_thermal_resistance": 1.5}]);
        assert!((exact(floor.clone()).unwrap() - (u_0 + 2.0 * psi_h / b)).abs() < 1e-12);
        // Vertical insulation of the same D reaches twice as far (2D), so it wins when both are given.
        floor["edge_insulation"] = json!([
            {"type": "horizontal", "width": 1, "edge_thermal_resistance": 1.5},
            {"type": "vertical", "depth": 1, "edge_thermal_resistance": 1.5}]);
        assert!(psi_v < psi_h);
        assert!((exact(floor.clone()).unwrap() - (u_0 + 2.0 * psi_v / b)).abs() < 1e-12);
        // A stated thickness takes off the ground it replaces (R' = R_n − d_n/λ); a thickness and
        // conductivity with no resistance give R_n = d_n/λ_n.
        let with_thickness = |edge: Value| {
            let mut f = floor.clone();
            f["floor_type"] = json!("Slab_edge_insulation");
            f["edge_insulation"] = json!([edge]);
            exact(f).unwrap()
        };
        let d_extra_thin: f64 = (1.5 - 0.06 / 1.5) * 1.5;
        let psi_thin =
            -1.5 / PI * ((1.0 / d_t + 1.0).ln() - (1.0 / (d_t + d_extra_thin) + 1.0).ln());
        let stated_r = with_thickness(
            json!({"type": "horizontal", "width": 1, "edge_thermal_resistance": 1.5, "thickness": 0.06}),
        );
        assert!((stated_r - (u_0 + 2.0 * psi_thin / b)).abs() < 1e-12);
        let from_lambda = with_thickness(
            json!({"type": "horizontal", "width": 1, "thickness": 0.06, "thermal_conductivity": 0.04}),
        );
        assert!((from_lambda - stated_r).abs() < 1e-12);
        let mut edge_floor = floor.clone();
        edge_floor["floor_type"] = json!("Slab_edge_insulation");
        assert!(edge_thickness_missing(edge_floor.as_object().unwrap()));
        edge_floor["edge_insulation"] = json!([{"type": "horizontal", "width": 1, "edge_thermal_resistance": 1.5, "thickness": 0.06}]);
        assert!(!edge_thickness_missing(edge_floor.as_object().unwrap()));
        // An entry it cannot read (no conductivity for a thickness, no width) gives no U-value.
        let mut unreadable = floor.clone();
        unreadable["floor_type"] = json!("Slab_edge_insulation");
        unreadable["edge_insulation"] = json!([{"type": "horizontal", "width": 1, "edge_thermal_resistance": 1.5},
            {"type": "vertical", "thickness": 0.05, "material": "EPS"}]);
        assert_eq!(exact(unreadable), None);
        // A slab without edge insulation ignores any listed.
        floor["floor_type"] = json!("Slab_no_edge_insulation");
        assert_eq!(exact(floor), Some(u_0));
    }

    #[test]
    fn suspended_floor_puts_ground_insulation_into_d_g() {
        let floor = |r_g: f64| {
            json!({"floor_type": "Suspended_floor", "total_area": 35.6,
            "perimeter": 25.8, "thickness_walls": 0.3, "thermal_resistance_floor_construction": 2.0,
            "height_upper_surface": 0.3, "thermal_transm_walls": 1.5, "area_per_perimeter_vent": 0.0015,
            "thermal_resist_insul": r_g})
        };
        let b: f64 = 35.6 / 12.9;
        let d_g: f64 = 0.3 + 1.5 * (0.17 + 1.0 + 0.04);
        let u_g = 3.0 / (PI * b + d_g) * (PI * b / d_g + 1.0).ln();
        let u_x = 2.0 * 0.3 * 1.5 / b + 1450.0 * 0.0015 * 5.0 * 0.05 / b;
        let expected = 1.0 / (0.34 + 2.0 + 1.0 / (u_g + u_x));
        assert!((exact(floor(1.0)).unwrap() - expected).abs() < 1e-12);
        assert!(exact(floor(1.0)).unwrap() < exact(floor(0.0)).unwrap());
        // The vent area and the ground insulation are inputs: missing, there is no U-value.
        for key in ["area_per_perimeter_vent", "thermal_resist_insul"] {
            let mut missing = floor(1.0);
            missing.as_object_mut().unwrap().remove(key);
            assert_eq!(exact(missing), None, "{key}");
        }
    }

    #[test]
    fn heated_basement_floor_uses_half_the_depth() {
        let floor = |z: f64| {
            json!({"floor_type": "Heated_basement", "total_area": 35.6, "perimeter": 25.8,
            "thickness_walls": 0.3, "thermal_resistance_floor_construction": 0.0, "depth_basement_floor": z})
        };
        let b: f64 = 35.6 / 12.9;
        let d_t: f64 = 0.3 + 1.5 * 0.21;
        let expected = 3.0 / (PI * b + d_t + 1.0) * (PI * b / (d_t + 1.0) + 1.0).ln();
        assert!((exact(floor(2.0)).unwrap() - expected).abs() < 1e-12);
        // A depth that takes d_t + z/2 past B' uses the well-insulated equation.
        assert!((exact(floor(6.0)).unwrap() - 1.5 / (0.457 * b + d_t + 3.0)).abs() < 1e-12);
        // As z → 0 the basement floor becomes the slab (§7.3.2 reduces to §7.1).
        let mut slab = floor(1e-9);
        slab["floor_type"] = json!("Slab_no_edge_insulation");
        assert!((exact(floor(1e-9)).unwrap() - exact(slab).unwrap()).abs() < 1e-8);
    }

    #[test]
    fn basement_wall_uses_the_smaller_equivalent_thickness() {
        let z: f64 = 2.0;
        // d_w = 1.5·(0.13 + 0.5 + 0.04) = 1.005 ≥ d_t = 0.615: the d_t form.
        let d_t: f64 = 0.3 + 1.5 * 0.21;
        let d_w: f64 = 1.5 * (0.13 + 0.5 + 0.04);
        let expected = 3.0 / (PI * z) * (1.0 + 0.5 * d_t / (d_t + z)) * (z / d_w + 1.0).ln();
        assert!((basement_wall_u(z, 0.5, d_t) - expected).abs() < 1e-12);
        // d_w < d_t: the d_w form.
        let d_t: f64 = 3.0;
        let d_w: f64 = 1.5 * 0.17;
        let expected = 3.0 / (PI * z) * (1.0 + 0.5 * d_w / (d_w + z)) * (z / d_w + 1.0).ln();
        assert!((basement_wall_u(z, 0.0, d_t) - expected).abs() < 1e-12);
    }

    #[test]
    fn unheated_basement_combines_the_section_7_4_paths() {
        let floor = json!({"floor_type": "Unheated_basement", "total_area": 35.6,
            "perimeter": 25.8, "thickness_walls": 0.3, "thermal_resistance_floor_construction": 0.0,
            "depth_basement_floor": 2, "thermal_transm_envi_base": 0.5, "thermal_transm_walls": 1.5,
            "height_basement_walls": 0.5, "thermal_resist_walls_base": 0.5});
        let (a, p, z, h) = (35.6, 25.8, 2.0, 0.5);
        let b: f64 = a / (0.5 * p);
        let d_t: f64 = 0.3 + 1.5 * 0.21;
        let u_bf = 3.0 / (PI * b + d_t + 1.0) * (PI * b / (d_t + 1.0) + 1.0).ln();
        let u_bw = basement_wall_u(z, 0.5, d_t);
        let transfer = a * u_bf + z * p * u_bw + h * p * 1.5 + 0.33 * 0.3 * a * (z + h);
        let expected = 1.0 / (1.0 / 0.5 + a / transfer);
        assert!((exact(floor).unwrap() - expected).abs() < 1e-12);
    }

    #[test]
    fn missing_inputs_give_none_and_results_round_to_four_decimals() {
        let mut floor = slab(35.6, 25.8, 4.5);
        assert_eq!(u(floor.clone()), Some(0.1739));
        floor.as_object_mut().unwrap().remove("perimeter");
        assert_eq!(u(floor), None);
        let mut floor = slab(35.6, 25.8, -1.0);
        assert_eq!(u(floor.clone()), None);
        floor["thermal_resistance_floor_construction"] = json!("0.5");
        assert!(u(floor).is_some());
        let suspended = json!({"floor_type": "Suspended_floor", "total_area": 35.6, "perimeter": 25.8,
            "thickness_walls": 0.3, "thermal_resistance_floor_construction": 2.0});
        assert_eq!(u(suspended), None);
    }
}
