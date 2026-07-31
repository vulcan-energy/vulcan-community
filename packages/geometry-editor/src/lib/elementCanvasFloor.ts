// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../stores/geometryStore';

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
 * from `extra_json.floor_id` / `floorId` instead. Exported for `elementFloorZIndexForTb`,
 * which needs to know the canvas path already honours `floorId` for these types.
 */
export function physicalZUsesFloorId(element: Element): boolean {
  return (
    element.type === 'ThermalBridgeLinear' ||
    element.type === 'ThermalBridgePoint' ||
    element.type === 'WaterPipework' ||
    element.type === 'MechanicalVentilationDuctwork'
  );
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
