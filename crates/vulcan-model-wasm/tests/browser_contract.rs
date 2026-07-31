// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

use serde_json::Value;
use vulcan_model_wasm::{
    convert_geometry_csv_request, fhs_wrapper_version, hem_core_version, validate_fhs_preflight,
};

const MIN_WORKING_CSV: &str = include_str!("fixtures/min_working.csv");
const FHS_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../data/schemas/input_fhs.schema.json"
));
const DEFAULTS_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../data/defaults/defaults_template.json"
));

#[test]
fn version_exports_are_sourced_from_the_pinned_upstream_crates() {
    assert_eq!(hem_core_version(), hem_upstream::HEM_VERSION);
    assert_eq!(fhs_wrapper_version(), hem_fhs_upstream::FHS_VERSION);
}

#[test]
fn conversion_export_returns_structured_error_for_invalid_request_json() {
    let response: Value = serde_json::from_str(&convert_geometry_csv_request("{not-json"))
        .expect("conversion response must always be JSON");
    assert_eq!(response["ok"], false);
    assert!(response["error"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
}

#[test]
fn preflight_export_returns_structured_error_for_invalid_model_json() {
    let response: Value = serde_json::from_str(&validate_fhs_preflight("{not-json"))
        .expect("preflight response must always be JSON");
    assert_eq!(response["ok"], false);
    assert_eq!(response["is_valid"], false);
    assert!(response["errors"]
        .as_array()
        .is_some_and(|errors| !errors.is_empty()));
}

#[test]
fn caller_supplied_fhs_model_converts_and_passes_upstream_preflight() {
    let request = serde_json::json!({
        "csv": MIN_WORKING_CSV,
        "schema_json": FHS_SCHEMA,
        "defaults_json": DEFAULTS_TEMPLATE,
        "profile": "fhs",
        "version_metadata": {
            "hem_core_version": hem_core_version(),
            "fhs_wrapper_version": fhs_wrapper_version(),
        },
    });
    let conversion: Value =
        serde_json::from_str(&convert_geometry_csv_request(&request.to_string()))
            .expect("conversion response must be JSON");
    assert_eq!(conversion["ok"], true, "{conversion:#}");
    assert_eq!(conversion["validation"]["is_valid"], true, "{conversion:#}");

    let preflight: Value = serde_json::from_str(&validate_fhs_preflight(
        &serde_json::to_string(&conversion["json"]).expect("model should serialize"),
    ))
    .expect("preflight response must be JSON");
    assert_eq!(preflight["is_valid"], true, "{preflight:#}");
}
