// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { emptyGeometryInspectorContributions } from '../../../../geometry-editor-host/src/inspectorContributions';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { ElementCreator } from '../ElementCreator';
import type { ContextShading } from '../../geometry/types';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';

// The Elements list, the canvas and the draw tools select an External shading object with type 'global'.
it.each(['global', 'element'] as const)('shows the Directions table and Split for a %s selection', (type) => {
  const block = {
    id: 'cs1', type: 'ContextShading', name: 'L neighbour', shading_type: 'obstacle', height: 6, parent_element: 'DefaultCentre',
    start_angle: 0, end_angle: 0, distance: 0,
    coordinates: [[9, 1], [13, 1], [13, 10], [2, 10], [2, 7], [9, 7]].map(([x, y]) => ({ x, y, z: 0 })),
  } as ContextShading;
  const floor = {
    id: 'f1', type: 'BuildingElementGround', name: 'Floor', zoneId: 'z1', floorId: 'ground',
    coordinates: [[0, 0], [8, 0], [8, 6], [0, 6]].map(([x, y]) => ({ x, y, z: 0 })),
  };
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: canonicalGeometrySchemaPort });
  store.setState({
    zones: [{ id: 'z1', name: 'Zone 1', floorArea: 48, height: 2.5 }],
    floors: [{ id: 'ground', name: 'Ground', zIndex: 0 }],
    elementsById: { cs1: block, f1: floor }, elementIds: ['cs1', 'f1'], defaultsLoading: false,
  } as never);
  render(
    <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <ElementCreator selection={{ type, id: 'cs1' } as never} setSelection={vi.fn()} useCard={false}
          inspectorContributions={emptyGeometryInspectorContributions} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return waitFor(() => {
    expect(screen.getByTestId('context-shading-directions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Split into lines' })).toBeInTheDocument();
  });
});
