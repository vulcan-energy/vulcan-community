// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';

/**
 * Identifies opaque envelope pieces treated as **roof** in the app — same signals as
 * `isRoofLikePlanarOpaque` in `geometry3dMapper.ts` (3D slab height, exclusion from wall-only passes).
 *
 * **Signals**
 * - `is_unheated_pitched_roof` (HEM / import flag for pitched roof)
 * - `name` equals `"roof"` or contains `"roof"` (case-insensitive), e.g. CSV roof polygons
 * - **`pitch === 0`** on the opaque (horizontal deck / flat roof plane; “facing up” in plan–Z conventions)
 *
 * **Auto TB:** flat deck edges: `proposeFlatRoofEdge` / `isFlatRoofDeckLineForTb` (E14 or E15 per user).
 * Eaves, gable, ridges (E10+ / R4+ ) need additional geometry passes.
 */
export function isRoofLikeOpaqueElement(element: Element): boolean {
  if (element.type !== 'BuildingElementOpaque') return false;
  if ((element as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof) return true;
  const pitch = (element as { pitch?: number }).pitch;
  if (typeof pitch === 'number' && Number.isFinite(pitch) && pitch === 0) return true;
  const name = (element.name ?? '').trim().toLowerCase();
  if (name === 'roof' || name.includes('roof')) {
    /**
     * CSV often names vertical dormer **walls** "… Dormer … Wall" / "… Cheek" with "roof" in the string.
     * Those are `pitch === 90°` façade lines, not roof planes — they must stay eligible for wall passes
     * (E16, R8, etc.). True roof opaques use `0 < pitch < 90` or `pitch === 0` (handled above).
     */
    if (typeof pitch === 'number' && Number.isFinite(pitch) && Math.abs(pitch - 90) < 1e-3) {
      return false;
    }
    return true;
  }
  return false;
}
