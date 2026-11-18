// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { emptyGeometryInspectorContributions } from '../../../../geometry-editor-host/src/inspectorContributions';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { ElementCreator } from '../ElementCreator';
import type { Element, Zone } from '../../geometry/types';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';

// Inputs the editor can work out: the elevation of something at ground level, and the zone of a
// model with one zone.
function renderSelected(element: Element, zones: Partial<Zone>[] = []) {
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: canonicalGeometrySchemaPort });
  store.setState({ elementsById: { [element.id]: element }, elementIds: [element.id], zones, defaultsLoading: false } as never);
  render(
    <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <ElementCreator selection={{ type: 'global', id: element.id } as never} setSelection={vi.fn()} useCard={false}
          inspectorContributions={emptyGeometryInspectorContributions} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return store;
}

const appliance = (extra: Partial<Element> = {}) => ({
  id: 'a', type: 'Appliance', name: 'Fridge', appliancekey: 'Fridge', floorId: '0', coordinates: [{ x: 1, y: 2, z: 0 }], ...extra,
}) as unknown as Element;

it('shows no elevation for a point element at ground level', () => {
  renderSelected(appliance());
  expect(screen.queryByText(/Elevation above model ground/)).not.toBeInTheDocument();
});

it('shows the elevation once the element states one above ground', () => {
  renderSelected(appliance({ _base_height: 1.2 } as Partial<Element>));
  expect(screen.getByText(/Elevation above model ground/)).toBeInTheDocument();
});

const heating = (zoneId: string) => ({
  id: 's', type: 'System', subcategory: 'SpaceHeatSystem', name: 'Heating', zoneId, coordinates: [{ x: 1, y: 1, z: 0 }],
}) as unknown as Element;
const zone = (id: string, name: string) => ({ id, name, floorArea: 50 });

it('names the only zone as a source note, not a choice', () => {
  renderSelected(heating('z1'), [zone('z1', 'Zone 1')]);
  expect(screen.getByText('Zone 1')).toBeInTheDocument();
  expect(screen.getByText('the only zone')).toBeInTheDocument();
  expect(screen.queryByText('Select a zone')).not.toBeInTheDocument();
});

it('offers the zones as a choice when there are several', () => {
  renderSelected(heating('z1'), [zone('z1', 'Zone 1'), zone('z2', 'Zone 2')]);
  expect(screen.queryByText('the only zone')).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Zone 2' })).toBeInTheDocument();
});

// The Sizing block says a heat source is too big; the panel does not say it again above the fields.
it('says a sizing verdict once, in the Sizing block', () => {
  const hp = { id: 'hp', type: 'System', subcategory: 'HeatSourceWet', name: 'hp', coordinates: [{ x: 1, y: 1, z: 0 }] } as unknown as Element;
  const store = renderSelected(hp);
  act(() => store.setState({ heatingSizing: { status: 'ready', result: {
    coldestHourC: -6.5, setpointC: 21, weatherName: 'Bedford', zoneCount: 1, systems: [], notes: [],
    heatSources: [{ name: 'hp', kind: 'HeatPump', systems: [], status: 'ok', reason: null, designLossKw: 2, flowTempC: 45, minKw: 3.5, maxKw: 6.5,
      verdict: 'too-big', shortfallKw: null, balancePointC: null, hasBackupHeater: null, otherSystemsInZone: false, testPointC: -7, designBelowTestPointK: null, notes: [] }],
  } } } as never));
  expect(store.getState().validateElement(hp, store.getState().elementsById).warnings.map((warning) => warning.message))
    .toContain('hp (System): The heat pump is too big for the house. It switches on and off all year.');
  expect(screen.queryByText(/switches on and off all year/)).not.toBeInTheDocument();
});

it('keeps the elevation field while it is cleared to type a new value', async () => {
  const store = renderSelected(appliance({ _base_height: 1.2 } as Partial<Element>));
  const input = screen.getByDisplayValue('1.2');
  const user = userEvent.setup();
  await user.clear(input);
  await user.type(input, '1.5');
  expect(screen.getByDisplayValue('1.5')).toBeInTheDocument();
  expect(store.getState().elementsById.a).toMatchObject({ _base_height: 1.5 });
});
