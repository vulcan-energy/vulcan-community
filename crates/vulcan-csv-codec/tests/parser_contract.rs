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

#[test]
fn non_finite_and_out_of_range_numbers_are_not_coerced() {
    let parsed = CSVParser::new()
        .parse_csv("Metadata,,\nName,Value\nA,NaN\nB,-inf\nC,Infinity\nD,1e300\n")
        .expect("CSV should parse");
    let values: Vec<_> = parsed["Metadata"].iter().map(|row| &row["Value"]).collect();
    assert_eq!(values[1], "NaN");
    assert_eq!(values[2], "-inf");
    assert_eq!(values[3], "Infinity");
    // A Metadata number that does not print back as typed stays text.
    assert_eq!(values[4], "1e300");
}

#[test]
fn a_metadata_digit_string_a_number_cannot_hold_exactly_stays_text() {
    let parsed = CSVParser::new()
        .parse_csv(
            "Metadata,,\nA,0012345678901234\nB,1234567890123456\nC,98765432109876543\nD,0\nE,0.5\nF,12345678901234e1\nG,0123456789012E45\n",
        )
        .expect("CSV should parse");
    let values: Vec<_> = parsed["Metadata"].iter().map(|row| &row["Value"]).collect();
    assert_eq!(values[0], "0012345678901234");
    assert_eq!(values[1], 1234567890123456_i64);
    assert_eq!(values[2], "98765432109876543");
    assert_eq!(values[3], 0);
    assert_eq!(values[4], 0.5);
    assert_eq!(values[5], "12345678901234e1");
    assert_eq!(values[6], "0123456789012E45");
}

#[test]
fn names_and_references_stay_text() {
    let csv = "Zone\nName,Type,volume,floor_area\n007,Zone,100,40\n\nExposed Elements\nName,Zone,Type,width\n1,007,BuildingElementOpaque,4\n\nWindow Elements\nName,Zone,Type,parent_element,width\n2,007,BuildingElementTransparent,1,1.5\n";
    let parsed = CSVParser::new().parse_csv(csv).expect("CSV should parse");
    assert_eq!(parsed["Zone"][0]["Name"], "007");
    assert_eq!(parsed["Exposed Elements"][0]["Name"], "1");
    assert_eq!(parsed["Exposed Elements"][0]["Zone"], "007");
    assert_eq!(parsed["Exposed Elements"][0]["width"], 4);
    assert_eq!(parsed["Window Elements"][0]["parent_element"], "1");
}
