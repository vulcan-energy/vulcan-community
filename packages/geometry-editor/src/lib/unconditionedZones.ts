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

/**
 * The row with its zone keyed by the row's name: a zone's HEM key is its Systems row's name,
 * whatever it was before (a rename, a duplicate). A row defining several zones (hand-written
 * CSV) is left as it is.
 */
export function keyZoneByRowName<T extends Element>(row: T): T {
  if (row.type !== 'System' || row.subcategory !== ZONE_UNCONDITIONED) return row;
  const extra = readRecord(row.extra_json);
  const entries = Object.entries(readRecord(extra[ZONE_UNCONDITIONED]));
  if (entries.length !== 1 || entries[0][0] === row.name) return row;
  return { ...row, extra_json: { ...extra, [ZONE_UNCONDITIONED]: { [row.name]: entries[0][1] } } };
}

/** What a zone with this method may not state (the schema: "must be omitted when …"). */
export const METHOD_FORBIDS: Readonly<Record<string, readonly string[]>> = {
  Calculated: ['factor_adjustment_unconditioned_zone', 'heat_transfer_coeff_unconditioned_zone_total'],
  Direct: ['coeff_ventilation_unconditioned_zone'],
};

/** A zone window's shading row kinds: the schema's WindowShadingType values, and an obstacle. */
export const OBSTACLE = 'obstacle';
/** Whether a window's area is its width × height, allowing for the area written to 3 decimals. */
export function areaIsWidthByHeight({ area, width, height }: Record<string, unknown>): boolean {
  return typeof area === 'number' && typeof width === 'number' && typeof height === 'number'
    && Math.abs(area - width * height) <= 0.0005 + 1e-9;
}

export const shadingDef = (kind: string) => (kind === OBSTACLE ? 'WindowShadingObstacle' : 'WindowShadingObject');

/** The zone's problems, each with its fix. Calculated needs an envelope; each part states what its form requires. */
export function unconditionedZoneIssues(zone: unknown, root: unknown): string[] {
  const z = readRecord(zone);
  if (z.method === 'Direct') return ['HEM:EPC rejects the Direct method at present. Choose Calculated and add the zone\'s envelope.'];
  if (z.method !== 'Calculated') return ['Choose a method.'];
  const envelope = Object.entries(readRecord(z.building_element));
  if (envelope.length === 0) return ['Add the zone\'s outside walls, roof and windows.'];
  const defs = readRecord(readRecord(root).$defs);
  const missing = (value: Record<string, unknown>, def: string, of: string, extra: readonly string[] = []) => {
    const form = readRecord(defs[def]);
    return [...(Array.isArray(form.required) ? form.required as string[] : []), ...extra].flatMap((key) => (
      key === 'type' || (value[key] !== undefined && value[key] !== null && value[key] !== '')
        ? []
        : [`Enter the ${resolveFieldLabelContent(key, readRecord(readRecord(form.properties)[key]).title)} of ${of}.`]));
  };
  return envelope.flatMap(([part, value]) => {
    const p = readRecord(value);
    // Calculated sums U-value × area over the envelope, so every part needs its U-value.
    // A window's area is not an input: it is written from the width and height, which are asked
    // for themselves; one that has both but no area takes them in one click.
    const areaIssue = `Enter the ${resolveFieldLabelContent('area')} of '${part}'.`;
    const derivable = typeof p.width === 'number' && typeof p.height === 'number';
    const window = p.type === 'BuildingElementZoneUnconditionedTransparent';
    const issues = missing(p, String(p.type), `'${part}'`, ['u_value']).flatMap((issue) => {
      if (!window || issue !== areaIssue) return [issue];
      return derivable ? [`Use width × height for the area of '${part}'.`] : [];
    });
    const shading = Array.isArray(p.shading) ? p.shading.map(readRecord) : [];
    return [...issues, ...shading.flatMap((row, i) => missing(row, shadingDef(String(row.type)), `shading ${i + 1} on '${part}'`))];
  });
}
