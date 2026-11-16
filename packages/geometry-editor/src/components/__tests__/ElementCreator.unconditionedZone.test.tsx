// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import epcSchema from '../../../../../data/schemas/hem_epc_orchestrator_input.schema.json';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { emptyGeometryInspectorContributions } from '../../../../geometry-editor-host/src/inspectorContributions';
import type { GeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { __setSchemaObjectForTests } from '../../lib/schemaCache';
import { ElementCreator } from '../ElementCreator';
import type { Element } from '../../geometry/types';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';

afterEach(() => __setSchemaObjectForTests(null as never));

// An unconditioned zone (an unheated garage or porch) on a HEM:EPC new build: a Systems row holding
// the zone, and the unheated-space elements that border it.
function renderSelected(elements: Element[], selected: string, { existing = false } = {}) {
  __setSchemaObjectForTests(epcSchema as never);
  const port: GeometrySchemaPort = { ...canonicalGeometrySchemaPort, targetSchemaMode: () => 'core' };
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: port });
  store.setState({
    elementsById: Object.fromEntries(elements.map((e) => [e.id, e])), elementIds: elements.map((e) => e.id),
    complianceSettings: { IsExistingBuilding: existing }, defaultsLoading: false,
  } as never);
  const element = elements.find((e) => e.id === selected)!;
  render(
    <GeometryEditorServicePortsProvider schemaPort={port} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <ElementCreator selection={{ type: element.type === 'System' ? 'global' : 'element', id: selected } as never} setSelection={vi.fn()}
          useCard={false} inspectorContributions={emptyGeometryInspectorContributions} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return store;
}

const system = (extra?: Record<string, unknown>, subcategory?: string) => ({
  id: 'garage', name: 'Garage', type: 'System', zoneId: 'z', coordinates: [{ x: 1, y: 1, z: 0 }],
  ...(subcategory ? { subcategory } : {}), ...(extra ? { extra_json: extra } : {}),
}) as unknown as Element;
const garage = (zone: Record<string, unknown>) => system({ ZoneUnconditioned: { Garage: zone } }, 'ZoneUnconditioned');
const wall = (extra: Record<string, unknown>) => ({
  id: 'wall', name: 'Garage wall', type: 'BuildingElementAdjacentUnconditionedSpace_Simple', zoneId: 'z',
  width: 4, height: 2.4, area: 9.6, pitch: 90, parent_element: null, coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
  extra_json: { u_value: 0.3, ...extra },
}) as unknown as Element;
const categories = () => [...(screen.getByText('Heat source').closest('select') as HTMLSelectElement).options].map((o) => o.text);

it.each([[false, true], [true, false]])('offers the unconditioned zone category on a new build only (existing %s)', async (existing, offered) => {
  const store = renderSelected([system()], 'garage', { existing });
  expect(categories().includes('Unconditioned zone')).toBe(offered);
  if (!offered) return;
  await userEvent.setup().selectOptions(screen.getByText('Heat source').closest('select')!, 'ZoneUnconditioned');
  // Calculated is the only method HEM:EPC takes, so choosing the category states it.
  expect(store.getState().elementsById.garage).toMatchObject({ subcategory: 'ZoneUnconditioned', extra_json: { ZoneUnconditioned: { Garage: { method: 'Calculated' } } } });
});

it('edits the zone envelope and shows Direct disabled with its reason; opening writes nothing', async () => {
  const before = garage({ method: 'Calculated' });
  const store = renderSelected([before], 'garage');
  expect(store.getState().elementsById.garage).toBe(before);
  expect(screen.getByRole('button', { name: 'Direct' })).toBeDisabled();
  expect(screen.getByText('Direct is not available: HEM:EPC rejects it at present.')).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add window' }));
  await user.click(screen.getByRole('button', { name: 'Add wall or roof' }));
  expect(store.getState().elementsById.garage.extra_json).toEqual({ ZoneUnconditioned: { Garage: { method: 'Calculated', building_element: {
    'Window': { type: 'BuildingElementZoneUnconditionedTransparent' }, 'Wall': { type: 'BuildingElementZoneUnconditionedOpaque' },
  } } } });
  // The ventilation coefficient's blank is HEM's own default.
  expect(screen.getByText(/Ventilation coefficient/)).toBeInTheDocument();
  expect(screen.getByPlaceholderText('0.5')).toHaveValue('');
  expect(screen.queryByText(/Adjustment factor/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Remove Window' }));
  expect(Object.keys((store.getState().elementsById.garage.extra_json as any).ZoneUnconditioned.Garage.building_element)).toEqual(['Wall']);
});

it('switches a Direct zone from a CSV to Calculated, dropping the Direct inputs', async () => {
  const store = renderSelected([garage({ method: 'Direct', factor_adjustment_unconditioned_zone: 0.5 })], 'garage');
  expect(screen.getByText('HEM:EPC rejects the Direct method at present. Choose Calculated.')).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Calculated' }));
  expect(store.getState().elementsById.garage.extra_json).toEqual({ ZoneUnconditioned: { Garage: { method: 'Calculated' } } });
});

it('links an unheated-space element to a zone, and back to its resistance', async () => {
  const store = renderSelected([wall({ thermal_resistance_unconditioned_space: 0.5 }), garage({ method: 'Calculated' })], 'wall');
  const user = userEvent.setup();
  const from = screen.getByRole('group', { name: 'Unheated space from' });
  await user.click(within(from).getByRole('button', { name: 'Unconditioned zone' }));
  expect(store.getState().elementsById.wall.extra_json).toEqual({ u_value: 0.3, ZoneUnconditioned: 'Garage' });
  await user.click(within(from).getByRole('button', { name: 'Resistance' }));
  expect(store.getState().elementsById.wall.extra_json).toEqual({ u_value: 0.3 });
});

it('adds a zone when the model has none', async () => {
  const store = renderSelected([wall({})], 'wall');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Unconditioned zone' }));
  const zone = Object.values(store.getState().elementsById).find((e) => e.type === 'System')!;
  expect(zone).toMatchObject({ name: 'Unconditioned zone', subcategory: 'ZoneUnconditioned', extra_json: { ZoneUnconditioned: { 'Unconditioned zone': { method: 'Calculated' } } } });
  expect(store.getState().elementsById.wall.extra_json).toMatchObject({ ZoneUnconditioned: 'Unconditioned zone' });
});

it('asks nothing about zones on an existing building', () => {
  renderSelected([wall({})], 'wall', { existing: true });
  expect(screen.queryByText('Unheated space from')).not.toBeInTheDocument();
});
