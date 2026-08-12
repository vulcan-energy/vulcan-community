// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Overlap Detection Utilities
 *
 * Detects overlapping elements for UI features like showing multiple labels on hover
 * and displaying count badges. Focuses on:
 * - Colinear lines (same line segment, usually from snaps)
 * - Same-point elements (exact coordinate match, usually from snaps)
 * - Overlapping polygons (polygons that share area)
 *
 * Note: Does NOT detect polygon-line overlaps or point-on-line cases.
 * Only detects true overlaps: lines overlapping lines, points overlapping points, and polygons overlapping polygons.
 */

import type { Element } from '../geometry/types';
import { isColinear } from './shapeUtils';
import { getElementShape } from './shapeUtils';
import { isPointInPolygon2D as isPointInsidePolygon } from './pointInPolygon';

/**
 * Check if a point lies on a line segment (within tolerance)
 * Used internally for colinear line overlap detection
 */
function pointOnSegment(
  s1: { x: number; y: number },
  s2: { x: number; y: number },
  p: { x: number; y: number },
  tol: number
): boolean {
  const minX = Math.min(s1.x, s2.x) - tol;
  const maxX = Math.max(s1.x, s2.x) + tol;
  const minY = Math.min(s1.y, s2.y) - tol;
  const maxY = Math.max(s1.y, s2.y) + tol;
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

/**
 * Calculate distance from a point to an infinite line
 * Returns the perpendicular distance
 */
function distanceToLine(
  p: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number }
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // Line is a point, return distance to that point
    return Math.hypot(p.x - lineStart.x, p.y - lineStart.y);
  }
  // Cross product: |(p - lineStart) × (lineEnd - lineStart)| / |lineEnd - lineStart|
  const cross = Math.abs((p.x - lineStart.x) * dy - (p.y - lineStart.y) * dx);
  return cross / Math.sqrt(lenSq);
}

/**
 * Check if two line segments are colinear and overlapping
 *
 * Two lines are colinear if:
 * 1. They are parallel (same direction)
 * 2. They lie on the same infinite line (a point from one line is on the other's infinite line)
 *
 * Two colinear lines overlap if:
 * - Any endpoint of one line lies on the other line segment, OR
 * - Their projections onto the line direction overlap
 */
function areColinearAndOverlapping(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
  tol: number = 0.001
): boolean {
  // First check if lines are parallel (same direction)
  if (!isColinear(a1, a2, b1, b2, 1e-6)) return false;

  // CRITICAL: Check if lines are on the same infinite line (not just parallel)
  // A line is on the same infinite line if a point from one line is close to the other's infinite line
  const distA1ToB = distanceToLine(a1, b1, b2);
  const distA2ToB = distanceToLine(a2, b1, b2);
  const distB1ToA = distanceToLine(b1, a1, a2);
  const distB2ToA = distanceToLine(b2, a1, a2);

  // If any point is far from the other line, they're parallel but not colinear
  if (distA1ToB > tol || distA2ToB > tol || distB1ToA > tol || distB2ToA > tol) {
    return false; // Parallel but not on same line
  }

  // Now check if they actually overlap (not just on same infinite line)
  // Check if any endpoint of one line lies on the other line segment
  const a1OnB = pointOnSegment(b1, b2, a1, tol);
  const a2OnB = pointOnSegment(b1, b2, a2, tol);
  const b1OnA = pointOnSegment(a1, a2, b1, tol);
  const b2OnA = pointOnSegment(a1, a2, b2, tol);

  // If any endpoint lies on the other segment, they overlap
  if (a1OnB || a2OnB || b1OnA || b2OnA) return true;

  // Also check if lines have overlapping projections along the line direction
  // Project all points onto the line direction vector
  const dirX = a2.x - a1.x;
  const dirY = a2.y - a1.y;
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen === 0) return false; // Degenerate line

  const project = (p: { x: number; y: number }) => {
    const vx = p.x - a1.x;
    const vy = p.y - a1.y;
    return (vx * dirX + vy * dirY) / dirLen;
  };

  const a1Proj = project(a1);
  const a2Proj = project(a2);
  const b1Proj = project(b1);
  const b2Proj = project(b2);

  const Amin = Math.min(a1Proj, a2Proj);
  const Amax = Math.max(a1Proj, a2Proj);
  const Bmin = Math.min(b1Proj, b2Proj);
  const Bmax = Math.max(b1Proj, b2Proj);

  const overlap1 = Math.max(Amin, Bmin);
  const overlap2 = Math.min(Amax, Bmax);
  return overlap2 > overlap1 + tol;
}

/**
 * Check if two points are the same (within tolerance)
 */
function areSamePoint(
  p1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number },
  tol: number = 0
): boolean {
  if (tol === 0) {
    // Exact match
    return p1.x === p2.x && p1.y === p2.y && p1.z === p2.z;
  }
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.z - p1.z;
  return Math.hypot(dx, dy, dz) <= tol;
}

/**
 * Heuristic polygon overlap (vertex-in-polygon + centroid checks).
 * Unreliable for edge-adjacent partitions (shared boundary vertices read as “inside”); not used for space labels.
 */
function doPolygonsOverlap(
  polyA: Array<{ x: number; y: number; z: number }>,
  polyB: Array<{ x: number; y: number; z: number }>
): boolean {
  if (polyA.length < 3 || polyB.length < 3) return false;

  // Convert to 2D for overlap checking
  const a2d = polyA.map(p => ({ x: p.x, y: p.y }));
  const b2d = polyB.map(p => ({ x: p.x, y: p.y }));

  // Check if any vertex of A is inside B
  for (const vertex of a2d) {
    if (isPointInsidePolygon(vertex, b2d)) {
      return true;
    }
  }

  // Check if any vertex of B is inside A
  for (const vertex of b2d) {
    if (isPointInsidePolygon(vertex, a2d)) {
      return true;
    }
  }

  // Also check if polygons share significant area by checking center points
  // Calculate centroids
  const centerA = {
    x: a2d.reduce((sum, p) => sum + p.x, 0) / a2d.length,
    y: a2d.reduce((sum, p) => sum + p.y, 0) / a2d.length
  };
  const centerB = {
    x: b2d.reduce((sum, p) => sum + p.x, 0) / b2d.length,
    y: b2d.reduce((sum, p) => sum + p.y, 0) / b2d.length
  };

  // If centers are inside each other, they overlap
  if (isPointInsidePolygon(centerA, b2d) || isPointInsidePolygon(centerB, a2d)) {
    return true;
  }

  return false;
}

/**
 * Find all elements that overlap with the given element
 * Returns array of element IDs that overlap
 */
export function findOverlappingElements(
  element: Element,
  elementsById: Record<string, Element>,
  snapTolerance: number = 0.1
): string[] {
  void snapTolerance;
  const overlapping: string[] = [];

  if (!element.coordinates || element.coordinates.length === 0) return overlapping;

  const elementShape = getElementShape(element);
  const elementZ = element.coordinates[0]?.z ?? 0;

  // For exact matching (same-point), use 0 tolerance
  // For colinear lines, use 0.001m (1mm) tolerance
  const exactTol = 0;
  const colinearTol = 0.001;

  for (const [otherId, other] of Object.entries(elementsById)) {
    if (otherId === element.id || !other.coordinates || other.coordinates.length === 0) continue;

    const otherShape = getElementShape(other);
    const otherZ = other.coordinates[0]?.z ?? 0;

    // Only check same z-level (same floor)
    if (elementZ !== otherZ) continue;

    // Check for same-point overlap (point elements or shared vertices)
    if (elementShape === 'point' && otherShape === 'point') {
      const p1 = element.coordinates[0];
      const p2 = other.coordinates[0];
      if (areSamePoint(p1, p2, exactTol)) {
        overlapping.push(otherId);
        continue;
      }
    }

    // Check for colinear line overlap
    if (elementShape === 'line' && otherShape === 'line' &&
        element.coordinates.length === 2 && other.coordinates.length === 2) {
      const [a1, a2] = element.coordinates;
      const [b1, b2] = other.coordinates;
      if (areColinearAndOverlapping(a1, a2, b1, b2, colinearTol)) {
        overlapping.push(otherId);
        continue;
      }
    }

    // Check for polygon-polygon overlap
    if ((elementShape === 'polygon' || elementShape === 'sloped-polygon') &&
        (otherShape === 'polygon' || otherShape === 'sloped-polygon') &&
        element.coordinates.length >= 3 && other.coordinates.length >= 3) {
      if (doPolygonsOverlap(element.coordinates, other.coordinates)) {
        overlapping.push(otherId);
        continue;
      }
    }
  }

  return overlapping;
}

/**
 * Calculate the center position of overlapping elements for badge placement
 */
export function getOverlapCenter(
  element: Element,
  overlappingElements: Element[]
): { x: number; y: number; z: number } | null {
  const allElements = [element, ...overlappingElements];
  const allCoords: Array<{ x: number; y: number; z: number }> = [];

  for (const el of allElements) {
    if (!el.coordinates || el.coordinates.length === 0) continue;
    const shape = getElementShape(el);

    if (shape === 'point') {
      allCoords.push(el.coordinates[0]);
    } else if (shape === 'line' && el.coordinates.length === 2) {
      // Use midpoint of line
      const [a, b] = el.coordinates;
      allCoords.push({
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        z: a.z ?? b.z ?? 0
      });
    } else if ((shape === 'polygon' || shape === 'sloped-polygon') && el.coordinates.length >= 3) {
      // Use centroid of polygon
      const xs = el.coordinates.map(c => c.x);
      const ys = el.coordinates.map(c => c.y);
      const zs = el.coordinates.map(c => c.z ?? 0);
      allCoords.push({
        x: xs.reduce((sum, x) => sum + x, 0) / xs.length,
        y: ys.reduce((sum, y) => sum + y, 0) / ys.length,
        z: zs.reduce((sum, z) => sum + z, 0) / zs.length
      });
    }
  }

  if (allCoords.length === 0) return null;

  // Average all coordinates
  const avgX = allCoords.reduce((sum, c) => sum + c.x, 0) / allCoords.length;
  const avgY = allCoords.reduce((sum, c) => sum + c.y, 0) / allCoords.length;
  const avgZ = allCoords.reduce((sum, c) => sum + (c.z ?? 0), 0) / allCoords.length;

  return { x: avgX, y: avgY, z: avgZ };
}
