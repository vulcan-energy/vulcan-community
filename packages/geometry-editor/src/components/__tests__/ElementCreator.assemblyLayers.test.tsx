// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * An element's layers sit in its panel: each row edit applies at once with undo, and the U-value
 * field shows the layers' U as its source, which a typed U-value overrides and its reset restores.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import coreSchema from '../../../../../data/schemas/core-input.schema.json';
import fhsSchema from '../../../../../data/schemas/input_fhs.schema.json';
import type { BundledAssemblyLibrary } from '../../lib/assemblyLibrary';
import type { AssemblyExample, MaterialRow } from '../../lib/assemblyTypes';

const library = vi.hoisted(() => {
  const material = (id: string, name: string, lambda: number) =>
    ({ id, name, shortName: name, lambda_W_mK: lambda, density_kg_m3: 500, specific_heat_J_kg_K: 1500 });
  return {
    materialsById: new Map([['insulation', material('insulation', 'Insulation', 0.04)], ['brick', material('brick', 'Brick', 0.77)]]),
    cavityResistanceByType: new Map(),
    cavityRows: [],
    examples: [],
    materialCategories: [],
  };
});
vi.mock('../../lib/assemblyLibrary', () => ({ loadBundledAssemblyLibrary: vi.fn(async () => library), upsertUserAssembly: vi.fn() }));

import { canonicalGeometrySchemaPort, configureGeometrySchemaAssetSource, resetGeometrySchemaAssetsForTests } from '../../lib/geometrySchemaPort';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { emptyGeometryInspectorContributions } from '../../../../geometry-editor-host/src/inspectorContributions';
import { createGeometryStore, GeometryStoreProvider, type GeometryStoreApi } from '../../stores/geometryStore';
import type { Element } from '../../geometry/types';
import { ElementCreator } from '../ElementCreator';
import { ASSEMBLY_SET_ASIDE_KEY } from '../../lib/assemblyAppliedUi';
import { computePatchFromSavedAssembly } from '../../lib/multiSelectAssemblyApply';

beforeAll(async () => {
  configureGeometrySchemaAssetSource({ loadText: async (mode) => JSON.stringify(mode === 'fhs' ? fhsSchema : coreSchema) });
  await Promise.all([canonicalGeometrySchemaPort.preload('core'), canonicalGeometrySchemaPort.preload('fhs')]);
});
afterAll(() => resetGeometrySchemaAssetsForTests());
afterEach(() => cleanup());

const lib = library as unknown as BundledAssemblyLibrary & { materialsById: Map<string, MaterialRow> };
const buildUp = (insulationM: number): AssemblyExample => ({
  id: 'calculator:layered', name: '', elementType: 'wall',
  layers: [{ kind: 'solid', materialId: 'insulation', thickness_m: insulationM }, { kind: 'solid', materialId: 'brick', thickness_m: 0.1 }],
});
const applied = (insulationM: number) => computePatchFromSavedAssembly(buildUp(insulationM), lib, 'BuildingElementOpaque', 90)!;

function openWall(): GeometryStoreApi {
  const wall = {
    id: 'w', type: 'BuildingElementOpaque', name: 'Wall (S)', zoneId: 'z', floorId: '0', pitch: 90, orientation360: 180,
    width: 4, height: 2.4, area: 9.6, coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
    extra_json: applied(0.15).patch,
  } as unknown as Element;
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: canonicalGeometrySchemaPort });
  store.setState({
    elementsById: { w: wall }, elementIds: ['w'], defaultsLoading: false,
    zones: [{ id: 'z', name: 'Zone', floorArea: 20, height: 2.4 }], zoneIds: ['z'],
  } as never);
  render(
    <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <ElementCreator selection={{ type: 'element', id: 'w' } as never} setSelection={vi.fn()} useCard={false}
          inspectorContributions={emptyGeometryInspectorContributions} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return store;
}

const extra = (store: GeometryStoreApi) => store.getState().elementsById.w!.extra_json as Record<string, unknown>;
const uField = () => document.querySelector<HTMLElement>('[data-field-key="u_value"]')!;

describe('element panel layers', () => {
  it('shows the rows in the panel and the U-value from the layers, with no applied card or Update element', async () => {
    openWall();
    expect(await screen.findByRole('button', { name: 'Insulation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Brick' })).toBeInTheDocument();
    for (const name of ['Edit layers', 'Change assembly', 'Assembly calculator', 'Update element']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Opaque element')).not.toBeInTheDocument();
    await waitFor(() => expect(uField()).toBeTruthy());
    expect(within(uField()).getByText('from the layers')).toBeInTheDocument();
    expect(within(uField()).getByRole('textbox')).toHaveValue(String(applied(0.15).patch.u_value));
  });

  it('a row edit applies at once, and undo brings the old layers back', async () => {
    const store = openWall();
    await screen.findByRole('button', { name: 'Insulation' });
    act(() => store.getState().saveToHistory('opened'));
    fireEvent.change(screen.getByLabelText('Layer 1 thickness (mm)'), { target: { value: '250' } });
    await waitFor(() => expect(extra(store).u_value).toBe(applied(0.25).patch.u_value));
    expect(extra(store).thermal_resistance_construction).toBe(applied(0.25).patch.thermal_resistance_construction);
    act(() => store.getState().saveToHistory('edit'));
    act(() => store.getState().undo());
    expect(extra(store).u_value).toBe(applied(0.15).patch.u_value);
    await waitFor(() => expect(screen.getByLabelText('Layer 1 thickness (mm)')).toHaveValue('150'));
  });

  it('a typed U-value overrides the layers, which stay; its reset brings them back', async () => {
    const store = openWall();
    await screen.findByRole('button', { name: 'Insulation' });
    await waitFor(() => expect(uField()).toBeTruthy());
    fireEvent.change(within(uField()).getByRole('textbox'), { target: { value: '0.3' } });
    await waitFor(() => expect(extra(store).u_value).toBe(0.3));
    expect(extra(store).vulcan_assembly_v1).toBeUndefined();
    expect(extra(store).thermal_resistance_construction).toBeUndefined();
    expect(extra(store)[ASSEMBLY_SET_ASIDE_KEY]).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Insulation' })).toBeInTheDocument();

    fireEvent.click(within(uField()).getByRole('button', { name: /use the layers/ }));
    await waitFor(() => expect(extra(store).vulcan_assembly_v1).toBeTruthy());
    expect(extra(store)).toMatchObject({
      u_value: applied(0.15).patch.u_value,
      thermal_resistance_construction: applied(0.15).patch.thermal_resistance_construction,
    });
    expect(extra(store)[ASSEMBLY_SET_ASIDE_KEY]).toBeUndefined();
  });
});
