// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Schema-shape predicates and nullable normalization for resolved JSON Schema nodes.
 * Enum-like means a non-empty enum or non-empty oneOf/anyOf whose record branches all have `const`.
 * Nullable unwrapping handles exactly two branches: one bare null schema and one record.
 */

import { isRecord, readRecord, type JsonRecord } from './jsonTypes';

/** `oneOf`/`anyOf` narrowed to the record branches, or `null` when the keyword is absent. */
export function schemaAlternatives(schema: JsonRecord, key: 'oneOf' | 'anyOf'): JsonRecord[] | null {
  const value = schema[key];
  return Array.isArray(value) ? value.filter(isRecord) : null;
}

/** Declared `type`, normalized to a list: `'number'` -> `['number']`, absent -> `[]`. */
export function schemaTypeList(schema: JsonRecord): string[] {
  const typeValue = schema.type;
  if (Array.isArray(typeValue)) return typeValue.filter((type): type is string => typeof type === 'string');
  return typeof typeValue === 'string' ? [typeValue] : [];
}

/** True only for a non-empty `enum` array. */
export function schemaHasEnum(schema: unknown): boolean {
  const values = readRecord(schema).enum;
  return Array.isArray(values) && values.length > 0;
}

/** True when the filtered, non-empty `oneOf`/`anyOf` alternatives all have `const`. */
export function schemaHasConstAlternatives(schema: unknown, key: 'oneOf' | 'anyOf'): boolean {
  const alts = schemaAlternatives(readRecord(schema), key);
  return !!alts && alts.length > 0 && alts.every((alt) => Object.prototype.hasOwnProperty.call(alt, 'const'));
}

/** Empty alternatives must fall through to a typed input, not an unusable empty dropdown. */
export function isNonEmptyEnumLike(resolved: JsonRecord): boolean {
  return (
    schemaHasEnum(resolved) ||
    schemaHasConstAlternatives(resolved, 'oneOf') ||
    schemaHasConstAlternatives(resolved, 'anyOf')
  );
}

/** A BARE null-typed schema: exactly `{type: 'null'}`, nothing else. */
function isBareNullSchema(value: unknown): boolean {
  return isRecord(value) && value.type === 'null' && Object.keys(value).length === 1;
}

/**
 * Collapse nullable wrapper layers matching exactly `anyOf`/`oneOf: [X, {type: 'null'}]`.
 * Other shapes are returned unchanged by identity. Outer fields override inner fields; the
 * surviving inner combinator is restored under the consumed keyword. Drop only `default: null`;
 * preserve outer `title`/`description` and remove inner annotations when the outer lacks them.
 * Inner annotations name schema types, not fields; retaining them can rename distinct controls identically.
 * Stop when unchanged or after eight layers, preventing malformed recursive schemas from hanging rendering.
 */
export function unwrapNullableSchema(node: JsonRecord): JsonRecord {
  let current = node;
  // Limit traversal to eight layers so malformed recursive shapes cannot hang rendering.
  for (let pass = 0; pass < 8; pass += 1) {
    const next = unwrapNullableSchemaLayer(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

/** One layer of {@link unwrapNullableSchema}; returns `node` itself when nothing matches. */
function unwrapNullableSchemaLayer(node: JsonRecord): JsonRecord {
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const branches = node[keyword];
    if (!Array.isArray(branches) || branches.length !== 2) continue;
    if (branches.filter(isBareNullSchema).length !== 1) continue;
    const inner = branches.find((branch) => !isBareNullSchema(branch));
    if (!isRecord(inner)) continue;

    // Outer fields override inner fields; the inner branch supplies the rest.
    const merged: JsonRecord = { ...inner, ...node };
    // Restore a same-keyword combinator from the surviving inner branch.
    if (keyword in inner) merged[keyword] = inner[keyword];
    else delete merged[keyword];
    if (merged.default === null) delete merged.default;
    for (const annotation of ['title', 'description'] as const) {
      if (!(annotation in node)) delete merged[annotation];
    }
    return merged;
  }
  return node;
}

const PRIMITIVE_SCHEMA_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'integer', 'boolean']);

/** True when the unwrapped node is primitive-typed or non-empty enum-like. */
export function isPrimitiveOrEnumSchemaNode(node: unknown): boolean {
  if (!isRecord(node)) return false;
  const resolved = unwrapNullableSchema(node);
  if (isNonEmptyEnumLike(resolved)) return true;
  return schemaTypeList(resolved).some((type) => PRIMITIVE_SCHEMA_TYPES.has(type));
}
