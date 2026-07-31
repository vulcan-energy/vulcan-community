// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Cache for defaults template to check if fields have default values

import type { OpaqueFabricVariant } from './opaqueFabricVariant';
import { classifyOpaqueFabricVariant } from './opaqueFabricVariant';

export type { OpaqueFabricVariant };

type DefaultsRecord = Record<string, unknown>;

function isDefaultsRecord(value: unknown): value is DefaultsRecord {
  return value !== null && typeof value === 'object';
}

let defaultsObj: unknown | null = null;

// Phase 1: Cache for hasDefaultValue results (memoization)
// Key: `${fieldName}:${elementType || ''}:${subtype || ''}`, Value: boolean
const hasDefaultValueCache = new Map<string, boolean>();

// Phase 1: Pre-indexed lookup map for faster defaults access
// Key: `${fieldName}:${elementType || ''}`, Value: defaultValue
const defaultsIndex = new Map<string, unknown>();

/**
 * Build a pre-indexed lookup map from the defaults object.
 * This performs a one-time DFS pass to extract all field->value mappings,
 * storing them with type context for fast O(1) lookups.
 *
 * The index stores:
 * - `${fieldName}:BuildingElementOpaque:${variant}` for opaque fabric variants (last match wins)
 * - `${fieldName}:${exactType}` for exact type matches (first match wins)
 * - `${fieldName}:BuildingElement*` for BuildingElement wildcard matches
 * - `${fieldName}:*` for fallback matches (lowest priority)
 */
function buildDefaultsIndex(defaults: unknown, index: Map<string, unknown> = defaultsIndex): void {
  index.clear();
  if (!isDefaultsRecord(defaults)) return;

  const visited = new WeakSet<object>();

  function indexNode(node: unknown): void {
    if (!isDefaultsRecord(node)) return;
    if (visited.has(node)) return;
    visited.add(node);

    const nodeType = node.type;

    // Index all fields in this node
    for (const [fieldName, value] of Object.entries(node)) {
      if (fieldName === 'type') continue; // Skip type field itself

      // Store exact type match (highest priority)
      // Each element type gets its own entry, so order doesn't matter
      if (nodeType && typeof nodeType === 'string') {
        if (nodeType === 'BuildingElementOpaque') {
          const variant = classifyOpaqueFabricVariant(node);
          const variantKey = `${fieldName}:BuildingElementOpaque:${variant}`;
          index.set(variantKey, value);
        }

        const exactKey = `${fieldName}:${nodeType}`;
        // Only store if not already present (first match wins)
        if (!index.has(exactKey)) {
          index.set(exactKey, value);
        }

        // Store BuildingElement* wildcard match (if applicable)
        // First BuildingElement node encountered wins (matches DFS behavior)
        if (nodeType.startsWith('BuildingElement')) {
          const wildcardKey = `${fieldName}:BuildingElement*`;
          if (!index.has(wildcardKey)) {
            index.set(wildcardKey, value);
          }
        }
      }

      // Store fallback match (lowest priority)
      // First node encountered wins (matches dfsAny behavior)
      const fallbackKey = `${fieldName}:*`;
      if (!index.has(fallbackKey)) {
        index.set(fallbackKey, value);
      }
    }

    // Recurse into children
    const entries = Array.isArray(node) ? node : Object.values(node);
    for (const child of entries) {
      if (isDefaultsRecord(child)) {
        indexNode(child);
      }
    }
  }

  // Build index by traversing entire defaults tree
  indexNode(defaults);
}

/**
 * Invalidate all caches (call when defaults are reloaded or changed)
 */
export function invalidateDefaultsCache(): void {
  hasDefaultValueCache.clear();
  defaultsIndex.clear();
}


export function getDefaultsObject(): unknown | null {
  return defaultsObj;
}

export function setDefaultsObject(obj: unknown | null): void {
  defaultsObj = obj;
  buildDefaultsIndex(obj);
  hasDefaultValueCache.clear();
}

export function withDefaultsObject<T>(obj: unknown | null, fn: () => T): T {
  const previous = defaultsObj;
  setDefaultsObject(obj);
  try {
    return fn();
  } finally {
    setDefaultsObject(previous);
  }
}

// Test-only helpers
export function __setDefaultsObjectForTests(obj: unknown): void {
  defaultsObj = obj;
  buildDefaultsIndex(obj);
  hasDefaultValueCache.clear();
}
export function __resetDefaultsCacheForTests(): void {
  defaultsObj = null;
  invalidateDefaultsCache();
}

/**
 * Get default value from pre-indexed map (fast path).
 * Falls back to DFS if index is empty (e.g., during initial load).
 */
function getDefaultValueFromDefaultsIndexed(
  index: ReadonlyMap<string, unknown>,
  fieldName: string,
  elementType?: string,
  opaqueFabricVariant?: OpaqueFabricVariant,
): unknown {
  if (!fieldName) return undefined;

  // Try exact type match first (highest priority)
  if (elementType) {
    if (elementType === 'BuildingElementOpaque' && opaqueFabricVariant) {
      const variantKey = `${fieldName}:BuildingElementOpaque:${opaqueFabricVariant}`;
      if (index.has(variantKey)) {
        return index.get(variantKey);
      }
    }

    const exactKey = `${fieldName}:${elementType}`;
    if (index.has(exactKey)) {
      return index.get(exactKey);
    }

    // Try BuildingElement* wildcard match
    if (elementType.startsWith('BuildingElement')) {
      const wildcardKey = `${fieldName}:BuildingElement*`;
      if (index.has(wildcardKey)) {
        return index.get(wildcardKey);
      }
    }
  }

  // Fallback: any type (lowest priority)
  const fallbackKey = `${fieldName}:*`;
  if (index.has(fallbackKey)) {
    return index.get(fallbackKey);
  }

  return undefined;
}

// Helper to get default value for a specific field, similar to getDefaultValue in jsonformsRenderers
// This is the fallback DFS implementation used when index is not yet built
function getDefaultValueFromDefaults(
  defaults: unknown,
  index: ReadonlyMap<string, unknown>,
  fieldName: string,
  elementType?: string,
  opaqueFabricVariant?: OpaqueFabricVariant,
): unknown {
  if (!defaults || !fieldName) {
    return undefined;
  }

  // Try indexed lookup first (fast path)
  const indexedValue = getDefaultValueFromDefaultsIndexed(index, fieldName, elementType, opaqueFabricVariant);
  if (indexedValue !== undefined) {
    return indexedValue;
  }

  // Fallback to DFS if index is empty (shouldn't happen after preload, but safe fallback)
  const propertyNameKey = fieldName;
  let visited = new WeakSet<object>();

  function opaqueVariantMatches(node: DefaultsRecord): boolean {
    if (elementType !== 'BuildingElementOpaque' || !opaqueFabricVariant) return true;
    return classifyOpaqueFabricVariant(node) === opaqueFabricVariant;
  }

  function isRelevantNode(node: unknown): boolean {
    if (!isDefaultsRecord(node)) return false;
    const t = node?.type;
    // For BuildingElement types, look for BuildingElement* nodes
    if (elementType && elementType.startsWith('BuildingElement')) {
      return typeof t === 'string' && t.startsWith('BuildingElement');
    }
    // For other types (Appliance, etc.), look for exact type match
    return typeof t === 'string' && t === elementType;
  }

  function dfsPreferRelevantNode(node: unknown): unknown {
    if (!isDefaultsRecord(node)) return undefined;
    if (visited.has(node)) return undefined;
    visited.add(node);

    // If this is a relevant node, check here first (exact match preferred)
    const t = node.type;
    const isRelevant = isRelevantNode(node);
    if (
      isRelevant &&
      elementType &&
      t === elementType &&
      opaqueVariantMatches(node) &&
      Object.prototype.hasOwnProperty.call(node, propertyNameKey)
    ) {
      return node[propertyNameKey];
    }
    if (isRelevant && !elementType && Object.prototype.hasOwnProperty.call(node, propertyNameKey)) {
      return node[propertyNameKey];
    }

    // Recurse into children, visiting relevant children first
    const entries = Array.isArray(node) ? node : Object.values(node);
    const relevantFirst = entries.filter(isRelevantNode).concat(entries.filter((n) => !isRelevantNode(n)));
    for (const child of relevantFirst) {
      const found = dfsPreferRelevantNode(child);
      if (found !== undefined) return found;
    }

    return undefined;
  }

  function dfsAny(node: unknown): unknown {
    if (!isDefaultsRecord(node)) return undefined;
    if (visited.has(node)) return undefined;
    visited.add(node);

    if (Object.prototype.hasOwnProperty.call(node, propertyNameKey)) {
      return node[propertyNameKey];
    }

    const entries = Array.isArray(node) ? node : Object.values(node);
    for (const child of entries) {
      const found = dfsAny(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  let result = dfsPreferRelevantNode(defaults);
  if (result === undefined) {
    // Recreate visited set for the second pass
    visited = new WeakSet<object>();
    result = dfsAny(defaults);
  }
  return result;
}

export interface DefaultsLookup {
  getDefaultValueForElementField: (
    fieldName: string,
    elementType?: string,
    opaqueFabricVariant?: OpaqueFabricVariant,
  ) => unknown;
  getMechVentDefaultByVentType: (fieldName: string, ventType: string) => unknown;
  hasDefaultValue: (
    fieldName: string,
    elementType?: string,
    subschema?: { properties?: Record<string, { default?: unknown } | undefined> },
    subtype?: string,
    opaqueFabricVariant?: OpaqueFabricVariant,
  ) => boolean;
}

/** Create an isolated defaults resolver whose cache belongs only to the supplied document. */
export function createDefaultsLookup(defaults: unknown | null): DefaultsLookup {
  const index = new Map<string, unknown>();
  const hasValueCache = new Map<string, boolean>();
  buildDefaultsIndex(defaults, index);

  const getMechVentDefaultByVentTypeForDefaults = (fieldName: string, ventType: string): unknown => {
    const defaultsRecord = isDefaultsRecord(defaults) ? defaults : undefined;
    const infiltrationVentilation = defaultsRecord?.InfiltrationVentilation;
    const infiltrationRecord = isDefaultsRecord(infiltrationVentilation) ? infiltrationVentilation : undefined;
    const mvMap = infiltrationRecord?.MechanicalVentilation;
    if (!isDefaultsRecord(mvMap)) return undefined;
    for (const entry of Object.values(mvMap)) {
      if (isDefaultsRecord(entry) && entry.vent_type === ventType) {
        const value = entry[fieldName];
        if (value !== undefined) return value;
      }
    }
    return undefined;
  };

  return {
    getDefaultValueForElementField: (fieldName, elementType, opaqueFabricVariant) => {
      if (!defaults) return undefined;
      return getDefaultValueFromDefaults(defaults, index, fieldName, elementType, opaqueFabricVariant);
    },
    getMechVentDefaultByVentType: getMechVentDefaultByVentTypeForDefaults,
    hasDefaultValue: (fieldName, elementType, subschema, subtype, opaqueFabricVariant) => {
      if (subschema?.properties?.[fieldName]?.default !== undefined) return true;

      const cacheKey = `${fieldName}:${elementType || ''}:${subtype || ''}:${opaqueFabricVariant || ''}`;
      const cached = hasValueCache.get(cacheKey);
      if (cached !== undefined) return cached;

      const value = elementType === 'MechanicalVentilation' && subtype
        ? getMechVentDefaultByVentTypeForDefaults(fieldName, subtype)
        : defaults
          ? getDefaultValueFromDefaults(defaults, index, fieldName, elementType, opaqueFabricVariant)
          : undefined;
      const result = value !== undefined;
      hasValueCache.set(cacheKey, result);
      return result;
    },
  };
}

/**
 * Single-field lookup from the loaded project defaults (same resolution path as
 * {@link hasDefaultValue} / Advanced Element Editor). Returns undefined if defaults
 * are not loaded or no default exists for this field and element type.
 */
export function getDefaultValueForElementField(
  fieldName: string,
  elementType?: string,
  opaqueFabricVariant?: OpaqueFabricVariant,
): unknown {
  const defaults = getDefaultsObject();
  if (!defaults) return undefined;
  return getDefaultValueFromDefaults(defaults, defaultsIndex, fieldName, elementType, opaqueFabricVariant);
}

/**
 * MechanicalVentilation defaults are keyed by `vent_type` — `defaults_template.json` has
 * a separate `mechvent_*` entry for each vent type, and the merger picks the one matching
 * the live element's `vent_type`. Mirrors the lookup logic inside {@link hasDefaultValue}
 * for MV but returns the actual value (not just a boolean).
 */
export function getMechVentDefaultByVentType(fieldName: string, ventType: string): unknown {
  const defaults = getDefaultsObject();
  const defaultsRecord = isDefaultsRecord(defaults) ? defaults : undefined;
  const infiltrationVentilation = defaultsRecord?.InfiltrationVentilation;
  const infiltrationRecord = isDefaultsRecord(infiltrationVentilation) ? infiltrationVentilation : undefined;
  const mvMap = infiltrationRecord?.MechanicalVentilation;
  if (!isDefaultsRecord(mvMap)) return undefined;
  for (const entry of Object.values(mvMap)) {
    if (isDefaultsRecord(entry) && entry.vent_type === ventType) {
      const v = entry[fieldName];
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

/**
 * Check if a field has a default value from either:
 * 1. The defaults template (defaults_template.json)
 * 2. The schema (schema.properties[fieldName].default)
 *
 * Phase 1 optimization: Uses memoization cache and pre-indexed lookup for 10-100x faster lookups.
 *
 * @param fieldName - The field name to check (e.g., 'areal_heat_capacity')
 * @param elementType - The element type (e.g., 'BuildingElementOpaque')
 * @param subschema - The subschema for the element type (optional, for schema defaults)
 * @param subtype - The subtype for elements that need it (e.g., 'vent_type' for MechanicalVentilation)
 * @param opaqueFabricVariant - For {@link BuildingElementOpaque}, which defaults bucket (wall / roof / external door)
 * @returns true if a default exists, false otherwise
 */
export function hasDefaultValue(
  fieldName: string,
  elementType?: string,
  subschema?: { properties?: Record<string, { default?: unknown } | undefined> },
  subtype?: string,
  opaqueFabricVariant?: OpaqueFabricVariant,
): boolean {
  // Check schema default first (faster, synchronous)
  if (subschema?.properties?.[fieldName]?.default !== undefined) {
    return true;
  }

  // Phase 1: Check memoization cache (include subtype in key)
  const cacheKey = `${fieldName}:${elementType || ''}:${subtype || ''}:${opaqueFabricVariant || ''}`;
  if (hasDefaultValueCache.has(cacheKey)) {
    return hasDefaultValueCache.get(cacheKey)!;
  }

  // Special handling for MechanicalVentilation: filter by vent_type
  if (elementType === 'MechanicalVentilation' && subtype) {
    const defaults = getDefaultsObject();
    const defaultsRecord = isDefaultsRecord(defaults) ? defaults : undefined;
    const infiltrationVentilation = defaultsRecord?.InfiltrationVentilation;
    const infiltrationRecord = isDefaultsRecord(infiltrationVentilation) ? infiltrationVentilation : undefined;
    const mvMap = infiltrationRecord?.MechanicalVentilation;
    if (isDefaultsRecord(mvMap)) {
      // Only check defaults from entries matching the vent_type
      for (const entry of Object.values(mvMap)) {
        if (isDefaultsRecord(entry) && entry.vent_type === subtype) {
          if (entry[fieldName] !== undefined) {
            hasDefaultValueCache.set(cacheKey, true);
            return true;
          }
        }
      }
    }
    // No default found for this vent_type
    hasDefaultValueCache.set(cacheKey, false);
    return false;
  }

  // Phase 1: Check defaults template using pre-indexed lookup (fast path)
  const defaults = getDefaultsObject();
  let hasDefault = false;
  if (defaults) {
    // Try indexed lookup first (O(1) lookup)
    const defaultValue = getDefaultValueFromDefaultsIndexed(defaultsIndex, fieldName, elementType, opaqueFabricVariant);
    if (defaultValue !== undefined) {
      hasDefault = true;
    } else {
      // Fallback to DFS if index is empty (shouldn't happen after preload)
      const dfsValue = getDefaultValueFromDefaults(defaults, defaultsIndex, fieldName, elementType, opaqueFabricVariant);
      if (dfsValue !== undefined) {
        hasDefault = true;
      }
    }
  }

  // Cache the result for future calls
  hasDefaultValueCache.set(cacheKey, hasDefault);
  return hasDefault;
}
