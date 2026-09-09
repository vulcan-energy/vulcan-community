// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plain JSON narrowing, recursive clone/equality, and nested path access/update.
 * Paths use decoded segments; updates preserve the editor's immutable data semantics.
 */

import { decodePointerToken } from './schemaRefResolver';

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function readRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function errorMessageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, cloneJsonValue(child)]),
    );
  }
  return value;
}

export function jsonValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonValuesEqual(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aEntries = Object.entries(a as Record<string, unknown>);
    const bRecord = b as Record<string, unknown>;
    if (aEntries.length !== Object.keys(bRecord).length) return false;
    return aEntries.every(([key, value]) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) && jsonValuesEqual(value, bRecord[key]),
    );
  }
  return false;
}

/**
 * Split a layout scope at literal `/properties/`, then RFC 6901-decode each segment.
 * Dots remain part of keys; escaped slash and tilde names are decoded by `decodePointerToken`.
 * A scope without the standard prefix retains all of its segments.
 */
export function segmentsFromLayoutScope(scope: string): string[] {
  const tokens = scope.split('/properties/');
  const segments = scope.startsWith('#/properties/') ? tokens.slice(1) : tokens;
  return segments.map(decodePointerToken);
}

/** Canonical non-negative array-index spelling; existing arrays use it, objects keep keys. */
function isCanonicalArrayIndexSegment(segment: string): boolean {
  return /^(0|[1-9]\d*)$/.test(segment);
}

/**
 * Read a nested value; existing arrays accept canonical index segments only.
 * Missing/non-object hops and non-canonical array keys return `undefined`.
 */
export function getAtPath(data: Record<string, unknown>, segments: string[]): unknown {
  let current: unknown = data;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!isCanonicalArrayIndexSegment(segment)) return undefined;
      current = current[Number(segment)];
      continue;
    }
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Immutably set or delete a nested value. Missing containers become objects; existing arrays
 * remain arrays for canonical indices. A leaf `undefined` deletes an object key or splices an
 * array element, and empty ancestors remain present.
 */
function setAtPathNode(node: unknown, segments: string[], value: unknown): unknown {
  const [head, ...rest] = segments;
  if (Array.isArray(node) && isCanonicalArrayIndexSegment(head)) {
    const index = Number(head);
    const nextArray = node.slice();
    if (rest.length === 0) {
      if (value === undefined) {
        // Splice the leaf: a hole serializes as null rather than removing the item.
        nextArray.splice(index, 1);
      } else {
        nextArray[index] = value;
      }
      return nextArray;
    }
    nextArray[index] = setAtPathNode(nextArray[index], rest, value);
    return nextArray;
  }
  const record =
    node && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>) : {};
  const nextRecord: Record<string, unknown> = { ...record };
  if (rest.length === 0) {
    if (value === undefined) {
      delete nextRecord[head];
    } else {
      nextRecord[head] = value;
    }
    return nextRecord;
  }
  nextRecord[head] = setAtPathNode(nextRecord[head], rest, value);
  return nextRecord;
}

export function setAtPath(obj: Record<string, unknown>, segments: string[], value: unknown): Record<string, unknown> {
  return setAtPathNode(obj, segments, value) as Record<string, unknown>;
}
