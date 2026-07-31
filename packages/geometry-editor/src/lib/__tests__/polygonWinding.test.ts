// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  buildOutwardRoomWallSegments,
  ensureCounterClockwiseKeepingLeadEdge,
  ensureCounterClockwisePolygon,
  isClockwisePolygon,
  signedPolygonArea,
} from '../polygonWinding';
import { orientation360SlopedFromFirstEdge } from '../openingSegmentOutward';

describe('polygon winding helpers', () => {
  const ccwSquare = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 1, z: 0 },
    { x: 0, y: 1, z: 0 },
  ];
  const cwSquare = [...ccwSquare].reverse();

  it('detects clockwise and counter-clockwise polygon winding', () => {
    expect(signedPolygonArea(ccwSquare)).toBeGreaterThan(0);
    expect(isClockwisePolygon(ccwSquare)).toBe(false);
    expect(signedPolygonArea(cwSquare)).toBeLessThan(0);
    expect(isClockwisePolygon(cwSquare)).toBe(true);
  });

  it('normalizes room polygons to counter-clockwise order', () => {
    expect(ensureCounterClockwisePolygon(ccwSquare)).toEqual(ccwSquare);
    expect(ensureCounterClockwisePolygon(cwSquare)).toEqual(ccwSquare);
  });

  it('builds room wall segments with counter-clockwise outward convention', () => {
    const ccwSegments = buildOutwardRoomWallSegments(ccwSquare, 2);
    expect(ccwSegments[0]).toEqual([
      { x: 0, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 },
    ]);
    expect(ccwSegments[3]).toEqual([
      { x: 0, y: 1, z: 2 },
      { x: 0, y: 0, z: 2 },
    ]);

    const correctedCwSegments = buildOutwardRoomWallSegments(cwSquare, 2);
    expect(correctedCwSegments[0]).toEqual([
      { x: 2, y: 1, z: 2 },
      { x: 0, y: 1, z: 2 },
    ]);
    expect(correctedCwSegments[3]).toEqual([
      { x: 0, y: 1, z: 2 },
      { x: 0, y: 0, z: 2 },
    ]);
  });

  it('normalizes sloped polygons by reversing the physical lead edge', () => {
    const normalized = ensureCounterClockwiseKeepingLeadEdge(cwSquare);
    expect(normalized).toEqual([
      cwSquare[1],
      cwSquare[0],
      cwSquare[3],
      cwSquare[2],
    ]);
    expect(isClockwisePolygon(normalized)).toBe(false);
  });

  it('flips sloped first-edge orientation when correcting clockwise winding', () => {
    const before = orientation360SlopedFromFirstEdge(cwSquare[0].x, cwSquare[0].y, cwSquare[1].x, cwSquare[1].y, 0);
    const normalized = ensureCounterClockwiseKeepingLeadEdge(cwSquare);
    const after = orientation360SlopedFromFirstEdge(
      normalized[0].x,
      normalized[0].y,
      normalized[1].x,
      normalized[1].y,
      0,
    );

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).toBeCloseTo(((before ?? 0) + 180) % 360, 5);
  });
});
