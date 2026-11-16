// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readRecord } from './jsonTypes';
import type { AdvancedFieldsLayoutNode } from './systemAdvancedUischema';

/**
 * Inputs HEM takes as alternatives: one method each, so the others cannot also be stated (the
 * existing-building converter rejects a tank that "states its size more than once",
 * `hemie_systems.rs` `tank_descriptors`). A method is offered only when the schema takes all its fields.
 */
export type InputMethod = Readonly<{ value: string; label: string; fields: readonly string[] }>;
export type InputMethodGroup = Readonly<{ key: string; label: string; methods: readonly InputMethod[] }>;

export const TANK_METHOD_GROUPS: readonly InputMethodGroup[] = [
  {
    key: 'size',
    label: 'Size from',
    methods: [
      { value: 'category', label: 'Category', fields: ['tank_volume_category'] },
      { value: 'volume', label: 'Volume', fields: ['volume'] },
      { value: 'dimensions', label: 'Dimensions', fields: ['external_diameter', 'external_height'] },
    ],
  },
  {
    key: 'loss',
    label: 'Heat loss from',
    methods: [
      { value: 'measured', label: 'Measured', fields: ['daily_losses'] },
      { value: 'label', label: 'Energy label', fields: ['energy_efficiency_class'] },
      { value: 'year', label: 'Install year', fields: ['installation_year'] },
    ],
  },
];

const isStated = (value: unknown) => value !== undefined && value !== null && value !== '';

/** The group's methods the schema takes; fewer than two means no choice to show. */
export function offeredMethods(group: InputMethodGroup, schemaProperties: Readonly<Record<string, unknown>>): InputMethod[] {
  return group.methods.filter((method) => method.fields.every((field) => field in schemaProperties));
}

/**
 * The method the data states: the first with a stated field. With none stated, the method whose
 * blank the target fills (`fallback`: an existing building's category "Inaccessible" and install
 * year "unknown"), else the first.
 */
export function statedMethod(methods: readonly InputMethod[], data: Readonly<Record<string, unknown>>, fallback?: string): InputMethod {
  return methods.find((method) => method.fields.some((field) => isStated(data[field])))
    ?? methods.find((method) => method.value === fallback)
    ?? methods[0]!;
}

/** The data with the other methods' fields removed (one write, one undo step). */
export function switchMethod(methods: readonly InputMethod[], to: string, data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const next = { ...data };
  for (const method of methods) if (method.value !== to) for (const field of method.fields) delete next[field];
  return next;
}

/** The existing building's storage tank in a hot water System's extra_json: its plant key and data. */
export function storageTank(extraJson: unknown): [string, Record<string, unknown>] | undefined {
  const entry = Object.entries(readRecord(readRecord(extraJson).HotWaterSource)).find(([, plant]) => readRecord(plant).type === 'StorageTank');
  return entry && [entry[0], readRecord(entry[1])];
}

/** The layout without the controls for these leaf keys (they show with their method instead). */
export function withoutLayoutLeaves(node: AdvancedFieldsLayoutNode, scopePrefix: string, keys: ReadonlySet<string>): AdvancedFieldsLayoutNode | null {
  if (node.type === 'Control') {
    const leaf = node.scope?.startsWith(`${scopePrefix}/properties/`) ? node.scope.slice(scopePrefix.length + '/properties/'.length) : undefined;
    return leaf && keys.has(leaf) ? null : node;
  }
  return { ...node, elements: (node.elements ?? []).flatMap((child) => withoutLayoutLeaves(child, scopePrefix, keys) ?? []) };
}
