// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { createGeometryStore } from '../../stores/geometryStore';
import { networkPoint3 } from '../elementCanvasFloor';
import type { Element, Floor } from '../../geometry/types';
import {
  calculateDerivedHeight,
  calculateSuggestedVentilationHeight,
  calculateBaseHeightPatchForFloorStackChange,
  getCumulativeBaseHeightsByFloorId,
  getStrictStoreyHeight,
  getMaxLineWallHeightOnFloor,
  calculateSharedGroundElementArea,
  withEffectiveStoreyHeights,
} from '../zoneDerivation';

const LINE_WALL_TYPES = [
  'BuildingElementOpaque',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
] as const satisfies ReadonlyArray<Element['type']>;

describe('calculateDerivedHeight wall filtering', () => {
  it('excludes line-hosted external doors', () => {
    const elements = [
      {
        id: 'wall-with-door',
        name: 'Wall with door',
        type: 'BuildingElementOpaque',
        zoneId: 'zone-door-filter',
        height: 2.85,
        width: 4.67,
        pitch: 90,
        coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4.67, y: 0, z: 0 }],
        parent_element: null,
      },
      {
        id: 'external-door',
        name: 'External door',
        type: 'BuildingElementOpaque',
        zoneId: 'zone-door-filter',
        height: 2,
        width: 1,
        pitch: 90,
        is_external_door: true,
        coordinates: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
        parent_element: 'Wall with door',
      },
    ] as unknown as Element[];

    expect(calculateDerivedHeight('zone-door-filter', elements, [])).toBe(2.85);
  });

  it.each(LINE_WALL_TYPES)('excludes non-vertical two-point %s elements', (type) => {
    const elements = [
      {
        id: 'vertical-wall',
        name: 'Vertical wall',
        type: 'BuildingElementOpaque',
        zoneId: 'zone-pitch-filter',
        height: 2.85,
        width: 4,
        pitch: 90,
        coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
        parent_element: null,
      },
      {
        id: `pitched-${type}`,
        name: `Pitched ${type}`,
        type,
        zoneId: 'zone-pitch-filter',
        height: 2,
        width: 4,
        pitch: 30,
        coordinates: [{ x: 0, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }],
        parent_element: null,
      },
    ] as unknown as Element[];

    expect(calculateDerivedHeight('zone-pitch-filter', elements, [])).toBe(2.85);
  });
});

describe('calculateSharedGroundElementArea', () => {
  it('sums every split Ground Elements row for HEM total_area', () => {
    const grounds = [
      {
        id: 'ground-north',
        name: 'Ground north',
        type: 'BuildingElementGround',
        area: 59.41,
        coordinates: [{ x: 0, y: 0, z: 0 }],
      },
      {
        id: 'ground-south',
        name: 'Ground south',
        type: 'BuildingElementGround',
        area: 21.24,
        coordinates: [{ x: 0, y: 0, z: 2.5 }],
      },
    ] as unknown as Element[];

    expect(calculateSharedGroundElementArea(grounds)).toBe(80.65);
  });
});

describe('getMaxLineWallHeightOnFloor wall filtering', () => {
  it('uses only vertical fabric lines, excluding slopes, windows, and external doors', () => {
    const elements = [
      {
        id: 'vertical-wall',
        name: 'Vertical wall',
        type: 'BuildingElementOpaque',
        height: 2.85,
        width: 4,
        pitch: 90,
        is_external_door: false,
        coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
        parent_element: null,
      },
      {
        id: 'pitched-wall',
        name: 'Pitched wall',
        type: 'BuildingElementOpaque',
        height: 8,
        width: 4,
        pitch: 30,
        coordinates: [{ x: 0, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }],
        parent_element: null,
      },
      {
        id: 'external-door',
        name: 'External door',
        type: 'BuildingElementOpaque',
        height: 4,
        width: 1,
        pitch: 90,
        is_external_door: true,
        coordinates: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
        parent_element: 'Vertical wall',
      },
      {
        id: 'window',
        name: 'Window',
        type: 'BuildingElementTransparent',
        height: 6,
        width: 2,
        pitch: 90,
        coordinates: [{ x: 1, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }],
        parent_element: 'Vertical wall',
      },
    ] as unknown as Element[];

    expect(getMaxLineWallHeightOnFloor(0, elements)).toBe(2.85);
  });
});

describe('getStrictStoreyHeight source resolution', () => {
  it('does not inherit a height from another floor or a stored fallback', () => {
    const lowerFloor = { id: 'floor-0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false };
    const upperFloor = { id: 'floor-1', name: 'First', zIndex: 1, height: 2.4, isRoofSpace: false };
    const lowerWall = {
      id: 'lower-wall',
      name: 'Lower wall',
      type: 'BuildingElementOpaque',
      height: 2.4,
      width: 4,
      pitch: 90,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      parent_element: null,
    } as unknown as Element;

    expect(getStrictStoreyHeight(upperFloor, [lowerWall])).toBe(0);
    expect(getStrictStoreyHeight({ ...upperFloor, height: 3.1 }, [])).toBe(0);
    expect(getStrictStoreyHeight({ ...upperFloor, height: 3.1, heightUserOverride: true }, [])).toBe(3.1);
    expect(getStrictStoreyHeight(lowerFloor, [lowerWall])).toBe(2.4);
  });

  it('keeps an upper base unresolved when an intervening floor has no strict height', () => {
    const modelFloors = [
      { id: 'floor-0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false },
      { id: 'floor-1', name: 'First', zIndex: 1, height: 3.1, isRoofSpace: false },
      { id: 'floor-2', name: 'Second', zIndex: 2, height: 2.4, isRoofSpace: false },
    ];
    const lowerWall = {
      id: 'lower-wall',
      name: 'Lower wall',
      type: 'BuildingElementOpaque',
      height: 2.4,
      width: 4,
      pitch: 90,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      parent_element: null,
    } as unknown as Element;

    const bases = getCumulativeBaseHeightsByFloorId(modelFloors, [lowerWall]);

    expect(bases.get('floor-0')).toBe(0);
    expect(bases.get('floor-1')).toBe(2.4);
    expect(bases.get('floor-2')).toBeNull();
  });

  it('uses an explicit floor base without changing the storey height below it', () => {
    const modelFloors = [
      {
        id: 'floor-0',
        name: 'Ground',
        zIndex: 0,
        height: 2.4,
        baseHeight: 0.3,
        baseHeightUserOverride: true,
        isRoofSpace: false,
      },
      { id: 'floor-1', name: 'First', zIndex: 1, height: 2.4, isRoofSpace: false },
    ];
    const lowerWall = {
      id: 'lower-wall',
      name: 'Lower wall',
      type: 'BuildingElementOpaque',
      height: 2.4,
      width: 4,
      pitch: 90,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      parent_element: null,
    } as unknown as Element;

    const bases = getCumulativeBaseHeightsByFloorId(modelFloors, [lowerWall]);

    expect(bases.get('floor-0')).toBe(0.3);
    expect(bases.get('floor-1')).toBe(2.7);
  });

  it('prefills existing floor bases from consistent authored vertical wall bases', () => {
    const modelFloors = [
      { id: 'floor-0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false },
      { id: 'floor-1', name: 'First', zIndex: 1, height: 2.4, isRoofSpace: false },
    ];
    const elements = [
      {
        id: 'lower-wall',
        name: 'Lower wall',
        type: 'BuildingElementOpaque',
        height: 2.4,
        width: 4,
        pitch: 90,
        base_height: 0.3,
        coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
        parent_element: null,
      },
      {
        id: 'upper-wall',
        name: 'Upper wall',
        type: 'BuildingElementOpaque',
        height: 2.4,
        width: 4,
        pitch: 90,
        base_height: 2.7,
        coordinates: [{ x: 0, y: 0, z: 1 }, { x: 4, y: 0, z: 1 }],
        parent_element: null,
      },
    ] as unknown as Element[];

    const bases = getCumulativeBaseHeightsByFloorId(modelFloors, elements);

    expect(bases.get('floor-0')).toBe(0.3);
    expect(bases.get('floor-1')).toBe(2.7);
  });

  it('prefills from adjacent-wall viewer bases but excludes windows, slopes, and doors', () => {
    const modelFloors = [
      { id: 'floor-0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false },
    ];
    const elements = [
      {
        id: 'party-wall',
        name: 'Party wall',
        type: 'BuildingElementPartyWall',
        height: 2.4,
        width: 4,
        pitch: 90,
        _base_height: 0.4,
        coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      },
      {
        id: 'window',
        name: 'Window',
        type: 'BuildingElementTransparent',
        height: 2.4,
        width: 2,
        pitch: 90,
        base_height: 0.8,
        coordinates: [{ x: 1, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }],
      },
      {
        id: 'sloped-wall',
        name: 'Sloped wall',
        type: 'BuildingElementOpaque',
        height: 2.4,
        width: 4,
        pitch: 30,
        base_height: 1.2,
        coordinates: [{ x: 0, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }],
      },
      {
        id: 'external-door',
        name: 'External door',
        type: 'BuildingElementOpaque',
        height: 2.4,
        width: 1,
        pitch: 90,
        is_external_door: true,
        base_height: 1.6,
        coordinates: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      },
    ] as unknown as Element[];

    const bases = getCumulativeBaseHeightsByFloorId(modelFloors, elements);

    expect(bases.get('floor-0')).toBe(0.4);
  });

  it('cascades an explicit base edit onto authored ground-floor elevations', () => {
    const oldFloors = [
      { id: 'floor-0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false },
    ];
    const newFloors = [
      {
        id: 'floor-0',
        name: 'Ground',
        zIndex: 0,
        height: 2.4,
        baseHeight: 0.3,
        baseHeightUserOverride: true,
        isRoofSpace: false,
      },
    ];
    const wall = {
      id: 'wall-0',
      name: 'Ground wall',
      type: 'BuildingElementOpaque',
      height: 2.4,
      width: 4,
      pitch: 90,
      base_height: 0,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      parent_element: null,
    } as unknown as Element;

    expect(calculateBaseHeightPatchForFloorStackChange(wall, oldFloors, newFloors)).toEqual({
      base_height: 0.3,
    });
  });
});

describe('storey base changes carry metre-z elements', () => {
  it('raising storey 0 lifts storey-1 ducts, a riser top and a terminal with their unit, leaves storey 0 alone, in one undo step', () => {
    vi.useFakeTimers();
    try {
      const store = createGeometryStore({ defaultDefaultsPath: null });
      const { addFloor, addElements } = store.getState();
      const f0 = addFloor('Ground', 2.5, false, 0);
      const f1 = addFloor('First', 2.5, false, 1);
      store.getState().updateFloor(f0, { heightUserOverride: true });
      const ids = addElements([
        { type: 'MechanicalVentilation', name: 'MV', vent_type: 'MVHR', floorId: f1, coordinates: [{ x: 0, y: 0, z: 1 }] },
        { type: 'MechanicalVentilationDuctwork', name: 'Up', duct_type: 'supply', parent_element: 'MV', length: 3, floorId: f1,
          coordinates: [{ x: 0, y: 0, z: 2.5 }, { x: 3, y: 0, z: 2.5 }] },
        { type: 'MechanicalVentilationTerminal', name: 'T', terminal_type: 'intake', parent_element: 'MV', host_element: null,
          orientation360: 0, pitch: 90, floorId: f1, coordinates: [{ x: 5, y: 0, z: 4.9 }] },
        { type: 'MechanicalVentilationDuctwork', name: 'Down', duct_type: 'extract', parent_element: 'MV', length: 2, floorId: f0,
          coordinates: [{ x: 0, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }] },
        // A riser on the first floor's membership from the ground slab up to the first floor.
        { type: 'MechanicalVentilationDuctwork', name: 'Riser', duct_type: 'extract', parent_element: 'MV', length: 2.5, floorId: f1,
          coordinates: [{ x: 2, y: 1, z: 0 }, { x: 2, y: 1, z: 2.5 }] },
      ] as never);
      vi.runAllTimers();
      const historyBefore = store.getState().historyIndex;
      store.getState().updateFloor(f0, { height: 2.8 });
      vi.runAllTimers();
      const byName = (name: string) => Object.values(store.getState().elementsById).find((el) => el.name === name)!;
      expect(byName('Up').coordinates.map((p) => p.z)).toEqual([2.8, 2.8]);
      expect(byName('T').coordinates[0]!.z).toBe(5.2);
      expect(byName('Down').coordinates.map((p) => p.z)).toEqual([0, 0]);
      expect(byName('Riser').coordinates.map((p) => p.z)).toEqual([0, 2.8]);
      expect((byName('Riser') as { length?: number }).length).toBe(2.8);
      expect((byName('Up') as { length?: number }).length).toBe(3);
      // Still connected to the unit, now at the first floor's new base.
      const state = store.getState();
      const effective = withEffectiveStoreyHeights(state.floors, Object.values(state.elementsById));
      expect(networkPoint3(byName('MV'), effective)!.z).toBe(2.8);
      expect(store.getState().historyIndex).toBe(historyBefore + 1);
      expect(ids).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('storey base changes: each source and each storey rule', () => {
  const setup = () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const { addFloor, addZone, addElements } = store.getState();
    const f0 = addFloor('Ground', 2.5, false, 0);
    const f1 = addFloor('First', 2.5, false, 1);
    addZone({ name: 'Zone', floorArea: 20, height: 5, volume: 100 });
    const zoneId = store.getState().zones[0]!.id;
    const wall = (name: string, z: number, floorId: string, height = 2.5) => ({ type: 'BuildingElementOpaque', name, zoneId, height, width: 10,
      area: 25, pitch: 90, floorId, parent_element: null, coordinates: [{ x: -5, y: -5 + z, z }, { x: 5, y: -5 + z, z }] });
    addElements([
      wall('W0', 0, f0), wall('W1', 1, f1),
      { type: 'MechanicalVentilation', name: 'MV', vent_type: 'MVHR', floorId: f1, coordinates: [{ x: 0, y: 0, z: 1 }] },
      // Ground membership, up to the unit upstairs: its ceiling end belongs to the first floor.
      { type: 'MechanicalVentilationDuctwork', name: 'RiserG', duct_type: 'supply', parent_element: 'MV', length: 2.5, floorId: f0,
        coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2.5 }] },
      { type: 'MechanicalVentilationDuctwork', name: 'Up', duct_type: 'supply', parent_element: 'MV', length: 3, floorId: f1,
        coordinates: [{ x: 0, y: 0, z: 2.5 }, { x: 3, y: 0, z: 2.5 }] },
      // No floor recorded: the first floor by its z band.
      { type: 'ThermalBridgePoint', name: 'TBP', zoneId, heat_transfer_coeff: 0.1, coordinates: [{ x: 1, y: 1, z: 3.5 }] },
    ] as never);
    vi.runAllTimers();
    return { store, f0, wall };
  };
  const zs = (store: ReturnType<typeof setup>['store'], name: string) =>
    Object.values(store.getState().elementsById).find((el) => el.name === name)!.coordinates.map((p) => p.z);

  it('a storey height edit carries a ground-membership riser top and a floorless TB point with the first floor', () => {
    vi.useFakeTimers();
    try {
      const { store, f0 } = setup();
      store.getState().updateFloor(f0, { height: 3.0, heightUserOverride: true });
      vi.runAllTimers();
      expect(zs(store, 'RiserG')).toEqual([0, 3]);
      expect(zs(store, 'Up')).toEqual([3, 3]);
      expect(zs(store, 'TBP')).toEqual([4]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a taller wall and a ground base override cascade too', () => {
    vi.useFakeTimers();
    try {
      const { store, f0 } = setup();
      const w0 = Object.values(store.getState().elementsById).find((el) => el.name === 'W0')!;
      store.getState().updateElement(w0.id, { height: 3.0 } as never);
      vi.runAllTimers();
      expect(zs(store, 'Up')).toEqual([3, 3]);
      store.getState().updateFloor(f0, { baseHeight: 0.5, baseHeightUserOverride: true });
      vi.runAllTimers();
      expect(zs(store, 'RiserG')).toEqual([0.5, 3.5]);
      expect(zs(store, 'Up')).toEqual([3.5, 3.5]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never shifts elements added in the same batch as the change, or on load', () => {
    vi.useFakeTimers();
    try {
      const { store, f0, wall } = setup();
      store.getState().addElements([
        wall('W0b', 0, f0, 3.0),
        { type: 'MechanicalVentilationDuctwork', name: 'New', duct_type: 'supply', parent_element: 'MV', length: 3,
          floorId: store.getState().floors[1]!.id, coordinates: [{ x: 0, y: 0, z: 3 }, { x: 0, y: 3, z: 3 }] },
      ] as never);
      vi.runAllTimers();
      expect(zs(store, 'New')).toEqual([3, 3]);
      expect(zs(store, 'Up')).toEqual([3, 3]);
      const csv = store.getState().generateCSV({ allowUnresolvedMigration: true });
      const reloaded = createGeometryStore({ defaultDefaultsPath: null });
      reloaded.getState().loadFromCSV(csv);
      vi.runAllTimers();
      for (const name of ['New', 'Up', 'RiserG', 'TBP']) expect(zs(reloaded, name)).toEqual(zs(store, name));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('calculateDerivedHeight area weighting', () => {
  const square = (id: string, side: number, z: number) => ({
    id, name: id, type: 'BuildingElementGround', zoneId: 'z',
    coordinates: [{ x: 0, y: 0, z }, { x: side, y: 0, z }, { x: side, y: side, z }, { x: 0, y: side, z }],
  }) as unknown as Element;
  const deck = (id: string, width: number, depth: number, z: number) => ({
    id, name: id, type: 'BuildingElementOpaque', zoneId: 'z', pitch: 180,
    coordinates: [{ x: 0, y: 0, z }, { x: width, y: 0, z }, { x: width, y: depth, z }, { x: 0, y: depth, z }],
  }) as unknown as Element;
  const wall = (id: string, height: number, z: number) => ({
    id, name: id, type: 'BuildingElementOpaque', zoneId: 'z', pitch: 90, height, width: 4,
    coordinates: [{ x: 0, y: 0, z }, { x: 4, y: 0, z }],
  }) as unknown as Element;

  it('weights each storey by its treated floor area', () => {
    const elements = [square('g', 10, 0), deck('f', 10, 5, 1), wall('w0', 3, 0), wall('w1', 2.4, 1)];
    expect(calculateDerivedHeight('z', elements, [])).toBe(2.8);
  });

  it('ignores a level with walls but no treated floor', () => {
    const elements = [square('g', 10, 0), deck('f', 10, 5, 1), wall('w0', 3, 0), wall('w1', 2.4, 1), wall('gable', 1, 2)];
    expect(calculateDerivedHeight('z', elements, [])).toBe(2.8);
  });

  it('does not count overlapping floors twice in the weight', () => {
    const elements = [square('g', 10, 0), deck('f', 10, 10, 1), deck('f2', 10, 10, 1), wall('w0', 3, 0), wall('w1', 2.4, 1)];
    expect(calculateDerivedHeight('z', elements, [])).toBe(2.7);
  });

  it('does not read the old mean height in an older saved file as a typed height', () => {
    const csv = [
      'Zone,,,,,,,,,,,,,',
      'Name,Type,volume,floor_area,height,simplified thermal bridging',
      'Z,Zone,92.5,50,1.85,FALSE',
      '',
      'Exposed Elements,,,,,,,,,,,,,',
      'Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json',
      'W0,Z,BuildingElementOpaque,10,90,4,2.5,0,0,FALSE,FALSE,,"0,0,0|4,0,0",',
      'Gable,Z,BuildingElementOpaque,4.8,90,4,1.2,0,2.5,FALSE,FALSE,,"0,0,1|4,0,1",',
      '',
      'Ground Elements,,,,,,,,,,,,,',
      'Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,base_height,parent_element,coords,extra_json',
      'Ground Floor,Z,BuildingElementGround,50,5,10,30,Slab_no_edge_insulation,,,0,,"0,0,0|5,0,0|5,10,0|0,10,0",',
    ].join('\n');
    const store = createGeometryStore();
    store.getState().loadFromCSV(csv);
    const zone = store.getState().zones.find((candidate) => !candidate.isPlaceholder)!;
    expect(zone._heightUserOverride).toBeFalsy();
    expect(zone.height).toBe(2.5);
    expect(zone.volume).toBe(125);
  });

  it('falls back to the storey mean when no treated floor is modelled', () => {
    expect(calculateDerivedHeight('z', [wall('w0', 3, 0), wall('w1', 2.4, 1)], [])).toBe(2.7);
  });

  it('uses the storey height, so a short floating wall does not lower it', () => {
    const elements = [square('g', 10, 0), wall('w0', 2.4, 0), wall('upstand', 0.3, 0)];
    expect(calculateDerivedHeight('z', elements, [])).toBe(2.4);
  });

  it('uses a storey height typed in the floor picker', () => {
    const elements = [square('g', 10, 0), wall('w0', 2.4, 0)];
    const floors = [{ id: 'f0', name: 'Ground', zIndex: 0, height: 2.6, heightUserOverride: true }] as Floor[];
    expect(calculateDerivedHeight('z', elements, floors)).toBe(2.6);
  });

  it('updates the zone height when a storey height is typed', () => {
    const csv = [
      'Zone,,,,,,,,,,,,,',
      'Name,Type,volume,floor_area,height,simplified thermal bridging',
      'Z,Zone,125,50,2.5,FALSE',
      '',
      'Exposed Elements,,,,,,,,,,,,,',
      'Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json',
      'W0,Z,BuildingElementOpaque,10,90,4,2.5,0,0,FALSE,FALSE,,"0,0,0|4,0,0",',
      '',
      'Ground Elements,,,,,,,,,,,,,',
      'Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,base_height,parent_element,coords,extra_json',
      'Ground Floor,Z,BuildingElementGround,50,5,10,30,Slab_no_edge_insulation,,,0,,"0,0,0|5,0,0|5,10,0|0,10,0",',
    ].join('\n');
    const store = createGeometryStore();
    store.getState().loadFromCSV(csv);
    const ground = store.getState().floors.find((floor) => floor.zIndex === 0)!;
    store.getState().updateFloor(ground.id, { height: 2.8, heightUserOverride: true });
    const zone = store.getState().zones.find((candidate) => !candidate.isPlaceholder)!;
    expect(zone.height).toBe(2.8);
    expect(zone.volume).toBe(140);
  });

  it('suggests the ventilation zone height from heated storey heights', () => {
    // A 0.3 m upstand does not lower the ground storey; the loft gable level has no treated floor.
    const elements = [square('g', 10, 0), deck('f', 10, 5, 1), wall('w0', 2.4, 0), wall('upstand', 0.3, 0),
      wall('w1', 2.5, 1), wall('gable', 1, 2)];
    expect(calculateSuggestedVentilationHeight(elements, [])).toBe(4.9);
    const floors = [{ id: 'f1', name: 'First', zIndex: 1, height: 2.8, heightUserOverride: true, isRoofSpace: false }] as Floor[];
    expect(calculateSuggestedVentilationHeight(elements, floors)).toBe(5.2);
  });

  it('reads a saved ventilation zone height from the earlier suggestion as derived', () => {
    const csv = (ventHeight: number) => [
      'Metadata,,,,,,,,,,,,,',
      `AirPermeability_ventilation_zone_height,${ventHeight},,,,,,,,,,,,,`,
      '',
      'Zone,,,,,,,,,,,,,',
      'Name,Type,volume,floor_area,height,simplified thermal bridging',
      'Z,Zone,120,50,2.4,FALSE',
      '',
      'Exposed Elements,,,,,,,,,,,,,',
      'Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json',
      'W0,Z,BuildingElementOpaque,9.6,90,4,2.4,0,0,FALSE,FALSE,,"0,0,0|4,0,0",',
      'Upstand,Z,BuildingElementOpaque,1.2,90,4,0.3,0,2.1,FALSE,FALSE,,"0,5,0|4,5,0",',
      '',
      'Ground Elements,,,,,,,,,,,,,',
      'Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,base_height,parent_element,coords,extra_json',
      'Ground Floor,Z,BuildingElementGround,50,5,10,30,Slab_no_edge_insulation,,,0,,"0,0,0|5,0,0|5,10,0|0,10,0",',
    ].join('\n');
    const load = (ventHeight: number) => {
      const store = createGeometryStore();
      store.getState().loadFromCSV(csv(ventHeight));
      return store.getState().complianceSettings.AirPermeability_ventilation_zone_height;
    };
    expect(load(1.35)).toBeUndefined(); // earlier suggestion: (2.4 + 0.3) / 2
    expect(load(2.4)).toBeUndefined(); // current suggestion
    expect(load(3)).toBe(3); // typed
  });
});
