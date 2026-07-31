// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared **plan** geometry for party-wall × roof-edge thermal bridge proposals (P4/P5 sloped, P4 flat).
 * Keeps overlap endpoints, segment length, and {@link planOverlapAdjacentOnWall} metadata in one place
 * for both proposers and avoids drifting copies of `pointOnWallAtT` / distance checks.
 */
import type { BuildingElementPartyWall } from '../types';
import { planOverlapAdjacentOnWall } from './proposeAdjacentWallJunction';

/** Minimum overlap length (m) along the roof plan edge — aligned with adjacent-junction tolerances. */
export const PARTY_WALL_ROOF_OVERLAP_MIN_LEN_M = 0.05;

export function dist2XYPlan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Point at normalized distance `t` along segment Wa→Wb (`wallLen` = |Wb−Wa|). */
export function pointOnWallAtT(
  Wa: { x: number; y: number },
  Wb: { x: number; y: number },
  t: number,
  wallLen: number,
): { x: number; y: number } {
  const vx = Wb.x - Wa.x;
  const vy = Wb.y - Wa.y;
  if (wallLen < 1e-9) return { x: Wa.x, y: Wa.y };
  const ux = vx / wallLen;
  const uy = vy / wallLen;
  return { x: Wa.x + ux * t, y: Wa.y + uy * t };
}

export type RoofEdgeOverlapWithPartyWall = {
  a: { x: number; y: number };
  b: { x: number; y: number };
  lenM: number;
  ovl: { tMid: number; wallLen: number; overlapLen: number; tLo: number; tHi: number };
};

/**
 * Where a vertical party wall segment overlaps a roof **plan** edge Ra→Rb: endpoints of the overlap
 * segment and {@link planOverlapAdjacentOnWall} details for proposal ids / reasons.
 */
export function overlapEndpointsOnRoofPlanEdgeForPartyWall(
  Ra: { x: number; y: number },
  Rb: { x: number; y: number },
  party: BuildingElementPartyWall,
): RoofEdgeOverlapWithPartyWall | null {
  if (dist2XYPlan(Ra, Rb) < 1e-4) return null;
  const P0 = party.coordinates[0]!;
  const P1 = party.coordinates[1]!;
  const ovl = planOverlapAdjacentOnWall(Ra, Rb, P0, P1);
  if (!ovl) return null;
  const a = pointOnWallAtT(Ra, Rb, ovl.tLo, ovl.wallLen);
  const b = pointOnWallAtT(Ra, Rb, ovl.tHi, ovl.wallLen);
  const lenM = dist2XYPlan(a, b);
  if (lenM < PARTY_WALL_ROOF_OVERLAP_MIN_LEN_M) return null;
  return { a, b, lenM, ovl };
}
