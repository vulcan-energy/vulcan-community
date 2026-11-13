// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! Field shapes of the HEM:EPC full input (Orchestrator 0.13.2a0 schema) that no FHS
//! target uses. The builder calls each mapping only when the model profile answers the
//! matching capability question. A value with a Vulcan source is mapped from it; a value
//! without one comes from the target's defaults and is reported; nothing is a code default.

use crate::finalization::SchemaOmission;
use crate::target_mappings::TARGET_INPUT_WARNING;
use crate::{json_pointer, ValidationError};
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

/// Cavity types that take a lining type; every other cavity type must not state one
/// (HEM Core 2.0.0a4 `BuildingElementPartyWall.validate_party_wall_lining_type`).
const LINED_PARTY_WALL_CAVITIES: [&str; 3] =
    ["filled_unsealed", "unfilled_sealed", "unfilled_unsealed"];

/// A party wall's lining type must be stated for a lined cavity type and absent otherwise.
/// Either mismatch is an error naming the wall; nothing is dropped.
pub(crate) fn check_party_wall_lining(model: &Value, errors: &mut Vec<ValidationError>) {
    for (zone, zone_value) in model["Zone"].as_object().into_iter().flatten() {
        for (name, element) in zone_value["BuildingElement"]
            .as_object()
            .into_iter()
            .flatten()
        {
            if element["type"] != "BuildingElementPartyWall" {
                continue;
            }
            let cavity = element["party_wall_cavity_type"]
                .as_str()
                .unwrap_or_default();
            let lining = element
                .get("party_wall_lining_type")
                .filter(|v| !v.is_null());
            let lined = LINED_PARTY_WALL_CAVITIES.contains(&cavity);
            let message = match (lined, lining) {
                (true, None) => format!("Party wall '{name}' has cavity type {cavity}, which needs party_wall_lining_type. State the lining type."),
                (false, Some(lining)) if cavity.is_empty() => format!("Party wall '{name}' states party_wall_lining_type {lining} but no party_wall_cavity_type. State the cavity type."),
                (false, Some(lining)) => format!("Party wall '{name}' states party_wall_lining_type {lining}, but its cavity type {cavity} takes none (only {} do). Remove the lining type or correct the cavity type.", LINED_PARTY_WALL_CAVITIES.join(", ")),
                _ => continue,
            };
            errors.push(error(
                "E_EPC_PARTY_WALL_LINING",
                json_pointer(&[
                    "Zone",
                    zone,
                    "BuildingElement",
                    name,
                    "party_wall_lining_type",
                ]),
                message,
            ));
        }
    }
}

/// DESNZ-defined colour to solar absorption map (also the FHS wrapper's
/// `COLOUR_TO_SOLAR_ABSORPTION_MAP`).
pub(crate) fn solar_absorption_coeff(colour: &str) -> Option<f64> {
    match colour {
        "Light" => Some(0.3),
        "Intermediate" => Some(0.6),
        "Dark" => Some(0.9),
        _ => None,
    }
}

/// The appliance presence fields, the Metadata row that states each, and the Appliances keys
/// that show one is drawn. Presence is a required assessor input (DESNZ-defined): a missing
/// row is an error, never "absent".
pub(crate) const APPLIANCE_PRESENCE: [(&str, &str, &[&str]); 3] = [
    ("has_dryer", "Appliances_has_dryer", &["Clothes_drying"]),
    (
        "has_dishwasher",
        "Appliances_has_dishwasher",
        &["Dishwasher"],
    ),
    (
        "has_separate_fridge_or_freezer",
        "Appliances_has_separate_fridge_or_freezer",
        &["Fridge", "Freezer"],
    ),
];

/// Appliance presence comes from Metadata rows, checked against drawn Appliances rows; `Oven` and `Hobs` take the row's `EnergySupply`, which EPC
/// requires (DESNZ-defined): a missing one is an error, never a template value.
/// `presence` holds, per `APPLIANCE_PRESENCE` row, whether its Metadata row is present and the
/// value the shared CSV boolean parser read (None for a value it already reported).
pub(crate) fn map_appliances(
    model: &mut Value,
    csv: &Rows,
    presence: [(bool, Option<bool>); 3],
    errors: &mut Vec<ValidationError>,
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
    for ((field, row, keys), (present, value)) in APPLIANCE_PRESENCE.into_iter().zip(presence) {
        let drawn = has(keys);
        if !present {
            errors.push(error(
                "E_EPC_APPLIANCE_PRESENCE",
                format!("/Appliances/{field}"),
                format!("HEM:EPC requires the appliance spaces to be stated: add the Metadata row '{row}' with TRUE or FALSE."),
            ));
            continue;
        }
        match value {
            None => {}
            Some(false) if drawn => errors.push(error(
                "E_EPC_APPLIANCE_PRESENCE",
                "/Metadata".into(),
                format!("Metadata row '{row}' is FALSE, but the plan has a {} appliance. Correct one of them.", keys.join(" or ")),
            )),
            Some(present) => {
                appliances.insert(field.into(), json!(present));
            }
        }
    }
    for key in ["Oven", "Hobs"] {
        let authored = rows
            .iter()
            .filter(|row| key_of(row) == Some(key))
            .find_map(|row| row.get("extra_json")?.get("EnergySupply")?.as_str());
        match authored {
            Some(supply) => {
                appliances.insert(key.into(), json!({ "EnergySupply": supply }));
            }
            None => errors.push(error(
                "E_EPC_COOKING_SUPPLY",
                format!("/Appliances/{key}"),
                format!("State the energy supply of the {key}: add an Appliances row '{key}' with an EnergySupply. HEM:EPC requires it and there is no default."),
            )),
        }
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

const VENTILATION_DEFAULT_FIELDS: [&str; 2] = ["sup_air_flw_ctrl", "sup_air_temp_ctrl"];

/// Mechanical ventilation fields EPC adds come from the target defaults' template for the
/// system's `vent_type` unless its Ventilation Systems row states them; report each one used.
pub(crate) fn report_ventilation_defaults(
    model: &Value,
    csv: &Rows,
    errors: &mut Vec<ValidationError>,
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
        // A continuous system's installation type is a required assessor input (no default).
        let continuous = !matches!(
            system.get("vent_type").and_then(Value::as_str),
            Some("Intermittent MEV" | "Positive input ventilation")
        );
        if continuous
            && !system
                .as_object()
                .is_some_and(|s| s.contains_key("installation_type"))
        {
            errors.push(error(
                "E_EPC_VENTILATION_INSTALLATION",
                json_pointer(&["InfiltrationVentilation", "MechanicalVentilation", name, "installation_type"]),
                format!("Ventilation system '{name}': state its installation_type (installation_scheme or no_installation_scheme) on its Ventilation Systems row. There is no default."),
            ));
        }
        // A stopped intermittent extract fan leaks; its back-draught protection and diameter
        // are assessor inputs with no default (DESNZ-defined).
        let intermittent =
            system.get("vent_type").and_then(Value::as_str) == Some("Intermittent MEV");
        if intermittent
            && system
                .get("leakage_when_stopped")
                .is_none_or(Value::is_null)
        {
            errors.push(error(
                "E_EPC_FAN_LEAKAGE",
                json_pointer(&["InfiltrationVentilation", "MechanicalVentilation", name, "leakage_when_stopped"]),
                format!("Intermittent extract fan '{name}': state leakage_when_stopped with its back_draught_protection (internal damper, external terminal or none) and diameter (100 mm or 150 mm) on its Ventilation Systems row. There is no default."),
            ));
        }
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

/// Thermostat positions move into `tank_controls`. A wet coil must state its flow and heat
/// transfer rates; a missing one is an error naming the cylinder, never a template value.
pub(crate) fn map_cylinder_coils(model: &mut Value, errors: &mut Vec<ValidationError>) {
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
                for field in COIL_FIELDS
                    .into_iter()
                    .filter(|f| !heat_source.contains_key(*f))
                {
                    errors.push(error(
                        "E_EPC_CYLINDER_COIL",
                        format!("{path}/{field}"),
                        format!("Cylinder '{source_name}': state its coil's {field} (heat source '{name}') on the cylinder's Systems row. There is no default."),
                    ));
                }
            }
        }
        if !controls.is_empty() && !source.contains_key("tank_controls") {
            source.insert("tank_controls".into(), Value::Array(controls));
        }
    }
}

/// Every opaque element states `solar_absorption_coeff` (EPC requires it). A new build must
/// author the coefficient; the colour-to-coefficient map (HEMIE) applies only to an existing
/// building. `from_colour` lists the element paths whose coefficient came from a colour.
pub(crate) fn check_solar_absorption(
    model: &mut Value,
    from_colour: &[String],
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) {
    let existing = model["IsExistingBuilding"] == true;
    for (zone, zone_value) in model["Zone"].as_object_mut().into_iter().flatten() {
        for (name, element) in zone_value["BuildingElement"]
            .as_object_mut()
            .into_iter()
            .flatten()
        {
            let path = json_pointer(&["Zone", zone, "BuildingElement", name]);
            let from_a_colour = from_colour.contains(&path);
            if existing && from_a_colour {
                notices.push(notice(&format!("{path}/solar_absorption_coeff"), format!("Element '{name}' takes solar_absorption_coeff {} from its colour (DESNZ's map for an existing building).", element["solar_absorption_coeff"])));
            }
            if !existing && from_a_colour {
                if let Some(element) = element.as_object_mut() {
                    element.remove("solar_absorption_coeff");
                }
            }
            if element["type"] == "BuildingElementOpaque"
                && element.get("solar_absorption_coeff").is_none()
            {
                let message = match (existing, from_a_colour) {
                    (false, true) => format!("Element '{name}' gives a colour, which only an existing building may use. A new build states solar_absorption_coeff."),
                    (false, false) => format!("Element '{name}' needs its solar_absorption_coeff. There is no default."),
                    (true, _) => format!("Element '{name}' needs its solar_absorption_coeff or its surface colour (Light, Intermediate or Dark). There is no default."),
                };
                errors.push(error(
                    "E_EPC_SOLAR_ABSORPTION",
                    format!("{path}/solar_absorption_coeff"),
                    message,
                ));
            }
        }
    }
}

/// DESNZ's defaults for HEM:EPC inputs, each applied only when the input is absent and
/// reported; values the converter works out from the model are reported too.
/// - Battery: location outside, age 5 years, grid charging possible, no grid export
///   (DESNZ-defined).
/// - Wet distribution: no variable flow, and then a design flow rate of 0.06 L/s
///   (DESNZ-defined).
/// - Ventilation zone base height: 0 m for a house, bungalow or park home (DESNZ-defined);
///   any other built form must state it.
/// - Envelope area: always derived from the drawn elements, reported.
/// - Window shading: a window with no drawn shading has none, derived from the drawing and
///   reported.
pub(crate) fn apply_desnz_defaults(
    model: &mut Value,
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) {
    for (supply, value) in model["EnergySupply"].as_object_mut().into_iter().flatten() {
        let Some(battery) = value
            .get_mut("ElectricBattery")
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        let mut used = Vec::new();
        for (field, default) in [
            ("battery_location", json!("outside")),
            ("battery_age", json!(5)),
            ("grid_charging_possible", json!(true)),
            ("grid_exporting_possible", json!(false)),
        ] {
            if !battery.contains_key(field) {
                used.push(format!("{field} {default}"));
                battery.insert(field.into(), default);
            }
        }
        if !used.is_empty() {
            notices.push(notice(&json_pointer(&["EnergySupply", supply, "ElectricBattery"]), format!("The battery on '{supply}' does not state {}, so it uses DESNZ's defaults. State them on its row to change them.", used.join(", "))));
        }
    }
    for (name, system) in model["SpaceHeatSystem"]
        .as_object_mut()
        .into_iter()
        .flatten()
    {
        let Some(system) = system
            .as_object_mut()
            .filter(|s| s.get("type") == Some(&json!("WetDistribution")))
        else {
            continue;
        };
        let mut used = Vec::new();
        if !system.contains_key("variable_flow") {
            system.insert("variable_flow".into(), json!(false));
            used.push("variable_flow false".to_string());
        }
        if system["variable_flow"] == false && !system.contains_key("design_flow_rate") {
            system.insert("design_flow_rate".into(), json!(0.06));
            used.push("design_flow_rate 0.06".to_string());
        }
        if !used.is_empty() {
            notices.push(notice(&json_pointer(&["SpaceHeatSystem", name]), format!("Wet distribution '{name}' does not state {}, so it uses DESNZ's defaults. State them on its Systems row to change them.", used.join(" and "))));
        }
    }
    let mut unshaded = Vec::new();
    for (zone, zone_value) in model["Zone"].as_object_mut().into_iter().flatten() {
        for (name, element) in zone_value["BuildingElement"]
            .as_object_mut()
            .into_iter()
            .flatten()
        {
            if let Some(element) = element.as_object_mut().filter(|e| {
                e.get("type") == Some(&json!("BuildingElementTransparent"))
                    && !e.contains_key("shading")
            }) {
                element.insert("shading".into(), json!([]));
                unshaded.push(format!("{zone}/{name}"));
            }
        }
    }
    if !unshaded.is_empty() {
        notices.push(notice(
            "/Zone",
            format!(
                "No shading is drawn for {}, so they have none. Draw Window Shading to add it.",
                unshaded.join(", ")
            ),
        ));
    }
    let build_type = model["General"]["build_type"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    if let Some(ventilation) = model
        .get_mut("InfiltrationVentilation")
        .and_then(Value::as_object_mut)
    {
        // Stated by a Metadata row or a Systems InfiltrationVentilation row: both are merged
        // into the model before this runs, and the EPC template carries no value.
        if ventilation
            .get("ventilation_zone_base_height")
            .is_none_or(Value::is_null)
        {
            let path = "/InfiltrationVentilation/ventilation_zone_base_height";
            if [
                "detached",
                "semi_detached_end_terrace",
                "mid_terrace",
                "bungalow",
                "park home",
            ]
            .contains(&build_type.as_str())
            {
                ventilation.insert("ventilation_zone_base_height".into(), json!(0));
                notices.push(notice(path, format!("No Metadata row states Ventilation_ventilation_zone_base_height, so this {build_type} uses 0 m, DESNZ's default for a dwelling at ground level. Add the row to state it.")));
            } else {
                errors.push(error("E_EPC_REQUIRED_INPUT", path.into(), format!("A {} must state its ventilation zone base height: add the Metadata row Ventilation_ventilation_zone_base_height.", if build_type.is_empty() { "dwelling with no built form" } else { &build_type })));
            }
        }
        if let Some(area) = ventilation.get("Leaks").and_then(|l| l.get("env_area")) {
            notices.push(notice("/InfiltrationVentilation/Leaks/env_area", format!("The envelope area {area} m² is derived from the drawn elements that separate the dwelling from outside, other dwellings and unheated spaces.")));
        }
    }
}

/// Each building element states every field its schema definition requires, named in one
/// error per element: there is no template value. The definition is the target schema's own
/// for the element's `type` (and `floor_type`, for ground floors).
pub(crate) fn check_element_fields(
    model: &Value,
    schema: &Value,
    errors: &mut Vec<ValidationError>,
) {
    let defs = schema["$defs"].as_object();
    for (zone, zone_value) in model["Zone"].as_object().into_iter().flatten() {
        for (name, element) in zone_value["BuildingElement"]
            .as_object()
            .into_iter()
            .flatten()
        {
            let Some(element) = element.as_object() else {
                continue;
            };
            let def = defs.into_iter().flatten().map(|(_, def)| def).find(|def| {
                let properties = def["properties"].as_object();
                properties.is_some_and(|properties| {
                    properties.get("type").and_then(|t| t.get("const")) == element.get("type")
                        && properties.iter().filter(|(key, _)| *key != "type").all(
                            |(key, property)| {
                                property
                                    .get("const")
                                    .is_none_or(|c| element.get(key).is_none_or(|v| v == c))
                            },
                        )
                }) && !def
                    .get("required")
                    .and_then(Value::as_array)
                    .is_some_and(|r| r.iter().any(|f| f == "model_type"))
            });
            let Some(def) = def else {
                continue;
            };
            let mut missing: Vec<String> = def["required"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|field| !element.contains_key(*field))
                // A field another check already named has its own error.
                .filter(|field| {
                    let path = json_pointer(&["Zone", zone, "BuildingElement", name, field]);
                    !errors.iter().any(|e| e.path == path)
                })
                .map(str::to_string)
                .collect();
            // Alternatives (`oneOf`/`anyOf` of `required` lists), at the top or in `allOf`.
            let parts = std::iter::once(def).chain(def["allOf"].as_array().into_iter().flatten());
            for part in parts {
                for key in ["oneOf", "anyOf"] {
                    let groups: Vec<Vec<&str>> = part[key]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|group| group["required"].as_array())
                        .map(|r| r.iter().filter_map(Value::as_str).collect())
                        .collect();
                    if !groups.is_empty()
                        && !groups
                            .iter()
                            .any(|g| g.iter().all(|f| element.contains_key(*f)))
                    {
                        missing.push(format!(
                            "one of {}",
                            groups
                                .iter()
                                .map(|g| g.join(" + "))
                                .collect::<Vec<_>>()
                                .join(" or ")
                        ));
                    }
                }
            }
            if !missing.is_empty() {
                let kind = element
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                errors.push(error(
                    "E_EPC_REQUIRED_INPUT",
                    json_pointer(&["Zone", zone, "BuildingElement", name]),
                    format!(
                        "Element '{name}' ({kind}) needs {}. HEM:EPC has no default for them.",
                        missing.join(", ")
                    ),
                ));
            }
        }
    }
}

/// Each drawn primary pipe states every field the target schema's pipe definition requires,
/// named in one error per pipe (the builder names its Water Pipework row): the EPC template
/// has no pipe values.
pub(crate) fn check_primary_pipework(
    model: &Value,
    schema: &Value,
    errors: &mut Vec<ValidationError>,
) {
    let required: Vec<&str> = schema["$defs"]
        .as_object()
        .into_iter()
        .flatten()
        .find(|(name, _)| name.ends_with("input_output__input__WaterPipework"))
        .and_then(|(_, def)| def["required"].as_array())
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    for (cylinder, source) in model["HotWaterSource"].as_object().into_iter().flatten() {
        for (i, pipe) in source["primary_pipework"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            let missing: Vec<&str> = required
                .iter()
                .copied()
                .filter(|field| pipe.get(*field).is_none_or(Value::is_null))
                .collect();
            if !missing.is_empty() {
                errors.push(error(
                    "E_EPC_REQUIRED_INPUT",
                    json_pointer(&["HotWaterSource", cylinder, "primary_pipework", &i.to_string()]),
                    format!("This primary pipe of cylinder '{cylinder}' needs {}. HEM:EPC has no default for them.", missing.join(", ")),
                ));
            }
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
pub(crate) struct SlotRule {
    pub path: &'static [&'static str],
    pub requires: Option<(&'static str, &'static [&'static str])>,
    pub inline: Option<(&'static str, &'static [&'static str])>,
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
pub(crate) const PRODUCT_SLOTS: &[SlotRule] = &[
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

pub(crate) fn collect<'a>(
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

    #[test]
    fn a_party_wall_states_a_lining_type_exactly_when_its_cavity_takes_one() {
        let wall = |cavity: &str, lining: Option<&str>| {
            let mut wall =
                json!({"type": "BuildingElementPartyWall", "party_wall_cavity_type": cavity});
            if let Some(lining) = lining {
                wall["party_wall_lining_type"] = json!(lining);
            }
            wall
        };
        let model = json!({"Zone": {"z": {"BuildingElement": {
            "ok sealed": wall("filled_sealed", None),
            "ok lined": wall("unfilled_sealed", Some("dry_lined")),
            "extra": wall("filled_sealed", Some("dry_lined")),
            "missing": wall("filled_unsealed", None),
            "not a party wall": {"type": "BuildingElementOpaque", "party_wall_lining_type": "dry_lined"}
        }}}});
        let mut errors = Vec::new();
        check_party_wall_lining(&model, &mut errors);
        let found: Vec<_> = errors
            .iter()
            .map(|e| (e.path.as_str(), e.message.split(',').next().unwrap()))
            .collect();
        assert_eq!(
            found,
            [
                (
                    "/Zone/z/BuildingElement/extra/party_wall_lining_type",
                    "Party wall 'extra' states party_wall_lining_type \"dry_lined\""
                ),
                (
                    "/Zone/z/BuildingElement/missing/party_wall_lining_type",
                    "Party wall 'missing' has cavity type filled_unsealed"
                ),
            ]
        );
    }
}
