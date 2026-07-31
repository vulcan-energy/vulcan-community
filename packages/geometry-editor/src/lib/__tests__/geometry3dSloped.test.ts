// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { computeSlopedPolygonInwardNormal2D, elevationAtSlopedVertexM } from '../geometry3dSloped';

describe('computeSlopedPolygonInwardNormal2D', () => {
  it('points upslope into the interior for a rectangle whose first edge is the bottom', () => {
    const pts: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ];
    const n = computeSlopedPolygonInwardNormal2D(pts);
    expect(n).not.toBeNull();
    expect(n![0]).toBeCloseTo(0, 5);
    expect(n![1]).toBeCloseTo(1, 5);
  });
});

describe('elevationAtSlopedVertexM', () => {
  it('is flat on the eaves line and rises with perpendicular run', () => {
    const eaves: [number, number] = [0, 0];
    const inward: [number, number] = [0, 1];
    const h0 = elevationAtSlopedVertexM([0, 0], eaves, inward, 2.4, 45);
    const h1 = elevationAtSlopedVertexM([0, 1], eaves, inward, 2.4, 45);
    expect(h0).toBe(2.4);
    expect(h1).toBeCloseTo(2.4 + Math.tan(Math.PI / 4), 5);
  });
});
