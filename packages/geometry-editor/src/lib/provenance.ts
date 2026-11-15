// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import type { DefaultsLookup } from './defaultsCache';
import { GLOBAL_ELEMENT_TYPES_FOR_NAME_SCOPE } from './elementNameDuplicates';
import { classifyOpaqueFabricVariantFromElement } from './opaqueFabricVariant';

/**
 * Where a field's value comes from. Every "is this entered, a default or from the drawing"
 * decision asks `provenanceOf`: a source the provenance table recorded wins, and a field it has no
 * entry for is inferred from its value.
 */
export type FieldProvenance = 'user' | 'source';

export type ProvenanceRecord = { kind: 'element' | 'zone' | 'floor' | 'metadata'; id: string };

/** What the value-based answer compares: the value the source gives, and the value stated. */
export type ProvenanceProbe = {
  source: number | null | undefined;
  current: number | '' | null | undefined;
  /** Largest difference that still reads as the source's value. */
  tolerance?: number;
};

/** Who wrote a field: the user, or a named preset the user applied. */
export type ProvenanceSource = 'user' | `preset:${string}`;

/**
 * Recorded sources by element id, then field (top-level or `extra_json` key). It holds only entries
 * its value cannot tell (`keepsEntry`), so it is exactly what the `Provenance` Metadata row saves.
 */
export type ProvenanceTable = Readonly<Record<string, Readonly<Record<string, ProvenanceSource>>>>;

export const PROVENANCE_METADATA_KEY = 'Provenance';

const DEFAULT_TOLERANCE = 0.005;

/**
 * The table's entry when it has one (`user`, or `source` for a preset). Otherwise `user` when the
 * stated value differs from its source; `source` when it is blank, equal within `tolerance`, or
 * there is no source to differ from.
 */
export function provenanceOf(
  table: ProvenanceTable,
  record: ProvenanceRecord,
  field: string,
  probe: ProvenanceProbe,
): FieldProvenance {
  const recorded = record.kind === 'element' ? table[record.id]?.[field] : undefined;
  if (recorded) return recorded === 'user' ? 'user' : 'source';
  const { source, current, tolerance = DEFAULT_TOLERANCE } = probe;
  if (source === null || source === undefined || !Number.isFinite(source)) return 'source';
  return typeof current === 'number' && Number.isFinite(current) && Math.abs(current - source) > tolerance
    ? 'user'
    : 'source';
}

// Identity and the drawing's own dimensions: a drag changes them in the user's write, and their
// authored overrides have markers of their own (overrideProvenance.ts).
const UNRECORDED_FIELDS = new Set([
  'id', 'type', 'name', 'zoneId', 'parent_element', 'floorId', 'isPlaceholder',
  'width', 'height', 'area', 'pitch', 'orientation360', 'base_height',
]);

type Scalar = string | number | boolean;
const isScalar = (value: unknown): value is Scalar =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
const isBlank = (value: unknown): boolean => value === undefined || value === null || value === '';

function fieldValue(element: Element, field: string): unknown {
  const own = element as unknown as Record<string, unknown>;
  return field in own ? own[field] : element.extra_json?.[field];
}

/**
 * Whether the value alone cannot tell this entry, so it must be kept: a preset always; a user entry
 * only on a value equal to its default, which would otherwise read as the default. Without loaded
 * defaults nothing can be told, so every entry is kept.
 */
function keepsEntry(source: ProvenanceSource, element: Element, field: string, defaults: DefaultsLookup | null): boolean {
  const value = fieldValue(element, field);
  if (isBlank(value)) return false;
  if (source !== 'user' || !defaults) return true;
  const variant = element.type === 'BuildingElementOpaque'
    ? classifyOpaqueFabricVariantFromElement(element as unknown as Record<string, unknown>)
    : undefined;
  const fallback = defaults.getDefaultValueForElementField(field, element.type, variant);
  if (typeof value === 'number' && typeof fallback === 'number') return Math.abs(value - fallback) <= DEFAULT_TOLERANCE;
  return value === fallback;
}

function changedFields(before: Element, after: Element): string[] {
  const fields: string[] = [];
  const scan = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key.startsWith('_') || UNRECORDED_FIELDS.has(key) || a[key] === b[key]) continue;
      if ((isScalar(b[key]) || isBlank(b[key])) && (isScalar(a[key]) || isBlank(a[key]))) fields.push(key);
    }
  };
  scan(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
  if (before.extra_json !== after.extra_json) scan(before.extra_json ?? {}, after.extra_json ?? {});
  return fields;
}

/**
 * Records `source` for every scalar field an edit changed on an element that existed before it
 * (creating or removing an element records nothing). Returns `table` itself when nothing changed.
 */
export function recordProvenance(
  table: ProvenanceTable,
  before: Readonly<Record<string, Element>>,
  after: Readonly<Record<string, Element>>,
  source: ProvenanceSource,
  defaults: DefaultsLookup | null,
): ProvenanceTable {
  let next: Record<string, Record<string, ProvenanceSource>> | null = null;
  for (const id in after) {
    const previous = before[id];
    const element = after[id];
    if (!previous || previous === element) continue;
    for (const field of changedFields(previous, element)) {
      const keep = keepsEntry(source, element, field, defaults);
      const current = (next ?? table)[id]?.[field];
      if (keep ? current === source : current === undefined) continue;
      next ??= { ...table };
      const entries = { ...next[id] };
      if (keep) entries[field] = source;
      else delete entries[field];
      if (Object.keys(entries).length) next[id] = entries;
      else delete next[id];
    }
  }
  return next ?? table;
}

const recordKey = (element: Element, zoneNameById: ReadonlyMap<string, string>): string =>
  `e:${GLOBAL_ELEMENT_TYPES_FOR_NAME_SCOPE.has(element.type) ? element.type : zoneNameById.get(element.zoneId ?? '') ?? ''}/${element.name}`;

/**
 * The `Provenance` Metadata row's value: JSON with sorted keys, `e:<zone or global type>/<name>`
 * then field, holding the entries the saved values cannot tell. `null` when there are none, so a
 * model nobody edited saves no row.
 */
export function provenanceMetadataValue(
  table: ProvenanceTable,
  elements: readonly Element[],
  zoneNameById: ReadonlyMap<string, string>,
  defaults: DefaultsLookup | null,
): string | null {
  const saved: Record<string, Record<string, ProvenanceSource>> = {};
  for (const element of elements) {
    const entries = table[element.id];
    if (!entries) continue;
    for (const field of Object.keys(entries).sort()) {
      if (keepsEntry(entries[field], element, field, defaults)) (saved[recordKey(element, zoneNameById)] ??= {})[field] = entries[field];
    }
  }
  const keys = Object.keys(saved).sort();
  return keys.length ? JSON.stringify(Object.fromEntries(keys.map((key) => [key, saved[key]]))) : null;
}

/** Reads a `Provenance` row value. Throws when it is not an object of `{ field: source }` objects. */
export function parseProvenanceMetadataValue(raw: string): Record<string, Record<string, ProvenanceSource>> {
  const parsed: unknown = JSON.parse(raw);
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!isRecord(parsed)) throw new Error('not a JSON object');
  for (const [key, entries] of Object.entries(parsed)) {
    if (!isRecord(entries)) throw new Error(`${key} is not an object`);
    for (const [field, source] of Object.entries(entries)) {
      if (typeof source !== 'string' || !(source === 'user' || /^preset:./.test(source))) {
        throw new Error(`${key} ${field} has unknown source ${JSON.stringify(source)}`);
      }
    }
  }
  return parsed as Record<string, Record<string, ProvenanceSource>>;
}

/** The table for loaded elements from a parsed row; entries naming no element are dropped. */
export function provenanceTableFromMetadata(
  saved: Readonly<Record<string, Readonly<Record<string, ProvenanceSource>>>> | undefined,
  elements: readonly Element[],
  zoneNameById: ReadonlyMap<string, string>,
): ProvenanceTable {
  if (!saved) return {};
  const table: Record<string, Record<string, ProvenanceSource>> = {};
  for (const element of elements) {
    const entries = saved[recordKey(element, zoneNameById)];
    if (entries) table[element.id] = { ...entries };
  }
  return table;
}
