// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! Dedicated public browser boundary: model conversion and FHS preflight only.

use hem_fhs_upstream::{run_wrappers, FhsFlags, HemError, SinkOutputWriter};
use hem_upstream::OutputFormat;
use serde_json::{json, Value};
use std::io::Cursor;
use vulcan_model_transform::{
    clone_for_hem_validation,
    preflight_diagnostics::{extract_fhs_preflight_errors, generic_fhs_preflight_error},
    transform_geometry_csv, TransformError, TransformRequest,
};
use wasm_bindgen::prelude::*;

/// Exact pinned upstream HEM version to pass in every transform request.
#[wasm_bindgen]
pub fn hem_core_version() -> String {
    hem_upstream::HEM_VERSION.to_string()
}

/// Exact pinned upstream FHS wrapper version to pass in FHS transform requests.
#[wasm_bindgen]
pub fn fhs_wrapper_version() -> String {
    hem_fhs_upstream::FHS_VERSION.to_string()
}

/// Convert an explicit, self-contained [`TransformRequest`] supplied as JSON.
/// The host remains responsible for reading schema/default content and selecting
/// a profile; this artifact has no file-system or private-product dependency.
#[wasm_bindgen]
pub fn convert_geometry_csv_request(request_json: &str) -> String {
    let request = match serde_json::from_str::<TransformRequest>(request_json) {
        Ok(request) => request,
        Err(error) => {
            return json!({
                "ok": false,
                "error": format!("Invalid conversion request JSON: {error}"),
            })
            .to_string();
        }
    };

    match transform_geometry_csv(request) {
        Ok(output) => json!({
            "ok": true,
            "json": output.model,
            "validation": output.validation,
            "version_metadata": output.version_metadata,
        })
        .to_string(),
        Err(error) => {
            let validation = match &error {
                TransformError::Build(build_error) if !build_error.validation_errors.is_empty() => {
                    Some(json!({
                        "is_valid": false,
                        "errors": build_error.validation_errors,
                    }))
                }
                _ => None,
            };
            json!({
                "ok": false,
                "validation": validation,
                "error": error.to_string(),
            })
            .to_string()
        }
    }
}

/// Run upstream FHS ingest and Part F preprocessing without simulation.
/// The product model is projected to the upstream contract inside this boundary.
#[wasm_bindgen]
pub fn validate_fhs_preflight(model_json: &str) -> String {
    let model = match serde_json::from_str::<Value>(model_json) {
        Ok(model) => model,
        Err(error) => {
            let technical = format!("Failed to parse model JSON: {error}");
            return invalid_preflight_response(&technical);
        }
    };
    let projected = clone_for_hem_validation(&model);
    let projected_json = match serde_json::to_string(&projected) {
        Ok(json) => json,
        Err(error) => {
            return invalid_preflight_response(&format!(
                "Failed to serialize the FHS validation projection: {error}"
            ));
        }
    };

    let flags = FhsFlags::FHS_COMPLIANCE;
    match run_wrappers(
        Cursor::new(projected_json),
        SinkOutputWriter,
        None,
        None,
        &flags,
        true,
        false,
        false,
        &[OutputFormat::Csv],
    ) {
        Ok(_) => json!({
            "ok": true,
            "is_valid": true,
            "errors": [],
        })
        .to_string(),
        Err(error) => {
            let technical = format_hem_error_report(&error);
            let mut errors = extract_fhs_preflight_errors(&technical);
            if errors.is_empty() {
                errors.push(generic_fhs_preflight_error(&technical));
            }
            json!({
                "ok": false,
                "is_valid": false,
                "raw_engine_error": technical,
                "errors": errors,
            })
            .to_string()
        }
    }
}

fn invalid_preflight_response(technical: &str) -> String {
    json!({
        "ok": false,
        "is_valid": false,
        "errors": [generic_fhs_preflight_error(technical)],
    })
    .to_string()
}

fn format_hem_error_report(error: &HemError) -> String {
    match error {
        HemError::InvalidRequest(source) => {
            format!("Request was considered invalid due to error:\n{source:#}")
        }
        HemError::FailureInCalculation(source) => {
            format!("Error identified during HEM calculation:\n{source:#}")
        }
        HemError::ErrorInPostprocessing(source) => {
            format!("Error during wrapper postprocessing:\n{source:#}")
        }
        HemError::PanicInWrapper(_)
        | HemError::PanicInCalculation(_)
        | HemError::GeneralPanic(_)
        | HemError::NotImplemented(_) => error.to_string(),
    }
}

/// FHS preprocessing uses Rayon in browser builds. Hosts must await this before
/// calling `validate_fhs_preflight`; conversion itself does not require it.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn initialize_rayon_thread_pool(num_threads: usize) -> js_sys::Promise {
    wasm_bindgen_rayon::init_thread_pool(num_threads)
}
