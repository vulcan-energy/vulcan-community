// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type PlanPoint2 = { x: number; y: number };

/**
 * Even-odd ray cast for a simple polygon ring, in plan (x, y). Rings may be open or closed and
 * either winding; `z` is ignored where callers pass 3D coordinates.
 *
 * The `(yi > y) !== (yj > y)` test only passes when `yi !== yj`, so the divisor is never zero, and
 * the zero-guards two of the previous copies carried (`|| Number.EPSILON`, `+ 1e-18`) were dead.
 * The other two were magnitude guards, not zero guards: `buildingFootprintDimensions` skipped edges
 * with `|yj - yi| < 1e-6` — the same tolerance it uses to call an edge horizontal — and
 * `pvHostDerivation` used `1e-12`. Those edges now toggle parity instead of being skipped, which is
 * a real if negligible change: it needs the sample `y` to land inside a band that thin.
 */
export function isPointInPolygon2D(
  point: PlanPoint2,
  ring: ReadonlyArray<PlanPoint2>,
): boolean {
  if (ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x;
    const yi = ring[i]!.y;
    const xj = ring[j]!.x;
    const yj = ring[j]!.y;
    const crossesRay =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (crossesRay) inside = !inside;
  }
  return inside;
}
