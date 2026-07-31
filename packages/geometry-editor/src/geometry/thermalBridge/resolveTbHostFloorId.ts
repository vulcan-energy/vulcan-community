// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../types';

/**
 * Host element `floorId` for auto-TB proposals (legacy lookup path before storey index).
 * Synthetic `openingId`s (`wgcont:…`, `wicont:…`, `corner:…`) map to the underlying wall element.
 */
export function resolveHostFloorIdForTbProposal(
  row: { openingId: string; zoneId?: string; parentElementForTb?: string | null },
  elementsById: Record<string, Element>,
): string | undefined {
  const oid = row.openingId;
  if (!oid) return undefined;

  if (oid.startsWith('wgcont:') || oid.startsWith('wicont:')) {
    const prefix = oid.startsWith('wgcont:') ? 'wgcont:' : 'wicont:';
    const wallId = oid.slice(prefix.length).split(':')[0];
    if (!wallId) return undefined;
    const w = elementsById[wallId];
    const fid = w?.floorId?.trim();
    return fid || undefined;
  }

  if (oid.startsWith('corner:')) {
    const zoneId = row.zoneId;
    const parentName = row.parentElementForTb?.trim();
    if (!parentName || !zoneId) return undefined;
    const wall = Object.values(elementsById).find(
      (e) =>
        e.type === 'BuildingElementOpaque' &&
        e.zoneId === zoneId &&
        e.name === parentName,
    );
    const fid = wall?.floorId?.trim();
    return fid || undefined;
  }

  const opening = elementsById[oid];
  const fid = opening?.floorId?.trim();
  return fid || undefined;
}

/**
 * **Storey index** from a fabric host’s first coordinate: same convention as `addElement` for
 * non–physical-z elements (integer **z** 0, 1, 2, … in metres encodes the canvas storey).
 * Example (tb_test_2): walls/slabs at 0.000 → 0; lower pitched + unheated at 1.000 → 1;
 * upper tier + flat roof at 2.000 → 2.
 */
export function storeyZIndexFromHostElementFirstZ(host: Element): number | undefined {
  const c = (host as { coordinates?: Array<{ z?: number }> }).coordinates;
  if (!c || c.length < 1) return undefined;
  const z0 = c[0]!.z;
  if (typeof z0 !== 'number' || !Number.isFinite(z0)) return undefined;
  return Math.floor(z0);
}

/**
 * Finds the fabric host for an auto-TB line: `parent_element` in zone when set, else synthetic
 * opening ids, else the `openingId` element (e.g. roof opaque, window).
 */
export function findHostElementForAutoTbProposal(
  row: {
    openingId: string;
    zoneId?: string;
    parentElementForTb?: string | null;
  },
  elementsById: Record<string, Element>,
): Element | undefined {
  const zoneId = row.zoneId?.trim();
  const parentName = row.parentElementForTb !== undefined && row.parentElementForTb !== null
    ? String(row.parentElementForTb).trim()
    : '';
  if (parentName && zoneId) {
    const byName = Object.values(elementsById).find(
      (e) => e.zoneId === zoneId && 'name' in e && String((e as { name?: string }).name ?? '').trim() === parentName,
    );
    if (byName) return byName;
  }

  const oid = row.openingId;
  if (!oid) return undefined;

  if (oid.startsWith('wgcont:') || oid.startsWith('wicont:')) {
    const prefix = oid.startsWith('wgcont:') ? 'wgcont:' : 'wicont:';
    const wallId = oid.slice(prefix.length).split(':')[0];
    return wallId ? elementsById[wallId] : undefined;
  }

  if (oid.startsWith('corner:') && parentName && zoneId) {
    return Object.values(elementsById).find(
      (e) =>
        e.type === 'BuildingElementOpaque' &&
        e.zoneId === zoneId &&
        (e as { name?: string }).name === parentName,
    );
  }

  return elementsById[oid];
}

export type FloorsForAutoTbStorey = ReadonlyArray<{ id: string; zIndex: number }>;

/**
 * Storey index for `extra_json.floor_id` on an auto-suggested TB: **host** `coordinates[0].z`
 * (0, 1, 2, …), not κ-line height in metres. If the host has no vertex z, maps legacy on-element
 * `floorId` via `floors` when possible.
 */
export function resolveFloorStoreyIndexForAutoTbFromHostZ(
  row: {
    openingId: string;
    zoneId?: string;
    parentElementForTb?: string | null;
  },
  elementsById: Record<string, Element>,
  floors: FloorsForAutoTbStorey,
): number | undefined {
  const host = findHostElementForAutoTbProposal(row, elementsById);
  if (host) {
    const zIdx = storeyZIndexFromHostElementFirstZ(host);
    if (zIdx !== undefined) return zIdx;
  }
  const legacyFid = resolveHostFloorIdForTbProposal(row, elementsById)?.trim();
  if (legacyFid && floors.length > 0) {
    const m = floors.find((f) => f.id === legacyFid);
    if (m) return m.zIndex;
  }
  return undefined;
}

export type CornerHostWallIdsForTb = readonly [string | undefined | null, string | undefined | null] | undefined;

export type AutoTbProposalHostIdentityRow = {
  openingId: string;
  zoneId?: string;
  parentElementForTb?: string | null;
  cornerHostWallIds?: CornerHostWallIdsForTb;
  /** Generic pair of fabric host ids for two-element junctions. */
  hostElementIds?: readonly [string, string];
  /** R8/R9: roof opaque id + adjacent vertical segment id. */
  roofAdjacentPairIds?: readonly [string, string];
};

function trimmedPair(ids: readonly [string | undefined | null, string | undefined | null] | undefined): readonly [string, string] | undefined {
  const a = ids?.[0]?.trim();
  const b = ids?.[1]?.trim();
  return a && b ? [a, b] : undefined;
}

function addPairToSet(set: Set<string>, ids: readonly [string, string] | undefined): void {
  if (!ids) return;
  set.add(ids[0]);
  set.add(ids[1]);
}

export function explicitHostPairIdsForAutoTbProposal(
  row: AutoTbProposalHostIdentityRow,
): readonly [string, string] | undefined {
  return (
    trimmedPair(row.hostElementIds) ??
    trimmedPair(row.roofAdjacentPairIds) ??
    trimmedPair(row.cornerHostWallIds)
  );
}

export function knownHostElementIdsForAutoTbProposal(
  row: AutoTbProposalHostIdentityRow,
  elementsById: Record<string, Element>,
): Set<string> {
  const ids = new Set<string>();
  if (row.openingId && elementsById[row.openingId]) ids.add(row.openingId);
  addPairToSet(ids, trimmedPair(row.hostElementIds));
  addPairToSet(ids, trimmedPair(row.roofAdjacentPairIds));
  addPairToSet(ids, trimmedPair(row.cornerHostWallIds));
  return ids;
}

/**
 * Persist `extra_json.thermal_bridge_source` with stable host element ids for solver downstream.
 * The serialized field names are legacy (`host_wall_id` / `host_wall_b_id`), but the values are
 * host element ids: roof, wall, floor, party wall, adjacent segment, etc.
 */
export function thermalBridgeSourceExtraJsonForAutoProposal(
  row: AutoTbProposalHostIdentityRow,
  elementsById: Record<string, Element>,
): { host_wall_id: string; host_wall_b_id?: string } | undefined {
  const pair = explicitHostPairIdsForAutoTbProposal(row);
  if (pair) {
    return {
      host_wall_id: pair[0],
      host_wall_b_id: pair[1],
    };
  }
  const host = findHostElementForAutoTbProposal(row, elementsById);
  if (host?.id) {
    return { host_wall_id: host.id };
  }
  return undefined;
}
