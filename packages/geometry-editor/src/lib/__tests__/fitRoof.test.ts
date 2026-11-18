// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { fitRoof, type FitRoofInput, type RoofEdgeType, type RoofFit } from '../fitRoof';

type P = { x: number; y: number };
const rect = (w: number, d: number): P[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }];
// Edges of `rect`: 0 front (y = 0), 1 east, 2 rear, 3 west.
const all = (n: number, type: RoofEdgeType): RoofEdgeType[] => Array.from({ length: n }, () => type);
// An L: main 10 × 5, a rear wing 4 wide and 4 deep at x 3–7.
const L: P[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 9 }, { x: 3, y: 9 }, { x: 3, y: 5 }, { x: 0, y: 5 }];
// A T: bar 12 × 5, a stem 4 wide and 5 deep at x 4–8 in front of it.
const T: P[] = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 5 }, { x: 0, y: 5 }].map((p) => ({ x: p.x, y: p.y + 5 }));
T.splice(1, 0, { x: 4, y: 5 }, { x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 5 });

// An L whose wing is longer than the main roof is deep.
const longL: P[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 7, y: 4 }, { x: 7, y: 12 }, { x: 0, y: 12 }];
// A U: 12 × 10 with a 4 × 6 notch in the rear.
const U: P[] = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 8, y: 10 }, { x: 8, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];

/** No repeated point, no spike (the boundary turning back on itself), no two edges that touch. */
const simple = (ring: P[]): boolean => {
  const n = ring.length;
  const at = (i: number) => ring[((i % n) + n) % n];
  const crs = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 0; i < n; i += 1) {
    const [a, p, b] = [at(i - 1), at(i), at(i + 1)];
    if (Math.hypot(b.x - p.x, b.y - p.y) < 1e-6) return false;
    const dot = (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y);
    if (dot < 0 && Math.abs(crs(a, p, b)) <= 1e-3 * Math.hypot(p.x - a.x, p.y - a.y) * Math.hypot(b.x - p.x, b.y - p.y)) return false;
  }
  // Non-adjacent edges must not meet, even at a point.
  const meet = (a: P, b: P, c: P, d: P) => {
    const [d1, d2, d3, d4] = [crs(c, d, a), crs(c, d, b), crs(a, b, c), crs(a, b, d)];
    const on = (o: P, q: P, r: P) => Math.min(o.x, q.x) - 1e-9 <= r.x && r.x <= Math.max(o.x, q.x) + 1e-9 && Math.min(o.y, q.y) - 1e-9 <= r.y && r.y <= Math.max(o.y, q.y) + 1e-9;
    if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) return true;
    return (Math.abs(d1) <= 1e-9 && on(c, d, a)) || (Math.abs(d2) <= 1e-9 && on(c, d, b)) || (Math.abs(d3) <= 1e-9 && on(a, b, c)) || (Math.abs(d4) <= 1e-9 && on(a, b, d));
  };
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      if (meet(at(i), at(i + 1), at(j), at(j + 1))) return false;
    }
  }
  return true;
};

const planArea = (ring: P[]) => Math.abs(ring.reduce((s, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return s + p.x * q.y - q.x * p.y;
}, 0)) / 2;
const ok = (fit: RoofFit | { problem: string }): RoofFit => {
  if ('problem' in fit) throw new Error(fit.problem);
  return fit;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

const rows: Array<{
  name: string;
  input: FitRoofInput;
  faces: number;
  ridge: number;
  ridgeLength?: number;
  gables?: Record<number, number[]>;
  pitches?: number[];
  note?: RegExp;
}> = [
  { name: 'hipped', input: { ring: rect(8, 5), edges: all(4, 'eaves'), pitch: 45 }, faces: 4, ridge: 2.5, ridgeLength: 3 },
  // A semi: the party wall (west) is a gable; the far end hips.
  { name: 'party gable', input: { ring: rect(8, 5), edges: ['eaves', 'eaves', 'eaves', 'gable'], pitch: 45 }, faces: 3, ridge: 2.5, gables: { 3: [0, 2.5, 0] } },
  { name: 'gable ends', input: { ring: rect(8, 5), edges: ['eaves', 'gable', 'eaves', 'gable'], pitch: 45 }, faces: 2, ridge: 2.5, ridgeLength: 8, gables: { 1: [0, 2.5, 0], 3: [0, 2.5, 0] } },
  // The hip starts 1.8 m up: a 1.4 m (plan) hip triangle on each end, gable walls to 1.8 m.
  { name: 'half-hip', input: { ring: rect(8, 5), edges: ['eaves', 'half-hip', 'eaves', 'half-hip'], pitch: 45, halfHipHeight: 1.8 }, faces: 4, ridge: 2.5, ridgeLength: 6.6, gables: { 1: [0, 1.8, 1.8, 0], 3: [0, 1.8, 1.8, 0] } },
  { name: 'half-hip above the ridge is a gable', input: { ring: rect(8, 5), edges: ['eaves', 'half-hip', 'eaves', 'half-hip'], pitch: 45, halfHipHeight: 3 }, faces: 2, ridge: 2.5, note: /gable/ },
  // A lean-to: low at the front, its back abuts the house wall.
  { name: 'mono', input: { ring: rect(4, 3), edges: ['eaves', 'gable', 'abuts', 'gable'], pitch: 30 }, faces: 1, ridge: r2(3 * Math.tan(Math.PI / 6)), gables: { 1: [0, r2(3 * Math.tan(Math.PI / 6))] } },
  { name: 'flat', input: { ring: rect(8, 5), edges: all(4, 'eaves'), pitch: 45, flat: true }, faces: 1, ridge: 0, pitches: [0] },
  // Steep 70° lower slopes to a 2 m break, 30° above it.
  { name: 'mansard', input: { ring: rect(8, 6), edges: all(4, 'eaves'), pitch: 70, mansard: { breakHeight: 2, upperPitch: 30 } }, faces: 8, ridge: r2(2 + (3 - 2 / Math.tan((70 * Math.PI) / 180)) * Math.tan(Math.PI / 6)), pitches: [30, 70] },
  { name: 'gambrel', input: { ring: rect(8, 6), edges: ['eaves', 'gable', 'eaves', 'gable'], pitch: 70, mansard: { breakHeight: 2, upperPitch: 30 } }, faces: 4, ridge: r2(2 + (3 - 2 / Math.tan((70 * Math.PI) / 180)) * Math.tan(Math.PI / 6)), pitches: [30, 70] },
  { name: 'mansard break above the ridge', input: { ring: rect(8, 6), edges: all(4, 'eaves'), pitch: 45, mansard: { breakHeight: 5, upperPitch: 30 } }, faces: 4, ridge: 3, note: /single steep slope/ },
  // The rear wing (4 wide) runs into the main roof (5 deep): two valleys, the main ridge stays highest.
  { name: 'L plan with valleys', input: { ring: L, edges: all(8, 'eaves'), pitch: 45 }, faces: 7, ridge: 2.5 },
  { name: 'L plan, rear gable', input: { ring: L, edges: ['eaves', 'eaves', 'eaves', 'eaves', 'gable', 'eaves', 'eaves', 'eaves'], pitch: 45 }, faces: 6, ridge: 2.5, gables: { 4: [0, 2, 0] } },
  { name: 'T plan', input: { ring: T, edges: all(8, 'eaves'), pitch: 45 }, faces: 7, ridge: 2.5 },
  // Plans whose valleys used to leave zero-width spikes in a face.
  { name: 'L plan, long wing', input: { ring: longL, edges: all(6, 'eaves'), pitch: 40 }, faces: 6, ridge: r2(3.5 * Math.tan((40 * Math.PI) / 180)) },
  { name: 'L plan, the wing runs through', input: { ring: L, edges: all(8, 'eaves'), pitch: 45, junction: 1 }, faces: 7, ridge: 2.5 },
  { name: 'U plan', input: { ring: U, edges: all(8, 'eaves'), pitch: 45 }, faces: 8, ridge: 2 },
];

describe('fitRoof', () => {
  it.each(rows)('$name', ({ input, faces, ridge, ridgeLength, gables, pitches, note }) => {
    const fit = ok(fitRoof(input));
    expect(fit.faces).toHaveLength(faces);
    expect(r2(fit.ridge.height)).toBe(ridge);
    if (ridgeLength !== undefined) expect(r2(Math.hypot(fit.ridge.b.x - fit.ridge.a.x, fit.ridge.b.y - fit.ridge.a.y))).toBe(ridgeLength);
    // The faces cover the outline once: no gap, no overlap.
    expect(r2(fit.faces.reduce((s, f) => s + planArea(f.ring), 0))).toBe(r2(planArea(input.ring)));
    for (const face of fit.faces) {
      expect(simple(face.ring), JSON.stringify(face.ring)).toBe(true);
      // The first edge is the eaves: level, and the lowest edge of the face.
      const [a, b] = face.ring;
      const low = Math.min(...face.ring.map((p) => p.z));
      expect(Math.abs(a.z - low)).toBeLessThan(1e-6);
      expect(Math.abs(b.z - low)).toBeLessThan(1e-6);
      // Counter-clockwise in plan: the face lies left of its eaves edge.
      const area2 = face.ring.reduce((s, p, i) => s + p.x * face.ring[(i + 1) % face.ring.length].y - face.ring[(i + 1) % face.ring.length].x * p.y, 0);
      expect(area2).toBeGreaterThan(0);
    }
    if (pitches) expect([...new Set(fit.faces.map((f) => Math.round(f.pitch)))].sort()).toEqual(pitches);
    for (const [edge, heights] of Object.entries(gables ?? {})) {
      const gable = fit.gables.find((g) => g.edge === Number(edge));
      expect(gable?.profile.map((p) => r2(p.h))).toEqual(heights);
    }
    if (note) expect(fit.notes.join(' ')).toMatch(note);
    else expect(fit.notes).toEqual([]);
  });

  it('the L plan has a second cut: the rear wing runs through instead', () => {
    const main = ok(fitRoof({ ring: L, edges: all(8, 'eaves'), pitch: 45 }));
    expect(main.junctions).toBe(2);
    expect(main.junctionAt).not.toBeNull();
    const swapped = ok(fitRoof({ ring: L, edges: all(8, 'eaves'), pitch: 45, junction: 1 }));
    expect(swapped.wings[0]).not.toEqual(main.wings[0]);
    expect(r2(swapped.faces.reduce((s, f) => s + planArea(f.ring), 0))).toBe(r2(planArea(L)));
  });

  it('works on a clockwise outline, keeping edge numbers', () => {
    const cw = [...rect(8, 5)].reverse(); // edges: 0 rear, 1 east, 2 front, 3 west
    const fit = ok(fitRoof({ ring: cw, edges: ['gable', 'eaves', 'eaves', 'eaves'], pitch: 45 }));
    expect(fit.faces).toHaveLength(3);
    expect(fit.gables.map((g) => g.edge)).toEqual([0]);
  });

  it('the section crosses the main ridge', () => {
    const fit = ok(fitRoof({ ring: rect(8, 5), edges: ['eaves', 'gable', 'eaves', 'gable'], pitch: 45 }));
    expect(fit.section.points.map((p) => [r2(p.s), r2(p.z)])).toEqual([[0, 0], [2.5, 2.5], [5, 0]]);
  });

  it.each([
    { name: 'only gables', input: { ring: rect(8, 5), edges: all(4, 'gable'), pitch: 45 }, problem: /eaves/ },
    { name: 'no pitch', input: { ring: rect(8, 5), edges: all(4, 'eaves'), pitch: 0 }, problem: /pitch/ },
  ])('stops: $name', ({ input, problem }) => {
    const fit = fitRoof(input);
    expect('problem' in fit && fit.problem).toMatch(problem);
  });
});
