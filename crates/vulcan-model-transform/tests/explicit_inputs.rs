// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

use vulcan_model_transform::{
    transform_geometry_csv, ModelProfile, TransformRequest, VersionMetadata,
};

const MINIMAL_SCHEMA: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "metadata": { "type": "object", "additionalProperties": true },
    "Zone": { "type": "object", "additionalProperties": true },
    "ColdWaterSource": { "type": "object" },
    "ExternalConditions": { "type": "object" },
    "InfiltrationVentilation": { "type": "object" },
    "KitchenExtractorHoodExternal": { "type": "boolean" },
    "PartO_active_cooling_required": { "type": "boolean" }
  }
}"#;

const MINIMAL_CSV: &str = r#"Metadata
Postcode,MK40 1AA

Zone
Name,Type,volume,floor_area
Living,Zone,100,40
"#;

#[test]
fn transform_uses_caller_selected_profile_and_version_metadata() {
    let output = transform_geometry_csv(TransformRequest {
        csv: MINIMAL_CSV.to_string(),
        schema_json: MINIMAL_SCHEMA.to_string(),
        defaults_json: r#"{"Zone":{},"InfiltrationVentilation":{}}"#.to_string(),
        profile: ModelProfile::Fhs,
        version_metadata: VersionMetadata {
            hem_core_version: "caller-core-version".to_string(),
            fhs_wrapper_version: Some("caller-fhs-version".to_string()),
        },
    })
    .expect("explicit-input transform should return a work-in-progress model");

    assert_eq!(
        output.model.pointer("/metadata/hem_core_version"),
        Some(&serde_json::json!("caller-core-version")),
    );
}

#[test]
fn transform_rejects_missing_caller_supplied_content() {
    let error = transform_geometry_csv(TransformRequest {
        csv: String::new(),
        schema_json: MINIMAL_SCHEMA.to_string(),
        defaults_json: "{}".to_string(),
        profile: ModelProfile::Core,
        version_metadata: VersionMetadata {
            hem_core_version: "caller-core-version".to_string(),
            fhs_wrapper_version: None,
        },
    })
    .expect_err("empty CSV must fail loudly");

    assert!(error.to_string().contains("CSV"));
}
