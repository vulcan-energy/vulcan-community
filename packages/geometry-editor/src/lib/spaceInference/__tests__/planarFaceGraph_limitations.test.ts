// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { extractInteriorFaceRings } from '../polygonizeInteriorFaces';
import { signedShoelaceArea2 } from '../signedArea';
import type { WallSegment2D } from '../types';

const MIN_A = 1e-4;

function seg(z: number, ax: number, ay: number, bx: number, by: number): WallSegment2D {
  return { a: { x: ax, y: ay }, b: { x: bx, y: by }, wallZIndex: z };
}

/**
 * Documents behaviour for topologies the PRD does not fully guarantee (holes / semantics).
 */
describe('extractInteriorFaceRings (known limitations / edge cases)', () => {
  it('courtyard (outer + inner CW loop): two faces (courtyard 4 m² + outer plate 100 m²) — no true annulus ring', () => {
    const z = 0;
    const outer: WallSegment2D[] = [
      seg(z, 0, 0, 10, 0),
      seg(z, 10, 0, 10, 10),
      seg(z, 10, 10, 0, 10),
      seg(z, 0, 10, 0, 0),
    ];
    const inner: WallSegment2D[] = [
      seg(z, 4, 4, 6, 4),
      seg(z, 6, 4, 6, 6),
      seg(z, 6, 6, 4, 6),
      seg(z, 4, 6, 4, 4),
    ];
    const rings = extractInteriorFaceRings([...outer, ...inner], MIN_A);
    expect(rings.length).toBe(2);
    const areas = rings.map((r) => Math.abs(signedShoelaceArea2(r))).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(4, 3);
    expect(areas[1]).toBeCloseTo(100, 3);
  });

  it('courtyard: opposite inner winding vs CW inner — JSTS polygonize keeps both (graph-only majority filter used to drop one)', () => {
    const z = 0;
    const outer: WallSegment2D[] = [
      seg(z, 0, 0, 10, 0),
      seg(z, 10, 0, 10, 10),
      seg(z, 10, 10, 0, 10),
      seg(z, 0, 10, 0, 0),
    ];
    const innerCw: WallSegment2D[] = [
      seg(z, 4, 4, 6, 4),
      seg(z, 6, 4, 6, 6),
      seg(z, 6, 6, 4, 6),
      seg(z, 4, 6, 4, 4),
    ];
    const innerOpposite: WallSegment2D[] = [
      seg(z, 4, 4, 4, 6),
      seg(z, 4, 6, 6, 6),
      seg(z, 6, 6, 6, 4),
      seg(z, 6, 4, 4, 4),
    ];
    const ringsCw = extractInteriorFaceRings([...outer, ...innerCw], MIN_A);
    const ringsOpp = extractInteriorFaceRings([...outer, ...innerOpposite], MIN_A);
    expect(ringsCw.length).toBe(2);
    expect(ringsOpp.length).toBe(2);
    const areasOpp = ringsOpp.map((r) => Math.abs(signedShoelaceArea2(r))).sort((a, b) => a - b);
    expect(areasOpp[0]).toBeCloseTo(4, 3);
    expect(areasOpp[1]).toBeCloseTo(100, 3);
  });

  it('duplicate identical partition segment: still one partition (2 rooms); duplicate does not remove the wall', () => {
    const z = 0;
    const segs: WallSegment2D[] = [
      seg(z, 0, 0, 4, 0),
      seg(z, 4, 0, 4, 3),
      seg(z, 4, 3, 0, 3),
      seg(z, 0, 3, 0, 0),
      seg(z, 2, 0, 2, 3),
      seg(z, 2, 0, 2, 3),
    ];
    const rings = extractInteriorFaceRings(segs, MIN_A);
    expect(rings.length).toBe(2);
    const areas = rings.map((r) => Math.abs(signedShoelaceArea2(r))).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(6, 3);
    expect(areas[1]).toBeCloseTo(6, 3);
  });

  it('near‑zero length segment after refinement is dropped (no crash)', () => {
    const z = 0;
    const segs: WallSegment2D[] = [
      seg(z, 0, 0, 4, 0),
      seg(z, 4, 0, 4, 4),
      seg(z, 4, 4, 0, 4),
      seg(z, 0, 4, 0, 0),
      seg(z, 2, 2, 2.00005, 2.00005),
    ];
    const rings = extractInteriorFaceRings(segs, MIN_A);
    expect(rings.length).toBeGreaterThanOrEqual(1);
  });
});
