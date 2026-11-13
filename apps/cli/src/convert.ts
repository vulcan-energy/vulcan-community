// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Converts a geometry CSV to HEM input JSON with the same WASM converter the editor uses.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import defaultsTemplateText from '../../../data/defaults/defaults_template.json?raw';
import epcDefaultsTemplateText from '../../../data/defaults/defaults_template_epc.json?raw';
import epcSchemaText from '../../../data/schemas/hem_epc_orchestrator_input.schema.json?raw';
import { loadCommunitySchemaText } from '../../geometry-editor/src/communitySchemaAssets';
import type {
  CommunityModelProfile,
  CommunityModelValidation,
} from '../../geometry-editor/src/communityModelBuildDocumentHost';
import { csvModelProfile } from '../../../packages/geometry-editor/src/geometry/io/modelSchemaProfile';
import { parseCsvToGeometry } from '../../../packages/geometry-editor/src/geometry/io/parseCsvToGeometry';
import { loadModelWasm } from './wasm';

/** `epc` is HEM:EPC input: new build, or existing building (HEMIE) when the CSV states IsExistingBuilding. */
export type CliModelProfile = CommunityModelProfile | 'epc';
export const CLI_MODEL_PROFILES: readonly CliModelProfile[] = ['core', 'fhs', 'epc'];

export type ConvertOptions = Readonly<{ schema?: string; defaults?: string; profile?: string }>;

// The bundled HEM:EPC schema (Orchestrator 0.13.2a0) and product data (HEM Database client
// 1.0.0a10) are the HEM:EPC 0.13.2 release set: EPC wrapper 0.13.2 on HEM Core 2.0.0a4.
const EPC_VERSION_METADATA = { hem_core_version: '2.0.0a4', wrapper_version: '0.13.2' };
const EPC_PRODUCT_DATA: Record<string, string> = Object.fromEntries(Object.entries(
  import.meta.glob('../../../data/hem_database/1.0.0a10/*.csv', { query: '?raw', import: 'default', eager: true }),
).map(([path, text]) => [path.slice(path.lastIndexOf('/') + 1), text]));

export type ConvertResponse =
  | Readonly<{ ok: true; json: unknown; validation: CommunityModelValidation; version_metadata: unknown }>
  | Readonly<{ ok: false; error: string; validation?: CommunityModelValidation | null }>;

// --defaults > the CSV's DefaultsPath (workspace-relative, so resolved against the current
// directory) > the bundled template, used only when neither declares one.
function readDefaults(declared: string | undefined, profile: CliModelProfile): string {
  if (declared === undefined) return profile === 'epc' ? epcDefaultsTemplateText : defaultsTemplateText;
  const path = resolve(declared);
  if (!existsSync(path)) throw new Error(`Defaults file not found: ${declared} (${path})`);
  return readFileSync(path, 'utf8');
}

export async function convertCsv(csvArg: string, options: ConvertOptions): Promise<ConvertResponse> {
  const csv = readFileSync(resolve(csvArg), 'utf8');
  const { metadata } = parseCsvToGeometry(csv);
  if (metadata.targetBundleId) {
    throw new Error(`CSV pins TargetBundleId '${metadata.targetBundleId}'. This CLI converts with its bundled schema and cannot apply that HEM version. Use Vulcan to prepare it, or remove the TargetBundleId line to convert with the bundled schema.`);
  }
  if (options.profile !== undefined && !CLI_MODEL_PROFILES.includes(options.profile as CliModelProfile)) {
    throw new Error(`Unknown --profile ${options.profile}: use ${CLI_MODEL_PROFILES.join(', ')}.`);
  }
  const profile = (options.profile as CliModelProfile | undefined)
    ?? csvModelProfile(metadata.targetBundleId, metadata.complianceSettings.complianceValidationCell);
  if (metadata.schemaProfile === 'ecaas_input_fhs' && options.schema === undefined) {
    throw new Error('SchemaProfile ecaas_input_fhs needs --schema <file>; Vulcan Community does not bundle that schema.');
  }
  const schemaJson = options.schema !== undefined
    ? readFileSync(resolve(options.schema), 'utf8')
    : profile === 'epc' ? epcSchemaText : await loadCommunitySchemaText(profile);
  const defaultsJson = readDefaults(options.defaults ?? metadata.defaultsPath, profile);

  const wasm = await loadModelWasm();
  return JSON.parse(wasm.convert_geometry_csv_request(JSON.stringify({
    csv,
    schema_json: schemaJson,
    defaults_json: defaultsJson,
    profile,
    ...(profile === 'epc' ? {
      conversion_profile: 'epc_full_input_v1',
      version_metadata: EPC_VERSION_METADATA,
      product_data: EPC_PRODUCT_DATA,
    } : {
      version_metadata: {
        hem_core_version: wasm.hem_core_version(),
        ...(profile === 'fhs' ? { wrapper_version: wasm.fhs_wrapper_version() } : {}),
      },
    }),
  }))) as ConvertResponse;
}

export function printValidationErrors(validation: CommunityModelValidation | null | undefined): void {
  for (const error of validation?.errors ?? []) {
    console.error(`  [${error.code}] ${error.path}: ${error.message}`);
  }
}
