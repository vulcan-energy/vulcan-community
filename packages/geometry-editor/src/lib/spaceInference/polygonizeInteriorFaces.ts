// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { extractInteriorFacesGraphWalker } from './graphWalkerInteriorFaces';
import type { InferredPlanarFace, PlanarPoint2, WallSegment2D } from './types';

export type ExtractInteriorFacesOptions = {
  /** ε for {@link refineWallSegments} before graph walk. Default 0.1. */
  nodingEpsilonM?: number;
};

/**
 * Bounded faces: ε-refinement → planar half-edge walk.
 */
export function extractInteriorFaces(
  segments: WallSegment2D[],
  minArea: number,
  options?: ExtractInteriorFacesOptions,
): InferredPlanarFace[] {
  const eps = options?.nodingEpsilonM ?? 0.1;
  return extractInteriorFacesGraphWalker(segments, eps, minArea);
}

/** Exterior rings only — convenience wrapper used by tests / debugging. */
export function extractInteriorFaceRings(
  segments: WallSegment2D[],
  minArea: number,
  options?: ExtractInteriorFacesOptions,
): PlanarPoint2[][] {
  return extractInteriorFaces(segments, minArea, options).map((f) => f.exteriorRing);
}
