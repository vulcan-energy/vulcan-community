// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

const COMMUNITY_CORE_SCHEMA: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../data/schemas/core-input.schema.json"
));
const UPSTREAM_CORE_SCHEMA: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../hem_engine_upstream/schemas/core-input.schema.json"
));
const COMMUNITY_FHS_SCHEMA: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../data/schemas/input_fhs.schema.json"
));
const UPSTREAM_FHS_SCHEMA: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../hem_fhs_upstream/schema/input_fhs.schema.json"
));

#[test]
fn community_core_schema_matches_pinned_upstream() {
    assert_eq!(COMMUNITY_CORE_SCHEMA, UPSTREAM_CORE_SCHEMA);
}

#[test]
fn community_fhs_schema_matches_pinned_upstream() {
    assert_eq!(COMMUNITY_FHS_SCHEMA, UPSTREAM_FHS_SCHEMA);
}

#[test]
fn surface_class_values_are_the_pinned_a7_wrappers() {
    let source = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../hem_fhs_upstream/src/future_homes_standard/future_homes_standard.rs"
    ));
    let start = source.find("static AREAL_HEAT_MAP").unwrap();
    let block = &source[start..start + source[start..].find(".into()").unwrap()];
    for (label, value) in vulcan_model_transform::AREAL_HEAT_CAPACITY_CLASSES
        .iter()
        .zip(vulcan_model_transform::SURFACE_AREAL_HEAT_CAPACITY)
    {
        assert!(
            block.contains(&format!("(\"{label}\", {})", value as u64)),
            "{label} {value}"
        );
    }
}
