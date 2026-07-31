// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Build and compare "document" snapshots used for undo history.
 * Version counters (`_v` on elements) are ignored so echo updates that only bump
 * revision still compare equal to the history head.
 */

export type HistoryDocumentSnapshot = {
  elementsById: Record<string, unknown>;
  elementIds: string[];
  zones: unknown[];
  floors: unknown[];
  floorIds: string[];
  currentFloorId: string | null;
  spaceLabelsById?: Record<string, unknown>;
  spaceLabelIds?: string[];
};

export function buildHistoryDocumentSnapshotFromState(
  s: HistoryDocumentSnapshotInput,
): HistoryDocumentSnapshot {
  return {
    elementsById: JSON.parse(JSON.stringify(s.elementsById)) as Record<string, unknown>,
    elementIds: JSON.parse(JSON.stringify(s.elementIds)) as string[],
    zones: JSON.parse(JSON.stringify(s.zones)) as unknown[],
    floors: JSON.parse(JSON.stringify(s.floors)) as unknown[],
    floorIds: JSON.parse(JSON.stringify(s.floorIds)) as string[],
    currentFloorId: s.currentFloorId,
    spaceLabelsById: JSON.parse(JSON.stringify(s.spaceLabelsById ?? {})) as Record<string, unknown>,
    spaceLabelIds: JSON.parse(JSON.stringify(s.spaceLabelIds ?? [])) as string[],
  };
}

type HistoryDocumentSnapshotInput = {
  elementsById: unknown;
  elementIds: unknown;
  zones: unknown;
  floors: unknown;
  floorIds: unknown;
  currentFloorId: string | null;
  spaceLabelsById?: unknown;
  spaceLabelIds?: unknown;
};

/**
 * Stabilize key order for deterministic stringify (plain objects, arrays, primitives).
 */
function stableStringifyForCompare(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    // Preserve array order; contents stabilized recursively
    return `[${(v as unknown[]).map(stableStringifyForCompare).join(',')}]`;
  }
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys
    .map((k) => {
      if (k === '_v') {
        return null;
      }
      return `${JSON.stringify(k)}:${stableStringifyForCompare(o[k])}`;
    })
    .filter((x) => x !== null)
    .join(',')}}`;
}

/**
 * Canonical form for equality: stable key order, `_v` keys omitted at any depth, zone/floor
 * / id lists sorted so order does not create false differences.
 */
function normalizeForHistoryCompare(doc: HistoryDocumentSnapshot): string {
  const eid = JSON.parse(JSON.stringify(doc.elementsById)) as Record<string, unknown>;
  const withSortedIds = [...doc.elementIds].sort();
  const z = (
    JSON.parse(JSON.stringify(doc.zones)) as Array<{
      id?: string;
    }>
  ).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const f = (
    JSON.parse(JSON.stringify(doc.floors)) as Array<{
      id?: string;
    }>
  ).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const fid = [...doc.floorIds].sort();
  const slIds = [...(doc.spaceLabelIds ?? [])].sort();
  const slById = JSON.parse(JSON.stringify(doc.spaceLabelsById ?? {})) as Record<string, unknown>;
  const head = {
    currentFloorId: doc.currentFloorId,
    elementIds: withSortedIds,
    elementsById: eid,
    floorIds: fid,
    floors: f,
    zones: z,
    spaceLabelIds: slIds,
    spaceLabelsById: slById,
  };
  return stableStringifyForCompare(head);
}

/**
 * True when the two snapshots represent the same user-visible document
 * (ignores per-element `_v` and ordering of list-like collections).
 */
export function historyDocumentSnapshotsContentEqual(
  a: HistoryDocumentSnapshot,
  b: HistoryDocumentSnapshot,
): boolean {
  return normalizeForHistoryCompare(a) === normalizeForHistoryCompare(b);
}
