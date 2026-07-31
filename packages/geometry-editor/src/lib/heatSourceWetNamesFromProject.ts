// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, System } from '../geometry/types';

/**
 * All keys in `extra_json.HeatSourceWet` for any `System` row in the project (including composite
 * `extra_json` on the same element as `HotWaterSource`).
 */
export function collectHeatSourceWetNamesFromProject(elementsById: Record<string, Element>): string[] {
  const out = new Set<string>();
  for (const el of Object.values(elementsById)) {
    if (el.type !== 'System' || el.isPlaceholder) continue;
    const ex = (el as System).extra_json;
    if (!ex || typeof ex !== 'object' || Array.isArray(ex)) continue;
    const hsw = (ex as Record<string, unknown>).HeatSourceWet;
    if (!hsw || typeof hsw !== 'object' || Array.isArray(hsw)) continue;
    for (const k of Object.keys(hsw as Record<string, unknown>)) {
      if (k) out.add(k);
    }
  }
  return Array.from(out).sort();
}

export function collectHeatSourceWetNameLabelsFromProject(elementsById: Record<string, Element>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of Object.values(elementsById)) {
    if (el.type !== 'System' || el.isPlaceholder) continue;
    const ex = (el as System).extra_json;
    if (!ex || typeof ex !== 'object' || Array.isArray(ex)) continue;
    const hsw = (ex as Record<string, unknown>).HeatSourceWet;
    if (!hsw || typeof hsw !== 'object' || Array.isArray(hsw)) continue;
    for (const key of Object.keys(hsw as Record<string, unknown>)) {
      if (!key || out[key]) continue;
      const elementName = typeof el.name === 'string' ? el.name.trim() : '';
      out[key] = elementName && elementName !== key ? `${elementName} (${key})` : key;
    }
  }
  return out;
}
