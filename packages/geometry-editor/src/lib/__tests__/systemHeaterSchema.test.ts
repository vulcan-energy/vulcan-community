// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only
import type { SchemaNode } from '../schemaTypes';
import { expect, it } from 'vitest';
import fhs from '../../../../../data/schemas/input_fhs.schema.json';
import { dereferenceSchemaNodeInRoot } from '../subschemaCache';
import { flattenIfThenAllOfProperties } from '../systemSchemaFlatten';
import { buildSystemAdvancedUischema } from '../systemAdvancedUischema';

it('expands the actual named cylinder heaters and their own conditional fields', () => {
  const tank = { type: 'StorageTank', volume: 200, heat_exchanger_surface_area: 1, HeatSource: {
    'HP/one.~': { type: 'HeatPump_HWOnly', test_data: { M: { cop_dhw: 2.5 } } },
    'Backup custom': { type: 'ImmersionHeater', power: 3 },
  } };
  const schema = dereferenceSchemaNodeInRoot({ $ref: '#/$defs/Tank' }, fhs);
  const flat = flattenIfThenAllOfProperties(schema, tank, fhs) as SchemaNode;
  expect(flat.properties!.HeatSource.properties!['HP/one.~'].properties!.power_max).toBeTruthy();
  expect(flat.properties!.HeatSource.properties!['HP/one.~'].properties!.test_data.properties!.M.properties!.cop_dhw).toBeTruthy();
  expect(flat.properties!.HeatSource.properties!['Backup custom'].properties!.power).toBeTruthy();
  expect(flat.properties!.HeatSource.properties!['Backup custom'].properties!.power_max).toBeUndefined();
  const layout = JSON.stringify(buildSystemAdvancedUischema('HotWaterSource', { properties: { HotWaterSource: { properties: { 'hw cylinder': flat } } } }));
  expect(layout).toContain('HP~1one.~0');
  expect(layout).toContain('HP/one.~');
});
