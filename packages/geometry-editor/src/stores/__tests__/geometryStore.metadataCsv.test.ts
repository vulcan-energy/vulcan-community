// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';

it('never writes a model-input metadata row with a blank value', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().setComplianceSettings({ complianceValidationEnabled: true, GroundFloorArea: '', Ventilation_altitude: null, built_form: '' } as never);
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
  expect(pinOf('Metadata,,\nVulcanCsvVersion,3\n\nLighting,,\nName,Zone,efficacy,count,power,base_height,coords,extra_json\nTargetBundleId,Zone 1,,,,,,\n')).toBeUndefined();
  expect(() => pinOf(`Metadata,,\nTargetBundleId,${id},\nTargetBundleId,other,\n`)).toThrow('conflicting TargetBundleId');
});
