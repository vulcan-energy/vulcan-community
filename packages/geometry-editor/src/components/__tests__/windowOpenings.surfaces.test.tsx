// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fhs from '../../../../../data/schemas/input_fhs.schema.json';
import { canonicalGeometrySchemaPort, configureGeometrySchemaAssetSource, resetGeometrySchemaAssetsForTests } from '../../lib/geometrySchemaPort';
import type { GeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { unavailableGeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import type { BuildingElementTransparent, Element } from '../../geometry/types';
import { validateElementCore } from '../../geometry/validation/validateElement';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import { DirectAdvancedFields } from '../DirectAdvancedFields';
import { ElementCreator } from '../ElementCreator';
import { WindowPartListControl } from '../jsonformsRenderers';

afterEach(cleanup);

const physicalItems = {
  type: 'object',
  required: ['free_area_height', 'mid_height', 'max_window_open_area'],
  properties: {
    free_area_height: { type: 'number', minimum: 0, maximum: 100 },
    mid_height: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
    max_window_open_area: { type: 'number', minimum: 0, maximum: 100 },
  },
};
const legacyItems = {
  type: 'object',
  required: ['mid_height_air_flow_path'],
  properties: { mid_height_air_flow_path: { type: 'number', minimum: 0, maximum: 100 } },
};
const listSchema = (items: unknown) => ({ properties: { window_part_list: { type: 'array', items } } });
const port = (items: unknown): GeometrySchemaPort => ({
  ...unavailableGeometrySchemaPort,
  availability: 'available',
  getRootSchema: () => listSchema(items),
  getElementSubschema: () => listSchema(items),
  getSchemaSubtypeForElementData: () => undefined,
  getConditionalRequiredFields: () => [],
  validateProperty: () => ({ valid: true }),
  findParameter: () => null,
});

const part = (mid: number) => ({ free_area_height: 0.5, mid_height: mid, max_window_open_area: 0.4 });
const windowElement = (extra?: Record<string, unknown>, overrides: Partial<BuildingElementTransparent> = {}) => ({
  id: 'window-1',
  name: 'Window',
  type: 'BuildingElementTransparent',
  zoneId: 'zone-1',
  floorId: '0',
  parent_element: null,
  coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
  width: 1,
  height: 1,
  area: 1,
  pitch: 90,
  base_height: 1,
  frame_area_fraction: 0.2,
  free_area_height: 0.95,
  mid_height: 1.65,
  max_window_open_area: 0.8,
  extra_json: extra,
  ...overrides,
}) as unknown as BuildingElementTransparent;

function mount(element: Element, items: unknown, onChange = vi.fn()) {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  act(() => store.setState({
    selection: { type: 'element', id: element.id },
    elementsById: { [element.id]: element },
    elementIds: [element.id],
  }));
  const data = (element.extra_json ?? {}) as Record<string, unknown>;
  render(
    <GeometryEditorServicePortsProvider schemaPort={port(items)} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <DirectAdvancedFields
          schema={listSchema(items)}
          data={data}
          config={{ elementType: 'BuildingElementTransparent', schemaPort: port(items) }}
          layout={{ type: 'Control', scope: '#/properties/window_part_list', label: 'Window Part List' }}
          onDataChange={onChange}
        />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return store;
}

const stored = (store: ReturnType<typeof createGeometryStore>) =>
  store.getState().elementsById['window-1'] as BuildingElementTransparent;

describe('window_part_list on physical-opening targets', () => {
  it('shows a table with row-level issues for two or more parts, and no legacy presets', () => {
    mount(windowElement({ window_part_list: [part(1.2), { free_area_height: 0.5, mid_height: 2 }] }), physicalItems);
    expect(screen.getByRole('table', { name: /window parts/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Part 2 needs max open area');
    expect(screen.queryByText('Presets')).toBeNull();
  });

  it('points to the main form for one opening and can add a second', () => {
    const store = mount(windowElement({ window_part_list: [{ mid_height_air_flow_path: 1.65 }] }), physicalItems);
    expect(screen.getByText(/One opening\. Edit it in the main form\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add opening' }));
    expect(stored(store).extra_json).toMatchObject({
      window_part_list: [{ free_area_height: 0.95, mid_height: 1.65, max_window_open_area: 0.8 }, {}],
    });
  });

  it('writes the normal form when a removal leaves one part', () => {
    const store = mount(windowElement({ window_part_list: [part(1.2), part(2)] }), physicalItems);
    fireEvent.click(screen.getByRole('button', { name: 'Remove window part 1' }));
    const result = stored(store);
    expect(result).toMatchObject(part(2));
    expect(result.extra_json).toMatchObject({ window_part_list: [{ mid_height_air_flow_path: 2 }] });
  });

  it('offers Add opening on a closed window', () => {
    mount(windowElement({ window_part_list: [] }), physicalItems);
    expect(screen.getByRole('button', { name: 'Add opening' })).toBeInTheDocument();
  });

  it('offers one explicit repair for a conflicting legacy list', () => {
    const store = mount(windowElement({ window_part_list: [{ mid_height_air_flow_path: 1.3 }, { mid_height_air_flow_path: 2 }] }), physicalItems);
    expect(screen.getByRole('alert')).toHaveTextContent('different heights');
    fireEvent.click(screen.getByRole('button', { name: 'Convert to a single opening' }));
    expect(stored(store).extra_json).toMatchObject({ window_part_list: [{ mid_height_air_flow_path: 1.65 }] });
  });
});

describe('window_part_list on a7 with physical parts', () => {
  it('shows parts read-only with one conversion that says what is lost', () => {
    const element = windowElement({ window_part_list: [part(1.2), part(2)] });
    const store = createGeometryStore({ defaultDefaultsPath: null });
    act(() => store.setState({
      selection: { type: 'element', id: 'window-1' },
      elementsById: { 'window-1': element },
      elementIds: ['window-1'],
    }));
    const handleChange = vi.fn();
    render(
      <GeometryEditorServicePortsProvider schemaPort={port(legacyItems)} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
        <GeometryStoreProvider store={store}>
          <WindowPartListControl
            data={[part(1.2), part(2)]}
            handleChange={handleChange}
            path="window_part_list"
            propKey="window_part_list"
            label="Window Part List"
            schema={{ type: 'array', items: legacyItems }}
            uischema={{ type: 'Control', scope: '#/properties/window_part_list' }}
            config={{ elementType: 'BuildingElementTransparent', schemaPort: port(legacyItems) }}
            enabled
            errors=""
          />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );
    expect(screen.getByText(/Part 2: free height 0.5 m, mid height 2 m/)).toBeInTheDocument();
    expect(screen.getByText(/1 other part is removed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add window part' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to a single opening' }));
    expect(stored(store)).toMatchObject(part(1.2));
    expect(stored(store).extra_json).toMatchObject({ window_part_list: [{ mid_height_air_flow_path: 1.2 }] });
    expect(handleChange).not.toHaveBeenCalled();
  });
});

describe('WindowPartListControl with physical parts present', () => {
  it('does not apply a stale base-height delta after Convert', () => {
    const element = windowElement({ window_part_list: [part(1.2)] });
    const store = createGeometryStore({ defaultDefaultsPath: null });
    act(() => store.setState({
      selection: { type: 'element', id: 'window-1' },
      elementsById: { 'window-1': element },
      elementIds: ['window-1'],
    }));
    const handleChange = vi.fn();
    const ui = (data: unknown) => (
      <GeometryEditorServicePortsProvider schemaPort={port(legacyItems)} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
        <GeometryStoreProvider store={store}>
          <WindowPartListControl
            data={data}
            handleChange={handleChange}
            path="window_part_list"
            propKey="window_part_list"
            label="Window Part List"
            schema={{ type: 'array', items: legacyItems }}
            uischema={{ type: 'Control', scope: '#/properties/window_part_list' }}
            config={{ elementType: 'BuildingElementTransparent', schemaPort: port(legacyItems) }}
            enabled
            errors=""
          />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>
    );
    const { rerender } = render(ui([part(1.2)]));
    act(() => store.getState().updateElement('window-1', { base_height: 2 } as Partial<Element>));
    rerender(ui([part(1.2)]));
    fireEvent.click(screen.getByRole('button', { name: 'Convert to a single opening' }));
    rerender(ui((stored(store).extra_json as Record<string, unknown>).window_part_list));
    expect(handleChange).not.toHaveBeenCalled();
  });
});

describe('validateElement window rules', () => {
  const messages = (element: BuildingElementTransparent, schemaPort: GeometrySchemaPort) =>
    validateElementCore(element, {
      schemaPort,
      elementsById: { [element.id]: element },
      complianceValidationEnabled: true,
    }).issues.filter((issue) => /Height|Open Area|part|openings/i.test(issue.message)).map((issue) => issue.message.replace('Window (BuildingElementTransparent): ', ''));
  const blankColumns = { free_area_height: undefined, mid_height: undefined, max_window_open_area: undefined };

  it('accepts new-style parts with blank columns on a8/a9', () => {
    expect(messages(windowElement({ window_part_list: [part(1.2)] }, blankColumns as never), port(physicalItems))).toEqual([]);
  });

  it('keeps blank columns in force with no schema', () => {
    expect(messages(windowElement(undefined, blankColumns as never), unavailableGeometrySchemaPort)).toEqual([
      'Free Area Height is required',
      'Mid Height is required',
      'Max Window Open Area is required',
    ]);
  });

  it('flags physical parts on a7 but lets a7 run divisions with different heights', () => {
    expect(messages(windowElement({ window_part_list: [part(1.2)] }), port(legacyItems))[0]).toContain('Convert to a single opening');
    const divisions = { window_part_list: [{ mid_height_air_flow_path: 1.3 }, { mid_height_air_flow_path: 2 }] };
    expect(messages(windowElement(divisions), port(legacyItems))).toEqual([]);
    expect(messages(windowElement(divisions), port(physicalItems))[0]).toContain('different heights');
  });

  it.each([
    ['zero open area', undefined, { max_window_open_area: 0 }],
    ['an empty list', { window_part_list: [] }, {}],
  ])('allows a closed window on a8/a9: %s', (_name, extra, overrides) => {
    expect(messages(windowElement(extra, overrides), port(physicalItems))).toEqual([]);
  });

  it('calls a blank free height required, not zero, beside an old automatic zero area', () => {
    expect(messages(windowElement(undefined, { free_area_height: undefined, max_window_open_area: 0 } as never), port(physicalItems)))
      .toEqual(['Free Area Height is required']);
  });

  it('keeps a7 required-value errors on a closed or zero window', () => {
    expect(messages(windowElement(undefined, { free_area_height: 0, mid_height: 0, max_window_open_area: 0 }), port(legacyItems))).toEqual([
      'Free Area Height should not be 0',
      'Mid Height should not be 0',
      'Max Window Open Area should not be 0',
    ]);
    expect(messages(windowElement({ window_part_list: [] }, { free_area_height: 0, mid_height: 1, max_window_open_area: 0.4 }), port(legacyItems)))
      .toEqual(['Free Area Height should not be 0']);
  });

  it('keeps zero free height flagged on a7 and accepted on a8/a9', () => {
    const zeroFree = { free_area_height: 0, mid_height: 1, max_window_open_area: 0.4 };
    expect(messages(windowElement(undefined, zeroFree), port(legacyItems))).toEqual(['Free Area Height should not be 0']);
    expect(messages(windowElement(undefined, { ...zeroFree, mid_height: 1.5 }), port(physicalItems))).toEqual([]);
  });

  describe('a9 checks made before the run', () => {
    const opening = (values: Record<string, number>) => ({ free_area_height: 0.5, mid_height: 1.5, max_window_open_area: 0.4, ...values });

    it('compares summed open area with height x width, not the stored area', () => {
      expect(messages(windowElement(undefined, { area: 9, ...opening({ max_window_open_area: 1.2 }) }), port(physicalItems))[0]).toContain('greater than the window area');
      expect(messages(windowElement({ window_part_list: [opening({ max_window_open_area: 0.5 }), opening({ max_window_open_area: 0.5 })] }), port(physicalItems))).toEqual([]);
      expect(messages(windowElement({ window_part_list: [opening({ max_window_open_area: 0.6 }), opening({ max_window_open_area: 0.6 })] }), port(physicalItems))[0]).toContain('greater than the window area');
    });

    it('rejects a free height above the window height', () => {
      expect(messages(windowElement(undefined, opening({ free_area_height: 1.1 })), port(physicalItems))[0]).toContain('Free Area Height');
      expect(messages(windowElement({ window_part_list: [opening({}), opening({ free_area_height: 1.1 })] }), port(physicalItems))[0]).toContain('Part 2');
      expect(messages(windowElement(undefined, opening({ free_area_height: 1 })), port(physicalItems))).toEqual([]);
    });

    it('rejects a mid height outside the glazed span, ground-relative in the editor', () => {
      expect(messages(windowElement(undefined, opening({ mid_height: 2.1 })), port(physicalItems))[0]).toContain('Mid Height');
      expect(messages(windowElement({ window_part_list: [opening({ mid_height: 0.9 })] }), port(physicalItems))[0]).toContain('Mid Height');
      expect(messages(windowElement(undefined, opening({ mid_height: 1 })), port(physicalItems))).toEqual([]);
      expect(messages(windowElement(undefined, opening({ mid_height: 2 })), port(physicalItems))).toEqual([]);
    });
  });
});

describe('main-form window opening inputs', () => {
  type SchemaRecord = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const physicalRoot = () => {
    const root = structuredClone(fhs) as SchemaRecord;
    const branch = root.properties.Zone.additionalProperties.properties.BuildingElement.additionalProperties.allOf
      .find((entry: SchemaRecord) => entry.then?.properties?.window_part_list);
    branch.then.properties.window_part_list.items = physicalItems;
    for (const key of ['free_area_height', 'mid_height', 'max_window_open_area']) delete branch.then.properties[key];
    branch.then.required = branch.then.required.filter((key: string) => !['free_area_height', 'mid_height', 'max_window_open_area'].includes(key));
    return root;
  };

  beforeAll(async () => {
    configureGeometrySchemaAssetSource({ loadText: async () => JSON.stringify(physicalRoot()) });
    await Promise.all([canonicalGeometrySchemaPort.preload('core'), canonicalGeometrySchemaPort.preload('fhs')]);
  });
  afterAll(resetGeometrySchemaAssetsForTests);

  function renderForm(element: Element) {
    const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: canonicalGeometrySchemaPort });
    store.setState({
      elementsById: { [element.id]: element },
      elementIds: [element.id],
      zones: [{ id: 'zone-1', name: 'Zone', floorArea: 1, height: 2 }],
      zoneIds: ['zone-1'],
    });
    render(
      <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
        <GeometryStoreProvider store={store}>
          <ElementCreator selection={{ type: 'element', id: element.id } as never} setSelection={vi.fn()} useCard={false} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );
    return store;
  }

  it('shows the three inputs when the schema moved them into the parts', () => {
    renderForm(windowElement());
    for (const name of [/^Free Area Height/, /^Mid Height/, /^Max Window Open Area/]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('gives way to the table for two or more parts', () => {
    renderForm(windowElement({ window_part_list: [part(1.2), part(2)] }));
    expect(screen.queryByText(/^Free Area Height/)).toBeNull();
    expect(screen.getByText(/This window has separate openings/)).toBeInTheDocument();
  });

  const inputFor = (label: RegExp) => {
    let node: HTMLElement | null = screen.getByText(label);
    while (node && !node.nextElementSibling?.classList.contains('element-input')) node = node.parentElement;
    return node!.nextElementSibling!.querySelector('input') as HTMLInputElement;
  };

  it('does not change a window when it is selected', async () => {
    const element = windowElement(undefined, { free_area_height: 0.5, mid_height: undefined, max_window_open_area: 0 } as never);
    const store = renderForm(element);
    await act(async () => {});
    expect(stored(store).max_window_open_area).toBe(0);
    expect(stored(store).mid_height).toBeUndefined();
  });

  it('does not read input rounding as a geometry change on selection', async () => {
    const store = renderForm(windowElement(undefined, {
      width: 3.004, height: 2.1, free_area_height: 2.004, max_window_open_area: 6.02, base_height: 1.004, mid_height: 2.054,
    }));
    await act(async () => {});
    expect(stored(store).max_window_open_area).toBe(6.02);
    expect(stored(store).mid_height).toBe(2.054);
  });

  it('keeps an explicit zero area when free height changes', () => {
    const store = renderForm(windowElement(undefined, { free_area_height: 0.5, max_window_open_area: 0 }));
    act(() => store.getState().updateElement('window-1', { free_area_height: 0.6 } as Partial<Element>));
    expect(stored(store).max_window_open_area).toBe(0);
  });

  it('still fills an automatic zero when the free height is first entered', () => {
    const store = renderForm(windowElement(undefined, { free_area_height: undefined, max_window_open_area: 0 } as never));
    act(() => store.getState().updateElement('window-1', { free_area_height: 0.6 } as Partial<Element>));
    expect(stored(store).max_window_open_area).toBe(0.6);
  });

  it('shows the run value and does not sync over a single physical part', async () => {
    renderForm(windowElement({ window_part_list: [{ free_area_height: 0.5, mid_height: 1.5, max_window_open_area: 0.5 }] }, { free_area_height: 0.5, mid_height: 1.5, max_window_open_area: 0.5 }));
    await act(async () => {});
    fireEvent.change(inputFor(/^Height/), { target: { value: '1.4' } });
    await act(async () => {});
    expect(inputFor(/^Mid Height/).value).toBe('1.5');
  });

  it('says that entering a mid height collapses conflicting legacy parts', () => {
    renderForm(windowElement({ window_part_list: [{ mid_height_air_flow_path: 1.3 }, { mid_height_air_flow_path: 2 }] }));
    expect(screen.getByText(/replaces the parts with one opening/)).toBeInTheDocument();
  });

  it('shows no blocking message for a closed window on a8/a9', () => {
    renderForm(windowElement({ window_part_list: [] }));
    expect(screen.queryByText(/cannot run/)).toBeNull();
    expect(screen.queryByText(/stays closed/)).toBeNull();
  });

  it('does not derive open area while free height is blank', () => {
    const store = renderForm(windowElement(undefined, { free_area_height: undefined, max_window_open_area: undefined } as never));
    expect(stored(store).max_window_open_area).toBeUndefined();
    act(() => store.getState().updateElement('window-1', { width: 2 } as Partial<Element>));
    expect(stored(store).max_window_open_area).toBeUndefined();
  });
});
