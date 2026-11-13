// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! HEM:EPC existing-building systems (declared in `hemie.rs` as `systems`). DESNZ-defined: an
//! existing building gives each system in its HEMIE form wherever the schema has one (marked by
//! `model_type`), and the assessor may still state the full values, which that form accepts.
//! Systems with no HEMIE form (boilers, heat batteries, ...) stay in their full form.
//!
//! Mechanical ventilation moves into HEMIE Geometry: each vent sits in the wall, window or door
//! its Ventilation Systems row names as `host_element`, and HEMIE takes its height, orientation
//! and pitch from that element. A vent's `vent_position` (bottom, middle or top) defaults to
//! middle (DESNZ-defined).

use super::{error, notice, Ctx, HemieWall, Row, Rows};
use crate::finalization::{project_model, SchemaOmission};
use crate::{json_pointer, ValidationError};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

const SECTIONS: [&str; 4] = [
    "HotWaterSource",
    "HeatSourceWet",
    "SpaceHeatSystem",
    "SpaceCoolSystem",
];
const VENTILATION: &str = "Ventilation Systems";
const MV: &str = "/InfiltrationVentilation/MechanicalVentilation";

/// A value on a row: its column, else its `extra_json` key; blank is absent.
fn cell<'r>(row: &'r Row, key: &str) -> Option<&'r Value> {
    let blank = |v: &&Value| v.is_null() || v.as_str() == Some("");
    row.get(key)
        .filter(|v| !blank(v))
        .or_else(|| row.get("extra_json")?.get(key).filter(|v| !blank(v)))
}

fn text<'r>(row: &'r Row, key: &str) -> Option<&'r str> {
    cell(row, key).and_then(Value::as_str)
}

/// `$defs` once, with a `$ref` set per definition: the schema is large, so it is cloned once.
struct Defs(Value);

impl Defs {
    fn new(schema: &Value) -> Self {
        Defs(json!({"$defs": schema["$defs"]}))
    }
    fn branch(&mut self, def: &str) -> &Value {
        self.0["$ref"] = json!(format!("#/$defs/{def}"));
        &self.0
    }
}

/// Project `candidate` onto `def`, report the fields that form does not take, and name every
/// field it still lacks.
fn to_form(
    candidate: &Value,
    def: &str,
    path: &str,
    defs: &mut Defs,
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) -> Option<Value> {
    let branch = defs.branch(def);
    let (projected, omitted) = match project_model(candidate, branch) {
        Ok(result) => result,
        Err(message) => {
            errors.push(error(path.into(), message));
            return None;
        }
    };
    notices.extend(omitted.into_iter().map(|mut o| {
        o.path = format!("{path}{}", o.path);
        o
    }));
    let validator = jsonschema::validator_for(branch).expect("vendored schema compiles");
    let mut valid = true;
    for e in validator.iter_errors(&projected) {
        valid = false;
        for (at, message) in leaves(&e) {
            errors.push(error(
                format!("{path}{at}"),
                format!("'{}' in its existing-building (HEMIE) form: {message}. There is no default; state it on its row.", path.rsplit('/').next().unwrap_or(path)),
            ));
        }
    }
    valid.then_some(projected)
}

/// The errors inside an `anyOf`, leaving out the branches the value is not even the type of
/// (an optional object's `null` branch), so the message names the missing field.
fn leaves(e: &jsonschema::ValidationError) -> Vec<(String, String)> {
    use jsonschema::error::ValidationErrorKind::{AnyOf, Type};
    if let AnyOf { context } = e.kind() {
        let found: Vec<_> = context
            .iter()
            .filter(|branch| {
                !matches!(&branch[..], [only] if matches!(only.kind(), Type { .. }) && only.instance_path() == e.instance_path())
            })
            .flat_map(|branch| branch.iter().flat_map(leaves))
            .collect();
        if !found.is_empty() {
            return found;
        }
    }
    vec![(e.instance_path().to_string(), e.to_string())]
}

/// The HEMIE definition for a system `type` in `section`, if the schema has one.
fn hemie_def<'s>(schema: &'s Value, section: &str, ty: &str) -> Option<&'s str> {
    let union = &schema["properties"][section];
    let items = union.get("additionalProperties").or_else(|| {
        union["anyOf"]
            .as_array()?
            .iter()
            .find_map(|b| b.get("additionalProperties"))
    })?;
    items["anyOf"].as_array()?.iter().find_map(|branch| {
        let def = branch["discriminator"]["mapping"][ty]
            .as_str()?
            .strip_prefix("#/$defs/")?;
        // The wrapper converts a section only when it states `model_type` (`hemie_options.py`).
        schema["$defs"][def]["properties"]
            .get("model_type")
            .map(|_| def)
    })
}

/// DESNZ-defined: with no volume, dimensions or volume descriptor HEMIE takes
/// the tank as inaccessible; with no standing loss, efficiency class or install year, the
/// install year is unknown. HEMIE 0.18.1 requires one of each, so Vulcan states the default.
fn tank_descriptors(tank: &mut Value, path: &str, notices: &mut Vec<SchemaOmission>) {
    let has =
        |t: &Value, keys: &[&str]| keys.iter().all(|k| t.get(*k).is_some_and(|v| !v.is_null()));
    let (mut missing, mut applied) = (Vec::new(), Vec::new());
    if !has(tank, &["volume"])
        && !has(tank, &["external_diameter", "external_height"])
        && !has(tank, &["tank_volume_category"])
    {
        tank["tank_volume_category"] = json!("Inaccessible");
        missing.push("volume, dimensions or volume descriptor");
        applied.push("volume descriptor Inaccessible");
    }
    if !has(tank, &["daily_losses"])
        && !has(tank, &["energy_efficiency_class"])
        && !has(tank, &["installation_year"])
    {
        tank["installation_year"] = json!("unknown");
        missing.push("standing loss, efficiency class or install year");
        applied.push("install year unknown");
    }
    if !applied.is_empty() {
        notices.push(notice(
            path,
            format!(
                "The tank states no {}, so HEMIE takes the DESNZ default: {}.",
                missing.join(" and no "),
                applied.join(", ")
            ),
        ));
    }
}

/// Give every system that has a HEMIE form in that form, with no `Zone`.
pub(super) fn map_systems(
    model: &mut Value,
    schema: &Value,
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) {
    if schema.get("$defs").is_none() {
        return;
    }
    let mut defs = Defs::new(schema);
    for section in SECTIONS {
        let Some(systems) = model.get_mut(section).and_then(Value::as_object_mut) else {
            continue;
        };
        for (name, system) in systems.iter_mut() {
            let Some(def) = system["type"]
                .as_str()
                .and_then(|ty| hemie_def(schema, section, ty))
            else {
                continue;
            };
            let path = json_pointer(&[section, name]);
            let mut hemie = system.clone();
            hemie.as_object_mut().expect("system").remove("Zone");
            hemie["model_type"] = json!("hemie");
            if system["type"] == "StorageTank" {
                tank_descriptors(&mut hemie, &path, notices);
            }
            if let Some(projected) = to_form(&hemie, def, &path, &mut defs, errors, notices) {
                *system = projected;
            }
        }
    }
}

/// A mechanical vent: a non-MVHR system's own row, or an MVHR terminal row.
struct Vent<'r> {
    name: &'r str,
    row: &'r Row,
    system: &'r str,
    vent_type: &'r str,
}

fn vents(csv: &Rows) -> Vec<Vent<'_>> {
    let rows: Vec<&Row> = csv.get(VENTILATION).into_iter().flatten().collect();
    fn name(row: &Row) -> &str {
        text(row, "Name").unwrap_or_default()
    }
    let mut out = Vec::new();
    for row in &rows {
        match row.get("Type").and_then(Value::as_str) {
            Some("MechanicalVentilation") => {
                let vent_type = text(row, "vent_type").unwrap_or_default();
                if vent_type != "MVHR" {
                    out.push(Vent {
                        name: name(row),
                        row,
                        system: name(row),
                        vent_type,
                    });
                }
            }
            Some("MechanicalVentilationTerminal") => {
                let system = text(row, "parent_element").unwrap_or_default();
                let vent_type = rows
                    .iter()
                    .find(|r| name(r) == system)
                    .and_then(|r| text(r, "vent_type"))
                    .unwrap_or_default();
                out.push(Vent {
                    name: name(row),
                    row,
                    system,
                    vent_type,
                });
            }
            _ => {}
        }
    }
    out
}

/// The mechanical vents in `host` (a wall, window or door), as HEMIE `mechanical_vents`.
pub(super) fn host_vents(ctx: &mut Ctx, host: &str) -> Option<Value> {
    let mut out = Map::new();
    for vent in vents(ctx.settings.csv) {
        if text(vent.row, "host_element") != Some(host) {
            continue;
        }
        let path = json_pointer(&[VENTILATION, vent.name]);
        let position = match text(vent.row, "vent_position") {
            Some(p @ ("bottom" | "middle" | "top")) => p,
            Some(other) => {
                ctx.errors.push(error(
                    path,
                    format!(
                        "Vent '{}' has vent_position '{other}'. Give bottom, middle or top.",
                        vent.name
                    ),
                ));
                continue;
            }
            // DESNZ-defined: a vent's position in its element defaults to middle.
            None => {
                ctx.notices.push(notice(&path, format!("Vent '{}' states no vent_position, so HEMIE takes the DESNZ default: the middle of '{host}'.", vent.name)));
                "middle"
            }
        };
        out.insert(
            vent.name.into(),
            json!({"type": "Mechanical", "position": position, "vent_system": vent.vent_type}),
        );
    }
    (!out.is_empty()).then_some(Value::Object(out))
}

/// Vents in storey walls go in the first outline edge of that wall: a wall's edges are
/// collinear, so each gives the vent the same height, orientation and pitch.
pub(super) fn wall_vents(ctx: &mut Ctx, walls: &mut [HemieWall]) {
    let mut done = BTreeSet::new();
    for wall in walls.iter_mut() {
        if done.insert(wall.source.name) {
            if let Some(v) = host_vents(ctx, wall.source.name) {
                wall.value.insert("mechanical_vents".into(), v);
            }
        }
    }
}

fn placed_vents(value: &Value, out: &mut BTreeSet<String>) {
    match value {
        Value::Object(map) => {
            for (key, v) in map {
                if key == "mechanical_vents" {
                    out.extend(v.as_object().into_iter().flatten().map(|(k, _)| k.clone()));
                }
                placed_vents(v, out);
            }
        }
        Value::Array(items) => items.iter().for_each(|v| placed_vents(v, out)),
        _ => {}
    }
}

/// The model's mechanical ventilation as HEMIE Geometry `mechanical_ventilation_system`, from
/// the full-input systems (products resolved) and the vents placed in `geometry`.
pub(super) fn mechanical_ventilation(
    full: &Value,
    csv: &Rows,
    schema: &Value,
    geometry: &mut Value,
    errors: &mut Vec<ValidationError>,
    notices: &mut Vec<SchemaOmission>,
) {
    let Some(systems) = full.pointer(MV).and_then(Value::as_object) else {
        return;
    };
    let mut placed = BTreeSet::new();
    placed_vents(geometry, &mut placed);
    let all = vents(csv);
    for vent in &all {
        if placed.contains(vent.name) {
            continue;
        }
        let path = json_pointer(&[VENTILATION, vent.name]);
        errors.push(error(path, match text(vent.row, "host_element") {
            None => format!("Vent '{}' of '{}' names no host_element. An existing-building EPC places each mechanical vent in a wall, window or door, and takes its height, orientation and pitch from it: name that element.", vent.name, vent.system),
            Some(host) => format!("Vent '{}' of '{}' is in '{host}', which is not a storey wall, window or door of the existing-building model. Name the wall, window or door it sits in.", vent.name, vent.system),
        }));
    }
    let mut defs = Defs::new(schema);
    let mut out = Map::new();
    for (name, system) in systems {
        let path = format!("{MV}{}", json_pointer(&[name]));
        let mut candidate = system.clone();
        let vent_type = system["vent_type"].as_str().unwrap_or_default();
        let ours = all.iter().filter(|v| v.system == name.as_str());
        // DESNZ-defined (wrapper and HEMIE code): MVHR is a product with an intake and an
        // exhaust; continuous MEV a product with its vents; intermittent MEV and PIV are given
        // by their own fan values.
        let def = match vent_type {
            "MVHR" => {
                for role in ["intake", "exhaust"] {
                    if let Some(v) = ours
                        .clone()
                        .find(|v| text(v.row, "terminal_type") == Some(role))
                    {
                        candidate[role] = json!(v.name);
                    }
                }
                "MVHRSystemProduct"
            }
            "Centralised continuous MEV" | "Decentralised continuous MEV" => "NonMVHRSystemProduct",
            _ => "NonMVHRSystem",
        };
        if vent_type != "MVHR" {
            candidate["vents"] = json!(ours.map(|v| v.name).collect::<Vec<_>>());
        }
        if let Some(form) = to_form(&candidate, def, &path, &mut defs, errors, notices) {
            out.insert(name.clone(), form);
        }
    }
    if !out.is_empty() {
        notices.push(notice(MV, "HEMIE places each mechanical vent in its host element and takes the vent's height, orientation and pitch from it; the heights and directions stated on the Ventilation Systems rows are not used. HEMIE also takes MVHR ductwork as its default.".into()));
        geometry["mechanical_ventilation_system"] = Value::Object(out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str =
        include_str!("../../../data/schemas/hem_epc_orchestrator_input.schema.json");

    fn schema() -> Value {
        serde_json::from_str(SCHEMA).unwrap()
    }

    fn run(model: Value) -> (Value, Vec<ValidationError>, Vec<SchemaOmission>) {
        let mut model = model;
        let (mut errors, mut notices) = (Vec::new(), Vec::new());
        map_systems(&mut model, &schema(), &mut errors, &mut notices);
        (model, errors, notices)
    }

    fn tank(extra: Value) -> Value {
        let mut tank = json!({"type": "StorageTank", "ColdWaterSource": "mains water", "location": "internal",
            "tank_controls": [{"heat_source": "hp", "thermostat_position": 0.33}],
            "HeatSource": {"hp": {"type": "HeatSourceWet", "name": "hp", "heater_position": 0.1, "primary_flow_rate": 10, "heat_transfer_rate_W_per_K": 300}}});
        tank.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        tank
    }

    #[test]
    fn systems_with_a_hemie_form_take_it_and_others_stay_full() {
        let (model, errors, _) = run(json!({
            "HeatSourceWet": {
                "hp": {"type": "HeatPump", "product_id": 693003, "EnergySupply": "mains elec", "source_type": "OutsideAir"},
                "boiler": {"type": "Boiler", "product_id": 1, "EnergySupply": "mains gas"}
            },
            "HotWaterSource": {"hw": tank(json!({"volume": 200, "daily_losses": 1.6}))},
            "SpaceHeatSystem": {"c": {"type": "InstantElecHeater", "Zone": "Z", "product_id": 1, "EnergySupply": "mains elec", "rated_power": 2.0, "convective_type": "Air heating (convectors, fan coils etc.)"}}
        }));
        assert!(errors.is_empty(), "{errors:#?}");
        assert_eq!(model["HeatSourceWet"]["hp"]["model_type"], "hemie");
        assert!(model["HeatSourceWet"]["boiler"].get("model_type").is_none());
        // The stated full values stay: they are the assessor's evidence.
        assert_eq!(model["HotWaterSource"]["hw"]["volume"], 200);
        assert_eq!(model["HotWaterSource"]["hw"]["model_type"], "hemie");
        let heater = &model["SpaceHeatSystem"]["c"];
        assert_eq!(heater["model_type"], "hemie");
        assert!(heater.get("Zone").is_none());
    }

    #[test]
    fn a_tank_with_no_size_or_loss_takes_the_desnz_descriptors() {
        let (model, errors, notices) = run(json!({"HotWaterSource": {"hw": tank(json!({}))}}));
        assert!(errors.is_empty(), "{errors:#?}");
        let hw = &model["HotWaterSource"]["hw"];
        assert_eq!(hw["tank_volume_category"], "Inaccessible");
        assert_eq!(hw["installation_year"], "unknown");
        assert!(notices
            .iter()
            .any(|n| n.path == "/HotWaterSource/hw" && n.message.contains("DESNZ default")));
        // A stated descriptor is kept, and no default is added.
        let (model, _, _) = run(
            json!({"HotWaterSource": {"hw": tank(json!({"tank_volume_category": "Large", "energy_efficiency_class": "C"}))}}),
        );
        assert_eq!(
            model["HotWaterSource"]["hw"]["tank_volume_category"],
            "Large"
        );
        assert!(model["HotWaterSource"]["hw"]
            .get("installation_year")
            .is_none());
    }

    #[test]
    fn a_missing_input_with_no_default_fails_naming_the_system_and_field() {
        let mut no_location = tank(json!({"volume": 200, "daily_losses": 1.6}));
        no_location.as_object_mut().unwrap().remove("location");
        let (_, errors, _) = run(json!({
            "HotWaterSource": {"hw": no_location},
            "HeatSourceWet": {"hybrid": {"type": "HeatPump", "product_id": 1, "EnergySupply": "mains elec", "source_type": "OutsideAir",
                "boiler": {"boiler_type": "condensing", "EnergySupply": "mains gas", "EnergySupply_aux": "mains elec"}}}
        }));
        assert!(
            errors
                .iter()
                .any(|e| e.path == "/HotWaterSource/hw" && e.message.contains("\"location\"")),
            "{errors:#?}"
        );
        assert!(
            errors
                .iter()
                .any(|e| e.path == "/HeatSourceWet/hybrid/boiler"
                    && e.message.contains("\"boiler_location\"")),
            "{errors:#?}"
        );
    }

    fn ventilation(rows: &[&str]) -> Rows {
        let text = format!("Ventilation Systems\nName,Type,parent_element,host_element,terminal_type,vent_type,extra_json\n{}\n", rows.join("\n"));
        crate::parser::CSVParser::new()
            .parse_csv(&text)
            .expect("csv")
    }

    #[test]
    fn each_ventilation_type_takes_its_hemie_system_form() {
        let csv = ventilation(&[
            "MVHR,MechanicalVentilation,,,,MVHR,",
            "In,MechanicalVentilationTerminal,MVHR,Wall N,intake,,",
            "Out,MechanicalVentilationTerminal,MVHR,Wall S,exhaust,,",
            "Fan,MechanicalVentilation,,Kitchen window,,Intermittent MEV,",
        ]);
        let full = json!({"InfiltrationVentilation": {"MechanicalVentilation": {
            "MVHR": {"vent_type": "MVHR", "product_id": 7, "installation_type": "installation_scheme", "EnergySupply": "mains elec",
                "design_outdoor_air_flow_rate": 100, "mvhr_location": "inside", "SFP": 1.0, "ductwork": [], "position_intake": {}},
            "Fan": {"vent_type": "Intermittent MEV", "EnergySupply": "mains elec", "design_outdoor_air_flow_rate": 30, "SFP": 1.5,
                "leakage_when_stopped": {"back_draught_protection": "internal damper", "diameter": "100 mm"}, "mid_height_air_flow_path": 2.0}
        }}});
        let mut geometry = json!({"walls": [{"mechanical_vents": {"In": {}, "Out": {}}}, {"windows": [{"mechanical_vents": {"Fan": {}}}]}]});
        let (mut errors, mut notices) = (Vec::new(), Vec::new());
        mechanical_ventilation(
            &full,
            &csv,
            &schema(),
            &mut geometry,
            &mut errors,
            &mut notices,
        );
        assert!(errors.is_empty(), "{errors:#?}");
        let systems = &geometry["mechanical_ventilation_system"];
        assert_eq!(systems["MVHR"]["intake"], "In");
        assert_eq!(systems["MVHR"]["exhaust"], "Out");
        assert!(systems["MVHR"].get("ductwork").is_none());
        assert_eq!(systems["Fan"]["vents"], json!(["Fan"]));
        assert_eq!(systems["Fan"]["vent_type"], "Intermittent MEV");
        assert!(systems["Fan"].get("mid_height_air_flow_path").is_none());
        // A vent no element holds fails, naming it.
        let mut empty = json!({});
        let (mut errors, mut notices) = (Vec::new(), Vec::new());
        mechanical_ventilation(
            &full,
            &csv,
            &schema(),
            &mut empty,
            &mut errors,
            &mut notices,
        );
        assert!(
            errors
                .iter()
                .any(|e| e.path == "/Ventilation Systems/In" && e.message.contains("'Wall N'")),
            "{errors:#?}"
        );
    }
}
