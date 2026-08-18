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
  it.each([
    ['Efficacy', 'efficacy', 0],
    ['Efficacy', 'efficacy', -1],
    ['Count', 'count', 0],
    ['Count', 'count', -1],
    ['Power', 'power', 0],
    ['Power', 'power', -1],
  ] as const)('keeps %s (%s) = %s omitted while preserving detailed siblings', (label, property, value) => {
    const store = renderLighting({
      id: 'light', type: 'Lighting', name: 'light', zoneId: 'zone',
      coordinates: [{ x: 0, y: 0, z: 0 }], efficacy: 90, count: 4, power: 8,
    } as Element);
    const fieldLabel = screen.getByText(label);
    const fieldInput = fieldLabel.closest('.tooltip-container')?.nextElementSibling?.querySelector('input');
    expect(fieldInput).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(fieldInput as HTMLInputElement, { target: { value: String(value) } });
    const edited = store.getState().elementsById.light;
    expect(edited?.[property]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(edited, property)).toBe(true);
    expect(edited).toMatchObject({
      efficacy: property === 'efficacy' ? undefined : 90,
      count: property === 'count' ? undefined : 4,
      power: property === 'power' ? undefined : 8,
      bulbs: {
        led: {
          efficacy: property === 'efficacy' ? undefined : 90,
          count: property === 'count' ? undefined : 4,
          power: property === 'power' ? undefined : 8,
        },
      },
    });
    const led = edited?.bulbs?.led;
    expect(Object.keys(led ?? {})).toEqual(['count', 'power', 'efficacy']);
    for (const key of ['count', 'power', 'efficacy']) {
      expect(Object.prototype.hasOwnProperty.call(led, key)).toBe(true);
    }
  });
});
