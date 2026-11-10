// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Wall edges fitted to pitched roofs: "On roof" (bottom) and "Under roof" (top) in the wall
 * shape rows.
 * Heights are metres above the wall foot; t runs 0..1 from the wall's first to second coordinate.
 */
import { elementBaseElevationMForTb } from './geometry3dMapper';
import { isPointInPolygon2D } from './pointInPolygon';
import { interpolateProfileHeight, wallFaceBreakpoints, type ProfilePoint } from './profileLineFace';
import { roofTopElevationAtPlanM } from './roofTopElevationAtPlanM';
import { roundToTwoDecimals } from '../geometry/constants';
import type { BuildingElementOpaque, Element, Floor } from '../geometry/types';

export type WallRoofEdge = { profile: ProfilePoint[]; roofNames: string[] };

/** Stored roof snapshot and a fresh fit may differ by this much before the wall shows "Roof changed". */
export const ROOF_FIT_TOLERANCE_M = 0.005;

// A plan point this close to a roof outline counts as covered: a gable wall sits on the roof's
// edge in plan, and drawn models put it a few centimetres either side (H482: 6.4 cm). Within a
// wall thickness, so a roof this close is the one over or under the wall.
const OUTLINE_TOL_M = 0.1;
// Containment is sampled this far either side of a roof edge; it is also the width of the
// step drawn where the roof edge is not at the wall foot (an eaves the wall runs past).
const SIDE_M = 0.005;

const isPitchedRoof = (el: Element, wallId: string): el is BuildingElementOpaque =>
  el.type === 'BuildingElementOpaque'
  && el.id !== wallId
  && !el.isPlaceholder
  && (el.coordinates?.length ?? 0) >= 3
  && typeof el.pitch === 'number' && el.pitch > 0 && el.pitch < 90;

function distanceToRing(p: { x: number; y: number }, ring: Array<{ x: number; y: number }>): number {
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

/**
 * Fits one edge of a line wall to the pitched roofs whose plan outline covers the wall line.
 *
 * - `bottom` ("On roof"): the roofs the wall stands on: those above the foot and below `limit`
 *   (the top edge) at one or more points, so a roof wholly over the wall is not mistaken for the
 *   one under it. h(t) = max(0, highest such roof − foot), following the roof even where it rises
 *   through the top (the face is then invalid and says where). Null when no roof is above the
 *   foot anywhere along the wall.
 * - `top` ("Under roof"): the roofs over the wall. A roof qualifies where it is at or above
 *   `limit` (the bottom edge; the foot when omitted). h(t) = lowest qualifying roof − foot.
 *   Null unless a roof qualifies along the whole wall line. A gable wall under a dual-pitch roof
 *   gives the gable triangle, with a breakpoint at the ridge.
 *
 * Breakpoints are the wall ends, every crossing with a roof's plan edge, every bend of `limit`,
 * and every point where the chosen roof changes or meets `limit`/the foot.
 * `floors` must already carry effective storey heights (`withEffectiveStoreyHeights`).
 */
export function deriveWallEdgeFromRoofs(
  wall: Element,
  elements: Element[],
  floors: Floor[],
  globalOrientationOffset: number | undefined,
  edge: 'top' | 'bottom',
  limit?: ProfilePoint[],
): WallRoofEdge | null {
  const c = wall.coordinates;
  if (!c || c.length !== 2) return null;
  const a = c[0]!;
  const b = c[1]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  const sideT = SIDE_M / length;
  const foot = elementBaseElevationMForTb(wall, floors);
  const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });
  const limitAt = (t: number) => (limit ? interpolateProfileHeight(limit, t) : edge === 'top' ? 0 : Infinity);

  const roofs = elements.filter((el) => isPitchedRoof(el, wall.id));
  const above = (roof: BuildingElementOpaque, t: number) => {
    const p = at(t);
    const z = roofTopElevationAtPlanM(roof, p.x, p.y, floors, globalOrientationOffset);
    return z === null ? null : z - foot;
  };
  const covers = (roof: BuildingElementOpaque, t: number) => {
    const p = at(t);
    return isPointInPolygon2D(p, roof.coordinates) || distanceToRing(p, roof.coordinates) < OUTLINE_TOL_M;
  };
  const covering = (t: number) => roofs.filter((roof) => covers(roof, t));

  // Crossings of the wall line with each roof's plan edges, plus the bends of `limit`.
  const ts = new Set([0, 1, ...(limit ?? []).map((p) => p.t)]);
  for (const roof of roofs) {
    const ring = roof.coordinates;
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i]!;
      const q = ring[(i + 1) % ring.length]!;
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den;
      const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
      if (t > sideT && t < 1 - sideT && u >= 0 && u <= 1) ts.add(t);
    }
  }

  // Inside each span the same roofs cover the wall and each roof, the foot and `limit` are
  // straight lines in t, so the chosen roof can only change where two of those lines cross.
  const spans = [...ts].sort((x, y) => x - y);
  for (let i = 0; i < spans.length - 1; i += 1) {
    const t0 = spans[i]!;
    const t1 = spans[i + 1]!;
    const lines: Array<readonly [number, number]> = [[0, 0]];
    if (limit) lines.push([limitAt(t0), limitAt(t1)]);
    for (const roof of covering((t0 + t1) / 2)) {
      const h0 = above(roof, t0);
      const h1 = above(roof, t1);
      if (h0 !== null && h1 !== null) lines.push([h0, h1]);
    }
    for (let j = 0; j < lines.length; j += 1) {
      for (let k = j + 1; k < lines.length; k += 1) {
        const d0 = lines[j]![0] - lines[k]![0];
        const d1 = lines[j]![1] - lines[k]![1];
        if (d0 * d1 < 0) ts.add(t0 + ((t1 - t0) * d0) / (d0 - d1));
      }
    }
  }

  const sorted = [...ts].sort((x, y) => x - y);
  // A roof is under the wall if, somewhere it covers the wall line, it is above the foot and
  // below the top. It then counts along everything it covers, even where it rises through the
  // top: the fitted edge follows the roof and wallFaceProblem names the stretch where the wall
  // passes through it. Roofs entirely above the top are over the wall, never its bottom. Every
  // quantity is linear between breakpoints, so breakpoints and span midpoints are enough.
  const samples = sorted.flatMap((t, i) => (i === 0 ? [t] : [(sorted[i - 1]! + t) / 2, t]));
  const under = new Set(roofs.filter((roof) => samples.some((t) => {
    const h = covers(roof, t) ? above(roof, t) : null;
    return h !== null && h > 1e-9 && h < limitAt(t) - 1e-9;
  })));

  const names = new Set<string>();
  // Height at t; the roofs are chosen by coverage at `side` (just before or after a roof edge)
  // but always evaluated at t. Undefined for the top edge where no roof covers the wall.
  const heightAt = (t: number, side: number): number | undefined => {
    const lim = limitAt(t);
    let best: number | undefined = edge === 'bottom' ? 0 : undefined;
    let bestRoof: string | undefined;
    for (const roof of covering(side)) {
      const h = above(roof, t);
      if (h === null) continue;
      const better = edge === 'bottom'
        ? under.has(roof) && h > best! + 1e-9
        : h >= lim - 1e-6 && (best === undefined || h < best - 1e-9);
      if (better) {
        best = h;
        bestRoof = roof.name;
      }
    }
    if (bestRoof !== undefined) names.add(bestRoof);
    return best;
  };
  const profile: ProfilePoint[] = [];
  for (const t of sorted) {
    const before = heightAt(t, Math.max(0, t - sideT));
    const after = heightAt(t, Math.min(1, t + sideT));
    if (before === undefined || after === undefined) return null;
    profile.push({ t, h: roundToTwoDecimals(Math.max(0, before)) });
    if (Math.abs(after - before) > ROOF_FIT_TOLERANCE_M && t < 1 - sideT) {
      profile.push({ t: t + sideT, h: roundToTwoDecimals(Math.max(0, after)) });
    }
  }
  if (edge === 'bottom' && !profile.some((p) => p.h > 0)) return null;
  return { profile, roofNames: [...names].sort() };
}

/** True when a stored roof snapshot no longer matches a fresh fit (or the roof is gone). */
export function isRoofSnapshotStale(stored: ProfilePoint[], fresh: ProfilePoint[] | null): boolean {
  if (!fresh) return true;
  return wallFaceBreakpoints(stored, fresh).some(
    (t) => Math.abs(interpolateProfileHeight(stored, t) - interpolateProfileHeight(fresh, t))
      > ROOF_FIT_TOLERANCE_M + 1e-6,
  );
}
