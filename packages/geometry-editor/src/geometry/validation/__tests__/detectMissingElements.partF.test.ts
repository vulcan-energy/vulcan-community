// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Integration tests: detectMissingElements with Part F context.
//
// Verifies that Part F findings translate into MissingElement rows on the elements panel
// with the right pillQualifier text and a batchPlan when applicable.

import { describe, it, expect } from 'vitest';
import { detectMissingElements } from '../detectMissingElements';
import type {
  Element,
  BuildingElementOpaque,
  BuildingElementTransparent,
  MechanicalVentilation,
  SpaceLabel,
  System,
  Vents,
  WetEmitter,
  Zone,
} from '../../types';

let nextId = 0;
const newId = () => `el-${++nextId}`;

const realWall = (zoneId: string): BuildingElementOpaque => ({
  id: newId(),
  name: `Wall-${nextId}`,
  zoneId,
  type: 'BuildingElementOpaque',
  width: 1,
  height: 1,
  area: 1,
  parent_element: null,
  coordinates: [{ x: 0, y: 0, z: 0 }],
  isPlaceholder: false,
});

const window = (zoneId: string, name: string, x: number, y: number): BuildingElementTransparent => ({
  id: newId(),
  name,
  zoneId,
  type: 'BuildingElementTransparent',
  width: 1,
  height: 1,
  area: 1,
  parent_element: null,
  coordinates: [{ x, y, z: 1.5 }],
  isPlaceholder: false,
});

const mv = (
  vent_type: MechanicalVentilation['vent_type'],
  flowM3h: number,
): MechanicalVentilation => ({
  id: newId(),
  name: `mv-${nextId}`,
  type: 'MechanicalVentilation',
  vent_type,
  parent_element: null,
  coordinates: [{ x: 0, y: 0, z: 0 }],
  isPlaceholder: false,
  extra_json: { design_outdoor_air_flow_rate: flowM3h },
});

const hotWater = (
  subcategory: 'Bath' | 'MixerShower' | 'OtherWaterUseDetails' | 'InstantElecShower',
): Element => ({
  id: newId(),
  name: subcategory,
  type: 'HotWaterDemand',
  subcategory,
  flowrate: subcategory === 'Bath' ? undefined : 8,
  size: subcategory === 'Bath' ? 100 : undefined,
  allow_low_flowrate: subcategory === 'MixerShower' ? false : undefined,
  rated_power: subcategory === 'InstantElecShower' ? 9 : undefined,
  isPlaceholder: false,
} as Element);

const wetEmitter = (zoneId: string, overrides: Partial<WetEmitter> = {}): WetEmitter => ({
  id: newId(),
  name: `Radiator-${nextId}`,
  zoneId,
  type: 'WetEmitter',
  subcategory: 'radiator',
  unit_number: 1,
  parent_element: null,
  coordinates: [{ x: 0, y: 0, z: 0 }],
  isPlaceholder: false,
  ...overrides,
} as WetEmitter);

const spaceHeatSystem = (zoneId: string, name = 'Zone 1 radiator system'): System => ({
  id: newId(),
  name,
  zoneId,
  type: 'System',
  subcategory: 'SpaceHeatSystem',
  system_preset: 'instant_elec_heater',
  extra_json: {
    SpaceHeatSystem: {
      [name]: {
        type: 'InstantElecHeater',
        EnergySupply: 'mains elec',
        rated_power: 2.5,
      },
    },
  },
  parent_element: null,
  coordinates: [{ x: 0, y: 0, z: 0 }],
  isPlaceholder: false,
} as System);

const bedroomLabel = (cx: number, cy: number, size = 4): SpaceLabel => ({
  id: newId(),
  name: `bedroom-${nextId}`,
  zoneId: 'zone-1',
  storey: 0,
  room_type: 'bedroom',
  coordinates: [
    { x: cx - size / 2, y: cy - size / 2, z: 0 },
    { x: cx + size / 2, y: cy - size / 2, z: 0 },
    { x: cx + size / 2, y: cy + size / 2, z: 0 },
    { x: cx - size / 2, y: cy + size / 2, z: 0 },
  ],
});

const zone = (): Zone => ({
  id: 'zone-1',
  name: 'Zone 1',
  floorArea: 100,
  height: 2.5,
  isPlaceholder: false,
});

function elementsById(els: Element[]): Record<string, Element> {
  return Object.fromEntries(els.map((e) => [e.id, e]));
}

const partFCtx = (over: object = {}) => ({
  spaceLabels: [],
  totalFloorAreaM2: 100,
  bedrooms: 4,
  habitableRooms: 5,
  wetRooms: 3,
  bathrooms: 2,
  utilityRooms: 0,
  sanitaryAccommodations: 0,
  storeys: 2,
  isKitchenVentExternal: true,
  ...over,
});

describe('detectMissingElements + Part F', () => {
  it('does not count an unlinked wet emitter as a zone SpaceHeatSystem', () => {
    const z1 = zone();
    const radiator = wetEmitter(z1.id);

    const missing = detectMissingElements(
      [z1],
      elementsById([radiator]),
      true,
      0,
      false,
      partFCtx(),
    );

    expect(missing.find((m) => m.path === '/Zone/Zone 1/SpaceHeatSystem')).toBeTruthy();
  });

  it('does not count a category-only SpaceHeatSystem shell as zone space heating', () => {
    const z1 = zone();
    const system = {
      ...spaceHeatSystem(z1.id),
      system_preset: undefined,
      extra_json: undefined,
    } as System;

    const missing = detectMissingElements(
      [z1],
      elementsById([system]),
      true,
      0,
      false,
      partFCtx(),
    );

    expect(missing.find((m) => m.path === '/Zone/Zone 1/SpaceHeatSystem')).toBeTruthy();
  });

  it('accepts an authored SpaceHeatSystem element for zone space heating', () => {
    const z1 = zone();
    const system = spaceHeatSystem(z1.id);

    const missing = detectMissingElements(
      [z1],
      elementsById([system]),
      true,
      0,
      false,
      partFCtx(),
    );

    expect(missing.find((m) => m.path === '/Zone/Zone 1/SpaceHeatSystem')).toBeUndefined();
  });

  it('multi-storey FHS compliance requires a shower even when a bath exists', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    const bath = hotWater('Bath');

    const missing = detectMissingElements(
      [z1],
      elementsById([wall, bath]),
      true,
      0,
      false,
      partFCtx({ storeys: 2 }),
    );

    const row = missing.find((m) => m.path === '/HotWaterDemand/Shower');
    expect(row).toBeTruthy();
    expect(row!.type).toBe('HotWaterDemand');
    expect(row!.pillQualifier).toBe('Shower');
  });

  it('single-storey FHS compliance does not require the notional WWHRS shower', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    const bath = hotWater('Bath');

    const missing = detectMissingElements(
      [z1],
      elementsById([wall, bath]),
      true,
      0,
      false,
      partFCtx({ storeys: 1 }),
    );

    expect(missing.find((m) => m.path === '/HotWaterDemand/Shower')).toBeUndefined();
    expect(missing.find((m) => m.path === '/HotWaterDemand/ShowerOrBath')).toBeUndefined();
  });

  it('multi-storey FHS compliance accepts an authored mixer shower', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    const shower = hotWater('MixerShower');

    const missing = detectMissingElements(
      [z1],
      elementsById([wall, shower]),
      true,
      0,
      false,
      partFCtx({ storeys: 2 }),
    );

    expect(missing.find((m) => m.path === '/HotWaterDemand/Shower')).toBeUndefined();
    expect(missing.find((m) => m.path === '/HotWaterDemand/ShowerOrBath')).toBeUndefined();
  });

  it('multi-storey FHS compliance accepts an authored instantaneous electric shower', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    const shower = hotWater('InstantElecShower');

    const missing = detectMissingElements(
      [z1],
      elementsById([wall, shower]),
      true,
      0,
      false,
      partFCtx({ storeys: 2 }),
    );

    expect(missing.find((m) => m.path === '/HotWaterDemand/Shower')).toBeUndefined();
    expect(missing.find((m) => m.path === '/HotWaterDemand/ShowerOrBath')).toBeUndefined();
  });

  it('cMEV with no vents produces a single merged background-vent pill (area + count combined)', () => {
    // area + count rules both close via the same batched CTA — emitting both as separate
    // pills would produce two clicks that do exactly the same thing. detectMissingElements
    // merges them into one pill labelled with both gaps.
    const z1 = zone();
    const wall = realWall(z1.id);
    const cmev = mv('Centralised continuous MEV', 200);
    const els = [wall, cmev];

    const missing = detectMissingElements(
      [z1],
      elementsById(els),
      true,
      0,
      false,
      partFCtx({ spaceLabels: [bedroomLabel(0, 0)] }),
    );

    const partFRows = missing.filter((m) => m.path.startsWith('/InfiltrationVentilation/'));
    // Exactly one pill — the merged one — for the continuous-pathway background shortfall.
    expect(partFRows).toHaveLength(1);
    const row = partFRows[0]!;
    expect(row.type).toBe('Vents');
    expect(row.requiredBy).toBe('fhs');
    expect(row.path).toBe('/InfiltrationVentilation/background_area_continuous');
    expect(row.pillQualifier).toMatch(/0 \/ 6 vents · 0 \/ 200 cm²/);
    expect(row.batchPlan).toBeTruthy();
    expect(row.batchPlan!.vents).toHaveLength(6); // bedrooms (4) + 2
  });

  it('Part F context omitted → no Part F rows (existing behaviour preserved)', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    const cmev = mv('Centralised continuous MEV', 200);
    const els = [wall, cmev];

    const missing = detectMissingElements([z1], elementsById(els), true, 0, false);
    const partFRows = missing.filter((m) => m.path.startsWith('/InfiltrationVentilation/'));
    expect(partFRows).toHaveLength(0);
  });

  it('compliance disabled → no Part F rows even with full context', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    const cmev = mv('Centralised continuous MEV', 200);
    const els = [wall, cmev];

    const missing = detectMissingElements(
      [z1],
      elementsById(els),
      false, // compliance off
      0,
      false,
      partFCtx({ spaceLabels: [bedroomLabel(0, 0)] }),
    );
    expect(missing).toHaveLength(0);
  });

  it('placeholder-only model (no real elements) → no Part F rows', () => {
    const z1 = zone();
    const placeholder: BuildingElementOpaque = { ...realWall(z1.id), isPlaceholder: true };
    const cmev: MechanicalVentilation = { ...mv('Centralised continuous MEV', 200), isPlaceholder: true };

    const missing = detectMissingElements(
      [z1],
      elementsById([placeholder, cmev]),
      true,
      0,
      false,
      partFCtx(),
    );
    const partFRows = missing.filter((m) => m.path.startsWith('/InfiltrationVentilation/'));
    expect(partFRows).toHaveLength(0);
  });

  it('missing dwelling counts → no Part F rows (avoids double-flagging vs Dwelling Details)', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    const cmev = mv('Centralised continuous MEV', 200);

    const missing = detectMissingElements(
      [z1],
      elementsById([wall, cmev]),
      true,
      0,
      false,
      partFCtx({ habitableRooms: undefined }),
    );
    const partFRows = missing.filter((m) => m.path.startsWith('/InfiltrationVentilation/'));
    expect(partFRows).toHaveLength(0);
  });

  it('background-area batchPlan parents vents to bedroom windows', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    const wnd = window(z1.id, 'BedroomWindow', 0, 0);
    const cmev = mv('Centralised continuous MEV', 200);

    const missing = detectMissingElements(
      [z1],
      elementsById([wall, wnd, cmev]),
      true,
      0,
      false,
      partFCtx({ spaceLabels: [bedroomLabel(0, 0)] }),
    );
    const areaRow = missing.find((m) => m.path.endsWith('/background_area_continuous'));
    expect(areaRow).toBeTruthy();
    expect(areaRow!.batchPlan!.vents.length).toBeGreaterThan(0);
    expect(areaRow!.batchPlan!.vents.every((v) => v.parent_element === 'BedroomWindow')).toBe(true);
  });

  it('whole-dwelling extract finding emits NO MissingElement (per-element issues handle it)', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    // 4 bedroom, 100 m² → 133.2 m³/h required; supply only 50.
    const cmev = mv('Centralised continuous MEV', 50);
    // Add enough vents so the area/count checks don't fire and we isolate whole-dwelling.
    const enoughVents: Vents[] = Array.from({ length: 6 }, (_, i) => ({
      id: newId(),
      name: `vent-${i}`,
      type: 'Vents',
      area_cm2: 50,
      mid_height_air_flow_path: 1.5,
      parent_element: '',
      coordinates: [{ x: 0, y: 0, z: 0 }],
      isPlaceholder: false,
    }));
    const missing = detectMissingElements(
      [z1],
      elementsById([wall, cmev, ...enoughVents]),
      true,
      0,
      false,
      partFCtx(),
    );
    expect(missing.find((m) => m.path.endsWith('/whole_dwelling_continuous'))).toBeUndefined();
  });

  it('large_imev finding emits NO MissingElement (sizing on existing iMEV)', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    // 2 iMEV, neither meeting the 30 l/s = 108 m³/h kitchen threshold.
    const imev1 = mv('Intermittent MEV', 60);
    const imev2 = mv('Intermittent MEV', 60);
    // Pad vents so background rules don't fire.
    const padVents: Vents[] = Array.from({ length: 5 }, (_, i) => ({
      id: newId(),
      name: `vent-${i}`,
      type: 'Vents',
      area_cm2: 200,
      mid_height_air_flow_path: 1.5,
      parent_element: '',
      coordinates: [{ x: 0, y: 0, z: 0 }],
      isPlaceholder: false,
    }));
    const missing = detectMissingElements(
      [z1],
      elementsById([wall, imev1, imev2, ...padVents]),
      true,
      0,
      false,
      partFCtx({
        bedrooms: 1,
        habitableRooms: 5,
        wetRooms: 2,
        bathrooms: 2,
        storeys: 2,
      }),
    );
    expect(missing.find((m) => m.path.endsWith('/large_imev'))).toBeUndefined();
  });

  it('MVHR + background vents (rule K) emits NO MissingElement (deletion fix on existing vents)', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    const mvhr = mv('MVHR', 200);
    const offendingVent: Vents = {
      id: newId(),
      name: 'OffendingVent',
      type: 'Vents',
      area_cm2: 80,
      mid_height_air_flow_path: 1.5,
      parent_element: '',
      coordinates: [{ x: 0, y: 0, z: 0 }],
      isPlaceholder: false,
    };
    const missing = detectMissingElements(
      [z1],
      elementsById([wall, mvhr, offendingVent]),
      true,
      0,
      false,
      partFCtx(),
    );
    expect(missing.find((m) => m.path.endsWith('/mvhr_no_background_vents'))).toBeUndefined();
  });

  it('Both pathways present and both failing → two merged pills (one per pathway)', () => {
    // Sub-agent review #1 flagged this as untested. When iMEV + cMEV both exist and both
    // fall short of background area/count, mergeBackgroundFindings should emit one merged
    // pill per pathway — not collapse them across pathways.
    const z1 = zone();
    const wall = realWall(z1.id);
    const imev = mv('Intermittent MEV', 5);    // far below intermittent threshold
    const cmev = mv('Centralised continuous MEV', 5);  // far below continuous threshold
    const missing = detectMissingElements(
      [z1],
      elementsById([wall, imev, cmev]),
      true,
      0,
      false,
      partFCtx({
        bedrooms: 4,
        habitableRooms: 5,
        wetRooms: 3,
        bathrooms: 2,
        storeys: 2,
      }),
    );
    const partFRows = missing.filter((m) => m.path.startsWith('/InfiltrationVentilation/'));
    const bgRows = partFRows.filter((m) => m.path.includes('background_'));
    // Two merged pills — one for continuous, one for intermittent. Each has its own qualifier.
    expect(bgRows).toHaveLength(2);
    const paths = bgRows.map((m) => m.path).sort();
    expect(paths).toEqual([
      '/InfiltrationVentilation/background_area_continuous',
      '/InfiltrationVentilation/background_area_intermittent',
    ]);
  });

  it('Orphan count finding without an area partner passes through unmerged', () => {
    // If a model has plenty of vent area but too few vents (e.g. one big vent, only 1 of 5
    // required), only the count rule fires for that pathway. The merge logic should leave it
    // alone rather than fail to find a partner. Synthesised by giving 1 huge vent.
    const z1 = zone();
    const wall = realWall(z1.id);
    const cmev = mv('Centralised continuous MEV', 200);
    const oneHugeVent: Vents = {
      id: newId(),
      name: 'huge',
      type: 'Vents',
      area_cm2: 9999, // way over the area threshold
      mid_height_air_flow_path: 1.5,
      parent_element: '',
      coordinates: [{ x: 0, y: 0, z: 0 }],
      isPlaceholder: false,
    };
    const missing = detectMissingElements(
      [z1],
      elementsById([wall, cmev, oneHugeVent]),
      true,
      0,
      false,
      partFCtx({ bedrooms: 4, habitableRooms: 5 }),
    );
    const partFRows = missing.filter((m) => m.path.startsWith('/InfiltrationVentilation/'));
    const bgRows = partFRows.filter((m) => m.path.includes('background_'));
    // Only count rule fires (area is met). Merge sees no partner → emits the count rule alone.
    expect(bgRows).toHaveLength(1);
    expect(bgRows[0]!.path).toBe('/InfiltrationVentilation/background_count_continuous');
  });

  it('Intermittent pathway: area + count rules merge for intermittent pathway too', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    // 3 iMEV with sufficient large vent for kitchen, but no background vents at all.
    const imev1 = mv('Intermittent MEV', 110);
    const imev2 = mv('Intermittent MEV', 60);
    const imev3 = mv('Intermittent MEV', 60);
    const missing = detectMissingElements(
      [z1],
      elementsById([wall, imev1, imev2, imev3]),
      true,
      0,
      false,
      partFCtx({
        bedrooms: 2,
        habitableRooms: 4,
        wetRooms: 3,
        bathrooms: 1,
        utilityRooms: 0,
        sanitaryAccommodations: 1,
        storeys: 2,
      }),
    );
    const partFRows = missing.filter((m) => m.path.startsWith('/InfiltrationVentilation/'));
    // Exactly one merged background pill — not two.
    const bgRows = partFRows.filter((m) => m.path.includes('background_'));
    expect(bgRows).toHaveLength(1);
    expect(bgRows[0]!.pillQualifier).toMatch(/\d+ \/ \d+ vents · \d+ \/ \d+ cm²/);
  });

  it('imev_count finding still emits a MissingElement (add another iMEV is the right action)', () => {
    const z1 = zone();
    const wall = realWall(z1.id);
    // 1 iMEV, 3 wet rooms → 2 missing.
    const imev = mv('Intermittent MEV', 110);
    const padVents: Vents[] = Array.from({ length: 5 }, (_, i) => ({
      id: newId(),
      name: `vent-${i}`,
      type: 'Vents',
      area_cm2: 200,
      mid_height_air_flow_path: 1.5,
      parent_element: '',
      coordinates: [{ x: 0, y: 0, z: 0 }],
      isPlaceholder: false,
    }));
    const missing = detectMissingElements(
      [z1],
      elementsById([wall, imev, ...padVents]),
      true,
      0,
      false,
      partFCtx({
        bedrooms: 1,
        habitableRooms: 5,
        wetRooms: 3,
        bathrooms: 2,
        storeys: 2,
      }),
    );
    const row = missing.find((m) => m.path.endsWith('/imev_count'));
    expect(row).toBeTruthy();
    expect(row!.type).toBe('MechanicalVentilation');
    expect(row!.batchPlan).toBeUndefined();
  });
});
