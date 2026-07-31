// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Continuous intermediate-slab E6 along external walls; complements ground E5 and opening `wall_intermediate_floor_foot`.
 */
import { describe, expect, it } from 'vitest';
import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementGround,
  BuildingElementOpaque,
  BuildingElementTransparent,
  Floor,
} from '../types';
import { proposeFacadeOpeningThermalBridges } from './proposeFacadeOpenings';
import { FOOT_ON_WALL_PERP_TOL_M } from './proposeWallGroundContinuous';
import {
  isIntermediateSlabExternalWallForContinuousTb,
  isUnheatedBasementWallForContinuousE6,
  proposeWallIntermediateContinuous,
} from './proposeWallIntermediateContinuous';

/** Ground (2.4 m) + first slab at 2.4 m; second storey slab at 4.8 m. */
const testFloors: Floor[] = [
  { id: 'f0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false },
  { id: 'f1', name: 'First', zIndex: 1, height: 2.4, isRoofSpace: false },
];

/** Plan polygon on storey z=1 sharing the north wall edge y=0 from x=0..10 with typical tests. */
function makeIntermediateSlab(overrides?: Partial<BuildingElementGround>): BuildingElementGround {
  return {
    type: 'BuildingElementGround',
    id: 'slab-f1',
    name: 'First floor slab',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 1 },
      { x: 10, y: 0, z: 1 },
      { x: 10, y: 8, z: 1 },
      { x: 0, y: 8, z: 1 },
    ],
    width: 0,
    height: 0,
    area: 80,
    total_area: 80,
    perimeter: 36,
    floor_type: 'Suspended_floor',
    ...overrides,
  } as BuildingElementGround;
}

/** Polygon internal floor (`BuildingElementAdjacentConditionedSpace`), same plan as {@link makeIntermediateSlab}. */
function makeConditionedIntermediateFloorPolygon(): BuildingElementAdjacentConditionedSpace {
  return {
    type: 'BuildingElementAdjacentConditionedSpace',
    id: 'internal-floor',
    name: 'Internal Floor',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 1 },
      { x: 10, y: 0, z: 1 },
      { x: 10, y: 8, z: 1 },
      { x: 0, y: 8, z: 1 },
    ],
    width: 0,
    height: 0,
    area: 80,
    pitch: 0,
    isPlaceholder: false,
  } as BuildingElementAdjacentConditionedSpace;
}

function makeUnheatedBasementGround(overrides?: Partial<BuildingElementGround>): BuildingElementGround {
  return {
    type: 'BuildingElementGround',
    id: 'ub',
    name: 'Unheated basement',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 8, z: 0 },
      { x: 0, y: 8, z: 0 },
    ],
    width: 0,
    height: 0,
    area: 80,
    total_area: 80,
    perimeter: 36,
    floor_type: 'Unheated_basement',
    depth_basement_floor: 2,
    extra_json: { height_basement_walls: 1 },
    ...overrides,
  } as BuildingElementGround;
}

function makeWall(
  overrides: Partial<BuildingElementOpaque> & Pick<BuildingElementOpaque, 'id' | 'name'>,
): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id: overrides.id,
    name: overrides.name,
    zoneId: overrides.zoneId ?? 'z1',
    parent_element: overrides.parent_element ?? null,
    coordinates: overrides.coordinates ?? [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ],
    width: overrides.width ?? 10,
    height: overrides.height ?? 2.5,
    area: overrides.area ?? 25,
    pitch: overrides.pitch ?? 90,
    isPlaceholder: false,
    ...(overrides.base_height !== undefined ? { base_height: overrides.base_height } : {}),
    ...(overrides.floorId !== undefined ? { floorId: overrides.floorId } : {}),
    ...overrides,
  } as BuildingElementOpaque;
}

function makeUpperWindow(
  overrides: Partial<BuildingElementTransparent> & Pick<BuildingElementTransparent, 'id' | 'name'>,
): BuildingElementTransparent {
  return {
    type: 'BuildingElementTransparent',
    id: overrides.id,
    name: overrides.name,
    zoneId: overrides.zoneId ?? 'z1',
    parent_element: overrides.parent_element ?? 'North wall',
    coordinates: overrides.coordinates ?? [
      { x: 4, y: 0, z: 1 },
      { x: 6, y: 0, z: 1 },
    ],
    width: overrides.width ?? 2,
    height: overrides.height ?? 2.4,
    area: overrides.area ?? 4.8,
    pitch: overrides.pitch ?? 90,
    isPlaceholder: false,
    floorId: overrides.floorId ?? 'f1',
    base_height: overrides.base_height ?? 2.4,
    ...overrides,
  } as BuildingElementTransparent;
}

describe('isIntermediateSlabExternalWallForContinuousTb', () => {
  it('accepts first-floor external wall when base matches that storey slab', () => {
    expect(
      isIntermediateSlabExternalWallForContinuousTb(
        makeWall({
          id: 'w',
          name: 'N',
          floorId: 'f1',
          base_height: 2.4,
          coordinates: [{ x: 0, y: 0, z: 1 }, { x: 5, y: 0, z: 1 }],
        }),
        testFloors,
      ),
    ).toBe(true);
  });

  it('rejects without floor list', () => {
    expect(
      isIntermediateSlabExternalWallForContinuousTb(
        makeWall({
          id: 'w',
          name: 'N',
          floorId: 'f1',
          base_height: 2.4,
          coordinates: [{ x: 0, y: 0, z: 1 }, { x: 5, y: 0, z: 1 }],
        }),
      ),
    ).toBe(false);
  });

  it('rejects ground-floor wall (same criteria as continuous E5)', () => {
    expect(
      isIntermediateSlabExternalWallForContinuousTb(
        makeWall({
          id: 'g',
          name: 'G',
          floorId: 'f0',
          base_height: 0,
          coordinates: [
            { x: 0, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 },
          ],
        }),
        testFloors,
      ),
    ).toBe(false);
  });

  it('rejects internal wall', () => {
    const w = {
      ...makeWall({
        id: 'w',
        name: 'I',
        floorId: 'f1',
        base_height: 2.4,
        coordinates: [{ x: 0, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }],
      }),
      location: 'internal',
    };
    expect(isIntermediateSlabExternalWallForContinuousTb(w as BuildingElementOpaque, testFloors)).toBe(false);
  });
});

describe('proposeWallIntermediateContinuous', () => {
  it('emits E6 at unheated-basement wall height for the floor over the basement', () => {
    const basement = makeUnheatedBasementGround();
    const wall = makeWall({
      id: 'wall-basement',
      name: 'Basement-linked wall',
      base_height: 1,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
    });
    expect(isIntermediateSlabExternalWallForContinuousTb(wall, testFloors)).toBe(false);
    expect(isUnheatedBasementWallForContinuousE6(wall, [basement, wall], testFloors)).toBe(true);

    const p = proposeWallIntermediateContinuous([basement, wall], [], testFloors);
    expect(p).toHaveLength(1);
    expect(p[0].edgeRole).toBe('wall_intermediate_continuous');
    expect(p[0].junctionCode).toBe('E6');
    expect(p[0].suggestedLengthM).toBe(10);
    expect(p[0].coordinates[0]).toMatchObject({ x: 0, y: 0, z: 1 });
    expect(p[0].coordinates[1]).toMatchObject({ x: 10, y: 0, z: 1 });
  });

  it('does not emit unheated-basement E6 until the wall base matches height_basement_walls', () => {
    const basement = makeUnheatedBasementGround();
    const wall = makeWall({
      id: 'wall-basement',
      name: 'Basement-linked wall',
      base_height: 0,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
    });
    expect(isUnheatedBasementWallForContinuousE6(wall, [basement, wall], testFloors)).toBe(false);
    expect(proposeWallIntermediateContinuous([basement, wall], [], testFloors)).toHaveLength(0);
  });

  it('emits one E6 run for a bare first-floor external wall at slab elevation', () => {
    const slab = makeIntermediateSlab();
    const wall = makeWall({
      id: 'wall-n',
      name: 'North wall',
      floorId: 'f1',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
    });
    const openings = proposeFacadeOpeningThermalBridges([], testFloors);
    const p = proposeWallIntermediateContinuous([slab, wall], openings, testFloors);
    expect(p).toHaveLength(1);
    expect(p[0].edgeRole).toBe('wall_intermediate_continuous');
    expect(p[0].junctionCode).toBe('E6');
    expect(p[0].suggestedLengthM).toBe(10);
    expect(p[0].coordinates[0].z).toBe(2.4);
    expect(p[0].coordinates[1].z).toBe(2.4);
  });

  it('emits E6 when the intermediate slab is a conditioned polygon (internal floor), not BuildingElementGround', () => {
    const slab = makeConditionedIntermediateFloorPolygon();
    const wall = makeWall({
      id: 'wall-n',
      name: 'North wall',
      floorId: 'f1',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
    });
    const openings = proposeFacadeOpeningThermalBridges([], testFloors);
    const p = proposeWallIntermediateContinuous([slab, wall], openings, testFloors);
    expect(p).toHaveLength(1);
    expect(p[0].junctionCode).toBe('E6');
    expect(p[0].suggestedLengthM).toBe(10);
  });

  it('uses slab elevation from floor stack (tall ground storey → slab at 3 m)', () => {
    const floors: Floor[] = [
      { id: 'a', name: 'G', zIndex: 0, height: 3, isRoofSpace: false },
      { id: 'b', name: 'F', zIndex: 1, height: 2.4, isRoofSpace: false },
    ];
    const slab = makeIntermediateSlab({
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 4, y: 0, z: 1 },
        { x: 4, y: 6, z: 1 },
        { x: 0, y: 6, z: 1 },
      ],
    });
    const wall = makeWall({
      id: 'w',
      name: 'High',
      floorId: 'b',
      base_height: 3,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 4, y: 0, z: 1 },
      ],
    });
    const p = proposeWallIntermediateContinuous([slab, wall], [], floors);
    expect(p).toHaveLength(1);
    expect(p[0].junctionCode).toBe('E6');
    expect(p[0].coordinates[0].z).toBe(3);
  });

  it('subtracts wall_intermediate_floor_foot and yields two side segments', () => {
    const slab = makeIntermediateSlab();
    const wall = makeWall({
      id: 'wall-n',
      name: 'North wall',
      floorId: 'f1',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
    });
    const win = makeUpperWindow({
      id: 'win',
      name: 'Upper',
      parent_element: 'North wall',
      coordinates: [
        { x: 4, y: 0, z: 1 },
        { x: 6, y: 0, z: 1 },
      ],
    });
    const openings = proposeFacadeOpeningThermalBridges([win], testFloors);
    expect(openings.some((x) => x.edgeRole === 'wall_intermediate_floor_foot')).toBe(true);
    const p = proposeWallIntermediateContinuous([slab, wall], openings, testFloors);
    expect(p).toHaveLength(2);
    expect(p.every((x) => x.edgeRole === 'wall_intermediate_continuous')).toBe(true);
    const lens = p.map((x) => x.suggestedLengthM).sort((a, b) => a - b);
    expect(lens).toEqual([4, 4]);
  });

  it('emits no continuous E6 when a full-width intermediate opening covers the wall', () => {
    const slab = makeIntermediateSlab();
    const wall = makeWall({
      id: 'wall-n',
      name: 'North wall',
      floorId: 'f1',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
    });
    const win = makeUpperWindow({
      id: 'full',
      name: 'Ribbon',
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
      width: 10,
    });
    const openings = proposeFacadeOpeningThermalBridges([win], testFloors);
    const p = proposeWallIntermediateContinuous([slab, wall], openings, testFloors);
    expect(p).toHaveLength(0);
  });

  it('counterfactual: misaligned foot does not subtract without host name match (full E6 length)', () => {
    const slab = makeIntermediateSlab();
    const wall = makeWall({
      id: 'wall-n',
      name: 'North wall',
      floorId: 'f1',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
    });
    const win = makeUpperWindow({
      id: 'off',
      name: 'Door',
      parent_element: 'Other',
      coordinates: [
        { x: 4, y: 0.4, z: 1 },
        { x: 6, y: 0.4, z: 1 },
      ],
    });
    const openings = proposeFacadeOpeningThermalBridges([win], testFloors);
    expect(0.4).toBeGreaterThan(FOOT_ON_WALL_PERP_TOL_M);
    const p = proposeWallIntermediateContinuous([slab, wall], openings, testFloors);
    expect(p).toHaveLength(1);
    expect(p[0].suggestedLengthM).toBe(10);
  });

  it('name-matched parent subtracts when foot is slightly off the wall line', () => {
    const slab = makeIntermediateSlab();
    const wall = makeWall({
      id: 'wall-n',
      name: 'North wall',
      floorId: 'f1',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
    });
    const win = makeUpperWindow({
      id: 'door',
      name: 'D',
      parent_element: 'North wall',
      coordinates: [
        { x: 4, y: 0.15, z: 1 },
        { x: 6, y: 0.15, z: 1 },
      ],
    });
    const openings = proposeFacadeOpeningThermalBridges([win], testFloors);
    const p = proposeWallIntermediateContinuous([slab, wall], openings, testFloors);
    expect(p).toHaveLength(2);
  });

  it('ignores intermediate foot from another zone', () => {
    const slab = makeIntermediateSlab();
    const wall = makeWall({
      id: 'wall-n',
      name: 'North wall',
      zoneId: 'z1',
      floorId: 'f1',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
    });
    const win = makeUpperWindow({
      id: 'w',
      name: 'W',
      zoneId: 'z2',
      coordinates: [
        { x: 4, y: 0, z: 1 },
        { x: 6, y: 0, z: 1 },
      ],
    });
    const openings = proposeFacadeOpeningThermalBridges([win], testFloors);
    const p = proposeWallIntermediateContinuous([slab, wall], openings, testFloors);
    expect(p).toHaveLength(1);
    expect(p[0].suggestedLengthM).toBe(10);
  });

  it('does not emit E6 for ground-only model when only ground wall exists', () => {
    const groundWall = makeWall({
      id: 'g',
      name: 'G',
      floorId: 'f0',
      base_height: 0,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 8, y: 0, z: 0 },
      ],
    });
    const p = proposeWallIntermediateContinuous([groundWall], [], testFloors);
    expect(p).toHaveLength(0);
  });

  it('emits nothing when floors are omitted', () => {
    const slab = makeIntermediateSlab();
    const wall = makeWall({
      id: 'wall-n',
      name: 'North wall',
      floorId: 'f1',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
    });
    expect(proposeWallIntermediateContinuous([slab, wall], [])).toHaveLength(0);
  });

  it('emits no E6 without a linked same-storey slab footprint (ground or conditioned polygon)', () => {
    const wall = makeWall({
      id: 'wall-n',
      name: 'North wall',
      floorId: 'f1',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
    });
    expect(proposeWallIntermediateContinuous([wall], [], testFloors)).toHaveLength(0);
  });

  it('links wall to slab via parent_element name without perimeter proximity', () => {
    const slab = makeIntermediateSlab({
      id: 'deck',
      name: 'Deck',
      coordinates: [
        { x: 200, y: 200, z: 1 },
        { x: 210, y: 200, z: 1 },
        { x: 210, y: 210, z: 1 },
        { x: 200, y: 210, z: 1 },
      ],
    });
    const wall = makeWall({
      id: 'wall-n',
      name: 'North wall',
      floorId: 'f1',
      parent_element: 'Deck',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
    });
    const p = proposeWallIntermediateContinuous([slab, wall], [], testFloors);
    expect(p).toHaveLength(1);
    expect(p[0].junctionCode).toBe('E6');
  });
});
