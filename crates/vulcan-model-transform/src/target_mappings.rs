// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! Explicit Python FHS a8/a9 projections from authored CSV rows. These run before
//! schema finalization, with source identity and UI provenance still available.
use crate::ValidationError;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// Preserve the unobstructed sky while avoiding pinned Python a8/a9's rounded
/// sum of 36 * (10/360) exceeding 1 before acos. Only the converter's exact empty
/// sectors qualify: never discard objects, extra authored keys or invalid arcs.
/// Eight 45-degree sectors cover the same sky with exactly representable eighths.
pub fn map_target_unobstructed_shading(model: &mut Value, profile: crate::ConversionProfile) {
    map_contract_unobstructed_shading(model, profile.input_contract());
}

pub(crate) fn map_contract_unobstructed_shading(model: &mut Value, contract: crate::InputContract) {
    if !contract.uses_exact_empty_shading_sectors {
        return;
    }
    let Some(sectors) = model
        .pointer_mut("/ExternalConditions/shading_segments")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    if sectors.len() == 36
        && sectors.iter().enumerate().all(|(i, sector)| {
            sector.as_object().is_some_and(|fields| fields.len() == 2)
                && sector.get("start360").and_then(Value::as_u64) == Some((i * 10) as u64)
                && sector.get("end360").and_then(Value::as_u64) == Some(((i + 1) * 10) as u64)
        })
    {
        *sectors = (0..8)
            .map(|i| json!({"start360":i*45,"end360":(i+1)*45}))
            .collect();
    }
}

type Row = HashMap<String, Value>;

/// Non-blocking mapping diagnostic: the builder reports it beside schema omissions.
pub(crate) const TARGET_INPUT_WARNING: &str = "W_TARGET_INPUT";

fn field<'a>(row: &'a Row, key: &str) -> Option<&'a Value> {
    row.get(key)
        .filter(|v| !v.is_null() && v.as_str() != Some(""))
        .or_else(|| row.get("extra_json")?.get(key))
}

fn error(errors: &mut Vec<ValidationError>, path: &str, field: &str, message: &str) {
    errors.push(ValidationError {
        code: "E_TARGET_INPUT".into(),
        path: format!("{path}/{field}"),
        message: message.into(),
        schema_path: None,
        keyword: None,
    });
}

pub(crate) fn map_physical_opening_full_partition_element(
    row: &Row,
    model: &mut Value,
    path: &str,
    whole_wall_u_required: bool,
    ventilation_base_height: f64,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let Some(element) = model.as_object_mut() else {
        return errors;
    };
    match element.get("type").and_then(Value::as_str) {
        Some("BuildingElementTransparent") => {
            map_window(row, element, path, ventilation_base_height, &mut errors)
        }
        Some("BuildingElementAdjacentConditionedSpace") => {
            map_partition(row, element, path, &mut errors)
        }
        Some("BuildingElementPartyWall") => {
            map_party_wall(row, element, path, &mut errors, whole_wall_u_required)
        }
        _ => {}
    }
    errors
}

/// The original Rust contract remains the default. Only explicit new source
/// meanings need projection; unversioned legacy rows retain their old behavior.
pub(crate) fn map_divided_opening_half_partition_element(
    row: &Row,
    model: &mut Value,
    path: &str,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let Some(element) = model.as_object_mut() else {
        return errors;
    };
    let party = element.get("type").and_then(Value::as_str) == Some("BuildingElementPartyWall");
    let internal = element.get("type").and_then(Value::as_str)
        == Some("BuildingElementAdjacentConditionedSpace");
    if !party && !internal {
        return errors;
    }
    if party && field(row, "u_value_interpretation").and_then(Value::as_str) == Some("whole_wall") {
        element.remove("u_value");
        if let Some(r) = field(row, "thermal_resistance_construction") {
            element.insert("thermal_resistance_construction".into(), r.clone());
        } else {
            element.remove("thermal_resistance_construction");
            error(&mut errors,path,"thermal_resistance_construction","Whole-wall U-value cannot stand in for construction-to-midpoint resistance. Supply that independent value for the selected input contract.");
        }
    }
    if field(row, "construction_basis").and_then(Value::as_str) == Some("full") {
        if let Some(r) = field(row, "thermal_resistance_construction").and_then(Value::as_f64) {
            element.remove("u_value");
            element.insert("thermal_resistance_construction".into(), json!(r / 2.0));
        }
        if let Some(capacity) = field(row, "areal_heat_capacity").and_then(Value::as_f64) {
            element.insert("areal_heat_capacity".into(), json!(capacity / 2.0));
        }
    }
    let within = row.get("Type").and_then(Value::as_str) != Some("Party")
        && field(row, "_vulcan_ui_party_element").and_then(Value::as_bool) != Some(true);
    if internal
        && within
        && field(row, "internal_partition_area_basis").and_then(Value::as_str)
            == Some("single_face")
    {
        if let Some(area) = element.get("area").and_then(Value::as_f64) {
            element.insert("area".into(), json!(area * 2.0));
        }
    }
    errors
}

fn map_window(
    row: &Row,
    element: &mut Map<String, Value>,
    path: &str,
    ventilation_base_height: f64,
    errors: &mut Vec<ValidationError>,
) {
    // Rust parts are numerical airflow divisions of the SAME whole opening.
    // a9 subdivides each physical opening internally. Repeating its whole area
    // per old division would multiply the opening area and flow coefficient.
    let parts = field(row, "window_part_list");
    if let Some(Value::Array(parts)) = parts {
        if parts.is_empty() {
            element.insert("window_part_list".into(), json!([]));
            return;
        }
        if parts.iter().all(|p| {
            p.get("mid_height").is_some()
                && p.get("free_area_height").is_some()
                && p.get("max_window_open_area").is_some()
        }) {
            element.insert("window_part_list".into(), Value::Array(parts.clone()));
            return;
        }
        let midpoint = parts
            .first()
            .and_then(|p| p.get("mid_height_air_flow_path"))
            .and_then(Value::as_f64);
        let consistent = midpoint.is_some_and(|mid| {
            parts.iter().all(|part| {
                part.as_object().is_some_and(|obj| obj.len() == 1)
                    && part
                        .get("mid_height_air_flow_path")
                        .and_then(Value::as_f64)
                        .is_some_and(|h| (h - mid).abs() < 1e-9)
            })
        });
        if !consistent {
            error(errors, path, "window_part_list", "Legacy airflow divisions have conflicting heights or unsupported fields. Supply physical opening parts with mid_height, free_area_height and max_window_open_area.");
            element.insert("window_part_list".into(), Value::Array(parts.clone()));
            return;
        }
        // The legacy engine's stack flow used the division height; the whole-window
        // mid_height only picked a wind-pressure band. Keep the height that was used
        // and ask the user to check it when it is not the window's mid-height.
        // Part heights are relative to the ventilation-zone base; base_height is
        // above ground. The editor and v1 migration round heights to 0.01 m, so
        // the window midpoint is compared at that resolution.
        let used = midpoint.unwrap();
        let geometric = match (
            field(row, "base_height").and_then(Value::as_f64),
            field(row, "height").and_then(Value::as_f64),
        ) {
            (Some(base), Some(height)) => {
                Some(((base + height / 2.0 - ventilation_base_height) * 100.0).round() / 100.0)
            }
            _ => field(row, "mid_height").and_then(Value::as_f64),
        };
        let opens = field(row, "max_window_open_area").and_then(Value::as_f64) != Some(0.0);
        if let Some(window_mid) = geometric.filter(|mid| opens && (mid - used).abs() > 0.005) {
            let (used, window_mid) = (metres(used), metres(window_mid));
            errors.push(ValidationError {
                code: TARGET_INPUT_WARNING.into(),
                path: format!("{path}/window_part_list"),
                message: format!("The opening height used for ventilation ({used} m) differs from the window's mid-height ({window_mid} m), both above the ventilation-zone base. Check the opening height."),
                schema_path: None,
                keyword: None,
            });
        }
        make_single_opening(row, element, midpoint, path, errors);
    } else if let Some(parts) = parts {
        // Invalid declared values must survive to validation, never become fixed glazing.
        element.insert("window_part_list".into(), parts.clone());
    } else {
        make_single_opening(
            row,
            element,
            field(row, "mid_height").and_then(Value::as_f64),
            path,
            errors,
        );
    }
}

/// Millimetre display, so 1.0 + 1.3 / 2 reads as 1.65 rather than its float tail.
fn metres(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn make_single_opening(
    row: &Row,
    element: &mut Map<String, Value>,
    midpoint: Option<f64>,
    path: &str,
    errors: &mut Vec<ValidationError>,
) {
    let height = field(row, "free_area_height").and_then(Value::as_f64);
    let area = field(row, "max_window_open_area").and_then(Value::as_f64);
    if area == Some(0.0) {
        element.insert("window_part_list".into(), json!([]));
    } else if let (Some(mid), Some(height), Some(area)) = (midpoint, height, area) {
        element.insert(
            "window_part_list".into(),
            json!([{"mid_height":mid,"free_area_height":height,"max_window_open_area":area}]),
        );
    } else {
        error(errors,path,"window_part_list","An openable window needs authored free_area_height, mid_height and max_window_open_area. No opening area is inferred from sash count or glazing dimensions.");
    }
}

fn map_partition(
    row: &Row,
    element: &mut Map<String, Value>,
    path: &str,
    errors: &mut Vec<ValidationError>,
) {
    let source_type = row.get("Type").and_then(Value::as_str).unwrap_or("");
    let party_floor = field(row, "_vulcan_ui_party_element").and_then(Value::as_bool) == Some(true);
    let within = source_type != "Party" && !party_floor;
    if party_floor
        && !element
            .get("pitch")
            .and_then(Value::as_f64)
            .is_some_and(|p| p == 0.0 || p == 180.0)
    {
        error(
            errors,
            path,
            "pitch",
            "A party-floor classification requires a horizontal element (pitch 0 or 180).",
        );
    }
    element.insert("is_adjacent_space_within_dwelling".into(), json!(within));
    match field(row, "internal_partition_area_basis").and_then(Value::as_str) {
        Some("both_faces") if within => {
            if let Some(area) = element.get("area").and_then(Value::as_f64) {
                element.insert("area".into(), json!(area / 2.0));
            }
        }
        Some("single_face") => {}
        Some("both_faces") => error(
            errors,
            path,
            "area",
            "A party element must use single-face area.",
        ),
        Some(_) => error(
            errors,
            path,
            "internal_partition_area_basis",
            "Use single_face or both_faces for internal partition area.",
        ),
        None => {
            // Legacy geometry is evidence of the physical face; compare rather
            // than unconditionally halving older single-face imported areas.
            let physical_area = physical_face_area(row);
            if let (Some(area), Some(physical)) = (
                element.get("area").and_then(Value::as_f64),
                physical_area.filter(|a| *a > 0.0),
            ) {
                if (area - physical).abs() < 0.03 {
                    // Retain authored rounding and any established single-face convention.
                } else if within && (area - physical * 2.0).abs() < 0.03 {
                    element.insert("area".into(), json!(area / 2.0));
                } else {
                    error(errors,path,"area","Partition area disagrees with its physical width and height; correct geometry before preparing target input.");
                }
            } else if within {
                error(errors,path,"area","Partition needs physical width/height or an explicit source area basis before target preparation.");
            }
        }
    }
    let authored_half = [
        "thermal_resistance_construction",
        "u_value",
        "areal_heat_capacity",
    ]
    .iter()
    .any(|key| field(row, key).and_then(Value::as_f64).is_some());
    let basis = field(row, "construction_basis")
        .and_then(Value::as_str)
        .unwrap_or(if authored_half { "half" } else { "full" });
    match basis {
        "full" => {}
        "half" => {
            let resistance = field(row, "thermal_resistance_construction")
                .and_then(Value::as_f64)
                .or_else(|| {
                    field(row, "u_value")
                        .and_then(Value::as_f64)
                        .zip(element.get("pitch").and_then(Value::as_f64))
                        .and_then(|(u, p)| construction_resistance(u, p))
                });
            if let Some(r) = resistance {
                element.remove("u_value");
                element.insert("thermal_resistance_construction".into(), json!(r * 2.0));
            } else {
                error(errors,path,"thermal_resistance_construction","Half construction requires a positive U-value with pitch or a construction resistance.");
            }
            if let Some(capacity) = field(row, "areal_heat_capacity").and_then(Value::as_f64) {
                element.insert("areal_heat_capacity".into(), json!(capacity * 2.0));
            }
            // a9's qualitative classes already designate full-depth capacity;
            // do not double class labels or treat them as reversible numbers.
        }
        _ => error(
            errors,
            path,
            "construction_basis",
            "Use full or half for construction basis.",
        ),
    }
}

// Use persisted geometry to distinguish old single-face rows from doubled
// editor exports. CSV width/height can be rounded or equivalent dimensions.
fn physical_face_area(row: &Row) -> Option<f64> {
    if let Some(coords) = field(row, "coords").and_then(Value::as_str) {
        let points: Option<Vec<Vec<f64>>> = coords
            .split('|')
            .map(|point| {
                point
                    .split(',')
                    .map(|v| v.trim().parse::<f64>().ok())
                    .collect::<Option<Vec<_>>>()
            })
            .collect();
        if let Some(points) = points.filter(|p| {
            p.iter()
                .all(|p| p.len() == 3 && p.iter().all(|v| v.is_finite()))
        }) {
            if points.len() == 2 {
                let length = ((points[1][0] - points[0][0]).powi(2)
                    + (points[1][1] - points[0][1]).powi(2))
                .sqrt();
                if let Some(height) = field(row, "height").and_then(Value::as_f64) {
                    return Some(length * height);
                }
            } else if points.len() >= 3 {
                let mut normal = [0.0; 3];
                for i in 0..points.len() {
                    let a = &points[i];
                    let b = &points[(i + 1) % points.len()];
                    normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
                    normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
                    normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
                }
                return Some(normal.iter().map(|v| v * v).sum::<f64>().sqrt() / 2.0);
            }
        }
    }
    field(row, "width")
        .and_then(Value::as_f64)
        .zip(field(row, "height").and_then(Value::as_f64))
        .map(|(w, h)| w * h)
}

fn map_party_wall(
    row: &Row,
    element: &mut Map<String, Value>,
    path: &str,
    errors: &mut Vec<ValidationError>,
    whole_wall_u_required: bool,
) {
    let meaning = field(row, "u_value_interpretation").and_then(Value::as_str);
    let legacy_u = field(row, "u_value").and_then(Value::as_f64);
    if legacy_u.is_some() && meaning.is_none() {
        error(errors,path,"u_value","Resolve the legacy party-wall U-value meaning explicitly: whole_wall or half_construction. Keeping the number unchanged does not resolve its meaning.");
    }
    if whole_wall_u_required {
        if let Some(whole) = field(row, "u_value_whole_wall").or_else(|| {
            (meaning == Some("whole_wall"))
                .then(|| field(row, "u_value"))
                .flatten()
        }) {
            element.insert("u_value_whole_wall".into(), whole.clone());
        } else {
            error(errors,path,"u_value_whole_wall","Supply whole-wall U-value independently of construction-to-midpoint resistance; manual values are supported.");
        }
    } else {
        element.remove("u_value_whole_wall");
    }
    if let Some(r) = field(row, "thermal_resistance_construction").cloned() {
        let r = if field(row, "construction_basis").and_then(Value::as_str) == Some("full") {
            r.as_f64().map(|r| json!(r / 2.0)).unwrap_or(r)
        } else {
            r
        };
        element.insert("thermal_resistance_construction".into(), r);
    } else if meaning == Some("half_construction") {
        if let Some(r) = legacy_u
            .zip(element.get("pitch").and_then(Value::as_f64))
            .and_then(|(u, p)| construction_resistance(u, p))
        {
            element.insert("thermal_resistance_construction".into(), json!(r));
        }
    }
    element.remove("u_value");
    if !element.contains_key("thermal_resistance_construction") {
        error(errors,path,"thermal_resistance_construction","Supply the party-wall construction-to-midpoint resistance. Whole-wall U-value alone cannot determine it.");
    }
}

// Python a9 HeatTransferInternal.convert_uvalue_to_resistance, pinned source
// 918add... uses heat-transfer coefficients, not rounded surface resistances.
fn construction_resistance(u: f64, pitch: f64) -> Option<f64> {
    if u <= 0.0 || !u.is_finite() {
        return None;
    }
    let h_ci = if pitch < 60.0 {
        5.0
    } else if pitch <= 120.0 {
        2.5
    } else {
        0.7
    };
    let resistance = 1.0 / u - 1.0 / (5.13 + h_ci) - 1.0 / (20.0 + 4.14);
    (resistance > 0.0).then_some(resistance)
}

#[cfg(test)]
mod tests {
    #[test]
    fn canonical_contracts_match_legacy_element_projection() {
        use crate::{ConversionProfile::*, ElementInputConvention};
        let row = Row::from([
            ("Type".into(), json!("Party")),
            ("u_value_interpretation".into(), json!("half_construction")),
            ("u_value".into(), json!(0.5)),
            ("u_value_whole_wall".into(), json!(0.2)),
            ("thermal_resistance_construction".into(), json!(2.0)),
            ("construction_basis".into(), json!("half")),
            ("internal_partition_area_basis".into(), json!("single_face")),
            ("mid_height".into(), json!(1.2)),
            ("free_area_height".into(), json!(0.8)),
            ("max_window_open_area".into(), json!(0.6)),
        ]);
        for (legacy, canonical) in [
            (CurrentRustFhs, DividedOpeningHalfPartitionV1),
            (PythonFhsA8, PhysicalOpeningFullPartitionV1),
            (PythonFhsA9, PhysicalOpeningFullPartitionPartyWallUV1),
        ] {
            for element_type in [
                "BuildingElementTransparent",
                "BuildingElementPartyWall",
                "BuildingElementAdjacentConditionedSpace",
            ] {
                let project = |profile: crate::ConversionProfile| {
                    let contract = profile.input_contract();
                    let mut model = json!({"type":element_type,"pitch":90,"area":10,"u_value":0.5});
                    let errors = match contract.elements {
                        ElementInputConvention::DividedOpeningHalfPartition => {
                            map_divided_opening_half_partition_element(&row, &mut model, "test")
                        }
                        ElementInputConvention::PhysicalOpeningFullPartition => {
                            map_physical_opening_full_partition_element(
                                &row,
                                &mut model,
                                "test",
                                contract.party_wall_requires_whole_u,
                                0.0,
                            )
                        }
                    };
                    (model, errors)
                };
                assert_eq!(project(legacy), project(canonical));
            }
            let readiness = json!({"HotWaterSource":{},"Zone":{"Z":{"ThermalBridging":0.1}}});
            assert_eq!(
                crate::validate_target_input(&readiness, legacy, &a8_version()),
                crate::validate_target_input(&readiness, canonical, &a8_version())
            );
        }
    }

    #[test]
    fn python_empty_sky_mapping_is_exact_bounded_and_idempotent() {
        use crate::ConversionProfile;
        let source = json!({"ExternalConditions":{"shading_segments":(0..36).map(|i| json!({"start360":i*10,"end360":(i+1)*10})).collect::<Vec<_>>()}});
        for profile in [
            ConversionProfile::PythonFhsA8,
            ConversionProfile::PythonFhsA9,
        ] {
            let mut model = source.clone();
            map_target_unobstructed_shading(&mut model, profile);
            let sectors = model["ExternalConditions"]["shading_segments"]
                .as_array()
                .unwrap();
            assert_eq!(sectors.len(), 8);
            for (i, sector) in sectors.iter().enumerate() {
                assert_eq!(sector, &json!({"start360":i*45,"end360":(i+1)*45}));
            }
            let once = model.clone();
            map_target_unobstructed_shading(&mut model, profile);
            assert_eq!(model, once);
            for mutation in [
                "obstacle",
                "unknown",
                "empty_authored_shading",
                "gap",
                "reverse",
                "count",
                "string",
            ] {
                let mut authored = source.clone();
                let sectors = authored["ExternalConditions"]["shading_segments"]
                    .as_array_mut()
                    .unwrap();
                match mutation {
                    "obstacle" => {
                        sectors[0]["shading"] =
                            json!([{"type":"obstacle","height":5,"distance":10}])
                    }
                    "unknown" => sectors[0]["note"] = json!("authored"),
                    "empty_authored_shading" => sectors[0]["shading"] = json!([]),
                    "gap" => sectors[0]["end360"] = json!(9),
                    "reverse" => sectors.reverse(),
                    "count" => {
                        sectors.pop();
                    }
                    "string" => sectors[0]["start360"] = json!("0"),
                    _ => unreachable!(),
                }
                let original = authored.clone();
                map_target_unobstructed_shading(&mut authored, profile);
                assert_eq!(authored, original, "{mutation}");
            }
        }
        let mut rust = source.clone();
        map_target_unobstructed_shading(&mut rust, ConversionProfile::CurrentRustFhs);
        assert_eq!(rust, source);
    }
    use super::*;
    fn map(source: Value, output: Value) -> (Value, Vec<ValidationError>) {
        let row = serde_json::from_value(source).unwrap();
        let mut output = output;
        let errors = map_physical_opening_full_partition_element(
            &row,
            &mut output,
            "Zone/Z/BuildingElement/test",
            true,
            0.0,
        );
        (output, errors)
    }
    #[test]
    fn numerical_window_divisions_preserve_one_opening_area_and_reference_height() {
        let (v, e) = map(
            json!({"Type":"Transparent","free_area_height":1.0,"mid_height":2.2,"max_window_open_area":0.8,"extra_json":{"window_part_list":[{"mid_height_air_flow_path":2.2},{"mid_height_air_flow_path":2.2}]}}),
            json!({"type":"BuildingElementTransparent"}),
        );
        assert!(e.is_empty());
        assert_eq!(
            v["window_part_list"],
            json!([{"free_area_height":1.0,"mid_height":2.2,"max_window_open_area":0.8}])
        );
    }
    #[test]
    fn legacy_division_height_is_used_and_warns_only_when_off_the_window_midpoint() {
        let window = |base_height: f64| {
            json!({"Type":"Transparent","base_height":base_height,"height":1.3,"free_area_height":0.95,"mid_height":1.65,"max_window_open_area":0.8,
                "extra_json":{"window_part_list":[{"mid_height_air_flow_path":1.5},{"mid_height_air_flow_path":1.5}]}})
        };
        let (v, e) = map(window(1.0), json!({"type":"BuildingElementTransparent"}));
        assert_eq!(
            v["window_part_list"],
            json!([{"free_area_height":0.95,"mid_height":1.5,"max_window_open_area":0.8}])
        );
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].code, TARGET_INPUT_WARNING);
        assert_eq!(e[0].path, "Zone/Z/BuildingElement/test/window_part_list");
        assert!(e[0].message.contains("(1.5 m)") && e[0].message.contains("(1.65 m)"));
        // Geometry wins over a stale whole-window mid_height: 0.85 + 1.3 / 2 = 1.5.
        let (v, e) = map(window(0.85), json!({"type":"BuildingElementTransparent"}));
        assert!(e.is_empty());
        assert_eq!(v["window_part_list"][0]["mid_height"], 1.5);
        // Upper-floor window, zone base 2.4 m: 3.2 + 1.2 / 2 - 2.4 = 1.4 above it.
        let row = serde_json::from_value(
            json!({"base_height":3.2,"height":1.2,"free_area_height":1,"max_window_open_area":0.5,
            "extra_json":{"window_part_list":[{"mid_height_air_flow_path":1.4}]}}),
        )
        .unwrap();
        let mut v = json!({"type":"BuildingElementTransparent"});
        assert!(
            map_physical_opening_full_partition_element(&row, &mut v, "w", true, 2.4).is_empty()
        );
        assert_eq!(v["window_part_list"][0]["mid_height"], 1.4);
        // Odd-centimetre height: 1.0 + 1.01 / 2 is a float hair over 5 mm from the
        // stored 1.51 m; it must not warn.
        let row = serde_json::from_value(
            json!({"base_height":1.0,"height":1.01,"free_area_height":1,"max_window_open_area":0.5,
            "extra_json":{"window_part_list":[{"mid_height_air_flow_path":1.51}]}}),
        )
        .unwrap();
        let mut v = json!({"type":"BuildingElementTransparent"});
        assert!(
            map_physical_opening_full_partition_element(&row, &mut v, "w", true, 0.0).is_empty()
        );
        // A window that does not open has no ventilation height to check.
        let (_, e) = map(
            json!({"base_height":1.0,"height":1.3,"max_window_open_area":0,
            "extra_json":{"window_part_list":[{"mid_height_air_flow_path":1.5}]}}),
            json!({"type":"BuildingElementTransparent"}),
        );
        assert!(e.is_empty());
    }
    #[test]
    fn invalid_or_conflicting_window_parts_never_become_fixed_glazing() {
        for parts in [
            json!("invalid"),
            json!([{"mid_height_air_flow_path":1},{"mid_height_air_flow_path":2}]),
        ] {
            let (v, _) = map(
                json!({"extra_json":{"window_part_list":parts}}),
                json!({"type":"BuildingElementTransparent"}),
            );
            assert_eq!(v["window_part_list"], parts);
        }
    }
    #[test]
    fn fixed_glazing_and_authored_physical_parts_remain_exact() {
        for parts in [
            json!([]),
            json!([{"mid_height":1.5,"free_area_height":1,"max_window_open_area":0.4},{"mid_height":2.5,"free_area_height":0.5,"max_window_open_area":0.2}]),
        ] {
            let (v, e) = map(
                json!({"extra_json":{"window_part_list":parts}}),
                json!({"type":"BuildingElementTransparent"}),
            );
            assert!(e.is_empty());
            assert_eq!(v["window_part_list"], parts);
        }
    }
    #[test]
    fn full_partition_recovery_is_exactly_once_and_does_not_double_qualitative_capacity() {
        let (v, e) = map(
            json!({"Type":"Internal","extra_json":{"internal_partition_area_basis":"both_faces","construction_basis":"half","thermal_resistance_construction":1.2,"areal_heat_capacity":100000}}),
            json!({"type":"BuildingElementAdjacentConditionedSpace","area":20,"pitch":90}),
        );
        assert!(e.is_empty());
        assert_eq!(v["area"], 10.0);
        assert_eq!(v["thermal_resistance_construction"], 2.4);
        assert_eq!(v["areal_heat_capacity"], 200000.0);
        assert_eq!(v["is_adjacent_space_within_dwelling"], true);
        // a9 then creates two faces: each area 10, R 1.2, capacity 100000.
    }
    #[test]
    fn legacy_single_face_area_and_explicit_party_floor_are_not_halved() {
        for (source, within) in [("Internal", true), ("Party", false)] {
            let (v, e) = map(
                json!({"Type":source,"width":5,"height":2,"extra_json":{"construction_basis":"full"}}),
                json!({"type":"BuildingElementAdjacentConditionedSpace","area":10,"pitch":90}),
            );
            assert!(e.is_empty());
            assert_eq!(v["area"], 10);
            assert_eq!(v["is_adjacent_space_within_dwelling"], within);
        }
        let (v, e) = map(
            json!({"Type":"BuildingElementAdjacentConditionedSpace","extra_json":{"_vulcan_ui_party_element":true,"construction_basis":"full","internal_partition_area_basis":"single_face"}}),
            json!({"type":"BuildingElementAdjacentConditionedSpace","area":20,"pitch":0}),
        );
        assert!(e.is_empty());
        assert_eq!(v["area"], 20);
        assert_eq!(v["is_adjacent_space_within_dwelling"], false);
    }
    #[test]
    fn party_wall_whole_u_and_construction_r_are_independent_and_zero_u_is_valid() {
        let (v, e) = map(
            json!({"u_value":0,"extra_json":{"u_value_interpretation":"whole_wall","thermal_resistance_construction":1.25}}),
            json!({"type":"BuildingElementPartyWall","pitch":90,"u_value":0}),
        );
        assert!(e.is_empty());
        assert_eq!(v["u_value_whole_wall"], 0);
        assert_eq!(v["thermal_resistance_construction"], 1.25);
        assert!(v.get("u_value").is_none());
        let (_, e) = map(
            json!({"u_value":0.25}),
            json!({"type":"BuildingElementPartyWall","pitch":90}),
        );
        assert!(e.iter().any(|e| e.path.ends_with("/u_value")));
    }
    #[test]
    fn half_u_removes_exact_surface_resistance_before_scaling() {
        let r = construction_resistance(0.5, 90.0).unwrap();
        assert!((r - (2.0 - 1.0 / 7.63 - 1.0 / 24.14)).abs() < 1e-12);
        assert!(construction_resistance(0.0, 90.0).is_none());
    }
    #[test]
    fn rust_target_does_not_use_retained_whole_wall_u_as_half_construction_u() {
        let row=serde_json::from_value(json!({"extra_json":{"u_value":0.2,"u_value_interpretation":"whole_wall","u_value_whole_wall":0.2,"thermal_resistance_construction":1.3}})).unwrap();
        let mut output = json!({"type":"BuildingElementPartyWall","u_value":0.2});
        assert!(map_divided_opening_half_partition_element(&row, &mut output, "wall").is_empty());
        assert!(output.get("u_value").is_none());
        assert_eq!(output["thermal_resistance_construction"], 1.3);
    }

    #[test]
    fn legacy_polygon_double_area_and_manual_half_resistance_are_automatic() {
        let (v, e) = map(
            json!({"Type":"Internal","coords":"0,0,3|4,0,3|4,2,3|0,2,3","extra_json":{"thermal_resistance_construction":0.7,"areal_heat_capacity":120000}}),
            json!({"type":"BuildingElementAdjacentConditionedSpace","area":16,"pitch":180}),
        );
        assert!(e.is_empty(), "{e:?}");
        assert_eq!(v["area"], 8.0);
        assert_eq!(v["thermal_resistance_construction"], 1.4);
        assert_eq!(v["areal_heat_capacity"], 240000.0);
    }
    #[test]
    fn incomplete_window_never_invents_area_from_width_times_height() {
        let (v, e) = map(
            json!({"width":2,"height":1,"mid_height":1.5,"free_area_height":0.8}),
            json!({"type":"BuildingElementTransparent"}),
        );
        assert!(v.get("window_part_list").is_none());
        assert_eq!(e.len(), 1);
        assert!(e[0].message.contains("No opening area is inferred"));
    }
    #[test]
    fn party_wall_capacity_classes_are_preserved_and_invalid_numeric_capacity_not_reinterpreted() {
        // Pinned a9 FHS PartyWall accepts qualitative classes only. Its wrapper
        // maps those classes; a numeric source remains invalid for the schema.
        for capacity in [json!("Medium"), json!(200000)] {
            let (v, e) = map(
                json!({"extra_json":{"u_value_whole_wall":0.2,"thermal_resistance_construction":2.0,"construction_basis":"full","areal_heat_capacity":capacity}}),
                json!({"type":"BuildingElementPartyWall","pitch":90,"areal_heat_capacity":capacity}),
            );
            assert!(e.is_empty());
            assert_eq!(v["thermal_resistance_construction"], 1.0);
            assert_eq!(v["areal_heat_capacity"], capacity);
        }
    }

    #[test]
    fn a8_party_wall_uses_construction_without_requiring_a9_reporting_u() {
        let row=serde_json::from_value(json!({"Type":"BuildingElementPartyWall","extra_json":{"thermal_resistance_construction":1.3,"u_value_whole_wall":0.2}})).unwrap();
        let mut output =
            json!({"type":"BuildingElementPartyWall","pitch":90,"u_value_whole_wall":0.2});
        assert!(
            map_physical_opening_full_partition_element(&row, &mut output, "wall", false, 0.0)
                .is_empty()
        );
        assert_eq!(output["thermal_resistance_construction"], 1.3);
        assert!(output.get("u_value_whole_wall").is_none());
        let no_whole =
            serde_json::from_value(json!({"extra_json":{"thermal_resistance_construction":1.3}}))
                .unwrap();
        assert!(map_physical_opening_full_partition_element(
            &no_whole,
            &mut output,
            "wall",
            true,
            0.0
        )
        .iter()
        .any(|e| e.path.ends_with("u_value_whole_wall")));
    }
    fn a8_version() -> crate::VersionMetadata {
        crate::VersionMetadata {
            hem_core_version: "1.0.0a8".into(),
            fhs_wrapper_version: Some("1.0.0a8".into()),
        }
    }
    #[test]
    fn a8_scalar_bridge_schema_gap_is_a_readiness_error_not_an_invented_mapping() {
        let model = json!({"Zone":{"Z":{"ThermalBridging":12.3}}});
        let errors = crate::validate_target_input(
            &model,
            crate::ConversionProfile::PythonFhsA8,
            &a8_version(),
        );
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].path, "/Zone/Z/ThermalBridging");
        assert!(errors[0].message.starts_with("HEM 1.0.0a8 requires"));
        assert_eq!(model["Zone"]["Z"]["ThermalBridging"], 12.3);
        assert!(crate::validate_target_input(
            &json!({"Zone":{"Z":{"ThermalBridging":{}}}}),
            crate::ConversionProfile::PythonFhsA8,
            &a8_version(),
        )
        .is_empty());
    }
    #[test]
    fn python_fhs_requires_main_hot_water_name_without_rejecting_point_of_use() {
        for profile in [
            crate::ConversionProfile::PythonFhsA8,
            crate::ConversionProfile::PythonFhsA9,
        ] {
            let model = json!({"HotWaterSource":{}});
            let errors = crate::validate_target_input(&model, profile, &a8_version());
            assert_eq!(errors.len(), 1);
            assert_eq!(errors[0].code, "E_PYTHON_FHS_HOT_WATER_SOURCE");
            assert_eq!(errors[0].path, "/HotWaterSource/hw cylinder");
            assert!(crate::validate_target_input(
                &json!({"HotWaterSource":{"hw cylinder":{"type":"PointOfUse"}}}),
                profile,
                &a8_version(),
            )
            .is_empty());
            assert_eq!(model, json!({"HotWaterSource":{}}));
        }
    }
    #[test]
    fn a8_and_a9_share_qualified_window_and_partition_mappings() {
        for (source, model) in [
            (
                json!({"Type":"Transparent","free_area_height":1,"mid_height":1.5,"max_window_open_area":0.5,"extra_json":{"window_part_list":[{"mid_height_air_flow_path":1.5},{"mid_height_air_flow_path":1.5}]}}),
                json!({"type":"BuildingElementTransparent"}),
            ),
            (
                json!({"Type":"Internal","extra_json":{"construction_basis":"half","internal_partition_area_basis":"both_faces","thermal_resistance_construction":1.2,"areal_heat_capacity":100000}}),
                json!({"type":"BuildingElementAdjacentConditionedSpace","area":10,"pitch":90}),
            ),
        ] {
            let row = serde_json::from_value(source).unwrap();
            let mut a8 = model.clone();
            let mut a9 = model;
            assert_eq!(
                map_physical_opening_full_partition_element(&row, &mut a8, "test", false, 0.0),
                map_physical_opening_full_partition_element(&row, &mut a9, "test", true, 0.0)
            );
            assert_eq!(a8, a9);
        }
    }
}
