// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { roundToTwoDecimals } from '../geometry/constants';
import type { ContextShading, Element } from '../geometry/types';

type PlanPoint = { x: number; y: number };

const normalizeDegrees = (angle: number): number => ((angle % 360) + 360) % 360;

export function getPlanCenter(coords: PlanPoint[] | undefined): PlanPoint | null {
  if (!coords || coords.length === 0) return null;
  const last = coords[coords.length - 1];
  const ring = coords.length > 1 && last.x === coords[0].x && last.y === coords[0].y
    ? coords.slice(0, -1)
    : coords;
  // Sum relative to the first vertex so large (e.g. grid) coordinates keep their precision.
  const { x: x0, y: y0 } = ring[0];
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const ax = ring[i].x - x0;
    const ay = ring[i].y - y0;
    const bx = ring[(i + 1) % ring.length].x - x0;
    const by = ring[(i + 1) % ring.length].y - y0;
    const cross = ax * by - bx * ay;
    twiceArea += cross;
    cx += (ax + bx) * cross;
    cy += (ay + by) * cross;
  }
  if (Math.abs(twiceArea) > 1e-9) {
    return { x: x0 + cx / (3 * twiceArea), y: y0 + cy / (3 * twiceArea) };
  }
  // A point, line or zero-area shape has no area centroid; its centre is the vertex mean.
  return {
    x: ring.reduce((sum, coord) => sum + coord.x, 0) / ring.length,
    y: ring.reduce((sum, coord) => sum + coord.y, 0) / ring.length,
  };
}

function pointAzimuthDeg(point: PlanPoint, origin: PlanPoint): number {
  const mathematicalDeg = Math.atan2(point.y - origin.y, point.x - origin.x) * 180 / Math.PI;
  return normalizeDegrees(90 - mathematicalDeg);
}

function smallestAngularRange(angles: number[]): { start_angle: number; end_angle: number } {
  if (angles.length === 0) return { start_angle: 0, end_angle: 0 };
  if (angles.length === 1) return { start_angle: angles[0], end_angle: angles[0] };

  const sortedAngles = [...angles].sort((a, b) => a - b);
  let largestGap = -1;
  let largestGapIndex = 0;

  for (let i = 0; i < sortedAngles.length; i++) {
    const current = sortedAngles[i];
    const next = sortedAngles[(i + 1) % sortedAngles.length];
    const gap = normalizeDegrees(next - current);
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = i;
    }
  }

  return {
    start_angle: sortedAngles[(largestGapIndex + 1) % sortedAngles.length],
    end_angle: sortedAngles[largestGapIndex],
  };
}

export function calculateContextShadingAngularRangeFromCoordinates(
  contextShading: ContextShading,
  parentElement: Element,
  globalOffsetDeg = 0,
): { start_angle: number; end_angle: number } {
  if (!contextShading.coordinates || !parentElement.coordinates ||
      contextShading.coordinates.length === 0 || parentElement.coordinates.length === 0) {
    return { start_angle: 0, end_angle: 0 };
  }

  const parentCenter = getPlanCenter(parentElement.coordinates);
  if (!parentCenter) return { start_angle: 0, end_angle: 0 };

  let { start_angle, end_angle } = smallestAngularRange(
    contextShading.coordinates.map((coord) => pointAzimuthDeg(coord, parentCenter)),
  );

  if (globalOffsetDeg) {
    start_angle = normalizeDegrees(start_angle - globalOffsetDeg);
    end_angle = normalizeDegrees(end_angle - globalOffsetDeg);
  }

  return { start_angle, end_angle };
}

export function calculateContextShadingDistanceFromCoordinates(
  contextShading: Pick<ContextShading, 'coordinates'>,
  parentElement: Pick<Element, 'coordinates'>,
): number {
  const shadingCenter = getPlanCenter(contextShading.coordinates);
  const parentCenter = getPlanCenter(parentElement.coordinates);
  if (!shadingCenter || !parentCenter) return 0;
  return roundToTwoDecimals(Math.hypot(
    shadingCenter.x - parentCenter.x,
    shadingCenter.y - parentCenter.y,
  ));
}
