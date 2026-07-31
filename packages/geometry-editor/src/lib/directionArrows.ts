// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../stores/geometryStore';
import { getElementShape } from './shapeUtils';
import {
  orientation360FromSegmentOutwardModelXY,
  segmentTangentAndOpeningOutwardModelXY,
} from './openingSegmentOutward';

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
 * For sloped polygons, uses the first two coordinates (bottom edge).
 */
export function calculateDirectionArrow(element: Element): DirectionArrow | null {
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

  // For sloped polygons, use first two coordinates (bottom edge)
  // For line elements, use both coordinates
  const [point1, point2] = element.coordinates;
  const centerX = (point1.x + point2.x) / 2;
  const centerY = (point1.y + point2.y) / 2;

  const arrowLength = 0.25;
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

  const arrowLength = 0.25;

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
