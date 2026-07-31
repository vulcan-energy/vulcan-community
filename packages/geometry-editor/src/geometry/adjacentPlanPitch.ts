// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/** Max vertical spread (m) to treat a polygon as lying in a horizontal plane (plan / slab). */
export const HORIZONTAL_ADJACENT_POLYGON_Z_SPAN_M = 0.03;

/**
 * Non-exposed adjacent/party elements often get wall-default pitch 90 from authoring; a
 * horizontal (plan) polygon must use 0° / 180° in FHS. If pitch is 90 and vertices are
 * coplanar in Z within {@link HORIZONTAL_ADJACENT_POLYGON_Z_SPAN_M}, use 0°.
 *
 * Used on CSV parse, CSV export, and in the element editor for self-heal.
 */
export function normalizeHorizontalAdjacentPlanPitch(
  pitch: number | undefined,
  coordinates: ReadonlyArray<{ x: number; y: number; z: number }> | undefined,
): number | undefined {
  if (pitch !== 90) return pitch;
  if (!coordinates || coordinates.length < 3) return pitch;
  const zs = coordinates.map((c) => c.z);
  if (Math.max(...zs) - Math.min(...zs) > HORIZONTAL_ADJACENT_POLYGON_Z_SPAN_M) return pitch;
  return 0;
}
