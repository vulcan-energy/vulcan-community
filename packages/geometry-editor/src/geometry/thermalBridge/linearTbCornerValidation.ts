// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * E16/E17 plan validation: proposals place a vertical TB at the meeting point of two external walls.
 */
import type { BuildingElementOpaque, Element, ThermalBridgeLinear } from '../types';
import { E16_E17_CORNER_PLAN_TOL_M } from './thermalBridgeTolerances';

function twoPointPlanSegment(el: Element): [{ x: number; y: number }, { x: number; y: number }] | null {
  if (el.type !== 'BuildingElementOpaque') return null;
  const c = (el as BuildingElementOpaque).coordinates;
  if (!c || c.length !== 2) return null;
  return [{ x: c[0]!.x, y: c[0]!.y }, { x: c[1]!.x, y: c[1]!.y }];
}

/** Infinite-line intersection in XY; null if parallel or degenerate. */
export function intersectLinesXY(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): { x: number; y: number } | null {
  const r_dx = bx - ax;
  const r_dy = by - ay;
  const s_dx = dx - cx;
  const s_dy = dy - cy;
  const denom = r_dx * s_dy - r_dy * s_dx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((cx - ax) * s_dy - (cy - ay) * s_dx) / denom;
  return { x: ax + t * r_dx, y: ay + t * r_dy };
}

/** Plan (x,y) for TB: vertical corners use duplicate XY on both endpoints — use that point; else midpoint. */
export function tbPlanAnchorXY(tb: ThermalBridgeLinear): { x: number; y: number } | null {
  const c = tb.coordinates;
  if (!c || c.length < 2) return null;
  const p0 = c[0]!;
  const p1 = c[1]!;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  if (dx * dx + dy * dy < 1e-12) {
    return { x: p0.x, y: p0.y };
  }
  return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
}

/**
 * When both host walls are 2-point lines, checks TB plan anchor vs wall–wall intersection.
 * Returns a human-readable message if invalid; null if skipped (non-2-point walls) or OK.
 */
export function e16e17CornerPlanMessage(
  tb: ThermalBridgeLinear,
  wallA: Element,
  wallB: Element,
  tolM: number = E16_E17_CORNER_PLAN_TOL_M,
): string | null {
  const sa = twoPointPlanSegment(wallA);
  const sb = twoPointPlanSegment(wallB);
  if (!sa || !sb) return null;

  const ip = intersectLinesXY(sa[0].x, sa[0].y, sa[1].x, sa[1].y, sb[0].x, sb[0].y, sb[1].x, sb[1].y);
  if (!ip) return null;

  const anchor = tbPlanAnchorXY(tb);
  if (!anchor) return null;

  const d = Math.hypot(anchor.x - ip.x, anchor.y - ip.y);
  if (d <= tolM) return null;

  return `E16/E17 TB plan position is ${d.toFixed(2)} m from the intersection of the two host walls — check corner or thermal_bridge_source ids.`;
}
