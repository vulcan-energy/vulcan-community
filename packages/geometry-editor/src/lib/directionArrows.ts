// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import { getElementShape } from './shapeUtils';
import {
  orientation360FromSegmentOutwardModelXY,
  polygonPlanCentroid,
  segmentTangentAndOpeningOutwardModelXY,
} from './openingSegmentOutward';
import { downslopeUnitModelXY, isOrientationPitchAxis } from './slopePitchAxis';

/** One arrow length for every direction arrow: lines, bottom-edge slopes, fall lines. */
const FIXED_ARROW_LENGTH_M = 0.25;

export interface DirectionArrow {
  centerX: number;
  centerY: number;
  arrowX: number;
  arrowY: number;
  orientation: number;
}

export interface ArrowHeadPoints {
  tip: { x: number; y: number };
  left: { x: number; y: number };
  right: { x: number; y: number };
}

/**
 * Direction arrow for line elements and sloped polygons.
 * Tip direction = opening-outward from segment sense A→B (same as 3D window shading); `orientation360` is only required to exist.
 * Orientation-axis slopes use their authored fall line; bottom-edge slopes retain the first-edge convention.
 */
export function calculateDirectionArrow(element: Element, globalOrientationOffset?: number): DirectionArrow | null {
  // Process line elements and sloped polygons (BuildingElementOpaque, BuildingElementTransparent, OnSiteGeneration)
  if (element.type !== 'BuildingElementOpaque' && element.type !== 'BuildingElementTransparent' && element.type !== 'OnSiteGeneration') {
    return null;
  }

  // Must have at least 2 coordinates (line element or sloped polygon)
  if (!element.coordinates || element.coordinates.length < 2) {
    return null;
  }

  // Must have orientation360 property
  if (element.orientation360 === undefined || element.orientation360 === null) {
    return null;
  }

  if (isOrientationPitchAxis(element)) {
    if (element.coordinates.length < 3 || !Number.isFinite(globalOrientationOffset)) return null;
    const centroid = polygonPlanCentroid(element.coordinates);
    if (!centroid) return null;
    const { x: centerX, y: centerY } = centroid;
    const downslope = downslopeUnitModelXY(element.orientation360, globalOrientationOffset!);
    // Same fixed-length convention as the bottom-edge and line arrows: the grip is
    // sized in screen space, so the shaft does not have to grow with the footprint.
    const arrowLength = FIXED_ARROW_LENGTH_M;
    return {
      centerX,
      centerY,
      arrowX: centerX + arrowLength * downslope[0],
      arrowY: centerY + arrowLength * downslope[1],
      orientation: element.orientation360,
    };
  }

  // For sloped polygons, use first two coordinates (bottom edge)
  // For line elements, use both coordinates
  const [point1, point2] = element.coordinates;
  const centerX = (point1.x + point2.x) / 2;
  const centerY = (point1.y + point2.y) / 2;

  const arrowLength = FIXED_ARROW_LENGTH_M;
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;

  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
    return null;
  }

  const { openingOutward } = segmentTangentAndOpeningOutwardModelXY(point1.x, point1.y, point2.x, point2.y);
  const arrowX = centerX + arrowLength * openingOutward[0];
  const arrowY = centerY + arrowLength * openingOutward[1];

  const shape = getElementShape(element);
  const orientation =
    shape === 'sloped-polygon' && typeof element.orientation360 === 'number'
      ? element.orientation360
      : orientation360FromSegmentOutwardModelXY(point1.x, point1.y, point2.x, point2.y) ?? 0;

  return {
    centerX,
    centerY,
    arrowX,
    arrowY,
    orientation,
  };
}

/**
 * Calculate arrowhead points for rendering a proper arrowhead
 */
export function calculateArrowPoints(arrow: DirectionArrow): ArrowHeadPoints {
  const headLength = 3; // Length of arrowhead
  const headWidth = 3; // Width of arrowhead

  // Calculate direction vector from center to arrow tip
  const dx = arrow.arrowX - arrow.centerX;
  const dy = arrow.arrowY - arrow.centerY;
  const length = Math.sqrt(dx * dx + dy * dy);

  // Normalize direction vector
  const unitX = dx / length;
  const unitY = dy / length;

  // Calculate perpendicular vector for arrowhead width
  const perpX = -unitY;
  const perpY = unitX;

  // Calculate arrowhead points
  const tip = {
    x: arrow.arrowX,
    y: arrow.arrowY
  };

  const left = {
    x: arrow.arrowX - unitX * headLength + perpX * headWidth,
    y: arrow.arrowY - unitY * headLength + perpY * headWidth
  };

  const right = {
    x: arrow.arrowX - unitX * headLength - perpX * headWidth,
    y: arrow.arrowY - unitY * headLength - perpY * headWidth
  };

  return { tip, left, right };
}

/**
 * Calculate direction arrow for drawing preview
 * Always points perpendicular to the line being drawn
 */
export function calculateDrawingPreviewArrow(
  point1: { x: number; y: number },
  point2: { x: number; y: number },
  _orientation360: number,
  _scale: number,
): DirectionArrow | null {
  void _orientation360;
  void _scale;
  const centerX = (point1.x + point2.x) / 2;
  const centerY = (point1.y + point2.y) / 2;

  const arrowLength = FIXED_ARROW_LENGTH_M;

  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;

  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
    return null;
  }

  const { openingOutward } = segmentTangentAndOpeningOutwardModelXY(point1.x, point1.y, point2.x, point2.y);
  const arrowX = centerX + arrowLength * openingOutward[0];
  const arrowY = centerY + arrowLength * openingOutward[1];

  const orientation = orientation360FromSegmentOutwardModelXY(point1.x, point1.y, point2.x, point2.y);

  return {
    centerX,
    centerY,
    arrowX,
    arrowY,
    orientation: orientation ?? 0,
  };
}
