// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { roundToTwoDecimals } from '../geometry/constants';
import type { ContextShading, Element } from '../geometry/types';

type PlanPoint = { x: number; y: number };

const normalizeDegrees = (angle: number): number => ((angle % 360) + 360) % 360;

function getPlanCenter(coords: PlanPoint[] | undefined): PlanPoint | null {
  if (!coords || coords.length === 0) return null;
  return {
    x: coords.reduce((sum, coord) => sum + coord.x, 0) / coords.length,
    y: coords.reduce((sum, coord) => sum + coord.y, 0) / coords.length,
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
