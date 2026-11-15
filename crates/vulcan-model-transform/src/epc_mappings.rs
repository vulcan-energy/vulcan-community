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
/// The Global Settings label of an appliance presence row.
fn appliance_label(row: &str) -> &'static str {
    match row {
        "Appliances_has_dryer" => "Has a clothes dryer",
        "Appliances_has_dishwasher" => "Has a dishwasher",
        _ => "Has a separate fridge or freezer",
    }
}

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
                format!("HEM:EPC needs to know whether the dwelling has space for this appliance. Choose Yes or No in Global Settings > Dwelling Details ({}).", appliance_label(row)),
            ));
            continue;
        }
        match value {
            None => {}
            Some(false) if drawn => errors.push(error(
                "E_EPC_APPLIANCE_PRESENCE",
                "/Metadata".into(),
                format!("{} is No in Global Settings > Dwelling Details, but the plan has a {} appliance. Correct one of them.", appliance_label(row), keys.join(" or ").replace('_', " ").to_lowercase()),
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

/// `mounting_type` and `panel_count` are read only by an existing building's PV form.
const PV_PANEL_KEYS: [&str; 10] = [
    "mounting_type",
    "panel_count",
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
                format!("Ventilation system '{name}': choose its installation type (installation scheme or no installation scheme). There is no default."),
            ));
        }
        // An MVHR's location (inside or outside the envelope) is an assessor input with no
        // default (DESNZ-defined).
        if system.get("vent_type").and_then(Value::as_str) == Some("MVHR")
            && system.get("mvhr_location").is_none_or(Value::is_null)
        {
            errors.push(error(
                "E_EPC_VENTILATION_MVHR_LOCATION",
                json_pointer(&["InfiltrationVentilation", "MechanicalVentilation", name, "mvhr_location"]),
                format!("MVHR '{name}': choose its MVHR location (inside or outside the insulated envelope). There is no default."),
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
                format!("Intermittent extract fan '{name}': choose its back-draught protection (internal damper, external terminal or none) and diameter (100 mm or 150 mm) under leakage when stopped. There is no default."),
            ));
        }
        let used: Vec<String> = VENTILATION_DEFAULT_FIELDS
            .iter()
            .filter(|field| !authored(field))
            .filter_map(|field| Some(format!("{field} {}", system.get(*field)?)))
            .collect();
        if !used.is_empty() {
            let path = json_pointer(&["InfiltrationVentilation", "MechanicalVentilation", name]);
            notices.push(notice(&path, format!("The ventilation system '{name}' does not state these settings, so the model uses the defaults: {}. State them on the system to change them.", used.join(", ").replace('_', " "))));
        }
    }
}

/// An MVHR's drawn ducts as the full input's ductwork descriptor (an object, not the FHS list).
/// Each descriptor field the drawing gives one value for is mapped from it; a field the system
/// states in its own `ductwork` object keeps that value; every other field takes the
/// DESNZ-defined default, and the notice names it.
pub(crate) fn mvhr_ductwork(
    name: &str,
    stated: Option<&Map<String, Value>>,
    ducts: &[Value],
    location: Option<&str>,
) -> (Value, Option<SchemaOmission>) {
    let path = json_pointer(&[
        "InfiltrationVentilation",
        "MechanicalVentilation",
        name,
        "ductwork",
    ]);
    let mut out = stated.cloned().unwrap_or_default();
    if ducts.is_empty() {
        let notice = notice(&path, format!("The MVHR '{name}' has no drawn ducts, so its ductwork uses the defaults. Draw its ducts to change them."));
        return (Value::Object(out), Some(notice));
    }
    // HEM counts only the intake and exhaust ducts of an MVHR inside the envelope, and only the
    // supply and extract ducts of one outside it; the full input states only those lengths.
    let counted: &[&str] = match location {
        Some("inside") => &["intake", "exhaust"],
        Some("outside") => &["supply", "extract"],
        _ => &["intake", "exhaust", "supply", "extract"],
    };
    let ducts: Vec<&Value> = ducts
        .iter()
        .filter(|d| {
            d["duct_type"]
                .as_str()
                .is_some_and(|t| counted.contains(&t))
        })
        .collect();
    let mut set = |field: &str,
                   value: Option<Value>,
                   missing: &mut Vec<&'static str>,
                   label: &'static str| {
        if out.contains_key(field) {
            return;
        }
        match value {
            Some(value) => {
                out.insert(field.into(), value);
            }
            None => missing.push(label),
        }
    };
    let one = |values: Vec<Option<Value>>| -> Option<Value> {
        let first = values.first()?.clone()?;
        values
            .iter()
            .all(|v| v.as_ref() == Some(&first))
            .then_some(first)
    };
    let mut missing = Vec::new();
    for duct_type in counted {
        let lengths: Vec<f64> = ducts
            .iter()
            .filter(|d| d["duct_type"] == *duct_type)
            .filter_map(|d| d["length"].as_f64())
            .collect();
        let label = match *duct_type {
            "intake" => "intake duct length",
            "exhaust" => "exhaust duct length",
            "supply" => "supply duct length",
            _ => "extract duct length",
        };
        let length = (!lengths.is_empty()).then(|| json!(lengths.iter().sum::<f64>()));
        set(&format!("{duct_type}_length"), length, &mut missing, label);
    }
    let shape = one(ducts
        .iter()
        .map(|d| d.get("cross_section_shape").cloned())
        .collect());
    // DESNZ-defined: the size bands, a rectangular duct's perimeter or a circular duct's
    // external diameter in mm, as a representative size.
    // Ours: each drawn duct takes its nearest band (the larger one at a tie), and the ductwork
    // the band with the greatest length (the larger one at a tie).
    let mut band_lengths = [0.0; 3];
    let mut banded = false;
    for d in &ducts {
        let (field, sizes) = match d["cross_section_shape"].as_str() {
            Some("rectangular") => ("duct_perimeter_mm", [328.0, 528.0, 620.0]),
            Some("circular") => ("external_diameter_mm", [100.0, 125.0, 150.0]),
            _ => continue,
        };
        let Some(mm) = d[field].as_f64() else {
            continue;
        };
        let distance = |i: usize| (sizes[i] - mm).abs();
        let band = (0..3)
            .rev()
            .min_by(|a, b| distance(*a).total_cmp(&distance(*b)));
        band_lengths[band.unwrap_or(2)] += d["length"].as_f64().unwrap_or(0.0);
        banded = true;
    }
    let size = banded.then(|| {
        let band = (0..3)
            .max_by(|a, b| band_lengths[*a].total_cmp(&band_lengths[*b]))
            .unwrap_or(2);
        json!(["small", "medium", "large"][band])
    });
    let insulated = one(ducts
        .iter()
        .map(|d| {
            Some(json!(
                d["insulation_thickness_mm"].as_f64().unwrap_or(0.0) > 0.0
            ))
        })
        .collect());
    set(
        "cross_section_shape",
        shape,
        &mut missing,
        "cross-section shape",
    );
    set("ductwork_size", size, &mut missing, "size");
    set("insulation_present", insulated, &mut missing, "insulation");
    let field = |key: &str| one(ducts.iter().map(|d| d.get(key).cloned()).collect());
    set(
        "insulation_thermal_conductivity",
        field("insulation_thermal_conductivity"),
        &mut missing,
        "insulation thermal conductivity",
    );
    set(
        "reflective",
        field("reflective"),
        &mut missing,
        "reflective surface",
    );
    let notice = (!missing.is_empty()).then(|| {
        notice(&path, format!("The MVHR '{name}' ductwork uses the default {}: its drawn ducts give no single value. Draw the missing ducts, or give the drawn ones one value, to change it.", missing.join(", ")))
    });
    (Value::Object(out), notice)
}

/// The full input's MVHR product states no `vent_type` (the product gives it), and only that
/// field tells it from a product without heat recovery. Dropped last, once product slots and
/// the existing-building conversion have read it.
pub(crate) fn drop_mvhr_vent_type(model: &mut Value) {
    for system in model
        .pointer_mut("/InfiltrationVentilation/MechanicalVentilation")
        .and_then(Value::as_object_mut)
        .into_iter()
        .flatten()
        .filter_map(|(_, s)| s.as_object_mut())
        .filter(|s| s.get("vent_type") == Some(&json!("MVHR")))
    {
        system.remove("vent_type");
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
                        format!("Cylinder '{source_name}': state its coil's {} (heat source '{name}') on the cylinder. There is no default.", field.replace('_', " ")),
                    ));
                }
            }
        }
        if !controls.is_empty() && !source.contains_key("tank_controls") {
            source.insert("tank_controls".into(), Value::Array(controls));
        }
    }
}

/// Every opaque element states `solar_absorption_coeff` (EPC requires it): its own, or the
/// DESNZ-defined coefficient for its colour (Light, Intermediate or Dark), on a new build and an
/// existing building alike. `from_colour` lists the element paths whose coefficient came from a
/// colour; each is reported.
pub(crate) fn check_solar_absorption(
    model: &Value,
    from_colour: &[String],
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) {
    for (zone, zone_value) in model["Zone"].as_object().into_iter().flatten() {
        for (name, element) in zone_value["BuildingElement"]
            .as_object()
            .into_iter()
            .flatten()
        {
            let path = json_pointer(&["Zone", zone, "BuildingElement", name]);
            if from_colour.contains(&path) {
                notices.push(notice(&format!("{path}/solar_absorption_coeff"), format!("Element '{name}' takes solar_absorption_coeff {} from its colour (the default colour map).", element["solar_absorption_coeff"])));
            }
            if element["type"] == "BuildingElementOpaque"
                && element.get("solar_absorption_coeff").is_none()
            {
                errors.push(error(
                    "E_EPC_SOLAR_ABSORPTION",
                    format!("{path}/solar_absorption_coeff"),
                    format!("Element '{name}' needs its solar absorption coefficient or its surface colour (Light, Intermediate or Dark). There is no default."),
                ));
            }
        }
    }
}

/// Inputs a new build states and an existing building may leave to a DESNZ-defined default: the
/// model path, the `type` that has the field (empty: any), the field, and the existing-building
/// default (None: HEMIE applies it, or asks for it). Values: direct feed maximum power 15 kW,
/// mixer shower 9 L/min; a tank's location has none; the rest are HEMIE's (air conditioning and heat-pump warm-air convective fraction, instant
/// heater power and convective type, storage heater units, immersion power and position, coil
/// position, solar loop inputs, buffer tank pump flow rate).
const STATED_OR_DEFAULTED: [(&[&str], &str, &str, Option<f64>); 17] = [
    (&["HotWaterSource", "*"], "StorageTank", "location", None),
    (
        &["HotWaterSource", "*"],
        "SmartHotWaterTank",
        "location",
        None,
    ),
    (
        &["HeatSourceWet", "*"],
        "DirectFeed",
        "power_max",
        Some(15.0),
    ),
    (
        &["HotWaterDemand", "Shower", "*"],
        "MixerShower",
        "flowrate",
        Some(9.0),
    ),
    (
        &["SpaceCoolSystem", "*"],
        "AirConditioning",
        "frac_convective",
        None,
    ),
    (
        &["SpaceHeatSystem", "*"],
        "WarmAir",
        "frac_convective",
        None,
    ),
    (
        &["SpaceHeatSystem", "*"],
        "InstantElecHeater",
        "rated_power",
        None,
    ),
    (
        &["SpaceHeatSystem", "*"],
        "InstantElecHeater",
        "convective_type",
        None,
    ),
    (
        &["SpaceHeatSystem", "*"],
        "ElecStorageHeater",
        "n_units",
        None,
    ),
    (
        &["HotWaterSource", "*", "HeatSource", "*"],
        "ImmersionHeater",
        "power",
        None,
    ),
    (
        &["HotWaterSource", "*", "HeatSource", "*"],
        "ImmersionHeater",
        "heater_position",
        None,
    ),
    (
        &["HotWaterSource", "*", "HeatSource", "*"],
        "HeatSourceWet",
        "heater_position",
        None,
    ),
    (
        &["HotWaterSource", "*", "HeatSource", "*"],
        "SolarThermalSystem",
        "sol_loc",
        None,
    ),
    (
        &["HotWaterSource", "*", "HeatSource", "*"],
        "SolarThermalSystem",
        "heater_position",
        None,
    ),
    (
        &["HotWaterSource", "*", "HeatSource", "*"],
        "SolarThermalSystem",
        "collector_mass_flow_rate",
        None,
    ),
    (
        &["HotWaterSource", "*", "HeatSource", "*"],
        "SolarThermalSystem",
        "solar_loop_piping_hlc",
        None,
    ),
    (
        &["HeatSourceWet", "*", "BufferTank"],
        "",
        "pump_fixed_flow_rate",
        None,
    ),
];

/// DESNZ's defaults for HEM:EPC inputs, each applied only when the input is absent and
/// reported; values the converter works out from the model are reported too.
/// - Battery: location outside, age 5 years, grid charging possible, no grid export
///   (DESNZ-defined).
/// - Wet distribution: no variable flow, and then a design flow rate of 0.06 L/s
///   (DESNZ-defined), written as 3.6 because HEM reads `design_flow_rate` in L/min; the design
///   flow temperature by emitter type and temperature difference by heat source type
///   (DESNZ-defined).
/// - Ventilation zone base height: 0 m for a house, bungalow or park home, or a dwelling whose
///   base storey is the ground floor (DESNZ-defined); any other built form must state it.
/// - Envelope area: from the air test report when stated, else derived from the drawn elements,
///   reported.
/// - Window shading: a window with no drawn shading has none, derived from the drawing and
///   reported.
pub(crate) fn apply_desnz_defaults(
    model: &mut Value,
    env_area_stated: bool,
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
    derived: &mut Vec<crate::DerivedDefault>,
) {
    let existing = model["IsExistingBuilding"] == true;
    let mut derive = |path: String, field: &str, value: Value| {
        derived.push(crate::DerivedDefault {
            path,
            field: field.into(),
            value,
        })
    };
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
            notices.push(notice(&json_pointer(&["EnergySupply", supply, "ElectricBattery"]), format!("The battery on '{supply}' does not state {}, so it uses the defaults. State them on the battery to change them.", used.join(", ").replace('_', " "))));
        }
    }
    let heat_source_types: BTreeMap<String, String> = model["HeatSourceWet"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(name, source)| Some((name.clone(), source["type"].as_str()?.to_string())))
        .collect();
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
            system.insert("design_flow_rate".into(), json!(3.6));
            used.push("design_flow_rate 3.6 (L/min)".to_string());
        }
        // DESNZ-defined: the design flow temperature by emitter type and the design temperature
        // difference by heat source type, when every emitter or heat source agrees; otherwise
        // the system states them.
        let one = |values: Vec<Option<&str>>| -> Option<String> {
            let first = values.first().copied().flatten()?;
            values
                .iter()
                .all(|v| *v == Some(first))
                .then(|| first.to_string())
        };
        let emitter = one(system["emitters"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|e| e["wet_emitter_type"].as_str())
            .collect());
        let sources: Vec<Option<&str>> = match &system["HeatSource"] {
            Value::Array(items) => items.iter().collect(),
            other => vec![other],
        }
        .into_iter()
        .map(|s| {
            s["name"]
                .as_str()
                .and_then(|n| heat_source_types.get(n))
                .map(String::as_str)
        })
        .collect();
        let source = one(sources);
        if !system.contains_key("design_flow_temp") {
            let temp = match emitter.as_deref() {
                Some("radiator") => Some(55),
                Some("fancoil" | "ufh") => Some(45),
                _ => None,
            };
            if let (Some(temp), Some(emitter)) = (temp, &emitter) {
                system.insert("design_flow_temp".into(), json!(temp));
                derive(
                    json_pointer(&["SpaceHeatSystem", name]),
                    "design_flow_temp",
                    json!(temp),
                );
                used.push(format!("design_flow_temp {temp} ({emitter})"));
            }
        }
        if !system.contains_key("temp_diff_emit_dsgn") {
            let diff = match source.as_deref() {
                Some("HeatPump") => Some(5),
                Some("Boiler" | "HeatBattery" | "PrimaryThermalStore") => Some(10),
                Some("HIU" | "DirectFeed") => Some(20),
                _ => None,
            };
            if let (Some(diff), Some(source)) = (diff, &source) {
                system.insert("temp_diff_emit_dsgn".into(), json!(diff));
                derive(
                    json_pointer(&["SpaceHeatSystem", name]),
                    "temp_diff_emit_dsgn",
                    json!(diff),
                );
                used.push(format!("temp_diff_emit_dsgn {diff} ({source})"));
            }
        }
        // No DESNZ default for the rest (plan questions E40, E59): each one missing is an error
        // naming the system, before the run fails on it.
        let path = json_pointer(&["SpaceHeatSystem", name]);
        let mut need = |field: &str, why: String| {
            errors.push(error("E_EPC_REQUIRED_INPUT", format!("{path}/{field}"), format!("Wet distribution '{name}': state its {} on the system. There is no default {why}.", field.replace('_', " "))));
        };
        if !system.contains_key("design_flow_temp") {
            need(
                "design_flow_temp",
                "when its emitters differ in type".into(),
            );
        }
        if !system.contains_key("temp_diff_emit_dsgn") {
            need(
                "temp_diff_emit_dsgn",
                match &source {
                    Some(source) => format!("for a {source} heat source"),
                    None => "when its heat sources differ in type".into(),
                },
            );
        }
        let radiators = system["emitters"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|e| e["wet_emitter_type"] == "radiator");
        // HEMIE requires the circuit's thermal mass with radiators, and HEM adds it to each
        // radiator's own (from its product), so it is only the mass not in the radiators.
        if existing && radiators && system.get("thermal_mass").is_none_or(Value::is_null) {
            need(
                "thermal_mass",
                "for the radiators of an existing building. HEM adds it to the radiators' own thermal mass, which their products give, so enter only the mass not in the radiators".into(),
            );
        }
        if !used.is_empty() {
            notices.push(notice(&path, format!("Wet distribution '{name}' does not state {}, so it uses the defaults. State them on the system to change them.", used.join(", ").replace('_', " "))));
        }
    }
    // DESNZ-defined values an existing building takes when they are not stated, and a new build
    // must state (DESNZ: a new build gives full information). HEMIE applies the existing-building
    // defaults of every system with a HEMIE form itself; these are the ones it does not.
    for (pattern, kind, field, default) in STATED_OR_DEFAULTED {
        let mut found = Vec::new();
        collect(model, pattern, Vec::new(), &mut found);
        for (segments, system) in found {
            // A mixer shower's product gives its flow rate.
            let Some(system) = system.as_object_mut().filter(|s| {
                (kind.is_empty() || s.get("type") == Some(&json!(kind)))
                    && !(kind == "MixerShower" && s.contains_key("product_id"))
            }) else {
                continue;
            };
            if system.get(field).is_some_and(|v| !v.is_null()) {
                continue;
            }
            let segments: Vec<&str> = segments.iter().map(String::as_str).collect();
            let path = json_pointer(&segments);
            let name = segments[..segments.len() - usize::from(kind.is_empty())]
                .last()
                .copied()
                .unwrap_or_default();
            let words = field.replace('_', " ");
            match (existing, default) {
                (true, Some(value)) => {
                    system.insert(field.into(), json!(value));
                    notices.push(notice(&path, format!("'{name}' does not state its {words}, so it uses the default, {value}. State it on the system to change it.")));
                }
                (true, None) => {}
                (false, _) => {
                    // A blank value, so the schema adds no second error for it.
                    system.remove(field);
                    errors.push(error("E_EPC_REQUIRED_INPUT", format!("{path}/{field}"), format!("'{name}' ({}) needs its {words}. A new build states it: there is no default.", match kind { "" => "buffer tank", "StorageTank" => "storage tank", "SmartHotWaterTank" => "smart hot water tank", _ => kind })));
                }
            }
        }
    }
    // DESNZ-defined: an unstated design outdoor air flow rate is the greater of 13 l/s plus
    // 6 l/s per bedroom and 0.3 l/s per m² of total floor area, in m³/h.
    let area: f64 = model["Zone"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(_, z)| z["area"].as_f64())
        .sum();
    let by_rooms = model["NumberOfBedrooms"]
        .as_u64()
        .map(|b| 13.0 + 6.0 * b as f64);
    for (name, system) in model["InfiltrationVentilation"]["MechanicalVentilation"]
        .as_object_mut()
        .into_iter()
        .flatten()
    {
        if system
            .get("design_outdoor_air_flow_rate")
            .is_some_and(|v| !v.is_null())
        {
            continue;
        }
        let path = json_pointer(&["InfiltrationVentilation", "MechanicalVentilation", name]);
        match by_rooms {
            Some(rate) => {
                let flow = rate.max(0.3 * area) * 3.6;
                system["design_outdoor_air_flow_rate"] = json!(flow);
                derive(path.clone(), "design_outdoor_air_flow_rate", json!(flow));
                notices.push(notice(&path, format!("'{name}' does not state its design outdoor air flow rate, so it uses the default estimate from the bedrooms and the {area:.1} m² floor area: {flow:.1} m³/h. State it from the commissioning certificate to change it.")));
            }
            None => errors.push(error("E_EPC_REQUIRED_INPUT", path, format!("'{name}' does not state its design outdoor air flow rate, and the model states no number of bedrooms to estimate it from. State the flow rate on the system, or the number of bedrooms in Global Settings > Dwelling Details."))),
        }
    }
    let mut unshaded = Vec::new();
    // An existing building takes close-shading categories on the window instead, and names the
    // windows that state none (`hemie_shading::close`).
    let existing = model.get("IsExistingBuilding") == Some(&Value::Bool(true));
    for (_, zone_value) in model["Zone"].as_object_mut().into_iter().flatten() {
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
                unshaded.push(name.clone());
            }
        }
    }
    if !unshaded.is_empty() && !existing {
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
    // DESNZ-defined: an existing building may give its base storey instead, and
    // HEMIE estimates the base height from it.
    let new_build = model.get("IsExistingBuilding") != Some(&Value::Bool(true));
    let storey = crate::hemie::base_storey(model);
    let base_storey = (!new_build).then_some(storey).flatten();
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
                notices.push(notice(path, format!("No ventilation zone base height is given, so this {build_type} uses 0 m, the default for a dwelling at ground level. Give it in Global Settings > Ventilation Environment to state it.")));
            } else if storey == Some(0) {
                // DESNZ-defined: a ground-floor flat or maisonette also defaults to 0 m.
                ventilation.insert("ventilation_zone_base_height".into(), json!(0));
                notices.push(notice(path, format!("No ventilation zone base height is given, so this ground-floor {build_type} uses 0 m, the default. Give it in Global Settings > Ventilation Environment to state it.")));
            } else if let Some(storey) = base_storey {
                notices.push(notice(path, format!("No ventilation zone base height is given, so the existing-building EPC estimates it from the storey of dwelling, {}.", storey + 1)));
            } else {
                errors.push(error("E_EPC_REQUIRED_INPUT", path.into(), format!("A {} must state its ventilation zone base height: give it in Global Settings > Ventilation Environment. An existing building may give its storey of dwelling instead, in Dwelling Details.", if build_type.is_empty() { "dwelling with no built form" } else { &build_type })));
            }
        }
        // Absent: the builder removed the template's value (`desnz_default_rows`). HEMIE
        // applies its own default on an existing building.
        if new_build && ventilation.get("noise_nuisance").is_none_or(Value::is_null) {
            ventilation.insert("noise_nuisance".into(), json!(false));
            notices.push(notice("/InfiltrationVentilation/noise_nuisance", "No noise nuisance is given, so the model uses No, the default. Give it in Global Settings > Ventilation Environment to state it.".to_string()));
        }
        if let Some(area) = ventilation
            .get("Leaks")
            .and_then(|l| l.get("env_area"))
            .and_then(Value::as_f64)
            .filter(|_| !env_area_stated)
        {
            notices.push(notice("/InfiltrationVentilation/Leaks/env_area", format!("Envelope area is {area:.1} m², from the drawn walls, floors and roofs. To use the air test value, enter Envelope area in Global Settings > Air tightness.")));
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
                        field_words(&missing)
                    ),
                ));
            }
        }
    }
}

/// Schema field names as words for a message: "internal diameter (mm)".
fn field_words<S: AsRef<str>>(fields: &[S]) -> String {
    fields
        .iter()
        .map(|f| f.as_ref().replace("_mm", " (mm)").replace('_', " "))
        .collect::<Vec<_>>()
        .join(", ")
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
                    format!("This primary pipe of cylinder '{cylinder}' needs {}. HEM:EPC has no default for them.", field_words(&missing)),
                ));
            }
        }
    }
}

/// A field the named entry must have: its own field, the same fact in its product's row, and
/// the value.
type Need = (&'static str, &'static str, &'static str);

/// Cooling from a heat pump: an air-to-air one for split air cooling, air-to-water for fan coils
/// (HEM Core 2.0.0a4 `cooling_heat_pump` raises for any other).
const AIR_COOLING: &[Need] = &[
    ("type", "", "HeatPump"),
    ("source_type", "sourceType", "OutsideAir"),
    ("sink_type", "sinkType", "Air"),
];
const FAN_COIL_COOLING: &[Need] = &[
    ("type", "", "HeatPump"),
    ("source_type", "sourceType", "OutsideAir"),
    ("sink_type", "sinkType", "Water"),
];

/// References between full-input systems that the JSON schema cannot check: the referring
/// section, the referring system's type (None: any), the reference's pointer inside it, the
/// section it names, and what the named entry must be. A meta system's members are checked
/// as well.
type SystemReference = (
    &'static str,
    Option<&'static str>,
    &'static str,
    &'static str,
    &'static [Need],
);
const SYSTEM_REFERENCES: [SystemReference; 7] = [
    (
        "SpaceHeatSystem",
        None,
        "/HeatSourceWarmAir",
        "/HeatSourceWarmAir",
        &[],
    ),
    (
        "SpaceHeatSystem",
        Some("WarmAir"),
        "/HeatSource/name",
        "/HeatSourceWet",
        &[],
    ),
    (
        "SpaceHeatSystem",
        None,
        "/FlueConfig/PassiveDuct",
        "/InfiltrationVentilation/PassiveDucts",
        &[],
    ),
    (
        "HeatSourceWet",
        None,
        "/integrated_space_heat_system/FlueConfig/PassiveDuct",
        "/InfiltrationVentilation/PassiveDucts",
        &[],
    ),
    (
        "SpaceCoolSystem",
        Some("HeatPumpAirCooling"),
        "/HeatSourceWet",
        "/HeatSourceWet",
        AIR_COOLING,
    ),
    (
        "SpaceCoolSystem",
        Some("HeatPumpFanCoilCooling"),
        "/HeatSourceWet",
        "/HeatSourceWet",
        FAN_COIL_COOLING,
    ),
    // A cooling system of any other type names no heat source; this catches a dangling one.
    (
        "SpaceCoolSystem",
        None,
        "/HeatSourceWet",
        "/HeatSourceWet",
        &[],
    ),
];

/// A cylinder's immersion heater that states `pv_diverter` true takes surplus PV through a
/// diverter on its electricity supply (`EnergySupply.<supply>.diverter`). Another heat source,
/// or a second diverter on one supply, is an error naming it.
pub(crate) fn map_pv_diverter(model: &mut Value, errors: &mut Vec<ValidationError>) {
    let mut diverters: Vec<(String, String, String)> = Vec::new();
    for (cylinder, source) in model["HotWaterSource"]
        .as_object_mut()
        .into_iter()
        .flatten()
    {
        for (name, heat_source) in source["HeatSource"].as_object_mut().into_iter().flatten() {
            let Some(heat_source) = heat_source.as_object_mut() else {
                continue;
            };
            if heat_source.remove("pv_diverter") != Some(json!(true)) {
                continue;
            }
            let path = json_pointer(&["HotWaterSource", cylinder, "HeatSource", name]);
            match heat_source.get("EnergySupply").and_then(Value::as_str) {
                Some(supply) if heat_source.get("type") == Some(&json!("ImmersionHeater")) => {
                    diverters.push((path, name.clone(), supply.to_string()))
                }
                _ => errors.push(error("E_EPC_PV_DIVERTER", path, format!("Cylinder '{cylinder}': heat source '{name}' states a PV diverter, which only an immersion heater with an electricity supply takes. Remove it."))),
            }
        }
    }
    for (path, name, supply) in diverters {
        match model
            .pointer_mut(&json_pointer(&["EnergySupply", &supply]))
            .filter(|e| e["fuel"] == "electricity" && e.get("diverter").is_none())
        {
            Some(entry) => entry["diverter"] = json!({ "HeatSource": name }),
            None => errors.push(error("E_EPC_PV_DIVERTER", path, format!("Immersion heater '{name}' states a PV diverter, but its supply '{supply}' is not an electricity supply or already has one. Give one immersion heater on an electricity supply the diverter."))),
        }
    }
}

/// The system catalogue's fail-loud rules: a system type the converter cannot express is an
/// error naming it, and a reference between systems must name an entry of the right type.
pub(crate) fn check_system_catalogue(
    model: &Value,
    db: &crate::epc_products::ProductDatabase,
    errors: &mut Vec<ValidationError>,
) {
    for (zone, zone_value) in model["Zone"].as_object().into_iter().flatten() {
        for (name, element) in zone_value["BuildingElement"]
            .as_object()
            .into_iter()
            .flatten()
        {
            let kind = element["type"].as_str().unwrap_or_default();
            if !kind.ends_with("AdjacentUnconditionedZone") {
                continue;
            }
            let path = json_pointer(&["Zone", zone, "BuildingElement", name]);
            let named = element["ZoneUnconditioned"].as_str().unwrap_or_default();
            if model["IsExistingBuilding"] == true {
                // HEMIE Geometry has no element next to an unconditioned zone.
                errors.push(error(
                    "E_EPC_UNSUPPORTED_SYSTEM",
                    path,
                    format!("Element '{name}' ({kind}) is next to an unconditioned zone, which an existing building's EPC input cannot state. Draw it as BuildingElementAdjacentUnconditionedSpace_Simple with the unheated space's thermal resistance."),
                ));
            } else if model["ZoneUnconditioned"].get(named).is_none() {
                errors.push(error(
                    "E_EPC_SYSTEM_REFERENCE",
                    format!("{path}/ZoneUnconditioned"),
                    format!("Element '{name}' ({kind}) names ZoneUnconditioned '{named}', but the model has no such unconditioned zone. Add a Systems row with subcategory ZoneUnconditioned that defines it, or correct the name."),
                ));
            }
        }
    }
    // ponytail: a defect of the pinned Orchestrator 0.13.2a0, which passes
    // coeff_ventilation_unconditioned_zone to the wrapper even when unset; drop on a re-pin
    // that fixes it.
    for (name, _) in model["ZoneUnconditioned"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, zone)| zone["method"] == "Direct")
    {
        errors.push(error(
            "E_EPC_UNSUPPORTED_SYSTEM",
            json_pointer(&["ZoneUnconditioned", name, "method"]),
            format!("Unconditioned zone '{name}' uses method Direct, which this HEM:EPC target rejects. Use method Calculated and state the zone's envelope in building_element."),
        ));
    }
    // A room heater whose product gives auxiliary power fields (even 0) states the supply for
    // them: the wrapper rejects one without (`validate_power_aux_needs_supply`). A back
    // boiler's integrated room heater takes the back boiler's product.
    let room_heaters = model["SpaceHeatSystem"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(name, s)| (vec!["SpaceHeatSystem", name.as_str()], s, s))
        .chain(
            model["HeatSourceWet"]
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(_, s)| s["type"] == "BackBoiler")
                .map(|(name, s)| {
                    (
                        vec![
                            "HeatSourceWet",
                            name.as_str(),
                            "integrated_space_heat_system",
                        ],
                        s,
                        &s["integrated_space_heat_system"],
                    )
                }),
        );
    for (segments, owner, heater) in room_heaters {
        let aux_fields = owner["product_id"]
            .as_u64()
            .and_then(|id| db.products.get(&id))
            .filter(|product| product.table == "RoomHeater")
            .is_some_and(|product| {
                [
                    "power_aux_burner_w",
                    "power_aux_blower_w",
                    "power_aux_standby_w",
                ]
                .iter()
                .any(|f| {
                    product
                        .fields
                        .get(*f)
                        .is_some_and(|v| !v.is_empty() && v != "NULL")
                })
            });
        if aux_fields && heater["EnergySupply_aux"].as_str().is_none() {
            let name = segments[1];
            errors.push(error(
                "E_EPC_REQUIRED_INPUT",
                format!("{}/EnergySupply_aux", json_pointer(&segments)),
                format!("Room heater '{name}': its product gives auxiliary power fields, so choose its auxiliary energy supply."),
            ));
        }
    }
    for name in model["InfiltrationVentilation"]["CombustionAppliances"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(name, _)| name)
    {
        errors.push(error(
            "E_EPC_UNSUPPORTED_SYSTEM",
            json_pointer(&["InfiltrationVentilation", "CombustionAppliances", name]),
            format!("Combustion appliance '{name}' has no HEM:EPC input. Model the fire or stove as a room heater (CombustionRoomHeater) whose FlueConfig names a passive duct, and remove the Combustion Appliances row."),
        ));
    }
    for (section, kind, field, target, needs) in SYSTEM_REFERENCES {
        for (name, system) in model[section].as_object().into_iter().flatten() {
            let system_kind = system["type"].as_str().unwrap_or_default();
            if kind.is_some_and(|kind| kind != system_kind) {
                continue;
            }
            let Some(reference) = system.pointer(field).and_then(Value::as_str) else {
                continue;
            };
            // The reference in words: the last named part of its path.
            let field_name = match field
                .trim_end_matches("/name")
                .rsplit('/')
                .next()
                .unwrap_or_default()
            {
                "HeatSourceWarmAir" => "warm air heat source",
                "HeatSource" | "HeatSourceWet" => "heat source",
                "PassiveDuct" => "flue duct",
                other => other,
            };
            let path = format!("{}{field}", json_pointer(&[section, name]));
            let Some(entry) = model.pointer(target).and_then(|e| e.get(reference)) else {
                errors.push(error("E_EPC_SYSTEM_REFERENCE", path, format!("'{name}' names {field_name} '{reference}', but the model has no {field_name} of that name. Add it or correct the name.")));
                continue;
            };
            let product = entry["product_id"]
                .as_u64()
                .and_then(|id| db.products.get(&id));
            // The product's row is the fact; the authored field stands in when there is none.
            let found: Vec<&str> = needs
                .iter()
                .map(|(own, product_field, _)| {
                    product
                        .and_then(|p| p.fields.get(*product_field))
                        .map(String::as_str)
                        .or_else(|| entry[*own].as_str())
                        .unwrap_or("none")
                })
                .collect();
            if needs
                .iter()
                .zip(&found)
                .any(|(need, found)| need.2 != *found)
            {
                let list = |values: Vec<&str>| {
                    needs
                        .iter()
                        .zip(values)
                        .map(|(need, value)| format!("{} {value}", need.0))
                        .collect::<Vec<_>>()
                        .join(", ")
                };
                errors.push(error("E_EPC_SYSTEM_REFERENCE", path, format!("{section} '{name}' ({system_kind}) takes its {field_name} from '{reference}', which has {}; it needs {}. Name a heat source that has.", list(found.clone()), list(needs.iter().map(|n| n.2).collect()))));
            }
        }
    }
    for section in ["SpaceHeatSystem", "SpaceCoolSystem"] {
        let systems = &model[section];
        for (name, system) in systems.as_object().into_iter().flatten() {
            for (i, member) in system["members"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
            {
                let reference = member[section].as_str().unwrap_or_default();
                if systems.get(reference).is_none() {
                    errors.push(error(
                        "E_EPC_SYSTEM_REFERENCE",
                        json_pointer(&[section, name, "members", &i.to_string(), section]),
                        format!("{section} '{name}' (meta) has member '{reference}', but the model has no such {section}. Add it or correct the name."),
                    ));
                }
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
    let state =
        |why: String| format!("{why} Choose the build type in Global Settings > Dwelling Details.");
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
    fn a_circuit_with_no_desnz_default_is_named_for_each_missing_field() {
        let mut model = json!({
            "IsExistingBuilding": true,
            "HeatSourceWet": {"stove": {"type": "SolidFuelBoiler"}},
            "SpaceHeatSystem": {"c": {"type": "WetDistribution", "HeatSource": {"name": "stove"}, "emitters": [{"wet_emitter_type": "radiator"}]}}
        });
        let mut errors = Vec::new();
        apply_desnz_defaults(
            &mut model,
            false,
            &mut errors,
            &mut Vec::new(),
            &mut Vec::new(),
        );
        let found: Vec<&str> = errors
            .iter()
            .map(|e| e.path.as_str())
            .filter(|p| p.starts_with("/SpaceHeatSystem"))
            .collect();
        assert_eq!(
            found,
            [
                "/SpaceHeatSystem/c/temp_diff_emit_dsgn",
                "/SpaceHeatSystem/c/thermal_mass"
            ]
        );
        assert!(errors[0]
            .message
            .contains("for a SolidFuelBoiler heat source"));
        assert!(errors[1]
            .message
            .contains("enter only the mass not in the radiators"));
    }

    #[test]
    fn ductwork_takes_the_nearest_size_band_with_the_most_length() {
        let duct = |shape: &str, field: &str, mm: f64, length: f64| json!({"duct_type": "intake", "length": length, "cross_section_shape": shape, field: mm});
        let size = |ducts: &[Value]| {
            mvhr_ductwork("MVHR", None, ducts, Some("inside")).0["ductwork_size"].clone()
        };
        // An odd size takes the nearest band; halfway takes the larger.
        assert_eq!(
            size(&[duct("circular", "external_diameter_mm", 110.0, 1.0)]),
            "small"
        );
        assert_eq!(
            size(&[duct("circular", "external_diameter_mm", 112.5, 1.0)]),
            "medium"
        );
        assert_eq!(
            size(&[duct("rectangular", "duct_perimeter_mm", 600.0, 1.0)]),
            "large"
        );
        // Mixed sizes take the band with the greatest length; a tie takes the larger.
        let mixed = [
            duct("circular", "external_diameter_mm", 100.0, 2.0),
            duct("circular", "external_diameter_mm", 150.0, 1.5),
            duct("rectangular", "duct_perimeter_mm", 620.0, 0.4),
        ];
        assert_eq!(size(&mixed), "small");
        assert_eq!(
            size(
                &mixed[..2]
                    .iter()
                    .cloned()
                    .chain([duct("circular", "external_diameter_mm", 150.0, 0.5)])
                    .collect::<Vec<_>>()
            ),
            "large"
        );
        // No size drawn: the default, named in the notice.
        let (out, notice) = mvhr_ductwork(
            "MVHR",
            None,
            &[json!({"duct_type": "intake", "length": 1.0})],
            Some("inside"),
        );
        assert!(out.get("ductwork_size").is_none());
        assert!(notice.unwrap().message.contains("size"));
    }

    #[test]
    fn a_new_build_tank_states_its_location_and_an_existing_one_leaves_it_to_hemie() {
        for (existing, errors_expected) in [(false, 2), (true, 0)] {
            let mut model = json!({
                "IsExistingBuilding": existing,
                "HotWaterSource": {
                    "hw": {"type": "StorageTank", "volume": 200, "daily_losses": 1.6},
                    "smart": {"type": "SmartHotWaterTank", "product_id": 1}
                }
            });
            let mut errors = Vec::new();
            apply_desnz_defaults(
                &mut model,
                false,
                &mut errors,
                &mut Vec::new(),
                &mut Vec::new(),
            );
            let found: Vec<&str> = errors
                .iter()
                .map(|e| e.path.as_str())
                .filter(|p| p.ends_with("/location"))
                .collect();
            assert_eq!(found.len(), errors_expected, "{errors:#?}");
            if !existing {
                assert!(errors.iter().any(|e| e.message == "'hw' (storage tank) needs its location. A new build states it: there is no default."), "{errors:#?}");
                assert!(
                    errors
                        .iter()
                        .any(|e| e.message.starts_with("'smart' (smart hot water tank)")),
                    "{errors:#?}"
                );
            }
            assert!(model["HotWaterSource"]["hw"].get("location").is_none());
        }
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
