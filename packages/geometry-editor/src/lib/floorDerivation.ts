// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Floor } from '../geometry/types';
import type {
  FloorBaseHeightOverrideRow,
  FloorHeightOverrideRow,
} from '../geometry/io/parseCsvToGeometry';
import {
  FLOOR_BASE_HEIGHT_OVERRIDE_DESCRIPTOR,
  FLOOR_HEIGHT_OVERRIDE_DESCRIPTOR,
} from './overrideProvenance';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function deriveFloorsFromElements(elements: Element[]): Floor[] {
  const zValues = new Set<number>([0]);
  for (const element of elements) {
    for (const coord of element.coordinates ?? []) {
      if (isFiniteNumber(coord.z)) zValues.add(Math.floor(coord.z));
    }
  }
  return [...zValues]
    .sort((a, b) => a - b)
    .map((zIndex) => ({
      id: String(zIndex),
      name: zIndex === 0 ? 'Ground Floor' : `Floor ${zIndex}`,
      zIndex,
      height: 0,
      isRoofSpace: false,
    }));
}

/**
 * Reconciles a fresh floor set against persisted `FloorHeightOverride` CSV metadata rows
 * (`ParsedCsvMetadata.floorHeightOverrides`), matching by `zIndex`. A floor with a matching row
 * gets its stored height pinned (`heightUserOverride: true`) so `getEffectiveStoreyHeight` uses it
 * instead of deriving from walls; every other floor has the flag cleared, since the input floor set
 * is always the complete set for the document being reconciled and must not carry forward a stale
 * override from elsewhere.
 *
 * Shared by `ioSlice`'s `loadFromCSV` (the primary editor model) and
 * `parseDevelopmentContextModel` (read-only neighbour models for context shading) — both parse the
 * same CSV shape and need identical reconciliation over a freshly derived floor list.
 */
export function applyFloorHeightOverrides(
  floors: Floor[],
  overrides: readonly FloorHeightOverrideRow[],
): Floor[] {
  const overrideHeightByZIndex = new Map(overrides.map((override) => [override.zIndex, override.height]));
  return floors.map((floor) => {
    const height = overrideHeightByZIndex.get(floor.zIndex);
    if (height !== undefined) {
      return { ...floor, height, [FLOOR_HEIGHT_OVERRIDE_DESCRIPTOR.flag]: true };
    }
    return floor[FLOOR_HEIGHT_OVERRIDE_DESCRIPTOR.flag]
      ? { ...floor, [FLOOR_HEIGHT_OVERRIDE_DESCRIPTOR.flag]: false }
      : floor;
  });
}

/** Apply persisted explicit floor base elevations; old models without these rows retain derived bases. */
export function applyFloorBaseHeightOverrides(
  floors: Floor[],
  overrides: readonly FloorBaseHeightOverrideRow[],
): Floor[] {
  const overrideBaseByZIndex = new Map(overrides.map((override) => [override.zIndex, override.baseHeight]));
  return floors.map((floor) => {
    const baseHeight = overrideBaseByZIndex.get(floor.zIndex);
    if (baseHeight !== undefined) {
      return {
        ...floor,
        baseHeight,
        [FLOOR_BASE_HEIGHT_OVERRIDE_DESCRIPTOR.flag]: true,
      };
    }
    if (floor[FLOOR_BASE_HEIGHT_OVERRIDE_DESCRIPTOR.flag] || floor.baseHeight !== undefined) {
      const withoutBase = { ...floor };
      delete withoutBase.baseHeight;
      delete withoutBase.baseHeightUserOverride;
      return withoutBase;
    }
    return floor;
  });
}
