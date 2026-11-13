// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { roundToTwoDecimals } from '../geometry/constants';
import type { ContextShading, Element } from '../geometry/types';

type PlanPoint = { x: number; y: number };

const normalizeDegrees = (angle: number): number => ((angle % 360) + 360) % 360;

function openRing(coords: readonly PlanPoint[]): PlanPoint[] {
  const last = coords[coords.length - 1];
  return coords.length > 1 && last.x === coords[0].x && last.y === coords[0].y ? coords.slice(0, -1) : [...coords];
}

export function getPlanCenter(coords: PlanPoint[] | undefined): PlanPoint | null {
  if (!coords || coords.length === 0) return null;
  const ring = openRing(coords);
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

type Segment = [PlanPoint, PlanPoint];

/** Edges of a drawn shape: a point is one zero-length face, a line one face, a polygon its closed edges. */
function faces(coords: readonly PlanPoint[]): Segment[] {
  const ring = openRing(coords);
  if (ring.length <= 2) return [[ring[0], ring[ring.length - 1]]];
  return ring.map((point, i) => [point, ring[(i + 1) % ring.length]]);
}

function pointSegmentDistance(p: PlanPoint, [a, b]: Segment): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const midpoint = ([a, b]: Segment): PlanPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Wall types whose far side is not outside air, so they are never the closest external wall. */
const NON_EXTERNAL_WALL_TYPES = new Set<string>([
  'BuildingElementPartyWall',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
]);
// Wall lines and floor edges are drawn separately, so allow a small drafting offset.
const WALL_ON_EDGE_TOLERANCE_M = 0.05;

/** True when a non-external wall's plan line lies along the edge and covers most of it. */
function edgeCarriesWall([a, b]: Segment, wall: readonly PlanPoint[]): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const ends = [wall[0], wall[wall.length - 1]];
  if (ends.some((p) => Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux) > WALL_ON_EDGE_TOLERANCE_M)) return false;
  const [t0, t1] = ends.map((p) => (p.x - a.x) * ux + (p.y - a.y) * uy).sort((x, y) => x - y);
  return Math.min(t1, length) - Math.max(t0, 0) > length / 2;
}

/**
 * DESNZ-defined distance (FHS guidance 2.3.1): the horizontal distance from the outside face at
 * the midpoint of the dwelling's closest external wall to the midpoint of the shading object's
 * closest face, measured perpendicular to that facade.
 *
 * The parent floor's edges stand in for the walls. An edge under a party wall or a wall to an
 * adjacent space is not external and is skipped. Edges are drawn on the internal wall faces,
 * so each moves out by the floor's `thickness_walls` when the model gives it. "Closest" is
 * judged by the face midpoint's distance to the wall. A result of 0 or less means the object
 * is beside the dwelling, not in front of an external wall.
 */
export function calculateContextShadingDistanceFromCoordinates(
  contextShading: Pick<ContextShading, 'coordinates'>,
  parentElement: Pick<Element, 'coordinates'> & { thickness_walls?: number },
  elements: readonly Pick<Element, 'type' | 'coordinates'>[],
): number {
  if (!contextShading.coordinates?.length || (parentElement.coordinates?.length ?? 0) < 3) return 0;
  const ring = openRing(parentElement.coordinates);
  const twiceArea = ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0);
  const winding = Math.sign(twiceArea);
  const thickness = Number.isFinite(parentElement.thickness_walls) ? parentElement.thickness_walls! : 0;
  const nonExternalWalls = elements.flatMap((element) =>
    NON_EXTERNAL_WALL_TYPES.has(element.type) && (element.coordinates?.length ?? 0) >= 2 ? [element.coordinates] : []);
  const faceMidpoints = faces(contextShading.coordinates).map(midpoint);
  const objectCenter = getPlanCenter(contextShading.coordinates)!;

  let best: { gap: number; facing: number; distance: number } | null = null;
  for (const edge of faces(ring)) {
    const [a, b] = edge;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0 || nonExternalWalls.some((wall) => edgeCarriesWall(edge, wall))) continue;
    // Outward normal: right of the edge direction for an anticlockwise ring.
    const n = { x: (winding * (b.y - a.y)) / length, y: (winding * (a.x - b.x)) / length };
    const wall: Segment = [
      { x: a.x + n.x * thickness, y: a.y + n.y * thickness },
      { x: b.x + n.x * thickness, y: b.y + n.y * thickness },
    ];
    const wallMid = midpoint(wall);
    const perpendicular = (p: PlanPoint) => (p.x - wallMid.x) * n.x + (p.y - wallMid.y) * n.y;
    const face = faceMidpoints
      .map((mid) => ({ gap: pointSegmentDistance(mid, wall), distance: perpendicular(mid) }))
      .reduce((x, y) => (y.gap < x.gap ? y : x));
    // Ties go to the facade that faces the object most squarely.
    const facing = perpendicular(objectCenter) / (Math.hypot(objectCenter.x - wallMid.x, objectCenter.y - wallMid.y) || 1);
    if (!best || face.gap < best.gap - 1e-9 || (face.gap < best.gap + 1e-9 && facing > best.facing)) {
      best = { gap: face.gap, facing, distance: face.distance };
    }
  }
  return best ? roundToTwoDecimals(best.distance) : 0;
}

/**
 * Re-derives every drawn Context Shading's start angle, end angle and distance from its
 * footprint and parent, so stored values always match the drawing (the form shows the
 * derived values). Returns the input array unchanged when nothing differs.
 */
export function rederiveContextShadingFromDrawing<T extends Element>(elements: readonly T[], globalOffsetDeg: number): T[] {
  const byName = new Map<string, T>();
  for (const element of elements) {
    if (element.name && !byName.has(element.name)) byName.set(element.name, element);
  }
  let changed = false;
  const next = elements.map((element) => {
    if (element.type !== 'ContextShading' || !element.coordinates?.length) return element;
    const shading = element as unknown as ContextShading;
    const parent = shading.parent_element ? byName.get(shading.parent_element) : undefined;
    if (!parent?.coordinates?.length) return element;
    const angles = calculateContextShadingAngularRangeFromCoordinates(shading, parent, globalOffsetDeg);
    const derived = {
      start_angle: roundToTwoDecimals(angles.start_angle),
      end_angle: roundToTwoDecimals(angles.end_angle),
      distance: calculateContextShadingDistanceFromCoordinates(shading, parent, elements),
    };
    if (derived.start_angle === shading.start_angle && derived.end_angle === shading.end_angle && derived.distance === shading.distance) {
      return element;
    }
    changed = true;
    return { ...element, ...derived };
  });
  return changed ? next : (elements as T[]);
}
