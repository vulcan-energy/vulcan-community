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
