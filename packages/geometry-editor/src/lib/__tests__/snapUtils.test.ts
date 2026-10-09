// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { createGeometryStore } from '../../stores/geometryStore';
import { getServiceLineLengthFromCoordinates as lengthOf } from '../serviceLineDrawModes';
import {
  applyAngleSnapIfClose,
  buildGeometrySnapCache,
  buildGeometrySnapCacheFromTargets,
  constrainPointOrthogonally,
  findClosestSnapCorner,
  resolveOpeningSegmentParentFromCache,
  resolveDrawSnapPoint,
  getExactSnappedVertices,
  getWallSupportedSnappedVertices,
  planOrthogonalElbow,
  planServiceLineEndpointWelds,
  planServiceLineTeeSplits,
  pointsConnected,
  serviceNetworkSegmentFilter,
  snapCornerToOtherCornersFromCache,
} from '../snapUtils';

describe('constrainPointOrthogonally', () => {
  it('locks horizontally when horizontal travel dominates', () => {
    expect(
      constrainPointOrthogonally({ x: 4, y: 3 }, { x: 1, y: 1 }),
    ).toEqual({
      point: { x: 4, y: 1 },
      snapped: true,
    });
  });

  it('locks vertically when vertical travel dominates', () => {
    expect(
      constrainPointOrthogonally({ x: 3, y: 7 }, { x: 1, y: 1 }),
    ).toEqual({
      point: { x: 1, y: 7 },
      snapped: true,
    });
  });
});

describe('planOrthogonalElbow', () => {
  it('routes the larger move first, flips, and stays straight on-axis', () => {
    const start = { x: 0, y: 0 };
    expect(planOrthogonalElbow(start, { x: 4, y: 1 }, 2, false)).toEqual({ x: 4, y: 0 });
    expect(planOrthogonalElbow(start, { x: 4, y: 1 }, 2, true)).toEqual({ x: 0, y: 1 });
    expect(planOrthogonalElbow(start, { x: 1, y: -3 }, 2, false)).toEqual({ x: 0, y: -3 });
    expect(planOrthogonalElbow(start, { x: 4, y: 0.05 }, 2, false)).toBeNull();
  });
});

describe('planServiceLineTeeSplits', () => {
  const line = (id: string, z0: number, z1: number) =>
    ({ id, type: 'WaterPipework', pipework_type: 'primary', coordinates: [{ x: 0, y: 0, z: z0 }, { x: 4, y: 0, z: z1 }] }) as unknown as Element;
  const anyPipe = (el: Element) => el.type === 'WaterPipework';

  it('tees in plan at the segment z there, and lands near an end instead of leaving a stub', () => {
    const byId = { sloped: line('sloped', 2, 3) };
    const [tee] = planServiceLineTeeSplits(byId, anyPipe, [{ x: 1, y: 0.004, z: 0.5 }]);
    expect(tee!.point).toEqual({ x: 1, y: 0, z: 2.25 });
    expect([tee!.head![1], tee!.tail![0]]).toEqual([tee!.point, tee!.point]);
    const [nearEnd] = planServiceLineTeeSplits(byId, anyPipe, [{ x: 3.97, y: 0, z: 0.5 }]);
    expect(nearEnd).toEqual({ endIndex: 0, elementId: 'sloped', point: { x: 4, y: 0, z: 3 } });
  });

  it('keeps each network rule', () => {
    const el = (props: Record<string, unknown>) =>
      ({ type: 'MechanicalVentilationDuctwork', duct_type: 'supply', parent_element: 'MVHR', coordinates: [{}, {}], ...props }) as unknown as Element;
    const isDuct = serviceNetworkSegmentFilter({ type: 'MechanicalVentilationDuctwork', parent_element: 'MVHR', duct_type: 'supply' })!;
    const isPipe = serviceNetworkSegmentFilter({ type: 'WaterPipework', pipework_type: 'primary' })!;
    expect(isDuct(el({}))).toBe(true);
    expect(isDuct(el({ duct_type: 'extract' }))).toBe(false);
    expect(isDuct(el({ parent_element: 'Other' }))).toBe(false);
    expect(isDuct(el({ parent_element: null }))).toBe(false);
    expect(isDuct(el({ type: 'WaterPipework', pipework_type: 'primary' }))).toBe(false);
    expect(isDuct(el({ type: 'BuildingElementOpaque' }))).toBe(false);
    expect(isPipe(el({ type: 'WaterPipework', pipework_type: 'primary' }))).toBe(true);
    expect(isPipe(el({ type: 'WaterPipework', pipework_type: 'distribution' }))).toBe(false);
    expect(isPipe(el({}))).toBe(false);
    expect(serviceNetworkSegmentFilter({ type: 'MechanicalVentilationDuctwork', duct_type: 'supply' })).toBeUndefined();
  });

  it('splits a same-network duct at a mid-leg tee, applied with the branch in one history step', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const duct = (name: string, duct_type: 'supply' | 'extract') => ({
      type: 'MechanicalVentilationDuctwork' as const,
      name,
      duct_type,
      parent_element: 'MVHR',
      length: 4,
      coordinates: [{ x: 0, y: 0, z: 2 }, { x: 4, y: 3, z: 2 }],
    });
    const [mainId] = store.getState().addElements([duct('Main', 'supply'), duct('Other role', 'extract')]);
    const isNetwork = serviceNetworkSegmentFilter({
      type: 'MechanicalVentilationDuctwork',
      parent_element: 'MVHR',
      duct_type: 'supply',
    })!;
    const before = store.getState();
    expect(planServiceLineTeeSplits(before.elementsById, isNetwork, [{ x: 3.997, y: 2.998, z: 2 }])).toEqual([]);
    // A drawn end on the 0.01 m grid, a few mm off the diagonal main.
    const splits = planServiceLineTeeSplits(before.elementsById, isNetwork, [{ x: 0, y: 3, z: 2 }, { x: 1.6, y: 1.21, z: 2 }]);
    expect(splits.map((split) => [split.endIndex, split.elementId])).toEqual([[1, mainId]]);
    const [split] = splits;
    const { point, head, tail: tailCoords } = split!;
    // Exact projection: both pieces stay colinear with the main and meet the branch end.
    expect(head[1]).toEqual(point);
    expect(tailCoords[0]).toEqual(point);
    expect(point.x * 3 - point.y * 4).toBeCloseTo(0, 12);

    // As the duct draw click applies it: the head in place, then the branch and the tail together.
    before.updateElement(split!.elementId, { coordinates: head, length: lengthOf(head) }, true);
    const [branchId, tailId] = before.addElements([
      { ...duct('', 'supply'), length: 1, coordinates: [{ ...point }, { x: point.x, y: point.y + 1, z: 2 }] },
      { ...before.elementsById[mainId!]!, name: '', coordinates: tailCoords, length: lengthOf(tailCoords) } as never,
    ]);

    const after = store.getState();
    expect(after.history).toHaveLength(before.history.length + 1);
    const main = after.elementsById[mainId!]! as Element & { length: number };
    const tail = after.elementsById[tailId!]! as Element & { length: number; duct_type: string };
    expect([main.name, main.length, main.coordinates[1]]).toEqual(['Main', 2.01, point]);
    expect(after.elementsById[branchId!]!.coordinates[0]).toEqual(point);
    expect(tail.name).not.toBe('Main');
    expect([tail.length, tail.duct_type, tail.coordinates]).toEqual([2.99, 'supply', tailCoords]);
  });
});

describe('applyAngleSnapIfClose', () => {
  it('snaps a near-orthogonal segment to a cardinal direction', () => {
    const result = applyAngleSnapIfClose({ x: 4, y: 1.05 }, { x: 1, y: 1 }, 2);
    expect(result.snapped).toBe(true);
    expect(result.cardinal).toBe(0);
    expect(result.point.x).toBeCloseTo(4.0004166377355);
    expect(result.point.y).toBe(1);
  });
});

describe('snapCornerToOtherCornersFromCache', () => {
  it('returns the winning source element and source vertex order', () => {
    const elementsById = {
      first: {
        id: 'first',
        type: 'BuildingElementOpaque',
        name: 'First',
        coordinates: [
          { x: -10, y: -10, z: 0 },
          { x: -9, y: -10, z: 0 },
        ],
      },
      target: {
        id: 'target',
        type: 'BuildingElementOpaque',
        name: 'Target',
        coordinates: [
          { x: 5, y: 5, z: 0 },
          { x: 6, y: 5, z: 0 },
          { x: 6, y: 6, z: 0 },
        ],
      },
    } as unknown as Parameters<typeof buildGeometrySnapCache>[0];

    const result = snapCornerToOtherCornersFromCache(
      { x: 6.01, y: 6 },
      '__draw__',
      buildGeometrySnapCache(elementsById),
      0.05,
    );

    expect(result).toMatchObject({
      x: 6,
      y: 6,
      elementId: 'target',
      order: 4,
      sourceVertexOrder: 2,
    });
  });
});

describe('resolveDrawSnapPoint', () => {
  const tol = 0.05;
  const angleTol = 5;

  it('snaps first point to nearest wall edge', () => {
    const elementsById = {
      w1: {
        id: 'w1',
        type: 'BuildingElementPartyWall',
        name: 'p',
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
    } as any;
    const r = resolveDrawSnapPoint({
      mouseWorld: { x: 5, y: 0.02 },
      lastPoint: null,
      elementsById,
      excludeElementId: '__draw__',
      snapTol: tol,
      orthogonalModifierHeld: false,
      angleTolDeg: angleTol,
    });
    expect(r.geometrySnap).toBe(true);
    expect(r.point.x).toBeCloseTo(5);
    expect(r.point.y).toBeCloseTo(0);
    expect(r.snap).toEqual({ kind: 'parent-edge', sourceElementId: 'w1' });
  });

  it('prefers a corner over an edge when both are within tolerance', () => {
    const elementsById = {
      w1: {
        id: 'w1',
        type: 'BuildingElementOpaque',
        name: 'w',
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
      w2: {
        id: 'w2',
        type: 'BuildingElementOpaque',
        name: 'w2',
        coordinates: [
          { x: 10, y: 0, z: 0 },
          { x: 10, y: 10, z: 0 },
        ],
      },
    } as any;
    const r = resolveDrawSnapPoint({
      mouseWorld: { x: 10, y: 0.02 },
      lastPoint: { x: 2, y: 5 },
      elementsById,
      excludeElementId: '__draw__',
      snapTol: tol,
      orthogonalModifierHeld: false,
      angleTolDeg: angleTol,
    });
    expect(r.geometrySnap).toBe(true);
    expect(r.point.x).toBe(10);
    expect(r.point.y).toBe(0);
    expect(r.snap).toEqual({
      kind: 'corner',
      sourceElementId: 'w1',
      sourceVertexOrder: 1,
    });
  });

  it('with Shift orthogonal, snaps to edge on the axis-aligned ray', () => {
    const elementsById = {
      w1: {
        id: 'w1',
        type: 'BuildingElementAdjacentConditionedSpace',
        name: 'a',
        coordinates: [
          { x: 5, y: -5, z: 0 },
          { x: 5, y: 5, z: 0 },
        ],
      },
    } as any;
    const last = { x: 0, y: 0 };
    const r = resolveDrawSnapPoint({
      mouseWorld: { x: 5, y: 0.02 },
      lastPoint: last,
      elementsById,
      excludeElementId: '__draw__',
      snapTol: tol,
      orthogonalModifierHeld: true,
      angleTolDeg: angleTol,
    });
    expect(r.geometrySnap).toBe(true);
    expect(r.point.x).toBeCloseTo(5);
    expect(r.point.y).toBeCloseTo(0);
    expect(r.snap).toEqual({ kind: 'ortho-lock', sourceElementId: 'w1' });
  });

  it('returns the same result with a precomputed snap cache', () => {
    const elementsById = {
      w1: {
        id: 'w1',
        type: 'BuildingElementOpaque',
        name: 'w',
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
      w2: {
        id: 'w2',
        type: 'BuildingElementPartyWall',
        name: 'p',
        coordinates: [
          { x: 10, y: 0, z: 0 },
          { x: 10, y: 8, z: 0 },
        ],
      },
    } as any;
    const params = {
      mouseWorld: { x: 10, y: 0.03 },
      lastPoint: { x: 2, y: 5 },
      elementsById,
      excludeElementId: '__draw__',
      snapTol: tol,
      orthogonalModifierHeld: false,
      angleTolDeg: angleTol,
    };

    const uncached = resolveDrawSnapPoint(params);
    const cached = resolveDrawSnapPoint({
      ...params,
      snapCache: buildGeometrySnapCache(elementsById),
    });

    expect(cached).toEqual(uncached);
  });

  it('keeps indexed corner snapping across spatial cell boundaries', () => {
    const elementsById = {
      wall: {
        id: 'wall',
        type: 'BuildingElementOpaque',
        name: 'Wall',
        coordinates: [
          { x: 0.49, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
      },
    } as any;

    const result = resolveDrawSnapPoint({
      mouseWorld: { x: 0.51, y: 0 },
      lastPoint: null,
      elementsById,
      snapCache: buildGeometrySnapCache(elementsById),
      excludeElementId: '__draw__',
      snapTol: 0.05,
      orthogonalModifierHeld: false,
      angleTolDeg: 5,
    });

    expect(result.geometrySnap).toBe(true);
    expect(result.point).toEqual({ x: 0.49, y: 0 });
    expect(result.snap).toEqual({
      kind: 'corner',
      sourceElementId: 'wall',
      sourceVertexOrder: 0,
    });
  });

  it('identifies perpendicular-foot and cardinal tiers', () => {
    const elementsById = {
      wall: {
        id: 'wall',
        type: 'BuildingElementOpaque',
        name: 'Wall',
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
    } as unknown as Parameters<typeof buildGeometrySnapCache>[0];
    const snapCache = buildGeometrySnapCache(elementsById);

    const perpendicular = resolveDrawSnapPoint({
      mouseWorld: { x: 5, y: 0.02 },
      lastPoint: { x: 5, y: 4 },
      elementsById,
      snapCache,
      excludeElementId: '__draw__',
      snapTol: tol,
      orthogonalModifierHeld: false,
      angleTolDeg: angleTol,
    });
    expect(perpendicular.snap).toEqual({ kind: 'perp-foot', sourceElementId: 'wall' });

    const cardinal = resolveDrawSnapPoint({
      mouseWorld: { x: 4, y: 0.1 },
      lastPoint: { x: 0, y: 0 },
      elementsById: {},
      excludeElementId: '__draw__',
      snapTol: tol,
      orthogonalModifierHeld: false,
      angleTolDeg: angleTol,
    });
    expect(cardinal.snap).toEqual({ kind: 'cardinal', value: 0 });
  });

  it('identifies a plain orthogonal axis lock when no geometry tier wins', () => {
    const result = resolveDrawSnapPoint({
      mouseWorld: { x: 4, y: 1 },
      lastPoint: { x: 0, y: 0 },
      elementsById: {},
      excludeElementId: '__draw__',
      snapTol: tol,
      orthogonalModifierHeld: true,
      angleTolDeg: angleTol,
    });

    expect(result.snap).toEqual({ kind: 'ortho-lock' });
  });
});

describe('resolveOpeningSegmentParentFromCache', () => {
  it('projects a drawn opening onto an opaque wall and returns its parent name', () => {
    const elementsById = {
      wall: {
        id: 'wall',
        type: 'BuildingElementOpaque',
        name: 'Rear Wall',
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
    } as any;

    const result = resolveOpeningSegmentParentFromCache(
      [
        { x: 2, y: 0.03, z: 0 },
        { x: 4, y: 0.03, z: 0 },
      ],
      buildGeometrySnapCache(elementsById),
      elementsById,
      '__draw__',
      0.05,
    );

    expect(result?.parentName).toBe('Rear Wall');
    expect(result?.coordinates).toEqual([
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ]);
  });

  it('does not auto-parent openings to adjacent or party elements', () => {
    const elementsById = {
      adjacent: {
        id: 'adjacent',
        type: 'BuildingElementAdjacentConditionedSpace',
        name: 'Party Floor',
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
    } as any;

    const result = resolveOpeningSegmentParentFromCache(
      [
        { x: 2, y: 0.03, z: 0 },
        { x: 4, y: 0.03, z: 0 },
      ],
      buildGeometrySnapCache(elementsById),
      elementsById,
      '__draw__',
      0.05,
    );

    expect(result).toBeNull();
  });

  it('prefers an eligible opaque wall on the opening storey when walls overlap in plan', () => {
    const elementsById = {
      firstFloorWall: {
        id: 'firstFloorWall',
        type: 'BuildingElementOpaque',
        name: 'First Floor Wall',
        coordinates: [
          { x: 0, y: 0, z: 1 },
          { x: 10, y: 0, z: 1 },
        ],
      },
      groundWall: {
        id: 'groundWall',
        type: 'BuildingElementOpaque',
        name: 'Ground Wall',
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
    } as any;

    const result = resolveOpeningSegmentParentFromCache(
      [
        { x: 2, y: 0.03, z: 0 },
        { x: 4, y: 0.03, z: 0 },
      ],
      buildGeometrySnapCache(elementsById),
      elementsById,
      '__draw__',
      0.05,
    );

    expect(result?.parentName).toBe('Ground Wall');
    expect(result?.coordinates).toEqual([
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ]);
  });

  it('does not auto-parent an opening to a wall on another storey', () => {
    const elementsById = {
      firstFloorWall: {
        id: 'firstFloorWall',
        type: 'BuildingElementOpaque',
        name: 'First Floor Wall',
        coordinates: [
          { x: 0, y: 0, z: 1 },
          { x: 10, y: 0, z: 1 },
        ],
      },
    } as any;

    const result = resolveOpeningSegmentParentFromCache(
      [
        { x: 2, y: 0.03, z: 0 },
        { x: 4, y: 0.03, z: 0 },
      ],
      buildGeometrySnapCache(elementsById),
      elementsById,
      '__draw__',
      0.05,
    );

    expect(result).toBeNull();
  });
});

describe('getExactSnappedVertices', () => {
  it('treats building-element vertices as snapped when x/y match on the same storey', () => {
    const wall = {
      id: 'wall',
      type: 'BuildingElementPartyWall',
      coordinates: [
        { x: 1, y: 2, z: 0.1 },
        { x: 5, y: 2, z: 0.1 },
      ],
    } as any;
    const polygon = {
      id: 'polygon',
      type: 'BuildingElementAdjacentConditionedSpace',
      coordinates: [
        { x: 1, y: 2, z: 0.9 },
        { x: 2, y: 2, z: 0.9 },
        { x: 2, y: 3, z: 0.9 },
      ],
    } as any;

    expect(getExactSnappedVertices(wall, { wall, polygon })).toEqual(new Set([0]));
  });

  it('does not treat building-element vertices on different storeys as snapped', () => {
    const wall = {
      id: 'wall',
      type: 'BuildingElementPartyWall',
      coordinates: [
        { x: 1, y: 2, z: 0 },
        { x: 5, y: 2, z: 0 },
      ],
    } as any;
    const polygon = {
      id: 'polygon',
      type: 'BuildingElementAdjacentConditionedSpace',
      coordinates: [
        { x: 1, y: 2, z: 1 },
        { x: 2, y: 2, z: 1 },
        { x: 2, y: 3, z: 1 },
      ],
    } as any;

    expect(getExactSnappedVertices(wall, { wall, polygon })).toEqual(new Set());
  });

  it('keeps exact z matching for non-building elements', () => {
    const point = {
      id: 'point',
      type: 'Appliance',
      coordinates: [{ x: 1, y: 2, z: 0.1 }],
    } as any;
    const other = {
      id: 'other',
      type: 'Appliance',
      coordinates: [{ x: 1, y: 2, z: 0.9 }],
    } as any;

    expect(getExactSnappedVertices(point, { point, other })).toEqual(new Set());
  });

  it('only counts a duct end as snapped within its own network, not on a wall corner', () => {
    const el = (id: string, type: string, coordinates: Element['coordinates'], extra: object = {}) =>
      ({ id, type, name: id, coordinates, ...extra }) as unknown as Element;
    const wall = el('wall', 'BuildingElementOpaque', [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }]);
    const duct = el('duct', 'MechanicalVentilationDuctwork', [{ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }], {
      parent_element: 'MV',
    });
    const sibling = el('sibling', 'MechanicalVentilationDuctwork', [{ x: 2, y: 2, z: 0 }, { x: 3, y: 3, z: 0 }], {
      parent_element: 'MV',
    });

    expect(getExactSnappedVertices(duct, { wall, duct, sibling })).toEqual(new Set([1]));
    expect(getExactSnappedVertices(wall, { wall, duct, sibling })).toEqual(new Set());
  });
});

describe('getWallSupportedSnappedVertices', () => {
  it('treats same-storey polygon vertices on wall line segments as supported', () => {
    const ground = {
      id: 'ground',
      type: 'BuildingElementGround',
      coordinates: [
        { x: 2, y: 0, z: 0.8 },
        { x: 8, y: 0, z: 0.8 },
        { x: 8, y: 5, z: 0.8 },
        { x: 2, y: 5, z: 0.8 },
      ],
    } as any;
    const wallSouth = {
      id: 'wall-south',
      type: 'BuildingElementOpaque',
      coordinates: [
        { x: 0, y: 0, z: 0.1 },
        { x: 10, y: 0, z: 0.1 },
      ],
    } as any;
    const wallEast = {
      id: 'wall-east',
      type: 'BuildingElementOpaque',
      coordinates: [
        { x: 8, y: -1, z: 0.1 },
        { x: 8, y: 6, z: 0.1 },
      ],
    } as any;
    const wallNorth = {
      id: 'wall-north',
      type: 'BuildingElementPartyWall',
      coordinates: [
        { x: 10, y: 5, z: 0.1 },
        { x: 0, y: 5, z: 0.1 },
      ],
    } as any;
    const wallWest = {
      id: 'wall-west',
      type: 'BuildingElementAdjacentConditionedSpace',
      coordinates: [
        { x: 2, y: 6, z: 0.1 },
        { x: 2, y: -1, z: 0.1 },
      ],
    } as any;
    const elementsById = { ground, wallSouth, wallEast, wallNorth, wallWest };

    expect(getExactSnappedVertices(ground, elementsById)).toEqual(new Set());
    expect(getWallSupportedSnappedVertices(ground, elementsById)).toEqual(new Set([0, 1, 2, 3]));
  });

  it('does not treat a different-storey wall segment as supporting a polygon vertex', () => {
    const ground = {
      id: 'ground',
      type: 'BuildingElementGround',
      coordinates: [{ x: 5, y: 0, z: 0 }],
    } as any;
    const upperWall = {
      id: 'upper-wall',
      type: 'BuildingElementOpaque',
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 10, y: 0, z: 1 },
      ],
    } as any;

    expect(getWallSupportedSnappedVertices(ground, { ground, upperWall })).toEqual(new Set());
  });
});

describe('findClosestSnapCorner', () => {
  // Shared by ElementRenderer's 2D vertex-drag snap and GeometryCanvas3D's 3D vertex-drag snap
  // (both previously carried their own copy of this loop). findClosestSnapCorner only consumes
  // SnapCornerTarget[], so the cache is built directly from targets rather than Element fixtures.
  const cache = buildGeometrySnapCacheFromTargets(
    [
      { elementId: 'near', order: 0, sourceVertexOrder: 3, x: 1, y: 0, z: 0 },
      { elementId: 'far', order: 1, sourceVertexOrder: 4, x: 5, y: 0, z: 0 },
    ],
    [],
  );

  it('returns the closest corner within tolerance', () => {
    const result = findClosestSnapCorner({ x: 0.95, y: 0 }, cache, 0.5);
    expect(result).toMatchObject({
      x: 1,
      y: 0,
      elementId: 'near',
      sourceVertexOrder: 3,
    });
  });

  it('returns null when nothing is within tolerance', () => {
    expect(findClosestSnapCorner({ x: 3, y: 0 }, cache, 0.5)).toBeNull();
  });

  it('breaks distance ties by insertion order', () => {
    const tiedCache = buildGeometrySnapCacheFromTargets(
      [
        { elementId: 'first', order: 0, sourceVertexOrder: 0, x: 0, y: 1, z: 0 },
        { elementId: 'second', order: 1, sourceVertexOrder: 0, x: 0, y: -1, z: 0 },
      ],
      [],
    );
    const result = findClosestSnapCorner({ x: 0, y: 0 }, tiedCache, 5);
    expect(result?.elementId).toBe('first');
  });

  it('applies isExcluded and isEligible filters (the 2D/3D call-site divergence)', () => {
    // isExcluded alone (matches GeometryCanvas3D.snap3DPlanPoint's excludedElementIds set)
    expect(
      findClosestSnapCorner({ x: 1, y: 0 }, cache, 0.5, {
        isExcluded: (target) => target.elementId === 'near',
      }),
    ).toBeNull();
    // isEligible alone (matches ElementRenderer.findCornerVertexSnapTarget's same-storey gate)
    expect(
      findClosestSnapCorner({ x: 1, y: 0 }, cache, 0.5, {
        isEligible: () => false,
      }),
    ).toBeNull();
  });

  it('includes a target exactly at the tolerance boundary', () => {
    const boundaryCache = buildGeometrySnapCacheFromTargets(
      [{ elementId: 'target', order: 0, sourceVertexOrder: 0, x: 1, y: 0, z: 0 }],
      [],
    );
    expect(findClosestSnapCorner({ x: 0, y: 0 }, boundaryCache, 1)?.elementId).toBe('target');
  });
});

const wall = { type: 'BuildingElementOpaque' };
const duct = { type: 'MechanicalVentilationDuctwork' };
const unit = { type: 'MechanicalVentilation' };

describe('pointsConnected', () => {
  it('uses the storey for building pairs, exact xyz for mixed pairs and 5 mm for service pairs', () => {
    expect(pointsConnected(wall, { x: 1, y: 2, z: 0 }, wall, { x: 1, y: 2, z: 0.4 })).toBe(true);
    expect(pointsConnected(wall, { x: 1, y: 2, z: 0 }, wall, { x: 1, y: 2, z: 1 })).toBe(false);
    expect(pointsConnected(duct, { x: 1, y: 2, z: 0 }, duct, { x: 1, y: 2, z: 0.4 })).toBe(false);
    expect(pointsConnected(duct, { x: 1, y: 2, z: 0 }, wall, { x: 1, y: 2, z: 0.4 })).toBe(false);
    // A 2 dp duct end next to an unrounded unit point connects; a 1 cm miss doesn't.
    expect(pointsConnected(duct, { x: 3.14, y: 2, z: 0 }, unit, { x: 3.14159, y: 2.0031, z: 0 })).toBe(true);
    expect(pointsConnected(duct, { x: 3.13, y: 2, z: 0 }, unit, { x: 3.14159, y: 2, z: 0 })).toBe(false);
    expect(pointsConnected(wall, { x: 1, y: 2, z: 0 }, wall, { x: 1, y: 2.001, z: 0 })).toBe(false);
    expect(pointsConnected(wall, { x: 1, y: 2, z: 0 }, duct, { x: 1, y: 2.003, z: 0 })).toBe(false);
  });
});

describe('planServiceLineEndpointWelds', () => {
  it('welds duct ends onto the unit and each other, never across roles, and pipes within one type', () => {
    const ductLine = (id: string, role: string, start: { x: number; y: number }, end: { x: number; y: number }) => ({
      id, name: id, type: 'MechanicalVentilationDuctwork', duct_type: role, parent_element: 'MVHR',
      coordinates: [{ ...start, z: 0 }, { ...end, z: 0 }],
    });
    const pipeLine = (id: string, pipework_type: string, start: { x: number; y: number }, end: { x: number; y: number }) => ({
      id, name: id, type: 'WaterPipework', pipework_type, coordinates: [{ ...start, z: 0 }, { ...end, z: 0 }],
    });
    const elementsById = {
      unit: { id: 'unit', name: 'MVHR', type: 'MechanicalVentilation', coordinates: [{ x: 0, y: 0, z: 0 }] },
      // a's start is fixed on the unit; c and the exhaust x sit in one 3-end cluster with it.
      a: ductLine('a', 'supply', { x: 0.01, y: 0 }, { x: 2, y: 0 }),
      b: ductLine('b', 'supply', { x: 2.01, y: 0.01 }, { x: 2, y: 3 }),
      c: ductLine('c', 'supply', { x: 0.055, y: 0 }, { x: 0, y: -3 }),
      x: ductLine('x', 'exhaust', { x: 0.06, y: 0.02 }, { x: 0.06, y: 3 }),
      boiler: { id: 'boiler', name: 'Boiler', type: 'System', coordinates: [{ x: 5, y: 5, z: 0 }] },
      p1: pipeLine('p1', 'primary', { x: 5.02, y: 5 }, { x: 8, y: 5 }),
      p2: pipeLine('p2', 'primary', { x: 8.02, y: 5 }, { x: 8, y: 9 }),
      p3: pipeLine('p3', 'distribution', { x: 8.01, y: 5.01 }, { x: 12, y: 5 }),
    } as unknown as Record<string, Element>;

    expect(planServiceLineEndpointWelds(elementsById, ['a', 'b', 'c', 'x', 'p1', 'p2', 'p3'], 0.05)).toEqual([
      { elementId: 'a', vertexIndex: 0, newPosition: { x: 0, y: 0, z: 0 } },
      { elementId: 'b', vertexIndex: 0, newPosition: { x: 2, y: 0, z: 0 } },
      { elementId: 'c', vertexIndex: 0, newPosition: { x: 0, y: 0, z: 0 } },
      { elementId: 'p2', vertexIndex: 0, newPosition: { x: 8, y: 5, z: 0 } },
    ]);
  });
});
