// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

use serde_json::json;
use vulcan_model_transform::preflight_diagnostics::{
    classify_fhs_preflight_error_line, extract_fhs_preflight_errors,
};

#[test]
fn known_fhs_failures_keep_actionable_paths_and_messages() {
    let bath = classify_fhs_preflight_error_line("Bath too small, fill_vol_l: -7.552811413753247");
    assert_eq!(bath["path"], json!("/HotWaterDemand/Bath"));
    assert_eq!(bath["code"], json!("fhs_hot_water_bath_too_small"));
    assert_eq!(bath["user_message"], json!("Increase bath size."));

    let window = classify_fhs_preflight_error_line(
        "Zone 'Living/Kitchen' must contain at least one BuildingElementTransparent",
    );
    assert_eq!(
        window["path"],
        json!("/Zone/Living~1Kitchen/BuildingElement")
    );
    assert_eq!(window["code"], json!("fhs_window_required"));
    assert_eq!(
        window["user_message"],
        json!("Add a window to Living/Kitchen.")
    );
}

#[test]
fn upstream_failure_banner_is_split_into_individual_diagnostics() {
    let raw = concat!(
        "Request was considered invalid due to error:\n",
        "FHS input validation failed, see part F of the building regulations.\n",
        "Failure(s):\n",
        "Dwelling lacks any mechanical vents.\n",
        "The 'storeys_in_building' property, 1, must be greater than or equal to the ",
        "'storeys_in_dwelling' property, 2\n",
    );

    let errors = extract_fhs_preflight_errors(raw);
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0]["code"], json!("fhs_part_f"));
    assert_eq!(errors[1]["code"], json!("fhs_storeys"));
}

#[test]
fn unknown_failures_remain_explicit_and_are_not_misclassified() {
    let error = classify_fhs_preflight_error_line("Some new upstream preflight error");
    assert_eq!(error["path"], json!("/"));
    assert_eq!(error["code"], json!("fhs_preflight"));
    assert_eq!(error["category"], json!("fhs_preflight"));
    assert_eq!(error["message"], json!("Some new upstream preflight error"));
    assert_eq!(error["technical_message"], error["message"]);
}
