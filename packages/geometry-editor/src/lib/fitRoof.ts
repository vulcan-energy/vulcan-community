// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Fits a roof to a storey outline from the type of each outline edge. Pure geometry, no store.
//
// The outline is cut into convex wings at its inside corners. Over a convex wing the roof is the
// lower envelope of one plane per eaves edge (z = h0 + d·tan θ, d the distance in from the edge
// line): the straight-skeleton roof without a straight-skeleton library. A wing other than the
// main one is extended through its junction into the wing it joins, and where wings overlap the
// higher roof wins (the upper envelope), which makes the valleys. Heights are above the eaves.

import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping';

export type RoofEdgeType = 'eaves' | 'gable' | 'half-hip' | 'abuts';

type P = { x: number; y: number };
export type P3 = P & { z: number };

export interface FitRoofInput {
  /** The outline; edge i runs from ring[i] to ring[i + 1]. Either winding. */
  ring: P[];
  edges: RoofEdgeType[];
  /** Degrees: every slope, or a mansard's lower slopes. */
  pitch: number;
  flat?: boolean;
  /** Where a half-hip starts, above the eaves (m); absent, a half-hip edge is drawn as a gable. */
  halfHipHeight?: number;
  /** A mansard's (or gambrel's) break above the eaves and its upper pitch. */
  mansard?: { breakHeight: number; upperPitch: number };
  /** Which cut of an L or T plan into wings: 0 keeps the largest wing whole. */
  junction?: number;
}

export interface RoofFitFace {
  /** The outline edge whose plane this is (its eaves wall), and whether it is a mansard's upper slope. */
  edge: number;
  upper: boolean;
  /** Counter-clockwise in plan, the eaves edge first. */
  ring: P3[];
  pitch: number;
}

export interface RoofFit {
  faces: RoofFitFace[];
  /** Gable and half-hip edges: the roof's height along the edge (t from its first point). */
  gables: Array<{ edge: number; profile: Array<{ t: number; h: number }> }>;
  /** The main ridge (a and b equal on a pyramid) and the highest point. */
  ridge: { a: P; b: P; height: number };
  /** The wings the outline was cut into, the one that runs through first. */
  wings: P[][];
  /** How many ways the outline can be cut into wings, and where the cut is. */
  junctions: number;
  junctionAt: P | null;
  /** Across the main ridge, through the middle of the main wing: s along the cut from the eaves. */
  section: { a: P; b: P; points: Array<{ s: number; z: number }> };
  notes: string[];
}

const EPS = 1e-6;
const deg = (d: number) => (d * Math.PI) / 180;
const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const area2 = (ring: P[]) => ring.reduce((s, p, i) => s + p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y, 0);
const dist = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y);

/** z = c + gx·x + gy·y */
interface Plane { c: number; gx: number; gy: number; edge: number; upper: boolean; pitch: number }
const zAt = (q: Plane, p: P) => q.c + q.gx * p.x + q.gy * p.y;

/** The plane rising at `pitch` in from edge a→b of a counter-clockwise ring, h0 at the edge. */
function edgePlane(a: P, b: P, h0: number, pitch: number, edge: number, upper: boolean): Plane {
  const len = dist(a, b);
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const t = Math.tan(deg(pitch));
  return { c: h0 - t * (a.x * n.x + a.y * n.y), gx: t * n.x, gy: t * n.y, edge, upper, pitch };
}

/** Sutherland–Hodgman: the part of a convex polygon where f(p) ≤ 0, f linear. */
function clip(poly: P[], f: (p: P) => number): P[] {
  const out: P[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa <= EPS) out.push(a);
    if ((fa < -EPS && fb > EPS) || (fa > EPS && fb < -EPS)) {
      const k = fa / (fa - fb);
      out.push({ x: a.x + k * (b.x - a.x), y: a.y + k * (b.y - a.y) });
    }
  }
  return clean(out);
}

/**
 * Drops repeated points, collinear points and spikes (the boundary turning back on itself, which
 * clipping leaves along a valley) until none is left; counter-clockwise.
 */
function clean<T extends P>(ring: T[]): T[] {
  let pts = ring;
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const p = pts[i];
      const b = pts[(i + 1) % pts.length];
      const c = Math.abs(cross(a, p, b));
      const turnsBack = (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y) < 0 && c <= 1e-3 * dist(a, p) * dist(p, b);
      if (dist(a, p) <= 1e-3 || c <= 1e-9 * Math.max(1, dist(a, b)) || turnsBack) {
        pts = pts.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  if (pts.length < 3) return [];
  return area2(pts) < 0 ? [...pts].reverse() : pts;
}

const toRing = (ring: P[]): Ring => ring.map((p) => [p.x, p.y]);
const fromMulti = (multi: MultiPolygon): P[][] => multi.flatMap((poly) => {
  const ring = clean(poly[0].slice(0, -1).map(([x, y]) => ({ x, y })));
  return Math.abs(area2(ring)) > 2e-2 ? [ring] : [];
});

/** The pieces of `ring` either side of the line through `a` along `d`. */
function split(ring: P[], a: P, d: P): P[][] {
  const big = 1e4;
  const n = { x: -d.y, y: d.x };
  const side = (s: number): Polygon => [toRing([
    { x: a.x - d.x * big, y: a.y - d.y * big },
    { x: a.x + d.x * big, y: a.y + d.y * big },
    { x: a.x + d.x * big + s * n.x * big, y: a.y + d.y * big + s * n.y * big },
    { x: a.x - d.x * big + s * n.x * big, y: a.y - d.y * big + s * n.y * big },
  ])];
  return [1, -1].flatMap((s) => fromMulti(polygonClipping.intersection([toRing(ring)], side(s))));
}

const isConvex = (ring: P[]) => ring.every((p, i) => cross(ring[(i + ring.length - 1) % ring.length], p, ring[(i + 1) % ring.length]) >= -1e-9);
const area = (ring: P[]) => Math.abs(area2(ring)) / 2;

/** Every way of cutting a ring into convex wings along the lines of its inside-corner edges, best first. */
function decompositions(ring: P[], depth = 0): P[][][] {
  if (isConvex(ring)) return [[ring]];
  if (depth > 6) return [];
  const lines: Array<{ a: P; d: P }> = [];
  ring.forEach((p, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length];
    const next = ring[(i + 1) % ring.length];
    if (cross(prev, p, next) >= -1e-9) return;
    for (const [from, to] of [[prev, p], [p, next]]) {
      const len = dist(from, to);
      const d = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
      const same = lines.some((l) => Math.abs(l.d.x * d.y - l.d.y * d.x) < 1e-9 && Math.abs(cross(l.a, { x: l.a.x + l.d.x, y: l.a.y + l.d.y }, p)) < 1e-6);
      if (!same) lines.push({ a: p, d });
    }
  });
  const found: P[][][] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const pieces = split(ring, line.a, line.d);
    if (pieces.length < 2) continue;
    const parts = pieces.map((piece) => decompositions(piece, depth + 1)[0]);
    if (parts.some((part) => !part)) continue;
    const wings = parts.flat().sort((x, y) => area(y) - area(x));
    const key = wings.map((w) => w.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).sort().join(';')).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(wings);
  }
  // The cut that keeps the largest wing whole first; then fewer wings.
  return found.sort((x, y) => area(y[0]) - area(x[0]) || x.length - y.length);
}

/** The outline edges that wing edge a→b lies along (none: a cut between wings). */
function outlineEdgesOf(a: P, b: P, ring: P[]): number[] {
  const len = dist(a, b);
  const u = (p: P) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len;
  return ring.flatMap((p, i) => {
    const q = ring[(i + 1) % ring.length];
    if (Math.abs(cross(a, b, p)) / len > 1e-4 || Math.abs(cross(a, b, q)) / len > 1e-4) return [];
    const lo = Math.max(0, Math.min(u(p), u(q)));
    const hi = Math.min(len, Math.max(u(p), u(q)));
    return hi - lo > 1e-4 ? [i] : [];
  });
}

/** The shared stretch of two wings' boundaries, as wing `w`'s edge index, or -1. */
function junctionEdge(w: P[], other: P[]): number {
  for (let i = 0; i < w.length; i += 1) {
    const a = w[i];
    const b = w[(i + 1) % w.length];
    for (let j = 0; j < other.length; j += 1) {
      const c = other[j];
      const d = other[(j + 1) % other.length];
      const len = dist(a, b);
      if (Math.abs(cross(a, b, c)) / len > 1e-4 || Math.abs(cross(a, b, d)) / len > 1e-4) continue;
      const u = (p: P) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len;
      const lo = Math.max(0, Math.min(u(c), u(d)));
      const hi = Math.min(len, Math.max(u(c), u(d)));
      if (hi - lo > 0.05) return i;
    }
  }
  return -1;
}

/** Wing `w` carried through its edge `j` into `into`, between the lines of its neighbouring edges. */
function extend(w: P[], j: number, into: P[]): P[] {
  const n = w.length;
  const line = (a: P, b: P) => (p: P) => cross(a, b, p);
  const beyond = line(w[j], w[(j + 1) % n]); // ≤ 0: right of the junction, outside w
  const prev = line(w[(j + n - 1) % n], w[j]);
  const next = line(w[(j + 1) % n], w[(j + 2) % n]);
  let ext = clip(into, beyond);
  ext = ext.length ? clip(ext, (p) => -prev(p)) : ext;
  ext = ext.length ? clip(ext, (p) => -next(p)) : ext;
  if (!ext.length) return w;
  const union = fromMulti(polygonClipping.union([toRing(w)], [toRing(ext)]));
  return union.length === 1 && isConvex(union[0]) ? union[0] : w;
}

/** The lower envelope of `planes` over a convex wing: one face per plane that is lowest somewhere. */
function lowerEnvelope(wing: P[], planes: Plane[]): Array<{ plane: Plane; ring: P[] }> {
  return planes.flatMap((q) => {
    let face = wing;
    for (const o of planes) {
      if (o === q || !face.length) continue;
      face = clip(face, (p) => zAt(q, p) - zAt(o, p));
    }
    return face.length && area(face) > 1e-4 ? [{ plane: q, ring: face }] : [];
  });
}

const planeKey = (q: Plane) => [q.c, q.gx, q.gy].map((v) => v.toFixed(5)).join(',');

/** Rotates a face so it starts with its longest lowest level edge. */
function eavesFirst(ring: P3[]): P3[] | null {
  const low = Math.min(...ring.map((p) => p.z));
  let best = -1;
  let bestLen = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    if (Math.abs(p.z - low) < 1e-3 && Math.abs(q.z - low) < 1e-3 && dist(p, q) > bestLen) {
      best = i;
      bestLen = dist(p, q);
    }
  });
  return best < 0 ? null : [...ring.slice(best), ...ring.slice(0, best)];
}

function inside(p: P, ring: P[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    // On the boundary counts as inside.
    const len = dist(a, b);
    const u = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len);
    if (Math.abs(cross(a, b, p)) / len < 1e-6 && u > -1e-6 && u < 1 + 1e-6) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

export function fitRoof(input: FitRoofInput): RoofFit | { problem: string } {
  const n = input.ring.length;
  if (n < 3 || input.edges.length !== n) return { problem: 'The outline needs at least three edges, each with a type.' };
  // Counter-clockwise inside; `edgeOf` maps an edge back to the caller's numbering.
  const ccw = area2(input.ring) > 0;
  const ring = ccw ? input.ring : input.ring.map((_, k) => input.ring[(n - k) % n]);
  const edgeOf = (k: number) => (ccw ? k : (n - k - 1 + n) % n);
  const type = (k: number) => input.edges[edgeOf(k)];
  const notes: string[] = [];

  if (input.flat) {
    const longest = ring.reduce((best, p, i) => (dist(p, ring[(i + 1) % n]) > dist(ring[best], ring[(best + 1) % n]) ? i : best), 0);
    const face = [...ring.slice(longest), ...ring.slice(0, longest)].map((p) => ({ ...p, z: 0 }));
    const c = ring.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), { x: 0, y: 0 });
    return {
      faces: [{ edge: edgeOf(longest), upper: false, ring: face, pitch: 0 }],
      gables: [],
      ridge: { a: c, b: c, height: 0 },
      wings: [ring],
      junctions: 1,
      junctionAt: null,
      section: { a: c, b: c, points: [] },
      notes,
    };
  }
  if (!(input.pitch > 0 && input.pitch < 90)) return { problem: 'Give the roof a pitch above 0° and below 90°.' };
  if (!input.edges.some((t) => t === 'eaves' || (t === 'half-hip' && input.halfHipHeight !== undefined))) {
    return { problem: 'Make at least one edge eaves: a roof with only gables has no slope.' };
  }
  const cuts = decompositions(ring);
  if (!cuts.length) return { problem: 'This outline cannot be fitted. Split it at a corner, or draw the roof planes.' };
  const wings = cuts[Math.min(input.junction ?? 0, cuts.length - 1)];

  // One plane per eaves edge (two on a mansard), on the outline edge's own line.
  const planesOf = (k: number): Plane[] => {
    const a = ring[k];
    const b = ring[(k + 1) % n];
    const edge = edgeOf(k);
    if (type(k) === 'half-hip' && input.halfHipHeight !== undefined) return [edgePlane(a, b, input.halfHipHeight, input.pitch, edge, false)];
    if (type(k) !== 'eaves') return [];
    const lower = edgePlane(a, b, 0, input.pitch, edge, false);
    if (!input.mansard) return [lower];
    const { breakHeight, upperPitch } = input.mansard;
    const d1 = breakHeight / Math.tan(deg(input.pitch));
    return [lower, edgePlane(a, b, breakHeight - d1 * Math.tan(deg(upperPitch)), upperPitch, edge, true)];
  };

  // Each wing's faces; a wing after the first is carried into the larger wings it joins.
  const faces: Array<{ plane: Plane; ring: P[]; wing: number }> = [];
  let junctionAt: P | null = null;
  wings.forEach((wing, w) => {
    let extended = wing;
    for (let o = 0; o < w; o += 1) {
      const j = junctionEdge(extended, wings[o]);
      if (j < 0) continue;
      const a = extended[j];
      const b = extended[(j + 1) % extended.length];
      junctionAt ??= { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      extended = extend(extended, j, wings[o]);
    }
    const planes: Plane[] = [];
    extended.forEach((p, i) => {
      for (const k of outlineEdgesOf(p, extended[(i + 1) % extended.length], ring)) {
        for (const q of planesOf(k)) if (!planes.some((o) => planeKey(o) === planeKey(q))) planes.push(q);
      }
    });
    for (const face of lowerEnvelope(extended, planes)) faces.push({ ...face, wing: w });
  });

  // Where wings overlap the higher roof shows; on a tie, the wing that runs through.
  const visible: Array<{ plane: Plane; ring: P[] }> = [];
  for (const f of faces) {
    const over = faces.flatMap((g) => {
      if (g.wing === f.wing) return [];
      const s = g.wing < f.wing ? -1e-4 : 1e-4;
      const part = clip(g.ring, (p) => zAt(f.plane, p) - zAt(g.plane, p) + s);
      return part.length ? [[toRing(part)] as Polygon] : [];
    });
    const left = over.length ? fromMulti(polygonClipping.difference([toRing(f.ring)], ...over)) : [f.ring];
    for (const ring2 of left) visible.push({ plane: f.plane, ring: ring2 });
  }
  // One face per plane where pieces of it touch (the same wall's slope in two wings).
  const byPlane = new Map<string, { plane: Plane; rings: P[][] }>();
  for (const v of visible) {
    const key = planeKey(v.plane);
    byPlane.set(key, { plane: byPlane.get(key)?.plane ?? v.plane, rings: [...(byPlane.get(key)?.rings ?? []), v.ring] });
  }
  const out: RoofFitFace[] = [];
  for (const { plane, rings } of byPlane.values()) {
    const merged = rings.length > 1 ? fromMulti(polygonClipping.union([toRing(rings[0])], ...rings.slice(1).map((r) => [toRing(r)] as Polygon))) : rings;
    for (const r of merged) {
      const ring3 = eavesFirst(r.map((p) => ({ ...p, z: zAt(plane, p) < 1e-3 ? 0 : zAt(plane, p) })));
      if (!ring3) {
        if (area(r) < 0.01) continue;
        return { problem: 'This outline cannot be fitted. Split it at a corner, or draw the roof planes.' };
      }
      out.push({ edge: plane.edge, upper: plane.upper, ring: ring3, pitch: plane.pitch });
    }
  }
  if (input.halfHipHeight !== undefined && ring.some((_, k) => type(k) === 'half-hip') && !out.some((f) => input.edges[f.edge] === 'half-hip')) {
    notes.push('The half-hip starts at or above the ridge: the end is drawn as a gable.');
  }
  if (input.mansard && !out.some((f) => f.upper)) notes.push('The break is at or above the ridge: the roof is drawn as a single steep slope.');

  const height = (p: P) => Math.max(0, ...out.flatMap((f) => (inside(p, f.ring) ? [faceHeight(f.ring, p)] : [])));

  // Gable profiles: the roof's height at the face corners along the edge.
  const gables = ring.flatMap((a, k) => {
    if (type(k) !== 'gable' && type(k) !== 'half-hip') return [];
    const b = ring[(k + 1) % n];
    const len = dist(a, b);
    const ts = new Map<string, { t: number; h: number }>();
    for (const p of [a, b, ...out.flatMap((f) => f.ring)]) {
      const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len);
      if (Math.abs(cross(a, b, p)) / len > 1e-4 || t < -1e-6 || t > 1 + 1e-6) continue;
      const tt = Math.min(1, Math.max(0, t));
      const h = height({ x: a.x + tt * (b.x - a.x), y: a.y + tt * (b.y - a.y) });
      const key = tt.toFixed(5);
      if (!ts.has(key) || ts.get(key)!.h < h) ts.set(key, { t: tt, h });
    }
    const profile = clean2([...ts.values()].sort((x, y) => x.t - y.t));
    // Profiles run from the caller's edge start.
    return [{ edge: edgeOf(k), profile: ccw ? profile : profile.map((q) => ({ t: 1 - q.t, h: q.h })).reverse() }];
  });

  // The main ridge: the longest level edge at the main wing's top.
  const main = out.filter((f) => f.ring.some((p) => inside(p, wings[0])));
  const top = Math.max(0, ...out.flatMap((f) => f.ring.map((p) => p.z)));
  const mainTop = Math.max(0, ...main.flatMap((f) => f.ring.map((p) => p.z)));
  const peak = main.flatMap((f) => f.ring.filter((p) => Math.abs(p.z - mainTop) < 1e-4 && inside(p, wings[0])));
  let ridge = { a: peak[0] ?? wings[0][0], b: peak[0] ?? wings[0][0] };
  for (const p of peak) for (const q of peak) if (dist(p, q) > dist(ridge.a, ridge.b)) ridge = { a: p, b: q };

  // The section: across the ridge (or across the main wing's long side) through its middle.
  const c = wings[0].reduce((s, p) => ({ x: s.x + p.x / wings[0].length, y: s.y + p.y / wings[0].length }), { x: 0, y: 0 });
  let along = { x: ridge.b.x - ridge.a.x, y: ridge.b.y - ridge.a.y };
  if (Math.hypot(along.x, along.y) < 1e-6) {
    const longest = wings[0].reduce((best, p, i) => (dist(p, wings[0][(i + 1) % wings[0].length]) > dist(wings[0][best], wings[0][(best + 1) % wings[0].length]) ? i : best), 0);
    const p = wings[0][longest];
    const q = wings[0][(longest + 1) % wings[0].length];
    along = { x: q.x - p.x, y: q.y - p.y };
  }
  const len = Math.hypot(along.x, along.y);
  const d = { x: -along.y / len, y: along.x / len };
  // A ridge that is one point (a pyramid, or a ridge tilted by a jog in the outline): through the wing's middle.
  const mid = dist(ridge.a, ridge.b) > 1e-6 ? { x: (ridge.a.x + ridge.b.x) / 2, y: (ridge.a.y + ridge.b.y) / 2 } : c;
  const ss: number[] = [];
  for (const r of [wings[0], ...main.map((f) => f.ring)]) {
    r.forEach((p, i) => {
      const q = r[(i + 1) % r.length];
      const den = (q.x - p.x) * d.y - (q.y - p.y) * d.x;
      if (Math.abs(den) < 1e-12) return;
      const u = ((mid.x - p.x) * d.y - (mid.y - p.y) * d.x) / den;
      if (u < -1e-9 || u > 1 + 1e-9) return;
      const x = { x: p.x + u * (q.x - p.x), y: p.y + u * (q.y - p.y) };
      ss.push((x.x - mid.x) * d.x + (x.y - mid.y) * d.y);
    });
  }
  const s0 = Math.min(...ss);
  const s1 = Math.max(...ss);
  const at = (s: number) => ({ x: mid.x + s * d.x, y: mid.y + s * d.y });
  const points = clean2([...new Set(ss.map((s) => s.toFixed(5)))].map(Number).sort((x, y) => x - y)
    .map((s) => ({ t: s - s0, h: height(at(s)) }))).map((q) => ({ s: q.t, z: q.h }));

  return {
    faces: out,
    gables,
    ridge: { ...ridge, height: top },
    wings,
    junctions: cuts.length,
    junctionAt: cuts.length > 1 ? junctionAt : null,
    section: { a: at(s0), b: at(s1), points },
    notes,
  };
}

/** The height of a face's plane at `p`, from three of its own corners. */
function faceHeight(ring: P3[], p: P): number {
  const [a, b, c] = ring;
  const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(det) < 1e-12) return a.z;
  const u = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / det;
  const v = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / det;
  return a.z + u * (b.z - a.z) + v * (c.z - a.z);
}

/** Drops points on the straight line between their neighbours (and repeats). */
function clean2(points: Array<{ t: number; h: number }>): Array<{ t: number; h: number }> {
  return points.filter((q, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const a = points[i - 1];
    const b = points[i + 1];
    if (Math.abs(q.t - a.t) < 1e-6) return false;
    return Math.abs((q.h - a.h) * (b.t - a.t) - (b.h - a.h) * (q.t - a.t)) > 1e-6;
  });
}
