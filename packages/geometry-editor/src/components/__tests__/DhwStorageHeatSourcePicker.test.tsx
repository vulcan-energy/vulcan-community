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
import { unavailableGeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { validateElementCore } from '../../geometry/validation/validateElement';
import { hotWaterSourceReferencesUnsatisfiedHeatSourceWet } from '../../geometry/validation/detectMissingElements';

afterEach(cleanup);

it('recognises an internal HWOHP without changing its data, replaces it, and picks it again with defaults', () => {
  const extraJson = { HotWaterSource: { 'hw cylinder': {
    type: 'StorageTank', volume: 200, HeatSource: { hwo_hp: { type: 'HeatPump_HWOnly', power_max: 5, test_data: { M: { cop_dhw: 2.5 } } } },
  } } };
  const system: System = { id: 'dhw', name: 'Cylinder', type: 'System', subcategory: 'HotWaterSource',
    parent_element: null, coordinates: [{ x: 0, y: 0, z: 0 }], extra_json: extraJson };
  const onPatch = vi.fn();
  const store = createGeometryStore();
  function Harness() {
    const [extra, setExtra] = React.useState<Record<string, unknown>>(extraJson);
    return <GeometryStoreProvider store={store}>
      <DhwStorageHeatSourcePicker elementsById={{ dhw: system }} systemElement={{ ...system, extra_json: extra }}
        onPatchExtraJson={(patch) => { onPatch(patch(extra)); setExtra(patch(extra)); }} />
    </GeometryStoreProvider>;
  }
  render(<Harness />);
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  expect(select.selectedOptions[0].textContent).toBe('Hot-water-only heat pump (built-in)');
  expect(onPatch).not.toHaveBeenCalled();
  fireEvent.change(select, { target: { value: select.value } });
  expect(onPatch).toHaveBeenLastCalledWith(extraJson);
  fireEvent.change(select, { target: { value: '__dhw_immersion__' } });
  expect(select.selectedOptions[0].textContent).toBe('Immersion');
  expect(screen.getByRole('option', { name: 'Hot-water-only heat pump (built-in)' })).toBeTruthy();
  expect(onPatch).toHaveBeenLastCalledWith({ HotWaterSource: { 'hw cylinder': {
    type: 'StorageTank', volume: 200, HeatSource: { immersion: {
      type: 'ImmersionHeater', power: 3, EnergySupply: 'mains elec', heater_position: 0.1, thermostat_position: 0.33,
    } },
  } } });

  fireEvent.change(select, { target: { value: '__dhw_hwonly_heat_pump__' } });
  const picked = onPatch.mock.lastCall![0] as Record<string, unknown>;
  expect(picked).toEqual({ HotWaterSource: { 'hw cylinder': {
    type: 'StorageTank', volume: 200, heat_exchanger_surface_area: 1, HeatSource: { hwo_hp: {
      type: 'HeatPump_HWOnly', EnergySupply: 'mains elec', power_max: 5, tank_volume_declared: 100,
      daily_losses_declared: 1.05, heat_exchanger_surface_area_declared: 1.5, in_use_factor_mismatch: 0.6,
      heater_position: 0.1, thermostat_position: 0.33,
      test_data: { M: { cop_dhw: 2.5, energy_input_measured: 2.338, hw_tapping_prof_daily_total: 5.845,
        hw_vessel_loss_daily: 2, power_standby: 0.02 } },
    } },
  } } });
  // Heated by its own heat pump: valid with no HeatSourceWet anywhere in the project.
  const cylinder = { ...system, isPlaceholder: false, extra_json: picked };
  expect(validateElementCore(cylinder, {
    schemaPort: unavailableGeometrySchemaPort, elementsById: { dhw: cylinder }, complianceValidationEnabled: true,
  }).issues).toEqual([]);
  expect(hotWaterSourceReferencesUnsatisfiedHeatSourceWet([cylinder])).toBe(false);
});

it('uses the existing cylinder and heat-pump icons for the new presets', () => {
  const system = { type: 'System', subcategory: 'HeatSourceWet' } as System;
  expect(getPointElementIconNode({ ...system, system_preset: 'hwo_heat_pump_cylinder' })).toEqual(Cylinder);
  expect(getPointElementIconNode({ ...system, system_preset: 'exhaust_air_mev_heat_pump' })).toEqual(ThermometerSnowflake);
});
