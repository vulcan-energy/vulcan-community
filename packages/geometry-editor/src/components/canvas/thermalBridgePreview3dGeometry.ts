// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { modelXYToThreeXZ } from '../../lib/geometryTransform';

type Point3 = { x: number; y: number; z: number };

export interface ThermalBridgePreviewIntersection {
  distance: number;
  object: {
    userData: {
      thermalBridgePreviewCandidateId?: string;
      thermalBridgePreviewOccludes?: boolean;
    };
  };
}

export interface ThermalBridgePreviewHostSurface {
  hostElementId?: string;
  point: [number, number, number];
  normal: [number, number, number];
  thicknessM: number;
}

/** Candidate coordinates carry physical metre elevation in z; Three.js uses y for height. */
export function thermalBridgePreviewWorldPoints(
  coordinates: readonly Point3[],
): [number, number, number][] {
  return coordinates.map((point) => {
    const [x, z] = modelXYToThreeXZ([point.x, point.y]);
    return [x, point.z, z];
  });
}

/** Display-only front-face offset along the mapped host face normal; model coordinates stay intact. */
export function offsetThermalBridgePreviewWorldPoints(
  points: readonly [number, number, number][],
  cameraPosition: { x: number; y: number; z: number },
  surface: ThermalBridgePreviewHostSurface,
): [number, number, number][] {
  const normalLength = Math.hypot(...surface.normal);
  if (points.length === 0 || normalLength < 1e-9 || !Number.isFinite(surface.thicknessM)) {
    return points.map((point) => [...point]);
  }
  const midpoint = points.reduce((sum, point) => [
    sum[0] + point[0] / points.length,
    sum[1] + point[1] / points.length,
    sum[2] + point[2] / points.length,
  ], [0, 0, 0]);
  const towardCamera = [cameraPosition.x - midpoint[0], cameraPosition.y - midpoint[1], cameraPosition.z - midpoint[2]];
  const normal = surface.normal.map((component) => component / normalLength);
  const side = towardCamera.reduce((sum, component, index) => sum + component * normal[index]!, 0) >= 0 ? 1 : -1;
  const offsetM = Math.max(0, surface.thicknessM / 2) + 0.005;
  return points.map((point) => [
    point[0] + normal[0]! * offsetM * side,
    point[1] + normal[1]! * offsetM * side,
    point[2] + normal[2]! * offsetM * side,
  ]);
}

/** Keep only the host planes incident to this bridge; exact corner lines may lie on two faces. */
export function incidentThermalBridgePreviewSurfaces(
  points: readonly [number, number, number][],
  surfaces: readonly ThermalBridgePreviewHostSurface[],
  tieToleranceM = 0.01,
): ThermalBridgePreviewHostSurface[] {
  if (points.length === 0 || surfaces.length < 2) return [...surfaces];
  const distances = surfaces.map((surface) => {
    const length = Math.hypot(...surface.normal);
    if (length < 1e-9) return Number.POSITIVE_INFINITY;
    const normal = surface.normal.map((component) => component / length);
    return Math.max(...points.map((point) => Math.abs(
      (point[0] - surface.point[0]) * normal[0]! +
      (point[1] - surface.point[1]) * normal[1]! +
      (point[2] - surface.point[2]) * normal[2]!,
    )));
  });
  const nearest = Math.min(...distances);
  if (!Number.isFinite(nearest)) return [...surfaces];
  const incident = surfaces.filter((_, index) => distances[index]! <= nearest + tieToleranceM);
  const thickestByPlane = new Map<string, ThermalBridgePreviewHostSurface>();
  for (const surface of incident) {
    const length = Math.hypot(...surface.normal);
    const normal = surface.normal.map((component) => component / length);
    let firstSignificant = 1;
    for (const component of normal) {
      if (Math.abs(component) <= 1e-6) continue;
      firstSignificant = component;
      break;
    }
    const sign = firstSignificant < 0 ? -1 : 1;
    const canonicalNormal = normal.map((component) => component * sign);
    const planeOffset = surface.point.reduce(
      (sum, component, index) => sum + component * canonicalNormal[index]!,
      0,
    );
    const key = `${canonicalNormal.map((component) => component.toFixed(6)).join(',')}:${planeOffset.toFixed(4)}`;
    const existing = thickestByPlane.get(key);
    if (!existing || surface.thicknessM > existing.thicknessM) thickestByPlane.set(key, surface);
  }
  return Array.from(thickestByPlane.values());
}

/** Group candidate lines hit by one ray, stopping at the nearest opaque fabric hit. */
export function thermalBridgePreviewCandidateIdsAtHit(
  intersections: readonly ThermalBridgePreviewIntersection[],
  clickedId?: string,
): string[] {
  const nearestOpaqueDistance = intersections.reduce(
    (nearest, hit) => hit.object.userData.thermalBridgePreviewOccludes
      ? Math.min(nearest, hit.distance)
      : nearest,
    Number.POSITIVE_INFINITY,
  );
  const hits = intersections
    .filter((hit) =>
      hit.object.userData.thermalBridgePreviewCandidateId !== undefined &&
      hit.distance <= nearestOpaqueDistance + 1e-4,
    )
    .sort((a, b) => a.distance - b.distance);
  const ids = Array.from(new Set(hits.map((hit) => hit.object.userData.thermalBridgePreviewCandidateId!)));
  return clickedId === undefined || ids.includes(clickedId) ? ids : [];
}

export function isThermalBridgePreviewClick(deltaPx: number): boolean {
  return Number.isFinite(deltaPx) && deltaPx <= 5;
}
