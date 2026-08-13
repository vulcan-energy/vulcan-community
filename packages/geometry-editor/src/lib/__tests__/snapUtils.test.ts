// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
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
