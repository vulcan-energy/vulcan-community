// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Floor } from '../geometry/types';
import { isStoreyIndexPoint, networkPoint3, normalizeStoreyIndex, physicalZUsesFloorId } from './elementCanvasFloor';
import type { SnapEvent } from './snapEvent';
import { roundToTwoDecimals } from '../geometry/constants';

/** Two-point “wall line” types that participate in mutual segment snapping while drawing. */
export const LINE_WALL_SNAP_TYPES: ReadonlySet<string> = new Set<string>([
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
  sourceVertexOrder: number;
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
  /** Edge glide only, never a perpendicular-foot target (duct and pipe network segments). */
  edgeOnly?: boolean;
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

type ConnectivityElement = { type?: unknown } | undefined;
type ConnectivityPoint = { x: number; y: number; z?: unknown };

function isBuildingElement(element: ConnectivityElement): boolean {
  return typeof element?.type === 'string' && element.type.startsWith('BuildingElement');
}

/** Half the 0.01 m grid service-line ends are rounded to: absorbs that rounding, invisible on screen. */
export const SERVICE_POINT_COINCIDENCE_EPS_M = 0.005;

/** Same canvas storey: building elements snap in plan, so their z only has to share a storey. */
function sameStorey(aZ: unknown, bZ: unknown): boolean {
  const aStorey = normalizeStoreyIndex(aZ);
  return aStorey !== undefined && aStorey === normalizeStoreyIndex(bZ);
}

function withinServiceEps(u: unknown, v: unknown): boolean {
  return u === v || (typeof u === 'number' && typeof v === 'number' && Math.abs(u - v) <= SERVICE_POINT_COINCIDENCE_EPS_M);
}

/**
 * The one rule for "these two element vertices are the same point". Building-element pairs: exact
 * x, y on the same storey. Mixed pairs: exact x, y, z. Pairs with no building element (ducts,
 * pipes, plant and terminal points): within SERVICE_POINT_COINCIDENCE_EPS_M on each axis.
 */
export function pointsConnected(
  a: ConnectivityElement,
  aPoint: ConnectivityPoint,
  b: ConnectivityElement,
  bPoint: ConnectivityPoint,
): boolean {
  // Cheap reject first (also rejects NaN): this runs per vertex pair on every canvas pass.
  if (!(Math.abs(aPoint.x - bPoint.x) <= SERVICE_POINT_COINCIDENCE_EPS_M)) return false;
  if (!(Math.abs(aPoint.y - bPoint.y) <= SERVICE_POINT_COINCIDENCE_EPS_M)) return false;
  const aBuilding = isBuildingElement(a);
  const bBuilding = isBuildingElement(b);
  if (!aBuilding && !bBuilding) return withinServiceEps(aPoint.z, bPoint.z);
  if (aPoint.x !== bPoint.x || aPoint.y !== bPoint.y) return false;
  return aBuilding && bBuilding ? sameStorey(aPoint.z, bPoint.z) : aPoint.z === bPoint.z;
}

type WeldPoint = { x: number; y: number; z: number };
type NetworkElement = Element & { duct_type?: string; terminal_type?: string; pipework_type?: string; parent_element?: string | null };
export type ServiceLineWeld = { elementId: string; vertexIndex: number; newPosition: WeldPoint };

function distance(a: WeldPoint, b: WeldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Fixed points a duct's ends may weld to, in metres: its MVHR unit and same-role terminals. */
function ductPointTargets(duct: NetworkElement, all: NetworkElement[], effectiveFloors: Floor[]): WeldPoint[] {
  if (!duct.parent_element) return [];
  return all
    .filter((el) =>
      el.coordinates?.length === 1 &&
      ((el.type === 'MechanicalVentilation' && el.name === duct.parent_element) ||
        (el.type === 'MechanicalVentilationTerminal' &&
          el.parent_element === duct.parent_element &&
          el.terminal_type === duct.duct_type)))
    .map((el) => networkPoint3(el, effectiveFloors))
    .filter((point): point is WeldPoint => !!point);
}

/** Plant a primary pipe ends on: a heat source or hot water source System point. */
export function isPrimaryPipeworkPlant(element: Pick<Element, 'type' | 'isPlaceholder' | 'coordinates'> & { subcategory?: unknown }): boolean {
  return element.type === 'System' && !element.isPlaceholder && element.coordinates?.length === 1 &&
    (element.subcategory === 'HeatSourceWet' || element.subcategory === 'HotWaterSource');
}

function isPrimaryPipe(pipe: { pipework_type?: string }): boolean {
  return (pipe.pipework_type ?? 'primary') === 'primary';
}

/** Fixed points a primary pipe's ends may weld to, in metres: heat source and hot water source plant. */
function pipePointTargets(pipe: NetworkElement, all: NetworkElement[], effectiveFloors: Floor[]): WeldPoint[] {
  if (!isPrimaryPipe(pipe)) return [];
  return all
    .filter(isPrimaryPipeworkPlant)
    .map((el) => networkPoint3(el, effectiveFloors))
    .filter((point): point is WeldPoint => !!point);
}

/**
 * Multi-select "Snap" for ducts and pipes: selected line ends within `tolerance` (3D) weld onto a
 * fixed network point when one is in reach, and onto each other otherwise (a cluster lands on its
 * first fixed point, else its first end in selection order). Ducts weld only within the same unit
 * and role, pipes only within the same pipework_type; primary pipes also weld to heat source and
 * hot water source plant. `effectiveFloors` (`withEffectiveStoreyHeights`) place units and plant in metres.
 */
export function planServiceLineEndpointWelds(
  elementsById: Record<string, Element>,
  elementIds: string[],
  tolerance: number,
  effectiveFloors: Floor[],
): ServiceLineWeld[] {
  const all = Object.values(elementsById) as NetworkElement[];
  const ends: Array<{ elementId: string; vertexIndex: number; network: string; original: WeldPoint; point: WeldPoint; fixed: boolean }> = [];
  for (const id of elementIds) {
    const line = elementsById[id] as NetworkElement | undefined;
    if (!line || (line.type !== 'MechanicalVentilationDuctwork' && line.type !== 'WaterPipework')) continue;
    if (line.coordinates?.length !== 2) continue;
    const network = line.type === 'WaterPipework'
      ? `pipe:${line.pipework_type ?? ''}`
      : `duct:${line.parent_element ?? ''}:${line.duct_type}`;
    const targets = line.type === 'WaterPipework' ? pipePointTargets(line, all, effectiveFloors) : ductPointTargets(line, all, effectiveFloors);
    line.coordinates.forEach((original, vertexIndex) => {
      let nearest: WeldPoint | undefined;
      for (const target of targets) {
        if (distance(original, target) <= tolerance && (!nearest || distance(original, target) < distance(original, nearest))) {
          nearest = target;
        }
      }
      ends.push({ elementId: id, vertexIndex, network, original, point: nearest ?? original, fixed: !!nearest });
    });
  }

  // Single-linkage clusters of ends within tolerance of each other; a fixed end keeps its own
  // target, the rest land on the cluster's first fixed point, else its first end.
  const root = ends.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      const a = ends[i]!;
      const b = ends[j]!;
      if (a.elementId !== b.elementId && a.network === b.network && distance(a.original, b.original) <= tolerance) {
        root[find(j)] = find(i);
      }
    }
  }
  const clusterPoint = new Map<number, WeldPoint>();
  ends.forEach((end, i) => {
    if (end.fixed && !clusterPoint.has(find(i))) clusterPoint.set(find(i), end.point);
  });
  ends.forEach((end, i) => {
    if (!clusterPoint.has(find(i))) clusterPoint.set(find(i), end.point);
  });
  const finalPoints = ends.map((end, i) => (end.fixed ? end.point : clusterPoint.get(find(i))!));

  const welds: ServiceLineWeld[] = [];
  for (let i = 0; i < ends.length; i += 2) {
    const [start, end] = [finalPoints[i]!, finalPoints[i + 1]!];
    if (pointsConnected(undefined, start, undefined, end)) continue; // would collapse the line
    for (const k of [i, i + 1]) {
      const { elementId, vertexIndex, original } = ends[k]!;
      if (!pointsConnected(undefined, original, undefined, finalPoints[k]!)) {
        welds.push({ elementId, vertexIndex, newPosition: { ...finalPoints[k]! } });
      }
    }
  }
  return welds;
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

export type ClosestSnapCorner = {
  x: number;
  y: number;
  elementId: string;
  order: number;
  sourceVertexOrder: number;
};

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
      best = {
        x: target.x,
        y: target.y,
        elementId: target.elementId,
        order: target.order,
        sourceVertexOrder: target.sourceVertexOrder,
        distSq,
      };
    }
  }

  return best;
}

/** `isExtraEdge` adds more two-point edge targets beside line walls (a duct or pipe network while drawing one). */
export function buildGeometrySnapCache(
  elementsById: Record<string, Element>,
  isExtraEdge?: (el: Element) => boolean,
): GeometrySnapCache {
  const cornerTargets: SnapCornerTarget[] = [];
  const wallSegments: SnapWallSegmentTarget[] = [];
  let cornerOrder = 0;
  let wallOrder = 0;

  for (const id of Object.keys(elementsById)) {
    const el = elementsById[id];
    const coords = el?.coordinates || [];
    for (let sourceVertexOrder = 0; sourceVertexOrder < coords.length; sourceVertexOrder++) {
      const coord = coords[sourceVertexOrder]!;
      cornerTargets.push({
        elementId: id,
        order: cornerOrder++,
        sourceVertexOrder,
        x: coord.x,
        y: coord.y,
        z: coord.z,
      });
    }

    const edgeOnly = !isLineWallElementForSnap(el);
    if ((edgeOnly && !(el && isExtraEdge?.(el))) || coords.length !== 2) continue;
    wallSegments.push({
      elementId: id,
      elementName: (el as any).name || '',
      order: wallOrder++,
      A: coords[0],
      B: coords[1],
      ...(edgeOnly ? { edgeOnly } : {}),
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
  let best: {x:number,y:number,elementId:string,order:number,sourceVertexOrder:number}|null = null;
  let bestD = Infinity;
  for (const otherId of Object.keys(elementsById)) {
    if (otherId === selfElementId) continue;
    const oc = elementsById[otherId].coordinates || [];
    for (let k=0;k<oc.length;k++) {
      const d = Math.hypot(oc[k].x - point.x, oc[k].y - point.y);
      if (d < bestD && d <= tol) {
        bestD = d;
        best = { x: oc[k].x, y: oc[k].y, elementId: otherId, order: k, sourceVertexOrder: k };
      }
    }
  }
  return best;
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
  let best: {x:number,y:number,elementId:string,order:number,sourceVertexOrder:number}|null = null;
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
      best = {
        x: target.x,
        y: target.y,
        elementId: target.elementId,
        order: target.order,
        sourceVertexOrder: target.sourceVertexOrder,
      };
    }
  }
  return best;
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
    return {
      point: { x: fixed.x + len * Math.cos(rad), y: fixed.y + len * Math.sin(rad) },
      snapped: true,
      cardinal: nearest,
    } as const;
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
  for (const { elementId, elementName, order, A, B, edgeOnly } of getNearbySnapWallSegments(snapCache, mouseWorld, tolerance)) {
    if (elementId === excludeElementId || edgeOnly) continue;
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
  snap?: SnapEvent;
};

/**
 * Where a draw click places a point: on the 0.01 m grid, like drawn duct and pipe ends, unless it
 * snapped to a target, which it never leaves.
 */
export function placedDrawPoint(snap: Pick<DrawSnapResult, 'point' | 'geometrySnap'>): { x: number; y: number } {
  return snap.geometrySnap
    ? snap.point
    : { x: roundToTwoDecimals(snap.point.x), y: roundToTwoDecimals(snap.point.y) };
}

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

  type Hit = {
    p: { x: number; y: number };
    dSq: number;
    sourceElementId?: string;
    sourceVertexOrder?: number;
  };

  const maybeBetter = (
    prev: Hit | null,
    p: { x: number; y: number },
    source?: Pick<Hit, 'sourceElementId' | 'sourceVertexOrder'>,
  ): Hit | null => {
    const dSq = distanceSq(p, mouseWorld);
    if (dSq <= snapTolSq && (!prev || dSq < prev.dSq)) return { p, dSq, ...source };
    return prev;
  };

  // Tier 1: corners on orthogonal ray
  let hit1: Hit | null = null;
  if (snapCache) {
    for (const v of getNearbySnapCornerTargets(snapCache, mouseWorld, snapTol)) {
      if (v.elementId === excludeElementId) continue;
      if (!pointOnOrthogonalRayForDraw(lastPoint, mouseWorld, v, rayEps)) continue;
      hit1 = maybeBetter(hit1, { x: v.x, y: v.y }, {
        sourceElementId: v.elementId,
        sourceVertexOrder: v.sourceVertexOrder,
      });
    }
  } else {
    for (const id of Object.keys(elementsById)) {
      if (id === excludeElementId) continue;
      const el = elementsById[id];
      const oc = el?.coordinates || [];
      for (let k = 0; k < oc.length; k++) {
        const v = oc[k];
        if (!pointOnOrthogonalRayForDraw(lastPoint, mouseWorld, v, rayEps)) continue;
        hit1 = maybeBetter(hit1, { x: v.x, y: v.y }, {
          sourceElementId: id,
          sourceVertexOrder: k,
        });
      }
    }
  }
  if (hit1 !== null) {
    return {
      point: hit1.p,
      geometrySnap: true,
      cardinalSnap: false,
      orthogonalAxisLock: true,
      snap: {
        kind: 'ortho-lock',
        sourceElementId: hit1.sourceElementId,
        sourceVertexOrder: hit1.sourceVertexOrder,
      },
    };
  }

  // Tier 2: perpendicular feet (closest point on segment to lastPoint) that lie on the ray
  let hit2: Hit | null = null;
  const collectTier2 = ({
    A,
    B,
    id,
    elementId,
    edgeOnly,
  }: {
    A: { x: number; y: number };
    B: { x: number; y: number };
    id?: string;
    elementId?: string;
    edgeOnly?: boolean;
  }) => {
    if (edgeOnly) return;
    const foot = projectPointOntoSegmentXY(lastPoint, A, B);
    if (!pointOnOrthogonalRayForDraw(lastPoint, mouseWorld, foot, rayEps)) return;
    hit2 = maybeBetter(hit2, foot, { sourceElementId: elementId ?? id });
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
      snap: { kind: 'ortho-lock', sourceElementId: resolvedHit2.sourceElementId },
    };
  }

  // Tier 3: intersection of orthogonal ray with wall segments
  let hit3: Hit | null = null;
  const collectTier3 = ({
    A,
    B,
    id,
    elementId,
  }: {
    A: { x: number; y: number };
    B: { x: number; y: number };
    id?: string;
    elementId?: string;
  }) => {
    const hit = intersectOrthogonalRayWithSegment(lastPoint, mouseWorld, A, B);
    if (hit) hit3 = maybeBetter(hit3, hit, { sourceElementId: elementId ?? id });
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
      snap: { kind: 'ortho-lock', sourceElementId: resolvedHit3.sourceElementId },
    };
  }

  return {
    point: orthoPoint,
    geometrySnap: false,
    cardinalSnap: false,
    orthogonalAxisLock: true,
    snap: { kind: 'ortho-lock' },
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
        point: { x: corner.x, y: corner.y },
        geometrySnap: true,
        cardinalSnap: false,
        orthogonalAxisLock: false,
        snap: {
          kind: 'corner',
          sourceElementId: corner.elementId,
          sourceVertexOrder: corner.sourceVertexOrder,
        },
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
        snap: { kind: 'parent-edge', sourceElementId: edge.parentId },
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
      point: { x: corner.x, y: corner.y },
      geometrySnap: true,
      cardinalSnap: false,
      orthogonalAxisLock: false,
      snap: {
        kind: 'corner',
        sourceElementId: corner.elementId,
        sourceVertexOrder: corner.sourceVertexOrder,
      },
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
      snap: { kind: 'perp-foot', sourceElementId: perp.parentId },
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
      snap: { kind: 'parent-edge', sourceElementId: edge.parentId },
    };
  }

  const res = applyAngleSnapIfClose(mouseWorld, lastPoint, angleTolDeg);
  return {
    point: res.point,
    geometrySnap: false,
    cardinalSnap: res.snapped,
    orthogonalAxisLock: false,
    snap: res.snapped ? { kind: 'cardinal', value: res.cardinal } : undefined,
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
  /**
   * Effective floors (`withEffectiveStoreyHeights`): a storey-index point (unit, plant) paired
   * with a metre-z element (duct, pipe, terminal) is compared at its storey's base height.
   * Without them both points are compared as stored.
   */
  effectiveFloors?: Floor[];
};

/**
 * Which partners can make a vertex "snapped". Building elements count only building elements (a
 * duct, pipe or TB end on a free wall end leaves it loose). Ducts and pipes count only their own
 * network: a duct with same-unit ducts and terminals and the unit's point, a pipe with other pipes
 * and, for a primary pipe, heat source and hot water source plant.
 * Undefined (any partner) for every other type, so TBs still count wall corners.
 */
export function snapPartnerFilter(element: Element): ((other: Element) => boolean) | undefined {
  if (isBuildingElement(element)) return isBuildingElement;
  if (element.type === 'WaterPipework') {
    const primary = isPrimaryPipe(element);
    return (other) => other.type === 'WaterPipework' || (primary && isPrimaryPipeworkPlant(other));
  }
  if (element.type !== 'MechanicalVentilationDuctwork') return undefined;
  const unit = element.parent_element?.trim();
  if (!unit) return () => false;
  return (other) =>
    ((other.type === 'MechanicalVentilationDuctwork' || other.type === 'MechanicalVentilationTerminal') &&
      other.parent_element?.trim() === unit) ||
    (other.type === 'MechanicalVentilation' && other.name?.trim() === unit);
}

type ServiceNetworkDraft = { type: string; duct_type?: unknown; parent_element?: unknown; pipework_type?: unknown };

/**
 * Segments a duct or pipe being drawn may branch from: ducts of the same unit and duct_type, pipes
 * of the same pipework_type. Undefined for every other type.
 */
export function serviceNetworkSegmentFilter(draft: ServiceNetworkDraft): ((el: Element) => boolean) | undefined {
  if (draft.type === 'WaterPipework') {
    return (el) => el.type === 'WaterPipework' && el.pipework_type === draft.pipework_type && el.coordinates?.length === 2;
  }
  if (draft.type !== 'MechanicalVentilationDuctwork') return undefined;
  const unit = typeof draft.parent_element === 'string' ? draft.parent_element.trim() : '';
  if (!unit) return undefined;
  return (el) =>
    el.type === 'MechanicalVentilationDuctwork' &&
    el.parent_element?.trim() === unit &&
    el.duct_type === draft.duct_type &&
    el.coordinates?.length === 2;
}

/**
 * Shift on the duct/pipe plan tool: an off-axis end routes as an L whose first leg runs along the
 * larger move (`flip` swaps the legs). Null when the end is on-axis, which keeps the ortho lock.
 */
export function planOrthogonalElbow(
  start: { x: number; y: number },
  end: { x: number; y: number },
  angleTolDeg: number,
  flip: boolean,
): { x: number; y: number } | null {
  if (end.x === start.x || end.y === start.y || applyAngleSnapIfClose(end, start, angleTolDeg).snapped) return null;
  const xFirst = (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) !== flip;
  return xFirst ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
}

/** Drawn ends sit on the 0.01 m grid, so a tee on a diagonal segment can land up to ~7 mm off its line in plan. */
const TEE_ON_SEGMENT_TOL_M = 0.01;
/** Closer than this to a segment end, a tee would leave a stub: the drawn end lands on that end instead. */
export const TEE_MIN_STUB_M = 0.05;

export type ServiceLineTeeSplit = {
  /** Index into `ends` of the drawn end that tees in; the caller moves that end onto `point`. */
  endIndex: number;
  elementId: string;
  /** Plan projection onto the segment at the segment's z there, or the segment end it lands near. */
  point: WeldPoint;
  /** The split pieces; absent when the end lands near a segment end (no split). */
  head?: WeldPoint[];
  tail?: WeldPoint[];
};

/**
 * A drawn end that lands in plan inside a network segment splits that segment at the tee, so every
 * branch stays an endpoint coincidence. Snapping is in plan, so the match is too, and the tee takes
 * the segment's z there (sloped segments, mains at another height). The original keeps `head`;
 * `tail` becomes a new element. Within TEE_MIN_STUB_M of an end the drawn end lands on that end
 * instead; within SERVICE_POINT_COINCIDENCE_EPS_M it is already there. One entry per segment.
 */
export function planServiceLineTeeSplits(
  elementsById: Record<string, Element>,
  isNetworkSegment: (el: Element) => boolean,
  ends: WeldPoint[],
): ServiceLineTeeSplit[] {
  const splits: ServiceLineTeeSplit[] = [];
  ends.forEach((p, endIndex) => {
    for (const el of Object.values(elementsById)) {
      if (!isNetworkSegment(el) || splits.some((split) => split.elementId === el.id)) continue;
      const [a, b] = el.coordinates as [WeldPoint, WeldPoint];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy);
      if (!(t >= 0 && t <= 1)) continue; // also a vertical riser (NaN)
      const point = { x: a.x + t * vx, y: a.y + t * vy, z: a.z + t * (b.z - a.z) };
      if (Math.hypot(p.x - point.x, p.y - point.y) > TEE_ON_SEGMENT_TOL_M) continue;
      const planLength = Math.hypot(vx, vy);
      const nearest = Math.min(t, 1 - t) * planLength;
      if (nearest <= SERVICE_POINT_COINCIDENCE_EPS_M) continue;
      if (nearest < TEE_MIN_STUB_M) {
        splits.push({ endIndex, elementId: el.id, point: { ...(t < 0.5 ? a : b) } });
      } else {
        splits.push({ endIndex, elementId: el.id, point, head: [{ ...a }, { ...point }], tail: [{ ...point }, { ...b }] });
      }
      break;
    }
  });
  return splits;
}

type ConnectedDragPoint = { x: number; y: number; z: number };

const isConnectedDragWall = (el: Element): boolean =>
  isLineWallElementForSnap(el) && el.coordinates?.length === 2 && !(el as { is_external_door?: unknown }).is_external_door;

/**
 * Line ends that Alt-drag "move connected" carries along with `element`: vertices of same-network
 * ducts and pipes (by their own `snapPartnerFilter`), or for a line wall of other line walls,
 * connected to one of its vertices. Points (unit, terminals) never follow a dragged line; a dragged
 * unit or terminal carries its duct ends. Openings, floors, roofs and labels never follow a wall.
 * A line colinear with a dragged line (within `angleTolDeg`) is left behind: it detaches.
 * `effectiveFloors` (`withEffectiveStoreyHeights`) place a dragged unit in metres.
 */
export function findConnectedDragNeighbours(
  element: Element,
  elementsById: Record<string, Element>,
  angleTolDeg: number,
  effectiveFloors: Floor[],
): Array<{ elementId: string; vertexIndex: number }> {
  const pointInMetres = isStoreyIndexPoint(element) ? networkPoint3(element, effectiveFloors) : undefined;
  const own = pointInMetres ? [pointInMetres] : element.coordinates ?? [];
  const [a, b] = own;
  const parallel = (q: { x: number; y: number }, far: { x: number; y: number }) => {
    if (own.length !== 2 || !a || !b) return false;
    const ux = b.x - a.x, uy = b.y - a.y, vx = far.x - q.x, vy = far.y - q.y;
    return Math.abs(ux * vy - uy * vx) <= Math.sin((angleTolDeg * Math.PI) / 180) * Math.hypot(ux, uy) * Math.hypot(vx, vy);
  };
  const out: Array<{ elementId: string; vertexIndex: number }> = [];
  for (const other of Object.values(elementsById)) {
    if (other.id === element.id || other.coordinates?.length !== 2) continue;
    const serviceLine = other.type === 'MechanicalVentilationDuctwork' || other.type === 'WaterPipework';
    if (serviceLine ? !snapPartnerFilter(other)?.(element) : !(isConnectedDragWall(element) && isConnectedDragWall(other))) continue;
    other.coordinates.forEach((q, vertexIndex) => {
      if (parallel(q, other.coordinates[1 - vertexIndex]!)) return;
      if (own.some((p) => pointsConnected(element, p, other, q))) out.push({ elementId: other.id, vertexIndex });
    });
  }
  return out;
}

/**
 * Coordinates after an Alt-drag of `element` by plan `delta`: the element translates (a line only
 * along its plan normal, so right-angle neighbours stay square) and each neighbour end moves with
 * it while the far end stays put. A neighbour that would collapse or reverse is left behind.
 */
export function planConnectedDrag(
  element: Element,
  neighbours: ReadonlyArray<{ elementId: string; vertexIndex: number }>,
  elementsById: Record<string, Element>,
  delta: { x: number; y: number },
): Record<string, ConnectedDragPoint[]> {
  const coords = (element.coordinates ?? []) as ConnectedDragPoint[];
  let { x: dx, y: dy } = delta;
  if (coords.length === 2) {
    const nx = coords[0]!.y - coords[1]!.y;
    const ny = coords[1]!.x - coords[0]!.x;
    const n2 = nx * nx + ny * ny;
    if (n2 > 0) {
      const t = (dx * nx + dy * ny) / n2;
      dx = t * nx;
      dy = t * ny;
    }
  }
  const moved: Record<string, ConnectedDragPoint[]> = {
    [element.id]: coords.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  };
  for (const { elementId, vertexIndex } of neighbours) {
    const next = [...((moved[elementId] ?? elementsById[elementId]?.coordinates ?? []) as ConnectedDragPoint[])];
    const p = next[vertexIndex];
    const far = next[1 - vertexIndex];
    if (!p || !far) continue;
    const q = { ...p, x: p.x + dx, y: p.y + dy };
    if (Math.hypot(q.x - far.x, q.y - far.y, q.z - far.z) < 0.01) continue;
    if ((p.x - far.x) * (q.x - far.x) + (p.y - far.y) * (q.y - far.y) < 0) continue;
    next[vertexIndex] = q;
    moved[elementId] = next;
  }
  return moved;
}

// Helper to detect which vertices of an element are exactly snapped to other elements (for persistent indicators)
export const getExactSnappedVertices = (
  element: Element,
  elementsById: Record<string, Element>,
  options?: GetExactSnappedVerticesOptions,
): Set<number> => {
  const snappedVertices = new Set<number>();
  const skipTypes = options?.skipVertexMatchFromOtherTypes;
  const isPartner = snapPartnerFilter(element);
  const floors = options?.effectiveFloors;
  // A storey-index point meets a metre-z partner at its storey's base height.
  const inMetres = (el: Element, metreZPartner: Element) =>
    !!floors && isStoreyIndexPoint(el) && physicalZUsesFloorId(metreZPartner);

  if (!element.coordinates) return snappedVertices;

  element.coordinates.forEach((storedCoord, index) => {
    // Early exit: if this vertex is already snapped, skip further checks
    if (snappedVertices.has(index)) return;

    for (const otherId of Object.keys(elementsById)) {
      if (otherId === element.id) continue; // Skip self
      const other = elementsById[otherId];
      if (skipTypes?.length && other.type && skipTypes.includes(String(other.type))) {
        continue;
      }
      if (isPartner && !isPartner(other)) continue;
      if (!other.coordinates) continue;
      const coord = inMetres(element, other) ? networkPoint3(element, floors!) ?? storedCoord : storedCoord;
      const otherCoords = inMetres(other, element) ? [networkPoint3(other, floors!) ?? other.coordinates[0]!] : other.coordinates;

      for (const otherCoord of otherCoords) {
        if (pointsConnected(element, coord, other, otherCoord)) {
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
  if (!element.coordinates || !isBuildingElement(element)) return supportedVertices;

  const skipTypes = options?.skipVertexMatchFromOtherTypes;
  const tolerance = options?.wallSegmentTolerance ?? DEFAULT_WALL_SUPPORTED_VERTEX_TOLERANCE_M;
  const toleranceSq = tolerance * tolerance;

  element.coordinates.forEach((coord, index) => {
    if (supportedVertices.has(index)) return;

    for (const otherId of Object.keys(elementsById)) {
      if (otherId === element.id) continue;
      const other = elementsById[otherId];
      if (!other || !isBuildingElement(other)) continue;
      if (skipTypes?.length && other.type && skipTypes.includes(String(other.type))) continue;
      if (!isLineWallElementForSnap(other) || other.coordinates?.length !== 2) continue;

      const [A, B] = other.coordinates;
      if (
        !sameStorey(coord.z, A.z) ||
        !sameStorey(coord.z, B.z)
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
    if (pointsConnected(element2, coord, element1, sharedVertex)) {
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
      if (pointsConnected(element, vertex, other, otherCoord)) {
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
