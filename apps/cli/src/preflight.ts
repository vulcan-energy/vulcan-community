// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Runs the upstream FHS ingest and Part F preprocessing on a HEM model, without simulation.
// HEM:EPC has no Rust wrapper to run: its preflight is the conversion and the EPC schema check.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  CommunityModelPreflight,
  CommunityModelValidation,
} from '../../geometry-editor/src/communityModelBuildDocumentHost';
import { convertCsv, type ConvertOptions } from './convert';
import { loadModelWasm } from './wasm';

export type PreflightResult = Readonly<{
  validation?: CommunityModelValidation | null;
  conversionError?: string;
  preflight?: CommunityModelPreflight;
}>;

export async function preflightModel(path: string, options: ConvertOptions): Promise<PreflightResult> {
  let modelJson: string;
  let validation: CommunityModelValidation | undefined;
  if (path.toLowerCase().endsWith('.csv')) {
    const converted = await convertCsv(path, options);
    if (!converted.ok) return { validation: converted.validation, conversionError: converted.error };
    if (options.profile === 'epc') return { validation: converted.validation };
    modelJson = JSON.stringify(converted.json);
    validation = converted.validation;
  } else if (options.profile === 'epc') {
    throw new Error('EPC preflight checks a geometry CSV: its conversion and the HEM:EPC schema. Pass the CSV.');
  } else {
    modelJson = readFileSync(resolve(path), 'utf8');
  }
  const wasm = await loadModelWasm();
  const preflight = JSON.parse(wasm.validate_fhs_preflight(modelJson)) as CommunityModelPreflight;
  return { ...(validation === undefined ? {} : { validation }), preflight };
}

export function preflightPassed(result: PreflightResult, options: ConvertOptions = {}): boolean {
  return result.conversionError === undefined
    && result.validation?.is_valid !== false
    && (options.profile === 'epc' ? result.validation?.is_valid === true : result.preflight?.is_valid === true);
}
