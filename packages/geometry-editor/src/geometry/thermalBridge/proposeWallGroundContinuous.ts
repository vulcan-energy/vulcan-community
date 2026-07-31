// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Continuous **E5** along ground-contact **external** opaque wall segments in plan (Phase 5, first slice).
 *
 * Spans already represented by **`wall_ground_foot`** under ground-floor openings are subtracted along the
 * same wall line so assessors do not double-count wall–floor ψ on door/window runs.
 *
 * Intermediate-slab continuous **E6** lives in `proposeWallIntermediateContinuous.ts`.
 */

import {
  elementBaseElevationMForTb,
  elementFloorZIndexForTb,
  slabElevationMForFloorZ,
} from '../../lib/geometry3dMapper';
import type { Floor } from '../../stores/geometryStore';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { isBasementGroundElement } from '../../lib/basementGeometry';
import { roundToTwoDecimals } from '../constants';
import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementGround,
  BuildingElementOpaque,
  BuildingElementPartyWall,
  Element,
} from '../types';
import {
  findNonBasementGroundSurfaceForLineElement,
  findLinkedGroundSlabForLineElement,
  groundSlabPolygonEdgesXY,
  GROUND_SLAB_PERIM_LINK_TOL_M,
} from '../../lib/suspendedFloorGeometry';
import { isExternalLineWall } from './proposeExternalCorners';
import {
  type FacadeOpeningTbProposal,
  psiTable37ForCode,
  SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M,
} from './proposeFacadeOpenings';

const MIN_SEGMENT_M = 0.05;
/** Opening foot must lie within this perpendicular distance (m) of the wall’s infinite line to subtract. */
export const FOOT_ON_WALL_PERP_TOL_M = 0.12;

export { GROUND_SLAB_PERIM_LINK_TOL_M, groundSlabPolygonEdgesXY } from '../../lib/suspendedFloorGeometry';

const MIN_WALL_LEN_XY_FOR_SLAB_EDGE_M = 0.05;

function dist2XYPoints(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Plan boundary edges for a horizontal (`pitch` 0°) conditioned floor polygon — same footprint idea as
 * {@link groundSlabPolygonEdgesXY} but for `BuildingElementAdjacentConditionedSpace` intermediate slabs.
 */
export function adjacentConditionedHorizontalFloorPolygonEdgesXY(
  el: BuildingElementAdjacentConditionedSpace,
): Array<[[number, number], [number, number]]> {
  if (el.isPlaceholder) return [];
  const c = el.coordinates;
  if (!c || c.length < 2) return [];
  const pitch = el.pitch;
  if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch !== 0) return [];
  const z0 = typeof c[0]?.z === 'number' && Number.isFinite(c[0].z) ? c[0].z : 0;
  for (let i = 1; i < c.length; i++) {
    const zi = typeof c[i]?.z === 'number' && Number.isFinite(c[i].z) ? c[i].z : 0;
    if (Math.abs(zi - z0) > 1e-2) return [];
  }
  const out: Array<[[number, number], [number, number]]> = [];
  if (c.length === 2) {
    if (dist2XYPoints(c[0]!, c[1]!) < MIN_WALL_LEN_XY_FOR_SLAB_EDGE_M) return [];
    return [
      [
        [c[0]!.x, c[0]!.y],
        [c[1]!.x, c[1]!.y],
      ],
    ];
  }
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i]!;
    const b = c[i + 1]!;
    out.push([
      [a.x, a.y],
      [b.x, b.y],
    ]);
  }
  const p0 = c[0]!;
  const pL = c[c.length - 1]!;
  if (c.length >= 3 && Math.hypot(p0.x - pL.x, p0.y - pL.y) > 1e-4) {
    out.push([[pL.x, pL.y], [p0.x, p0.y]]);
  }
  return out.filter(([[ax, ay], [bx, by]]) => Math.hypot(bx - ax, by - ay) >= MIN_WALL_LEN_XY_FOR_SLAB_EDGE_M);
}

export function wallHasPositiveFabricExtent(w: BuildingElementOpaque): boolean {
  const h = w.height;
  const ar = w.area;
  return (
    (typeof h === 'number' && Number.isFinite(h) && h > 0) ||
    (typeof ar === 'number' && Number.isFinite(ar) && ar > 0)
  );
}

function pointToSegmentDistanceM(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const denom = abx * abx + aby * aby;
  const t = denom > 1e-18 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / denom)) : 0;
  const qx = ax + t * abx;
  const qy = ay + t * aby;
  return Math.hypot(px - qx, py - qy);
}

function minDistancePointToEdgesM(px: number, py: number, edges: Array<[[number, number], [number, number]]>): number {
  let minD = Infinity;
  for (const [[ax, ay], [bx, by]] of edges) {
    minD = Math.min(minD, pointToSegmentDistanceM(px, py, ax, ay, bx, by));
  }
  return minD;
}

/**
 * True when the wall is tied to a `BuildingElementGround` in the same zone by `parent_element` name,
 * or both wall endpoints lie within {@link GROUND_SLAB_PERIM_LINK_TOL_M} of that slab’s plan boundary.
 */
export function wallLinkedToGroundSlabForContinuousE5(w: BuildingElementOpaque, elements: Element[]): boolean {
  const zoneId = w.zoneId;
  const grounds = elements.filter(
    (e): e is BuildingElementGround =>
      e.type === 'BuildingElementGround' && e.zoneId === zoneId && !isBasementGroundElement(e),
  );
  return findLinkedGroundSlabForLineElement(w, grounds) !== null;
}

/**
 * True when an intermediate-storey wall is tied to a **same-storey** slab footprint by
 * `parent_element` name, or both wall endpoints lie within {@link GROUND_SLAB_PERIM_LINK_TOL_M} of that
 * slab’s plan boundary. Host slabs may be `BuildingElementGround` **or** a horizontal polygon
 * `BuildingElementAdjacentConditionedSpace` (typical “internal floor”).
 */
export function wallLinkedToIntermediateFloorSlabForContinuousE6(
  w: BuildingElementOpaque,
  elements: Element[],
  floors: Floor[],
): boolean {
  const floorZ = elementFloorZIndexForTb(w, floors);
  if (floorZ < 1) return false;

  const grounds = elements.filter(
    (e): e is BuildingElementGround =>
      e.type === 'BuildingElementGround' &&
      e.zoneId === w.zoneId &&
      elementFloorZIndexForTb(e, floors) === floorZ,
  );

  const conditionedFloors = elements.filter(
    (e): e is BuildingElementAdjacentConditionedSpace =>
      e.type === 'BuildingElementAdjacentConditionedSpace' &&
      !e.isPlaceholder &&
      e.zoneId === w.zoneId &&
      elementFloorZIndexForTb(e, floors) === floorZ,
  );

  if (grounds.length === 0 && conditionedFloors.length === 0) return false;

  const pe = typeof w.parent_element === 'string' ? w.parent_element.trim() : '';
  if (pe) {
    if (grounds.some((g) => (g.name ?? '').trim() === pe)) return true;
    if (conditionedFloors.some((f) => (f.name ?? '').trim() === pe)) return true;
  }

  const c = w.coordinates;
  if (!c || c.length !== 2) return false;
  const Wa = { x: c[0].x, y: c[0].y };
  const Wb = { x: c[1].x, y: c[1].y };

  for (const g of grounds) {
    const edges = groundSlabPolygonEdgesXY(g);
    if (edges.length === 0) continue;
    const dA = minDistancePointToEdgesM(Wa.x, Wa.y, edges);
    const dB = minDistancePointToEdgesM(Wb.x, Wb.y, edges);
    if (dA <= GROUND_SLAB_PERIM_LINK_TOL_M && dB <= GROUND_SLAB_PERIM_LINK_TOL_M) return true;
  }

  for (const f of conditionedFloors) {
    const edges = adjacentConditionedHorizontalFloorPolygonEdgesXY(f);
    if (edges.length === 0) continue;
    const dA = minDistancePointToEdgesM(Wa.x, Wa.y, edges);
    const dB = minDistancePointToEdgesM(Wb.x, Wb.y, edges);
    if (dA <= GROUND_SLAB_PERIM_LINK_TOL_M && dB <= GROUND_SLAB_PERIM_LINK_TOL_M) return true;
  }

  return false;
}

function opaqueWallBaseElevationM(w: BuildingElementOpaque): number {
  const coords = w.coordinates;
  const z0 = typeof coords[0]?.z === 'number' && Number.isFinite(coords[0].z) ? coords[0].z : 0;
  const z1 = typeof coords[1]?.z === 'number' && Number.isFinite(coords[1].z) ? coords[1].z : 0;
  const bh = w.base_height;
  if (typeof bh === 'number' && Number.isFinite(bh) && bh >= 0) return bh;
  return Math.min(z0, z1);
}

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Scalar projection of `p` onto the ray Wa→Wb, and perpendicular distance to the infinite line. */
function projectOnWallLine(
  Wa: { x: number; y: number },
  Wb: { x: number; y: number },
  p: { x: number; y: number },
): { t: number; perp: number; wallLen: number } {
  const vx = Wb.x - Wa.x;
  const vy = Wb.y - Wa.y;
  const wallLen = Math.hypot(vx, vy);
  if (wallLen < 1e-9) {
    return { t: 0, perp: Math.hypot(p.x - Wa.x, p.y - Wa.y), wallLen: 0 };
  }
  const ux = vx / wallLen;
  const uy = vy / wallLen;
  const t = (p.x - Wa.x) * ux + (p.y - Wa.y) * uy;
  const perp = Math.abs(-uy * (p.x - Wa.x) + ux * (p.y - Wa.y));
  return { t, perp, wallLen };
}

function zonesCompatible(a: string | undefined, b: string | undefined): boolean {
  if (a !== undefined && b !== undefined && a !== b) return false;
  return true;
}

/** Target elevation for the ground E5 junction: floor slab, or linked local ground surface when authored. */
export function groundContactElevationTargetMForContinuousTb(
  w: BuildingElementOpaque,
  elements?: Element[],
  floors?: Floor[],
): number | null {
  if (!isExternalLineWall(w)) return null;
  const linkedGroundSurface = elements ? findNonBasementGroundSurfaceForLineElement(w, elements) : null;
  if (floors && floors.length > 0) {
    const floorZ = elementFloorZIndexForTb(w, floors);
    if (floorZ !== 0) return null;
    return linkedGroundSurface?.surfaceM ?? slabElevationMForFloorZ(0, floors);
  }
  const coords = w.coordinates;
  const z0 = typeof coords[0]?.z === 'number' && Number.isFinite(coords[0].z) ? coords[0].z : 0;
  const z1 = typeof coords[1]?.z === 'number' && Number.isFinite(coords[1].z) ? coords[1].z : 0;
  const zMin = Math.min(z0, z1);
  if (zMin >= 1 - 1e-9) return null;
  return linkedGroundSurface?.surfaceM ?? 0;
}

export function isGroundContactExternalWallForContinuousTb(
  w: BuildingElementOpaque,
  floors?: Floor[],
  elements?: Element[],
): boolean {
  const targetM = groundContactElevationTargetMForContinuousTb(w, elements, floors);
  if (targetM === null) return false;
  const baseEl = floors && floors.length > 0
    ? elementBaseElevationMForTb(w, floors)
    : opaqueWallBaseElevationM(w);
  return Math.abs(baseEl - targetM) <= SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M;
}

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let [cs, ce] = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i]!;
    if (s <= ce + 1e-9) ce = Math.max(ce, e);
    else {
      out.push([cs, ce]);
      cs = s;
      ce = e;
    }
  }
  out.push([cs, ce]);
  return out;
}

/** Remaining [start,end] sub-segments along [0, wallLen] after removing merged `covered`. */
export function gapIntervalsAlongWall(wallLen: number, covered: [number, number][]): [number, number][] {
  if (wallLen <= MIN_SEGMENT_M) return [];
  const merged = mergeIntervals(covered.filter(([a, b]) => b > a + 1e-9));
  const gaps: [number, number][] = [];
  let cur = 0;
  for (const [s, e] of merged) {
    const ss = Math.max(0, s);
    const ee = Math.min(wallLen, e);
    if (ss > cur + MIN_SEGMENT_M) gaps.push([cur, ss]);
    cur = Math.max(cur, ee);
  }
  if (wallLen > cur + MIN_SEGMENT_M) gaps.push([cur, wallLen]);
  return gaps;
}

/**
 * Project an opening foot segment onto a wall; used to subtract spans for both ground (E5) and
 * intermediate-slab (E6) continuous runs.
 */
export function footIntervalOnWallForRole(
  wall: BuildingElementOpaque,
  foot: FacadeOpeningTbProposal,
  footRole: 'wall_ground_foot' | 'wall_intermediate_floor_foot',
): [number, number] | null {
  if (foot.edgeRole !== footRole) return null;
  if (!zonesCompatible(wall.zoneId, foot.zoneId)) return null;

  const c = wall.coordinates;
  const Wa = { x: c[0].x, y: c[0].y };
  const Wb = { x: c[1].x, y: c[1].y };
  const wallLen = dist2XY(Wa, Wb);
  if (wallLen < MIN_SEGMENT_M) return null;

  const p0 = foot.coordinates[0];
  const p1 = foot.coordinates[1];
  const Fa = { x: p0.x, y: p0.y };
  const Fb = { x: p1.x, y: p1.y };

  const pa = projectOnWallLine(Wa, Wb, Fa);
  const pb = projectOnWallLine(Wa, Wb, Fb);
  if (pa.perp > FOOT_ON_WALL_PERP_TOL_M || pb.perp > FOOT_ON_WALL_PERP_TOL_M) {
    const wname = wall.name?.trim() ?? '';
    const parent = foot.parentElementForTb?.trim() ?? '';
    if (!wname || !parent || parent !== wname) return null;
    /** Name-only fallback: still require finite projection onto segment. */
    if (pa.perp > 0.5 || pb.perp > 0.5) return null;
  }

  let t0 = Math.min(pa.t, pb.t);
  let t1 = Math.max(pa.t, pb.t);
  t0 = Math.max(0, t0);
  t1 = Math.min(wallLen, t1);
  if (t1 <= t0 + 1e-9) return null;
  return [t0, t1];
}

/**
 * E5 along external ground-level wall runs, minus spans already taken by `wall_ground_foot` proposals.
 *
 * @param openingProposals — typically `proposeFacadeOpeningThermalBridges(elements, floors)` so foot geometry matches.
 */
export function proposeWallGroundContinuous(
  elements: Element[],
  openingProposals: FacadeOpeningTbProposal[],
  floors?: Floor[],
): FacadeOpeningTbProposal[] {
  // Bake wall-derived storey heights + user overrides into `floors` once; internal helpers and
  // re-exported geometry3dMapper functions then see effective slab elevations for free.
  floors = withEffectiveStoreyHeights(floors, elements);
  const feet = openingProposals.filter((p) => p.edgeRole === 'wall_ground_foot');
  const out: FacadeOpeningTbProposal[] = [];

  for (const el of elements) {
    if (el.type !== 'BuildingElementOpaque') continue;
    const w = el as BuildingElementOpaque;
    if (!isGroundContactExternalWallForContinuousTb(w, floors, elements)) continue;
    if (!wallHasPositiveFabricExtent(w)) continue;
    if (!wallLinkedToGroundSlabForContinuousE5(w, elements)) continue;

    const c = w.coordinates;
    const Wa = { x: c[0].x, y: c[0].y };
    const Wb = { x: c[1].x, y: c[1].y };
    const wallLen = dist2XY(Wa, Wb);
    if (wallLen < MIN_SEGMENT_M) continue;

    const covered: [number, number][] = [];
    for (const foot of feet) {
      const iv = footIntervalOnWallForRole(w, foot, 'wall_ground_foot');
      if (iv) covered.push(iv);
    }

    const gaps = gapIntervalsAlongWall(wallLen, covered);
    const targetZ = groundContactElevationTargetMForContinuousTb(w, elements, floors);
    const z = roundToTwoDecimals(
      targetZ ?? (floors && floors.length > 0 ? elementBaseElevationMForTb(w, floors) : opaqueWallBaseElevationM(w)),
    );
    const ux = (Wb.x - Wa.x) / wallLen;
    const uy = (Wb.y - Wa.y) / wallLen;

    gaps.forEach(([t0, t1], segIdx) => {
      const len = t1 - t0;
      if (len < MIN_SEGMENT_M) return;
      const ax = Wa.x + ux * t0;
      const ay = Wa.y + uy * t0;
      const bx = Wa.x + ux * t1;
      const by = Wa.y + uy * t1;
      const code = 'E5';
      out.push({
        proposalId: `wgcont:${w.id}:${segIdx}`,
        openingId: `wgcont:${w.id}:${segIdx}`,
        openingName: `Wall–floor (continuous): ${w.name || w.id}`,
        zoneId: w.zoneId,
        edgeRole: 'wall_ground_continuous',
        junctionCode: code,
        suggestedLengthM: roundToTwoDecimals(len),
        linearThermalTransmittance: psiTable37ForCode(code),
        reason: `Ground wall–floor junction along "${w.name || w.id}" (E5), excluding opening foot spans on the same wall line; wall must have positive height or area and lie on / link to a ground slab`,
        coordinates: [
          { x: roundToTwoDecimals(ax), y: roundToTwoDecimals(ay), z },
          { x: roundToTwoDecimals(bx), y: roundToTwoDecimals(by), z },
        ],
        parentElementForTb: w.name || undefined,
      });
    });
  }

  return out;
}

/**
 * True when a **party wall** sits on the **ground** storey slab elevation (same band as continuous **E5**).
 */
export function isGroundContactPartyWallForP1Tb(pw: BuildingElementPartyWall, floors: Floor[]): boolean {
  const floorZ = elementFloorZIndexForTb(pw, floors);
  if (floorZ !== 0) return false;
  const baseEl = elementBaseElevationMForTb(pw, floors);
  const slabElev = slabElevationMForFloorZ(0, floors);
  return Math.abs(baseEl - slabElev) <= SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M;
}

/**
 * Same slab linkage rule as {@link wallLinkedToGroundSlabForContinuousE5} for **party** walls (`parent_element`
 * names the slab or both endpoints lie near the ground polygon boundary).
 */
export function partyWallLinkedToGroundSlabForP1(pw: BuildingElementPartyWall, elements: Element[]): boolean {
  const zoneId = pw.zoneId;
  const grounds = elements.filter(
    (e): e is BuildingElementGround =>
      e.type === 'BuildingElementGround' && e.zoneId === zoneId && !isBasementGroundElement(e),
  );
  if (grounds.length === 0) return false;

  const pe = typeof pw.parent_element === 'string' ? pw.parent_element.trim() : '';
  if (pe && grounds.some((g) => (g.name ?? '').trim() === pe)) return true;

  const c = pw.coordinates;
  if (!c || c.length !== 2) return false;
  const Wa = { x: c[0].x, y: c[0].y };
  const Wb = { x: c[1].x, y: c[1].y };

  for (const g of grounds) {
    const edges = groundSlabPolygonEdgesXY(g);
    if (edges.length === 0) continue;
    const dA = minDistancePointToEdgesM(Wa.x, Wa.y, edges);
    const dB = minDistancePointToEdgesM(Wb.x, Wb.y, edges);
    if (dA <= GROUND_SLAB_PERIM_LINK_TOL_M && dB <= GROUND_SLAB_PERIM_LINK_TOL_M) return true;
  }
  return false;
}
