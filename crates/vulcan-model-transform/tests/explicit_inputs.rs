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
        conversion_profile: Default::default(),
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
        conversion_profile: Default::default(),
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

#[test]
fn python_conversion_profiles_reject_mismatched_engine_wrapper_metadata() {
    let error = transform_geometry_csv(TransformRequest {
        csv: MINIMAL_CSV.into(),
        schema_json: MINIMAL_SCHEMA.into(),
        defaults_json: "{}".into(),
        profile: ModelProfile::Fhs,
        conversion_profile: vulcan_model_transform::ConversionProfile::PythonFhsA8,
        version_metadata: VersionMetadata {
            hem_core_version: "1.0.0a9".into(),
            fhs_wrapper_version: Some("1.0.0a8".into()),
        },
    })
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("matching core and FHS wrapper 1.0.0a8"));
}

#[test]
fn conversion_profile_wire_compatibility_and_default_are_stable() {
    use vulcan_model_transform::ConversionProfile;
    for wire in [
        "current_rust_fhs",
        "python_fhs_a8",
        "python_fhs_a9",
        "divided_opening_half_partition_v1",
        "physical_opening_full_partition_v1",
        "physical_opening_full_partition_party_wall_u_v1",
    ] {
        let profile: ConversionProfile = serde_json::from_value(serde_json::json!(wire)).unwrap();
        assert_eq!(serde_json::to_value(profile).unwrap(), wire);
    }
    assert_eq!(
        serde_json::to_value(ConversionProfile::default()).unwrap(),
        "current_rust_fhs"
    );
}

#[test]
fn canonical_profiles_preserve_legacy_output_and_accept_independent_versions() {
    use vulcan_model_transform::ConversionProfile::*;
    for (legacy, canonical, version) in [
        (CurrentRustFhs, DividedOpeningHalfPartitionV1, "1.0.0a7"),
        (PythonFhsA8, PhysicalOpeningFullPartitionV1, "1.0.0a8"),
        (
            PythonFhsA9,
            PhysicalOpeningFullPartitionPartyWallUV1,
            "1.0.0a9",
        ),
    ] {
        let request = TransformRequest {
            csv: MINIMAL_CSV.into(),
            schema_json: MINIMAL_SCHEMA.into(),
            defaults_json: r#"{"Zone":{},"InfiltrationVentilation":{}}"#.into(),
            profile: ModelProfile::Fhs,
            conversion_profile: legacy,
            version_metadata: VersionMetadata {
                hem_core_version: version.into(),
                fhs_wrapper_version: Some(version.into()),
            },
        };
        let old = transform_geometry_csv(request.clone()).unwrap();
        let mut neutral = request.clone();
        neutral.conversion_profile = canonical;
        let new = transform_geometry_csv(neutral.clone()).unwrap();
        assert_eq!(old.model, new.model);
        assert_eq!(old.validation, new.validation);
        neutral.version_metadata = VersionMetadata {
            hem_core_version: "future-core".into(),
            fhs_wrapper_version: Some("independent-wrapper".into()),
        };
        assert!(transform_geometry_csv(neutral).is_ok());
    }
}

#[test]
fn physical_opening_contracts_require_fhs_but_divided_contracts_keep_core_support() {
    use vulcan_model_transform::ConversionProfile::*;
    for conversion_profile in [
        PythonFhsA8,
        PythonFhsA9,
        PhysicalOpeningFullPartitionV1,
        PhysicalOpeningFullPartitionPartyWallUV1,
        CurrentRustFhs,
        DividedOpeningHalfPartitionV1,
    ] {
        let result = transform_geometry_csv(TransformRequest {
            csv: MINIMAL_CSV.into(),
            schema_json: MINIMAL_SCHEMA.into(),
            defaults_json: r#"{"Zone":{},"InfiltrationVentilation":{}}"#.into(),
            profile: ModelProfile::Core,
            conversion_profile,
            version_metadata: VersionMetadata {
                hem_core_version: "caller-core".into(),
                fhs_wrapper_version: None,
            },
        });
        if matches!(
            conversion_profile,
            CurrentRustFhs | DividedOpeningHalfPartitionV1
        ) {
            // This minimal fixture is not a complete Core dwelling. It may fail
            // engine validation, but its profile must pass request validation.
            assert!(
                !matches!(
                    result,
                    Err(vulcan_model_transform::TransformError::InvalidRequest(_))
                ),
                "{conversion_profile:?}: {result:?}"
            );
        } else {
            assert!(result
                .unwrap_err()
                .to_string()
                .contains("requires the FHS profile"));
        }
    }
}
