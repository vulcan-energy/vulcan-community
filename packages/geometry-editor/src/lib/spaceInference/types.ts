// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../../geometry/types';

export type PlanarPoint2 = { x: number; y: number };

/** One bounded face from polygonization (exterior ring + optional holes). */
export type InferredPlanarFace = {
  exteriorRing: PlanarPoint2[];
  holeRings: PlanarPoint2[][];
  /** Absolute plan area (m^2), net of holes. */
  areaM2: number;
};

/** One candidate footprint for SpaceLabel mapping. */
export type InferredSpaceFootprint = {
  /** Index into `floors` (`SpaceLabel.storey` convention). */
  storeyIndex: number;
  /** Wall coordinate band / `Floor.zIndex` used for filtering. */
  wallZIndex: number;
  /** Exterior boundary (closed ring without repeating the first vertex at the end). */
  ring: PlanarPoint2[];
  /** Present when the face is a polygon with holes (e.g. annulus shell). */
  holeRings?: PlanarPoint2[][];
  /** Plan area (m^2); net of holes when `holeRings` is set. */
  areaM2: number;
};

export type InferSpaceFootprintsOptions = {
  elements: Element[];
  zoneId: string;
  floors: Array<{ zIndex: number }>;
  /**
   * Epsilon-tolerant segment splitting ({@link refineWallSegments}) before face enumeration,
   * and quantisation grid for {@link fingerprintInferenceWallSet}. Default 0.1 m.
   */
  snapEpsilonM?: number;
  /** Drop faces smaller than this area (m^2). */
  minFaceAreaM2?: number;
};

export type WallSegment2D = {
  a: PlanarPoint2;
  b: PlanarPoint2;
  wallZIndex: number;
};

export function isInferenceWallElement(el: Element): boolean {
  if (el.isPlaceholder) return false;
  switch (el.type) {
    case 'BuildingElementOpaque':
    case 'BuildingElementAdjacentConditionedSpace':
    case 'BuildingElementAdjacentUnconditionedSpace_Simple':
    case 'BuildingElementPartyWall':
      return true;
    default:
      return false;
  }
}
