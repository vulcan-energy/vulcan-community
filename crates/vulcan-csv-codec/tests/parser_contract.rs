// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: Apache-2.0

use vulcan_csv_codec::parser::CSVParser;

#[test]
fn parses_sectioned_rows_and_quoted_json_without_model_policy() {
    let csv = r#"Zone
Name,Type,volume,floor_area
Living,Zone,100,40

Exposed Elements
Name,Zone,Type,extra_json
Wall,Living,BuildingElementOpaque,"{""u_value"":0.18}"
"#;
    let parsed = CSVParser::new().parse_csv(csv).expect("CSV should parse");
    assert_eq!(parsed["Zone"][0]["Name"], "Living");
    assert_eq!(parsed["Exposed Elements"][0]["extra_json"]["u_value"], 0.18);
}

#[test]
fn every_metadata_row_is_a_field_value_pair() {
    let parsed = CSVParser::new()
        .parse_csv("Metadata,,\nNumberOfBedrooms,3,\nField,Value\nGuideOverlay,0,v1|a.png\n")
        .expect("CSV should parse");
    assert_eq!(
        serde_json::to_value(&parsed["Metadata"]).unwrap(),
        serde_json::json!([
            {"Field": "NumberOfBedrooms", "Value": 3},
            {"Field": "Field", "Value": "Value"},
            {"Field": "GuideOverlay", "Value": 0}
        ])
    );
}

#[test]
fn rejects_a_row_that_references_an_undefined_zone() {
    let csv = r#"Exposed Elements
Name,Zone,Type
Wall,Missing,BuildingElementOpaque
"#;
    let error = CSVParser::new()
        .parse_csv(csv)
        .expect_err("undefined zone must fail loudly");
    assert_eq!(error.code, "E008");
}
