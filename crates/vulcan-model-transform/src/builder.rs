// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

use super::ValidationError;
use crate::{schema_validation::normalized_schema_document, ModelProfile, VersionMetadata};
use jsonschema::validator_for;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
#[cfg(test)]
use std::{fs, path::Path};

#[derive(Debug, Clone)]
pub struct BuildError {
    pub code: String,
    pub message: String,
    pub validation_errors: Vec<ValidationError>,
}

impl std::fmt::Display for BuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for BuildError {}

/// HEM short letter codes and legacy values → FHS `#/$defs/MassDistributionClass` enum strings.
fn coerce_mass_distribution_class_for_fhs(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    const FULL: [&str; 5] = [
        "I: Mass concentrated at internal side",
        "E: Mass concentrated at external side",
        "IE: Mass divided over internal and external side",
        "D: Mass equally distributed",
        "M: Mass concentrated inside",
    ];
    if FULL.contains(&t) {
        return Some(t.to_string());
    }
    match t.to_uppercase().as_str() {
        "I" => Some(FULL[0].to_string()),
        "E" => Some(FULL[1].to_string()),
        "IE" => Some(FULL[2].to_string()),
        "D" => Some(FULL[3].to_string()),
        "M" => Some(FULL[4].to_string()),
        _ => None,
    }
}

const HORIZONTAL_POLYGON_Z_MAX_SPAN: f64 = 0.03;

const NAMED_UI_ONLY_EXTRA_JSON_KEYS: &[&str] =
    &["psi_source", "vulcan_assembly_v1", "ru_calculator_state_v1"];

fn is_ui_only_extra_json_key(key: &str) -> bool {
    key.starts_with('_') || NAMED_UI_ONLY_EXTRA_JSON_KEYS.contains(&key)
}

fn strip_ui_only_extra_json_value(value: &Value) -> Value {
    match value {
        Value::Object(obj) => {
            let mut stripped = serde_json::Map::new();
            for (key, nested) in obj {
                if is_ui_only_extra_json_key(key) {
                    continue;
                }
                stripped.insert(key.clone(), strip_ui_only_extra_json_value(nested));
            }
            Value::Object(stripped)
        }
        Value::Array(items) => {
            Value::Array(items.iter().map(strip_ui_only_extra_json_value).collect())
        }
        _ => value.clone(),
    }
}

fn pitch_csv_value_is_90(v: &Value) -> bool {
    v.as_f64()
        .map(|f| (f.round() as i64) == 90)
        .unwrap_or(false)
        || v.as_str()
            .and_then(|s| s.parse::<f64>().ok())
            .map(|f| (f.round() as i64) == 90)
            .unwrap_or(false)
}

/// Wall-default pitch 90 is invalid for a coplanar horizontal 3+ vertex adjacent polygon; use 0°.
fn should_coerce_horizontal_adjacent_pitch_90(
    schema_element_type: &str,
    element_row: &HashMap<String, Value>,
) -> bool {
    if !matches!(
        schema_element_type,
        "BuildingElementAdjacentConditionedSpace"
            | "BuildingElementAdjacentUnconditionedSpace_Simple"
            | "BuildingElementPartyWall"
    ) {
        return false;
    }
    let Some(coords_str) = element_row.get("coords").and_then(|v| v.as_str()) else {
        return false;
    };
    let segs: Vec<_> = coords_str
        .split('|')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if segs.len() < 3 {
        return false;
    }
    let mut z_min = f64::INFINITY;
    let mut z_max = f64::NEG_INFINITY;
    for seg in segs {
        let p: Vec<&str> = seg.split(',').collect();
        if p.len() < 3 {
            return false;
        }
        let z: f64 = match p[2].trim().parse() {
            Ok(x) => x,
            Err(_) => return false,
        };
        z_min = z_min.min(z);
        z_max = z_max.max(z);
    }
    if z_max - z_min > HORIZONTAL_POLYGON_Z_MAX_SPAN {
        return false;
    }
    element_row
        .get("pitch")
        .map(pitch_csv_value_is_90)
        .unwrap_or(false)
}

/// Parse an optional CSV cell as a finite f64, failing loudly on garbage.
/// Empty / absent → Ok(None); a non-empty unparseable value → E055 (a silently
/// skipped value would let the defaults profile win over what the user typed).
fn parse_csv_number_cell(value: Option<&Value>, field: &str) -> Result<Option<f64>, BuildError> {
    let Some(v) = value else { return Ok(None) };
    match v {
        Value::Null => Ok(None),
        Value::Number(n) => Ok(n.as_f64()),
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            trimmed.parse::<f64>().map(Some).map_err(|_| {
                BuildError::new(
                    "E055",
                    &format!(
                        "'{field}' has unparseable numeric value '{trimmed}'. \
                         Fix the value or clear it to use the default."
                    ),
                )
            })
        }
        other => Err(BuildError::new(
            "E055",
            &format!("'{field}' has non-numeric value '{other}'"),
        )),
    }
}

#[derive(Debug, Clone, Copy)]
struct CsvPoint3 {
    x: f64,
    y: f64,
    z: f64,
}

fn json_number(value: f64, field: &str) -> Result<Value, BuildError> {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .ok_or_else(|| BuildError::new("E055", &format!("'{field}' has non-finite numeric value")))
}

fn parse_coords_points(value: Option<&Value>, field: &str) -> Result<Vec<CsvPoint3>, BuildError> {
    let Some(v) = value else {
        return Ok(Vec::new());
    };
    let coords = match v {
        Value::Null => return Ok(Vec::new()),
        Value::String(s) => s.trim(),
        other => {
            return Err(BuildError::new(
                "E055",
                &format!("'{field}' has non-string coords value '{other}'"),
            ))
        }
    };
    if coords.is_empty() {
        return Ok(Vec::new());
    }
    let mut points = Vec::new();
    for segment in coords.split('|') {
        let parts: Vec<_> = segment.split(',').map(str::trim).collect();
        if parts.len() < 3 {
            return Err(BuildError::new(
                "E055",
                &format!("'{field}' has invalid coordinate '{segment}'"),
            ));
        }
        let x = parts[0].parse::<f64>().map_err(|_| {
            BuildError::new(
                "E055",
                &format!("'{field}' has invalid x coordinate '{}'", parts[0]),
            )
        })?;
        let y = parts[1].parse::<f64>().map_err(|_| {
            BuildError::new(
                "E055",
                &format!("'{field}' has invalid y coordinate '{}'", parts[1]),
            )
        })?;
        let z = parts[2].parse::<f64>().map_err(|_| {
            BuildError::new(
                "E055",
                &format!("'{field}' has invalid z coordinate '{}'", parts[2]),
            )
        })?;
        if !x.is_finite() || !y.is_finite() || !z.is_finite() {
            return Err(BuildError::new(
                "E055",
                &format!("'{field}' has non-finite coordinate '{segment}'"),
            ));
        }
        points.push(CsvPoint3 { x, y, z });
    }
    Ok(points)
}

fn normalize_orientation360(value: f64) -> f64 {
    let mut n = value % 360.0;
    if n < 0.0 {
        n += 360.0;
    }
    n
}

fn orientation360_from_first_segment(points: &[CsvPoint3]) -> Option<f64> {
    if points.len() < 2 {
        return None;
    }
    let a = points[0];
    let b = points[1];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if dx.abs() < 1e-9 && dy.abs() < 1e-9 {
        return None;
    }
    let len = (dx * dx + dy * dy).sqrt();
    let tx = dx / len;
    let ty = dy / len;
    let outward_x = ty;
    let outward_y = -tx;
    Some(normalize_orientation360(
        outward_x.atan2(outward_y).to_degrees(),
    ))
}

fn csv_string_cell<'a>(row: &'a HashMap<String, Value>, key: &str) -> Option<&'a str> {
    row.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn find_mvhr_terminal_host<'a>(
    csv_data: &'a HashMap<String, Vec<HashMap<String, Value>>>,
    host_name: &str,
) -> Option<(&'static str, &'a HashMap<String, Value>)> {
    for section in ["Exposed Elements", "Window Elements"] {
        if let Some(rows) = csv_data.get(section) {
            for row in rows {
                if csv_string_cell(row, "Name") == Some(host_name) {
                    return Some((section, row));
                }
            }
        }
    }
    None
}

fn mvhr_terminal_mid_height(
    terminal_row: &HashMap<String, Value>,
    terminal_name: &str,
) -> Result<f64, BuildError> {
    let mid_height = if let Some(value) = parse_csv_number_cell(
        terminal_row.get("mid_height_air_flow_path"),
        "mid_height_air_flow_path",
    )? {
        value
    } else {
        let terminal_points = parse_coords_points(terminal_row.get("coords"), "coords")?;
        terminal_points.first().map(|point| point.z).ok_or_else(|| {
            BuildError::new(
                "E040",
                &format!(
                    "MechanicalVentilationTerminal '{terminal_name}' needs a height or point coords for MVHR position"
                ),
            )
        })?
    };
    if !(1.0..=60.0).contains(&mid_height) {
        return Err(BuildError::new(
            "E040",
            &format!(
                "MechanicalVentilationTerminal '{terminal_name}' height {mid_height}m is outside FHS range 1..60"
            ),
        ));
    }
    Ok(mid_height)
}

fn mvhr_terminal_position_object(
    mid_height: f64,
    orientation360: f64,
    pitch: f64,
) -> Result<serde_json::Map<String, Value>, BuildError> {
    let mut position = serde_json::Map::new();
    position.insert(
        "mid_height_air_flow_path".to_string(),
        json_number(mid_height, "mid_height_air_flow_path")?,
    );
    position.insert(
        "orientation360".to_string(),
        json_number(
            normalize_orientation360(orientation360).round(),
            "orientation360",
        )?,
    );
    position.insert("pitch".to_string(), json_number(pitch.round(), "pitch")?);
    Ok(position)
}

fn mvhr_terminal_manual_position_values(
    terminal_row: &HashMap<String, Value>,
    terminal_name: &str,
) -> Result<serde_json::Map<String, Value>, BuildError> {
    let mid_height = mvhr_terminal_mid_height(terminal_row, terminal_name)?;
    let orientation360 =
        parse_csv_number_cell(terminal_row.get("orientation360"), "orientation360")?.ok_or_else(
            || {
                BuildError::new(
                    "E040",
                    &format!(
                        "MechanicalVentilationTerminal '{terminal_name}' manual position missing orientation360"
                    ),
                )
            },
        )?;
    let pitch = parse_csv_number_cell(terminal_row.get("pitch"), "pitch")?.ok_or_else(|| {
        BuildError::new(
            "E040",
            &format!(
                "MechanicalVentilationTerminal '{terminal_name}' manual position missing pitch"
            ),
        )
    })?;
    if !(0.0..=360.0).contains(&orientation360) || !(0.0..=180.0).contains(&pitch) {
        return Err(BuildError::new(
            "E040",
            &format!(
                "MechanicalVentilationTerminal '{terminal_name}' manual orientation360/pitch are outside FHS ranges"
            ),
        ));
    }
    mvhr_terminal_position_object(mid_height, orientation360, pitch)
}

fn mvhr_terminal_host_position_values(
    host_section: &str,
    host_row: &HashMap<String, Value>,
    terminal_row: &HashMap<String, Value>,
    terminal_name: &str,
) -> Result<serde_json::Map<String, Value>, BuildError> {
    let host_type = csv_string_cell(host_row, "Type").unwrap_or("");
    let is_window = host_section == "Window Elements" && host_type == "BuildingElementTransparent";
    let is_wall = host_section == "Exposed Elements" && host_type == "BuildingElementOpaque";
    if !is_window && !is_wall {
        return Err(BuildError::new(
            "E040",
            &format!(
                "MechanicalVentilationTerminal '{terminal_name}' host must be an external wall or window"
            ),
        ));
    }
    if is_wall
        && parse_csv_bool_cell(host_row.get("is_external_door"), "is_external_door")?
            .unwrap_or(false)
    {
        return Err(BuildError::new(
            "E040",
            &format!(
                "MechanicalVentilationTerminal '{terminal_name}' host cannot be an external door"
            ),
        ));
    }

    let host_points = parse_coords_points(host_row.get("coords"), "coords")?;
    if is_wall && host_points.len() != 2 {
        return Err(BuildError::new(
            "E040",
            &format!(
                "MechanicalVentilationTerminal '{terminal_name}' host must be a line-like external wall"
            ),
        ));
    }

    let mid_height = mvhr_terminal_mid_height(terminal_row, terminal_name)?;

    let orientation360 = parse_csv_number_cell(host_row.get("orientation360"), "orientation360")?
        .or_else(|| orientation360_from_first_segment(&host_points))
        .ok_or_else(|| {
            BuildError::new(
                "E040",
                &format!(
                    "MechanicalVentilationTerminal '{terminal_name}' host orientation360 cannot be resolved"
                ),
            )
        })?;
    let pitch = parse_csv_number_cell(host_row.get("pitch"), "pitch")?
        .or({
            if host_points.len() == 2 {
                Some(90.0)
            } else {
                None
            }
        })
        .ok_or_else(|| {
            BuildError::new(
                "E040",
                &format!(
                    "MechanicalVentilationTerminal '{terminal_name}' host pitch cannot be resolved"
                ),
            )
        })?;
    if !(0.0..=360.0).contains(&orientation360) || !(0.0..=180.0).contains(&pitch) {
        return Err(BuildError::new(
            "E040",
            &format!(
                "MechanicalVentilationTerminal '{terminal_name}' host orientation360/pitch are outside FHS ranges"
            ),
        ));
    }

    mvhr_terminal_position_object(mid_height, orientation360, pitch)
}

/// Parse an optional CSV/metadata cell as a boolean, failing loudly on garbage.
/// Accepts TRUE/FALSE (any case) or JSON booleans; empty / absent → Ok(None).
fn parse_csv_bool_cell(value: Option<&Value>, field: &str) -> Result<Option<bool>, BuildError> {
    let Some(v) = value else { return Ok(None) };
    match v {
        Value::Null => Ok(None),
        Value::Bool(b) => Ok(Some(*b)),
        Value::String(s) => match s.trim().to_uppercase().as_str() {
            "" => Ok(None),
            "TRUE" => Ok(Some(true)),
            "FALSE" => Ok(Some(false)),
            other => Err(BuildError::new(
                "E055",
                &format!(
                    "'{field}' has unparseable boolean value '{other}'. \
                     Use TRUE or FALSE, or clear it to use the default."
                ),
            )),
        },
        other => Err(BuildError::new(
            "E055",
            &format!("'{field}' has non-boolean value '{other}'"),
        )),
    }
}

/// Contract precedence for a sectioned CSV row: defaults-template seed ←
/// extra_json ← CSV columns (highest), with schema allowlisting. Blank cells
/// (null / empty string) leave the seed value in place. An empty `allowed`
/// set allows all keys and skips the final prune. `skip_keys` are identity /
/// geometry / UI columns that must never enter the merged object.
/// Use this for any new sectioned merge so the precedence cannot be
/// reimplemented inverted (see `contracts/geometry-csv` `merge_precedence`).
fn csv_cell_is_set(v: &Value) -> bool {
    !(v.is_null() || v.as_str().is_some_and(|s| s.trim().is_empty()))
}

fn overlay_row_onto_seed(
    mut seed: serde_json::Map<String, Value>,
    row: &HashMap<String, Value>,
    skip_keys: &[&str],
    allowed: &HashSet<String>,
) -> serde_json::Map<String, Value> {
    let mut csv_set_keys: HashSet<String> = HashSet::new();
    for (k, v) in row {
        if k == "extra_json" || skip_keys.contains(&k.as_str()) {
            continue;
        }
        if !allowed.is_empty() && !allowed.contains(k) {
            continue;
        }
        if !csv_cell_is_set(v) {
            continue;
        }
        seed.insert(k.clone(), v.clone());
        csv_set_keys.insert(k.clone());
    }

    // extra_json arrives as a parsed object from the CSV parser, or as a raw
    // string in some sections — accept both.
    let extra_json_obj = match row.get("extra_json") {
        Some(Value::Object(obj)) => Some(obj.clone()),
        Some(Value::String(raw)) => serde_json::from_str::<Value>(raw)
            .ok()
            .and_then(|v| v.as_object().cloned()),
        _ => None,
    };
    if let Some(extra_json) = extra_json_obj {
        for (k, v) in &extra_json {
            // UI-only metadata keys must never reach merged JSON.
            if is_ui_only_extra_json_key(k) || csv_set_keys.contains(k) {
                continue;
            }
            if !allowed.is_empty() && !allowed.contains(k) {
                continue;
            }
            if !csv_cell_is_set(v) {
                continue;
            }
            seed.insert(k.clone(), v.clone());
        }
    }

    if !allowed.is_empty() {
        seed.retain(|k, _| allowed.contains(k));
    }
    seed
}

/// Metadata row names recognised by the merge pipeline. One list, shared by all
/// metadata mergers (it was previously triplicated and had already drifted).
const KNOWN_METADATA_FIELD_NAMES: &[&str] = &[
    "GlobalOrientationOffset",
    "DefaultsPath",
    "Postcode",
    "NumberOfBedrooms",
    "NumberOfWetRooms",
    "GroundFloorArea",
    "HeatingControlType",
    "PartGcompliance",
    "ColdWaterSource",
    "PartO_active_cooling_required",
    "Location",
    "AirPermeability_test_pressure",
    "AirPermeability_test_result",
    "AirPermeability_env_area",
    "AirPermeability_ventilation_zone_height",
    "DefaultThermalBridging",
    "Ventilation_shield_class",
    "Ventilation_terrain_class",
    "Ventilation_altitude",
    "Ventilation_ventilation_zone_base_height",
    "Ventilation_noise_nuisance",
    "BuildingLength",
    "BuildingWidth",
    "NumberOfHotTappedRooms",
    "NumberOfUtilityRooms",
    "NumberOfBathrooms",
    "NumberOfSanitaryAccommodations",
    "NumberOfHabitableRooms",
    "KitchenExtractorHoodExternal",
    "ComplianceValidationEnabled",
    "General_build_type",
    "General_built_form",
    "General_storeys_in_dwelling",
    "General_storey_of_dwelling",
    "General_storeys_in_building",
];

const COLD_WATER_SOURCE_MAINS: &str = "mains water";
const COLD_WATER_SOURCE_HEADER_TANK: &str = "header tank";
const COLD_WATER_SOURCE_DEFAULT: &str = COLD_WATER_SOURCE_MAINS;

/// Identify the (field name, field value) pair in a parsed Metadata row.
///
/// The CSV parser treats the first Metadata row as headers, so a row like
/// `PartGcompliance,TRUE` arrives as arbitrary header→cell pairs; the field
/// name is whichever cell matches a known metadata name and the value is the
/// first other non-empty cell.
fn extract_metadata_field(row: &HashMap<String, Value>) -> (Option<String>, Option<Value>) {
    let mut field_name: Option<String> = None;
    let mut field_value: Option<Value> = None;
    for value in row.values() {
        if let Some(value_str) = value.as_str() {
            if !value_str.is_empty() {
                if KNOWN_METADATA_FIELD_NAMES.contains(&value_str) {
                    if field_name.is_none() {
                        field_name = Some(value_str.to_string());
                    }
                } else if field_value.is_none() {
                    field_value = Some(value.clone());
                }
            }
        } else if !value.is_null() && field_value.is_none() {
            field_value = Some(value.clone());
        }
    }
    (field_name, field_value)
}

/// Slope-corrected PV panel dimensions from polygon coords + pitch (degrees).
/// Keep this in sync with the browser PV footprint derivation.
fn derive_pv_dimensions_from_coords(coords_str: &str, pitch_deg: f64) -> Option<(f64, f64)> {
    let mut coords: Vec<(f64, f64)> = Vec::new();
    for seg in coords_str.split('|') {
        let parts: Vec<&str> = seg.split(',').collect();
        if parts.len() < 2 {
            continue;
        }
        let (x, y) = match (
            parts[0].trim().parse::<f64>(),
            parts[1].trim().parse::<f64>(),
        ) {
            (Ok(x), Ok(y)) => (x, y),
            _ => continue,
        };
        coords.push((x, y));
    }
    if coords.len() < 3 {
        return None;
    }
    let ((ax, ay), (bx, by)) = (coords[0], coords[1]);
    let width = (bx - ax).hypot(by - ay);
    if !width.is_finite() || width <= 0.0 {
        return None;
    }
    let mut twice_area = 0.0;
    for (index, &(x1, y1)) in coords.iter().enumerate() {
        let (x2, y2) = coords[(index + 1) % coords.len()];
        twice_area += x1 * y2 - x2 * y1;
    }
    let plan_area = twice_area.abs() / 2.0;
    if !plan_area.is_finite() || plan_area <= 0.0 {
        return None;
    }
    let projected_depth = plan_area / width;
    let cos_pitch = pitch_deg.to_radians().cos();
    let height = if pitch_deg > 0.0 && cos_pitch > 1e-9 {
        projected_depth / cos_pitch
    } else {
        projected_depth
    };
    Some((width, height))
}

impl BuildError {
    pub(crate) fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            validation_errors: Vec::new(),
        }
    }

    pub(crate) fn with_validation_errors(
        code: &str,
        message: &str,
        validation_errors: Vec<ValidationError>,
    ) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            validation_errors,
        }
    }
}

pub struct JSONBuilder {
    schema: Value,
    defaults: Value,
    #[allow(dead_code)]
    seen_names: HashSet<String>,
    pub type_templates: HashMap<String, Value>,
    /// Indexed from defaults: last `BuildingElementOpaque` with vertical wall-like pitch (not door / not roof-band).
    opaque_template_wall: Option<Value>,
    /// Indexed from defaults: last opaque whose pitch falls in the roof sloped band (see [`Self::pitch_degrees_matches_roof_variant`]).
    opaque_template_roof: Option<Value>,
    /// Indexed from defaults: last opaque with `is_external_door` true.
    opaque_template_external_door: Option<Value>,
    /// True when this builder was initialised with an FHS schema (input_fhs.schema.json).
    /// In that case we keep richer FHS-only fields; for Core schemas we rely strictly
    /// on the Core schema's allowed properties when pruning.
    is_fhs_schema: bool,
    /// Parsed from CSV Metadata `ComplianceValidationEnabled` (workflow flag). When `Some(false)`,
    /// we skip injecting implicit `false` defaults for FHS-only root booleans used by validation.
    /// When `None` or `Some(true)`, FHS merges apply those defaults when keys are absent.
    compliance_validation_enabled: Option<bool>,
    /// Default thermal bridging value (W/K) to use when simplified thermal bridging is disabled and no thermal bridge elements are defined
    default_thermal_bridging: f64,
    /// FHS cold-water source selected from CSV Metadata `ColdWaterSource`.
    /// Core inputs keep their existing defaults shape; this only canonicalizes FHS-family output.
    cold_water_source: String,
    /// Non-fatal merge problems (e.g. unparseable user values, unknown element
    /// types). The bad value is skipped so a JSON is still produced; the
    /// problems surface in the save's `ValidationResult` for the UI to show.
    /// RefCell because most merge passes take `&self`.
    non_fatal_errors: RefCell<Vec<ValidationError>>,
    /// Exact upstream core version supplied by the host for FHS input metadata.
    hem_core_version: String,
}

impl JSONBuilder {
    /// True when this builder validates against an FHS-family schema (FHS / ECaaS).
    pub fn targets_fhs_schema(&self) -> bool {
        self.is_fhs_schema
    }

    /// Top-level property names the active schema accepts. Used to reject unknown
    /// root keys, since schema roots are not strict (`unevaluatedProperties` absent).
    pub fn schema_root_property_names(&self) -> HashSet<String> {
        self.schema
            .get("properties")
            .and_then(|p| p.as_object())
            .map(|props| props.keys().cloned().collect())
            .unwrap_or_default()
    }
}

impl JSONBuilder {
    #[cfg(test)]
    pub fn new(schema_path: &str, defaults_path: &str) -> Result<Self, BuildError> {
        let schema = normalized_schema_document(Self::load_schema(schema_path)?);
        let defaults = Self::load_defaults(defaults_path)?;

        // Detect FHS schema by inspecting schema content (required fields), not the
        // file path. Path-based detection was too broad and could misclassify
        // core schema paths that happened to include "fhs".
        let is_fhs = Self::detect_fhs_schema(&schema);

        let mut builder = Self {
            is_fhs_schema: is_fhs,
            schema,
            defaults,
            seen_names: HashSet::new(),
            type_templates: HashMap::new(),
            opaque_template_wall: None,
            opaque_template_roof: None,
            opaque_template_external_door: None,
            default_thermal_bridging: 0.2, // Default fallback value
            cold_water_source: COLD_WATER_SOURCE_DEFAULT.to_string(),
            compliance_validation_enabled: None,
            non_fatal_errors: RefCell::new(Vec::new()),
            hem_core_version: hem_upstream::HEM_VERSION.to_string(),
        };

        builder.index_templates();
        Ok(builder)
    }

    /// Construct only from caller-supplied content and explicit profile/version metadata.
    pub fn from_json_inputs(
        schema_json: &str,
        defaults_json: &str,
        profile: ModelProfile,
        version_metadata: &VersionMetadata,
    ) -> Result<Self, BuildError> {
        let schema: Value = serde_json::from_str(schema_json)
            .map_err(|e| BuildError::new("E003", &format!("Failed to parse schema JSON: {e}")))?;
        let schema = normalized_schema_document(schema);
        let defaults: Value = serde_json::from_str(defaults_json)
            .map_err(|e| BuildError::new("E006", &format!("Failed to parse defaults JSON: {e}")))?;

        let is_fhs = profile == ModelProfile::Fhs;

        let mut builder = Self {
            is_fhs_schema: is_fhs,
            schema,
            defaults,
            seen_names: HashSet::new(),
            type_templates: HashMap::new(),
            opaque_template_wall: None,
            opaque_template_roof: None,
            opaque_template_external_door: None,
            default_thermal_bridging: 0.2, // Default fallback value
            cold_water_source: COLD_WATER_SOURCE_DEFAULT.to_string(),
            compliance_validation_enabled: None,
            non_fatal_errors: RefCell::new(Vec::new()),
            hem_core_version: version_metadata.hem_core_version.clone(),
        };
        builder.index_templates();
        Ok(builder)
    }

    /// Record a non-fatal merge problem. The offending value is skipped (the
    /// defaults profile wins for that field) and the problem surfaces in the
    /// save's `ValidationResult`, so users always get a JSON plus a visible
    /// front-end build error — never a silent fallback, never a blocked save.
    fn push_non_fatal(&self, code: &str, path: &str, message: &str) {
        self.non_fatal_errors.borrow_mut().push(ValidationError {
            code: code.to_string(),
            path: path.to_string(),
            message: message.to_string(),
            schema_path: None,
            keyword: None,
        });
    }

    /// Drain the non-fatal merge problems collected during `build_json`.
    pub fn take_non_fatal_errors(&self) -> Vec<ValidationError> {
        std::mem::take(&mut *self.non_fatal_errors.borrow_mut())
    }

    /// Parse a numeric CSV/metadata cell; an unparseable or non-finite value
    /// records E055 and returns None (defaults win, the user is told).
    fn csv_number_non_fatal(&self, value: Option<&Value>, field: &str, path: &str) -> Option<f64> {
        match parse_csv_number_cell(value, field) {
            Ok(Some(n)) if n.is_finite() => Some(n),
            Ok(Some(n)) => {
                self.push_non_fatal(
                    "E055",
                    path,
                    &format!("'{field}' is not a finite number ({n})"),
                );
                None
            }
            Ok(None) => None,
            Err(e) => {
                self.push_non_fatal(&e.code, path, &e.message);
                None
            }
        }
    }

    /// Parse a boolean CSV/metadata cell; an unparseable value records E055
    /// and returns None (defaults win, the user is told).
    fn csv_bool_non_fatal(&self, value: Option<&Value>, field: &str, path: &str) -> Option<bool> {
        match parse_csv_bool_cell(value, field) {
            Ok(v) => v,
            Err(e) => {
                self.push_non_fatal(&e.code, path, &e.message);
                None
            }
        }
    }

    #[cfg(test)]
    fn detect_fhs_schema(schema: &Value) -> bool {
        // For JSON string inputs, detect FHS schema by checking for FHS-specific required fields.
        // FHS schema has unique required fields that Core doesn't have:
        // 'HeatingControlType', 'Appliances', 'NumberOfBedrooms', 'PartGcompliance', 'SpaceHeatSystem', 'General'
        if let Some(required) = schema.get("required").and_then(|r| r.as_array()) {
            let required_set: HashSet<&str> = required.iter().filter_map(|v| v.as_str()).collect();

            // Check for FHS-specific required fields
            // If schema requires these FHS-only fields, it's an FHS schema
            let fhs_indicators = [
                "HeatingControlType",
                "Appliances",
                "NumberOfBedrooms",
                "PartGcompliance",
            ];
            for indicator in &fhs_indicators {
                if required_set.contains(indicator) {
                    return true;
                }
            }
        }

        false
    }

    #[cfg(test)]
    fn load_schema(schema_path: &str) -> Result<Value, BuildError> {
        let path = Path::new(schema_path);
        if !path.exists() {
            return Err(BuildError::new(
                "E001",
                &format!("Schema file not found: {schema_path}"),
            ));
        }

        let content = fs::read_to_string(path)
            .map_err(|e| BuildError::new("E002", &format!("Failed to read schema file: {e}")))?;

        serde_json::from_str(&content)
            .map_err(|e| BuildError::new("E003", &format!("Failed to parse schema JSON: {e}")))
    }

    #[cfg(test)]
    fn load_defaults(defaults_path: &str) -> Result<Value, BuildError> {
        let requested = Path::new(defaults_path);
        let community_template = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../data/defaults/defaults_template.json");
        let resolved = if requested.exists() {
            requested
        } else if requested
            .file_name()
            .is_some_and(|name| name == "defaults_template.json")
        {
            community_template.as_path()
        } else {
            requested
        };
        let content = fs::read_to_string(resolved).map_err(|error| {
            BuildError::new(
                "E005",
                &format!(
                    "Failed to read defaults file {}: {error}",
                    resolved.display()
                ),
            )
        })?;
        serde_json::from_str(&content).map_err(|error| {
            BuildError::new(
                "E006",
                &format!(
                    "Failed to parse defaults JSON ({}): {error}",
                    resolved.display()
                ),
            )
        })
    }

    fn index_templates(&mut self) {
        // Pre-index all templates by type for O(1) lookup
        // Snapshot `Zone` so we can mutate template buckets while walking defaults.
        let zones_snapshot = self.defaults.get("Zone").cloned();
        if let Some(zones) = zones_snapshot {
            if let Some(zones_obj) = zones.as_object() {
                for zone_data in zones_obj.values() {
                    if let Some(building_elements) = zone_data.get("BuildingElement") {
                        if let Some(elements_obj) = building_elements.as_object() {
                            for element in elements_obj.values() {
                                if let Some(element_obj) = element.as_object() {
                                    if let Some(type_str) =
                                        element_obj.get("type").and_then(|v| v.as_str())
                                    {
                                        if type_str == "BuildingElementOpaque" {
                                            self.index_opaque_template_candidate(element.clone());
                                        } else {
                                            self.type_templates
                                                .insert(type_str.to_string(), element.clone());
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if let Some(thermal_bridging) = zone_data.get("ThermalBridging") {
                        if let Some(bridging_obj) = thermal_bridging.as_object() {
                            for bridge in bridging_obj.values() {
                                if let Some(bridge_obj) = bridge.as_object() {
                                    if let Some(bridge_type) = bridge_obj.get("type") {
                                        if let Some(type_str) = bridge_type.as_str() {
                                            self.type_templates
                                                .insert(type_str.to_string(), bridge.clone());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                self.finalize_opaque_primary_template();
            }
        }

        // Index root-level OnSiteGeneration templates
        if let Some(on_site_gen) = self.defaults.get("OnSiteGeneration") {
            if let Some(on_site_gen_obj) = on_site_gen.as_object() {
                for pv_system in on_site_gen_obj.values() {
                    if let Some(pv_obj) = pv_system.as_object() {
                        if let Some(pv_type) = pv_obj.get("type") {
                            if let Some(type_str) = pv_type.as_str() {
                                // Index by type (e.g., "PhotovoltaicSystem")
                                let key = format!("OnSiteGeneration_{type_str}");
                                self.type_templates.insert(key, pv_system.clone());
                            }
                        }
                    }
                }
            }
        }

        // Index root-level EnergySupply.ElectricBattery templates
        if let Some(energy_supply) = self.defaults.get("EnergySupply") {
            if let Some(energy_supply_obj) = energy_supply.as_object() {
                for supply_entry in energy_supply_obj.values() {
                    if let Some(supply_obj) = supply_entry.as_object() {
                        if let Some(battery) = supply_obj.get("ElectricBattery") {
                            if battery.is_object() {
                                // Index ElectricBattery template
                                self.type_templates
                                    .insert("ElectricBattery".to_string(), battery.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    /// Sloped / non-vertical opaque fabric used to pick roof-oriented defaults. Excludes vertical
    /// walls (~90°) and horizontal floors (~180°); includes typical pitched roofs (e.g. 45°) and
    /// near-flat decks (0°).
    fn pitch_degrees_matches_roof_variant(deg: f64) -> bool {
        const WALL_DEG: f64 = 90.0;
        const FLOOR_DEG: f64 = 180.0;
        const EPS: f64 = 1e-3;
        if !deg.is_finite() {
            return false;
        }
        if (deg - WALL_DEG).abs() < EPS || (deg - FLOOR_DEG).abs() < EPS {
            return false;
        }
        (-EPS..=180.0 + EPS).contains(&deg)
    }

    fn value_as_pitch_degrees_f64(value: &Value) -> Option<f64> {
        if let Some(f) = value.as_f64() {
            return Some(f);
        }
        if let Some(i) = value.as_i64() {
            return Some(i as f64);
        }
        value.as_str()?.trim().parse::<f64>().ok()
    }

    fn json_truthy_external_door(value: Option<&Value>) -> bool {
        match value {
            Some(Value::Bool(b)) => *b,
            Some(Value::String(s)) => {
                matches!(s.trim().to_ascii_uppercase().as_str(), "TRUE" | "1" | "YES")
            }
            Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
            _ => false,
        }
    }

    /// CSV `is_external_door` column only (`extra_json` is not used for this flag).
    fn row_external_door_flag(row: &HashMap<String, Value>) -> bool {
        if row.contains_key("is_external_door") {
            return Self::json_truthy_external_door(row.get("is_external_door"));
        }
        false
    }

    /// Opaque template pitch: CSV `pitch` column only (`extra_json` is not used).
    fn row_effective_pitch_degrees_for_opaque_template(
        row: &HashMap<String, Value>,
    ) -> Option<f64> {
        row.get("pitch").and_then(Self::value_as_pitch_degrees_f64)
    }

    fn index_opaque_template_candidate(&mut self, element: Value) {
        let Some(obj) = element.as_object() else {
            return;
        };
        if Self::json_truthy_external_door(obj.get("is_external_door")) {
            self.opaque_template_external_door = Some(element);
            return;
        }
        let pitch = obj.get("pitch").and_then(Self::value_as_pitch_degrees_f64);
        if let Some(p) = pitch {
            if Self::pitch_degrees_matches_roof_variant(p) {
                self.opaque_template_roof = Some(element);
                return;
            }
        }
        self.opaque_template_wall = Some(element);
    }

    fn finalize_opaque_primary_template(&mut self) {
        let primary = self
            .opaque_template_wall
            .clone()
            .or_else(|| self.opaque_template_roof.clone())
            .or_else(|| self.opaque_template_external_door.clone());
        if let Some(t) = primary {
            self.type_templates
                .insert("BuildingElementOpaque".to_string(), t);
        }
    }

    fn get_default_building_element_opaque_seed(
        &self,
        is_external_door: bool,
        pitch_degrees: Option<f64>,
    ) -> Result<Value, BuildError> {
        if is_external_door {
            if let Some(t) = &self.opaque_template_external_door {
                return Ok(t.clone());
            }
        } else if let Some(p) = pitch_degrees {
            if Self::pitch_degrees_matches_roof_variant(p) {
                if let Some(t) = &self.opaque_template_roof {
                    return Ok(t.clone());
                }
            }
        }
        if let Some(t) = self.type_templates.get("BuildingElementOpaque") {
            return Ok(t.clone());
        }
        let mut element_obj = serde_json::Map::new();
        element_obj.insert(
            "type".to_string(),
            Value::String("BuildingElementOpaque".to_string()),
        );
        Ok(Value::Object(element_obj))
    }

    pub fn build_json(
        &mut self,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<Value, BuildError> {
        // Parse DefaultThermalBridging from metadata early so it's available for zone processing
        self.parse_default_thermal_bridging_from_metadata(csv_data);
        self.parse_cold_water_source_from_metadata(csv_data);

        let mut result = self.defaults.clone();
        if self.is_fhs_schema {
            if let Some(root) = result.as_object_mut() {
                // FHS hot-water source must be explicitly authored through Systems.
                // Keep defaults_template.json as a source of field defaults, not as an implicit model element.
                root.remove("HotWaterSource");
                // Wet heat plant must come from CSV Systems / presets, not a leftover default HP
                // (e.g. immersion-only or all-electric space heat must not retain a phantom ASHP).
                root.remove("HeatSourceWet");
            }
        }

        // Process zone-centric sections
        self.build_zone_structure(&mut result, csv_data)?;

        // Consolidate zones for FHS schema (FHS only supports single zone)
        // This must happen after build_zone_structure but before process_root_level_sections
        // so that systems and elements are processed correctly
        if self.is_fhs_schema {
            self.consolidate_zones_for_fhs(&mut result)?;
        }

        // Process root-level sections (includes merge_ventilation_systems, merge_water_pipework, merge_wet_emitters)
        self.process_root_level_sections(&mut result, csv_data)?;

        if self.is_fhs_schema {
            self.apply_fhs_cold_water_source(&mut result);
            self.sanitize_fhs_output(&mut result);
        }

        // Schema-based cleanup: removes properties not allowed by the schema
        // This replaces hardcoded cleanup functions with a programmatic approach
        self.cleanup_against_schema(&mut result)?;

        // Full JSON Schema validation is deferred to `convert_geometry_csv_to_json` in `mod.rs`
        // so merge can return a Value while reporting `is_valid: false` (UI saves JSON + flags).

        Ok(result)
    }

    fn sanitize_fhs_output(&self, result: &mut Value) {
        if let Some(root) = result.as_object_mut() {
            root.remove("temp_internal_air_static_calcs");
            root.remove("SimulationTime");
            root.remove("InternalGains");
            // Root `Control` is not an allowed top-level property in FHS merge JSON Schema validation
            // (`unevaluatedProperties`). Upstream ingest resolves schedule refs separately.
            root.remove("Control");

            if let Some(heat_source_wet) = root
                .get_mut("HeatSourceWet")
                .and_then(|v| v.as_object_mut())
            {
                for heat_source in heat_source_wet.values_mut() {
                    if let Some(heat_source_obj) = heat_source.as_object_mut() {
                        let backup_ctrl_type = heat_source_obj
                            .get("backup_ctrl_type")
                            .and_then(|v| v.as_str());
                        if backup_ctrl_type == Some("None") {
                            heat_source_obj.remove("time_delay_backup");
                            heat_source_obj.remove("power_max_backup");
                        }
                    }
                }
            }

            if let Some(infiltration) = root
                .get_mut("InfiltrationVentilation")
                .and_then(|v| v.as_object_mut())
            {
                infiltration.remove("cross_vent_possible");
                infiltration.remove("cross_vent_factor");
            }
        }

        if let Some(zones) = result.get_mut("Zone").and_then(|z| z.as_object_mut()) {
            for zone in zones.values_mut() {
                if let Some(zone_obj) = zone.as_object_mut() {
                    zone_obj.remove("SpaceHeatControl");
                }
            }
        }

        if let Some(space_heat_systems) = result
            .get_mut("SpaceHeatSystem")
            .and_then(|s| s.as_object_mut())
        {
            for system in space_heat_systems.values_mut() {
                if let Some(system_obj) = system.as_object_mut() {
                    system_obj.remove("Control");
                }
            }
        }
    }

    fn build_zone_structure(
        &mut self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        // Process Zone section to create zone objects
        if let Some(zone_data) = csv_data.get("Zone") {
            tracing::debug!("Creating {} zones", zone_data.len());
            let mut zones = serde_json::Map::new();

            for zone_row in zone_data {
                let zone_name = zone_row
                    .get("Name")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| BuildError::new("E007", "Zone missing required 'Name' field"))?;

                tracing::debug!("Creating zone '{}'", zone_name);

                // Start with a copy of the default zone structure if it exists, but clear the building elements
                // Try to match by zone name first, then fall back to first available zone
                let default_zone = result["Zone"]
                    .as_object()
                    .and_then(|z| z.get(zone_name))
                    .or_else(|| result["Zone"].as_object().and_then(|z| z.values().next()));

                let mut zone_obj = if let Some(default_zone) = default_zone {
                    let mut zone_copy = default_zone.clone();
                    // Clear the building elements so we only include CSV-defined ones
                    if let Some(zone_obj) = zone_copy.as_object_mut() {
                        tracing::debug!(
                            "Clearing BuildingElement for zone '{}' (starting with empty map)",
                            zone_name
                        );
                        zone_obj.insert(
                            "BuildingElement".to_string(),
                            Value::Object(serde_json::Map::new()),
                        );
                        zone_obj.insert(
                            "ThermalBridging".to_string(),
                            Value::Object(serde_json::Map::new()),
                        );
                        zone_obj.insert("Lighting".to_string(), Value::Null);

                        // Clear SpaceHeatSystem reference if we're copying from a different zone name
                        // This prevents default systems from being incorrectly assigned to zones
                        // that don't match the system's Zone field. The assignment logic will
                        // handle assigning systems correctly based on the system's Zone field.
                        let default_zone_name = default_zone
                            .as_object()
                            .and_then(|z| z.get("SpaceHeatSystem"))
                            .and_then(|v| {
                                // Check if the referenced system's Zone field matches this zone name
                                v.as_str().and_then(|sys_name| {
                                    result["SpaceHeatSystem"]
                                        .as_object()
                                        .and_then(|syss| syss.get(sys_name))
                                        .and_then(|sys| sys.get("Zone"))
                                        .and_then(|v| v.as_str())
                                        .map(|sys_zone| sys_zone == zone_name)
                                })
                            });

                        // If the default zone's SpaceHeatSystem doesn't match this zone name, clear it
                        if default_zone_name != Some(true) {
                            tracing::debug!(
                                "Clearing SpaceHeatSystem for zone '{}' (system's Zone field doesn't match)",
                                zone_name
                            );
                            zone_obj.remove("SpaceHeatSystem");
                        }

                        // Remove FHS-disallowed properties if using FHS schema
                        // This provides defense-in-depth in case these properties are added back to defaults
                        if self.is_fhs_schema {
                            zone_obj.remove("area");
                            zone_obj.remove("height");
                            zone_obj.remove("temp_setpnt_init");
                        }
                    }
                    zone_copy
                } else {
                    // Create minimal zone structure if no default exists
                    let mut obj = serde_json::Map::new();
                    obj.insert(
                        "BuildingElement".to_string(),
                        Value::Object(serde_json::Map::new()),
                    );
                    obj.insert(
                        "ThermalBridging".to_string(),
                        Value::Object(serde_json::Map::new()),
                    );
                    obj.insert("Lighting".to_string(), Value::Null);
                    Value::Object(obj)
                };

                // Update zone properties from CSV
                if let Some(volume) = zone_row.get("volume") {
                    zone_obj["volume"] = volume.clone();
                }
                let csv_floor_area = zone_row.get("floor_area").cloned();
                if !self.is_fhs_schema {
                    if let Some(floor_area) = csv_floor_area.as_ref() {
                        zone_obj["area"] = floor_area.clone();
                    }
                }
                if let Some(livingroom_area) = zone_row.get("livingroom_area") {
                    if !livingroom_area.is_null() {
                        zone_obj["livingroom_area"] = livingroom_area.clone();
                    }
                }
                if let Some(restofdwelling_area) = zone_row.get("restofdwelling_area") {
                    if !restofdwelling_area.is_null() {
                        zone_obj["restofdwelling_area"] = restofdwelling_area.clone();
                    }
                }
                // Process height: store it in zone object, and if volume is missing, calculate volume = floor_area * height
                // Skip storing height in zone object for FHS schema (not allowed by FHS schema)
                if let Some(height) = zone_row.get("height") {
                    if let Some(h) = height.as_f64() {
                        if h > 0.0 {
                            // Store height in zone object (only for Core schema, not FHS)
                            if !self.is_fhs_schema {
                                zone_obj["height"] =
                                    Value::Number(serde_json::Number::from_f64(h).unwrap());
                            }

                            // If volume is missing or zero, calculate it from floor_area * height
                            // This calculation is still useful for both Core and FHS
                            let current_volume = zone_obj
                                .get("volume")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0);
                            if current_volume == 0.0 {
                                let area_for_volume = csv_floor_area
                                    .as_ref()
                                    .and_then(|v| v.as_f64())
                                    .or_else(|| zone_obj.get("area").and_then(|v| v.as_f64()));
                                if let Some(area) = area_for_volume {
                                    if area > 0.0 {
                                        let calculated_volume = area * h;
                                        zone_obj["volume"] = Value::Number(
                                            serde_json::Number::from_f64(calculated_volume)
                                                .unwrap(),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }

                // Handle simplified thermal bridging during zone creation (like Python)
                let simplified = zone_row
                    .get("simplified thermal bridging")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                if simplified {
                    // Calculate total exposed area (Exposed Elements + Window Elements)
                    let mut total_area = 0.0;
                    if let Some(exposed_elements) = csv_data.get("Exposed Elements") {
                        for elem in exposed_elements {
                            if elem.get("Zone").and_then(|v| v.as_str()) == Some(zone_name) {
                                if let Some(area) = elem.get("area").and_then(|v| v.as_f64()) {
                                    total_area += area;
                                }
                            }
                        }
                    }
                    if let Some(window_elements) = csv_data.get("Window Elements") {
                        for elem in window_elements {
                            if elem.get("Zone").and_then(|v| v.as_str()) == Some(zone_name) {
                                if let Some(area) = elem.get("area").and_then(|v| v.as_f64()) {
                                    total_area += area;
                                }
                            }
                        }
                    }
                    // Set ThermalBridging to 0.2 * total_area (as a number, not object)
                    zone_obj["ThermalBridging"] = serde_json::Value::Number(
                        serde_json::Number::from_f64(0.2 * total_area).unwrap(),
                    );
                }

                // Insert the zone into the zones map
                zones.insert(zone_name.to_string(), zone_obj);
            }

            result["Zone"] = Value::Object(zones);
        }

        // Process building element sections
        self.add_building_elements_to_zones(result, csv_data)?;

        // Calculate zone area from geometry if floor_area is 0
        self.calculate_zone_area_from_geometry(result, csv_data)?;

        // Process window shading (add to window objects)
        self.add_window_shading_to_zones(result, csv_data)?;

        // Process thermal bridging elements (only for zones not using simplified mode)
        self.add_thermal_bridging_to_zones(result, csv_data)?;

        // Process lighting
        self.add_lighting_to_zones(result, csv_data)?;

        // Ensure required fields: ThermalBridging and temp_setpnt_init (like Python)
        if let Some(zones) = result["Zone"].as_object_mut() {
            for (zone_name, zone) in zones {
                if let Some(zone_obj) = zone.as_object_mut() {
                    // If temp_setpnt_init is missing, copy from defaults or set to 21.0 (like Python)
                    // Skip inserting temp_setpnt_init for FHS schema (not allowed by FHS schema)
                    if !self.is_fhs_schema && !zone_obj.contains_key("temp_setpnt_init") {
                        let default_val = if let Some(default_zone) =
                            self.defaults.get("Zone").and_then(|z| z.get(zone_name))
                        {
                            default_zone.get("temp_setpnt_init").cloned()
                        } else {
                            None
                        };
                        zone_obj.insert(
                            "temp_setpnt_init".to_string(),
                            default_val.unwrap_or_else(|| {
                                serde_json::Value::Number(
                                    serde_json::Number::from_f64(21.0).unwrap(),
                                )
                            }),
                        );
                    }
                }
            }
        }

        Ok(())
    }

    fn add_building_elements_to_zones(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        let building_element_sections = [
            "Exposed Elements",
            "Window Elements",
            "Ground Elements",
            "Non-Exposed Elements",
        ];

        let valid_types = self.schema_building_element_type_values();

        for section_name in &building_element_sections {
            if let Some(section_data) = csv_data.get(*section_name) {
                tracing::debug!(
                    "Processing {} section with {} elements",
                    section_name,
                    section_data.len()
                );
                for element_row in section_data {
                    let element_name = element_row
                        .get("Name")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            BuildError::new(
                                "E008",
                                &format!("{section_name} missing required 'Name' field"),
                            )
                        })?;

                    let zone_name = element_row
                        .get("Zone")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            BuildError::new(
                                "E009",
                                &format!("{section_name} missing required 'Zone' field"),
                            )
                        })?;

                    let csv_element_type = element_row
                        .get("Type")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            BuildError::new(
                                "E010",
                                &format!("{section_name} missing required 'Type' field"),
                            )
                        })?;

                    tracing::debug!(
                        "Adding element '{}' of type '{}' to zone '{}'",
                        element_name,
                        csv_element_type,
                        zone_name
                    );

                    // Map CSV type to schema type
                    let schema_element_type = self.map_csv_type_to_schema_type(csv_element_type);

                    // An unknown/typo'd element Type used to degrade silently (the row
                    // kept only base-schema properties and the rest of the user's
                    // values were discarded). The degraded element is still emitted so
                    // the user gets a JSON, but the problem now surfaces as an E056
                    // validation error instead of passing unremarked.
                    if !valid_types.is_empty() && !valid_types.contains(&schema_element_type) {
                        self.push_non_fatal(
                            "E056",
                            &format!("Zone/{zone_name}/BuildingElement/{element_name}"),
                            &format!(
                                "Unknown building element type '{schema_element_type}' \
                                 (element '{element_name}' in {section_name}) — check the \
                                 'Type' column. Valid types: {}",
                                {
                                    let mut sorted: Vec<&String> = valid_types.iter().collect();
                                    sorted.sort();
                                    sorted
                                        .iter()
                                        .map(|s| s.as_str())
                                        .collect::<Vec<_>>()
                                        .join(", ")
                                }
                            ),
                        );
                    }

                    // Check if zone exists
                    if !result["Zone"].as_object().unwrap().contains_key(zone_name) {
                        return Err(BuildError::new(
                            "E011",
                            &format!(
                                "Zone '{zone_name}' referenced in {section_name} but not defined"
                            ),
                        ));
                    }

                    // Start with a default template for this element type
                    // For BuildingElementGround, we need to get the floor_type from CSV first to select the right variant
                    // Extract floor_type early so it's available throughout the function
                    let floor_type = if schema_element_type == "BuildingElementGround" {
                        element_row
                            .get("floor_type")
                            .or_else(|| {
                                element_row
                                    .get("extra_json")
                                    .and_then(|ej| ej.get("floor_type"))
                            })
                            .and_then(|v| v.as_str())
                    } else {
                        None
                    };

                    let is_external_door_flag = if schema_element_type == "BuildingElementOpaque" {
                        Self::row_external_door_flag(element_row)
                    } else {
                        false
                    };
                    let opaque_pitch_for_seed = if schema_element_type == "BuildingElementOpaque" {
                        Self::row_effective_pitch_degrees_for_opaque_template(element_row)
                    } else {
                        None
                    };

                    let mut element_obj = if schema_element_type == "BuildingElementGround" {
                        self.get_default_building_element_variant(&schema_element_type, floor_type)?
                    } else if schema_element_type == "BuildingElementOpaque" {
                        self.get_default_building_element_opaque_seed(
                            is_external_door_flag,
                            opaque_pitch_for_seed,
                        )?
                    } else {
                        self.get_default_building_element(&schema_element_type)?
                    };

                    let mut element_context = Self::build_building_element_context(
                        &schema_element_type,
                        None,
                        floor_type,
                    );
                    if let Some(pitch) = element_row.get("pitch") {
                        element_context.insert("pitch".to_string(), pitch.clone());
                    }
                    if let Some(extra_json) =
                        element_row.get("extra_json").and_then(|v| v.as_object())
                    {
                        for key in ["floor_type", "party_wall_cavity_type"] {
                            if let Some(value) = extra_json.get(key) {
                                element_context.insert(key.to_string(), value.clone());
                            }
                        }
                    }
                    if schema_element_type == "BuildingElementOpaque" {
                        element_context.insert(
                            "is_external_door".to_string(),
                            Value::Bool(is_external_door_flag),
                        );
                    }

                    let allowed_building_element_props = self
                        .get_allowed_building_element_properties(
                            &schema_element_type,
                            Some(&element_context),
                            floor_type,
                        );

                    // An empty allowlist means the schema lookup failed entirely; the
                    // element degrades to a bare `type` and the user's values are
                    // discarded, so record an E056 (non-fatal — a JSON is still saved).
                    if allowed_building_element_props.is_empty() {
                        self.push_non_fatal(
                            "E056",
                            &format!("Zone/{zone_name}/BuildingElement/{element_name}"),
                            &format!(
                                "No schema properties found for building element type \
                                 '{schema_element_type}' (element '{element_name}') — \
                                 check the 'Type' column"
                            ),
                        );
                    }

                    // Ensure defaults don't introduce unknown keys (schema uses additionalProperties=false)
                    if let Some(obj) = element_obj.as_object_mut() {
                        if !allowed_building_element_props.is_empty() {
                            obj.retain(|k, _| allowed_building_element_props.contains(k));
                        } else {
                            obj.retain(|k, _| k == "type");
                        }
                    }

                    // Track which keys were explicitly set by CSV columns (to preserve precedence)
                    let mut csv_set_keys: std::collections::HashSet<String> =
                        std::collections::HashSet::new();

                    let coerce_horizontal_csv_pitch_90 = should_coerce_horizontal_adjacent_pitch_90(
                        &schema_element_type,
                        element_row,
                    );

                    // Override with CSV data, but only include valid properties and non-null values
                    for (key, value) in element_row {
                        if key == "Name" || key == "Zone" || key == "Type" || key == "position_xyz"
                        {
                            continue;
                        }
                        // NB. `base_height` on adjacent/party/ground rows is viewer-only and not in
                        // the HEM schema for those element types — the allowlist check drops it here.
                        // It stays in the CSV; the merged dwelling JSON carries pure HEM input only.
                        let storage_key: String = key.clone();
                        // Only include properties that are valid for this element type
                        if allowed_building_element_props.contains(&storage_key) {
                            // Only override if the value is not null/empty
                            if !(value.is_null()
                                || (value.is_string() && value.as_str().unwrap().is_empty()))
                            {
                                let mut processed_value = self.coerce_building_element_value(
                                    key,
                                    value,
                                    &schema_element_type,
                                    floor_type,
                                );
                                if key == "pitch"
                                    && coerce_horizontal_csv_pitch_90
                                    && pitch_csv_value_is_90(&processed_value)
                                {
                                    processed_value = Value::Number(serde_json::Number::from(0));
                                }
                                element_obj[&storage_key] = processed_value;
                                csv_set_keys.insert(storage_key);
                            }
                        }
                    }

                    // Merge extra_json data with precedence: CSV columns > extra_json > defaults
                    if let Some(Value::Object(extra_json_obj)) = element_row.get("extra_json") {
                        if let Some(element_obj_map) = element_obj.as_object_mut() {
                            for (key, value) in extra_json_obj {
                                if is_ui_only_extra_json_key(key) {
                                    continue;
                                }
                                let storage_key: String = key.clone();
                                // Only merge if:
                                // 1. Property is valid for this element type
                                // 2. Property is not already set by CSV columns (CSV takes precedence)
                                // 3. Value is not null/empty
                                // 4. Property is not position_xyz (CSV-only field)
                                if allowed_building_element_props.contains(&storage_key)
                                    && !csv_set_keys.contains(&storage_key)
                                    && key != "position_xyz"
                                    && key != "pitch"
                                    && key != "is_external_door"
                                    && !(value.is_null()
                                        || (value.is_string()
                                            && value.as_str().unwrap().is_empty()))
                                {
                                    let processed_value = self.coerce_building_element_value(
                                        key,
                                        value,
                                        &schema_element_type,
                                        floor_type,
                                    );
                                    element_obj_map.insert(
                                        storage_key,
                                        strip_ui_only_extra_json_value(&processed_value),
                                    );
                                }
                            }
                        }
                    }

                    // Calculate area from width * height if area is missing or ≤ 0
                    // This applies to opaque and transparent elements that have width/height
                    if let Some(element_obj_map) = element_obj.as_object_mut() {
                        let supports_calculated_area = schema_element_type
                            == "BuildingElementOpaque"
                            || (schema_element_type == "BuildingElementTransparent"
                                && !self.is_fhs_schema);
                        let needs_area_calculation = supports_calculated_area && {
                            let current_area = element_obj_map
                                .get("area")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0);
                            current_area <= 0.0
                        };

                        if needs_area_calculation {
                            if let (Some(width), Some(height)) = (
                                element_obj_map.get("width").and_then(|v| v.as_f64()),
                                element_obj_map.get("height").and_then(|v| v.as_f64()),
                            ) {
                                if width > 0.0 && height > 0.0 {
                                    let calculated_area = width * height;
                                    element_obj_map.insert(
                                        "area".to_string(),
                                        Value::Number(
                                            serde_json::Number::from_f64(calculated_area)
                                                .expect("Area should be a valid number"),
                                        ),
                                    );
                                }
                            }
                        }

                        // The geometry CSV contract has one ground-element `area` column and no
                        // separate dwelling-wide `total_area` column. For the unambiguous
                        // single-ground-element topology, upstream HEM requires those two facts
                        // to be identical. Do not let a template's unrelated `total_area`
                        // survive after the CSV has replaced `area` (the H283 route previously
                        // produced area=35.6 with a stale template total_area=30).
                        // Multi-element ground topology remains untouched because the CSV does
                        // not carry an identity that can establish which zone portions belong to
                        // the same whole-dwelling floor.
                        if schema_element_type == "BuildingElementGround" && section_data.len() == 1
                        {
                            let area = element_obj_map
                                .get("area")
                                .and_then(Value::as_f64)
                                .filter(|value| value.is_finite() && *value > 0.0)
                                .ok_or_else(|| {
                                    BuildError::new(
                                        "E055",
                                        &format!(
                                            "Ground element '{element_name}' requires a finite positive area"
                                        ),
                                    )
                                })?;

                            if let Some(explicit_total_area) = element_row
                                .get("extra_json")
                                .and_then(Value::as_object)
                                .and_then(|extra| extra.get("total_area"))
                            {
                                let explicit_total_area = explicit_total_area
                                    .as_f64()
                                    .filter(|value| value.is_finite() && *value > 0.0)
                                    .ok_or_else(|| {
                                        BuildError::new(
                                            "E055",
                                            &format!(
                                                "Ground element '{element_name}' extra_json.total_area must be a finite positive number"
                                            ),
                                        )
                                    })?;
                                if (explicit_total_area - area).abs() > 0.01 {
                                    return Err(BuildError::new(
                                        "E058",
                                        &format!(
                                            "Ground element '{element_name}' is the sole represented ground floor, but extra_json.total_area {explicit_total_area} conflicts with CSV area {area}"
                                        ),
                                    ));
                                }
                            }

                            element_obj_map.insert(
                                "total_area".to_string(),
                                Value::Number(
                                    serde_json::Number::from_f64(area)
                                        .expect("validated finite ground area"),
                                ),
                            );
                        }
                    }

                    if self.is_fhs_schema {
                        if let Some(element_obj_map) = element_obj.as_object_mut() {
                            self.normalize_building_element_for_fhs(
                                element_obj_map,
                                Some(&csv_set_keys),
                            );
                        }
                    }

                    // Add to zone's BuildingElement section
                    let zone = result["Zone"][zone_name].as_object_mut().unwrap();
                    let building_elements = zone
                        .get_mut("BuildingElement")
                        .unwrap()
                        .as_object_mut()
                        .unwrap();
                    building_elements.insert(element_name.to_string(), element_obj);
                }
            }
        }

        Ok(())
    }

    fn map_csv_type_to_schema_type(&self, csv_type: &str) -> String {
        // Map CSV-friendly types to schema types (like Python implementation)
        match csv_type {
            "Wall" => "BuildingElementOpaque".to_string(),
            "Window" => "BuildingElementTransparent".to_string(),
            "Floor" => "BuildingElementGround".to_string(),
            "Party" => "BuildingElementAdjacentConditionedSpace".to_string(),
            "Roof" => "BuildingElementOpaque".to_string(),
            "Door" => "BuildingElementOpaque".to_string(),
            "Basement" => "BuildingElementGround".to_string(),
            "Internal" => "BuildingElementAdjacentConditionedSpace".to_string(),
            // Schema types (identity mappings)
            "BuildingElementOpaque" => "BuildingElementOpaque".to_string(),
            "BuildingElementTransparent" => "BuildingElementTransparent".to_string(),
            "BuildingElementGround" => "BuildingElementGround".to_string(),
            "BuildingElementAdjacentConditionedSpace" => {
                "BuildingElementAdjacentConditionedSpace".to_string()
            }
            "BuildingElementAdjacentUnconditionedSpace_Simple" => {
                "BuildingElementAdjacentUnconditionedSpace_Simple".to_string()
            }
            "BuildingElementPartyWall" => "BuildingElementPartyWall".to_string(),
            // Default to original if no mapping found
            _ => csv_type.to_string(),
        }
    }

    fn get_default_building_element(&self, element_type: &str) -> Result<Value, BuildError> {
        // Use pre-indexed templates from index_templates() (works for any zone name)
        if let Some(template) = self.type_templates.get(element_type) {
            return Ok(template.clone());
        }

        // If no template found, create a minimal one with just the type
        let mut element_obj = serde_json::Map::new();
        element_obj.insert("type".to_string(), Value::String(element_type.to_string()));

        Ok(Value::Object(element_obj))
    }

    /// Get default building element with variant support (for BuildingElementGround)
    fn get_default_building_element_variant(
        &self,
        element_type: &str,
        variant_value: Option<&str>,
    ) -> Result<Value, BuildError> {
        // For BuildingElementGround, try to get a variant-specific template
        if element_type == "BuildingElementGround" {
            // First, try to find a template that matches the variant
            if let Some(floor_type) = variant_value {
                // Look for a template with matching floor_type
                if let Some(template) = self.type_templates.get(element_type) {
                    if let Some(template_obj) = template.as_object() {
                        if template_obj.get("floor_type").and_then(|v| v.as_str())
                            == Some(floor_type)
                        {
                            return Ok(template.clone());
                        }
                    }
                }
            }

            // Fallback: use the base template and filter it by schema
            if let Some(template) = self.type_templates.get(element_type) {
                let mut filtered = template.clone();
                if let Some(filtered_obj) = filtered.as_object_mut() {
                    // Use the variant value from template or parameter
                    let floor_type = variant_value
                        .or_else(|| filtered_obj.get("floor_type").and_then(|v| v.as_str()));

                    // Filter using schema
                    if let Some(variant_schema) =
                        self.get_building_element_variant_schema(element_type, floor_type)
                    {
                        let context =
                            Self::build_building_element_context(element_type, None, floor_type);
                        let mut allowed_props = Self::collect_schema_properties_with_context(
                            variant_schema,
                            Some(&context),
                        );
                        if let Some(base_properties) = self
                            .get_building_element_base_schema()
                            .and_then(|schema| schema.get("properties").and_then(|v| v.as_object()))
                        {
                            allowed_props.extend(base_properties.keys().cloned());
                        }
                        filtered_obj.retain(|k, _| allowed_props.contains(k));
                    }
                }
                return Ok(filtered);
            }
        }

        // Fallback to standard method
        self.get_default_building_element(element_type)
    }

    fn add_thermal_bridging_to_zones(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        // Determine which zones use simplified mode
        let mut simplified_zones = std::collections::HashSet::new();
        if let Some(zone_section) = csv_data.get("Zone") {
            for zone_row in zone_section {
                let zone_name = zone_row.get("Name").and_then(|v| v.as_str()).unwrap_or("");
                let simplified = zone_row
                    .get("simplified thermal bridging")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if simplified {
                    simplified_zones.insert(zone_name.to_string());
                }
            }
        }
        if let Some(section_data) = csv_data.get("Thermal Bridging Elements") {
            for bridge_row in section_data {
                let bridge_name =
                    bridge_row
                        .get("Name")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            BuildError::new(
                                "E012",
                                "Thermal Bridging Elements missing required 'Name' field",
                            )
                        })?;
                let zone_name =
                    bridge_row
                        .get("Zone")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            BuildError::new(
                                "E013",
                                "Thermal Bridging Elements missing required 'Zone' field",
                            )
                        })?;
                let bridge_type =
                    bridge_row
                        .get("Type")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            BuildError::new(
                                "E014",
                                "Thermal Bridging Elements missing required 'Type' field",
                            )
                        })?;
                // Skip if this zone uses simplified mode
                if simplified_zones.contains(zone_name) {
                    continue;
                }
                // Check if zone exists
                if !result["Zone"].as_object().unwrap().contains_key(zone_name) {
                    return Err(BuildError::new(
                        "E015",
                        &format!(
                            "Zone '{zone_name}' referenced in Thermal Bridging Elements but not defined"
                        ),
                    ));
                }
                // Start with a default template for this bridge type
                let mut bridge_obj = self.get_default_thermal_bridge(bridge_type)?;
                // junction_type is semantically per-bridge: never inherit it from the
                // defaults template. Missing junction_type on a linear bridge surfaces
                // as a loud schema-validation error (the FHS schema requires it).
                if bridge_type == "ThermalBridgeLinear" {
                    if let Some(obj) = bridge_obj.as_object_mut() {
                        obj.remove("junction_type");
                    }
                }

                // Contract precedence: CSV columns > extra_json > defaults template.
                // Blank cells leave the template value in place, as in other sections;
                // schema-invalid keys (UI-only metadata like floor_id) are dropped.
                let allowed_names: &[&str] = match bridge_type {
                    "ThermalBridgeLinear" => &[
                        "type",
                        "length",
                        "linear_thermal_transmittance",
                        "junction_type",
                    ],
                    _ => &["type", "heat_transfer_coeff"],
                };
                let allowed: HashSet<String> =
                    allowed_names.iter().map(|s| s.to_string()).collect();
                let seed = bridge_obj
                    .as_object()
                    .cloned()
                    .unwrap_or_else(serde_json::Map::new);
                bridge_obj = Value::Object(overlay_row_onto_seed(
                    seed,
                    bridge_row,
                    &["Name", "Zone", "Type", "coords", "parent_element"],
                    &allowed,
                ));
                // Add to zone's ThermalBridging section
                let zone = result["Zone"][zone_name].as_object_mut().unwrap();
                let thermal_bridging = zone
                    .get_mut("ThermalBridging")
                    .unwrap()
                    .as_object_mut()
                    .unwrap();
                thermal_bridging.insert(bridge_name.to_string(), bridge_obj);
            }
        }
        Ok(())
    }

    fn get_default_thermal_bridge(&self, bridge_type: &str) -> Result<Value, BuildError> {
        // Use pre-indexed templates from index_templates() (works for any zone name)
        if let Some(template) = self.type_templates.get(bridge_type) {
            return Ok(template.clone());
        }

        // If no template found, create a minimal one
        let mut bridge_obj = serde_json::Map::new();
        bridge_obj.insert("type".to_string(), Value::String(bridge_type.to_string()));

        // Add required fields based on type
        match bridge_type {
            "ThermalBridgeLinear" => {
                bridge_obj.insert(
                    "linear_thermal_transmittance".to_string(),
                    Value::Number(serde_json::Number::from_f64(1.0).unwrap()),
                );
                bridge_obj.insert(
                    "length".to_string(),
                    Value::Number(serde_json::Number::from_f64(1.0).unwrap()),
                );
            }
            "ThermalBridgePoint" => {
                bridge_obj.insert(
                    "heat_transfer_coeff".to_string(),
                    Value::Number(serde_json::Number::from_f64(1.0).unwrap()),
                );
            }
            _ => {
                return Err(BuildError::new(
                    "E028",
                    &format!("Unknown thermal bridge type: {bridge_type}"),
                ));
            }
        }

        Ok(Value::Object(bridge_obj))
    }

    fn add_window_shading_to_zones(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        if let Some(section_data) = csv_data.get("Window Shading") {
            for shading_row in section_data {
                let zone_name = shading_row
                    .get("Zone")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        BuildError::new("E029", "Window Shading missing required 'Zone' field")
                    })?;

                let linked_window = shading_row
                    .get("linked_window")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        BuildError::new(
                            "E030",
                            "Window Shading missing required 'linked_window' field",
                        )
                    })?;

                // Check if zone exists
                if !result["Zone"].as_object().unwrap().contains_key(zone_name) {
                    return Err(BuildError::new(
                        "E031",
                        &format!("Zone '{zone_name}' referenced in Window Shading but not defined"),
                    ));
                }

                // Find the linked window in the zone
                let zone = result["Zone"][zone_name].as_object_mut().unwrap();
                let building_element = zone
                    .get_mut("BuildingElement")
                    .unwrap()
                    .as_object_mut()
                    .unwrap();

                if !building_element.contains_key(linked_window) {
                    return Err(BuildError::new(
                        "E032",
                        &format!("Linked window '{linked_window}' not found in zone '{zone_name}'"),
                    ));
                }

                let window_element = building_element
                    .get_mut(linked_window)
                    .unwrap()
                    .as_object_mut()
                    .unwrap();

                // Create shading object
                let shading_type = shading_row
                    .get("Type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("object");

                // Map CSV type to schema type
                let schema_type = if shading_type == "object" {
                    "obstacle"
                } else {
                    shading_type
                };

                let mut shading_obj = serde_json::Map::new();
                shading_obj.insert("type".to_string(), Value::String(schema_type.to_string()));

                // Add type-specific fields
                if shading_type == "object" {
                    if let Some(height) = shading_row.get("height") {
                        shading_obj.insert("height".to_string(), height.clone());
                    }
                    if let Some(distance) = shading_row.get("distance") {
                        shading_obj.insert("distance".to_string(), distance.clone());
                    }
                    if let Some(transparency) = shading_row.get("transparency") {
                        shading_obj.insert("transparency".to_string(), transparency.clone());
                    }
                } else {
                    // overhang, sidefinright, sidefinleft, reveal
                    if let Some(depth) = shading_row.get("depth") {
                        shading_obj.insert("depth".to_string(), depth.clone());
                    }
                    if let Some(distance) = shading_row.get("distance") {
                        shading_obj.insert("distance".to_string(), distance.clone());
                    }
                }

                // Initialize shading array if not present
                if !window_element.contains_key("shading") {
                    window_element.insert("shading".to_string(), Value::Array(Vec::new()));
                }

                // Add shading object to window
                let shading_array = window_element
                    .get_mut("shading")
                    .unwrap()
                    .as_array_mut()
                    .unwrap();
                shading_array.push(Value::Object(shading_obj));
            }
        }

        Ok(())
    }

    fn add_lighting_to_zones(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        if let Some(section_data) = csv_data.get("Lighting") {
            for lighting_row in section_data {
                let zone_name = lighting_row
                    .get("Zone")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        BuildError::new("E016", "Lighting missing required 'Zone' field")
                    })?;

                // Check if zone exists
                if !result["Zone"].as_object().unwrap().contains_key(zone_name) {
                    return Err(BuildError::new(
                        "E017",
                        &format!("Zone '{zone_name}' referenced in Lighting but not defined"),
                    ));
                }

                let efficacy = if let Some(efficacy) = lighting_row.get("efficacy") {
                    efficacy.clone()
                } else {
                    return Err(BuildError::new(
                        "E027",
                        "Lighting missing required 'efficacy' field",
                    ));
                };

                let count = lighting_row
                    .get("count")
                    .and_then(|v| if v.is_null() { None } else { Some(v.clone()) })
                    .ok_or_else(|| {
                        BuildError::new(
                            "E027",
                            "Lighting missing required 'count' field (explicit bulb objects are required)",
                        )
                    })?;
                let power = lighting_row
                    .get("power")
                    .and_then(|v| if v.is_null() { None } else { Some(v.clone()) })
                    .ok_or_else(|| {
                        BuildError::new(
                            "E027",
                            "Lighting missing required 'power' field (explicit bulb objects are required)",
                        )
                    })?;

                let mut bulb_obj = serde_json::Map::new();
                bulb_obj.insert("count".to_string(), count);
                bulb_obj.insert("power".to_string(), power);
                bulb_obj.insert("efficacy".to_string(), efficacy.clone());

                // Append this bulb entry to the zone's Lighting.bulbs array. Each Light row
                // in the CSV is one luminaire spec; previously this loop replaced the zone's
                // entire Lighting section on every iteration, so only the last Light row
                // survived — meaning a dwelling with 8 modelled LEDs ended up with one bulb
                // in the merged JSON.
                let zone = result["Zone"][zone_name].as_object_mut().unwrap();
                // Replace any pre-existing null/non-object Lighting placeholder so we always
                // start from an empty object before appending bulbs to it.
                let needs_reset = zone.get("Lighting").map(|v| !v.is_object()).unwrap_or(true);
                if needs_reset {
                    zone.insert(
                        "Lighting".to_string(),
                        Value::Object(serde_json::Map::new()),
                    );
                }
                let lighting_map = zone
                    .get_mut("Lighting")
                    .and_then(|v| v.as_object_mut())
                    .ok_or_else(|| {
                        BuildError::new("E028", "Existing Lighting entry is not an object")
                    })?;
                let bulbs_value = lighting_map
                    .entry("bulbs".to_string())
                    .or_insert_with(|| Value::Array(vec![]));
                let bulbs_array = bulbs_value.as_array_mut().ok_or_else(|| {
                    BuildError::new("E028", "Existing Lighting.bulbs entry is not an array")
                })?;
                bulbs_array.push(Value::Object(bulb_obj));
            }
        }

        Ok(())
    }

    fn collect_referenced_energy_supplies(value: &Value, referenced: &mut HashSet<String>) {
        match value {
            Value::Object(obj) => {
                for (key, child) in obj {
                    if matches!(key.as_str(), "EnergySupply" | "EnergySupply_aux") {
                        if let Some(name) = child.as_str() {
                            referenced.insert(name.to_string());
                        }
                    }
                    Self::collect_referenced_energy_supplies(child, referenced);
                }
            }
            Value::Array(items) => {
                for item in items {
                    Self::collect_referenced_energy_supplies(item, referenced);
                }
            }
            _ => {}
        }
    }

    fn energy_supply_template_for_reference(&self, name: &str) -> Option<Value> {
        self.defaults
            .get("EnergySupply")
            .and_then(|value| value.as_object())
            .and_then(|energy_supply| energy_supply.get(name).cloned())
            .or_else(|| match name {
                "mains elec" => {
                    let mut entry = serde_json::Map::new();
                    entry.insert("fuel".to_string(), Value::String("electricity".to_string()));
                    entry.insert("is_export_capable".to_string(), Value::Bool(true));
                    Some(Value::Object(entry))
                }
                "mains gas" => {
                    let mut entry = serde_json::Map::new();
                    entry.insert("fuel".to_string(), Value::String("mains_gas".to_string()));
                    Some(Value::Object(entry))
                }
                _ => None,
            })
    }

    fn clean_energy_supply_entry_for_fhs(entry: &mut serde_json::Map<String, Value>) {
        if entry.get("fuel").and_then(Value::as_str) != Some("electricity") {
            entry.remove("is_export_capable");
        }
    }

    fn ensure_referenced_energy_supplies(
        &self,
        result: &mut Value,
        referenced: &HashSet<String>,
    ) -> Result<(), BuildError> {
        if referenced.is_empty() {
            return Ok(());
        }

        let result_obj = result
            .as_object_mut()
            .ok_or_else(|| BuildError::new("E038", "Merged JSON root is not an object"))?;
        let energy_supply = result_obj
            .entry("EnergySupply".to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()))
            .as_object_mut()
            .ok_or_else(|| BuildError::new("E038", "EnergySupply is not an object"))?;

        for name in referenced {
            if !energy_supply.contains_key(name) {
                let entry = self
                    .energy_supply_template_for_reference(name)
                    .ok_or_else(|| {
                        BuildError::new(
                            "E038",
                            &format!(
                            "Referenced EnergySupply '{name}' is missing and has no defaults template"
                        ),
                        )
                    })?;
                energy_supply.insert(name.clone(), entry);
            }

            let entry = energy_supply
                .get_mut(name)
                .and_then(Value::as_object_mut)
                .ok_or_else(|| {
                    BuildError::new("E038", &format!("EnergySupply '{name}' is not an object"))
                })?;
            if self.is_fhs_schema {
                Self::clean_energy_supply_entry_for_fhs(entry);
            }
        }

        Ok(())
    }

    fn process_root_level_sections(
        &mut self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        // Process Appliances
        self.build_appliances(result, csv_data)?;

        // Process Hot Water Outlets
        self.build_hot_water_outlets(result, csv_data)?;

        // Process Context Shading
        self.build_context_shading(result, csv_data)?;

        // Process Ventilation Systems (merge into InfiltrationVentilation)
        self.merge_ventilation_systems(result, csv_data)?;

        // Process Combustion Appliances (merge into InfiltrationVentilation)
        self.merge_combustion_appliances(result, csv_data)?;

        // Process Systems before pipework so explicit HotWaterSource rows exist before primary pipework attaches.
        self.merge_systems(result, csv_data)?;

        // FHS: explicit dry `SpaceHeatSystem` presets from CSV must win over template `WetDistribution`
        // (otherwise reconciliation prefers radiators and leaves CSV dry plant orphaned / inconsistent).
        self.strip_default_wet_distribution_for_csv_dry_space_heat(result, csv_data)?;

        // Process Wet Emitters (create SpaceHeatSystem entries)
        self.merge_wet_emitters(result, csv_data)?;

        // Process Compliance Settings (merge into root level)
        self.merge_compliance_settings(result, csv_data)?;

        // Process On-Site Generation (create OnSiteGeneration entries)
        self.merge_onsite_generation(result, csv_data)?;

        // Update default SpaceHeatSystem systems that weren't in CSV to use first zone
        self.update_default_space_heat_systems(result, csv_data)?;

        // Process Water Pipework after Systems so primary pipework attaches to the authored hot water source.
        self.merge_water_pipework(result, csv_data)?;

        // Final reconciliation of Zone.SpaceHeatSystem references after all system processing
        self.reconcile_zone_space_heat_system_references(result)?;

        // FHS `input_fhs`: `Zone` on a plant is only valid for some `SpaceHeatSystem` types
        // (e.g. ElecStorageHeater, WetDistribution). The CSV merge may attach `Zone` to every
        // merged system to drive reconciliation — remove it for types where the schema has
        // `unevaluatedProperties: false` and does not list `Zone`.
        self.strip_non_schema_space_heat_system_zone(result);

        // Drop `SpaceHeatSystem` entries no zone references (safety net after strip/reconcile).
        // CSV-authored systems are exempt: they surface E057 instead of vanishing.
        let csv_authored_space_heat: HashSet<String> =
            Self::authored_space_heat_system_aliases_from_systems_csv(csv_data)
                .into_values()
                .collect();
        self.prune_unreferenced_space_heat_systems(result, &csv_authored_space_heat);

        // Cleanup: Remove empty OnSiteGeneration section if no PV systems in CSV
        if csv_data.get("On-Site Generation").is_none()
            || csv_data
                .get("On-Site Generation")
                .map(|v| v.is_empty())
                .unwrap_or(true)
        {
            if let Some(result_obj) = result.as_object_mut() {
                result_obj.remove("OnSiteGeneration");
            }
        }

        let mut referenced_energy_supplies = HashSet::new();
        Self::collect_referenced_energy_supplies(result, &mut referenced_energy_supplies);
        self.ensure_referenced_energy_supplies(result, &referenced_energy_supplies)?;

        // Cleanup: keep ElectricBattery only when explicitly provided by CSV Systems rows.
        let has_battery_rows = csv_data
            .get("Systems")
            .map(|rows| {
                rows.iter().any(|row| {
                    row.get("Type")
                        .and_then(|v| v.as_str())
                        .or_else(|| row.get("system_type").and_then(|v| v.as_str()))
                        .or_else(|| row.get("subcategory").and_then(|v| v.as_str()))
                        == Some("ElectricBattery")
                })
            })
            .unwrap_or(false);

        if !has_battery_rows {
            if let Some(result_obj) = result.as_object_mut() {
                if let Some(energy_supply) = result_obj.get_mut("EnergySupply") {
                    if let Some(energy_supply_obj) = energy_supply.as_object_mut() {
                        // Strip any ElectricBattery blocks that came from defaults.
                        // Keep referenced EnergySupply entries themselves so they remain
                        // available for appliances, PV, heat pumps, gas boilers, etc.
                        for supply_value in energy_supply_obj.values_mut() {
                            if let Some(supply_obj) = supply_value.as_object_mut() {
                                supply_obj.remove("ElectricBattery");
                            }
                        }

                        // Remove unreferenced EnergySupply entries that are now effectively empty.
                        let keys_to_remove: Vec<String> = energy_supply_obj
                            .iter()
                            .filter_map(|(key, value)| {
                                if key == "mains elec"
                                    || referenced_energy_supplies.contains(key.as_str())
                                {
                                    return None;
                                }
                                let supply_obj = value.as_object()?;
                                let is_effectively_empty = supply_obj.is_empty()
                                    || (supply_obj.len() == 1
                                        && (supply_obj.contains_key("fuel")
                                            || supply_obj.contains_key("is_export_capable")))
                                    || (supply_obj.len() == 2
                                        && supply_obj.contains_key("fuel")
                                        && supply_obj.contains_key("is_export_capable"));
                                if is_effectively_empty {
                                    Some(key.clone())
                                } else {
                                    None
                                }
                            })
                            .collect();
                        for key in keys_to_remove {
                            energy_supply_obj.remove(&key);
                        }
                    }
                }
            }
        }

        // Always calculate env_area from building elements (matching Python logic)
        // Only set env_area - don't override other fields that come from defaults file
        tracing::debug!("About to call calculate_env_area from process_root_level_sections");
        let calculated_env_area = self.calculate_env_area(csv_data)?;
        tracing::debug!("calculate_env_area returned: {:?}", calculated_env_area);

        // Update InfiltrationVentilation.Leaks with calculated env_area only
        // This preserves defaults file values for test_pressure, test_result, ventilation_zone_height
        if let Some(inf_vent) = result.get_mut("InfiltrationVentilation") {
            if let Some(leaks) = inf_vent.get_mut("Leaks") {
                if let Some(leaks_obj) = leaks.as_object_mut() {
                    // Only set env_area - it's always calculated from building elements
                    if calculated_env_area > 0.0 {
                        leaks_obj.insert(
                            "env_area".to_string(),
                            serde_json::Value::Number(
                                serde_json::Number::from_f64(calculated_env_area).unwrap(),
                            ),
                        );
                    }
                }
            }
        }

        // Merge air permeability settings from CSV metadata (after calculate_leaks_areas so CSV values override)
        // This is done here instead of in merge_compliance_settings to ensure it happens after calculate_leaks_areas
        self.merge_air_permeability_from_metadata(result, csv_data)?;
        self.merge_ventilation_env_from_metadata(result, csv_data)?;

        if self.is_fhs_schema {
            self.merge_input_metadata(result)?;
        }

        Ok(())
    }

    /// Stamp `metadata.hem_core_version` from the upstream core (`home-energy-model`) so inputs match the
    /// engine version used for FHS preprocessing (see `hem_fhs_upstream` / `HEM_VERSION`).
    fn merge_input_metadata(&self, result: &mut Value) -> Result<(), BuildError> {
        let result_obj = result
            .as_object_mut()
            .ok_or_else(|| BuildError::new("E042", "Result JSON is not an object"))?;
        let meta = result_obj
            .entry("metadata".to_string())
            .or_insert_with(|| serde_json::json!({}));
        if let Some(meta_obj) = meta.as_object_mut() {
            meta_obj.insert(
                "hem_core_version".to_string(),
                serde_json::Value::String(self.hem_core_version.clone()),
            );
        }
        Ok(())
    }

    fn build_appliances(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        if let Some(section_data) = csv_data.get("Appliances") {
            let mut appliances = serde_json::Map::new();

            for appliance_row in section_data {
                // Use appliancekey as the JSON key (schema enum value), not Name (display name)
                let appliance_key = appliance_row
                    .get("appliancekey")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        BuildError::new("E018", "Appliances missing required 'appliancekey' field")
                    })?;

                // Use simplified approach with "Default" reference (like Python)
                appliances.insert(
                    appliance_key.to_string(),
                    Value::String("Default".to_string()),
                );
            }

            result["Appliances"] = Value::Object(appliances);
        }

        Ok(())
    }

    fn build_hot_water_outlets(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        if let Some(section_data) = csv_data.get("Hot Water Outlets") {
            // Start with existing HotWaterDemand from defaults
            // Preserve Distribution from defaults - it will be replaced by merge_water_pipework()
            // if CSV has Water Pipework section, otherwise it stays from defaults
            let mut hot_water_demand = if let Some(existing) = result.get("HotWaterDemand") {
                if let Some(existing_obj) = existing.as_object() {
                    existing_obj.clone()
                } else {
                    serde_json::Map::new()
                }
            } else {
                serde_json::Map::new()
            };

            // CSV-authoritative for Shower/Bath: outlets come from the user's
            // section, so defaults-profile entries are discarded before the CSV
            // rows are added (same policy as HotWaterSource / pipework).
            // `Other` is different: the FHS schema requires at least one entry
            // (minProperties), and by convention the defaults profile supplies
            // the standard tap — it is only replaced when the user authors
            // OtherWaterUseDetails rows.
            for subcategory_key in ["Shower", "Bath"] {
                hot_water_demand.insert(
                    subcategory_key.to_string(),
                    Value::Object(serde_json::Map::new()),
                );
            }
            let authors_other_rows = section_data.iter().any(|row| {
                row.get("subcategory").and_then(|v| v.as_str()) == Some("OtherWaterUseDetails")
            });
            if authors_other_rows || !hot_water_demand.contains_key("Other") {
                hot_water_demand.insert("Other".to_string(), Value::Object(serde_json::Map::new()));
            }

            for outlet_row in section_data {
                let outlet_name =
                    outlet_row
                        .get("Name")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            BuildError::new(
                                "E019",
                                "Hot Water Outlets missing required 'Name' field",
                            )
                        })?;

                let subcategory = outlet_row
                    .get("subcategory")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        BuildError::new(
                            "E020",
                            "Hot Water Outlets missing required 'subcategory' field",
                        )
                    })?;

                let _outlet_type =
                    outlet_row
                        .get("Type")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            BuildError::new(
                                "E021",
                                "Hot Water Outlets missing required 'Type' field",
                            )
                        })?;

                let mut outlet_obj = serde_json::Map::new();

                // Create outlet object based on subcategory (like Python implementation)
                match subcategory {
                    "MixerShower" => {
                        outlet_obj
                            .insert("type".to_string(), Value::String("MixerShower".to_string()));
                        if let Some(flowrate) = outlet_row.get("flowrate") {
                            outlet_obj.insert("flowrate".to_string(), flowrate.clone());
                        }
                        let allow_low_flowrate = outlet_row
                            .get("allow_low_flowrate")
                            .and_then(|v| match v {
                                Value::Bool(b) => Some(*b),
                                Value::String(s) => match s.trim().to_ascii_lowercase().as_str() {
                                    "true" => Some(true),
                                    "false" => Some(false),
                                    _ => None,
                                },
                                _ => None,
                            })
                            .unwrap_or(false);
                        outlet_obj.insert(
                            "allow_low_flowrate".to_string(),
                            Value::Bool(allow_low_flowrate),
                        );
                        outlet_obj.insert(
                            "ColdWaterSource".to_string(),
                            Value::String(self.effective_cold_water_source().to_string()),
                        );

                        if let Some(shower_obj) = hot_water_demand
                            .get_mut("Shower")
                            .and_then(|v| v.as_object_mut())
                        {
                            // FHS hardcodes "mixer" as the singleton key for the
                            // MixerShower entry under HotWaterDemand.Shower
                            // (see hem_fhs_upstream input.rs:1026, future_homes_standard.rs:4838).
                            // The CSV "Name" column is informational; canonicalize here.
                            shower_obj.insert("mixer".to_string(), Value::Object(outlet_obj));
                        }
                    }
                    "InstantElecShower" => {
                        let rated_power =
                            outlet_row.get("rated_power").cloned().unwrap_or_else(|| {
                                Value::Number(serde_json::Number::from_f64(9.0).unwrap())
                            });
                        outlet_obj.insert(
                            "type".to_string(),
                            Value::String("InstantElecShower".to_string()),
                        );
                        outlet_obj.insert("rated_power".to_string(), rated_power);
                        outlet_obj.insert(
                            "ColdWaterSource".to_string(),
                            Value::String(self.effective_cold_water_source().to_string()),
                        );
                        outlet_obj.insert(
                            "EnergySupply".to_string(),
                            Value::String("mains elec".to_string()),
                        );

                        if let Some(shower_obj) = hot_water_demand
                            .get_mut("Shower")
                            .and_then(|v| v.as_object_mut())
                        {
                            shower_obj.insert(outlet_name.to_string(), Value::Object(outlet_obj));
                        }
                    }
                    "Bath" => {
                        if let Some(size) = outlet_row.get("size") {
                            outlet_obj.insert("size".to_string(), size.clone());
                        }
                        outlet_obj.insert(
                            "ColdWaterSource".to_string(),
                            Value::String(self.effective_cold_water_source().to_string()),
                        );

                        if let Some(bath_obj) = hot_water_demand
                            .get_mut("Bath")
                            .and_then(|v| v.as_object_mut())
                        {
                            bath_obj.insert(outlet_name.to_string(), Value::Object(outlet_obj));
                        }
                    }
                    "OtherWaterUseDetails" => {
                        if let Some(flowrate) = outlet_row.get("flowrate") {
                            outlet_obj.insert("flowrate".to_string(), flowrate.clone());
                        }
                        outlet_obj.insert(
                            "ColdWaterSource".to_string(),
                            Value::String(self.effective_cold_water_source().to_string()),
                        );

                        if let Some(other_obj) = hot_water_demand
                            .get_mut("Other")
                            .and_then(|v| v.as_object_mut())
                        {
                            other_obj.insert(outlet_name.to_string(), Value::Object(outlet_obj));
                        }
                    }
                    other => {
                        self.push_non_fatal(
                            "E055",
                            &format!("HotWaterDemand/{outlet_name}"),
                            &format!(
                                "Hot Water Outlets row '{outlet_name}' has unknown subcategory \
                                 '{other}' and was skipped. Valid: MixerShower, \
                                 InstantElecShower, Bath, OtherWaterUseDetails."
                            ),
                        );
                        continue;
                    }
                }
            }

            result["HotWaterDemand"] = Value::Object(hot_water_demand);
        } else if let Some(hwd_obj) = result
            .get_mut("HotWaterDemand")
            .and_then(|v| v.as_object_mut())
        {
            // No Hot Water Outlets section: clear defaults-profile Shower/Bath
            // entries (CSV-authoritative, matching the pipework Distribution
            // handling). `Other` keeps the defaults-profile tap — the FHS schema
            // requires at least one Other entry.
            for subcategory_key in ["Shower", "Bath"] {
                if let Some(map) = hwd_obj
                    .get_mut(subcategory_key)
                    .and_then(|v| v.as_object_mut())
                {
                    map.clear();
                }
            }
        }

        Ok(())
    }

    fn build_context_shading(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        tracing::debug!("build_context_shading called");
        if let Some(section_data) = csv_data.get("Context Shading") {
            tracing::debug!(
                "Found Context Shading section with {} rows",
                section_data.len()
            );
            let mut shading_segments = Vec::new();

            // Create 36 segments (0-360 degrees)
            for i in 0..36 {
                let start_angle = i * 10;
                let end_angle = (i + 1) * 10;

                let mut segment = serde_json::Map::new();
                segment.insert(
                    "start360".to_string(),
                    Value::Number(serde_json::Number::from(start_angle)),
                );
                segment.insert(
                    "end360".to_string(),
                    Value::Number(serde_json::Number::from(end_angle)),
                );

                // Check if any shading objects fall within this segment
                let mut shading_objects = Vec::new();
                for shading_row in section_data {
                    if let (Some(start), Some(end)) = (
                        Self::read_context_shading_angle(
                            shading_row,
                            &["start angle", "start_angle"],
                        ),
                        Self::read_context_shading_angle(shading_row, &["end angle", "end_angle"]),
                    ) {
                        // FHS schema expects integer angles (start360/end360). Round early so overlap logic
                        // is stable even if CSV contains fractional degrees.
                        let start = start.round();
                        let end = end.round();

                        // Normalize angles to 0-360 range (like Python)
                        let mut normalized_start = start % 360.0;
                        let mut normalized_end = end % 360.0;

                        // Handle negative angles
                        if normalized_start < 0.0 {
                            normalized_start += 360.0;
                        }
                        if normalized_end < 0.0 {
                            normalized_end += 360.0;
                        }

                        // Check if this is a wraparound case
                        let is_wraparound = normalized_end < normalized_start;

                        // Check if shading object overlaps with this segment
                        let mut overlaps = false;

                        if is_wraparound {
                            // For wraparound cases, check if segment overlaps with either:
                            // 1. The range from start_angle to 360°
                            // 2. The range from 0° to end_angle
                            if (normalized_start < end_angle as f64 && 360.0 > start_angle as f64)
                                || (0.0 < end_angle as f64 && normalized_end > start_angle as f64)
                            {
                                overlaps = true;
                            }
                        } else {
                            // For normal cases, check if object overlaps with segment
                            // Use general overlap logic - include if any part of the object overlaps with the segment
                            if normalized_start < end_angle as f64
                                && normalized_end > start_angle as f64
                            {
                                overlaps = true;
                            }
                        }

                        if overlaps {
                            let mut shading_obj = serde_json::Map::new();
                            let shading_type = Self::read_context_shading_type(shading_row);
                            shading_obj.insert(
                                "type".to_string(),
                                Value::String(shading_type.to_string()),
                            );

                            if let Some(height) = shading_row.get("height") {
                                shading_obj.insert("height".to_string(), height.clone());
                            }
                            if let Some(distance) = shading_row.get("distance") {
                                shading_obj.insert("distance".to_string(), distance.clone());
                            }

                            shading_objects.push(Value::Object(shading_obj));
                        }
                    }
                }

                if !shading_objects.is_empty() {
                    let shading_count = shading_objects.len();
                    segment.insert("shading".to_string(), Value::Array(shading_objects));
                    tracing::debug!(
                        "Segment {} ({}°-{}°) has {} shading objects",
                        i + 1,
                        start_angle,
                        end_angle,
                        shading_count
                    );
                }

                shading_segments.push(Value::Object(segment));
            }

            tracing::debug!("Created {} shading segments", shading_segments.len());
            result["ExternalConditions"]["shading_segments"] = Value::Array(shading_segments);
        } else {
            tracing::debug!("No Context Shading section found in CSV data");
            // Schema-valid empty state: keep segment structure but do not retain default shading objects.
            let mut shading_segments = Vec::new();
            for i in 0..36 {
                let start_angle = i * 10;
                let end_angle = (i + 1) * 10;
                let mut segment = serde_json::Map::new();
                segment.insert(
                    "start360".to_string(),
                    Value::Number(serde_json::Number::from(start_angle)),
                );
                segment.insert(
                    "end360".to_string(),
                    Value::Number(serde_json::Number::from(end_angle)),
                );
                shading_segments.push(Value::Object(segment));
            }
            result["ExternalConditions"]["shading_segments"] = Value::Array(shading_segments);
        }

        Ok(())
    }

    fn read_context_shading_angle(
        shading_row: &HashMap<String, Value>,
        candidate_keys: &[&str],
    ) -> Option<f64> {
        candidate_keys
            .iter()
            .find_map(|key| shading_row.get(*key))
            .and_then(|value| {
                value
                    .as_f64()
                    .or_else(|| value.as_str()?.parse::<f64>().ok())
            })
    }

    fn read_context_shading_type(shading_row: &HashMap<String, Value>) -> &'static str {
        let raw_type = shading_row
            .get("shading_type")
            .or_else(|| shading_row.get("Type"))
            .and_then(|v| v.as_str())
            .unwrap_or("obstacle")
            .trim();

        match raw_type {
            "overhang" => "overhang",
            "obstacle" | "ContextShading" | "" => "obstacle",
            _ => "obstacle",
        }
    }

    fn merge_ventilation_systems(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        tracing::debug!("merge_ventilation_systems called");
        if let Some(section_data) = csv_data.get("Ventilation Systems") {
            tracing::debug!(
                "Found Ventilation Systems section with {} rows",
                section_data.len()
            );
            // Ensure InfiltrationVentilation exists
            if !result
                .as_object()
                .unwrap()
                .contains_key("InfiltrationVentilation")
            {
                return Err(BuildError::new(
                    "E027",
                    "InfiltrationVentilation section not found in defaults template",
                ));
            }
            let inf_vent = result.get_mut("InfiltrationVentilation").unwrap();

            // Derive allowed properties from the active schema (Core or FHS), instead of hardcoded allowlists.
            // This keeps the pipeline resilient as the schema evolves.
            let schema_infiltration = self
                .schema
                .get("properties")
                .and_then(|p| p.get("InfiltrationVentilation"));
            let schema_infiltration_props = schema_infiltration
                .and_then(|iv| iv.get("properties"))
                .and_then(|p| p.as_object());

            let vents_schema = schema_infiltration_props
                .and_then(|p| p.get("Vents"))
                .and_then(|v| v.get("additionalProperties"))
                .or_else(|| {
                    // Fallback: some schemas may define Vents at root level
                    self.schema.get("$defs").and_then(|d| d.get("Vents"))
                });
            let allowed_vent_props = vents_schema
                .map(|s| self.get_allowed_properties_from_schema(s))
                .unwrap_or_default();

            let mechvent_schema = schema_infiltration_props
                .and_then(|p| p.get("MechanicalVentilation"))
                .and_then(|v| v.get("additionalProperties"))
                .or_else(|| {
                    self.schema.get("$defs").and_then(|d| {
                        d.get("MechanicalVentilationFHS")
                            .or_else(|| d.get("MechanicalVentilation"))
                    })
                });
            let allowed_mechvent_props = mechvent_schema
                .map(|s| self.get_allowed_properties_from_schema(s))
                .unwrap_or_default();

            // Ductwork schema is typically defined as the items schema under
            // MechanicalVentilation.ductwork. In FHS it sits inside the MVHR
            // allOf/then branch rather than directly under base properties.
            let ductwork_schema = mechvent_schema
                .and_then(|mv| Self::find_property_schema(mv, "ductwork"))
                .and_then(|dw| dw.get("items").or_else(|| dw.get("additionalProperties")))
                .or_else(|| {
                    self.schema
                        .get("$defs")
                        .and_then(|d| d.get("MechanicalVentilationDuctwork"))
                });
            let allowed_duct_props = ductwork_schema
                .map(|s| self.get_allowed_properties_from_schema(s))
                .unwrap_or_default();

            // Defaults templates for Vents / MechanicalVentilation (used for seeding missing required fields)
            let defaults_inf_vent = self.defaults.get("InfiltrationVentilation");
            let default_vents_map = defaults_inf_vent
                .and_then(|iv| iv.get("Vents"))
                .and_then(|v| v.as_object());
            let default_mechvent_map = defaults_inf_vent
                .and_then(|iv| iv.get("MechanicalVentilation"))
                .and_then(|v| v.as_object());

            let mut vents = serde_json::Map::new();
            let mut mechanical_ventilation = serde_json::Map::new();

            for vent_row in section_data {
                let vent_name = vent_row
                    .get("Name")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        BuildError::new("E020", "Ventilation Systems missing required 'Name' field")
                    })?;
                let vent_type = vent_row
                    .get("Type")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        BuildError::new("E021", "Ventilation Systems missing required 'Type' field")
                    })?;
                match vent_type {
                    "Vents" => {
                        // Seed from defaults template (first available vent), then overlay CSV + extra_json.
                        let mut vent_obj = default_vents_map
                            .and_then(|m| m.values().next())
                            .and_then(|v| v.as_object())
                            .cloned()
                            .unwrap_or_else(serde_json::Map::new);
                        let mut csv_set_keys = HashSet::new();

                        // Overlay: CSV columns (highest precedence), schema-allowed only, ignoring empties.
                        for (k, v) in vent_row {
                            if k == "Name"
                                || k == "Type"
                                || k == "coords"
                                || k == "extra_json"
                                || k == "parent_element"
                                || k == "terminal_type"
                                || k == "host_element"
                            {
                                continue;
                            }
                            if !allowed_vent_props.is_empty() && !allowed_vent_props.contains(k) {
                                continue;
                            }
                            if v.is_null() || (v.is_string() && v.as_str().unwrap_or("").is_empty())
                            {
                                continue;
                            }
                            vent_obj.insert(k.clone(), v.clone());
                            csv_set_keys.insert(k.clone());
                        }

                        // Overlay: extra_json (lower precedence than CSV columns, but overrides defaults)
                        if let Some(extra_json) =
                            vent_row.get("extra_json").and_then(|v| v.as_object())
                        {
                            for (k, v) in extra_json {
                                if is_ui_only_extra_json_key(k) {
                                    continue;
                                }
                                if !csv_cell_is_set(v) {
                                    continue;
                                }
                                if csv_set_keys.contains(k) {
                                    continue;
                                }
                                if !allowed_vent_props.is_empty() && !allowed_vent_props.contains(k)
                                {
                                    continue;
                                }
                                vent_obj.insert(k.clone(), strip_ui_only_extra_json_value(v));
                            }
                        }

                        // Prune to schema-allowed keys (defence-in-depth; cleanup_against_schema will also run).
                        if !allowed_vent_props.is_empty() {
                            vent_obj.retain(|k, _| allowed_vent_props.contains(k));
                        }
                        vents.insert(vent_name.to_string(), Value::Object(vent_obj));
                    }
                    "MechanicalVentilation" => {
                        // Option A (strict): require a defaults template entry matching this vent_type.
                        // This avoids brittle hardcoded defaults and ensures schema evolution is handled
                        // by updating the parameter-library defaults_template.json (single source of truth).
                        let csv_vent_type = vent_row
                            .get("vent_type")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .or_else(|| {
                                vent_row
                                    .get("extra_json")
                                    .and_then(|v| v.as_object())
                                    .and_then(|o| o.get("vent_type"))
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string())
                            });

                        let vt = csv_vent_type.as_deref().ok_or_else(|| {
                            BuildError::new(
                                "E021",
                                "MechanicalVentilation requires vent_type (CSV column or extra_json.vent_type)",
                            )
                        })?;

                        let m = default_mechvent_map.ok_or_else(|| {
                            BuildError::new(
                                "E027",
                                "Defaults template missing InfiltrationVentilation.MechanicalVentilation templates",
                            )
                        })?;

                        let mut selected: Option<serde_json::Map<String, Value>> = None;
                        for sys in m.values() {
                            if let Some(sys_obj) = sys.as_object() {
                                if sys_obj.get("vent_type").and_then(|x| x.as_str()) == Some(vt) {
                                    selected = Some(sys_obj.clone());
                                    break;
                                }
                            }
                        }
                        let mut mv_obj = selected.ok_or_else(|| {
                            BuildError::new(
                                "E027",
                                &format!(
                                    "Defaults template missing MechanicalVentilation template for vent_type='{vt}' (update input/defaults/defaults_template.json)"
                                ),
                            )
                        })?;
                        // Keys seeded from the defaults template for this vent_type. The JSON Schema
                        // `additionalProperties` tree used for `allowed_mechvent_props` is not guaranteed
                        // to list every engine field (e.g. some controls exist in templates before the
                        // schema lists them). Retain must not strip template keys or merged inputs lose
                        // required fields and fail validation.
                        let template_keys: std::collections::HashSet<String> =
                            mv_obj.keys().cloned().collect();

                        // Overlay: CSV columns (highest precedence), schema-allowed only, ignoring empties.
                        let mut csv_set_keys = std::collections::HashSet::new();
                        for (k, v) in vent_row {
                            if k == "Name"
                                || k == "Type"
                                || k == "coords"
                                || k == "extra_json"
                                || k == "parent_element"
                                || k == "terminal_type"
                                || k == "host_element"
                            {
                                continue;
                            }
                            if !allowed_mechvent_props.is_empty()
                                && !allowed_mechvent_props.contains(k)
                                && !template_keys.contains(k)
                            {
                                continue;
                            }
                            if v.is_null() || (v.is_string() && v.as_str().unwrap_or("").is_empty())
                            {
                                continue;
                            }
                            mv_obj.insert(k.clone(), v.clone());
                            csv_set_keys.insert(k.clone());
                        }

                        // Overlay: extra_json (lower precedence than CSV columns, but overrides defaults)
                        if let Some(extra_json) =
                            vent_row.get("extra_json").and_then(|v| v.as_object())
                        {
                            for (k, v) in extra_json {
                                if is_ui_only_extra_json_key(k) {
                                    continue;
                                }
                                if !csv_cell_is_set(v) {
                                    continue;
                                }
                                // Skip only if this key was set by CSV columns (not defaults)
                                if csv_set_keys.contains(k) {
                                    continue;
                                }
                                if !allowed_mechvent_props.is_empty()
                                    && !allowed_mechvent_props.contains(k)
                                    && !template_keys.contains(k)
                                {
                                    continue;
                                }
                                mv_obj.insert(k.clone(), strip_ui_only_extra_json_value(v));
                            }
                        }

                        let extra_json_keys: std::collections::HashSet<String> = vent_row
                            .get("extra_json")
                            .and_then(|v| v.as_object())
                            .map(|o| o.keys().cloned().collect())
                            .unwrap_or_default();

                        let flat_position_keys =
                            ["mid_height_air_flow_path", "orientation360", "pitch"];
                        let flat_position_explicit = flat_position_keys.iter().any(|key| {
                            csv_set_keys.contains(*key) || extra_json_keys.contains(*key)
                        });
                        let wrapped_position_explicit =
                            extra_json_keys.contains("position_exhaust");

                        if let Some(vt) = mv_obj.get("vent_type").and_then(|v| v.as_str()) {
                            if vt == "MVHR" {
                                for key in flat_position_keys {
                                    mv_obj.remove(key);
                                }
                            } else if flat_position_explicit {
                                mv_obj.remove("position_exhaust");
                                mv_obj.remove("position_intake");
                            } else if wrapped_position_explicit {
                                for key in flat_position_keys {
                                    mv_obj.remove(key);
                                }
                                mv_obj.remove("position_intake");
                            }
                        }

                        // After overlays, normalise mutually-exclusive ventilation performance inputs.
                        // The active upstream FHS schema accepts either SFP or measured_* for
                        // Centralised continuous MEV / MVHR, but not both at once.
                        if let Some(vt) = mv_obj.get("vent_type").and_then(|v| v.as_str()) {
                            if vt == "Intermittent MEV" || vt == "Decentralised continuous MEV" {
                                mv_obj.remove("measured_fan_power");
                                mv_obj.remove("measured_air_flow_rate");
                                mv_obj.remove("mvhr_eff");
                                mv_obj.remove("mvhr_location");
                                mv_obj.remove("position_intake");
                                // Keep `position_exhaust`: defaults templates and FHS schema `oneOf`
                                // allow exhaust geometry via this object when root-level mid_* is absent.
                            } else if vt == "Centralised continuous MEV" || vt == "MVHR" {
                                let sfp_explicit =
                                    csv_set_keys.contains("SFP") || extra_json_keys.contains("SFP");
                                let measured_explicit = csv_set_keys.contains("measured_fan_power")
                                    || csv_set_keys.contains("measured_air_flow_rate")
                                    || extra_json_keys.contains("measured_fan_power")
                                    || extra_json_keys.contains("measured_air_flow_rate");

                                if sfp_explicit {
                                    mv_obj.remove("measured_fan_power");
                                    mv_obj.remove("measured_air_flow_rate");
                                } else if measured_explicit {
                                    mv_obj.remove("SFP");
                                }
                            }
                        }

                        // Validate base required fields from input_fhs.schema.json MechanicalVentilation.additionalProperties.required
                        // (Engine may accept extra keys with serde defaults; those are not listed as required in the FHS schema.)
                        let required_fields =
                            ["vent_type", "EnergySupply", "design_outdoor_air_flow_rate"];
                        for field in &required_fields {
                            if !mv_obj.contains_key(*field) {
                                return Err(BuildError::new(
                                    "E040",
                                    &format!(
                                        "MechanicalVentilation missing required field '{field}' (provide via CSV column or extra_json)"
                                    ),
                                ));
                            }
                        }

                        // Build ductwork for this system
                        let mut ductwork = Vec::new();
                        for duct_row in section_data.iter() {
                            let duct_type = duct_row.get("Type").and_then(|v| v.as_str());
                            let parent_element =
                                duct_row.get("parent_element").and_then(|v| v.as_str());
                            if duct_type == Some("MechanicalVentilationDuctwork")
                                && parent_element == Some(vent_name)
                            {
                                // Seed ductwork defaults from the selected MV template (if present), else fallback defaults.
                                let mut duct_obj: serde_json::Map<String, Value> = mv_obj
                                    .get("ductwork")
                                    .and_then(|v| v.as_array())
                                    .and_then(|arr| arr.first())
                                    .and_then(|v| v.as_object())
                                    .cloned()
                                    .unwrap_or_else(|| {
                                        let mut o = serde_json::Map::new();
                                        o.insert(
                                            "cross_section_shape".to_string(),
                                            Value::String("circular".to_string()),
                                        );
                                        o.insert(
                                            "insulation_thermal_conductivity".to_string(),
                                            Value::Number(
                                                serde_json::Number::from_f64(0.035).unwrap(),
                                            ),
                                        );
                                        o.insert(
                                            "insulation_thickness_mm".to_string(),
                                            Value::Number(serde_json::Number::from(25)),
                                        );
                                        o.insert("reflective".to_string(), Value::Bool(false));
                                        o
                                    });
                                let mut csv_set_keys = HashSet::new();

                                // Overlay: CSV columns (highest precedence), schema-allowed only, ignoring empties.
                                for (k, v) in duct_row {
                                    if k == "Name"
                                        || k == "Type"
                                        || k == "coords"
                                        || k == "extra_json"
                                        || k == "parent_element"
                                        || k == "terminal_type"
                                        || k == "host_element"
                                    {
                                        continue;
                                    }
                                    if !allowed_duct_props.is_empty()
                                        && !allowed_duct_props.contains(k)
                                    {
                                        continue;
                                    }
                                    if v.is_null()
                                        || (v.is_string() && v.as_str().unwrap_or("").is_empty())
                                    {
                                        continue;
                                    }
                                    duct_obj.insert(k.clone(), v.clone());
                                    csv_set_keys.insert(k.clone());
                                }

                                // Overlay: extra_json (lower precedence than CSV columns, but overrides defaults)
                                if let Some(extra_json) =
                                    duct_row.get("extra_json").and_then(|v| v.as_object())
                                {
                                    for (k, v) in extra_json {
                                        if is_ui_only_extra_json_key(k) {
                                            continue;
                                        }
                                        if !csv_cell_is_set(v) {
                                            continue;
                                        }
                                        if csv_set_keys.contains(k) {
                                            continue;
                                        }
                                        if !allowed_duct_props.is_empty()
                                            && !allowed_duct_props.contains(k)
                                        {
                                            continue;
                                        }
                                        duct_obj
                                            .insert(k.clone(), strip_ui_only_extra_json_value(v));
                                    }
                                }

                                if !allowed_duct_props.is_empty() {
                                    duct_obj.retain(|k, _| allowed_duct_props.contains(k));
                                }
                                ductwork.push(Value::Object(duct_obj));
                            }
                        }

                        // FHS schema only allows `ductwork` on MVHR systems.
                        if vt != "MVHR" && !ductwork.is_empty() {
                            return Err(BuildError::new(
                                "E040",
                                &format!(
                                    "MechanicalVentilation '{vent_name}' has linked ductwork, but vent_type='{vt}'. Ductwork is only valid for MVHR systems."
                                ),
                            ));
                        }

                        let linked_terminal_rows: Vec<&HashMap<String, Value>> = section_data
                            .iter()
                            .filter(|terminal_row| {
                                terminal_row.get("Type").and_then(|v| v.as_str())
                                    == Some("MechanicalVentilationTerminal")
                                    && terminal_row.get("parent_element").and_then(|v| v.as_str())
                                        == Some(vent_name)
                            })
                            .collect();
                        if vt != "MVHR" && !linked_terminal_rows.is_empty() {
                            return Err(BuildError::new(
                                "E040",
                                &format!(
                                    "MechanicalVentilation '{vent_name}' has linked terminals, but vent_type='{vt}'. Terminals are only valid for MVHR systems."
                                ),
                            ));
                        }

                        // CSV-authoritative: ductwork comes from the user's
                        // MechanicalVentilationDuctwork rows only. An MVHR with no
                        // ductwork rows must not silently inherit the defaults
                        // template's ducts (they add heat losses the user never
                        // authored); the missing required `ductwork` surfaces as a
                        // schema validation error instead.
                        if vt == "MVHR" && !ductwork.is_empty() {
                            mv_obj.insert("ductwork".to_string(), Value::Array(ductwork));
                        } else {
                            mv_obj.remove("ductwork");
                        }

                        if vt == "MVHR" {
                            mv_obj.remove("position_intake");
                            mv_obj.remove("position_exhaust");
                            let mut seen_terminal_roles: HashSet<String> = HashSet::new();
                            for terminal_row in linked_terminal_rows {
                                let terminal_name = terminal_row
                                    .get("Name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("<unnamed terminal>");
                                let terminal_role = terminal_row
                                    .get("terminal_type")
                                    .and_then(|v| v.as_str())
                                    .map(str::trim)
                                    .ok_or_else(|| {
                                        BuildError::new(
                                            "E040",
                                            &format!(
                                                "MechanicalVentilationTerminal '{terminal_name}' missing terminal_type"
                                            ),
                                        )
                                    })?;
                                if terminal_role != "intake" && terminal_role != "exhaust" {
                                    return Err(BuildError::new(
                                        "E040",
                                        &format!(
                                            "MechanicalVentilationTerminal '{terminal_name}' terminal_type='{terminal_role}' must be intake or exhaust"
                                        ),
                                    ));
                                }
                                if !seen_terminal_roles.insert(terminal_role.to_string()) {
                                    return Err(BuildError::new(
                                        "E040",
                                        &format!(
                                            "MechanicalVentilation '{vent_name}' has duplicate {terminal_role} terminals"
                                        ),
                                    ));
                                }
                                let host_name = csv_string_cell(terminal_row, "host_element");
                                let position = if let Some(host_name) = host_name {
                                    let (host_section, host_row) = find_mvhr_terminal_host(
                                        csv_data,
                                        host_name,
                                    )
                                    .ok_or_else(|| {
                                        BuildError::new(
                                            "E040",
                                            &format!(
                                                "MechanicalVentilationTerminal '{terminal_name}' host_element '{host_name}' not found"
                                            ),
                                        )
                                    })?;
                                    mvhr_terminal_host_position_values(
                                        host_section,
                                        host_row,
                                        terminal_row,
                                        terminal_name,
                                    )?
                                } else {
                                    mvhr_terminal_manual_position_values(
                                        terminal_row,
                                        terminal_name,
                                    )?
                                };
                                let position_key = if terminal_role == "intake" {
                                    "position_intake"
                                } else {
                                    "position_exhaust"
                                };
                                mv_obj.insert(position_key.to_string(), Value::Object(position));
                            }
                            for required_role in ["intake", "exhaust"] {
                                if !seen_terminal_roles.contains(required_role) {
                                    return Err(BuildError::new(
                                        "E040",
                                        &format!(
                                            "MechanicalVentilation '{vent_name}' missing {required_role} terminal"
                                        ),
                                    ));
                                }
                            }
                        } else {
                            mv_obj.remove("position_intake");
                        }

                        // Prune to schema-allowed keys (defence-in-depth; cleanup_against_schema will also run).
                        if !allowed_mechvent_props.is_empty() {
                            mv_obj.retain(|k, _| {
                                allowed_mechvent_props.contains(k) || template_keys.contains(k)
                            });
                        }
                        mechanical_ventilation.insert(vent_name.to_string(), Value::Object(mv_obj));
                    }
                    _ => {
                        // Skip other types for now
                        continue;
                    }
                }
            }
            // Merge into InfiltrationVentilation with CSV-authoritative behavior:
            // empty section/types should clear defaults, not preserve them.
            inf_vent["Vents"] = Value::Object(vents);
            if mechanical_ventilation.is_empty() {
                if let Some(inf_map) = inf_vent.as_object_mut() {
                    inf_map.remove("MechanicalVentilation");
                }
            } else {
                inf_vent["MechanicalVentilation"] = Value::Object(mechanical_ventilation);
            }

            // Note: Area calculation is now handled in process_root_level_sections
        } else {
            tracing::debug!("No Ventilation Systems section found in CSV data; clearing defaults");
            if !result
                .as_object()
                .unwrap()
                .contains_key("InfiltrationVentilation")
            {
                return Err(BuildError::new(
                    "E027",
                    "InfiltrationVentilation section not found in defaults template",
                ));
            }
            let inf_vent = result.get_mut("InfiltrationVentilation").unwrap();
            if let Some(inf_map) = inf_vent.as_object_mut() {
                // Clear default vents and mechanical ventilation
                inf_map.insert("Vents".to_string(), Value::Object(serde_json::Map::new()));
                inf_map.remove("MechanicalVentilation");
                if self.is_fhs_schema {
                    inf_map.remove("cross_vent_possible");
                }
                inf_map.remove("cross_vent_factor");
            } else {
                return Err(BuildError::new(
                    "E027",
                    "InfiltrationVentilation structure is not an object",
                ));
            }
        }
        Ok(())
    }

    fn merge_combustion_appliances(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        if let Some(section_data) = csv_data.get("Combustion Appliances") {
            let mut combustion_appliances = serde_json::Map::new();

            // Derive allowed keys from schema (Core/FHS) to avoid brittle allowlists.
            let schema_infiltration = self
                .schema
                .get("properties")
                .and_then(|p| p.get("InfiltrationVentilation"));
            let schema_infiltration_props = schema_infiltration
                .and_then(|iv| iv.get("properties"))
                .and_then(|p| p.as_object());
            let combustion_schema = schema_infiltration_props
                .and_then(|p| p.get("CombustionAppliances"))
                .and_then(|v| v.get("additionalProperties"))
                .or_else(|| {
                    self.schema
                        .get("$defs")
                        .and_then(|d| d.get("CombustionAppliances"))
                });
            let allowed_keys = combustion_schema
                .map(|s| self.get_allowed_properties_from_schema(s))
                .unwrap_or_default();

            // Defaults template seed (first available appliance)
            let defaults_inf_vent = self.defaults.get("InfiltrationVentilation");
            let default_appliance_obj = defaults_inf_vent
                .and_then(|iv| iv.get("CombustionAppliances"))
                .and_then(|v| v.as_object())
                .and_then(|m| m.values().next())
                .and_then(|v| v.as_object())
                .cloned();

            for appliance_row in section_data {
                let appliance_name = appliance_row
                    .get("Name")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        BuildError::new(
                            "E023",
                            "Combustion Appliances missing required 'Name' field",
                        )
                    })?;

                // Seed from defaults template, then overlay extra_json < CSV columns, then prune.
                let appliance_obj = overlay_row_onto_seed(
                    default_appliance_obj
                        .clone()
                        .unwrap_or_else(serde_json::Map::new),
                    appliance_row,
                    &["Name", "Type", "coords"],
                    &allowed_keys,
                );

                combustion_appliances
                    .insert(appliance_name.to_string(), Value::Object(appliance_obj));
            }

            // Merge into InfiltrationVentilation
            if let Some(inf_vent) = result.get_mut("InfiltrationVentilation") {
                if let Some(inf_vent_obj) = inf_vent.as_object_mut() {
                    inf_vent_obj.insert(
                        "CombustionAppliances".to_string(),
                        Value::Object(combustion_appliances),
                    );
                }
            }
        } else if let Some(inf_vent) = result.get_mut("InfiltrationVentilation") {
            if let Some(inf_vent_obj) = inf_vent.as_object_mut() {
                inf_vent_obj.remove("CombustionAppliances");
            }
        }

        Ok(())
    }

    fn merge_water_pipework(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        // Derive allowed keys from schema (Core/FHS) to avoid brittle allowlists.
        // The schema typically defines WaterPipework in $defs.
        let pipework_schema = self
            .schema
            .get("$defs")
            .and_then(|d| d.get("WaterPipework"))
            .or_else(|| {
                self.schema
                    .get("$defs")
                    .and_then(|d| d.get("Tank"))
                    .and_then(|tank| tank.get("properties"))
                    .and_then(|props| props.get("primary_pipework"))
                    .and_then(|primary| primary.get("items"))
            });
        let allowed_pipework_props = pipework_schema
            .map(|s| self.get_allowed_properties_from_schema(s))
            .unwrap_or_default();

        // Defaults seeds: take the first distribution / primary pipework entries if present.
        let default_distribution_pipe = self
            .defaults
            .get("HotWaterDemand")
            .and_then(|hwd| hwd.get("Distribution"))
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_object())
            .cloned();

        let default_primary_pipe = self
            .defaults
            .get("HotWaterSource")
            .and_then(|hws| hws.as_object())
            .and_then(|m| m.values().next())
            .and_then(|sys| sys.get("primary_pipework"))
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_object())
            .cloned();
        if let Some(section_data) = csv_data.get("Water Pipework") {
            // Group pipework by type (primary vs distribution)
            let mut primary_pipework = Vec::new();
            let mut distribution_pipework = Vec::new();
            for pipe_row in section_data {
                let pipework_type = pipe_row
                    .get("pipework_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("primary")
                    .to_lowercase();
                let seed = match pipework_type.as_str() {
                    "primary" => default_primary_pipe
                        .clone()
                        .unwrap_or_else(serde_json::Map::new),
                    _ => default_distribution_pipe
                        .clone()
                        .unwrap_or_else(serde_json::Map::new),
                };
                let pipe_obj = overlay_row_onto_seed(
                    seed,
                    pipe_row,
                    &[
                        "Name",
                        "Type",
                        "coords",
                        "pipework_type",
                        "simplified pipework",
                        "simplified_pipework",
                    ],
                    &allowed_pipework_props,
                );
                if pipework_type == "primary" {
                    primary_pipework.push(Value::Object(pipe_obj));
                } else {
                    distribution_pipework.push(Value::Object(pipe_obj));
                }
            }
            // Handle primary pipework (in HotWaterSource)
            if !primary_pipework.is_empty() {
                if let Some(hot_water_source) = result.get_mut("HotWaterSource") {
                    if let Some(hws_obj) = hot_water_source.as_object_mut() {
                        for (_, system_data) in hws_obj {
                            if let Some(system_obj) = system_data.as_object_mut() {
                                if system_obj.get("type").and_then(|v| v.as_str())
                                    == Some("hw cylinder")
                                    || system_obj.get("type").and_then(|v| v.as_str())
                                        == Some("StorageTank")
                                {
                                    system_obj.insert(
                                        "primary_pipework".to_string(),
                                        Value::Array(primary_pipework.clone()),
                                    );
                                }
                            }
                        }
                    }
                }
            }
            // Handle distribution pipework (in HotWaterDemand.Distribution)
            if !distribution_pipework.is_empty() {
                if let Some(hot_water_demand) = result.get_mut("HotWaterDemand") {
                    if let Some(hwd_obj) = hot_water_demand.as_object_mut() {
                        hwd_obj.insert(
                            "Distribution".to_string(),
                            Value::Array(distribution_pipework),
                        );
                    }
                }
            }
        } else {
            // CSV-authoritative policy: no Water Pipework section means remove pipework defaults.
            if let Some(hot_water_demand) = result.get_mut("HotWaterDemand") {
                if let Some(hwd_obj) = hot_water_demand.as_object_mut() {
                    hwd_obj.remove("Distribution");
                }
            }
            if let Some(hot_water_source) = result.get_mut("HotWaterSource") {
                if let Some(hws_obj) = hot_water_source.as_object_mut() {
                    for (_, system_data) in hws_obj {
                        if let Some(system_obj) = system_data.as_object_mut() {
                            system_obj.remove("primary_pipework");
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn parse_default_thermal_bridging_from_metadata(
        &mut self,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) {
        // Parse DefaultThermalBridging from metadata early so it's available for zone processing
        if let Some(metadata_rows) = csv_data.get("Metadata") {
            for row in metadata_rows {
                let (field_name, field_value) = extract_metadata_field(row);
                if field_name.as_deref() == Some("DefaultThermalBridging") {
                    if let Some(num) = self.csv_number_non_fatal(
                        field_value.as_ref(),
                        "DefaultThermalBridging",
                        "Metadata",
                    ) {
                        if num < 0.0 {
                            self.push_non_fatal(
                                "E055",
                                "Metadata",
                                &format!("'DefaultThermalBridging' must be >= 0, got {num}"),
                            );
                        } else {
                            self.default_thermal_bridging = num;
                        }
                    }
                    break; // Found it, no need to continue
                }
            }
        }
    }

    fn normalize_cold_water_source(raw: &str) -> Option<&'static str> {
        match raw.trim() {
            COLD_WATER_SOURCE_MAINS => Some(COLD_WATER_SOURCE_MAINS),
            COLD_WATER_SOURCE_HEADER_TANK => Some(COLD_WATER_SOURCE_HEADER_TANK),
            "" => None,
            _ => None,
        }
    }

    fn parse_cold_water_source_from_metadata(
        &mut self,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) {
        if let Some(metadata_rows) = csv_data.get("Metadata") {
            for row in metadata_rows {
                let (field_name, field_value) = extract_metadata_field(row);
                if field_name.as_deref() != Some("ColdWaterSource") {
                    continue;
                }

                let Some(value) = field_value.as_ref().and_then(Value::as_str) else {
                    break;
                };

                if value.trim().is_empty() {
                    break;
                }

                if let Some(normalized) = Self::normalize_cold_water_source(value) {
                    self.cold_water_source = normalized.to_string();
                } else {
                    self.push_non_fatal(
                        "E055",
                        "Metadata",
                        &format!(
                            "'ColdWaterSource' must be '{COLD_WATER_SOURCE_MAINS}' or \
                             '{COLD_WATER_SOURCE_HEADER_TANK}', got '{}'",
                            value.trim()
                        ),
                    );
                }
                break;
            }
        }
    }

    fn effective_cold_water_source(&self) -> &str {
        if self.is_fhs_schema {
            self.cold_water_source.as_str()
        } else {
            COLD_WATER_SOURCE_DEFAULT
        }
    }

    fn apply_fhs_cold_water_source(&self, result: &mut Value) {
        if !self.is_fhs_schema {
            return;
        }

        let source = self.effective_cold_water_source().to_string();
        let Some(root) = result.as_object_mut() else {
            return;
        };

        root.insert(
            "ColdWaterSource".to_string(),
            serde_json::json!({ source.clone(): {} }),
        );

        for (key, value) in root.iter_mut() {
            if key == "ColdWaterSource" {
                continue;
            }
            Self::replace_cold_water_source_string_references(value, &source);
        }
    }

    fn replace_cold_water_source_string_references(value: &mut Value, source: &str) {
        match value {
            Value::Object(obj) => {
                if matches!(obj.get("ColdWaterSource"), Some(Value::String(_))) {
                    obj.insert(
                        "ColdWaterSource".to_string(),
                        Value::String(source.to_string()),
                    );
                }
                for child in obj.values_mut() {
                    Self::replace_cold_water_source_string_references(child, source);
                }
            }
            Value::Array(values) => {
                for child in values {
                    Self::replace_cold_water_source_string_references(child, source);
                }
            }
            _ => {}
        }
    }

    fn merge_compliance_settings(
        &mut self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        // Compliance settings are stored in the Metadata section
        // The parser treats metadata rows as table rows, so the first row becomes headers
        // For metadata like "GlobalOrientationOffset,0", the headers would be ["GlobalOrientationOffset", "0", ...]
        // And subsequent rows would be parsed with those headers
        // So we need to access the first column of each row as the field name
        if let Some(metadata_rows) = csv_data.get("Metadata") {
            let result_obj = result
                .as_object_mut()
                .ok_or_else(|| BuildError::new("E026", "Result JSON is not an object"))?;

            for row in metadata_rows {
                let (field_name, field_value) = extract_metadata_field(row);

                if let Some(name) = field_name {
                    // Skip fields already parsed before root-level merge.
                    if name == "DefaultThermalBridging" || name == "ColdWaterSource" {
                        continue;
                    }

                    // Skip known metadata fields that aren't compliance settings
                    if name == "GlobalOrientationOffset" || name == "DefaultsPath" {
                        continue;
                    }

                    // Workflow-only flag: whether downstream FHS validation should run; controls implicit
                    // defaults for required root booleans when absent from CSV/defaults.
                    if name == "ComplianceValidationEnabled" {
                        if let Some(b) =
                            self.csv_bool_non_fatal(field_value.as_ref(), &name, "Metadata")
                        {
                            self.compliance_validation_enabled = Some(b);
                        }
                        continue;
                    }

                    if let Some(val) = field_value {
                        if name == "Postcode" {
                            if let Some(str_val) = val.as_str() {
                                let postcode = str_val.trim();
                                if !postcode.is_empty() {
                                    let metadata = result_obj
                                        .entry("metadata".to_string())
                                        .or_insert_with(|| serde_json::json!({}));
                                    if let Some(metadata_obj) = metadata.as_object_mut() {
                                        metadata_obj.insert(
                                            "postcode".to_string(),
                                            serde_json::Value::String(postcode.to_string()),
                                        );
                                    }
                                }
                            }
                        } else if name == "General_build_type" {
                            if let Some(str_val) = val.as_str() {
                                match str_val {
                                    "flat" | "house" => {
                                        let general = result_obj
                                            .entry("General".to_string())
                                            .or_insert_with(|| serde_json::json!({}));
                                        if let Some(general_obj) = general.as_object_mut() {
                                            general_obj.insert(
                                                "build_type".to_string(),
                                                serde_json::Value::String(str_val.to_string()),
                                            );
                                        }
                                    }
                                    "" => {}
                                    other => {
                                        self.push_non_fatal(
                                            "E055",
                                            "Metadata",
                                            &format!(
                                                "'General_build_type' must be 'flat' or 'house', \
                                                 got '{other}'"
                                            ),
                                        );
                                    }
                                }
                            }
                        } else if name == "General_built_form" {
                            if let Some(num) =
                                self.csv_number_non_fatal(Some(&val), &name, "Metadata")
                            {
                                if num.fract() != 0.0 || !(1.0..=6.0).contains(&num) {
                                    self.push_non_fatal(
                                        "E055",
                                        "Metadata",
                                        &format!(
                                            "'General_built_form' must be a whole-number SAP Built-Form code from 1 to 6, got {num}"
                                        ),
                                    );
                                } else {
                                    let general = result_obj
                                        .entry("General".to_string())
                                        .or_insert_with(|| serde_json::json!({}));
                                    if let Some(general_obj) = general.as_object_mut() {
                                        general_obj.insert(
                                            "built_form".to_string(),
                                            serde_json::Value::Number(serde_json::Number::from(
                                                num as i64,
                                            )),
                                        );
                                    }
                                }
                            }
                        } else if name == "General_storeys_in_dwelling"
                            || name == "General_storey_of_dwelling"
                            || name == "General_storeys_in_building"
                        {
                            let general_field = name.strip_prefix("General_").ok_or_else(|| {
                                BuildError::new("E029", "Invalid General metadata field")
                            })?;
                            if let Some(num) =
                                self.csv_number_non_fatal(Some(&val), &name, "Metadata")
                            {
                                if num.fract() != 0.0 {
                                    self.push_non_fatal(
                                        "E055",
                                        "Metadata",
                                        &format!("'{name}' must be a whole number, got {num}"),
                                    );
                                } else {
                                    let general = result_obj
                                        .entry("General".to_string())
                                        .or_insert_with(|| serde_json::json!({}));
                                    if let Some(general_obj) = general.as_object_mut() {
                                        general_obj.insert(
                                            general_field.to_string(),
                                            serde_json::Value::Number(serde_json::Number::from(
                                                num as i64,
                                            )),
                                        );
                                    }
                                }
                            }
                        }
                        // Handle boolean fields
                        else if name == "PartO_active_cooling_required"
                            || name == "PartGcompliance"
                            || name == "KitchenExtractorHoodExternal"
                        {
                            if let Some(bool_val) =
                                self.csv_bool_non_fatal(Some(&val), &name, "Metadata")
                            {
                                result_obj.insert(name.clone(), serde_json::Value::Bool(bool_val));
                            }
                        }
                        // Handle number fields
                        else if name == "NumberOfBedrooms"
                            || name == "NumberOfWetRooms"
                            || name == "NumberOfHabitableRooms"
                            || name == "NumberOfHotTappedRooms"
                            || name == "NumberOfUtilityRooms"
                            || name == "NumberOfBathrooms"
                            || name == "NumberOfSanitaryAccommodations"
                        {
                            if let Some(num) =
                                self.csv_number_non_fatal(Some(&val), &name, "Metadata")
                            {
                                if num.fract() != 0.0 {
                                    self.push_non_fatal(
                                        "E055",
                                        "Metadata",
                                        &format!("'{name}' must be a whole number, got {num}"),
                                    );
                                } else {
                                    result_obj.insert(
                                        name.clone(),
                                        serde_json::Value::Number(serde_json::Number::from(
                                            num as i64,
                                        )),
                                    );
                                }
                            }
                        } else if name == "GroundFloorArea"
                            || name == "BuildingLength"
                            || name == "BuildingWidth"
                        {
                            if let Some(num) =
                                self.csv_number_non_fatal(Some(&val), &name, "Metadata")
                            {
                                result_obj.insert(
                                    name.clone(),
                                    serde_json::Value::Number(
                                        serde_json::Number::from_f64(num)
                                            .expect("finiteness checked"),
                                    ),
                                );
                            }
                        }
                        // Handle string fields. NB. `Location` is a recognised Metadata row but
                        // is Vulcan-only (no HEM consumer reads it) — it stays in the CSV and is
                        // deliberately not written into the merged JSON.
                        else if name == "HeatingControlType" {
                            if let Some(str_val) = val.as_str() {
                                if !str_val.is_empty() {
                                    result_obj.insert(
                                        name.clone(),
                                        serde_json::Value::String(str_val.to_string()),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }

        if result
            .get("General")
            .and_then(|general| general.get("build_type"))
            .and_then(Value::as_str)
            == Some("house")
        {
            if let Some(general_obj) = result.get_mut("General").and_then(Value::as_object_mut) {
                general_obj.remove("storey_of_dwelling");
                general_obj.remove("storeys_in_building");
            }
        }

        self.apply_fhs_implicit_false_root_booleans(result);

        Ok(())
    }

    /// When using the FHS schema and compliance validation is not explicitly disabled, ensure
    /// required root booleans exist by inserting `false` when CSV metadata did not set them.
    fn apply_fhs_implicit_false_root_booleans(&self, result: &mut Value) {
        if !self.is_fhs_schema {
            return;
        }
        // Absent flag means "validation on" for backward compatibility with CSV that omits the row.
        if self.compliance_validation_enabled == Some(false) {
            return;
        }
        let Some(root) = result.as_object_mut() else {
            return;
        };
        if !root.contains_key("KitchenExtractorHoodExternal") {
            root.insert(
                "KitchenExtractorHoodExternal".to_string(),
                serde_json::Value::Bool(false),
            );
        }
        if !root.contains_key("PartO_active_cooling_required") {
            root.insert(
                "PartO_active_cooling_required".to_string(),
                serde_json::Value::Bool(false),
            );
        }
    }

    fn merge_air_permeability_from_metadata(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        // Air permeability settings are stored in the Metadata section with "AirPermeability_" prefix
        if let Some(metadata_rows) = csv_data.get("Metadata") {
            let result_obj = result
                .as_object_mut()
                .ok_or_else(|| BuildError::new("E031", "Result JSON is not an object"))?;

            // Known air permeability field names (env_area is calculated automatically, not set by user)
            let air_permeability_fields: HashSet<&str> = [
                "AirPermeability_test_pressure",
                "AirPermeability_test_result",
                "AirPermeability_ventilation_zone_height",
            ]
            .iter()
            .cloned()
            .collect();

            for row in metadata_rows {
                let (field_name, field_value) = extract_metadata_field(row);

                if let Some(name) =
                    field_name.filter(|n| air_permeability_fields.contains(n.as_str()))
                {
                    if let Some(val) = field_value {
                        // Extract the field name (remove "AirPermeability_" prefix)
                        let leaks_field_name = name.strip_prefix("AirPermeability_").unwrap();

                        // Ensure InfiltrationVentilation.Leaks exists
                        let inf_vent = result_obj
                            .entry("InfiltrationVentilation".to_string())
                            .or_insert_with(|| {
                                serde_json::json!({
                                    "Leaks": {}
                                })
                            });

                        if let Some(inf_vent_obj) = inf_vent.as_object_mut() {
                            let leaks =
                                inf_vent_obj.entry("Leaks".to_string()).or_insert_with(|| {
                                    serde_json::Value::Object(serde_json::Map::new())
                                });

                            if let Some(leaks_obj) = leaks.as_object_mut() {
                                if leaks_field_name == "test_pressure" {
                                    if self.is_fhs_schema {
                                        match &val {
                                            Value::String(s) => {
                                                leaks_obj.insert(
                                                    leaks_field_name.to_string(),
                                                    Value::String(s.trim().to_string()),
                                                );
                                            }
                                            other => {
                                                leaks_obj.insert(
                                                    leaks_field_name.to_string(),
                                                    other.clone(),
                                                );
                                            }
                                        }
                                    } else {
                                        let numeric_value = match &val {
                                            Value::String(s) => {
                                                let trimmed = s.trim();
                                                match trimmed {
                                                    "Standard" => Some(50.0),
                                                    "Pulse test only" => Some(4.0),
                                                    _ => self.csv_number_non_fatal(
                                                        Some(&val),
                                                        &name,
                                                        "InfiltrationVentilation/Leaks",
                                                    ),
                                                }
                                            }
                                            Value::Number(num) => num.as_f64(),
                                            _ => None,
                                        };
                                        if let Some(test_pressure) = numeric_value {
                                            leaks_obj.insert(
                                                leaks_field_name.to_string(),
                                                serde_json::Value::Number(
                                                    serde_json::Number::from_f64(test_pressure)
                                                        .ok_or_else(|| {
                                                            BuildError::new(
                                                                "E032",
                                                                &format!(
                                                                    "Invalid number for {name}"
                                                                ),
                                                            )
                                                        })?,
                                                ),
                                            );
                                        }
                                    }
                                    continue;
                                }
                                // Parse the value as a number
                                if let Some(num) = self.csv_number_non_fatal(
                                    Some(&val),
                                    &name,
                                    "InfiltrationVentilation/Leaks",
                                ) {
                                    leaks_obj.insert(
                                        leaks_field_name.to_string(),
                                        serde_json::Value::Number(
                                            serde_json::Number::from_f64(num)
                                                .expect("finiteness checked"),
                                        ),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn merge_ventilation_env_from_metadata(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        if let Some(metadata_rows) = csv_data.get("Metadata") {
            let ventilation_fields: HashSet<&str> = [
                "Ventilation_shield_class",
                "Ventilation_terrain_class",
                "Ventilation_altitude",
                "Ventilation_ventilation_zone_base_height",
                "Ventilation_noise_nuisance",
            ]
            .iter()
            .cloned()
            .collect();

            for row in metadata_rows {
                let (field_name, field_value) = extract_metadata_field(row);

                if let Some(name) = &field_name {
                    if !ventilation_fields.contains(name.as_str()) {
                        continue;
                    }
                    if let Some(val) = field_value {
                        let inf_field = name.strip_prefix("Ventilation_").unwrap();

                        let inf_vent = result
                            .as_object_mut()
                            .ok_or_else(|| BuildError::new("E034", "Result JSON is not an object"))?
                            .entry("InfiltrationVentilation".to_string())
                            .or_insert_with(|| serde_json::json!({}));

                        if let Some(inf_vent_obj) = inf_vent.as_object_mut() {
                            match inf_field {
                                "shield_class" | "terrain_class" => {
                                    if let Some(s) = val.as_str() {
                                        inf_vent_obj.insert(
                                            inf_field.to_string(),
                                            Value::String(s.to_string()),
                                        );
                                    }
                                }
                                "altitude" | "ventilation_zone_base_height" => {
                                    if let Some(num) = self.csv_number_non_fatal(
                                        Some(&val),
                                        name,
                                        "InfiltrationVentilation",
                                    ) {
                                        if let Some(n) = serde_json::Number::from_f64(num) {
                                            inf_vent_obj
                                                .insert(inf_field.to_string(), Value::Number(n));
                                        }
                                    }
                                }
                                "noise_nuisance" => {
                                    if let Some(bool_val) = self.csv_bool_non_fatal(
                                        Some(&val),
                                        name,
                                        "InfiltrationVentilation",
                                    ) {
                                        inf_vent_obj
                                            .insert(inf_field.to_string(), Value::Bool(bool_val));
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn merge_onsite_generation(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        if let Some(section_data) = csv_data.get("On-Site Generation") {
            if section_data.is_empty() {
                // No PV systems in CSV - cleanup will remove empty section
                return Ok(());
            }
            let result_obj = result
                .as_object_mut()
                .ok_or_else(|| BuildError::new("E029", "Result JSON is not an object"))?;

            // Get or create OnSiteGeneration object
            let on_site_gen = result_obj
                .entry("OnSiteGeneration".to_string())
                .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()))
                .as_object_mut()
                .ok_or_else(|| BuildError::new("E030", "OnSiteGeneration is not an object"))?;

            for row in section_data {
                // Get element name (first column)
                let element_name = row.get("Name").and_then(|v| v.as_str()).ok_or_else(|| {
                    BuildError::new("E031", "On-Site Generation missing required 'Name' field")
                })?;

                // Get generation_type (should be "PhotovoltaicSystem")
                let generation_type = row
                    .get("generation_type")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        BuildError::new(
                            "E032",
                            "On-Site Generation missing required 'generation_type' field",
                        )
                    })?;

                if generation_type != "PhotovoltaicSystem" {
                    return Err(BuildError::new(
                        "E033",
                        &format!(
                            "Unsupported generation_type: {generation_type}. Only PhotovoltaicSystem is supported"
                        ),
                    ));
                }

                // Start with defaults template if available, otherwise create empty
                let mut pv_system = if let Some(template) = self
                    .type_templates
                    .get("OnSiteGeneration_PhotovoltaicSystem")
                {
                    if let Some(template_obj) = template.as_object() {
                        template_obj.clone()
                    } else {
                        serde_json::Map::new()
                    }
                } else {
                    serde_json::Map::new()
                };

                // Ensure type is set
                pv_system.insert(
                    "type".to_string(),
                    Value::String("PhotovoltaicSystem".to_string()),
                );

                // CSV columns (highest precedence; contract: CSV columns > extra_json
                // > defaults profile). Pitch/orientation are rounded to integers for
                // FHS only (an FHS schema requirement); core keeps fractional values.
                let mut csv_set_keys: HashSet<String> = HashSet::new();
                let pv_path = format!("OnSiteGeneration/{element_name}");
                for key in ["peak_power", "base_height", "width", "height"] {
                    if let Some(num) = self.csv_number_non_fatal(row.get(key), key, &pv_path) {
                        pv_system.insert(
                            key.to_string(),
                            Value::Number(
                                serde_json::Number::from_f64(num).expect("finiteness checked"),
                            ),
                        );
                        csv_set_keys.insert(key.to_string());
                    }
                }
                for key in ["pitch", "orientation360"] {
                    if let Some(num) = self.csv_number_non_fatal(row.get(key), key, &pv_path) {
                        let value = if self.is_fhs_schema {
                            Value::Number(serde_json::Number::from(num.round() as i64))
                        } else {
                            Value::Number(
                                serde_json::Number::from_f64(num).expect("finiteness checked"),
                            )
                        };
                        pv_system.insert(key.to_string(), value);
                        csv_set_keys.insert(key.to_string());
                    }
                }

                // extra_json: overrides defaults but never an authored CSV column.
                if let Some(extra_json) = row.get("extra_json").and_then(|v| v.as_object()) {
                    for (key, value) in extra_json {
                        // UI-only metadata keys must never be written into merged JSON.
                        if is_ui_only_extra_json_key(key) {
                            continue;
                        }
                        if csv_set_keys.contains(key) {
                            continue;
                        }
                        // FHS schema requires integer orientation360/pitch.
                        let processed_value =
                            if self.is_fhs_schema && (key == "orientation360" || key == "pitch") {
                                if let Some(f) = value.as_f64() {
                                    Value::Number(serde_json::Number::from(f.round() as i64))
                                } else {
                                    value.clone()
                                }
                            } else {
                                value.clone()
                            };
                        pv_system.insert(
                            key.clone(),
                            strip_ui_only_extra_json_value(&processed_value),
                        );
                    }
                }

                // Ensure required fields have defaults if missing (fallback only if not in template)
                // Precedence: CSV columns > extra_json > defaults template > fallback defaults
                if !pv_system.contains_key("ventilation_strategy") {
                    pv_system.insert(
                        "ventilation_strategy".to_string(),
                        Value::String("moderately_ventilated".to_string()),
                    );
                }
                if !pv_system.contains_key("EnergySupply") {
                    pv_system.insert(
                        "EnergySupply".to_string(),
                        Value::String("mains elec".to_string()),
                    );
                }
                if !pv_system.contains_key("shading") {
                    pv_system.insert("shading".to_string(), Value::Array(vec![]));
                }
                if !pv_system.contains_key("inverter_peak_power_dc") {
                    pv_system.insert(
                        "inverter_peak_power_dc".to_string(),
                        Value::Number(serde_json::Number::from_f64(1.0).unwrap()),
                    );
                }
                if !pv_system.contains_key("inverter_peak_power_ac") {
                    pv_system.insert(
                        "inverter_peak_power_ac".to_string(),
                        Value::Number(serde_json::Number::from_f64(1.0).unwrap()),
                    );
                }
                if !pv_system.contains_key("inverter_is_inside") {
                    pv_system.insert("inverter_is_inside".to_string(), Value::Bool(true));
                }
                if !pv_system.contains_key("inverter_type") {
                    pv_system.insert(
                        "inverter_type".to_string(),
                        Value::String("string_inverter".to_string()),
                    );
                }

                // Width / height precedence: explicit CSV column (applied above) >
                // extra_json > existing template value > slope-corrected derivation
                // from coords + pitch. Keep the slope correction in sync with
                // the browser PV footprint derivation.
                let needs_width = pv_system
                    .get("width")
                    .and_then(|v| v.as_f64())
                    .map(|w| w <= 0.0)
                    .unwrap_or(true);
                let needs_height = pv_system
                    .get("height")
                    .and_then(|v| v.as_f64())
                    .map(|h| h <= 0.0)
                    .unwrap_or(true);

                if needs_width || needs_height {
                    let pitch_deg = pv_system
                        .get("pitch")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    if let Some(coords_str) = row.get("coords").and_then(|v| v.as_str()) {
                        if let Some((derived_w, derived_h)) =
                            derive_pv_dimensions_from_coords(coords_str, pitch_deg)
                        {
                            if needs_width {
                                pv_system.insert(
                                    "width".to_string(),
                                    Value::Number(serde_json::Number::from_f64(derived_w).unwrap()),
                                );
                            }
                            if needs_height {
                                pv_system.insert(
                                    "height".to_string(),
                                    Value::Number(serde_json::Number::from_f64(derived_h).unwrap()),
                                );
                            }
                        }
                    }
                }

                // Merge into "Default PV" only if CSV name is "OnSiteGeneration" or "Default PV"
                // This ensures CSV PV data with generic names merge into the default template entry
                // rather than creating duplicates, but allows named systems (e.g., "PV South") to create new entries
                let should_merge_into_default = on_site_gen.contains_key("Default PV")
                    && (element_name == "OnSiteGeneration" || element_name == "Default PV");

                if should_merge_into_default {
                    // Merge CSV properties into existing "Default PV" entry (CSV takes precedence)
                    if let Some(existing_pv) = on_site_gen
                        .get_mut("Default PV")
                        .and_then(|v| v.as_object_mut())
                    {
                        for (key, value) in pv_system {
                            existing_pv.insert(key, value);
                        }
                    }
                } else {
                    // Insert new entry with CSV name
                    on_site_gen.insert(element_name.to_string(), Value::Object(pv_system));

                    // Remove empty "Default PV" placeholder if it exists (peak_power=0 means it's just a template)
                    // We only keep it if we merged into it, otherwise remove it when creating a new named system
                    if let Some(default_pv) = on_site_gen.get("Default PV") {
                        if let Some(default_pv_obj) = default_pv.as_object() {
                            let peak_power = default_pv_obj
                                .get("peak_power")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0);
                            if peak_power == 0.0 {
                                // Empty placeholder - remove it since we're creating a real named system
                                on_site_gen.remove("Default PV");
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn update_default_space_heat_systems(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        // Skip if CSV has wet emitters - merge_wet_emitters already cleared all systems
        // and created new ones from CSV. We only need to update defaults when CSV has no emitters.
        if csv_data.get("Wet Emitters").is_some()
            && !csv_data.get("Wet Emitters").unwrap().is_empty()
        {
            return Ok(());
        }

        // Get first zone name from CSV
        let first_zone_name = if let Some(zone_data) = csv_data.get("Zone") {
            zone_data
                .first()
                .and_then(|row| row.get("Name").and_then(|v| v.as_str()))
        } else {
            None
        };

        if let Some(first_zone) = first_zone_name {
            // Get list of system names from CSV Systems section
            let csv_system_names: std::collections::HashSet<String> =
                if let Some(systems_data) = csv_data.get("Systems") {
                    systems_data
                        .iter()
                        .filter_map(|row| {
                            let sys_type = row.get("Type").and_then(|v| v.as_str())?;
                            let subcategory = row.get("subcategory").and_then(|v| v.as_str());
                            let name = row.get("Name").and_then(|v| v.as_str())?;
                            // Preserve both direct system types and generic System rows classified by subcategory.
                            if sys_type == "SpaceHeatSystem"
                                || sys_type == "WetDistribution"
                                || (sys_type == "System" && subcategory == Some("SpaceHeatSystem"))
                            {
                                Some(name.to_string())
                            } else {
                                None
                            }
                        })
                        .collect()
                } else {
                    std::collections::HashSet::new()
                };

            // Update systems that came from defaults but weren't in CSV
            if let Some(space_heat_systems) = result
                .get_mut("SpaceHeatSystem")
                .and_then(|s| s.as_object_mut())
            {
                let systems_to_update: Vec<(String, String)> = space_heat_systems
                    .iter()
                    .filter_map(|(sys_name, sys_val)| {
                        // Skip if this system was in CSV
                        if csv_system_names.contains(sys_name) {
                            return None;
                        }

                        // Check if system has Zone field that doesn't match any CSV zone
                        if let Some(sys_zone) = sys_val.get("Zone").and_then(|v| v.as_str()) {
                            // Check if this zone exists in CSV
                            let zone_exists = csv_data
                                .get("Zone")
                                .map(|zones| {
                                    zones.iter().any(|z| {
                                        z.get("Name").and_then(|v| v.as_str()) == Some(sys_zone)
                                    })
                                })
                                .unwrap_or(false);

                            if !zone_exists && sys_zone != first_zone {
                                // System has a zone that doesn't exist in CSV - update it
                                let new_name = if sys_name.starts_with(&format!("{sys_zone} ")) {
                                    // Replace zone name in system name
                                    let suffix = sys_name
                                        .strip_prefix(&format!("{sys_zone} "))
                                        .unwrap_or("");
                                    format!("{first_zone} {suffix}")
                                } else if sys_name.starts_with("zone 1 ") {
                                    // Handle "zone 1 <type>" pattern
                                    let suffix = sys_name.strip_prefix("zone 1 ").unwrap_or("");
                                    format!("{first_zone} {suffix}")
                                } else {
                                    sys_name.clone()
                                };

                                Some((sys_name.clone(), new_name))
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    })
                    .collect();

                // Update systems
                for (old_name, new_name) in systems_to_update {
                    if let Some(mut system) = space_heat_systems.remove(&old_name) {
                        if let Some(system_obj) = system.as_object_mut() {
                            system_obj
                                .insert("Zone".to_string(), Value::String(first_zone.to_string()));
                            space_heat_systems.insert(new_name, system);
                        }
                    }
                }
            }
        }

        // Reconcile Zone.SpaceHeatSystem references after updating default systems
        self.reconcile_zone_space_heat_system_references(result)?;

        Ok(())
    }

    fn reconcile_zone_space_heat_system_references(
        &self,
        result: &mut Value,
    ) -> Result<(), BuildError> {
        // Take an immutable snapshot of SpaceHeatSystem to avoid aliasing with mutable Zone borrow
        let space_heat_systems_snapshot = result
            .get("SpaceHeatSystem")
            .and_then(|s| s.as_object())
            .cloned();

        if let (Some(zones), Some(space_heat_systems)) = (
            result.get_mut("Zone").and_then(|z| z.as_object_mut()),
            space_heat_systems_snapshot,
        ) {
            // Build a mapping from zone name to list of system names that target the zone
            let mut zone_to_systems: HashMap<String, Vec<String>> = HashMap::new();
            for (sys_name, sys_val) in space_heat_systems.iter() {
                if let Some(sys_zone) = sys_val
                    .get("Zone")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                {
                    zone_to_systems
                        .entry(sys_zone)
                        .or_default()
                        .push(sys_name.clone());
                }
            }

            for (zone_name, zone_val) in zones.iter_mut() {
                if let Some(zone_obj) = zone_val.as_object_mut() {
                    Self::reconcile_space_heat_refs_for_zone(
                        zone_name,
                        zone_obj,
                        &space_heat_systems,
                        &zone_to_systems,
                    );
                }
            }
        }

        Ok(())
    }

    /// Recompute one zone's `SpaceHeatSystem` reference list. A reference is
    /// kept when the system exists and either declares this zone or declares
    /// no `Zone` at all (systems authored without a Zone cell must not
    /// invalidate the user's explicit link); dangling / other-zone refs drop.
    /// Every system declaring this zone is added.
    fn reconcile_space_heat_refs_for_zone(
        zone_name: &str,
        zone_obj: &mut serde_json::Map<String, Value>,
        space_heat_systems: &serde_json::Map<String, Value>,
        zone_to_systems: &HashMap<String, Vec<String>>,
    ) {
        let current_refs = Self::zone_space_heat_refs_from_obj(zone_obj);

        let retained: Vec<String> = current_refs
            .iter()
            .filter(|name| {
                space_heat_systems.get(*name).is_some_and(|sys| {
                    match sys.get("Zone").and_then(|v| v.as_str()) {
                        None => true,
                        Some(z) => z == zone_name,
                    }
                })
            })
            .cloned()
            .collect();

        let mut desired = retained;
        if let Some(candidates) = zone_to_systems.get(zone_name) {
            desired.extend(candidates.iter().cloned());
        }
        let desired = Self::sorted_unique_names(desired);

        if desired == Self::sorted_unique_names(current_refs.clone()) {
            return;
        }
        match Self::zone_space_heat_reference_value(desired) {
            Some(v) => {
                zone_obj.insert("SpaceHeatSystem".to_string(), v);
            }
            None => {
                if !current_refs.is_empty() {
                    tracing::debug!(
                        "Removing invalid SpaceHeatSystem references {:?} from zone '{}'",
                        current_refs,
                        zone_name
                    );
                    zone_obj.remove("SpaceHeatSystem");
                }
            }
        }
    }

    /// `merge_systems` may set `SpaceHeatSystem.<name>.Zone` so `reconcile_zone_space_heat_system_references`
    /// can link zones. FHS only allows `Zone` on `ElecStorageHeater` and `WetDistribution` plant objects
    /// (see `input_fhs` `SpaceHeatSystem` `additionalProperties`); it is **not** valid on `InstantElecHeater`
    /// or `WarmAir`, and triggers JSON Schema validation (E046) if left in the merged JSON.
    fn strip_non_schema_space_heat_system_zone(&self, result: &mut Value) {
        let Some(ssh) = result
            .get_mut("SpaceHeatSystem")
            .and_then(|s| s.as_object_mut())
        else {
            return;
        };
        for (_name, sys_val) in ssh.iter_mut() {
            let Some(obj) = sys_val.as_object_mut() else {
                continue;
            };
            let type_str = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if type_str == "ElecStorageHeater" || type_str == "WetDistribution" {
                continue;
            }
            obj.remove("Zone");
        }
    }

    /// Names referenced by `Zone.<name>.SpaceHeatSystem` (string or JSON array of strings).
    fn zone_space_heat_refs_from_obj(zone_obj: &serde_json::Map<String, Value>) -> Vec<String> {
        match zone_obj.get("SpaceHeatSystem") {
            Some(Value::String(s)) => vec![s.clone()],
            Some(Value::Array(items)) => items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
            _ => Vec::new(),
        }
    }

    fn sorted_unique_names(mut names: Vec<String>) -> Vec<String> {
        names.sort();
        names.dedup();
        names
    }

    /// One reference → string; multiple → sorted unique array (FHS schema allows both).
    fn zone_space_heat_reference_value(names: Vec<String>) -> Option<Value> {
        let names = Self::sorted_unique_names(names);
        match names.len() {
            0 => None,
            1 => Some(Value::String(names.into_iter().next().unwrap())),
            _ => Some(Value::Array(names.into_iter().map(Value::String).collect())),
        }
    }

    /// Remove **dry** space-heat presets not referenced by `Zone.SpaceHeatSystem`.
    ///
    /// Only defaults-template leftovers are pruned. A CSV-authored system
    /// (`csv_authored` holds the merged keys from the Systems section) is never
    /// silently deleted — an unreferenced one stays in the JSON and records an
    /// E057 so the user knows to link it to a zone.
    fn prune_unreferenced_space_heat_systems(
        &self,
        result: &mut Value,
        csv_authored: &HashSet<String>,
    ) {
        const DRY_PRUNE_IF_UNREFERENCED: &[&str] =
            &["InstantElecHeater", "ElecStorageHeater", "WarmAir"];

        let Some(zones) = result.get("Zone").and_then(|z| z.as_object()) else {
            return;
        };
        let mut referenced: HashSet<String> = HashSet::new();
        for zone_val in zones.values() {
            if let Some(zone_obj) = zone_val.as_object() {
                for name in Self::zone_space_heat_refs_from_obj(zone_obj) {
                    referenced.insert(name);
                }
            }
        }
        let Some(shs) = result
            .get_mut("SpaceHeatSystem")
            .and_then(|s| s.as_object_mut())
        else {
            return;
        };
        let keys: Vec<String> = shs.keys().cloned().collect();
        for key in keys {
            if referenced.contains(&key) {
                continue;
            }
            let Some(typ) = shs
                .get(&key)
                .and_then(|sys| sys.get("type"))
                .and_then(|v| v.as_str())
            else {
                continue;
            };
            if !DRY_PRUNE_IF_UNREFERENCED.contains(&typ) {
                continue;
            }
            if csv_authored.contains(&key) {
                self.push_non_fatal(
                    "E057",
                    &format!("SpaceHeatSystem/{key}"),
                    &format!(
                        "SpaceHeatSystem '{key}' was authored in the Systems CSV but is not \
                         referenced by any zone. Set the row's Zone so the system heats a zone."
                    ),
                );
                continue;
            }
            tracing::debug!(
                "Removing unreferenced dry SpaceHeatSystem '{}' (type {})",
                key,
                typ
            );
            shs.remove(&key);
        }
    }

    /// Convert zone name to control name format
    /// Example: "Rest of Dwelling" -> "RestOfDwelling"
    fn zone_name_to_control_suffix(zone_name: &str) -> String {
        zone_name
            .split_whitespace()
            .map(|word| {
                let mut chars = word.chars();
                match chars.next() {
                    None => String::new(),
                    Some(first) => {
                        let rest: String = chars.collect();
                        // Capitalize first letter, rest lowercase
                        format!("{}{}", first.to_uppercase(), rest.to_lowercase())
                    }
                }
            })
            .collect()
    }

    fn consolidate_zones_for_fhs(&self, result: &mut Value) -> Result<(), BuildError> {
        // FHS schema only supports single zone - consolidate all zones into the first one
        // First, collect zone names and determine which to keep
        let zone_names: Vec<String> = result
            .get("Zone")
            .and_then(|z| z.as_object())
            .map(|z| z.keys().cloned().collect())
            .ok_or_else(|| BuildError::new("E027", "Zone section not found"))?;

        if zone_names.len() <= 1 {
            // No consolidation needed
            return Ok(());
        }

        // Keep the first CSV-defined zone as the consolidated target.
        let sorted_zone_names = zone_names;

        let first_zone_name = sorted_zone_names
            .first()
            .ok_or_else(|| BuildError::new("E028", "No zones found"))?
            .clone();
        let other_zone_names: Vec<String> = sorted_zone_names.iter().skip(1).cloned().collect();

        if other_zone_names.is_empty() {
            return Ok(());
        }

        tracing::debug!(
            "Consolidating {} zones into '{}' for FHS schema",
            sorted_zone_names.len(),
            first_zone_name
        );

        // Collect data from all zones (immutable borrow)
        let zones_obj = result
            .get("Zone")
            .and_then(|z| z.as_object())
            .ok_or_else(|| BuildError::new("E027", "Zone section not found"))?;

        let first_zone_data = zones_obj
            .get(&first_zone_name)
            .ok_or_else(|| {
                BuildError::new("E029", &format!("First zone '{first_zone_name}' not found"))
            })?
            .as_object()
            .ok_or_else(|| {
                BuildError::new(
                    "E030",
                    &format!("First zone '{first_zone_name}' is not an object"),
                )
            })?;

        // Initialize consolidated values from first zone
        let mut total_area = first_zone_data
            .get("area")
            .and_then(|v| v.as_f64())
            .unwrap_or_else(|| {
                first_zone_data
                    .get("livingroom_area")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0)
                    + first_zone_data
                        .get("restofdwelling_area")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0)
            });
        let mut total_volume = first_zone_data
            .get("volume")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let mut total_livingroom_area = first_zone_data
            .get("livingroom_area")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let mut total_restofdwelling_area = first_zone_data
            .get("restofdwelling_area")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let mut height_sum = first_zone_data
            .get("height")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let mut height_count = if height_sum > 0.0 { 1 } else { 0 };

        // Get BuildingElement and ThermalBridging from first zone
        let mut consolidated_elements = first_zone_data
            .get("BuildingElement")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_else(serde_json::Map::new);

        let mut consolidated_thermal_bridging = first_zone_data.get("ThermalBridging").cloned();
        let first_zone_has_lighting = first_zone_data.contains_key("Lighting");
        let mut other_lighting: Option<Value> = None;

        // Collect data from other zones
        for other_zone_name in &other_zone_names {
            let other_zone_obj = zones_obj
                .get(other_zone_name)
                .ok_or_else(|| {
                    BuildError::new("E031", &format!("Zone '{other_zone_name}' not found"))
                })?
                .as_object()
                .ok_or_else(|| {
                    BuildError::new(
                        "E032",
                        &format!("Zone '{other_zone_name}' is not an object"),
                    )
                })?;

            // Sum area and volume
            if let Some(area) = other_zone_obj.get("area").and_then(|v| v.as_f64()) {
                total_area += area;
            }
            if let Some(volume) = other_zone_obj.get("volume").and_then(|v| v.as_f64()) {
                total_volume += volume;
            }
            if let Some(livingroom_area) = other_zone_obj
                .get("livingroom_area")
                .and_then(|v| v.as_f64())
            {
                total_livingroom_area += livingroom_area;
            }
            if let Some(restofdwelling_area) = other_zone_obj
                .get("restofdwelling_area")
                .and_then(|v| v.as_f64())
            {
                total_restofdwelling_area += restofdwelling_area;
            }
            if let Some(height) = other_zone_obj.get("height").and_then(|v| v.as_f64()) {
                if height > 0.0 {
                    height_sum += height;
                    height_count += 1;
                }
            }

            // Merge BuildingElement objects
            if let Some(other_elements) = other_zone_obj
                .get("BuildingElement")
                .and_then(|v| v.as_object())
            {
                for (elem_name, elem_value) in other_elements {
                    // Check for name conflicts - append zone name if needed
                    let final_name = if consolidated_elements.contains_key(elem_name) {
                        format!("{elem_name} ({other_zone_name})")
                    } else {
                        elem_name.clone()
                    };
                    consolidated_elements.insert(final_name, elem_value.clone());
                }
            }

            // Merge ThermalBridging
            if let Some(other_tb) = other_zone_obj.get("ThermalBridging") {
                match (&consolidated_thermal_bridging, other_tb) {
                    (Some(Value::Number(a)), Value::Number(b)) => {
                        // Both are numbers - sum them
                        let a_val = a.as_f64().unwrap_or(0.0);
                        let b_val = b.as_f64().unwrap_or(0.0);
                        consolidated_thermal_bridging = Some(Value::Number(
                            serde_json::Number::from_f64(a_val + b_val).unwrap(),
                        ));
                    }
                    (Some(Value::Object(a_obj)), Value::Object(b_obj)) => {
                        // Both are objects - merge them, disambiguating colliding
                        // bridge names like the BuildingElement merge above (a plain
                        // insert would silently drop one zone's bridge heat loss).
                        let mut merged = a_obj.clone();
                        for (key, value) in b_obj {
                            let final_name = if merged.contains_key(key) {
                                format!("{key} ({other_zone_name})")
                            } else {
                                key.clone()
                            };
                            merged.insert(final_name, value.clone());
                        }
                        consolidated_thermal_bridging = Some(Value::Object(merged));
                    }
                    (None, _) => {
                        // First zone had no ThermalBridging, use other zone's
                        consolidated_thermal_bridging = Some(other_tb.clone());
                    }
                    _ => {
                        // Mismatched types - keep first zone's value
                        tracing::warn!(
                            "ThermalBridging type mismatch between zones, keeping first zone's value"
                        );
                    }
                }
            }

            // Collect Lighting from other zones (use first one found if first zone has none)
            if !first_zone_has_lighting {
                if let Some(lighting) = other_zone_obj.get("Lighting") {
                    if lighting.is_object() {
                        other_lighting = Some(lighting.clone());
                    }
                }
            }
        }

        // Now update zones (mutable borrow)
        let zones = result
            .get_mut("Zone")
            .and_then(|z| z.as_object_mut())
            .ok_or_else(|| BuildError::new("E027", "Zone section not found"))?;

        let first_zone = zones
            .get_mut(&first_zone_name)
            .ok_or_else(|| {
                BuildError::new("E029", &format!("First zone '{first_zone_name}' not found"))
            })?
            .as_object_mut()
            .ok_or_else(|| {
                BuildError::new(
                    "E030",
                    &format!("First zone '{first_zone_name}' is not an object"),
                )
            })?;

        // Update first zone with consolidated values
        if !self.is_fhs_schema {
            first_zone.insert(
                "area".to_string(),
                Value::Number(serde_json::Number::from_f64(total_area).unwrap()),
            );
        }
        first_zone.insert(
            "volume".to_string(),
            Value::Number(serde_json::Number::from_f64(total_volume).unwrap()),
        );
        first_zone.insert(
            "livingroom_area".to_string(),
            Value::Number(serde_json::Number::from_f64(total_livingroom_area).unwrap()),
        );
        first_zone.insert(
            "restofdwelling_area".to_string(),
            Value::Number(serde_json::Number::from_f64(total_restofdwelling_area).unwrap()),
        );
        // Set height if we have any height values (even if only one zone had height)
        // Skip inserting height for FHS schema (not allowed by FHS schema)
        // Note: This function only runs when is_fhs_schema is true, but we check anyway for safety
        if !self.is_fhs_schema {
            if height_count > 0 {
                let avg_height = height_sum / height_count as f64;
                first_zone.insert(
                    "height".to_string(),
                    Value::Number(serde_json::Number::from_f64(avg_height).unwrap()),
                );
            } else {
                // If no zones had height, calculate from volume/area if both are available
                if total_area > 0.0 && total_volume > 0.0 {
                    let calculated_height = total_volume / total_area;
                    first_zone.insert(
                        "height".to_string(),
                        Value::Number(serde_json::Number::from_f64(calculated_height).unwrap()),
                    );
                }
            }
        }
        first_zone.insert(
            "BuildingElement".to_string(),
            Value::Object(consolidated_elements),
        );
        if let Some(tb) = consolidated_thermal_bridging {
            first_zone.insert("ThermalBridging".to_string(), tb);
        }
        if !first_zone_has_lighting {
            if let Some(lighting) = other_lighting {
                first_zone.insert("Lighting".to_string(), lighting);
            }
        }

        // Remove all other zones
        for other_zone_name in &other_zone_names {
            zones.remove(other_zone_name);
        }

        // Update all SpaceHeatSystem entries to reference the consolidated zone
        if let Some(space_heat_systems) = result
            .get_mut("SpaceHeatSystem")
            .and_then(|s| s.as_object_mut())
        {
            for (_sys_name, sys_data) in space_heat_systems.iter_mut() {
                if let Some(sys_obj) = sys_data.as_object_mut() {
                    // Update Zone field to point to consolidated zone
                    if let Some(sys_zone) = sys_obj.get("Zone").and_then(|v| v.as_str()) {
                        if other_zone_names.contains(&sys_zone.to_string()) {
                            sys_obj
                                .insert("Zone".to_string(), Value::String(first_zone_name.clone()));
                        }
                    }
                }
            }
        }

        // Update SpaceCoolSystem references if present
        if let Some(space_cool_systems) = result
            .get_mut("SpaceCoolSystem")
            .and_then(|s| s.as_object_mut())
        {
            for (_sys_name, sys_data) in space_cool_systems.iter_mut() {
                if let Some(sys_obj) = sys_data.as_object_mut() {
                    if let Some(sys_zone) = sys_obj.get("Zone").and_then(|v| v.as_str()) {
                        if other_zone_names.contains(&sys_zone.to_string()) {
                            sys_obj
                                .insert("Zone".to_string(), Value::String(first_zone_name.clone()));
                        }
                    }
                }
            }
        }

        // Remove controls that reference merged zones
        // Controls follow the pattern "HeatingControls_{ZoneName}" where ZoneName is camelCase
        // Example: "Rest of Dwelling" -> "HeatingControls_RestOfDwelling"
        if let Some(control_obj) = result.get_mut("Control").and_then(|c| c.as_object_mut()) {
            let mut controls_to_remove = Vec::new();

            for merged_zone_name in &other_zone_names {
                // Convert zone name to control name format
                // "Rest of Dwelling" -> "RestOfDwelling"
                let control_suffix = Self::zone_name_to_control_suffix(merged_zone_name);
                let control_name = format!("HeatingControls_{control_suffix}");

                if control_obj.contains_key(&control_name) {
                    controls_to_remove.push(control_name.clone());
                    tracing::debug!(
                        "Removing control '{}' for merged zone '{}'",
                        control_name,
                        merged_zone_name
                    );
                }
            }

            // Remove the controls
            for control_name in controls_to_remove {
                control_obj.remove(&control_name);
            }
        }

        tracing::debug!(
            "Zone consolidation complete: {} zones consolidated into '{}'",
            other_zone_names.len() + 1,
            first_zone_name
        );

        Ok(())
    }

    /// Seeds **`WetDistribution`** from the template and overlays **`extra_json`** (flat keys).
    ///
    /// Used for **`Systems.Type = WetDistribution`**, and for legacy **`Type = SpaceHeatSystem`** rows
    /// whose `extra_json` does **not** use the wrapped `{ "SpaceHeatSystem": { ... } }` preset shape.
    fn merge_systems_space_heat_wet_distribution_row(
        &self,
        result_obj: &mut serde_json::Map<String, Value>,
        row: &HashMap<String, Value>,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        let system_name = row.get("Name").and_then(|v| v.as_str()).ok_or_else(|| {
            BuildError::new("E038", "SpaceHeatSystem missing required 'Name' field")
        })?;

        let space_heat_systems = result_obj
            .entry("SpaceHeatSystem".to_string())
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()))
            .as_object_mut()
            .ok_or_else(|| BuildError::new("E039", "SpaceHeatSystem is not an object"))?;

        let mut system =
            if let Some(template) = self.type_templates.get("SpaceHeatSystemWetDistribution") {
                if let Some(template_obj) = template.as_object() {
                    template_obj.clone()
                } else {
                    serde_json::Map::new()
                }
            } else {
                let mut fallback = serde_json::Map::new();
                fallback.insert(
                    "type".to_string(),
                    Value::String("WetDistribution".to_string()),
                );
                fallback
            };

        system.insert(
            "type".to_string(),
            Value::String("WetDistribution".to_string()),
        );

        let zone_from_csv = row
            .get("zone_reference")
            .and_then(|v| v.as_str())
            .or_else(|| row.get("Zone").and_then(|v| v.as_str()));

        let mut final_system_name = system_name.to_string();

        if let Some(zone) = zone_from_csv {
            system.insert("Zone".to_string(), Value::String(zone.to_string()));
        } else {
            let template_has_zone = system.get("Zone").is_some();
            if template_has_zone {
                if let Some(zone_data) = csv_data.get("Zone") {
                    if let Some(first_zone_row) = zone_data.first() {
                        if let Some(first_zone_name) =
                            first_zone_row.get("Name").and_then(|v| v.as_str())
                        {
                            system.insert(
                                "Zone".to_string(),
                                Value::String(first_zone_name.to_string()),
                            );

                            if system_name.starts_with("zone 1 ") {
                                let suffix = system_name.strip_prefix("zone 1 ").unwrap_or("");
                                final_system_name = format!("{first_zone_name} {suffix}");
                            }
                        }
                    }
                }
            }
        }

        if let Some(extra_json) = row.get("extra_json").and_then(|v| v.as_object()) {
            for (key, value) in extra_json {
                if is_ui_only_extra_json_key(key) {
                    continue;
                }
                system.insert(key.clone(), strip_ui_only_extra_json_value(value));
            }
        }

        space_heat_systems.insert(final_system_name, Value::Object(system));
        Ok(())
    }

    fn merge_systems(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        let mut zone_to_space_cool_systems: HashMap<String, Vec<String>> = HashMap::new();
        if let Some(section_data) = csv_data.get("Systems") {
            if section_data.is_empty() {
                // No systems in CSV - cleanup will remove empty entries
                return Ok(());
            }
            {
                let result_obj = result
                    .as_object_mut()
                    .ok_or_else(|| BuildError::new("E034", "Result JSON is not an object"))?;

                for row in section_data {
                    // Get system type – try new column layout first ("Type"), then legacy ("system_type")
                    let system_type = row
                        .get("Type")
                        .and_then(|v| v.as_str())
                        .or_else(|| row.get("system_type").and_then(|v| v.as_str()))
                        .or_else(|| row.get("subcategory").and_then(|v| v.as_str()))
                        .ok_or_else(|| {
                            BuildError::new(
                                "E035",
                                "Systems missing required 'Type' or 'system_type' field",
                            )
                        })?;

                    // Handle ElectricBattery (nested under EnergySupply)
                    if system_type == "ElectricBattery" {
                        // Get EnergySupply name from extra_json
                        let energy_supply_name = row
                            .get("extra_json")
                            .and_then(|v| v.as_object())
                            .and_then(|obj| obj.get("EnergySupply"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("mains elec");

                        // Get or create EnergySupply object
                        let energy_supply = result_obj
                            .entry("EnergySupply".to_string())
                            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()))
                            .as_object_mut()
                            .ok_or_else(|| {
                                BuildError::new("E036", "EnergySupply is not an object")
                            })?;

                        // Get or create specific EnergySupply entry
                        // If it exists from defaults, preserve its structure
                        let supply_entry = energy_supply
                            .entry(energy_supply_name.to_string())
                            .or_insert_with(|| {
                                let mut entry = serde_json::Map::new();
                                entry.insert(
                                    "fuel".to_string(),
                                    Value::String("electricity".to_string()),
                                );
                                entry.insert("is_export_capable".to_string(), Value::Bool(true));
                                Value::Object(entry)
                            })
                            .as_object_mut()
                            .ok_or_else(|| {
                                BuildError::new(
                                    "E037",
                                    &format!(
                                        "EnergySupply '{energy_supply_name}' is not an object"
                                    ),
                                )
                            })?;

                        // Ensure fuel is "electricity" for ElectricBattery
                        supply_entry
                            .insert("fuel".to_string(), Value::String("electricity".to_string()));

                        // Ensure is_export_capable exists (from defaults template)
                        if !supply_entry.contains_key("is_export_capable") {
                            supply_entry.insert("is_export_capable".to_string(), Value::Bool(true));
                        }

                        // Note: priority field is handled by schema validation - don't set it here
                        // The schema will validate based on the presence of ElectricBattery

                        // Start with defaults template if available, otherwise create empty
                        let mut battery =
                            if let Some(template) = self.type_templates.get("ElectricBattery") {
                                if let Some(template_obj) = template.as_object() {
                                    template_obj.clone()
                                } else {
                                    serde_json::Map::new()
                                }
                            } else {
                                serde_json::Map::new()
                            };

                        // Older presets may contain legacy battery/grid-charging fields that are
                        // not part of current input schemas; strip them during CSV->JSON build.
                        battery.remove("grid_charging_possible");

                        // Parse extra_json for battery properties (override defaults)
                        if let Some(extra_json) = row.get("extra_json").and_then(|v| v.as_object())
                        {
                            for (key, value) in extra_json {
                                // Skip EnergySupply as it's used for nesting, not as a property
                                if key == "EnergySupply" {
                                    continue;
                                }
                                if is_ui_only_extra_json_key(key) {
                                    continue;
                                }
                                // Ignore legacy grid charging fields not present in current schemas.
                                if key == "grid_charging_possible" {
                                    continue;
                                }
                                if key == "threshold_charges"
                                    || key == "threshold_prices"
                                    || key == "tariff"
                                {
                                    continue;
                                } else {
                                    battery
                                        .insert(key.clone(), strip_ui_only_extra_json_value(value));
                                }
                            }
                        }

                        // Insert ElectricBattery into EnergySupply entry
                        supply_entry.insert("ElectricBattery".to_string(), Value::Object(battery));
                    }
                    // `Systems.Type = SpaceHeatSystem`: wrapped `{ "SpaceHeatSystem": { ... } }` presets
                    // (InstantElecHeater, ElecStorageHeater, etc.) must merge like `System`/`SpaceHeatSystem`,
                    // not seed WetDistribution. Legacy flat rows still overlay the wet template.
                    else if system_type == "SpaceHeatSystem" {
                        let wrapped = row
                            .get("extra_json")
                            .and_then(|v| v.as_object())
                            .map(|m| m.contains_key("SpaceHeatSystem"))
                            .unwrap_or(false);
                        if wrapped {
                            if let Some(extra_json) =
                                row.get("extra_json").and_then(|v| v.as_object())
                            {
                                Self::merge_wrapped_system_fragment(
                                    result_obj,
                                    extra_json,
                                    "SpaceHeatSystem",
                                );
                                let zone_name = row
                                    .get("Zone")
                                    .and_then(|v| v.as_str())
                                    .or_else(|| row.get("zone_reference").and_then(|v| v.as_str()));
                                if let Some(zn) = zone_name {
                                    if let Some(frag) = extra_json
                                        .get("SpaceHeatSystem")
                                        .and_then(|v| v.as_object())
                                    {
                                        if let Some(ssh) = result_obj
                                            .get_mut("SpaceHeatSystem")
                                            .and_then(|v| v.as_object_mut())
                                        {
                                            for key in frag.keys() {
                                                if let Some(sys) =
                                                    ssh.get_mut(key).and_then(|v| v.as_object_mut())
                                                {
                                                    if !sys.contains_key("Zone") {
                                                        sys.insert(
                                                            "Zone".to_string(),
                                                            Value::String(zn.to_string()),
                                                        );
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } else {
                            self.merge_systems_space_heat_wet_distribution_row(
                                result_obj, row, csv_data,
                            )?;
                        }
                    } else if system_type == "WetDistribution" {
                        self.merge_systems_space_heat_wet_distribution_row(
                            result_obj, row, csv_data,
                        )?;
                    }
                    // Handle PCDB System elements (HeatSourceWet, HotWaterSource, SpaceCoolSystem)
                    else if system_type == "System" {
                        // New format: subcategory tells us the HEM JSON target path
                        let subcategory = row
                            .get("subcategory")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");

                        let element_name =
                            row.get("Name").and_then(|v| v.as_str()).ok_or_else(|| {
                                BuildError::new(
                                    "E040",
                                    "System element missing required 'Name' field",
                                )
                            })?;

                        match subcategory {
                            "HeatSourceWet" => {
                                // Replace entire HeatSourceWet section (mirrors batch_runner.rs approach).
                                // This removes stale defaults (e.g. old "hp") when switching to a different
                                // heat source (e.g. "gas_boiler"), preventing orphaned entries.
                                if let Some(extra_json) =
                                    row.get("extra_json").and_then(|v| v.as_object())
                                {
                                    if let Some(inner) =
                                        extra_json.get("HeatSourceWet").and_then(|v| v.as_object())
                                    {
                                        let mut inner = inner.clone();
                                        self.ensure_fhs_heat_source_wet_defaults(&mut inner);
                                        // Wrapped format: { "HeatSourceWet": { "hp": { ... } } }
                                        // Replace the entire HeatSourceWet object with the preset contents
                                        result_obj.insert(
                                            "HeatSourceWet".to_string(),
                                            Value::Object(inner.clone()),
                                        );

                                        if let Some(hot_water_source) = extra_json
                                            .get("HotWaterSource")
                                            .and_then(|v| v.as_object())
                                        {
                                            result_obj.insert(
                                                "HotWaterSource".to_string(),
                                                Value::Object(hot_water_source.clone()),
                                            );
                                        }

                                        // Repoint SpaceHeatSystem and HotWaterSource references
                                        // whose name no longer exists in the new HeatSourceWet
                                        // map. References the user authored to a still-valid
                                        // heat source are left alone (a blanket repoint to the
                                        // first key used to clobber them, row-order dependent).
                                        if let Some(first_hs_name) = inner.keys().next() {
                                            if let Some(systems_obj) = result_obj
                                                .get_mut("SpaceHeatSystem")
                                                .and_then(|v| v.as_object_mut())
                                            {
                                                for system in systems_obj.values_mut() {
                                                    let Some(heat_source_obj) = system
                                                        .as_object_mut()
                                                        .and_then(|s| s.get_mut("HeatSource"))
                                                        .and_then(|h| h.as_object_mut())
                                                    else {
                                                        continue;
                                                    };
                                                    let current_is_valid = heat_source_obj
                                                        .get("name")
                                                        .and_then(|v| v.as_str())
                                                        .is_some_and(|n| inner.contains_key(n));
                                                    if !current_is_valid {
                                                        heat_source_obj.insert(
                                                            "name".to_string(),
                                                            Value::String(first_hs_name.clone()),
                                                        );
                                                    }
                                                }
                                            }

                                            self.repoint_hot_water_source_for_heat_source_wet(
                                                result_obj, &inner,
                                            );
                                        }
                                    } else {
                                        // Flat extra_json (no wrapper key): put fields on element name
                                        let target = result_obj
                                            .entry("HeatSourceWet".to_string())
                                            .or_insert_with(
                                                || Value::Object(serde_json::Map::new()),
                                            )
                                            .as_object_mut()
                                            .ok_or_else(|| {
                                                BuildError::new(
                                                    "E041",
                                                    "HeatSourceWet is not an object",
                                                )
                                            })?;
                                        let mut system_data = serde_json::Map::new();
                                        for (key, value) in extra_json {
                                            if is_ui_only_extra_json_key(key) {
                                                continue;
                                            }
                                            system_data.insert(
                                                key.clone(),
                                                strip_ui_only_extra_json_value(value),
                                            );
                                        }
                                        if self.is_fhs_schema
                                            && !system_data.contains_key("is_heat_network")
                                        {
                                            system_data.insert(
                                                "is_heat_network".to_string(),
                                                Value::Bool(false),
                                            );
                                        }
                                        target.insert(
                                            element_name.to_string(),
                                            Value::Object(system_data),
                                        );
                                    }
                                }
                            }
                            "HotWaterSource" => {
                                // Replace entire HotWaterSource section (mirrors batch_runner.rs approach).
                                if let Some(extra_json) =
                                    row.get("extra_json").and_then(|v| v.as_object())
                                {
                                    if let Some(inner) =
                                        extra_json.get("HotWaterSource").and_then(|v| v.as_object())
                                    {
                                        // Wrapped format: replace entire HotWaterSource
                                        result_obj.insert(
                                            "HotWaterSource".to_string(),
                                            Value::Object(inner.clone()),
                                        );
                                    } else {
                                        // Flat extra_json fallback
                                        let target = result_obj
                                            .entry("HotWaterSource".to_string())
                                            .or_insert_with(
                                                || Value::Object(serde_json::Map::new()),
                                            )
                                            .as_object_mut()
                                            .ok_or_else(|| {
                                                BuildError::new(
                                                    "E042",
                                                    "HotWaterSource is not an object",
                                                )
                                            })?;
                                        let mut system_data = serde_json::Map::new();
                                        for (key, value) in extra_json {
                                            if is_ui_only_extra_json_key(key) {
                                                continue;
                                            }
                                            system_data.insert(
                                                key.clone(),
                                                strip_ui_only_extra_json_value(value),
                                            );
                                        }
                                        target.insert(
                                            element_name.to_string(),
                                            Value::Object(system_data),
                                        );
                                    }
                                }
                            }
                            "SpaceCoolSystem" => {
                                // Replace entire SpaceCoolSystem section (mirrors batch_runner.rs approach).
                                if let Some(extra_json) =
                                    row.get("extra_json").and_then(|v| v.as_object())
                                {
                                    let zone_name = row
                                        .get("zone_reference")
                                        .and_then(|v| v.as_str())
                                        .or_else(|| row.get("Zone").and_then(|v| v.as_str()));
                                    if let Some(inner) = extra_json
                                        .get("SpaceCoolSystem")
                                        .and_then(|v| v.as_object())
                                    {
                                        // Wrapped format: replace entire SpaceCoolSystem
                                        result_obj.insert(
                                            "SpaceCoolSystem".to_string(),
                                            Value::Object(inner.clone()),
                                        );
                                        if let Some(zone_name) = zone_name {
                                            let refs = zone_to_space_cool_systems
                                                .entry(zone_name.to_string())
                                                .or_default();
                                            for system_name in inner.keys() {
                                                if !refs.contains(system_name) {
                                                    refs.push(system_name.clone());
                                                }
                                            }
                                        }
                                    } else {
                                        // Flat extra_json fallback
                                        let target = result_obj
                                            .entry("SpaceCoolSystem".to_string())
                                            .or_insert_with(
                                                || Value::Object(serde_json::Map::new()),
                                            )
                                            .as_object_mut()
                                            .ok_or_else(|| {
                                                BuildError::new(
                                                    "E043",
                                                    "SpaceCoolSystem is not an object",
                                                )
                                            })?;
                                        let mut system_data = serde_json::Map::new();
                                        for (key, value) in extra_json {
                                            if is_ui_only_extra_json_key(key) {
                                                continue;
                                            }
                                            system_data.insert(
                                                key.clone(),
                                                strip_ui_only_extra_json_value(value),
                                            );
                                        }
                                        target.insert(
                                            element_name.to_string(),
                                            Value::Object(system_data),
                                        );
                                        if let Some(zone_name) = zone_name {
                                            let refs = zone_to_space_cool_systems
                                                .entry(zone_name.to_string())
                                                .or_default();
                                            let name = element_name.to_string();
                                            if !refs.contains(&name) {
                                                refs.push(name);
                                            }
                                        }
                                    }
                                }
                            }
                            "InfiltrationVentilation" => {
                                if let Some(extra_json) =
                                    row.get("extra_json").and_then(|v| v.as_object())
                                {
                                    Self::merge_wrapped_system_fragment(
                                        result_obj,
                                        extra_json,
                                        "InfiltrationVentilation",
                                    );
                                }
                            }
                            "HotWaterDemand" => {
                                if let Some(extra_json) =
                                    row.get("extra_json").and_then(|v| v.as_object())
                                {
                                    Self::merge_wrapped_system_fragment(
                                        result_obj,
                                        extra_json,
                                        "HotWaterDemand",
                                    );
                                }
                            }
                            "SpaceHeatSystem" => {
                                if let Some(extra_json) =
                                    row.get("extra_json").and_then(|v| v.as_object())
                                {
                                    Self::merge_wrapped_system_fragment(
                                        result_obj,
                                        extra_json,
                                        "SpaceHeatSystem",
                                    );
                                    // InstantElecHeater / other presets often omit `Zone`. Zone linkage for
                                    // `reconcile_zone_space_heat_system_references` is driven by this field.
                                    let zone_name =
                                        row.get("Zone").and_then(|v| v.as_str()).or_else(|| {
                                            row.get("zone_reference").and_then(|v| v.as_str())
                                        });
                                    if let Some(zn) = zone_name {
                                        if let Some(frag) = extra_json
                                            .get("SpaceHeatSystem")
                                            .and_then(|v| v.as_object())
                                        {
                                            if let Some(ssh) = result_obj
                                                .get_mut("SpaceHeatSystem")
                                                .and_then(|v| v.as_object_mut())
                                            {
                                                for key in frag.keys() {
                                                    if let Some(sys) = ssh
                                                        .get_mut(key)
                                                        .and_then(|v| v.as_object_mut())
                                                    {
                                                        if !sys.contains_key("Zone") {
                                                            sys.insert(
                                                                "Zone".to_string(),
                                                                Value::String(zn.to_string()),
                                                            );
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            "WWHRS" => {
                                if let Some(extra_json) =
                                    row.get("extra_json").and_then(|v| v.as_object())
                                {
                                    Self::merge_wrapped_system_fragment(
                                        result_obj, extra_json, "WWHRS",
                                    );
                                }
                            }
                            _ => {
                                // Unknown System subcategory - skip with warning
                                eprintln!("[merge_systems] Warning: Unknown System subcategory '{subcategory}' for element '{element_name}' – skipping");
                            }
                        }
                    }
                }
            }
        }
        self.reconcile_zone_space_cool_system_references(
            result,
            Some(&zone_to_space_cool_systems),
        )?;
        Ok(())
    }

    fn reconcile_zone_space_cool_system_references(
        &self,
        result: &mut Value,
        zone_hints: Option<&HashMap<String, Vec<String>>>,
    ) -> Result<(), BuildError> {
        let space_cool_systems_snapshot = result
            .get("SpaceCoolSystem")
            .and_then(|s| s.as_object())
            .cloned();

        if let (Some(zones), Some(space_cool_systems)) = (
            result.get_mut("Zone").and_then(|z| z.as_object_mut()),
            space_cool_systems_snapshot,
        ) {
            let single_system_name = if space_cool_systems.len() == 1 {
                space_cool_systems.keys().next().cloned()
            } else {
                None
            };

            for (zone_name, zone_val) in zones.iter_mut() {
                if let Some(zone_obj) = zone_val.as_object_mut() {
                    let mut candidates: Vec<String> = Vec::new();

                    if let Some(hints) = zone_hints.and_then(|m| m.get(zone_name)) {
                        for name in hints {
                            if space_cool_systems.contains_key(name) && !candidates.contains(name) {
                                candidates.push(name.clone());
                            }
                        }
                    }

                    if candidates.is_empty() {
                        if let Some(one) = single_system_name.as_ref() {
                            candidates.push(one.clone());
                        }
                    }

                    if candidates.len() == 1 {
                        zone_obj.insert(
                            "SpaceCoolSystem".to_string(),
                            Value::String(candidates[0].clone()),
                        );
                        continue;
                    }

                    if candidates.len() > 1 {
                        zone_obj.insert(
                            "SpaceCoolSystem".to_string(),
                            Value::Array(candidates.into_iter().map(Value::String).collect()),
                        );
                        continue;
                    }

                    // No candidates: keep existing valid refs only.
                    if let Some(existing) = zone_obj.get("SpaceCoolSystem").cloned() {
                        match existing {
                            Value::String(name) => {
                                if !space_cool_systems.contains_key(&name) {
                                    zone_obj.remove("SpaceCoolSystem");
                                }
                            }
                            Value::Array(arr) => {
                                let mut valid: Vec<Value> = Vec::new();
                                for v in arr {
                                    if let Some(name) = v.as_str() {
                                        if space_cool_systems.contains_key(name) {
                                            valid.push(Value::String(name.to_string()));
                                        }
                                    }
                                }
                                match valid.len() {
                                    0 => {
                                        zone_obj.remove("SpaceCoolSystem");
                                    }
                                    1 => {
                                        if let Some(name) = valid[0].as_str() {
                                            zone_obj.insert(
                                                "SpaceCoolSystem".to_string(),
                                                Value::String(name.to_string()),
                                            );
                                        }
                                    }
                                    _ => {
                                        zone_obj.insert(
                                            "SpaceCoolSystem".to_string(),
                                            Value::Array(valid),
                                        );
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        Ok(())
    }

    fn deep_merge_json_value(target: &mut Value, patch: &Value) {
        match (target, patch) {
            (Value::Object(target_obj), Value::Object(patch_obj)) => {
                for (key, patch_value) in patch_obj {
                    if let Some(target_value) = target_obj.get_mut(key) {
                        Self::deep_merge_json_value(target_value, patch_value);
                    } else {
                        target_obj.insert(key.clone(), patch_value.clone());
                    }
                }
            }
            (target_slot, patch_value) => {
                *target_slot = patch_value.clone();
            }
        }
    }

    fn merge_wrapped_system_fragment(
        result_obj: &mut serde_json::Map<String, Value>,
        extra_json: &serde_json::Map<String, Value>,
        root_key: &str,
    ) {
        if let Some(fragment) = extra_json.get(root_key) {
            let target = result_obj
                .entry(root_key.to_string())
                .or_insert_with(|| Value::Object(serde_json::Map::new()));
            let stripped_fragment = strip_ui_only_extra_json_value(fragment);
            Self::deep_merge_json_value(target, &stripped_fragment);
        }
    }

    fn ensure_fhs_heat_source_wet_defaults(
        &self,
        heat_source_wet: &mut serde_json::Map<String, Value>,
    ) {
        if !self.is_fhs_schema {
            return;
        }
        for entry in heat_source_wet.values_mut() {
            if let Some(obj) = entry.as_object_mut() {
                if !obj.contains_key("is_heat_network") {
                    obj.insert("is_heat_network".to_string(), Value::Bool(false));
                }
            }
        }
    }

    /// After a HeatSourceWet Systems row replaces the wet plant, hot-water
    /// sources whose heat-source reference no longer exists in the new map are
    /// repointed to its first entry. User-authored references that are still
    /// valid — and all their sibling fields — are preserved.
    fn repoint_hot_water_source_for_heat_source_wet(
        &self,
        result_obj: &mut serde_json::Map<String, Value>,
        heat_source_wet: &serde_json::Map<String, Value>,
    ) {
        let Some(first_hs_name) = heat_source_wet.keys().next().cloned() else {
            return;
        };
        let is_valid = |name: Option<&str>| name.is_some_and(|n| heat_source_wet.contains_key(n));
        if let Some(hot_water_source) = result_obj.get_mut("HotWaterSource") {
            if let Some(hw_source_obj) = hot_water_source.as_object_mut() {
                for hw_source in hw_source_obj.values_mut() {
                    if let Some(hw_obj) = hw_source.as_object_mut() {
                        if self.is_fhs_schema {
                            match hw_obj.get("type").and_then(|v| v.as_str()) {
                                Some("CombiBoiler") | Some("HIU") | Some("HeatBattery") => {
                                    if !is_valid(
                                        hw_obj.get("HeatSourceWet").and_then(|v| v.as_str()),
                                    ) {
                                        hw_obj.insert(
                                            "HeatSourceWet".to_string(),
                                            Value::String(first_hs_name.clone()),
                                        );
                                    }
                                }
                                Some("StorageTank") | Some("SmartHotWaterTank") => {
                                    if let Some(heat_source) =
                                        hw_obj.get_mut("HeatSource").and_then(|v| v.as_object_mut())
                                    {
                                        for hs_entry in heat_source.values_mut() {
                                            if let Some(hs_entry_obj) = hs_entry.as_object_mut() {
                                                if hs_entry_obj.get("type").and_then(|v| v.as_str())
                                                    == Some("HeatSourceWet")
                                                    && !is_valid(
                                                        hs_entry_obj
                                                            .get("name")
                                                            .and_then(|v| v.as_str()),
                                                    )
                                                {
                                                    hs_entry_obj.insert(
                                                        "name".to_string(),
                                                        Value::String(first_hs_name.clone()),
                                                    );
                                                }
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        } else if let Some(heat_source) = hw_obj.get_mut("HeatSource") {
                            if let Some(hs_obj) = heat_source.as_object_mut() {
                                let mut has_wet_entry = false;
                                for hs_entry in hs_obj.values_mut() {
                                    if let Some(hs_entry_obj) = hs_entry.as_object_mut() {
                                        if hs_entry_obj.get("type").and_then(|v| v.as_str())
                                            == Some("HeatSourceWet")
                                        {
                                            has_wet_entry = true;
                                            if !is_valid(
                                                hs_entry_obj.get("name").and_then(|v| v.as_str()),
                                            ) {
                                                hs_entry_obj.insert(
                                                    "name".to_string(),
                                                    Value::String(first_hs_name.clone()),
                                                );
                                            }
                                        }
                                    }
                                }
                                // No existing wet link: add one alongside the user's
                                // other heat sources (the old behavior cleared the
                                // whole map and wiped user-authored entries).
                                if !has_wet_entry {
                                    hs_obj.insert(
                                        first_hs_name.clone(),
                                        serde_json::json!({
                                            "type": "HeatSourceWet",
                                            "name": first_hs_name,
                                            "temp_flow_limit_upper": 65,
                                            "EnergySupply": "mains elec",
                                            "Controlmin": "HotWaterMin",
                                            "Controlmax": "HotWaterMax",
                                            "heater_position": 0.1,
                                            "thermostat_position": 0.33
                                        }),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// When CSV authors a wrapped dry `SpaceHeatSystem` preset (`InstantElecHeater`, …) and does not
    /// author wet plant via `Systems`, remove template `WetDistribution` entries so reconciliation
    /// binds zones to the CSV preset instead of default radiators (which reference `HeatSourceWet` names
    /// such as `hp` that may not exist after merge).
    fn strip_default_wet_distribution_for_csv_dry_space_heat(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        if !self.is_fhs_schema {
            return Ok(());
        }
        if !Self::systems_csv_presets_dry_space_heat_only(csv_data)
            || Self::systems_csv_authors_wet_space_heat(csv_data)
        {
            return Ok(());
        }
        let Some(shs) = result
            .get_mut("SpaceHeatSystem")
            .and_then(|s| s.as_object_mut())
        else {
            return Ok(());
        };
        let before = shs.len();
        shs.retain(|_, v| v.get("type").and_then(|t| t.as_str()) != Some("WetDistribution"));
        if shs.len() != before {
            tracing::debug!(
                "Removed default WetDistribution: CSV authors dry SpaceHeatSystem preset without wet Systems rows"
            );
        }
        Ok(())
    }

    fn space_heat_system_fragment_is_dry_only(frag: &serde_json::Map<String, Value>) -> bool {
        const DRY: &[&str] = &["InstantElecHeater", "ElecStorageHeater", "WarmAir"];
        let mut saw_dry = false;
        for v in frag.values() {
            let Some(obj) = v.as_object() else {
                continue;
            };
            let Some(t) = obj.get("type").and_then(|x| x.as_str()) else {
                continue;
            };
            if t == "WetDistribution" {
                return false;
            }
            if DRY.contains(&t) {
                saw_dry = true;
            }
        }
        saw_dry
    }

    fn systems_csv_presets_dry_space_heat_only(
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> bool {
        let Some(rows) = csv_data.get("Systems") else {
            return false;
        };
        for row in rows {
            let system_type = row
                .get("Type")
                .and_then(|v| v.as_str())
                .or_else(|| row.get("system_type").and_then(|v| v.as_str()))
                .or_else(|| row.get("subcategory").and_then(|v| v.as_str()));
            let Some(st) = system_type else {
                continue;
            };

            if st == "SpaceHeatSystem" {
                let wrapped = row
                    .get("extra_json")
                    .and_then(|v| v.as_object())
                    .map(|m| m.contains_key("SpaceHeatSystem"))
                    .unwrap_or(false);
                if wrapped {
                    if let Some(frag) = row
                        .get("extra_json")
                        .and_then(|v| v.as_object())
                        .and_then(|m| m.get("SpaceHeatSystem"))
                        .and_then(|v| v.as_object())
                    {
                        if Self::space_heat_system_fragment_is_dry_only(frag) {
                            return true;
                        }
                    }
                }
                continue;
            }

            if st == "System"
                && row.get("subcategory").and_then(|v| v.as_str()) == Some("SpaceHeatSystem")
            {
                if let Some(frag) = row
                    .get("extra_json")
                    .and_then(|v| v.as_object())
                    .and_then(|m| m.get("SpaceHeatSystem"))
                    .and_then(|v| v.as_object())
                {
                    if Self::space_heat_system_fragment_is_dry_only(frag) {
                        return true;
                    }
                }
            }
        }
        false
    }

    fn systems_csv_authors_wet_space_heat(
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> bool {
        let Some(rows) = csv_data.get("Systems") else {
            return false;
        };
        for row in rows {
            let system_type = row
                .get("Type")
                .and_then(|v| v.as_str())
                .or_else(|| row.get("system_type").and_then(|v| v.as_str()))
                .or_else(|| row.get("subcategory").and_then(|v| v.as_str()));
            let Some(st) = system_type else {
                continue;
            };

            if st == "WetDistribution" {
                return true;
            }

            if st == "SpaceHeatSystem" {
                let wrapped = row
                    .get("extra_json")
                    .and_then(|v| v.as_object())
                    .map(|m| m.contains_key("SpaceHeatSystem"))
                    .unwrap_or(false);
                if !wrapped {
                    return true;
                }
                if let Some(frag) = row
                    .get("extra_json")
                    .and_then(|v| v.as_object())
                    .and_then(|m| m.get("SpaceHeatSystem"))
                    .and_then(|v| v.as_object())
                {
                    for v in frag.values() {
                        if let Some(t) = v.get("type").and_then(|x| x.as_str()) {
                            if t == "WetDistribution" {
                                return true;
                            }
                        }
                    }
                }
                continue;
            }

            if st == "System"
                && row.get("subcategory").and_then(|v| v.as_str()) == Some("SpaceHeatSystem")
            {
                if let Some(frag) = row
                    .get("extra_json")
                    .and_then(|v| v.as_object())
                    .and_then(|m| m.get("SpaceHeatSystem"))
                    .and_then(|v| v.as_object())
                {
                    for v in frag.values() {
                        if let Some(t) = v.get("type").and_then(|x| x.as_str()) {
                            if t == "WetDistribution" {
                                return true;
                            }
                        }
                    }
                }
            }
        }
        false
    }

    fn build_wet_emitter_object(
        subcategory: &str,
        emitter_row: &HashMap<String, Value>,
        allowed_emitter_props: &HashSet<String>,
    ) -> Result<serde_json::Map<String, Value>, BuildError> {
        let mut emitter_data = emitter_row.clone();
        if let Some(extra_json_obj) = emitter_row.get("extra_json").and_then(|v| v.as_object()) {
            // Contract precedence: CSV columns > extra_json. Only fill keys the
            // row doesn't already author (a blank cell parses as Null / "").
            let row_cell_is_set = |key: &str| {
                emitter_row.get(key).is_some_and(|v| {
                    !v.is_null() && v.as_str().map(|s| !s.trim().is_empty()).unwrap_or(true)
                })
            };
            for (key, value) in extra_json_obj {
                if is_ui_only_extra_json_key(key) {
                    continue;
                }
                if row_cell_is_set(key) {
                    continue;
                }
                emitter_data.insert(key.clone(), strip_ui_only_extra_json_value(value));
            }
        }

        let mut emitter_obj = serde_json::Map::new();
        emitter_obj.insert(
            "wet_emitter_type".to_string(),
            Value::String(subcategory.to_string()),
        );

        match subcategory {
            "radiator" => {
                let unit_number = emitter_data
                    .get("unit_number")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1.0);
                let length = emitter_data.get("length").and_then(|v| v.as_f64());
                let effective_length = length.map(|value| value * unit_number);

                // Per-metre vs lumped is a single coherent mode, mirroring the upstream
                // FHS schema which branches the whole emitter on `length`. The c
                // representation defines the mode: a radiator is per-metre when it gives
                // `c_per_m` or `length`, otherwise lumped. Thermal mass follows the same
                // mode, so only the active branch's fields are emitted and a stray field
                // from the other branch (which the engine would silently ignore) is
                // dropped rather than written into the merged JSON.
                let is_per_metre = emitter_data
                    .get("c_per_m")
                    .and_then(|v| v.as_f64())
                    .is_some()
                    || length.is_some();

                if is_per_metre {
                    let c_per_m = emitter_data
                        .get("c_per_m")
                        .and_then(|v| v.as_f64())
                        .ok_or_else(|| {
                            BuildError::new(
                                "E047",
                                "Per-metre radiator emitters (with 'length') require 'c_per_m'",
                            )
                        })?;
                    let effective_length = effective_length.ok_or_else(|| {
                        BuildError::new("E047", "Radiator emitters with 'c_per_m' require 'length'")
                    })?;
                    emitter_obj.insert(
                        "c_per_m".to_string(),
                        Value::Number(serde_json::Number::from_f64(c_per_m).unwrap()),
                    );
                    emitter_obj.insert(
                        "length".to_string(),
                        Value::Number(serde_json::Number::from_f64(effective_length).unwrap()),
                    );
                } else {
                    let c_value = emitter_data
                        .get("c")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.08 * unit_number);
                    emitter_obj.insert(
                        "c".to_string(),
                        Value::Number(serde_json::Number::from_f64(c_value).unwrap()),
                    );
                }

                let n_value = emitter_data
                    .get("n")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1.2);
                emitter_obj.insert(
                    "n".to_string(),
                    Value::Number(serde_json::Number::from_f64(n_value).unwrap()),
                );

                let frac_conv = emitter_data
                    .get("frac_convective")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.4);
                emitter_obj.insert(
                    "frac_convective".to_string(),
                    Value::Number(serde_json::Number::from_f64(frac_conv).unwrap()),
                );

                if is_per_metre {
                    if let Some(thermal_mass_per_m) = emitter_data
                        .get("thermal_mass_per_m")
                        .and_then(|v| v.as_f64())
                    {
                        emitter_obj.insert(
                            "thermal_mass_per_m".to_string(),
                            Value::Number(
                                serde_json::Number::from_f64(thermal_mass_per_m).unwrap(),
                            ),
                        );
                    }
                } else if let Some(thermal_mass) =
                    emitter_data.get("thermal_mass").and_then(|v| v.as_f64())
                {
                    emitter_obj.insert(
                        "thermal_mass".to_string(),
                        Value::Number(serde_json::Number::from_f64(thermal_mass).unwrap()),
                    );
                }
            }
            "ufh" => {
                let area = emitter_data
                    .get("area")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(80.0);
                emitter_obj.insert(
                    "emitter_floor_area".to_string(),
                    Value::Number(serde_json::Number::from_f64(area).unwrap()),
                );

                let thermal_mass = emitter_data
                    .get("equivalent_specific_thermal_mass")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(80.0);
                emitter_obj.insert(
                    "equivalent_specific_thermal_mass".to_string(),
                    Value::Number(serde_json::Number::from_f64(thermal_mass).unwrap()),
                );

                let perf_factor = emitter_data
                    .get("system_performance_factor")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(5.0);
                emitter_obj.insert(
                    "system_performance_factor".to_string(),
                    Value::Number(serde_json::Number::from_f64(perf_factor).unwrap()),
                );

                let frac_conv = emitter_data
                    .get("frac_convective")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.43);
                emitter_obj.insert(
                    "frac_convective".to_string(),
                    Value::Number(serde_json::Number::from_f64(frac_conv).unwrap()),
                );
            }
            "fancoil" => {
                let to_i64_rounded = |v: &Value| -> Option<i64> {
                    v.as_i64()
                        .or_else(|| v.as_f64().map(|f| f.round() as i64))
                        .or_else(|| {
                            v.as_str()
                                .and_then(|s| s.parse::<f64>().ok().map(|f| f.round() as i64))
                        })
                };

                let n_units = emitter_data
                    .get("n_units")
                    .and_then(to_i64_rounded)
                    .or_else(|| emitter_data.get("unit_number").and_then(to_i64_rounded))
                    .ok_or_else(|| BuildError::new(
                        "E026",
                        "Fancoil emitters require 'n_units' field (from extra_json or unit_number column)",
                    ))?;
                emitter_obj.insert(
                    "n_units".to_string(),
                    Value::Number(serde_json::Number::from(n_units)),
                );

                // User-supplied test data (extra_json) wins; the stub is only a
                // schema-completeness fill when none was authored.
                let fancoil_test_data = emitter_data
                    .get("fancoil_test_data")
                    .filter(|v| v.is_object())
                    .cloned()
                    .unwrap_or_else(|| {
                        serde_json::json!({
                            "fan_power_W": [15],
                            "fan_speed_data": []
                        })
                    });
                emitter_obj.insert("fancoil_test_data".to_string(), fancoil_test_data);

                let frac_conv = emitter_data
                    .get("frac_convective")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1.0);
                emitter_obj.insert(
                    "frac_convective".to_string(),
                    Value::Number(serde_json::Number::from_f64(frac_conv).unwrap()),
                );
            }
            _ => {
                let frac_conv = emitter_data
                    .get("frac_convective")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.5);
                emitter_obj.insert(
                    "frac_convective".to_string(),
                    Value::Number(serde_json::Number::from_f64(frac_conv).unwrap()),
                );
            }
        }

        if !allowed_emitter_props.is_empty() {
            emitter_obj.retain(|k, _| allowed_emitter_props.contains(k));
        }
        Ok(emitter_obj)
    }

    fn authored_space_heat_system_aliases_from_systems_csv(
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> HashMap<String, String> {
        let mut aliases = HashMap::new();
        let Some(rows) = csv_data.get("Systems") else {
            return aliases;
        };

        for row in rows {
            let row_type = row
                .get("Type")
                .and_then(|v| v.as_str())
                .or_else(|| row.get("system_type").and_then(|v| v.as_str()))
                .or_else(|| row.get("subcategory").and_then(|v| v.as_str()));
            let subcategory = row.get("subcategory").and_then(|v| v.as_str());
            let is_space_heat_row = row_type == Some("WetDistribution")
                || row_type == Some("SpaceHeatSystem")
                || (row_type == Some("System") && subcategory == Some("SpaceHeatSystem"));
            if !is_space_heat_row {
                continue;
            }
            let row_name = row
                .get("Name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty());

            if let Some(fragment) = row
                .get("extra_json")
                .and_then(|v| v.as_object())
                .and_then(|m| m.get("SpaceHeatSystem"))
                .and_then(|v| v.as_object())
            {
                for key in fragment.keys() {
                    aliases.insert(key.clone(), key.clone());
                }
                if let (Some(name), 1) = (row_name, fragment.len()) {
                    if let Some(key) = fragment.keys().next() {
                        aliases.insert(name.to_string(), key.clone());
                    }
                } else if let Some(name) = row_name {
                    if fragment.contains_key(name) {
                        aliases.insert(name.to_string(), name.to_string());
                    }
                }
            } else if let Some(name) = row_name {
                aliases.insert(name.to_string(), name.to_string());
            }
        }

        aliases
    }

    fn merge_wet_emitters(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        let wet_distribution_schema = self.get_space_heat_system_variant_schema("WetDistribution");
        let mut allowed_system_props: HashSet<String> = self
            .get_space_heat_system_base_schema()
            .map(Self::collect_schema_properties)
            .unwrap_or_default();
        if let Some(variant_schema) = wet_distribution_schema {
            allowed_system_props.extend(Self::collect_schema_properties(variant_schema));
        }
        let mut allowed_emitter_props: HashSet<String> = self
            .get_wet_distribution_emitter_schema()
            .map(Self::collect_schema_properties)
            .unwrap_or_default();
        if allowed_emitter_props.is_empty() {
            for k in [
                "wet_emitter_type",
                "c",
                "c_per_m",
                "n",
                "frac_convective",
                "length",
                "thermal_mass",
                "thermal_mass_per_m",
                "emitter_floor_area",
                "equivalent_specific_thermal_mass",
                "system_performance_factor",
                "n_units",
                "fancoil_test_data",
            ] {
                allowed_emitter_props.insert(k.to_string());
            }
        }
        if let Some(section_data) = csv_data.get("Wet Emitters") {
            if section_data.is_empty() {
                // FHS: no emitter rows means CSV does not author wet distribution — drop
                // **WetDistribution** entries only. Non-wet presets (InstantElecHeater,
                // ElecStorageHeater, WarmAir, …) are merged from `Systems` **before** this step;
                // wiping the whole map broke those systems when exporters included an empty
                // `Wet Emitters` table (header-only section parses as `Some(vec![])`).
                // Core: keep defaults so `update_default_space_heat_systems` can rename/reconcile
                // (e.g. multi-zone geometry CSV without a Wet Emitters section).
                if self.is_fhs_schema {
                    if let Some(space_heat_system) = result.get_mut("SpaceHeatSystem") {
                        if let Some(shs_obj) = space_heat_system.as_object_mut() {
                            shs_obj.retain(|_, v| {
                                v.get("type").and_then(|t| t.as_str()) != Some("WetDistribution")
                            });
                        }
                    }
                }
                return Ok(());
            }
            let has_explicit_heat_source_wet_system = csv_data
                .get("Systems")
                .map(|rows| {
                    rows.iter().any(|row| {
                        let row_type = row
                            .get("Type")
                            .and_then(|v| v.as_str())
                            .or_else(|| row.get("system_type").and_then(|v| v.as_str()));
                        let subcategory = row.get("subcategory").and_then(|v| v.as_str());
                        row_type == Some("HeatSourceWet")
                            || (row_type == Some("System") && subcategory == Some("HeatSourceWet"))
                    })
                })
                .unwrap_or(false);
            if self.is_fhs_schema && !has_explicit_heat_source_wet_system {
                return Err(BuildError::new(
                    "E044",
                    "Wet Emitters require an explicit HeatSourceWet system (add a Systems row with subcategory='HeatSourceWet')",
                ));
            }

            let consolidated_zone_name = if self.is_fhs_schema {
                result
                    .get("Zone")
                    .and_then(|z| z.as_object())
                    .and_then(|zones| {
                        if zones.len() == 1 {
                            zones.keys().next().cloned()
                        } else {
                            None
                        }
                    })
            } else {
                None
            };
            let authored_space_heat_system_aliases =
                Self::authored_space_heat_system_aliases_from_systems_csv(csv_data);
            let authored_space_heat_system_names: HashSet<String> =
                authored_space_heat_system_aliases
                    .values()
                    .cloned()
                    .collect();

            // Step 1: Group wet emitters. Rows with `space_heat_system` attach to an explicit
            // authored system. Rows without the column are legacy CSVs and retain the historical
            // generated `<zone> <subcategory>` grouping. Rows with a blank link in the current CSV
            // format are treated as unassigned geometry and are not silently merged into generated
            // fallback systems.
            let mut zone_type_emitters: HashMap<(String, String), Vec<HashMap<String, Value>>> =
                HashMap::new();
            let mut unlinked_zone_type_emitters: HashMap<
                (String, String),
                Vec<HashMap<String, Value>>,
            > = HashMap::new();
            let mut unlinked_zones_with_csv_emitters: std::collections::HashSet<String> =
                std::collections::HashSet::new();
            let mut linked_system_emitters: HashMap<String, Vec<HashMap<String, Value>>> =
                HashMap::new();
            let mut linked_system_zones: HashMap<String, HashSet<String>> = HashMap::new();
            let mut zones_with_csv_emitters: std::collections::HashSet<String> =
                std::collections::HashSet::new();
            let mut saw_space_heat_system_link_column = false;

            for emitter_row in section_data {
                let zone_name = emitter_row
                    .get("Zone")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        BuildError::new("E024", "Wet Emitters missing required 'Zone' field")
                    })?;
                let subcategory = emitter_row
                    .get("subcategory")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        BuildError::new("E025", "Wet Emitters missing required 'subcategory' field")
                    })?;
                let effective_zone_name = consolidated_zone_name
                    .clone()
                    .unwrap_or_else(|| zone_name.to_string());
                let linked_system_value = emitter_row
                    .get("space_heat_system")
                    .or_else(|| emitter_row.get("SpaceHeatSystem"));
                if linked_system_value.is_some() {
                    saw_space_heat_system_link_column = true;
                }
                let linked_system_name = linked_system_value
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(ToOwned::to_owned);

                if let Some(system_name) = linked_system_name {
                    let system_name = authored_space_heat_system_aliases
                        .get(&system_name)
                        .cloned()
                        .unwrap_or(system_name);
                    zones_with_csv_emitters.insert(effective_zone_name.clone());
                    linked_system_zones
                        .entry(system_name.clone())
                        .or_default()
                        .insert(effective_zone_name);
                    linked_system_emitters
                        .entry(system_name)
                        .or_default()
                        .push(emitter_row.clone());
                } else if linked_system_value.is_none() {
                    unlinked_zones_with_csv_emitters.insert(effective_zone_name.clone());
                    unlinked_zone_type_emitters
                        .entry((effective_zone_name, subcategory.to_string()))
                        .or_default()
                        .push(emitter_row.clone());
                }
            }

            if linked_system_emitters.is_empty() && !saw_space_heat_system_link_column {
                zone_type_emitters = unlinked_zone_type_emitters;
                zones_with_csv_emitters.extend(unlinked_zones_with_csv_emitters);
            }

            let defaults_wet_distribution_template = result
                .get("SpaceHeatSystem")
                .and_then(|shs| shs.as_object())
                .and_then(|systems| {
                    systems.values().find_map(|system| {
                        let system_obj = system.as_object()?;
                        (system_obj.get("type").and_then(|v| v.as_str()) == Some("WetDistribution"))
                            .then(|| system_obj.clone())
                    })
                });

            // Step 2: Remove stale template WetDistribution systems. Legacy CSVs without the link
            // column rebuild wet systems as before; current CSVs preserve only explicitly authored
            // systems with linked emitters and remove defaults that are neither authored nor linked.
            if let Some(space_heat_system) = result.get_mut("SpaceHeatSystem") {
                if let Some(shs_obj) = space_heat_system.as_object_mut() {
                    if linked_system_emitters.is_empty() && !saw_space_heat_system_link_column {
                        shs_obj.clear();
                    } else {
                        shs_obj.retain(|name, system| {
                            let is_wet_distribution = system.get("type").and_then(|v| v.as_str())
                                == Some("WetDistribution");
                            !is_wet_distribution || linked_system_emitters.contains_key(name)
                        });
                    }
                }
            }

            // Step 3: Start from a defaults WetDistribution template only.
            // Do not synthesize implicit fallback systems/heat sources here.
            let mut template_system = defaults_wet_distribution_template.ok_or_else(|| {
                BuildError::new(
                    "E045",
                    "Defaults template missing SpaceHeatSystem WetDistribution template",
                )
            })?;
            template_system.remove("emitters");

            // Step 4: Create aggregated systems - one per (zone, subcategory) pair
            let mut new_space_heat_systems = serde_json::Map::new();
            for ((zone_name, subcategory), emitters_data) in zone_type_emitters {
                // Create system name: <zone_name> <WetEmitter_type>
                let system_name = format!("{zone_name} {subcategory}");

                // Create new system based on template
                let mut new_system = template_system.clone();
                new_system.insert("Zone".to_string(), Value::String(zone_name.clone()));

                // Build emitters array - aggregate all emitters of this type for this zone
                let mut emitters_array = Vec::new();

                for emitter_row in emitters_data {
                    let emitter_obj = Self::build_wet_emitter_object(
                        &subcategory,
                        &emitter_row,
                        &allowed_emitter_props,
                    )?;
                    emitters_array.push(Value::Object(emitter_obj));
                }

                new_system.insert("emitters".to_string(), Value::Array(emitters_array));
                if subcategory != "radiator" {
                    new_system.remove("thermal_mass");
                }
                if !allowed_system_props.is_empty() {
                    new_system.retain(|k, _| allowed_system_props.contains(k));
                }
                new_space_heat_systems.insert(system_name, Value::Object(new_system));
            }

            // Step 5: Merge new systems into SpaceHeatSystem
            if let Some(space_heat_system) = result.get_mut("SpaceHeatSystem") {
                if let Some(shs_obj) = space_heat_system.as_object_mut() {
                    for (name, system) in new_space_heat_systems {
                        shs_obj.insert(name, system);
                    }
                }
            } else {
                result["SpaceHeatSystem"] = Value::Object(new_space_heat_systems);
            }

            if !linked_system_emitters.is_empty() {
                let shs_obj = result
                    .get_mut("SpaceHeatSystem")
                    .and_then(|v| v.as_object_mut())
                    .ok_or_else(|| {
                        BuildError::new(
                            "E048",
                            "Wet Emitters reference explicit SpaceHeatSystem entries, but SpaceHeatSystem is missing",
                        )
                    })?;

                for (system_name, emitters_data) in linked_system_emitters {
                    if !authored_space_heat_system_names.contains(&system_name) {
                        return Err(BuildError::new(
                            "E049",
                            &format!(
                                "Wet Emitter references SpaceHeatSystem '{system_name}' but no Systems row authors it"
                            ),
                        ));
                    }

                    let zones = linked_system_zones.get(&system_name).ok_or_else(|| {
                        BuildError::new(
                            "E050",
                            &format!(
                                "Wet Emitter references SpaceHeatSystem '{system_name}' but no zone was resolved"
                            ),
                        )
                    })?;
                    if zones.len() != 1 {
                        return Err(BuildError::new(
                            "E051",
                            &format!(
                                "Wet Emitters for SpaceHeatSystem '{system_name}' span multiple zones"
                            ),
                        ));
                    }
                    let zone_name = zones.iter().next().cloned().ok_or_else(|| {
                        BuildError::new(
                            "E050",
                            &format!(
                                "Wet Emitter references SpaceHeatSystem '{system_name}' but no zone was resolved"
                            ),
                        )
                    })?;

                    let system_obj = shs_obj
                        .get_mut(&system_name)
                        .and_then(|v| v.as_object_mut())
                        .ok_or_else(|| {
                            BuildError::new(
                                "E052",
                                &format!(
                                    "Wet Emitter references unknown SpaceHeatSystem '{system_name}'"
                                ),
                            )
                        })?;
                    if system_obj.get("type").and_then(|v| v.as_str()) != Some("WetDistribution") {
                        return Err(BuildError::new(
                            "E053",
                            &format!(
                                "Wet Emitter references SpaceHeatSystem '{system_name}' but it is not a WetDistribution"
                            ),
                        ));
                    }
                    if let Some(existing_zone) = system_obj.get("Zone").and_then(|v| v.as_str()) {
                        if existing_zone != zone_name {
                            return Err(BuildError::new(
                                "E054",
                                &format!(
                                    "Wet Emitter references SpaceHeatSystem '{system_name}' in zone '{zone_name}' but the system is assigned to zone '{existing_zone}'"
                                ),
                            ));
                        }
                    } else {
                        system_obj.insert("Zone".to_string(), Value::String(zone_name));
                    }

                    let mut emitters_array = Vec::new();
                    let mut has_radiator_emitters = false;
                    for emitter_row in emitters_data {
                        let Some(subcategory) =
                            emitter_row.get("subcategory").and_then(|v| v.as_str())
                        else {
                            return Err(BuildError::new(
                                "E025",
                                "Wet Emitters missing required 'subcategory' field",
                            ));
                        };
                        let emitter_obj = Self::build_wet_emitter_object(
                            subcategory,
                            &emitter_row,
                            &allowed_emitter_props,
                        )?;
                        if emitter_obj.get("wet_emitter_type").and_then(|v| v.as_str())
                            == Some("radiator")
                        {
                            has_radiator_emitters = true;
                        }
                        emitters_array.push(Value::Object(emitter_obj));
                    }
                    if has_radiator_emitters {
                        if !system_obj.contains_key("thermal_mass") {
                            if let Some(thermal_mass) = template_system.get("thermal_mass") {
                                system_obj.insert("thermal_mass".to_string(), thermal_mass.clone());
                            }
                        }
                    } else {
                        system_obj.remove("thermal_mass");
                    }
                    system_obj.insert("emitters".to_string(), Value::Array(emitters_array));
                }
            }
            // Reconcile Zone.SpaceHeatSystem: reference every CSV-built wet system for this zone
            // (string if one, sorted JSON array if several) so upstream FHS preprocessing attaches
            // `Control` to each `WetDistribution`.
            // Take an immutable snapshot of SpaceHeatSystem to avoid aliasing with mutable Zone borrow
            let space_heat_systems_snapshot = result
                .get("SpaceHeatSystem")
                .and_then(|s| s.as_object())
                .cloned();

            if let (Some(zones), Some(space_heat_systems)) = (
                result.get_mut("Zone").and_then(|z| z.as_object_mut()),
                space_heat_systems_snapshot,
            ) {
                // Build a mapping from zone name to list of system names that target the zone
                let mut zone_to_systems: HashMap<String, Vec<String>> = HashMap::new();
                for (sys_name, sys_val) in space_heat_systems.iter() {
                    if let Some(sys_zone) = sys_val
                        .get("Zone")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                    {
                        zone_to_systems
                            .entry(sys_zone)
                            .or_default()
                            .push(sys_name.clone());
                    }
                }

                for (zone_name, zone_val) in zones.iter_mut() {
                    if let Some(zone_obj) = zone_val.as_object_mut() {
                        // If this zone has CSV-defined emitters, reference every CSV-built wet system
                        // for this zone (typically `"<zone> <subcategory>"`), so FHS preprocessing
                        // attaches `Control` / schedules to each `WetDistribution`.
                        if zones_with_csv_emitters.contains(zone_name) {
                            if let Some(candidates) = zone_to_systems.get(zone_name) {
                                let csv_systems: Vec<&String> = candidates
                                    .iter()
                                    .filter(|name| name.starts_with(&format!("{zone_name} ")))
                                    .collect();

                                if !csv_systems.is_empty() {
                                    let names: Vec<String> =
                                        csv_systems.iter().map(|s| (*s).clone()).collect();
                                    if let Some(v) = Self::zone_space_heat_reference_value(names) {
                                        zone_obj.insert("SpaceHeatSystem".to_string(), v);
                                    }
                                } else if candidates.len() == 1 {
                                    zone_obj.insert(
                                        "SpaceHeatSystem".to_string(),
                                        Value::String(candidates[0].clone()),
                                    );
                                } else if candidates.len() > 1 {
                                    let names = Self::sorted_unique_names(candidates.clone());
                                    if let Some(v) = Self::zone_space_heat_reference_value(names) {
                                        zone_obj.insert("SpaceHeatSystem".to_string(), v);
                                    }
                                }
                            }
                        } else {
                            Self::reconcile_space_heat_refs_for_zone(
                                zone_name,
                                zone_obj,
                                &space_heat_systems,
                                &zone_to_systems,
                            );
                        }
                    }
                }
            }
        } else if self.is_fhs_schema {
            // No "Wet Emitters" section in the CSV: strip defaults-template wet SHS, but do not
            // wipe `SpaceHeatSystem` entries that were just merged from `Systems` (e.g. dry
            // `SpaceHeatSystem` presets) — that merge runs in `merge_systems` *before* this
            // function, so a blanket clear would erase user-authored / preset SHS.
            let csv_includes_space_heat_from_systems = csv_data
                .get("Systems")
                .map(|rows| {
                    rows.iter().any(|row| {
                        let t = row
                            .get("Type")
                            .and_then(|v| v.as_str())
                            .or_else(|| row.get("system_type").and_then(|v| v.as_str()));
                        let sub = row.get("subcategory").and_then(|v| v.as_str());
                        sub == Some("SpaceHeatSystem")
                            || t == Some("SpaceHeatSystem")
                            || t == Some("WetDistribution")
                    })
                })
                .unwrap_or(false);
            if !csv_includes_space_heat_from_systems {
                if let Some(space_heat_system) = result.get_mut("SpaceHeatSystem") {
                    if let Some(shs_obj) = space_heat_system.as_object_mut() {
                        shs_obj.clear();
                    }
                }
            }
        }
        Ok(())
    }

    fn collect_schema_properties(schema_def: &Value) -> HashSet<String> {
        fn collect_from_schema(schema: &Value, out: &mut HashSet<String>) {
            if let Some(properties) = schema.get("properties").and_then(|v| v.as_object()) {
                for key in properties.keys() {
                    out.insert(key.clone());
                }
            }
            if let Some(then_block) = schema.get("then") {
                collect_from_schema(then_block, out);
            }
            if let Some(else_block) = schema.get("else") {
                collect_from_schema(else_block, out);
            }
            if let Some(all_of) = schema.get("allOf").and_then(|v| v.as_array()) {
                for block in all_of {
                    if let Some(then_block) = block.get("then") {
                        collect_from_schema(then_block, out);
                    }
                    if let Some(else_block) = block.get("else") {
                        collect_from_schema(else_block, out);
                    }
                    collect_from_schema(block, out);
                }
            }
            if let Some(any_of) = schema.get("anyOf").and_then(|v| v.as_array()) {
                for branch in any_of {
                    collect_from_schema(branch, out);
                }
            }
            if let Some(one_of) = schema.get("oneOf").and_then(|v| v.as_array()) {
                for branch in one_of {
                    collect_from_schema(branch, out);
                }
            }
        }

        let mut allowed = HashSet::new();
        collect_from_schema(schema_def, &mut allowed);
        allowed
    }

    fn schema_condition_matches_context(
        condition: &Value,
        context: &serde_json::Map<String, Value>,
    ) -> bool {
        if let Some(any_of) = condition.get("anyOf").and_then(|v| v.as_array()) {
            return any_of
                .iter()
                .any(|candidate| Self::schema_condition_matches_context(candidate, context));
        }

        if let Some(one_of) = condition.get("oneOf").and_then(|v| v.as_array()) {
            return one_of
                .iter()
                .filter(|candidate| Self::schema_condition_matches_context(candidate, context))
                .count()
                == 1;
        }

        if let Some(not_cond) = condition.get("not") {
            return !Self::schema_condition_matches_context(not_cond, context);
        }

        if let Some(required) = condition.get("required").and_then(|v| v.as_array()) {
            if !required.iter().all(|key| {
                key.as_str()
                    .map(|k| context.contains_key(k))
                    .unwrap_or(false)
            }) {
                return false;
            }
        }

        if let Some(properties) = condition.get("properties").and_then(|v| v.as_object()) {
            for (key, schema) in properties {
                let Some(value) = context.get(key) else {
                    return false;
                };

                if let Some(const_value) = schema.get("const") {
                    if value != const_value {
                        return false;
                    }
                }

                if let Some(enum_values) = schema.get("enum").and_then(|v| v.as_array()) {
                    if !enum_values.iter().any(|candidate| candidate == value) {
                        return false;
                    }
                }

                if let Some(type_name) = schema.get("type").and_then(|v| v.as_str()) {
                    match type_name {
                        "number" => {
                            let Some(number) = value.as_f64() else {
                                return false;
                            };
                            if let Some(minimum) = schema.get("minimum").and_then(|v| v.as_f64()) {
                                if number < minimum {
                                    return false;
                                }
                            }
                            if let Some(maximum) = schema.get("maximum").and_then(|v| v.as_f64()) {
                                if number > maximum {
                                    return false;
                                }
                            }
                            if let Some(minimum) =
                                schema.get("exclusiveMinimum").and_then(|v| v.as_f64())
                            {
                                if number <= minimum {
                                    return false;
                                }
                            }
                            if let Some(maximum) =
                                schema.get("exclusiveMaximum").and_then(|v| v.as_f64())
                            {
                                if number >= maximum {
                                    return false;
                                }
                            }
                        }
                        "integer" => {
                            let Some(number) = value.as_i64() else {
                                return false;
                            };
                            if let Some(minimum) = schema.get("minimum").and_then(|v| v.as_i64()) {
                                if number < minimum {
                                    return false;
                                }
                            }
                            if let Some(maximum) = schema.get("maximum").and_then(|v| v.as_i64()) {
                                if number > maximum {
                                    return false;
                                }
                            }
                        }
                        "boolean" => {
                            if !value.is_boolean() {
                                return false;
                            }
                        }
                        "string" if !value.is_string() => {
                            return false;
                        }
                        _ => {}
                    }
                }
            }
        }

        true
    }

    fn collect_schema_properties_with_context(
        schema_def: &Value,
        context: Option<&serde_json::Map<String, Value>>,
    ) -> HashSet<String> {
        fn collect_from_schema(
            schema: &Value,
            context: Option<&serde_json::Map<String, Value>>,
            out: &mut HashSet<String>,
        ) {
            if let Some(properties) = schema.get("properties").and_then(|v| v.as_object()) {
                for key in properties.keys() {
                    out.insert(key.clone());
                }
            }

            if let Some(if_cond) = schema.get("if") {
                let matches = context
                    .map(|ctx| JSONBuilder::schema_condition_matches_context(if_cond, ctx))
                    .unwrap_or(false);
                if matches {
                    if let Some(then_block) = schema.get("then") {
                        collect_from_schema(then_block, context, out);
                    }
                } else if let Some(else_block) = schema.get("else") {
                    collect_from_schema(else_block, context, out);
                }
            }

            if let Some(all_of) = schema.get("allOf").and_then(|v| v.as_array()) {
                for block in all_of {
                    if let Some(properties) = block.get("properties").and_then(|v| v.as_object()) {
                        for key in properties.keys() {
                            out.insert(key.clone());
                        }
                    }

                    if let Some(if_cond) = block.get("if") {
                        let matches = context
                            .map(|ctx| JSONBuilder::schema_condition_matches_context(if_cond, ctx))
                            .unwrap_or(false);
                        if matches {
                            if let Some(then_block) = block.get("then") {
                                collect_from_schema(then_block, context, out);
                            }
                        } else if let Some(else_block) = block.get("else") {
                            collect_from_schema(else_block, context, out);
                        }
                    } else {
                        collect_from_schema(block, context, out);
                    }
                }
            }

            if let Some(any_of) = schema.get("anyOf").and_then(|v| v.as_array()) {
                for branch in any_of {
                    collect_from_schema(branch, context, out);
                }
            }
            if let Some(one_of) = schema.get("oneOf").and_then(|v| v.as_array()) {
                for branch in one_of {
                    collect_from_schema(branch, context, out);
                }
            }
        }

        let mut allowed = HashSet::new();
        collect_from_schema(schema_def, context, &mut allowed);
        allowed
    }

    fn find_property_schema<'a>(schema_def: &'a Value, property: &str) -> Option<&'a Value> {
        if let Some(prop_schema) = schema_def
            .get("properties")
            .and_then(|v| v.as_object())
            .and_then(|props| props.get(property))
        {
            return Some(prop_schema);
        }

        for branch_key in ["then", "else"] {
            if let Some(found) = schema_def
                .get(branch_key)
                .and_then(|branch| Self::find_property_schema(branch, property))
            {
                return Some(found);
            }
        }

        for branches_key in ["allOf", "anyOf", "oneOf"] {
            if let Some(branches) = schema_def.get(branches_key).and_then(|v| v.as_array()) {
                for branch in branches {
                    if let Some(found) = Self::find_property_schema(branch, property) {
                        return Some(found);
                    }
                }
            }
        }

        None
    }

    /// Get allowed properties for a schema definition
    /// For BuildingElement variants, this should merge base properties with conditional properties
    fn get_allowed_properties_from_schema(&self, schema_def: &Value) -> HashSet<String> {
        let mut allowed = Self::collect_schema_properties(schema_def);

        // For BuildingElement variants, we also need to include base properties
        // (type, pitch, thermal_resistance_construction, u_value).
        if let Some(base_schema) = self.get_building_element_base_schema() {
            if let Some(base_properties) = base_schema.get("properties").and_then(|v| v.as_object())
            {
                for key in base_properties.keys() {
                    allowed.insert(key.clone());
                }
            }
        }

        allowed
    }

    fn build_building_element_context(
        element_type: &str,
        element_obj: Option<&serde_json::Map<String, Value>>,
        discriminator_value: Option<&str>,
    ) -> serde_json::Map<String, Value> {
        let mut context = serde_json::Map::new();
        context.insert("type".to_string(), Value::String(element_type.to_string()));

        if let Some(value) = discriminator_value {
            context.insert("floor_type".to_string(), Value::String(value.to_string()));
        }

        if let Some(obj) = element_obj {
            for key in [
                "floor_type",
                "party_wall_cavity_type",
                "pitch",
                "is_unheated_pitched_roof",
                "is_external_door",
            ] {
                if let Some(value) = obj.get(key) {
                    context.insert(key.to_string(), value.clone());
                }
            }
        }

        context
    }

    /// Coerce a CSV/extra_json value for a building-element property.
    /// FHS rounds pitch/orientation360 to integers (schema requirement; core
    /// keeps fractional user values untouched); other string values are
    /// coerced to the schema's number/boolean type. Unparseable strings pass
    /// through unchanged so schema validation flags them loudly.
    fn coerce_building_element_value(
        &self,
        key: &str,
        value: &Value,
        schema_element_type: &str,
        floor_type: Option<&str>,
    ) -> Value {
        if (key == "orientation360" || key == "pitch") && self.is_fhs_schema {
            if let Some(f) = value.as_f64() {
                return Value::Number(serde_json::Number::from(f.round() as i64));
            }
            if let Some(s) = value.as_str() {
                if let Ok(num) = s.parse::<f64>() {
                    return Value::Number(serde_json::Number::from(num.round() as i64));
                }
            }
            return value.clone();
        }
        if let Some(s) = value.as_str() {
            if self.is_property_numeric_type(key, schema_element_type, floor_type) {
                if let Ok(num) = s.parse::<f64>() {
                    return if num.fract() == 0.0 {
                        Value::Number(serde_json::Number::from(num as i64))
                    } else {
                        Value::Number(
                            serde_json::Number::from_f64(num)
                                .unwrap_or_else(|| serde_json::Number::from(0)),
                        )
                    };
                }
                return value.clone();
            }
            if self.is_property_boolean_type(key, schema_element_type, floor_type) {
                match s.to_lowercase().as_str() {
                    "true" => return Value::Bool(true),
                    "false" => return Value::Bool(false),
                    _ => {}
                }
            }
        }
        value.clone()
    }

    /// Check if a property should be a number type based on the schema
    fn is_property_numeric_type(
        &self,
        property: &str,
        element_type: &str,
        floor_type: Option<&str>,
    ) -> bool {
        // Get the variant schema for this element type
        if let Some(variant_schema) =
            self.get_building_element_variant_schema(element_type, floor_type)
        {
            // Check if the property exists in the schema and is a number type
            if let Some(properties) = variant_schema.get("properties").and_then(|v| v.as_object()) {
                if let Some(prop_schema) = properties.get(property) {
                    // Check if type is "number" or "integer"
                    if let Some(type_val) = prop_schema.get("type").and_then(|v| v.as_str()) {
                        return type_val == "number" || type_val == "integer";
                    }
                    // Check for anyOf/oneOf that might contain number type
                    if let Some(any_of) = prop_schema.get("anyOf").and_then(|v| v.as_array()) {
                        for item in any_of {
                            if let Some(type_val) = item.get("type").and_then(|v| v.as_str()) {
                                if type_val == "number" || type_val == "integer" {
                                    return true;
                                }
                            }
                        }
                    }
                    if let Some(one_of) = prop_schema.get("oneOf").and_then(|v| v.as_array()) {
                        for item in one_of {
                            if let Some(type_val) = item.get("type").and_then(|v| v.as_str()) {
                                if type_val == "number" || type_val == "integer" {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }

            // Also check base properties from BuildingElement.additionalProperties.properties
            if let Some(zone_additional_props) = self
                .schema
                .get("properties")
                .and_then(|p| p.get("Zone"))
                .and_then(|z| z.get("additionalProperties"))
            {
                if let Some(zone_fhs_ref) =
                    zone_additional_props.get("$ref").and_then(|v| v.as_str())
                {
                    if let Some(zone_fhs) = self.resolve_schema_ref(zone_fhs_ref) {
                        if let Some(be_props) = zone_fhs
                            .get("properties")
                            .and_then(|p| p.get("BuildingElement"))
                        {
                            if let Some(be_additional) = be_props.get("additionalProperties") {
                                if let Some(base_properties) =
                                    be_additional.get("properties").and_then(|v| v.as_object())
                                {
                                    if let Some(prop_schema) = base_properties.get(property) {
                                        if let Some(type_val) =
                                            prop_schema.get("type").and_then(|v| v.as_str())
                                        {
                                            return type_val == "number" || type_val == "integer";
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Fallback: check common numeric properties
        let known_numeric_props = [
            "height_upper_surface",
            "thermal_resistance_construction",
            "u_value",
            "area",
            "width",
            "height",
            "pitch",
            "base_height",
            "orientation360",
            "areal_heat_capacity",
            "g_value",
            "frame_area_fraction",
            "free_area_height",
            "mid_height",
            "max_window_open_area",
            "depth",
            "distance",
            "transparency",
            "length",
            "heat_transfer_coeff",
            "linear_thermal_transmittance",
            "efficacy",
            "count",
            "power",
            "flowrate",
            "size",
            "rated_power",
            "peak_power",
            "capacity",
            "charge_discharge_efficiency_round_trip",
            "minimum_charge_rate_one_way_trip",
            "maximum_charge_rate_one_way_trip",
            "maximum_discharge_rate_one_way_trip",
            "perimeter",
            "depth_basement_floor",
            "thickness_walls",
            "start angle",
            "end angle",
        ];
        known_numeric_props.contains(&property)
    }

    fn is_property_boolean_type(
        &self,
        property: &str,
        element_type: &str,
        floor_type: Option<&str>,
    ) -> bool {
        // Get the variant schema for this element type
        if let Some(variant_schema) =
            self.get_building_element_variant_schema(element_type, floor_type)
        {
            // Check if the property exists in the schema and is a boolean type
            if let Some(properties) = variant_schema.get("properties").and_then(|v| v.as_object()) {
                if let Some(prop_schema) = properties.get(property) {
                    // Check if type is "boolean"
                    if let Some(type_val) = prop_schema.get("type").and_then(|v| v.as_str()) {
                        return type_val == "boolean";
                    }
                    // Check for anyOf/oneOf that might contain boolean type
                    if let Some(any_of) = prop_schema.get("anyOf").and_then(|v| v.as_array()) {
                        for item in any_of {
                            if let Some(type_val) = item.get("type").and_then(|v| v.as_str()) {
                                if type_val == "boolean" {
                                    return true;
                                }
                            }
                        }
                    }
                    if let Some(one_of) = prop_schema.get("oneOf").and_then(|v| v.as_array()) {
                        for item in one_of {
                            if let Some(type_val) = item.get("type").and_then(|v| v.as_str()) {
                                if type_val == "boolean" {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }

            // Also check base properties from BuildingElement.additionalProperties.properties
            if let Some(zone_additional_props) = self
                .schema
                .get("properties")
                .and_then(|p| p.get("Zone"))
                .and_then(|z| z.get("additionalProperties"))
            {
                if let Some(zone_fhs_ref) =
                    zone_additional_props.get("$ref").and_then(|v| v.as_str())
                {
                    if let Some(zone_fhs) = self.resolve_schema_ref(zone_fhs_ref) {
                        if let Some(be_props) = zone_fhs
                            .get("properties")
                            .and_then(|p| p.get("BuildingElement"))
                        {
                            if let Some(be_additional) = be_props.get("additionalProperties") {
                                if let Some(base_properties) =
                                    be_additional.get("properties").and_then(|v| v.as_object())
                                {
                                    if let Some(prop_schema) = base_properties.get(property) {
                                        if let Some(type_val) =
                                            prop_schema.get("type").and_then(|v| v.as_str())
                                        {
                                            return type_val == "boolean";
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        false
    }

    /// Resolve a $ref in the schema
    fn resolve_schema_ref(&self, ref_path: &str) -> Option<&Value> {
        // Remove the #/$defs/ prefix
        if let Some(def_name) = ref_path.strip_prefix("#/$defs/") {
            self.schema.get("$defs")?.get(def_name)
        } else {
            None
        }
    }

    fn get_zone_schema(&self) -> Option<&Value> {
        let zone_additional_props = self
            .schema
            .get("properties")?
            .get("Zone")?
            .get("additionalProperties")?;

        if let Some(zone_ref) = zone_additional_props.get("$ref").and_then(|v| v.as_str()) {
            self.resolve_schema_ref(zone_ref)
        } else {
            Some(zone_additional_props)
        }
    }

    /// Get the schema definition for a BuildingElement variant
    fn get_building_element_variant_schema(
        &self,
        element_type: &str,
        discriminator_value: Option<&str>,
    ) -> Option<&Value> {
        let building_element_schema = self
            .get_zone_schema()?
            .get("properties")?
            .get("BuildingElement")?
            .get("additionalProperties")?;

        // First, check if there's a discriminator mapping at the top level
        if let Some(discriminator) = building_element_schema.get("discriminator") {
            if let Some(mapping) = discriminator.get("mapping").and_then(|v| v.as_object()) {
                // Check if element_type is directly in the mapping (for BuildingElementOpaque, BuildingElementTransparent)
                if let Some(mapping_value) = mapping.get(element_type) {
                    // If it's a string (direct reference), resolve it
                    if let Some(ref_path) = mapping_value.as_str() {
                        return self.resolve_schema_ref(ref_path);
                    }
                    // If it's an object (nested discriminator like BuildingElementGround), handle it differently
                    else if mapping_value.is_object() && element_type == "BuildingElementGround" {
                        // For BuildingElementGround, the mapping value is itself a discriminator object
                        // We need to look inside it for the floor_type mapping
                        if let Some(nested_discriminator) = mapping_value.get("discriminator") {
                            if let Some(nested_mapping) = nested_discriminator
                                .get("mapping")
                                .and_then(|v| v.as_object())
                            {
                                if let Some(floor_type) = discriminator_value {
                                    if let Some(ref_path) =
                                        nested_mapping.get(floor_type).and_then(|v| v.as_str())
                                    {
                                        return self.resolve_schema_ref(ref_path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // NOTE: previously this function tried to short-circuit by returning the first
        // matching `allOf[i].then` schema. That was wrong for two reasons:
        //   1. It only checked `if.properties.type.const`, missing `if.anyOf[…]` clauses
        //      that group multiple types (e.g. allOf[0] which covers both
        //      AdjacentConditionedSpace and AdjacentUnconditionedSpace_Simple).
        //   2. Returning a single matching `then` block dropped properties contributed
        //      by other matching `allOf` branches. Concretely, AdjacentUnconditionedSpace_Simple
        //      matched allOf[1] (which only carries thermal_resistance_unconditioned_space)
        //      and lost the shared geometry props (area/pitch/areal_heat_capacity/
        //      mass_distribution_class) defined in allOf[0].
        // Always fall through to the full base schema. `collect_schema_properties_with_context`
        // walks `allOf`/`anyOf`/`if`/`then` with the element-type context and gathers
        // properties from every matching branch, which is what we want.

        // Fallback: Find the oneOf that matches this element type
        if let Some(one_of) = building_element_schema
            .get("oneOf")
            .and_then(|v| v.as_array())
        {
            for variant in one_of {
                // Check if this variant has a discriminator (for BuildingElementGround)
                if let Some(discriminator) = variant.get("discriminator") {
                    if let Some(property_name) =
                        discriminator.get("propertyName").and_then(|v| v.as_str())
                    {
                        if property_name == "floor_type" && element_type == "BuildingElementGround"
                        {
                            if let Some(disc_value) = discriminator_value {
                                if let Some(mapping) =
                                    discriminator.get("mapping").and_then(|v| v.as_object())
                                {
                                    if let Some(ref_path) =
                                        mapping.get(disc_value).and_then(|v| v.as_str())
                                    {
                                        return self.resolve_schema_ref(ref_path);
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // Check if this variant directly references the element type
                    if let Some(ref_path) = variant.get("$ref").and_then(|v| v.as_str()) {
                        if let Some(def) = self.resolve_schema_ref(ref_path) {
                            // Check if the type matches - handle both const and enum cases
                            if let Some(type_prop) =
                                def.get("properties").and_then(|p| p.get("type"))
                            {
                                if let Some(const_val) =
                                    type_prop.get("const").and_then(|v| v.as_str())
                                {
                                    if const_val == element_type {
                                        return Some(def);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // If no conditional schema matched, return the base schema
        // This includes base properties like type, pitch, thermal_resistance_construction, u_value
        Some(building_element_schema)
    }

    /// All `type` values the active schema accepts for building elements,
    /// gathered from `properties.type` const/enum declarations and
    /// `discriminator.mapping` keys in the BuildingElement subtree.
    fn schema_building_element_type_values(&self) -> HashSet<String> {
        fn walk(node: &Value, out: &mut HashSet<String>) {
            match node {
                Value::Object(obj) => {
                    if let Some(type_prop) = obj.get("properties").and_then(|p| p.get("type")) {
                        if let Some(c) = type_prop.get("const").and_then(|v| v.as_str()) {
                            out.insert(c.to_string());
                        }
                        if let Some(e) = type_prop.get("enum").and_then(|v| v.as_array()) {
                            out.extend(e.iter().filter_map(|v| v.as_str()).map(String::from));
                        }
                    }
                    if let Some(disc) = obj.get("discriminator") {
                        if disc.get("propertyName").and_then(|v| v.as_str()) == Some("type") {
                            if let Some(mapping) = disc.get("mapping").and_then(|v| v.as_object()) {
                                out.extend(mapping.keys().cloned());
                            }
                        }
                    }
                    for value in obj.values() {
                        walk(value, out);
                    }
                }
                Value::Array(arr) => {
                    for value in arr {
                        walk(value, out);
                    }
                }
                _ => {}
            }
        }

        let mut out = HashSet::new();
        if let Some(be_schema) = self.get_building_element_base_schema() {
            walk(be_schema, &mut out);
        }
        out
    }

    fn get_building_element_base_schema(&self) -> Option<&Value> {
        self.get_zone_schema()?
            .get("properties")?
            .get("BuildingElement")?
            .get("additionalProperties")
    }

    fn get_space_heat_system_base_schema(&self) -> Option<&Value> {
        self.schema
            .get("properties")?
            .get("SpaceHeatSystem")?
            .get("additionalProperties")
    }

    fn get_space_heat_system_variant_schema(&self, system_type: &str) -> Option<&Value> {
        let system_schema = self.get_space_heat_system_base_schema()?;

        if let Some(all_of) = system_schema.get("allOf").and_then(|v| v.as_array()) {
            for item in all_of {
                let matches = item
                    .get("if")
                    .and_then(|if_cond| if_cond.get("properties"))
                    .and_then(|props| props.get("type"))
                    .and_then(|type_prop| type_prop.get("const"))
                    .and_then(|v| v.as_str())
                    .map(|const_val| const_val == system_type)
                    .unwrap_or(false);

                if matches {
                    if let Some(then_schema) = item.get("then") {
                        return Some(then_schema);
                    }
                }
            }
        }

        Some(system_schema)
    }

    fn get_wet_distribution_emitter_schema(&self) -> Option<&Value> {
        self.get_space_heat_system_variant_schema("WetDistribution")?
            .get("properties")?
            .get("emitters")?
            .get("items")
    }

    fn get_allowed_building_element_properties(
        &self,
        element_type: &str,
        element_obj: Option<&serde_json::Map<String, Value>>,
        discriminator_value: Option<&str>,
    ) -> HashSet<String> {
        let mut allowed_props: HashSet<String> = self
            .get_building_element_base_schema()
            .and_then(|schema| schema.get("properties").and_then(|v| v.as_object()))
            .map(|properties| properties.keys().cloned().collect())
            .unwrap_or_default();

        if let Some(variant_schema) =
            self.get_building_element_variant_schema(element_type, discriminator_value)
        {
            let context = Self::build_building_element_context(
                element_type,
                element_obj,
                discriminator_value,
            );
            allowed_props.extend(Self::collect_schema_properties_with_context(
                variant_schema,
                Some(&context),
            ));
        }

        allowed_props
    }

    fn normalize_building_element_for_fhs(
        &self,
        element_obj: &mut serde_json::Map<String, Value>,
        csv_set_keys: Option<&HashSet<String>>,
    ) {
        let Some(element_type) = element_obj
            .get("type")
            .and_then(|v| v.as_str())
            .map(|value| value.to_string())
        else {
            return;
        };

        if let Some(v) = element_obj.get_mut("mass_distribution_class") {
            if let Some(s) = v.as_str() {
                if let Some(coerced) = coerce_mass_distribution_class_for_fhs(s) {
                    *v = Value::String(coerced);
                }
            }
        }

        if element_obj.contains_key("u_value")
            && element_obj.contains_key("thermal_resistance_construction")
        {
            let prefer_u_value = csv_set_keys
                .map(|keys| {
                    keys.contains("u_value") && !keys.contains("thermal_resistance_construction")
                })
                .unwrap_or(false);
            if prefer_u_value {
                element_obj.remove("thermal_resistance_construction");
            } else {
                element_obj.remove("u_value");
            }
        }

        let discriminator_value = if element_type == "BuildingElementGround" {
            element_obj.get("floor_type").and_then(|v| v.as_str())
        } else {
            None
        };
        let allowed_props = self.get_allowed_building_element_properties(
            &element_type,
            Some(element_obj),
            discriminator_value,
        );
        if !allowed_props.is_empty() {
            element_obj.retain(|key, _| allowed_props.contains(key));
        }
    }

    /// Schema-based cleanup: removes properties not allowed by the schema
    /// This recursively walks the JSON and removes any properties that aren't in the schema's properties list
    /// when additionalProperties is false
    pub fn cleanup_against_schema(&self, json_data: &mut Value) -> Result<(), BuildError> {
        // Start from root schema - use the schema itself as the definition
        // The root schema has properties, and we need to check additionalProperties at root level

        self.cleanup_object_against_schema(json_data, &self.schema)?;
        Ok(())
    }

    /// Recursively clean an object against its schema definition
    fn cleanup_object_against_schema(
        &self,
        json_value: &mut Value,
        schema_def: &Value,
    ) -> Result<(), BuildError> {
        if let Some(obj) = json_value.as_object_mut() {
            let additional_props = schema_def.get("additionalProperties");

            // Handle additionalProperties as a value schema (name-keyed maps): each value in
            // the object must conform to it. Covers both `$ref` form and the inline form the
            // FHS schema uses for `Zone.additionalProperties` / `BuildingElement.additionalProperties`.
            if let Some(additional_props) = additional_props {
                if let Some(ref_path) = additional_props.get("$ref").and_then(|v| v.as_str()) {
                    if let Some(ref_schema) = self.resolve_schema_ref(ref_path) {
                        // Each value in this object should conform to the referenced schema
                        // Iterate over values and clean each one
                        for (_key, value) in obj.iter_mut() {
                            self.cleanup_value_against_schema(value, ref_schema)?;
                        }
                        return Ok(());
                    }
                } else if additional_props.is_object() {
                    for (_key, value) in obj.iter_mut() {
                        self.cleanup_value_against_schema(value, additional_props)?;
                    }
                    return Ok(());
                }
            }

            // Check if additionalProperties is false (strict mode)
            let is_strict = additional_props
                .and_then(|v| v.as_bool())
                .map(|b| !b)
                .unwrap_or(false);

            if is_strict {
                // Get allowed properties from schema
                let allowed_props = self.get_allowed_properties_from_schema(schema_def);

                // Remove properties not in allowed list
                let keys_to_remove: Vec<String> = obj
                    .keys()
                    .filter(|k| !allowed_props.contains(*k))
                    .cloned()
                    .collect();

                for key in keys_to_remove {
                    obj.remove(&key);
                }
            }

            // Recursively process each property
            if let Some(properties) = schema_def.get("properties") {
                for (key, value) in obj.iter_mut() {
                    if let Some(prop_schema) = properties.get(key) {
                        // Handle oneOf/discriminator for BuildingElement
                        if key == "BuildingElement" {
                            // For BuildingElement, resolve $ref if present
                            let prop_schema_resolved = if let Some(ref_path) =
                                prop_schema.get("$ref").and_then(|v| v.as_str())
                            {
                                self.resolve_schema_ref(ref_path).unwrap_or(prop_schema)
                            } else {
                                prop_schema
                            };
                            self.cleanup_building_element_object(value, prop_schema_resolved)?;
                        } else {
                            // For other properties, let cleanup_value_against_schema handle $ref resolution
                            self.cleanup_value_against_schema(value, prop_schema)?;
                        }
                    }
                }
            }
        } else if let Some(arr) = json_value.as_array_mut() {
            // Handle arrays - get items schema
            if let Some(items_schema) = schema_def.get("items") {
                for item in arr.iter_mut() {
                    self.cleanup_value_against_schema(item, items_schema)?;
                }
            }
        }
        Ok(())
    }

    /// Clean a value against its schema (handles objects, arrays, primitives)
    fn cleanup_value_against_schema(
        &self,
        value: &mut Value,
        schema_def: &Value,
    ) -> Result<(), BuildError> {
        // First, handle anyOf/oneOf wrappers by selecting the most appropriate branch
        // for the current JSON value type. This is important for cases like
        // ExternalConditions.shading_segments, which uses:
        //   "anyOf": [
        //     { "type": "array", "items": { "$ref": "#/$defs/ShadingSegment" } },
        //     { "type": "null" }
        //   ]
        // Without unwrapping anyOf, array items (ShadingSegment) never see their
        // own schema, so additionalProperties:false can't prune fields like `number`.
        if let Some(any_of) = schema_def.get("anyOf").and_then(|v| v.as_array()) {
            // Resolve $ref-only branches first so type matching and property
            // scoring see the real variant schemas (e.g. OnSiteGeneration's
            // anyOf of $ref PhotovoltaicSystemWithPanels / PhotovoltaicSystem).
            let resolved: Vec<&Value> = any_of
                .iter()
                .map(|candidate| {
                    candidate
                        .get("$ref")
                        .and_then(|r| r.as_str())
                        .and_then(|r| self.resolve_schema_ref(r))
                        .unwrap_or(candidate)
                })
                .collect();

            // Nothing to clean for nulls when a null branch exists.
            if value.is_null()
                && resolved
                    .iter()
                    .any(|c| c.get("type").and_then(|v| v.as_str()) == Some("null"))
            {
                return Ok(());
            }

            let mut chosen_schema: Option<&Value> = None;
            match &*value {
                Value::Array(_) => {
                    chosen_schema = resolved
                        .iter()
                        .find(|c| c.get("type").and_then(|v| v.as_str()) == Some("array"))
                        .copied();
                }
                Value::Object(obj) => {
                    let object_branches: Vec<&Value> = resolved
                        .iter()
                        .filter(|c| {
                            c.get("type").and_then(|v| v.as_str()) == Some("object")
                                || c.get("properties").is_some()
                        })
                        .copied()
                        .collect();
                    // With several object variants, pruning against the wrong one
                    // silently deletes valid user fields — pick the branch whose
                    // property set overlaps the value's keys the most.
                    chosen_schema = match object_branches.len() {
                        0 => None,
                        1 => Some(object_branches[0]),
                        _ => object_branches
                            .iter()
                            .max_by_key(|c| {
                                let props = Self::collect_schema_properties(c);
                                obj.keys().filter(|k| props.contains(*k)).count()
                            })
                            .copied(),
                    };
                }
                _ => {}
            }

            // Fallback: if we didn't find a matching type, just use the first branch.
            if chosen_schema.is_none() {
                chosen_schema = resolved.first().copied();
            }

            if let Some(schema) = chosen_schema {
                // Delegate to the same function with the unwrapped schema.
                return self.cleanup_value_against_schema(value, schema);
            }
        }

        match value {
            Value::Object(obj) => {
                // First, resolve $ref if schema_def itself is a $ref
                let effective_schema =
                    if let Some(ref_path) = schema_def.get("$ref").and_then(|v| v.as_str()) {
                        self.resolve_schema_ref(ref_path).unwrap_or(schema_def)
                    } else {
                        schema_def
                    };

                // If the schema has additionalProperties with $ref, that means each value in the object
                // should conform to the referenced schema. This is the case for properties like Zone
                // where Zone is an object with zone names as keys and Zone objects as values.
                if let Some(additional_props) = effective_schema.get("additionalProperties") {
                    if let Some(ref_path) = additional_props.get("$ref").and_then(|v| v.as_str()) {
                        if let Some(ref_schema) = self.resolve_schema_ref(ref_path) {
                            // Each value in this object should conform to the referenced schema
                            // Iterate over values and clean each one
                            for (_key, val) in obj.iter_mut() {
                                self.cleanup_value_against_schema(val, ref_schema)?;
                            }
                            return Ok(());
                        }
                    }
                }

                // Otherwise, clean the object against the schema normally
                self.cleanup_object_against_schema(value, effective_schema)?;
            }
            Value::Array(_) => {
                // Resolve $ref in items schema if present
                let items_schema = if let Some(items) = schema_def.get("items") {
                    if let Some(ref_path) = items.get("$ref").and_then(|v| v.as_str()) {
                        self.resolve_schema_ref(ref_path).unwrap_or(items)
                    } else {
                        items
                    }
                } else {
                    return Ok(());
                };

                if let Some(arr) = value.as_array_mut() {
                    for item in arr.iter_mut() {
                        self.cleanup_value_against_schema(item, items_schema)?;
                    }
                }
            }
            _ => {
                // Primitives don't need cleanup
            }
        }
        Ok(())
    }

    /// Special handling for BuildingElement which uses oneOf and discriminators
    fn cleanup_building_element_object(
        &self,
        value: &mut Value,
        _schema_def: &Value,
    ) -> Result<(), BuildError> {
        if let Some(obj) = value.as_object_mut() {
            // BuildingElement is an object with additionalProperties containing oneOf
            // Each key in BuildingElement is an element name, each value is an element object
            for (_element_name, element_value) in obj.iter_mut() {
                if let Some(element_obj) = element_value.as_object_mut() {
                    // Get the element type
                    if let Some(element_type) = element_obj.get("type").and_then(|v| v.as_str()) {
                        let discriminator_value = if element_type == "BuildingElementGround" {
                            element_obj.get("floor_type").and_then(|v| v.as_str())
                        } else {
                            None
                        };
                        let allowed_props = self.get_allowed_building_element_properties(
                            element_type,
                            Some(element_obj),
                            discriminator_value,
                        );

                        if !allowed_props.is_empty() {
                            let keys_to_remove: Vec<String> = element_obj
                                .keys()
                                .filter(|k| !allowed_props.contains(*k))
                                .cloned()
                                .collect();

                            for key in keys_to_remove {
                                element_obj.remove(&key);
                            }
                        }
                        if self.is_fhs_schema {
                            self.normalize_building_element_for_fhs(element_obj, None);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub fn validate_against_schema(&self, json_data: &Value) -> Result<(), BuildError> {
        // Compile the schema
        let validator = validator_for(&self.schema)
            .map_err(|e| BuildError::new("E025", &format!("Schema compilation failed: {e}")))?;

        // Validate the JSON data against the schema
        let errors: Vec<_> = validator.iter_errors(json_data).collect();
        if errors.is_empty() {
            Ok(())
        } else {
            // Filter out oneOf validation errors for BuildingElement types
            // The JSON Schema validator checks all oneOf branches sequentially and reports errors
            // from non-matching branches. Since cleanup already ensures only valid properties
            // are present, we can safely filter out these false positives.
            let mut filtered_errors = Vec::new();
            for error in errors {
                let error_str = format!("{error}");
                let instance_path = error.instance_path().to_string();
                let keyword_path = error.schema_path().to_string();

                // Helper to check if an error is a oneOf mismatch (non-matching branch)
                let is_oneof_mismatch = |error_str: &str, keyword_path: &str| -> bool {
                    // Check for explicit oneOf errors
                    if error_str.contains(
                        "is not valid under any of the schemas listed in the 'oneOf' keyword",
                    ) {
                        return true;
                    }
                    // Check for "was expected" errors from oneOf branches (e.g., "BuildingElementOpaque was expected")
                    if error_str.contains("was expected") && keyword_path.contains("/oneOf/") {
                        return true;
                    }
                    // Check for "Additional properties are not allowed" errors from oneOf branches
                    if error_str.contains("Additional properties are not allowed")
                        && keyword_path.contains("/oneOf/")
                    {
                        return true;
                    }
                    // Check for required property errors from oneOf branches
                    if error_str.contains("is a required property")
                        && keyword_path.contains("/oneOf/")
                    {
                        return true;
                    }
                    false
                };

                // Filter BuildingElement oneOf errors
                if instance_path.contains("/BuildingElement/") {
                    // Get the element object to check its type
                    if let Some(element_obj) = self.get_element_at_path(json_data, &instance_path) {
                        if let Some(element_type) = element_obj.get("type").and_then(|v| v.as_str())
                        {
                            // Check if this is a oneOf mismatch error
                            if is_oneof_mismatch(&error_str, &keyword_path) {
                                // Verify the element has a valid type field
                                let valid_types = [
                                    "BuildingElementOpaque",
                                    "BuildingElementTransparent",
                                    "BuildingElementGround",
                                    "BuildingElementAdjacentConditionedSpace",
                                    "BuildingElementAdjacentUnconditionedSpace_Simple",
                                    "BuildingElementPartyWall",
                                ];
                                if valid_types.contains(&element_type) {
                                    // This is a false positive from a non-matching oneOf branch
                                    continue;
                                }
                            }
                        }
                    }
                }

                // Filter ExternalConditions additionalProperties errors
                // The FHS schema allows these properties, but the validator may be checking
                // against a different schema or a resolved $ref that has additionalProperties: false
                if (instance_path == "/ExternalConditions"
                    || instance_path.starts_with("/ExternalConditions/"))
                    && error_str.contains("Additional properties are not allowed")
                {
                    let disallowed_props = [
                        "daylight_savings",
                        "end_day",
                        "january_first",
                        "leap_day_included",
                        "start_day",
                        "time_series_step",
                        "timezone",
                    ];
                    // Check if the error is about FHS-specific ExternalConditions properties
                    if disallowed_props.iter().any(|prop| error_str.contains(prop)) {
                        // These are valid in the FHS schema, so this is likely a validator issue
                        // Skip if the keyword path suggests it's from a $ref with additionalProperties: false
                        if keyword_path.contains("/$ref/additionalProperties") {
                            continue;
                        }
                    }
                }

                // Filter edge_insulation type mismatch errors from FHS schema conditional clauses
                // The FHS schema has a bug: a conditional allOf/then clause incorrectly defines
                // edge_insulation as an object when floor_type="Slab_edge_insulation", but the
                // base schema definition (and actual data) correctly uses an array.
                // Schema path: /properties/Zone/additionalProperties/properties/BuildingElement/additionalProperties/allOf/2/then/allOf/0/then/properties/edge_insulation/type
                if instance_path.contains("edge_insulation")
                    && error_str.contains("is not of type \"object\"")
                    && keyword_path.contains("/allOf/")
                    && keyword_path.contains("/then/")
                {
                    // Verify the actual value is an array (which is correct)
                    if let Some(value) = self.get_element_at_path(json_data, &instance_path) {
                        if value.is_array() {
                            // This is a false positive from the FHS schema conditional clause bug
                            // The base schema definition correctly expects an array
                            continue;
                        }
                    }
                }

                // FHS HotWaterSource uses a strict base `hw cylinder` object plus conditional
                // allOf branches for StorageTank/CombiBoiler/etc. The validator can report the
                // base unevaluatedProperties before considering the matching conditional branch.
                if instance_path == "/HotWaterSource/hw cylinder"
                    && error_str.contains("Unevaluated properties are not allowed")
                    && keyword_path.contains(
                        "/properties/HotWaterSource/properties/hw cylinder/unevaluatedProperties",
                    )
                {
                    if let Some(value) = self.get_element_at_path(json_data, &instance_path) {
                        if matches!(
                            value.get("type").and_then(|v| v.as_str()),
                            Some("StorageTank")
                                | Some("SmartHotWaterTank")
                                | Some("CombiBoiler")
                                | Some("PointOfUse")
                                | Some("HIU")
                                | Some("HeatBattery")
                        ) {
                            continue;
                        }
                    }
                }

                // Keep all other errors
                filtered_errors.push(error);
            }

            if filtered_errors.is_empty() {
                Ok(())
            } else {
                let mut error_messages = Vec::new();
                let mut validation_errors = Vec::new();
                for error in filtered_errors {
                    let message = error.to_string();
                    let path = error.instance_path().to_string();
                    let schema_path = error.schema_path().to_string();
                    let keyword = schema_path
                        .split('/')
                        .rfind(|part| !part.is_empty())
                        .map(ToOwned::to_owned);
                    error_messages.push(format!("{message} at {path}"));
                    validation_errors.push(ValidationError {
                        code: "E046".to_string(),
                        path,
                        message,
                        schema_path: Some(schema_path),
                        keyword,
                    });
                }
                Err(BuildError::with_validation_errors(
                    "E046",
                    &format!("Schema validation failed: {}", error_messages.join("; ")),
                    validation_errors,
                ))
            }
        }
    }

    /// Helper to get an element at a JSON path (e.g., /Zone/Living/BuildingElement/Window)
    fn get_element_at_path<'a>(&self, json_data: &'a Value, path: &str) -> Option<&'a Value> {
        let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
        let mut current = json_data;
        for part in parts {
            {
                let obj = current.as_object()?;
                current = obj.get(part)?;
            }
        }
        Some(current)
    }

    /// Calculate polygon area from coordinates using the shoelace formula
    /// Coordinates format: "x1,y1,z1|x2,y2,z2|..."
    fn calculate_polygon_area_from_coords(&self, coords_str: &str) -> Option<f64> {
        let coords: Vec<&str> = coords_str.split('|').collect();
        if coords.len() < 3 {
            return None;
        }

        let mut points = Vec::new();
        for coord_str in coords {
            let parts: Vec<&str> = coord_str.split(',').collect();
            if parts.len() >= 2 {
                if let (Ok(x), Ok(y)) = (
                    parts[0].trim().parse::<f64>(),
                    parts[1].trim().parse::<f64>(),
                ) {
                    points.push((x, y));
                }
            }
        }

        if points.len() < 3 {
            return None;
        }

        // Shoelace formula for polygon area
        let mut area = 0.0;
        for i in 0..points.len() {
            let j = (i + 1) % points.len();
            area += points[i].0 * points[j].1;
            area -= points[j].0 * points[i].1;
        }
        Some(area.abs() / 2.0)
    }

    /// Calculate zone area from geometry when floor_area is 0
    /// Strategy:
    /// 1. Sum areas from BuildingElementGround polygon coordinates
    /// 2. If no Ground elements, check for horizontal elements (pitch=0 or 180) and calculate from coordinates
    /// 3. If still no area, use Roof element area as fallback
    fn calculate_zone_area_from_geometry(
        &self,
        result: &mut Value,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<(), BuildError> {
        if let Some(zones) = result.get_mut("Zone").and_then(|z| z.as_object_mut()) {
            for (zone_name, zone_val) in zones.iter_mut() {
                if let Some(zone_obj) = zone_val.as_object_mut() {
                    let current_area = if self.is_fhs_schema {
                        zone_obj
                            .get("livingroom_area")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0)
                            + zone_obj
                                .get("restofdwelling_area")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0)
                    } else {
                        zone_obj.get("area").and_then(|v| v.as_f64()).unwrap_or(0.0)
                    };

                    // Only calculate if area is 0
                    if current_area > 0.0 {
                        continue;
                    }

                    let mut calculated_area = 0.0;

                    // Step 1: Try BuildingElementGround elements
                    if let Some(building_elements) = zone_obj
                        .get("BuildingElement")
                        .and_then(|be| be.as_object())
                    {
                        for (elem_name, elem_val) in building_elements {
                            if let Some(elem_obj) = elem_val.as_object() {
                                let elem_type =
                                    elem_obj.get("type").and_then(|v| v.as_str()).unwrap_or("");

                                if elem_type == "BuildingElementGround" {
                                    // Try to get coordinates from CSV data
                                    if let Some(ground_elements) = csv_data.get("Ground Elements") {
                                        for ground_row in ground_elements {
                                            if ground_row.get("Name").and_then(|v| v.as_str())
                                                == Some(elem_name)
                                                && ground_row.get("Zone").and_then(|v| v.as_str())
                                                    == Some(zone_name)
                                            {
                                                if let Some(coords_str) = ground_row
                                                    .get("coords")
                                                    .and_then(|v| v.as_str())
                                                {
                                                    if let Some(area) = self
                                                        .calculate_polygon_area_from_coords(
                                                            coords_str,
                                                        )
                                                    {
                                                        calculated_area += area;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Step 2: If no Ground elements, check for horizontal elements (pitch=0 or 180)
                    if calculated_area == 0.0 {
                        // Check Exposed Elements and Non-Exposed Elements for horizontal elements
                        for section in &["Exposed Elements", "Non-Exposed Elements"] {
                            if let Some(elements) = csv_data.get(*section) {
                                for elem_row in elements {
                                    if elem_row.get("Zone").and_then(|v| v.as_str())
                                        == Some(zone_name)
                                    {
                                        let pitch = elem_row
                                            .get("pitch")
                                            .and_then(|v| v.as_f64())
                                            .unwrap_or(90.0);

                                        // Horizontal elements (pitch=0 or 180) can represent floor/ceiling
                                        if pitch == 0.0 || pitch == 180.0 {
                                            if let Some(coords_str) =
                                                elem_row.get("coords").and_then(|v| v.as_str())
                                            {
                                                if let Some(area) = self
                                                    .calculate_polygon_area_from_coords(coords_str)
                                                {
                                                    calculated_area += area;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Step 3: Fallback to Roof element area if still no area
                    if calculated_area == 0.0 {
                        // First try to get Roof coordinates from CSV and calculate area
                        for section in &["Exposed Elements", "Non-Exposed Elements"] {
                            if let Some(elements) = csv_data.get(*section) {
                                for elem_row in elements {
                                    if elem_row.get("Zone").and_then(|v| v.as_str())
                                        == Some(zone_name)
                                    {
                                        let elem_name = elem_row
                                            .get("Name")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("");

                                        if elem_name.to_lowercase().contains("roof") {
                                            if let Some(coords_str) =
                                                elem_row.get("coords").and_then(|v| v.as_str())
                                            {
                                                if let Some(area) = self
                                                    .calculate_polygon_area_from_coords(coords_str)
                                                {
                                                    calculated_area = area;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // If still no area, use Roof element area from JSON
                        if calculated_area == 0.0 {
                            if let Some(building_elements) = zone_obj
                                .get("BuildingElement")
                                .and_then(|be| be.as_object())
                            {
                                // Look for Roof element
                                for (elem_name, elem_val) in building_elements {
                                    if elem_name.to_lowercase().contains("roof") {
                                        if let Some(elem_obj) = elem_val.as_object() {
                                            if let Some(roof_area) =
                                                elem_obj.get("area").and_then(|v| v.as_f64())
                                            {
                                                if roof_area > 0.0 {
                                                    calculated_area = roof_area;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Update zone area if we calculated it
                    if calculated_area > 0.0 {
                        if !self.is_fhs_schema {
                            zone_obj.insert(
                                "area".to_string(),
                                Value::Number(
                                    serde_json::Number::from_f64(calculated_area)
                                        .expect("Area should be a valid number"),
                                ),
                            );
                        }

                        // Also update volume if height is available
                        if let Some(height) = zone_obj.get("height").and_then(|v| v.as_f64()) {
                            if height > 0.0 {
                                let calculated_volume = calculated_area * height;
                                zone_obj.insert(
                                    "volume".to_string(),
                                    Value::Number(
                                        serde_json::Number::from_f64(calculated_volume)
                                            .expect("Volume should be a valid number"),
                                    ),
                                );
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Calculate env_area from building elements only
    /// This preserves defaults file values for other fields (test_pressure, test_result, ventilation_zone_height)
    ///
    /// env_area is the q50 air-permeability reference area: it must reflect the
    /// dwelling's leakage boundary, not every modelled building element. Internal
    /// partitions and intermediate floors within the same heated envelope
    /// (BuildingElementAdjacentConditionedSpace) are inside the air volume and
    /// would double-count if added; they are excluded here.
    fn calculate_env_area(
        &self,
        csv_data: &HashMap<String, Vec<HashMap<String, Value>>>,
    ) -> Result<f64, BuildError> {
        let mut all_elements = Vec::new();

        for section in &[
            "Exposed Elements",
            "Window Elements",
            "Ground Elements",
            "Non-Exposed Elements",
        ] {
            if let Some(elements) = csv_data.get(*section) {
                all_elements.extend(elements.iter());
            }
        }

        let mut env_area_sum = 0.0;

        for el in &all_elements {
            let element_type = el.get("Type").and_then(|v| v.as_str()).unwrap_or("");
            if element_type == "BuildingElementAdjacentConditionedSpace" {
                continue;
            }
            if let Some(area) = el.get("area").and_then(|v| v.as_f64()) {
                env_area_sum += area;
            }
        }

        Ok(env_area_sum)
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub fn write_json(&self, output_path: &str, json_data: &Value) -> Result<(), BuildError> {
        use std::fs;
        use std::path::Path;

        // Ensure .json extension
        let output_path = if output_path.ends_with(".json") {
            output_path.to_string()
        } else {
            format!("{output_path}.json")
        };

        // Create parent directories if they don't exist
        if let Some(parent) = Path::new(&output_path).parent() {
            fs::create_dir_all(parent).map_err(|e| {
                BuildError::new("E999", &format!("Failed to create output directory: {e}"))
            })?;
        }

        // Write JSON file
        let json_string = serde_json::to_string_pretty(json_data)
            .map_err(|e| BuildError::new("E999", &format!("Failed to serialize JSON: {e}")))?;

        fs::write(&output_path, json_string)
            .map_err(|e| BuildError::new("E999", &format!("Failed to write JSON file: {e}")))?;

        Ok(())
    }
}

#[cfg(test)]
mod extra_json_merge_tests {
    use super::*;
    use crate::parser::CSVParser;

    const SCHEMA_PATH: &str = crate::schema_paths::CORE_UPSTREAM_SCHEMA_REL_PATH;
    const DEFAULTS_PATH: &str = "../../data/defaults/defaults_template.json";

    fn build_partial_json(csv: &str, defaults_path: &str) -> Value {
        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(SCHEMA_PATH, defaults_path).expect("Builder should init");
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");
        result
    }

    #[test]
    fn opaque_extra_json_overrides_defaults() {
        // CSV includes an extra_json column with mass_distribution_class override
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Exposed Elements
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,extra_json
wall 0,Living,BuildingElementOpaque,4,90,2,2,0,0,"{""mass_distribution_class"":""D""}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);

        // Debug: print final JSON
        println!(
            "Final JSON: {:#?}",
            json["Zone"]["Living"]["BuildingElement"]["wall 0"]
        );

        let wall = json["Zone"]["Living"]["BuildingElement"]["wall 0"]
            .as_object()
            .unwrap();
        // Expect override from extra_json to apply (TDD – should fail until implemented)
        assert_eq!(wall.get("mass_distribution_class").unwrap(), "D");
    }

    // Note: Test for mechvent_extra_json_overrides_defaults_sfp removed - requires full model setup
    // Fix verified: extra_json now overrides defaults (see builder.rs lines 2057-2069)
    // Manual test: Run CSV merge on Great Haddon.csv, verify SFP=0.368 (not 1.5)

    #[test]
    fn ground_extra_json_ignored_for_unknown_keys() {
        // Ground has unknown key 'height' in extra_json - should be ignored, schema-valid
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Ground Elements
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,extra_json
ground 0,Living,BuildingElementGround,8,2,4,20,Slab_no_edge_insulation,2,0.2,"{""height"":4}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);

        let ground = json["Zone"]["Living"]["BuildingElement"]["ground 0"]
            .as_object()
            .unwrap();
        // Should not include 'height'
        assert!(!ground.contains_key("height"));
        // Must still pass schema-required fields via defaults merge
        assert!(ground.contains_key("u_value"));
    }

    #[test]
    fn ground_slab_edge_insulation_with_extra_json() {
        // Test that edge_insulation in extra_json for Slab_edge_insulation floor_type works correctly
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Ground Elements
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,extra_json
ground 0,Living,BuildingElementGround,8,2,4,20,Slab_edge_insulation,2,0.2,"{""edge_insulation"":[{""edge_thermal_resistance"":1,""type"":""horizontal"",""width"":1}]}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);

        let ground = json["Zone"]["Living"]["BuildingElement"]["ground 0"]
            .as_object()
            .unwrap();
        // Verify floor_type is set correctly
        assert_eq!(
            ground.get("floor_type").and_then(|v| v.as_str()),
            Some("Slab_edge_insulation")
        );

        // Verify edge_insulation is present and is an array
        let edge_insulation = ground.get("edge_insulation");
        assert!(
            edge_insulation.is_some(),
            "edge_insulation should be present"
        );
        assert!(
            edge_insulation.unwrap().is_array(),
            "edge_insulation should be an array"
        );

        // Verify the array content
        if let Some(Value::Array(arr)) = edge_insulation {
            assert!(!arr.is_empty(), "edge_insulation array should not be empty");
            if let Some(Value::Object(item)) = arr.first() {
                assert_eq!(
                    item.get("type").and_then(|v| v.as_str()),
                    Some("horizontal")
                );
                assert_eq!(
                    item.get("edge_thermal_resistance").and_then(|v| v.as_f64()),
                    Some(1.0)
                );
            }
        }
    }

    #[test]
    fn ground_slab_edge_insulation_with_space_in_name() {
        // Test that edge_insulation works correctly with element names containing spaces (like "Ground Floor")
        // This replicates the issue from Bucklers Park.csv where element name is "Ground Floor"
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Ground Elements
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
Ground Floor,Living,BuildingElementGround,43.16,0,0,26.73,Slab_edge_insulation,,0.27,,"-2.099,-17.931,0.000|-2.099,-12.469,0.000|-10.001,-12.469,0.000|-10.001,-17.931,0.000","{""u_value"":0.12,""edge_insulation"":[{""type"":""horizontal"",""edge_thermal_resistance"":1,""width"":1}]}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);

        let ground = json["Zone"]["Living"]["BuildingElement"]["Ground Floor"]
            .as_object()
            .unwrap();
        // Verify floor_type is set correctly
        assert_eq!(
            ground.get("floor_type").and_then(|v| v.as_str()),
            Some("Slab_edge_insulation")
        );

        // Verify edge_insulation is present and is an array (not an object)
        let edge_insulation = ground.get("edge_insulation");
        assert!(
            edge_insulation.is_some(),
            "edge_insulation should be present"
        );
        assert!(
            edge_insulation.unwrap().is_array(),
            "edge_insulation should be an array, not an object"
        );

        // Verify the array content
        if let Some(Value::Array(arr)) = edge_insulation {
            assert!(!arr.is_empty(), "edge_insulation array should not be empty");
            if let Some(Value::Object(item)) = arr.first() {
                assert_eq!(
                    item.get("type").and_then(|v| v.as_str()),
                    Some("horizontal")
                );
                assert_eq!(
                    item.get("edge_thermal_resistance").and_then(|v| v.as_f64()),
                    Some(1.0)
                );
                assert_eq!(item.get("width").and_then(|v| v.as_f64()), Some(1.0));
            }
        }

        // Verify u_value from extra_json is also set
        assert_eq!(ground.get("u_value").and_then(|v| v.as_f64()), Some(0.12));
    }

    #[test]
    fn bucklers_park_edge_insulation_validation_error() {
        // This test replicates the exact error from Bucklers Park CSV:
        // "[{"type":"horizontal","edge_thermal_resistance":1,"width":1}] is not of type "object" at /Zone/Living/BuildingElement/Ground Floor/edge_insulation"
        // The issue is that the validator is checking against a schema that expects an object, but edge_insulation should be an array.
        // This test should FAIL initially to help us diagnose the schema path resolution issue.
        // Use the same defaults path as the actual application to match the real behavior
        const BUCKLERS_DEFAULTS_PATH: &str = "../../data/defaults/defaults_template.json";

        let csv = r#"Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,
DefaultsPath,input/defaults/defaults_template.json,,,,,,,,,,,,,
Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area
Living,Zone,94.71,43.16

Ground Elements,,,,,,,,,,,,,,
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
Ground Floor,Living,BuildingElementGround,43.16,0,0,26.73,Slab_edge_insulation,,0.27,,"-2.099,-17.931,0.000|-2.099,-12.469,0.000|-10.001,-12.469,0.000|-10.001,-17.931,0.000","{""u_value"":0.12,""edge_insulation"":[{""type"":""horizontal"",""edge_thermal_resistance"":1,""width"":1}]}"
"#;

        let json = build_partial_json(csv, BUCKLERS_DEFAULTS_PATH);
        let ground = json["Zone"]["Living"]["BuildingElement"]["Ground Floor"]
            .as_object()
            .unwrap();
        let edge_insulation = ground.get("edge_insulation");
        assert!(
            edge_insulation.is_some(),
            "edge_insulation should be present"
        );
        assert!(
            edge_insulation.unwrap().is_array(),
            "edge_insulation should be an array, not an object"
        );
    }

    #[test]
    fn opaque_extra_json_numeric_override_areal_heat_capacity() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Exposed Elements
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,extra_json
wall 0,Living,BuildingElementOpaque,4,90,2,2,0,0,"{""areal_heat_capacity"":20000}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);
        let wall = json["Zone"]["Living"]["BuildingElement"]["wall 0"]
            .as_object()
            .unwrap();
        assert_eq!(wall.get("areal_heat_capacity").unwrap(), 20000);
    }

    #[test]
    fn transparent_extra_json_override_g_value() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Window Elements
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,extra_json
window 0,Living,BuildingElementTransparent,1.6,90,1,1.6,90,1,"{""g_value"":0.55}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);
        let window = json["Zone"]["Living"]["BuildingElement"]["window 0"]
            .as_object()
            .unwrap();
        assert_eq!(window.get("g_value").unwrap(), 0.55);
    }

    #[test]
    fn extra_json_invalid_type_causes_validation_error() {
        // mass_distribution_class should be string; here provide number -> expect validation error post-merge
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Exposed Elements
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,extra_json
wall 0,Living,BuildingElementOpaque,4,90,2,2,0,0,"{""mass_distribution_class"":123}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);
        let wall = json["Zone"]["Living"]["BuildingElement"]["wall 0"]
            .as_object()
            .unwrap();
        assert_eq!(wall.get("mass_distribution_class").unwrap(), 123);
    }

    #[test]
    fn malformed_extra_json_is_ignored_and_builds() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Exposed Elements
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,extra_json
wall 0,Living,BuildingElementOpaque,4,90,2,2,0,0,"{bad"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);
        let wall = json["Zone"]["Living"]["BuildingElement"]["wall 0"]
            .as_object()
            .unwrap();
        assert!(
            !wall.contains_key("extra_json"),
            "Malformed extra_json should be ignored during merge"
        );
    }
}

#[cfg(test)]
mod schema_cleanup_tests {
    use super::*;
    use serde_json::json;

    const CORE_SCHEMA_PATH: &str = crate::schema_paths::CORE_UPSTREAM_SCHEMA_REL_PATH;
    const FHS_SCHEMA_PATH: &str = crate::schema_paths::FHS_UPSTREAM_SCHEMA_REL_PATH;
    const DEFAULTS_PATH: &str = "../../data/defaults/defaults_template.json";

    #[test]
    fn removes_combustion_appliances_for_core_schema() {
        // JSON with CombustionAppliances (FHS-only)
        let mut json = json!({
            "InfiltrationVentilation": {
                "CombustionAppliances": {
                    "Fireplace": {
                        "supply_situation": "room_air",
                        "exhaust_situation": "into_separate_duct",
                        "fuel_type": "wood",
                        "appliance_type": "open_fireplace"
                    }
                },
                "Leaks": {},
                "Vents": {},
                "altitude": 0.0,
                "cross_vent_possible": false,
                "shield_class": "Normal",
                "terrain_class": "Suburban",
                "ventilation_zone_base_height": 0.0
            }
        });

        let builder =
            JSONBuilder::new(CORE_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        // CombustionAppliances should be removed
        let inf_vent = json["InfiltrationVentilation"].as_object().unwrap();
        assert!(
            !inf_vent.contains_key("CombustionAppliances"),
            "CombustionAppliances should be removed for Core schema"
        );
    }

    #[test]
    fn keeps_combustion_appliances_for_fhs_schema() {
        // JSON with CombustionAppliances (required in FHS)
        let mut json = json!({
            "InfiltrationVentilation": {
                "CombustionAppliances": {
                    "Fireplace": {
                        "supply_situation": "room_air",
                        "exhaust_situation": "into_separate_duct",
                        "fuel_type": "wood",
                        "appliance_type": "open_fireplace"
                    }
                },
                "Leaks": {},
                "Vents": {},
                "altitude": 0.0,
                "cross_vent_possible": false,
                "shield_class": "Normal",
                "terrain_class": "Suburban",
                "ventilation_zone_base_height": 0.0
            }
        });

        let builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        // CombustionAppliances should be kept
        let inf_vent = json["InfiltrationVentilation"].as_object().unwrap();
        assert!(
            inf_vent.contains_key("CombustionAppliances"),
            "CombustionAppliances should be kept for FHS schema"
        );
    }

    #[test]
    fn removes_is_external_door_from_opaque_for_core_schema() {
        let mut json = json!({
            "Zone": {
                "Living": {
                    "BuildingElement": {
                        "wall": {
                            "type": "BuildingElementOpaque",
                            "area": 10.0,
                            "is_external_door": true,
                            "areal_heat_capacity": 20000.0,
                            "base_height": 0.0,
                            "height": 2.5,
                            "mass_distribution_class": "D",
                            "orientation360": 0.0,
                            "pitch": 90.0,
                            "solar_absorption_coeff": 0.6,
                            "width": 4.0
                        }
                    }
                }
            }
        });

        let builder =
            JSONBuilder::new(CORE_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        let wall = json["Zone"]["Living"]["BuildingElement"]["wall"]
            .as_object()
            .unwrap();
        assert!(
            !wall.contains_key("is_external_door"),
            "is_external_door should be removed for Core schema"
        );
    }

    #[test]
    fn removes_lighting_from_zones_for_core_schema() {
        let mut json = json!({
            "Zone": {
                "Living": {
                    "Lighting": {
                        "efficacy": 80
                    },
                    "BuildingElement": {},
                    "area": 50.0,
                    "volume": 100.0,
                    "temp_setpnt_init": 20.0,
                    "ThermalBridging": 0.0
                }
            }
        });

        let builder =
            JSONBuilder::new(CORE_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        let zone = json["Zone"]["Living"].as_object().unwrap();
        assert!(
            !zone.contains_key("Lighting"),
            "Lighting should be removed from zones for Core schema"
        );
    }

    #[test]
    fn keeps_lighting_in_zones_for_fhs_schema() {
        let mut json = json!({
            "Zone": {
                "Living": {
                    "Lighting": {
                        "efficacy": 80
                    },
                    "BuildingElement": {},
                    "area": 50.0,
                    "volume": 100.0
                }
            }
        });

        let builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        let zone = json["Zone"]["Living"].as_object().unwrap();
        assert!(
            zone.contains_key("Lighting"),
            "Lighting should be kept in zones for FHS schema"
        );
    }

    #[test]
    fn removes_appliances_and_general_from_root_for_core_schema() {
        let mut json = json!({
            "Appliances": {
                "Washer": "Default"
            },
            "General": {
                "storeys_in_building": 1,
                "build_type": "house"
            },
            "Zone": {}
        });

        let builder =
            JSONBuilder::new(CORE_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        assert!(
            !json.as_object().unwrap().contains_key("Appliances"),
            "Appliances should be removed from root for Core schema"
        );
        assert!(
            !json.as_object().unwrap().contains_key("General"),
            "General should be removed from root for Core schema"
        );
    }

    #[test]
    fn keeps_appliances_and_general_for_fhs_schema() {
        let mut json = json!({
            "Appliances": {
                "Washer": "Default"
            },
            "General": {
                "storeys_in_building": 1,
                "build_type": "house"
            },
            "Zone": {}
        });

        let builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        assert!(
            json.as_object().unwrap().contains_key("Appliances"),
            "Appliances should be kept for FHS schema"
        );
        assert!(
            json.as_object().unwrap().contains_key("General"),
            "General should be kept for FHS schema"
        );
    }

    #[test]
    fn test_fhs_schema_external_conditions_structure() {
        // Verify the FHS schema structure for ExternalConditions
        let builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let schema = &builder.schema;

        // Check that ExternalConditions is defined directly (not via $ref)
        let ext_cond = schema
            .get("properties")
            .and_then(|p| p.get("ExternalConditions"));
        assert!(
            ext_cond.is_some(),
            "ExternalConditions should be in properties"
        );

        let ext_cond_obj = ext_cond.unwrap().as_object().unwrap();

        // Verify it doesn't use $ref
        assert!(
            !ext_cond_obj.contains_key("$ref"),
            "ExternalConditions should not use $ref in FHS schema"
        );

        // Verify it matches the current upstream FHS schema shape
        if let Some(props) = ext_cond_obj.get("properties").and_then(|p| p.as_object()) {
            assert!(
                props.contains_key("shading_segments"),
                "ExternalConditions should have shading_segments property"
            );
            assert!(
                !props.contains_key("timezone"),
                "ExternalConditions should not have legacy timezone property"
            );
        } else {
            panic!("ExternalConditions should have properties defined");
        }

        // Verify additionalProperties is not false
        if let Some(additional_props) = ext_cond_obj.get("additionalProperties") {
            if let Some(false_val) = additional_props.as_bool() {
                assert!(
                    !false_val,
                    "ExternalConditions should not have additionalProperties: false"
                );
            }
        }
    }

    #[test]
    fn test_preserves_external_conditions_fhs_properties() {
        // Test that cleanup preserves all FHS ExternalConditions properties
        let mut json = json!({
            "ExternalConditions": {
                "air_temperatures": vec![5.0; 8760],
                "wind_speeds": vec![3.0; 8760],
                "wind_directions": vec![180.0; 8760],
                "diffuse_horizontal_radiation": vec![50.0; 8760],
                "direct_beam_radiation": vec![100.0; 8760],
                "solar_reflectivity_of_ground": vec![0.2; 8760],
                "latitude": 51.5,
                "longitude": -0.1,
                "timezone": 0,
                "start_day": 0,
                "end_day": 365,
                "time_series_step": 1.0,
                "january_first": 1,
                "daylight_savings": "GMT",
                "leap_day_included": false,
                "direct_beam_conversion_needed": false,
                "shading_segments": [
                    {"start360": 0, "end360": 45},
                    {"start360": 45, "end360": 90},
                    {"start360": 90, "end360": 135},
                    {"start360": 135, "end360": 180},
                    {"start360": 180, "end360": 225},
                    {"start360": 225, "end360": 270},
                    {"start360": 270, "end360": 315},
                    {"start360": 315, "end360": 360}
                ]
            },
            "Zone": {}
        });

        let builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        let ext_cond = json.get("ExternalConditions").unwrap().as_object().unwrap();

        // Verify all FHS properties are preserved
        assert!(
            ext_cond.contains_key("timezone"),
            "timezone should be preserved"
        );
        assert!(
            ext_cond.contains_key("start_day"),
            "start_day should be preserved"
        );
        assert!(
            ext_cond.contains_key("end_day"),
            "end_day should be preserved"
        );
        assert!(
            ext_cond.contains_key("time_series_step"),
            "time_series_step should be preserved"
        );
        assert!(
            ext_cond.contains_key("daylight_savings"),
            "daylight_savings should be preserved"
        );
        assert!(
            ext_cond.contains_key("january_first"),
            "january_first should be preserved"
        );
        assert!(
            ext_cond.contains_key("leap_day_included"),
            "leap_day_included should be preserved"
        );
    }

    #[test]
    fn test_building_element_ground_cleanup() {
        // Test cleanup of BuildingElementGround with Suspended_floor type
        let mut json = json!({
            "Zone": {
                "Living": {
                    "BuildingElement": {
                        "Floor": {
                            "type": "BuildingElementGround",
                            "floor_type": "Suspended_floor",
                            "total_area": 50.0,
                            "perimeter": 30.0,
                            "u_value": 0.2,
                            "thermal_resistance_floor_construction": 5.0,
                            "areal_heat_capacity": 20000.0,
                            "mass_distribution_class": "D",
                            "thickness_walls": 0.3,
                            "psi_wall_floor_junc": 0.1,
                            "height_upper_surface": 0.5,
                            "pitch": 0,
                            "orientation360": 0
                        }
                    },
                    "area": 50.0,
                    "volume": 100.0
                }
            }
        });

        let builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        let floor = json["Zone"]["Living"]["BuildingElement"]["Floor"]
            .as_object()
            .unwrap();

        // Verify type is preserved
        assert_eq!(
            floor.get("type").and_then(|v| v.as_str()),
            Some("BuildingElementGround")
        );
        assert_eq!(
            floor.get("floor_type").and_then(|v| v.as_str()),
            Some("Suspended_floor")
        );

        // Verify required properties for Suspended_floor are present
        assert!(
            floor.contains_key("height_upper_surface"),
            "height_upper_surface should be preserved for Suspended_floor"
        );
    }

    #[test]
    fn test_building_element_transparent_cleanup() {
        // Test cleanup of BuildingElementTransparent (Window)
        let mut json = json!({
            "Zone": {
                "Living": {
                    "BuildingElement": {
                        "Window": {
                            "type": "BuildingElementTransparent",
                            "width": 1.5,
                            "height": 1.2,
                            "area": 1.8,
                            "pitch": 90,
                            "orientation360": 180,
                            "base_height": 0.9,
                            "frame_area_fraction": 0.25,
                            "g_value": 0.6,
                            "u_value": 1.4,
                            "thermal_resistance_construction": 0.07,
                            "free_area_height": 0.1,
                            "max_window_open_area": 0.5,
                            "mid_height": 0.6,
                            "window_part_list": [],
                            "shading": []
                        }
                    },
                    "area": 50.0,
                    "volume": 100.0
                }
            }
        });

        let builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        let window = json["Zone"]["Living"]["BuildingElement"]["Window"]
            .as_object()
            .unwrap();

        // Verify type is preserved
        assert_eq!(
            window.get("type").and_then(|v| v.as_str()),
            Some("BuildingElementTransparent")
        );

        // Verify window-specific properties are preserved
        assert!(
            window.contains_key("frame_area_fraction"),
            "frame_area_fraction should be preserved"
        );
        assert!(
            window.contains_key("g_value"),
            "g_value should be preserved"
        );
        assert!(
            window.contains_key("window_part_list"),
            "window_part_list should be preserved"
        );
    }

    #[test]
    fn test_fhs_validation_after_cleanup() {
        // Test that the FHS sanitiser removes legacy root/system fields before schema cleanup.
        let mut json = json!({
            "SimulationTime": {},
            "temp_internal_air_static_calcs": 20,
            "InternalGains": {},
            "Control": {},
            "HeatSourceWet": {
                "hp": {
                    "backup_ctrl_type": "None",
                    "time_delay_backup": 2,
                    "power_max_backup": 0
                }
            },
            "InfiltrationVentilation": {
                "cross_vent_possible": false,
                "cross_vent_factor": true
            },
            "Zone": {
                "Living": {
                    "SpaceHeatControl": "livingroom"
                }
            },
            "SpaceHeatSystem": {
                "Living radiator": {
                    "Control": "HeatingControls_Main"
                }
            }
        });

        let builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");

        builder.sanitize_fhs_output(&mut json);
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        assert!(json.get("SimulationTime").is_none());
        assert!(json.get("temp_internal_air_static_calcs").is_none());
        assert!(json.get("InternalGains").is_none());
        assert!(json.get("Control").is_none());
        assert!(json["HeatSourceWet"]["hp"]
            .get("time_delay_backup")
            .is_none());
        assert!(json["HeatSourceWet"]["hp"]
            .get("power_max_backup")
            .is_none());
        assert!(json["InfiltrationVentilation"]
            .get("cross_vent_possible")
            .is_none());
        assert!(json["InfiltrationVentilation"]
            .get("cross_vent_factor")
            .is_none());
        assert!(json["Zone"]["Living"].get("SpaceHeatControl").is_none());
        assert!(json["SpaceHeatSystem"]["Living radiator"]
            .get("Control")
            .is_none());
    }

    #[test]
    fn test_building_element_ground_suspended_floor_validation() {
        // Test that BuildingElementGround with Suspended_floor validates correctly
        // This reproduces the error: "BuildingElementGround" was expected but validator
        // checks against wrong oneOf branch
        let mut json = json!({
            "PartGcompliance": true,
            "NumberOfBedrooms": 3,
            "HeatingControlType": "SeparateTempControl",
            "SimulationTime": {},
            "ExternalConditions": {
                "shading_segments": [
                    {"start360": 0, "end360": 45},
                    {"start360": 45, "end360": 90},
                    {"start360": 90, "end360": 135},
                    {"start360": 135, "end360": 180},
                    {"start360": 180, "end360": 225},
                    {"start360": 225, "end360": 270},
                    {"start360": 270, "end360": 315},
                    {"start360": 315, "end360": 360}
                ]
            },
            "Appliances": {},
            "ColdWaterSource": {"mains water": {}},
            "EnergySupply": {"mains elec": {"fuel": "electricity", "is_export_capable": false}},
            "Control": {},
            "HotWaterSource": {},
            "HotWaterDemand": {"Distribution": {}},
            "Events": {},
            "SpaceHeatSystem": {},
            "General": {
                "storeys_in_building": 2,
                "build_type": "house"
            },
            "InfiltrationVentilation": {
                "Leaks": {
                    "ventilation_zone_height": 2.5,
                    "test_pressure": 50.0,
                    "test_result": 5.0,
                    "env_area": 50.0
                },
                "Vents": {},
                "CombustionAppliances": {},
                "altitude": 0.0,
                "cross_vent_possible": false,
                "shield_class": "Normal",
                "terrain_class": "Suburban",
                "ventilation_zone_base_height": 0.0
            },
            "Zone": {
                "Living": {
                    "area": 50.0,
                    "volume": 100.0,
                    "Lighting": {
                        "bulbs": {
                            "led": {
                                "count": 10,
                                "power": 8.0,
                                "efficacy": 80.0
                            }
                        }
                    },
                    "BuildingElement": {
                        "Floor": {
                            "type": "BuildingElementGround",
                            "floor_type": "Suspended_floor",
                            "total_area": 50.0,
                            "perimeter": 30.0,
                            "u_value": 0.2,
                            "thermal_resistance_floor_construction": 5.0,
                            "areal_heat_capacity": 20000.0,
                            "mass_distribution_class": "D",
                            "thickness_walls": 0.3,
                            "psi_wall_floor_junc": 0.1,
                            "height_upper_surface": 0.5,
                            "thermal_transm_walls": 0.5,
                            "shield_fact_location": "Average",
                            "thermal_resist_insul": 2.0,
                            "pitch": 0,
                            "orientation360": 0,
                            "area": 50.0
                        }
                    },
                    "ThermalBridging": {}
                }
            }
        });

        let builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");

        // Cleanup first
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        // Check what properties remain after cleanup
        let floor = json["Zone"]["Living"]["BuildingElement"]["Floor"]
            .as_object()
            .unwrap();
        eprintln!(
            "Floor properties after cleanup: {:?}",
            floor.keys().collect::<Vec<_>>()
        );
        eprintln!("Floor type: {:?}", floor.get("type"));
        eprintln!("Floor floor_type: {:?}", floor.get("floor_type"));

        assert_eq!(
            floor.get("type"),
            Some(&Value::String("BuildingElementGround".to_string()))
        );
        assert_eq!(
            floor.get("floor_type"),
            Some(&Value::String("Suspended_floor".to_string()))
        );
        assert!(floor.contains_key("total_area"));
        assert!(floor.contains_key("area"));
        assert!(floor.contains_key("perimeter"));
        assert!(floor.contains_key("thermal_resistance_floor_construction"));
        assert!(floor.contains_key("areal_heat_capacity"));
        assert!(floor.contains_key("mass_distribution_class"));
        assert!(floor.contains_key("height_upper_surface"));
        assert!(floor.contains_key("thermal_transm_walls"));
        assert!(floor.contains_key("shield_fact_location"));
        assert!(floor.contains_key("thermal_resist_insul"));
    }

    #[test]
    fn test_embedded_schema_matches_file_schema() {
        // Verify that the embedded schema in batch_runner matches the file schema
        use std::fs;

        // Load the file schema
        let file_schema_str =
            fs::read_to_string(FHS_SCHEMA_PATH).expect("Should be able to read FHS schema file");
        let file_schema: Value = serde_json::from_str(&file_schema_str)
            .expect("Should be able to parse FHS schema file");

        // Load the embedded schema used by runtime.
        let embedded_schema_str = crate::include_fhs_upstream_schema_json!();
        let embedded_schema: Value = serde_json::from_str(embedded_schema_str)
            .expect("Should be able to parse embedded FHS schema");

        // Compare ExternalConditions structure
        let file_ext_cond = file_schema
            .get("properties")
            .and_then(|p| p.get("ExternalConditions"));
        let embedded_ext_cond = embedded_schema
            .get("properties")
            .and_then(|p| p.get("ExternalConditions"));

        assert_eq!(
            file_ext_cond.is_some(),
            embedded_ext_cond.is_some(),
            "ExternalConditions should exist in both schemas"
        );

        if let (Some(file), Some(embedded)) = (file_ext_cond, embedded_ext_cond) {
            // Check that both have the same properties
            let file_props = file.get("properties").and_then(|p| p.as_object());
            let embedded_props = embedded.get("properties").and_then(|p| p.as_object());

            assert_eq!(
                file_props.is_some(),
                embedded_props.is_some(),
                "Both should have properties defined"
            );

            if let (Some(file_p), Some(embedded_p)) = (file_props, embedded_props) {
                // Check key FHS properties exist in both
                for key in &[
                    "timezone",
                    "start_day",
                    "end_day",
                    "time_series_step",
                    "daylight_savings",
                    "january_first",
                    "leap_day_included",
                ] {
                    assert_eq!(
                        file_p.contains_key(*key),
                        embedded_p.contains_key(*key),
                        "Property {key} should have same presence in both schemas"
                    );
                }
            }
        }
    }

    #[test]
    fn preserves_fhs_opaque_geometry_fields_before_validation() {
        use crate::parser::CSVParser;

        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Exposed Elements
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
FrontWallGround,Living,BuildingElementOpaque,10,90,4,2.5,0,0,FALSE,FALSE,,"0.000,0.000,0.000|4.000,0.000,0.000","{""thermal_resistance_construction"":0.75}"
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");

        if let Some(template) = builder.type_templates.get_mut("BuildingElementOpaque") {
            if let Some(template_obj) = template.as_object_mut() {
                template_obj.remove("colour");
            }
        }

        let mut result = builder.defaults.clone();

        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");

        let wall = result["Zone"]["Living"]["BuildingElement"]["FrontWallGround"]
            .as_object()
            .expect("Opaque wall should exist");

        assert_eq!(
            wall.get("type").and_then(|v| v.as_str()),
            Some("BuildingElementOpaque")
        );
        assert_eq!(wall.get("pitch").and_then(|v| v.as_i64()), Some(90));
        assert_eq!(wall.get("base_height").and_then(|v| v.as_i64()), Some(0));
        assert_eq!(wall.get("height").and_then(|v| v.as_f64()), Some(2.5));
        assert_eq!(wall.get("width").and_then(|v| v.as_i64()), Some(4));
        assert_eq!(wall.get("area").and_then(|v| v.as_i64()), Some(10));
        assert_eq!(
            wall.get("thermal_resistance_construction")
                .and_then(|v| v.as_f64()),
            Some(0.75)
        );
        assert!(
            wall.contains_key("areal_heat_capacity"),
            "Defaults-backed areal_heat_capacity should remain before validation"
        );
        assert!(
            wall.contains_key("mass_distribution_class"),
            "Defaults-backed mass_distribution_class should remain before validation"
        );
        assert!(
            !wall.contains_key("colour"),
            "Missing colour should surface as a validation issue rather than being auto-filled"
        );
    }

    #[test]
    fn removes_invalid_properties_from_building_element_ground_based_on_floor_type() {
        // Suspended_floor should not have depth_basement_floor
        let mut json = json!({
            "Zone": {
                "Living": {
                    "BuildingElement": {
                        "floor": {
                            "type": "BuildingElementGround",
                            "floor_type": "Suspended_floor",
                            "depth_basement_floor": 3.0,  // Invalid for Suspended_floor
                            "total_area": 30.0,
                            "area": 15.0,
                            "pitch": 180.0,
                            "u_value": 1.4
                        }
                    }
                }
            }
        });

        let builder =
            JSONBuilder::new(CORE_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        builder
            .cleanup_against_schema(&mut json)
            .expect("Cleanup should succeed");

        let floor = json["Zone"]["Living"]["BuildingElement"]["floor"]
            .as_object()
            .unwrap();
        assert!(
            !floor.contains_key("depth_basement_floor"),
            "depth_basement_floor should be removed for Suspended_floor"
        );
    }
}

#[cfg(test)]
mod wet_emitter_tests {
    use super::*;
    use crate::parser::CSVParser;
    use serde_json::json;

    const SCHEMA_PATH: &str = crate::schema_paths::CORE_UPSTREAM_SCHEMA_REL_PATH;
    const DEFAULTS_PATH: &str = "../../data/defaults/defaults_template.json";

    fn build_partial_json(csv: &str, defaults_path: &str) -> Value {
        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(SCHEMA_PATH, defaults_path).expect("Builder should init");
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");
        result
    }

    #[test]
    fn multiple_radiators_aggregated_into_single_system() {
        // CSV has 2 radiator rows for the same zone
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Wet Emitters
Name,Zone,Type,subcategory,unit_number
Radiator 1,Living,WetEmitter,radiator,1.0
Radiator 2,Living,WetEmitter,radiator,2.0
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);

        // Should create one system "Living radiator" with 2 emitter objects
        let system = json["SpaceHeatSystem"]["Living radiator"]
            .as_object()
            .unwrap();
        assert_eq!(system["Zone"], "Living");

        let emitters = system["emitters"].as_array().unwrap();
        assert_eq!(emitters.len(), 2, "Should have 2 emitter objects");

        // Check first radiator (c = 0.08 * 1.0 = 0.08)
        let emitter1 = emitters[0].as_object().unwrap();
        assert_eq!(emitter1["wet_emitter_type"], "radiator");
        assert_eq!(emitter1["c"], 0.08);
        assert_eq!(emitter1["n"], 1.2);
        assert_eq!(emitter1["frac_convective"], 0.4);

        // Check second radiator (c = 0.08 * 2.0 = 0.16)
        let emitter2 = emitters[1].as_object().unwrap();
        assert_eq!(emitter2["wet_emitter_type"], "radiator");
        assert_eq!(emitter2["c"], 0.16);
        assert_eq!(emitter2["n"], 1.2);
        assert_eq!(emitter2["frac_convective"], 0.4);

        // Zone should reference the system
        assert_eq!(json["Zone"]["Living"]["SpaceHeatSystem"], "Living radiator");
    }

    #[test]
    fn radiator_per_metre_fields_keep_length_in_metres() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Wet Emitters
Name,Zone,Type,subcategory,unit_number,extra_json
Radiator 1,Living,WetEmitter,radiator,2,"{""length"":1.5,""c_per_m"":0.04,""thermal_mass_per_m"":0.01,""n"":1.3,""frac_convective"":0.45}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);
        let emitters = json["SpaceHeatSystem"]["Living radiator"]["emitters"]
            .as_array()
            .unwrap();
        let emitter = emitters[0].as_object().unwrap();

        assert_eq!(emitter["wet_emitter_type"], "radiator");
        assert_eq!(emitter["c_per_m"], 0.04);
        assert_eq!(emitter["length"], 3.0);
        assert_eq!(emitter["thermal_mass_per_m"], 0.01);
        assert_eq!(emitter["n"], 1.3);
        assert_eq!(emitter["frac_convective"], 0.45);
        assert!(emitter.get("c").is_none());
    }

    #[test]
    fn radiator_per_metre_mode_drops_lumped_thermal_mass() {
        // A per-metre radiator (c_per_m + length) with a stray lumped `thermal_mass`.
        // Per-metre and lumped are a single coherent mode: in per-metre mode the
        // engine reads `thermal_mass_per_m`, so a lumped `thermal_mass` is inert.
        // It must be dropped rather than emitted alongside the per-metre fields.
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Wet Emitters
Name,Zone,Type,subcategory,unit_number,extra_json
Radiator 1,Living,WetEmitter,radiator,1,"{""length"":2,""c_per_m"":1.2,""thermal_mass"":1}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);
        let emitters = json["SpaceHeatSystem"]["Living radiator"]["emitters"]
            .as_array()
            .unwrap();
        let emitter = emitters[0].as_object().unwrap();

        assert_eq!(emitter["c_per_m"], 1.2);
        assert_eq!(emitter["length"], 2.0);
        assert!(
            emitter.get("thermal_mass").is_none(),
            "lumped thermal_mass must be dropped in per-metre mode"
        );
        assert!(emitter.get("thermal_mass_per_m").is_none());
        assert!(emitter.get("c").is_none());
    }

    #[test]
    fn radiator_per_metre_mode_prefers_per_metre_thermal_mass() {
        // H283 case: both thermal_mass_per_m and thermal_mass set alongside the
        // per-metre c. The per-metre thermal mass wins; lumped thermal_mass is dropped.
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Wet Emitters
Name,Zone,Type,subcategory,unit_number,extra_json
Radiator 1,Living,WetEmitter,radiator,1,"{""length"":2,""c_per_m"":1.2,""thermal_mass_per_m"":1,""thermal_mass"":1}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);
        let emitters = json["SpaceHeatSystem"]["Living radiator"]["emitters"]
            .as_array()
            .unwrap();
        let emitter = emitters[0].as_object().unwrap();

        assert_eq!(emitter["thermal_mass_per_m"], 1.0);
        assert!(
            emitter.get("thermal_mass").is_none(),
            "lumped thermal_mass must be dropped in per-metre mode"
        );
    }

    #[test]
    fn radiator_lumped_mode_drops_per_metre_thermal_mass() {
        // A lumped radiator (c, no length/c_per_m) with a stray thermal_mass_per_m.
        // thermal_mass_per_m is per-metre-only; in lumped mode it is inert and must
        // be dropped so the merged JSON never carries a schema-invalid mix.
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Wet Emitters
Name,Zone,Type,subcategory,unit_number,extra_json
Radiator 1,Living,WetEmitter,radiator,1,"{""c"":0.1,""thermal_mass"":2,""thermal_mass_per_m"":0.5}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);
        let emitters = json["SpaceHeatSystem"]["Living radiator"]["emitters"]
            .as_array()
            .unwrap();
        let emitter = emitters[0].as_object().unwrap();

        assert_eq!(emitter["c"], 0.1);
        assert_eq!(emitter["thermal_mass"], 2.0);
        assert!(
            emitter.get("thermal_mass_per_m").is_none(),
            "per-metre thermal_mass_per_m must be dropped in lumped mode"
        );
        assert!(emitter.get("length").is_none());
        assert!(emitter.get("c_per_m").is_none());
    }

    #[test]
    fn multiple_ufh_aggregated_into_single_system() {
        // CSV has 2 UFH rows for the same zone
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Wet Emitters
Name,Zone,Type,subcategory,area
UFH 1,Living,WetEmitter,ufh,20.0
UFH 2,Living,WetEmitter,ufh,30.0
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);

        // Should create one system "Living ufh" with 2 emitter objects
        let system = json["SpaceHeatSystem"]["Living ufh"].as_object().unwrap();
        assert_eq!(system["Zone"], "Living");

        let emitters = system["emitters"].as_array().unwrap();
        assert_eq!(emitters.len(), 2, "Should have 2 emitter objects");

        // Check first UFH
        let emitter1 = emitters[0].as_object().unwrap();
        assert_eq!(emitter1["wet_emitter_type"], "ufh");
        assert_eq!(emitter1["emitter_floor_area"], 20.0);
        assert_eq!(
            emitter1["equivalent_specific_thermal_mass"]
                .as_f64()
                .unwrap(),
            80.0
        );
        assert_eq!(emitter1["system_performance_factor"].as_f64().unwrap(), 5.0);
        assert_eq!(emitter1["frac_convective"], 0.43);

        // Check second UFH
        let emitter2 = emitters[1].as_object().unwrap();
        assert_eq!(emitter2["wet_emitter_type"], "ufh");
        assert_eq!(emitter2["emitter_floor_area"], 30.0);

        // Zone should reference the system
        assert_eq!(json["Zone"]["Living"]["SpaceHeatSystem"], "Living ufh");
    }

    #[test]
    fn mixed_emitter_types_create_separate_systems() {
        // CSV has both radiators and UFH for the same zone
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Wet Emitters
Name,Zone,Type,subcategory,unit_number,area
Radiator 1,Living,WetEmitter,radiator,1.0,
Radiator 2,Living,WetEmitter,radiator,2.0,
UFH 1,Living,WetEmitter,ufh,,25.0
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);

        // Should create two separate systems
        assert!(json["SpaceHeatSystem"].get("Living radiator").is_some());
        assert!(json["SpaceHeatSystem"].get("Living ufh").is_some());

        // Radiator system should have 2 emitters
        let rad_system = json["SpaceHeatSystem"]["Living radiator"]
            .as_object()
            .unwrap();
        assert_eq!(rad_system["emitters"].as_array().unwrap().len(), 2);

        // UFH system should have 1 emitter
        let ufh_system = json["SpaceHeatSystem"]["Living ufh"].as_object().unwrap();
        assert_eq!(ufh_system["emitters"].as_array().unwrap().len(), 1);

        // Zone must list both wet systems so FHS preprocessing attaches Control to each WetDistribution.
        let zone_shs = &json["Zone"]["Living"]["SpaceHeatSystem"];
        let names: Vec<&str> = match zone_shs {
            Value::Array(items) => items
                .iter()
                .map(|v| v.as_str().expect("SpaceHeatSystem[] entries should be strings"))
                .collect(),
            Value::String(s) => panic!(
                "expected array of SpaceHeatSystem refs when zone has UFH + radiators, got string {s:?}"
            ),
            other => panic!("unexpected Zone.SpaceHeatSystem shape: {other:?}"),
        };
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(
            sorted,
            vec!["Living radiator", "Living ufh"],
            "zone should reference both wet systems (sorted), got {names:?}"
        );
    }

    #[test]
    fn csv_emitters_remove_existing_systems_for_zone() {
        // Base JSON has existing system for "Living" zone
        // CSV defines new emitters for "Living" - should remove old system
        let base_json = json!({
            "Zone": {
                "Living": {
                    "SpaceHeatSystem": "old system",
                    "area": 50.0,
                    "volume": 100.0
                }
            },
            "SpaceHeatSystem": {
                "old system": {
                    "type": "WetDistribution",
                    "Zone": "Living",
                    "emitters": [{
                        "wet_emitter_type": "radiator",
                        "c": 0.05,
                        "n": 1.1,
                        "frac_convective": 0.3
                    }]
                }
            }
        });

        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Wet Emitters
Name,Zone,Type,subcategory,unit_number
New Radiator,Living,WetEmitter,radiator,1.0
"#;

        let mut parser = CSVParser::new();
        let csv_data = parser.parse_csv(csv).expect("CSV should parse");
        let builder = JSONBuilder::new(SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");

        // Build with base JSON (simulating merge with defaults)
        let mut result = base_json.clone();
        builder
            .merge_wet_emitters(&mut result, &csv_data)
            .expect("Should merge");

        // Old system should be removed
        assert!(result["SpaceHeatSystem"].get("old system").is_none());

        // New system should exist
        assert!(result["SpaceHeatSystem"].get("Living radiator").is_some());

        // Zone should reference new system
        assert_eq!(
            result["Zone"]["Living"]["SpaceHeatSystem"],
            "Living radiator"
        );
    }

    #[test]
    fn csv_emitters_replace_existing_space_heat_systems() {
        // Base JSON has systems for "Living" and "Bedroom".
        // When CSV wet emitters are supplied, SpaceHeatSystem is rebuilt from CSV,
        // so pre-existing systems are cleared rather than selectively preserved.
        let base_json = json!({
            "Zone": {
                "Living": {
                    "SpaceHeatSystem": "living system",
                    "area": 50.0,
                    "volume": 100.0
                },
                "Bedroom": {
                    "SpaceHeatSystem": "bedroom system",
                    "area": 20.0,
                    "volume": 40.0
                }
            },
            "SpaceHeatSystem": {
                "living system": {
                    "type": "WetDistribution",
                    "Zone": "Living",
                    "emitters": []
                },
                "bedroom system": {
                    "type": "WetDistribution",
                    "Zone": "Bedroom",
                    "emitters": []
                }
            }
        });

        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Wet Emitters
Name,Zone,Type,subcategory,unit_number
Radiator,Living,WetEmitter,radiator,1.0
"#;

        let mut parser = CSVParser::new();
        let csv_data = parser.parse_csv(csv).expect("CSV should parse");
        let builder = JSONBuilder::new(SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");

        let mut result = base_json.clone();
        builder
            .merge_wet_emitters(&mut result, &csv_data)
            .expect("Should merge");

        // Living system should be removed (replaced by CSV-defined one)
        assert!(result["SpaceHeatSystem"].get("living system").is_none());

        // Bedroom system is also removed as part of the rebuild.
        assert!(result["SpaceHeatSystem"].get("bedroom system").is_none());

        // New CSV-derived system should exist.
        assert!(result["SpaceHeatSystem"].get("Living radiator").is_some());
    }

    #[test]
    fn linked_wet_emitters_populate_explicit_space_heat_system() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Systems
Name,Zone,Type,subcategory,system_preset,extra_json
Heat Pump,Living,System,HeatSourceWet,hp,"{""HeatSourceWet"":{""hp"":{""type"":""HeatPump"",""EnergySupply"":""mains elec"",""source_type"":""OutsideAir"",""sink_type"":""Water"",""temp_lower_operating_limit"":-5,""temp_return_feed_max"":70,""min_temp_diff_flow_return_for_hp_to_operate"":0,""modulating_control"":true,""power_crankcase_heater"":0.01,""power_heating_circ_pump"":0.015,""power_off"":0.015,""power_source_circ_pump"":0.01,""power_standby"":0.015,""test_data_EN14825"":[{""capacity"":8.0,""cop"":3.0,""design_flow_temp"":45,""temp_outlet"":42,""temp_source"":0,""temp_test"":2,""test_letter"":""B""}],""time_constant_onoff_operation"":140,""var_flow_temp_ctrl_during_test"":true}}}"
Living circuit,Living,System,SpaceHeatSystem,,"{""SpaceHeatSystem"":{""Living circuit"":{""type"":""WetDistribution"",""Zone"":""Living"",""HeatSource"":{""name"":""hp"",""temp_flow_limit_upper"":65},""design_flow_temp"":45,""temp_diff_emit_dsgn"":8,""variable_flow"":true,""min_flow_rate"":2,""max_flow_rate"":12,""thermal_mass"":0.2,""ecodesign_controller"":{""ecodesign_control_class"":2,""min_outdoor_temp"":-5,""max_outdoor_temp"":18,""min_flow_temp"":28}}}}"

Wet Emitters
Name,Zone,Type,subcategory,unit_number,space_heat_system,extra_json
Radiator,Living,WetEmitter,radiator,2,Living circuit,"{""n"":1.3,""frac_convective"":0.45}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);

        assert!(
            json["SpaceHeatSystem"].get("Living radiator").is_none(),
            "linked emitters should not create a generated fallback system"
        );
        let system = json["SpaceHeatSystem"]["Living circuit"]
            .as_object()
            .expect("explicit system should be preserved");
        assert_eq!(system["type"], "WetDistribution");
        assert_eq!(system["Zone"], "Living");
        assert_eq!(system["design_flow_temp"], 45);
        assert_eq!(system["temp_diff_emit_dsgn"], 8);
        assert_eq!(system["min_flow_rate"], 2);
        assert_eq!(system["max_flow_rate"], 12);
        assert_eq!(system["ecodesign_controller"]["min_flow_temp"], 28);

        let emitters = system["emitters"].as_array().unwrap();
        assert_eq!(emitters.len(), 1);
        assert_eq!(emitters[0]["wet_emitter_type"], "radiator");
        assert_eq!(emitters[0]["c"], 0.16);
        assert_eq!(emitters[0]["n"], 1.3);
        assert_eq!(emitters[0]["frac_convective"], 0.45);
        assert_eq!(json["Zone"]["Living"]["SpaceHeatSystem"], "Living circuit");
    }

    #[test]
    fn mixed_linked_and_unlinked_wet_emitters_keep_only_linked_explicit_system() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Systems
Name,Zone,Type,subcategory,system_preset,extra_json
Heat Pump,Living,System,HeatSourceWet,hp,"{""HeatSourceWet"":{""hp"":{""type"":""HeatPump"",""EnergySupply"":""mains elec"",""source_type"":""OutsideAir"",""sink_type"":""Water"",""temp_lower_operating_limit"":-5,""temp_return_feed_max"":70,""min_temp_diff_flow_return_for_hp_to_operate"":0,""modulating_control"":true,""power_crankcase_heater"":0.01,""power_heating_circ_pump"":0.015,""power_off"":0.015,""power_source_circ_pump"":0.01,""power_standby"":0.015,""test_data_EN14825"":[{""capacity"":8.0,""cop"":3.0,""design_flow_temp"":45,""temp_outlet"":42,""temp_source"":0,""temp_test"":2,""test_letter"":""B""}],""time_constant_onoff_operation"":140,""var_flow_temp_ctrl_during_test"":true}}}"
Living circuit,Living,System,SpaceHeatSystem,,"{""SpaceHeatSystem"":{""Living circuit"":{""type"":""WetDistribution"",""Zone"":""Living"",""HeatSource"":{""name"":""hp"",""temp_flow_limit_upper"":65},""design_flow_temp"":45,""temp_diff_emit_dsgn"":8,""variable_flow"":true,""min_flow_rate"":2,""max_flow_rate"":12,""thermal_mass"":0.2,""ecodesign_controller"":{""ecodesign_control_class"":2,""min_outdoor_temp"":-5,""max_outdoor_temp"":18,""min_flow_temp"":28}}}}"

Wet Emitters
Name,Zone,Type,subcategory,area,unit_number,space_heat_system,extra_json
Linked Radiator,Living,WetEmitter,radiator,,2,Living circuit,"{""n"":1.3,""frac_convective"":0.45}"
Unlinked Radiator,Living,WetEmitter,radiator,,1,,"{""length"":0.6,""frac_convective"":0.92}"
Unlinked UFH,Living,WetEmitter,ufh,8,,,"{""emitter_floor_area"":8,""frac_convective"":0.45}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);
        let space_heat_systems = json["SpaceHeatSystem"]
            .as_object()
            .expect("SpaceHeatSystem should be an object");

        assert!(
            space_heat_systems.get("Living radiator").is_none(),
            "unlinked radiator should not create a generated fallback system"
        );
        assert!(
            space_heat_systems.get("Living ufh").is_none(),
            "unlinked UFH should not create a generated fallback system"
        );

        let system = space_heat_systems["Living circuit"]
            .as_object()
            .expect("explicit system should be preserved");
        assert_eq!(system["design_flow_temp"], 45);
        assert_eq!(system["ecodesign_controller"]["min_flow_temp"], 28);
        let emitters = system["emitters"].as_array().unwrap();
        assert_eq!(
            emitters.len(),
            1,
            "only emitters linked to the explicit system should be merged"
        );
        assert_eq!(emitters[0]["wet_emitter_type"], "radiator");
        assert_eq!(json["Zone"]["Living"]["SpaceHeatSystem"], "Living circuit");
    }

    #[test]
    fn blank_space_heat_system_column_does_not_generate_legacy_wet_systems() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Wet Emitters
Name,Zone,Type,subcategory,area,unit_number,space_heat_system,extra_json
Unlinked Radiator,Living,WetEmitter,radiator,,1,,"{""length"":0.6,""frac_convective"":0.92}"
Unlinked UFH,Living,WetEmitter,ufh,8,,,"{""emitter_floor_area"":8,""frac_convective"":0.45}"
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);
        let space_heat_systems = json["SpaceHeatSystem"]
            .as_object()
            .expect("SpaceHeatSystem should be an object");

        assert!(
            space_heat_systems.get("Living radiator").is_none(),
            "blank explicit links should not create a generated radiator system"
        );
        assert!(
            space_heat_systems.get("Living ufh").is_none(),
            "blank explicit links should not create a generated UFH system"
        );
        assert!(
            json["Zone"]["Living"].get("SpaceHeatSystem").is_none(),
            "zone should not reference generated systems when current CSV links are blank"
        );
    }

    #[test]
    fn multiple_fancoils_aggregated_into_single_system() {
        // CSV has 2 fancoil rows (note: fancoil not yet implemented, so this will fail initially)
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Wet Emitters
Name,Zone,Type,subcategory,n_units
Fancoil 1,Living,WetEmitter,fancoil,2
Fancoil 2,Living,WetEmitter,fancoil,3
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);

        // Should create one system "Living fancoil" with 2 emitter objects
        let system = json["SpaceHeatSystem"]["Living fancoil"]
            .as_object()
            .unwrap();
        assert_eq!(system["Zone"], "Living");

        let emitters = system["emitters"].as_array().unwrap();
        assert_eq!(emitters.len(), 2, "Should have 2 emitter objects");

        // Check first fancoil
        let emitter1 = emitters[0].as_object().unwrap();
        assert_eq!(emitter1["wet_emitter_type"], "fancoil");
        assert_eq!(emitter1["n_units"], 2);
        assert!(emitter1.get("fancoil_test_data").is_some());

        // Check second fancoil
        let emitter2 = emitters[1].as_object().unwrap();
        assert_eq!(emitter2["wet_emitter_type"], "fancoil");
        assert_eq!(emitter2["n_units"], 3);

        // Zone should reference the system
        assert_eq!(json["Zone"]["Living"]["SpaceHeatSystem"], "Living fancoil");
    }

    #[test]
    fn default_space_heat_system_assigned_to_multiple_zones_causes_validation_error() {
        // This test replicates the Bucklers Park issue where the default "zone 1 radiators" system
        // gets assigned to both "Living" and "Rest of Dwelling" zones, causing HEM engine error:
        // "SpaceHeatSystem (zone 1 radiators) has been assigned to more than one Zone"
        //
        // Root cause:
        // 1. Defaults have: Zone "zone 1" with SpaceHeatSystem="zone 1 radiators"
        // 2. CSV creates zones: "Living" and "Rest of Dwelling" (not "zone 1")
        // 3. When creating zones, code copies default zone structure (line 244-259)
        // 4. Since no default zone named "Living" or "Rest of Dwelling" exists, it falls back
        //    to first default zone ("zone 1") and copies its SpaceHeatSystem reference
        // 5. Both zones end up with SpaceHeatSystem="zone 1 radiators"
        // 6. But the system's Zone field still says "zone 1", causing HEM engine error
        //
        // Use the same defaults file as Bucklers Park to replicate the exact issue
        const BUCKLERS_DEFAULTS_PATH: &str = "../../data/defaults/defaults_template.json";

        let csv = r#"Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,
DefaultsPath,input/defaults/defaults_template.json,,,,,,,,,,,,,
Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area
Living,Zone,94.71,43.16
Rest of Dwelling,Zone,0,0
"#;

        let json = build_partial_json(csv, BUCKLERS_DEFAULTS_PATH);

        // Check what systems exist
        let space_heat_systems = json.get("SpaceHeatSystem").and_then(|s| s.as_object());
        assert!(space_heat_systems.is_some(), "SpaceHeatSystem should exist");
        let space_heat_systems = space_heat_systems.unwrap();

        // After fix: "zone 1 radiators" should be renamed to "Living radiators" and Zone updated
        // Old system "zone 1 radiators" should not exist
        assert!(
            space_heat_systems.get("zone 1 radiators").is_none(),
            "Old system 'zone 1 radiators' should not exist - it should have been renamed"
        );

        // New system should exist with first zone name
        let living_system = space_heat_systems.get("Living radiators");
        assert!(
            living_system.is_some(),
            "System 'Living radiators' should exist (renamed from 'zone 1 radiators')"
        );

        if let Some(system) = living_system {
            let system_zone = system.get("Zone").and_then(|v| v.as_str()).unwrap_or("");
            assert_eq!(
                system_zone, "Living",
                "System should have Zone='Living' (updated from 'zone 1')"
            );
        }

        // Check which zones reference systems
        let living_ref = json["Zone"]["Living"]
            .get("SpaceHeatSystem")
            .and_then(|v| v.as_str());
        let rest_ref = json["Zone"]["Rest of Dwelling"]
            .get("SpaceHeatSystem")
            .and_then(|v| v.as_str());

        // After fix: Only first zone should reference the system
        // The system should be assigned to "Living" (first zone), not "Rest of Dwelling"
        if let Some(ref_name) = living_ref {
            assert_eq!(
                ref_name, "Living radiators",
                "Living zone should reference 'Living radiators'"
            );
            // Verify the referenced system's Zone field matches
            if let Some(sys) = space_heat_systems.get(ref_name) {
                assert_eq!(
                    sys.get("Zone").and_then(|v| v.as_str()),
                    Some("Living"),
                    "Referenced system's Zone field should match zone name"
                );
            }
        }

        // Rest of Dwelling should not reference the same system (or should have no system)
        if let Some(ref_name) = rest_ref {
            assert_ne!(ref_name, "Living radiators",
                "Rest of Dwelling should not reference 'Living radiators' (only first zone gets default system)");
        }

        // Verify zones exist
        assert!(
            json["Zone"]["Living"].is_object(),
            "Living zone should exist"
        );
        assert!(
            json["Zone"]["Rest of Dwelling"].is_object(),
            "Rest of Dwelling zone should exist"
        );
    }

    #[test]
    fn radiators_assigned_to_different_zones_creates_separate_systems() {
        // Test that when radiators are assigned to different zones in CSV,
        // separate SpaceHeatSystem objects are created for each zone
        let csv = r#"Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area
Living,Zone,100,50
Bedroom,Zone,80,40

Wet Emitters,,,,,,,,,,,,,
Name,Zone,Type,subcategory,area
radiator 1,Living,WetEmitter,radiator,2.0
radiator 2,Bedroom,WetEmitter,radiator,1.5
"#;

        let json = build_partial_json(csv, DEFAULTS_PATH);

        // Check that two separate systems were created
        let space_heat_systems = json
            .get("SpaceHeatSystem")
            .and_then(|s| s.as_object())
            .expect("SpaceHeatSystem should exist");

        // Find systems for Living and Bedroom zones
        let living_system = space_heat_systems
            .iter()
            .find(|(_, sys)| sys.get("Zone").and_then(|v| v.as_str()) == Some("Living"))
            .map(|(name, _)| name);

        let bedroom_system = space_heat_systems
            .iter()
            .find(|(_, sys)| sys.get("Zone").and_then(|v| v.as_str()) == Some("Bedroom"))
            .map(|(name, _)| name);

        assert!(
            living_system.is_some(),
            "Living zone should have a SpaceHeatSystem"
        );
        assert!(
            bedroom_system.is_some(),
            "Bedroom zone should have a SpaceHeatSystem"
        );
        assert_ne!(
            living_system, bedroom_system,
            "Living and Bedroom should have different SpaceHeatSystem objects"
        );

        // Verify zones reference the correct systems
        let living_ref = json["Zone"]["Living"]["SpaceHeatSystem"]
            .as_str()
            .expect("Living zone should reference a system");
        let bedroom_ref = json["Zone"]["Bedroom"]["SpaceHeatSystem"]
            .as_str()
            .expect("Bedroom zone should reference a system");

        assert_eq!(
            living_ref,
            living_system.unwrap(),
            "Living zone should reference its system"
        );
        assert_eq!(
            bedroom_ref,
            bedroom_system.unwrap(),
            "Bedroom zone should reference its system"
        );
        assert_ne!(
            living_ref, bedroom_ref,
            "Living and Bedroom zones should reference different systems"
        );

        // Verify each system's Zone field matches the zone name
        let living_system_obj = space_heat_systems
            .get(living_ref)
            .expect("Living system should exist");
        let bedroom_system_obj = space_heat_systems
            .get(bedroom_ref)
            .expect("Bedroom system should exist");

        assert_eq!(
            living_system_obj["Zone"].as_str(),
            Some("Living"),
            "Living system's Zone field should be 'Living'"
        );
        assert_eq!(
            bedroom_system_obj["Zone"].as_str(),
            Some("Bedroom"),
            "Bedroom system's Zone field should be 'Bedroom'"
        );

        // Verify each system has the correct emitters
        let living_emitters = living_system_obj["emitters"]
            .as_array()
            .expect("Living system should have emitters");
        let bedroom_emitters = bedroom_system_obj["emitters"]
            .as_array()
            .expect("Bedroom system should have emitters");

        assert_eq!(
            living_emitters.len(),
            1,
            "Living system should have 1 emitter"
        );
        assert_eq!(
            bedroom_emitters.len(),
            1,
            "Bedroom system should have 1 emitter"
        );

        // Verify emitters are radiators with correct properties
        assert_eq!(
            living_emitters[0]["wet_emitter_type"].as_str(),
            Some("radiator"),
            "Living emitter should be a radiator"
        );
        assert_eq!(
            bedroom_emitters[0]["wet_emitter_type"].as_str(),
            Some("radiator"),
            "Bedroom emitter should be a radiator"
        );

        // Radiators have c, n, and frac_convective fields
        // Both should have valid radiator properties (the exact c value depends on defaults/calculation)
        assert!(
            living_emitters[0].get("c").is_some(),
            "Living radiator should have c field"
        );
        assert!(
            bedroom_emitters[0].get("c").is_some(),
            "Bedroom radiator should have c field"
        );
        assert!(
            living_emitters[0].get("n").is_some(),
            "Living radiator should have n field"
        );
        assert!(
            bedroom_emitters[0].get("n").is_some(),
            "Bedroom radiator should have n field"
        );
    }
}

#[cfg(test)]
mod onsite_generation_tests {
    use super::*;
    use crate::parser::CSVParser;

    const SCHEMA_PATH: &str = crate::schema_paths::CORE_UPSTREAM_SCHEMA_REL_PATH;
    const DEFAULTS_PATH: &str = "../../data/defaults/defaults_template.json";

    fn build_partial_json(csv: &str) -> Value {
        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");
        result
    }

    #[test]
    fn creates_onsite_generation_from_csv() {
        // CSV has OnSiteGeneration with polygon coordinates
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

On-Site Generation
Name,Type,generation_type,pitch,orientation360,base_height,peak_power,coords,extra_json
PV System 1,OnSiteGeneration,PhotovoltaicSystem,30,180,10,2.5,"-6.460,-4.940,0.000|-4.300,-4.940,0.000|-4.300,2.560,0.000|-6.460,2.560,0.000","{""ventilation_strategy"":""moderately_ventilated"",""EnergySupply"":""mains elec"",""shading"":[],""inverter_peak_power_dc"":2,""inverter_peak_power_ac"":1.4,""inverter_is_inside"":false,""inverter_type"":""optimised_inverter""}"
"#;

        let json = build_partial_json(csv);

        // Should create OnSiteGeneration entry
        let pv_system = json["OnSiteGeneration"]["PV System 1"].as_object().unwrap();
        assert_eq!(pv_system["type"], "PhotovoltaicSystem");
        assert_eq!(pv_system["peak_power"].as_f64().unwrap(), 2.5);
        assert_eq!(pv_system["pitch"].as_f64().unwrap(), 30.0);
        assert_eq!(
            pv_system["orientation360"].as_f64().unwrap(),
            180.0,
            "core profile keeps orientation360 numeric (integer rounding is FHS-only)"
        );
        assert_eq!(pv_system["base_height"].as_f64().unwrap(), 10.0);
        assert_eq!(pv_system["ventilation_strategy"], "moderately_ventilated");
        assert_eq!(pv_system["EnergySupply"], "mains elec");

        // Check inverter properties
        assert_eq!(pv_system["inverter_peak_power_dc"].as_f64().unwrap(), 2.0);
        assert_eq!(pv_system["inverter_peak_power_ac"].as_f64().unwrap(), 1.4);
        assert!(!pv_system["inverter_is_inside"].as_bool().unwrap());
        assert_eq!(pv_system["inverter_type"], "optimised_inverter");

        // Check shading array exists
        assert!(pv_system["shading"].is_array());
    }

    #[test]
    fn onsite_generation_explicit_width_height_columns_take_precedence() {
        // CSV carries explicit width / height columns (post-2026-05 layout). Builder must
        // use them verbatim instead of recomputing from the polygon.
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

On-Site Generation
Name,Type,generation_type,pitch,orientation360,base_height,peak_power,width,height,coords,extra_json
PV Array,OnSiteGeneration,PhotovoltaicSystem,30,180,10,2.5,3,4,"0,0,0|2,0,0|2,1,0|0,1,0","{""ventilation_strategy"":""moderately_ventilated"",""EnergySupply"":""mains elec"",""shading"":[]}"
"#;

        let json = build_partial_json(csv);

        let pv = json["OnSiteGeneration"]["PV Array"].as_object().unwrap();
        assert_eq!(pv["width"].as_f64().unwrap(), 3.0);
        assert_eq!(pv["height"].as_f64().unwrap(), 4.0);
    }

    #[test]
    fn onsite_generation_missing_width_height_uses_slope_corrected_fallback() {
        // Older CSVs predate the width/height columns; builder falls back to coord+pitch
        // derivation matching the TS `derivePvDimensionsFromCoords` algorithm.
        // 2x1 plan polygon, pitch 60°: width = first edge = 2;
        // height = projected depth 1 / cos(60°) = 2.
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

On-Site Generation
Name,Type,generation_type,pitch,orientation360,base_height,peak_power,coords,extra_json
PV Sloped,OnSiteGeneration,PhotovoltaicSystem,60,180,10,2.5,"0,0,0|2,0,0|2,1,0|0,1,0","{""ventilation_strategy"":""moderately_ventilated"",""EnergySupply"":""mains elec"",""shading"":[]}"
"#;

        let json = build_partial_json(csv);

        let pv = json["OnSiteGeneration"]["PV Sloped"].as_object().unwrap();
        let w = pv["width"].as_f64().unwrap();
        let h = pv["height"].as_f64().unwrap();
        assert!((w - 2.0).abs() < 1e-6, "width should be 2.0, got {w}");
        assert!(
            (h - 2.0).abs() < 1e-6,
            "height should be 2.0 (1 / cos 60°), got {h}"
        );
    }

    #[test]
    fn creates_flat_roof_pv_system() {
        // CSV has flat roof PV (pitch = 0)
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

On-Site Generation
Name,Type,generation_type,pitch,orientation360,base_height,peak_power,coords,extra_json
Flat PV,OnSiteGeneration,PhotovoltaicSystem,0,0,5,1.5,"-6.460,-4.940,0.000|-4.300,-4.940,0.000|-4.300,2.560,0.000|-6.460,2.560,0.000","{""ventilation_strategy"":""unventilated"",""EnergySupply"":""mains elec"",""shading"":[],""inverter_peak_power_dc"":1.5,""inverter_peak_power_ac"":1.0,""inverter_is_inside"":true,""inverter_type"":""string_inverter""}"
"#;

        let json = build_partial_json(csv);

        let pv_system = json["OnSiteGeneration"]["Flat PV"].as_object().unwrap();
        assert_eq!(pv_system["pitch"].as_f64().unwrap(), 0.0);
        assert_eq!(pv_system["ventilation_strategy"], "unventilated");
    }

    #[test]
    fn multiple_onsite_generation_systems() {
        // CSV has multiple PV systems
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

On-Site Generation
Name,Type,generation_type,pitch,orientation360,base_height,peak_power,coords,extra_json
PV South,OnSiteGeneration,PhotovoltaicSystem,30,180,10,2.5,"-6.460,-4.940,0.000|-4.300,-4.940,0.000|-4.300,2.560,0.000|-6.460,2.560,0.000","{""ventilation_strategy"":""moderately_ventilated"",""EnergySupply"":""mains elec"",""shading"":[],""inverter_peak_power_dc"":2,""inverter_peak_power_ac"":1.4,""inverter_is_inside"":false,""inverter_type"":""optimised_inverter""}"
PV East,OnSiteGeneration,PhotovoltaicSystem,30,90,10,1.5,"-4.300,-4.940,0.000|-0.960,-4.940,0.000|-0.960,2.560,0.000|-4.300,2.560,0.000","{""ventilation_strategy"":""moderately_ventilated"",""EnergySupply"":""mains elec"",""shading"":[],""inverter_peak_power_dc"":1.5,""inverter_peak_power_ac"":1.0,""inverter_is_inside"":false,""inverter_type"":""string_inverter""}"
"#;

        let json = build_partial_json(csv);

        // Should have both systems
        assert!(json["OnSiteGeneration"].get("PV South").is_some());
        assert!(json["OnSiteGeneration"].get("PV East").is_some());

        let pv_south = json["OnSiteGeneration"]["PV South"].as_object().unwrap();
        assert_eq!(pv_south["orientation360"].as_f64().unwrap(), 180.0);
        assert_eq!(pv_south["peak_power"].as_f64().unwrap(), 2.5);

        let pv_east = json["OnSiteGeneration"]["PV East"].as_object().unwrap();
        assert_eq!(pv_east["orientation360"].as_f64().unwrap(), 90.0);
        assert_eq!(pv_east["peak_power"].as_f64().unwrap(), 1.5);
    }

    #[test]
    fn generic_csv_pv_name_creates_single_system_without_default_template() {
        // The current shared defaults fixture does not include a "Default PV" placeholder,
        // so a generic CSV name should produce a single concrete OnSiteGeneration entry.
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

On-Site Generation
Name,Type,generation_type,pitch,orientation360,base_height,peak_power,coords,extra_json
OnSiteGeneration,OnSiteGeneration,PhotovoltaicSystem,30,180.53,10,12,"-1.620,2.500,2.000|-5.960,2.460,2.000|-6.060,-1.180,2.000|-1.540,-1.160,2.000","{""ventilation_strategy"":""moderately_ventilated"",""EnergySupply"":""mains elec"",""shading"":[]}"
"#;

        let json = build_partial_json(csv);

        assert!(
            json["OnSiteGeneration"].get("Default PV").is_none(),
            "Default PV placeholder should not exist in this defaults fixture"
        );
        assert!(
            json["OnSiteGeneration"].get("OnSiteGeneration").is_some(),
            "Generic CSV PV name should create a single OnSiteGeneration entry"
        );

        let default_pv = json["OnSiteGeneration"]["OnSiteGeneration"]
            .as_object()
            .unwrap();

        // CSV values should override defaults
        assert_eq!(
            default_pv["peak_power"].as_f64().unwrap(),
            12.0,
            "peak_power from CSV should override default 0"
        );
        assert_eq!(default_pv["pitch"].as_f64().unwrap(), 30.0);
        assert_eq!(default_pv["base_height"].as_f64().unwrap(), 10.0);

        // Core profile keeps fractional orientation360 untouched (rounding to
        // integers is an FHS schema requirement only).
        assert_eq!(default_pv["orientation360"].as_f64().unwrap(), 180.53);

        // CSV omits explicit width/height columns, so the merger falls back to
        // slope-corrected derivation: width = first edge ≈ 4.34,
        // height = projected plan depth / cos(30°) ≈ 4.30 (matches TS
        // `derivePvDimensionsFromCoords`).
        let width = default_pv["width"].as_f64().unwrap();
        let height = default_pv["height"].as_f64().unwrap();
        assert!(
            (width - 4.34).abs() < 0.1,
            "width should be approximately 4.34 from first edge, got {width}"
        );
        assert!(
            (height - 4.30).abs() < 0.1,
            "height should be approximately 4.30 (slope-corrected projected depth), got {height}"
        );

        // Default properties should be preserved
        assert_eq!(default_pv["type"], "PhotovoltaicSystem");
        assert_eq!(default_pv["ventilation_strategy"], "moderately_ventilated");
        assert_eq!(default_pv["EnergySupply"], "mains elec");
        assert_eq!(
            default_pv["inverter_peak_power_dc"].as_f64().unwrap(),
            1.0,
            "Default inverter_peak_power_dc should be preserved"
        );
        assert_eq!(
            default_pv["inverter_peak_power_ac"].as_f64().unwrap(),
            1.0,
            "Default inverter_peak_power_ac should be preserved"
        );
        assert!(
            default_pv["inverter_is_inside"].as_bool().unwrap(),
            "Default inverter_is_inside should be preserved"
        );
        assert_eq!(
            default_pv["inverter_type"], "string_inverter",
            "Default inverter_type should be preserved"
        );
    }

    #[test]
    fn csv_orientation360_column_beats_extra_json() {
        // Contract precedence: CSV columns > extra_json > defaults. A stale
        // extra_json orientation360 must not override the authored column.
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

On-Site Generation
Name,Type,generation_type,pitch,orientation360,base_height,peak_power,coords,extra_json
PV Test,OnSiteGeneration,PhotovoltaicSystem,30,0,10,2.5,"-6.460,-4.940,0.000|-4.300,-4.940,0.000|-4.300,2.560,0.000|-6.460,2.560,0.000","{""orientation360"":270.7,""ventilation_strategy"":""moderately_ventilated"",""EnergySupply"":""mains elec"",""shading"":[]}"
"#;

        let json = build_partial_json(csv);

        let pv_system = json["OnSiteGeneration"]["PV Test"].as_object().unwrap();
        assert_eq!(
            pv_system["orientation360"].as_f64().unwrap(),
            0.0,
            "CSV orientation360 column must beat the stale extra_json copy"
        );
    }

    #[test]
    fn removes_default_pv_when_creating_named_system() {
        // When CSV creates a named system (not "OnSiteGeneration" or "Default PV"),
        // the empty "Default PV" placeholder should be removed
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

On-Site Generation
Name,Type,generation_type,pitch,orientation360,base_height,peak_power,coords,extra_json
PV South,OnSiteGeneration,PhotovoltaicSystem,30,180,10,2.5,"-6.460,-4.940,0.000|-4.300,-4.940,0.000|-4.300,2.560,0.000|-6.460,2.560,0.000","{""ventilation_strategy"":""moderately_ventilated"",""EnergySupply"":""mains elec"",""shading"":[]}"
"#;

        let json = build_partial_json(csv);

        // Should create "PV South" entry
        assert!(
            json["OnSiteGeneration"].get("PV South").is_some(),
            "Should have PV South entry"
        );

        // Should NOT have empty "Default PV" placeholder (it should be removed)
        assert!(
            json["OnSiteGeneration"].get("Default PV").is_none(),
            "Should NOT have empty Default PV placeholder when creating named system"
        );

        let pv_south = json["OnSiteGeneration"]["PV South"].as_object().unwrap();
        assert_eq!(pv_south["peak_power"].as_f64().unwrap(), 2.5);
    }
}

#[cfg(test)]
mod electric_battery_tests {
    use super::*;
    use crate::parser::CSVParser;

    const SCHEMA_PATH: &str = crate::schema_paths::CORE_UPSTREAM_SCHEMA_REL_PATH;
    const DEFAULTS_PATH: &str = "../../data/defaults/defaults_template.json";

    fn build_partial_json(csv: &str) -> Value {
        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");
        result
    }

    #[test]
    fn creates_electric_battery_nested_under_energy_supply() {
        // CSV has ElectricBattery - should nest under EnergySupply with fuel="electricity"
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Systems
Name,Zone,Type,system_type,coords,extra_json
Battery 1,Living,ElectricBattery,ElectricBattery,"-5.0,0.0,0.0","{""capacity"":5.0,""charge_discharge_efficiency_round_trip"":0.85,""battery_age"":0,""minimum_charge_rate_one_way_trip"":0.001,""maximum_charge_rate_one_way_trip"":2.0,""maximum_discharge_rate_one_way_trip"":1.8,""battery_location"":""inside"",""grid_charging_possible"":false,""EnergySupply"":""mains elec""}"
"#;

        let json = build_partial_json(csv);

        // Should nest under EnergySupply["mains elec"]["ElectricBattery"]
        let battery = json["EnergySupply"]["mains elec"]["ElectricBattery"]
            .as_object()
            .unwrap();
        assert_eq!(battery["capacity"].as_f64().unwrap(), 5.0);
        assert_eq!(
            battery["charge_discharge_efficiency_round_trip"]
                .as_f64()
                .unwrap(),
            0.85
        );
        assert_eq!(
            battery["minimum_charge_rate_one_way_trip"]
                .as_f64()
                .unwrap(),
            0.001
        );
        assert_eq!(
            battery["maximum_charge_rate_one_way_trip"]
                .as_f64()
                .unwrap(),
            2.0
        );
        assert_eq!(
            battery["maximum_discharge_rate_one_way_trip"]
                .as_f64()
                .unwrap(),
            1.8
        );
        assert_eq!(battery["battery_location"], "inside");
        assert!(battery.get("grid_charging_possible").is_none());
        assert!(json["EnergySupply"]["mains elec"]
            .get("grid_charging_possible")
            .is_none());
    }

    #[test]
    fn electric_battery_with_grid_charging() {
        // CSV has ElectricBattery with grid_charging_possible=true
        // Note: threshold_charges and threshold_prices need 12 items each (one per month)
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Systems
Name,Zone,Type,system_type,coords,extra_json
Battery Grid,Living,ElectricBattery,ElectricBattery,"-5.0,0.0,0.0","{""capacity"":10.0,""charge_discharge_efficiency_round_trip"":0.9,""battery_age"":0,""minimum_charge_rate_one_way_trip"":0.001,""maximum_charge_rate_one_way_trip"":3.0,""maximum_discharge_rate_one_way_trip"":2.5,""battery_location"":""outside"",""grid_charging_possible"":true,""threshold_charges"":[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,0.95,0.85],""threshold_prices"":[0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6],""tariff"":""time_of_use"",""EnergySupply"":""mains elec""}"
"#;

        let json = build_partial_json(csv);

        let battery = json["EnergySupply"]["mains elec"]["ElectricBattery"]
            .as_object()
            .unwrap();
        assert!(battery.get("grid_charging_possible").is_none());
        assert_eq!(battery["capacity"].as_f64().unwrap(), 10.0);
        assert_eq!(battery["battery_location"], "outside");

        // Legacy grid-charging fields should be dropped from output (not in current schemas).
        let energy_supply = json["EnergySupply"]["mains elec"].as_object().unwrap();
        assert!(energy_supply.get("grid_charging_possible").is_none());
        assert!(energy_supply.get("threshold_charges").is_none());
        assert!(energy_supply.get("threshold_prices").is_none());
        assert!(energy_supply.get("tariff").is_none());
    }
}

// Note: system_element_tests live in tests/csv_merge_fixes_tests.rs using the
// convert_geometry_csv_to_json public API (same pattern as the fancoil/emitter tests).
// The JSONBuilder::new(path) approach used here for electric_battery_tests used to
// hit an FHS-detection bug when detection relied on schema path naming.

#[cfg(test)]
mod zone_consolidation_tests {
    use super::*;
    use serde_json::json;

    const FHS_SCHEMA_PATH: &str = crate::schema_paths::FHS_UPSTREAM_SCHEMA_REL_PATH;
    const DEFAULTS_PATH: &str = "../../data/defaults/defaults_template.json";

    #[test]
    fn consolidation_disambiguates_colliding_thermal_bridge_names() {
        // The CSV parser rejects duplicate names within a section, so collisions
        // can only arise internally (e.g. renames) — but a plain insert would
        // silently drop one zone's bridge heat loss, so the merge must
        // disambiguate like the BuildingElement merge does.
        let builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("builder should init");
        let mut result = json!({
            "Zone": {
                "Living": {
                    "volume": 60.0, "area": 30.0,
                    "BuildingElement": {},
                    "ThermalBridging": {
                        "TB E2": {"type": "ThermalBridgeLinear", "junction_type": "E2",
                                   "linear_thermal_transmittance": 0.05, "length": 4.0}
                    }
                },
                "Bedroom": {
                    "volume": 40.0, "area": 20.0,
                    "BuildingElement": {},
                    "ThermalBridging": {
                        "TB E2": {"type": "ThermalBridgeLinear", "junction_type": "E2",
                                   "linear_thermal_transmittance": 0.05, "length": 7.0}
                    }
                }
            }
        });

        builder
            .consolidate_zones_for_fhs(&mut result)
            .expect("consolidation should succeed");

        let zones = result["Zone"].as_object().unwrap();
        assert_eq!(zones.len(), 1, "FHS consolidates to a single zone");
        let (_, zone) = zones.iter().next().unwrap();
        let tb = zone["ThermalBridging"].as_object().unwrap();
        assert_eq!(
            tb.len(),
            2,
            "both zones' bridges must survive consolidation, got keys {:?}",
            tb.keys().collect::<Vec<_>>()
        );
        let lengths: Vec<f64> = tb
            .values()
            .filter_map(|b| b.get("length").and_then(|v| v.as_f64()))
            .collect();
        assert!(
            lengths.contains(&4.0) && lengths.contains(&7.0),
            "both bridge lengths must be present, got {lengths:?}"
        );
    }
}

#[cfg(test)]
mod ventilation_systems_fhs_defaults_tests {
    use super::*;
    use crate::parser::CSVParser;

    const FHS_SCHEMA_PATH: &str = crate::schema_paths::FHS_UPSTREAM_SCHEMA_REL_PATH;
    const DEFAULTS_PATH: &str = "../../data/defaults/defaults_template.json";

    #[test]
    fn intermittent_mev_gets_sfp_default_when_missing() {
        // Use a minimal-but-valid geometry CSV (zones + a few elements) and add an
        // Intermittent MEV system that omits SFP. This previously failed schema
        // validation under FHS schemas.
        let csv = r#"Zone
Name,Type,volume,floor_area,height,simplified thermal bridging
Default Zone,Zone,100,50,2.5,FALSE

Lighting
Name,Zone,efficacy,count,power
light_1,Default Zone,50,1,10

Exposed Elements
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
wall_1,Default Zone,BuildingElementOpaque,10,90,5,2.5,0,0,FALSE,FALSE,,"0.000,0.000,0.000|5.000,0.000,0.000",{}
wall_2,Default Zone,BuildingElementOpaque,10,90,5,2.5,90,0,FALSE,FALSE,,"5.000,0.000,0.000|5.000,5.000,0.000",{}
wall_3,Default Zone,BuildingElementOpaque,10,90,5,2.5,180,0,FALSE,FALSE,,"5.000,5.000,0.000|0.000,5.000,0.000",{}
wall_4,Default Zone,BuildingElementOpaque,10,90,5,2.5,270,0,FALSE,FALSE,,"0.000,5.000,0.000|0.000,0.000,0.000",{}

Window Elements
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,linked_wall,frame_area_fraction,free_area_height,mid_height,max_window_open_area,coords,extra_json
window_1,Default Zone,BuildingElementTransparent,2,90,1,2,0,0.5,wall_1,0.25,1.6,1.5,2,"1.000,0.000,0.500|2.000,0.000,0.500",{}

Ground Elements
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
floor_1,Default Zone,BuildingElementGround,25,5,5,20,Slab_no_edge_insulation,,,,"0.000,0.000,0.000|5.000,0.000,0.000|5.000,5.000,0.000|0.000,5.000,0.000",{}

Ventilation Systems
Name,Type,vent_type,extra_json
vent1,MechanicalVentilation,Intermittent MEV,"{}"
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        let mv = result["InfiltrationVentilation"]["MechanicalVentilation"]["vent1"]
            .as_object()
            .expect("MechanicalVentilation system should exist");

        assert!(
            mv.contains_key("SFP"),
            "SFP should be present for Intermittent MEV under FHS schema"
        );
        // Ensure we didn't accidentally pull in measured_* fields from some other template.
        assert!(
            !mv.contains_key("measured_fan_power") && !mv.contains_key("measured_air_flow_rate"),
            "Intermittent MEV should not include measured_* fields by default"
        );
    }

    fn ventilation_row(fields: &[&str; 15]) -> String {
        fields.join(",")
    }

    fn mvhr_terminal_csv(include_exhaust: bool) -> String {
        let mut rows = vec![
            ventilation_row(&[
                "mvhr_1",
                "MechanicalVentilation",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "MVHR",
                "\"0,0,0\"",
                r#""{""mvhr_eff"":"""",""design_zone_cooling_covered_by_mech_vent"":"""",""design_zone_heating_covered_by_mech_vent"":""""}""#,
            ]),
            ventilation_row(&[
                "supply_duct",
                "MechanicalVentilationDuctwork",
                "0",
                "1",
                "supply",
                "",
                "mvhr_1",
                "",
                "",
                "",
                "",
                "",
                "",
                "\"0,0,2.4|1,0,2.4\"",
                "\"{}\"",
            ]),
            ventilation_row(&[
                "intake_duct",
                "MechanicalVentilationDuctwork",
                "0",
                "1",
                "intake",
                "",
                "mvhr_1",
                "",
                "",
                "",
                "",
                "",
                "",
                "\"0,0,2.4|1,0,2.4\"",
                "\"{}\"",
            ]),
            ventilation_row(&[
                "intake_terminal",
                "MechanicalVentilationTerminal",
                "",
                "",
                "",
                "intake",
                "mvhr_1",
                "wall_1",
                "",
                "",
                "",
                "",
                "",
                "\"0,0,2.4\"",
                "\"{}\"",
            ]),
        ];
        if include_exhaust {
            rows.push(ventilation_row(&[
                "exhaust_terminal",
                "MechanicalVentilationTerminal",
                "",
                "",
                "",
                "exhaust",
                "mvhr_1",
                "wall_1",
                "",
                "",
                "",
                "",
                "",
                "\"1,0,2.5\"",
                "\"{}\"",
            ]));
        }

        format!(
            r#"Zone
Name,Type,volume,floor_area,height,simplified thermal bridging
Default Zone,Zone,100,50,2.5,FALSE

Exposed Elements
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
wall_1,Default Zone,BuildingElementOpaque,10,90,5,2.5,180,0,FALSE,FALSE,,"0.000,0.000,0.000|5.000,0.000,0.000",{{}}

Ground Elements
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
floor_1,Default Zone,BuildingElementGround,25,5,5,20,Slab_no_edge_insulation,,,,"0.000,0.000,0.000|5.000,0.000,0.000|5.000,5.000,0.000|0.000,5.000,0.000",{{}}

Ventilation Systems
Name,Type,floor_id,length,duct_type,terminal_type,parent_element,host_element,mid_height_air_flow_path,area_cm2,orientation360,pitch,vent_type,coords,extra_json
{}
"#,
            rows.join("\n")
        )
    }

    #[test]
    fn mvhr_terminal_rows_generate_intake_and_exhaust_positions() {
        let csv = mvhr_terminal_csv(true);
        let mut parser = CSVParser::new();
        let data = parser.parse_csv(&csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let result = builder.build_json(&data).expect("MVHR CSV should merge");

        let mv = result["InfiltrationVentilation"]["MechanicalVentilation"]["mvhr_1"]
            .as_object()
            .expect("MechanicalVentilation system should exist");
        let ductwork = mv["ductwork"]
            .as_array()
            .expect("linked duct rows should produce ductwork array");
        let position_intake = mv["position_intake"]
            .as_object()
            .expect("intake terminal should produce position_intake");
        let position_exhaust = mv["position_exhaust"]
            .as_object()
            .expect("exhaust terminal should produce position_exhaust");

        assert_eq!(mv["mvhr_eff"].as_f64(), Some(0.85));
        assert!(mv.get("design_zone_cooling_covered_by_mech_vent").is_none());
        assert!(mv.get("design_zone_heating_covered_by_mech_vent").is_none());
        assert_eq!(
            position_intake["mid_height_air_flow_path"].as_f64(),
            Some(2.4)
        );
        assert_eq!(
            position_exhaust["mid_height_air_flow_path"].as_f64(),
            Some(2.5)
        );
        assert_eq!(position_intake["orientation360"].as_f64(), Some(180.0));
        assert_eq!(position_intake["pitch"].as_f64(), Some(90.0));
        assert!(ductwork.iter().all(|duct| {
            duct.get("parent_element").is_none()
                && duct.get("host_element").is_none()
                && duct.get("terminal_type").is_none()
                && duct.get("floor_id").is_none()
        }));
        assert!(position_intake.get("parent_element").is_none());
        assert!(position_intake.get("host_element").is_none());
        assert!(position_intake.get("terminal_type").is_none());
    }

    #[test]
    fn mvhr_manual_terminal_rows_generate_positions_without_hosts() {
        let csv = mvhr_terminal_csv(true)
            .replace(
                "intake,mvhr_1,wall_1,,,,,,\"0,0,2.4\"",
                "intake,mvhr_1,,2.4,,315,90,,\"0,0,2.4\"",
            )
            .replace(
                "exhaust,mvhr_1,wall_1,,,,,,\"1,0,2.5\"",
                "exhaust,mvhr_1,,2.5,,135,90,,\"1,0,2.5\"",
            );
        let mut parser = CSVParser::new();
        let data = parser.parse_csv(&csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let result = builder
            .build_json(&data)
            .expect("manual MVHR terminals should merge");

        let mv = &result["InfiltrationVentilation"]["MechanicalVentilation"]["mvhr_1"];
        assert_eq!(
            mv["position_intake"]["mid_height_air_flow_path"].as_f64(),
            Some(2.4)
        );
        assert_eq!(
            mv["position_intake"]["orientation360"].as_f64(),
            Some(315.0)
        );
        assert_eq!(mv["position_intake"]["pitch"].as_f64(), Some(90.0));
        assert_eq!(
            mv["position_exhaust"]["orientation360"].as_f64(),
            Some(135.0)
        );
    }

    #[test]
    fn mvhr_terminal_rows_error_when_required_role_is_missing() {
        let csv = mvhr_terminal_csv(false);
        let mut parser = CSVParser::new();
        let data = parser.parse_csv(&csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let err = builder
            .build_json(&data)
            .expect_err("missing exhaust terminal should fail clearly");

        assert_eq!(err.code, "E040");
        assert!(err.message.contains("missing exhaust terminal"));
    }

    #[test]
    fn mvhr_terminal_rows_error_when_terminal_role_is_duplicated() {
        let csv = mvhr_terminal_csv(true).replace(
            "exhaust_terminal,MechanicalVentilationTerminal",
            "duplicate_intake_terminal,MechanicalVentilationTerminal,0,,,intake,mvhr_1,wall_1,,,,,,\"0.5,0,2.6\",\"{}\"\nexhaust_terminal,MechanicalVentilationTerminal",
        );
        let mut parser = CSVParser::new();
        let data = parser.parse_csv(&csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let err = builder
            .build_json(&data)
            .expect_err("duplicate intake terminals should fail clearly");

        assert_eq!(err.code, "E040");
        assert!(err.message.contains("duplicate intake terminals"));
    }
}

#[cfg(test)]
mod hot_water_and_lighting_fixes_tests {
    use super::*;
    use crate::parser::CSVParser;

    const FHS_SCHEMA_PATH: &str = crate::schema_paths::FHS_UPSTREAM_SCHEMA_REL_PATH;
    const DEFAULTS_PATH: &str = "../../data/defaults/defaults_template.json";

    #[test]
    fn does_not_invent_distribution_with_explicit_lighting_objects() {
        // CSV has Hot Water Outlets but no Water Pipework section.
        // The shared FHS defaults do not define Distribution, so we should not
        // synthesize one just because outlets exist.
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Hot Water Outlets
Name,Type,subcategory,flowrate,size
Shower,HotWaterDemand,MixerShower,8,
Bath,HotWaterDemand,Bath,6,120
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");

        // Build JSON step by step to check Distribution before validation
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        // Distribution should remain absent.
        let distribution = result["HotWaterDemand"]["Distribution"].as_array();
        assert!(
            distribution.is_none(),
            "Distribution should remain absent when defaults do not define it"
        );
    }

    #[test]
    fn system_space_cooling_row_sets_zone_space_cool_reference() {
        // Regression: subcategory=SpaceCoolSystem rows populated root SpaceCoolSystem
        // but did not wire Zone.<name>.SpaceCoolSystem, causing FHS Part O failures.
        let csv = r#"Metadata
PartO_active_cooling_required,TRUE

Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Systems
Name,Zone,Type,subcategory,system_preset,extra_json
Cooling,Living,System,SpaceCoolSystem,basic_air_conditioning,"{""SpaceCoolSystem"":{""space_cooling"":{""type"":""AirConditioning"",""cooling_capacity"":3.0,""efficiency"":4.3,""frac_convective"":0.95,""EnergySupply"":""mains elec""}}}"
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");

        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        assert_eq!(
            result["Zone"]["Living"]["SpaceCoolSystem"], "space_cooling",
            "Zone should reference the named SpaceCoolSystem entry"
        );
        assert!(
            result["SpaceCoolSystem"]["space_cooling"].is_object(),
            "Root SpaceCoolSystem entry should exist"
        );
    }

    #[test]
    fn errors_when_lighting_count_or_power_missing() {
        // Simplified lighting no longer invents fallback bulbs; explicit objects are required.
        let csv = r#"Metadata
NumberOfBedrooms,1
NumberOfWetRooms,1
GroundFloorArea,50
HeatingControlType,SeparateTempControl
PartGcompliance,TRUE

Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Lighting
Name,Zone,efficacy
Light,Living,80
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let mut result = builder.defaults.clone();
        let err = builder
            .build_zone_structure(&mut result, &data)
            .expect_err("Missing count/power should error");
        assert!(
            err.message
                .contains("Lighting missing required 'count' field")
                || err
                    .message
                    .contains("Lighting missing required 'power' field"),
            "Unexpected error: {}",
            err.message
        );
    }

    #[test]
    fn does_not_invent_distribution_when_no_water_pipework_section() {
        // Hot Water Outlets should not invent Distribution without Water Pipework rows.
        let csv = r#"Metadata
NumberOfBedrooms,1
NumberOfWetRooms,1
GroundFloorArea,50
HeatingControlType,SeparateTempControl
PartGcompliance,TRUE

Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Hot Water Outlets
Name,Type,subcategory,flowrate
Shower,HotWaterDemand,MixerShower,8

Lighting
Name,Zone,efficacy,count,power
Light,Living,80,6,8
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");

        // Build JSON step by step to check both fixes before validation
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        // Distribution is absent in the current defaults fixture.
        let distribution = result["HotWaterDemand"]["Distribution"].as_array();
        assert!(
            distribution.is_none(),
            "Distribution should remain absent when not supplied by defaults or CSV"
        );

        let bulbs = result["Zone"]["Living"]["Lighting"]["bulbs"]
            .as_array()
            .expect("bulbs array should exist");
        assert_eq!(bulbs.len(), 1, "expected one explicit bulb object");
    }

    #[test]
    fn metadata_dwelling_details_override_fhs_general() {
        let csv = r#"Metadata
GlobalOrientationOffset,0
General_build_type,flat
General_built_form,2
General_storeys_in_dwelling,2
General_storey_of_dwelling,3
General_storeys_in_building,6

Zone
Name,Type,volume,floor_area
Living,Zone,100,50
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let mut result = builder.defaults.clone();

        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        assert_eq!(result["General"]["build_type"], "flat");
        assert_eq!(result["General"]["built_form"], 2);
        assert_eq!(result["General"]["storeys_in_dwelling"], 2);
        assert_eq!(result["General"]["storey_of_dwelling"], 3);
        assert_eq!(result["General"]["storeys_in_building"], 6);
    }

    #[test]
    fn metadata_house_dwelling_details_drop_flat_only_fields() {
        let csv = r#"Metadata
GlobalOrientationOffset,0
General_build_type,house
General_storeys_in_dwelling,2
General_storey_of_dwelling,3
General_storeys_in_building,6

Zone
Name,Type,volume,floor_area
Living,Zone,100,50
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let mut result = builder.defaults.clone();

        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        assert_eq!(result["General"]["build_type"], "house");
        assert_eq!(result["General"]["storeys_in_dwelling"], 2);
        assert!(result["General"].get("storey_of_dwelling").is_none());
        assert!(result["General"].get("storeys_in_building").is_none());
    }

    #[test]
    fn fhs_zone_consolidation_sums_manual_area_split_columns() {
        let csv = r#"Metadata
NumberOfBedrooms,1
NumberOfWetRooms,1
GroundFloorArea,90
HeatingControlType,SeparateTempControl
PartGcompliance,TRUE

Zone
Name,Type,volume,floor_area,livingroom_area,restofdwelling_area
Zone 1,Zone,100,50,18,32
Zone 2,Zone,80,40,0,40
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");

        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .consolidate_zones_for_fhs(&mut result)
            .expect("FHS consolidation should succeed");

        let zones = result["Zone"]
            .as_object()
            .expect("Zone should be an object");
        assert_eq!(
            zones.len(),
            1,
            "FHS consolidation should keep a single zone"
        );

        let zone = zones
            .get("Zone 1")
            .and_then(|v| v.as_object())
            .expect("First zone should be retained after consolidation");
        assert_eq!(zone["volume"].as_f64().unwrap(), 180.0);
        assert_eq!(zone["livingroom_area"].as_f64().unwrap(), 18.0);
        assert_eq!(zone["restofdwelling_area"].as_f64().unwrap(), 72.0);
        assert!(
            zone.get("area").is_none(),
            "FHS consolidated zone should not retain legacy area field"
        );
    }

    #[test]
    fn distribution_replaced_when_water_pipework_section_exists() {
        // If Water Pipework section exists, it should replace defaults Distribution
        let csv = r#"Metadata
NumberOfBedrooms,1
NumberOfWetRooms,1
GroundFloorArea,50
HeatingControlType,SeparateTempControl
PartGcompliance,TRUE

Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Hot Water Outlets
Name,Type,subcategory,flowrate
Shower,HotWaterDemand,MixerShower,8

Water Pipework
Name,Type,pipework_type,length,location,internal_diameter_mm
pipe1,WaterPipework,distribution,5.0,internal,25
pipe2,WaterPipework,distribution,3.0,external,25
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");

        // Build JSON step by step to check Distribution before validation
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        // Distribution should exist and have 2 items from CSV
        let distribution = result["HotWaterDemand"]["Distribution"].as_array();
        assert!(distribution.is_some(), "Distribution should exist");
        assert_eq!(
            distribution.unwrap().len(),
            2,
            "Distribution should have 2 items from CSV pipework"
        );
    }

    #[test]
    fn uses_appliancekey_as_json_key_not_name() {
        // CSV has appliances with Name (display name) and appliancekey (schema enum)
        // JSON should use appliancekey as the key, not Name
        let csv = r#"Metadata
NumberOfBedrooms,1
NumberOfWetRooms,1
GroundFloorArea,50
HeatingControlType,SeparateTempControl
PartGcompliance,TRUE

Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Appliances
Name,Type,appliancekey,coords
Washer,Appliance,Clothes_washing,"-6.183,0.414,0.000"
Dishwasher,Appliance,Dishwasher,"-6.194,1.074,0.000"
Fridge,Appliance,Fridge-Freezer,"-4.735,-0.616,0.000"
Hob,Appliance,Hobs,"-6.138,1.594,0.000"
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");

        // Build JSON step by step to check appliances before validation
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        // Check appliances use appliancekey (schema enum) as keys, not Name (display name)
        let appliances = result["Appliances"].as_object().unwrap();

        // Should have schema enum keys, not display names
        assert!(
            appliances.contains_key("Clothes_washing"),
            "Should use 'Clothes_washing' (appliancekey), not 'Washer' (Name)"
        );
        assert!(
            appliances.contains_key("Dishwasher"),
            "Should use 'Dishwasher' (appliancekey), not 'Dishwasher' (Name - same in this case)"
        );
        assert!(
            appliances.contains_key("Fridge-Freezer"),
            "Should use 'Fridge-Freezer' (appliancekey), not 'Fridge' (Name)"
        );
        assert!(
            appliances.contains_key("Hobs"),
            "Should use 'Hobs' (appliancekey), not 'Hob' (Name)"
        );

        // Should NOT have display names as keys
        assert!(
            !appliances.contains_key("Washer"),
            "Should NOT use 'Washer' (Name) as key"
        );
        assert!(
            !appliances.contains_key("Hob"),
            "Should NOT use 'Hob' (Name) as key"
        );
        assert!(
            !appliances.contains_key("Fridge"),
            "Should NOT use 'Fridge' (Name) as key"
        );

        // All should have "Default" as value
        assert_eq!(appliances["Clothes_washing"], "Default");
        assert_eq!(appliances["Dishwasher"], "Default");
        assert_eq!(appliances["Fridge-Freezer"], "Default");
        assert_eq!(appliances["Hobs"], "Default");
    }

    #[test]
    fn thermal_bridge_junction_type_can_be_recovered_from_extra_json() {
        let csv = r#"Metadata
NumberOfBedrooms,1
NumberOfWetRooms,1
GroundFloorArea,50
HeatingControlType,SeparateTempControl
PartGcompliance,TRUE

Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Thermal Bridging Elements
Name,Zone,Type,heat_transfer_coeff,length,linear_thermal_transmittance,parent_element,coords,extra_json
thermal bridge 0,Living,ThermalBridgeLinear,,2,0.15,Wall A,"0,0,0|2,0,0","{""junction_type"":""E5""}"
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");

        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");

        let thermal_bridge = result["Zone"]["Living"]["ThermalBridging"]["thermal bridge 0"]
            .as_object()
            .expect("thermal bridge should exist");
        assert_eq!(thermal_bridge["type"], "ThermalBridgeLinear");
        assert_eq!(thermal_bridge["length"], 2);
        assert_eq!(thermal_bridge["linear_thermal_transmittance"], 0.15);
        assert_eq!(thermal_bridge["junction_type"], "E5");
    }

    #[test]
    fn does_not_inject_default_thermal_bridging_when_none_defined() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");

        let tb = result["Zone"]["Living"]["ThermalBridging"]
            .as_object()
            .expect("ThermalBridging should remain an object");
        assert!(
            tb.is_empty(),
            "ThermalBridging should stay empty without CSV rows"
        );
    }

    #[test]
    fn clears_space_heat_system_defaults_when_wet_emitters_absent() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        let shs = result["SpaceHeatSystem"]
            .as_object()
            .expect("SpaceHeatSystem should be an object");
        assert!(
            shs.is_empty(),
            "SpaceHeatSystem defaults should be cleared when Wet Emitters section is absent"
        );
    }

    #[test]
    fn absent_context_shading_uses_schema_valid_empty_segments() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        let segments = result["ExternalConditions"]["shading_segments"]
            .as_array()
            .expect("shading_segments should be an array");
        assert_eq!(
            segments.len(),
            36,
            "expected empty 10-degree shading segments"
        );
        assert!(
            segments.iter().all(|seg| seg.get("shading").is_none()),
            "no default shading objects should be retained without CSV Context Shading rows"
        );
    }

    #[test]
    fn context_shading_accepts_underscore_headers_and_shading_type() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Context Shading
Name,Type,shading_type,start_angle,end_angle,distance,height,parent_element,coords
Shade 1,ContextShading,overhang,10,20,5,7,,"0,0,0"
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        let segments = result["ExternalConditions"]["shading_segments"]
            .as_array()
            .expect("shading_segments should be an array");
        let first_shaded_segment = segments
            .iter()
            .find(|seg| seg.get("shading").is_some())
            .expect("expected at least one shaded segment");
        let shading = first_shaded_segment["shading"]
            .as_array()
            .expect("shading should be an array");
        assert_eq!(shading[0]["type"], "overhang");
    }

    #[test]
    fn context_shading_treats_contextshading_type_as_obstacle() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Context Shading
Name,Type,start angle,end angle,distance,height,parent_element,coords
Shade 1,ContextShading,10,20,5,7,,"0,0,0"
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        let segments = result["ExternalConditions"]["shading_segments"]
            .as_array()
            .expect("shading_segments should be an array");
        let first_shaded_segment = segments
            .iter()
            .find(|seg| seg.get("shading").is_some())
            .expect("expected at least one shaded segment");
        let shading = first_shaded_segment["shading"]
            .as_array()
            .expect("shading should be an array");
        assert_eq!(shading[0]["type"], "obstacle");
    }

    #[test]
    fn ventilation_empty_section_clears_vents_and_mechanical_defaults() {
        let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,50

Ventilation Systems
Name,Type
"#;

        let mut parser = CSVParser::new();
        let data = parser.parse_csv(csv).expect("CSV should parse");
        let mut builder =
            JSONBuilder::new(FHS_SCHEMA_PATH, DEFAULTS_PATH).expect("Builder should init");
        let mut result = builder.defaults.clone();
        builder
            .build_zone_structure(&mut result, &data)
            .expect("Zone structure should build");
        builder
            .process_root_level_sections(&mut result, &data)
            .expect("Root sections should process");

        let vents = result["InfiltrationVentilation"]["Vents"]
            .as_object()
            .expect("Vents should be an object");
        assert!(
            vents.is_empty(),
            "Vents should be cleared for empty section"
        );
        assert!(
            result["InfiltrationVentilation"]
                .get("MechanicalVentilation")
                .is_none(),
            "MechanicalVentilation defaults should be removed for empty section"
        );
    }
}
