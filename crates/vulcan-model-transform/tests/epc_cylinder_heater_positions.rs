// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

//! A cylinder heater's positions left blank on HEM:EPC: an existing building takes the default
//! (HEMIE applies it), and a new build is asked for the heater position. The editor leaves both
//! blank on HEM:EPC models (`DhwStorageHeatSourcePicker`).

use vulcan_model_transform::{
    transform_geometry_csv, ConversionProfile, ModelProfile, TransformOutput, TransformRequest,
    VersionMetadata,
};

const DIR: &str = env!("CARGO_MANIFEST_DIR");

fn read(path: &str) -> String {
    std::fs::read_to_string(format!("{DIR}/{path}")).unwrap()
}

fn convert(fixture: &str) -> TransformOutput {
    let csv = read(&format!("../../apps/cli/src/__tests__/fixtures/{fixture}"));
    let stated = r#",""heater_position"":0.1,""thermostat_position"":0.33"#;
    assert!(csv.contains(stated), "{fixture} states the positions");
    let product_data = std::fs::read_dir(format!("{DIR}/../../data/hem_database/1.0.0a10"))
        .unwrap()
        .map(|entry| {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            (name, std::fs::read_to_string(&path).unwrap())
        })
        .collect();
    transform_geometry_csv(TransformRequest {
        conversion_profile: ConversionProfile::EpcFullInputV1,
        product_data,
        csv: csv.replace(stated, ""),
        schema_json: read("../../data/schemas/hem_epc_orchestrator_input.schema.json"),
        defaults_json: read("../../data/defaults/defaults_template_epc.json"),
        profile: ModelProfile::Epc,
        version_metadata: VersionMetadata {
            hem_core_version: "2.0.0a4".into(),
            wrapper_version: Some("0.13.2".into()),
        },
    })
    .expect("EPC transform")
}

fn position_errors(output: &TransformOutput) -> Vec<String> {
    output
        .validation
        .errors
        .iter()
        .filter(|e| e.path.contains("position"))
        .map(|e| format!("{}: {}", e.path, e.message))
        .collect()
}

#[test]
fn an_existing_building_leaves_a_blank_heater_position_to_the_default() {
    let output = convert("epc_existing_building.csv");
    assert!(
        position_errors(&output).is_empty(),
        "{:?}",
        position_errors(&output)
    );
    let text = output.model.to_string();
    assert!(!text.contains("heater_position"), "no position is sent");
    assert!(!text.contains("thermostat_position"), "no position is sent");
}

#[test]
fn a_new_build_is_asked_for_a_blank_heater_position_only() {
    let output = convert("epc_new_build.csv");
    assert_eq!(
        position_errors(&output),
        ["/HotWaterSource/hw cylinder/HeatSource/immersion/heater_position: 'immersion' (ImmersionHeater) needs its heater position. A new build states it: there is no default."],
    );
}
