// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! Fabric presets: the `FabricPreset` Metadata row, a named set of fabric values per construction
//! type that the Fabric tab picks. The converter gives an element the preset's values for its
//! type when the element states no fabric value of its own; the merged model holds them as
//! ordinary element values. A preset is for FHS or for HEM:EPC new build (`family`); a preset for
//! the other family is not used. An existing building takes its fabric from the age band and
//! constructions, so a preset there is an error. The rules match the editor's
//! `lib/fabricPreset.ts`.

use crate::builder::BuildError;
use crate::ModelProfile;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub(crate) const FABRIC_PRESET_ROW: &str = "FabricPreset";

/// The construction types a preset has values for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum FabricRow {
    Wall,
    AdjacentWall,
    Roof,
    GroundFloor,
    Window,
    Door,
}

impl FabricRow {
    const ALL: [Self; 6] = [
        Self::Wall,
        Self::AdjacentWall,
        Self::Roof,
        Self::GroundFloor,
        Self::Window,
        Self::Door,
    ];

    fn key(self) -> &'static str {
        match self {
            Self::Wall => "wall",
            Self::AdjacentWall => "adjacent_wall",
            Self::Roof => "roof",
            Self::GroundFloor => "ground_floor",
            Self::Window => "window",
            Self::Door => "door",
        }
    }

    /// The values a preset sets. Not a ground floor's U-value: the floor calculation
    /// (`ground_u_value.rs`) derives it from the construction's resistance and the drawing.
    fn preset_keys(self) -> &'static [&'static str] {
        match self {
            Self::Wall | Self::AdjacentWall | Self::Roof | Self::Door => &["u_value"],
            Self::GroundFloor => &["thermal_resistance_floor_construction"],
            Self::Window => &["u_value", "g_value"],
        }
    }

    /// The element values that keep a preset value off: the value itself, the other way of
    /// stating it, and a build-up (which writes it).
    fn blocking_keys(self, key: &str) -> &'static [&'static str] {
        match (self, key) {
            (Self::Window, "g_value") => &["g_value"],
            (Self::Window, _) => &["u_value"],
            (Self::GroundFloor, _) => &[
                "thermal_resistance_floor_construction",
                "vulcan_assembly_v1",
            ],
            _ => &[
                "u_value",
                "thermal_resistance_construction",
                "vulcan_assembly_v1",
            ],
        }
    }

    /// The row an element counts under, as the defaults file's elements are matched.
    pub(crate) fn of_element(
        schema_element_type: &str,
        is_external_door: bool,
        opaque_is_roof: bool,
    ) -> Option<Self> {
        match schema_element_type {
            "BuildingElementTransparent" => Some(Self::Window),
            "BuildingElementGround" => Some(Self::GroundFloor),
            "BuildingElementAdjacentConditionedSpace"
            | "BuildingElementAdjacentUnconditionedSpace_Simple" => Some(Self::AdjacentWall),
            "BuildingElementOpaque" if is_external_door => Some(Self::Door),
            "BuildingElementOpaque" if opaque_is_roof => Some(Self::Roof),
            "BuildingElementOpaque" => Some(Self::Wall),
            _ => None,
        }
    }
}

/// A preset value's range, with its unit.
fn range(key: &str) -> (f64, f64, bool, &'static str, &'static str) {
    match key {
        "u_value" => (0.0, 10.0, true, "U-value", " W/m²K"),
        "g_value" => (0.0, 1.0, false, "g-value", ""),
        _ => (0.0, 20.0, true, "construction resistance", " m²K/W"),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FabricPreset {
    pub name: String,
    values: BTreeMap<FabricRow, Map<String, Value>>,
}

impl FabricPreset {
    /// The preset values an element's CSV row takes: each value the row does not state itself,
    /// in a column or in `extra_json`. None when it states them all.
    pub(crate) fn values_for(
        &self,
        row: FabricRow,
        element_row: &BTreeMap<String, Value>,
    ) -> Option<Map<String, Value>> {
        let extra = element_row.get("extra_json").and_then(Value::as_object);
        let stated = |key: &str| {
            [element_row.get(key), extra.and_then(|e| e.get(key))]
                .into_iter()
                .flatten()
                .any(|v| !v.is_null() && v != "")
        };
        let values: Map<String, Value> = self
            .values
            .get(&row)?
            .iter()
            .filter(|(key, _)| !row.blocking_keys(key).iter().any(|own| stated(own)))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        (!values.is_empty()).then_some(values)
    }
}

fn invalid(message: String) -> BuildError {
    BuildError::new("E068", &message)
}

/// The model's preset for this conversion. None without a `FabricPreset` row, or for a preset of
/// the other family. A malformed preset, or any preset on an existing building, is an error.
pub(crate) fn read(
    csv_data: &BTreeMap<String, Vec<BTreeMap<String, Value>>>,
    profile: ModelProfile,
    existing_building: bool,
) -> Result<Option<FabricPreset>, BuildError> {
    let Some(cell) = csv_data
        .get("Metadata")
        .into_iter()
        .flatten()
        .find_map(|row| {
            (row.get("Field").and_then(Value::as_str) == Some(FABRIC_PRESET_ROW))
                .then(|| row.get("Value").cloned())
                .flatten()
        })
    else {
        return Ok(None);
    };
    let json = match cell {
        Value::String(text) if text.trim().is_empty() => return Ok(None),
        Value::String(text) => serde_json::from_str::<Value>(&text).map_err(|_| {
            invalid(
                "Metadata row FabricPreset is not a fabric preset: the text is not JSON.".into(),
            )
        })?,
        Value::Null => return Ok(None),
        other => other,
    };
    let name = json
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| {
            invalid("Metadata row FabricPreset is not a fabric preset: it has no name.".into())
        })?
        .to_string();
    let family = json.get("family").and_then(Value::as_str);
    if !matches!(family, Some("fhs" | "epc")) {
        return Err(invalid(format!(
            "Fabric preset \"{name}\": family must be \"fhs\" or \"epc\"."
        )));
    }
    let values = parse_values(&name, json.get("values"))?;
    if existing_building && profile.converts_existing_buildings_to_hemie() {
        return Err(invalid(format!(
            "The model has the fabric preset \"{name}\", but an existing building takes its fabric from the age band and constructions. Remove the preset in Global Settings > Fabric."
        )));
    }
    if family != Some(profile.fabric_preset_family()) {
        return Ok(None);
    }
    Ok(Some(FabricPreset { name, values }))
}

fn parse_values(
    name: &str,
    values: Option<&Value>,
) -> Result<BTreeMap<FabricRow, Map<String, Value>>, BuildError> {
    let fail = |problem: String| invalid(format!("Fabric preset \"{name}\": {problem}."));
    let values = values
        .and_then(Value::as_object)
        .ok_or_else(|| fail("it has no values".into()))?;
    let mut parsed = BTreeMap::new();
    for (row_key, row_values) in values {
        let row = FabricRow::ALL
            .into_iter()
            .find(|row| row.key() == row_key)
            .ok_or_else(|| fail(format!("\"{row_key}\" is not a construction type")))?;
        let row_values = row_values
            .as_object()
            .ok_or_else(|| fail(format!("the {row_key} values are not a list of values")))?;
        for (key, value) in row_values {
            if !row.preset_keys().contains(&key.as_str()) {
                return Err(fail(format!(
                    "{row_key} takes {}, not {key}",
                    row.preset_keys().join(" and ")
                )));
            }
            let (min, max, min_exclusive, label, unit) = range(key);
            let number = value
                .as_f64()
                .filter(|n| n.is_finite())
                .ok_or_else(|| fail(format!("the {row_key} {label} is not a number")))?;
            if number > max
                || (if min_exclusive {
                    number <= min
                } else {
                    number < min
                })
            {
                return Err(fail(format!(
                    "the {row_key} {label} {number} is outside {min} to {max}{unit}"
                )));
            }
        }
        parsed.insert(row, row_values.clone());
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn csv(preset: Value, existing: bool) -> BTreeMap<String, Vec<BTreeMap<String, Value>>> {
        let mut rows = vec![BTreeMap::from([
            ("Field".to_string(), json!(FABRIC_PRESET_ROW)),
            ("Value".to_string(), json!(preset.to_string())),
        ])];
        if existing {
            rows.push(BTreeMap::from([
                ("Field".to_string(), json!("IsExistingBuilding")),
                ("Value".to_string(), json!(true)),
            ]));
        }
        BTreeMap::from([("Metadata".to_string(), rows)])
    }

    fn preset(family: &str) -> Value {
        json!({"name": "Spec", "family": family, "values": {
            "wall": {"u_value": 0.2}, "ground_floor": {"thermal_resistance_floor_construction": 4.5},
            "window": {"u_value": 1.4, "g_value": 0.6},
        }})
    }

    #[test]
    fn an_element_takes_each_preset_value_it_does_not_state() {
        let preset = read(&csv(preset("fhs"), false), ModelProfile::Fhs, false)
            .unwrap()
            .unwrap();
        let row = |extra: Value| BTreeMap::from([("extra_json".to_string(), extra)]);
        assert_eq!(
            preset.values_for(FabricRow::Wall, &row(json!({}))),
            Some(Map::from_iter([("u_value".into(), json!(0.2))]))
        );
        // A resistance, a U-value column or a build-up is the wall's own.
        assert_eq!(
            preset.values_for(
                FabricRow::Wall,
                &row(json!({"thermal_resistance_construction": 2}))
            ),
            None
        );
        assert_eq!(
            preset.values_for(
                FabricRow::Wall,
                &BTreeMap::from([("u_value".to_string(), json!(0.3))])
            ),
            None
        );
        assert_eq!(
            preset.values_for(FabricRow::Wall, &row(json!({"vulcan_assembly_v1": {}}))),
            None
        );
        // A window stating its g-value takes only the U-value; a ground U-value keeps no resistance off.
        assert_eq!(
            preset.values_for(FabricRow::Window, &row(json!({"g_value": 0.7}))),
            Some(Map::from_iter([("u_value".into(), json!(1.4))]))
        );
        assert!(preset
            .values_for(FabricRow::GroundFloor, &row(json!({"u_value": 0.17})))
            .is_some());
        assert_eq!(preset.values_for(FabricRow::Roof, &row(json!({}))), None);
    }

    #[test]
    fn the_target_family_and_an_existing_building_decide_the_preset() {
        assert!(read(&csv(preset("epc"), false), ModelProfile::Fhs, false)
            .unwrap()
            .is_none());
        assert!(read(&csv(preset("epc"), false), ModelProfile::Epc, false)
            .unwrap()
            .is_some());
        let error = read(&csv(preset("epc"), true), ModelProfile::Epc, true).unwrap_err();
        assert_eq!(error.code, "E068");
    }

    #[test]
    fn a_malformed_preset_is_an_error() {
        for (values, message) in [
            (
                json!({"wall": {"u_value": "0.2"}}),
                "the wall U-value is not a number",
            ),
            (
                json!({"window": {"g_value": 1.5}}),
                "the window g-value 1.5 is outside 0 to 1",
            ),
            (
                json!({"ground_floor": {"u_value": 0.2}}),
                "ground_floor takes thermal_resistance_floor_construction, not u_value",
            ),
            (json!({"attic": {}}), "\"attic\" is not a construction type"),
        ] {
            let text = json!({"name": "Spec", "family": "fhs", "values": values});
            let error = read(&csv(text, false), ModelProfile::Fhs, false).unwrap_err();
            assert!(error.message.contains(message), "{}", error.message);
        }
    }
}
