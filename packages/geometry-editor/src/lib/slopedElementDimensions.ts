// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { roundToTwoDecimals } from '../geometry/constants';
import {
  computeSlopedPolygonInwardNormal2D,
  elevationAtSlopedVertexM,
} from './geometry3dSloped';
import { isOrientationPitchAxis, slopedPolygonPlaneBasis } from './slopePitchAxis';
import type { Element } from '../geometry/types';

export type SlopedPolygonPoint3D = {
  x: number;
  y: number;
  z: number;
};

export type SlopedElementDimensionSource = {
  coordinates?: SlopedPolygonPoint3D[];
  pitch?: number;
  type?: Element['type'];
  orientation360?: number;
  extra_json?: Record<string, unknown>;
};

export type SlopedElementDimensions = {
  width: number;
  height: number;
  area: number;
};

export type PolygonScalarDimensionSemantics = {
  lowEdgeWidth: number;
  farEdgeWidth?: number;
  vertexCount: number;
  /**
   * True for non-parallelogram sloped shapes (triangles, trapezoids, ...): height is kept as
   * the true up-slope (slope-plane) length, and width becomes the equivalent dimension
   * (surface area ÷ height) so the surface area stays exact. False for parallelograms, where
   * width = low-edge length and height = area ÷ width already equals the true slope length.
   */
  usesEquivalentWidth: boolean;
};

export type PolygonPoint2D = {
  x: number;
  y: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const POLYGON_INTERSECTION_EPSILON = 1e-9;

const cross2d = (a: PolygonPoint2D, b: PolygonPoint2D, c: PolygonPoint2D): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const pointOnSegment2d = (point: PolygonPoint2D, a: PolygonPoint2D, b: PolygonPoint2D): boolean => {
  if (Math.abs(cross2d(a, b, point)) > POLYGON_INTERSECTION_EPSILON) return false;
  return (
    point.x >= Math.min(a.x, b.x) - POLYGON_INTERSECTION_EPSILON &&
    point.x <= Math.max(a.x, b.x) + POLYGON_INTERSECTION_EPSILON &&
    point.y >= Math.min(a.y, b.y) - POLYGON_INTERSECTION_EPSILON &&
    point.y <= Math.max(a.y, b.y) + POLYGON_INTERSECTION_EPSILON
  );
};

const segmentsIntersect2d = (
  a: PolygonPoint2D,
  b: PolygonPoint2D,
  c: PolygonPoint2D,
  d: PolygonPoint2D,
): boolean => {
  const abC = cross2d(a, b, c);
  const abD = cross2d(a, b, d);
  const cdA = cross2d(c, d, a);
  const cdB = cross2d(c, d, b);

  if (
    (Math.abs(abC) <= POLYGON_INTERSECTION_EPSILON && pointOnSegment2d(c, a, b)) ||
    (Math.abs(abD) <= POLYGON_INTERSECTION_EPSILON && pointOnSegment2d(d, a, b)) ||
    (Math.abs(cdA) <= POLYGON_INTERSECTION_EPSILON && pointOnSegment2d(a, c, d)) ||
    (Math.abs(cdB) <= POLYGON_INTERSECTION_EPSILON && pointOnSegment2d(b, c, d))
  ) {
    return true;
  }

  return (
    (
      (abC > POLYGON_INTERSECTION_EPSILON && abD < -POLYGON_INTERSECTION_EPSILON) ||
      (abC < -POLYGON_INTERSECTION_EPSILON && abD > POLYGON_INTERSECTION_EPSILON)
    ) &&
    (
      (cdA > POLYGON_INTERSECTION_EPSILON && cdB < -POLYGON_INTERSECTION_EPSILON) ||
      (cdA < -POLYGON_INTERSECTION_EPSILON && cdB > POLYGON_INTERSECTION_EPSILON)
    )
  );
};

export const hasSelfIntersectingPolygonEdges = (
  coordinates: ReadonlyArray<PolygonPoint2D> | undefined,
): boolean => {
  if (!Array.isArray(coordinates) || coordinates.length < 4) return false;
  const edgeCount = coordinates.length;

  for (let i = 0; i < edgeCount; i += 1) {
    const a = coordinates[i];
    const b = coordinates[(i + 1) % edgeCount];
    if (Math.hypot(b.x - a.x, b.y - a.y) <= POLYGON_INTERSECTION_EPSILON) continue;

    for (let j = i + 1; j < edgeCount; j += 1) {
      const edgesAreAdjacent =
        Math.abs(i - j) === 1 ||
        (i === 0 && j === edgeCount - 1);
      if (edgesAreAdjacent) continue;

      const c = coordinates[j];
      const d = coordinates[(j + 1) % edgeCount];
      if (Math.hypot(d.x - c.x, d.y - c.y) <= POLYGON_INTERSECTION_EPSILON) continue;
      if (segmentsIntersect2d(a, b, c, d)) return true;
    }
  }

  return false;
};

export const rebuildSlopedPolygonRectangleFromLowEdgeDimensions = (args: {
  coordinates: ReadonlyArray<SlopedPolygonPoint3D> | undefined;
  widthM: number;
  heightM: number;
  pitchDegrees: number | undefined;
}): SlopedPolygonPoint3D[] | null => {
  const { coordinates, widthM, heightM, pitchDegrees } = args;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  if (!isFiniteNumber(widthM) || widthM <= 0) return null;
  if (!isFiniteNumber(heightM) || heightM <= 0) return null;

  const a = coordinates[0];
  const b = coordinates[1];
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lowEdgeLength = Math.hypot(dx, dy);
  if (!Number.isFinite(lowEdgeLength) || lowEdgeLength <= 1e-9) return null;

  const ux = dx / lowEdgeLength;
  const uy = dy / lowEdgeLength;
  const leftX = -uy;
  const leftY = ux;
  const sidePoint = coordinates[2] ?? coordinates[coordinates.length - 1];
  const sideCross = sidePoint
    ? (b.x - a.x) * (sidePoint.y - a.y) - (b.y - a.y) * (sidePoint.x - a.x)
    : 1;
  const sideSign = sideCross < 0 ? -1 : 1;
  const pitch = isFiniteNumber(pitchDegrees) ? pitchDegrees : 0;
  const cosPitch = Math.cos((pitch * Math.PI) / 180);
  const projectedDepth = pitch > 0 && cosPitch > 1e-9 ? heightM * cosPitch : heightM;
  const sx = leftX * sideSign;
  const sy = leftY * sideSign;
  const z = isFiniteNumber(a.z) ? a.z : 0;
  const p0 = { x: roundToTwoDecimals(a.x), y: roundToTwoDecimals(a.y), z: roundToTwoDecimals(z) };
  const p1 = {
    x: roundToTwoDecimals(a.x + ux * widthM),
    y: roundToTwoDecimals(a.y + uy * widthM),
    z: roundToTwoDecimals(z),
  };
  const p2 = {
    x: roundToTwoDecimals(p1.x + sx * projectedDepth),
    y: roundToTwoDecimals(p1.y + sy * projectedDepth),
    z: roundToTwoDecimals(z),
  };
  const p3 = {
    x: roundToTwoDecimals(p0.x + sx * projectedDepth),
    y: roundToTwoDecimals(p0.y + sy * projectedDepth),
    z: roundToTwoDecimals(z),
  };
  return [p0, p1, p2, p3];
};

export type SlopedPolygonRectangleDimensionPatch = {
  coordinates: SlopedPolygonPoint3D[];
  width: number;
  height: number;
  area: number;
  _widthUserOverride: false;
  _heightUserOverride: false;
};

/** Build one authoritative patch for a rectangular sloped surface and its scalar dimensions. */
export const buildSlopedPolygonRectangleDimensionPatch = (args: {
  coordinates: ReadonlyArray<SlopedPolygonPoint3D> | undefined;
  widthM: number;
  heightM: number;
  pitchDegrees: number | undefined;
}): SlopedPolygonRectangleDimensionPatch | null => {
  const width = roundToTwoDecimals(args.widthM);
  const height = roundToTwoDecimals(args.heightM);
  const coordinates = rebuildSlopedPolygonRectangleFromLowEdgeDimensions({
    coordinates: args.coordinates,
    widthM: width,
    heightM: height,
    pitchDegrees: args.pitchDegrees,
  });
  if (!coordinates) return null;
  return {
    coordinates,
    width,
    height,
    area: roundToTwoDecimals(width * height),
    _widthUserOverride: false,
    _heightUserOverride: false,
  };
};

export const slopedPolygonNeedsRectangleRebuild = (args: {
  coordinates: ReadonlyArray<SlopedPolygonPoint3D> | undefined;
  widthM: number;
  heightM: number;
  pitchDegrees: number | undefined;
  epsilon?: number;
}): boolean => {
  const { coordinates, widthM, heightM, pitchDegrees, epsilon = 0.01 } = args;
  const rebuilt = rebuildSlopedPolygonRectangleFromLowEdgeDimensions({
    coordinates,
    widthM,
    heightM,
    pitchDegrees,
  });
  if (!rebuilt || !Array.isArray(coordinates) || coordinates.length < 3) return false;
  if (coordinates.length !== rebuilt.length) return true;

  return coordinates.some((point, index) => {
    const expected = rebuilt[index];
    return (
      Math.abs(point.x - expected.x) > epsilon ||
      Math.abs(point.y - expected.y) > epsilon ||
      Math.abs((point.z ?? 0) - (expected.z ?? 0)) > epsilon
    );
  });
};

const calculatePlanarFaceArea3D = (points: SlopedPolygonPoint3D[]): number => {
  if (points.length < 3) return 0;

  const origin = points[0];
  let grossArea = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const ab = { x: a.x - origin.x, y: a.y - origin.y, z: a.z - origin.z };
    const ac = { x: b.x - origin.x, y: b.y - origin.y, z: b.z - origin.z };
    const cross = {
      x: ab.y * ac.z - ab.z * ac.y,
      y: ab.z * ac.x - ab.x * ac.z,
      z: ab.x * ac.y - ab.y * ac.x,
    };
    grossArea += 0.5 * Math.hypot(cross.x, cross.y, cross.z);
  }

  return grossArea;
};

export const getSlopedPolygonSurfaceArea = (
  polygon: SlopedPolygonPoint3D[],
  slopeReference: SlopedElementDimensionSource,
  globalOrientationOffset?: number,
): number | null => {
  if (polygon.length < 3) return null;
  const pitch = slopeReference.pitch;
  if (!isFiniteNumber(pitch) || pitch <= 0 || pitch >= 90) return null;
  const coordinates = slopeReference.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 3) return null;

  const hostPlanPoints = coordinates.map((point) => [point.x, point.y] as [number, number]);
  const orientationAxis = isOrientationPitchAxis(slopeReference as Element);
  if (orientationAxis && !Number.isFinite(globalOrientationOffset)) return null;
  const basis = slopedPolygonPlaneBasis(
    hostPlanPoints,
    orientationAxis ? 'orientation' : 'bottom-edge',
    slopeReference.orientation360 ?? 0,
    globalOrientationOffset ?? 0,
  );
  if (!basis) return null;
  const liftedPoints = polygon.map((point) => ({
    x: point.x,
    y: point.y,
    z: elevationAtSlopedVertexM(
      [point.x, point.y],
      basis.anchorXY,
      basis.upslope2D,
      0,
      pitch,
    ),
  }));

  return roundToTwoDecimals(calculatePlanarFaceArea3D(liftedPoints));
};

/**
 * Pre-"equivalent-width" formula: width = low-edge length, height = surface area ÷ low-edge
 * width, applied uniformly to every sloped shape including non-parallelograms. For a true
 * parallelogram this already equals the true slope length (see `deriveSlopedElementDimensions`),
 * so it stays the live formula for those shapes. Kept as a standalone export only so CSV imports
 * saved before the equivalent-width change can distinguish a genuine user override from a stale
 * auto-calculated value on import (see `loadFromCSV` in stores/geometryStore/slices/ioSlice.ts).
 */
export const deriveLegacySlopedElementDimensions = (
  element: SlopedElementDimensionSource,
): SlopedElementDimensions | null => {
  const coords = element.coordinates;
  if (!Array.isArray(coords) || coords.length < 3) return null;
  const pitch = element.pitch;
  if (!isFiniteNumber(pitch) || pitch <= 0 || pitch >= 90) return null;

  const first = coords[0];
  const second = coords[1];
  if (!first || !second) return null;

  const lowEdgeWidth = Math.hypot(second.x - first.x, second.y - first.y);
  if (!Number.isFinite(lowEdgeWidth) || lowEdgeWidth <= 1e-9) return null;

  const area = getSlopedPolygonSurfaceArea(coords, { coordinates: coords, pitch });
  if (!isFiniteNumber(area) || area <= 0) return null;

  return {
    width: roundToTwoDecimals(lowEdgeWidth),
    height: roundToTwoDecimals(area / lowEdgeWidth),
    area: roundToTwoDecimals(area),
  };
};

export const deriveSlopedElementDimensions = (
  element: SlopedElementDimensionSource,
  globalOrientationOffset?: number,
): SlopedElementDimensions | null => {
  const coords = element.coordinates;
  const pitch = element.pitch;
  const orientationAxis = isOrientationPitchAxis(element as Element);
  if (orientationAxis) {
    if (!Array.isArray(coords) || coords.length < 3) return null;
    if (!isFiniteNumber(pitch) || pitch <= 0 || pitch >= 90) return null;
    if (!Number.isFinite(globalOrientationOffset)) return null;
    const area = getSlopedPolygonSurfaceArea(coords, element, globalOrientationOffset);
    if (!isFiniteNumber(area) || area <= 0) return null;
    const points = coords.map((point) => [point.x, point.y] as [number, number]);
    const basis = slopedPolygonPlaneBasis(
      points,
      'orientation',
      element.orientation360 ?? 0,
      globalOrientationOffset!,
    );
    if (!basis) return null;
    let dMax = 0;
    for (const point of points) {
      const d =
        (point[0] - basis.anchorXY[0]) * basis.upslope2D[0] +
        (point[1] - basis.anchorXY[1]) * basis.upslope2D[1];
      if (d > dMax) dMax = d;
    }
    if (dMax <= 1e-9) return null;
    const cosPitch = Math.cos((pitch * Math.PI) / 180);
    const slopeExtent = cosPitch > 1e-9 ? dMax / cosPitch : dMax;
    if (!Number.isFinite(slopeExtent) || slopeExtent <= 1e-9) return null;
    return {
      width: roundToTwoDecimals(area / slopeExtent),
      height: roundToTwoDecimals(slopeExtent),
      area: roundToTwoDecimals(area),
    };
  }

  // For parallelograms the legacy formula is already exact (height = area / low-edge width =
  // true slope length), so it doubles as the guard clauses and the parallelogram result here.
  const parallelogramDimensions = deriveLegacySlopedElementDimensions(element);
  if (!parallelogramDimensions) return null;

  const bottomEdgeCoords = element.coordinates as ReadonlyArray<{ x: number; y: number }>;
  const bottomEdgePitch = element.pitch as number;
  const area = parallelogramDimensions.area;

  const semantics = getPolygonScalarDimensionSemantics(bottomEdgeCoords);
  if (!semantics?.usesEquivalentWidth) return parallelogramDimensions;

  // Non-parallelogram (triangle/trapezoid) sloped shapes: keep HEIGHT physically true because
  // HEM derives overhang/obstacle shading from it (projected_height = height·sin(pitch)), and
  // make WIDTH the equivalent dimension instead, so the surface area stays exact.
  // True up-slope extent = the plan-perpendicular distance from the eaves edge to the farthest
  // vertex, projected onto the pitched plane (divided by cos(pitch)).
  const hostPlanPoints = bottomEdgeCoords.map((point) => [point.x, point.y] as [number, number]);
  const inwardNormal2D = computeSlopedPolygonInwardNormal2D(hostPlanPoints);
  if (!inwardNormal2D) return parallelogramDimensions;

  const anchor = hostPlanPoints[0];
  let dMax = 0;
  for (const point of hostPlanPoints) {
    const d = (point[0] - anchor[0]) * inwardNormal2D[0] + (point[1] - anchor[1]) * inwardNormal2D[1];
    if (d > dMax) dMax = d;
  }
  // Degenerate: every vertex sits on (or behind) the eaves line — fall back to the
  // parallelogram formula rather than divide by ~0.
  if (dMax <= 1e-9) return parallelogramDimensions;

  const cosPitch = Math.cos((bottomEdgePitch * Math.PI) / 180);
  const slopeExtent = cosPitch > 1e-9 ? dMax / cosPitch : dMax;
  if (!Number.isFinite(slopeExtent) || slopeExtent <= 1e-9) return parallelogramDimensions;

  return {
    width: roundToTwoDecimals(area / slopeExtent),
    height: roundToTwoDecimals(slopeExtent),
    area: roundToTwoDecimals(area),
  };
};

export const getPolygonScalarDimensionSemantics = (
  coordinates: ReadonlyArray<{ x: number; y: number }> | undefined,
  lowEdgeWidthOverride?: number,
  epsilon = 0.01,
): PolygonScalarDimensionSemantics | null => {
  if (!Array.isArray(coordinates) || coordinates.length < 3) return null;
  const first = coordinates[0];
  const second = coordinates[1];
  if (!first || !second) return null;
  const lowEdgeWidth = isFiniteNumber(lowEdgeWidthOverride)
    ? lowEdgeWidthOverride
    : Math.hypot(second.x - first.x, second.y - first.y);
  if (!Number.isFinite(lowEdgeWidth) || lowEdgeWidth <= 1e-9) return null;

  if (coordinates.length !== 4) {
    return {
      lowEdgeWidth: roundToTwoDecimals(lowEdgeWidth),
      vertexCount: coordinates.length,
      usesEquivalentWidth: true,
    };
  }

  const third = coordinates[2];
  const fourth = coordinates[3];
  if (!third || !fourth) return null;
  const farEdgeWidth = Math.hypot(third.x - fourth.x, third.y - fourth.y);
  if (!Number.isFinite(farEdgeWidth) || farEdgeWidth <= 1e-9) {
    return {
      lowEdgeWidth: roundToTwoDecimals(lowEdgeWidth),
      farEdgeWidth: Number.isFinite(farEdgeWidth) ? roundToTwoDecimals(farEdgeWidth) : undefined,
      vertexCount: coordinates.length,
      usesEquivalentWidth: true,
    };
  }

  const lowVector = { x: second.x - first.x, y: second.y - first.y };
  const farVector = { x: third.x - fourth.x, y: third.y - fourth.y };
  const cross = Math.abs(lowVector.x * farVector.y - lowVector.y * farVector.x);
  const parallelError = cross / (lowEdgeWidth * farEdgeWidth);
  const farEdgeDiffers = Math.abs(farEdgeWidth - lowEdgeWidth) > epsilon;
  const farEdgeNotParallel = parallelError > 0.01;

  return {
    lowEdgeWidth: roundToTwoDecimals(lowEdgeWidth),
    farEdgeWidth: roundToTwoDecimals(farEdgeWidth),
    vertexCount: coordinates.length,
    usesEquivalentWidth: farEdgeDiffers || farEdgeNotParallel,
  };
};

export const slopedDimensionDiffers = (
  currentValue: unknown,
  derivedValue: number,
  epsilon = 0.01,
): currentValue is number =>
  typeof currentValue === 'number' &&
  Number.isFinite(currentValue) &&
  Math.abs(currentValue - derivedValue) > epsilon;
