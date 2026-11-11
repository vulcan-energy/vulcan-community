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
| `convert <csv>` | Convert a geometry CSV to HEM input JSON. |
| `preflight <csv\|json>` | Future Homes Standard ingest and Part F preflight, without a simulation. Not a compliance result. |
| `version` | Version and legal notices. |

Every command takes `--json` for machine-readable output, for scripts and AI agents. Node.js
22.19 or later.

Geometry CSVs come from the Vulcan Community editor or the Vulcan app. Vulcan's MCP helper
(`@vulcan-energy/mcp-helper`) and Analyst use this CLI for their geometry tools.

Licensed under AGPL-3.0-only with the Vulcan Origin Terms; see `LICENSE`, `NOTICE`,
`ATTRIBUTION.md`, `ADDITIONAL_TERMS.md` and `TRADEMARKS.md`. Source:
<https://github.com/vulcan-energy/vulcan-community>.
