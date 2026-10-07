// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../types';

export type UValueInterpretation = 'whole_wall' | 'half_construction';
export type CsvMigrationIssue = { elementId: string; elementName: string; value: number; code: 'CSV_U_VALUE_MEANING_REQUIRED' };

/** Version alone cannot prove the meaning of a manually authored party-wall U-value. */
export function csvMigrationIssues(elements: readonly Element[], sourceCsvVersion = 3): CsvMigrationIssue[] {
  return elements.flatMap(element => {
    const extra = element.extra_json;
    if (element.type !== 'BuildingElementPartyWall' || typeof extra?.u_value !== 'number') return [];
    const reviewedValueChanged = sourceCsvVersion < 3 && extra.u_value_interpreted_value !== undefined && extra.u_value_interpreted_value !== extra.u_value;
    if (!reviewedValueChanged && (extra.u_value_interpretation === 'whole_wall' || extra.u_value_interpretation === 'half_construction')) return [];
    return [{ elementId: element.id, elementName: element.name, value: extra.u_value, code: 'CSV_U_VALUE_MEANING_REQUIRED' as const }];
  });
}

/** Explicit review, separate from changing a number or validating calculation readiness. */
export function resolveCsvUValueMeaning(element: Element, meaning: UValueInterpretation): Element {
  if (meaning !== 'whole_wall' && meaning !== 'half_construction') throw new Error('Choose a known U-value meaning; unknown remains unresolved.');
  if (element.type !== 'BuildingElementPartyWall' || typeof element.extra_json?.u_value !== 'number') throw new Error('This element has no legacy party-wall U-value to interpret.');
  return { ...element, extra_json: { ...element.extra_json, u_value_interpretation: meaning, u_value_interpreted_value: element.extra_json.u_value,
    ...(meaning === 'whole_wall' ? { u_value_whole_wall: element.extra_json.u_value_whole_wall ?? element.extra_json.u_value } : {}),
  } };
}

export function assertCsvMigrationResolved(elements: readonly Element[], sourceCsvVersion = 3): void {
  const issues = csvMigrationIssues(elements, sourceCsvVersion);
  if (issues.length) throw new Error(`CSV_U_VALUE_MEANING_REQUIRED: choose whole-wall or previous half-construction U-value for ${issues.map(issue => issue.elementName).join(', ')} before saving an upgraded copy.`);
}

/** Only an unchanged calculator result proves its half-construction provenance. */
export function normalizeCsvConstructionProvenance(elements: readonly Element[]): Element[] {
  return elements.map(element => {
    if (element.type !== 'BuildingElementPartyWall' && element.type !== 'BuildingElementAdjacentConditionedSpace') return element;
    const extra = element.extra_json;
    const raw = extra?.vulcan_assembly_v1;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return element;
    const assembly = raw as Record<string, unknown>;
    const snapshot = assembly.assemblySnapshot as { elementMode?: unknown } | undefined;
    if (assembly.schemaVersion !== 1 || snapshot?.elementMode !== element.type) return element;
    const unchangedU = typeof assembly.correctedU_W_m2K === 'number' && extra?.u_value === assembly.correctedU_W_m2K;
    const unchangedR = typeof assembly.thermalResistanceConstruction_m2K_W === 'number' && extra?.thermal_resistance_construction === assembly.thermalResistanceConstruction_m2K_W;
    return { ...element, extra_json: { ...extra,
      ...(unchangedU && element.type === 'BuildingElementPartyWall' && extra?.u_value_interpretation === undefined ? { u_value_interpretation: 'half_construction', u_value_interpreted_value: extra.u_value } : {}),
      ...(unchangedR && extra?.construction_basis === undefined ? { construction_basis: 'half' } : {}),
    } };
  });
}
