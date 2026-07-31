// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type PlanPoint = { x: number; y: number };
export type CoordinatePoint = PlanPoint & { z: number };

export function signedPolygonArea(points: PlanPoint[]): number {
  if (points.length < 3) return 0;
  let areaTwice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    areaTwice += current.x * next.y - next.x * current.y;
  }
  return areaTwice / 2;
}

export function isClockwisePolygon(points: PlanPoint[]): boolean {
  return signedPolygonArea(points) < 0;
}

export function ensureCounterClockwisePolygon<T extends PlanPoint>(points: T[]): T[] {
  return isClockwisePolygon(points) ? [...points].reverse() : points.slice();
}

export function reversePolygonKeepingLeadEdge<T>(points: T[]): T[] {
  if (points.length < 2) return points.slice();
  return [points[1], points[0], ...points.slice(2).reverse()];
}

export function ensureCounterClockwiseKeepingLeadEdge<T extends PlanPoint>(points: T[]): T[] {
  return isClockwisePolygon(points) ? reversePolygonKeepingLeadEdge(points) : points.slice();
}

export function buildOutwardRoomWallSegments(
  points: PlanPoint[],
  z: number,
): Array<[CoordinatePoint, CoordinatePoint]> {
  if (points.length < 2) return [];
  const flip = isClockwisePolygon(points);
  const segments: Array<[CoordinatePoint, CoordinatePoint]> = [];
  for (let i = 0; i < points.length; i += 1) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    segments.push(
      flip
        ? [
            { x: end.x, y: end.y, z },
            { x: start.x, y: start.y, z },
          ]
        : [
            { x: start.x, y: start.y, z },
            { x: end.x, y: end.y, z },
          ],
    );
  }
  return segments;
}
