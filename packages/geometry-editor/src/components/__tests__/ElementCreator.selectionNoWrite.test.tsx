// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { emptyGeometryInspectorContributions } from '../../../../geometry-editor-host/src/inspectorContributions';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { ElementCreator } from '../ElementCreator';
import type { Element } from '../../geometry/types';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';

// A loaded element's floorId is its floor record's id. Selecting it must not rewrite the element:
// the write revalidated every element, re-rendered the Elements list and marked the model edited.
it('selecting an element on its own floor leaves the model unchanged', () => {
  const wall = {
    id: 'w1', type: 'BuildingElementOpaque', name: 'Wall', zoneId: 'z1', floorId: 'ground',
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
  } as Element;
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: canonicalGeometrySchemaPort });
  store.setState({
    zones: [{ id: 'z1', name: 'Zone 1', floorArea: 16, height: 2.5 }],
    floors: [{ id: 'ground', name: 'Ground', zIndex: 0 }],
    elementsById: { w1: wall }, elementIds: ['w1'], defaultsLoading: false,
  } as never);
  render(
    <GeometryEditorServicePortsProvider
      schemaPort={canonicalGeometrySchemaPort}
      workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
    >
      <GeometryStoreProvider store={store}>
        <ElementCreator selection={{ type: 'element', id: 'w1' } as never} setSelection={vi.fn()} useCard={false}
          inspectorContributions={emptyGeometryInspectorContributions} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  expect(store.getState().elementsById.w1).toBe(wall);
});
