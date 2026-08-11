// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// The single JSON Pointer / $ref resolver for schema code. schemaCache, schemaUtils
// and subschemaCache previously each carried their own walker; they differed in
// pointer-token decoding, array traversal and cycle handling, which is exactly the
// kind of drift that makes a ref resolve in one surface and fail in another. Error
// policy (null vs throw) and $ref-sibling merging stay with the callers — those
// differences are deliberate per use, only the walk itself is shared.

import { asSchemaNode, type SchemaNode } from './schemaTypes';

export function isInternalSchemaRef(ref: unknown): ref is string {
  return typeof ref === 'string' && (ref === '#' || ref.startsWith('#/'));
}

// JSON Pointer token decode per RFC 6901 (~1 => /, ~0 => ~)
function decodePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Walk an internal ref ("#", "#/", "#/a/b") from the schema root.
 * Traverses plain objects and arrays; returns undefined for a non-internal ref
 * or a missing path. JSON data cannot hold undefined, so undefined is
 * unambiguously "not found".
 */
export function resolveSchemaPointer(root: unknown, ref: string): unknown {
  if (!isInternalSchemaRef(ref)) return undefined;
  if (ref === '#' || ref === '#/') return root;
  let current: unknown = root;
  for (const segment of ref.slice(2).split('/').map(decodePointerToken)) {
    if (current === null || typeof current !== 'object') return undefined;
    if (!(segment in (current as Record<string, unknown>))) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** String-ref form: resolve "#/..." to a schema node, or null. */
export function resolveSchemaRef(root: SchemaNode, ref: string): SchemaNode | null {
  return asSchemaNode(resolveSchemaPointer(root, ref));
}

/**
 * Node form: if the value is a node carrying $ref, resolve it one hop from the
 * root; otherwise return the value as a node. Null when the value is not a node
 * or the ref does not lead to one.
 */
export function resolveRefNode(root: SchemaNode, value: unknown): SchemaNode | null {
  const node = asSchemaNode(value);
  if (!node?.$ref) return node;
  return resolveSchemaRef(root, node.$ref);
}

/**
 * Follow a $ref chain to its final node. Cycle-guarded by visited ref strings:
 * a cyclic chain returns the last node before the repeat instead of hanging.
 */
export function resolveRefChain(root: SchemaNode, value: unknown): SchemaNode | null {
  let resolved = resolveRefNode(root, value);
  const seen = new Set<string>();
  while (resolved?.$ref) {
    if (seen.has(resolved.$ref)) break;
    seen.add(resolved.$ref);
    const next = resolveSchemaRef(root, resolved.$ref);
    if (!next) break;
    resolved = next;
  }
  return resolved;
}
