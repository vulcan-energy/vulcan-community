// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Geometry3DPrimitive } from './geometry3dPrimitivesTypes';
import { elevationAtSlopedVertexM } from './geometry3dSloped';
import { modelXYToThreeXZ } from './geometryTransform';

/**
 * Approximate center of an element’s 3D representation (Three.js: X/Y/Z = X/up/Z).
 * Used to aim OrbitControls when framing from the elements list.
 */
export function computeElement3DFrameTarget(
  elementId: string,
  primitives: Geometry3DPrimitive[],
): [number, number, number] | null {
  const pts: [number, number, number][] = [];

  for (const primitive of primitives) {
    if (primitive.elementId !== elementId) continue;

    if (primitive.kind === 'wall-segment') {
      const [sx, sz] = modelXYToThreeXZ(primitive.start);
      const [ex, ez] = modelXYToThreeXZ(primitive.end);
      const midY = primitive.baseElevationM + primitive.heightM / 2;
      pts.push([sx, midY, sz], [ex, midY, ez]);
    } else if (primitive.kind === 'thermal-bridge-vertical-line') {
      const [px, pz] = modelXYToThreeXZ(primitive.xy);
      const midY = (primitive.zBottomM + primitive.zTopM) / 2;
      pts.push([px, midY, pz]);
    } else if (primitive.kind === 'thermal-bridge-sloped-line') {
      const [sx, sz] = modelXYToThreeXZ([primitive.start[0], primitive.start[2]]);
      const [ex, ez] = modelXYToThreeXZ([primitive.end[0], primitive.end[2]]);
      pts.push([sx, primitive.start[1], sz], [ex, primitive.end[1], ez]);
    } else if (primitive.kind === 'point-marker') {
      const [px, pz] = modelXYToThreeXZ(primitive.position);
      pts.push([px, primitive.baseElevationM + primitive.radiusM, pz]);
    } else if (primitive.kind === 'oriented-box') {
      pts.push(primitive.position);
    } else if (primitive.kind === 'planar-face') {
      for (const [modelX, elevation, modelY] of primitive.points) {
        const [px, pz] = modelXYToThreeXZ([modelX, modelY]);
        pts.push([px, elevation, pz]);
      }
    } else if (primitive.kind === 'polygon-sloped') {
      for (const point of primitive.points) {
        const [px, pz] = modelXYToThreeXZ(point);
        const y =
          elevationAtSlopedVertexM(point, primitive.hingeAnchorXY, primitive.inwardNormal2D, primitive.baseElevationM, primitive.pitchDeg) +
          primitive.thicknessM / 2;
        pts.push([px, y, pz]);
      }
    } else {
      for (const point of primitive.points) {
        const [px, pz] = modelXYToThreeXZ(point);
        pts.push([px, primitive.baseElevationM + primitive.heightM / 2, pz]);
      }
    }
  }

  if (pts.length === 0) return null;

  const sum = pts.reduce(
    (acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]] as [number, number, number],
    [0, 0, 0] as [number, number, number],
  );
  const n = pts.length;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}
