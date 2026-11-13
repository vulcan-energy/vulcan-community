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

const VENTILATION_DEFAULT_FIELDS: [&str; 3] =
    ["installation_type", "sup_air_flw_ctrl", "sup_air_temp_ctrl"];

/// Mechanical ventilation fields EPC adds come from the target defaults' template for the
/// system's `vent_type` unless its Ventilation Systems row states them; report each one used.
pub(crate) fn report_ventilation_defaults(
    model: &Value,
    csv: &Rows,
    notices: &mut Vec<SchemaOmission>,
) {
    let Some(systems) = model
        .pointer("/InfiltrationVentilation/MechanicalVentilation")
        .and_then(Value::as_object)
    else {
        return;
    };
    for (name, system) in systems {
        let row = csv
            .get("Ventilation Systems")
            .into_iter()
            .flatten()
            .find(|row| row.get("Name").and_then(Value::as_str) == Some(name));
        let authored = |field: &str| {
            row.is_some_and(|row| {
                row.get(field).is_some_and(|v| !v.is_null() && v != "")
                    || row.get("extra_json").and_then(|e| e.get(field)).is_some()
            })
        };
        let used: Vec<String> = VENTILATION_DEFAULT_FIELDS
            .iter()
            .filter(|field| !authored(field))
            .filter_map(|field| Some(format!("{field} {}", system.get(*field)?)))
            .collect();
        if !used.is_empty() {
            let path = json_pointer(&["InfiltrationVentilation", "MechanicalVentilation", name]);
            notices.push(notice(&path, format!("The ventilation system '{name}' does not state these settings, so the model uses the target defaults: {}. Add them to its Ventilation Systems row to state them.", used.join(", "))));
        }
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

fn plan_points(row: &BTreeMap<String, Value>) -> Vec<[f64; 2]> {
    row.get("coords")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .split('|')
        .filter_map(|p| {
            let v: Vec<f64> = p
                .split(',')
                .map(|v| v.trim().parse().ok())
                .collect::<Option<_>>()?;
            (v.len() >= 2).then(|| [v[0], v[1]])
        })
        .collect()
}

fn storeys(csv: &Rows) -> Option<usize> {
    let stated = csv.get("Metadata").into_iter().flatten().find_map(|row| {
        match crate::builder::extract_metadata_field(row) {
            (Some(name), Some(value)) if name == "General_storeys_in_dwelling" => value
                .as_f64()
                .or_else(|| value.as_str()?.trim().parse().ok()),
            _ => None,
        }
    });
    if let Some(n) = stated {
        return Some(n as usize);
    }
    let labels: std::collections::BTreeSet<String> = csv
        .get("Space Labels")
        .into_iter()
        .flatten()
        .filter_map(|row| row.get("storey").map(Value::to_string))
        .collect();
    (!labels.is_empty()).then_some(labels.len())
}

/// Built form from party walls, by the sides of the dwelling they are on: none is detached,
/// one side is semi-detached or end terrace, two opposite sides is mid terrace. A stepped
/// party wall on one side faces the same way, so it is one side. Returns the built form and
/// the side count, or why the built form is the user's to state: party floors (flat or
/// maisonette), a single storey (bungalow, when the schema has it), sides that are neither
/// one nor opposite, or a party wall with no plan line. A park home is never derived.
pub(crate) fn build_type_from_party_walls(
    csv: &Rows,
    allowed: &[String],
) -> Result<(&'static str, usize), String> {
    let state = |why: String| format!("{why} State General_build_type in the Metadata section.");
    let mut walls = Vec::new();
    let mut midpoints = Vec::new();
    for row in csv.values().flatten() {
        let points = plan_points(row);
        let ty = row.get("Type").and_then(Value::as_str).unwrap_or_default();
        if points.len() == 2 && ty == "BuildingElementOpaque" {
            midpoints.push([
                (points[0][0] + points[1][0]) / 2.0,
                (points[0][1] + points[1][1]) / 2.0,
            ]);
        }
        let party_floor = row
            .get("extra_json")
            .and_then(|extra| extra.get(crate::parser::PARTY_ELEMENT_MARKER))
            .and_then(Value::as_bool)
            == Some(true);
        let pitch = row.get("pitch").and_then(Value::as_f64);
        let horizontal = pitch.is_some_and(|p| !(60.0..=120.0).contains(&p));
        let name = row.get("Name").and_then(Value::as_str).unwrap_or_default();
        if party_floor || (ty == "BuildingElementPartyWall" && horizontal) {
            return Err(state(format!("'{name}' is a party floor or ceiling, so the dwelling is a flat or maisonette, which the converter does not choose between.")));
        }
        if ty != "BuildingElementPartyWall" {
            continue;
        }
        let [a, b] = points.as_slice() else {
            return Err(state(format!(
                "Party wall '{name}' has no plan line, so the built form cannot be derived."
            )));
        };
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let length = dx.hypot(dy);
        if length == 0.0 {
            return Err(state(format!(
                "Party wall '{name}' has zero length, so the built form cannot be derived."
            )));
        }
        walls.push((
            [-dy / length, dx / length],
            [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0],
        ));
    }
    if midpoints.is_empty() && !walls.is_empty() {
        return Err(state(
            "No wall has a plan line, so the sides the party walls are on cannot be found.".into(),
        ));
    }
    let n = midpoints.len().max(1) as f64;
    let centre = midpoints
        .iter()
        .fold([0.0, 0.0], |c, m| [c[0] + m[0] / n, c[1] + m[1] / n]);
    // Outward unit normal of each party wall; walls facing within 30 degrees are one side.
    let mut sides: Vec<[f64; 2]> = Vec::new();
    for (normal, mid) in walls {
        let outward = if normal[0] * (mid[0] - centre[0]) + normal[1] * (mid[1] - centre[1]) < 0.0 {
            [-normal[0], -normal[1]]
        } else {
            normal
        };
        if !sides
            .iter()
            .any(|s| s[0] * outward[0] + s[1] * outward[1] > 0.866)
        {
            sides.push(outward);
        }
    }
    let built_form = match sides.as_slice() {
        [] => "detached",
        [_] => "semi_detached_end_terrace",
        [a, b] if a[0] * b[0] + a[1] * b[1] < -0.866 => "mid_terrace",
        _ => {
            return Err(state(format!(
                "The party walls are on {} sides that are not opposite, so the built form is not clear.",
                sides.len()
            )))
        }
    };
    if allowed.iter().any(|v| v == "bungalow") && storeys(csv).is_none_or(|n| n <= 1) {
        return Err(state("The dwelling has one storey (or its storeys are not stated), so it may be a bungalow, which the converter does not choose.".into()));
    }
    Ok((built_form, sides.len()))
}

/// One place EPC requires a HEM Database product: the model path, the discriminator values
/// whose definition requires `product_id` (`None`: every object there), and the values of a
/// field that select an inline definition with no product instead.
struct SlotRule {
    path: &'static [&'static str],
    requires: Option<(&'static str, &'static [&'static str])>,
    inline: Option<(&'static str, &'static [&'static str])>,
}

const fn slot(
    path: &'static [&'static str],
    requires: Option<(&'static str, &'static [&'static str])>,
) -> SlotRule {
    SlotRule {
        path,
        requires,
        inline: None,
    }
}

/// Every full-input (`epc`) definition of the Orchestrator 0.13.2a0 schema whose `required`
/// lists `product_id`, at the model path that reaches it. `slot_table_matches_the_schema`
/// fails when the vendored schema and this table differ. Not listed: `MixerShower`, whose
/// inline definition stays valid (`ShowerMixerProduct` is an alternative, not a requirement).
const PRODUCT_SLOTS: &[SlotRule] = &[
    slot(
        &["HeatSourceWet", "*"],
        Some((
            "type",
            &[
                "BackBoiler",
                "Boiler",
                "DirectElectricBoiler",
                "HIU",
                "HeatBattery",
                "HeatPump",
                "PrimaryThermalStore",
                "SolidFuelBoiler",
            ],
        )),
    ),
    // A heat network supply given as an object (a string names an EnergySupply instead).
    slot(&["HeatSourceWet", "*", "EnergySupply"], None),
    slot(&["HeatSourceWet", "*", "EnergySupply_heat_network"], None),
    slot(
        &["HeatSourceWet", "*", "HeatSource", "*"],
        Some(("type", &["HeatPump_HWOnly"])),
    ),
    slot(
        &["HeatSourceWarmAir", "*"],
        Some(("type", &["WarmAirCombustion", "WarmAirElectric"])),
    ),
    slot(
        &["SpaceHeatSystem", "*"],
        Some((
            "type",
            &[
                "CombustionRoomHeater",
                "ElecStorageHeater",
                "InstantElecHeater",
            ],
        )),
    ),
    slot(
        &["SpaceHeatSystem", "*", "emitters", "*"],
        Some(("wet_emitter_type", &["fancoil", "radiator", "ufh"])),
    ),
    // Intermittent MEV and PIV stay inline (`$defs/MechanicalVentilationWithoutHeatRecovery`).
    SlotRule {
        path: &["InfiltrationVentilation", "MechanicalVentilation", "*"],
        requires: None,
        inline: Some((
            "vent_type",
            &["Intermittent MEV", "Positive input ventilation"],
        )),
    },
    slot(
        &["HotWaterSource", "*"],
        Some(("type", &["HeatPump_HWOnly", "SmartHotWaterTank"])),
    ),
    slot(
        &["HotWaterSource", "*", "HeatSource", "*"],
        Some(("type", &["HeatPump_HWOnly", "SolarThermalSystem"])),
    ),
    slot(&["HotWaterSource", "*", "flue_gas_heat_recovery"], None),
    slot(
        &["PreHeatedWaterSource", "preheated tank", "HeatSource", "*"],
        Some(("type", &["HeatPump_HWOnly", "SolarThermalSystem"])),
    ),
    slot(&["WWHRS", "*"], Some(("type", &["WWHRS_Instantaneous"]))),
    slot(
        &["EnergySupply", "*", "ElectricBattery"],
        Some(("type", &["stationary"])),
    ),
    slot(
        &["EnergySupply", "*", "ElectricBattery", "*"],
        Some(("type", &["stationary"])),
    ),
    slot(
        &["Zone", "*", "BuildingElement", "*", "has_smart_air_brick"],
        None,
    ),
    slot(
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

/// Product seam: each system EPC requires a product for takes the ID the host supplied for
/// its key, else keeps an authored `product_id`. A system with neither, and a supplied key no
/// system has, are errors; no default and no ID is invented here. `keys` gives the stable key
/// of a model path whose last segment is an array index (a Wet Emitters row name); every
/// other slot's key is its model path.
pub(crate) fn apply_product_references(
    model: &mut Value,
    references: &ProductReferences,
    keys: &BTreeMap<String, String>,
    errors: &mut Vec<ValidationError>,
) -> Vec<ProductSlot> {
    let mut slots = Vec::new();
    for rule in PRODUCT_SLOTS {
        let mut found = Vec::new();
        collect(model, rule.path, Vec::new(), &mut found);
        for (segments, system) in found {
            let Some(object) = system.as_object_mut() else {
                continue;
            };
            let field = |field: &str| {
                object
                    .get(field)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            };
            if rule
                .requires
                .is_some_and(|(f, values)| !values.contains(&field(f)))
                || rule
                    .inline
                    .is_some_and(|(f, values)| values.contains(&field(f)))
            {
                continue;
            }
            let segments: Vec<&str> = segments.iter().map(String::as_str).collect();
            let path = json_pointer(&segments);
            let key = keys.get(&path).cloned().unwrap_or_else(|| path.clone());
            let system_type = ["type", "wet_emitter_type", "vent_type"]
                .iter()
                .map(|f| field(f))
                .find(|v| !v.is_empty())
                .unwrap_or("system")
                .to_string();
            let product_id = references
                .get(&key)
                .copied()
                .or_else(|| object.get("product_id").and_then(Value::as_u64));
            match product_id {
                Some(id) => {
                    object.insert("product_id".into(), json!(id));
                }
                None => errors.push(error(
                    "E_PRODUCT_REQUIRED",
                    path.clone(),
                    format!("'{}' ({system_type}) needs a HEM Database product. Pick its product; the converter never invents a product ID.", key.rsplit('/').next().unwrap_or_default()),
                )),
            }
            slots.push(ProductSlot {
                key,
                path,
                system_type,
                product_id,
            });
        }
    }
    for key in references.keys() {
        if !slots.iter().any(|slot| &slot.key == key) {
            errors.push(error(
                "E_PRODUCT_REFERENCE_UNMATCHED",
                key.clone(),
                format!("A product was supplied for '{key}', but no system there needs one. Remove it or move it to the system it belongs to."),
            ));
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
    fn built_form_counts_party_wall_sides() {
        let allowed = ["detached", "bungalow", "flat"].map(String::from);
        let exposed = |coords: &str| {
            BTreeMap::from([
                ("Type".into(), json!("BuildingElementOpaque")),
                ("coords".into(), json!(coords)),
            ])
        };
        let rows = |walls: Vec<&str>, storeys: &str| {
            let mut elements: Vec<_> = ["-29.7,-6.47,0|-25.7,-6.47,0", "-25.7,2.43,0|-29.7,2.43,0"]
                .into_iter()
                .map(exposed)
                .collect();
            elements.extend(walls.into_iter().map(party));
            Rows::from([
                ("Exposed Elements".into(), elements),
                (
                    "Metadata".into(),
                    vec![BTreeMap::from([
                        ("Field".into(), json!("General_storeys_in_dwelling")),
                        ("Value".into(), json!(storeys)),
                    ])],
                ),
            ])
        };
        assert_eq!(
            build_type_from_party_walls(&rows(vec![], "2"), &allowed).unwrap(),
            ("detached", 0)
        );
        // Two storeys of one side, drawn in opposite directions and stepped by 0.5 m: one side.
        assert_eq!(
            build_type_from_party_walls(
                &rows(
                    vec!["-25.7,-6.47,0|-25.7,2.43,0", "-25.2,18.1,1|-25.2,9.2,1"],
                    "2"
                ),
                &allowed
            )
            .unwrap(),
            ("semi_detached_end_terrace", 1)
        );
        assert_eq!(
            build_type_from_party_walls(
                &rows(
                    vec!["-25.7,-6.47,0|-25.7,2.43,0", "-29.7,-6.47,0|-29.7,2.43,0"],
                    "2"
                ),
                &allowed
            )
            .unwrap(),
            ("mid_terrace", 2)
        );
        // A side and an adjacent side: not a terrace the converter can name.
        assert!(build_type_from_party_walls(
            &rows(
                vec!["-25.7,-6.47,0|-25.7,2.43,0", "-25.7,2.43,0|-29.7,2.43,0"],
                "2"
            ),
            &allowed
        )
        .is_err());
        // One storey may be a bungalow.
        assert!(build_type_from_party_walls(&rows(vec![], "1"), &allowed)
            .unwrap_err()
            .contains("bungalow"));
        assert!(build_type_from_party_walls(&rows(vec!["1,2,0"], "2"), &allowed).is_err());
        // No exposed wall gives a centre, so the sides cannot be found.
        let walls_only = Rows::from([(
            "Non-Exposed Elements".into(),
            vec![party("-25.7,-6.47,0|-25.7,2.43,0")],
        )]);
        assert!(build_type_from_party_walls(&walls_only, &allowed)
            .unwrap_err()
            .contains("plan line"));
    }

    #[test]
    fn product_slots_fill_from_the_seam_or_fail() {
        let mut model = json!({
            "HeatSourceWet": {"hp": {"type": "HeatPump", "EnergySupply": "mains elec"}},
            "SpaceHeatSystem": {"rads": {"type": "WetDistribution", "emitters": [
                {"wet_emitter_type": "radiator", "length": 1.0},
                {"wet_emitter_type": "radiator", "length": 2.0}
            ]}},
            "InfiltrationVentilation": {"MechanicalVentilation": {
                "cmev": {"vent_type": "Centralised continuous MEV"},
                "imev": {"vent_type": "Intermittent MEV"}
            }}
        });
        // Emitters are keyed by row name, so reordering them cannot move a product.
        let keys = BTreeMap::from([
            (
                "/SpaceHeatSystem/rads/emitters/0".into(),
                "/SpaceHeatSystem/rads/emitters/Hall".into(),
            ),
            (
                "/SpaceHeatSystem/rads/emitters/1".into(),
                "/SpaceHeatSystem/rads/emitters/Bed".into(),
            ),
        ]);
        let references = ProductReferences::from([
            ("/HeatSourceWet/hp".into(), 693001),
            ("/SpaceHeatSystem/rads/emitters/Bed".into(), 650000),
            ("/HeatSourceWet/gone".into(), 1),
        ]);
        let mut errors = Vec::new();
        let slots = apply_product_references(&mut model, &references, &keys, &mut errors);
        assert_eq!(model["HeatSourceWet"]["hp"]["product_id"], 693001);
        assert_eq!(
            model["SpaceHeatSystem"]["rads"]["emitters"][1]["product_id"],
            650000
        );
        let found: Vec<_> = errors
            .iter()
            .map(|e| (e.code.as_str(), e.path.as_str()))
            .collect();
        assert_eq!(
            found,
            [
                ("E_PRODUCT_REQUIRED", "/SpaceHeatSystem/rads/emitters/0"),
                (
                    "E_PRODUCT_REQUIRED",
                    "/InfiltrationVentilation/MechanicalVentilation/cmev"
                ),
                ("E_PRODUCT_REFERENCE_UNMATCHED", "/HeatSourceWet/gone"),
            ]
        );
        assert!(errors[0].message.contains("'Hall' (radiator)"));
        assert_eq!(slots.len(), 4);
    }

    /// Paths of the full-input definitions that require `product_id`, with the `type` (or
    /// `wet_emitter_type`) values selecting them; `None` when the definition has no such const.
    fn schema_product_slots() -> BTreeMap<String, Option<std::collections::BTreeSet<String>>> {
        let schema: Value = serde_json::from_str(include_str!(
            "../../../data/schemas/hem_epc_orchestrator_input.schema.json"
        ))
        .unwrap();
        let defs = schema["$defs"].as_object().unwrap();
        let mut out = BTreeMap::new();
        fn walk(
            node: &Value,
            path: &[String],
            defs: &Map<String, Value>,
            seen: &mut Vec<(String, Vec<String>)>,
            out: &mut BTreeMap<String, Option<std::collections::BTreeSet<String>>>,
        ) {
            match node {
                Value::Array(items) => items.iter().for_each(|n| walk(n, path, defs, seen, out)),
                Value::Object(map) => {
                    if let Some(name) = map.get("$ref").and_then(Value::as_str) {
                        let name = name.rsplit('/').next().unwrap().to_string();
                        let def = &defs[&name];
                        let required = |key: &str| {
                            def["required"]
                                .as_array()
                                .is_some_and(|r| r.iter().any(|k| k == key))
                        };
                        // HEMIE definitions are marked by name or by a required `model_type`.
                        if name.to_lowercase().contains("hemie")
                            || required("model_type")
                            || seen.contains(&(name.clone(), path.to_vec()))
                        {
                            return;
                        }
                        if required("product_id") {
                            let discriminator = ["type", "wet_emitter_type"]
                                .iter()
                                .find_map(|k| def["properties"][k]["const"].as_str());
                            let entry = out
                                .entry(path.join("/"))
                                .or_insert_with(|| Some(Default::default()));
                            match (discriminator, entry.as_mut()) {
                                (Some(value), Some(values)) => {
                                    values.insert(value.to_string());
                                }
                                _ => *entry = None,
                            }
                        }
                        seen.push((name, path.to_vec()));
                        walk(def, path, defs, seen, out);
                        return;
                    }
                    for key in ["anyOf", "oneOf", "allOf", "then", "else"] {
                        if let Some(child) = map.get(key) {
                            walk(child, path, defs, seen, out);
                        }
                    }
                    if let Some(properties) = map.get("properties").and_then(Value::as_object) {
                        for (key, child) in properties {
                            walk(
                                child,
                                &[path, std::slice::from_ref(key)].concat(),
                                defs,
                                seen,
                                out,
                            );
                        }
                    }
                    for key in ["additionalProperties", "items"] {
                        if let Some(child) = map.get(key).filter(|c| c.is_object()) {
                            walk(child, &[path, &["*".to_string()]].concat(), defs, seen, out);
                        }
                    }
                }
                _ => {}
            }
        }
        walk(
            &json!({"properties": schema["properties"]}),
            &[],
            defs,
            &mut Vec::new(),
            &mut out,
        );
        out
    }

    #[test]
    fn slot_table_matches_the_schema() {
        let mut schema = schema_product_slots();
        // Inline `MixerShower` stays valid; see `PRODUCT_SLOTS`.
        assert!(schema.remove("HotWaterDemand/Shower/*").is_some());
        let table: BTreeMap<String, Option<std::collections::BTreeSet<String>>> = PRODUCT_SLOTS
            .iter()
            .map(|rule| {
                (
                    rule.path.join("/"),
                    rule.requires
                        .map(|(_, values)| values.iter().map(|v| v.to_string()).collect()),
                )
            })
            .collect();
        assert_eq!(table, schema);
    }
}
