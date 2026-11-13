// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! Primary pipework has two sources: a cylinder's own `primary_pipework` on its Systems row, and
//! drawn primary Water Pipework rows. Authored data is never replaced or removed silently.

use serde_json::{json, Value};
use vulcan_model_transform::{
    transform_geometry_csv, ConversionProfile, ModelProfile, TransformOutput, TransformRequest,
    VersionMetadata,
};

const FHS_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../data/schemas/input_fhs.schema.json"
));
const CORE_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../data/schemas/core-input.schema.json"
));
const DEFAULTS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../data/defaults/defaults_template.json"
));

const PATH: &str = "/HotWaterSource/hw cylinder/primary_pipework";

/// A pipe in the cylinder's own `primary_pipework` (length 2.5) and a drawn one (length 6).
const AUTHORED_LENGTH: f64 = 2.5;
const DRAWN_LENGTH: f64 = 6.0;

fn pipe(length: f64) -> Value {
    json!({
        "location": "internal", "internal_diameter_mm": 22, "external_diameter_mm": 24,
        "length": length, "insulation_thermal_conductivity": 0.035,
        "insulation_thickness_mm": 25, "surface_reflectivity": false, "pipe_contents": "water"
    })
}

fn csv_cell(value: &Value) -> String {
    format!("\"{}\"", value.to_string().replace('"', "\"\""))
}

/// `source` is the row's `_system_source` marker; `None` writes no marker.
fn csv(authored: Option<f64>, source: Option<&str>, drawn: Option<f64>) -> String {
    let mut cylinder = json!({
        "type": "StorageTank", "volume": 150, "daily_losses": 1.5, "init_temp": 55,
        "ColdWaterSource": "mains water",
        "HeatSource": {"hp": {"type": "HeatSourceWet", "name": "hp", "temp_flow_limit_upper": 65,
            "heater_position": 0.1, "thermostat_position": 0.33}}
    });
    if let Some(length) = authored {
        cylinder["primary_pipework"] = json!([pipe(length)]);
    }
    let mut extra = json!({"HotWaterSource": {"hw cylinder": cylinder}});
    if let Some(source) = source {
        extra["_system_source"] = json!(source);
    }
    let mut text = format!(
        "Zone\nName,Type,volume,floor_area\nLiving,Zone,100,40\n\n\
         Systems\nName,Zone,Type,subcategory,system_preset,coords,extra_json\n\
         Tank,Living,System,HotWaterSource,heat_pump_cylinder,,{}\n",
        csv_cell(&extra)
    );
    if let Some(length) = drawn {
        let row_extra = pipe(length);
        text.push_str(&format!(
            "\nWater Pipework\nName,Type,length,location,pipework_type,coords,extra_json\n\
             Riser,WaterPipework,{length},internal,primary,,{}\n",
            csv_cell(&row_extra)
        ));
    }
    text
}

fn profiles() -> [(ModelProfile, ConversionProfile, &'static str, &'static str); 4] {
    [
        (
            ModelProfile::Fhs,
            ConversionProfile::CurrentRustFhs,
            "1.0.0a7",
            FHS_SCHEMA,
        ),
        (
            ModelProfile::Fhs,
            ConversionProfile::PythonFhsA8,
            "1.0.0a8",
            FHS_SCHEMA,
        ),
        (
            ModelProfile::Fhs,
            ConversionProfile::PythonFhsA9,
            "1.0.0a9",
            FHS_SCHEMA,
        ),
        (
            ModelProfile::Core,
            ConversionProfile::CurrentRustFhs,
            "1.0.0a7",
            CORE_SCHEMA,
        ),
    ]
}

fn convert_all(csv: &str) -> Vec<(String, TransformOutput)> {
    profiles()
        .into_iter()
        .map(|(profile, conversion_profile, version, schema)| {
            let output = transform_geometry_csv(TransformRequest {
                csv: csv.into(),
                schema_json: schema.into(),
                defaults_json: DEFAULTS.into(),
                profile,
                conversion_profile,
                product_data: Default::default(),
                version_metadata: VersionMetadata {
                    hem_core_version: version.into(),
                    wrapper_version: (profile == ModelProfile::Fhs).then(|| version.into()),
                },
            })
            .expect("conversion returns a model");
            (format!("{profile:?} {conversion_profile:?}"), output)
        })
        .collect()
}

fn lengths(output: &TransformOutput) -> Option<Vec<f64>> {
    output.model.pointer(PATH).map(|pipes| {
        pipes
            .as_array()
            .expect("primary_pipework is an array")
            .iter()
            .map(|p| p["length"].as_f64().expect("length"))
            .collect()
    })
}

fn codes(output: &TransformOutput) -> Vec<String> {
    output
        .validation
        .errors
        .iter()
        .map(|e| e.code.clone())
        .collect()
}

#[test]
fn authored_primary_pipework_without_drawn_rows_is_kept() {
    for (label, output) in convert_all(&csv(Some(AUTHORED_LENGTH), Some("custom"), None)) {
        assert_eq!(lengths(&output), Some(vec![AUTHORED_LENGTH]), "{label}");
        assert!(!codes(&output).contains(&"E067".into()), "{label}");
    }
}

#[test]
fn authored_and_drawn_primary_pipework_that_differ_fail_naming_both() {
    for (label, output) in convert_all(&csv(Some(AUTHORED_LENGTH), None, Some(DRAWN_LENGTH))) {
        let error = output
            .validation
            .errors
            .iter()
            .find(|e| e.code == "E067")
            .unwrap_or_else(|| panic!("{label}: no E067 in {:?}", codes(&output)));
        assert_eq!(error.path, PATH, "{label}");
        for name in ["hw cylinder", "Tank", "Riser"] {
            assert!(error.message.contains(name), "{label}: {}", error.message);
        }
        // The authored value is not replaced by the drawn one.
        assert_eq!(lengths(&output), Some(vec![AUTHORED_LENGTH]), "{label}");
    }
}

#[test]
fn authored_and_drawn_primary_pipework_that_agree_convert() {
    for (label, output) in convert_all(&csv(Some(DRAWN_LENGTH), None, Some(DRAWN_LENGTH))) {
        assert_eq!(lengths(&output), Some(vec![DRAWN_LENGTH]), "{label}");
        assert!(!codes(&output).contains(&"E067".into()), "{label}");
    }
}

#[test]
fn drawn_rows_are_the_source_when_nothing_is_authored() {
    for (label, output) in convert_all(&csv(None, Some("presets"), Some(DRAWN_LENGTH))) {
        assert_eq!(lengths(&output), Some(vec![DRAWN_LENGTH]), "{label}");
        assert!(
            !output.schema_omissions.iter().any(|n| n.path == PATH),
            "{label}"
        );
    }
}

/// CSVs saved before the editor stopped copying the preset's pipework onto the cylinder.
#[test]
fn a_legacy_preset_copy_gives_way_to_drawn_rows_with_a_notice() {
    for (label, output) in convert_all(&csv(
        Some(AUTHORED_LENGTH),
        Some("presets"),
        Some(DRAWN_LENGTH),
    )) {
        assert_eq!(lengths(&output), Some(vec![DRAWN_LENGTH]), "{label}");
        assert!(!codes(&output).contains(&"E067".into()), "{label}");
        let notice = output
            .schema_omissions
            .iter()
            .find(|n| n.path == PATH)
            .unwrap_or_else(|| panic!("{label}: no notice in {:?}", output.schema_omissions));
        assert_eq!(notice.code, "W_TARGET_INPUT", "{label}");
        assert!(
            notice.message.contains("Tank"),
            "{label}: {}",
            notice.message
        );
    }
}

#[test]
fn a_legacy_preset_copy_without_drawn_rows_is_ignored_with_a_notice() {
    for (label, output) in convert_all(&csv(Some(AUTHORED_LENGTH), Some("presets"), None)) {
        assert_eq!(lengths(&output), None, "{label}");
        assert!(
            output.schema_omissions.iter().any(|n| n.path == PATH),
            "{label}: {:?}",
            output.schema_omissions
        );
    }
}
