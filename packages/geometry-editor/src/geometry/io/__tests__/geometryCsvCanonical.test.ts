// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createGeometryStore } from '../../../stores/geometryStore';
import { stripModelVersionRow } from '../geometryCsvCanonical';
import { parseCsvToGeometry } from '../parseCsvToGeometry';

const MODEL_ID = '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b';

// The shipped sample plus every metadata row the parser reads that the sample lacks
// (General_storey_of_dwelling and General_storeys_in_building are flat-only; the sample is a house).
const EXTRA_METADATA = [
  'TargetBundleId,test-bundle',
  `ModelId,${MODEL_ID}`,
  'ModelVersion,7',
  'ProvenanceMarkers,3',
  'Postcode,MK40 1AA',
  'GuideOverlay,0,v1|input/overlays/plan_p1.png|0.41|-33.68|23.82|56.7|10|13.46|-22.06|24.8|-22.06',
  'GuideOverlaySource,0,v1|pdf|input/overlay-sources/plan.pdf|plan.pdf|1|input/overlays/plan_p1.png',
  '_height_user_override,Zone 1',
  'FloorHeightOverride,0,2.6',
  'FloorBaseHeightOverride,1,2.9',
  'JunctionPsiDefaultsPath,input/junction_psi.csv',
  'DetailedBridgePsiProfileSource,test-source',
  'DetailedBridgePsiProfileId,profile-1',
  'DetailedBridgePsiProfileLabel,Profile 1',
  'PartO_active_cooling_required,FALSE',
  'Ventilation_shield_class,Normal',
  'Ventilation_altitude,50',
  'Ventilation_noise_nuisance,FALSE',
  'General_built_form,2',
].map((row) => `${row},,,,,,,,,,,,,`);

const sampleCsv = (): string => {
  const lines = readFileSync(resolve(import.meta.dirname, '../../__fixtures__/example_semi_detached.csv'), 'utf8')
    .split('\n');
  lines.splice(2, 0, ...EXTRA_METADATA);
  return lines.join('\n');
};

const loadAndGenerate = (csv: string): string => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv);
  return store.getState().generateCSV();
};

describe('shared-model identity rows', () => {
  it('parse → generate → parse → generate is byte-stable with every metadata row', () => {
    const first = loadAndGenerate(sampleCsv());
    const second = loadAndGenerate(first);
    expect(second).toBe(first);
    const metadataKeys = new Set(first.split('\n').map((line) => line.split(',')[0]));
    for (const row of EXTRA_METADATA) expect(metadataKeys).toContain(row.split(',')[0]);
    expect(first).toContain(`TargetBundleId,test-bundle,,,,,,,,,,,,,\nModelId,${MODEL_ID},,,,,,,,,,,,,\nModelVersion,7,`);
  });

  it('parses the rows, ignores a malformed version, and writes nothing when unset', () => {
    const parsed = parseCsvToGeometry(sampleCsv());
    expect(parsed.metadata.modelId).toBe(MODEL_ID);
    expect(parsed.metadata.modelVersion).toBe(7);
    const malformed = parseCsvToGeometry(sampleCsv().replace('ModelVersion,7,', 'ModelVersion,-1,'));
    expect(malformed.metadata.modelVersion).toBeUndefined();

    const store = createGeometryStore({ defaultDefaultsPath: null });
    expect(store.getState().generateCSV()).not.toMatch(/^Model(Id|Version),/m);
  });

  it('stamps an id once, sets the version, and clears both on New', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const id = store.getState().ensureModelId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.getState().ensureModelId()).toBe(id);
    store.getState().setModelVersion(0);
    expect(store.getState().generateCSV()).toContain(`ModelId,${id},,,,,,,,,,,,,\nModelVersion,0,`);
    store.getState().clearAll();
    expect(store.getState().modelId).toBeUndefined();
    expect(store.getState().modelVersion).toBeUndefined();
  });

  it('strips only the ModelVersion row, byte for byte, idempotently', () => {
    const csv = 'Metadata,,\r\nTargetBundleId,a,,\r\nModelId,x,,\r\nModelVersion,3,,\r\nZone,,\r\n';
    const stripped = stripModelVersionRow(csv);
    expect(stripped).toBe('Metadata,,\r\nTargetBundleId,a,,\r\nModelId,x,,\r\nZone,,\r\n');
    expect(stripModelVersionRow(stripped)).toBe(stripped);
    const generated = loadAndGenerate(sampleCsv());
    expect(stripModelVersionRow(generated)).toBe(generated.replace('ModelVersion,7,,,,,,,,,,,,,\n', ''));
  });
});
