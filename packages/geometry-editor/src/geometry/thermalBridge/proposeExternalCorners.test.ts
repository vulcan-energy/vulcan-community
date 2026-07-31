// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * External-corner TB proposals from closed external wall loops (plan).
 */
import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, Element } from '../types';
import { proposeExternalCornerThermalBridges } from './proposeExternalCorners';

function makeWall(
  id: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  overrides: Partial<BuildingElementOpaque> & { zoneId?: string } = {},
): BuildingElementOpaque {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  return {
    type: 'BuildingElementOpaque',
    id,
    name: `Wall ${id}`,
    zoneId: overrides.zoneId ?? 'z1',
    parent_element: null,
    coordinates: [
      { x: x0, y: y0, z: 0 },
      { x: x1, y: y1, z: 0 },
    ],
    width: len,
    height: overrides.height ?? 2.5,
    area: len * (overrides.height ?? 2.5),
    pitch: 90,
    isPlaceholder: false,
    ...overrides,
  } as BuildingElementOpaque;
}

/**
 * One wall per edge of a **simple** CCW closed polygon in plan (`ring.length` ≥ 3, first point not repeated).
 * Edges may be axis-aligned or diagonal; last edge closes back to the first vertex.
 */
function wallsFromPlanRing(ids: string[], ring: Array<[number, number]>, zoneId = 'z1'): Element[] {
  if (ring.length < 3 || ids.length !== ring.length) {
    throw new Error('wallsFromPlanRing: need ids.length === ring.length >= 3');
  }
  const walls: Element[] = [];
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[j]!;
    walls.push(makeWall(ids[i]!, x0, y0, x1, y1, { zoneId }));
  }
  return walls;
}

describe('proposeExternalCornerThermalBridges', () => {
  it('collapses duplicate parallel storey walls so convex corners are still classified (semi-detached footprint)', () => {
    const ground = [
      makeWall('g0', 0, 0, 10, 0),
      makeWall('g1', 10, 0, 10, 10),
      makeWall('g2', 10, 10, 0, 10),
      makeWall('g3', 0, 10, 0, 0),
    ];
    const upperSamePlan = [
      makeWall('u0', 0, 0, 10, 0, { height: 2.8 }),
      makeWall('u1', 10, 0, 10, 10, { height: 2.8 }),
      makeWall('u2', 10, 10, 0, 10, { height: 2.8 }),
      makeWall('u3', 0, 10, 0, 0, { height: 2.8 }),
    ];
    const p = proposeExternalCornerThermalBridges([...ground, ...upperSamePlan]);
    expect(p).toHaveLength(4);
    expect(p.every((x) => x.junctionCode === 'E16')).toBe(true);
  });

  it('proposes four E16 corners for a square closed loop (CCW)', () => {
    const walls: Element[] = [
      makeWall('a', 0, 0, 10, 0),
      makeWall('b', 10, 0, 10, 10),
      makeWall('c', 10, 10, 0, 10),
      makeWall('d', 0, 10, 0, 0),
    ];
    const p = proposeExternalCornerThermalBridges(walls);
    expect(p).toHaveLength(4);
    expect(p.every((x) => x.junctionCode === 'E16')).toBe(true);
    expect(p.every((x) => x.edgeRole === 'external_corner_convex')).toBe(true);
  });

  it('clips corner vertical extent to the overlap of the two host walls (not zone height)', () => {
    const walls: Element[] = [
      makeWall('a', 0, 0, 10, 0, { height: 2.5 }),
      makeWall('b', 10, 0, 10, 10, { height: 2.5 }),
      makeWall('c', 10, 10, 0, 10, { height: 2.5 }),
      makeWall('d', 0, 10, 0, 0, { height: 1.5 }),
    ];
    const p = proposeExternalCornerThermalBridges(walls);
    const atOrigin = p.find((x) => Math.hypot(x.coordinates[0].x, x.coordinates[0].y) < 1e-3);
    expect(atOrigin).toBeDefined();
    expect(atOrigin!.coordinates[0].z).toBeCloseTo(0);
    expect(atOrigin!.coordinates[1].z).toBeCloseTo(1.5);
    expect(atOrigin!.suggestedLengthM).toBeCloseTo(1.5);
  });

  it('honours negative base_height for below-ground basement wall corners', () => {
    const walls: Element[] = [
      makeWall('a', 0, 0, 10, 0, { base_height: -2.8, height: 2.8 }),
      makeWall('b', 10, 0, 10, 10, { base_height: -2.8, height: 2.8 }),
      makeWall('c', 10, 10, 0, 10, { base_height: -2.8, height: 2.8 }),
      makeWall('d', 0, 10, 0, 0, { base_height: -2.8, height: 2.8 }),
    ];
    const p = proposeExternalCornerThermalBridges(walls);
    expect(p).toHaveLength(4);
    expect(p.every((x) => x.coordinates[0].z === -2.8)).toBe(true);
    expect(p.every((x) => x.coordinates[1].z === 0)).toBe(true);
  });

  it('proposes one E17 at the reflex vertex of an L-shaped loop', () => {
    /** CCW L: reflex (re-entrant plan corner) at (2,2). */
    const walls: Element[] = [
      makeWall('e1', 0, 0, 6, 0),
      makeWall('e2', 6, 0, 6, 4),
      makeWall('e3', 6, 4, 2, 4),
      makeWall('e4', 2, 4, 2, 2),
      makeWall('e5', 2, 2, 0, 2),
      makeWall('e6', 0, 2, 0, 0),
    ];
    const p = proposeExternalCornerThermalBridges(walls);
    expect(p).toHaveLength(6);
    const e17 = p.filter((x) => x.junctionCode === 'E17');
    const e16 = p.filter((x) => x.junctionCode === 'E16');
    expect(e17).toHaveLength(1);
    expect(e16).toHaveLength(5);
    expect(e17[0]!.coordinates[0].x).toBeCloseTo(2, 5);
    expect(e17[0]!.coordinates[0].y).toBeCloseTo(2, 5);
    expect(e17[0]!.edgeRole).toBe('external_corner_reentrant');
  });

  it('places basement re-entrant E17 corners below ground when wall bases are below ground', () => {
    const walls = wallsFromPlanRing(
      ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'],
      [
        [0, 0],
        [6, 0],
        [6, 4],
        [2, 4],
        [2, 2],
        [0, 2],
      ],
    ).map((w) => ({ ...w, base_height: -2.8, height: 2.8 })) as Element[];
    const p = proposeExternalCornerThermalBridges(walls);
    const e17 = p.filter((x) => x.junctionCode === 'E17');
    expect(e17).toHaveLength(1);
    expect(e17[0]!.coordinates[0].z).toBe(-2.8);
    expect(e17[0]!.coordinates[1].z).toBe(0);
  });

  it('does not mention orientation360 in proposal reasons', () => {
    const walls: Element[] = [
      makeWall('a', 0, 0, 10, 0, { orientation360: 180 }),
      makeWall('b', 10, 0, 10, 10, { orientation360: 90 }),
      makeWall('c', 10, 10, 0, 10, { orientation360: 0 }),
      makeWall('d', 0, 10, 0, 0, { orientation360: 270 }),
    ];
    const p = proposeExternalCornerThermalBridges(walls);
    expect(p.length).toBeGreaterThan(0);
    expect(p.every((x) => !/orientation360/i.test(x.reason))).toBe(true);
  });

  it('still proposes four E16 for a square when orientation360 on one wall disagrees with segment direction', () => {
    /** Geometry is authoritative for E16/E17; orientation360 does not surface in `reason`. */
    const walls: Element[] = [
      makeWall('a', 0, 0, 10, 0, { orientation360: 0 }),
      makeWall('b', 10, 0, 10, 10, { orientation360: 90 }),
      makeWall('c', 10, 10, 0, 10, { orientation360: 0 }),
      makeWall('d', 0, 10, 0, 0, { orientation360: 270 }),
    ];
    const p = proposeExternalCornerThermalBridges(walls);
    expect(p).toHaveLength(4);
    expect(p.every((x) => x.junctionCode === 'E16')).toBe(true);
    expect(p.every((x) => !/orientation360/i.test(x.reason))).toBe(true);
  });

  it('returns no proposals when a node has degree ≠ 2 (T-junction at split)', () => {
    const walls: Element[] = [
      makeWall('h1', 0, 0, 5, 0),
      makeWall('h2', 5, 0, 10, 0),
      makeWall('v', 5, 0, 5, 5),
    ];
    const p = proposeExternalCornerThermalBridges(walls);
    expect(p).toHaveLength(0);
  });

  it('U-shaped footprint: two reflex plan corners (two E17, rest E16)', () => {
    /** CCW U opening upward; inner corners of the U are reflex (E17). */
    const ring: Array<[number, number]> = [
      [0, 0],
      [12, 0],
      [12, 10],
      [8, 10],
      [8, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    const ids = ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'];
    const walls = wallsFromPlanRing(ids, ring);
    const p = proposeExternalCornerThermalBridges(walls);
    expect(p).toHaveLength(8);
    expect(p.filter((x) => x.junctionCode === 'E17')).toHaveLength(2);
    expect(p.filter((x) => x.junctionCode === 'E16')).toHaveLength(6);
    const e17pts = p
      .filter((x) => x.junctionCode === 'E17')
      .map((x) => ({ x: x.coordinates[0].x, y: x.coordinates[0].y }));
    expect(e17pts.some((pt) => Math.hypot(pt.x - 8, pt.y - 4) < 0.01)).toBe(true);
    expect(e17pts.some((pt) => Math.hypot(pt.x - 4, pt.y - 4) < 0.01)).toBe(true);
  });

  it('plus-sign outer boundary: four reflex corners (four E17)', () => {
    /** Orthogonal “cross” outline — multiple re-entrant plan corners. */
    const ring: Array<[number, number]> = [
      [2, 0],
      [10, 0],
      [10, 2],
      [12, 2],
      [12, 10],
      [10, 10],
      [10, 12],
      [2, 12],
      [2, 10],
      [0, 10],
      [0, 2],
      [2, 2],
    ];
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const walls = wallsFromPlanRing(ids, ring);
    const p = proposeExternalCornerThermalBridges(walls);
    expect(p).toHaveLength(12);
    expect(p.filter((x) => x.junctionCode === 'E17')).toHaveLength(4);
    expect(p.filter((x) => x.junctionCode === 'E16')).toHaveLength(8);
  });

  it('two disjoint closed loops in the same zone produce two independent corner sets', () => {
    const zone = 'z-main';
    const squareA: Element[] = [
      makeWall('a1', 0, 0, 4, 0, { zoneId: zone }),
      makeWall('a2', 4, 0, 4, 4, { zoneId: zone }),
      makeWall('a3', 4, 4, 0, 4, { zoneId: zone }),
      makeWall('a4', 0, 4, 0, 0, { zoneId: zone }),
    ];
    const squareB: Element[] = [
      makeWall('b1', 10, 0, 14, 0, { zoneId: zone }),
      makeWall('b2', 14, 0, 14, 4, { zoneId: zone }),
      makeWall('b3', 14, 4, 10, 4, { zoneId: zone }),
      makeWall('b4', 10, 4, 10, 0, { zoneId: zone }),
    ];
    const p = proposeExternalCornerThermalBridges([...squareA, ...squareB]);
    expect(p).toHaveLength(8);
    expect(p.every((x) => x.junctionCode === 'E16')).toBe(true);
    expect(new Set(p.map((x) => x.zoneId))).toEqual(new Set([zone]));
  });

  it('skips collinear vertices (180° turn): no proposal where cross(c−p, q−c) is ~0', () => {
    /** Same rectangle as a 4-gon, but bottom edge split into (0,0)–(5,0) and (5,0)–(10,0). Vertex (5,0) is not a geometric corner. */
    const walls: Element[] = [
      makeWall('c1', 0, 0, 5, 0),
      makeWall('c2', 5, 0, 10, 0),
      makeWall('c3', 10, 0, 10, 5),
      makeWall('c4', 10, 5, 0, 5),
      makeWall('c5', 0, 5, 0, 0),
    ];
    const p = proposeExternalCornerThermalBridges(walls);
    expect(p).toHaveLength(4);
    expect(p.every((x) => x.junctionCode === 'E16')).toBe(true);
  });

  describe('non-axis-aligned (diagonal) edges in plan', () => {
    it('triangle: all corners convex → three E16', () => {
      const ring: Array<[number, number]> = [
        [0, 0],
        [10, 0],
        [3, 7],
      ];
      const p = proposeExternalCornerThermalBridges(wallsFromPlanRing(['t0', 't1', 't2'], ring));
      expect(p).toHaveLength(3);
      expect(p.every((x) => x.junctionCode === 'E16')).toBe(true);
    });

    it('convex pentagon with only slanted edges → five E16', () => {
      /** Near-regular pentagon (CCW); vertices from unit circle scaled and shifted. */
      const ring: Array<[number, number]> = [
        [5, -1],
        [8.804226, 1.763932],
        [7.351141, 6.236068],
        [2.648859, 6.236068],
        [1.195774, 1.763932],
      ];
      const ids = ['p0', 'p1', 'p2', 'p3', 'p4'];
      const p = proposeExternalCornerThermalBridges(wallsFromPlanRing(ids, ring));
      expect(p).toHaveLength(5);
      expect(p.every((x) => x.junctionCode === 'E16')).toBe(true);
    });

    it('parallelogram: four convex corners (no parallel-to-axis requirement)', () => {
      const ring: Array<[number, number]> = [
        [0, 0],
        [10, 2],
        [12, 8],
        [2, 6],
      ];
      const p = proposeExternalCornerThermalBridges(wallsFromPlanRing(['q0', 'q1', 'q2', 'q3'], ring));
      expect(p).toHaveLength(4);
      expect(p.every((x) => x.junctionCode === 'E16')).toBe(true);
    });

    it('concave pentagon (chevron): one reflex vertex → one E17 at the notch', () => {
      const ring: Array<[number, number]> = [
        [0, 0],
        [12, 0],
        [6, 4],
        [3, 10],
        [0, 4],
      ];
      const p = proposeExternalCornerThermalBridges(wallsFromPlanRing(['v0', 'v1', 'v2', 'v3', 'v4'], ring));
      expect(p).toHaveLength(5);
      expect(p.filter((x) => x.junctionCode === 'E17')).toHaveLength(1);
      expect(p.filter((x) => x.junctionCode === 'E16')).toHaveLength(4);
      const e17 = p.find((x) => x.junctionCode === 'E17')!;
      expect(e17.coordinates[0].x).toBeCloseTo(6, 5);
      expect(e17.coordinates[0].y).toBeCloseTo(4, 5);
    });
  });

  it('merges 2cm Y drift at a shared node and still detects corners along an open bay chain', () => {
    /**
     * Simplified test_house_tb front + bay: one segment ends at (-4.3,-4.94), next starts at (-4.3,-4.92).
     * MERGE_VERTEX_XY_M merges them; open chain has two degree-1 ends (no party wall in the set).
     */
    const walls: Element[] = [
      makeWall('fw', -6.46, -4.94, -4.3, -4.94),
      makeWall('w1', -4.3, -4.92, -3.8, -5.46),
      makeWall('w2', -3.8, -5.46, -2.16, -5.46),
      makeWall('w3', -2.16, -5.46, -1.62, -4.94),
      makeWall('w4', -1.62, -4.94, -0.96, -4.94),
    ];
    const p = proposeExternalCornerThermalBridges(walls);
    expect(p.length).toBeGreaterThanOrEqual(4);
    expect(p.some((x) => x.junctionCode === 'E17')).toBe(true);
    expect(p.some((x) => x.junctionCode === 'E16')).toBe(true);
  });

  it('open rectangular chain (no party walls): four corners along one façade run', () => {
    /** Single storey open footprint: (0,0)→(10,0)→(10,5)→(0,5) — open chain, 2 convex ends + 2 corners */
    const walls: Element[] = [
      makeWall('a', 0, 0, 10, 0),
      makeWall('b', 10, 0, 10, 5),
      makeWall('c', 10, 5, 0, 5),
      makeWall('d', 0, 5, 0, 0),
    ];
    const p = proposeExternalCornerThermalBridges(walls);
    expect(p).toHaveLength(4);
    expect(p.every((x) => x.junctionCode === 'E16')).toBe(true);
  });
});
