// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type {
  InferSpaceFootprintsOptions,
  InferredPlanarFace,
  InferredSpaceFootprint,
  PlanarPoint2,
  WallSegment2D,
} from './types';
export { isInferenceWallElement } from './types';
export { collectInferenceWallSegmentsForStorey } from './collectWallSegments';
export type { ExtractInteriorFacesOptions } from './polygonizeInteriorFaces';
export {
  extractInteriorFaceRings,
  extractInteriorFaces,
} from './polygonizeInteriorFaces';
export { signedShoelaceArea2 } from './signedArea';
export { inferSpaceFootprintsForZone, fingerprintInferenceWallSet } from './inferSpacesFromWalls';
export {
  labelsListContentEqual,
  pointInPolygon,
  polygonCentroid2d,
  remapZoneSpaceLabelsFromInference,
} from './remapInferredSpaceLabels';
