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
| `sizing <model.json> --design-heat-loss <file>` | Size the heat sources and space heating systems of a preprocessed HEM core model against its static design heat loss. |
| `version` | Version and legal notices. |

The npm package runs `check`, `thermal-bridges`, `sizing` and `version`. It does not ship the
Community model WASM, so `convert` and `preflight` need the CLI built from source
([Run locally](https://github.com/vulcan-energy/vulcan-community#run-locally)). Given a CSV,
they first read the defaults file its `DefaultsPath` names, relative to the current directory, and
stop with "Defaults file not found" if it is missing; `--defaults <file>` overrides it.

`--profile epc` converts to HEM:EPC input instead of FHS input: a new build, or an existing
building (HEMIE) when the CSV's Metadata has `IsExistingBuilding,TRUE`. EPC `preflight` is the
conversion and the HEM:EPC schema check; the EPC wrapper itself is not run.

`sizing` runs no HEM target. It reads a preprocessed HEM core model and its design heat loss
(`{ coldestHourC, setpointC, weatherName, zones }`), the output of a Rust HEM:FHS target's `design_heat_loss`
export. The Vulcan repository's `scripts/hem-targets/design-heat-loss.mjs` writes both files;
released targets do not have that export yet. Exit codes: 0 when sized (a "Too small" verdict is a
result); 3 when `--design-heat-loss` is not given, or its file is missing, cannot be read as JSON, or
lacks `coldestHourC`, `setpointC`, `weatherName` or a `zones` object; 1 when a zone is not an object
or has a missing or non-finite number, and on any other failure (a usage error, or a model file that
is missing or not JSON). `--json`
gives `status` (`sized` or `unavailable`), then `reason` when unavailable, or `coldestHourC`,
`setpointC`, `weatherName`, `zoneCount`, `systems`, `heatSources` and `notes` when sized.

`sizing` answers three questions for the coldest hour of the weather file: is each heat pump or
boiler big enough, is it too big, and what is the lowest flow temperature at which the radiators
still give enough heat. It does not judge efficiency over the year (that is the full run), single
rooms, or hot water.

Radiator output follows the HEM engine's own formula. Each radiator gives c × (T_mean − T_room)^n,
where T_mean is the mean water temperature, (flow + return) / 2, and T_room is the set-point. With
variable flow, the return is the flow minus `temp_diff_emit_dsgn` while the flow rate stays inside
`min_flow_rate` to `max_flow_rate`; at a limit, or with a fixed `design_flow_rate`, the return
comes from the heat the water carries at that rate. The output line can bend where the pump
reaches its maximum flow rate.

The report suggests a lower design flow temperature, the lowest whole degree at which the
radiators still give enough heat, when all of these are true: every heat source is a heat pump;
the radiators are big enough; each heat pump is still big enough, and not too big, at the lower
flow; the suggestion is at least 1 °C lower; and the design day runs the `design_flow_temp`
setting (not a milder, weather-compensated design day). The suggestion then replaces the line
that says where the radiators start to give enough heat.

The report reads like the editor's sizing block. For the HEM:FHS demo model (a heat pump with a
3 kW backup heater, feeding radiators, and a direct electric heater in the same zone), preprocessed on a
Rust a9 build with the export:

```
Heating sizing
Coldest hour in the Bedford weather file: −6.5 °C outside, 21 °C inside.

Heat source "hp": Too small
  Below −6 °C outside, the backup heater covers the gap.
  House needs 9.0 kW. Heat pump gives 8.8 kW on the design day and turns down to 3.5 kW.

System "radiators" (whole dwelling): Big enough at 55 °C
  Radiators give enough heat from 38.9 °C flow.
  Radiators give 21.3 kW at 55 °C flow. The house needs 9.0 kW.

System "backup" (whole dwelling): Not sized: Direct electric heaters are not sized yet.

Space heating only. Hot water is not included.
```

There is no suggestion here: at 39 °C the heat pump gives 8.5 kW, still below 9.0 kW. With a heat
pump 1.5 times as big, the system lines read:

```
System "radiators" (whole dwelling): Big enough at 55 °C
  You could lower the design flow temperature to 39 °C. The radiators still give enough heat, and the heat pump runs more efficiently.
  Radiators give 21.3 kW at 55 °C flow. The house needs 9.0 kW.
```

Every command takes `--json` for machine-readable output, for scripts and AI agents. Node.js
22.19 or later.

Geometry CSVs come from the Vulcan Community editor.

Licensed under AGPL-3.0-only with the Vulcan Origin Terms; see `LICENSE`, `NOTICE`,
`ATTRIBUTION.md`, `ADDITIONAL_TERMS.md` and `TRADEMARKS.md`. Third-party material bundled in
`dist/cli.js` is listed with its licences in `dist/THIRD_PARTY_NOTICES.md`. Source:
<https://github.com/vulcan-energy/vulcan-community>.
