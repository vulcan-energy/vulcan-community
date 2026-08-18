// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/** R6 parity fence: panel/store behavior, not a proposed descriptor helper. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import type { GeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import type { GeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import type { Element } from '../../geometry/types';
import { MultiSelectPanel } from '../MultiSelectPanel';
import { createGeometryStore, GeometryStoreProvider, type GeometryStoreApi } from '../../stores/geometryStore';

const schemaPort: GeometrySchemaPort = Object.freeze({
  availability: 'unavailable', preload: async () => undefined,
  getRootSchema: () => null, getElementSubschema: () => null,
  getBaseFieldsForElementType: () => [], getApplianceKeys: () => [],
  getStrictestIntegerKeysForElementType: () => new Set<string>(),
  getSchemaSubtypeForElementData: () => undefined, getConditionalRequiredFields: () => [],
  validateProperty: () => ({ valid: true }), findParameter: () => null,
});
// Non-assembly cases leave the unrelated catalogue effect pending; assembly cases inject their own port.
const pendingResource = new Promise<never>(() => undefined);
const resources: GeometryWorkspaceResourcePort = Object.freeze({
  availability: 'unavailable',
  readText: () => pendingResource,
  readFile: () => pendingResource,
  writeText: async () => { throw new Error('resource unavailable'); },
  writeBytes: async () => { throw new Error('resource unavailable'); },
  removeFile: async () => { throw new Error('resource unavailable'); },
  ensureDirectory: async () => { throw new Error('resource unavailable'); },
  exists: async () => false, list: async () => [],
});
const assemblyDocuments: Readonly<Record<string, string>> = Object.freeze({
  'input/assembly_library/materials.json': JSON.stringify({
    materialCategories: [],
    materials: [{
      id: 'test.board', name: 'Test board', shortName: 'test board',
      lambda_W_mK: 0.2, density_kg_m3: 800, specific_heat_J_kg_K: 1000,
    }],
  }),
  'input/assembly_library/cavity_resistances.json': JSON.stringify({ cavities: [] }),
  'input/assembly_library/assemblies.json': JSON.stringify({
    assemblies: [
      {
        id: 'test.wall', name: '', elementType: 'wall',
        layers: [{ kind: 'solid', materialId: 'test.board', thickness_m: 0.1 }],
      },
      {
        id: 'distractor.wall', name: 'Distractor assembly', elementType: 'wall',
        layers: [{ kind: 'solid', materialId: 'test.board', thickness_m: 0.2 }],
      },
    ],
  }),
});
const resolvedAssemblyResources: GeometryWorkspaceResourcePort = Object.freeze({
  ...resources,
  availability: 'available',
  readText: async (path: string) => {
    const document = assemblyDocuments[path];
    if (document === undefined) throw new Error(`unexpected assembly resource: ${path}`);
    return document;
  },
});
const rejectedAssemblyResources: GeometryWorkspaceResourcePort = Object.freeze({
  ...resources,
  availability: 'available',
  readText: async () => {
    throw new Error('assembly fixture unavailable');
  },
});
const coords = [{ x: 0, y: 0, z: 0 }];

function lighting(id: string, fields: Record<string, unknown> = {}): Element {
  return { id, type: 'Lighting', name: id, coordinates: coords, ...fields } as Element;
}
function thermalBridgePoint(id: string, heat_transfer_coeff = 4): Element {
  return {
    id, type: 'ThermalBridgePoint', name: id, coordinates: coords, zoneId: 'zone', heat_transfer_coeff,
  } as Element;
}
function transparentWindow(
  coordinates: Array<{ x: number; y: number; z: number }>,
): Element {
  return {
    id: 'window', type: 'BuildingElementTransparent', name: 'Window', zoneId: 'zone',
    coordinates, width: 10, height: 1, area: 10,
  } as Element;
}
function windowShading(id: string, fields: Record<string, unknown> = {}): Element {
  return {
    id, type: 'WindowShading', name: id, zoneId: 'zone',
    coordinates: [{ x: 5, y: 4, z: 7 }], shading_type: 'overhang',
    ...fields,
  } as Element;
}
function fabric(id: string): Element {
  return {
    id, type: 'BuildingElementOpaque', name: id,
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }],
    width: 2, height: 2, area: 4, pitch: 90,
  } as Element;
}
function mount(
  elements: Element[],
  selectedElementIds = elements.map((element) => element.id),
  workspaceResourcePort: GeometryWorkspaceResourcePort = resources,
) {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.setState({
    elementsById: Object.fromEntries(elements.map((element) => [element.id, element])),
    elementIds: elements.map((element) => element.id), selectedElementIds,
    zones: [{ id: 'zone', name: 'Zone', floorArea: 1, height: 2 }], zoneIds: ['zone'],
  });
  const view = render(
    <GeometryEditorServicePortsProvider schemaPort={schemaPort} workspaceResourcePort={workspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <MultiSelectPanel
          selectedElementIds={selectedElementIds}
          onDelete={vi.fn()}
          workspaceResourcePort={workspaceResourcePort}
        />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return { store, ...view };
}
function input(name: string): HTMLInputElement {
  return screen.getByRole('textbox', { name }) as HTMLInputElement;
}
function fieldLabels(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.multi-select-field-group .multi-select-row'))
    .map((row) => row.querySelector('.multi-select-row__label')?.textContent?.trim() ?? '');
}
function json(store: GeometryStoreApi, id: string): string {
  const element = store.getState().elementsById[id];
  if (!element) throw new Error(`missing ${id}`);
  return JSON.stringify(element);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('R6 MultiSelect parity fence — DOM, focus and keyboard', () => {
  it('keeps exact Lighting field visibility, order, labels, placeholders and bounds', () => {
    mount([
      lighting('direct', { efficacy: 90, count: 4, power: 8 }),
      lighting('nested', { bulbs: { led: { efficacy: 80, count: 2, power: 6 } } }),
    ]);
    expect(fieldLabels()).toEqual(['Efficacy', 'Count', 'Power']);
    expect(['Efficacy', 'Count', 'Power (W)'].map((name) => input(name).getAttribute('aria-label')))
      .toEqual(['Efficacy', 'Count', 'Power (W)']);
    expect(input('Efficacy')).toHaveAttribute('placeholder', 'Mixed: 80 (1), 90 (1)');
    expect(input('Count')).toHaveAttribute('placeholder', 'Mixed: 2 (1), 4 (1)');
    expect(input('Power (W)')).toHaveAttribute('placeholder', 'Mixed: 6 (1), 8 (1)');
    expect(input('Efficacy')).toHaveAttribute('min', '0');
    expect(input('Count')).toHaveAttribute('min', '1');
    expect(input('Power (W)')).toHaveAttribute('min', '0');
    expect(input('Efficacy')).toHaveAttribute('inputmode', 'decimal');

    cleanup();
    mount([thermalBridgePoint('point')]);
    expect(fieldLabels()).toEqual(['Heat Transfer Coefficient']);
    expect(input('Heat Transfer Coefficient')).toHaveValue('4');
    expect(screen.queryByRole('textbox', { name: 'Efficacy' })).not.toBeInTheDocument();
  });

  it('preserves focus and Enter-to-blur behavior for a live field', async () => {
    const user = userEvent.setup();
    const { store } = mount([lighting('one', { efficacy: 90, count: 4, power: 8 })]);
    const efficacy = input('Efficacy');
    efficacy.focus();
    expect(document.activeElement).toBe(efficacy);
    await user.keyboard('110');
    await user.keyboard('{Enter}');
    expect(document.activeElement).not.toBe(efficacy);
    expect(store.getState().elementsById.one?.efficacy).toBe(110);
    expect(efficacy).toHaveValue('110');
  });

  it('keeps exact WindowShading labels, options, conditional fields and placeholders', () => {
    mount([
      transparentWindow([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }]),
      windowShading('shade', { parent_element: 'Window', shading_type: 'object' }),
    ], ['shade']);

    expect(fieldLabels()).toEqual([
      'Linked Window', 'Shading Type', 'Distance', 'Height', 'Transparency',
    ]);
    expect(Array.from(screen.getByRole('combobox', { name: 'Linked Window' }).querySelectorAll('option'))
      .map((option) => [option.value, option.textContent]))
      .toEqual([
        ['__placeholder__', 'Set value...'], ['', 'None'], ['Window', 'Window'],
      ]);
    expect(Array.from(screen.getByRole('combobox', { name: 'Shading Type' }).querySelectorAll('option'))
      .map((option) => [option.value, option.textContent]))
      .toEqual([
        ['__placeholder__', 'Set value...'],
        ['object', 'Obstacle'], ['overhang', 'Overhang'], ['sidefinleft', 'Left fin'],
        ['sidefinright', 'Right fin'], ['reveal', 'Reveal'],
      ]);
    expect(input('Distance (m)')).toHaveAttribute('placeholder', 'No current value');
    expect(input('Height (m)')).toHaveAttribute('placeholder', 'No current value');
    expect(input('Transparency')).toHaveAttribute('placeholder', 'No current value');
    expect(screen.queryByRole('textbox', { name: 'Depth (m)' })).not.toBeInTheDocument();

    cleanup();
    mount([windowShading('shade', { shading_type: 'overhang' })]);
    expect(fieldLabels()).toEqual(['Linked Window', 'Shading Type', 'Distance', 'Depth']);
    expect(input('Depth (m)')).toHaveAttribute('placeholder', 'No current value');
    expect(screen.queryByRole('textbox', { name: 'Height (m)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Transparency' })).not.toBeInTheDocument();
  });
});

describe('R6 MultiSelect parity fence — model, bytes, persistence and history', () => {
  it('keeps three-point WindowShading parent projection and ordered per-element updates', () => {
    const parent = transparentWindow([
      { x: 0, y: 0, z: 30 }, { x: 10, y: 0, z: 40 }, { x: 10, y: 5, z: 50 },
    ]);
    const { store } = mount([
      parent,
      windowShading('b', { coordinates: [{ x: -3, y: 4, z: 8 }] }),
      windowShading('a', { coordinates: [{ x: 14, y: 4, z: 9 }] }),
    ], ['b', 'a']);
    const originalUpdateElement = store.getState().updateElement;
    const updateElement = vi.fn((...args: Parameters<typeof originalUpdateElement>) => originalUpdateElement(...args));
    act(() => store.setState({ updateElement }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Linked Window' }), {
      target: { value: 'Window' },
    });

    const aPatch = { parent_element: 'Window', coordinates: [{ x: 10, y: 0, z: 9 }] };
    const bPatch = { parent_element: 'Window', coordinates: [{ x: 0, y: 0, z: 8 }] };
    expect(updateElement).toHaveBeenCalledTimes(2);
    expect(updateElement).toHaveBeenNthCalledWith(1, 'a', aPatch, true);
    expect(updateElement).toHaveBeenNthCalledWith(2, 'b', bPatch, false);
    expect(Object.keys(updateElement.mock.calls[0]?.[1] ?? {})).toEqual(['parent_element', 'coordinates']);
    expect(JSON.stringify(updateElement.mock.calls.map((call) => call[1])))
      .toBe(JSON.stringify([aPatch, bPatch]));
  });

  it('keeps WindowShading subtype projection, undefined cleanup, key order and grouping', () => {
    const parent = transparentWindow([
      { x: 0, y: 0, z: 30 }, { x: 10, y: 0, z: 40 }, { x: 10, y: 5, z: 50 },
    ]);
    const { store } = mount([
      parent,
      windowShading('b', {
        parent_element: 'Window', shading_type: 'object', height: 2, transparency: 0.4,
        coordinates: [{ x: -3, y: 4, z: 8 }],
      }),
      windowShading('a', {
        parent_element: 'Window', shading_type: 'object', height: 3, transparency: 0.5,
        coordinates: [{ x: 14, y: 4, z: 9 }],
      }),
    ], ['b', 'a']);
    const originalUpdateElement = store.getState().updateElement;
    const updateElement = vi.fn((...args: Parameters<typeof originalUpdateElement>) => originalUpdateElement(...args));
    act(() => store.setState({ updateElement }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Shading Type' }), {
      target: { value: 'overhang' },
    });

    const aPatch = {
      shading_type: 'overhang', height: undefined, transparency: undefined,
      coordinates: [{ x: 10, y: 0, z: 9 }],
    };
    const bPatch = {
      shading_type: 'overhang', height: undefined, transparency: undefined,
      coordinates: [{ x: 0, y: 0, z: 8 }],
    };
    expect(updateElement).toHaveBeenNthCalledWith(1, 'a', aPatch, true);
    expect(updateElement).toHaveBeenNthCalledWith(2, 'b', bPatch, false);
    expect(Object.keys(updateElement.mock.calls[0]?.[1] ?? {})).toEqual([
      'shading_type', 'height', 'transparency', 'coordinates',
    ]);
    expect(Object.prototype.hasOwnProperty.call(updateElement.mock.calls[0]?.[1], 'height')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(updateElement.mock.calls[0]?.[1], 'transparency')).toBe(true);
    expect(JSON.stringify(updateElement.mock.calls.map((call) => call[1])))
      .toBe(JSON.stringify([aPatch, bPatch]));
  });

  it.each([
    ['object linked-window guard', windowShading('shade', { shading_type: 'object' }), 'Linked Window', 'Window', { parent_element: 'Window' }],
    ['missing point linked-window guard', windowShading('shade', { coordinates: [] }), 'Linked Window', 'Window', { parent_element: 'Window' }],
    ['missing parent subtype guard', windowShading('shade', { parent_element: 'Missing', shading_type: 'object' }), 'Shading Type', 'overhang', { shading_type: 'overhang', height: undefined, transparency: undefined }],
    ['object subtype guard', windowShading('shade', { shading_type: 'overhang', depth: 2 }), 'Shading Type', 'object', { shading_type: 'object', depth: undefined }],
  ] as const)('keeps the %s free of coordinate changes', (_case, shading, label, value, expectedPatch) => {
    const { store } = mount([
      transparentWindow([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }]),
      shading,
    ], ['shade']);
    const originalUpdateElement = store.getState().updateElement;
    const updateElement = vi.fn((...args: Parameters<typeof originalUpdateElement>) => originalUpdateElement(...args));
    act(() => store.setState({ updateElement }));

    fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } });

    expect(updateElement).toHaveBeenCalledExactlyOnceWith('shade', expectedPatch, false);
    expect(updateElement.mock.calls[0]?.[1]).not.toHaveProperty('coordinates');
  });

  it('keeps the single-target edit on updateElement with no skip flag', () => {
    const { store } = mount([lighting('single', { efficacy: 90, count: 4, power: 8 })]);
    const originalUpdateElement = store.getState().updateElement;
    const originalUpdateElementsBulk = store.getState().updateElementsBulk;
    const updateElement = vi.fn((...args: Parameters<typeof originalUpdateElement>) => originalUpdateElement(...args));
    const updateElementsBulk = vi.fn((...args: Parameters<typeof originalUpdateElementsBulk>) => originalUpdateElementsBulk(...args));
    act(() => store.setState({ updateElement, updateElementsBulk }));
    fireEvent.change(input('Efficacy'), { target: { value: '110' } });
    expect(updateElementsBulk).not.toHaveBeenCalled();
    expect(updateElement).toHaveBeenCalledExactlyOnceWith('single', {
      efficacy: 110,
      count: 4,
      power: 8,
      bulbs: { led: { count: 4, power: 8, efficacy: 110 } },
      extra_json: { _lighting_entry_mode: 'detailed' },
    }, false);
    expect(Object.keys(updateElement.mock.calls[0]?.[1] ?? {})).toEqual([
      'efficacy', 'count', 'power', 'bulbs', 'extra_json',
    ]);
  });

  it('routes a two-target panel edit through ordered per-element updates', () => {
    const { store } = mount([
      lighting('b', { efficacy: 80, count: 2, power: 6 }),
      lighting('a', { efficacy: 90, count: 4, power: 8 }),
    ]);
    const originalUpdateElement = store.getState().updateElement;
    const original = store.getState().updateElementsBulk;
    const updateElement = vi.fn((...args: Parameters<typeof originalUpdateElement>) => originalUpdateElement(...args));
    const updateElementsBulk = vi.fn((...args: Parameters<typeof original>) => original(...args));
    act(() => store.setState({ updateElement, updateElementsBulk }));
    fireEvent.change(input('Efficacy'), { target: { value: '110' } });
    expect(updateElementsBulk).not.toHaveBeenCalled();
    expect(updateElement).toHaveBeenCalledTimes(2);
    expect(updateElement.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ['a', true], ['b', false],
    ]);
    expect(store.getState().elementsById.a?.efficacy).toBe(110);
    expect(store.getState().elementsById.b?.efficacy).toBe(110);
  });

  it('keeps ThermalBridgePoint edits top-level and reloadable through CSV', () => {
    const { store } = mount([thermalBridgePoint('point', 4)]);
    const originalUpdateElement = store.getState().updateElement;
    const originalUpdateElementsBulk = store.getState().updateElementsBulk;
    const updateElement = vi.fn((...args: Parameters<typeof originalUpdateElement>) => originalUpdateElement(...args));
    const updateElementsBulk = vi.fn((...args: Parameters<typeof originalUpdateElementsBulk>) => originalUpdateElementsBulk(...args));
    act(() => store.setState({ updateElement, updateElementsBulk }));
    fireEvent.change(input('Heat Transfer Coefficient'), { target: { value: '7.5' } });
    expect(updateElementsBulk).toHaveBeenCalledExactlyOnceWith({
      point: { heat_transfer_coeff: 7.5 },
    }, { mode: 'replace' });
    expect(updateElement).toHaveBeenCalledExactlyOnceWith(
      'point', { heat_transfer_coeff: 7.5 }, false,
    );
    expect(store.getState().elementsById.point?.heat_transfer_coeff).toBe(7.5);
    expect(json(store, 'point')).toBe('{"id":"point","type":"ThermalBridgePoint","name":"point","coordinates":[{"x":0,"y":0,"z":0}],"zoneId":"zone","heat_transfer_coeff":7.5,"_v":1}');
    const csv = store.getState().generateCSV();
    expect(csv).toContain(',7.5,');
    const reloaded = createGeometryStore({ defaultDefaultsPath: null });
    reloaded.getState().loadFromCSV(csv);
    const roundTripped = Object.values(reloaded.getState().elementsById)
      .find((element) => element.name === 'point');
    expect(roundTripped?.type).toBe('ThermalBridgePoint');
    expect(roundTripped?.heat_transfer_coeff).toBe(7.5);
    expect(roundTripped).not.toHaveProperty('heat_transfer_coefficient');
  });

  it('routes a two-target ThermalBridgePoint edit through one bulk replace', () => {
    const { store } = mount([thermalBridgePoint('b', 5), thermalBridgePoint('a', 4)]);
    const originalUpdateElement = store.getState().updateElement;
    const originalUpdateElementsBulk = store.getState().updateElementsBulk;
    const updateElement = vi.fn((...args: Parameters<typeof originalUpdateElement>) => originalUpdateElement(...args));
    const updateElementsBulk = vi.fn((...args: Parameters<typeof originalUpdateElementsBulk>) => originalUpdateElementsBulk(...args));
    act(() => store.setState({ updateElement, updateElementsBulk }));
    fireEvent.change(input('Heat Transfer Coefficient'), { target: { value: '7.5' } });
    expect(updateElementsBulk).toHaveBeenCalledOnce();
    expect(updateElement).toHaveBeenCalledTimes(2);
    expect(updateElement.mock.calls.map((call) => [call[0], call[1], call[2]])).toEqual([
      ['a', { heat_transfer_coeff: 7.5 }, true],
      ['b', { heat_transfer_coeff: 7.5 }, false],
    ]);
    expect(updateElementsBulk.mock.calls[0]?.[1]).toEqual({ mode: 'replace' });
    expect(updateElementsBulk.mock.calls[0]?.[0]).toEqual({
      a: { heat_transfer_coeff: 7.5 }, b: { heat_transfer_coeff: 7.5 },
    });
    expect(store.getState().elementsById.a?.heat_transfer_coeff).toBe(7.5);
    expect(store.getState().elementsById.b?.heat_transfer_coeff).toBe(7.5);
  });

  it('keeps exact Lighting patch own-properties, detailed-mode semantics and bytes', () => {
    const { store } = mount([
      lighting('direct', {
        efficacy: 90, count: 4, power: 8,
        extra_json: { retained: 'yes', _lighting_entry_mode: 'guided' },
      }),
      lighting('nested', {
        bulbs: { led: { efficacy: 70, count: 2, power: 6 } }, extra_json: { retained: 'nested' },
      }),
    ]);
    const originalUpdateElement = store.getState().updateElement;
    const originalUpdateElementsBulk = store.getState().updateElementsBulk;
    const updateElement = vi.fn((...args: Parameters<typeof originalUpdateElement>) => originalUpdateElement(...args));
    const updateElementsBulk = vi.fn((...args: Parameters<typeof originalUpdateElementsBulk>) => originalUpdateElementsBulk(...args));
    act(() => store.setState({ updateElement, updateElementsBulk }));
    fireEvent.change(input('Efficacy'), { target: { value: '110' } });

    expect(updateElementsBulk).not.toHaveBeenCalled();
    expect(updateElement).toHaveBeenCalledTimes(2);
    const patches = updateElement.mock.calls.map((call) => call[1]);
    expect(patches).toHaveLength(2);
    for (const patch of patches) {
      expect(Object.keys(patch)).toEqual(['efficacy', 'count', 'power', 'bulbs', 'extra_json']);
      expect(Object.prototype.hasOwnProperty.call(patch, 'count')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(patch, 'power')).toBe(true);
      expect((patch as { extra_json?: Record<string, unknown> }).extra_json?._lighting_entry_mode)
        .toBe('detailed');
    }
    expect(store.getState().elementsById.direct).toMatchObject({
      efficacy: 110, count: 4, power: 8,
      bulbs: { led: { count: 4, power: 8, efficacy: 110 } },
      extra_json: { retained: 'yes', _lighting_entry_mode: 'detailed' },
    });
    expect(store.getState().elementsById.nested).toMatchObject({
      efficacy: 110, count: 2, power: 6,
      bulbs: { led: { count: 2, power: 6, efficacy: 110 } },
      extra_json: { retained: 'nested', _lighting_entry_mode: 'detailed' },
    });
    expect(json(store, 'direct')).toBe('{"id":"direct","type":"Lighting","name":"direct","coordinates":[{"x":0,"y":0,"z":0}],"efficacy":110,"count":4,"power":8,"extra_json":{"retained":"yes","_lighting_entry_mode":"detailed"},"bulbs":{"led":{"count":4,"power":8,"efficacy":110}},"_v":1}');
    expect(json(store, 'nested')).toBe('{"id":"nested","type":"Lighting","name":"nested","coordinates":[{"x":0,"y":0,"z":0}],"bulbs":{"led":{"count":2,"power":6,"efficacy":110}},"extra_json":{"retained":"nested","_lighting_entry_mode":"detailed"},"efficacy":110,"count":2,"power":6,"_v":1}');
    fireEvent.change(input('Count'), { target: { value: '5' } });
    expect(store.getState().elementsById.direct?.count).toBe(5);
    expect(store.getState().elementsById.direct?.extra_json?._lighting_entry_mode).toBe('detailed');
  });

  it('does not add detailed-mode metadata for a count-only edit, but does for power', () => {
    const countMount = mount([
      lighting('count-only', { efficacy: 90, count: 4, power: 8, extra_json: { retained: true } }),
    ]);
    fireEvent.change(input('Count'), { target: { value: '5' } });
    expect(countMount.store.getState().elementsById['count-only']?.extra_json)
      .toEqual({ retained: true });

    cleanup();
    const powerMount = mount([
      lighting('power-only', { efficacy: 90, count: 4, power: 8, extra_json: { retained: true } }),
    ]);
    fireEvent.change(input('Power (W)'), { target: { value: '9' } });
    expect(powerMount.store.getState().elementsById['power-only']?.extra_json)
      .toEqual({ retained: true, _lighting_entry_mode: 'detailed' });

    cleanup();
    const efficacyMount = mount([
      lighting('efficacy-only', { efficacy: 90, count: 4, power: 8, extra_json: { retained: true } }),
    ]);
    fireEvent.change(input('Efficacy'), { target: { value: '100' } });
    expect(efficacyMount.store.getState().elementsById['efficacy-only']?.extra_json)
      .toEqual({ retained: true, _lighting_entry_mode: 'detailed' });
  });

  it('keeps exact Lighting count and power patches, nested siblings and bytes', () => {
    const countMount = mount([
      lighting('count', {
        efficacy: null, count: 4, power: undefined,
        bulbs: { led: { efficacy: 80, count: 2, power: 6 } },
        extra_json: { retained: 'count' },
      }),
    ]);
    const countOriginal = countMount.store.getState().updateElement;
    const countUpdate = vi.fn((...args: Parameters<typeof countOriginal>) => countOriginal(...args));
    act(() => countMount.store.setState({ updateElement: countUpdate }));
    fireEvent.change(input('Count'), { target: { value: '5.4' } });
    expect(countUpdate).toHaveBeenCalledExactlyOnceWith('count', {
      count: 5,
      efficacy: 80,
      power: 6,
      bulbs: { led: { count: 5, power: 6, efficacy: 80 } },
    }, false);
    expect(Object.keys(countUpdate.mock.calls[0]?.[1] ?? {})).toEqual([
      'count', 'efficacy', 'power', 'bulbs',
    ]);
    expect(json(countMount.store, 'count')).toBe('{"id":"count","type":"Lighting","name":"count","coordinates":[{"x":0,"y":0,"z":0}],"efficacy":80,"count":5,"power":6,"bulbs":{"led":{"count":5,"power":6,"efficacy":80}},"extra_json":{"retained":"count"},"_v":1}');

    cleanup();
    const powerMount = mount([
      lighting('power', {
        efficacy: undefined, count: null, power: 8,
        bulbs: { led: { efficacy: 80, count: 2, power: 6 } },
        extra_json: { retained: 'power' }, zoneId: 'zone',
      }),
    ]);
    const powerOriginal = powerMount.store.getState().updateElement;
    const powerUpdate = vi.fn((...args: Parameters<typeof powerOriginal>) => powerOriginal(...args));
    act(() => powerMount.store.setState({ updateElement: powerUpdate }));
    fireEvent.change(input('Power (W)'), { target: { value: '9' } });
    expect(powerUpdate).toHaveBeenCalledExactlyOnceWith('power', {
      power: 9,
      efficacy: 80,
      count: 2,
      bulbs: { led: { count: 2, power: 9, efficacy: 80 } },
      extra_json: { retained: 'power', _lighting_entry_mode: 'detailed' },
    }, false);
    expect(Object.keys(powerUpdate.mock.calls[0]?.[1] ?? {})).toEqual([
      'power', 'efficacy', 'count', 'bulbs', 'extra_json',
    ]);
    expect(json(powerMount.store, 'power')).toBe('{"id":"power","type":"Lighting","name":"power","coordinates":[{"x":0,"y":0,"z":0}],"efficacy":80,"count":2,"power":9,"bulbs":{"led":{"count":2,"power":9,"efficacy":80}},"extra_json":{"retained":"power","_lighting_entry_mode":"detailed"},"zoneId":"zone","_v":1}');

    const csv = powerMount.store.getState().generateCSV();
    const reloaded = createGeometryStore({ defaultDefaultsPath: null });
    reloaded.getState().loadFromCSV(csv);
    const roundTripped = Object.values(reloaded.getState().elementsById)
      .find((element) => element.name === 'power');
    expect(roundTripped).toMatchObject({ efficacy: 80, count: 2, power: 9 });
    expect(roundTripped?.bulbs).toBeUndefined();
    expect(roundTripped?.extra_json).toEqual({
      retained: 'power', _lighting_entry_mode: 'detailed',
    });
  });

  it('keeps reversed multi-target Lighting efficacy, count and power routes, patch bytes and CSV reloads', () => {
    const cases = [
      {
        field: 'Efficacy', raw: '110',
        aPatch: {
          efficacy: 110, count: 4, power: 8,
          bulbs: { led: { count: 4, power: 8, efficacy: 110 } },
          extra_json: { _lighting_entry_mode: 'detailed' },
        },
        bPatch: {
          efficacy: 110, count: 2, power: 6,
          bulbs: { led: { count: 2, power: 6, efficacy: 110 } },
          extra_json: { _lighting_entry_mode: 'detailed' },
        },
        aValues: { efficacy: 110, count: 4, power: 8 },
        bValues: { efficacy: 110, count: 2, power: 6 },
        metadata: { _lighting_entry_mode: 'detailed' },
      },
      {
        field: 'Count', raw: '5.4',
        aPatch: {
          count: 5, efficacy: 90, power: 8,
          bulbs: { led: { count: 5, power: 8, efficacy: 90 } },
        },
        bPatch: {
          count: 5, efficacy: 80, power: 6,
          bulbs: { led: { count: 5, power: 6, efficacy: 80 } },
        },
        aValues: { efficacy: 90, count: 5, power: 8 },
        bValues: { efficacy: 80, count: 5, power: 6 },
        metadata: undefined,
      },
      {
        field: 'Power (W)', raw: '9',
        aPatch: {
          power: 9, efficacy: 90, count: 4,
          bulbs: { led: { count: 4, power: 9, efficacy: 90 } },
          extra_json: { _lighting_entry_mode: 'detailed' },
        },
        bPatch: {
          power: 9, efficacy: 80, count: 2,
          bulbs: { led: { count: 2, power: 9, efficacy: 80 } },
          extra_json: { _lighting_entry_mode: 'detailed' },
        },
        aValues: { efficacy: 90, count: 4, power: 9 },
        bValues: { efficacy: 80, count: 2, power: 9 },
        metadata: { _lighting_entry_mode: 'detailed' },
      },
    ] as const;

    for (const testCase of cases) {
      cleanup();
      const { store } = mount([
        lighting('b', { efficacy: 80, count: 2, power: 6, zoneId: 'zone' }),
        lighting('a', { efficacy: 90, count: 4, power: 8, zoneId: 'zone' }),
      ]);
      const originalUpdateElement = store.getState().updateElement;
      const originalUpdateElementsBulk = store.getState().updateElementsBulk;
      const updateElement = vi.fn((...args: Parameters<typeof originalUpdateElement>) => originalUpdateElement(...args));
      const updateElementsBulk = vi.fn((...args: Parameters<typeof originalUpdateElementsBulk>) => originalUpdateElementsBulk(...args));
      act(() => store.setState({ updateElement, updateElementsBulk }));

      fireEvent.change(input(testCase.field), { target: { value: testCase.raw } });
      expect(updateElementsBulk, testCase.field).not.toHaveBeenCalled();
      expect(updateElement, testCase.field).toHaveBeenCalledTimes(2);
      expect(updateElement).toHaveBeenNthCalledWith(1, 'a', testCase.aPatch, true);
      expect(updateElement).toHaveBeenNthCalledWith(2, 'b', testCase.bPatch, false);
      expect(JSON.stringify(updateElement.mock.calls[0]?.[1])).toBe(JSON.stringify(testCase.aPatch));
      expect(JSON.stringify(updateElement.mock.calls[1]?.[1])).toBe(JSON.stringify(testCase.bPatch));
      expect(store.getState().elementsById.a).toMatchObject(testCase.aValues);
      expect(store.getState().elementsById.b).toMatchObject(testCase.bValues);

      const csv = store.getState().generateCSV();
      const reloaded = createGeometryStore({ defaultDefaultsPath: null });
      reloaded.getState().loadFromCSV(csv);
      for (const [id, values] of [['a', testCase.aValues], ['b', testCase.bValues]] as const) {
        const roundTripped = Object.values(reloaded.getState().elementsById)
          .find((element) => element.name === id);
        expect(roundTripped, `${testCase.field} ${id}`).toMatchObject(values);
        expect(roundTripped?.bulbs).toBeUndefined();
        expect(roundTripped?.extra_json).toEqual(testCase.metadata);
      }
    }
  });

  it('keeps live drafts isolated by field key', () => {
    mount([
      lighting('a', { efficacy: 90, count: 4, power: 8 }),
      lighting('b', { efficacy: 80, count: 2, power: 6 }),
    ]);
    fireEvent.change(input('Efficacy'), { target: { value: 'draft' } });
    expect(input('Efficacy')).toHaveValue('draft');
    expect(input('Power (W)')).toHaveValue('');
  });

  it('distinguishes null, undefined and omitted siblings and round-trips the persistence key', () => {
    const { store } = mount([
      lighting('null-siblings', {
        efficacy: 90, count: null, power: null, bulbs: {}, extra_json: { retained: true }, zoneId: 'zone',
      }),
      lighting('undefined-siblings', {
        efficacy: 90, count: undefined, power: undefined, bulbs: {}, extra_json: { retained: true }, zoneId: 'zone',
      }),
      lighting('omitted-siblings', { efficacy: 90, bulbs: {}, extra_json: { retained: true }, zoneId: 'zone' }),
    ]);
    fireEvent.change(input('Efficacy'), { target: { value: '110' } });
    for (const id of ['null-siblings', 'undefined-siblings', 'omitted-siblings']) {
      const edited = store.getState().elementsById[id];
      expect(edited).toBeDefined();
      expect(edited).not.toHaveProperty('count', null);
      expect(edited).not.toHaveProperty('power', null);
      expect(Object.prototype.hasOwnProperty.call(edited, 'count')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(edited, 'power')).toBe(true);
      expect(edited?.count).toBeUndefined();
      expect(edited?.power).toBeUndefined();
    }
    const csv = store.getState().generateCSV();
    expect(csv).toContain('""_lighting_entry_mode"":""detailed""');
    const reloaded = createGeometryStore({ defaultDefaultsPath: null });
    reloaded.getState().loadFromCSV(csv);
    const roundTripped = Object.values(reloaded.getState().elementsById)
      .find((element) => element.name === 'null-siblings');
    expect(roundTripped?.extra_json).toMatchObject({ retained: true, _lighting_entry_mode: 'detailed' });
    const editedNull = store.getState().elementsById['null-siblings'];
    expect(roundTripped?.count).toBeUndefined();
    expect(roundTripped?.power).toBeUndefined();
    expect(JSON.stringify(roundTripped?.extra_json)).toBe(JSON.stringify(editedNull?.extra_json));
  });

  it.each([
    ['efficacy', 'Efficacy'],
    ['count', 'Count'],
    ['power', 'Power (W)'],
  ] as const)('keeps exact %s direct/LED precedence without incandescent fall-through', (field, label) => {
    const cases: Array<[
      string,
      number | null | undefined | 'omitted',
      number | null | undefined | 'omitted',
      string,
    ]> = [
      ['direct value', 120, 80, '120'],
      ['direct null', null, 80, '80'],
      ['direct own undefined', undefined, 80, '80'],
      ['direct omitted', 'omitted', 80, '80'],
      ['direct NaN', Number.NaN, 80, '80'],
      ['LED null', 'omitted', null, ''],
      ['LED own undefined', 'omitted', undefined, ''],
      ['LED omitted', 'omitted', 'omitted', ''],
      ['LED NaN', 'omitted', Number.NaN, ''],
    ];
    for (const [caseName, direct, led, expected] of cases) {
      cleanup();
      mount([lighting(`${field}-${caseName}`, {
        ...(direct === 'omitted' ? {} : { [field]: direct }),
        bulbs: {
          led: led === 'omitted' ? {} : { [field]: led },
          incandescent: { [field]: 60 },
        },
      })]);
      expect(input(label), caseName).toHaveValue(expected);
    }

    cleanup();
    mount([lighting(`${field}-incandescent-only`, {
      bulbs: { incandescent: { [field]: 60 } },
    })]);
    expect(input(label)).toHaveValue('60');
  });

  it('groups one multi-element edit into one undo step and restores both elements', () => {
    vi.useFakeTimers();
    const { store } = mount([
      lighting('a', { efficacy: 90, count: 4, power: 8 }),
      lighting('b', { efficacy: 80, count: 2, power: 6 }),
    ]);
    act(() => store.getState().saveToHistory('fixture baseline'));
    const originalSaveToHistory = store.getState().saveToHistory;
    const saveToHistory = vi.fn((...args: Parameters<typeof originalSaveToHistory>) => (
      originalSaveToHistory(...args)
    ));
    act(() => store.setState({ saveToHistory }));
    fireEvent.change(input('Efficacy'), { target: { value: '110' } });
    expect(saveToHistory).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(350));
    expect(saveToHistory).toHaveBeenCalledExactlyOnceWith('debounced-flush');
    expect(store.getState().history).toHaveLength(2);
    expect(store.getState().canUndo).toBe(true);
    act(() => store.getState().undo());
    expect(store.getState().elementsById.a?.efficacy).toBe(90);
    expect(store.getState().elementsById.b?.efficacy).toBe(80);
  });
});

describe('R6 MultiSelect parity fence — assembly seam', () => {
  it('loads a host assembly and applies its exact envelope to every selected fabric element', async () => {
    const user = userEvent.setup();
    const { store } = mount(
      [
        { ...fabric('wall-a'), extra_json: { retained: 'a' } } as Element,
        { ...fabric('wall-b'), extra_json: { retained: 'b' } } as Element,
      ],
      undefined,
      resolvedAssemblyResources,
    );

    const trigger = await screen.findByRole('button', { name: 'Search assemblies…' });
    expect(trigger).not.toBeDisabled();
    await user.click(trigger);
    expect(screen.getByRole('option', { name: /200mm test board/ })).toBeInTheDocument();
    const searchInput = screen.getByPlaceholderText('Search assemblies…');
    await waitFor(() => expect(screen.getByRole('listbox')).toHaveStyle({ pointerEvents: 'auto' }));
    await user.type(searchInput, '100mm');
    expect(screen.queryByRole('option', { name: /200mm test board/ })).not.toBeInTheDocument();
    const option = await screen.findByRole('option', { name: /100mm test board/ });
    await user.click(option);

    for (const [id, retained] of [['wall-a', 'a'], ['wall-b', 'b']] as const) {
      const extraJson = store.getState().elementsById[id]?.extra_json;
      const envelope = extraJson?.vulcan_assembly_v1 as { appliedAt?: unknown } | undefined;
      expect(envelope?.appliedAt).toEqual(expect.any(String));
      expect(new Date(envelope?.appliedAt as string).toISOString()).toBe(envelope?.appliedAt);
      expect(extraJson).toStrictEqual({
        retained,
        u_value: 1.5,
        thermal_resistance_construction: 0.5,
        mass_distribution_class: 'D: Mass equally distributed',
        areal_heat_capacity: 'Light',
        vulcan_assembly_v1: {
          schemaVersion: 1,
          assemblyId: 'test.wall',
          assemblySnapshot: {
            elementMode: 'BuildingElementOpaque',
            pitchDegrees: 90,
            layers: [{
              kind: 'solid',
              materialId: 'test.board',
              thickness_m: 0.1,
              repeatingBridges: undefined,
            }],
          },
          appliedAt: envelope?.appliedAt,
          uncorrectedU_W_m2K: 1.5,
          correctedU_W_m2K: 1.5,
          combinedMethodU_W_m2K: 1.49,
          thermalResistanceConstruction_m2K_W: 0.5,
          rConstructionLowerLimit_m2K_W: 0.5,
          rConstructionUpperLimit_m2K_W: 0.5,
          massDistributionClass: 'D: Mass equally distributed',
          calculationEngineVersion: 'vulcan-assembly-calc/0.6.0',
          arealHeatCapacity_J_m2K: 80000,
          arealHeatCapacityWrittenToElement_J_m2K: 75000,
          uValueWrittenToElement_W_m2K: 1.5,
        },
      });
      const layers = (envelope as {
        assemblySnapshot?: { layers?: Array<Record<string, unknown>> };
      } | undefined)?.assemblySnapshot?.layers;
      expect(Object.prototype.hasOwnProperty.call(layers?.[0], 'repeatingBridges')).toBe(true);
    }
  });

  it('surfaces a host assembly load failure without hiding the fabric controls', async () => {
    mount([fabric('wall')], undefined, rejectedAssemblyResources);

    expect(await screen.findByText('assembly fixture unavailable')).toBeInTheDocument();
    expect(screen.getByText('Assembly')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Loading assemblies…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Library' })).not.toBeDisabled();
    expect(input('U Value')).not.toBeDisabled();
    expect(input('U Value')).toHaveValue('');
    expect(input('Thermal Resistance Construction')).not.toBeDisabled();
    expect(input('Thermal Resistance Construction')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Mass Distribution Class' }))
      .not.toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Areal Heat Capacity' }))
      .not.toBeDisabled();
  });

  it('keeps assembly controls host-neutral and hidden for non-fabric selections', () => {
    mount([lighting('light', { efficacy: 90, count: 4, power: 8 })]);
    expect(screen.queryByText('Assembly')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Library' })).not.toBeInTheDocument();
    cleanup();
    mount([thermalBridgePoint('point')]);
    expect(screen.queryByText('Assembly')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Library' })).not.toBeInTheDocument();
    cleanup();
    mount([fabric('wall')]);
    expect(screen.getByText('Assembly')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Library' })).not.toBeDisabled();
  });
});
