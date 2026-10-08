// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Cylinder, ThermometerSnowflake } from 'lucide';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import type { System } from '../../geometry/types';
import { getPointElementIconNode } from '../../lib/pointElementIconSpec';
import { DhwStorageHeatSourcePicker } from '../DhwStorageHeatSourcePicker';

afterEach(cleanup);

it('adds named heaters without replacing custom data and removes only the requested heater', () => {
  const extraJson = { _system_source: 'custom', HotWaterSource: { 'Imported tank': {
    type: 'StorageTank', volume: 200, HeatSource: { 'HP/one.~': { type: 'HeatPump_HWOnly', power_max: 7, test_data: { M: { cop_dhw: 3.2 } } }, 'custom backup': { type: 'ImmersionHeater', power: 2 } },
  } } };
  const system: System = { id: 'dhw', name: 'Cylinder', type: 'System', subcategory: 'HotWaterSource',
    parent_element: null, coordinates: [{ x: 0, y: 0, z: 0 }], extra_json: extraJson };
  const onPatch = vi.fn();
  const store = createGeometryStore();
  function Harness() {
    const [extra, setExtra] = React.useState<Record<string, unknown>>(extraJson);
    return <GeometryStoreProvider store={store}>
      <DhwStorageHeatSourcePicker elementsById={{ dhw: system }} systemElement={{ ...system, extra_json: extra }}
        onPatchExtraJson={(patch) => { const next = patch(extra); onPatch(next); setExtra(next); }} />
    </GeometryStoreProvider>;
  }
  render(<Harness />);
  expect(onPatch).not.toHaveBeenCalled();
  const add = () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: '__dhw_immersion__' } }); fireEvent.click(screen.getByRole('button', { name: 'Add heater' })); };
  add(); add();
  const next = onPatch.mock.lastCall![0];
  expect(next._system_source).toBe('custom');
  expect(next.HotWaterSource['Imported tank'].volume).toBe(200);
  expect(next.HotWaterSource['Imported tank'].HeatSource).toMatchObject({ ...extraJson.HotWaterSource['Imported tank'].HeatSource, immersion: { power: 3 }, immersion_2: { power: 3 } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove heater custom backup' }));
  expect(onPatch.mock.lastCall![0].HotWaterSource['Imported tank'].HeatSource['custom backup']).toBeUndefined();
  expect(onPatch.mock.lastCall![0].HotWaterSource['Imported tank'].HeatSource['HP/one.~']).toEqual(extraJson.HotWaterSource['Imported tank'].HeatSource['HP/one.~']);
  fireEvent.click(screen.getByRole('button', { name: 'Add profile L' }));
  expect(onPatch.mock.lastCall![0].HotWaterSource['Imported tank'].HeatSource['HP/one.~'].test_data.L).toEqual({});
  fireEvent.click(screen.getByRole('button', { name: 'Remove profile L' }));
  expect(onPatch.mock.lastCall![0].HotWaterSource['Imported tank'].HeatSource['HP/one.~'].test_data).toEqual({ M: { cop_dhw: 3.2 } });
});

it('uses the existing cylinder and heat-pump icons for the new presets', () => {
  const system = { type: 'System', subcategory: 'HeatSourceWet' } as System;
  expect(getPointElementIconNode({ ...system, system_preset: 'hwo_heat_pump_cylinder' })).toEqual(Cylinder);
  expect(getPointElementIconNode({ ...system, system_preset: 'exhaust_air_mev_heat_pump' })).toEqual(ThermometerSnowflake);
});
