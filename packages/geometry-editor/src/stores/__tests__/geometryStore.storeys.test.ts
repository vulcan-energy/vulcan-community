// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Element } from '../../geometry/types';
import { createGeometryStore } from '../geometryStore';
import { HISTORY_CAPTURE_QUIET_MS } from '../geometryStore/slices/historySlice';

type Store = ReturnType<typeof createGeometryStore>;

const settle = () => vi.advanceTimersByTime(HISTORY_CAPTURE_QUIET_MS + 10);
const byName = (store: Store, name: string): Element | undefined =>
  Object.values(store.getState().elementsById).find((el) => el.name === name);
const onFloor = (store: Store, z: number): Element[] =>
  Object.values(store.getState().elementsById).filter((el) => Math.floor(el.coordinates?.[0]?.z ?? NaN) === z);

const wall = (name: string, zoneId: string, z: number, x: number, extra: Record<string, unknown> = {}) => ({
  type: 'BuildingElementOpaque' as const, name, zoneId, height: 2.5, width: 4, area: 10,
  pitch: 90, base_height: z * 2.5, parent_element: null,
  coordinates: [{ x, y: 0, z }, { x: x + 4, y: 0, z }],
  ...extra,
});

/** A loaded two-storey house: F1 typed at 2.5 m, F2 with walls, a window, door, internal wall, emitter, light, vent, floor, ceiling, roof. */
function twoStoreys(): Store {
  const builder = createGeometryStore({ defaultDefaultsPath: null });
  builder.getState().seedHistory('load');
  builder.getState().addZone({ name: 'Zone 1', floorArea: 20, height: 5, volume: 100 });
  const zoneId = builder.getState().zones[0]!.id;
  builder.getState().addElements([
    wall('Wall (S)', zoneId, 0, 0),
    wall('Wall (S) 1', zoneId, 1, 0),
    wall('Knee wall', zoneId, 1, 10, { height: 1.2, area: 4.8 }),
    wall('Door 1', zoneId, 1, 20, { is_external_door: true, height: 2.1, width: 1, area: 2.1 }),
    {
      type: 'BuildingElementAdjacentConditionedSpace', name: 'Internal Wall', zoneId, height: 2.5, width: 3, area: 7.5,
      pitch: 90, parent_element: null, coordinates: [{ x: 0, y: 2, z: 1 }, { x: 3, y: 2, z: 1 }],
    },
    {
      type: 'BuildingElementAdjacentConditionedSpace', name: 'Internal Ceiling', zoneId, height: 4, width: 4, area: 16,
      pitch: 180, parent_element: null,
      coordinates: [{ x: 0, y: 0, z: 1 }, { x: 4, y: 0, z: 1 }, { x: 4, y: 4, z: 1 }, { x: 0, y: 4, z: 1 }],
    },
    {
      type: 'BuildingElementOpaque', name: 'Roof', zoneId, height: 4, width: 4, area: 16, pitch: 40, base_height: 5,
      parent_element: null, coordinates: [{ x: 0, y: 0, z: 1 }, { x: 4, y: 0, z: 1 }, { x: 4, y: 4, z: 1 }, { x: 0, y: 4, z: 1 }],
    },
    {
      type: 'BuildingElementTransparent', name: 'Window 1', zoneId, height: 1.2, width: 1, area: 1.2, pitch: 90,
      base_height: 3.4, parent_element: 'Wall (S) 1', coordinates: [{ x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }],
    },
    { type: 'WetEmitter', name: 'Radiator 1', zoneId, subcategory: 'radiator', space_heat_system: 'Heating', unit_number: 1, parent_element: null, coordinates: [{ x: 1, y: 1, z: 1 }, { x: 2, y: 1, z: 1 }] },
    { type: 'Lighting', name: 'Light 1', zoneId, simplified_lighting: false, efficacy: 120, count: 2, power: 5, parent_element: null, coordinates: [{ x: 2, y: 2, z: 1 }] },
    { type: 'Vents', name: 'Vent 1', zoneId, mid_height_air_flow_path: 4.5, area_cm2: 25, parent_element: 'Wall (S) 1', coordinates: [{ x: 3, y: 0, z: 1 }] },
    { type: 'ThermalBridgePoint', name: 'TB 1', zoneId, heat_transfer_coeff: 0.1, parent_element: null, coordinates: [{ x: 0, y: 0, z: 1 }] },
  ] as never);
  const store = builder;
  const f1 = store.getState().floors.find((floor) => floor.zIndex === 0)!;
  store.getState().updateFloor(f1.id, { height: 2.5, heightUserOverride: true });
  return store;
}

describe('storeys', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a wall drawn on a storey takes the storey height, so it opens without a height error', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const floorId = store.getState().ensureFloorForZ(0);
    store.getState().updateFloor(floorId, { height: 2.5, heightUserOverride: true });
    const id = store.getState().createPlaceholderElement('', 'BuildingElementOpaque');
    store.getState().updateElement(id, { coordinates: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }], pitch: 90 } as Partial<Element>);
    const drawn = store.getState().elementsById[id] as Element & { height: number; area: number };
    expect(drawn.height).toBe(2.5);
    expect(drawn.area).toBe(20);
  });

  it('a storey height change moves the walls at the old height and the storeys above, one undo step', () => {
    const store = twoStoreys();
    settle();
    const f1 = store.getState().floors.find((floor) => floor.zIndex === 0)!;
    store.getState().updateFloor(f1.id, { height: 2.7, heightUserOverride: true });
    settle();
    expect((byName(store, 'Wall (S)') as { height: number }).height).toBe(2.7);
    expect((byName(store, 'Wall (S)') as { area: number }).area).toBe(10.8);
    expect((byName(store, 'Wall (S) 1') as { base_height: number }).base_height).toBe(2.7);
    expect((byName(store, 'Wall (S) 1') as { height: number }).height).toBe(2.5);
    store.getState().undo();
    expect((byName(store, 'Wall (S)') as { height: number }).height).toBe(2.5);
    expect((byName(store, 'Wall (S) 1') as { base_height: number }).base_height).toBe(2.5);
  });

  it('a typed base above does not move with the storey below', () => {
    const store = twoStoreys();
    const f2 = store.getState().floors.find((floor) => floor.zIndex === 1)!;
    store.getState().updateFloor(f2.id, { baseHeight: 2.5, baseHeightUserOverride: true });
    const f1 = store.getState().floors.find((floor) => floor.zIndex === 0)!;
    store.getState().updateFloor(f1.id, { height: 2.7, heightUserOverride: true });
    expect((byName(store, 'Wall (S) 1') as { base_height: number }).base_height).toBe(2.5);
  });

  it('Copy of F2 copies walls, openings, internal walls, emitters, lights and vents in place onto F3, as one undo step', () => {
    const store = twoStoreys();
    settle();
    const historyBefore = store.getState().historyIndex;
    store.getState().copyStorey(1, 2);
    settle();

    const copied = onFloor(store, 2);
    expect(copied.map((el) => el.name).sort()).toEqual([
      'Door 1 F3', 'Internal Wall F3', 'Knee wall F3', 'Light 1 F3', 'Radiator 1 F3', 'Vent 1 F3', 'Wall (S) 1 F3', 'Window 1 F3',
    ]);
    const source = byName(store, 'Wall (S) 1')!;
    const copy = byName(store, 'Wall (S) 1 F3')! as Element & { base_height: number; height: number };
    expect(copy.coordinates.map(({ x, y }) => ({ x, y }))).toEqual(source.coordinates.map(({ x, y }) => ({ x, y })));
    expect(copy.base_height).toBe(5);
    expect(copy.height).toBe(2.5);
    expect(byName(store, 'Window 1 F3')!.parent_element).toBe('Wall (S) 1 F3');
    expect((byName(store, 'Window 1 F3') as { base_height: number }).base_height).toBe(5.9);
    expect(byName(store, 'Vent 1 F3')!.parent_element).toBe('Wall (S) 1 F3');
    expect((byName(store, 'Vent 1 F3') as { mid_height_air_flow_path: number }).mid_height_air_flow_path).toBe(7);
    expect(byName(store, 'Vent 1 F3')!.floorId).toBe(store.getState().floors.find((floor) => floor.zIndex === 2)!.id);
    expect((byName(store, 'Radiator 1 F3') as { space_heat_system?: string }).space_heat_system).toBe('Heating');
    expect(store.getState().currentFloorZ).toBe(2);

    expect(store.getState().historyIndex).toBe(historyBefore + 1);
    store.getState().undo();
    expect(onFloor(store, 2)).toEqual([]);
  });
});

describe('storey heights on mixed storeys', () => {
  it('a typed storey height moves the walls most stand at, not the one stair wall', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().addElements([
      wall('A', '', 0, 0, { height: 2.4, area: 9.6 }),
      wall('B', '', 0, 5, { height: 2.4, area: 9.6 }),
      wall('Stair', '', 0, 10, { height: 2.9, area: 11.6 }),
    ] as never);
    const f1 = store.getState().floors.find((floor) => floor.zIndex === 0)!;
    store.getState().updateFloor(f1.id, { height: 2.5, heightUserOverride: true });
    expect([byName(store, 'A'), byName(store, 'B'), byName(store, 'Stair')].map((el) => (el as { height: number }).height))
      .toEqual([2.5, 2.5, 2.9]);
  });

  it('a later edit never refills a height the user blanked', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const floorId = store.getState().ensureFloorForZ(0);
    store.getState().updateFloor(floorId, { height: 2.5, heightUserOverride: true });
    const id = store.getState().createPlaceholderElement('', 'BuildingElementOpaque');
    store.getState().updateElement(id, { coordinates: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }], pitch: 90 } as Partial<Element>);
    store.getState().updateElement(id, { height: undefined } as Partial<Element>);
    store.getState().updateElement(id, { name: 'Renamed' } as Partial<Element>);
    expect((store.getState().elementsById[id] as { height?: number }).height).toBeUndefined();
  });
});
