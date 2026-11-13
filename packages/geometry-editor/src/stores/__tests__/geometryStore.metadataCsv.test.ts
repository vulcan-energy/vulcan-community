// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';

it('never writes a model-input metadata row with a blank value', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().setComplianceSettings({ GroundFloorArea: '', Ventilation_altitude: null, built_form: '' } as never);
  const csv = store.getState().generateCSV({ allowUnresolvedMigration: true });
  expect(csv).not.toMatch(/^(GroundFloorArea|Ventilation_altitude|General_built_form),(null)?,/m);
});

it('reads the pin from the Metadata rows only, and identical repeats are not a conflict', () => {
  const id = 'python-fhs-a9-918addad-b9b90138-v1';
  const pinOf = (csv: string) => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().loadFromCSV(csv);
    return store.getState().targetBundleId;
  };
  expect(pinOf(`Metadata,,\nTargetBundleId,${id},\nTargetBundleId,${id},\n`)).toBe(id);
  expect(pinOf('Metadata,,\nVulcanCsvVersion,3\n\nZone,,\nName,Type,volume,floor_area,height,simplified thermal bridging\nZone 1,Zone,10,4,2.5,FALSE\n\nLighting,,\nName,Zone,efficacy,count,power,base_height,coords,extra_json\nTargetBundleId,Zone 1,,,,,,\n')).toBeUndefined();
  expect(() => pinOf(`Metadata,,\nTargetBundleId,${id},\nTargetBundleId,other,\n`)).toThrow('conflicting TargetBundleId');
});

it('keeps the product settings rows as typed through load and save', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV('Metadata,,\nProduct_radiator,650047,\nProduct_radiator_length,Large,\nProduct_ufh,,\n');
  expect(store.getState().complianceSettings.productSettings).toEqual({ Product_radiator: '650047', Product_radiator_length: 'Large', Product_ufh: '' });
  const csv = store.getState().generateCSV({ allowUnresolvedMigration: true });
  expect(csv).toMatch(/^Product_radiator,650047,/m);
  expect(csv).toMatch(/^Product_radiator_length,Large,/m);
  expect(csv).toMatch(/^Product_ufh,,/m);
});

it('keeps the HEMIE_ model settings as typed through load and save', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV('Metadata,,\nHEMIE_age_band,D\nHEMIE_construction_external_wall,"{""wall_construction_type"":""cavity""}"\n');
  expect(store.getState().complianceSettings.hemieSettings).toEqual({
    HEMIE_age_band: 'D',
    HEMIE_construction_external_wall: '{"wall_construction_type":"cavity"}',
  });
  const csv = store.getState().generateCSV({ allowUnresolvedMigration: true });
  expect(csv).toMatch(/^HEMIE_age_band,D,/m);
  expect(csv).toMatch(/^HEMIE_construction_external_wall,"\{""wall_construction_type"":""cavity""\}",/m);
});
