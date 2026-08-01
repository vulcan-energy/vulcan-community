# Vulcan Community

Vulcan Community is an offline-first 2D/3D building-geometry editor for Home
Energy Model (HEM) and Future Homes Standard (FHS) modellers, assessors and tool
builders. It runs in a Chromium-based browser against a local folder: no account
is required, and project files stay on the user's machine.

It authors and validates HEM and FHS model inputs; it does not run simulations.
The included WASM exposes CSV-to-HEM conversion, FHS preflight and version
reporting, with no simulation run entry point. To calculate results, use the
public, MIT-licensed
[upstream HEM engine](https://github.com/communitiesuk/epb-home-energy-model)
separately; this repository pins it as the `hem_engine_upstream` submodule.

The editor includes 2D/3D geometry authoring, Core/FHS fields, local documents
and projects, editable defaults, an assembly calculator, automatic thermal
bridges, CSV-to-HEM conversion and FHS preflight validation. Optional IFC import
is described below.

## Run locally

Clone the repository with its pinned HEM engine and FHS wrapper submodules:

```bash
git clone --recurse-submodules https://github.com/vulcan-energy/vulcan-community.git
cd vulcan-community
```

If you already cloned without `--recurse-submodules`, recover with:

```bash
git submodule update --init --recursive
```

The editor requires Node.js 22.19 or newer with npm (the lockfile is tested
with npm 10.9.3), plus a POSIX shell with `grep`. Building its local model WASM
also requires `cargo`, `rustc` and `rustup` using a nightly Rust toolchain, the
`rust-src` component, the `wasm32-unknown-unknown` target, and `wasm-pack`.
Install and select those Rust prerequisites from the repository root:

```bash
rustup toolchain install nightly --component rust-src --target wasm32-unknown-unknown
rustup override set nightly
cargo install wasm-pack --version 0.14.0 --locked
```

Install the locked JavaScript dependencies and start the editor:

```bash
npm ci
npm run dev
```

The first run builds the model WASM, then Vite serves the editor at
`http://localhost:5176/`. Open it in a Chromium-based browser and choose a
dedicated local folder when prompted. The editor uses the browser File System
Access API: opening, editing and saving stay on your computer.

IFC import is optional and experimental. It requires a third-party ~11 MB
IfcOpenShell Pyodide wheel that statically contains GPL-3.0-or-later CGAL code.
The binary is not committed to or redistributed by this repository. To enable
IFC import, stop the dev server, fetch the pinned wheel, then restart:

```bash
npm run fetch:ifc-wheel
npm run dev
```

The fetch verifies the SHA-256 recorded in
[`third_party/ifc/dependencies.json`](third_party/ifc/dependencies.json), which
also records the wheel's provenance. When IFC import is explicitly invoked it
loads the pinned Pyodide runtime from jsDelivr; the IFC file bytes remain in the
browser worker.

The starter workspace contains one editable defaults file at
`data/defaults/defaults_template.json`. Open **Global Settings -> Defaults** to
edit or duplicate it. Starter assemblies are illustrative and user-editable;
the junction defaults are attributed HEM guidance Building Fabric Table 3.7 data.

Theme and naming configuration lives in
`apps/geometry-editor/src/communityEditorConfig.ts`; forks can change that
composition value without changing editor components.

## Self-hosting

Self-hosted deployments must be cross-origin isolated for FHS preflight because
it relies on `SharedArrayBuffer`. The [deployment guide](docs/DEPLOYMENT.md)
covers the required COOP/COEP configuration and supported hosting patterns.

## Run the tests

This tree carries its own tests, beside the modules they cover, and its own
harness to run them:

```bash
npm ci
npm test
npm run typecheck
npm run typecheck:document
npm run lint
npm run quality
npm run licence
```

`npm run lint` is the raw ESLint report and exits non-zero while the recorded debt remains.
`npm run quality` is the enforcing ratchet: it accepts the baseline but fails if ESLint or
React Doctor gets worse.

Run installation and tests from the repository root rather than from an
individual workspace package. Nested installs can introduce a second React copy,
which produces misleading hook errors instead of exercising the application.

## Project scope

Vulcan Community covers the browser editor and its local authoring and
validation workflow: geometry, Core/FHS fields, local documents and defaults,
the assembly calculator, automatic thermal bridges, CSV-to-HEM conversion and
FHS preflight. Simulation, SAP/RdSAP calculation and lodgement,
account-backed managed workspaces and other commercial services are separate
[Vulcan products](https://usevulcan.app) and are not part of this repository.

## Licences by path

| Part of the tree | Licence |
| --- | --- |
| `apps/**`, the substantial editor packages, `crates/vulcan-model-transform/**`, `crates/vulcan-model-wasm/**` and classified first-party build entry points | `AGPL-3.0-only` plus the Vulcan Origin Terms in `ADDITIONAL_TERMS.md` |
| `crates/vulcan-csv-codec/**` | `Apache-2.0` |
| This README, approved documentation and the HEF-authored starter assembly data | `CC-BY-4.0` |
| `data/junction_psi_defaults/table_3_7_default_psi.csv` | `OGL-UK-3.0` with Crown attribution |
| The pinned HEM/FHS upstreams and exact copied upstream schemas | Their upstream `MIT` terms |
| Other `third_party/**` material | Its identified upstream terms; never a Vulcan first-party header |

The full standard texts are in [`LICENSES/`](LICENSES/), and
[`PATH_RIGHTS.md`](PATH_RIGHTS.md) records the authoritative path treatment and
provenance summary. Unlisted paths default to exclusion under
`licence-manifest.json`.

## Contributing and project policy

Contribution requirements are in [`CONTRIBUTING.md`](CONTRIBUTING.md), and
participation is governed by the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
Report vulnerabilities as described in [`SECURITY.md`](SECURITY.md), not in a
public issue. Project changes are recorded in [`CHANGELOG.md`](CHANGELOG.md).
