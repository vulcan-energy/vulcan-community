// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { emptyGeometryInspectorContributions } from '../../../../geometry-editor-host/src/inspectorContributions';
import type { GeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { ElementCreator } from '../ElementCreator';
import type { Element } from '../../geometry/types';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';

// HEM:EPC inputs on global elements. An appliance whose target schema requires its energy supply
// (cooking) asks for it.
const epcRoot = {
  properties: { General: {}, Appliances: { $ref: '#/$defs/Appliances' } },
  $defs: {
    Appliances: { properties: { Oven: { $ref: '#/$defs/Cooking' }, Dishwasher: { type: 'object' } } },
    Cooking: { properties: { EnergySupply: { type: 'string' } }, required: ['EnergySupply'] },
  },
};
const fhsRoot = { properties: { General: {}, Appliances: { patternProperties: { 'Oven|Dishwasher': { enum: ['Default'] } } } } };

function renderGlobal(element: Element, schemaPort: Partial<GeometrySchemaPort>) {
  const port = { ...canonicalGeometrySchemaPort, ...schemaPort };
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: port });
  store.setState({
    elementsById: { [element.id]: element }, elementIds: [element.id],
    defaultsJson: { EnergySupply: { 'mains elec': {}, 'mains gas': {} } }, defaultsLoading: false,
  } as never);
  render(
    <GeometryEditorServicePortsProvider
      schemaPort={port}
      workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
    >
      <GeometryStoreProvider store={store}>
        <ElementCreator selection={{ type: 'global', id: element.id } as never} setSelection={vi.fn()} useCard={false}
          inspectorContributions={emptyGeometryInspectorContributions} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return store;
}

const renderAppliance = (appliancekey: string, root: unknown) => renderGlobal(
  { id: 'oven', type: 'Appliance', name: 'Oven', appliancekey, coordinates: [{ x: 1, y: 2, z: 0 }] } as Element,
  { getRootSchema: () => root as never, getApplianceKeys: () => ['Oven', 'Dishwasher'] },
);

it('asks for the oven energy supply and saves it in extra_json', async () => {
  const store = renderAppliance('Oven', epcRoot);
  const supply = screen.getByText('Select energy supply').closest('select')!;
  expect([...(supply as HTMLSelectElement).options].map((option) => option.value)).toEqual(['', 'mains elec', 'mains gas']);
  await userEvent.setup().selectOptions(supply, 'mains gas');
  expect(store.getState().elementsById.oven).toMatchObject({ extra_json: { EnergySupply: 'mains gas' } });
});

it.each([['Dishwasher', epcRoot], ['Oven', fhsRoot]])('asks no energy supply for %s where the schema has none', (key, root) => {
  renderAppliance(key, root);
  expect(screen.queryByText(/Energy supply/)).not.toBeInTheDocument();
});

// The battery inputs a target takes, each showing the DESNZ-defined default the converter applies.
const battery = { id: 'battery', type: 'ElectricBattery', name: 'Battery', coordinates: [{ x: 1, y: 1, z: 0 }] } as Element;

it('asks for battery age, grid charging and export where the target takes them', async () => {
  const store = renderGlobal(battery, { targetRules: () => ({ batteryGridInputs: true }) });
  expect(screen.getByPlaceholderText('5 (DESNZ-defined default)')).toHaveValue('');
  const charging = screen.getByText('Yes (DESNZ-defined default)').closest('select')!;
  expect(screen.getByText('No (DESNZ-defined default)')).toBeInTheDocument();
  expect(screen.getByText('Outside (DESNZ-defined default)')).toBeInTheDocument();
  expect(store.getState().validateElement(battery, store.getState().elementsById).issues.map((i) => i.fieldKey)).not.toContain('battery_location');
  await userEvent.setup().selectOptions(charging, 'No');
  expect(store.getState().elementsById.battery).toMatchObject({ extra_json: { grid_charging_possible: false } });
});

it('asks for no battery grid input on a target without them', () => {
  const store = renderGlobal(battery, {});
  expect(store.getState().validateElement(battery, store.getState().elementsById).issues.map((i) => i.fieldKey)).toContain('battery_location');
  expect(screen.queryByText(/DESNZ-defined default/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Grid Charging/)).not.toBeInTheDocument();
});
