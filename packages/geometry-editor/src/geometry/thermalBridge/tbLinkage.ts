// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared resolution and distance helpers for linear thermal bridges (proposers, dedupe, issues).
 */
import type { BuildingElementOpaque, Element, ThermalBridgeLinear } from '../types';
import { isSlopedPitchedRoofElementForEavesGable } from './proposeSlopedRoofEavesGable';
import {
  TB_ENDPOINT_EDGE_MARGIN_M,
  TB_MIN_PLAN_LENGTH_FOR_ALIGNMENT_M,
  TB_PLAN_EDGE_PARALLEL_MIN_ABS_DOT,
} from './thermalBridgeTolerances';

/** Midpoint of a 3D segment (TB proposal coordinates, dedupe, etc.). */
export function midpoint3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

export function dist3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function tbSegmentMidpoint(tb: ThermalBridgeLinear): { x: number; y: number; z: number } | null {
  const c = tb.coordinates;
  if (!c || c.length < 2) return null;
  return midpoint3(c[0], c[1]);
}

/** Match of a linear TB (plan projection) to one edge of the host — same edge notion as polygon TB proposals. */
export type PlanEdgeMatch = {
  /** Index of edge start vertex in plan ring (`plan[i]` → `plan[(i+1)%n]`). */
  edgeIndex: number;
  /** Plan length of that edge (m). */
  spanM: number;
  /** Shortest distance in plan from TB segment midpoint to that edge segment (m). */
  midpointDistToEdgeM: number;
};

/**
 * Plan XY vertices from a TB host element (walls, openings, roof polygons, basement ground outlines,
 * adjacent segments). Matches proposals that place TBs on polygon edges or 2-point lines.
 */
export function planCoordinatesForHostElement(el: Element): Array<{ x: number; y: number }> | null {
  const t = el.type;
  if (
    t !== 'BuildingElementOpaque' &&
    t !== 'BuildingElementTransparent' &&
    t !== 'BuildingElementGround' &&
    t !== 'BuildingElementAdjacentConditionedSpace' &&
    t !== 'BuildingElementAdjacentUnconditionedSpace_Simple'
  ) {
    return null;
  }
  const c = (el as { coordinates?: Array<{ x: number; y: number; z: number }> }).coordinates;
  if (!c || c.length < 2) return null;
  return c.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * For each **closed** polygon edge when `plan.length >= 3`, or the single segment when `plan.length === 2`,
 * finds the edge whose perpendicular distance from `(midX, midY)` is minimal (plan).
 */
export function bestPlanEdgeMatchForMidpointPlan(
  midX: number,
  midY: number,
  plan: Array<{ x: number; y: number }>,
): PlanEdgeMatch | null {
  const n = plan.length;
  if (n === 2) {
    const a = plan[0]!;
    const b = plan[1]!;
    const { dist, segLen } = distPointToSegmentXY(midX, midY, a.x, a.y, b.x, b.y);
    if (segLen < 1e-9) return null;
    return { edgeIndex: 0, spanM: segLen, midpointDistToEdgeM: dist };
  }
  let best: PlanEdgeMatch | null = null;
  for (let i = 0; i < n; i++) {
    const a = plan[i]!;
    const b = plan[(i + 1) % n]!;
    const { dist, segLen } = distPointToSegmentXY(midX, midY, a.x, a.y, b.x, b.y);
    if (segLen < 1e-9) continue;
    if (!best || dist < best.midpointDistToEdgeM) {
      best = { edgeIndex: i, spanM: segLen, midpointDistToEdgeM: dist };
    }
  }
  return best;
}

/**
 * Resolves host to plan coordinates, then picks the **closest edge** to the TB midline (plan), matching how
 * multi-vertex roof TBs are proposed one edge at a time (eaves, gable, ridge).
 */
export function bestPlanEdgeMatchForLinearTb(tb: ThermalBridgeLinear, host: Element): PlanEdgeMatch | null {
  const plan = planCoordinatesForHostElement(host);
  if (!plan || plan.length < 2) return null;
  const mid = tbSegmentMidpoint(tb);
  if (!mid) return null;
  return bestPlanEdgeMatchForMidpointPlan(mid.x, mid.y, plan);
}

/** Plan length of the TB segment in XY (m). */
export function tbPlanSegmentLengthM(tb: ThermalBridgeLinear): number {
  const c = tb.coordinates;
  if (!c || c.length < 2) return 0;
  return Math.hypot(c[1]!.x - c[0]!.x, c[1]!.y - c[0]!.y);
}

/**
 * For a non-degenerate TB in plan, checks direction is parallel to the matched host edge and
 * endpoints project onto that edge (with margin). Vertical-in-plan TBs (length &lt; threshold) skip.
 * Returns null if OK, else a short message for {@link findLinearThermalBridgeIssues}.
 */
export function tbPlanAlignmentMessageForMatchedEdge(
  tb: ThermalBridgeLinear,
  plan: Array<{ x: number; y: number }>,
  match: PlanEdgeMatch,
): string | null {
  if (tbPlanSegmentLengthM(tb) < TB_MIN_PLAN_LENGTH_FOR_ALIGNMENT_M) return null;
  const n = plan.length;
  const i = match.edgeIndex;
  const a = plan[i]!;
  const b = plan[(i + 1) % n]!;
  const ax = a.x;
  const ay = a.y;
  const bx = b.x;
  const by = b.y;
  const edx = bx - ax;
  const edy = by - ay;
  const elen = Math.hypot(edx, edy);
  if (elen < 1e-9) return null;
  const ux = edx / elen;
  const uy = edy / elen;

  const c = tb.coordinates;
  if (!c || c.length < 2) return null;
  const tdx = c[1]!.x - c[0]!.x;
  const tdy = c[1]!.y - c[0]!.y;
  const tlen = Math.hypot(tdx, tdy);
  if (tlen < 1e-9) return null;
  const vtx = tdx / tlen;
  const vty = tdy / tlen;
  const dot = Math.abs(vtx * ux + vty * uy);
  if (dot < TB_PLAN_EDGE_PARALLEL_MIN_ABS_DOT) {
    return 'TB plan direction is not parallel to the matched host edge — check placement.';
  }

  const marginT = TB_ENDPOINT_EDGE_MARGIN_M / elen;
  const abx = bx - ax;
  const aby = by - ay;
  const segLen2 = abx * abx + aby * aby;
  if (segLen2 < 1e-18) return null;
  for (const p of [c[0]!, c[1]!]) {
    const apx = p.x - ax;
    const apy = p.y - ay;
    const tRaw = (apx * abx + apy * aby) / segLen2;
    if (tRaw < -marginT || tRaw > 1 + marginT) {
      return 'TB endpoints project outside the matched host edge segment — check length or parent edge.';
    }
  }
  return null;
}

/**
 * Perpendicular distance in plan (m) from point P to segment A–B.
 */
export function distPointToSegmentXY(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { dist: number; t: number; segLen: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const segLen = Math.hypot(abx, aby);
  if (segLen < 1e-9) {
    return { dist: Math.hypot(apx, apy), t: 0, segLen: 0 };
  }
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (segLen * segLen)));
  const qx = ax + t * abx;
  const qy = ay + t * aby;
  return { dist: Math.hypot(px - qx, py - qy), t, segLen };
}

/**
 * `parent_element` on `ThermalBridgeLinear` may be host **id** (CSV) or **name** (UI); resolve within the TB's zone.
 */
export function resolveHostElementForLinearTb(
  parent: string | null | undefined,
  zoneId: string | undefined,
  elementsById: Record<string, Element>,
): Element | null {
  const p = typeof parent === 'string' ? parent.trim() : '';
  if (!p) return null;

  const byId = elementsById[p];
  if (byId) return byId;

  for (const e of Object.values(elementsById)) {
    if (!e || (e as { name?: string }).name === undefined) continue;
    const n = String((e as { name: string }).name).trim();
    if (n !== p) continue;
    if (zoneId !== undefined && zoneId !== '' && (e as { zoneId?: string }).zoneId !== zoneId) continue;
    return e;
  }
  return null;
}

/**
 * Read `extra_json.thermal_bridge_source` host ids. Field names are legacy (`host_wall_*`), but values can
 * identify any host fabric element: roof, wall, floor, party wall, adjacent segment, etc.
 */
export function readThermalBridgeSourceHostIds(extra: Record<string, unknown> | undefined): {
  primary: string | undefined;
  secondary: string | undefined;
} {
  if (!extra) return { primary: undefined, secondary: undefined };
  const raw = extra.thermal_bridge_source;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { primary: undefined, secondary: undefined };
  const o = raw as Record<string, unknown>;
  const a = o.host_wall_id;
  const b = o.host_wall_b_id;
  return {
    primary: typeof a === 'string' && a.trim() ? a.trim() : undefined,
    secondary: typeof b === 'string' && b.trim() ? b.trim() : undefined,
  };
}

/** Legacy alias for E16/E17 code paths that specifically require two wall hosts. */
export function readThermalBridgeSourceWallIds(extra: Record<string, unknown> | undefined): {
  a: string | undefined;
  b: string | undefined;
} {
  const { primary, secondary } = readThermalBridgeSourceHostIds(extra);
  return { a: primary, b: secondary };
}

export function thermalBridgeSourceHostIdSet(extra: Record<string, unknown> | undefined): Set<string> {
  const { primary, secondary } = readThermalBridgeSourceHostIds(extra);
  const ids = new Set<string>();
  if (primary) ids.add(primary);
  if (secondary) ids.add(secondary);
  return ids;
}

/**
 * Auto roof junctions such as **R8/R9** (roof × adjacent wall) and **R10** (roof × dormer roof) store the
 * sloped **roof opaque** id in the primary host slot and the paired fabric in the secondary slot. The ψ-line can lie
 * **inside** the roof plan polygon, so boundary-edge distance / span checks against only the roof outline
 * are misleading.
 */
export function shouldSkipOutlineChecksForTwoHostRoofJunction(
  junctionType: string | undefined,
  extra: Record<string, unknown> | undefined,
  elementsById: Record<string, Element>,
): boolean {
  const jt = junctionType?.trim();
  if (jt !== 'R8' && jt !== 'R9' && jt !== 'R10') return false;
  const { primary, secondary } = readThermalBridgeSourceHostIds(extra);
  if (!primary || !secondary) return false;
  if (!elementsById[secondary]) return false;
  const first = elementsById[primary];
  if (!first || first.type !== 'BuildingElementOpaque') return false;
  return isSlopedPitchedRoofElementForEavesGable(first as BuildingElementOpaque);
}
