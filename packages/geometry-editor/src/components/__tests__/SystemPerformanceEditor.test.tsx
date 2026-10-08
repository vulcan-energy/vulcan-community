// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { resolveFieldPresentation } from '../../lib/fieldPresentation';
import core from '../../../../../data/schemas/core-input.schema.json';
import fhs from '../../../../../data/schemas/input_fhs.schema.json';
import { canonicalGeometrySchemaPort, configureGeometrySchemaAssetSource, resetGeometrySchemaAssetsForTests } from '../../lib/geometrySchemaPort';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import { AdvancedFieldsEditor, SystemModelContext } from '../AdvancedFieldsEditor';
import type { Element } from '../../geometry/types';
import { DirectAdvancedFields } from '../DirectAdvancedFields';
import { readRecord } from '../../lib/jsonTypes';

beforeAll(async () => {
  configureGeometrySchemaAssetSource({ loadText: async (mode) => JSON.stringify(mode === 'fhs' ? fhs : core) });
  await Promise.all([canonicalGeometrySchemaPort.preload('core'), canonicalGeometrySchemaPort.preload('fhs')]);
});
afterAll(resetGeometrySchemaAssetsForTests);
afterEach(cleanup);

const initial = { HotWaterSource: { 'hw cylinder': { type: 'StorageTank', volume: 200, daily_losses: 1.3, heat_exchanger_surface_area: 1, ColdWaterSource: 'mains water', HeatSource: {
  'HP/one.~': { type: 'HeatPump_HWOnly', power_max: 5, tank_volume_declared: 100, daily_losses_declared: 1.05, heat_exchanger_surface_area_declared: 1.5, in_use_factor_mismatch: .6, EnergySupply: 'mains elec', heater_position: .1, thermostat_position: .33,
    test_data: { M: { cop_dhw: 2.5, energy_input_measured: 2.338, hw_tapping_prof_daily_total: 5.845, hw_vessel_loss_daily: 2, power_standby: .02 } } },
} } }, _system_source: 'custom' };

function mount(mode: boolean, preset = false) {
  const onChange = vi.fn();
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const resources = preset ? { ...unavailableGeometryWorkspaceResourcePort, availability: 'available' as const, readText: async () => JSON.stringify(initial) } : unavailableGeometryWorkspaceResourcePort;
  function Harness() {
    const [data, setData] = React.useState({ id: 'tank', type: 'System', subcategory: 'HotWaterSource', system_preset: preset ? 'hwo' : undefined, extra_json: initial });
    return <AdvancedFieldsEditor elementType="System" subtype="HotWaterSource" workspaceResourcePort={resources} currentData={data} useFHSSchema={mode} collapsible={false} onChange={(next) => { onChange(next); setData(next as typeof data); }} />;
  }
  const result = render(<GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={resources}><GeometryStoreProvider store={store}><Harness /></GeometryStoreProvider></GeometryEditorServicePortsProvider>);
  return { ...result, onChange };
}

it.each([true, false])('edits heater performance and keeps explicit profile/immersion removals (FHS=%s)', async (mode) => {
  const { container, onChange } = mount(mode);
  const input = (key: string) => within(container.querySelector(`[data-field-key="${key}"]`) as HTMLElement).getByRole('textbox');
  expect(container.querySelector('[data-field-key="power_max"]')).toHaveTextContent('kW');
  fireEvent.change(input('power_max'), { target: { value: '' } });
  expect(container.querySelector('[data-field-key="power_max"]')).toHaveTextContent('is a required property');
  fireEvent.change(input('power_max'), { target: { value: '5' } });
  fireEvent.change(input('cop_dhw'), { target: { value: '3.1' } });
  await waitFor(() => expect(onChange.mock.lastCall?.[0].extra_json.HotWaterSource['hw cylinder'].HeatSource['HP/one.~'].test_data.M.cop_dhw).toBe(3.1));
  fireEvent.click(screen.getByRole('button', { name: 'Add profile L' }));
  expect(container.querySelectorAll('[data-field-key="cop_dhw"]')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Remove profile L' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Heater to add to hw cylinder' }), { target: { value: '__dhw_immersion__' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add heater' }));
  expect(input('power')).toHaveValue('3');
  fireEvent.click(screen.getByRole('button', { name: 'Remove heater immersion' }));
  fireEvent.change(input('volume'), { target: { value: '210' } });
  const saved = onChange.mock.lastCall![0].extra_json;
  const heaters = saved.HotWaterSource['hw cylinder'].HeatSource;
  expect(Object.keys(heaters)).toEqual(['HP/one.~']);
  expect(heaters['HP/one.~'].test_data).toEqual({ M: { ...initial.HotWaterSource['hw cylinder'].HeatSource['HP/one.~'].test_data.M, cop_dhw: 3.1 } });
  const document = createGeometryStore({ defaultDefaultsPath: null });
  document.getState().addElement({ type: 'System', name: 'Cylinder', subcategory: 'HotWaterSource', parent_element: null, coordinates: [{ x: 0, y: 0, z: 0 }], extra_json: saved });
  const restored = createGeometryStore({ defaultDefaultsPath: null });
  restored.getState().loadFromCSV(document.getState().generateCSV());
  expect(Object.values(restored.getState().elementsById).find((element) => element.type === 'System')?.extra_json).toEqual({ ...saved, _name_auto_sync: false });
});

it('collapses large test tables and edits, removes and resets only test data', () => {
  const point = { test_letter: 'A', cop: 3, temp_test: -7 };
  const original = { HeatSourceWet: { 'HP.with/dots': { test_data_EN14825: Array.from({ length: 4 }, () => ({ ...point })), power_standby: .02 } } };
  const schema = {
    type: 'object', properties: {
      test_data_EN14825: {
        type: 'array', items: {
          type: 'object', required: ['cop', 'temp_test'], properties: {
            cop: { type: 'number', exclusiveMinimum: 0 },
            temp_test: { type: 'number', minimum: -273.15 },
          },
        },
      },
    },
  };
  const onChange = vi.fn();
  const store = createGeometryStore();
  function Harness() {
    const [data, setData] = React.useState(original);
    return <DirectAdvancedFields schema={{ properties: { HeatSourceWet: { properties: { 'HP.with/dots': schema } } } }} data={data} config={{ elementType: 'System', systemSampleMode: true, systemSampleBaselineExtraJson: original, schemaPort: canonicalGeometrySchemaPort }} layout={{ type: 'Control', scope: '#/properties/HeatSourceWet/properties/HP.with~1dots/properties/test_data_EN14825', label: 'Performance' }} onDataChange={(next) => { onChange(next); setData(next as typeof original); }} />;
  }
  const { container } = render(<GeometryStoreProvider store={store}><Harness /></GeometryStoreProvider>);
  const details = container.querySelector('details')!;
  expect(details.open).toBe(false);
  details.open = true; fireEvent(details, new Event('toggle'));
  expect(details).toHaveTextContent('Preset');
  const inputs = container.querySelectorAll('[data-field-key="temp_test"] input');
  fireEvent.change(inputs[0], { target: { value: '-12.5' } });
  expect(details).toHaveTextContent('Custom');
  expect(onChange.mock.lastCall![0].HeatSourceWet['HP.with/dots'].test_data_EN14825[0].temp_test).toBe(-12.5);
  expect(onChange.mock.lastCall![0].HeatSourceWet['HP.with/dots'].power_standby).toBe(.02);
  const copInput = screen.getByRole('textbox', { name: 'Point 1 · CoP' });
  fireEvent.change(copInput, { target: { value: '0' } });
  expect(copInput).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(copInput, { target: { value: '.5' } });
  expect(copInput).not.toHaveAttribute('aria-invalid', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Remove test point 1' }));
  expect(screen.getByRole('textbox', { name: 'Point 1 · CoP' })).toHaveValue('3');
  expect(onChange.mock.lastCall![0].HeatSourceWet['HP.with/dots'].test_data_EN14825).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
  expect(onChange.mock.lastCall![0]).toEqual(original);
  expect(details).toHaveTextContent('Preset');
  expect(readRecord(onChange.mock.lastCall![0]).HeatSourceWet).toBeTruthy();
});


it('shares dwelling controls and explains missing, ambiguous and insufficient ventilation', () => {
  const store = createGeometryStore();
  const pump = { HeatSourceWet: { HP: { type: 'HeatPump', source_type: 'ExhaustAirMVHR', test_data_EN14825: [{ air_flow_rate: 100 }] } } };
  const ventilation: Element = { id: 'mvhr', name: 'MVHR', type: 'MechanicalVentilation', vent_type: 'MVHR', parent_element: null, coordinates: [{ x: 0, y: 0, z: 0 }], extra_json: { design_outdoor_air_flow_rate: 80 } };
  const view = (subtype: string, elementsById: Record<string, Element> = {}) => <GeometryStoreProvider store={store}><SystemModelContext extraJson={pump} subtype={subtype} useFHSSchema elementsById={elementsById} /></GeometryStoreProvider>;
  const { rerender } = render(view('SpaceHeatSystem'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Heating control type (whole dwelling)' }), { target: { value: 'SeparateTimeAndTempControl' } });
  expect(store.getState().complianceSettings.HeatingControlType).toBe('SeparateTimeAndTempControl');
  expect(screen.getByText('Add compatible mechanical ventilation.')).toBeInTheDocument();
  rerender(view('HeatSourceWet', { mvhr: ventilation }));
  expect(screen.getByText(/below the lowest test airflow/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect MVHR' }));
  expect(store.getState().selection).toEqual({ type: 'element', id: 'mvhr' });
  rerender(view('HeatSourceWet', { mvhr: ventilation, second: { ...ventilation, id: 'second' } }));
  expect(screen.getByText(/Multiple ventilation units/)).toBeInTheDocument();
});

it('uses heat-pump capacity units rather than unrelated battery capacity metadata', () => {
  const presentation = resolveFieldPresentation({ mode: 'fhs', elementType: 'System', subtype: 'HeatSourceWet', propertyKey: 'capacity', schemaNode: { type: 'number', exclusiveMinimum: 0 } }, canonicalGeometrySchemaPort);
  expect(presentation.unit).toMatchObject({ status: 'resolved', display: 'kW' });
});


it('uses shared preset/custom badges for edited fields, reset and added immersion', async () => {
  const { container } = mount(true, true);
  const field = (key: string) => container.querySelector(`[data-field-key="${key}"]`) as HTMLElement;
  await waitFor(() => expect(field('cop_dhw')).toHaveTextContent('Preset'));
  fireEvent.change(within(field('cop_dhw')).getByRole('textbox'), { target: { value: '3.1' } });
  await waitFor(() => expect(field('cop_dhw')).toHaveTextContent('Custom'));
  expect(field('volume')).toHaveTextContent('Preset');
  fireEvent.blur(within(field('cop_dhw')).getByRole('textbox'));
  fireEvent.click(within(field('cop_dhw')).getByRole('button', { name: 'Reset field to sample preset value' }));
  await waitFor(() => expect(field('cop_dhw')).toHaveTextContent('Preset'));
  expect(within(field('cop_dhw')).getByRole('textbox')).toHaveValue('2.5');
  fireEvent.change(screen.getByRole('combobox', { name: 'Heater to add to hw cylinder' }), { target: { value: '__dhw_immersion__' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add heater' }));
  await waitFor(() => expect(field('power')).toHaveTextContent('Custom'));
  expect(field('cop_dhw')).toHaveTextContent('Preset');
});
