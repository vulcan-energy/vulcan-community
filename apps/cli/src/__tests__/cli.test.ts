// @vitest-environment node
// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkGeometryCsv } from '../check';
import { convertCsv } from '../convert';
import { NO_DESIGN_HEAT_LOSS_REASON, SIZING_UNAVAILABLE_EXIT_CODE, sizeModel, sizingExitCode, sizingText } from '../sizing';
import { autoThermalBridges, validateThermalBridges } from '../thermalBridges';
import { versionInfo, versionText } from '../version';

const fixture = fileURLToPath(new URL(
  '../../../../packages/geometry-editor/src/geometry/__fixtures__/example_semi_detached.csv',
  import.meta.url,
));

describe('vulcan-community commands', () => {
  // Downstream tooling parses these keys from --json output.
  it('check returns the JSON contract', () => {
    const result = checkGeometryCsv(fixture);
    expect(result.counts.elements).toBeGreaterThan(0);
    expect(Object.keys(result.counts)).toEqual(expect.arrayContaining([
      'criticalIssues', 'warnings', 'missingElements',
    ]));
    expect(Array.isArray(result.criticalIssues)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.missingElements)).toBe(true);
  });

  // A CSV with no TargetBundleId is the a7 target, an FHS model; only FALSE on an unpinned CSV selects core.
  it('check reads the model type from the target', () => {
    const csv = join(mkdtempSync(join(tmpdir(), 'vulcan-cli-')), 'no-row.csv');
    writeFileSync(csv, readFileSync(fixture, 'utf8').replace(/^ComplianceValidationEnabled,.*\n/m, ''));
    expect(checkGeometryCsv(csv).complianceValidationEnabled).toBe(true);
    writeFileSync(csv, readFileSync(fixture, 'utf8').replace(/^ComplianceValidationEnabled,TRUE/m, 'ComplianceValidationEnabled,FALSE'));
    expect(checkGeometryCsv(csv).complianceValidationEnabled).toBe(false);
    // A pinned CSV is its target's model type whatever the row says.
    writeFileSync(csv, readFileSync(fixture, 'utf8')
      .replace(/^ComplianceValidationEnabled,TRUE/m, 'ComplianceValidationEnabled,FALSE')
      .replace(/^Metadata,.*\n/m, (row) => `${row}TargetBundleId,rust-fhs-a7-62d3df70-c5ba2673-v1,\n`));
    expect(checkGeometryCsv(csv).complianceValidationEnabled).toBe(true);
  });

  it('check names Context Shading parts by their directions less the north offset', () => {
    // An 8 x 6 house with 0.3 m walls; an L block whose east arm stands against the east wall.
    const csv = join(mkdtempSync(join(tmpdir(), 'vulcan-cli-')), 'shading.csv');
    const write = (offset: number) => writeFileSync(csv, `Metadata,,
GlobalOrientationOffset,${offset},
VulcanCsvVersion,3

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone 1,Zone,120,48,2.5,FALSE

Ground Elements,,
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
Floor,Zone 1,BuildingElementGround,48,0,0,28,Slab_no_edge_insulation,,0.3,,"0,0,0|8,0,0|8,6,0|0,6,0",

Context Shading,,
Name,Type,shading_type,start_angle,end_angle,distance,height,parent_element,coords,extra_json
L,ContextShading,obstacle,0,0,0,6,DefaultCentre,"8,0,0|10,0,0|10,8,0|-2,8,0|-2,7,0|8,7,0",
`);
    const touching = () => {
      const messages = checkGeometryCsv(csv).criticalIssues.map((row: { message: string }) => row.message)
        .filter((message: string) => message.includes('touches or overlaps'));
      expect(messages).toHaveLength(1);
      return messages[0]!.match(/Direction (\d+)°–(\d+)°/)!.slice(1).map(Number);
    };
    write(0);
    const [start, end] = touching();
    write(10);
    expect(touching()).toEqual([start - 10, end - 10]);
  });

  it('convert refuses a CSV pinned to a HEM version instead of converting it with the bundled schema', async () => {
    const csv = join(mkdtempSync(join(tmpdir(), 'vulcan-cli-')), 'pinned.csv');
    writeFileSync(csv, 'Metadata,,\nVulcanCsvVersion,3,\n#TargetBundleId,python-fhs-a9-918addad-b9b90138-v1,\n');
    await expect(convertCsv(csv, {})).rejects.toThrow("CSV pins TargetBundleId 'python-fhs-a9-918addad-b9b90138-v1'");
  });

  it('thermal-bridges proposes and validates', () => {
    expect(autoThermalBridges(fixture).proposals.length).toBeGreaterThan(0);
    const validation = validateThermalBridges(fixture, true);
    expect(typeof validation.issueCount).toBe('number');
    expect(validation.thermalBridgeLinearRows).toBeGreaterThan(0);
    expect(Array.isArray(validation.issues)).toBe(true);
  });

  it('version carries the ADDITIONAL_TERMS section 1 notice', () => {
    const text = versionText();
    for (const required of [
      'Vulcan Community',
      'Home Energy Foundry Limited',
      'https://usevulcan.app/open-source',
      'Copyright © 2026 Home Energy Foundry Limited and contributors.',
      'AGPL-3.0-only',
      'Corresponding Source: unofficial build, revision unknown.',
      'not necessarily affiliated with or endorsed by Home Energy Foundry Limited',
    ]) {
      expect(text).toContain(required);
    }
    expect(versionInfo().correspondingSource).toBeNull();
  });
});

// A model sized by heatingSizing.test.ts's rules: one radiator system giving 6 kW at 55 C flow, and a
// heat pump of 3 to 6 kW at 55 C, as a preprocessed core model. Variable flow inside its range: the
// mean water temperature is 55 - 5 / 2 = 52.5 C.
const C6 = 6 / 31.5 ** 1.3;
const testRow = (letter: string, flow: number, capacity: number, temp: number) => ({
  test_letter: letter, design_flow_temp: flow, capacity, temp_test: temp, temp_outlet: flow, temp_source: temp, cop: 3,
});
const sizingModel = {
  Zone: { 'zone 1': {} },
  SpaceHeatSystem: { radiators: {
    type: 'WetDistribution', HeatSource: { name: 'hp' }, Zone: 'zone 1', design_flow_temp: 55, temp_diff_emit_dsgn: 5,
    variable_flow: true, min_flow_rate: 1, max_flow_rate: 100,
    emitters: [{ wet_emitter_type: 'radiator', c: C6, n: 1.3, frac_convective: 0.7 }], ecodesign_controller: { ecodesign_control_class: 1 },
  } },
  HeatSourceWet: { hp: {
    type: 'HeatPump', source_type: 'OutsideAir', sink_type: 'Water', modulating_control: true,
    min_modulation_rate_35: 0.4, min_modulation_rate_55: 0.5, backup_ctrl_type: 'TopUp', power_max_backup: 3,
    test_data_EN14825: [testRow('A', 35, 8, -7), testRow('A', 55, 6, -7), testRow('F', 35, 7, -10), testRow('F', 55, 5, -10)],
  } },
};

const designLoss = (kw: number) => ({
  coldestHourC: -1, setpointC: 21, weatherName: 'Bedford',
  zones: { 'zone 1': { htcWPerK: (kw * 1000) / 22, fabricWPerK: (kw * 1000) / 22, thermalBridgesWPerK: 0, ventilationWPerK: 0, designLossKw: kw } },
});

const writeJson = (name: string, value: unknown) => {
  const path = join(mkdtempSync(join(tmpdir(), 'vulcan-sizing-')), name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  return path;
};

describe('vulcan-community sizing', () => {
  it.each([
    // [design loss kW, heat source pill, its sentence, system pill, suggested flow]
    // 5 kW: mean water 21 + 31.5 x (5/6)^(1/1.3) = 48.4 C, flow 50.9 C: 51 C, where the heat pump (6.4 kW down to 3.1 kW) still fits.
    [5, 'Big enough', null, 'Big enough at 55 °C', 51],
    [7, 'Too small', 'the backup heater covers the gap.', 'Too small at 55 °C', null],
    // 2 kW: the radiators cover it from 38 C, but the heat pump is too big there: no suggestion.
    [2, 'Too big', 'It will switch on and off all year.', 'Big enough at 55 °C', null],
  ] as const)('%s kW: heat source %s, exit 0', (lossKw, sourcePill, sentence, systemPill, suggested) => {
    const result = sizeModel(writeJson('model.json', sizingModel), { designHeatLoss: writeJson('dhl.json', designLoss(lossKw)) });
    expect(sizingExitCode(result)).toBe(0);
    // Downstream tooling parses these keys from --json output.
    expect(Object.keys(result)).toEqual(['status', 'coldestHourC', 'setpointC', 'weatherName', 'zoneCount', 'systems', 'heatSources', 'notes']);
    expect(result).toMatchObject({ status: 'sized', coldestHourC: -1, setpointC: 21 });
    const text = sizingText(result).join('\n').replace(/\u00a0/g, ' ');
    expect(text).toContain('Coldest hour in the Bedford weather file: −1 °C outside, 21 °C inside.');
    expect(text).toContain(`Heat source "hp": ${sourcePill}\n`);
    if (sentence) expect(text).toContain(sentence);
    expect(text).toContain(`House needs ${lossKw.toFixed(1)} kW. Heat pump gives 6.0 kW on the design day and turns down to 3.0 kW.`);
    expect(text).toContain(`System "radiators" (zone 1): ${systemPill}`);
    expect(text).toContain(`Radiators give 6.0 kW at 55 °C flow. The house needs ${lossKw.toFixed(1)} kW.`);
    // One sentence: the suggestion replaces where the radiators start to give enough heat.
    if (suggested === null) {
      expect(text).not.toContain('You could lower');
      expect(text).toMatch(/Radiators give enough heat (from|at any flow temperature from)/);
    } else {
      expect(text).toContain(`  You could lower the design flow temperature to ${suggested} °C. The radiators still give enough heat, and the heat pump runs more efficiently.`);
      expect(text).not.toContain('Radiators give enough heat from');
    }
    expect(text).toContain('Space heating only. Hot water is not included.');
  });

  it('prints Not sized lines for unsized entries', () => {
    const model = { ...sizingModel, HeatSourceWet: { ...sizingModel.HeatSourceWet, store: { type: 'HeatBattery' } } };
    const result = sizeModel(writeJson('model.json', model), { designHeatLoss: writeJson('dhl.json', designLoss(5)) });
    expect(sizingText(result).join('\n').replace(/\u00a0/g, ' ')).toContain('Heat source "store": Not sized: No space heating system uses this heat source.');
  });

  it.each([
    ['no --design-heat-loss', () => undefined, NO_DESIGN_HEAT_LOSS_REASON],
    ['a missing file', () => '/nonexistent/dhl.json', 'Design heat loss file not found: /nonexistent/dhl.json.'],
    ['a file that is not JSON', () => writeJson('dhl.json', 'nope'), 'is not JSON.'],
    ['JSON that is not a design heat loss', () => writeJson('dhl.json', { zones: {} }), 'is not a design heat loss: it needs coldestHourC, setpointC, weatherName and zones.'],
  ])('unavailable with %s: exit 3', (_name, dhl, reason) => {
    const result = sizeModel(writeJson('model.json', sizingModel), { designHeatLoss: dhl() });
    expect(result.status).toBe('unavailable');
    expect(result.status === 'unavailable' && result.reason).toContain(reason);
    expect(result.status === 'unavailable' && result.reason).toContain('scripts/hem-targets/design-heat-loss.mjs');
    expect(sizingExitCode(result)).toBe(SIZING_UNAVAILABLE_EXIT_CODE);
    expect(sizingText(result)[0]).toMatch(/^Not sized: /);
  });

  it('fails (exit 1) on a zone without a finite designLossKw, naming the zone and field', () => {
    const dhl = designLoss(5) as { zones: Record<string, Record<string, unknown>> };
    delete dhl.zones['zone 1'].designLossKw;
    expect(() => sizeModel(writeJson('model.json', sizingModel), { designHeatLoss: writeJson('dhl.json', dhl) }))
      .toThrow(/zone "zone 1" has no finite designLossKw/);
    const nonFinite = designLoss(5) as { zones: Record<string, unknown> };
    nonFinite.zones['zone 1'] = 'warm';
    expect(() => sizeModel(writeJson('model.json', sizingModel), { designHeatLoss: writeJson('dhl.json', nonFinite) }))
      .toThrow(/zone "zone 1" is not an object/);
  });

  it('fails on a model that is not JSON', () => {
    expect(() => sizeModel(writeJson('model.json', 'nope'), { designHeatLoss: writeJson('dhl.json', designLoss(5)) })).toThrow();
  });
});
