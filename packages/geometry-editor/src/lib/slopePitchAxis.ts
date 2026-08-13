// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import { getElementShape } from './shapeUtils';
import { computeSlopedPolygonInwardNormal2D } from './geometry3dSloped';

export const SLOPE_PITCH_AXIS_EXTRA_JSON_KEY = '_slope_pitch_axis';

/** Datum-line overshoot for the rendered hinge contour (canvas affordance only). */
export const SLOPE_CONTOUR_OVERSHOOT_M = 0.25;

export type SlopePitchAxis = 'bottom-edge' | 'orientation';

export function isOrientationPitchAxis(element: Element): boolean {
  return element.extra_json?.[SLOPE_PITCH_AXIS_EXTRA_JSON_KEY] === 'orientation' &&
    (element.type === 'BuildingElementOpaque' || element.type === 'BuildingElementTransparent') &&
    getElementShape(element) === 'sloped-polygon';
}

function cleanUnitComponent(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 1) < 1e-12) return 1;
  if (Math.abs(value + 1) < 1e-12) return -1;
  return value;
}

/** Model-plan downslope direction for a stored compass bearing. */
export function downslopeUnitModelXY(
  orientation360: number,
  globalOrientationOffset: number,
): [number, number] {
  const theta = ((orientation360 + globalOrientationOffset) * Math.PI) / 180;
  return [cleanUnitComponent(Math.sin(theta)), cleanUnitComponent(Math.cos(theta))];
}

export function findLowVertexIndex(
  points: Array<[number, number]>,
  downslope: [number, number],
): number | null {
  if (points.length === 0) return null;
  const projections = points.map((point) => point[0] * downslope[0] + point[1] * downslope[1]);
  const maximum = Math.max(...projections);
  return projections.findIndex((projection) => maximum - projection <= 1e-6);
}

export function slopedPolygonPlaneBasis(
  points: Array<[number, number]>,
  axisState: SlopePitchAxis,
  orientation360: number,
  globalOrientationOffset: number,
): { anchorXY: [number, number]; upslope2D: [number, number] } | null {
  if (points.length < 3) return null;
  if (axisState === 'bottom-edge') {
    const upslope2D = computeSlopedPolygonInwardNormal2D(points);
    return upslope2D ? { anchorXY: points[0]!, upslope2D } : null;
  }
  if (!Number.isFinite(orientation360) || !Number.isFinite(globalOrientationOffset)) return null;
  const downslope = downslopeUnitModelXY(orientation360, globalOrientationOffset);
  const lowIndex = findLowVertexIndex(points, downslope);
  if (lowIndex === null) return null;
  if (lowIndex === 0 && points[1]) {
    const firstProjection = points[0]![0] * downslope[0] + points[0]![1] * downslope[1];
    const secondProjection = points[1][0] * downslope[0] + points[1][1] * downslope[1];
    const bottomEdgeUpslope = computeSlopedPolygonInwardNormal2D(points);
    if (
      Math.abs(firstProjection - secondProjection) <= 1e-6 &&
      bottomEdgeUpslope &&
      bottomEdgeUpslope[0] * -downslope[0] + bottomEdgeUpslope[1] * -downslope[1] >= 1 - 1e-12
    ) {
      return { anchorXY: points[0], upslope2D: bottomEdgeUpslope };
    }
  }
  return {
    anchorXY: points[lowIndex]!,
    upslope2D: [cleanUnitComponent(-downslope[0]), cleanUnitComponent(-downslope[1])],
  };
}

/** Horizontal contour through the plane hinge, spanning all plan-point projections.
 * `overshootM` extends both ends past the span (datum-line rendering); geometry
 * consumers leave it 0. */
export function slopeHingeContourSegment(
  points: Array<[number, number]>,
  anchorXY: [number, number],
  upslope2D: [number, number],
  overshootM = 0,
): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  const contour: [number, number] = [upslope2D[1], -upslope2D[0]];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const projection =
      (point[0] - anchorXY[0]) * contour[0] +
      (point[1] - anchorXY[1]) * contour[1];
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  min -= overshootM;
  max += overshootM;
  return [
    [anchorXY[0] + contour[0] * min, anchorXY[1] + contour[1] * min],
    [anchorXY[0] + contour[0] * max, anchorXY[1] + contour[1] * max],
  ];
}
