// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import { readRecord } from './jsonTypes';
import { resolveFieldLabelContent } from './schemaDescriptionOverrides';

/**
 * Unconditioned zones (an unheated garage or porch modelled as a buffer zone). The zone is a
 * Systems row with subcategory `ZoneUnconditioned`, as the converter reads it; an element next to
 * it is an unheated-space element that names it in `extra_json.ZoneUnconditioned`, written to the
 * CSV as `BuildingElementAdjacentUnconditionedZone`.
 */
export const ZONE_UNCONDITIONED = 'ZoneUnconditioned';
export const ADJACENT_UNCONDITIONED_ZONE_TYPE = 'BuildingElementAdjacentUnconditionedZone';

/** A target takes them when its schema has them and the building is new (HEMIE has no such zone). */
export function takesUnconditionedZones(root: unknown, existingBuilding: boolean): boolean {
  return !existingBuilding && ZONE_UNCONDITIONED in readRecord(readRecord(root).properties);
}

/** The zone an element is next to, or undefined for an element next to an unheated space by its resistance. */
export function adjacentUnconditionedZone(element: { extra_json?: unknown }): string | undefined {
  const name = readRecord(element.extra_json)[ZONE_UNCONDITIONED];
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/** The zones the model's Systems rows define, by their HEM name. */
export function unconditionedZoneNames(elements: Iterable<Element>): string[] {
  const names: string[] = [];
  for (const element of elements) {
    if (element.type !== 'System' || element.subcategory !== ZONE_UNCONDITIONED) continue;
    names.push(...Object.keys(readRecord(readRecord(element.extra_json)[ZONE_UNCONDITIONED])));
  }
  return names;
}

/** What a zone with this method may not state (the schema: "must be omitted when …"). */
export const METHOD_FORBIDS: Readonly<Record<string, readonly string[]>> = {
  Calculated: ['factor_adjustment_unconditioned_zone', 'heat_transfer_coeff_unconditioned_zone_total'],
  Direct: ['coeff_ventilation_unconditioned_zone'],
};

/** The zone's problems, each with its fix. Calculated needs an envelope; each part states what its form requires. */
export function unconditionedZoneIssues(zone: unknown, root: unknown): string[] {
  const z = readRecord(zone);
  if (z.method === 'Direct') return ['HEM:EPC rejects the Direct method at present. Choose Calculated and add the zone\'s envelope.'];
  if (z.method !== 'Calculated') return ['Choose a method.'];
  const envelope = Object.entries(readRecord(z.building_element));
  if (envelope.length === 0) return ['Add the zone\'s outside walls, roof and windows.'];
  const defs = readRecord(readRecord(root).$defs);
  return envelope.flatMap(([part, value]) => {
    const p = readRecord(value);
    const form = readRecord(defs[String(p.type)]);
    // Calculated sums U-value × area over the envelope, so every part needs its U-value.
    const required = [...(Array.isArray(form.required) ? form.required as string[] : []), 'u_value'];
    return required.flatMap((key) => (key === 'type' || (p[key] !== undefined && p[key] !== null && p[key] !== '')
      ? []
      : [`Enter the ${resolveFieldLabelContent(key, readRecord(readRecord(form.properties)[key]).title)} of '${part}'.`]));
  });
}
