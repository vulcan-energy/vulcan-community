// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Zone } from '../geometry/types';

const GLOBAL_ELEMENT_TYPES_FOR_NAME_SCOPE = new Set<Element['type']>([
  'WaterPipework',
  'Appliance',
  'HotWaterDemand',
  'ContextShading',
  'MechanicalVentilation',
  'CombustionAppliances',
  'Vents',
  'MechanicalVentilationDuctwork',
  'OnSiteGeneration',
  'ElectricBattery',
  'System',
]);

export function collectDuplicateElementNameWarnings(
  elements: readonly Element[],
  zones: readonly Pick<Zone, 'id' | 'name'>[],
): string[] {
  const zoneNameById = new Map(zones.map((zone) => [zone.id, zone.name]));
  const groups = new Map<string, { name: string; count: number; scopeLabel: string }>();

  for (const element of elements) {
    const name = element.name?.trim();
    if (!name) continue;
    const isGlobal = GLOBAL_ELEMENT_TYPES_FOR_NAME_SCOPE.has(element.type);
    const scopeKey = isGlobal ? `global:${element.type}` : `zone:${element.zoneId ?? ''}`;
    const scopeLabel = isGlobal
      ? `global ${element.type} elements`
      : `zone "${zoneNameById.get(element.zoneId ?? '') ?? element.zoneId ?? '(unknown)'}"`;
    const key = `${scopeKey}\0${name}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { name, count: 1, scopeLabel });
    }
  }

  return Array.from(groups.values())
    .filter((group) => group.count > 1)
    .map(
      (group) =>
        `Duplicate element name "${group.name}" appears ${group.count} times in ${group.scopeLabel}; name-based links such as parent_element may be ambiguous.`,
    );
}
