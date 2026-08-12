// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../../geometry/types';
import { collectInferenceWallSegmentsForStorey } from './collectWallSegments';
import { extractInteriorFaces } from './polygonizeInteriorFaces';
import type { InferSpaceFootprintsOptions, InferredSpaceFootprint, WallSegment2D } from './types';

const DEFAULT_SNAP_M = 0.1;
const DEFAULT_MIN_FACE_M2 = 1e-4;

/**
 * Infer closed plan footprints from wall segments for **every floor** in `floors`.
 * Uses model XY; wall storey is `coordinates[].z` / `Floor.zIndex` (see `getElementCanvasFloorZValue`).
 */
export function inferSpaceFootprintsForZone(options: InferSpaceFootprintsOptions): InferredSpaceFootprint[] {
  const nodingEps = options.snapEpsilonM ?? DEFAULT_SNAP_M;
  const minArea = options.minFaceAreaM2 ?? DEFAULT_MIN_FACE_M2;
  const floors = options.floors;
  const out: InferredSpaceFootprint[] = [];

  for (let fi = 0; fi < floors.length; fi++) {
    const wallZ = floors[fi].zIndex;
    const segs = collectInferenceWallSegmentsForStorey(options.elements, options.zoneId, wallZ);
    const faces = extractInteriorFaces(segs, minArea, {
      nodingEpsilonM: nodingEps,
    });
    for (const f of faces) {
      out.push({
        storeyIndex: fi,
        wallZIndex: wallZ,
        ring: f.exteriorRing,
        holeRings: f.holeRings.length ? f.holeRings : undefined,
        areaM2: f.areaM2,
      });
    }
  }

  return out;
}

function quantKey(v: number, eps: number): number {
  return Math.round(v / eps) * eps;
}

function segmentFingerprintKey(s: WallSegment2D, eps: number): string {
  const ax = quantKey(s.a.x, eps);
  const ay = quantKey(s.a.y, eps);
  const bx = quantKey(s.b.x, eps);
  const by = quantKey(s.b.y, eps);
  const s1 = `${ax},${ay}`;
  const s2 = `${bx},${by}`;
  return s1 < s2 ? `${s.wallZIndex}|${s1}|${s2}` : `${s.wallZIndex}|${s2}|${s1}`;
}

/**
 * Stable string for debouncing / cache keys when wall geometry is unchanged after ε quantization.
 */
export function fingerprintInferenceWallSet(
  elements: Element[],
  zoneId: string,
  floors: Array<{ zIndex: number }>,
  snapEpsilonM: number = DEFAULT_SNAP_M,
): string {
  const keys: string[] = [];
  for (const f of floors) {
    const segs = collectInferenceWallSegmentsForStorey(elements, zoneId, f.zIndex);
    for (const s of segs) {
      keys.push(segmentFingerprintKey(s, snapEpsilonM));
    }
  }
  keys.sort();
  return keys.join('#');
}
