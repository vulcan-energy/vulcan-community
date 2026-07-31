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
pub mod preflight_diagnostics;
mod schema_validation;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelProfile {
    Core,
    Fhs,
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
    pub version_metadata: VersionMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformOutput {
    pub model: Value,
    pub validation: ValidationResult,
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
    let model = builder
        .build_json(&csv_data)
        .map_err(TransformError::Build)?;

    let mut errors = builder.take_non_fatal_errors();
    let validation_model = clone_for_hem_validation(&model);
    if let Err(error) = builder.validate_against_schema(&validation_model) {
        if error.validation_errors.is_empty() {
            errors.push(ValidationError {
                code: error.code,
                path: "schema".into(),
                message: error.message,
                schema_path: None,
                keyword: None,
            });
        } else {
            errors.extend(error.validation_errors);
        }
    }
    let validation = ValidationResult {
        is_valid: errors.is_empty(),
        errors,
    };

    enforce_pure_hem_input(&builder, &validation_model, &validation, request.profile)?;

    Ok(TransformOutput {
        model,
        validation,
        version_metadata: request.version_metadata,
    })
}

fn validate_request(request: &TransformRequest) -> Result<(), TransformError> {
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
            !validation.errors.iter().any(|other| {
                !matches!(
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
