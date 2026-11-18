// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const SPACE_HEAT_SYSTEM_TYPES_WITH_ZONE = new Set(['WetDistribution', 'ElecStorageHeater']);

function normalizedZoneName(zoneName: string | null | undefined): string | null {
  const trimmed = typeof zoneName === 'string' ? zoneName.trim() : '';
  return trimmed || null;
}

function shouldSyncSpaceHeatSystemZone(system: Record<string, unknown>): boolean {
  const type = typeof system.type === 'string' ? system.type.trim() : '';
  return SPACE_HEAT_SYSTEM_TYPES_WITH_ZONE.has(type) || Object.prototype.hasOwnProperty.call(system, 'Zone');
}

export function syncSpaceHeatSystemZoneNameInExtraJson(
  extraJson: unknown,
  zoneName: string | null | undefined,
): Record<string, unknown> | null {
  if (!isRecord(extraJson)) return null;
  if (!isRecord(extraJson.SpaceHeatSystem)) return null;

  const nextZoneName = normalizedZoneName(zoneName);
  let changed = false;
  const nextSpaceHeatSystems: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(extraJson.SpaceHeatSystem)) {
    if (!isRecord(value) || !shouldSyncSpaceHeatSystemZone(value)) {
      nextSpaceHeatSystems[name] = value;
      continue;
    }

    const nextSystem = { ...value };
    if (nextZoneName) {
      if (nextSystem.Zone !== nextZoneName) {
        nextSystem.Zone = nextZoneName;
        changed = true;
      }
    } else if (Object.prototype.hasOwnProperty.call(nextSystem, 'Zone')) {
      delete nextSystem.Zone;
      changed = true;
    }
    nextSpaceHeatSystems[name] = nextSystem;
  }

  if (!changed) return extraJson;
  return {
    ...extraJson,
    SpaceHeatSystem: nextSpaceHeatSystems,
  };
}

/**
 * The name of the model's only heating circuit (a drawn SpaceHeatSystem), the one link an emitter
 * can take; null when there is none or several (the user picks: never a guess).
 */
export function onlyHeatingCircuit(elements: readonly Element[]): string | null {
  const names = elements.flatMap((element) => (element.type === 'System' && element.subcategory === 'SpaceHeatSystem'
    && !element.isPlaceholder && element.name ? [element.name] : []));
  return names.length === 1 ? names[0]! : null;
}
