// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { unavailableGeometrySchemaPort } from '../../../../../geometry-editor-host/src/schemaPort';
import type { HeatingSizing, HeatSourceSizing, SystemSizing } from '../../../lib/heatingSizing';
import type { Element } from '../../types';
import { heatingSizingWarnings, heatingSizingWarningsFor, heatSourceSizingsFor, systemSizingFor, validateElementCore } from '../validateElement';

const system = (id: string, name: string, subcategory: string, extra_json?: Record<string, unknown>) =>
  ({ id, name, type: 'System', subcategory, extra_json }) as unknown as Element;
const emitter = (id: string, name: string, space_heat_system?: string) =>
  ({ id, name, type: 'WetEmitter', subcategory: 'radiator', space_heat_system }) as unknown as Element;

const sys = (over: Partial<SystemSizing> = {}): SystemSizing => ({
  name: 'rads', kind: 'WetDistribution', zone: 'zone', heatSources: ['hp'], status: 'ok', reason: null,
  designLossKw: 5.6, designFlowTempC: 45, flowTempAtDesignC: 45, outputAtDesignKw: 4.64, curve: [], minFlowC: 49, verdict: 'too-small', suggestedFlowC: null, notes: [],
  ...over,
});
const src = (over: Partial<HeatSourceSizing> = {}): HeatSourceSizing => ({
  name: 'hp', kind: 'HeatPump', systems: ['rads'], status: 'ok', reason: null, designLossKw: 9.12, flowTempC: 45,
  minKw: 2, maxKw: 8.8, verdict: 'too-small', shortfallKw: 0.32, balancePointC: -2.08, hasBackupHeater: false,
  testPointC: -7, designBelowTestPointK: null, notes: [],
  ...over,
});
const ready = (result: Partial<HeatingSizing>) => ({
  status: 'ready' as const,
  result: { coldestHourC: -6.5, setpointC: 21, weatherName: 'Bedford', zoneCount: 1, systems: [], heatSources: [], notes: [], ...result },
});

const hp = system('e-hp', 'hp', 'HeatSourceWet');
const rads = system('e-rads', 'rads', 'SpaceHeatSystem');
const elements = [hp, rads, emitter('e-r1', 'Rad 1', 'rads'), emitter('e-r2', 'Rad 2', 'rads'), emitter('e-other', 'Rad 3', 'other')];
const messages = (map: ReadonlyMap<string, readonly { message: string }[]>) =>
  Object.fromEntries([...map].map(([id, issues]) => [id, issues.map((i) => i.message.replace(/\u00a0/g, ' '))]));

const EMITTERS_SMALL = 'The radiators are too small at 45 °C flow.';
const HP_SMALL = 'The heat pump is too small for the house on the design day.';

describe('heatingSizingWarnings', () => {
  // The flag says the verdict only; the same message whatever the backup, test point or numbers.
  it.each([
    ['heat pump too small, no backup', src(), HP_SMALL],
    ['heat pump too small, backup heater', src({ hasBackupHeater: true }), HP_SMALL],
    ['boiler too small', src({ kind: 'Boiler', hasBackupHeater: null, testPointC: null }),
      'The boiler is too small for the house on the design day.'],
    ['too big', src({ verdict: 'too-big', minKw: 3.5, maxKw: 12, designLossKw: 2.3, balancePointC: null, shortfallKw: null }),
      'The heat pump is too big for the house. It switches on and off all year.'],
    ['too small, design day below the test point', src({ designBelowTestPointK: 0.2 }), HP_SMALL],
  ])('%s', (_label, heatSource, message) => {
    expect(messages(heatingSizingWarnings(ready({ heatSources: [heatSource] }), elements))).toEqual({ 'e-hp': [message] });
  });

  it('flags emitters too small on the system and on each of its emitters only', () => {
    expect(messages(heatingSizingWarnings(ready({ systems: [sys()] }), elements))).toEqual({
      'e-rads': [EMITTERS_SMALL], 'e-r1': [EMITTERS_SMALL], 'e-r2': [EMITTERS_SMALL],
    });
    const never = heatingSizingWarnings(ready({ systems: [sys({ minFlowC: null })] }), elements);
    expect(never.get('e-rads')?.[0].message.replace(/\u00a0/g, ' ')).toBe(EMITTERS_SMALL);
  });

  it('matches by model key: extra_json fragment key, and emitters linked by element name or key', () => {
    const shs = system('e-shs', 'Radiators', 'SpaceHeatSystem', { SpaceHeatSystem: { rads: { type: 'WetDistribution' } } });
    const pump = system('e-pump', 'Heat pump', 'HeatSourceWet', { HeatSourceWet: { hp: { type: 'HeatPump' } } });
    const list = [shs, pump, emitter('by-name', 'R1', 'Radiators'), emitter('by-key', 'R2', 'rads')];
    expect(Object.keys(messages(heatingSizingWarnings(ready({ systems: [sys()], heatSources: [src()] }), list))).sort())
      .toEqual(['by-key', 'by-name', 'e-pump', 'e-shs']);
  });

  it('flags a heat source shared by two systems once, and each system its own way', () => {
    const second = system('e-ufh', 'rads2', 'SpaceHeatSystem');
    const result = ready({
      systems: [sys(), sys({ name: 'rads2', verdict: 'ok', outputAtDesignKw: 6 })],
      heatSources: [src({ systems: ['rads', 'rads2'] })],
    });
    const map = heatingSizingWarnings(result, [...elements, second, emitter('e-r4', 'Rad 4', 'rads2')]);
    expect(map.get('e-hp')).toHaveLength(1);
    expect(map.has('e-ufh')).toBe(false);
    expect(map.has('e-r4')).toBe(false);
  });

  it('keeps flags on the right element when names collide across kinds', () => {
    const list = [system('src', 'Main', 'HeatSourceWet'), system('shs', 'Main', 'SpaceHeatSystem'), emitter('rad', 'Main', 'Main'),
      system('hw', 'Main', 'HotWaterSource')];
    const map = messages(heatingSizingWarnings(ready({ systems: [sys({ name: 'Main' })], heatSources: [src({ name: 'Main', verdict: 'too-big', minKw: 3.5, designLossKw: 2.3 })] }), list));
    expect(map.src[0]).toBe('The heat pump is too big for the house. It switches on and off all year.');
    expect(map.shs).toEqual([EMITTERS_SMALL]);
    expect(map.rad).toEqual([EMITTERS_SMALL]);
    expect(map.hw).toBeUndefined();
  });

  it.each([
    ['ok', { verdict: 'ok' as const }],
    ['unsupported', { status: 'unsupported' as const, verdict: null }],
    ['no-data', { status: 'no-data' as const, verdict: null }],
    ['error', { status: 'error' as const, verdict: null }],
    ['ok with the design day below the test point', { verdict: 'ok' as const, designBelowTestPointK: 0.2 }],
  ])('is silent for %s', (_label, over) => {
    const result = ready({ systems: [sys(over as Partial<SystemSizing>)], heatSources: [src(over)] });
    expect(heatingSizingWarnings(result, elements).size).toBe(0);
  });

  it('is silent unless the state holds a result: idle, unavailable, error', () => {
    const result = ready({ systems: [sys()], heatSources: [src()] }).result;
    for (const status of ['idle', 'unavailable', 'error'] as const) {
      expect(heatingSizingWarnings({ status }, elements).size).toBe(0);
      expect(heatingSizingWarnings({ status, result }, elements).size).toBe(0);
    }
  });

  it('keeps the last result while the next model computes (no flicker)', () => {
    const { result } = ready({ heatSources: [src()] });
    expect(heatingSizingWarnings({ status: 'computing', result }, elements).size).toBe(1);
    expect(heatingSizingWarnings({ status: 'computing' }, elements).size).toBe(0);
  });

  it('says nothing when the model has no heating', () => {
    expect(heatingSizingWarnings(ready({}), []).size).toBe(0);
    expect(heatingSizingWarnings(ready({ systems: [sys()], heatSources: [src()] }), []).size).toBe(0);
  });

  it('only ever adds warnings to element validation, never issues', () => {
    const map = heatingSizingWarnings(ready({ systems: [sys()], heatSources: [src()] }), elements);
    for (const element of [hp, rads]) {
      const blocking = map.get(element.id)!.map((i) => i.message);
      const result = validateElementCore(element, {
        schemaPort: unavailableGeometrySchemaPort,
        heatingSizingWarnings: map,
        // A host that lists the message as blocking still cannot turn it into an error.
        hostFindings: { blockingWarnings: blocking },
      });
      expect(result.issues.some((i) => i.source === 'sizing')).toBe(false);
      expect(result.warnings.filter((w) => w.source === 'sizing').map((w) => w.message))
        .toEqual(blocking.map((m) => `${element.name} (System): ${m}`));
    }
  });
});

/**
 * The model keys come from the converter (vulcan-model-transform builder.rs): a System row writes its
 * extra_json fragment's keys as they are, or its CSV-trimmed Name for a flat row; a WetEmitter's
 * trimmed space_heat_system resolves through authored_space_heat_system_aliases_from_systems_csv.
 * Names are never case-folded, transliterated or deduplicated. Each case lists the flagged element ids.
 */
describe('heating sizing entries by element name', () => {
  const pumpSmall = (name: string) => src({ name });
  const radsSmall = (name: string) => sys({ name });
  it.each<[string, Element[], Partial<HeatingSizing>, string[]]>([
    ['a name with spaces', [system('a', 'Heat pump GF 1', 'HeatSourceWet')], { heatSources: [pumpSmall('Heat pump GF 1')] }, ['a']],
    ['mixed case is kept, not folded', [system('a', 'HP', 'HeatSourceWet'), system('b', 'hp', 'HeatSourceWet')], { heatSources: [pumpSmall('HP')] }, ['a']],
    ['a non-ASCII name', [system('a', 'Pompe à chaleur ☀', 'HeatSourceWet')], { heatSources: [pumpSmall('Pompe à chaleur ☀')] }, ['a']],
    ['trailing spaces, trimmed as the CSV parser trims', [system('a', 'rads  ', 'SpaceHeatSystem'), emitter('r', 'R1', ' rads ')], { systems: [radsSmall('rads')] }, ['a', 'r']],
    ['one name in two subcategories', [system('a', 'heat', 'HeatSourceWet'), system('b', 'heat', 'SpaceHeatSystem')], { heatSources: [pumpSmall('heat')] }, ['a']],
    ['two elements whose fragments merge into one key', [
      system('a', 'Rads up', 'SpaceHeatSystem', { SpaceHeatSystem: { rads: { type: 'WetDistribution' } } }),
      system('b', 'Rads down', 'SpaceHeatSystem', { SpaceHeatSystem: { rads: { Zone: 'zone' } } }),
    ], { systems: [radsSmall('rads')] }, ['a', 'b']],
    ['a renamed element keeps its fragment key', [
      system('a', 'Renamed pump', 'HeatSourceWet', { HeatSourceWet: { hp: { type: 'HeatPump' } } }),
    ], { heatSources: [pumpSmall('hp')] }, ['a']],
    ['every plant of a fragment with several', [
      system('a', 'Plant room', 'HeatSourceWet', { HeatSourceWet: { boiler: {}, hp: { type: 'HeatPump' } } }),
    ], { heatSources: [pumpSmall('hp')] }, ['a']],
    ['an emitter linked by a name its multi-plant system does not hold stays unlinked', [
      system('a', 'Heating', 'SpaceHeatSystem', { SpaceHeatSystem: { down: {}, up: {} } }), emitter('r', 'R1', 'Heating'),
    ], { systems: [radsSmall('down')] }, ['a']],
    ['an empty fragment writes nothing, not the name', [system('a', 'rads', 'SpaceHeatSystem', { SpaceHeatSystem: {} })], { systems: [radsSmall('rads')] }, []],
    ['an element absent from the model', [system('a', 'ghost', 'HeatSourceWet'), emitter('r', 'R1', 'nowhere')], { heatSources: [pumpSmall('hp')], systems: [radsSmall('rads')] }, []],
  ])('%s', (_label, list, result, flagged) => {
    expect([...heatingSizingWarnings(ready(result), list).keys()].sort()).toEqual(flagged);
  });

  it('gives the panel the entries the flags use, or none', () => {
    const plant = system('a', 'Plant room', 'HeatSourceWet', { HeatSourceWet: { boiler: {}, hp: {} } });
    const sizing = ready({ heatSources: [src({ name: 'hp' })], systems: [sys()] }).result;
    expect(heatSourceSizingsFor(sizing, plant).map((s) => s.name)).toEqual(['hp']);
    expect(heatSourceSizingsFor(sizing, system('g', 'ghost', 'HeatSourceWet'))).toEqual([]);
    expect(systemSizingFor(sizing, emitter('r', 'R1', 'Radiators'), [system('s', 'Radiators', 'SpaceHeatSystem', { SpaceHeatSystem: { rads: {} } })])?.name).toBe('rads');
    expect(systemSizingFor(sizing, emitter('r', 'R1', 'nowhere'), [])).toBeNull();
  });

  it('names the plant in the flag when the element holds several, one flag per verdict', () => {
    const plant = system('a', 'Plant room', 'HeatSourceWet', { HeatSourceWet: { boiler: {}, hp: {} } });
    const result = ready({ heatSources: [src({ name: 'boiler', kind: 'Boiler', verdict: 'ok' }), src({ name: 'hp' })] });
    expect(messages(heatingSizingWarnings(result, [plant]))).toEqual({ a: ['The heat pump "hp" is too small for the house on the design day.'] });
  });

  // A stale result after a rename: until the next model computes, the result names the old key.
  it('flags nothing on a flat element renamed since the result, until the next one', () => {
    expect(heatingSizingWarnings({ status: 'computing', result: ready({ heatSources: [src()] }).result }, [system('a', 'hp 2', 'HeatSourceWet')]).size).toBe(0);
  });

  it('says zone, not house, when the model has several zones', () => {
    const many = ready({ zoneCount: 2, heatSources: [src()], systems: [sys()] });
    const out = messages(heatingSizingWarnings(many, elements));
    expect(out['e-hp'][0]).toBe('The heat pump is too small for the zone on the design day.');
    expect(out['e-rads'][0]).toBe(EMITTERS_SMALL);
  });

  it('writes the emitter flow temperature with a no-break space and a degree sign, and a negative one with a typographic minus', () => {
    const flag = (flow: number) => heatingSizingWarnings(ready({ systems: [sys({ flowTempAtDesignC: flow })] }), elements).get('e-rads')![0].message;
    expect(flag(55)).toBe('The radiators are too small at 55\u00a0\u00b0C flow.');
    expect(flag(-5)).toContain('at \u22125\u00a0\u00b0C flow');
  });

  describe('heatingSizingWarningsFor', () => {
    const byId = Object.fromEntries(elements.map((e) => [e.id, e]));
    it('builds once per result and element set, whatever the status', () => {
      const result = ready({ heatSources: [src()] }).result;
      const first = heatingSizingWarningsFor({ status: 'ready', result }, byId);
      expect(heatingSizingWarningsFor({ status: 'computing', result }, byId)).toBe(first);
      expect(heatingSizingWarningsFor({ status: 'ready', result }, byId)).toBe(first);
      expect(first.get('e-hp')).toHaveLength(1);
    });
    it('builds again for a new result or a new element set', () => {
      const result = ready({ heatSources: [src()] }).result;
      const first = heatingSizingWarningsFor({ status: 'ready', result }, byId);
      expect(heatingSizingWarningsFor({ status: 'ready', result: { ...result } }, byId)).not.toBe(first);
      expect(heatingSizingWarningsFor({ status: 'ready', result }, { ...byId })).not.toBe(first);
    });
    it('says nothing, with one shared empty map, without a result', () => {
      expect(heatingSizingWarningsFor({ status: 'idle' }, byId)).toBe(heatingSizingWarningsFor({ status: 'error' }, byId));
      expect(heatingSizingWarningsFor({ status: 'idle' }, byId).size).toBe(0);
    });
  });
});
