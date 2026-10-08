// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! Canonical, host-independent Geometry CSV to HEM model transformation.
//!
//! Hosts supply CSV, schema, defaults, selected profile and upstream version
//! metadata as content. This crate performs no workspace lookup and exposes no
//! calculation, batch, SAP/RdSAP, detailed-solver, telemetry or product runtime.

pub mod builder;
pub mod error {
    pub use vulcan_csv_codec::error::*;
}
pub mod parser {
    pub use vulcan_csv_codec::parser::*;
}
pub mod finalization;
pub mod preflight_diagnostics;
mod schema_validation;
mod target_mappings;
pub use target_mappings::map_target_unobstructed_shading;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelProfile {
    Core,
    Fhs,
}

/// Explicit converter contract; release labels never select translation rules implicitly.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversionProfile {
    #[default]
    CurrentRustFhs,
    PythonFhsA9,
    PythonFhsA8,
    DividedOpeningHalfPartitionV1,
    PhysicalOpeningFullPartitionV1,
    #[serde(rename = "physical_opening_full_partition_party_wall_u_v1")]
    PhysicalOpeningFullPartitionPartyWallUV1,
}

/// Input meaning, independent of the implementation language and release label.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ElementInputConvention {
    DividedOpeningHalfPartition,
    PhysicalOpeningFullPartition,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct InputContract {
    pub elements: ElementInputConvention,
    pub party_wall_requires_whole_u: bool,
    pub requires_main_hot_water_source: bool,
    pub requires_detailed_thermal_bridges: bool,
    pub uses_exact_empty_shading_sectors: bool,
}

impl ConversionProfile {
    /// Compatibility boundary for published preparation artifacts. New profiles
    /// describe the same contracts without tying them to a language or release.
    pub(crate) fn input_contract(self) -> InputContract {
        let (physical_openings, whole_u, detailed_bridges) = match self {
            Self::CurrentRustFhs | Self::DividedOpeningHalfPartitionV1 => (false, false, false),
            Self::PythonFhsA8 | Self::PhysicalOpeningFullPartitionV1 => (true, false, true),
            Self::PythonFhsA9 | Self::PhysicalOpeningFullPartitionPartyWallUV1 => {
                (true, true, false)
            }
        };
        InputContract {
            elements: if physical_openings {
                ElementInputConvention::PhysicalOpeningFullPartition
            } else {
                ElementInputConvention::DividedOpeningHalfPartition
            },
            party_wall_requires_whole_u: whole_u,
            requires_main_hot_water_source: physical_openings,
            requires_detailed_thermal_bridges: detailed_bridges,
            uses_exact_empty_shading_sectors: physical_openings,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionMetadata {
    pub hem_core_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fhs_wrapper_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformRequest {
    pub csv: String,
    pub schema_json: String,
    pub defaults_json: String,
    pub profile: ModelProfile,
    #[serde(default)]
    pub conversion_profile: ConversionProfile,
    pub version_metadata: VersionMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformOutput {
    pub model: Value,
    pub validation: ValidationResult,
    pub schema_omissions: Vec<finalization::SchemaOmission>,
    pub version_metadata: VersionMetadata,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    pub code: String,
    pub path: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyword: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ValidationResult {
    pub errors: Vec<ValidationError>,
    pub is_valid: bool,
}

#[derive(thiserror::Error, Debug)]
pub enum TransformError {
    #[error("Invalid transform request: {0}")]
    InvalidRequest(String),
    #[error("CSV parsing failed: {0}")]
    Csv(String),
    #[error("JSON building failed: {0}")]
    Build(builder::BuildError),
    #[error("Schema/defaults error: {0}")]
    Schema(String),
}

/// Clone a merged product model for validation by the unchanged HEM/FHS contracts.
pub fn clone_for_hem_validation(model: &Value) -> Value {
    let mut validation_model = model.clone();
    if let Some(general) = validation_model
        .get_mut("General")
        .and_then(Value::as_object_mut)
    {
        general.remove("built_form");
    }
    validation_model
}

/// Merge caller-supplied Geometry CSV and defaults into a HEM model, then
/// validate the HEM/FHS projection against the caller-supplied schema.
pub fn transform_geometry_csv(
    request: TransformRequest,
) -> Result<TransformOutput, TransformError> {
    validate_request(&request)?;

    let mut parser = parser::CSVParser::new();
    let csv_data = parser
        .parse_csv(&request.csv)
        .map_err(|error| TransformError::Csv(error.to_string()))?;

    let mut builder = builder::JSONBuilder::from_json_inputs(
        &request.schema_json,
        &request.defaults_json,
        request.profile,
        &request.version_metadata,
    )
    .map_err(|error| TransformError::Schema(error.to_string()))?;
    builder.set_conversion_profile(request.conversion_profile);
    let model = builder
        .build_json(&csv_data)
        .map_err(TransformError::Build)?;

    let mut schema_omissions = builder.take_schema_omissions();
    let schema: Value = serde_json::from_str(&request.schema_json)
        .map_err(|error| TransformError::Schema(error.to_string()))?;
    let finalized =
        finalization::finalize_model(&model, &schema).map_err(TransformError::Schema)?;
    schema_omissions.extend(finalized.omissions);
    let model = finalized.model;
    let mut errors = builder.take_non_fatal_errors();
    let validation_model = clone_for_hem_validation(&model);
    errors.extend(finalized.validation.errors);
    errors.extend(validate_target_input(
        &model,
        request.conversion_profile,
        &request.version_metadata,
    ));
    let validation = ValidationResult {
        is_valid: errors.is_empty(),
        errors,
    };

    enforce_pure_hem_input(&builder, &validation_model, &validation, request.profile)?;

    Ok(TransformOutput {
        model,
        validation,
        schema_omissions,
        version_metadata: request.version_metadata,
    })
}

/// Source-verified wrapper readiness beyond a release's JSON schema. Diagnose
/// missing main hot-water sources and a8 scalar bridges without inventing facts
/// or silently renaming authored systems.
pub fn validate_target_input(
    model: &Value,
    profile: ConversionProfile,
    version: &VersionMetadata,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let contract = profile.input_contract();
    let hem = format!("HEM {}", version.hem_core_version);
    if contract.requires_main_hot_water_source
        && model
            .get("HotWaterSource")
            .and_then(Value::as_object)
            .is_some_and(|sources| !sources.contains_key("hw cylinder"))
    {
        // Both FHS schemas declare only this main-source key (including
        // PointOfUse). Notional edit_storagetank indexes it unconditionally;
        // an empty schema-valid object is not a usable hot-water source.
        errors.push(ValidationError {
            code: "E_PYTHON_FHS_HOT_WATER_SOURCE".into(),
            path: "/HotWaterSource/hw cylinder".into(),
            message: format!("{hem} requires the main hot-water source under 'hw cylinder', including point-of-use systems. Supply a compatible main source; unsupported names are preserved in the authored CSV and are not renamed automatically."),
            schema_path: None, keyword: None,
        });
    }
    if contract.requires_detailed_thermal_bridges {
        if let Some(zones) = model.get("Zone").and_then(Value::as_object) {
            for (name, zone) in zones {
                if zone.get("ThermalBridging").is_some_and(Value::is_number) {
                    errors.push(ValidationError {
                        code: "E_A8_THERMAL_BRIDGING".into(),
                        path: json_pointer(&["Zone", name, "ThermalBridging"]),
                        message: format!("{hem} requires detailed thermal-bridge records during wrapper preprocessing, even though its schema accepts a single total. Supply the actual bridge records; a total cannot be expanded without evidence."),
                        schema_path: None, keyword: None,
                    });
                }
            }
        }
    }
    errors
}

/// RFC 6901 pointer from raw segments (names may contain '/' or '~').
pub(crate) fn json_pointer(segments: &[&str]) -> String {
    segments
        .iter()
        .map(|segment| format!("/{}", segment.replace('~', "~0").replace('/', "~1")))
        .collect()
}

fn validate_request(request: &TransformRequest) -> Result<(), TransformError> {
    if request.conversion_profile.input_contract().elements
        == ElementInputConvention::PhysicalOpeningFullPartition
        && request.profile != ModelProfile::Fhs
    {
        return Err(TransformError::InvalidRequest(
            "Physical-opening/full-partition conversion requires the FHS profile".into(),
        ));
    }
    let required_python_version = match request.conversion_profile {
        ConversionProfile::PythonFhsA8 => Some("1.0.0a8"),
        ConversionProfile::PythonFhsA9 => Some("1.0.0a9"),
        ConversionProfile::CurrentRustFhs
        | ConversionProfile::DividedOpeningHalfPartitionV1
        | ConversionProfile::PhysicalOpeningFullPartitionV1
        | ConversionProfile::PhysicalOpeningFullPartitionPartyWallUV1 => None,
    };
    if let Some(version) = required_python_version {
        if request.version_metadata.hem_core_version != version
            || request.version_metadata.fhs_wrapper_version.as_deref() != Some(version)
        {
            return Err(TransformError::InvalidRequest(format!("The selected Python conversion profile requires matching core and FHS wrapper {version} metadata")));
        }
    }
    let mut missing = Vec::new();
    if request.csv.trim().is_empty() {
        missing.push("CSV");
    }
    if request.schema_json.trim().is_empty() {
        missing.push("schema JSON");
    }
    if request.defaults_json.trim().is_empty() {
        missing.push("defaults JSON");
    }
    if request.version_metadata.hem_core_version.trim().is_empty() {
        missing.push("HEM core version");
    }
    if request.profile == ModelProfile::Fhs
        && request
            .version_metadata
            .fhs_wrapper_version
            .as_deref()
            .map(str::trim)
            .is_none_or(str::is_empty)
    {
        missing.push("FHS wrapper version");
    }
    if missing.is_empty() {
        Ok(())
    } else {
        Err(TransformError::InvalidRequest(format!(
            "missing {}",
            missing.join(", ")
        )))
    }
}

fn enforce_pure_hem_input(
    builder: &builder::JSONBuilder,
    json: &Value,
    validation: &ValidationResult,
    profile: ModelProfile,
) -> Result<(), TransformError> {
    let unknown_property_errors: Vec<ValidationError> = validation
        .errors
        .iter()
        .filter(|error| {
            matches!(
                error.keyword.as_deref(),
                Some("unevaluatedProperties") | Some("additionalProperties")
            )
        })
        .filter(|error| {
            // Only a concrete schema error explains an unknown property; converter
            // errors (no keyword) must not soften the pure-HEM-input gate.
            !validation.errors.iter().any(|other| {
                other.keyword.is_some()
                    && !matches!(
                    other.keyword.as_deref(),
                    Some("unevaluatedProperties") | Some("additionalProperties")
                ) && (other.path == error.path
                    || other.path.starts_with(&format!("{}/", error.path)))
            })
        })
        .cloned()
        .collect();
    if !unknown_property_errors.is_empty() {
        let details: Vec<String> = unknown_property_errors
            .iter()
            .map(|error| format!("{}: {}", error.path, error.message))
            .collect();
        return Err(TransformError::Build(
            builder::BuildError::with_validation_errors(
                "E047",
                &format!(
                    "Merged JSON contains keys not in the HEM schema — {}. The dwelling model JSON must contain only HEM inputs; UI-only data belongs in the geometry CSV.",
                    details.join("; ")
                ),
                unknown_property_errors,
            ),
        ));
    }

    let allowed_root = builder.schema_root_property_names();
    if !allowed_root.is_empty() {
        if let Some(object) = json.as_object() {
            let unknown_root: BTreeSet<&String> = object
                .keys()
                .filter(|key| !allowed_root.contains(*key))
                .collect();
            if !unknown_root.is_empty() {
                let keys: Vec<String> = unknown_root.iter().map(|key| (*key).clone()).collect();
                return Err(TransformError::Build(builder::BuildError::new(
                    "E048",
                    &format!(
                        "Merged JSON contains top-level keys not in the HEM schema: {}. The dwelling model JSON must contain only HEM inputs.",
                        keys.join(", ")
                    ),
                )));
            }
        }
    }

    if profile == ModelProfile::Core {
        if let Err(error) = serde_json::from_value::<hem_upstream::input::Input>(json.clone()) {
            let message = error.to_string();
            if message.contains("unknown field") {
                return Err(TransformError::Build(builder::BuildError::new(
                    "E049",
                    &format!("Merged JSON rejected by the HEM engine input parser: {message}"),
                )));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
#[macro_export]
macro_rules! include_fhs_upstream_schema_json {
    () => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../data/schemas/input_fhs.schema.json"
        ))
    };
}

#[cfg(test)]
pub(crate) mod schema_paths {
    pub const CORE_UPSTREAM_SCHEMA_REL_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../data/schemas/core-input.schema.json"
    );
    pub const FHS_UPSTREAM_SCHEMA_REL_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../data/schemas/input_fhs.schema.json"
    );
}
