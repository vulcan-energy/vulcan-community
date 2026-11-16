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

// The battery inputs a target takes, each showing the default the converter applies.
const battery = { id: 'battery', type: 'ElectricBattery', name: 'Battery', coordinates: [{ x: 1, y: 1, z: 0 }] } as Element;

it('asks for battery age, grid charging and export where the target takes them', async () => {
  const store = renderGlobal(battery, {
    targetRules: () => ({ batteryGridInputs: true }),
    getElementSubschema: () => ({ properties: { product_id: {}, battery_age: {}, battery_location: {} } }) as never,
  });
  expect(screen.getByPlaceholderText('5 (default)')).toHaveValue('');
  const charging = screen.getByText('Yes (default)').closest('select')!;
  expect(screen.getByText('No (default)')).toBeInTheDocument();
  expect(screen.getByText('Outside (default)')).toBeInTheDocument();
  expect(store.getState().validateElement(battery, store.getState().elementsById).issues.map((i) => i.fieldKey)).not.toContain('battery_location');
  // A HEM Database battery product states its own capacity and efficiency.
  const keys = store.getState().validateElement(battery, store.getState().elementsById).issues.map((i) => i.fieldKey);
  expect(keys).not.toContain('capacity');
  expect(keys).not.toContain('charge_discharge_efficiency_round_trip');
  expect(screen.queryByText(/Capacity|Efficiency/)).not.toBeInTheDocument();
  await userEvent.setup().selectOptions(charging, 'No');
  expect(store.getState().elementsById.battery).toMatchObject({ extra_json: { grid_charging_possible: false } });
  // The supply's grid import limit for charging, held on the battery.
  // Labels in sentence case, as the shared field labels give them.
  for (const label of ['Battery age', 'Grid charging possible', 'Grid exporting possible', 'Battery location', 'Grid import limit for charging (kW)']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
  const limit = screen.getByPlaceholderText('18.4 (default)');
  await userEvent.setup().type(limit, '7.2');
  expect(store.getState().elementsById.battery).toMatchObject({ extra_json: { power_limit_battery_import: 7.2 } });
  await userEvent.setup().clear(limit);
  expect(store.getState().elementsById.battery.extra_json).not.toHaveProperty('power_limit_battery_import');
});

it('asks for no battery grid input on a target without them', () => {
  const store = renderGlobal(battery, {});
  expect(store.getState().validateElement(battery, store.getState().elementsById).issues.map((i) => i.fieldKey))
    .toEqual(expect.arrayContaining(['battery_location', 'capacity', 'charge_discharge_efficiency_round_trip']));
  expect(screen.queryByText(/\(default\)/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Grid charging/)).not.toBeInTheDocument();
});

function renderElement(element: Element, schemaPort: Partial<GeometrySchemaPort>) {
  const port = { ...canonicalGeometrySchemaPort, ...schemaPort };
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: port });
  store.setState({ elementsById: { [element.id]: element }, elementIds: [element.id], defaultsLoading: false } as never);
  render(
    <GeometryEditorServicePortsProvider schemaPort={port} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <ElementCreator selection={{ type: 'element', id: element.id } as never} setSelection={vi.fn()} useCard={false}
          inspectorContributions={emptyGeometryInspectorContributions} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return store;
}

// An existing building's window states whether it has a trickle vent; unticked writes nothing.
it('saves a trickle vent on an existing-building window', async () => {
  const window = {
    id: 'w', name: 'Window', type: 'BuildingElementTransparent', zoneId: 'z', floorId: '0',
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], width: 1, height: 1, area: 1, pitch: 90, base_height: 1,
    extra_json: { window_sections: [{ window_type: 'casement' }] },
  } as unknown as Element;
  const store = renderElement(window, { targetRules: () => ({ constructionBands: true }) });
  const box = screen.getByLabelText('Trickle vent');
  expect(box).not.toBeChecked();
  const user = userEvent.setup();
  await user.click(box);
  expect(store.getState().elementsById.w.extra_json).toMatchObject({ window_sections: [{ window_type: 'casement' }], has_trickle_vent: true });
  await user.click(box);
  expect(store.getState().elementsById.w.extra_json).toMatchObject({ window_sections: [{ window_type: 'casement' }] });
  expect(store.getState().elementsById.w.extra_json).not.toHaveProperty('has_trickle_vent');
});

// A warm-air heater is a system category wherever the target schema has one.
const warmAirRoot = {
  properties: {
    General: {},
    HeatSourceWarmAir: { anyOf: [{ type: 'object', additionalProperties: { oneOf: [{ $ref: '#/$defs/Combustion' }] } }, { type: 'null' }] },
  },
  $defs: { Combustion: { type: 'object', properties: { type: { const: 'WarmAirCombustion' } } } },
};
const system = { id: 's', name: 'System', type: 'System', coordinates: [{ x: 1, y: 1, z: 0 }] } as unknown as Element;

it.each([[warmAirRoot, true], [fhsRoot, false]])('offers a warm-air heater category where the target has one', (root, offered) => {
  renderGlobal(system, { getRootSchema: () => root as never });
  const category = screen.getByText('Heat source').closest('select')!;
  expect([...category.options].map((option) => option.text).includes('Warm air heater')).toBe(offered);
});
