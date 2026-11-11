// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The part of a roof inside walls that stand on it: a box dormer or loft conversion on a pitched
 * roof, an extension that runs into the main roof, a room built on a flat roof. That part is inside
 * the dwelling: it is not external roof area and has no eaves, verge, ridge or flat-roof edge. It
 * is derived from the current geometry every time, like area, so it cannot go stale.
 *
 * 1. Standing walls: vertical walls whose bottom edge lies on the roof surface (a shaped bottom on
 *    a pitched roof; any bottom, usually the foot, on a flat roof deck). A wall along the roof
 *    edge that faces over the roof encloses part of it; one that faces away (a house wall above a
 *    lean-to) encloses none of it and is ignored. A wall faces the right of its first-to-second
 *    point direction, as everywhere in the editor.
 * 2. The standing walls are joined end to end. Where three or more walls meet, the footprint is
 *    not clear: it is reported, not guessed.
 * 3. Open chain ends are joined through other walls of the zone, shortest joins first: off the
 *    roof any wall (an extension's front wall on the floor past the eaves); on the roof only a wall
 *    that rises through its surface there (the house wall behind a room on an extension's deck,
 *    not the extension's own walls below the deck), joined mid-span where a chain end meets it.
 *    Internal partitions never stand or join; party walls and walls to unheated space do.
 * 4. A chain that is still open closes where both ends stop on the roof:
 *    - both at a wall end of no height (the wall meets the roof above it, as a dormer cheek does):
 *      along the line where the roofs drawn above those ends meet this roof (the valleys of a
 *      gable or hipped dormer; the straight back edge of a flat-roofed one), never round eaves
 *      that overhang the walls;
 *    - both on or past the roof outline: along the outline, the way round that has more of the
 *      walls' inside within it (a tie is reported).
 *    Any other case is reported with the ends, never guessed. A wall that faces into the footprint
 *    it encloses is named (the majority of the walls chose the side).
 * 5. The closed footprints are clipped to the roof's plan outline.
 */
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import { elementBaseElevationMForTb, opaquePolygonBaseElevationMForTb } from './geometry3dMapper';
import { isPointInPolygon2D } from './pointInPolygon';
import { calculatePolygonArea } from './polygonSync';
import { interpolateProfileHeight, lineFaceEdgesAt, normalizeProfilePoints, readProfiledLineFace } from './profileLineFace';
import { isRoofLikeOpaqueElement, isSlopedPitchedRoofElementForEavesGable } from './roofElement';
import { inwardNormal2DForSlopedRoof, roofTopElevationAtPlanM } from './roofTopElevationAtPlanM';
import { isOrientationPitchAxis } from './slopePitchAxis';
import { roofCoversPlanPoint } from './wallEdgeFromRoofs';
import { isVerticalLineWall, withEffectiveStoreyHeights } from './zoneDerivation';
import type { BuildingElementOpaque, Element, Floor } from '../geometry/types';

type P = { x: number; y: number };

/** A bottom edge this far above the foot is off the floor; this close to a roof surface it is on that roof. */
const ON_ROOF_TOL_M = 0.05;
/** Wall ends this close are joined; a chain end this close to the roof outline stops on it. */
const JOIN_TOL_M = 0.1;
/** A wall end this low (top − bottom) meets the roof above it. */
const END_GAP_TOL_M = 0.05;
/** How far to the inside of a wall its inside is sampled: past the outline tolerance. */
const INSIDE_PROBE_M = 0.15;

const zonesCompatible = (a: string | undefined, b: string | undefined) => a === undefined || b === undefined || a === b;

/** Pitched roofs a wall can stand on (the R8/R9 proposer uses the same set). */
export function pitchedRoofsForWalls(elements: Element[], globalOrientationOffset: number | undefined): BuildingElementOpaque[] {
  return elements.filter((e): e is BuildingElementOpaque => {
    if (e.type !== 'BuildingElementOpaque' || e.isPlaceholder) return false;
    if (isOrientationPitchAxis(e) && !inwardNormal2DForSlopedRoof(e, globalOrientationOffset)) return false;
    return isSlopedPitchedRoofElementForEavesGable(e);
  });
}

/**
 * True for a **horizontal flat roof** line: roof-like, pitch exactly 0, and we can tell it is a roof
 * (name or HEM unheated-pitched flag), not an arbitrary pitch-0 opaque.
 */
export function isFlatRoofDeckLineForTb(o: BuildingElementOpaque): boolean {
  if (o.isPlaceholder) return false;
  if (!isRoofLikeOpaqueElement(o)) return false;
  if (o.pitch !== 0) return false;
  if ((o as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof) return true;
  const n = (o.name ?? '').trim().toLowerCase();
  return n === 'roof' || n.includes('roof');
}

/**
 * Deck elevation (m) of a flat roof, shared with the flat-roof edge and party-wall P4 proposals. It
 * is where the 3D preview draws the deck: `base_height` 0 or unset is the top of the roof's storey.
 * `floors` must carry effective storey heights.
 */
export function flatRoofDeckElevationMForTb(o: BuildingElementOpaque, floors: Floor[] | undefined): number {
  return opaquePolygonBaseElevationMForTb(o, floors ?? []);
}

const memos = new WeakMap<object, Map<string, unknown>>();
/** `compute()` once per (owner object, key): the store replaces arrays and elements on change. */
function memo<T>(owner: object, key: string, compute: () => T): T {
  let byKey = memos.get(owner);
  if (!byKey) memos.set(owner, (byKey = new Map()));
  if (!byKey.has(key)) byKey.set(key, compute());
  return byKey.get(key) as T;
}

/** `Object.values(elementsById)`, the same array for the same record, so derivations are shared. */
export const elementsOf = (elementsById: Record<string, Element>): Element[] =>
  memo(elementsById, 'values', () => Object.values(elementsById));

/** `withEffectiveStoreyHeights(floors, elements)`, the same array for the same inputs. */
export const effectiveFloorsOf = (floors: Floor[], elements: Element[]): Floor[] => {
  const byFloors = memo(elements, 'floors', () => new WeakMap<Floor[], Floor[]>());
  if (!byFloors.has(floors)) byFloors.set(floors, withEffectiveStoreyHeights(floors, elements));
  return byFloors.get(floors)!;
};

/** Pitched roofs and flat roof decks drawn as plan polygons: the roofs a wall can stand on. */
export function roofsWallsStandOn(elements: Element[], globalOrientationOffset: number | undefined): BuildingElementOpaque[] {
  return memo(elements, `roofs|${globalOrientationOffset}`, () => [
    ...pitchedRoofsForWalls(elements, globalOrientationOffset),
    ...elements.filter((e): e is BuildingElementOpaque =>
      e.type === 'BuildingElementOpaque' && (e.coordinates?.length ?? 0) >= 3 && isFlatRoofDeckLineForTb(e)),
  ]);
}

/** True when a cut-out could exist: some wall bottom is raised, or the model has a flat roof deck. */
export function modelMayHaveRoofCutouts(elements: Element[]): boolean {
  return memo(elements, 'mayHave', () => elements.some((e) => (e.type === 'BuildingElementOpaque' && isFlatRoofDeckLineForTb(e))
    || (readProfiledLineFace(e.extra_json)?.bottom_profile.some((p) => p.h > ON_ROOF_TOL_M) ?? false)));
}

/**
 * Stretches (t ranges, 0..1) of a wall's bottom edge that stand on a roof, with that roof.
 * Between bottom-edge points the edge is straight and lies on one roof surface, so each stretch is
 * matched at its midpoint; neighbouring stretches on the same roof are joined. A pitched roof
 * counts only where the bottom edge is above the foot (a wall on its floor is not on the eaves); a
 * flat roof deck counts at the foot too. `floors` must carry effective storey heights.
 */
export function bottomEdgeRoofRuns(
  w: Element,
  roofs: BuildingElementOpaque[],
  floors: Floor[] | undefined,
  globalOrientationOffset: number | undefined,
): Array<{ roof: BuildingElementOpaque; t0: number; t1: number }> {
  if (w.coordinates?.length !== 2) return [];
  const face = readProfiledLineFace(w.extra_json);
  const bottom = face ? normalizeProfilePoints(face.bottom_profile) : [{ t: 0, h: 0 }, { t: 1, h: 0 }];
  if (!bottom) return [];
  const [A, B] = [w.coordinates[0]!, w.coordinates[1]!];
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  if (len < 1e-9) return [];
  const foot = elementBaseElevationMForTb(w, floors ?? []);
  const dir = { x: (B.x - A.x) / len, y: (B.y - A.y) / len };
  // The roof whose surface passes through elevation z at plan point p.
  const roofAt = (p: P, z: number, raised: boolean) => roofs.find((r) => {
    if (r.id === w.id || (!raised && r.pitch !== 0)) return false;
    if (!zonesCompatible(w.zoneId, r.zoneId) || !roofCoversPlanPoint(r, p, dir)) return false;
    const roofZ = r.pitch === 0
      ? flatRoofDeckElevationMForTb(r, floors)
      : roofTopElevationAtPlanM(r, p.x, p.y, floors, globalOrientationOffset);
    return roofZ !== null && Math.abs(roofZ - z) <= ON_ROOF_TOL_M;
  });
  const runs: Array<{ roof: BuildingElementOpaque; t0: number; t1: number }> = [];
  for (let i = 0; i < bottom.length - 1; i += 1) {
    const t0 = bottom[i]!.t;
    const t1 = bottom[i + 1]!.t;
    const tm = (t0 + t1) / 2;
    const h = interpolateProfileHeight(bottom, tm);
    // A bottom edge on no roof is a stale fit: validation says "re-fit its shape".
    const roof = roofAt({ x: A.x + (B.x - A.x) * tm, y: A.y + (B.y - A.y) * tm }, foot + h, h > ON_ROOF_TOL_M);
    if (!roof) continue;
    const last = runs[runs.length - 1];
    if (last && last.roof === roof && last.t1 === t0) last.t1 = t1;
    else runs.push({ roof, t0, t1 });
  }
  return runs;
}

type NamedPoint = { wallName: string; p: P };

/** Why walls standing on a roof do not give a footprint; each kind has its own message. */
export type RoofFootprintIssue = { wallNames: string[] } & (
  /** Loose wall ends either side of a gap, or one end when nothing else is loose. */
  | { kind: 'gap'; ends: [NamedPoint] | [NamedPoint, NamedPoint] }
  /** Three or more walls meet at one point. */
  | { kind: 'branch'; at: P }
  /** Both ends stop on the roof outline, but the walls' inside does not choose one way round. */
  | { kind: 'side'; ends: [NamedPoint, NamedPoint] }
  /** One end meets the roof above it; the other stops at the roof outline. */
  | { kind: 'mixed'; ends: [NamedPoint, NamedPoint] }
  /** Both ends meet a roof above them, but no drawn roof above joins them. */
  | { kind: 'noRoofAbove'; ends: [NamedPoint, NamedPoint] }
  /** The one wall named faces into the footprint it encloses. */
  | { kind: 'facing' }
);

export type RoofCutout = {
  /** Plan polygons of the part of the roof inside the walls (polygon-clipping MultiPolygon). */
  polygons: MultiPolygon;
  /** Plan area of `polygons`. */
  planArea: number;
  /** Walls standing on the roof that close a footprint, sorted. */
  wallNames: string[];
  /** Stretches (t ranges) of those walls that stand on the roof. */
  standing: Array<{ wall: Element; t0: number; t1: number }>;
  /** Footprints that do not close, or are not clear. */
  issues: RoofFootprintIssue[];
};

type Seg = { el: Element; a: P; b: P; onRoof: boolean; probes: P[] };
type End = { seg: Seg; t: 0 | 1 };
type Chain = { pts: P[]; segs: Seg[]; head: End; tail: End };

const near = (p: P, q: P) => Math.hypot(p.x - q.x, p.y - q.y) <= JOIN_TOL_M;
const last = <T,>(list: T[]) => list[list.length - 1]!;
const isClosed = (c: Chain) => c.pts.length >= 3 && near(c.pts[0]!, last(c.pts));

/** Points where three or more of `segs` meet. */
function branchPoints(segs: Seg[]): Array<{ at: P; segs: Seg[] }> {
  const nodes: Array<{ at: P; segs: Seg[] }> = [];
  for (const s of segs) {
    for (const p of [s.a, s.b]) {
      let node: { at: P; segs: Seg[] } | undefined;
      for (const n of nodes) {
        if (near(n.at, p)) { node = n; break; }
      }
      if (node) node.segs.push(s);
      else nodes.push({ at: p, segs: [s] });
    }
  }
  return nodes.filter((n) => n.segs.length >= 3);
}

/** Joins segments end to end; callers have checked that no point joins three or more. */
function buildChains(segs: Seg[]): Chain[] {
  const pool = new Set(segs);
  const chains: Chain[] = [];
  for (const s of segs) {
    if (!pool.delete(s)) continue;
    const chain: Chain = { pts: [s.a, s.b], segs: [s], head: { seg: s, t: 0 }, tail: { seg: s, t: 1 } };
    for (const side of ['tail', 'head'] as const) {
      while (!isClosed(chain)) {
        const end = side === 'tail' ? last(chain.pts) : chain.pts[0]!;
        let next: Seg | undefined;
        for (const n of pool) {
          if (near(n.a, end) || near(n.b, end)) { next = n; break; }
        }
        if (!next) break;
        pool.delete(next);
        const fromA = near(next.a, end);
        const far = fromA ? next.b : next.a;
        const farEnd: End = { seg: next, t: fromA ? 1 : 0 };
        chain.segs.push(next);
        if (side === 'tail') { chain.pts.push(far); chain.tail = farEnd; } else { chain.pts.unshift(far); chain.head = farEnd; }
      }
    }
    chains.push(chain);
  }
  return chains;
}

/**
 * Walls that can stand on a roof or join a footprint: vertical line walls of the dwelling's
 * boundary (external, party, to unheated space), not internal partitions, not doors.
 */
export const isFootprintWall = (e: Element): boolean =>
  !e.isPlaceholder
  && isVerticalLineWall(e)
  && e.type !== 'BuildingElementAdjacentConditionedSpace'
  && (e as { location?: string }).location !== 'internal'
  && !(e.type === 'BuildingElementOpaque' && isRoofLikeOpaqueElement(e));

/** Distance from p to the segment a–b. */
function distToSegment(p: P, a: P, b: P): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len2 = ex * ex + ey * ey;
  const u = len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
  return Math.hypot(p.x - a.x - ex * u, p.y - a.y - ey * u);
}

/**
 * Walls a chain end can be joined through: walls of the zone that rise through the roof surface
 * where they are joined on the roof (an extension's own walls under a deck do not), never a wall
 * under or on a standing wall. A wall is split at every chain end and wall end on its span, so a
 * chain end mid-span joins there and how a wall is divided does not change the footprint.
 */
function linkSegments(
  roof: BuildingElementOpaque,
  elements: Element[],
  segs: Seg[],
  openEnds: P[],
  floors: Floor[],
  globalOrientationOffset: number | undefined,
): Seg[] {
  const ring = roof.coordinates;
  const onRoofPlan = (p: P) => isPointInPolygon2D(p, ring) || ringPosition(p, ring).d <= JOIN_TOL_M;
  // Off the roof's plan there is no surface to rise through; any wall of the zone joins there.
  const joinsAt = (el: Element, foot: number, t: number, p: P) => {
    if (!onRoofPlan(p)) return true;
    const z = roofSurfaceZ(roof, p, floors, globalOrientationOffset);
    if (z === null) return false;
    const { bottom, top } = lineFaceEdgesAt(el, t);
    return foot + bottom <= z + ON_ROOF_TOL_M && z < foot + top - ON_ROOF_TOL_M;
  };
  const standingEls = new Set(segs.map((s) => s.el));
  const walls = elements.flatMap((el) => {
    if (standingEls.has(el) || !isFootprintWall(el) || !segs.some((s) => zonesCompatible(s.el.zoneId, el.zoneId))) return [];
    const a = el.coordinates[0]!;
    const b = el.coordinates[1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < JOIN_TOL_M) return [];
    const foot = elementBaseElevationMForTb(el, floors);
    // Cheap first cut: a wall that joins nowhere at its ends or at a chain end on it is no link.
    const tOf = (p: P) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len);
    const ends = openEnds.filter((p) => distToSegment(p, a, b) <= JOIN_TOL_M);
    if (!joinsAt(el, foot, 0, a) && !joinsAt(el, foot, 1, b) && !ends.some((p) => joinsAt(el, foot, tOf(p), p))) return [];
    return [{ el, a, b, len, foot, tOf }];
  });
  const cuts = [...openEnds, ...walls.flatMap((w) => [w.a, w.b])];
  const links: Seg[] = [];
  for (const w of walls) {
    const ts = [0, 1, ...cuts.filter((p) => distToSegment(p, w.a, w.b) <= JOIN_TOL_M).map(w.tOf)]
      .map((t) => Math.max(0, Math.min(1, t)))
      .sort((x, y) => x - y)
      .filter((t, k, list) => k === 0 || (t - list[k - 1]!) * w.len > JOIN_TOL_M);
    ts[ts.length - 1] = 1;
    for (let k = 0; k < ts.length - 1; k += 1) {
      const at = (t: number): P => ({ x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t });
      const [t0, t1] = [ts[k]!, ts[k + 1]!];
      const s: Seg = { el: w.el, a: at(t0), b: at(t1), onRoof: false, probes: [] };
      const mid = at((t0 + t1) / 2);
      if (!joinsAt(w.el, w.foot, t0, s.a) || !joinsAt(w.el, w.foot, t1, s.b)) continue;
      if (segs.some((st) => distToSegment(mid, st.a, st.b) <= JOIN_TOL_M)) continue;
      // Walls stacked on one plan line (a ground and a first floor wall) are one join.
      if (links.some((l) => (near(l.a, s.a) && near(l.b, s.b)) || (near(l.a, s.b) && near(l.b, s.a)))) continue;
      links.push(s);
    }
  }
  return links;
}

/**
 * Shortest joins between open chain ends through link segments (Dijkstra over their end points),
 * each pair once.
 */
function shortestJoins(openEnds: P[], links: Seg[]): Array<{ i: number; j: number; length: number; path: Seg[] }> {
  // Plan points within JOIN_TOL_M are one node: bucket by a grid of that size.
  const nodes: P[] = [];
  const grid = new Map<string, number[]>();
  const cell = (v: number) => Math.floor(v / JOIN_TOL_M);
  const nodeOf = (p: P): number => {
    const [cx, cy] = [cell(p.x), cell(p.y)];
    const around = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].flatMap((dy) => grid.get(`${cx + dx},${cy + dy}`) ?? []));
    const hit = around.find((n) => near(nodes[n]!, p));
    if (hit !== undefined) return hit;
    nodes.push(p);
    const key = `${cx},${cy}`;
    grid.set(key, [...(grid.get(key) ?? []), nodes.length - 1]);
    return nodes.length - 1;
  };
  const endNodes = openEnds.map(nodeOf);
  const adjacent: Array<Array<{ to: number; link: Seg; length: number }>> = [];
  for (const link of links) {
    const [u, v] = [nodeOf(link.a), nodeOf(link.b)];
    if (u === v) continue;
    const length = Math.hypot(link.b.x - link.a.x, link.b.y - link.a.y);
    (adjacent[u] ??= []).push({ to: v, link, length });
    (adjacent[v] ??= []).push({ to: u, link, length });
  }
  const joins: Array<{ i: number; j: number; length: number; path: Seg[] }> = [];
  endNodes.forEach((start, i) => {
    const dist = new Map<number, number>([[start, 0]]);
    const via = new Map<number, { from: number; link: Seg }>();
    const done = new Set<number>();
    // ponytail: linear scan for the nearest open node (O(V²) per end); a heap if link graphs grow large.
    for (;;) {
      let cur = -1;
      for (const [n, d] of dist) if (!done.has(n) && (cur < 0 || d < dist.get(cur)!)) cur = n;
      if (cur < 0) break;
      done.add(cur);
      if (cur !== start) {
        endNodes.forEach((end, j) => {
          if (j <= i || end !== cur) return;
          const path: Seg[] = [];
          for (let n = cur; n !== start; n = via.get(n)!.from) path.unshift(via.get(n)!.link);
          joins.push({ i, j, length: dist.get(cur)!, path });
        });
      }
      for (const { to, link, length } of adjacent[cur] ?? []) {
        const d = dist.get(cur)! + length;
        if (!done.has(to) && d < (dist.get(to) ?? Infinity)) {
          dist.set(to, d);
          via.set(to, { from: cur, link });
        }
      }
    }
  });
  return joins;
}

/** Nearest point on a closed ring, as a position s = edge index + fraction along it. */
function ringPosition(p: P, ring: ReadonlyArray<P>): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const u = len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
    const d = Math.hypot(p.x - a.x - ex * u, p.y - a.y - ey * u);
    if (d < best.d) best = { s: i + u, d };
  }
  return best;
}

/** Ring vertices strictly between positions `from` and `to`, walking forward (+1) or backward (−1). */
function ringVerticesBetween(ring: ReadonlyArray<P>, from: number, to: number, dir: 1 | -1): P[] {
  const n = ring.length;
  const offset = (k: number) => (((dir * (k - from)) % n) + n) % n;
  const span = offset(to);
  return ring
    .flatMap((p, k) => {
      const o = offset(k);
      return o > 1e-9 && o < span - 1e-9 ? [{ p, o }] : [];
    })
    .sort((x, y) => x.o - y.o)
    .map(({ p }) => p);
}

/**
 * Cuts the head of a polyline at its first crossing with the ring, walking in from the head, so an
 * end past the roof outline becomes the point where the walls cross it. Unchanged when the head
 * is inside the ring or on it.
 */
function cutHeadAtRing(pts: P[], ring: ReadonlyArray<P>): P[] {
  if (isPointInPolygon2D(pts[0]!, ring) || ringPosition(pts[0]!, ring).d <= JOIN_TOL_M) return pts;
  for (let k = 0; k < pts.length - 1; k += 1) {
    const p = pts[k]!;
    const q = pts[k + 1]!;
    let best: { u: number; x: P } | null = null;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const den = (q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x);
      if (Math.abs(den) < 1e-12) continue;
      const u = ((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)) / den;
      const v = ((a.x - p.x) * (q.y - p.y) - (a.y - p.y) * (q.x - p.x)) / den;
      if (u < 0 || u > 1 || v < 0 || v > 1 || (best && best.u <= u)) continue;
      best = { u, x: { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u } };
    }
    if (best) return [best.x, ...pts.slice(k + 1)];
  }
  return pts;
}

/** Elevation of a roof's top surface at a plan point: the deck of a flat roof, the plane of a pitched one. */
function roofSurfaceZ(roof: BuildingElementOpaque, p: P, floors: Floor[], globalOrientationOffset: number | undefined): number | null {
  return roof.pitch === 0
    ? flatRoofDeckElevationMForTb(roof, floors)
    : roofTopElevationAtPlanM(roof, p.x, p.y, floors, globalOrientationOffset);
}

/** The part of a polygon where `f` (linear along each edge) is 0 or more (Sutherland–Hodgman). */
function clipWhereNonNegative(ring: ReadonlyArray<P>, f: (p: P) => number): P[] {
  const out: P[] = [];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    const [fp, fq] = [f(p), f(q)];
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) {
      const u = fp / (fp - fq);
      out.push({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
    }
  });
  return out;
}

/**
 * Closes a chain whose two ends have no height (the walls meet a roof above them) along the line
 * where the roofs drawn above those ends meet `host`: the valleys of a gable or hipped dormer, the
 * back edge of a flat-roofed one. Those roofs are cut back to where they are over `host`, so a
 * roof drawn on into the slope still meets it there; of the two ways round their outline between
 * the ends, the one on `host`'s surface is taken, never the way round eaves that overhang the
 * walls. Null when no roof is above an end, the roofs above the two ends do not join, or not
 * exactly one way round lies on `host`.
 */
function closeUnderRoofsAbove(
  chain: Chain,
  host: BuildingElementOpaque,
  roofs: BuildingElementOpaque[],
  floors: Floor[],
  globalOrientationOffset: number | undefined,
): P[] | null {
  const above = (end: End, p: P) => {
    const { a, b, el } = end.seg;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const topZ = elementBaseElevationMForTb(el, floors) + lineFaceEdgesAt(el, end.t).top;
    return roofs.filter((r) => {
      if (!roofCoversPlanPoint(r, p, dir) && ringPosition(p, r.coordinates).d > JOIN_TOL_M) return false;
      const z = roofSurfaceZ(r, p, floors, globalOrientationOffset);
      return z !== null && Math.abs(z - topZ) <= JOIN_TOL_M;
    });
  };
  const head = chain.pts[0]!;
  const tail = last(chain.pts);
  const overHead = above(chain.head, head);
  const overTail = above(chain.tail, tail);
  if (overHead.length === 0 || overTail.length === 0) return null;
  const upper = [...new Set([...overHead, ...overTail])];
  // Height of roof r over host at p; both are planes, so it is linear in p.
  const over = (r: BuildingElementOpaque, p: P) =>
    (roofSurfaceZ(r, p, floors, globalOrientationOffset) ?? NaN) - (roofSurfaceZ(host, p, floors, globalOrientationOffset) ?? NaN);
  const clipped = upper
    .map((r) => ({ r, ring: clipWhereNonNegative(r.coordinates, (p) => over(r, p)) }))
    .filter(({ ring }) => ring.length >= 3);
  if (clipped.length === 0) return null;
  const planes = clipped.map(({ ring }): Polygon => [ring.map((p) => [p.x, p.y] as [number, number])]);
  const outline = polygonClipping.union(...(planes as [Polygon, ...Polygon[]]))
    .map((polygon) => polygon[0]!.slice(0, -1).map(([x, y]) => ({ x, y })))
    .find((r) => [head, tail].every((p) => isPointInPolygon2D(p, r) || ringPosition(p, r).d <= JOIN_TOL_M));
  if (!outline) return null;
  const from = ringPosition(tail, outline).s;
  const to = ringPosition(head, outline).s;
  // A way lies on host where the roof it runs along meets host, at the middle of each of its edges.
  const onHost = (path: P[]) => path.slice(1).every((q, k) => {
    const m = { x: (path[k]!.x + q.x) / 2, y: (path[k]!.y + q.y) / 2 };
    return clipped.some(({ r, ring }) => ringPosition(m, ring).d <= JOIN_TOL_M && Math.abs(over(r, m)) <= JOIN_TOL_M);
  });
  const ways = ([1, -1] as const)
    .map((dir) => ringVerticesBetween(outline, from, to, dir))
    .filter((between) => onHost([tail, ...between, head]));
  return ways.length === 1 ? [...chain.pts, ...ways[0]!] : null;
}

/**
 * The part of `roof` inside the walls that stand on it, and the footprints that do not close or
 * are not clear. Null when no wall encloses part of the roof. `floors` must carry effective storey
 * heights.
 */
export function deriveRoofCutout(
  roof: Element,
  elements: Element[],
  floors: Floor[],
  globalOrientationOffset: number | undefined,
): RoofCutout | null {
  if (roof.type !== 'BuildingElementOpaque' || !modelMayHaveRoofCutouts(elements)) return null;
  // Elements are replaced, never changed in place, so one derivation serves every caller of a model.
  const byRoof = memo(elements, `cutouts|${globalOrientationOffset}|${JSON.stringify(floors)}`, () => new WeakMap<Element, RoofCutout | null>());
  if (!byRoof.has(roof)) byRoof.set(roof, computeRoofCutout(roof, elements, floors, globalOrientationOffset));
  return byRoof.get(roof)!;
}

function computeRoofCutout(
  roof: BuildingElementOpaque,
  elements: Element[],
  floors: Floor[],
  globalOrientationOffset: number | undefined,
): RoofCutout | null {
  const roofs = roofsWallsStandOn(elements, globalOrientationOffset);
  if (!roofs.some((r) => r.id === roof.id)) return null;
  const ring = roof.coordinates;
  const inRoof = (p: P) => isPointInPolygon2D(p, ring);

  // 1. Walls standing on the roof that face over it somewhere.
  const standing: RoofCutout['standing'] = [];
  const segs: Seg[] = [];
  // A wall can stand on a deck only with a bottom point at the deck; on a pitched roof only raised.
  const deckZ = roof.pitch === 0 ? flatRoofDeckElevationMForTb(roof, floors) : null;
  const mayStand = (el: Element) => {
    const bottom = readProfiledLineFace(el.extra_json)?.bottom_profile.map((p) => p.h) ?? [0];
    if (deckZ === null) return bottom.some((h) => h > ON_ROOF_TOL_M);
    const foot = elementBaseElevationMForTb(el, floors);
    return foot + Math.min(...bottom) <= deckZ + ON_ROOF_TOL_M && deckZ <= foot + Math.max(...bottom) + ON_ROOF_TOL_M;
  };
  for (const el of elements) {
    if (!isFootprintWall(el) || !mayStand(el)) continue;
    const runs = bottomEdgeRoofRuns(el, roofs, floors, globalOrientationOffset).filter((run) => run.roof.id === roof.id);
    if (runs.length === 0) continue;
    const a = el.coordinates[0]!;
    const b = el.coordinates[1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const left = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    const probes = runs.flatMap(({ t0, t1 }) => {
      const tm = (t0 + t1) / 2;
      const probe = { x: a.x + (b.x - a.x) * tm + left.x * INSIDE_PROBE_M, y: a.y + (b.y - a.y) * tm + left.y * INSIDE_PROBE_M };
      return inRoof(probe) ? [probe] : [];
    });
    if (probes.length === 0) continue;
    runs.forEach(({ t0, t1 }) => standing.push({ wall: el, t0, t1 }));
    segs.push({ el, a, b, onRoof: true, probes });
  }
  if (segs.length === 0) return null;

  const issues: RoofFootprintIssue[] = [];
  const names = (list: Seg[]) => [...new Set(list.map((s) => s.el.name))].sort();
  const branches = branchPoints(segs);
  if (branches.length > 0) {
    for (const { at, segs: meeting } of branches) issues.push({ kind: 'branch', at, wallNames: names(meeting) });
    return { polygons: [], planArea: 0, wallNames: [], standing: [], issues };
  }

  // 3. Join open chain ends through walls of the zone that rise through the roof, shortest first.
  const firstChains = buildChains(segs);
  const openEnds = firstChains.flatMap((c) => (isClosed(c) ? [] : [c.pts[0]!, last(c.pts)]));
  const joins = openEnds.length === 0
    ? []
    : shortestJoins(openEnds, linkSegments(roof, elements, segs, openEnds, floors, globalOrientationOffset));
  const usedEnds = new Set<number>();
  const usedLinks = new Set<Seg>();
  for (const join of joins.sort((x, y) => x.length - y.length || x.i - y.i || x.j - y.j)) {
    if (usedEnds.has(join.i) || usedEnds.has(join.j) || join.path.some((l) => usedLinks.has(l))) continue;
    usedEnds.add(join.i);
    usedEnds.add(join.j);
    join.path.forEach((l) => usedLinks.add(l));
  }
  const allSegs = [...segs, ...usedLinks];
  const linkBranches = branchPoints(allSegs);
  if (linkBranches.length > 0) {
    for (const { at, segs: meeting } of linkBranches) issues.push({ kind: 'branch', at, wallNames: names(meeting) });
    return { polygons: [], planArea: 0, wallNames: [], standing: [], issues };
  }

  // 4. Close each chain.
  const stopKind = (end: End, p: P): 'outline' | 'zero' | null => {
    if (!inRoof(p) || ringPosition(p, ring).d <= JOIN_TOL_M) return 'outline';
    if (end.seg.onRoof) {
      const { bottom, top } = lineFaceEdgesAt(end.seg.el, end.t);
      if (top - bottom <= END_GAP_TOL_M) return 'zero';
    }
    return null;
  };
  const footprints: Polygon[] = [];
  const closingWalls = new Set<Seg>();
  const loose: Array<NamedPoint & { chainWalls: string[] }> = [];
  // A footprint is kept; each wall in it whose inside is not within it faces into it.
  const accept = (onRoof: Seg[], pts: P[]) => {
    onRoof.forEach((s) => {
      closingWalls.add(s);
      if (s.probes.some((probe) => !isPointInPolygon2D(probe, pts))) issues.push({ kind: 'facing', wallNames: [s.el.name] });
    });
    footprints.push([pts.map((p) => [p.x, p.y] as [number, number])]);
  };
  for (const chain of buildChains(allSegs)) {
    const onRoof = chain.segs.filter((s) => s.onRoof);
    if (isClosed(chain)) {
      accept(onRoof, chain.pts);
      continue;
    }
    const head = chain.pts[0]!;
    const tail = last(chain.pts);
    const ends: [NamedPoint, NamedPoint] = [{ wallName: chain.head.seg.el.name, p: head }, { wallName: chain.tail.seg.el.name, p: tail }];
    const kinds = [stopKind(chain.head, head), stopKind(chain.tail, tail)];
    if (kinds[0] === null || kinds[1] === null) {
      kinds.forEach((k, n) => { if (k === null) loose.push({ ...ends[n]!, chainWalls: names(onRoof) }); });
      continue;
    }
    if (kinds[0] !== kinds[1]) {
      issues.push({ kind: 'mixed', ends, wallNames: names(onRoof) });
      continue;
    }
    if (kinds[0] === 'zero') {
      const closed = closeUnderRoofsAbove(chain, roof, roofs.filter((r) => r.id !== roof.id), floors, globalOrientationOffset);
      if (closed) accept(onRoof, closed);
      else issues.push({ kind: 'noRoofAbove', ends, wallNames: names(onRoof) });
      continue;
    }
    // Along the outline: cut the chain where it crosses the outline, then take the way round
    // that has more of the walls' inside probes within it.
    const pts = cutHeadAtRing([...cutHeadAtRing(chain.pts, ring)].reverse(), ring).reverse();
    const from = ringPosition(last(pts), ring).s;
    const to = ringPosition(pts[0]!, ring).s;
    const probes = onRoof.flatMap((s) => s.probes);
    const ways = ([1, -1] as const).map((dir) => {
      const polygon = [...pts, ...ringVerticesBetween(ring, from, to, dir)];
      return { polygon, inside: probes.filter((probe) => isPointInPolygon2D(probe, polygon)).length };
    });
    if (ways[0]!.inside === ways[1]!.inside) {
      issues.push({ kind: 'side', ends, wallNames: names(onRoof) });
      continue;
    }
    accept(onRoof, ways[0]!.inside > ways[1]!.inside ? ways[0]!.polygon : ways[1]!.polygon);
  }
  // Each loose end is paired with the nearest other one: the gap a wall would close.
  while (loose.length > 0) {
    const a = loose.shift()!;
    let k = -1;
    loose.forEach((b, i) => {
      if (k < 0 || Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) < Math.hypot(loose[k]!.p.x - a.p.x, loose[k]!.p.y - a.p.y)) k = i;
    });
    const b = k >= 0 ? loose.splice(k, 1)[0]! : null;
    issues.push({
      kind: 'gap',
      wallNames: [...new Set([...a.chainWalls, ...(b?.chainWalls ?? [])])].sort(),
      ends: b ? [{ wallName: a.wallName, p: a.p }, { wallName: b.wallName, p: b.p }] : [{ wallName: a.wallName, p: a.p }],
    });
  }

  // 5. Clip to the roof outline. Degenerate rings clip to nothing.
  const polygons = footprints.length === 0
    ? []
    : polygonClipping.intersection(polygonClipping.union(...(footprints as [Polygon, ...Polygon[]])), [ring.map((p) => [p.x, p.y] as [number, number])]);
  const planArea = polygons.reduce((sum, polygon) => sum + polygon.reduce((s, r, k) => {
    const a = calculatePolygonArea(r.map(([x, y]) => ({ x, y, z: 0 })));
    return k === 0 ? s + a : s - a;
  }, 0), 0);
  const closing = planArea > 1e-6 ? [...closingWalls] : [];
  return {
    polygons,
    planArea,
    wallNames: names(closing),
    standing: standing.filter((s) => closing.some((c) => c.el === s.wall)),
    issues,
  };
}

const fmt = (p: P) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;

/** The model warning for walls on a roof that give no footprint: where, and what to do. */
export function roofFootprintIssueMessage(roofName: string, issue: RoofFootprintIssue): string {
  const walls = issue.wallNames.map((n) => `"${n}"`).join(', ');
  const lead = `Walls standing on "${roofName}" (${walls})`;
  switch (issue.kind) {
    case 'gap': {
      const [a, b] = issue.ends;
      const where = b
        ? `the gap is between "${a.wallName}" at ${fmt(a.p)} and "${b.wallName}" at ${fmt(b.p)}. Add a wall there`
        : `"${a.wallName}" ends at ${fmt(a.p)} without meeting another wall or the roof edge. Extend it to a wall or the roof edge`;
      return `${lead} do not close a footprint: ${where} or set their bottoms to Flat.`;
    }
    case 'branch':
      return `${lead} meet at ${fmt(issue.at)}, so the footprint is not clear. Make only two walls meet at each point.`;
    case 'side': {
      const [a, b] = issue.ends;
      return `${lead} stop at the roof edge at ${fmt(a.p)} and ${fmt(b.p)}, but their inside is on both sides of the footprint. Make the walls face outward (flip the wrong ones).`;
    }
    case 'noRoofAbove': {
      const [a, b] = issue.ends;
      return `${lead} meet a roof above them at ${fmt(a.p)} and ${fmt(b.p)}, but no roof drawn above those ends joins them. Draw the roof over these walls, or add a wall between these ends.`;
    }
    case 'facing':
      return `"${issue.wallNames[0]}" faces into the space it encloses on "${roofName}". Flip the wall so it faces outward.`;
    case 'mixed': {
      const [a, b] = issue.ends;
      return `${lead} do not close a footprint: one end meets the roof and one stops at the roof edge (${fmt(a.p)} and ${fmt(b.p)}). Add a wall between these ends.`;
    }
  }
}
