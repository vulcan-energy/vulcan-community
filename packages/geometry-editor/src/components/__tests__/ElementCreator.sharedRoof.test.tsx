// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { emptyGeometryInspectorContributions } from '../../../../geometry-editor-host/src/inspectorContributions';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { ElementCreator } from '../ElementCreator';
import type { Element } from '../../geometry/types';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';

// The planes of one roof share a construction on an existing building: the plane's editor names
// the others, each a link, and offers to select them all.
const ground = {
  id: 'g', type: 'BuildingElementGround', name: 'Ground', zoneId: 'z', floorId: '0', floor_type: 'Slab_no_edge_insulation', pitch: 180,
  coordinates: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 8, z: 0 }, { x: 0, y: 8, z: 0 }],
} as unknown as Element;
const plane = (id: string, name: string, y0: number, y1: number, orientation360: number) => ({
  id, type: 'BuildingElementOpaque', name, zoneId: 'z', floorId: '0', pitch: 35, orientation360,
  coordinates: [{ x: 0, y: y0, z: 5 }, { x: 10, y: y0, z: 5 }, { x: 10, y: y1, z: 5 }, { x: 0, y: y1, z: 5 }],
}) as unknown as Element;

it('names the other planes of the roof as links, for HEM:EPC', async () => {
  const south = plane('s', 'Roof (S)', 0, 4, 180);
  const north = plane('n', 'Roof (N)', 4, 8, 0);
  const port = { ...canonicalGeometrySchemaPort, targetRules: () => ({ constructionBands: true }) };
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: port });
  store.setState({ elementsById: { g: ground, s: south, n: north }, elementIds: ['g', 's', 'n'], defaultsLoading: false } as never);
  const setSelection = vi.fn();
  render(
    <GeometryEditorServicePortsProvider schemaPort={port} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <ElementCreator selection={{ type: 'element', id: 's' } as never} setSelection={setSelection} useCard={false}
          inspectorContributions={emptyGeometryInspectorContributions} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  const note = document.querySelector('[data-shared-roof]')!;
  expect(note.textContent).toBe('One roof with Roof (N) for HEM:EPC: the values must match. Select both');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Roof (N)' }));
  expect(setSelection).toHaveBeenCalledWith({ type: 'element', id: 'n' });
});
