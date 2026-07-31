# Vulcan Community path policy

Status: approved for public source release. First-party rights, outbound licence
choices and the Table 3.7 and fetch-only IFC decisions are final.

This document is the human-readable policy summary. `licence-manifest.json` is
the machine-readable allowlist and defaults every unknown path to exclusion.
The repository's licence validator enumerates the current Community sources;
all classified first-party `rights_status` values must remain `approved`.

## Selected split

| Path/material | Licence | Treatment |
| --- | --- | --- |
| `apps/**`, `packages/**`, `crates/vulcan-model-transform/**`, `crates/vulcan-model-wasm/**` | `AGPL-3.0-only` plus Vulcan Origin Terms | Include in the public source release |
| `crates/vulcan-csv-codec/**`, deliberately thin interchange/schema/fixture paths and functional self-hosting configuration | `Apache-2.0` | Include in the public source release |
| `README.md`, cleared prose/diagrams and HEF starter catalogue data | `CC-BY-4.0` | Include with attribution |
| `data/junction_psi_defaults/table_3_7_default_psi.csv` | `OGL-UK-3.0` | Include with HEM guidance Building Fabric Table 3.7/Crown attribution |
| Exact HEM/FHS upstream material and schemas | Upstream `MIT` | Include at pinned revisions with upstream notices |
| `apps/geometry-editor/src/assets/ifc/ifc_parser.py` | `AGPL-3.0-only` plus Vulcan Origin Terms | First-party HEF parser; include in the public source release |
| Fetched `ifcopenshell-0.8.3+34a1bc6-cp313-cp313-emscripten_4_0_9_wasm32.whl` | Effective `GPL-3.0-or-later` binary | Excluded from Git and source releases; users or deployers may fetch the pinned artifact with `scripts/fetch-ifc-wheel.sh`, which verifies its SHA-256 |
| Unlisted material | Excluded | Never export by default |

The owner confirms all included first-party work is Home Energy Foundry
Limited/Vulcan work with no further contributor-rights clearance required.
HEM and FHS are final MIT decisions. The reviewed defaults, starter data,
assembly material and Table 3.7 data decisions are final and must not be
reopened as owner questions.

### Table 3.7 provenance evidence

The shipped default psi values are an exact 44/44 match for Home Energy Model
guidance, Building Fabric, section 3.7.2, Table 3.7. An earlier revision of this
policy attributed them to SAP 10.2 Appendix K Table K1; that attribution is
withdrawn. HEM guidance is the correct source for a HEM authoring tool, and the
values were verified row by row against the document, not inferred.

The two tables are distinguishable, and the shipped file is not the SAP one.
SAP Appendix K Table K1 has **50** rows: the same 44 E/P/R junctions plus six
`B1`-`B6` basement junctions. `table_3_7_default_psi.csv` has exactly 44 rows
and no `B` rows.

The owner-approved licence decision is `OGL-UK-3.0`, with the HEM guidance
Building Fabric source, pinned evidence SHA-256, Crown copyright statement and
OGL attribution preserved in this repository. Runtime/CSV parity is enforced
mechanically. This decision is complete and is not a remaining release gate.

## Architecture boundary

- Community owns the single canonical editor/store, document/local-workspace
  flow, FHS authoring/preflight, automatic bridge topology, assembly calculator,
  local CSV-to-HEM conversion and explicit user-invoked IFC importer.
- Official supplies Quick Sim, SAP PDF/XML import/diff/prefill, native SAP/RdSAP
  calculation/lodgement, detailed solving, proprietary catalogues, managed
  account services, telemetry and entitlement.
- Community must contain no public-to-private import, plan logic, private
  feature symbol, private dynamic import or private build path.

## Exact approved inputs

- HEM: `62d3df705690f33b3fc3e905c9971d4f3743bf2e`.
- FHS: `c5ba2673fbd886cfe4fb528f61b376bdf406ebbd`; canonical MIT evidence revision
  `dd5ba73a19674d631da59b4924bb7dc2833fbb3b`.
- Defaults SHA-256:
  `f9447c404a4f1253a36866878f0ada8c2cd73fbf62e88340a2faebbf76d33fbb`.
- Table 3.7 CSV SHA-256:
  `a1ef0f2e7617a947939d5602de75303baa1cc9fbabd32a4781a1c980e8bb7cb1`.
- Table 3.7 source evidence copy (HEM guidance Building Fabric, draft) SHA-256:
  `6bfeeb31bf1bf3296722f393745ccda895f4bfed9f39b70e8e3abecd12d1f7c9`.
- IFC parser SHA-256:
  `e4c66dbfe61db5a8c4e385253fa96aac3d601b313b369f61f8419ede6ed4a176`.
- Fetched wheel SHA-256:
  `0092a71cfd56753b16f78541e1b9ea74446c2f51f9cbf0897aeaef615a5c89ab`.
- Exact IFC/Pyodide dependency inventory: `third_party/ifc/dependencies.json`.

## Release controls

No rights or provenance decision remains open. Public source releases must pass
the allowlist/licence validator, deterministic SBOM check, clean build and test
suites, and secret/identity scans. The IFC wheel remains outside Git and source
archives; a deployment that fetches and serves it must preserve its notices and
offer the Corresponding Source recorded in `third_party/ifc/dependencies.json`.
