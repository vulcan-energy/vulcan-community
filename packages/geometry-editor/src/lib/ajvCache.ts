// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import Ajv2020 from 'ajv/dist/2020';
import { isRecord } from './jsonTypes';

type AjvInstance = InstanceType<typeof Ajv2020>;

let singletonAjv: AjvInstance | null = null;
let rootSchemaAdded = false;
let currentSchemaId: string | null = null;
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

/**
 * Compute a stable identifier for a schema to detect when it changes.
 * Uses a lightweight hash based on key distinguishing features.
 */
function computeSchemaId(schema: unknown): string {
  if (!isRecord(schema)) return 'null';

  // Create a stable identifier based on schema structure
  // Key features that distinguish Core, FHS, and Core Allowing FHS:
  // - Root properties (Location distinguishes FHS)
  // - ExternalConditions structure (timezone/start_day/etc distinguish FHS)
  // - Number of root properties
  const props = isRecord(schema.properties) ? schema.properties : {};
  const propKeys = Object.keys(props).sort();
  const hasLocation = 'Location' in props;
  const hasExternalConditions = 'ExternalConditions' in props;

  // Check ExternalConditions structure (FHS has timezone, start_day, etc.)
  let externalConditionsType = 'none';
  if (hasExternalConditions) {
    const extCond = props.ExternalConditions;
    if (isRecord(extCond)) {
      if (typeof extCond.$ref === 'string') {
        externalConditionsType = `ref:${extCond.$ref}`;
      } else if (isRecord(extCond.properties)) {
        const extProps = Object.keys(extCond.properties).sort();
        const hasTimeFields = extProps.some((p: string) =>
          ['timezone', 'start_day', 'end_day', 'daylight_savings'].includes(p)
        );
        externalConditionsType = hasTimeFields ? 'fhs' : 'core';
      }
    }
  }

  // Create identifier from distinguishing features
  const idParts = [
    `props:${propKeys.length}`,
    `hasLocation:${hasLocation}`,
    `extCond:${externalConditionsType}`,
    // Include first few property names for additional uniqueness
    `keys:${propKeys.slice(0, 5).join(',')}`,
  ];

  return idParts.join('|');
}

export function ensureRootSchema(schema: unknown): void {
  const ajv = getAjvInstance();

  // Basic readiness heuristic: need properties and likely $defs for refs
  const schemaRecord = isRecord(schema) ? schema : null;
  const schemaProperties = schemaRecord && isRecord(schemaRecord.properties) ? schemaRecord.properties : null;
  const ready = !!(schemaProperties && Object.keys(schemaProperties).length > 0);
  if (!ready) return;

  // Compute schema identity
  const schemaId = computeSchemaId(schema);

  // If same schema already registered, no-op
  if (rootSchemaAdded && currentSchemaId === schemaId) {
    return;
  }

  // If different schema registered, reset first
  if (rootSchemaAdded && currentSchemaId !== schemaId) {
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
    currentSchemaId = schemaId;
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
