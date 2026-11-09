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
