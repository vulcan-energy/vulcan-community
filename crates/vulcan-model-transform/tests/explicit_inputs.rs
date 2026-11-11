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

#[test]
fn legacy_window_division_height_reaches_a8_with_a_non_blocking_warning() {
    let csv = format!(
        "{MINIMAL_CSV}
Window Elements
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,frame_area_fraction,free_area_height,mid_height,max_window_open_area,extra_json
Window,Living,BuildingElementTransparent,1.61,90,1.24,1.3,180,1,0.25,0.95,1.65,0.8,\"{{\"\"window_part_list\"\":[{{\"\"mid_height_air_flow_path\"\":1.5}}]}}\"
"
    );
    let output = transform_geometry_csv(TransformRequest {
        csv,
        schema_json: MINIMAL_SCHEMA.into(),
        defaults_json: r#"{"Zone":{},"InfiltrationVentilation":{}}"#.into(),
        profile: ModelProfile::Fhs,
        conversion_profile: vulcan_model_transform::ConversionProfile::PythonFhsA8,
        version_metadata: VersionMetadata {
            hem_core_version: "1.0.0a8".into(),
            fhs_wrapper_version: Some("1.0.0a8".into()),
        },
    })
    .unwrap();
    let path = "/Zone/Living/BuildingElement/Window/window_part_list";
    assert_eq!(
        output.model.pointer(path),
        Some(
            &serde_json::json!([{"mid_height":1.5,"free_area_height":0.95,"max_window_open_area":0.8}])
        )
    );
    assert!(
        output
            .validation
            .errors
            .iter()
            .all(|e| !e.path.contains("/Window/")),
        "{:?}",
        output.validation.errors
    );
    let warning = output
        .schema_omissions
        .iter()
        .find(|w| w.path == path)
        .expect("warning");
    assert_eq!(warning.code, "W_TARGET_INPUT");
    assert!(warning.message.starts_with("HEM 1.0.0a8: The opening height used for ventilation (1.5 m) differs from the window's mid-height (1.65 m), both above the ventilation-zone base."), "{}", warning.message);
}

#[test]
fn window_heights_use_the_template_base_height_when_the_metadata_row_is_absent() {
    let window = "
Window Elements
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,frame_area_fraction,free_area_height,mid_height,max_window_open_area
Window,Living,BuildingElementTransparent,1.61,90,1.24,1.3,180,1,0.25,0.95,1.65,0.8
";
    let convert = |metadata_row: &str, defaults_json: &str| {
        transform_geometry_csv(TransformRequest {
            csv: format!(
                "{}{window}",
                MINIMAL_CSV.replace(
                    "Postcode,MK40 1AA",
                    &format!("Postcode,MK40 1AA\n{metadata_row}")
                )
            ),
            schema_json: MINIMAL_SCHEMA.into(),
            defaults_json: defaults_json.into(),
            profile: ModelProfile::Fhs,
            conversion_profile: vulcan_model_transform::ConversionProfile::PythonFhsA8,
            version_metadata: VersionMetadata {
                hem_core_version: "1.0.0a8".into(),
                fhs_wrapper_version: Some("1.0.0a8".into()),
            },
        })
        .unwrap()
        .model
    };
    let row = convert(
        "Ventilation_ventilation_zone_base_height,1.0",
        r#"{"Zone":{},"InfiltrationVentilation":{"ventilation_zone_base_height":0.0}}"#,
    );
    let template = convert(
        "",
        r#"{"Zone":{},"InfiltrationVentilation":{"ventilation_zone_base_height":1.0}}"#,
    );
    for path in [
        "/InfiltrationVentilation/ventilation_zone_base_height",
        "/Zone/Living/BuildingElement/Window/window_part_list",
    ] {
        assert_eq!(row.pointer(path), template.pointer(path), "{path}");
    }
    assert_eq!(
        template.pointer("/Zone/Living/BuildingElement/Window/window_part_list/0/mid_height"),
        Some(&serde_json::json!(0.65))
    );

    // A Systems InfiltrationVentilation row overrides the template; Metadata rows override both,
    // and window heights are measured from the base the model carries.
    let defaults = r#"{"Zone":{},"InfiltrationVentilation":{"ventilation_zone_base_height":0.0}}"#;
    let systems = "
Systems
Name,Zone,Type,subcategory,extra_json
IV,Living,System,InfiltrationVentilation,\"{\"\"InfiltrationVentilation\"\":{\"\"altitude\"\":50,\"\"shield_class\"\":\"\"Shielded\"\",\"\"ventilation_zone_base_height\"\":1}}\"
";
    // A closed window's zero-area opening is placed from its sill and head.
    let closed =
        "Closed,Living,BuildingElementTransparent,1.61,90,1.24,1.3,180,1,0.25,0.95,1.65,0\n";
    let with_systems = |metadata_rows: &str| {
        transform_geometry_csv(TransformRequest {
            csv: format!(
                "{}{window}{closed}{systems}",
                MINIMAL_CSV.replace(
                    "Postcode,MK40 1AA",
                    &format!("Postcode,MK40 1AA\n{metadata_rows}")
                )
            ),
            schema_json: MINIMAL_SCHEMA.into(),
            defaults_json: defaults.into(),
            profile: ModelProfile::Fhs,
            conversion_profile: vulcan_model_transform::ConversionProfile::PythonFhsA8,
            version_metadata: VersionMetadata {
                hem_core_version: "1.0.0a8".into(),
                fhs_wrapper_version: Some("1.0.0a8".into()),
            },
        })
        .unwrap()
        .model
    };
    let part_mid = "/Zone/Living/BuildingElement/Window/window_part_list/0/mid_height";
    let closed_mid = "/Zone/Living/BuildingElement/Closed/window_part_list/0/mid_height";
    let systems_only = with_systems("");
    assert_eq!(
        systems_only.pointer(closed_mid),
        Some(&serde_json::json!(0.65))
    );
    assert_eq!(
        systems_only.pointer("/InfiltrationVentilation/ventilation_zone_base_height"),
        Some(&serde_json::json!(1))
    );
    assert_eq!(
        systems_only.pointer(part_mid),
        Some(&serde_json::json!(0.65))
    );
    let metadata = with_systems(
        "Ventilation_ventilation_zone_base_height,0.5\nVentilation_altitude,10\nVentilation_shield_class,Normal",
    );
    let iv = &metadata["InfiltrationVentilation"];
    assert_eq!(iv["ventilation_zone_base_height"], serde_json::json!(0.5));
    assert_eq!(iv["altitude"], serde_json::json!(10.0));
    assert_eq!(iv["shield_class"], serde_json::json!("Normal"));
    assert_eq!(metadata.pointer(part_mid), Some(&serde_json::json!(1.15)));
    assert_eq!(metadata.pointer(closed_mid), Some(&serde_json::json!(1.15)));
}

#[test]
fn non_finite_number_cells_are_reported_like_any_other_text() {
    let dir = env!("CARGO_MANIFEST_DIR");
    let read = |path: &str| std::fs::read_to_string(format!("{dir}/../../data/{path}")).unwrap();
    let convert = |u_value: &str, pitch: &str| {
        transform_geometry_csv(TransformRequest {
            csv: format!(
                "{MINIMAL_CSV}
Exposed Elements
Name,Zone,Type,area,pitch,orientation360,u_value,height,width,base_height
Wall,Living,BuildingElementOpaque,10,{pitch},180,{u_value},2.5,4,0
"
            ),
            schema_json: read("schemas/input_fhs.schema.json"),
            defaults_json: read("defaults/defaults_template.json"),
            profile: ModelProfile::Fhs,
            conversion_profile: Default::default(),
            version_metadata: VersionMetadata {
                hem_core_version: "1.0.0a7".into(),
                fhs_wrapper_version: Some("1.0.0a7".into()),
            },
        })
    };
    for bad in ["abc", "NaN", "-inf"] {
        let output = convert(bad, "90").unwrap();
        let path = "/Zone/Living/BuildingElement/Wall/u_value";
        assert_eq!(output.model.pointer(path), Some(&serde_json::json!(bad)));
        assert!(
            output.validation.errors.iter().any(|e| e.path == path),
            "{bad}: {:?}",
            output.validation.errors
        );
        let error = convert("0.2", bad).unwrap_err().to_string();
        assert!(error.contains("[E055] 'pitch'"), "{bad}: {error}");
    }
}

#[test]
fn derived_numbers_that_overflow_fail_with_e055_instead_of_panicking() {
    let dir = env!("CARGO_MANIFEST_DIR");
    let read = |path: &str| std::fs::read_to_string(format!("{dir}/../../data/{path}")).unwrap();
    let convert = |csv: String, fhs: bool| {
        let (schema, profile, wrapper) = if fhs {
            ("input_fhs", ModelProfile::Fhs, Some("1.0.0a7".into()))
        } else {
            ("core-input", ModelProfile::Core, None)
        };
        transform_geometry_csv(TransformRequest {
            csv,
            schema_json: read(&format!("schemas/{schema}.schema.json")),
            defaults_json: read("defaults/defaults_template.json"),
            profile,
            conversion_profile: Default::default(),
            version_metadata: VersionMetadata {
                hem_core_version: "1.0.0a7".into(),
                fhs_wrapper_version: wrapper,
            },
        })
    };
    let zone = "Zone\nName,Type,volume,floor_area,height,simplified thermal bridging\nLiving,Zone,100,40,2.5,FALSE\n";
    let walls = "Exposed Elements\nName,Zone,Type,area,pitch,orientation360,u_value,height,width,base_height,coords\n";
    let wall = |name: &str, zone: &str, area: &str, rest: &str| {
        format!("{name},{zone},BuildingElementOpaque,{area},90,180,0.2,{rest}\n")
    };
    let cases = [
        (false, "Zone Living volume", "Zone\nName,Type,volume,floor_area,height\nLiving,Zone,,1e200,1e200\n".to_string()),
        (false, "Wall area", format!("{zone}{walls}{}", wall("Wall", "Living", "", "1e200,1e200,0,"))),
        (false, "Zone Living ThermalBridging", format!("{}{walls}{}{}", zone.replace("FALSE", "TRUE"), wall("A", "Living", "1e308", "2.5,4,0,"), wall("B", "Living", "1e308", "2.5,4,0,"))),
        (false, "env_area", format!("{zone}{walls}{}{}", wall("A", "Living", "1e308", "2.5,4,0,"), wall("B", "Living", "1e308", "2.5,4,0,"))),
        (false, "length", format!("{zone}Wet Emitters\nName,Zone,Type,subcategory,unit_number,extra_json\nR,Living,WetEmitter,radiator,10,\"{{\"\"length\"\":1e308,\"\"c_per_m\"\":0.04}}\"\n")),
        (false, "mid_height", format!("Metadata\nVentilation_ventilation_zone_base_height,2.4\n\n{zone}Window Elements\nName,Zone,Type,area,pitch,width,height,orientation360,base_height,mid_height\nwin,Living,BuildingElementTransparent,1.2,90,1,1.2,90,3.2,1e307\n")),
        (false, "Zone Living area", format!("Zone\nName,Type,volume,floor_area,height\nLiving,Zone,,,2.5\n{walls}Roof,Living,BuildingElementOpaque,10,0,0,0.2,,,0,\"0,0,0|1e200,0,0|1e200,1e200,0|0,1e200,0\"\n")),
        (false, "Zone Living volume", format!("Zone\nName,Type,volume,floor_area,height\nLiving,Zone,,,1e200\n{walls}Roof,Living,BuildingElementOpaque,1e200,0,0,0.2,,,0,\n")),
        (false, "height (from coords)", format!("{zone}On-Site Generation\nName,Type,generation_type,pitch,orientation360,base_height,peak_power,width,height,coords\nPV,OnSiteGeneration,PhotovoltaicSystem,30,180,1,3.5,0,0,\"0,0,0|1e-300,0,0|1e5,1e5,0|0,1e5,0\"\n")),
        (true, "volume (sum of zones)", "Zone\nName,Type,volume,floor_area\nA,Zone,1e308,40\nB,Zone,1e308,40\n".to_string()),
        (true, "ThermalBridging (sum of zones)", {
            let zones: String = (0..6).map(|i| format!("Z{i},Zone,100,40,2.5,TRUE\n")).collect();
            let elements: String = (0..6).map(|i| wall(&format!("W{i}"), &format!("Z{i}"), "1.7e308", "2.5,4,0,")).collect();
            format!("Zone\nName,Type,volume,floor_area,height,simplified thermal bridging\n{zones}{walls}{elements}")
        }),
    ];
    for (fhs, field, csv) in cases {
        let error = convert(csv, fhs).unwrap_err().to_string();
        assert!(
            error.contains(&format!("[E055] '{field}")),
            "{field}: {error}"
        );
    }
}

#[test]
fn window_without_authored_parts_never_takes_template_airflow_height() {
    use vulcan_model_transform::ConversionProfile::*;
    let csv = r#"Metadata
VulcanCsvVersion,3

Zone
Name,Type,volume,floor_area
Living,Zone,100,40

Window Elements
Name,Zone,Type,area,pitch,width,height,base_height,free_area_height,mid_height,max_window_open_area,coords,extra_json
Upper,Living,BuildingElementTransparent,1.2,90,1,1.2,3.6,1.2,4.2,0.5,"0,0,1|1,0,1","{""u_value"":1.2,""g_value"":0.6}"
Unset,Living,BuildingElementTransparent,1.2,90,1,1.2,3.6,1.2,,0.5,"2,0,1|3,0,1","{""u_value"":1.2,""g_value"":0.6}"
"#;
    // The shipped template's window ventilates at 1.5 m.
    const FHS_SCHEMA: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../data/schemas/input_fhs.schema.json"
    ));
    const DEFAULTS_TEMPLATE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../data/defaults/defaults_template.json"
    ));
    // The shipped schema is a7's; target_mappings tests the physical-opening contracts.
    for (conversion_profile, version) in [
        (CurrentRustFhs, "1.0.0a7"),
        (DividedOpeningHalfPartitionV1, "1.0.0a7"),
    ] {
        let output = transform_geometry_csv(TransformRequest {
            csv: csv.into(),
            schema_json: FHS_SCHEMA.into(),
            defaults_json: DEFAULTS_TEMPLATE.into(),
            profile: ModelProfile::Fhs,
            conversion_profile,
            version_metadata: VersionMetadata {
                hem_core_version: version.into(),
                fhs_wrapper_version: Some(version.into()),
            },
        })
        .unwrap();
        let elements = &output.model["Zone"]["Living"]["BuildingElement"];
        assert_eq!(
            elements["Upper"]["window_part_list"],
            serde_json::json!([{"mid_height_air_flow_path": 4.2}]),
            "{conversion_profile:?}: {elements}"
        );
        assert!(
            elements["Unset"].get("window_part_list").is_none(),
            "{conversion_profile:?}: a window with no mid_height kept the template's parts: {}",
            elements["Unset"]
        );
        assert!(
            elements["Unset"].get("mid_height").is_none(),
            "{conversion_profile:?}: {}",
            elements["Unset"]
        );
    }
}
