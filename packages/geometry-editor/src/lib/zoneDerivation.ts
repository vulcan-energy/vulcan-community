// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Floor, Zone } from '../geometry/types';
import { calculatePolygonArea } from './polygonSync';
import { roundToTwoDecimals } from '../geometry/constants';
import { canvasFloorToFhsStorey, fhsStoreyToCanvasFloor } from './storeySemantics';

/** One geometry element that contributed to {@link calculateDerivedFloorArea}. */
export interface FloorAreaContribution {
  elementId: string;
  elementName: string;
  /** Portion of the zone total from this polygon (m²). */
  areaM2: number;
}

export interface DwellingDetailsSuggestion {
  buildType?: 'flat' | 'house';
  storeysInDwelling?: number;
  storeyOfDwelling?: number;
  contributingFloorLevels: number[];
  hasGroundElement: boolean;
  explanation?: string;
}

export type FloorMoveBaseHeightPatch = {
  base_height?: number;
  _base_height?: number;
  mid_height?: number;
  extra_json?: Record<string, any>;
};

const HORIZONTAL_FLOOR_POLYGON_TYPES: Array<Element['type']> = [
  'BuildingElementOpaque',
  'BuildingElementTransparent',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
];

/**
 * Horizontal polygon usable as treated floor area: **pitch 180°** (normal facing down / walkable deck from
 * inside the zone). **Pitch 0°** (facing up) is excluded — that is a roof / upper ceiling surface, not TFA.
 * @see ElementCreator pitch labels: 0° = "Facing up", 180° = "Facing down"
 */
export function isWalkableFloorHorizontalPolygon(el: Element): boolean {
  if (!HORIZONTAL_FLOOR_POLYGON_TYPES.includes(el.type)) return false;
  if (!el.coordinates || el.coordinates.length < 3) return false;
  const pitch = (el as { pitch?: number }).pitch;
  if (pitch !== 180) return false;
  if ((el as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof) return false;
  return true;
}

function pushContribution(
  out: FloorAreaContribution[],
  element: Element,
  area: number,
): void {
  const name = element.name?.trim() || element.id;
  out.push({ elementId: element.id, elementName: name, areaM2: roundToTwoDecimals(area) });
}

function formatAreaSource(contributions: FloorAreaContribution[]): string | undefined {
  if (contributions.length === 0) return undefined;
  if (contributions.length === 1) {
    const c = contributions[0]!;
    return `${c.elementName} (${c.areaM2} m²)`;
  }
  const parts = contributions.map((c) => `${c.elementName} (${c.areaM2} m²)`);
  return parts.join(' + ');
}

/**
 * Floor index (Z) for TFA / wall grouping: line walls use the first point; polygons use the lowest Z.
 */
export function elementFloorIndex(el: Element): number | null {
  if (!el.coordinates?.length) return null;
  if (el.coordinates.length === 2) {
    return Math.floor(el.coordinates[0]?.z ?? 0);
  }
  const minZ = Math.min(...el.coordinates.map((c) => c.z));
  return Math.floor(minZ);
}

/**
 * Calculate the geometry-derived **treated floor area** for a zone, ignoring any user override.
 *
 * Strategy:
 * 1. Sum **BuildingElementGround** polygons (all storeys; no pitch filter).
 * 2. Sum **walkable horizontal floor polygons**: opaque / transparent / adjacent with **pitch 180°**
 *    (excludes pitch 0° roof-ceiling surfaces). Not roof-marked.
 * Both steps apply — upper storeys can use pitch-180 decks even when ground exists on lower storeys.
 * No roof name/area fallback — roofs are not TFA; users must model floors explicitly.
 *
 * Returns contributing elements for UI navigation.
 */
export function calculateDerivedFloorArea(
  zoneId: string,
  elements: Element[],
): { floorArea: number; areaSource: string | undefined; contributingElements: FloorAreaContribution[] } {
  const zoneElements = elements.filter((el) => (el as any).zoneId === zoneId);
  const contributingElements: FloorAreaContribution[] = [];

  const groundElements = zoneElements.filter((el) => el.type === 'BuildingElementGround');
  for (const element of groundElements) {
    if (element.coordinates && element.coordinates.length >= 3) {
      const area = calculatePolygonArea(element.coordinates);
      if (area > 0) {
        pushContribution(contributingElements, element, area);
      }
    }
  }

  const horizontalFloors = zoneElements.filter(isWalkableFloorHorizontalPolygon);
  for (const element of horizontalFloors) {
    if (!element.coordinates || element.coordinates.length < 3) continue;
    const area = calculatePolygonArea(element.coordinates);
    if (area > 0) {
      pushContribution(contributingElements, element, area);
    }
  }

  const total = contributingElements.reduce((s, c) => s + c.areaM2, 0);

  return {
    floorArea: total > 0 ? roundToTwoDecimals(total) : 0,
    areaSource: formatAreaSource(contributingElements),
    contributingElements,
  };
}

/**
 * Suggest FHS `General` dwelling details from explicit floor/deck geometry.
 *
 * Counts distinct storey levels with a real floor contributor:
 * - `BuildingElementGround`
 * - walkable horizontal floor polygons (`pitch === 180`, not roof-marked)
 *
 * Roof/ceiling-only polygons (`pitch === 0`) and line walls are intentionally excluded.
 */
export function calculateDwellingDetailsSuggestion(elements: Element[]): DwellingDetailsSuggestion {
  const contributingFloorLevels = new Set<number>();
  let hasGroundElement = false;

  for (const element of elements) {
    const contributes =
      element.type === 'BuildingElementGround' || isWalkableFloorHorizontalPolygon(element);
    if (!contributes) continue;

    const floorIndex = elementFloorIndex(element);
    if (floorIndex === null) continue;

    contributingFloorLevels.add(floorIndex);
    if (element.type === 'BuildingElementGround') {
      hasGroundElement = true;
    }
  }

  const sortedFloorLevels = Array.from(contributingFloorLevels).sort((a, b) => a - b);
  const storeysInDwelling = sortedFloorLevels.length > 0 ? sortedFloorLevels.length : undefined;
  const storeyOfDwelling = sortedFloorLevels.length > 0
    ? canvasFloorToFhsStorey(sortedFloorLevels[0])
    : undefined;
  const buildType =
    sortedFloorLevels.length === 0
      ? undefined
      : hasGroundElement
        ? 'house'
        : 'flat';

  const explanation =
    sortedFloorLevels.length > 0
      ? [
          `Counted ${sortedFloorLevels.length} storey level${sortedFloorLevels.length === 1 ? '' : 's'} with floor geometry: ${sortedFloorLevels.map(canvasFloorToFhsStorey).join(', ')}.`,
          hasGroundElement
            ? 'A ground-contact floor was found, so house is suggested.'
            : 'No ground-contact floor was found, so flat is suggested.',
          'Pitch-0 roof/ceiling surfaces and line walls are not counted.',
        ].join(' ')
      : undefined;

  return {
    buildType,
    storeysInDwelling,
    storeyOfDwelling,
    contributingFloorLevels: sortedFloorLevels,
    hasGroundElement,
    explanation,
  };
}

const LINE_WALL_TYPES: Array<Element['type']> = [
  'BuildingElementOpaque',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
];

/**
 * Per-floor weighted-average line-wall height (m) for each Z-level that has contributing walls.
 * Same wall filtering as {@link calculateDerivedHeight}.
 */
export function getPerFloorLineWallAverageHeights(zoneId: string, elements: Element[]): Map<number, number> {
  const lineWalls = elements.filter((el) => {
    if ((el as any).zoneId !== zoneId) return false;
    if (!LINE_WALL_TYPES.includes(el.type)) return false;
    if (!el.coordinates || el.coordinates.length !== 2) return false;
    if (el.type === 'BuildingElementOpaque' && el.is_external_door === true) return false;

    const pitch = (el as { pitch?: number }).pitch;
    return typeof pitch !== 'number' || pitch === 90;
  });

  const byFloor = new Map<number, typeof lineWalls>();
  for (const wall of lineWalls) {
    const floorZ = Math.floor(wall.coordinates[0]?.z ?? 0);
    if (!byFloor.has(floorZ)) byFloor.set(floorZ, []);
    byFloor.get(floorZ)!.push(wall);
  }

  const out = new Map<number, number>();
  for (const [floorZ, floorWalls] of byFloor) {
    let weightedSum = 0;
    let weightTotal = 0;

    for (const wall of floorWalls) {
      const h = (wall as any).height as number | undefined;
      const width = (wall as any).width as number | undefined;

      if (typeof h !== 'number' || h <= 0) continue;

      const weight = typeof width === 'number' && width > 0 ? width : 1;
      weightedSum += h * weight;
      weightTotal += weight;
    }

    if (weightTotal > 0) {
      out.set(floorZ, weightedSum / weightTotal);
    }
  }

  return out;
}

/**
 * Z-levels that have line walls contributing to zone height, but no TFA element attributed to that floor.
 * Only considers floors with positive per-storey wall height (see {@link getPerFloorLineWallAverageHeights}).
 * Floors with only roof/ceiling polygons and no line walls are not listed.
 */
export function getZoneFloorLevelsMissingTfa(zoneId: string, elements: Element[]): number[] {
  const perFloorHeights = getPerFloorLineWallAverageHeights(zoneId, elements);
  const { contributingElements } = calculateDerivedFloorArea(zoneId, elements);
  const tfaZs = new Set<number>();
  for (const c of contributingElements) {
    const el = elements.find((e) => e.id === c.elementId);
    if (!el) continue;
    const z = elementFloorIndex(el);
    if (z !== null) tfaZs.add(z);
  }

  const missing: number[] = [];
  for (const [z, h] of perFloorHeights) {
    if (h <= 0) continue;
    if (!tfaZs.has(z)) missing.push(z);
  }
  return missing.sort((a, b) => a - b);
}

/**
 * Calculate the total ground floor area from BuildingElementGround elements.
 * Only considers elements at the lowest Z-level (within 0.1m tolerance).
 * This is the "global" ground floor area used in compliance settings.
 *
 * Also used during CSV export when no manual GroundFloorArea is set.
 */
export function calculateGroundFloorArea(elements: Element[]): number {
  const groundElements = elements.filter(el => el.type === 'BuildingElementGround');
  if (groundElements.length === 0) return 0;

  const minZ = Math.min(...groundElements.map(el => {
    const coords = el.coordinates as Array<{x: number; y: number; z: number}>;
    return coords.length > 0 ? Math.min(...coords.map(c => c.z)) : Infinity;
  }));

  if (minZ === Infinity) return 0;

  let totalArea = 0;
  for (const element of groundElements) {
    const coords = element.coordinates as Array<{x: number; y: number; z: number}>;
    if (coords.length >= 3) {
      const elementMinZ = Math.min(...coords.map(c => c.z));
      if (Math.abs(elementMinZ - minZ) < 0.1) {
        try {
          totalArea += calculatePolygonArea(coords);
        } catch {
          // Skip invalid polygons
        }
      }
    }
  }

  return roundToTwoDecimals(totalArea);
}

/**
 * Calculate the total building height for ventilation_zone_height.
 *
 * HEM uses this as the full height of the building envelope — leak paths
 * are placed at 0.25×, 0.75×, and 1.0× this value (bottom walls, upper
 * walls, roof).  For a two-storey building with 2.5 m per floor, this
 * should be ~5.0 m, not 2.5 m.
 *
 * Approach: group ALL line-drawn wall elements by floor Z-level, calculate
 * the weighted-average wall height per floor, then SUM across floors.
 * Falls back to summing Floor object heights when no wall data exists.
 *
 * Returns 0 when no suitable data is available.
 */
export function calculateSuggestedVentilationHeight(
  elements: Element[],
  floors?: Floor[],
): number {
  const wallTypes = [
    'BuildingElementOpaque',
    'BuildingElementAdjacentConditionedSpace',
    'BuildingElementAdjacentUnconditionedSpace_Simple',
  ];

  const lineWalls = elements.filter(el =>
    wallTypes.includes(el.type) &&
    el.coordinates && el.coordinates.length === 2
  );

  if (lineWalls.length > 0) {
    const byFloor = new Map<number, typeof lineWalls>();
    for (const wall of lineWalls) {
      const floorZ = Math.floor(wall.coordinates[0]?.z ?? 0);
      if (!byFloor.has(floorZ)) byFloor.set(floorZ, []);
      byFloor.get(floorZ)!.push(wall);
    }

    let totalHeight = 0;
    for (const [, floorWalls] of byFloor) {
      let weightedSum = 0;
      let weightTotal = 0;

      for (const wall of floorWalls) {
        const h = (wall as any).height as number | undefined;
        const pitch = (wall as any).pitch as number | undefined;
        const width = (wall as any).width as number | undefined;

        if (typeof h !== 'number' || h <= 0) continue;

        let effectiveHeight = h;
        if (typeof pitch === 'number') {
          if (pitch === 0 || pitch === 180) continue;
          effectiveHeight = h * Math.sin(pitch * Math.PI / 180);
        }

        const weight = (typeof width === 'number' && width > 0) ? width : 1;
        weightedSum += effectiveHeight * weight;
        weightTotal += weight;
      }

      if (weightTotal > 0) {
        totalHeight += weightedSum / weightTotal;
      }
    }

    if (totalHeight > 0) return roundToTwoDecimals(totalHeight);
  }

  // Fallback: sum Floor object heights
  if (floors && floors.length > 0) {
    const total = floors.reduce((sum, f) => sum + (f.height || 0), 0);
    if (total > 0) return roundToTwoDecimals(total);
  }

  return 0;
}

function readFiniteElementNumber(element: Element, key: string): number | undefined {
  const direct = (element as unknown as Record<string, unknown>)[key];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const extra = element.extra_json?.[key];
  return typeof extra === 'number' && Number.isFinite(extra) ? extra : undefined;
}

function isBasementGroundElement(element: Element): boolean {
  if (element.type !== 'BuildingElementGround') return false;
  const floorType = (element as { floor_type?: string }).floor_type;
  return floorType === 'Heated_basement' || floorType === 'Unheated_basement';
}

export function hasGroundFloorBasementVentilationBaseHeightCandidate(elements: Element[]): boolean {
  return elements.some(isBasementGroundElement);
}

export function calculateGroundFloorBasementVentilationBaseHeight(elements: Element[]): number | null {
  const candidates: number[] = [];

  for (const element of elements) {
    if (!isBasementGroundElement(element)) continue;
    const floorType = (element as { floor_type?: string }).floor_type;
    if (floorType === 'Heated_basement') {
      const depth = readFiniteElementNumber(element, 'depth_basement_floor');
      if (depth !== undefined && depth > 0) candidates.push(-depth);
    } else if (floorType === 'Unheated_basement') {
      const height = readFiniteElementNumber(element, 'height_basement_walls');
      if (height !== undefined && height >= 0) candidates.push(height);
    }
  }

  if (candidates.length === 0) return null;
  return roundToTwoDecimals(Math.min(...candidates));
}

export function calculateSuggestedVentilationBaseHeight(
  elements: Element[],
  floors?: Floor[],
  options: {
    buildType?: 'flat' | 'house';
    storeyOfDwelling?: number;
    storeysInDwelling?: number;
    ventilationZoneHeight?: number;
  } = {},
): number {
  const effectiveFloors = withEffectiveStoreyHeights(floors, elements);
  const heightFromFloorStack = (floorIndex: number): number | null => {
    if (!effectiveFloors || floorIndex === 0) return floorIndex === 0 ? 0 : null;
    const requiredZs =
      floorIndex > 0
        ? Array.from({ length: floorIndex }, (_, index) => index)
        : Array.from({ length: Math.abs(floorIndex) }, (_, index) => floorIndex + index);
    const hasCompleteStack = requiredZs.every((z) => {
      const floor = effectiveFloors.find((candidate) => candidate.zIndex === z);
      return !!floor && floor.height > 0;
    });
    if (!hasCompleteStack) return null;
    const cumulative = calculateDerivedBaseHeight(floorIndex, effectiveFloors);
    return cumulative === 0 && floorIndex !== 0 ? null : roundToTwoDecimals(cumulative);
  };

  const heightFromVentilation = (floorIndex: number): number | null => {
    if (floorIndex === 0) return 0;
    const ventilationZoneHeight =
      options.ventilationZoneHeight ?? calculateSuggestedVentilationHeight(elements, floors);
    const storeysInDwelling = options.storeysInDwelling;
    if (
      typeof ventilationZoneHeight === 'number' &&
      Number.isFinite(ventilationZoneHeight) &&
      ventilationZoneHeight > 0 &&
      typeof storeysInDwelling === 'number' &&
      Number.isFinite(storeysInDwelling) &&
      storeysInDwelling > 0
    ) {
      return roundToTwoDecimals((ventilationZoneHeight / storeysInDwelling) * floorIndex);
    }
    return null;
  };

  const basementGroundFloorBaseHeight = calculateGroundFloorBasementVentilationBaseHeight(elements);

  if (options.buildType === 'house') {
    const lowestOccupiedFloorIndex = calculateDwellingDetailsSuggestion(elements).contributingFloorLevels[0];
    if (typeof lowestOccupiedFloorIndex === 'number' && lowestOccupiedFloorIndex < 0) {
      return heightFromFloorStack(lowestOccupiedFloorIndex)
        ?? basementGroundFloorBaseHeight
        ?? heightFromVentilation(lowestOccupiedFloorIndex)
        ?? 0;
    }
    return basementGroundFloorBaseHeight ?? 0;
  }

  const storeyOfDwelling = options.storeyOfDwelling;
  if (typeof storeyOfDwelling !== 'number' || !Number.isFinite(storeyOfDwelling)) {
    return 0;
  }

  const floorIndex = fhsStoreyToCanvasFloor(storeyOfDwelling);
  if (floorIndex === 0) return basementGroundFloorBaseHeight ?? 0;
  return heightFromFloorStack(floorIndex)
    ?? (floorIndex < 0 ? basementGroundFloorBaseHeight : null)
    ?? heightFromVentilation(floorIndex)
    ?? 0;
}

/**
 * Calculate the derived base_height for an element based on its Z-level.
 *
 * base_height = the height above ground of the bottom of the element.
 * Computed as the cumulative sum of `floor.height` for every floor below the element's floor.
 *
 * `floor.height` here is expected to be the *effective* storey height — callers should pre-process
 * with {@link withEffectiveStoreyHeights} so wall-derived heights and user overrides are baked in.
 *
 * For Z=0: returns 0.
 * For Z=N (N>=1): sum of `floor.height` for floors 0..N-1.
 * For Z=-N: negative sum of `floor.height` for floors -N..-1.
 * Missing floors contribute 0 — callers should `ensureFloorForZ` first.
 */
export function calculateDerivedBaseHeight(
  elementZ: number,
  floors: Floor[],
): number {
  const floorZIndex = Math.floor(elementZ);
  if (floorZIndex === 0) return 0;

  let baseHeight = 0;
  if (floorZIndex > 0) {
    for (let z = 0; z < floorZIndex; z++) {
      const floor = floors.find((f) => f.zIndex === z);
      if (floor && Number.isFinite(floor.height) && floor.height > 0) baseHeight += floor.height;
    }
  } else {
    for (let z = -1; z >= floorZIndex; z--) {
      const floor = floors.find((f) => f.zIndex === z);
      if (floor && Number.isFinite(floor.height) && floor.height > 0) baseHeight -= floor.height;
    }
  }
  return roundToTwoDecimals(baseHeight);
}

/** Element types that contribute to wall-derived storey height (vertical fabric only). */
const STOREY_HEIGHT_WALL_TYPES: ReadonlySet<Element['type']> = new Set([
  'BuildingElementOpaque',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
]);

/**
 * Max effective wall height for line walls on a given floor. Returns 0 when no qualifying walls
 * exist. Pitched walls contribute `height × sin(pitch)` (vertical projection); horizontal surfaces
 * (pitch 0 / 180) are excluded — those are roofs/ceilings, not walls. Polygon walls are excluded
 * because their `height` field is synthetic (sqrt(area)) and not physically meaningful.
 */
export function getMaxLineWallHeightOnFloor(floorZIndex: number, elements: Element[]): number {
  let max = 0;
  for (const el of elements) {
    if (!STOREY_HEIGHT_WALL_TYPES.has(el.type)) continue;
    if (!el.coordinates || el.coordinates.length !== 2) continue;
    const z = Math.floor(el.coordinates[0]?.z ?? 0);
    if (z !== floorZIndex) continue;
    const h = (el as { height?: unknown }).height;
    if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) continue;
    const pitch = (el as { pitch?: unknown }).pitch;
    let effective = h;
    if (typeof pitch === 'number' && Number.isFinite(pitch)) {
      if (pitch === 0 || pitch === 180) continue; // horizontal surface, not a wall
      if (pitch !== 90) effective = h * Math.sin((pitch * Math.PI) / 180);
    }
    if (effective > max) max = effective;
  }
  return max;
}

/**
 * Effective storey height for one floor.
 *
 * Resolution order:
 * 1. If `floor.heightUserOverride === true` → return the user-typed `floor.height` (sticky override).
 * 2. Else if line walls exist on this floor → return their max effective height (with pitch projection).
 * 3. Else if any floor between this floor and ground has line walls → return the closest one's
 *    max wall height. Typical storeys are uniform; this lets a new upper/basement floor inherit
 *    the building's normal storey height until walls are drawn on it.
 * 4. Else if `floor.height > 0` is stored → use it (legacy/pre-walls fallback for models that carry
 *    a stored storey height without an explicit override flag).
 * 5. Else → 0. No hardcoded 2.4 m fallback anywhere.
 */
export function getEffectiveStoreyHeight(floor: Floor, elements: Element[]): number {
  if (floor.heightUserOverride === true) {
    return Number.isFinite(floor.height) && floor.height > 0 ? floor.height : 0;
  }
  const ownWalls = getMaxLineWallHeightOnFloor(floor.zIndex, elements);
  if (ownWalls > 0) return roundToTwoDecimals(ownWalls);
  if (floor.zIndex > 0) {
    for (let z = floor.zIndex - 1; z >= 0; z--) {
      const belowWalls = getMaxLineWallHeightOnFloor(z, elements);
      if (belowWalls > 0) return roundToTwoDecimals(belowWalls);
    }
  } else if (floor.zIndex < 0) {
    for (let z = floor.zIndex + 1; z <= 0; z++) {
      const aboveWalls = getMaxLineWallHeightOnFloor(z, elements);
      if (aboveWalls > 0) return roundToTwoDecimals(aboveWalls);
    }
  }
  if (Number.isFinite(floor.height) && floor.height > 0) return floor.height;
  return 0;
}

/**
 * Return a shallow-copy of the floors array with each `height` replaced by its *effective* value
 * (see {@link getEffectiveStoreyHeight}). Use this whenever you need to compute cumulative base
 * heights — callers that already pass `floors` into derivation helpers should wrap with this.
 *
 * Passes `undefined` through unchanged so TB / derivation entry points can call this unconditionally
 * without re-introducing the `if (floors && floors.length > 0)` boilerplate at every site.
 */
export function withEffectiveStoreyHeights<T extends Floor[] | undefined>(
  floors: T,
  elements: Element[],
): T {
  if (!floors || floors.length === 0) return floors;
  return floors.map((floor) => ({
    ...floor,
    height: getEffectiveStoreyHeight(floor, elements),
  })) as T;
}

/**
 * Cumulative base height (slab elevation) per floor — Floor 0 = 0, Floor N = sum of effective
 * storey heights for floors 0..N-1, basement floors are negative cumulative heights below
 * ground. Keyed by floor id for stable lookup. Used by the floor picker dropdown for display.
 */
export function getCumulativeBaseHeightsByFloorId(
  floors: Floor[],
  elements: Element[],
): Map<string, number> {
  const effectiveFloors = withEffectiveStoreyHeights(floors, elements) ?? [];
  const byId = new Map<string, number>();
  for (const floor of floors) {
    byId.set(floor.id, calculateDerivedBaseHeight(floor.zIndex, effectiveFloors));
  }
  return byId;
}

/**
 * Single source of truth for "which field carries this element's authored base_height,
 * and what value (if any) does it currently hold?". Used by both the floor-move and
 * floor-stack-change patch builders so they route patches to the same field per type.
 *
 * - Opaque / Transparent / OnSiteGeneration → `base_height` (HEM-canonical, exported to CSV).
 * - Adjacent / Party / Ground and non-schema drawable objects → `_base_height` (viewer-only, not sent to HEM).
 *   Legacy CSVs
 *   may carry a stray `base_height` on these types; we treat it as a `_base_height` value
 *   and flag it so the patch clears the legacy field on write.
 * - Returns `null` for endpoint-Z element types (thermal bridges, pipework, ductwork).
 *
 * `storedValue: null` means the element has no authored value yet — callers can either fall
 * back (move) or skip (cascade).
 */
export type AuthoredBaseHeightClassification = {
  field: 'base_height' | '_base_height';
  storedValue: number | null;
  /** True iff the element has a legacy `base_height` that must be cleared when writing to `_base_height`. */
  hasLegacyBaseHeight: boolean;
};

function classifyAuthoredBaseHeight(element: Element): AuthoredBaseHeightClassification | null {
  const baseHeight = (element as { base_height?: unknown }).base_height;
  const hasBaseHeight = typeof baseHeight === 'number' && Number.isFinite(baseHeight);

  if (
    element.type === 'BuildingElementOpaque' ||
    element.type === 'BuildingElementTransparent' ||
    element.type === 'OnSiteGeneration'
  ) {
    return {
      field: 'base_height',
      storedValue: hasBaseHeight ? (baseHeight as number) : null,
      hasLegacyBaseHeight: false,
    };
  }

  if (
    element.type === 'ThermalBridgeLinear' ||
    element.type === 'ThermalBridgePoint' ||
    element.type === 'WaterPipework' ||
    element.type === 'MechanicalVentilationDuctwork'
  ) {
    return null;
  }

  {
    const viewer = (element as { _base_height?: unknown })._base_height;
    const hasViewer = typeof viewer === 'number' && Number.isFinite(viewer);
    const storedValue = hasViewer
      ? (viewer as number)
      : (
        element.type === 'BuildingElementAdjacentConditionedSpace' ||
        element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
        element.type === 'BuildingElementPartyWall'
      ) && hasBaseHeight
        ? (baseHeight as number)
        : null;
    // Ground only ever uses `_base_height`; the other adjacent/party types may have legacy `base_height`.
    const hasLegacy = (
      element.type === 'BuildingElementAdjacentConditionedSpace' ||
      element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
      element.type === 'BuildingElementPartyWall'
    ) && hasBaseHeight;
    return { field: '_base_height', storedValue, hasLegacyBaseHeight: hasLegacy };
  }
}

/**
 * Construct the canonical base_height patch for an element given its classification, the value
 * that previously lived on it, and the new base_height target. Routes opaque/transparent/PV to
 * `base_height` (and cascades window mid_height + window_part_list deltas), routes adjacent/party
 * to `_base_height` (clearing any legacy `base_height`), routes ground to `_base_height` directly.
 *
 * Shared by {@link calculateBaseHeightPatchForFloorMove} (element changes floor) and
 * {@link calculateBaseHeightPatchForFloorStackChange} (floor stack changes under the element).
 */
function buildBaseHeightPatch(
  element: Element,
  classification: AuthoredBaseHeightClassification,
  oldAuthoredValue: number,
  nextBaseHeight: number,
): FloorMoveBaseHeightPatch {
  if (classification.field === 'base_height') {
    return {
      base_height: nextBaseHeight,
      ...buildTransparentBaseHeightDependentPatch(element, oldAuthoredValue, nextBaseHeight),
    };
  }
  return classification.hasLegacyBaseHeight
    ? { _base_height: nextBaseHeight, base_height: undefined }
    : { _base_height: nextBaseHeight };
}

function isRoofLikeOpaqueBaseHeightPlaceholder(element: Element): boolean {
  if (element.type !== 'BuildingElementOpaque') return false;
  const baseHeight = (element as { base_height?: unknown }).base_height;
  if (typeof baseHeight !== 'number' || !Number.isFinite(baseHeight) || baseHeight !== 0) return false;
  const pitch = (element as { pitch?: unknown }).pitch;
  if (typeof pitch === 'number' && Number.isFinite(pitch)) {
    if (pitch === 0) return true;
    if (Math.abs(pitch - 90) < 1e-3) return false;
  }
  if ((element as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof) return true;
  const name = (element.name ?? '').trim().toLowerCase();
  return name === 'roof' || name.includes('roof');
}

function buildTransparentBaseHeightDependentPatch(
  element: Element,
  oldBaseHeight: number,
  newBaseHeight: number,
): FloorMoveBaseHeightPatch {
  if (element.type !== 'BuildingElementTransparent') return {};
  const patch: FloorMoveBaseHeightPatch = {};
  const delta = newBaseHeight - oldBaseHeight;
  const midHeight = (element as { mid_height?: unknown }).mid_height;
  if (typeof midHeight === 'number' && Number.isFinite(midHeight)) {
    patch.mid_height = roundToTwoDecimals(midHeight + delta);
  }

  const extraJson = element.extra_json;
  if (!extraJson || typeof extraJson !== 'object' || Array.isArray(extraJson)) return patch;
  const windowPartList = (extraJson as Record<string, unknown>).window_part_list;
  if (!Array.isArray(windowPartList)) return patch;

  let changed = false;
  const nextWindowPartList = windowPartList.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const mid = (entry as Record<string, unknown>).mid_height_air_flow_path;
    if (typeof mid !== 'number' || !Number.isFinite(mid)) return entry;
    changed = true;
    return {
      ...entry,
      mid_height_air_flow_path: roundToTwoDecimals(mid + delta),
    };
  });

  if (changed) {
    patch.extra_json = {
      ...extraJson,
      window_part_list: nextWindowPartList,
    };
  }
  return patch;
}

export function calculateBaseHeightPatchForFloorMove(
  element: Element,
  newFloorZ: number,
  floors: Floor[],
): FloorMoveBaseHeightPatch | null {
  const coordinates = element.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;

  if (isRoofLikeOpaqueBaseHeightPlaceholder(element)) {
    return { base_height: 0 };
  }

  const classification = classifyAuthoredBaseHeight(element);
  if (!classification) return null;

  const oldFloorZ = Math.floor(coordinates[0]?.z ?? 0);
  const oldFloorBaseHeight = calculateDerivedBaseHeight(oldFloorZ, floors);
  const newFloorBaseHeight = calculateDerivedBaseHeight(newFloorZ, floors);
  // Fall back to the old slab when the element has no authored value yet — preserves the
  // "starts flush with the floor" assumption used by `_base_height` for adjacent fabric.
  const currentBaseHeight = classification.storedValue ?? oldFloorBaseHeight;
  const heightAboveOldFloor = currentBaseHeight - oldFloorBaseHeight;
  const nextBaseHeight = roundToTwoDecimals(newFloorBaseHeight + heightAboveOldFloor);

  return buildBaseHeightPatch(element, classification, currentBaseHeight, nextBaseHeight);
}

/**
 * Tolerance (m) for treating two storey/base values as equal. Used by the floor picker dropdown
 * to (a) auto-clear `heightUserOverride` when the typed value matches the current wall-derived
 * storey height, and (b) decide whether to show the "stale override" warning when walls and the
 * stored override disagree.
 *
 * The floor-stack cascade itself preserves the offset above the old slab for every authored
 * `base_height` — it doesn't use this tolerance as a gate.
 */
export const BASE_HEIGHT_AUTOSYNC_TOLERANCE_M = 0.01;

/**
 * Tolerance for treating a zone's floorArea (m²) or height (m) as equal to its geometry-derived
 * value when deciding whether a submitted/loaded number is a user override. Lives here — beside
 * the derivations it compares against — so both the store's in-session inference and ioSlice's
 * legacy-import reconstruction share one constant without a store↔slice import cycle.
 */
export const ZONE_OVERRIDE_EPSILON = 0.005;

/**
 * Build a patch for one element when the floor stack height changes underneath it.
 *
 * **Preserves the offset above the old slab.** A wall sitting on the slab (offset 0) moves with
 * the slab; a window at slab + 0.9 m sill stays at new_slab + 0.9 m; a fabric authored at any
 * relative offset keeps that offset under the new floor stack. This matches the user's mental
 * model: `base_height` is a position relative to the floor, not an absolute elevation that
 * happens to coincide with the slab.
 *
 * For windows, also cascades dependent fields (`mid_height`,
 * `extra_json.window_part_list[].mid_height_air_flow_path`) by the same delta — see
 * {@link buildTransparentBaseHeightDependentPatch}.
 *
 * Returns null when:
 *   - the element has no coordinates,
 *   - it's a roof-like opaque placeholder (`base_height: 0` keeps that special meaning),
 *   - it's on the ground reference floor (Z = 0),
 *   - the effective slab for its floor didn't change, or
 *   - no `base_height` (or `_base_height`) has been authored yet (nothing to patch).
 */
export function calculateBaseHeightPatchForFloorStackChange(
  element: Element,
  oldFloors: Floor[],
  newFloors: Floor[],
): FloorMoveBaseHeightPatch | null {
  const coordinates = element.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
  if (isRoofLikeOpaqueBaseHeightPlaceholder(element)) return null;

  const floorZ = Math.floor(coordinates[0]?.z ?? 0);
  if (floorZ === 0) return null;

  const oldDerived = calculateDerivedBaseHeight(floorZ, oldFloors);
  const newDerived = calculateDerivedBaseHeight(floorZ, newFloors);
  if (Math.abs(newDerived - oldDerived) < 1e-4) return null;

  const classification = classifyAuthoredBaseHeight(element);
  // Skip elements that have never had a base_height authored — the 3D viewer derives
  // their elevation from Floor.height directly, so no patch is needed.
  if (!classification || classification.storedValue == null) return null;

  // Preserve the element's offset above the old slab. Same semantics as the floor-move helper,
  // applied to "the floor stack changed under this element".
  const offsetAboveOldSlab = classification.storedValue - oldDerived;
  const nextBaseHeight = roundToTwoDecimals(newDerived + offsetAboveOldSlab);

  return buildBaseHeightPatch(element, classification, classification.storedValue, nextBaseHeight);
}

/**
 * Same as {@link cascadeFloorStackChange} but driven by element changes (a wall added/updated/
 * removed). The floor *records* don't move — what changed is the wall heights elements derive
 * storey height from. Computes effective storey heights under both element sets and cascades
 * based on the diff. Returns an empty array when nothing needs patching (e.g. a non-wall element
 * was added/updated, so no floor's effective storey shifted).
 */
export function cascadeWallChangeIfAny(
  floors: Floor[],
  oldElements: Element[],
  newElements: Element[],
): Array<{ elementId: string; patch: FloorMoveBaseHeightPatch }> {
  const oldEff = withEffectiveStoreyHeights(floors, oldElements);
  const newEff = withEffectiveStoreyHeights(floors, newElements);
  const changed = oldEff.some((f, i) => f.height !== newEff[i]?.height);
  if (!changed) return [];
  return cascadeFloorStackChange(oldEff, newEff, newElements);
}

/**
 * Compute base_height cascade patches for every element affected by a floor-stack change.
 * Returns one entry per element that needs patching. Elements with no stored `base_height` /
 * `_base_height` are skipped (the viewer / cascade has nothing to update for them); all others
 * have their offset above the old slab preserved under the new slab — see
 * {@link calculateBaseHeightPatchForFloorStackChange}.
 */
export function cascadeFloorStackChange(
  oldFloors: Floor[],
  newFloors: Floor[],
  elements: Element[],
): Array<{ elementId: string; patch: FloorMoveBaseHeightPatch }> {
  const results: Array<{ elementId: string; patch: FloorMoveBaseHeightPatch }> = [];
  for (const el of elements) {
    const patch = calculateBaseHeightPatchForFloorStackChange(el, oldFloors, newFloors);
    if (patch) results.push({ elementId: el.id, patch });
  }
  return results;
}

/**
 * Suggested mid-height for a window opening (vertical centre of the ventilated opening).
 * Matches HEM usage: absolute elevation above ground, typically `base_height + height/2` for a vertical opening.
 */
export function calculateDerivedWindowMidHeight(baseHeightM: number, openingHeightM: number): number {
  if (!Number.isFinite(baseHeightM) || !Number.isFinite(openingHeightM)) return 0;
  if (openingHeightM <= 0) return 0;
  return roundToTwoDecimals(baseHeightM + openingHeightM / 2);
}

/**
 * Calculate a suggested zone height from line-drawn wall heights.
 * Only considers line walls (coordinates.length === 2) since polygon wall
 * heights are synthetic (sqrt(area)) and not physically meaningful.
 *
 * For single-storey zones: weighted average of wall heights (weighted by width).
 * For multi-storey zones: **mean** of each storey’s weighted-average wall height (typical storey height).
 *
 * Only vertical line walls (pitch unset or 90°) contribute. Horizontal and
 * pitched surfaces, polygon walls, windows, and external doors are excluded.
 *
 * Returns 0 when no suitable wall data is available.
 */
export function calculateDerivedHeight(zoneId: string, elements: Element[]): number {
  const perFloor = getPerFloorLineWallAverageHeights(zoneId, elements);
  if (perFloor.size === 0) return 0;
  const values = [...perFloor.values()];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return mean > 0 ? roundToTwoDecimals(mean) : 0;
}

/**
 * Derive zone properties from its child elements
 * - Floor area (TFA-oriented): sum of **all** qualifying storey floors — BuildingElementGround polygons
 *   **plus** walkable horizontal polygons (opaque / transparent / adjacent, **pitch 180°** only; not pitch 0°).
 * - Height: mean of each storey’s weighted-average **line-segment** wall height (2-point walls only)
 * - Volume: floor area × height (convention: total zone TFA × typical storey height — not a storey-by-storey integral)
 *
 * Returns updates object with derived metadata.
 * Auto-updates `floorArea` and `height` from geometry unless the respective user-override flag is set.
 * Note: Per-floor height breakdown is available for display via getVolumeCalculationBreakdown()
 */
export function deriveZoneProperties(zone: Zone, elements: Element[]): Partial<Zone> {
  const updates: Partial<Zone> = {};

  const { floorArea, areaSource } = calculateDerivedFloorArea(zone.id, elements);
  const currentArea = zone.floorArea || 0;

  // Always store the derived value and source so the UI can offer a reset button
  if (floorArea > 0) {
    updates._derivedFloorArea = floorArea;
    updates._areaSource = areaSource;
  }

  // Auto-update floorArea from geometry unless the user has explicitly overridden it.
  // When _floorAreaUserOverride is false/absent, the zone tracks geometry automatically.
  if (floorArea > 0 && !zone._floorAreaUserOverride) {
    updates.floorArea = floorArea;
  }

  // Track distinct Z-levels of ground elements for multi-floor validation
  const zoneElements = elements.filter(el => (el as any).zoneId === zone.id);
  const groundElements = zoneElements.filter(el => el.type === 'BuildingElementGround');
  if (groundElements.length > 0) {
    const zLevels = new Set<number>();
    for (const el of groundElements) {
      if (el.coordinates && el.coordinates.length > 0) {
        zLevels.add(Math.floor(el.coordinates[0].z));
      }
    }
    updates._groundFloorLevels = Array.from(zLevels).sort((a, b) => a - b);
  }

  // --- Height derivation (same pattern as floor area) ---
  const derivedHeight = calculateDerivedHeight(zone.id, elements);
  const currentHeight = zone.height || 0;

  // Always store the derived height so the UI can offer a reset button
  if (derivedHeight > 0) {
    updates._derivedHeight = derivedHeight;
  }

  // Auto-update height from wall elements unless the user has explicitly overridden it
  if (derivedHeight > 0 && !zone._heightUserOverride) {
    updates.height = derivedHeight;
  }

  // --- Volume calculation ---
  const effectiveFloorArea = zone._floorAreaUserOverride ? currentArea : (floorArea > 0 ? floorArea : currentArea);
  const effectiveHeight = zone._heightUserOverride ? currentHeight : (derivedHeight > 0 ? derivedHeight : currentHeight);

  if (effectiveHeight > 0 && effectiveFloorArea > 0) {
    const volume = effectiveFloorArea * effectiveHeight;
    updates.volume = roundToTwoDecimals(volume);
  }

  return updates;
}

/**
 * Generate volume calculation breakdown for tooltip display
 * Includes information about which method was used to calculate floor area
 */
export function getVolumeCalculationBreakdown(zone: Zone, elements: Element[]): string {
  const derived = calculateDerivedFloorArea(zone.id, elements);
  let floorArea = derived.floorArea;
  const areaSource: string | undefined = derived.areaSource ?? zone._areaSource;

  if (floorArea === 0 && zone.floorArea) {
    floorArea = zone.floorArea;
  }

  // Match calculateDerivedHeight: only line-segment walls (2 coords). Polygon “walls” are excluded.
  const perFloorHeights = getPerFloorLineWallAverageHeights(zone.id, elements);
  const meanZoneHeightFromElements =
    perFloorHeights.size === 0
      ? 0
      : [...perFloorHeights.values()].reduce((a, b) => a + b, 0) / perFloorHeights.size;

  const breakdown: string[] = [];
  const sortedFloors = [...perFloorHeights.entries()].sort((a, b) => a[0] - b[0]);
  for (const [floorZ, avgM] of sortedFloors) {
    breakdown.push(`  Z=${floorZ}: ${avgM.toFixed(2)} m (line-wall average)`);
  }

  // Use zone's height directly (matching Rust logic)
  const zoneHeight = zone.height || 0;
  const volume = floorArea * zoneHeight;

  let result = `${zone.name} Volume Calculation:\n`;
  result += `${floorArea.toFixed(1)}m² × ${zoneHeight.toFixed(2)}m = ${volume.toFixed(1)}m³\n`;

  // Show area source if available
  if (areaSource) {
    result += `\nFloor area source: ${areaSource}`;
  }

  result += `\n`;

  // Show per-floor breakdown as informational (calculated from elements, but not used for volume)
  if (breakdown.length > 0) {
    result += `Per-storey line-wall heights (same basis as derived zone height; polygon walls excluded):\n`;
    result += `Mean ≈ ${meanZoneHeightFromElements.toFixed(2)} m · volume uses zone height (${zoneHeight.toFixed(2)} m)\n`;
    result += breakdown.join('\n');
  }

  return result;
}
