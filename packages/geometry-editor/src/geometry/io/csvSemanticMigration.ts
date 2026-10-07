// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../types';

export type UValueInterpretation = 'whole_wall' | 'half_construction';
export type CsvMigrationIssue = { elementId: string; elementName: string; value: number; code: 'CSV_U_VALUE_MEANING_REQUIRED' };

/** Import records established source meaning; only unresolved or changed evidence needs review. */
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
  if (issues.length) throw new Error(`CSV_U_VALUE_MEANING_REQUIRED: choose whole-wall or dwelling-side-to-midpoint U-value for ${issues.map(issue => issue.elementName).join(', ')} before saving.`);
}

/** Resolve source provenance at import, never from the currently selected calculation target.
 * Historical unpinned v1/v2 files used the Rust contract: corpus.rs converts their U
 * into construction resistance passed to PartyWall::new (wall layers before cavity).
 */
export function normalizeCsvConstructionProvenance(
  elements: readonly Element[],
  source?: { csvVersion: number; targetBundleId?: string },
): Element[] {
  const establishedRustMeaning = source?.targetBundleId === 'rust-fhs-a7-62d3df70-c5ba2673-v1'
    || (source?.targetBundleId === undefined && source !== undefined && source.csvVersion < 3);
  return elements.map(original => {
    let element = original;
    const originalExtra = element.extra_json;
    if (establishedRustMeaning && element.type === 'BuildingElementPartyWall'
      && typeof originalExtra?.u_value === 'number' && Number.isFinite(originalExtra.u_value)
      && originalExtra.u_value_interpretation === undefined
      && originalExtra.u_value_interpreted_value === undefined
      && originalExtra.u_value_whole_wall === undefined
      && originalExtra.construction_basis !== 'full') {
      element = { ...element, extra_json: { ...originalExtra,
        u_value_interpretation: 'half_construction', u_value_interpreted_value: originalExtra.u_value,
      } };
    }
    if (element.type !== 'BuildingElementPartyWall' && element.type !== 'BuildingElementAdjacentConditionedSpace') return element;
    const extra = element.extra_json;
    const raw = extra?.vulcan_assembly_v1;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return element;
    const assembly = raw as Record<string, unknown>;
    const snapshot = assembly.assemblySnapshot as { elementMode?: unknown } | undefined;
    if (assembly.schemaVersion !== 1 || snapshot?.elementMode !== element.type) return element;
    const unchangedU = typeof assembly.correctedU_W_m2K === 'number' && extra?.u_value === assembly.correctedU_W_m2K
      && (extra.u_value_interpreted_value === undefined || extra.u_value_interpreted_value === extra.u_value)
      && extra.construction_basis !== 'full';
    const unchangedR = typeof assembly.thermalResistanceConstruction_m2K_W === 'number' && extra?.thermal_resistance_construction === assembly.thermalResistanceConstruction_m2K_W;
    return { ...element, extra_json: { ...extra,
      ...(unchangedU && element.type === 'BuildingElementPartyWall' && extra?.u_value_interpretation === undefined ? { u_value_interpretation: 'half_construction', u_value_interpreted_value: extra.u_value } : {}),
      ...(unchangedR && extra?.construction_basis === undefined ? { construction_basis: 'half' } : {}),
    } };
  });
}

/** Saves before the ECaaS bare-id fix wrote heat pump `product_reference` as `ProductType:id`.
 * Rewrite only when `_pcdb.productID` vouches for the digits; anything else is left for the
 * submit guard. Returns the same array when nothing changed. */
export function upgradePcdbProductReferences(elements: readonly Element[]): Element[] {
  let changed = false;
  const result = elements.map(element => {
    const extra = element.extra_json;
    const pcdb = extra?._pcdb as { productID?: unknown } | undefined;
    if (element.type !== 'System' || !pcdb || pcdb.productID === undefined) return element;
    const productID = String(pcdb.productID).trim();
    let upgraded = false;
    const next = JSON.parse(JSON.stringify(extra), (key, value) => {
      const digits = key === 'product_reference' && typeof value === 'string' ? /^[A-Za-z]+:(\d+)$/.exec(value)?.[1] : undefined;
      if (digits === undefined || digits !== productID) return value;
      upgraded = true;
      return digits;
    });
    if (!upgraded) return element;
    changed = true;
    return { ...element, extra_json: next };
  });
  return changed ? result : (elements as Element[]);
}
