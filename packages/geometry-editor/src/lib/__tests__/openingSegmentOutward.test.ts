// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  applyCompassOrientationToLineCoords,
  applyCompassOrientationToSlopedPolygonCoords,
  orientation360FromSegmentOutwardModelXY,
  orientation360SlopedFromFirstEdge,
  polygonEdgePerpendicularBearings,
  rotatePolygonPlanXYAroundFirstVertex,
  segmentTangentAndOpeningOutwardModelXY,
} from '../openingSegmentOutward';

/** Outward-facing wall/sloped orientation: outward normal azimuth minus global offset. */
function orientation360WallLineSegmentLikeOutward(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  globalOrientationOffset = 0,
): number | null {
  const outward = orientation360FromSegmentOutwardModelXY(ax, ay, bx, by, 0);
  if (outward === null) return null;
  return ((outward - globalOrientationOffset + 360) % 360 + 360) % 360;
}

describe('orientation360SlopedFromFirstEdge', () => {
  const offset = 0;

  it('matches outward-facing wall convention on cardinal runs', () => {
    expect(orientation360SlopedFromFirstEdge(0, 0, -1, 0, offset)).toBeCloseTo(0, 5);
    expect(orientation360FromSegmentOutwardModelXY(0, 0, -1, 0, 0)).toBeCloseTo(0, 5);

    expect(orientation360SlopedFromFirstEdge(0, 0, 0, 1, offset)).toBeCloseTo(90, 5);
    expect(orientation360FromSegmentOutwardModelXY(0, 0, 0, 1, 0)).toBeCloseTo(90, 5);

    expect(orientation360SlopedFromFirstEdge(0, 0, 1, 0, offset)).toBeCloseTo(180, 5);
    expect(orientation360FromSegmentOutwardModelXY(0, 0, 1, 0, 0)).toBeCloseTo(180, 5);

    expect(orientation360SlopedFromFirstEdge(0, 0, 0, -1, offset)).toBeCloseTo(270, 5);
    expect(orientation360FromSegmentOutwardModelXY(0, 0, 0, -1, 0)).toBeCloseTo(270, 5);
  });

  it('sloped equals outward-facing wall orientation minus offset', () => {
    const ax = 2;
    const ay = 3;
    const bx = 7;
    const by = 3;
    const o = 15;
    const sloped = orientation360SlopedFromFirstEdge(ax, ay, bx, by, o);
    const wallLike = orientation360WallLineSegmentLikeOutward(ax, ay, bx, by, o);
    expect(sloped).toBeCloseTo(wallLike ?? 0, 4);
  });

  it('wall line helper matches outward-normal orientation for the same segment', () => {
    const ax = 2;
    const ay = 3;
    const bx = 7;
    const by = 3;
    const o = 15;
    const wallLike = orientation360WallLineSegmentLikeOutward(ax, ay, bx, by, o);
    const expected = (180 - o + 360) % 360;
    expect(wallLike).toBeCloseTo(expected, 4);
  });

  it('openingOutward is perpendicular to tangent (unchanged chirality)', () => {
    const { tangent, openingOutward } = segmentTangentAndOpeningOutwardModelXY(0, 0, 1, 0);
    const dot = tangent[0] * openingOutward[0] + tangent[1] * openingOutward[1];
    expect(dot).toBeCloseTo(0, 8);
  });
});

describe('polygonEdgePerpendicularBearings', () => {
  it('offers both square alignments per edge, roled by which end of the plane the edge lands on', () => {
    const bearings = polygonEdgePerpendicularBearings([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ], 0);

    expect(bearings).toEqual([
      { edgeIndex: 0, bearing: 180, edgeRole: 'low' },
      { edgeIndex: 0, bearing: 0, edgeRole: 'top' },
      { edgeIndex: 1, bearing: 90, edgeRole: 'low' },
      { edgeIndex: 1, bearing: 270, edgeRole: 'top' },
      { edgeIndex: 2, bearing: 0, edgeRole: 'low' },
      { edgeIndex: 2, bearing: 180, edgeRole: 'top' },
      { edgeIndex: 3, bearing: 270, edgeRole: 'low' },
      { edgeIndex: 3, bearing: 90, edgeRole: 'top' },
    ]);
  });

  it('reaches the apex-down alignment a bottom-edge-only set cannot', () => {
    // Falling north off this triangle's bottom edge hinges the plane on the far
    // apex, which is the alignment the outward-normal-only set never offered.
    const bearings = polygonEdgePerpendicularBearings([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 3 },
    ], 0);

    expect(bearings).toContainEqual({ edgeIndex: 0, bearing: 180, edgeRole: 'low' });
    expect(bearings).toContainEqual({ edgeIndex: 0, bearing: 0, edgeRole: 'top' });
  });

  it('roles the same bearing identically whichever way the polygon is wound', () => {
    const clockwise = polygonEdgePerpendicularBearings([
      { x: 0, y: 0 },
      { x: 2, y: 3 },
      { x: 4, y: 0 },
    ], 0);

    // The bottom edge is traversed 4,0 -> 0,0 here, flipping the formula's normal;
    // the roles must still describe the geometry, not the winding.
    expect(clockwise).toContainEqual({ edgeIndex: 2, bearing: 180, edgeRole: 'low' });
    expect(clockwise).toContainEqual({ edgeIndex: 2, bearing: 0, edgeRole: 'top' });
  });

  it('subtracts the site offset, the way the store derives orientation360', () => {
    const bearings = polygonEdgePerpendicularBearings([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 3 },
    ], 30);

    // The bottom edge's outward normal is geometric 180; stored space is
    // geometric − offset, and downslopeUnitModelXY adds the offset back when it
    // points the arrow. Adding it here instead would be wrong by twice the offset.
    expect(bearings).toContainEqual({ edgeIndex: 0, bearing: 150, edgeRole: 'low' });
    expect(bearings).toContainEqual({ edgeIndex: 0, bearing: 330, edgeRole: 'top' });
  });

  it('offers nothing for an edge that is neither end of the plane', () => {
    // Concave L. Falling east squares off both edge 3 and edge 5, but only edge 5
    // is the top of the plane; edge 3 sits mid-plane, where a centroid test
    // mislabels it as the top and highlights the wrong edge.
    const bearings = polygonEdgePerpendicularBearings([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 6 },
      { x: 0, y: 6 },
    ], 0);

    expect(bearings).toContainEqual({ edgeIndex: 5, bearing: 90, edgeRole: 'top' });
    expect(bearings.filter((entry) => entry.edgeIndex === 3)).toEqual([]);
  });

  it('returns nothing for a ring that encloses no plane', () => {
    expect(polygonEdgePerpendicularBearings([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0)).toEqual([]);
    expect(polygonEdgePerpendicularBearings([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ], 0)).toEqual([]);
  });
});

describe('applyCompassOrientationToSlopedPolygonCoords', () => {
  const z = 0;
  // Unit square: first edge (0,0)→(1,0) is eastward → outward-facing orientation 180° (offset 0).
  const unitSquare: Array<{ x: number; y: number; z: number }> = [
    { x: 0, y: 0, z },
    { x: 1, y: 0, z },
    { x: 1, y: 1, z },
    { x: 0, y: 1, z },
  ];

  it('rotates in plan so first-edge sloped compass matches the target', () => {
    const rotated = applyCompassOrientationToSlopedPolygonCoords(unitSquare, 90, 0);
    expect(rotated).not.toBeNull();
    const [A, B] = rotated!;
    const o = orientation360SlopedFromFirstEdge(A.x, A.y, B.x, B.y, 0);
    expect(o).toBeCloseTo(90, 4);
  });

  it('is identity when the polygon already matches the desired orientation', () => {
    const rotated = applyCompassOrientationToSlopedPolygonCoords(unitSquare, 180, 0);
    expect(rotated).not.toBeNull();
    expect(rotated!.map((p) => ({ x: p.x, y: p.y }))).toEqual(unitSquare.map((p) => ({ x: p.x, y: p.y })));
  });

  it('preserves Z on every vertex', () => {
    const withZ = unitSquare.map((p, i) => ({ ...p, z: i }));
    const rotated = applyCompassOrientationToSlopedPolygonCoords(withZ, 45, 0);
    expect(rotated).not.toBeNull();
    rotated!.forEach((p, i) => expect(p.z).toBe(i));
  });

  it('rotatePolygonPlanXYAroundFirstVertex moves the second vertex CCW as expected', () => {
    const tri = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
    ];
    const r = rotatePolygonPlanXYAroundFirstVertex(tri, 90);
    expect(r[1].x).toBeCloseTo(0, 5);
    expect(r[1].y).toBeCloseTo(1, 5);
  });

  it('matches the inspector rotation about vertex 0 for the same target bearing', () => {
    const snapshot = [
      { x: 3, y: 4, z: 0 },
      { x: 5, y: 4, z: 1 },
      { x: 5, y: 6, z: 2 },
      { x: 3, y: 6, z: 3 },
    ];
    const expectedInspectorCoordinates = rotatePolygonPlanXYAroundFirstVertex(snapshot, 90);

    expect(applyCompassOrientationToSlopedPolygonCoords(snapshot, 75, 15)).toEqual(
      expectedInspectorCoordinates,
    );
    expect(expectedInspectorCoordinates[0]).toEqual(snapshot[0]);
  });

});

describe('applyCompassOrientationToLineCoords', () => {
  it('keeps A fixed, moves B to the stored bearing, and preserves length', () => {
    const coordinates: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }] = [
      { x: 2, y: 3, z: 4 },
      { x: 5, y: 7, z: 9 },
    ];
    const rotated = applyCompassOrientationToLineCoords(coordinates, 40, 25);

    expect(rotated).not.toBeNull();
    expect(rotated?.[0]).toBe(coordinates[0]);
    expect(Math.hypot(rotated![1].x - rotated![0].x, rotated![1].y - rotated![0].y)).toBeCloseTo(5, 12);
    expect(rotated?.[1].z).toBe(9);
    const geometricBearing = orientation360FromSegmentOutwardModelXY(
      rotated![0].x,
      rotated![0].y,
      rotated![1].x,
      rotated![1].y,
      0,
    );
    expect(geometricBearing).not.toBeNull();
    expect(((geometricBearing! - 25) + 360) % 360).toBeCloseTo(40, 12);
  });
});
