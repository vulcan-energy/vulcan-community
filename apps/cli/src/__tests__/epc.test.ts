// @vitest-environment node
// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { convertCsv } from '../convert';
import { preflightModel, preflightPassed } from '../preflight';
import { modelWasmAvailable } from '../wasm';

const NEW_BUILD = fileURLToPath(new URL('./fixtures/epc_new_build.csv', import.meta.url));
const EXISTING_BUILDING = fileURLToPath(new URL('./fixtures/epc_existing_building.csv', import.meta.url));
const EPC = { profile: 'epc' } as const;

// Needs the model WASM (scripts/build-model-wasm.sh); the WASM build workflow runs it.
describe.skipIf(!modelWasmAvailable())('HEM:EPC convert and preflight', () => {
  it('converts a new build to schema-valid HEM:EPC full input', async () => {
    const result = await convertCsv(NEW_BUILD, EPC);
    if (!result.ok) throw new Error(result.error);
    expect(result.validation).toEqual(expect.objectContaining({ is_valid: true }));
    expect(result.version_metadata).toEqual({ hem_core_version: '2.0.0a4', wrapper_version: '0.13.2' });
    expect(result.json).toEqual(expect.objectContaining({ IsExistingBuilding: false }));
  });

  it('converts an existing building to schema-valid HEMIE input', async () => {
    const result = await convertCsv(EXISTING_BUILDING, EPC);
    if (!result.ok) throw new Error(result.error);
    expect(result.validation).toEqual(expect.objectContaining({ is_valid: true }));
    expect(result.json).toEqual(expect.objectContaining({
      IsExistingBuilding: true,
      Zone: expect.objectContaining({ model_type: expect.any(String), building_parts: expect.anything() }),
    }));
  });

  it('preflight passes a valid model and fails one HEM:EPC rejects', async () => {
    expect(preflightPassed(await preflightModel(NEW_BUILD, EPC), EPC)).toBe(true);
    // The same dwelling as an FHS model is not HEM:EPC input: it has no IsExistingBuilding row.
    const fhs = fileURLToPath(new URL('../../../../crates/vulcan-model-wasm/tests/fixtures/min_working.csv', import.meta.url));
    const defaults = fileURLToPath(new URL('../../../../data/defaults/defaults_template_epc.json', import.meta.url));
    const result = await preflightModel(fhs, { ...EPC, defaults });
    expect(preflightPassed(result, EPC)).toBe(false);
    await expect(preflightModel('model.json', EPC)).rejects.toThrow('EPC preflight checks a geometry CSV');
  });
});
