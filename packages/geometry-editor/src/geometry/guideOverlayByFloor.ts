// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { GuideOverlay, GuideOverlaySource } from './guideOverlay';

export type GuideOverlayByFloor = Record<number, GuideOverlay>;
export type GuideOverlaySourceByFloor = Record<number, GuideOverlaySource>;

export type ResolvedGuideOverlay<T> = {
  value: T | null;
  ownedByActiveFloor: boolean;
  inheritedFromFloor: number | null;
};

const numericFloorKeys = (byFloor: Record<number, unknown>): number[] =>
  Object.keys(byFloor)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n));

const resolve = <T>(byFloor: Record<number, T>, floorZ: number): ResolvedGuideOverlay<T> => {
  if (!byFloor || Object.keys(byFloor).length === 0) {
    return { value: null, ownedByActiveFloor: false, inheritedFromFloor: null };
  }
  if (Object.prototype.hasOwnProperty.call(byFloor, floorZ)) {
    return { value: byFloor[floorZ]!, ownedByActiveFloor: true, inheritedFromFloor: null };
  }
  const keys = numericFloorKeys(byFloor);
  const below = keys.filter((k) => k < floorZ).sort((a, b) => b - a)[0];
  if (below !== undefined) {
    return { value: byFloor[below]!, ownedByActiveFloor: false, inheritedFromFloor: below };
  }
  // No record at or below the active floor — fall back to nearest above so a freshly
  // imported overlay placed on an upper floor stays visible when scrolling down.
  const above = keys.filter((k) => k > floorZ).sort((a, b) => a - b)[0];
  if (above !== undefined) {
    return { value: byFloor[above]!, ownedByActiveFloor: false, inheritedFromFloor: above };
  }
  return { value: null, ownedByActiveFloor: false, inheritedFromFloor: null };
};

export const resolveGuideOverlayForFloor = (
  byFloor: GuideOverlayByFloor,
  floorZ: number,
): ResolvedGuideOverlay<GuideOverlay> => resolve(byFloor, floorZ);

export const resolveGuideOverlaySourceForFloor = (
  byFloor: GuideOverlaySourceByFloor,
  floorZ: number,
): ResolvedGuideOverlay<GuideOverlaySource> => resolve(byFloor, floorZ);

const referencedPaths = (byFloor: Record<number, GuideOverlay>): Set<string> => {
  const out = new Set<string>();
  for (const k of Object.keys(byFloor)) {
    const path = byFloor[Number(k)]?.path;
    if (path) out.add(path);
  }
  return out;
};

export const allOverlayPaths = (byFloor: GuideOverlayByFloor): string[] =>
  Array.from(referencedPaths(byFloor));

/** Floor index of the nearest strictly-lower floor that holds a record, or null. */
export const nearestLowerFloorWithOverlayRecord = (
  byFloor: GuideOverlayByFloor,
  floorZ: number,
): number | null => {
  const keys = numericFloorKeys(byFloor);
  const below = keys.filter((k) => k < floorZ).sort((a, b) => b - a)[0];
  return below === undefined ? null : below;
};

export const allOverlaySourcePaths = (byFloor: GuideOverlaySourceByFloor): string[] => {
  const out = new Set<string>();
  for (const k of Object.keys(byFloor)) {
    const sp = byFloor[Number(k)]?.source_path;
    if (sp) out.add(sp);
  }
  return Array.from(out);
};
