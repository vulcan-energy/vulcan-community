// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { ElementCreator } from '../ElementCreator';
import type { Element } from '../../geometry/types';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';

function renderLighting(element: Element) {
  return renderElement(element);
}

function renderElement(element: Element, relatedElements: Element[] = []) {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const elements = [...relatedElements, element];
  store.setState({
    elementsById: Object.fromEntries(elements.map((candidate) => [candidate.id, candidate])),
    elementIds: elements.map((candidate) => candidate.id),
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

function windowElement(
  coordinates: Array<{ x: number; y: number; z: number }>,
): Element {
  return {
    id: 'window', type: 'BuildingElementTransparent', name: 'Window', zoneId: 'zone',
    coordinates, width: 10, height: 1, area: 10,
  } as Element;
}

function windowShading(fields: Record<string, unknown> = {}): Element {
  return {
    id: 'shade', type: 'WindowShading', name: 'Shade', zoneId: 'zone',
    coordinates: [{ x: 5, y: 4, z: 7 }], shading_type: 'overhang',
    ...fields,
  } as Element;
}

function dropdownAfterLabel(label: string): HTMLSelectElement {
  const labelText = screen.getByText(label);
  const labelContainer = labelText.closest('.tooltip-container') ?? labelText.closest('.element-label');
  const dropdown = labelContainer?.nextElementSibling?.querySelector('select');
  expect(dropdown).toBeInstanceOf(HTMLSelectElement);
  return dropdown as HTMLSelectElement;
}

function spyOnUpdates(store: ReturnType<typeof createGeometryStore>) {
  const original = store.getState().updateElement;
  const updateElement = vi.fn((...args: Parameters<typeof original>) => original(...args));
  act(() => store.setState({ updateElement }));
  return updateElement;
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

describe('R6 ElementCreator WindowShading projection fence', () => {
  it.each([
    ['interior', { x: 5, y: 4, z: 7 }, [{ x: 0, y: 0, z: 30 }, { x: 10, y: 0, z: 40 }], { x: 5, y: 0, z: 7 }],
    ['before start', { x: -3, y: 4, z: 8 }, [{ x: 0, y: 0, z: 30 }, { x: 10, y: 0, z: 40 }], { x: 0, y: 0, z: 8 }],
    ['after end', { x: 14, y: 4, z: 9 }, [{ x: 0, y: 0, z: 30 }, { x: 10, y: 0, z: 40 }], { x: 10, y: 0, z: 9 }],
    ['degenerate parent', { x: 14, y: 4, z: 10 }, [{ x: 2, y: 3, z: 30 }, { x: 2, y: 3, z: 40 }], { x: 2, y: 3, z: 10 }],
  ] as const)('keeps the linked-window %s projection and its two separate updates', (_case, point, parentCoordinates, expected) => {
    const store = renderElement(
      windowShading({ coordinates: [point] }),
      [windowElement([...parentCoordinates])],
    );
    const updateElement = spyOnUpdates(store);

    fireEvent.change(dropdownAfterLabel('Linked Window'), { target: { value: 'Window' } });

    expect(updateElement).toHaveBeenCalledTimes(2);
    expect(updateElement).toHaveBeenNthCalledWith(1, 'shade', { parent_element: 'Window' });
    expect(updateElement).toHaveBeenNthCalledWith(2, 'shade', { coordinates: [expected] });
    expect(JSON.stringify(updateElement.mock.calls.map((call) => call[1])))
      .toBe(JSON.stringify([{ parent_element: 'Window' }, { coordinates: [expected] }]));
  });

  it.each([
    ['object subtype', windowShading({ shading_type: 'object' }), windowElement([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }])],
    ['three-point parent', windowShading(), windowElement([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 5, z: 0 }])],
  ] as const)('keeps linked-window %s as a parent-only update', (_case, shading, parent) => {
    const store = renderElement(shading, [parent]);
    const updateElement = spyOnUpdates(store);

    fireEvent.change(dropdownAfterLabel('Linked Window'), { target: { value: 'Window' } });

    expect(updateElement).toHaveBeenCalledExactlyOnceWith('shade', { parent_element: 'Window' });
  });

  it('keeps the store-normalized missing point in the second linked-window update', () => {
    const store = renderElement(
      windowShading({ coordinates: [] }),
      [windowElement([{ x: 0, y: 0, z: 30 }, { x: 10, y: 0, z: 40 }])],
    );
    const updateElement = spyOnUpdates(store);

    fireEvent.change(dropdownAfterLabel('Linked Window'), { target: { value: 'Window' } });

    expect(updateElement).toHaveBeenCalledTimes(2);
    expect(updateElement).toHaveBeenNthCalledWith(1, 'shade', { parent_element: 'Window' });
    expect(updateElement).toHaveBeenNthCalledWith(2, 'shade', {
      coordinates: [{ x: 0, y: 0, z: 0 }],
    });
  });

  it('keeps clearing the linked window as one parent-only update', () => {
    const store = renderElement(
      windowShading({ parent_element: 'Window' }),
      [windowElement([{ x: 0, y: 0, z: 30 }, { x: 10, y: 0, z: 40 }])],
    );
    const updateElement = spyOnUpdates(store);

    fireEvent.change(dropdownAfterLabel('Linked Window'), { target: { value: '' } });

    expect(updateElement).toHaveBeenCalledExactlyOnceWith('shade', { parent_element: '' });
  });

  it('keeps constrained subtype projection combined with the type update and preserves patch bytes', () => {
    const store = renderElement(
      windowShading({ shading_type: 'object', parent_element: 'Window' }),
      [windowElement([{ x: 0, y: 0, z: 30 }, { x: 10, y: 0, z: 40 }])],
    );
    const updateElement = spyOnUpdates(store);

    fireEvent.change(dropdownAfterLabel('Shading Type'), { target: { value: 'overhang' } });

    const patch = { coordinates: [{ x: 5, y: 0, z: 7 }], shading_type: 'overhang' };
    expect(updateElement).toHaveBeenCalledExactlyOnceWith('shade', patch);
    expect(Object.keys(updateElement.mock.calls[0]?.[1] ?? {})).toEqual(['coordinates', 'shading_type']);
    expect(JSON.stringify(updateElement.mock.calls[0]?.[1])).toBe(JSON.stringify(patch));
  });

  it.each([
    ['object', 'object', { shading_type: 'object' }],
    ['empty', '', { shading_type: undefined }],
    ['missing parent', 'overhang', { shading_type: 'overhang' }],
  ] as const)('keeps the %s subtype route free of a coordinate patch', (_case, nextType, expectedPatch) => {
    const store = renderElement(windowShading({
      shading_type: nextType === 'object' ? 'overhang' : 'object',
      parent_element: _case === 'missing parent' ? 'Missing' : 'Window',
    }), [windowElement([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }])]);
    const updateElement = spyOnUpdates(store);

    fireEvent.change(dropdownAfterLabel('Shading Type'), { target: { value: nextType } });

    expect(updateElement).toHaveBeenCalledExactlyOnceWith('shade', expectedPatch);
  });

  it('does not project a subtype change onto a three-coordinate parent', () => {
    const store = renderElement(
      windowShading({ shading_type: 'object', parent_element: 'Window' }),
      [windowElement([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 5, z: 0 }])],
    );
    const updateElement = spyOnUpdates(store);

    fireEvent.change(dropdownAfterLabel('Shading Type'), { target: { value: 'overhang' } });

    expect(updateElement).toHaveBeenCalledExactlyOnceWith('shade', { shading_type: 'overhang' });
  });

  it('does not project a constrained subtype change without a point', () => {
    const store = renderElement(
      windowShading({ coordinates: [], shading_type: 'object', parent_element: 'Window' }),
      [windowElement([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }])],
    );
    const updateElement = spyOnUpdates(store);

    fireEvent.change(dropdownAfterLabel('Shading Type'), { target: { value: 'overhang' } });

    expect(updateElement).toHaveBeenCalledExactlyOnceWith('shade', { shading_type: 'overhang' });
  });
});
