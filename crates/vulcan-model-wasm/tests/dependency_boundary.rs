// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

#[test]
fn public_wasm_manifest_has_no_private_product_dependency() {
    let manifest = include_str!("../Cargo.toml");
    for forbidden in [
        "hem-batch-core",
        "wasm_wrapper",
        "sap-calculator",
        "thermal_bridge_solver",
        "hem_pv_micro",
        "vulcan-mcp-server",
        "analyst",
    ] {
        assert!(
            !manifest.contains(forbidden),
            "public WASM manifest must not reference {forbidden}"
        );
    }
}
