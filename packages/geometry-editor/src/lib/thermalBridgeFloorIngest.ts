// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { BuildingElementGround, Element, ThermalBridgeLinear } from '../geometry/types';
import { storeyZIndexFromHostElementFirstZ } from '../geometry/thermalBridge/resolveTbHostFloorId';
import { isBasementGroundElement } from './basementGeometry';
import type { CanvasFloorListEntry } from './elementCanvasFloor';
import {
  getExtraJsonFloorIdRaw,
  parseExtraJsonRecord,
  parsePersistedExtraJsonFloorStorey,
} from './elementCanvasFloor';
import { syncThermalBridgeLinearLengthFromCoordinates } from './thermalBridgeLinearGeometry';

function findThermalBridgeHostByParentName(tb: Element, allElements: Element[]): Element | undefined {
  const pname = typeof tb.parent_element === 'string' ? tb.parent_element.trim() : '';
  if (!pname || !tb.zoneId) return undefined;
  return allElements.find(
    (e) =>
      e.zoneId === tb.zoneId &&
      'name' in e &&
      String((e as { name?: string }).name ?? '').trim() === pname,
  );
}

function invalidateFloorMatchIfHostStoreyMismatch(
  match: CanvasFloorListEntry | undefined,
  hostStorey: number | undefined,
  allowHostStoreyMismatch = false,
): CanvasFloorListEntry | undefined {
  if (allowHostStoreyMismatch) return match;
  if (!match || hostStorey === undefined) return match;
  return match.zIndex === hostStorey ? match : undefined;
}

function thermalBridgeJunctionType(tb: Element): string | undefined {
  const ex = parseExtraJsonRecord((tb as { extra_json?: unknown }).extra_json);
  const raw = ex?.junction_type;
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : undefined;
}

function allowFloorStoreyMismatchForHost(tb: Element, host: Element | undefined): boolean {
  return (
    thermalBridgeJunctionType(tb) === 'E22' &&
    host?.type === 'BuildingElementGround' &&
    isBasementGroundElement(host as BuildingElementGround)
  );
}

/**
 * After CSV/import hosts exist in `floors`, resolve the **storey index** for a linear TB:
 * 1) `extra_json.floor_id` (**integer storey**, or legacy `Floor.id` string looked up via `floors`) when it matches host storey
 * 2) else parent host's `floorId` when it matches host storey
 * 3) else `Math.floor(host.coordinates[0].z)`
 *
 * Ignores a matched persisted value when the resolved floor's `zIndex` disagrees with the host fabric storey
 * (duplicate legacy string `floor_id` on many rows).
 *
 * Callers should run `ensureFloorForZ(storey)` for `element.floorId` and `mergeThermalBridgeExtraJsonFloorId(…, storey)`.
 */
export function resolveThermalBridgeLinearFloorIdAfterHostsReady(
  tb: Element,
  allElements: Element[],
  floors: CanvasFloorListEntry[],
): number {
  if (tb.type !== 'ThermalBridgeLinear') {
    return 0;
  }
  const host = findThermalBridgeHostByParentName(tb, allElements);
  const hostStorey =
    host !== undefined ? storeyZIndexFromHostElementFirstZ(host) : undefined;
  const allowHostStoreyMismatch = allowFloorStoreyMismatchForHost(tb, host);

  const raw = getExtraJsonFloorIdRaw(tb);
  const storeyFromJson = parsePersistedExtraJsonFloorStorey(raw, floors);
  let match =
    storeyFromJson !== undefined ? floors.find((f) => f.zIndex === storeyFromJson) : undefined;
  match = invalidateFloorMatchIfHostStoreyMismatch(match, hostStorey, allowHostStoreyMismatch);
  if (allowHostStoreyMismatch && storeyFromJson !== undefined && !match) {
    return storeyFromJson;
  }

  const hostFid = resolveThermalBridgeHostFloorId(tb, allElements)?.trim();
  if (!match && hostFid) {
    match = floors.find((f) => f.id === hostFid);
  }
  match = invalidateFloorMatchIfHostStoreyMismatch(match, hostStorey, allowHostStoreyMismatch);

  if (match) {
    return match.zIndex;
  }

  const hz = host?.coordinates?.[0]?.z;
  const storey =
    typeof hz === 'number' && Number.isFinite(hz) ? Math.floor(hz) : 0;
  return storey;
}

/**
 * Host `floorId` when `parent_element` names an element in the same zone (does not read `extra_json.floor_id`).
 */
export function resolveThermalBridgeHostFloorId(tb: Element, allElements: Element[]): string | undefined {
  if (tb.type !== 'ThermalBridgeLinear') return undefined;
  const host = findThermalBridgeHostByParentName(tb, allElements);
  const fid =
    host && 'floorId' in host && typeof (host as { floorId?: string }).floorId === 'string'
      ? (host as { floorId: string }).floorId.trim()
      : undefined;
  return fid || undefined;
}

/** CSV / migration: sync `length` from coordinates (floor membership is set in `loadFromCSV` / `addElement`). */
export function ingestThermalBridgeLinearPostParse(tb: ThermalBridgeLinear, _allElements: Element[]): void {
  void _allElements;
  const len = syncThermalBridgeLinearLengthFromCoordinates(tb);
  if (len > 0) (tb as any).length = len;
}
