// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Converts a geometry CSV to HEM input JSON with the same WASM converter the editor uses.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import defaultsTemplateText from '../../../data/defaults/defaults_template.json?raw';
import { loadCommunitySchemaText } from '../../geometry-editor/src/communitySchemaAssets';
import type {
  CommunityModelProfile,
  CommunityModelValidation,
} from '../../geometry-editor/src/communityModelBuildDocumentHost';
import { parseCsvToGeometry } from '../../../packages/geometry-editor/src/geometry/io/parseCsvToGeometry';
import { loadModelWasm } from './wasm';

export type ConvertOptions = Readonly<{ schema?: string; defaults?: string }>;

export type ConvertResponse =
  | Readonly<{ ok: true; json: unknown; validation: CommunityModelValidation; version_metadata: unknown }>
  | Readonly<{ ok: false; error: string; validation?: CommunityModelValidation | null }>;

// --defaults > the CSV's DefaultsPath (workspace-relative, so resolved against the current
// directory) > the bundled template, used only when neither declares one.
function readDefaults(declared: string | undefined): string {
  if (declared === undefined) return defaultsTemplateText;
  const path = resolve(declared);
  if (!existsSync(path)) throw new Error(`Defaults file not found: ${declared} (${path})`);
  return readFileSync(path, 'utf8');
}

export async function convertCsv(csvArg: string, options: ConvertOptions): Promise<ConvertResponse> {
  const csv = readFileSync(resolve(csvArg), 'utf8');
  const { metadata } = parseCsvToGeometry(csv);
  const profile: CommunityModelProfile =
    metadata.complianceSettings.complianceValidationEnabled === true ? 'fhs' : 'core';
  if (metadata.schemaProfile === 'ecaas_input_fhs' && options.schema === undefined) {
    throw new Error('SchemaProfile ecaas_input_fhs needs --schema <file>; Vulcan Community does not bundle that schema.');
  }
  const schemaJson = options.schema === undefined
    ? await loadCommunitySchemaText(profile)
    : readFileSync(resolve(options.schema), 'utf8');
  const defaultsJson = readDefaults(options.defaults ?? metadata.defaultsPath);

  const wasm = await loadModelWasm();
  return JSON.parse(wasm.convert_geometry_csv_request(JSON.stringify({
    csv,
    schema_json: schemaJson,
    defaults_json: defaultsJson,
    profile,
    version_metadata: {
      hem_core_version: wasm.hem_core_version(),
      ...(profile === 'fhs' ? { fhs_wrapper_version: wasm.fhs_wrapper_version() } : {}),
    },
  }))) as ConvertResponse;
}

export function printValidationErrors(validation: CommunityModelValidation | null | undefined): void {
  for (const error of validation?.errors ?? []) {
    console.error(`  [${error.code}] ${error.path}: ${error.message}`);
  }
}
