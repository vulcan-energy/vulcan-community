// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Zone } from '../geometry/types';

/** Selection shape from GeometryCanvas / store (subset). */
export type ZonePickSelection =
  | { type: 'zone'; id: string; isPlaceholder?: boolean }
  | { type: 'element'; id: string; isPlaceholder?: boolean }
  | { type: 'global'; id: string; isPlaceholder?: boolean }
  | { type: 'dormer'; id: string; isPlaceholder?: boolean }
  | null
  | undefined;

/**
 * Choose which zone a newly placed canvas element should belong to.
 * Prefers the active zone selection, then the zone of the currently selected element
 * (including global elements that still carry a zoneId), then the first non-placeholder
 * zone, then the first zone, then creates a new placeholder zone.
 */
export function resolveTargetZoneIdForNewCanvasElement(
  zones: Zone[],
  selection: ZonePickSelection,
  elementsById: Record<string, { zoneId?: string } | undefined>,
  createPlaceholderZone: () => string
): string {
  if (selection?.type === 'zone' && selection.id) {
    return selection.id;
  }
  if ((selection?.type === 'element' || selection?.type === 'global') && selection.id) {
    const selEl = elementsById[selection.id];
    if (selEl?.zoneId) {
      return selEl.zoneId;
    }
  }
  const primary = zones.find((z) => !z.isPlaceholder);
  if (primary) {
    return primary.id;
  }
  if (zones.length > 0) {
    return zones[0].id;
  }
  return createPlaceholderZone();
}
