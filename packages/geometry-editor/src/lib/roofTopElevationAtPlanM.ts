// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Roof **top** plane elevation at a plan point — shared by R8/R9 and sloped-roof gable (E12/E13) proposals.
 */
import { elementBaseElevationMForTb } from './geometry3dMapper';
import { elevationAtSlopedVertexM } from './geometry3dSloped';
import { isOrientationPitchAxis, slopedPolygonPlaneBasis } from './slopePitchAxis';
import type { BuildingElementOpaque, Floor } from '../geometry/types';

function roofBaseElevationM(roof: BuildingElementOpaque, floors: Floor[] | undefined): number {
  if (floors && floors.length > 0) {
    return elementBaseElevationMForTb(roof, floors);
  }
  const c = roof.coordinates;
  if (!c?.length) return 0;
  const bh = (roof as { base_height?: number }).base_height;
  if (typeof bh === 'number' && Number.isFinite(bh) && bh >= 0) return bh;
  return Math.min(...c.map((p) => (typeof p.z === 'number' && Number.isFinite(p.z) ? p.z : 0)));
}

/**
 * Inward normal for a 2-point sloped roof strip: left of directed edge coords[0]→coords[1] (CCW footprint).
 */
function inwardNormal2DStripLeftOfDirectedEdge(roof: BuildingElementOpaque): [number, number] | null {
  const c = roof.coordinates;
  if (!c || c.length < 2) return null;
  const ax = c[0]!.x;
  const ay = c[0]!.y;
  const bx = c[1]!.x;
  const by = c[1]!.y;
  const ex = bx - ax;
  const ey = by - ay;
  const len = Math.hypot(ex, ey);
  if (len < 1e-9) return null;
  const nx = -ey / len;
  const ny = ex / len;
  return [nx, ny];
}

/** Inward normal in plan for sloped roof polygon or 2-vertex strip (same convention as 3D sloped envelopes). */
export function inwardNormal2DForSlopedRoof(
  roof: BuildingElementOpaque,
  globalOrientationOffset?: number,
): [number, number] | null {
  const c = roof.coordinates;
  if (!c || c.length < 2) return null;
  if (c.length >= 3) {
    const planPts = c.map((p) => [p.x, p.y] as [number, number]);
    const orientationAxis = isOrientationPitchAxis(roof);
    if (orientationAxis && !Number.isFinite(globalOrientationOffset)) return null;
    return slopedPolygonPlaneBasis(
      planPts,
      orientationAxis ? 'orientation' : 'bottom-edge',
      roof.orientation360 ?? 0,
      globalOrientationOffset ?? 0,
    )?.upslope2D ?? null;
  }
  return inwardNormal2DStripLeftOfDirectedEdge(roof);
}

/**
 * Z (m) on the **roof top** sloped plane at plan (x,y), matching sloped polygon / strip mapping.
 */
export function roofTopElevationAtPlanM(
  roof: BuildingElementOpaque,
  x: number,
  y: number,
  floors: Floor[] | undefined,
  globalOrientationOffset?: number,
): number | null {
  const c = roof.coordinates;
  if (!c || c.length < 2) return null;
  const pitch = roof.pitch;
  if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch <= 0 || pitch >= 90) return null;
  const orientationAxis = isOrientationPitchAxis(roof);
  if (orientationAxis && !Number.isFinite(globalOrientationOffset)) return null;
  const points = c.map((point) => [point.x, point.y] as [number, number]);
  const basis = c.length >= 3
    ? slopedPolygonPlaneBasis(
        points,
        orientationAxis ? 'orientation' : 'bottom-edge',
        roof.orientation360 ?? 0,
        globalOrientationOffset ?? 0,
      )
    : null;
  const inward = basis?.upslope2D ?? inwardNormal2DForSlopedRoof(roof, globalOrientationOffset);
  if (!inward) return null;
  const baseEl = roofBaseElevationM(roof, floors);
  const anchor: [number, number] = basis?.anchorXY ?? [c[0]!.x, c[0]!.y];
  return elevationAtSlopedVertexM([x, y], anchor, inward, baseEl, pitch);
}
