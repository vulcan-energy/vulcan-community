// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { WallSegment2D } from '../types';
import { extractInteriorFaceRings } from '../polygonizeInteriorFaces';
import { signedShoelaceArea2 } from '../signedArea';

const MIN_A = 1e-4;

function seg(z: number, ax: number, ay: number, bx: number, by: number): WallSegment2D {
  return { a: { x: ax, y: ay }, b: { x: bx, y: by }, wallZIndex: z };
}

function sortedAreas(rings: ReturnType<typeof extractInteriorFaceRings>): number[] {
  return rings.map((r) => Math.abs(signedShoelaceArea2(r))).sort((a, b) => a - b);
}

/**
 * Higher-complexity planar layouts for wall→space inference.
 * Complements rectangle-and-partition, bay, and imported-CSV integration coverage.
 */
describe('extractInteriorFaceRings (intricate layouts)', () => {
  it('2×2 quadrant grid: cross partitions produce four equal cells', () => {
    const z = 0;
    const segs: WallSegment2D[] = [
      seg(z, 0, 0, 8, 0),
      seg(z, 8, 0, 8, 8),
      seg(z, 8, 8, 0, 8),
      seg(z, 0, 8, 0, 0),
      seg(z, 4, 0, 4, 8),
      seg(z, 0, 4, 8, 4),
    ];
    const rings = extractInteriorFaceRings(segs, MIN_A);
    expect(rings.length).toBe(4);
    const areas = sortedAreas(rings);
    for (const a of areas) expect(a).toBeCloseTo(16, 4);
  });

  it('diagonal partition splits a square into two triangles', () => {
    const z = 0;
    const segs: WallSegment2D[] = [
      seg(z, 0, 0, 4, 0),
      seg(z, 4, 0, 4, 4),
      seg(z, 4, 4, 0, 4),
      seg(z, 0, 4, 0, 0),
      seg(z, 0, 4, 4, 0),
    ];
    const rings = extractInteriorFaceRings(segs, MIN_A);
    expect(rings.length).toBe(2);
    const areas = sortedAreas(rings);
    expect(areas[0]).toBeCloseTo(8, 4);
    expect(areas[1]).toBeCloseTo(8, 4);
  });

  it('concave L-shaped outer boundary yields one face with correct area', () => {
    const z = 0;
    const segs: WallSegment2D[] = [
      seg(z, 0, 0, 8, 0),
      seg(z, 8, 0, 8, 4),
      seg(z, 8, 4, 4, 4),
      seg(z, 4, 4, 4, 8),
      seg(z, 4, 8, 0, 8),
      seg(z, 0, 8, 0, 0),
    ];
    const rings = extractInteriorFaceRings(segs, MIN_A);
    expect(rings.length).toBe(1);
    expect(Math.abs(signedShoelaceArea2(rings[0]))).toBeCloseTo(48, 4);
  });

  it('two Tee bars on the same mid-line (two vertical stems through one horizontal)', () => {
    const z = 0;
    const segs: WallSegment2D[] = [
      seg(z, 0, 0, 10, 0),
      seg(z, 10, 0, 10, 10),
      seg(z, 10, 10, 0, 10),
      seg(z, 0, 10, 0, 0),
      seg(z, 0, 5, 10, 5),
      seg(z, 3, 5, 3, 10),
      seg(z, 7, 5, 7, 10),
    ];
    const rings = extractInteriorFaceRings(segs, MIN_A);
    expect(rings.length).toBe(4);
    const areas = sortedAreas(rings);
    // Bottom strip 10×5 = 50; top split into 3×5, 4×5, 3×5 = 15, 20, 15
    expect(areas).toEqual([15, 15, 20, 50].sort((a, b) => a - b));
  });

  /**
   * Gapped-stem regression: the vertical stem starts *above* the horizontal bar,
   * similar to short-stub T logic but on the other side of the bar.
   */
  it('T-junction with stem above the bar: three cells (short stub toward bar)', () => {
    const z = 0;
    const segs: WallSegment2D[] = [
      seg(z, 0, 0, 8, 0),
      seg(z, 8, 0, 8, 10),
      seg(z, 8, 10, 0, 10),
      seg(z, 0, 10, 0, 0),
      seg(z, 0, 5, 8, 5),
      seg(z, 4, 5.02, 4, 10),
    ];
    const rings = extractInteriorFaceRings(segs, MIN_A);
    expect(rings.length).toBe(3);
    const areas = sortedAreas(rings);
    expect(areas[0]).toBeCloseTo(20, 3);
    expect(areas[1]).toBeCloseTo(20, 3);
    expect(areas[2]).toBeCloseTo(40, 3);
  });

  it('45° partition through rectangle (two quadrilateral rooms)', () => {
    const z = 0;
    const segs: WallSegment2D[] = [
      seg(z, 0, 0, 6, 0),
      seg(z, 6, 0, 6, 4),
      seg(z, 6, 4, 0, 4),
      seg(z, 0, 4, 0, 0),
      seg(z, 0, 0, 6, 4),
    ];
    const rings = extractInteriorFaceRings(segs, MIN_A);
    expect(rings.length).toBe(2);
    const areas = sortedAreas(rings);
    expect(areas[0]).toBeCloseTo(12, 3);
    expect(areas[1]).toBeCloseTo(12, 3);
  });

  it('three parallel full-height partitions (four strip rooms)', () => {
    const z = 0;
    const segs: WallSegment2D[] = [
      seg(z, 0, 0, 8, 0),
      seg(z, 8, 0, 8, 4),
      seg(z, 8, 4, 0, 4),
      seg(z, 0, 4, 0, 0),
      seg(z, 2, 0, 2, 4),
      seg(z, 4, 0, 4, 4),
      seg(z, 6, 0, 6, 4),
    ];
    const rings = extractInteriorFaceRings(segs, MIN_A);
    expect(rings.length).toBe(4);
    const areas = sortedAreas(rings);
    for (const a of areas) expect(a).toBeCloseTo(8, 3);
  });
});
