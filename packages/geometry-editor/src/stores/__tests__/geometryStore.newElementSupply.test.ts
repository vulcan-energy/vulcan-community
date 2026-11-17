// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { createGeometryStore } from '../geometryStore';

it('a new fan or PV array takes the only electricity supply of a product-rule target', () => {
  const store = createGeometryStore({
    defaultDefaultsPath: null,
    schemaPort: { ...canonicalGeometrySchemaPort, targetRules: () => ({ hemDatabaseProducts: true }) },
  });
  store.setState({ defaultsJson: { EnergySupply: { 'mains elec': { fuel: 'electricity' }, gas: { fuel: 'mains_gas' } } } });
  const pv = store.getState().createPlaceholderElement('', 'OnSiteGeneration');
  expect(store.getState().elementsById[pv]?.extra_json).toMatchObject({ EnergySupply: 'mains elec' });

  store.setState({ defaultsJson: { EnergySupply: { a: { fuel: 'electricity' }, b: { fuel: 'electricity' } } } });
  const fan = store.getState().createPlaceholderElement('', 'MechanicalVentilation');
  expect((store.getState().elementsById[fan]?.extra_json as Record<string, unknown> | undefined)?.EnergySupply).toBeUndefined();
});
