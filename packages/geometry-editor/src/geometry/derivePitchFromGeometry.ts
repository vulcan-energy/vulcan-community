// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ElementType } from './types';
import {
  HORIZONTAL_ADJACENT_POLYGON_Z_SPAN_M,
  normalizeHorizontalAdjacentPlanPitch,
} from './adjacentPlanPitch';

type Coord = { x: number; y: number; z: number };

const ADJACENT_TYPES: ReadonlyArray<ElementType> = [
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
];

/**
 * Polygon normal via Newell's method — robust for slightly non-coplanar inputs;
 * returns null for degenerate (collinear / fewer-than-3-vertex) polygons.
 */
function computePolygonUnitNormal(
  coords: ReadonlyArray<Coord>,
): { x: number; y: number; z: number } | null {
  if (!coords || coords.length < 3) return null;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < coords.length; i++) {
    const cur = coords[i];
    const next = coords[(i + 1) % coords.length];
    nx += (cur.y - next.y) * (cur.z + next.z);
    ny += (cur.z - next.z) * (cur.x + next.x);
    nz += (cur.x - next.x) * (cur.y + next.y);
  }
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!Number.isFinite(len) || len === 0) return null;
  return { x: nx / len, y: ny / len, z: nz / len };
}

/**
 * Derive HEM `pitch` (degrees) from polygon geometry + element type.
 *
 * Returns `undefined` if the polygon is degenerate or pitch can't be inferred.
 *
 * Conventions:
 * - 0° = horizontal facing up (flat roof, skylight)
 * - 90° = vertical (wall, window)
 * - 180° = horizontal facing down (floor) — only inferred for `BuildingElementGround`;
 *   other horizontal elements default to 0 since the orientation is otherwise ambiguous.
 * - Sloped surfaces: angle between the surface and the horizontal, derived from the
 *   polygon normal's vertical component.
 *
 * Companion to {@link normalizeHorizontalAdjacentPlanPitch}, which handles the related
 * case where pitch is *explicitly* set to 90 on a horizontal polygon (wall default leaking).
 */
export function derivePitchFromGeometry(
  coordinates: ReadonlyArray<Coord> | undefined,
  elementType: ElementType,
): number | undefined {
  if (!coordinates || coordinates.length < 3) return undefined;

  // Reject degenerate (zero-area / collinear) polygons up front — Newell's normal
  // has zero magnitude for those, so we can't trust any element-type fallback either.
  const normal = computePolygonUnitNormal(coordinates);
  if (!normal) return undefined;

  const zs = coordinates.map((c) => c.z);
  const zSpan = Math.max(...zs) - Math.min(...zs);

  if (zSpan <= HORIZONTAL_ADJACENT_POLYGON_Z_SPAN_M) {
    if (elementType === 'BuildingElementGround') return 180;
    return 0;
  }

  const cosFromUp = Math.min(1, Math.max(-1, Math.abs(normal.z)));
  const angleFromHorizontal = Math.acos(cosFromUp) * (180 / Math.PI);
  return Math.round(angleFromHorizontal);
}

/**
 * Resolve the pitch value for a building element when writing CSV / reading CSV.
 *
 * Precedence:
 * 1. `element.pitch` if finite (with horizontal-plane normalisation for adjacent types).
 * 2. Otherwise derive from the polygon via {@link derivePitchFromGeometry}.
 * 3. Otherwise `undefined`.
 *
 * Use this anywhere a building element's pitch is consumed without an authoring UI
 * stepping in, so a missing-pitch element never silently inherits the merger's template default.
 */
export function resolveBuildingElementPitch(
  element: {
    pitch?: number | null;
    coordinates?: ReadonlyArray<Coord>;
    type: ElementType;
  },
): number | undefined {
  let pitch: number | null | undefined = element.pitch;
  if (ADJACENT_TYPES.includes(element.type)) {
    pitch = normalizeHorizontalAdjacentPlanPitch(pitch ?? undefined, element.coordinates);
  }
  if (typeof pitch === 'number' && Number.isFinite(pitch)) {
    return pitch;
  }
  return derivePitchFromGeometry(element.coordinates, element.type);
}
