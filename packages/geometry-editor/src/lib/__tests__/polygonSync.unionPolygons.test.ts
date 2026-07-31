// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { calculatePolygonArea, unionPolygons } from '../polygonSync';
import { signedPolygonArea } from '../polygonWinding';

type Point3 = { x: number; y: number; z: number };

const rect = (x0: number, y0: number, w: number, h: number, z = 0): Point3[] => [
  { x: x0, y: y0, z },
  { x: x0 + w, y: y0, z },
  { x: x0 + w, y: y0 + h, z },
  { x: x0, y: y0 + h, z },
];

/** Square parked in the notch of an L: bounding boxes overlap, the shapes never touch. */
const L_SHAPE: Point3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
  { x: 10, y: 3, z: 0 },
  { x: 3, y: 3, z: 0 },
  { x: 3, y: 10, z: 0 },
  { x: 0, y: 10, z: 0 },
];

/**
 * `mergeSelectedRooms` writes the union straight onto a `BuildingElementGround`, so an
 * over-large ring silently inflates the floor area and perimeter that reach HEM. A union
 * that cannot be represented as one ring must fail loudly (null) rather than approximate.
 */
describe('unionPolygons — rooms that do not touch', () => {
  it('returns null rather than a ring spanning the gap between separated rooms', () => {
    const merged = unionPolygons([rect(0, 0, 4, 4), rect(10, 0, 4, 4)]);

    expect(merged).toBeNull();
  });

  it('returns null when bounding boxes overlap but the rooms still do not touch', () => {
    const merged = unionPolygons([L_SHAPE, rect(5, 5, 4, 4)]);

    expect(merged).toBeNull();
  });

  it('never reports more area than the rooms actually cover', () => {
    const a = rect(0, 0, 4, 4);
    const b = rect(10, 0, 4, 4);
    const merged = unionPolygons([a, b]);

    // Union area can never exceed the sum of the parts.
    const maxPossible = calculatePolygonArea(a) + calculatePolygonArea(b);
    expect(merged === null || calculatePolygonArea(merged) <= maxPossible + 1e-6).toBe(true);
  });
});

describe('unionPolygons — rooms that do touch', () => {
  it('returns the single input unchanged', () => {
    const only = rect(0, 0, 4, 4);

    expect(unionPolygons([only])).toEqual(only);
  });

  it('unions two overlapping squares into their true footprint', () => {
    // 0..4 and 2..6 in x, both 0..4 in y => one 6 x 4 rectangle.
    const merged = unionPolygons([rect(0, 0, 4, 4), rect(2, 0, 4, 4)]);

    expect(merged).not.toBeNull();
    expect(calculatePolygonArea(merged!)).toBeCloseTo(24, 6);
  });

  it('unions two squares that share an edge', () => {
    // 0..4 and 4..8 in x, both 0..4 in y => one 8 x 4 rectangle.
    const merged = unionPolygons([rect(0, 0, 4, 4), rect(4, 0, 4, 4)]);

    expect(merged).not.toBeNull();
    expect(calculatePolygonArea(merged!)).toBeCloseTo(32, 6);
  });

  it('returns the outer room when one room sits entirely inside another', () => {
    const outer = rect(0, 0, 10, 10);
    const merged = unionPolygons([outer, rect(2, 2, 3, 3)]);

    expect(merged).not.toBeNull();
    expect(calculatePolygonArea(merged!)).toBeCloseTo(100, 6);
  });

  it('returns counter-clockwise coordinates, matching drawn room floors', () => {
    // The room draw commit runs `ensureCounterClockwisePolygon`; merged floors must agree,
    // and a merged ring must not alias a source room's coordinates array.
    const a = rect(0, 0, 4, 4);
    const merged = unionPolygons([a, rect(2, 0, 4, 4)]);

    expect(merged).not.toBeNull();
    expect(merged).not.toBe(a);
    expect(signedPolygonArea(merged!)).toBeGreaterThan(0);
  });

  it('keeps a concave union concave instead of convexifying it', () => {
    // An L made of a 6x2 bar and a 2x6 bar sharing the corner: true area 6*2 + 2*6 - 2*2 = 20.
    // A convex hull of the same points would report 6*6 - (triangle) and overstate the floor.
    const merged = unionPolygons([rect(0, 0, 6, 2), rect(0, 0, 2, 6)]);

    expect(merged).not.toBeNull();
    expect(calculatePolygonArea(merged!)).toBeCloseTo(20, 6);
  });
});
