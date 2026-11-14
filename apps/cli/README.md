<!--
SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

# Vulcan Community CLI

Command-line checks for Home Energy Model (HEM) geometry, from the open-source
[Vulcan Community](https://github.com/vulcan-energy/vulcan-community) editor. It runs
offline on your machine.

```bash
npx @vulcan-energy/community-cli check house.csv --summary
```

| Command | What it does |
| --- | --- |
| `check <csv>` | Validate a geometry CSV: elements, zones, missing elements and Part F findings. `--fail-on=none\|critical\|warning` sets the exit code. |
| `thermal-bridges <csv>` | Propose a linear thermal bridge for each junction, with Table 3.7 default psi values (`--csv-section` for a pasteable section). |
| `thermal-bridges <csv> --validate` | Validate the CSV's thermal-bridge rows (`--with-auto` adds the proposals). |
| `convert <csv>` | Convert a geometry CSV to HEM input JSON. Source build only; see below. |
| `preflight <csv\|json>` | Future Homes Standard ingest and Part F preflight, without a simulation. Not a compliance result. Source build only, as `convert`. |
| `version` | Version and legal notices. |

The npm package runs `check`, `thermal-bridges` and `version`. It does not ship the
Community model WASM, so `convert` and `preflight` need the CLI built from source
([Run locally](https://github.com/vulcan-energy/vulcan-community#run-locally)). Given a CSV,
they first read the defaults file its `DefaultsPath` names, relative to the current directory, and
stop with "Defaults file not found" if it is missing; `--defaults <file>` overrides it.

`--profile epc` converts to HEM:EPC input instead of FHS input: a new build, or an existing
building (HEMIE) when the CSV's Metadata has `IsExistingBuilding,TRUE`. EPC `preflight` is the
conversion and the HEM:EPC schema check; the EPC wrapper itself is not run.

Every command takes `--json` for machine-readable output, for scripts and AI agents. Node.js
22.19 or later.

Geometry CSVs come from the Vulcan Community editor.

Licensed under AGPL-3.0-only with the Vulcan Origin Terms; see `LICENSE`, `NOTICE`,
`ATTRIBUTION.md`, `ADDITIONAL_TERMS.md` and `TRADEMARKS.md`. Third-party material bundled in
`dist/cli.js` is listed with its licences in `dist/THIRD_PARTY_NOTICES.md`. Source:
<https://github.com/vulcan-energy/vulcan-community>.
