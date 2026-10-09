// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Floor } from '../geometry/types';
import { roundToTwoDecimals } from '../geometry/constants';

/** Storey index (..., -1, 0, 1, 2, …) in `extra_json.floor_id` for TB / pipework / ductwork — not `Floor.id`. Legacy CSV may still carry string `Floor.id`. */
export const THERMAL_BRIDGE_EXTRA_JSON_FLOOR_ID_KEY = 'floor_id' as const;

export type CanvasFloorListEntry = { id: string; zIndex: number };

/** Storey index from coordinate z (handles CSV strings like `"0"` vs number `0`). */
export function normalizeStoreyIndex(z: unknown): number | undefined {
  if (z === null || z === undefined) return undefined;
  if (typeof z === 'string' && z.trim() === '') return undefined;
  const n = Number(z);
  if (!Number.isFinite(n)) return undefined;
  return Math.floor(n);
}

export function parseExtraJsonRecord(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw) as unknown;
      return o && typeof o === 'object' ? (o as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return undefined;
}

/**
 * Element types whose coordinate `z` is physical metres, so the canvas storey must come
 * from `extra_json.floor_id` / `floorId` instead. Every other type stores z as a storey index
 * (`floor(z)`), including point elements such as MVHR units, plant, emitters and outlets.
 */
export function physicalZUsesFloorId(element: Pick<Element, 'type'>): boolean {
  return (
    element.type === 'ThermalBridgeLinear' ||
    element.type === 'ThermalBridgePoint' ||
    element.type === 'WaterPipework' ||
    element.type === 'MechanicalVentilationDuctwork' ||
    element.type === 'MechanicalVentilationTerminal'
  );
}

/**
 * A point element whose stored z is a storey index (units, plant, emitters, outlets): its physical
 * position is its storey's base height, which is where ducts and pipes drawn from it start.
 */
export function isStoreyIndexPoint(element: Pick<Element, 'type' | 'coordinates'>): boolean {
  return element.coordinates?.length === 1 && !physicalZUsesFloorId(element);
}

/**
 * An element's first point in physical metres, for connectivity with ducts and pipes: a
 * storey-index point sits at its storey's base height; metre-z types are returned unchanged.
 * `effectiveFloors` must carry effective storey heights (`withEffectiveStoreyHeights`).
 */
export function networkPoint3(
  element: Pick<Element, 'type' | 'coordinates' | 'floorId'>,
  effectiveFloors: Floor[],
): { x: number; y: number; z: number } | undefined {
  const point = element.coordinates?.[0];
  if (!point || ![point.x, point.y, point.z].every(Number.isFinite)) return undefined;
  if (!isStoreyIndexPoint(element)) return { x: point.x, y: point.y, z: point.z };
  const storey = getElementCanvasFloorZValue(element as Element, effectiveFloors)!; // z is finite, so defined
  return { x: point.x, y: point.y, z: calculateDerivedBaseHeight(storey, effectiveFloors) };
}

/**
 * Parse persisted `extra_json.floor_id`: preferred **integer storey index**; legacy **Floor.id** string
 * when `floors` is provided for lookup.
 */
export function parsePersistedExtraJsonFloorStorey(
  raw: unknown,
  floors?: CanvasFloorListEntry[],
): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.floor(raw);
    return n;
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return undefined;
    if (/^-?\d+$/.test(t)) {
      const n = parseInt(t, 10);
      return Number.isFinite(n) ? n : undefined;
    }
    if (floors?.length) {
      const m = floors.find((f) => f.id === t);
      if (m) return m.zIndex;
    }
    return undefined;
  }
  return undefined;
}

/**
 * Storey index from `extra_json.floor_id` for service lines when `floors` is known (numeric + legacy id).
 */
function serviceStoreyIndexFromExtraJson(
  element: Element,
  floors: CanvasFloorListEntry[] | undefined,
): number | undefined {
  if (!physicalZUsesFloorId(element) || !floors?.length) return undefined;
  const ex = parseExtraJsonRecord((element as { extra_json?: unknown }).extra_json);
  const raw = ex?.[THERMAL_BRIDGE_EXTRA_JSON_FLOOR_ID_KEY];
  return parsePersistedExtraJsonFloorStorey(raw, floors);
}

function floorIdStoreyIndex(
  element: Element,
  floors: CanvasFloorListEntry[] | undefined,
): number | undefined {
  const fid =
    typeof (element as { floorId?: string }).floorId === 'string'
      ? (element as { floorId: string }).floorId.trim()
      : '';
  if (!fid) return undefined;
  if (floors?.length) {
    const match = floors.find((f) => f.id === fid);
    if (match) return match.zIndex;
  }
  const numeric = Number(fid);
  return Number.isFinite(numeric) ? Math.floor(numeric) : undefined;
}

/**
 * First-coordinate storey index for the canvas (empty geometry -> ground `0`).
 * Uses {@link normalizeStoreyIndex} so string/number match the draw-toolbar integer.
 *
 * For thermal bridges, service lines, and MVHR terminals, `floorId` is canvas/storey membership and coordinate `z` is physical metres.
 * For service lines, when `floors` is passed and `extra_json.floor_id` matches a floor id,
 * that floor's `zIndex` wins over `Math.floor(coordinates[0].z)` (which may be absolute metres).
 * If `floor_id` is absent but top-level `floorId` is set, that floor's `zIndex` is used; coordinate
 * `z` is never interpreted as a storey index for these physical-Z elements.
 */
export function getElementCanvasFloorZValue(
  element: Element,
  floors?: CanvasFloorListEntry[],
): number | undefined {
  const fromService = serviceStoreyIndexFromExtraJson(element, floors);
  if (fromService !== undefined) return fromService;

  if (element.type === 'MechanicalVentilationTerminal') {
    const fromFloorId = floorIdStoreyIndex(element, floors);
    return fromFloorId ?? 0;
  }

  if (element.type === 'Vents' || element.type === 'MechanicalVentilation') {
    const fromFloorId = floorIdStoreyIndex(element, floors);
    if (fromFloorId !== undefined) return fromFloorId;
  }

  if (physicalZUsesFloorId(element) && floors?.length) {
    const fromFloorId = floorIdStoreyIndex(element, floors);
    if (fromFloorId !== undefined) return fromFloorId;
    return 0;
  }

  const coordinates = element.coordinates || [];
  if (coordinates.length === 0) return 0;
  const raw = coordinates[0].z;
  const n = normalizeStoreyIndex(raw);
  return n === undefined ? undefined : n;
}

/**
 * Active floor when the element's effective storey index matches `currentFloorZ` (after normalization).
 */
export function isElementOnActiveCanvasFloor(
  element: Element,
  currentFloorZ: number | undefined,
  floors?: CanvasFloorListEntry[],
): boolean {
  if (currentFloorZ === undefined) return true;
  const elementZ = getElementCanvasFloorZValue(element, floors);
  const cur = normalizeStoreyIndex(currentFloorZ);
  if (cur === undefined) return true;
  if (elementZ === undefined) return false;
  return elementZ === cur;
}

/** Raw `extra_json.floor_id` value (number, legacy string id, or numeric string). */
export function getExtraJsonFloorIdRaw(element: Element): unknown {
  const ex = parseExtraJsonRecord((element as { extra_json?: unknown }).extra_json);
  return ex?.[THERMAL_BRIDGE_EXTRA_JSON_FLOOR_ID_KEY];
}

/** Resolved storey index from `extra_json.floor_id` for TB / pipework / ductwork (number, numeric string, legacy floor row id). */
export function getThermalBridgeExtraJsonFloorStorey(
  element: Element,
  floors?: CanvasFloorListEntry[],
): number | undefined {
  if (!physicalZUsesFloorId(element)) return undefined;
  const ex = parseExtraJsonRecord((element as { extra_json?: unknown }).extra_json);
  const raw = ex?.[THERMAL_BRIDGE_EXTRA_JSON_FLOOR_ID_KEY];
  return parsePersistedExtraJsonFloorStorey(raw, floors);
}

/**
 * Merge `extra_json` with canonical **storey index** (`floor_id` number) for TB / service lines.
 * Does not change metre elevations in `coordinates`.
 */
export function mergeThermalBridgeExtraJsonFloorId(
  element: Element,
  storeyIndex: number,
): Record<string, unknown> {
  const raw = (element as { extra_json?: unknown }).extra_json;
  let base: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      base = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      base = {};
    }
  } else if (raw && typeof raw === 'object') {
    base = { ...(raw as Record<string, unknown>) };
  }
  const n = Math.floor(storeyIndex);
  return {
    ...base,
    [THERMAL_BRIDGE_EXTRA_JSON_FLOOR_ID_KEY]: Number.isFinite(n) ? n : 0,
  };
}

export const mergeServiceLineExtraJsonFloorId = mergeThermalBridgeExtraJsonFloorId;

/**
 * CSV load: canonical storey index for pipework, ductwork, and thermal-bridge points — prefers
 * `extra_json.floor_id` (integer or legacy `Floor.id` resolved via `floors`), otherwise
 * `Math.floor(coordinates[0].z)` (legacy; z may be physical metres for horizontal runs).
 */
export function resolvePhysicalZElementStoreyForCsvLoad(
  element: Element,
  floors: CanvasFloorListEntry[],
): number {
  const raw = getExtraJsonFloorIdRaw(element);
  const fromExtra = parsePersistedExtraJsonFloorStorey(raw, floors);
  if (fromExtra !== undefined) return fromExtra;
  const coords = (element as { coordinates?: Array<{ z?: unknown }> }).coordinates;
  const z0 = coords && coords.length > 0 ? coords[0]!.z : 0;
  const n = normalizeStoreyIndex(z0);
  return n === undefined ? 0 : n;
}

/**
 * Calculate the derived base_height for an element based on its Z-level.
 *
 * base_height = the height above ground of the bottom of the element.
 * Computed from an explicit floor base when present, otherwise as the cumulative sum of
 * `floor.height` for every floor below the element's floor.
 *
 * `floor.height` here is expected to be the *effective* storey height — callers should pre-process
 * with {@link withEffectiveStoreyHeights} so wall-derived heights and user overrides are baked in.
 *
 * For Z=0: returns the explicit F1 base when present, otherwise 0.
 * For Z=N (N>=1): uses the explicit base for FN when present, otherwise the stack below it.
 * For Z=-N: uses the explicit base for F-N when present, otherwise the stack above it.
 * Missing floors contribute 0 — callers should `ensureFloorForZ` first. For user-facing base
 * elevation display and validation, use {@link getCumulativeBaseHeightsByFloorId}, which keeps
 * an unresolved base distinct from a real zero elevation.
 */
export function calculateDerivedBaseHeight(
  elementZ: number,
  floors: Floor[],
): number {
  const floorZIndex = Math.floor(elementZ);
  const floorByZ = new Map(floors.map((floor) => [floor.zIndex, floor]));
  const explicitBase = (floor: Floor | undefined): number | undefined => {
    if (!floor || floor.baseHeightUserOverride !== true) return undefined;
    return Number.isFinite(floor.baseHeight) ? floor.baseHeight : undefined;
  };
  const heightOf = (floor: Floor | undefined): number =>
    floor && Number.isFinite(floor.height) && floor.height > 0 ? floor.height : 0;

  let baseHeight = explicitBase(floorByZ.get(0)) ?? 0;
  if (floorZIndex === 0) return roundToTwoDecimals(baseHeight);

  if (floorZIndex > 0) {
    for (let z = 0; z < floorZIndex; z++) {
      const floor = floorByZ.get(z);
      baseHeight = explicitBase(floor) ?? baseHeight;
      baseHeight += heightOf(floor);
    }
    return roundToTwoDecimals(explicitBase(floorByZ.get(floorZIndex)) ?? baseHeight);
  }

  for (let z = -1; z >= floorZIndex; z--) {
    const floor = floorByZ.get(z);
    baseHeight = explicitBase(floor) ?? baseHeight - heightOf(floor);
  }
  return roundToTwoDecimals(baseHeight);
}
