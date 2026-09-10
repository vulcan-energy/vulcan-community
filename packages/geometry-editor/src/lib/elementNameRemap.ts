// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';

/** Resolve a unique name within the requested zone, or globally for unscoped links. */
export function createElementNameLookup(elements: Iterable<Element>) {
  const byName = new Map<string, Element[]>();
  for (const element of elements) {
    const name = element.name?.trim();
    if (!name) continue;
    const matches = byName.get(name) ?? [];
    matches.push(element);
    byName.set(name, matches);
  }
  return (
    name: string | null | undefined,
    zoneId?: string | null,
    eligible?: (element: Element) => boolean,
  ): Element | undefined => {
    if (!name?.trim()) return undefined;
    const matches = byName.get(name.trim()) ?? [];
    const candidates = matches.filter((element) =>
      (!zoneId || element.zoneId === zoneId) && (!eligible || eligible(element)),
    );
    return candidates.length === 1 ? candidates[0] : undefined;
  };
}

/** Parent links on ventilation equipment are global; opening links belong to a zone. */
export function createParentElementLookup(elements: Iterable<Element>) {
  const resolveName = createElementNameLookup(elements);
  return (child: Element): Element | undefined => {
    switch (child.type) {
      case 'BuildingElementOpaque':
      case 'BuildingElementTransparent':
        return resolveName(child.parent_element, child.zoneId, (parent) => parent.type === 'BuildingElementOpaque');
      case 'WindowShading':
        return resolveName(child.parent_element, child.zoneId, (parent) => parent.type === 'BuildingElementTransparent');
      case 'MechanicalVentilationDuctwork':
      case 'MechanicalVentilationTerminal':
        return resolveName(child.parent_element, undefined, (parent) => parent.type === 'MechanicalVentilation');
      case 'MechanicalVentilation':
      case 'Vents':
        return resolveName(child.parent_element, undefined, (parent) =>
          parent.type === 'BuildingElementOpaque' || parent.type === 'BuildingElementTransparent',
        );
      default:
        return resolveName(child.parent_element, child.zoneId);
    }
  };
}

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
  elementsById?: Record<string, Element>,
): Map<string, ElementRenameEntry[]> => {
  const groups = new Map<string, ElementRenameEntry[]>();
  for (const entry of normalizedRenameEntries(renamePlan)) {
    const existing = groups.get(entry.from) ?? [];
    existing.push(entry);
    groups.set(entry.from, existing);
  }

  // Keep an identity entry for an unrenamed element that still owns an old
  // name. A unique rename target is global only when no same-name element
  // remains; otherwise references must be resolved by the owner's scope.
  if (elementsById) {
    const renamedElementIds = new Set(
      normalizedRenameEntries(renamePlan).map((entry) => entry.elementId),
    );
    for (const element of Object.values(elementsById)) {
      const name = element.name.trim();
      const entries = groups.get(name);
      if (!entries || renamedElementIds.has(element.id)) continue;
      entries.push({
        elementId: element.id,
        from: name,
        to: name,
        zoneId: element.zoneId,
        type: element.type,
      });
    }
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

const buildPreRenameElementsById = (
  elementsById: Record<string, Element>,
  renamePlan: ElementRenameEntry[],
): Record<string, Element> => {
  const oldElementsById = { ...elementsById };
  for (const entry of normalizedRenameEntries(renamePlan)) {
    const current = oldElementsById[entry.elementId];
    oldElementsById[entry.elementId] = current
      ? { ...current, name: entry.from }
      : ({
          id: entry.elementId,
          name: entry.from,
          type: entry.type ?? 'BuildingElementOpaque',
          zoneId: entry.zoneId,
          coordinates: [],
          parent_element: null,
          width: 0,
          height: 0,
          area: 0,
        } as Element);
  }
  return oldElementsById;
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
  nextParent = resolveName(element.parent_element, renameMap),
  nextHost = resolveName((element as ElementWithNameRefs).host_element, renameMap),
): Element => {
  const patch: Partial<ElementWithNameRefs> = {};

  if (nextParent !== element.parent_element) {
    patch.parent_element = nextParent as string | null;
  }

  const elementWithRefs = element as ElementWithNameRefs;
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
  elementsById: Record<string, Element>,
  _elementIds: string[],
): UnambiguousNameMapResult => {
  void _elementIds;
  const nameMap = new Map<string, string>();
  let skippedAmbiguousNameCount = 0;

  for (const [from, entries] of groupRenameEntriesByOldName(renamePlan, elementsById)) {
    const uniqueTargets = [...new Set(entries.map((entry) => entry.to))];
    if (uniqueTargets.length === 1 && uniqueTargets[0] !== from) {
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
  const groups = groupRenameEntriesByOldName(renamePlan, elementsById);
  if (groups.size === 0) {
    return { elementsById, changed: false, warnings: [] };
  }

  let nextElementsById = elementsById;
  let changed = false;
  const warnings: string[] = [];
  const oldElementsById = buildPreRenameElementsById(elementsById, renamePlan);
  const renameTargetById = new Map(
    normalizedRenameEntries(renamePlan).map((entry) => [entry.elementId, entry.to]),
  );
  const resolveOldParent = createParentElementLookup(Object.values(oldElementsById));
  const resolveOldHost = createElementNameLookup(
    Object.values(oldElementsById).filter((candidate) =>
      candidate.type === 'BuildingElementOpaque' || candidate.type === 'BuildingElementTransparent',
    ),
  );

  for (const elementId of elementIds) {
    const element = elementsById[elementId];
    if (!element) continue;

    const scopedNameMap = buildScopedNameMapForElement(element, groups, warnings);
    const oldElement = oldElementsById[elementId] ?? element;
    const parent = resolveOldParent(oldElement);
    const host = oldElement.type === 'MechanicalVentilationTerminal'
      ? resolveOldHost(oldElement.host_element)
      : undefined;
    const nextElement = remapElementNameReferences(
      element,
      scopedNameMap,
      parent ? renameTargetById.get(parent.id) ?? parent.name : element.parent_element,
      host ? renameTargetById.get(host.id) ?? host.name : (element as ElementWithNameRefs).host_element,
    );
    if (nextElement === element) continue;

    if (!changed) {
      nextElementsById = { ...elementsById };
      changed = true;
    }
    nextElementsById[elementId] = nextElement;
  }

  return { elementsById: nextElementsById, changed, warnings };
};
