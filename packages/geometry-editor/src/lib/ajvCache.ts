// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import Ajv2020 from 'ajv/dist/2020';
import { isRecord } from './jsonTypes';

type AjvInstance = InstanceType<typeof Ajv2020>;

let singletonAjv: AjvInstance | null = null;
let rootSchemaAdded = false;
let currentSchemaRoot: unknown = null;
const compiledRefs = new Set<string>();

export function getAjvInstance(): AjvInstance {
  if (singletonAjv) return singletonAjv;
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  try {
    ajv.addFormat('double', true);
    ajv.addFormat('float', true);
    ajv.addFormat('int32', true);
    ajv.addFormat('uint32', true);
    ajv.addFormat('uint', true);
  } catch {
    // ignore if already added
  }
  singletonAjv = ajv;
  return singletonAjv;
}

/** Target changes must discard compiled validators even if root keys happen to match. */
export function resetGeometrySchemaValidators(): void {
  singletonAjv = null;
  rootSchemaAdded = false;
  currentSchemaRoot = null;
  compiledRefs.clear();
}

export function ensureRootSchema(schema: unknown): void {
  const ajv = getAjvInstance();

  // Basic readiness heuristic: need properties and likely $defs for refs
  const schemaRecord = isRecord(schema) ? schema : null;
  const schemaProperties = schemaRecord && isRecord(schemaRecord.properties) ? schemaRecord.properties : null;
  const ready = !!(schemaProperties && Object.keys(schemaProperties).length > 0);
  if (!ready) return;

  // Compute schema identity
  const schemaRoot = schema;

  // If same schema already registered, no-op
  if (rootSchemaAdded && currentSchemaRoot === schemaRoot) {
    return;
  }

  // If different schema registered, reset first
  if (rootSchemaAdded && currentSchemaRoot !== schemaRoot) {
    try {
      ajv.removeSchema('root');
    } catch { /* swallow: best-effort */ }
    compiledRefs.clear();
  }

  // Register new schema
  try {
    const clone = JSON.parse(JSON.stringify(schema || {}));
    if (clone && clone.$schema) delete clone.$schema;
    if (!clone.$id) clone.$id = 'root';
    ajv.addSchema(clone, 'root');
    currentSchemaRoot = schemaRoot;
    rootSchemaAdded = true;
  } catch {
    // If schema cannot be cloned/added, leave as is
  }
}

export function precompilePointer(pointer: string, schema: unknown): void {
  const ajv = getAjvInstance();
  ensureRootSchema(schema);
  const ref = `root${pointer}`;
  if (compiledRefs.has(ref)) return;
  try {
    ajv.compile({ $ref: ref });
    compiledRefs.add(ref);
  } catch {
    // Ignore compile errors here; normal validation will surface them
  }
}

export function isRootSchemaAdded(): boolean {
  return rootSchemaAdded;
}
