// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Continuous ground wall–floor (E5) runs: real geometry and counterfactuals (no false positives/negatives).
 */
import { describe, expect, it } from 'vitest';
import type { BuildingElementGround, BuildingElementOpaque, BuildingElementTransparent, Floor } from '../types';
import { proposeFacadeOpeningThermalBridges } from './proposeFacadeOpenings';
import {
  FOOT_ON_WALL_PERP_TOL_M,
  gapIntervalsAlongWall,
  isGroundContactExternalWallForContinuousTb,
  proposeWallGroundContinuous,
  wallLinkedToGroundSlabForContinuousE5,
} from './proposeWallGroundContinuous';

function makeGround(
  overrides: Partial<BuildingElementGround> & Pick<BuildingElementGround, 'id' | 'name'>,
): BuildingElementGround {
  return {
    type: 'BuildingElementGround',
    id: overrides.id ?? 'gnd-1',
    name: overrides.name ?? 'Floor',
    zoneId: overrides.zoneId ?? 'z1',
    parent_element: null,
    coordinates: overrides.coordinates ?? [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
    ],
    width: 10,
    height: 0,
    area: 100,
    total_area: 100,
    perimeter: 40,
    floor_type: 'Slab_no_edge_insulation',
    isPlaceholder: false,
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
    ...overrides,
  } as BuildingElementOpaque;
}

function makeGroundWindow(
  overrides: Partial<BuildingElementTransparent> & Pick<BuildingElementTransparent, 'id' | 'name'>,
): BuildingElementTransparent {
  return {
    type: 'BuildingElementTransparent',
    id: overrides.id,
    name: overrides.name,
    zoneId: overrides.zoneId ?? 'z1',
    parent_element: overrides.parent_element ?? 'South wall',
    coordinates: overrides.coordinates ?? [
      { x: 4, y: 0, z: 0 },
      { x: 6, y: 0, z: 0 },
    ],
    width: overrides.width ?? 2,
    height: overrides.height ?? 2.4,
    area: overrides.area ?? 4.8,
    pitch: overrides.pitch ?? 90,
    isPlaceholder: false,
    ...overrides,
  } as BuildingElementTransparent;
}

describe('gapIntervalsAlongWall', () => {
  it('returns full length when nothing is covered', () => {
    expect(gapIntervalsAlongWall(10, [])).toEqual([[0, 10]]);
  });

  it('returns empty when one interval covers the entire wall', () => {
    expect(gapIntervalsAlongWall(10, [[0, 10]])).toEqual([]);
  });

  it('splits when the middle is covered', () => {
    expect(gapIntervalsAlongWall(10, [[4, 6]])).toEqual([
      [0, 4],
      [6, 10],
    ]);
  });

  it('merges overlapping foot intervals before subtracting', () => {
    expect(
      gapIntervalsAlongWall(10, [
        [2, 4],
        [3, 5],
      ]),
    ).toEqual([
      [0, 2],
      [5, 10],
    ]);
  });

  it('drops fragments shorter than the minimum segment length', () => {
    expect(gapIntervalsAlongWall(10, [[0, 9.97]])).toEqual([]);
  });
});

describe('isGroundContactExternalWallForContinuousTb', () => {
  it('accepts a typical ground-floor external wall', () => {
    expect(isGroundContactExternalWallForContinuousTb(makeWall({ id: 'w', name: 'S' }))).toBe(true);
  });

  it('rejects walls with floor index z ≥ 1 (upper storey)', () => {
    expect(
      isGroundContactExternalWallForContinuousTb(
        makeWall({
          id: 'w',
          name: 'Upper',
          coordinates: [
            { x: 0, y: 0, z: 1 },
            { x: 5, y: 0, z: 1 },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('rejects internal partition walls', () => {
    const w = {
      ...makeWall({ id: 'w', name: 'Int' }),
      location: 'internal',
    };
    expect(isGroundContactExternalWallForContinuousTb(w as BuildingElementOpaque)).toBe(false);
  });
});

describe('proposeWallGroundContinuous', () => {
  it('emits one E5 run for a bare ground external wall (no openings)', () => {
    const ground = makeGround({ id: 'g', name: 'Floor' });
    const wall = makeWall({ id: 'wall-s', name: 'South wall' });
    const openings = proposeFacadeOpeningThermalBridges([]);
    const p = proposeWallGroundContinuous([ground, wall], openings);
    expect(p).toHaveLength(1);
    expect(p[0].edgeRole).toBe('wall_ground_continuous');
    expect(p[0].junctionCode).toBe('E5');
    expect(p[0].suggestedLengthM).toBe(10);
    expect(p[0].coordinates[0]).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(p[0].coordinates[1]).toMatchObject({ x: 10, y: 0, z: 0 });
  });

  it('uses suspended floor upper surface for continuous E5 elevation', () => {
    const ground = makeGround({
      id: 'g',
      name: 'Suspended floor',
      floor_type: 'Suspended_floor',
      extra_json: { height_upper_surface: 0.15 },
    });
    const wall = makeWall({ id: 'wall-s', name: 'South wall', base_height: 0.15 });
    const p = proposeWallGroundContinuous([ground, wall], []);
    expect(p).toHaveLength(1);
    expect(p[0].coordinates[0]).toMatchObject({ x: 0, y: 0, z: 0.15 });
    expect(p[0].coordinates[1]).toMatchObject({ x: 10, y: 0, z: 0.15 });
  });

  it('uses explicit slab elevation for continuous E5 elevation', () => {
    const ground = makeGround({
      id: 'g',
      name: 'Raised slab',
      _base_height: 0.3,
    });
    const wall = makeWall({ id: 'wall-s', name: 'South wall', base_height: 0.3 });
    const p = proposeWallGroundContinuous([ground, wall], []);
    expect(p).toHaveLength(1);
    expect(p[0].coordinates[0]).toMatchObject({ x: 0, y: 0, z: 0.3 });
    expect(p[0].coordinates[1]).toMatchObject({ x: 10, y: 0, z: 0.3 });
  });

  it('uses the linked ground slab storey elevation even when it is authored off storey 0', () => {
    const floors: Floor[] = [
      { id: 'f0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false },
      { id: 'f1', name: 'Raised ground slab', zIndex: 1, height: 2.4, isRoofSpace: false },
    ];
    const ground = makeGround({
      id: 'g',
      name: 'Raised ground slab',
      floorId: 'f1',
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
        { x: 10, y: 10, z: 1 },
        { x: 0, y: 10, z: 1 },
      ],
    });
    const wall = makeWall({
      id: 'wall-s',
      name: 'South wall',
      parent_element: 'Raised ground slab',
      floorId: 'f1',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
    });

    const p = proposeWallGroundContinuous([ground, wall], [], floors);
    expect(p).toHaveLength(1);
    expect(p[0].junctionCode).toBe('E5');
    expect(p[0].coordinates.every((point) => point.z === 2.4)).toBe(true);
  });

  it('adds explicit slab elevation to suspended floor upper surface for continuous E5 elevation', () => {
    const ground = makeGround({
      id: 'g',
      name: 'Raised suspended floor',
      floor_type: 'Suspended_floor',
      _base_height: 0.3,
      extra_json: { height_upper_surface: 0.15 },
    });
    const wall = makeWall({ id: 'wall-s', name: 'South wall', base_height: 0.45 });
    const p = proposeWallGroundContinuous([ground, wall], []);
    expect(p).toHaveLength(1);
    expect(p[0].coordinates[0]).toMatchObject({ x: 0, y: 0, z: 0.45 });
    expect(p[0].coordinates[1]).toMatchObject({ x: 10, y: 0, z: 0.45 });
  });

  it('does not emit suspended floor E5 when the external wall base remains at ground level', () => {
    const ground = makeGround({
      id: 'g',
      name: 'Suspended floor',
      floor_type: 'Suspended_floor',
      extra_json: { height_upper_surface: 0.15 },
    });
    const wall = makeWall({ id: 'wall-s', name: 'South wall', base_height: 0 });
    expect(proposeWallGroundContinuous([ground, wall], [])).toHaveLength(0);
  });

  it('does not emit E5 for basement ground hosts', () => {
    const ground = makeGround({
      id: 'g',
      name: 'Basement floor',
      floor_type: 'Heated_basement',
      depth_basement_floor: 2.8,
    });
    const wall = makeWall({
      id: 'wall-s',
      name: 'South wall',
      parent_element: 'Basement floor',
      base_height: 0,
    });
    expect(wallLinkedToGroundSlabForContinuousE5(wall, [ground, wall])).toBe(false);
    expect(proposeWallGroundContinuous([ground, wall], [])).toHaveLength(0);
  });

  it('subtracts a ground opening foot and yields two side segments', () => {
    const ground = makeGround({ id: 'g', name: 'Floor' });
    const wall = makeWall({ id: 'wall-s', name: 'South wall' });
    const win = makeGroundWindow({
      id: 'door',
      name: 'Patio',
      parent_element: 'South wall',
      coordinates: [
        { x: 4, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
      ],
    });
    const openings = proposeFacadeOpeningThermalBridges([win]);
    const p = proposeWallGroundContinuous([ground, wall], openings);
    expect(openings.some((x) => x.edgeRole === 'wall_ground_foot')).toBe(true);
    expect(p).toHaveLength(2);
    const lens = p.map((x) => x.suggestedLengthM).sort((a, b) => a - b);
    expect(lens).toEqual([4, 4]);
    expect(p.every((x) => x.edgeRole === 'wall_ground_continuous')).toBe(true);
  });

  it('emits no continuous runs when a full-width ground opening consumes the whole wall', () => {
    const ground = makeGround({ id: 'g', name: 'Floor' });
    const wall = makeWall({ id: 'wall-s', name: 'South wall' });
    const win = makeGroundWindow({
      id: 'full',
      name: 'Shopfront',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      width: 10,
    });
    const openings = proposeFacadeOpeningThermalBridges([win]);
    const p = proposeWallGroundContinuous([ground, wall], openings);
    expect(p).toHaveLength(0);
  });

  it('does not subtract a foot that is offset from the wall line (counterfactual: no silent merge)', () => {
    const ground = makeGround({ id: 'g', name: 'Floor' });
    const wall = makeWall({ id: 'wall-s', name: 'South wall' });
    const win = makeGroundWindow({
      id: 'off',
      name: 'Offset door',
      parent_element: 'Other wall',
      coordinates: [
        { x: 4, y: 0.4, z: 0 },
        { x: 6, y: 0.4, z: 0 },
      ],
    });
    const openings = proposeFacadeOpeningThermalBridges([win]);
    const p = proposeWallGroundContinuous([ground, wall], openings);
    /** Perpendicular > FOOT_ON_WALL_PERP_TOL_M and parent name mismatch → no subtract. */
    expect(0.4).toBeGreaterThan(FOOT_ON_WALL_PERP_TOL_M);
    expect(p).toHaveLength(1);
    expect(p[0].suggestedLengthM).toBe(10);
  });

  it('subtracts using host wall name when the foot is slightly off the wall line', () => {
    const ground = makeGround({ id: 'g', name: 'Floor' });
    const wall = makeWall({ id: 'wall-s', name: 'South wall' });
    const win = makeGroundWindow({
      id: 'off',
      name: 'Door',
      parent_element: 'South wall',
      coordinates: [
        { x: 4, y: 0.15, z: 0 },
        { x: 6, y: 0.15, z: 0 },
      ],
    });
    const openings = proposeFacadeOpeningThermalBridges([win]);
    const p = proposeWallGroundContinuous([ground, wall], openings);
    expect(0.15).toBeGreaterThan(FOOT_ON_WALL_PERP_TOL_M);
    expect(p).toHaveLength(2);
    const lens = p.map((x) => x.suggestedLengthM).sort((a, b) => a - b);
    expect(lens).toEqual([4, 4]);
  });

  it('ignores wall_ground_foot from another zone', () => {
    const ground = makeGround({ id: 'g', name: 'Floor', zoneId: 'z1' });
    const wall = makeWall({ id: 'wall-s', name: 'South wall', zoneId: 'z1' });
    const win = makeGroundWindow({
      id: 'door',
      name: 'D',
      zoneId: 'z2',
      coordinates: [
        { x: 4, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
      ],
    });
    const openings = proposeFacadeOpeningThermalBridges([win]);
    const p = proposeWallGroundContinuous([ground, wall], openings);
    expect(p).toHaveLength(1);
    expect(p[0].suggestedLengthM).toBe(10);
  });

  it('emits no E5 when the wall is not linked to a ground slab (regression: annex segment off slab)', () => {
    const ground = makeGround({ id: 'g', name: 'Floor' });
    const wall = makeWall({
      id: 'wall-8',
      name: 'Wall 8',
      coordinates: [
        { x: -5.9, y: -5.7, z: 0 },
        { x: -9.06, y: -5.52, z: 0 },
      ],
      width: 3.17,
      height: 2.5,
      area: 8,
    });
    const openings = proposeFacadeOpeningThermalBridges([]);
    const p = proposeWallGroundContinuous([ground, wall], openings);
    expect(p).toHaveLength(0);
    expect(wallLinkedToGroundSlabForContinuousE5(wall, [ground, wall])).toBe(false);
  });

  it('emits no E5 when wall height and area are both zero even if nominally external', () => {
    const ground = makeGround({ id: 'g', name: 'Floor' });
    const wall = makeWall({
      id: 'w0',
      name: 'Degenerate',
      height: 0,
      area: 0,
    });
    const openings = proposeFacadeOpeningThermalBridges([]);
    const p = proposeWallGroundContinuous([ground, wall], openings);
    expect(p).toHaveLength(0);
  });

  it('accepts E5 when parent_element names the ground slab', () => {
    const ground = makeGround({ id: 'g', name: 'Main floor' });
    const wall = makeWall({
      id: 'w1',
      name: 'South wall',
      parent_element: 'Main floor',
      coordinates: [
        { x: 0, y: -2, z: 0 },
        { x: 10, y: -2, z: 0 },
      ],
    });
    expect(wallLinkedToGroundSlabForContinuousE5(wall, [ground, wall])).toBe(true);
  });
});
