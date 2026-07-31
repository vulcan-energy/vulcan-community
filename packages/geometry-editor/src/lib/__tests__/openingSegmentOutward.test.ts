// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  applyCompassOrientationToSlopedPolygonCoords,
  orientation360FromSegmentOutwardModelXY,
  orientation360SlopedFromFirstEdge,
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
});
