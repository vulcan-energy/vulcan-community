// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { BuildingElementOpaque, Element, Floor } from '../geometry/types';
import { roundToTwoDecimals } from '../geometry/constants';
import { calculateDerivedBaseHeight } from './zoneDerivation';

export const UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY = 'unheated_pitched_roof_ceiling_elevation';

export type UnheatedPitchedRoofCeilingElevationSource =
  | 'authored'
  | 'wall-top'
  | 'storey-ceiling'
  | 'roof-base';

export interface UnheatedPitchedRoofCeilingElevation {
  value: number;
  source: UnheatedPitchedRoofCeilingElevationSource;
}

const ROOF_WALL_PLAN_INTERSECTION_TOL_M = 0.35;
const WALL_TOP_ABOVE_ROOF_BASE_TOL_M = 1;

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readAuthoredUnheatedPitchedRoofCeilingElevationM(
  roof: BuildingElementOpaque,
): number | null {
  const value = finiteNumber(readRecord(roof.extra_json)[UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY]);
  return value !== null && value >= 0 ? roundToTwoDecimals(value) : null;
}

export function mergeUnheatedPitchedRoofCeilingElevationExtraJson(
  existingExtraJson: unknown,
  value: number | '',
): Record<string, unknown> | undefined {
  const next = { ...readRecord(existingExtraJson) };
  if (value === '') {
    delete next[UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY];
  } else if (Number.isFinite(value)) {
    next[UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY] = roundToTwoDecimals(value);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function floorZForElement(element: Element, floors: Floor[] | undefined): number | null {
  if (element.floorId && floors?.length) {
    const floor = floors.find((candidate) => candidate.id === element.floorId);
    if (floor && Number.isFinite(floor.zIndex)) return floor.zIndex;
  }
  const coordinates = Array.isArray(element.coordinates) ? element.coordinates : [];
  if (coordinates.length === 0) return null;
  const zValues = coordinates
    .map((coord) => coord.z)
    .filter((z): z is number => typeof z === 'number' && Number.isFinite(z));
  if (zValues.length === 0) return null;
  if (coordinates.length === 2) return Math.floor(zValues[0]!);
  return Math.floor(Math.min(...zValues));
}

function baseElevationMForElement(element: Element, floors: Floor[] | undefined): number | null {
  const schemaBaseHeight = finiteNumber((element as { base_height?: unknown }).base_height);
  if (schemaBaseHeight !== null && schemaBaseHeight >= 0) return schemaBaseHeight;

  const viewerBaseHeight = finiteNumber((element as { _base_height?: unknown })._base_height);
  if (viewerBaseHeight !== null && viewerBaseHeight >= 0) return viewerBaseHeight;

  if (floors?.length) {
    const floorZ = floorZForElement(element, floors);
    if (floorZ !== null) return calculateDerivedBaseHeight(floorZ, floors);
  }

  return null;
}

function coordinateBbox(element: Element): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const coordinates = Array.isArray(element.coordinates) ? element.coordinates : [];
  const points = coordinates.filter(
    (coord) => Number.isFinite(coord.x) && Number.isFinite(coord.y),
  );
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function bboxIntersects(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
  toleranceM: number,
): boolean {
  return (
    a.maxX + toleranceM >= b.minX &&
    b.maxX + toleranceM >= a.minX &&
    a.maxY + toleranceM >= b.minY &&
    b.maxY + toleranceM >= a.minY
  );
}

function isVerticalWallCandidate(element: Element): boolean {
  if (element.isPlaceholder) return false;
  if (
    element.type !== 'BuildingElementOpaque' &&
    element.type !== 'BuildingElementAdjacentConditionedSpace' &&
    element.type !== 'BuildingElementAdjacentUnconditionedSpace_Simple' &&
    element.type !== 'BuildingElementPartyWall'
  ) {
    return false;
  }
  if (!Array.isArray(element.coordinates) || element.coordinates.length !== 2) return false;
  if ((element as { is_unheated_pitched_roof?: unknown }).is_unheated_pitched_roof === true) return false;
  const height = finiteNumber((element as { height?: unknown }).height);
  if (height === null || height <= 0) return false;
  const pitch = finiteNumber((element as { pitch?: unknown }).pitch);
  return pitch === null || Math.abs(pitch - 90) <= 1;
}

function inferCeilingFromWallTopsM(
  roof: BuildingElementOpaque,
  elements: Element[],
  floors: Floor[] | undefined,
): number | null {
  const roofBbox = coordinateBbox(roof);
  if (!roofBbox) return null;
  const roofFloorZ = floorZForElement(roof, floors);
  const roofBase = finiteNumber(roof.base_height);
  let best: number | null = null;

  for (const element of elements) {
    if (element.id === roof.id) continue;
    if (!isVerticalWallCandidate(element)) continue;
    if (roof.zoneId && element.zoneId && roof.zoneId !== element.zoneId) continue;

    const wallBbox = coordinateBbox(element);
    if (!wallBbox || !bboxIntersects(roofBbox, wallBbox, ROOF_WALL_PLAN_INTERSECTION_TOL_M)) continue;

    const wallFloorZ = floorZForElement(element, floors);
    if (roofFloorZ !== null && wallFloorZ !== null && wallFloorZ > roofFloorZ) continue;

    const base = baseElevationMForElement(element, floors);
    const height = finiteNumber((element as { height?: unknown }).height);
    if (base === null || height === null || height <= 0) continue;

    const top = base + height;
    if (roofBase !== null && roofBase > 0 && top > roofBase + WALL_TOP_ABOVE_ROOF_BASE_TOL_M) continue;
    if (best === null || top > best) best = top;
  }

  return best === null ? null : roundToTwoDecimals(best);
}

function inferCeilingFromRoofStoreyM(
  roof: BuildingElementOpaque,
  floors: Floor[] | undefined,
): number | null {
  if (!floors?.length) return null;
  const roofFloorZ = floorZForElement(roof, floors);
  if (roofFloorZ === null || roofFloorZ === 0) return null;
  return calculateDerivedBaseHeight(roofFloorZ, floors);
}

function roofBaseFallbackM(roof: BuildingElementOpaque, floors: Floor[] | undefined): number {
  const roofBase = finiteNumber(roof.base_height);
  if (roofBase !== null && roofBase >= 0) return roundToTwoDecimals(roofBase);

  const storeyBase = inferCeilingFromRoofStoreyM(roof, floors);
  if (storeyBase !== null) return storeyBase;

  const zs = (roof.coordinates ?? [])
    .map((point) => point.z)
    .filter((z): z is number => typeof z === 'number' && Number.isFinite(z));
  return zs.length > 0 ? roundToTwoDecimals(Math.min(...zs)) : 0;
}

export function getUnheatedPitchedRoofCeilingElevationM(
  roof: BuildingElementOpaque,
  elements: Element[] = [],
  floors?: Floor[],
): UnheatedPitchedRoofCeilingElevation {
  const authored = readAuthoredUnheatedPitchedRoofCeilingElevationM(roof);
  if (authored !== null) return { value: authored, source: 'authored' };

  const wallTop = inferCeilingFromWallTopsM(roof, elements, floors);
  if (wallTop !== null) return { value: wallTop, source: 'wall-top' };

  const storeyCeiling = inferCeilingFromRoofStoreyM(roof, floors);
  if (storeyCeiling !== null) return { value: storeyCeiling, source: 'storey-ceiling' };

  return { value: roofBaseFallbackM(roof, floors), source: 'roof-base' };
}
