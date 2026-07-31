// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Build and cache standalone, dereferenced subschemas per category (browser-safe)
import { getSchemaKeyForCategory } from './categoryMap';

type SchemaRecord = Record<string, unknown>;

const cache = new Map<string, unknown>();
const schemaRootIds = new WeakMap<object, number>();
let nextSchemaRootId = 1;

function isSchemaRecord(value: unknown): value is SchemaRecord {
  return value !== null && typeof value === 'object';
}

function schemaRef(node: SchemaRecord): string | undefined {
  return typeof node.$ref === 'string' ? node.$ref : undefined;
}

function schemaRootCacheId(root: unknown): string {
  if (!isSchemaRecord(root)) return 'primitive';
  let id = schemaRootIds.get(root);
  if (!id) {
    id = nextSchemaRootId;
    nextSchemaRootId += 1;
    schemaRootIds.set(root, id);
  }
  return String(id);
}

function categoryToKey(category: string | undefined): string | undefined {
  if (!category) return undefined;
  return getSchemaKeyForCategory(category);
}

// JSON Pointer token decode (~1 => /, ~0 => ~)
function decodePtrToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolvePointer(root: unknown, pointer: string): unknown {
  if (!pointer || pointer === '#' || pointer === '#/') return root;
  if (!pointer.startsWith('#/')) throw new Error(`Only internal refs supported: ${pointer}`);
  const parts = pointer.slice(2).split('/').map(decodePtrToken);
  let cur: unknown = root;
  for (const p of parts) {
    if (!isSchemaRecord(cur) || !(p in cur)) {
      throw new Error(`Pointer not found: ${pointer}`);
    }
    cur = cur[p];
  }
  return cur;
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function derefSchema(node: unknown, root: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (!isSchemaRecord(node)) return node;
  if (seen.has(node)) return node;
  if (depth > 60) throw new Error('Schema dereference depth exceeded');
  seen.add(node);

  // Handle $ref first
  const ref = schemaRef(node);
  if (ref) {
    if (!ref.startsWith('#/')) throw new Error(`Only internal $ref supported: ${ref}`);
    const target = resolvePointer(root, ref);
    const resolved = derefSchema(deepClone(target), root, seen, depth + 1);
    const siblings: SchemaRecord = { ...node };
    delete siblings.$ref;
    // Merge siblings over resolved target (common pattern even if not spec-pure)
    return derefSchema({ ...(isSchemaRecord(resolved) ? resolved : {}), ...siblings }, root, seen, depth + 1);
  }

  if (Array.isArray(node)) {
    return node.map((it) => derefSchema(it, root, seen, depth + 1));
  }

  const out: SchemaRecord = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = derefSchema(v, root, seen, depth + 1);
  }
  return out;
}

export async function getDereferencedSubschema(category: string, fullSchema: SchemaRecord, mappedKey?: string): Promise<unknown> {
  const key = mappedKey ?? categoryToKey(category);
  const cacheKey = `sub:${schemaRootCacheId(fullSchema)}:${category}:${key ?? ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const properties = isSchemaRecord(fullSchema.properties) ? fullSchema.properties : undefined;
  if (!key || !properties?.[key]) {
    throw new Error(`Unknown or missing category mapping: ${category}`);
  }

  const subschemaSrc = properties[key];
  const deref = derefSchema(deepClone(subschemaSrc), fullSchema);
  cache.set(cacheKey, deref);
  return deref;
}

// Dereference any internal pointer (e.g., #/$defs/BuildingElement)
/** Synchronously dereference a schema fragment against a full root (browser/editor paths that cannot await). */
export function dereferenceSchemaNodeInRoot(node: unknown, fullRoot: unknown): unknown {
  if (node == null || typeof node !== 'object' || fullRoot == null || typeof fullRoot !== 'object') {
    return node;
  }
  return derefSchema(deepClone(node), fullRoot, new WeakSet(), 0);
}

export async function getDereferencedByPointer(fullSchema: unknown, pointer: string): Promise<unknown> {
  const key = `ptr:${schemaRootCacheId(fullSchema)}:${pointer}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (!fullSchema) throw new Error('Missing root schema');
  const target = resolvePointer(fullSchema, pointer);
  const deref = derefSchema(deepClone(target), fullSchema);
  cache.set(key, deref);
  return deref;
}
