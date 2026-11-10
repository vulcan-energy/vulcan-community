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
 * 3. Open chain ends are joined through other walls of the zone (an extension's front wall and a
 *    side wall that stand on the floor), shortest joins first.
 * 4. A chain that is still open closes where both ends stop on the roof:
 *    - both at a wall end of no height (the wall meets the roof above it, as a dormer cheek does):
 *      a straight line between them, which is where the roof above meets this roof;
 *    - both on or past the roof outline: along the outline, the way round that has more of the
 *      walls' inside within it (a tie is reported).
 *    Any other case is reported with the ends, never guessed.
 * 5. The closed footprints are clipped to the roof's plan outline.
 */
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import { elementBaseElevationMForTb } from './geometry3dMapper';
import { isPointInPolygon2D } from './pointInPolygon';
import { calculatePolygonArea } from './polygonSync';
import { interpolateProfileHeight, lineFaceEdgesAt, normalizeProfilePoints, readProfiledLineFace } from './profileLineFace';
import { isRoofLikeOpaqueElement, isSlopedPitchedRoofElementForEavesGable } from './roofElement';
import { inwardNormal2DForSlopedRoof, roofTopElevationAtPlanM } from './roofTopElevationAtPlanM';
import { isOrientationPitchAxis } from './slopePitchAxis';
import { roofCoversPlanPoint } from './wallEdgeFromRoofs';
import { isVerticalLineWall } from './zoneDerivation';
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

/** Deck elevation (m) for flat roof TB geometry — shared with party-wall × flat-roof P4 proposals. */
export function flatRoofDeckElevationMForTb(o: BuildingElementOpaque, floors: Floor[] | undefined): number {
  if (floors && floors.length > 0) {
    return elementBaseElevationMForTb(o, floors);
  }
  const c = o.coordinates;
  const bh = o.base_height;
  if (typeof bh === 'number' && Number.isFinite(bh) && bh >= 0) return bh;
  let maxZ = -Infinity;
  for (const p of c ?? []) {
    if (typeof p?.z === 'number' && Number.isFinite(p.z)) maxZ = Math.max(maxZ, p.z);
  }
  if (maxZ !== -Infinity) return maxZ;
  return 0;
}

/** Pitched roofs and flat roof decks drawn as plan polygons: the roofs a wall can stand on. */
export function roofsWallsStandOn(elements: Element[], globalOrientationOffset: number | undefined): BuildingElementOpaque[] {
  const flat = elements.filter((e): e is BuildingElementOpaque =>
    e.type === 'BuildingElementOpaque' && (e.coordinates?.length ?? 0) >= 3 && isFlatRoofDeckLineForTb(e));
  return [...pitchedRoofsForWalls(elements, globalOrientationOffset), ...flat];
}

/** True when a cut-out could exist: some wall bottom is raised, or the model has a flat roof deck. */
export function modelMayHaveRoofCutouts(elements: Element[]): boolean {
  return elements.some((e) => (e.type === 'BuildingElementOpaque' && isFlatRoofDeckLineForTb(e))
    || (readProfiledLineFace(e.extra_json)?.bottom_profile.some((p) => p.h > ON_ROOF_TOL_M) ?? false));
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

/** Walls that can stand on a roof or join a footprint: vertical line walls, not internal, not doors. */
export const isFootprintWall = (e: Element): boolean =>
  !e.isPlaceholder
  && isVerticalLineWall(e)
  && (e as { location?: string }).location !== 'internal'
  && !(e.type === 'BuildingElementOpaque' && isRoofLikeOpaqueElement(e));

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
  const roofs = roofsWallsStandOn(elements, globalOrientationOffset);
  if (!roofs.some((r) => r.id === roof.id)) return null;
  const ring = roof.coordinates;
  const inRoof = (p: P) => isPointInPolygon2D(p, ring);

  // 1. Walls standing on the roof that face over it somewhere.
  const standing: RoofCutout['standing'] = [];
  const segs: Seg[] = [];
  for (const el of elements) {
    if (!isFootprintWall(el)) continue;
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

  // 3. Join open chain ends through other walls of the zone, shortest joins first.
  const firstChains = buildChains(segs);
  const openEnds = firstChains.flatMap((c) => (isClosed(c) ? [] : [c.pts[0]!, last(c.pts)]));
  const links: Seg[] = [];
  const onRoofSet = new Set(segs.map((s) => s.el));
  for (const el of elements) {
    if (onRoofSet.has(el) || !isFootprintWall(el) || !segs.some((s) => zonesCompatible(s.el.zoneId, el.zoneId))) continue;
    const s: Seg = { el, a: el.coordinates[0]!, b: el.coordinates[1]!, onRoof: false, probes: [] };
    // Walls stacked on one plan line (a ground and a first floor wall) are one join.
    if (links.some((l) => (near(l.a, s.a) && near(l.b, s.b)) || (near(l.a, s.b) && near(l.b, s.a)))) continue;
    links.push(s);
  }
  const joins: Array<{ i: number; j: number; length: number; path: Seg[] }> = [];
  openEnds.forEach((start, i) => {
    // Shortest paths from this end through the link walls (Dijkstra over their end points).
    const best: Array<{ at: P; length: number; path: Seg[] }> = [{ at: start, length: 0, path: [] }];
    const done: P[] = [];
    while (best.length > 0) {
      best.sort((x, y) => x.length - y.length);
      const cur = best.shift()!;
      if (done.some((p) => near(p, cur.at))) continue;
      done.push(cur.at);
      openEnds.forEach((end, j) => {
        if (j > i && cur.path.length > 0 && near(end, cur.at)) joins.push({ i, j, length: cur.length, path: cur.path });
      });
      // A link back to a point already reached is dropped when it is taken off the queue.
      for (const l of links) {
        const next = near(l.a, cur.at) ? l.b : near(l.b, cur.at) ? l.a : null;
        if (next) best.push({ at: next, length: cur.length + Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y), path: [...cur.path, l] });
      }
    }
  });
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
  for (const chain of buildChains(allSegs)) {
    const onRoof = chain.segs.filter((s) => s.onRoof);
    const ring2 = (pts: P[]): Polygon => [pts.map((p) => [p.x, p.y] as [number, number])];
    if (isClosed(chain)) {
      onRoof.forEach((s) => closingWalls.add(s));
      footprints.push(ring2(chain.pts));
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
      onRoof.forEach((s) => closingWalls.add(s));
      footprints.push(ring2(chain.pts));
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
    onRoof.forEach((s) => closingWalls.add(s));
    footprints.push(ring2(ways[0]!.inside > ways[1]!.inside ? ways[0]!.polygon : ways[1]!.polygon));
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
    case 'mixed': {
      const [a, b] = issue.ends;
      return `${lead} do not close a footprint: one end meets the roof and one stops at the roof edge (${fmt(a.p)} and ${fmt(b.p)}). Add a wall between these ends.`;
    }
  }
}
