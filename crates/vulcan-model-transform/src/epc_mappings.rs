// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! Field shapes of the HEM:EPC full input (Orchestrator 0.13.2a0 schema) that no FHS
//! target uses. The builder calls each mapping only when the model profile answers the
//! matching capability question. A value with a Vulcan source is mapped from it; a value
//! without one comes from the target's defaults and is reported; nothing is a code default.

use crate::finalization::SchemaOmission;
use crate::target_mappings::TARGET_INPUT_WARNING;
use crate::{json_pointer, ProductReferences, ProductSlot, ValidationError};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

type Rows = BTreeMap<String, Vec<BTreeMap<String, Value>>>;

fn error(code: &str, path: String, message: String) -> ValidationError {
    ValidationError {
        code: code.into(),
        path,
        message,
        schema_path: None,
        keyword: None,
    }
}

fn notice(path: &str, message: String) -> SchemaOmission {
    SchemaOmission {
        code: TARGET_INPUT_WARNING.into(),
        path: path.into(),
        message,
    }
}

/// HEMIE Table 009.3 (also the FHS wrapper's `COLOUR_TO_SOLAR_ABSORPTION_MAP`).
pub(crate) fn solar_absorption_coeff(colour: &str) -> Option<f64> {
    match colour {
        "Light" => Some(0.3),
        "Intermediate" => Some(0.6),
        "Dark" => Some(0.9),
        _ => None,
    }
}

/// Appliance rows give presence; `Oven` and `Hobs` take the row's `EnergySupply`, else the
/// target defaults' `Appliances.<key>.EnergySupply`.
pub(crate) fn map_appliances(
    model: &mut Value,
    csv: &Rows,
    defaults: &Value,
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) {
    let rows: Vec<&BTreeMap<String, Value>> = csv.get("Appliances").into_iter().flatten().collect();
    fn key_of<'r>(row: &&'r BTreeMap<String, Value>) -> Option<&'r str> {
        row.get("appliancekey").and_then(Value::as_str)
    }
    let has = |keys: &[&str]| {
        rows.iter()
            .any(|row| key_of(row).is_some_and(|k| keys.contains(&k)))
    };
    let mut appliances = Map::new();
    appliances.insert("has_dryer".into(), json!(has(&["Clothes_drying"])));
    appliances.insert("has_dishwasher".into(), json!(has(&["Dishwasher"])));
    appliances.insert(
        "has_separate_fridge_or_freezer".into(),
        json!(has(&["Fridge", "Freezer"])),
    );
    let mut from_defaults = Vec::new();
    for key in ["Oven", "Hobs"] {
        let authored = rows
            .iter()
            .filter(|row| key_of(row) == Some(key))
            .find_map(|row| row.get("extra_json")?.get("EnergySupply")?.as_str());
        let supply = authored.or_else(|| {
            let supply = defaults
                .pointer(&format!("/Appliances/{key}/EnergySupply"))?
                .as_str();
            from_defaults.push(format!("{key} {}", supply?));
            supply
        });
        match supply {
            Some(supply) => {
                appliances.insert(key.into(), json!({ "EnergySupply": supply }));
            }
            None => errors.push(error(
                "E_EPC_COOKING_SUPPLY",
                format!("/Appliances/{key}"),
                format!("State the energy supply of the {key}: give its Appliances row an EnergySupply. The target defaults have none."),
            )),
        }
    }
    if !from_defaults.is_empty() {
        notices.push(notice("/Appliances", format!("No Appliances row states the cooking energy supply, so the model uses the target defaults: {}. Add Oven and Hobs rows with an EnergySupply to state them.", from_defaults.join(", "))));
    }
    model["Appliances"] = Value::Object(appliances);
}

const PV_PANEL_KEYS: [&str; 8] = [
    "peak_power",
    "ventilation_strategy",
    "pitch",
    "orientation360",
    "base_height",
    "height",
    "width",
    "shading",
];

/// One On-Site Generation row is one PV system with one panel array.
pub(crate) fn map_pv_panels(model: &mut Value) {
    let Some(systems) = model
        .get_mut("OnSiteGeneration")
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    for system in systems.values_mut().filter_map(Value::as_object_mut) {
        if system.get("type").and_then(Value::as_str) != Some("PhotovoltaicSystem")
            || system.contains_key("panels")
        {
            continue;
        }
        let panel: Map<String, Value> = PV_PANEL_KEYS
            .iter()
            .filter_map(|key| Some((key.to_string(), system.remove(*key)?)))
            .collect();
        system.insert("panels".into(), json!([panel]));
    }
}

const COIL_FIELDS: [&str; 2] = ["primary_flow_rate", "heat_transfer_rate_W_per_K"];

/// Thermostat positions move into `tank_controls`. A wet coil without its flow and heat
/// transfer rates takes them from the target defaults' cylinder coil.
pub(crate) fn map_cylinder_coils(
    model: &mut Value,
    defaults: &Value,
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) {
    let default_coil = defaults
        .get("HotWaterSource")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|sources| sources.values())
        .filter_map(|source| source.get("HeatSource")?.as_object())
        .flat_map(|heat_sources| heat_sources.values())
        .find(|heat_source| {
            heat_source.get("type").and_then(Value::as_str) == Some("HeatSourceWet")
        });
    let Some(sources) = model
        .get_mut("HotWaterSource")
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    for (source_name, source) in sources.iter_mut() {
        let Some(source) = source.as_object_mut() else {
            continue;
        };
        if source.get("type").and_then(Value::as_str) != Some("StorageTank") {
            continue;
        }
        let mut controls = Vec::new();
        if let Some(heat_sources) = source.get_mut("HeatSource").and_then(Value::as_object_mut) {
            for (name, heat_source) in heat_sources.iter_mut() {
                let Some(heat_source) = heat_source.as_object_mut() else {
                    continue;
                };
                if let Some(position) = heat_source.remove("thermostat_position") {
                    controls.push(json!({"heat_source": name, "thermostat_position": position}));
                }
                if heat_source.get("type").and_then(Value::as_str) != Some("HeatSourceWet") {
                    continue;
                }
                let path = json_pointer(&["HotWaterSource", source_name, "HeatSource", name]);
                let mut used = Vec::new();
                for field in COIL_FIELDS {
                    if heat_source.contains_key(field) {
                        continue;
                    }
                    match default_coil.and_then(|coil| coil.get(field)) {
                        Some(value) => {
                            used.push(format!("{field} {value}"));
                            heat_source.insert(field.into(), value.clone());
                        }
                        None => errors.push(error(
                            "E_EPC_CYLINDER_COIL",
                            format!("{path}/{field}"),
                            format!("State the cylinder coil's {field} on the hot water cylinder system. The target defaults have none."),
                        )),
                    }
                }
                if !used.is_empty() {
                    notices.push(notice(&path, format!("The cylinder coil '{name}' does not state {}, so the model uses the target defaults: {}. Add them to the cylinder's system to state them.", COIL_FIELDS.join(" and "), used.join(", "))));
                }
            }
        }
        if !controls.is_empty() && !source.contains_key("tank_controls") {
            source.insert("tank_controls".into(), Value::Array(controls));
        }
    }
}

/// Built form from party walls: none is detached, one wall line is semi-detached or end
/// terrace, two or more lines is mid terrace. Party walls on different storeys of the same
/// side share a line. Returns the error when a party wall has no plan line to compare.
pub(crate) fn build_type_from_party_walls(csv: &Rows) -> Result<&'static str, String> {
    // ponytail: straight plan lines only; a stepped or angled party wall counts as its own line.
    const TOLERANCE_M: f64 = 0.3;
    let mut lines: Vec<([f64; 2], f64)> = Vec::new();
    for row in csv.values().flatten() {
        if row.get("Type").and_then(Value::as_str) != Some("BuildingElementPartyWall")
            || row
                .get("pitch")
                .and_then(Value::as_f64)
                .is_some_and(|pitch| !(60.0..=120.0).contains(&pitch))
        {
            continue;
        }
        let name = row.get("Name").and_then(Value::as_str).unwrap_or_default();
        let points: Vec<Vec<f64>> = row
            .get("coords")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .split('|')
            .filter_map(|p| p.split(',').map(|v| v.trim().parse().ok()).collect())
            .collect();
        let [a, b] = points.as_slice() else {
            return Err(format!("Party wall '{name}' has no plan line, so the built form cannot be derived. State General_build_type in the Metadata section."));
        };
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let length = dx.hypot(dy);
        if length == 0.0 {
            return Err(format!("Party wall '{name}' has zero length, so the built form cannot be derived. State General_build_type in the Metadata section."));
        }
        // Unit normal with a fixed sign, so a wall drawn either way is the same line.
        let mut normal = [-dy / length, dx / length];
        if normal[0] < -1e-9 || (normal[0].abs() <= 1e-9 && normal[1] < 0.0) {
            normal = [-normal[0], -normal[1]];
        }
        let offset = normal[0] * a[0] + normal[1] * a[1];
        let same = |(n, d): &([f64; 2], f64)| {
            (n[0] * normal[1] - n[1] * normal[0]).abs() < 0.05 && (d - offset).abs() < TOLERANCE_M
        };
        if !lines.iter().any(same) {
            lines.push((normal, offset));
        }
    }
    Ok(match lines.len() {
        0 => "detached",
        1 => "semi_detached_end_terrace",
        _ => "mid_terrace",
    })
}

/// Where EPC requires a HEM Database product. `None` always needs one; otherwise the
/// object needs one when `field` holds one of the values (`true`) or none of them (`false`).
type SlotRule = (
    &'static [&'static str],
    Option<(&'static str, bool, &'static [&'static str])>,
);
const PRODUCT_SLOTS: &[SlotRule] = &[
    // Every wet heat source definition but HIU performance category requires a product.
    (&["HeatSourceWet", "*"], Some(("type", false, &["HIU"]))),
    (&["HeatSourceWarmAir", "*"], None),
    (&["SpaceHeatSystem", "*", "emitters", "*"], None),
    (
        &["SpaceHeatSystem", "*"],
        Some((
            "type",
            true,
            &[
                "ElecStorageHeater",
                "InstantElecHeater",
                "CombustionRoomHeater",
            ],
        )),
    ),
    // Intermittent MEV and PIV stay inline (`$defs/MechanicalVentilationWithoutHeatRecovery`).
    (
        &["InfiltrationVentilation", "MechanicalVentilation", "*"],
        Some((
            "vent_type",
            false,
            &["Intermittent MEV", "Positive input ventilation"],
        )),
    ),
    (
        &["HotWaterSource", "*"],
        Some((
            "type",
            true,
            &[
                "CombiBoiler",
                "SmartHotWaterTank",
                "HeatPump_HWOnly",
                "PrimaryThermalStore",
            ],
        )),
    ),
    (
        &["HotWaterSource", "*", "HeatSource", "*"],
        Some(("type", true, &["HeatPump_HWOnly", "SolarThermalSystem"])),
    ),
    (&["WWHRS", "*"], None),
    (&["EnergySupply", "*", "ElectricBattery"], None),
    (
        &["Zone", "*", "BuildingElement", "*", "treatment", "*"],
        None,
    ),
];

fn collect<'a>(
    value: &'a mut Value,
    pattern: &[&str],
    path: Vec<String>,
    out: &mut Vec<(Vec<String>, &'a mut Value)>,
) {
    let Some((head, rest)) = pattern.split_first() else {
        out.push((path, value));
        return;
    };
    let children: Vec<(String, &mut Value)> = match (value, *head) {
        (Value::Object(map), "*") => map.iter_mut().map(|(k, v)| (k.clone(), v)).collect(),
        (Value::Object(map), key) => map
            .get_mut(key)
            .map(|v| vec![(key.to_string(), v)])
            .unwrap_or_default(),
        (Value::Array(items), "*") => items
            .iter_mut()
            .enumerate()
            .map(|(i, v)| (i.to_string(), v))
            .collect(),
        _ => Vec::new(),
    };
    for (key, child) in children {
        let mut next = path.clone();
        next.push(key);
        collect(child, rest, next, out);
    }
}

fn slot_label(segments: &[&str], system_type: &str) -> String {
    let kind = if system_type.is_empty() {
        "system"
    } else {
        system_type
    };
    match segments.last().and_then(|last| last.parse::<usize>().ok()) {
        Some(index) => format!(
            "{kind} {} of '{}'",
            index + 1,
            segments.get(1).copied().unwrap_or_default()
        ),
        None => format!(
            "'{}' ({kind})",
            segments.last().copied().unwrap_or_default()
        ),
    }
}

/// Product seam: every system EPC requires a product for takes the ID the host supplied for
/// its path, else keeps an authored `product_id`. A system with neither is an error; no
/// default and no ID is invented here.
pub(crate) fn apply_product_references(
    model: &mut Value,
    references: &ProductReferences,
    errors: &mut Vec<ValidationError>,
) -> Vec<ProductSlot> {
    let mut slots = Vec::new();
    for (pattern, rule) in PRODUCT_SLOTS {
        let mut found = Vec::new();
        collect(model, pattern, Vec::new(), &mut found);
        for (segments, system) in found {
            let Some(object) = system.as_object_mut() else {
                continue;
            };
            if let Some((field, listed, values)) = rule {
                let value = object
                    .get(*field)
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if values.contains(&value) != *listed {
                    continue;
                }
            }
            let segments: Vec<&str> = segments.iter().map(String::as_str).collect();
            let path = json_pointer(&segments);
            let system_type = object
                .get("type")
                .or_else(|| object.get("wet_emitter_type"))
                .or_else(|| object.get("vent_type"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let product_id = references
                .get(&path)
                .copied()
                .or_else(|| object.get("product_id").and_then(Value::as_u64));
            match product_id {
                Some(id) => {
                    object.insert("product_id".into(), json!(id));
                }
                None => errors.push(error(
                    "E_PRODUCT_REQUIRED",
                    path.clone(),
                    format!("{} needs a HEM Database product. Pick its product; the converter never invents a product ID.", slot_label(&segments, &system_type)),
                )),
            }
            slots.push(ProductSlot {
                path,
                system_type,
                product_id,
            });
        }
    }
    slots
}

#[cfg(test)]
mod tests {
    use super::*;

    fn party(coords: &str) -> BTreeMap<String, Value> {
        BTreeMap::from([
            ("Type".into(), json!("BuildingElementPartyWall")),
            ("Name".into(), json!("PW")),
            ("coords".into(), json!(coords)),
        ])
    }

    #[test]
    fn built_form_counts_party_wall_lines() {
        let rows = |walls: Vec<&str>| {
            Rows::from([(
                "Non-Exposed Elements".into(),
                walls.into_iter().map(party).collect(),
            )])
        };
        assert_eq!(
            build_type_from_party_walls(&rows(vec![])).unwrap(),
            "detached"
        );
        // Two storeys of one side, drawn in opposite directions: one line.
        assert_eq!(
            build_type_from_party_walls(&rows(vec![
                "-25.7,-6.47,0|-25.7,2.43,0",
                "-25.709,18.1,1|-25.709,9.2,1"
            ]))
            .unwrap(),
            "semi_detached_end_terrace"
        );
        assert_eq!(
            build_type_from_party_walls(&rows(vec![
                "-25.7,-6.47,0|-25.7,2.43,0",
                "-29.7,-6.47,0|-29.7,2.43,0"
            ]))
            .unwrap(),
            "mid_terrace"
        );
        assert!(build_type_from_party_walls(&rows(vec!["1,2,0"])).is_err());
    }

    #[test]
    fn product_slots_fill_from_the_seam_or_fail() {
        let mut model = json!({
            "HeatSourceWet": {"hp": {"type": "HeatPump", "EnergySupply": "mains elec"}},
            "SpaceHeatSystem": {"rads": {"type": "WetDistribution", "emitters": [{"wet_emitter_type": "radiator", "length": 1.0}]}},
            "InfiltrationVentilation": {"MechanicalVentilation": {
                "cmev": {"vent_type": "Centralised continuous MEV"},
                "imev": {"vent_type": "Intermittent MEV"}
            }}
        });
        let references = ProductReferences::from([("/HeatSourceWet/hp".into(), 693001)]);
        let mut errors = Vec::new();
        let slots = apply_product_references(&mut model, &references, &mut errors);
        assert_eq!(model["HeatSourceWet"]["hp"]["product_id"], 693001);
        let paths: Vec<_> = errors.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "/SpaceHeatSystem/rads/emitters/0",
                "/InfiltrationVentilation/MechanicalVentilation/cmev"
            ]
        );
        assert!(errors.iter().all(|e| e.code == "E_PRODUCT_REQUIRED"
            && e.message.contains("needs a HEM Database product")));
        assert_eq!(slots.len(), 3);
        assert!(model["SpaceHeatSystem"]["rads"].get("product_id").is_none());
    }
}
