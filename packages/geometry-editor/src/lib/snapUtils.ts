// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { type Element } from '../stores/geometryStore';
import { normalizeStoreyIndex } from './elementCanvasFloor';

/** Two-point “wall line” types that participate in mutual segment snapping while drawing. */
const LINE_WALL_SNAP_TYPES = new Set<string>([
  'BuildingElementOpaque',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
]);

export function isLineWallElementForSnap(el: Element | undefined): boolean {
  return !!el?.type && LINE_WALL_SNAP_TYPES.has(el.type as string);
}

function projectPointOntoSegmentXY(
  p: { x: number; y: number },
  A: { x: number; y: number },
  B: { x: number; y: number },
): { x: number; y: number } {
  const vx = B.x - A.x;
  const vy = B.y - A.y;
  const v2 = vx * vx + vy * vy;
  if (v2 < 1e-18) return { x: A.x, y: A.y };
  let t = ((p.x - A.x) * vx + (p.y - A.y) * vy) / v2;
  t = Math.max(0, Math.min(1, t));
  return { x: A.x + t * vx, y: A.y + t * vy };
}

function forEachWallSegmentXY(
  elementsById: Record<string, Element>,
  excludeElementId: string,
  fn: (args: {
    id: string;
    el: Element;
    A: { x: number; y: number };
    B: { x: number; y: number };
  }) => void,
): void {
  for (const id of Object.keys(elementsById)) {
    if (id === excludeElementId) continue;
    const el = elementsById[id];
    if (!isLineWallElementForSnap(el)) continue;
    const cc = el!.coordinates || [];
    if (cc.length !== 2) continue;
    fn({ id, el: el!, A: cc[0], B: cc[1] });
  }
}

export type SnapCornerTarget = {
  elementId: string;
  order: number;
  x: number;
  y: number;
  z?: number;
};

export type SnapWallSegmentTarget = {
  elementId: string;
  elementName: string;
  order: number;
  A: { x: number; y: number };
  B: { x: number; y: number };
};

export type GeometrySnapCache = {
  cornerTargets: SnapCornerTarget[];
  wallSegments: SnapWallSegmentTarget[];
  spatialIndex?: SnapSpatialIndex;
};

type SnapSpatialIndex = {
  cellSize: number;
  cornerBuckets: Map<string, SnapCornerTarget[]>;
  wallBuckets: Map<string, SnapWallSegmentTarget[]>;
};

const SNAP_SPATIAL_CELL_SIZE_M = 0.5;

function snapCellKey(ix: number, iy: number): string {
  return `${ix},${iy}`;
}

function snapCell(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

function pushBucket<T>(buckets: Map<string, T[]>, key: string, value: T): void {
  const existing = buckets.get(key);
  if (existing) {
    existing.push(value);
  } else {
    buckets.set(key, [value]);
  }
}

function distanceSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pointToSegmentDistanceSqXY(
  p: { x: number; y: number },
  A: { x: number; y: number },
  B: { x: number; y: number },
): number {
  return distanceSq(p, projectPointOntoSegmentXY(p, A, B));
}

function isBuildingElementForPlanSnap(el: Element | undefined): boolean {
  return typeof el?.type === 'string' && el.type.startsWith('BuildingElement');
}

function storeyIndex(z: unknown): number | null {
  return normalizeStoreyIndex(z) ?? null;
}

function isSamePlanSnapFloor(
  source: Element,
  sourceZ: unknown,
  target: Element | undefined,
  targetZ: unknown,
): boolean {
  if (isBuildingElementForPlanSnap(source) && isBuildingElementForPlanSnap(target)) {
    const aFloor = storeyIndex(sourceZ);
    const bFloor = storeyIndex(targetZ);
    return aFloor !== null && bFloor !== null && aFloor === bFloor;
  }
  return sourceZ === targetZ;
}

function isSamePlanSnapVertex(
  element: Element,
  coord: { x: number; y: number; z?: number },
  other: Element,
  otherCoord: { x: number; y: number; z?: number },
): boolean {
  if (coord.x !== otherCoord.x || coord.y !== otherCoord.y) return false;
  return isSamePlanSnapFloor(element, coord.z, other, otherCoord.z);
}

function buildSnapSpatialIndex(
  cornerTargets: SnapCornerTarget[],
  wallSegments: SnapWallSegmentTarget[],
): SnapSpatialIndex {
  const cellSize = SNAP_SPATIAL_CELL_SIZE_M;
  const cornerBuckets = new Map<string, SnapCornerTarget[]>();
  const wallBuckets = new Map<string, SnapWallSegmentTarget[]>();

  for (const target of cornerTargets) {
    pushBucket(
      cornerBuckets,
      snapCellKey(snapCell(target.x, cellSize), snapCell(target.y, cellSize)),
      target,
    );
  }

  for (const segment of wallSegments) {
    const minCellX = snapCell(Math.min(segment.A.x, segment.B.x), cellSize);
    const maxCellX = snapCell(Math.max(segment.A.x, segment.B.x), cellSize);
    const minCellY = snapCell(Math.min(segment.A.y, segment.B.y), cellSize);
    const maxCellY = snapCell(Math.max(segment.A.y, segment.B.y), cellSize);
    for (let ix = minCellX; ix <= maxCellX; ix++) {
      for (let iy = minCellY; iy <= maxCellY; iy++) {
        pushBucket(wallBuckets, snapCellKey(ix, iy), segment);
      }
    }
  }

  return { cellSize, cornerBuckets, wallBuckets };
}

function querySnapBuckets<T>(
  buckets: Map<string, T[]>,
  cellSize: number,
  point: { x: number; y: number },
  tolerance: number,
): T[] {
  const minCellX = snapCell(point.x - tolerance, cellSize);
  const maxCellX = snapCell(point.x + tolerance, cellSize);
  const minCellY = snapCell(point.y - tolerance, cellSize);
  const maxCellY = snapCell(point.y + tolerance, cellSize);
  const result: T[] = [];
  const seen = new Set<T>();

  for (let ix = minCellX; ix <= maxCellX; ix++) {
    for (let iy = minCellY; iy <= maxCellY; iy++) {
      const items = buckets.get(snapCellKey(ix, iy));
      if (!items) continue;
      for (const item of items) {
        if (seen.has(item)) continue;
        seen.add(item);
        result.push(item);
      }
    }
  }

  return result;
}

export function buildGeometrySnapCacheFromTargets(
  cornerTargets: SnapCornerTarget[],
  wallSegments: SnapWallSegmentTarget[],
): GeometrySnapCache {
  return {
    cornerTargets,
    wallSegments,
    spatialIndex: buildSnapSpatialIndex(cornerTargets, wallSegments),
  };
}

export function getNearbySnapCornerTargets(
  snapCache: GeometrySnapCache,
  point: { x: number; y: number },
  tolerance: number,
): readonly SnapCornerTarget[] {
  const index = snapCache.spatialIndex;
  if (!index) return snapCache.cornerTargets;
  return querySnapBuckets(index.cornerBuckets, index.cellSize, point, tolerance);
}

export function getNearbySnapWallSegments(
  snapCache: GeometrySnapCache,
  point: { x: number; y: number },
  tolerance: number,
): readonly SnapWallSegmentTarget[] {
  const index = snapCache.spatialIndex;
  if (!index) return snapCache.wallSegments;
  return querySnapBuckets(index.wallBuckets, index.cellSize, point, tolerance);
}

export type FindClosestSnapCornerOptions = {
  /** Skip a candidate target when this returns true (e.g. the target's own element). */
  isExcluded?: (target: SnapCornerTarget) => boolean;
  /** Skip a candidate target when this returns false (e.g. a same-storey gate). */
  isEligible?: (target: SnapCornerTarget) => boolean;
};

export type ClosestSnapCorner = { x: number; y: number; elementId: string; order: number };

/**
 * Closest corner target within `tol` of `point`: nearest by squared XY distance, ties broken by
 * `order` (the earlier-inserted element wins, matching cache-build order). This is the loop
 * shared by 2D vertex-drag snapping (`ElementRenderer.findCornerVertexSnapTarget`) and 3D
 * vertex-drag snapping (`GeometryCanvas3D.snap3DPlanPoint`); the two call sites differ in which
 * candidates they exclude/allow, so that is threaded through as options rather than baked in.
 */
export function findClosestSnapCorner(
  point: { x: number; y: number },
  snapCache: GeometrySnapCache,
  tol: number,
  options?: FindClosestSnapCornerOptions,
): ClosestSnapCorner | null {
  const tolSq = tol * tol;
  let best: (ClosestSnapCorner & { distSq: number }) | null = null;

  for (const target of getNearbySnapCornerTargets(snapCache, point, tol)) {
    if (options?.isExcluded?.(target)) continue;
    if (options?.isEligible && !options.isEligible(target)) continue;
    const dx = target.x - point.x;
    const dy = target.y - point.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > tolSq) continue;
    if (!best || distSq < best.distSq || (distSq === best.distSq && target.order < best.order)) {
      best = { x: target.x, y: target.y, elementId: target.elementId, order: target.order, distSq };
    }
  }

  return best;
}

export function buildGeometrySnapCache(elementsById: Record<string, Element>): GeometrySnapCache {
  const cornerTargets: SnapCornerTarget[] = [];
  const wallSegments: SnapWallSegmentTarget[] = [];
  let cornerOrder = 0;
  let wallOrder = 0;

  for (const id of Object.keys(elementsById)) {
    const el = elementsById[id];
    const coords = el?.coordinates || [];
    for (const coord of coords) {
      cornerTargets.push({
        elementId: id,
        order: cornerOrder++,
        x: coord.x,
        y: coord.y,
        z: coord.z,
      });
    }

    if (!isLineWallElementForSnap(el) || coords.length !== 2) continue;
    wallSegments.push({
      elementId: id,
      elementName: (el as any).name || '',
      order: wallOrder++,
      A: coords[0],
      B: coords[1],
    });
  }

  return buildGeometrySnapCacheFromTargets(cornerTargets, wallSegments);
}

function forEachCachedWallSegmentXY(
  snapCache: GeometrySnapCache,
  excludeElementId: string,
  fn: (args: SnapWallSegmentTarget) => void,
  point?: { x: number; y: number },
  tolerance?: number,
): void {
  const segments =
    point && tolerance !== undefined
      ? getNearbySnapWallSegments(snapCache, point, tolerance)
      : snapCache.wallSegments;
  for (const segment of segments) {
    if (segment.elementId === excludeElementId) continue;
    fn(segment);
  }
}

/** Orthogonal draw ray from `last` toward `mouse` (same rule as constrainPointOrthogonally). */
export function pointOnOrthogonalRayForDraw(
  last: { x: number; y: number },
  mouse: { x: number; y: number },
  p: { x: number; y: number },
  eps: number,
): boolean {
  const horizontal = Math.abs(mouse.x - last.x) >= Math.abs(mouse.y - last.y);
  if (horizontal) {
    return Math.abs(p.y - last.y) <= eps;
  }
  return Math.abs(p.x - last.x) <= eps;
}

/**
 * Closest point on segment AB to the axis-aligned infinite ray from `last` through `mouse`.
 */
export function intersectOrthogonalRayWithSegment(
  last: { x: number; y: number },
  mouse: { x: number; y: number },
  A: { x: number; y: number },
  B: { x: number; y: number },
): { x: number; y: number } | null {
  const horizontal = Math.abs(mouse.x - last.x) >= Math.abs(mouse.y - last.y);
  if (horizontal) {
    const y0 = last.y;
    const dy = B.y - A.y;
    const dx = B.x - A.x;
    if (Math.abs(dy) < 1e-12) {
      if (Math.abs(A.y - y0) > 1e-9) return null;
      const minX = Math.min(A.x, B.x);
      const maxX = Math.max(A.x, B.x);
      const clampedX = Math.max(minX, Math.min(maxX, mouse.x));
      return { x: clampedX, y: y0 };
    }
    const t = (y0 - A.y) / dy;
    if (t < -1e-9 || t > 1 + 1e-9) return null;
    const xInt = A.x + t * dx;
    return { x: xInt, y: y0 };
  }
  const x0 = last.x;
  const dy = B.y - A.y;
  const dx = B.x - A.x;
  if (Math.abs(dx) < 1e-12) {
    if (Math.abs(A.x - x0) > 1e-9) return null;
    const minY = Math.min(A.y, B.y);
    const maxY = Math.max(A.y, B.y);
    const clampedY = Math.max(minY, Math.min(maxY, mouse.y));
    return { x: x0, y: clampedY };
  }
  const t = (x0 - A.x) / dx;
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  const yInt = A.y + t * dy;
  return { x: x0, y: yInt };
}

export const translateShapeToSnapFromCache = (
  element: Element,
  movedCoords: Array<{x: number, y: number, z: number}>,
  snapCache: GeometrySnapCache,
  getSnapTol: () => number
): { coords: Array<{x: number, y: number, z: number}>, snappedIndex: number|null } => {
  const tol = getSnapTol();
  const tolSq = tol * tol;

  let bestDx = 0;
  let bestDy = 0;
  let bestDistSq = Infinity;
  let bestIndex: number|null = null;

  for (let i = 0; i < movedCoords.length; i++) {
    const p = movedCoords[i];
    for (const target of getNearbySnapCornerTargets(snapCache, p, tol)) {
      if (target.elementId === element.id) continue;
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const dSq = dx * dx + dy * dy;
      if (dSq <= tolSq && dSq < bestDistSq) {
        bestDistSq = dSq;
        bestDx = dx;
        bestDy = dy;
        bestIndex = i;
      }
    }
  }

  if (bestDistSq !== Infinity) {
    return { coords: movedCoords.map(c => ({ x: c.x + bestDx, y: c.y + bestDy, z: c.z })), snappedIndex: bestIndex };
  }
  return { coords: movedCoords, snappedIndex: null };
};

export const snapCornerToOtherCorners = (
  point: {x:number,y:number},
  selfElementId: string,
  elementsById: Record<string, Element>,
  tol: number
) => {
  let best: {x:number,y:number}|null = null;
  let bestD = Infinity;
  for (const otherId of Object.keys(elementsById)) {
    if (otherId === selfElementId) continue;
    const oc = elementsById[otherId].coordinates || [];
    for (let k=0;k<oc.length;k++) {
      const d = Math.hypot(oc[k].x - point.x, oc[k].y - point.y);
      if (d < bestD && d <= tol) { bestD = d; best = { x: oc[k].x, y: oc[k].y }; }
    }
  }
  return best as {x:number,y:number} | null;
};

export const snapCornerToOtherCornersFromCache = (
  point: {x:number,y:number},
  selfElementId: string,
  snapCache: GeometrySnapCache,
  tol: number,
  options?: { minDistance?: number },
) => {
  const minDistance = options?.minDistance ?? 0;
  const minDistanceSq = minDistance * minDistance;
  const tolSq = tol * tol;
  let best: {x:number,y:number}|null = null;
  let bestDSq = Infinity;
  let bestOrder = Infinity;
  for (const target of getNearbySnapCornerTargets(snapCache, point, tol)) {
    if (target.elementId === selfElementId) continue;
    const dx = target.x - point.x;
    const dy = target.y - point.y;
    const dSq = dx * dx + dy * dy;
    if (dSq < minDistanceSq || dSq > tolSq) continue;
    if (dSq < bestDSq || (dSq === bestDSq && target.order < bestOrder)) {
      bestDSq = dSq;
      bestOrder = target.order;
      best = { x: target.x, y: target.y };
    }
  }
  return best as {x:number,y:number} | null;
};

export const applyAngleSnapIfClose = (
  moving: {x:number,y:number},
  fixed: {x:number,y:number},
  angleTolDeg: number
) => {
  const dx = moving.x - fixed.x; const dy = moving.y - fixed.y;
  const len = Math.hypot(dx, dy) || 0;
  if (len <= 0) return { point: moving, snapped: false } as const;
  const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  // Use absolute world cardinals (0, 90, 180, 270)
  const cardinals = [0, 90, 180, 270];
  let nearest = cardinals[0]; let bestDiff = 999;
  for (const c of cardinals) {
    const diff = Math.min(Math.abs(deg-c), 360-Math.abs(deg-c));
    if (diff < bestDiff) { bestDiff = diff; nearest = c; }
  }
  if (bestDiff <= angleTolDeg) {
    const rad = nearest * Math.PI / 180;
    return { point: { x: fixed.x + len * Math.cos(rad), y: fixed.y + len * Math.sin(rad) }, snapped: true } as const;
  }
  return { point: moving, snapped: false } as const;
};

export const constrainPointOrthogonally = (
  moving: {x:number,y:number},
  fixed: {x:number,y:number},
) => {
  const dx = moving.x - fixed.x;
  const dy = moving.y - fixed.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { point: { x: moving.x, y: fixed.y }, snapped: true } as const;
  }
  return { point: { x: fixed.x, y: moving.y }, snapped: true } as const;
};

export const projectSegmentOntoParent = (
  childCoords: Array<{x:number,y:number,z:number}>,
  parentCoords: Array<{x:number,y:number,z:number}>
) => {
  if (childCoords.length !== 2 || parentCoords.length !== 2) return childCoords;
  const [CA, CB] = childCoords; const [PA, PB] = parentCoords;
  const cx = (CA.x + CB.x) / 2; const cy = (CA.y + CB.y) / 2;
  const length = Math.hypot(CB.x - CA.x, CB.y - CA.y) || 0.01;
  const vx = PB.x - PA.x; const vy = PB.y - PA.y;
  const vlen = Math.hypot(vx, vy) || 1; const ux = vx / vlen; const uy = vy / vlen;
  const tRaw = ((cx - PA.x) * vx + (cy - PA.y) * vy) / (vlen * vlen);
  const t = Math.min(1, Math.max(0, tRaw));
  const px = PA.x + t * vx; const py = PA.y + t * vy;
  const half = length / 2;
  const A = { x: px - half * ux, y: py - half * uy, z: CA.z };
  const B = { x: px + half * ux, y: py + half * uy, z: CB.z };
  return [A, B];
};

type OpeningParentHit = {
  parentId: string;
  parentName: string;
  proj: { x: number; y: number };
  t: number;
};

type CachedWallProjectionOptions = {
  isCandidate?: (segment: SnapWallSegmentTarget) => boolean;
};

function isOpaqueLineWallParent(
  hit: OpeningParentHit | null,
  elementsById: Record<string, Element>,
): hit is OpeningParentHit {
  const parent = hit ? elementsById[hit.parentId] : undefined;
  return !!parent && parent.type === 'BuildingElementOpaque' && parent.coordinates?.length === 2;
}

function floorStoreyIndex(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
}

function isSameOpeningStorey(
  childCoords: Array<{x:number,y:number,z:number}>,
  parent: Element | undefined,
): boolean {
  const childStorey = floorStoreyIndex(childCoords[0]?.z);
  const parentStorey = floorStoreyIndex(parent?.coordinates?.[0]?.z);
  return childStorey === null || parentStorey === null || childStorey === parentStorey;
}

function isOpeningParentCandidate(
  segment: SnapWallSegmentTarget,
  childCoords: Array<{x:number,y:number,z:number}>,
  elementsById: Record<string, Element>,
): boolean {
  const parent = elementsById[segment.elementId];
  return !!parent &&
    parent.type === 'BuildingElementOpaque' &&
    parent.coordinates?.length === 2 &&
    isSameOpeningStorey(childCoords, parent);
}

export const resolveOpeningSegmentParentFromCache = (
  childCoords: Array<{x:number,y:number,z:number}>,
  snapCache: GeometrySnapCache,
  elementsById: Record<string, Element>,
  excludeElementId: string,
  tolerance: number,
): { parentId: string; parentName: string; coordinates: Array<{x:number,y:number,z:number}> } | null => {
  if (childCoords.length !== 2) return null;
  const [A, B] = childCoords;
  const midpoint = {
    x: (A.x + B.x) / 2,
    y: (A.y + B.y) / 2,
  };
  const projectionOptions = {
    isCandidate: (segment: SnapWallSegmentTarget) => isOpeningParentCandidate(segment, childCoords, elementsById),
  };

  const midpointHit = findNearestWallProjectionFromCache(midpoint, snapCache, excludeElementId, tolerance, projectionOptions);
  const startHit = findNearestWallProjectionFromCache(A, snapCache, excludeElementId, tolerance, projectionOptions);
  const endHit = findNearestWallProjectionFromCache(B, snapCache, excludeElementId, tolerance, projectionOptions);

  let chosen: OpeningParentHit | null = null;
  if (isOpaqueLineWallParent(midpointHit, elementsById)) {
    chosen = midpointHit;
  } else if (
    isOpaqueLineWallParent(startHit, elementsById) &&
    isOpaqueLineWallParent(endHit, elementsById) &&
    startHit.parentId === endHit.parentId
  ) {
    chosen = startHit;
  }

  if (!chosen) return null;
  const parent = elementsById[chosen.parentId];
  const parentCoords = parent?.coordinates;
  if (!parentCoords || parentCoords.length !== 2) return null;

  return {
    parentId: chosen.parentId,
    parentName: chosen.parentName,
    coordinates: projectSegmentOntoParent(childCoords, parentCoords),
  };
};

export const findNearestWallProjection = (
  point: {x:number,y:number},
  elementsById: Record<string, Element>,
  excludeElementId: string,
  tolerance: number
): { parentId: string, parentName: string, proj: {x:number,y:number}, t: number } | null => {
  let best: any = null;
  let bestD = Infinity;
  for (const id of Object.keys(elementsById)) {
    if (id === excludeElementId) continue;
    const el = elementsById[id];
    if (!isLineWallElementForSnap(el)) continue;
    const cc = el!.coordinates || [];
    if (cc.length === 2) {
      const [A,B] = cc as any;
      const vx = B.x - A.x; const vy = B.y - A.y;
      const v2 = vx*vx + vy*vy; if (v2 === 0) continue;
      const tRaw = ((point.x - A.x)*vx + (point.y - A.y)*vy) / v2;
      const t = Math.max(0, Math.min(1, tRaw));
      const px = A.x + t*vx; const py = A.y + t*vy;
      const d = Math.hypot(point.x - px, point.y - py);
      if (d <= tolerance && d < bestD) {
        bestD = d;
        best = { parentId: id, parentName: (el as any).name || '', proj: { x: px, y: py }, t };
      }
    }
  }
  return best;
};

export const findNearestWallProjectionFromCache = (
  point: {x:number,y:number},
  snapCache: GeometrySnapCache,
  excludeElementId: string,
  tolerance: number,
  options?: CachedWallProjectionOptions,
): { parentId: string, parentName: string, proj: {x:number,y:number}, t: number } | null => {
  let best: { parentId: string, parentName: string, proj: {x:number,y:number}, t: number, order: number } | null = null;
  let bestDSq = Infinity;
  const toleranceSq = tolerance * tolerance;
  for (const segment of getNearbySnapWallSegments(snapCache, point, tolerance)) {
    if (segment.elementId === excludeElementId) continue;
    if (options?.isCandidate && !options.isCandidate(segment)) continue;
    const { A, B } = segment;
    const vx = B.x - A.x; const vy = B.y - A.y;
    const v2 = vx*vx + vy*vy; if (v2 === 0) continue;
    const tRaw = ((point.x - A.x)*vx + (point.y - A.y)*vy) / v2;
    const t = Math.max(0, Math.min(1, tRaw));
    const px = A.x + t*vx; const py = A.y + t*vy;
    const dx = point.x - px;
    const dy = point.y - py;
    const dSq = dx * dx + dy * dy;
    if (dSq <= toleranceSq && (dSq < bestDSq || (dSq === bestDSq && segment.order < (best?.order ?? Infinity)))) {
      bestDSq = dSq;
      best = {
        parentId: segment.elementId,
        parentName: segment.elementName,
        proj: { x: px, y: py },
        t,
        order: segment.order,
      };
    }
  }
  return best ? { parentId: best.parentId, parentName: best.parentName, proj: best.proj, t: best.t } : null;
};

// Closest point on each candidate wall segment to fixedPoint (clamped to segment); picks the hit
// nearest to the mouse (same preference order as draw snap “perpendicular” edge snap).
export const findPerpendicularFootOnWallInfinite = (
  fixedPoint: {x:number,y:number},
  mouseWorld: {x:number,y:number},
  elementsById: Record<string, Element>,
  excludeElementId: string,
  tolerance: number
): { parentId: string, parentName: string, foot: {x:number,y:number} } | null => {
  let best: { parentId: string, parentName: string, foot: {x:number,y:number} } | null = null;
  let bestMouseDist = Infinity;
  forEachWallSegmentXY(elementsById, excludeElementId, ({ id, el, A, B }) => {
    const foot = projectPointOntoSegmentXY(fixedPoint, A, B);
    const mouseD = Math.hypot(mouseWorld.x - foot.x, mouseWorld.y - foot.y);
    if (mouseD <= tolerance && mouseD < bestMouseDist) {
      bestMouseDist = mouseD;
      best = { parentId: id, parentName: (el as any).name || '', foot };
    }
  });
  return best;
};

export const findPerpendicularFootOnWallInfiniteFromCache = (
  fixedPoint: {x:number,y:number},
  mouseWorld: {x:number,y:number},
  snapCache: GeometrySnapCache,
  excludeElementId: string,
  tolerance: number
): { parentId: string, parentName: string, foot: {x:number,y:number} } | null => {
  let best: { parentId: string, parentName: string, foot: {x:number,y:number}, order: number } | null = null;
  let bestMouseDistSq = Infinity;
  const toleranceSq = tolerance * tolerance;
  for (const { elementId, elementName, order, A, B } of getNearbySnapWallSegments(snapCache, mouseWorld, tolerance)) {
    if (elementId === excludeElementId) continue;
    const foot = projectPointOntoSegmentXY(fixedPoint, A, B);
    const mouseDSq = distanceSq(mouseWorld, foot);
    if (
      mouseDSq <= toleranceSq &&
      (mouseDSq < bestMouseDistSq || (mouseDSq === bestMouseDistSq && order < (best?.order ?? Infinity)))
    ) {
      bestMouseDistSq = mouseDSq;
      best = { parentId: elementId, parentName: elementName, foot, order };
    }
  }
  return best ? { parentId: best.parentId, parentName: best.parentName, foot: best.foot } : null;
};

export type DrawSnapResult = {
  point: { x: number; y: number };
  /** Vertex snap, perpendicular foot on segment, or general edge projection */
  geometrySnap: boolean;
  /** Cardinal angle snap (non-orthogonal path only; see applyAngleSnapIfClose) */
  cardinalSnap: boolean;
  /** Shift-held orthogonal axis lock from last point */
  orthogonalAxisLock: boolean;
};

function resolveOrthogonalDrawSnap(params: {
  mouseWorld: { x: number; y: number };
  lastPoint: { x: number; y: number };
  elementsById: Record<string, Element>;
  snapCache?: GeometrySnapCache;
  excludeElementId: string;
  snapTol: number;
}): DrawSnapResult {
  const { mouseWorld, lastPoint, elementsById, snapCache, excludeElementId, snapTol } = params;
  const orthoPoint = constrainPointOrthogonally(mouseWorld, lastPoint).point;
  const rayEps = Math.max(1e-9, snapTol * 1e-5);
  const snapTolSq = snapTol * snapTol;

  type Hit = { p: { x: number; y: number }; dSq: number };

  const maybeBetter = (prev: Hit | null, p: { x: number; y: number }): Hit | null => {
    const dSq = distanceSq(p, mouseWorld);
    if (dSq <= snapTolSq && (!prev || dSq < prev.dSq)) return { p, dSq };
    return prev;
  };

  // Tier 1: corners on orthogonal ray
  let hit1: Hit | null = null;
  if (snapCache) {
    for (const v of getNearbySnapCornerTargets(snapCache, mouseWorld, snapTol)) {
      if (v.elementId === excludeElementId) continue;
      if (!pointOnOrthogonalRayForDraw(lastPoint, mouseWorld, v, rayEps)) continue;
      hit1 = maybeBetter(hit1, { x: v.x, y: v.y });
    }
  } else {
    for (const id of Object.keys(elementsById)) {
      if (id === excludeElementId) continue;
      const el = elementsById[id];
      const oc = el?.coordinates || [];
      for (let k = 0; k < oc.length; k++) {
        const v = oc[k];
        if (!pointOnOrthogonalRayForDraw(lastPoint, mouseWorld, v, rayEps)) continue;
        hit1 = maybeBetter(hit1, { x: v.x, y: v.y });
      }
    }
  }
  if (hit1 !== null) {
    return {
      point: hit1.p,
      geometrySnap: true,
      cardinalSnap: false,
      orthogonalAxisLock: true,
    };
  }

  // Tier 2: perpendicular feet (closest point on segment to lastPoint) that lie on the ray
  let hit2: Hit | null = null;
  const collectTier2 = ({ A, B }: { A: { x: number; y: number }; B: { x: number; y: number } }) => {
    const foot = projectPointOntoSegmentXY(lastPoint, A, B);
    if (!pointOnOrthogonalRayForDraw(lastPoint, mouseWorld, foot, rayEps)) return;
    hit2 = maybeBetter(hit2, foot);
  };
  if (snapCache) {
    forEachCachedWallSegmentXY(snapCache, excludeElementId, collectTier2, mouseWorld, snapTol);
  } else {
    forEachWallSegmentXY(elementsById, excludeElementId, collectTier2);
  }
  const resolvedHit2 = hit2 as Hit | null;
  if (resolvedHit2 !== null) {
    return {
      point: resolvedHit2.p,
      geometrySnap: true,
      cardinalSnap: false,
      orthogonalAxisLock: true,
    };
  }

  // Tier 3: intersection of orthogonal ray with wall segments
  let hit3: Hit | null = null;
  const collectTier3 = ({ A, B }: { A: { x: number; y: number }; B: { x: number; y: number } }) => {
    const hit = intersectOrthogonalRayWithSegment(lastPoint, mouseWorld, A, B);
    if (hit) hit3 = maybeBetter(hit3, hit);
  };
  if (snapCache) {
    forEachCachedWallSegmentXY(snapCache, excludeElementId, collectTier3, mouseWorld, snapTol);
  } else {
    forEachWallSegmentXY(elementsById, excludeElementId, collectTier3);
  }
  const resolvedHit3 = hit3 as Hit | null;
  if (resolvedHit3 !== null) {
    return {
      point: resolvedHit3.p,
      geometrySnap: true,
      cardinalSnap: false,
      orthogonalAxisLock: true,
    };
  }

  return {
    point: orthoPoint,
    geometrySnap: false,
    cardinalSnap: false,
    orthogonalAxisLock: true,
  };
}

/**
 * Unified plan snap for line / polygon / room drawing: corners beat edges; perpendicular foot on
 * segment beats general edge glide; orthogonal mode snaps only to targets on the axis-aligned ray.
 */
export function resolveDrawSnapPoint(params: {
  mouseWorld: { x: number; y: number };
  lastPoint: { x: number; y: number } | null;
  elementsById: Record<string, Element>;
  snapCache?: GeometrySnapCache;
  excludeElementId: string;
  snapTol: number;
  orthogonalModifierHeld: boolean;
  angleTolDeg: number;
}): DrawSnapResult {
  const {
    mouseWorld,
    lastPoint,
    elementsById,
    snapCache,
    excludeElementId,
    snapTol,
    orthogonalModifierHeld,
    angleTolDeg,
  } = params;

  if (!lastPoint) {
    const corner = snapCache
      ? snapCornerToOtherCornersFromCache(mouseWorld, excludeElementId, snapCache, snapTol)
      : snapCornerToOtherCorners(mouseWorld, excludeElementId, elementsById, snapTol);
    if (corner) {
      return {
        point: corner,
        geometrySnap: true,
        cardinalSnap: false,
        orthogonalAxisLock: false,
      };
    }
    const edge = snapCache
      ? findNearestWallProjectionFromCache(mouseWorld, snapCache, excludeElementId, snapTol)
      : findNearestWallProjection(mouseWorld, elementsById, excludeElementId, snapTol);
    if (edge) {
      return {
        point: edge.proj,
        geometrySnap: true,
        cardinalSnap: false,
        orthogonalAxisLock: false,
      };
    }
    return {
      point: mouseWorld,
      geometrySnap: false,
      cardinalSnap: false,
      orthogonalAxisLock: false,
    };
  }

  if (orthogonalModifierHeld) {
    return resolveOrthogonalDrawSnap({
      mouseWorld,
      lastPoint,
      elementsById,
      snapCache,
      excludeElementId,
      snapTol,
    });
  }

  const corner = snapCache
    ? snapCornerToOtherCornersFromCache(mouseWorld, excludeElementId, snapCache, snapTol)
    : snapCornerToOtherCorners(mouseWorld, excludeElementId, elementsById, snapTol);
  if (corner) {
    return {
      point: corner,
      geometrySnap: true,
      cardinalSnap: false,
      orthogonalAxisLock: false,
    };
  }

  const perp = snapCache
    ? findPerpendicularFootOnWallInfiniteFromCache(
        lastPoint,
        mouseWorld,
        snapCache,
        excludeElementId,
        snapTol,
      )
    : findPerpendicularFootOnWallInfinite(
        lastPoint,
        mouseWorld,
        elementsById,
        excludeElementId,
        snapTol,
      );
  if (perp) {
    return {
      point: perp.foot,
      geometrySnap: true,
      cardinalSnap: false,
      orthogonalAxisLock: false,
    };
  }

  const edge = snapCache
    ? findNearestWallProjectionFromCache(mouseWorld, snapCache, excludeElementId, snapTol)
    : findNearestWallProjection(mouseWorld, elementsById, excludeElementId, snapTol);
  if (edge) {
    return {
      point: edge.proj,
      geometrySnap: true,
      cardinalSnap: false,
      orthogonalAxisLock: false,
    };
  }

  const res = applyAngleSnapIfClose(mouseWorld, lastPoint, angleTolDeg);
  return {
    point: res.point,
    geometrySnap: false,
    cardinalSnap: res.snapped,
    orthogonalAxisLock: false,
  };
}

export const findClosestPointOnPolygon = (
  mouseWorld: {x: number, y: number},
  coordinates: Array<{x: number, y: number, z: number}>
): {x: number, y: number, insertIndex: number} | null => {
  if (coordinates.length < 3) return null;

  let closestDistance = Infinity;
  let closestPoint: {x:number,y:number}|null = null;
  let insertIndex = 0;

  for (let i = 0; i < coordinates.length; i++) {
    const current = coordinates[i];
    const next = coordinates[(i + 1) % coordinates.length];

    const edgeLength = Math.hypot(next.x - current.x, next.y - current.y);
    if (edgeLength === 0) continue;

    const t = Math.max(0, Math.min(1,
      ((mouseWorld.x - current.x) * (next.x - current.x) +
       (mouseWorld.y - current.y) * (next.y - current.y)) / (edgeLength * edgeLength)
    ));

    const projectedX = current.x + t * (next.x - current.x);
    const projectedY = current.y + t * (next.y - current.y);

    const distance = Math.hypot(mouseWorld.x - projectedX, mouseWorld.y - projectedY);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestPoint = { x: projectedX, y: projectedY };
      insertIndex = i + 1;
    }
  }

  return closestPoint ? { ...closestPoint, insertIndex } : null;
};

export type GetExactSnappedVerticesOptions = {
  /**
   * When considering another element as a "snap" partner, skip these types.
   * Used e.g. for wall endpoint styling so a wall does not get persistent blue
   * snap markers purely because a window's endpoint shares coordinates on the line.
   */
  skipVertexMatchFromOtherTypes?: string[];
};

// Helper to detect which vertices of an element are exactly snapped to other elements (for persistent indicators)
export const getExactSnappedVertices = (
  element: Element,
  elementsById: Record<string, Element>,
  options?: GetExactSnappedVerticesOptions,
): Set<number> => {
  const snappedVertices = new Set<number>();
  const skipTypes = options?.skipVertexMatchFromOtherTypes;

  if (!element.coordinates) return snappedVertices;

  element.coordinates.forEach((coord, index) => {
    // Early exit: if this vertex is already snapped, skip further checks
    if (snappedVertices.has(index)) return;

    for (const otherId of Object.keys(elementsById)) {
      if (otherId === element.id) continue; // Skip self
      const other = elementsById[otherId];
      if (skipTypes?.length && other.type && skipTypes.includes(String(other.type))) {
        continue;
      }
      if (!other.coordinates) continue;

      for (const otherCoord of other.coordinates) {
        // Exact plan matching; building elements use same-storey Z because canvas snapping is 2D.
        if (isSamePlanSnapVertex(element, coord, other, otherCoord)) {
          snappedVertices.add(index);
          break; // Early exit: found an exact match
        }
      }
    }
  });

  return snappedVertices;
};

export type GetWallSupportedSnappedVerticesOptions = GetExactSnappedVerticesOptions & {
  /**
   * Persisted-geometry tolerance for treating a polygon vertex as lying on a wall segment.
   * This is intentionally tighter than the live drag/draw snap tolerance.
   */
  wallSegmentTolerance?: number;
};

const DEFAULT_WALL_SUPPORTED_VERTEX_TOLERANCE_M = 0.01;

// Polygon guidance can be satisfied by a vertex landing on a same-storey wall segment,
// even when it is not exactly on another element corner.
export const getWallSupportedSnappedVertices = (
  element: Element,
  elementsById: Record<string, Element>,
  options?: GetWallSupportedSnappedVerticesOptions,
): Set<number> => {
  const supportedVertices = getExactSnappedVertices(element, elementsById, options);
  if (!element.coordinates || !isBuildingElementForPlanSnap(element)) return supportedVertices;

  const skipTypes = options?.skipVertexMatchFromOtherTypes;
  const tolerance = options?.wallSegmentTolerance ?? DEFAULT_WALL_SUPPORTED_VERTEX_TOLERANCE_M;
  const toleranceSq = tolerance * tolerance;

  element.coordinates.forEach((coord, index) => {
    if (supportedVertices.has(index)) return;

    for (const otherId of Object.keys(elementsById)) {
      if (otherId === element.id) continue;
      const other = elementsById[otherId];
      if (!other || !isBuildingElementForPlanSnap(other)) continue;
      if (skipTypes?.length && other.type && skipTypes.includes(String(other.type))) continue;
      if (!isLineWallElementForSnap(other) || other.coordinates?.length !== 2) continue;

      const [A, B] = other.coordinates;
      if (
        !isSamePlanSnapFloor(element, coord.z, other, A.z) ||
        !isSamePlanSnapFloor(element, coord.z, other, B.z)
      ) {
        continue;
      }

      if (pointToSegmentDistanceSqXY(coord, A, B) <= toleranceSq) {
        supportedVertices.add(index);
        break;
      }
    }
  });

  return supportedVertices;
};

// Helper to calculate angle between two line segments sharing a vertex
export const calculateAngleBetweenSegments = (
  element1: Element,
  element2: Element,
  vertexIndex: number
): number => {
  if (!element1.coordinates || !element2.coordinates) return 0;

  // Get the shared vertex
  const sharedVertex = element1.coordinates[vertexIndex];

  // Find the other vertex in element1
  const otherVertex1 = element1.coordinates[vertexIndex === 0 ? 1 : 0];

  // Find the other vertex in element2 (the one that's not the shared vertex)
  let otherVertex2 = null;
  for (let i = 0; i < element2.coordinates.length; i++) {
    const coord = element2.coordinates[i];
    if (coord.x === sharedVertex.x && coord.y === sharedVertex.y && coord.z === sharedVertex.z) {
      // This is the shared vertex, get the other one
      otherVertex2 = element2.coordinates[i === 0 ? 1 : 0];
      break;
    }
  }

  if (!otherVertex1 || !otherVertex2) return 0;

  // Calculate vectors from shared vertex
  const vec1 = {
    x: otherVertex1.x - sharedVertex.x,
    y: otherVertex1.y - sharedVertex.y
  };
  const vec2 = {
    x: otherVertex2.x - sharedVertex.x,
    y: otherVertex2.y - sharedVertex.y
  };

  // Calculate angle between vectors
  const dot = vec1.x * vec2.x + vec1.y * vec2.y;
  const mag1 = Math.sqrt(vec1.x * vec1.x + vec1.y * vec1.y);
  const mag2 = Math.sqrt(vec2.x * vec2.x + vec2.y * vec2.y);

  if (mag1 === 0 || mag2 === 0) return 0;

  const cosAngle = dot / (mag1 * mag2);
  const angleRad = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
  const angleDeg = angleRad * 180 / Math.PI;

  return angleDeg;
};

// Helper to find connected elements at a specific vertex
export const findConnectedElementsAtVertex = (
  element: Element,
  vertexIndex: number,
  elementsById: Record<string, Element>
): Element[] => {
  const connectedElements: Element[] = [];

  if (!element.coordinates) return connectedElements;

  const vertex = element.coordinates[vertexIndex];

  for (const otherId of Object.keys(elementsById)) {
    if (otherId === element.id) continue; // Skip self
    const other = elementsById[otherId];
    if (!other.coordinates) continue;

    // Check if any vertex of the other element matches this vertex
    for (const otherCoord of other.coordinates) {
      if (vertex.x === otherCoord.x && vertex.y === otherCoord.y && vertex.z === otherCoord.z) {
        connectedElements.push(other);
        break; // Found connection, move to next element
      }
    }
  }

  return connectedElements;
};

// Helper to check if all connections at a vertex are 90 degrees
export const isAll90DegreeConnections = (
  element: Element,
  vertexIndex: number,
  elementsById: Record<string, Element>,
  angleToleranceDeg: number
): boolean => {
  const connectedElements = findConnectedElementsAtVertex(element, vertexIndex, elementsById);

  if (connectedElements.length === 0) return false;

  // All connections must be 90°
  for (const connected of connectedElements) {
    const angle = calculateAngleBetweenSegments(element, connected, vertexIndex);

    if (Math.abs(angle - 90) > angleToleranceDeg) {
      return false; // Found non-90° connection
    }
  }

  return true; // All connections are 90°
};

export const findBestSnapPositionFromCache = (
  element: Element,
  newCoords: Array<{x: number, y: number, z: number}>,
  snapCache: GeometrySnapCache,
  snapTol: number
): Array<{x: number, y: number, z: number}> => {
  const finalCoords = [...newCoords];

  newCoords.forEach((coord, index) => {
    let closestSnap: {x: number, y: number, z?: number} | null = null;
    let closestDist = snapTol;

    for (const target of snapCache.cornerTargets) {
      if (target.elementId === element.id) continue;
      const dist = Math.hypot(coord.x - target.x, coord.y - target.y);
      if (dist < closestDist) {
        closestDist = dist;
        closestSnap = { x: target.x, y: target.y, z: target.z };
      }
    }

    if (closestSnap !== null) {
      finalCoords[index] = { x: closestSnap.x, y: closestSnap.y, z: coord.z };
    }
  });

  return finalCoords;
};
