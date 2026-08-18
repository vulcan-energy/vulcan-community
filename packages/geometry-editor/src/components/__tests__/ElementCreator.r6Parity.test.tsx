// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { ElementCreator } from '../ElementCreator';
import type { Element } from '../../geometry/types';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';

function renderLighting(element: Element) {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.setState({
    elementsById: { [element.id]: element }, elementIds: [element.id],
    zones: [{ id: 'zone', name: 'Zone', floorArea: 1, height: 2 }], zoneIds: ['zone'],
  });
  render(
    <GeometryEditorServicePortsProvider
      schemaPort={unavailableGeometrySchemaPort}
      workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
    >
      <GeometryStoreProvider store={store}>
        <ElementCreator
          selection={{ type: 'element', id: element.id } as never}
          setSelection={vi.fn()}
          useCard={false}
        />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return store;
}

afterEach(cleanup);

describe('R6 ElementCreator Lighting commit fence', () => {
  it.each([0, -1])('keeps %s detailed count edits omitted while preserving siblings', (value) => {
    const store = renderLighting({
      id: 'light', type: 'Lighting', name: 'light', zoneId: 'zone',
      coordinates: [{ x: 0, y: 0, z: 0 }], efficacy: 90, count: 4, power: 8,
    } as Element);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThanOrEqual(3);
    fireEvent.change(inputs[1], { target: { value: String(value) } });
    const edited = store.getState().elementsById.light;
    expect(edited?.count).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(edited, 'count')).toBe(true);
    expect(edited?.efficacy).toBe(90);
    expect(edited?.power).toBe(8);
  });
});
