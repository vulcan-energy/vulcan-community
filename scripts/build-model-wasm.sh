#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
community_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$community_root/.." && pwd)"
crate_dir="$community_root/crates/vulcan-model-wasm"
output_dir="$community_root/apps/geometry-editor/src/generated/model-wasm"

for command_name in cargo grep node rustc rustup wasm-pack; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Missing required command: $command_name" >&2
        echo "See README.md#run-locally for the Community editor prerequisites." >&2
        exit 1
    fi
done

if ! cargo --version | grep -q -- '-nightly'; then
    echo "The Community WASM build requires a nightly Cargo toolchain." >&2
    echo "Run 'rustup override set nightly' from the repository root." >&2
    exit 1
fi
if ! rustup component list --installed | grep -qx "rust-src"; then
    echo "The Community WASM build requires the rust-src component." >&2
    echo "Run 'rustup component add rust-src --toolchain nightly'." >&2
    exit 1
fi
if ! rustup target list --installed | grep -qx "wasm32-unknown-unknown"; then
    echo "The Community WASM build requires the wasm32-unknown-unknown target." >&2
    echo "Run 'rustup target add wasm32-unknown-unknown --toolchain nightly'." >&2
    exit 1
fi

generated_parent="$(dirname "$output_dir")"
expected_output_dir="$community_root/apps/geometry-editor/src/generated/model-wasm"
if [[ "$output_dir" != "$expected_output_dir" ]]; then
    echo "Refusing to replace an unexpected Community WASM output directory." >&2
    exit 1
fi
mkdir -p "$generated_parent"
staging_dir="$(mktemp -d "$generated_parent/.model-wasm-build.XXXXXX")"
backup_parent=""
backup_dir=""
cleanup_build_temp() {
    if [[ -n "${staging_dir:-}" && -d "$staging_dir" ]]; then
        rm -rf -- "$staging_dir"
    fi
    if [[ -n "${backup_parent:-}" && -d "$backup_parent" ]]; then
        if [[ ! -d "$output_dir" && -n "${backup_dir:-}" && -d "$backup_dir" ]]; then
            mv "$backup_dir" "$output_dir"
        fi
        rm -rf -- "$backup_parent"
    fi
}
trap cleanup_build_temp EXIT

# FHS preprocessing uses Rayon. Scope the browser flags to the WASM target so
# wasm-pack's native helper installation never inherits incompatible flags.
rust_sysroot="$(rustc --print sysroot)"
build_home="${HOME:-}"
cargo_home="${CARGO_HOME:-}"
if [[ -z "$cargo_home" && -n "$build_home" ]]; then
    cargo_home="$build_home/.cargo"
fi
build_tmp_root="${TMPDIR:-/tmp}"
build_tmp_root="${build_tmp_root%/}"
wasm_rustflags='-C target-feature=+atomics,+bulk-memory,+simd128,+nontrapping-fptoint,+sign-ext,+extended-const --cfg getrandom_backend="wasm_js"'

# Cargo's target-specific RUSTFLAGS variable is whitespace-delimited. Reject an
# unsupported checkout/toolchain path instead of silently producing an
# unremapped or malformed build; the error explains how to relocate the tree.
for remap_source in \
    "$repo_root" \
    "$build_home" \
    "$cargo_home" \
    "$build_tmp_root" \
    "$rust_sysroot"
do
    if [[ "$remap_source" =~ [[:space:]] ]]; then
        echo "Community WASM build paths must not contain whitespace: $remap_source" >&2
        exit 1
    fi
done

# Rust keeps source locations in release panic metadata. Cargo can pass local
# dependency paths to rustc as either absolute or workspace-relative paths, so
# remap both forms before the broader repository prefixes.
wasm_rustflags+=" --remap-path-prefix=$community_root/hem_engine_upstream=vulcan-community/third_party/hem-engine"
wasm_rustflags+=" --remap-path-prefix=$community_root/hem_fhs_upstream=vulcan-community/third_party/hem-fhs"
wasm_rustflags+=" --remap-path-prefix=$community_root/third_party/jsonschema-0.46.5-offline=vulcan-community/third_party/jsonschema"
wasm_rustflags+=" --remap-path-prefix=hem_engine_upstream=vulcan-community/third_party/hem-engine"
wasm_rustflags+=" --remap-path-prefix=hem_fhs_upstream=vulcan-community/third_party/hem-fhs"
wasm_rustflags+=" --remap-path-prefix=$community_root=vulcan-community"
# Anything else under a parent checkout must remain fail-closed.
wasm_rustflags+=" --remap-path-prefix=$repo_root=unmapped-repository-root"
if [[ -n "$build_home" ]]; then
    wasm_rustflags+=" --remap-path-prefix=$build_home=build-home"
fi
if [[ -n "$cargo_home" ]]; then
    wasm_rustflags+=" --remap-path-prefix=$cargo_home=cargo"
fi
wasm_rustflags+=" --remap-path-prefix=$build_tmp_root=build-tmp"
wasm_rustflags+=" --remap-path-prefix=$rust_sysroot=rust-toolchain"

export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="$wasm_rustflags"

wasm-pack build \
    --target web \
    --release \
    --out-name vulcan_model_wasm \
    --out-dir "$staging_dir" \
    "$crate_dir" \
    -- \
    --locked \
    -Z build-std=std,panic_abort

declarations="$staging_dir/vulcan_model_wasm.d.ts"
wasm_binary="$staging_dir/vulcan_model_wasm_bg.wasm"
for export_name in \
    convert_geometry_csv_request \
    hem_core_version \
    fhs_wrapper_version \
    validate_fhs_preflight \
    initialize_rayon_thread_pool
do
    if ! grep -q "$export_name" "$declarations"; then
        echo "Generated Community WASM is missing export: $export_name" >&2
        exit 1
    fi
done

if LC_ALL=C grep -a -E -q -- \
    '/Users/|/home/|/private/(tmp|var)/|[A-Za-z]:[\\/]Users[\\/]|hem_engine_upstream|hem_fhs_upstream|unmapped-repository-root([\\/]|$)' \
    "$wasm_binary"
then
    echo "Generated Community WASM contains a non-portable private build path." >&2
    exit 1
fi

backup_parent="$(mktemp -d "$build_tmp_root/vulcan-community-model-wasm-backup.XXXXXX")"
backup_dir="$backup_parent/model-wasm"
if [[ -d "$output_dir" ]]; then
    mv "$output_dir" "$backup_dir"
fi
if ! mv "$staging_dir" "$output_dir"; then
    if [[ -d "$backup_dir" ]]; then
        mv "$backup_dir" "$output_dir"
    fi
    exit 1
fi
staging_dir=""

boundary_checker="$repo_root/scripts/check-community-boundary.mjs"
if [[ -f "$boundary_checker" ]]; then
    if ! node "$boundary_checker"; then
        rm -rf -- "$output_dir"
        if [[ -d "$backup_dir" ]]; then
            mv "$backup_dir" "$output_dir"
        fi
        exit 1
    fi
else
    echo "Parent boundary checker not present; skipping the integration-only check for this standalone Community build." >&2
fi
if [[ -d "$backup_dir" ]]; then
    rm -rf -- "$backup_dir"
fi
rm -rf -- "$backup_parent"
backup_parent=""
backup_dir=""

echo "Community model WASM generated at $output_dir"
