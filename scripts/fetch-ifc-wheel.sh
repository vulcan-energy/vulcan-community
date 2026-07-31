#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
# SPDX-License-Identifier: AGPL-3.0-only

#
# Fetch and verify the pinned IfcOpenShell Pyodide wheel.
#
# The wheel is not committed. It is an ~11 MB binary that statically contains
# GPL-3.0-or-later CGAL Nef_3 code and is excluded from source releases.
# Committing it would put that binary permanently in Git history even though
# released source archives cannot include it.
#
# Re-acquisition is deterministic: third_party/ifc/dependencies.json
# pins the exact upstream URL, the upstream Git blob and the SHA-256. This
# script downloads that exact artifact and refuses to install anything whose
# hash does not match.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
community_root="$(cd "$script_dir/.." && pwd)"
inventory="$community_root/third_party/ifc/dependencies.json"
output_dir="$community_root/apps/geometry-editor/public/ifc"

for command_name in curl node shasum; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Missing required command: $command_name" >&2
        exit 1
    fi
done

if [ ! -f "$inventory" ]; then
    echo "Missing IFC dependency inventory: $inventory" >&2
    exit 1
fi

read -r wheel_path expected_sha256 upstream_url <<EOF
$(node --input-type=module -e '
import { readFileSync } from "node:fs";
import { posix } from "node:path";
const inventory = JSON.parse(readFileSync(process.argv[1], "utf8"));
const artifacts = inventory.distributed_artifacts ?? [];
const wheels = artifacts.filter((a) => (a.path ?? "").endsWith(".whl"));
if (wheels.length !== 1) {
  console.error(`Expected exactly one pinned wheel, found ${wheels.length}`);
  process.exit(1);
}
const [wheel] = wheels;
for (const field of ["path", "sha256", "upstream_artifact_url"]) {
  if (!wheel[field]) {
    console.error(`Pinned wheel is missing ${field}`);
    process.exit(1);
  }
}
if (
  typeof wheel.path !== "string"
  || posix.isAbsolute(wheel.path)
  || posix.normalize(wheel.path) !== wheel.path
  || wheel.path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
) {
  console.error(`Pinned wheel path must be normalized and relative to the Community root: ${wheel.path}`);
  process.exit(1);
}
process.stdout.write(`${wheel.path} ${wheel.sha256} ${wheel.upstream_artifact_url}`);
' "$inventory")
EOF

target="$community_root/$wheel_path"
case "$target" in
    "$community_root"/*) ;;
    *)
        echo "Refusing to write the IFC wheel outside the Community root: $wheel_path" >&2
        exit 1
        ;;
esac
mkdir -p "$output_dir"

verify() {
    [ -f "$target" ] && [ "$(shasum -a 256 "$target" | cut -d' ' -f1)" = "$expected_sha256" ]
}

if verify; then
    echo "Pinned IFC wheel already present and verified: $wheel_path"
    exit 0
fi

if [ -f "$target" ]; then
    echo "Existing IFC wheel does not match the pinned SHA-256; refetching." >&2
fi

echo "Fetching pinned IFC wheel from $upstream_url"
temp_file="$(mktemp "$output_dir/.vulcan-ifc-wheel.XXXXXX")"
trap 'rm -f "$temp_file"' EXIT

if ! curl --fail --location --silent --show-error --output "$temp_file" "$upstream_url"; then
    echo "Failed to download the pinned IFC wheel from $upstream_url" >&2
    exit 1
fi

actual_sha256="$(shasum -a 256 "$temp_file" | cut -d' ' -f1)"
if [ "$actual_sha256" != "$expected_sha256" ]; then
    echo "Pinned IFC wheel SHA-256 mismatch; refusing to install." >&2
    echo "  expected: $expected_sha256" >&2
    echo "  actual:   $actual_sha256" >&2
    exit 1
fi

mv "$temp_file" "$target"
chmod 644 "$target"
trap - EXIT
echo "Verified and installed $wheel_path ($actual_sha256)"
