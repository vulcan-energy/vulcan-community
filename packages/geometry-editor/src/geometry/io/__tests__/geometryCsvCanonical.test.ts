// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

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

// Two zones each with a wall named "Wall 1": names are unique per zone, not per model.
const TWO_ZONE_CSV = `Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,
VulcanCsvVersion,3,,,,,,,,,,,,,
,,,,,,,,,,,,
Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone A,Zone,60,25,2.4,FALSE
Zone B,Zone,60,25,2.4,FALSE

Exposed Elements,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
Wall 1,Zone A,BuildingElementOpaque,12,90,5,2.4,180,0,FALSE,FALSE,,"0.000,0.000,0.000|5.000,0.000,0.000","{""_name_auto_sync"":false}"
Wall 1,Zone B,BuildingElementOpaque,12,90,5,2.4,180,0,FALSE,FALSE,,"10.000,0.000,0.000|15.000,0.000,0.000","{""_name_auto_sync"":false}"

Thermal Bridging Elements,,,,,,,,,
Name,Zone,Type,heat_transfer_coeff,length,linear_thermal_transmittance,parent_element,coords,extra_json
TB 1,Zone B,ThermalBridgeLinear,,2.4,0.06,,"10.000,0.000,0.000|10.000,0.000,2.400","{""junction_type"":""E18"",""thermal_bridge_source"":{""host_wall_name"":""Wall 1""},""_vulcan_ui_tb_adjacent_element_name"":""Wall 1""}"
`;

const loadAndGenerate = (csv: string): string => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv);
  return store.getState().generateCSV();
};

// Every geometry CSV this repository ships as a sample.
const SHIPPED_SAMPLES = [
  '../../__fixtures__/example_semi_detached.csv',
  '../../../../../../crates/vulcan-model-wasm/tests/fixtures/min_working.csv',
];

describe('shared-model identity rows', () => {
  it.each(SHIPPED_SAMPLES)('load → generate → load → generate is byte-identical for %s', (path) => {
    const first = loadAndGenerate(readFileSync(resolve(import.meta.dirname, path), 'utf8'));
    expect(loadAndGenerate(first)).toBe(first);
  });

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

  it('serialises thermal-bridge hosts by name, resolved within the bridge zone', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().loadFromCSV(TWO_ZONE_CSV);
    const first = store.getState().generateCSV();
    const reloaded = createGeometryStore({ defaultDefaultsPath: null });
    reloaded.getState().loadFromCSV(first);
    expect(reloaded.getState().generateCSV()).toBe(first);

    expect(first).toContain('""host_wall_name"":""Wall 1""');
    expect(first).toContain('""_vulcan_ui_tb_adjacent_element_name"":""Wall 1""');
    const { elementsById, zones } = reloaded.getState();
    for (const id of Object.keys(elementsById)) expect(first).not.toContain(id);
    const bridge = Object.values(elementsById).find((element) => element.type === 'ThermalBridgeLinear')!;
    const extra = bridge.extra_json as { thermal_bridge_source: { host_wall_id: string }; _vulcan_ui_tb_adjacent_element_id: string };
    const zoneB = zones.find((zone) => zone.name === 'Zone B')!;
    for (const hostId of [extra.thermal_bridge_source.host_wall_id, extra._vulcan_ui_tb_adjacent_element_id]) {
      expect(elementsById[hostId]).toMatchObject({ name: 'Wall 1', zoneId: zoneB.id });
    }
  });

  it('range-checks ModelVersion and resets the identity for a duplicate', () => {
    const unsafe = parseCsvToGeometry(sampleCsv().replace('ModelVersion,7,', 'ModelVersion,9007199254740993,'));
    expect(unsafe.metadata.modelVersion).toBeUndefined();
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().setModelVersion(4);
    for (const bad of [-1, 1.5, Number.NaN, 2 ** 53]) store.getState().setModelVersion(bad);
    expect(store.getState().modelVersion).toBe(4);
    const id = store.getState().ensureModelId();
    store.getState().resetModelId();
    expect(store.getState().modelId).toBeUndefined();
    expect(store.getState().modelVersion).toBeUndefined();
    expect(store.getState().ensureModelId()).not.toBe(id);
  });

  it('serialises in load order when element ids are all digits', () => {
    const sample = sampleCsv();
    const baseline = loadAndGenerate(sample);
    // Descending all-digit ids enumerate in reverse load order from `Object.values(elementsById)`.
    let next = 899999999;
    const random = vi.spyOn(Math, 'random').mockImplementation(() => (parseInt(String(next--), 36) + 0.5) / 36 ** 9);
    try {
      const first = loadAndGenerate(sample);
      expect(first).toBe(baseline);
      expect(loadAndGenerate(first)).toBe(baseline);
    } finally {
      random.mockRestore();
    }
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
    const elementNamedModelVersion = 'Metadata,,\nModelId,x,,\n,,,\nZone,,\nModelVersion,Zone,,\n';
    expect(stripModelVersionRow(elementNamedModelVersion)).toBe(elementNamedModelVersion);
  });
});
