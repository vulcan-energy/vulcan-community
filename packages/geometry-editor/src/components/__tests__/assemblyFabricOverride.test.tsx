// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Applied assembly versus fabric value edits, through the two editing surfaces a user has:
 * the single-element Advanced Fields (ElementCreator passes its patch straight to
 * `updateElement`) and the multi-select construction rows.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import coreSchema from '../../../../../data/schemas/core-input.schema.json';
import fhsSchema from '../../../../../data/schemas/input_fhs.schema.json';
import {
  canonicalGeometrySchemaPort,
  configureGeometrySchemaAssetSource,
  resetGeometrySchemaAssetsForTests,
} from '../../lib/geometrySchemaPort';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { createGeometryStore, GeometryStoreProvider, type GeometryStoreApi } from '../../stores/geometryStore';
import type { Element } from '../../geometry/types';
import { AdvancedFieldsEditor } from '../AdvancedFieldsEditor';
import { MultiSelectPanel } from '../MultiSelectPanel';

beforeAll(async () => {
  configureGeometrySchemaAssetSource({
    loadText: async (mode) => JSON.stringify(mode === 'fhs' ? fhsSchema : coreSchema),
  });
  await Promise.all([canonicalGeometrySchemaPort.preload('core'), canonicalGeometrySchemaPort.preload('fhs')]);
});
afterAll(() => resetGeometrySchemaAssetsForTests());
afterEach(() => cleanup());

const envelope = {
  schemaVersion: 1,
  assemblyId: 'wall-assembly',
  assemblySnapshot: {
    layers: [{ kind: 'solid', materialId: 'brick', thickness_m: 0.1 }],
    pitchDegrees: 90,
    elementMode: 'BuildingElementOpaque',
  },
  appliedAt: '2026-01-01T00:00:00.000Z',
  uncorrectedU_W_m2K: 0.18,
  correctedU_W_m2K: 0.18,
  uValueWrittenToElement_W_m2K: 0.18,
  thermalResistanceConstruction_m2K_W: 5,
  calculationEngineVersion: 'test',
};

function wall(): Element {
  return {
    id: 'wall', type: 'BuildingElementOpaque', name: 'Wall', zoneId: 'zone',
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
    width: 4, height: 2.4, area: 9.6, pitch: 90,
    extra_json: { u_value: 0.18, thermal_resistance_construction: 5, vulcan_assembly_v1: envelope },
  } as Element;
}

function storeWith(element: Element): GeometryStoreApi {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.setState({
    elementsById: { [element.id]: element }, elementIds: [element.id], selectedElementIds: [element.id],
    zones: [{ id: 'zone', name: 'Zone', floorArea: 1, height: 2.4 }], zoneIds: ['zone'],
  });
  return store;
}

function providers(store: GeometryStoreApi, children: React.ReactNode) {
  return (
    <GeometryEditorServicePortsProvider
      schemaPort={canonicalGeometrySchemaPort}
      workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
    >
      <GeometryStoreProvider store={store}>{children}</GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>
  );
}

/** ElementCreator's `handleAdvancedFieldsChange` hands a non-system patch to `updateElement` unchanged. */
function SingleElementHarness({ store }: { store: GeometryStoreApi }) {
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  const element = store.getState().elementsById.wall!;
  return (
    <AdvancedFieldsEditor
      elementType="BuildingElementOpaque"
      subtype="wall"
      currentData={element}
      onChange={(patch) => {
        store.getState().updateElement('wall', patch as Partial<Element>);
        rerender();
      }}
      collapsible={false}
      useFHSSchema
    />
  );
}

function extra(store: GeometryStoreApi): Record<string, unknown> {
  return store.getState().elementsById.wall!.extra_json as Record<string, unknown>;
}

function editSingleElementU(store: GeometryStoreApi, value: string) {
  const { container } = render(providers(store, <SingleElementHarness store={store} />));
  const row = container.querySelector<HTMLElement>('[data-field-key="u_value"]')!;
  fireEvent.change(within(row).getByRole('textbox'), { target: { value } });
}

function editMultiSelectU(store: GeometryStoreApi, value: string) {
  render(providers(store, <MultiSelectPanel selectedElementIds={['wall']} onDelete={vi.fn()} />));
  fireEvent.change(screen.getByLabelText('U Value'), { target: { value } });
}

describe('assembly versus U-value edits', () => {
  it('single element: a U override keeps the assembly envelope (current behaviour)', async () => {
    const store = storeWith(wall());
    editSingleElementU(store, '0.16');
    await waitFor(() => expect(extra(store).u_value).toBe(0.16));
    expect(extra(store).vulcan_assembly_v1).toEqual(envelope);
  });

  it('multi-select: a U override clears the assembly envelope', async () => {
    const store = storeWith(wall());
    editMultiSelectU(store, '0.16');
    await waitFor(() => expect(extra(store).u_value).toBe(0.16));
    expect(extra(store).vulcan_assembly_v1).toBeUndefined();
  });

});
