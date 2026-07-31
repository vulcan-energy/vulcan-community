// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';

type ElementWithNameRefs = Element & {
  _v?: number;
  space_heat_system?: string;
  host_element?: string | null;
};

export type ElementRenameEntry = {
  elementId: string;
  from: string;
  to: string;
  zoneId?: string | null;
  type?: string;
};

type RenamePlanResult = {
  elementsById: Record<string, Element>;
  changed: boolean;
  warnings: string[];
};

type UnambiguousNameMapResult = {
  nameMap: Map<string, string>;
  skippedAmbiguousNameCount: number;
};

const resolveName = (value: unknown, renameMap: Map<string, string>): unknown => {
  if (typeof value !== 'string') return value;
  return renameMap.get(value) ?? value;
};

const resolveNameArray = (value: unknown, renameMap: Map<string, string>): unknown => {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const next = value.map((entry) => {
    const resolved = resolveName(entry, renameMap);
    if (resolved !== entry) changed = true;
    return resolved;
  });
  return changed ? next : value;
};

const normalizedRenameEntries = (renamePlan: ElementRenameEntry[]): ElementRenameEntry[] =>
  renamePlan
    .map((entry) => ({
      ...entry,
      from: entry.from.trim(),
      to: entry.to.trim(),
    }))
    .filter((entry) => entry.from && entry.to && entry.from !== entry.to);

const groupRenameEntriesByOldName = (
  renamePlan: ElementRenameEntry[],
): Map<string, ElementRenameEntry[]> => {
  const groups = new Map<string, ElementRenameEntry[]>();
  for (const entry of normalizedRenameEntries(renamePlan)) {
    const existing = groups.get(entry.from) ?? [];
    existing.push(entry);
    groups.set(entry.from, existing);
  }
  return groups;
};

const collectElementReferenceNames = (element: Element): Set<string> => {
  const names = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) names.add(value);
  };
  const addArray = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const entry of value) add(entry);
  };

  add(element.parent_element);
  add((element as ElementWithNameRefs).host_element);
  add((element as ElementWithNameRefs).space_heat_system);

  const extraJson = element.extra_json;
  if (extraJson && typeof extraJson === 'object' && !Array.isArray(extraJson)) {
    const bundle = (extraJson as Record<string, unknown>).dormer_bundle;
    if (bundle && typeof bundle === 'object' && !Array.isArray(bundle)) {
      const bundleObj = bundle as Record<string, unknown>;
      for (const key of ['host_element_name', 'anchor_name', 'roof_name', 'window_name']) {
        add(bundleObj[key]);
      }
      for (const key of ['roof_names', 'cheek_wall_names']) {
        addArray(bundleObj[key]);
      }
    }
  }

  return names;
};

const buildScopedNameMapForElement = (
  element: Element,
  groups: Map<string, ElementRenameEntry[]>,
  warnings: string[],
): Map<string, string> => {
  const scopedMap = new Map<string, string>();
  const referencedNames = collectElementReferenceNames(element);

  for (const [from, entries] of groups) {
    const uniqueTargets = [...new Set(entries.map((entry) => entry.to))];
    if (uniqueTargets.length === 1) {
      scopedMap.set(from, uniqueTargets[0]);
      continue;
    }

    const zoneMatches = entries.filter(
      (entry) => entry.zoneId && element.zoneId && entry.zoneId === element.zoneId,
    );
    const uniqueZoneTargets = [...new Set(zoneMatches.map((entry) => entry.to))];
    if (uniqueZoneTargets.length === 1) {
      scopedMap.set(from, uniqueZoneTargets[0]);
      continue;
    }

    if (referencedNames.has(from)) {
      warnings.push(
        `Skipped ambiguous element reference '${from}' on '${element.name || element.id}'`,
      );
    }
  }

  return scopedMap;
};

const remapDormerBundle = (
  bundle: unknown,
  renameMap: Map<string, string>,
): { bundle: unknown; changed: boolean } => {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { bundle, changed: false };
  }

  const original = bundle as Record<string, unknown>;
  const next: Record<string, unknown> = { ...original };
  let changed = false;

  for (const key of ['host_element_name', 'anchor_name', 'roof_name', 'window_name']) {
    const resolved = resolveName(original[key], renameMap);
    if (resolved !== original[key]) {
      next[key] = resolved;
      changed = true;
    }
  }

  for (const key of ['roof_names', 'cheek_wall_names']) {
    const resolved = resolveNameArray(original[key], renameMap);
    if (resolved !== original[key]) {
      next[key] = resolved;
      changed = true;
    }
  }

  return { bundle: changed ? next : bundle, changed };
};

export const remapElementNameReferences = (
  element: Element,
  renameMap: Map<string, string>,
): Element => {
  if (renameMap.size === 0) return element;

  const patch: Partial<ElementWithNameRefs> = {};

  const nextParent = resolveName(element.parent_element, renameMap);
  if (nextParent !== element.parent_element) {
    patch.parent_element = nextParent as string | null;
  }

  const elementWithRefs = element as ElementWithNameRefs;
  const nextHost = resolveName(elementWithRefs.host_element, renameMap);
  if (nextHost !== elementWithRefs.host_element) {
    patch.host_element = nextHost as string | null;
  }

  const nextSpaceHeatSystem = resolveName(elementWithRefs.space_heat_system, renameMap);
  if (nextSpaceHeatSystem !== elementWithRefs.space_heat_system) {
    patch.space_heat_system = nextSpaceHeatSystem as string | undefined;
  }

  const extraJson = element.extra_json;
  if (extraJson && typeof extraJson === 'object' && !Array.isArray(extraJson)) {
    const extraObj = extraJson as Record<string, unknown>;
    const { bundle, changed } = remapDormerBundle(extraObj.dormer_bundle, renameMap);
    if (changed) {
      patch.extra_json = {
        ...extraObj,
        dormer_bundle: bundle,
      } as Element['extra_json'];
    }
  }

  if (Object.keys(patch).length === 0) return element;

  return {
    ...element,
    ...patch,
    _v: ((element as ElementWithNameRefs)._v ?? 0) + 1,
  } as Element;
};

export const applyElementNameMapToElementsById = (
  elementsById: Record<string, Element>,
  elementIds: string[],
  renameMap: Map<string, string>,
): { elementsById: Record<string, Element>; changed: boolean } => {
  if (renameMap.size === 0) {
    return { elementsById, changed: false };
  }

  let nextElementsById = elementsById;
  let changed = false;

  for (const elementId of elementIds) {
    const element = elementsById[elementId];
    if (!element) continue;

    const nextElement = remapElementNameReferences(element, renameMap);
    if (nextElement === element) continue;

    if (!changed) {
      nextElementsById = { ...elementsById };
      changed = true;
    }
    nextElementsById[elementId] = nextElement;
  }

  return { elementsById: nextElementsById, changed };
};

export const buildUnambiguousElementNameMap = (
  renamePlan: ElementRenameEntry[],
  _elementsById: Record<string, Element>,
  _elementIds: string[],
): UnambiguousNameMapResult => {
  void _elementsById;
  void _elementIds;
  const nameMap = new Map<string, string>();
  let skippedAmbiguousNameCount = 0;

  for (const [from, entries] of groupRenameEntriesByOldName(renamePlan)) {
    const uniqueTargets = [...new Set(entries.map((entry) => entry.to))];
    if (uniqueTargets.length === 1) {
      nameMap.set(from, uniqueTargets[0]);
    } else {
      skippedAmbiguousNameCount += 1;
    }
  }

  return { nameMap, skippedAmbiguousNameCount };
};

export const applyElementRenamePlanToElementsById = (
  elementsById: Record<string, Element>,
  elementIds: string[],
  renamePlan: ElementRenameEntry[],
): RenamePlanResult => {
  const groups = groupRenameEntriesByOldName(renamePlan);
  if (groups.size === 0) {
    return { elementsById, changed: false, warnings: [] };
  }

  let nextElementsById = elementsById;
  let changed = false;
  const warnings: string[] = [];

  for (const elementId of elementIds) {
    const element = elementsById[elementId];
    if (!element) continue;

    const scopedNameMap = buildScopedNameMapForElement(element, groups, warnings);
    const nextElement = remapElementNameReferences(element, scopedNameMap);
    if (nextElement === element) continue;

    if (!changed) {
      nextElementsById = { ...elementsById };
      changed = true;
    }
    nextElementsById[elementId] = nextElement;
  }

  return { elementsById: nextElementsById, changed, warnings };
};
