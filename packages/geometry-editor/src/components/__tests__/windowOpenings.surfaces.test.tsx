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
import { defineGeometryInspectorContributions, type GeometryInspectorContributions } from '../../../../geometry-editor-host/src/inspectorContributions';
import { ElementCreator } from '../ElementCreator';
import { buildSemiDetachedWithDormer } from '../../geometry/__fixtures__/semiDetachedWithDormer';
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

function mount(element: Element, items: unknown, onChange = vi.fn(), selected = true) {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  act(() => store.setState({
    selection: selected ? { type: 'element', id: element.id } : null,
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
  it('shows a table with row-level issues for two or more parts when no window is selected', () => {
    mount(windowElement({ window_part_list: [part(1.2), { free_area_height: 0.5, mid_height: 2 }] }), physicalItems, vi.fn(), false);
    expect(screen.getByRole('table', { name: /window parts/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Part 2 needs open area');
    expect(screen.queryByText('Presets')).toBeNull();
  });

  it('moves the remaining part\'s host keys onto the window when a table removal leaves one part', () => {
    const onChange = vi.fn();
    mount(windowElement({ keep: 1, window_part_list: [part(1.2), { ...part(2), _host_style: 'top_hung' }] }), physicalItems, onChange, false);
    fireEvent.click(screen.getByRole('button', { name: /Remove .* 1$/ }));
    expect(onChange).toHaveBeenLastCalledWith({ keep: 1, window_part_list: [{ mid_height_air_flow_path: 2 }], _host_style: 'top_hung' });
  });

  it('leaves a selected window\'s openings to its main form', () => {
    mount(windowElement({ window_part_list: [part(1.2), part(2)] }), physicalItems);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add openable part' })).toBeNull();
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
      'Free area height is required',
      'Mid height is required',
      'Open area is required',
    ]);
  });

  it('asks nothing about openings on construction bands, where the window states its opening type', () => {
    const bands: GeometrySchemaPort = { ...port(physicalItems), targetRules: () => ({ constructionBands: true }) };
    expect(messages(windowElement({ window_part_list: [part(1.2), { free_area_height: 0.5, mid_height: 2 }] }), bands)).toEqual([]);
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
      .toEqual(['Free area height is required']);
  });

  it('keeps a7 required-value errors on a closed or zero window', () => {
    expect(messages(windowElement(undefined, { free_area_height: 0, mid_height: 0, max_window_open_area: 0 }), port(legacyItems))).toEqual([
      'Free area height should not be 0',
      'Mid height should not be 0',
      'Open area should not be 0',
    ]);
    expect(messages(windowElement({ window_part_list: [] }, { free_area_height: 0, mid_height: 1, max_window_open_area: 0.4 }), port(legacyItems)))
      .toEqual(['Free area height should not be 0']);
  });

  it('keeps zero free height flagged on a7 and accepted on a8/a9', () => {
    const zeroFree = { free_area_height: 0, mid_height: 1, max_window_open_area: 0.4 };
    expect(messages(windowElement(undefined, zeroFree), port(legacyItems))).toEqual(['Free area height should not be 0']);
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
      expect(messages(windowElement(undefined, opening({ free_area_height: 1.1 })), port(physicalItems))[0]).toContain('Free area height');
      expect(messages(windowElement({ window_part_list: [opening({}), opening({ free_area_height: 1.1 })] }), port(physicalItems))[0]).toContain('Part 2');
      expect(messages(windowElement(undefined, opening({ free_area_height: 1 })), port(physicalItems))).toEqual([]);
    });

    it('rejects a mid height outside the glazed span, ground-relative in the editor', () => {
      expect(messages(windowElement(undefined, opening({ mid_height: 2.1 })), port(physicalItems))[0]).toContain('Mid height');
      expect(messages(windowElement({ window_part_list: [opening({ mid_height: 0.9 })] }), port(physicalItems))[0]).toContain('Mid height');
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

  function renderForm(element: Element, schemaPort: GeometrySchemaPort = canonicalGeometrySchemaPort, inspectorContributions?: GeometryInspectorContributions, others: Element[] = [], setSelection = vi.fn()) {
    const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort });
    store.setState({
      elementsById: Object.fromEntries([element, ...others].map((el) => [el.id, el])),
      elementIds: [element.id, ...others.map((el) => el.id)],
      zones: [{ id: 'zone-1', name: 'Zone', floorArea: 1, height: 2 }],
      zoneIds: ['zone-1'],
    });
    render(
      <GeometryEditorServicePortsProvider schemaPort={schemaPort} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
        <GeometryStoreProvider store={store}>
          <ElementCreator selection={{ type: 'element', id: element.id } as never} setSelection={setSelection} useCard={false}
            inspectorContributions={inspectorContributions} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );
    return store;
  }

  describe('Part that opens', () => {
    const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
    const follows = { mid_height: 1.5, free_area_height: 0.3, max_window_open_area: 0.3 };

    it('reads Whole on a file without the key, and opening the window writes nothing', () => {
      const element = windowElement({ window_part_list: [{ mid_height_air_flow_path: 1.5 }] }, follows);
      const store = renderForm(element);
      expect(pressed('Whole')).toBe('true');
      expect(stored(store)).toEqual(element);
    });

    it('reads Top from the key, and opening the window writes nothing', () => {
      const element = windowElement({ _vulcan_ui_opening_part: 'top', window_part_list: [{ mid_height_air_flow_path: 1.85 }] }, { ...follows, mid_height: 1.85 });
      const store = renderForm(element);
      expect(pressed('Top')).toBe('true');
      expect(stored(store)).toEqual(element);
    });

    it('single opening: Top moves a following mid height to head − free height ÷ 2, Whole moves it back', () => {
      const store = renderForm(windowElement({ window_part_list: [{ mid_height_air_flow_path: 1.5 }] }, follows));
      fireEvent.click(screen.getByRole('button', { name: 'Top' }));
      expect(stored(store)).toMatchObject({ mid_height: 1.85, extra_json: { _vulcan_ui_opening_part: 'top', window_part_list: [{ mid_height_air_flow_path: 1.85 }] } });
      expect(screen.getByText('top − free height ÷ 2')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Whole' }));
      expect(stored(store)).toMatchObject({ mid_height: 1.5, extra_json: { window_part_list: [{ mid_height_air_flow_path: 1.5 }] } });
      expect(stored(store).extra_json).not.toHaveProperty('_vulcan_ui_opening_part');
    });

    it('one-row part list: Bottom writes the one opening with its mid height at sill + free height ÷ 2', () => {
      const store = renderForm(windowElement({ window_part_list: [follows] },
        { free_area_height: undefined, mid_height: undefined, max_window_open_area: undefined }));
      fireEvent.click(screen.getByRole('button', { name: 'Bottom' }));
      expect(stored(store)).toMatchObject({ ...follows, mid_height: 1.15,
        extra_json: { _vulcan_ui_opening_part: 'bottom', window_part_list: [{ mid_height_air_flow_path: 1.15 }] } });
    });

    it('keeps a typed mid height and offers the part\'s value instead', () => {
      const store = renderForm(windowElement({ window_part_list: [{ mid_height_air_flow_path: 1.65 }] }, { free_area_height: 0.3 }));
      fireEvent.click(screen.getByRole('button', { name: 'Top' }));
      expect(stored(store)).toMatchObject({ mid_height: 1.65, extra_json: { _vulcan_ui_opening_part: 'top' } });
      expect(screen.getByRole('button', { name: /Mid height: use top − free height ÷ 2, 1\.85 m/ })).toBeInTheDocument();
    });

    it('a7: a list that follows the mid height moves with it; one that does not stays', () => {
      // The full schema with an a7 window part list: parts are airflow divisions, not openings.
      const a7: GeometrySchemaPort = {
        ...canonicalGeometrySchemaPort,
        getElementSubschema: (mode, type, subtype) => (type === 'BuildingElementTransparent'
          ? listSchema(legacyItems) : canonicalGeometrySchemaPort.getElementSubschema(mode, type, subtype)),
      } as GeometrySchemaPort;
      const store = renderForm(windowElement({ window_part_list: [{ mid_height_air_flow_path: 1.5 }] }, follows), a7);
      fireEvent.click(screen.getByRole('button', { name: 'Top' }));
      expect(stored(store)).toMatchObject({ mid_height: 1.85, extra_json: { _vulcan_ui_opening_part: 'top', window_part_list: [{ mid_height_air_flow_path: 1.85 }] } });
      cleanup();
      const own = renderForm(windowElement({ window_part_list: [{ mid_height_air_flow_path: 1.2 }] }, follows), a7);
      fireEvent.click(screen.getByRole('button', { name: 'Bottom' }));
      expect(stored(own)).toMatchObject({ mid_height: 1.15, extra_json: { window_part_list: [{ mid_height_air_flow_path: 1.2 }] } });
    });

    it('is not offered for several parts: each has its own mid height', () => {
      renderForm(windowElement({ window_part_list: [part(1.2), part(2)] }));
      expect(screen.queryByRole('group', { name: 'Part that opens' })).toBeNull();
    });
  });

  it('shows the three inputs when the schema moved them into the parts', () => {
    renderForm(windowElement());
    for (const name of [/^Free area height/, /^Mid height/, /^Open area/]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('shows two or more parts as rows, each field required', () => {
    renderForm(windowElement({ window_part_list: [part(1.2), { free_area_height: 0.5, mid_height: 2 }] }));
    expect(screen.queryByText(/^Free area height \(m\)/)).toBeNull();
    expect(screen.getByText('Opening 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Mid height', { selector: '#window-opening-1-mid_height' })).toHaveValue('2');
    expect(screen.getByLabelText('Open area', { selector: '#window-opening-1-max_window_open_area' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('edits a part in its row', () => {
    const store = renderForm(windowElement({ window_part_list: [part(1.2), part(2)] }));
    const input = screen.getByLabelText('Open area', { selector: '#window-opening-1-max_window_open_area' });
    fireEvent.change(input, { target: { value: '0.35' } });
    fireEvent.blur(input);
    expect(stored(store).extra_json).toMatchObject({ window_part_list: [part(1.2), { ...part(2), max_window_open_area: 0.35 }] });
  });

  it('adds a second opening from the main form', () => {
    const store = renderForm(windowElement({ window_part_list: [{ mid_height_air_flow_path: 1.65 }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Add openable part' }));
    expect(stored(store).extra_json).toMatchObject({
      window_part_list: [{ free_area_height: 0.95, mid_height: 1.65, max_window_open_area: 0.8 }, {}],
    });
  });

  it('moves the host\'s opening keys onto part 1 when a second opening is added', () => {
    const host = defineGeometryInspectorContributions({ openingPartFields: { render: () => null, openingKeys: ['_host_style'] } });
    const store = renderForm(windowElement({ window_part_list: [{ mid_height_air_flow_path: 1.65 }], _host_style: 'side_hung', _host_kind: 'w' }),
      canonicalGeometrySchemaPort, host);
    fireEvent.click(screen.getByRole('button', { name: 'Add openable part' }));
    expect(stored(store).extra_json).toMatchObject({ _host_kind: 'w',
      window_part_list: [{ free_area_height: 0.95, mid_height: 1.65, max_window_open_area: 0.8, _host_style: 'side_hung' }, {}] });
    expect(stored(store).extra_json).not.toHaveProperty('_host_style');
  });

  it('writes the normal form when a removal leaves one part', () => {
    const store = renderForm(windowElement({ window_part_list: [part(1.2), part(2)] }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove opening 1' }));
    const result = stored(store);
    expect(result).toMatchObject(part(2));
    expect(result.extra_json).toMatchObject({ window_part_list: [{ mid_height_air_flow_path: 2 }] });
  });

  const hostOpening = defineGeometryInspectorContributions({ openingFields: { render: () => <div data-testid="host-opening" /> } });
  const after = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it.each([
    ['one opening', undefined],
    ['several parts', { window_part_list: [part(1.2), part(2)] }],
  ])('shows the host opening fields once, right after Opening and Security risk: %s', (_name, extra) => {
    renderForm(windowElement(extra), canonicalGeometrySchemaPort, hostOpening);
    const host = screen.getByTestId('host-opening');
    expect(after(screen.getByText('Add openable part'), host)).toBe(true);
    expect(after(screen.getByLabelText('Security risk'), host)).toBe(true);
    expect(after(host, screen.getByText('Frame area fraction'))).toBe(true);
  });

  it('shows the host part fields in each part row and saves them on that part', () => {
    const hostParts = defineGeometryInspectorContributions({ openingPartFields: { render: ({ partIndex, onPatchPart }) => (
      <button type="button" onClick={() => onPatchPart((current) => ({ ...current, _host_style: `style ${partIndex + 1}` }))}>
        Host part {partIndex + 1}</button>) } });
    const store = renderForm(windowElement({ window_part_list: [part(1.2), part(2)] }), canonicalGeometrySchemaPort, hostParts);
    expect(after(screen.getByText('Opening 2'), screen.getByText('Host part 2'))).toBe(true);
    expect(after(screen.getByText('Host part 1'), screen.getByText('Opening 2'))).toBe(true);
    fireEvent.click(screen.getByText('Host part 2'));
    expect(stored(store).extra_json).toMatchObject({ window_part_list: [part(1.2), { ...part(2), _host_style: 'style 2' }] });
    expect(screen.getByLabelText('Mid height', { selector: '#window-opening-1-mid_height' }).closest('[data-host-field-key]'))
      .toHaveAttribute('data-host-field-key', 'window_part_list.1.mid_height');
  });

  it('asks for Security risk in plain words and saves the same boolean', () => {
    const store = renderForm(windowElement({ security_risk: false }));
    const select = screen.getByLabelText('Security risk');
    expect(Array.from(select.querySelectorAll('option')).map((option) => option.textContent))
      .toEqual(expect.arrayContaining(['Yes · cannot be left open at night', 'No · can be left open at night']));
    fireEvent.change(select, { target: { value: 'true' } });
    expect((stored(store).extra_json as Record<string, unknown>).security_risk).toBe(true);
  });

  it('asks a dormer window for Security risk in its Window Properties and keeps the choice', () => {
    const { elements, floors, dormerNames } = buildSemiDetachedWithDormer();
    const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: canonicalGeometrySchemaPort });
    store.setState({ elementsById: Object.fromEntries(elements.map((element) => [element.id, element])), elementIds: elements.map((element) => element.id), floors });
    const byName = (name: string) => Object.values(store.getState().elementsById).find((element) => element.name === name)!;
    render(
      <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
        <GeometryStoreProvider store={store}>
          <ElementCreator selection={{ type: 'element', id: byName(dormerNames.frontWall).id } as never} setSelection={vi.fn()} useCard={false} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );
    fireEvent.change(screen.getByLabelText('Security risk'), { target: { value: 'true' } });
    expect((byName(dormerNames.window).extra_json as Record<string, unknown>).security_risk).toBe(true);
  });

  it('on construction bands: host opening fields after Opening type, and no openable parts', () => {
    const bands: GeometrySchemaPort = {
      ...canonicalGeometrySchemaPort,
      targetRules: () => ({ constructionBands: true }) as never,
    };
    renderForm(windowElement({ window_part_list: [part(1.2), part(2)] }), bands, hostOpening);
    expect(after(screen.getByText('Add glazing section'), screen.getByTestId('host-opening'))).toBe(true);
    expect(screen.queryByText('Add openable part')).toBeNull();
    expect(screen.queryByText('Opening 1')).toBeNull();
  });

  it('offers Add openable part on a closed window', () => {
    renderForm(windowElement({ window_part_list: [] }));
    expect(screen.getByRole('button', { name: 'Add openable part' })).toBeInTheDocument();
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

  it('reads Outline · Rectangle, opens the shape rows in place, and shows no Area line for a plain rectangle', () => {
    renderForm(windowElement());
    const outline = screen.getByRole('button', { name: 'Outline · Rectangle' });
    expect(outline).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('wall-shape-top')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Area' })).toBeNull();
    fireEvent.click(outline);
    expect(screen.getByRole('button', { name: 'Outline · Rectangle' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('wall-shape-top')).toBeInTheDocument();
  });

  it('a shaped outline reads as a summary, stays closed until asked, and its height is set in the outline', () => {
    const face = { kind: 'profiled-line-face', top_profile: [{ t: 0, h: 1 }, { t: 0.5, h: 1.3 }, { t: 1, h: 1 }], bottom_profile: [{ t: 0, h: 0 }, { t: 1, h: 0 }] };
    renderForm(windowElement({ geometry_face: face }, { height: 1.3 }));
    expect(screen.getByRole('button', { name: 'Outline · Custom top' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('wall-shape-top')).toBeNull();
    expect(screen.getByLabelText('Height', { selector: 'input' })).toBeDisabled();
    // The outline sets the area, so the width is the drawn line's: text, not an input.
    expect(screen.getByRole('status', { name: 'Width' })).toHaveTextContent('1m');
    expect(screen.queryByLabelText('Width', { selector: 'input' })).toBeNull();
  });

  it('a wall fitted under a roof that changed says so on its closed outline', () => {
    const wall = {
      id: 'wall-1', name: 'Gable', type: 'BuildingElementOpaque', zoneId: 'zone-1', floorId: '0', parent_element: null,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }], width: 4, height: 3, area: 10, pitch: 90, base_height: 0,
      extra_json: { geometry_face: { kind: 'profiled-line-face', top_mode: 'roof', top_profile: [{ t: 0, h: 2 }, { t: 0.5, h: 3 }, { t: 1, h: 2 }], bottom_profile: [{ t: 0, h: 0 }, { t: 1, h: 0 }] } },
    } as unknown as Element;
    renderForm(wall);
    expect(screen.getByRole('button', { name: 'Outline · Top under roof · roof changed' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Width', { selector: 'input' })).toBeNull();
  });

  it('Edit all N windows selects every window of its kind, keeping this one to come back to', () => {
    const rooflight = windowElement(undefined, { id: 'roof-1', name: 'Rooflight', coordinates: [{ x: 0, y: 0, z: 3 }, { x: 1, y: 0, z: 3 }, { x: 1, y: 1, z: 3 }, { x: 0, y: 1, z: 3 }] } as never);
    const door = { ...windowElement(undefined, { id: 'door-1', name: 'Door' } as never), type: 'BuildingElementOpaque', is_external_door: true } as unknown as Element;
    const upstairs = windowElement(undefined, { id: 'w-up', name: 'Window up', base_height: 3.5, width: 2 } as never);
    const setSelection = vi.fn();
    const store = renderForm(windowElement(), undefined, undefined, [rooflight, door, upstairs], setSelection);
    fireEvent.click(screen.getByRole('button', { name: 'Edit all 2 windows' }));
    expect(store.getState().selectedElementIds).toEqual(['window-1', 'w-up']);
    expect(setSelection).toHaveBeenCalledWith({ type: 'element', id: 'window-1', editAll: true });
  });

  it('offers no Edit all for the only window of its kind', () => {
    renderForm(windowElement());
    expect(screen.queryByRole('button', { name: /^Edit all/ })).toBeNull();
  });

  describe('apply an edit to the windows like this one', () => {
    const sibling = (id: string, over: Partial<BuildingElementTransparent> = {}) => windowElement(undefined, { id, name: `Window ${id}`, ...over } as never);
    const heightOf = (store: ReturnType<typeof createGeometryStore>, id: string) => (store.getState().elementsById[id] as BuildingElementTransparent).height;
    const typeHeight = (value: string) => {
      fireEvent.change(screen.getByLabelText('Height', { selector: 'input' }), { target: { value } });
      fireEvent.blur(screen.getByLabelText('Height', { selector: 'input' }));
    };

    it('offers nothing until a value changes, and has no Same as line', () => {
      renderForm(windowElement(), undefined, undefined, [sibling('w2'), sibling('w3')]);
      expect(screen.queryByText(/Same as/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    });

    it('after an edit, Apply copies only that value to the windows that matched, as one undo step', async () => {
      const store = renderForm(windowElement(), undefined, undefined, [sibling('w2', { base_height: 1 }), sibling('w3'), sibling('wide', { width: 2 })]);
      act(() => store.getState().seedHistory('start'));
      typeHeight('1.3');
      await act(async () => {});
      expect(heightOf(store, 'window-1')).toBe(1.3);
      expect(screen.getByText('Height 1.3 m · Apply to the 2 other windows like this one')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(heightOf(store, 'w2')).toBe(1.3);
      expect(heightOf(store, 'w3')).toBe(1.3);
      expect(heightOf(store, 'wide')).toBe(1);
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
      act(() => store.getState().undo());
      expect(heightOf(store, 'w2')).toBe(1);
      expect(heightOf(store, 'w3')).toBe(1);
      expect(heightOf(store, 'window-1')).toBe(1.3);
    });

    it('recounts when a matching window is deleted, and clears on undo of the edit', async () => {
      const store = renderForm(windowElement(), undefined, undefined, [sibling('w2'), sibling('w3')]);
      act(() => store.getState().seedHistory('start'));
      typeHeight('1.3');
      await act(async () => {});
      act(() => store.getState().removeElement('w3'));
      expect(screen.getByText('Height 1.3 m · Apply to the other window like this one')).toBeInTheDocument();
      act(() => { store.getState().saveToHistory('delete'); });
      act(() => { store.getState().undo(); store.getState().undo(); });
      expect(heightOf(store, 'window-1')).toBe(1);
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    });

    it('names several changes; a window that matched none is offered nothing', async () => {
      renderForm(windowElement(), undefined, undefined, [sibling('w2'), sibling('w3')]);
      typeHeight('1.3');
      fireEvent.change(screen.getByLabelText('Sill', { selector: 'input' }), { target: { value: '0.8' } });
      fireEvent.blur(screen.getByLabelText('Sill', { selector: 'input' }));
      await act(async () => {});
      expect(screen.getByText('Height and sill · Apply to 2 other windows')).toBeInTheDocument();
      cleanup();
      renderForm(windowElement(), undefined, undefined, [sibling('w2', { width: 2 })]);
      typeHeight('1.3');
      await act(async () => {});
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    });
  });

  it('shows the run value and does not sync over a single physical part', async () => {
    renderForm(windowElement({ window_part_list: [{ free_area_height: 0.5, mid_height: 1.5, max_window_open_area: 0.5 }] }, { free_area_height: 0.5, mid_height: 1.5, max_window_open_area: 0.5 }));
    await act(async () => {});
    // Width, height and sill share one row: each input is named.
    fireEvent.change(screen.getByLabelText('Height', { selector: 'input' }), { target: { value: '1.4' } });
    await act(async () => {});
    expect(inputFor(/^Mid height/).value).toBe('1.5');
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
