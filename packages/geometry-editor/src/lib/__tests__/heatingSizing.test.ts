// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { sizeHeating, type DesignHeatLoss } from '../heatingSizing';

const zoneLoss = (designLossKw: number, htcWPerK = (designLossKw * 1000) / 22) => ({
  htcWPerK,
  fabricWPerK: htcWPerK,
  thermalBridgesWPerK: 0,
  ventilationWPerK: 0,
  designLossKw,
});

const loss = (zones: Record<string, number>, coldestHourC = -1): DesignHeatLoss => ({
  coldestHourC,
  setpointC: 21,
  weatherName: 'Bedford',
  zones: Object.fromEntries(Object.entries(zones).map(([k, v]) => [k, zoneLoss(v)])),
});

// One radiator, c chosen so output at 55 C flow is exactly 6 kW: c x (55 - 21)^1.3.
const C6 = 6 / 34 ** 1.3;
const radiator = (c = C6) => ({ wet_emitter_type: 'radiator', c, n: 1.3, frac_convective: 0.7 });

const wet = (over: Record<string, unknown> = {}) => ({
  type: 'WetDistribution',
  HeatSource: { name: 'hp' },
  Zone: 'zone 1',
  design_flow_temp: 55,
  temp_diff_emit_dsgn: 5,
  emitters: [radiator()],
  ecodesign_controller: { ecodesign_control_class: 1 },
  ...over,
});

const testRow = (letter: string, flow: number, capacity: number, temp: number) => ({
  test_letter: letter,
  design_flow_temp: flow,
  capacity,
  temp_test: temp,
  temp_outlet: flow,
  temp_source: temp,
  cop: 3,
});

const heatPump = (over: Record<string, unknown> = {}) => ({
  type: 'HeatPump',
  source_type: 'OutsideAir',
  sink_type: 'Water',
  modulating_control: true,
  min_modulation_rate_35: 0.4,
  min_modulation_rate_55: 0.5,
  backup_ctrl_type: 'TopUp',
  power_max_backup: 3,
  test_data_EN14825: [testRow('A', 35, 8, -7), testRow('A', 55, 6, -7), testRow('F', 35, 7, -10), testRow('F', 55, 5, -10)],
  ...over,
});

const boiler = { type: 'Boiler', rated_power: 24, modulation_load: 0.25 };

const model = (systems: Record<string, unknown>, sources: Record<string, unknown> = { hp: heatPump() }) => ({
  SpaceHeatSystem: systems,
  HeatSourceWet: sources,
});

describe('sizeHeating: heat sources', () => {
  it.each([
    // [design loss kW, expected verdict, maxKw, minKw]
    [5, 'ok', 6, 3],
    [7, 'too-small', 6, 3],
    [2, 'too-big', 6, 3],
  ] as const)('heat pump with %s kW loss is %s', (designLossKw, verdict, maxKw, minKw) => {
    const [hp] = sizeHeating(model({ s: wet() }), loss({ 'zone 1': designLossKw })).heatSources;
    expect(hp).toMatchObject({ status: 'ok', verdict, maxKw, minKw, flowTempC: 55, systems: ['s'] });
  });

  it('interpolates capacity and modulation between the 35 and 55 C rows', () => {
    const [hp] = sizeHeating(model({ s: wet({ design_flow_temp: 45 }) }), loss({ 'zone 1': 5 })).heatSources;
    expect(hp.maxKw).toBeCloseTo(7);
    expect(hp.minKw).toBeCloseTo(0.45 * 7);
  });

  it('reports shortfall, balance point and backup when too small', () => {
    const l = loss({ 'zone 1': 8.8 }); // HTC 400 W/K
    const [hp] = sizeHeating(model({ s: wet() }), l).heatSources;
    expect(hp.verdict).toBe('too-small');
    expect(hp.shortfallKw).toBeCloseTo(2.8);
    expect(hp.balancePointC).toBeCloseTo(21 - 6000 / 400);
    expect(hp.hasBackupHeater).toBe(true);
  });

  it.each([
    ['absent', { power_max_backup: undefined }],
    ['null', { power_max_backup: null }],
  ])('power_max_backup %s means no backup heater', (_label, over) => {
    const src = heatPump(over);
    const [hp] = sizeHeating(model({ s: wet() }, { hp: src }), loss({ 'zone 1': 8 })).heatSources;
    expect(hp.hasBackupHeater).toBe(false);
  });

  it('a backup boiler counts as a backup heater', () => {
    const src = { ...heatPump({ boiler: { rated_power: 10 } }), power_max_backup: undefined };
    const [hp] = sizeHeating(model({ s: wet() }, { hp: src }), loss({ 'zone 1': 8 })).heatSources;
    expect(hp.hasBackupHeater).toBe(true);
  });

  it('absent min modulation leaves minKw null and never says too big', () => {
    const src = heatPump({ min_modulation_rate_55: undefined });
    const [hp] = sizeHeating(model({ s: wet() }, { hp: src }), loss({ 'zone 1': 0.5 })).heatSources;
    expect(hp).toMatchObject({ status: 'ok', verdict: 'ok', minKw: null });
    expect(hp.notes.join(' ')).toMatch(/minimum modulation rate is not given/);
  });

  it('air sink uses min_modulation_rate_20 at the low end', () => {
    const src = heatPump({ sink_type: 'Air', min_modulation_rate_20: 0.2, min_modulation_rate_35: undefined });
    const [hp] = sizeHeating(model({ s: wet() }, { hp: src }), loss({ 'zone 1': 5 })).heatSources;
    expect(hp.minKw).toBeCloseTo(0.5 * 6);
  });

  it.each([
    [1, 'ok'],
    [7, 'too-small'],
  ] as const)('on/off heat pump with %s kW loss is %s, never too big', (designLossKw, verdict) => {
    const src = heatPump({ modulating_control: false });
    const [hp] = sizeHeating(model({ s: wet() }, { hp: src }), loss({ 'zone 1': designLossKw })).heatSources;
    expect(hp).toMatchObject({ minKw: null, maxKw: 6, verdict });
    expect(hp.notes.join(' ')).toMatch(/cycles by design/);
  });

  it.each([
    // [coldest C, rows, maxKw, testPointC, designBelowTestPointK]
    [-5, undefined, 6, -7, null],
    [-8, undefined, 5, -10, null],
    [-10, undefined, 5, -10, null],
    [-11, undefined, 5, -10, 1],
    [-30, undefined, 5, -10, 20],
    [-8, [testRow('A', 35, 8, -7), testRow('A', 55, 6, -7)], 6, -7, 1],
    [-8, [testRow('F', 35, 7, -10), testRow('F', 55, 5, -10)], 5, -10, null],
  ])('coldest hour %s C uses the coldest declared point, never no-data', (coldest, rows, maxKw, testPointC, below) => {
    const src = rows ? heatPump({ test_data_EN14825: rows }) : heatPump();
    const [hp] = sizeHeating(model({ s: wet() }, { hp: src }), loss({ 'zone 1': 4 }, coldest)).heatSources;
    expect(hp).toMatchObject({ status: 'ok', maxKw, testPointC, designBelowTestPointK: below });
    if (below !== null) expect(hp.notes).toContain(`Declared output at ${testPointC} C; design day is ${coldest} C.`);
  });

  it('no test point A or F has no data', () => {
    const src = heatPump({ test_data_EN14825: [testRow('B', 35, 8, 2), testRow('B', 55, 6, 2)] });
    const [hp] = sizeHeating(model({ s: wet() }, { hp: src }), loss({ 'zone 1': 4 })).heatSources;
    expect(hp).toMatchObject({ status: 'no-data', maxKw: null, reason: expect.stringMatching(/no EN 14825 test point A or F/) });
  });

  it.each(['Ground', 'WaterGround', 'WaterSurface', 'ExhaustAirMEV', 'ExhaustAirMVHR', 'ExhaustAirMixed', 'HeatNetwork'])(
    '%s heat pumps are unsupported',
    (source_type) => {
      const [hp] = sizeHeating(model({ s: wet() }, { hp: heatPump({ source_type }) }), loss({ 'zone 1': 4 })).heatSources;
      expect(hp).toMatchObject({ status: 'unsupported', maxKw: null, designLossKw: 4 });
      expect(hp.reason).toMatch(/^[A-Z][a-z ]+ heat pumps are not sized yet\.$/);
    },
  );

  it('a heat pump that charges a thermal store is unsupported, naming the store', () => {
    const store = { type: 'PrimaryThermalStore', HeatSource: { 'from ashp': { type: 'HeatSourceWet', name: 'hp' } } };
    const [hp, ts] = sizeHeating(
      model({ s: wet({ HeatSource: [{ name: 'thermal store' }] }) }, { hp: heatPump(), 'thermal store': store }),
      loss({ 'zone 1': 4 }),
    ).heatSources;
    expect(hp).toMatchObject({ status: 'unsupported', reason: 'It only feeds "thermal store", which is not sized yet.' });
    expect(ts).toMatchObject({ status: 'unsupported', systems: ['s'] });
  });

  it.each([
    [30, 8],
    [65, 6],
  ])('flow %s C outside the tested range uses the nearest row with a note', (flow, maxKw) => {
    const [hp] = sizeHeating(model({ s: wet({ design_flow_temp: flow }) }), loss({ 'zone 1': 4 })).heatSources;
    expect(hp.maxKw).toBe(maxKw);
    expect(hp.notes.join(' ')).toMatch(/outside the tested range/);
  });

  it('boiler range is modulation_load x rated_power to rated_power', () => {
    const [b] = sizeHeating(model({ s: wet({ HeatSource: { name: 'b' } }) }, { b: boiler }), loss({ 'zone 1': 5 }))
      .heatSources;
    expect(b).toMatchObject({ kind: 'Boiler', status: 'ok', minKw: 6, maxKw: 24, verdict: 'too-big', hasBackupHeater: null });
  });

  it.each(['HeatBattery', 'HIU'])('%s is unsupported', (type) => {
    const [h] = sizeHeating(model({ s: wet() }, { hp: { type } }), loss({ 'zone 1': 5 })).heatSources;
    expect(h).toMatchObject({ status: 'unsupported', designLossKw: 5, verdict: null });
  });

  it('sums the zones a heat source serves and counts a shared zone once', () => {
    const result = sizeHeating(
      model({
        a: wet({ Zone: 'z1' }),
        b: wet({ Zone: 'z2', design_flow_temp: 45 }),
        c: wet({ Zone: 'z2', design_flow_temp: 45 }),
        d: wet({ Zone: 'z3', HeatSource: { name: 'b' } }),
      }, { hp: heatPump(), b: boiler }),
      loss({ z1: 3, z2: 4, z3: 2 }),
    );
    const [hp, b] = result.heatSources;
    expect(hp).toMatchObject({ systems: ['a', 'b', 'c'], designLossKw: 7, flowTempC: 55, verdict: 'too-small' });
    expect(hp.notes.join(' ')).toMatch(/highest \(55 C\)/);
    expect(b).toMatchObject({ systems: ['d'], designLossKw: 2 });
    // b and c share z2: neither is judged against the whole zone's loss.
    expect(result.systems.map((s) => [s.name, s.status, s.verdict])).toEqual([
      ['a', 'ok', 'ok'], ['b', 'unsupported', null], ['c', 'unsupported', null], ['d', 'ok', 'ok'],
    ]);
    expect(result.systems[1]).toMatchObject({ reason: 'More than one heating system serves this zone.', curve: [], minFlowC: null, designLossKw: 4 });
  });

  it('a zone split between two heat sources: each source is unsupported, as are its systems', () => {
    const result = sizeHeating(
      model({ r: wet({ Zone: 'z' }), s: wet({ Zone: 'z', HeatSource: { name: 'b' } }) }, { hp: heatPump(), b: boiler }),
      loss({ z: 5 }),
    );
    for (const entry of [...result.systems, ...result.heatSources]) {
      expect(entry).toMatchObject({ status: 'unsupported', reason: 'More than one heating system serves this zone.', verdict: null });
    }
  });

  it('a direct electric backup in the zone (as the FHS demo) leaves the radiators sized', () => {
    const m = {
      ...model({ radiators: wet({ Zone: 'whole dwelling' }), backup: { type: 'InstantElecHeater', rated_power: 3 } }),
      Zone: { 'whole dwelling': { SpaceHeatSystem: ['radiators', 'backup'] } },
    };
    const result = sizeHeating(m, loss({ 'whole dwelling': 5 }));
    expect(result.systems.map((s) => s.status)).toEqual(['ok', 'unsupported']);
    expect(result.heatSources[0]).toMatchObject({ status: 'ok', verdict: 'ok' });
  });

  it('a heat source no system uses has no data', () => {
    const [, b] = sizeHeating(model({ s: wet() }, { hp: heatPump(), b: boiler }), loss({ 'zone 1': 5 })).heatSources;
    expect(b).toMatchObject({ status: 'no-data', systems: [], designLossKw: null });
  });

  it('a heat source serving a system with an unknown zone loss is an error', () => {
    const [hp] = sizeHeating(model({ s: wet({ Zone: 'ghost' }) }), loss({ 'zone 1': 5 })).heatSources;
    expect(hp).toMatchObject({ status: 'error', designLossKw: null });
  });

  it('a heat source serving a warm air system is unsupported', () => {
    const [hp] = sizeHeating(
      model({ s: { type: 'WarmAir', HeatSource: { name: 'hp' }, Zone: 'zone 1' } }),
      loss({ 'zone 1': 5 }),
    ).heatSources;
    expect(hp.status).toBe('unsupported');
  });

  it.each([0, -1])('design loss %s kW: heat source and system have no data', (designLossKw) => {
    const result = sizeHeating(model({ s: wet() }), loss({ 'zone 1': designLossKw }));
    expect(result.heatSources[0]).toMatchObject({ status: 'no-data', verdict: null, designLossKw });
    expect(result.systems[0]).toMatchObject({ status: 'no-data', verdict: null, minFlowC: null, designLossKw });
    expect(result.systems[0].reason).toMatch(/zero or negative/);
  });
});

describe('sizeHeating: emitters', () => {
  it('radiator output uses flow minus set-point and finds the minimum flow', () => {
    const [s] = sizeHeating(model({ s: wet() }), loss({ 'zone 1': 3 })).systems;
    expect(s).toMatchObject({ status: 'ok', verdict: 'ok', flowTempAtDesignC: 55 });
    expect(s.outputAtDesignKw).toBeCloseTo(6);
    expect(s.curve).toHaveLength(41);
    const expected = Math.ceil((21 + 34 * 0.5 ** (1 / 1.3)) * 10) / 10;
    expect(s.minFlowC).toBe(expected);
  });

  it('sums several radiators, c_per_m x length included', () => {
    const emitters = [radiator(), { wet_emitter_type: 'radiator', c_per_m: C6 / 2, length: 2, n: 1.3 }];
    const [s] = sizeHeating(model({ s: wet({ emitters }) }), loss({ 'zone 1': 3 })).systems;
    expect(s.outputAtDesignKw).toBeCloseTo(12);
  });

  it('too small when output is below loss, with no minimum flow up to 70 C', () => {
    const [s] = sizeHeating(model({ s: wet() }), loss({ 'zone 1': 50 })).systems;
    expect(s).toMatchObject({ verdict: 'too-small', minFlowC: null });
  });

  it('design flow above 70 C: the curve reaches it and the minimum flow is found above 70 C', () => {
    // 12 kW needs 21 + 34 x 2^(1/1.3) = 78.9 C flow.
    const [s] = sizeHeating(model({ s: wet({ design_flow_temp: 80 }) }), loss({ 'zone 1': 12 })).systems;
    expect(s.verdict).toBe('ok');
    expect(s.curve.at(-1)!.flowC).toBe(80);
    expect(s.minFlowC).toBe(Math.ceil((21 + 34 * 2 ** (1 / 1.3)) * 10) / 10);
    expect(s.flowTempAtDesignC! >= s.minFlowC!).toBe(true);
  });

  it('fractional design flow: the minimum flow is exact to 0.1 C and agrees with the verdict', () => {
    const fiveAt533 = C6 * (53.3 - 21) ** 1.3;
    const [s] = sizeHeating(model({ s: wet({ design_flow_temp: 53.3 }) }), loss({ 'zone 1': fiveAt533 })).systems;
    expect(s).toMatchObject({ verdict: 'ok', minFlowC: 53.3, flowTempAtDesignC: 53.3 });
    const [short] = sizeHeating(model({ s: wet({ design_flow_temp: 53.3 }) }), loss({ 'zone 1': fiveAt533 + 0.001 })).systems;
    expect(short).toMatchObject({ verdict: 'too-small', minFlowC: 53.4 });
  });

  it.each([30, 41.7, 53.25, 55, 68.9, 80, 95])('verdict is ok exactly when the design flow (%s C) reaches the minimum flow', (flow) => {
    for (const designLossKw of [1, 2.5, 4, 6, 7.3, 9, 14, 30]) {
      const [s] = sizeHeating(model({ s: wet({ design_flow_temp: flow }) }), loss({ 'zone 1': designLossKw })).systems;
      expect(s.verdict === 'ok').toBe(s.minFlowC !== null && s.flowTempAtDesignC! >= s.minFlowC);
    }
  });

  it('no flow up to 100 C covers the loss: no minimum flow', () => {
    const [s] = sizeHeating(model({ s: wet({ design_flow_temp: 55 }) }), loss({ 'zone 1': 25 })).systems;
    expect(s).toMatchObject({ verdict: 'too-small', minFlowC: null });
  });

  it('design flow at or below set-point gives zero output', () => {
    const [s] = sizeHeating(model({ s: wet({ design_flow_temp: 20 }) }), loss({ 'zone 1': 3 })).systems;
    expect(s).toMatchObject({ outputAtDesignKw: 0, verdict: 'too-small' });
  });

  it.each([
    // [coldest C, flow at design]: min_outdoor -5, max_outdoor 15, min_flow 35, design 55
    [20, 35],
    [-8, 55],
    [5, 45],
  ])('weather compensation at %s C runs %s C flow', (coldest, flow) => {
    const ctrl = { ecodesign_control_class: 2, min_outdoor_temp: -5, max_outdoor_temp: 15, min_flow_temp: 35 };
    const [s] = sizeHeating(model({ s: wet({ ecodesign_controller: ctrl }) }), loss({ 'zone 1': 3 }, coldest)).systems;
    expect(s.flowTempAtDesignC).toBeCloseTo(flow);
  });

  it('weather compensation without its limits has no data', () => {
    const [s] = sizeHeating(
      model({ s: wet({ ecodesign_controller: { ecodesign_control_class: 3 } }) }),
      loss({ 'zone 1': 3 }),
    ).systems;
    expect(s.status).toBe('no-data');
  });

  it.each([
    ['ufh', [{ wet_emitter_type: 'ufh' }]],
    ['fancoil', [{ wet_emitter_type: 'fancoil' }]],
    ['mixed', [radiator(), { wet_emitter_type: 'ufh' }]],
  ])('%s emitters are unsupported', (_label, emitters) => {
    const [s] = sizeHeating(model({ s: wet({ emitters }) }), loss({ 'zone 1': 3 })).systems;
    expect(s).toMatchObject({ status: 'unsupported', outputAtDesignKw: null, curve: [], designLossKw: 3 });
    expect(s.reason).toMatch(_label === 'fancoil' ? /^Fan coils are not sized yet\.$/ : /^Underfloor heating is not sized yet\.$/);
  });

  it.each([
    ['no Zone', wet({ Zone: undefined }), 'error', /no Zone/],
    ['zone missing from design heat loss', wet({ Zone: 'loft' }), 'error', /Zone "loft" has no design heat loss/],
    ['no emitters', wet({ emitters: [] }), 'no-data', /no emitters/],
    ['electric storage', { type: 'ElecStorageHeater', Zone: 'zone 1' }, 'unsupported', /^Electric storage heaters are not sized yet\.$/],
    ['unknown type', { type: 'Mystery', Zone: 'zone 1' }, 'unsupported', /^This system type is not sized yet\.$/],
  ])('system with %s', (_label, system, status, reason) => {
    const [s] = sizeHeating(model({ s: system }), loss({ 'zone 1': 3 })).systems;
    expect(s.status).toBe(status);
    expect(s.reason).toMatch(reason);
  });

  it('emitters with no heat source are still sized and noted', () => {
    const result = sizeHeating(model({ s: wet({ HeatSource: { name: 'missing' } }) }, {}), loss({ 'zone 1': 3 }));
    expect(result.systems[0]).toMatchObject({ status: 'ok', verdict: 'ok' });
    expect(result.systems[0].notes).toEqual(['Heat source "missing" is not in HeatSourceWet.']);
    expect(result.heatSources).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it('names shared across zones, systems and heat sources stay separate', () => {
    const result = sizeHeating(
      model({ x: wet({ Zone: 'x', HeatSource: { name: 'x' } }) }, { x: heatPump() }),
      loss({ x: 5 }),
    );
    expect(result.systems[0]).toMatchObject({ name: 'x', zone: 'x', heatSources: ['x'], designLossKw: 5 });
    expect(result.heatSources[0]).toMatchObject({ name: 'x', systems: ['x'], verdict: 'ok' });
  });
});

describe('sizeHeating: model shapes', () => {
  it('HEM:EPC HeatSource lists: each named heat source serves the system, with a note when shared', () => {
    const system = wet({ HeatSource: [{ name: 'hp' }, { name: 'b' }] });
    const result = sizeHeating(model({ s: system }, { hp: heatPump(), b: boiler }), loss({ 'zone 1': 5 }));
    expect(result.systems[0].heatSources).toEqual(['hp', 'b']);
    expect(result.heatSources.map((h) => h.systems)).toEqual([['s'], ['s']]);
    expect(result.heatSources[0].notes.join(' ')).toMatch(/several heat sources/);
  });

  it.each([
    // HEM:EPC curve 0.00625 T^2 - 1.125 T + 40, clamped to 30..55
    [-1, 0.00625 + 1.125 + 40],
    [-20, 55],
    [15, 30],
  ])('HEM:EPC weather compensation curve at %s C', (coldest, flow) => {
    const ctrl = { ecodesign_control_class: 2, min_flow_temp: 30, weather_comp_a: 0.00625, weather_comp_b: -1.125, weather_comp_c: 40 };
    const [s] = sizeHeating(model({ s: wet({ ecodesign_controller: ctrl }) }), loss({ 'zone 1': 3 }, coldest)).systems;
    expect(s.flowTempAtDesignC).toBeCloseTo(flow);
  });

  // HEM:EPC emitters.py temp_flow_return: load compensation runs only where load_comp_a is set, in
  // class I, IV, V or VIII, or in class II, III, VI or VII on a weather_comp curve.
  const loadComp = { load_comp_a: 0, load_comp_b: 5, load_comp_c: 40 };
  const curve = { min_flow_temp: 30, weather_comp_a: 0.00625, weather_comp_b: -1.125, weather_comp_c: 40 };
  it.each([
    ['class V', { ecodesign_control_class: 5, min_flow_temp: 30, ...loadComp }],
    ['class I', { ecodesign_control_class: 1, min_flow_temp: 30, ...loadComp }],
    ['class II on a weather_comp curve', { ecodesign_control_class: 2, ...curve, ...loadComp }],
  ])('load compensation the engine applies (%s) has no data', (_label, ctrl) => {
    const [s] = sizeHeating(model({ s: wet({ ecodesign_controller: ctrl }) }), loss({ 'zone 1': 3 })).systems;
    expect(s).toMatchObject({ status: 'no-data', reason: expect.stringMatching(/Load compensation/) });
  });

  it.each([
    ['class II on outdoor limits', { ecodesign_control_class: 2, min_outdoor_temp: -5, max_outdoor_temp: 15, min_flow_temp: 35, ...loadComp }, 55],
    ['class I without load_comp_a', { ecodesign_control_class: 1, load_comp_b: 5, load_comp_c: 40 }, 55],
  ])('load compensation fields the engine ignores (%s) are sized', (_label, ctrl, flow) => {
    const [s] = sizeHeating(model({ s: wet({ ecodesign_controller: ctrl }) }), loss({ 'zone 1': 3 }, -8)).systems;
    expect(s).toMatchObject({ status: 'ok', flowTempAtDesignC: flow });
  });

  it('a system without its own Zone takes the zone that lists it', () => {
    const m = { ...model({ heater: { type: 'InstantElecHeater', rated_power: 3 } }), Zone: { z: { SpaceHeatSystem: ['heater'] } } };
    const [s] = sizeHeating(m, loss({ z: 4 })).systems;
    expect(s).toMatchObject({ zone: 'z', status: 'unsupported', designLossKw: 4 });
  });
});

describe('sizeHeating: model', () => {
  it('a model with no SpaceHeatSystem or HeatSourceWet gives an empty result', () => {
    expect(sizeHeating({}, loss({}))).toEqual({ coldestHourC: -1, setpointC: 21, weatherName: 'Bedford', zoneCount: 0, systems: [], heatSources: [], notes: [] });
  });

  it('gives the weather file and the number of zones, so a one-zone loss reads as the house\'s', () => {
    expect(sizeHeating(model({ s: wet() }), loss({ 'zone 1': 3 }))).toMatchObject({ weatherName: 'Bedford', zoneCount: 1 });
    expect(sizeHeating(model({ s: wet() }), loss({ 'zone 1': 3, 'zone 2': 2 })).zoneCount).toBe(2);
  });

  it('notes that hot water is not included when a heat source is sized', () => {
    expect(sizeHeating(model({ s: wet() }), loss({ 'zone 1': 3 })).notes).toEqual([
      'Space heating only. Hot water is not included.',
    ]);
  });
});
