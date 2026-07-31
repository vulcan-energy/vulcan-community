// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../../stores/geometryStore';
import { getElementCanvasFloorZValue, normalizeStoreyIndex } from '../elementCanvasFloor';
import { isInferenceWallElement, type WallSegment2D } from './types';

function pitchIndicatesSlopedRoofLineWall(el: Element): boolean {
  const pitch = (el as { pitch?: number }).pitch;
  if (pitch === undefined || !Number.isFinite(pitch)) return false;
  return pitch > 0 && pitch < 90;
}

function isPitchedRoofOpaque(el: Element): boolean {
  return el.type === 'BuildingElementOpaque' && (el as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof === true;
}

/**
 * Line walls for space inference: exposed, internal (conditioned + unconditioned), party.
 * Excludes windows, non–2-point geometry, roof polygons / sloped roof lines, mismatched endpoint z.
 */
export function collectInferenceWallSegmentsForStorey(
  elements: Element[],
  zoneId: string,
  wallZIndex: number,
): WallSegment2D[] {
  const out: WallSegment2D[] = [];
  const targetZ = normalizeStoreyIndex(wallZIndex);
  if (targetZ === undefined) return out;

  for (const el of elements) {
    if (!isInferenceWallElement(el)) continue;
    if (el.zoneId !== zoneId) continue;
    if (pitchIndicatesSlopedRoofLineWall(el)) continue;
    if (isPitchedRoofOpaque(el)) continue;

    const coords = el.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) continue;

    const A = coords[0];
    const B = coords[1];
    const za = normalizeStoreyIndex(A.z);
    const zb = normalizeStoreyIndex(B.z);
    if (za === undefined || zb === undefined || za !== zb || za !== targetZ) continue;

    // Line fabric uses coordinate z as storey index; TB/service `floor_id` does not apply here.
    const floorZ = getElementCanvasFloorZValue(el, undefined);
    if (floorZ !== targetZ) continue;

    out.push({
      a: { x: A.x, y: A.y },
      b: { x: B.x, y: B.y },
      wallZIndex: targetZ,
    });
  }

  return out;
}
