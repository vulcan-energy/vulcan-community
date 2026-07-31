// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementAdjacentUnconditionedSpace_Simple,
  BuildingElementGround,
  BuildingElementPartyWall,
  Element,
} from '../geometry/types';
import { roundToTwoDecimals } from '../geometry/constants';
import { isExternalLineWall } from '../geometry/thermalBridge/proposeExternalCorners';
import {
  findLinkedGroundSlabForLineElement,
  GROUND_SLAB_PERIM_LINK_TOL_M,
  groundSlabPolygonEdgesXY,
} from './suspendedFloorGeometry';

export const GROUND_EXPOSED_PERIMETER_MANUAL_KEY = '_ground_exposed_perimeter_manual';

const MIN_OVERLAP_M = 0.01;
const PARALLEL_CROSS_TOL = 0.08;

type LineSurfaceElement =
  | Element
  | BuildingElementAdjacentConditionedSpace
  | BuildingElementAdjacentUnconditionedSpace_Simple
  | BuildingElementPartyWall;

export interface GroundExposedPerimeterRun {
  elementId: string;
  label: string;
  elementType: Element['type'];
  edgeIndex: number;
  lengthM: number;
  reason?: string;
}

export interface GroundExposedPerimeterDetails {
  /** Exposed length counted from external opaque and adjacent-unheated wall runs on the floor polyline. */
  valueM: number;
  /** Closed outline perimeter of the drawn ground polygon, retained for comparison/UI context. */
  shapePerimeterM: number;
  /** Boundary length with any linked line classification, exposed or excluded. */
  linkedBoundaryPerimeterM: number;
  exposedRuns: GroundExposedPerimeterRun[];
  excludedRuns: GroundExposedPerimeterRun[];
  linkedLineCount: number;
}

interface InternalGroundExposedPerimeterRun extends GroundExposedPerimeterRun {
  interval: [number, number];
}

function readStoreyKey(element: Pick<Element, 'floorId' | 'coordinates'>): string | null {
  if (typeof element.floorId === 'string' && element.floorId.trim() !== '') {
    return element.floorId.trim();
  }
  const z = element.coordinates?.[0]?.z;
  return typeof z === 'number' && Number.isFinite(z) ? String(Math.floor(z)) : null;
}

function sameStorey(
  a: Pick<Element, 'floorId' | 'coordinates'>,
  b: Pick<Element, 'floorId' | 'coordinates'>,
): boolean {
  const aKey = readStoreyKey(a);
  const bKey = readStoreyKey(b);
  return !aKey || !bKey || aKey === bKey;
}

function isExcludedBoundaryLine(
  element: Element,
): element is BuildingElementAdjacentConditionedSpace | BuildingElementPartyWall {
  return (
    element.type === 'BuildingElementAdjacentConditionedSpace' ||
    element.type === 'BuildingElementPartyWall'
  );
}

function isAdjacentUnconditionedBoundaryLine(
  element: Element,
): element is BuildingElementAdjacentUnconditionedSpace_Simple {
  return element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple';
}

function isExternalLineWallBoolean(element: Element): boolean {
  if (element.type === 'BuildingElementOpaque' && element.is_external_door === true) return false;
  return isExternalLineWall(element);
}

function lineLabel(element: LineSurfaceElement): string {
  return typeof element.name === 'string' && element.name.trim() ? element.name.trim() : element.id;
}

function shapePerimeterM(ground: BuildingElementGround): number {
  const coords = ground.coordinates;
  if (!coords || coords.length < 2) return 0;
  if (coords.length === 2) {
    const [a, b] = coords;
    return roundToTwoDecimals(Math.hypot(b.x - a.x, b.y - a.y));
  }
  let perimeter = 0;
  const edges = groundSlabPolygonEdgesXY(ground);
  for (const [[ax, ay], [bx, by]] of edges) {
    perimeter += Math.hypot(bx - ax, by - ay);
  }
  return roundToTwoDecimals(perimeter);
}

function overlapIntervalOnEdge(
  line: Pick<Element, 'coordinates'>,
  edge: [[number, number], [number, number]],
  toleranceM: number,
): [number, number] | null {
  const coords = line.coordinates;
  if (!coords || coords.length !== 2) return null;
  const [a, b] = coords;
  const [[ex0, ey0], [ex1, ey1]] = edge;
  const edgeDx = ex1 - ex0;
  const edgeDy = ey1 - ey0;
  const edgeLen = Math.hypot(edgeDx, edgeDy);
  if (edgeLen <= MIN_OVERLAP_M) return null;

  const ux = edgeDx / edgeLen;
  const uy = edgeDy / edgeLen;
  const lineDx = b.x - a.x;
  const lineDy = b.y - a.y;
  const lineLen = Math.hypot(lineDx, lineDy);
  if (lineLen <= MIN_OVERLAP_M) return null;
  const vx = lineDx / lineLen;
  const vy = lineDy / lineLen;
  const parallelCross = Math.abs(ux * vy - uy * vx);
  if (parallelCross > PARALLEL_CROSS_TOL) return null;

  const signedDistanceA = ux * (a.y - ey0) - uy * (a.x - ex0);
  const signedDistanceB = ux * (b.y - ey0) - uy * (b.x - ex0);
  if (Math.abs(signedDistanceA) > toleranceM || Math.abs(signedDistanceB) > toleranceM) return null;

  const tA = (a.x - ex0) * ux + (a.y - ey0) * uy;
  const tB = (b.x - ex0) * ux + (b.y - ey0) * uy;
  const start = Math.max(0, Math.min(tA, tB));
  const end = Math.min(edgeLen, Math.max(tA, tB));
  return end - start > MIN_OVERLAP_M ? [start, end] : null;
}

function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  if (intervals.length <= 1) return intervals;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval[0] > last[1] + MIN_OVERLAP_M) {
      merged.push([interval[0], interval[1]]);
    } else {
      last[1] = Math.max(last[1], interval[1]);
    }
  }
  return merged;
}

function isLinkedToGroundPolyline(
  element: LineSurfaceElement,
  ground: BuildingElementGround,
  toleranceM: number,
): boolean {
  if (element.zoneId !== ground.zoneId) return false;
  if (!sameStorey(element, ground)) return false;
  return findLinkedGroundSlabForLineElement(
    {
      zoneId: element.zoneId,
      parent_element: element.parent_element,
      coordinates: element.coordinates,
    },
    [ground],
    toleranceM,
  )?.id === ground.id;
}

function linkedRunsForEdges(
  element: LineSurfaceElement,
  edges: Array<[[number, number], [number, number]]>,
  toleranceM: number,
  reason?: string,
): InternalGroundExposedPerimeterRun[] {
  const runs: InternalGroundExposedPerimeterRun[] = [];
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    const interval = overlapIntervalOnEdge(element, edges[edgeIndex]!, toleranceM);
    if (!interval) continue;
    runs.push({
      elementId: element.id,
      label: lineLabel(element),
      elementType: element.type,
      edgeIndex,
      lengthM: roundToTwoDecimals(interval[1] - interval[0]),
      interval,
      ...(reason ? { reason } : {}),
    });
  }
  return runs;
}

export function computeGroundExposedPerimeterDetails(
  elementsById: Record<string, Element>,
  ground: BuildingElementGround,
  options: { toleranceM?: number } = {},
): GroundExposedPerimeterDetails {
  const toleranceM = options.toleranceM ?? GROUND_SLAB_PERIM_LINK_TOL_M;
  const edges = groundSlabPolygonEdgesXY(ground);
  const exposedRuns: GroundExposedPerimeterRun[] = [];
  const excludedRuns: GroundExposedPerimeterRun[] = [];
  const exposedIntervalsByEdge = new Map<number, Array<[number, number]>>();
  const linkedIntervalsByEdge = new Map<number, Array<[number, number]>>();
  let linkedLineCount = 0;

  for (const element of Object.values(elementsById)) {
    if (element.id === ground.id || element.isPlaceholder || !element.coordinates || element.coordinates.length !== 2) {
      continue;
    }
    // Openings are represented by their host wall run for perimeter purposes.
    // They must not define independent perimeter coverage or double count over the host.
    if (
      element.type === 'BuildingElementTransparent' ||
      (element.type === 'BuildingElementOpaque' && element.is_external_door === true)
    ) {
      continue;
    }
    if (element.zoneId !== ground.zoneId || !sameStorey(element, ground)) continue;

    const linked = isLinkedToGroundPolyline(element, ground, toleranceM);
    if (!linked) continue;

    if (element.type === 'BuildingElementOpaque' || isAdjacentUnconditionedBoundaryLine(element)) {
      const runs = linkedRunsForEdges(element, edges, toleranceM);
      if (runs.length > 0) linkedLineCount += 1;
      if (element.type !== 'BuildingElementOpaque' || isExternalLineWallBoolean(element)) {
        for (const run of runs) {
          const { interval, ...publicRun } = run;
          const edgeIndex = run.edgeIndex;
          const intervals = exposedIntervalsByEdge.get(edgeIndex) ?? [];
          intervals.push(interval);
          exposedIntervalsByEdge.set(edgeIndex, intervals);
          const linkedIntervals = linkedIntervalsByEdge.get(edgeIndex) ?? [];
          linkedIntervals.push(interval);
          linkedIntervalsByEdge.set(edgeIndex, linkedIntervals);
          exposedRuns.push(publicRun);
        }
      } else {
        for (const run of runs) {
          const { interval, ...publicRun } = { ...run, reason: 'not external' };
          const linkedIntervals = linkedIntervalsByEdge.get(run.edgeIndex) ?? [];
          linkedIntervals.push(interval);
          linkedIntervalsByEdge.set(run.edgeIndex, linkedIntervals);
          excludedRuns.push(publicRun);
        }
      }
    } else if (isExcludedBoundaryLine(element)) {
      const reason =
        element.type === 'BuildingElementPartyWall'
          ? 'party wall'
          : 'adjacent conditioned space';
      const runs = linkedRunsForEdges(element, edges, toleranceM, reason);
      if (runs.length > 0) linkedLineCount += 1;
      for (const run of runs) {
        const { interval, ...publicRun } = run;
        const linkedIntervals = linkedIntervalsByEdge.get(run.edgeIndex) ?? [];
        linkedIntervals.push(interval);
        linkedIntervalsByEdge.set(run.edgeIndex, linkedIntervals);
        excludedRuns.push(publicRun);
      }
    }
  }

  let total = 0;
  for (const intervals of exposedIntervalsByEdge.values()) {
    for (const [start, end] of mergeIntervals(intervals)) {
      total += end - start;
    }
  }
  let linkedBoundaryTotal = 0;
  for (const intervals of linkedIntervalsByEdge.values()) {
    for (const [start, end] of mergeIntervals(intervals)) {
      linkedBoundaryTotal += end - start;
    }
  }

  return {
    valueM: roundToTwoDecimals(total),
    shapePerimeterM: shapePerimeterM(ground),
    linkedBoundaryPerimeterM: roundToTwoDecimals(linkedBoundaryTotal),
    exposedRuns,
    excludedRuns,
    linkedLineCount,
  };
}
