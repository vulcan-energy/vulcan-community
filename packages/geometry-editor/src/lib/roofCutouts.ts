// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The part of a pitched roof inside walls that stand on it (a box dormer, a loft conversion, an
 * extension that runs into the main roof). That part is inside the dwelling: it is not external
 * roof area and has no eaves, verge or ridge. It is derived from the current geometry every time,
 * like area, so it cannot go stale.
 *
 * Footprint: the walls whose bottom edge stands on the roof, joined end to end. An open chain may
 * be joined by one other wall of the zone whose two ends meet two chain ends (the front wall of an
 * extension, which stands on the floor). A chain that is still open closes with a straight line
 * when both of its ends stop on the roof: at a wall end of no height (the wall meets the roof
 * above it, as a dormer cheek does) or on or past the roof's outline (the ridge, the eaves).
 * Otherwise the footprint is open: it is reported, never guessed. The closed footprint is then
 * clipped to the roof's plan outline.
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
import type { BuildingElementOpaque, Element, Floor } from '../geometry/types';

type P = { x: number; y: number };

/** A bottom edge this far above the foot is off the floor; this close to a roof plane it is on that roof. */
const ON_ROOF_TOL_M = 0.05;
/** Wall ends this close are joined; a chain end this close to the roof outline stops on it. */
const JOIN_TOL_M = 0.1;
/** A wall end this low (top − bottom) meets the roof above it. */
const END_GAP_TOL_M = 0.05;

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
 * Stretches (t ranges, 0..1) of a wall's bottom edge that stand on a pitched roof, with that roof.
 * Between bottom-edge points the edge is straight and lies on one roof plane, so each stretch is
 * matched at its midpoint; neighbouring stretches on the same roof are joined. `floors` must carry
 * effective storey heights.
 */
export function bottomEdgeRoofRuns(
  w: Element,
  roofs: BuildingElementOpaque[],
  floors: Floor[] | undefined,
  globalOrientationOffset: number | undefined,
): Array<{ roof: BuildingElementOpaque; t0: number; t1: number }> {
  const bottom = normalizeProfilePoints(readProfiledLineFace(w.extra_json)?.bottom_profile);
  if (!bottom || w.coordinates?.length !== 2) return [];
  const [A, B] = [w.coordinates[0]!, w.coordinates[1]!];
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  if (len < 1e-9) return [];
  const foot = elementBaseElevationMForTb(w, floors ?? []);
  const dir = { x: (B.x - A.x) / len, y: (B.y - A.y) / len };
  // The roof whose plane passes through elevation z at plan point p.
  const roofAt = (p: P, z: number) => roofs.find((r) => {
    if (r.id === w.id || !zonesCompatible(w.zoneId, r.zoneId) || !roofCoversPlanPoint(r, p, dir)) return false;
    const roofZ = roofTopElevationAtPlanM(r, p.x, p.y, floors, globalOrientationOffset);
    return roofZ !== null && Math.abs(roofZ - z) <= ON_ROOF_TOL_M;
  });
  const runs: Array<{ roof: BuildingElementOpaque; t0: number; t1: number }> = [];
  for (let i = 0; i < bottom.length - 1; i += 1) {
    const t0 = bottom[i]!.t;
    const t1 = bottom[i + 1]!.t;
    const tm = (t0 + t1) / 2;
    const h = interpolateProfileHeight(bottom, tm);
    if (h <= ON_ROOF_TOL_M) continue;
    // A bottom edge on no roof is a stale fit: validation says "re-fit its shape".
    const roof = roofAt({ x: A.x + (B.x - A.x) * tm, y: A.y + (B.y - A.y) * tm }, foot + h);
    if (!roof) continue;
    const last = runs[runs.length - 1];
    if (last && last.roof === roof && last.t1 === t0) last.t1 = t1;
    else runs.push({ roof, t0, t1 });
  }
  return runs;
}

export type RoofFootprintGap = {
  /** Walls standing on the roof in the open chain. */
  wallNames: string[];
  /** The loose wall ends either side of the gap, or one end when nothing else is loose. */
  ends: [{ wallName: string; p: P }] | [{ wallName: string; p: P }, { wallName: string; p: P }];
};

export type RoofCutout = {
  /** Plan polygons of the part of the roof inside the walls (polygon-clipping MultiPolygon). */
  polygons: MultiPolygon;
  /** Plan area of `polygons`. */
  planArea: number;
  /** Walls standing on the roof that close a footprint, sorted. */
  wallNames: string[];
  /** Footprints that do not close. */
  gaps: RoofFootprintGap[];
};

type Seg = { el: Element; a: P; b: P; onRoof: boolean };
type End = { seg: Seg; t: 0 | 1 };
type Chain = { pts: P[]; segs: Seg[]; head: End; tail: End };

const near = (p: P, q: P) => Math.hypot(p.x - q.x, p.y - q.y) <= JOIN_TOL_M;
const last = <T,>(list: T[]) => list[list.length - 1]!;
const isClosed = (c: Chain) => c.pts.length >= 3 && near(c.pts[0]!, last(c.pts));

function buildChains(segs: Seg[]): Chain[] {
  const pool = new Set(segs);
  const chains: Chain[] = [];
  for (const s of segs) {
    if (!pool.delete(s)) continue;
    const chain: Chain = { pts: [s.a, s.b], segs: [s], head: { seg: s, t: 0 }, tail: { seg: s, t: 1 } };
    for (const side of ['tail', 'head'] as const) {
      // ponytail: greedy walk; a node where three walls meet takes the first, which is enough for
      // a footprint's outline but not for a wall grid.
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

const isVerticalLineWall = (e: Element): boolean =>
  !e.isPlaceholder
  && e.coordinates?.length === 2
  && (e.type === 'BuildingElementPartyWall'
    || e.type === 'BuildingElementAdjacentConditionedSpace'
    || e.type === 'BuildingElementAdjacentUnconditionedSpace_Simple'
    || (e.type === 'BuildingElementOpaque' && !isRoofLikeOpaqueElement(e)
      && (typeof e.pitch !== 'number' || e.pitch === 90)));

function distanceToRing(p: P, ring: ReadonlyArray<P>): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const u = len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
    best = Math.min(best, Math.hypot(p.x - a.x - ex * u, p.y - a.y - ey * u));
  }
  return best;
}

/** True when any wall has a bottom edge above its foot (the cheap test before deriving cut-outs). */
export function modelHasRaisedWallBottoms(elements: Element[]): boolean {
  return elements.some((e) => readProfiledLineFace(e.extra_json)?.bottom_profile.some((p) => p.h > ON_ROOF_TOL_M) ?? false);
}

/**
 * The part of `roof` inside the walls that stand on it, and the footprints that do not close.
 * Null when no wall stands on the roof. `floors` must carry effective storey heights.
 */
export function deriveRoofCutout(
  roof: Element,
  elements: Element[],
  floors: Floor[],
  globalOrientationOffset: number | undefined,
): RoofCutout | null {
  if (roof.type !== 'BuildingElementOpaque' || !modelHasRaisedWallBottoms(elements)) return null;
  const roofs = pitchedRoofsForWalls(elements, globalOrientationOffset);
  if (!roofs.some((r) => r.id === roof.id)) return null;
  const ring = roof.coordinates;

  const standing = elements.filter((e) => isVerticalLineWall(e)
    && bottomEdgeRoofRuns(e, roofs, floors, globalOrientationOffset).some((run) => run.roof.id === roof.id));
  if (standing.length === 0) return null;
  const seg = (el: Element, onRoof: boolean): Seg => ({ el, a: el.coordinates[0]!, b: el.coordinates[1]!, onRoof });
  const segs = standing.map((el) => seg(el, true));

  // One other wall of the zone may join two open chain ends. Walls stacked on one plan line (a
  // ground and a first floor wall) are the same join, so the first one is kept.
  const openEnds = buildChains(segs).flatMap((c) => (isClosed(c) ? [] : [c.pts[0]!, last(c.pts)]));
  const openEndAt = (q: P) => openEnds.findIndex((p) => near(p, q));
  const standingSet = new Set(standing);
  const links: Seg[] = [];
  for (const el of elements) {
    if (standingSet.has(el) || !isVerticalLineWall(el) || !standing.some((w) => zonesCompatible(w.zoneId, el.zoneId))) continue;
    const s = seg(el, false);
    const i = openEndAt(s.a);
    const j = openEndAt(s.b);
    if (i < 0 || j < 0 || i === j) continue;
    if (links.some((l) => (near(l.a, s.a) && near(l.b, s.b)) || (near(l.a, s.b) && near(l.b, s.a)))) continue;
    links.push(s);
  }

  // A chain end stops on the roof where its wall has no height or where it is on or past the outline.
  const stops = (end: End, p: P) => {
    if (end.seg.onRoof) {
      const { bottom, top } = lineFaceEdgesAt(end.seg.el, end.t);
      if (top - bottom <= END_GAP_TOL_M) return true;
    }
    return !isPointInPolygon2D(p, ring) || distanceToRing(p, ring) <= JOIN_TOL_M;
  };

  const footprints: Polygon[] = [];
  const closingWalls = new Set<string>();
  // Chain ends that stop nowhere, with the walls standing on the roof in their chain.
  const loose: Array<{ wallName: string; p: P; chainWalls: string[] }> = [];
  for (const chain of buildChains([...segs, ...links])) {
    const head = chain.pts[0]!;
    const tail = last(chain.pts);
    const onRoofNames = [...new Set(chain.segs.flatMap((s) => (s.onRoof ? [s.el.name] : [])))];
    if (!isClosed(chain)) {
      const ends = ([[chain.head, head], [chain.tail, tail]] as const).filter(([end, p]) => !stops(end, p));
      if (ends.length > 0) {
        ends.forEach(([end, p]) => loose.push({ wallName: end.seg.el.name, p, chainWalls: onRoofNames }));
        continue;
      }
    }
    onRoofNames.forEach((n) => closingWalls.add(n));
    footprints.push([chain.pts.map((p) => [p.x, p.y] as [number, number])]);
  }
  // Each loose end is paired with the nearest other one: the gap a wall would close.
  const gaps: RoofFootprintGap[] = [];
  while (loose.length > 0) {
    const a = loose.shift()!;
    let k = -1;
    loose.forEach((b, i) => {
      if (k < 0 || Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) < Math.hypot(loose[k]!.p.x - a.p.x, loose[k]!.p.y - a.p.y)) k = i;
    });
    const b = k >= 0 ? loose.splice(k, 1)[0]! : null;
    gaps.push({
      wallNames: [...new Set([...a.chainWalls, ...(b?.chainWalls ?? [])])].sort(),
      ends: b ? [{ wallName: a.wallName, p: a.p }, { wallName: b.wallName, p: b.p }] : [{ wallName: a.wallName, p: a.p }],
    });
  }

  // Degenerate rings (a wall along the roof edge, closed onto itself) clip to nothing.
  const polygons = footprints.length === 0
    ? []
    : polygonClipping.intersection(polygonClipping.union(...(footprints as [Polygon, ...Polygon[]])), [ring.map((p) => [p.x, p.y] as [number, number])]);
  const planArea = polygons.reduce((sum, polygon) => sum + polygon.reduce((s, r, k) => {
    const a = calculatePolygonArea(r.map(([x, y]) => ({ x, y, z: 0 })));
    return k === 0 ? s + a : s - a;
  }, 0), 0);
  return { polygons, planArea, wallNames: planArea > 1e-6 ? [...closingWalls].sort() : [], gaps };
}

const fmt = (p: P) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;

/** The model warning for a footprint that does not close: where the gap is and how to fix it. */
export function roofFootprintGapMessage(roofName: string, gap: RoofFootprintGap): string {
  const [a, b] = gap.ends;
  const walls = gap.wallNames.map((n) => `"${n}"`).join(', ');
  const where = b
    ? `the gap is between "${a.wallName}" at ${fmt(a.p)} and "${b.wallName}" at ${fmt(b.p)}. Add a wall there`
    : `"${a.wallName}" ends at ${fmt(a.p)} without meeting another wall or the roof edge. Extend it to a wall or the roof edge`;
  return `Walls standing on "${roofName}" (${walls}) do not close a footprint: ${where} or set their bottoms to Flat.`;
}
