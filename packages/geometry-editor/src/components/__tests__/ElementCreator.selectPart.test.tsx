// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, expect, it } from 'vitest';
import coreSchema from '../../../../../data/schemas/core-input.schema.json';
import fhsSchema from '../../../../../data/schemas/input_fhs.schema.json';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { defineGeometryInspectorContributions, type GeometryInspectorElementFieldsContext } from '../../../../geometry-editor-host/src/inspectorContributions';
import { canonicalGeometrySchemaPort, configureGeometrySchemaAssetSource, resetGeometrySchemaAssetsForTests } from '../../lib/geometrySchemaPort';
import { parseCsvToGeometry } from '../../geometry/io/parseCsvToGeometry';
import { ElementCreator } from '../ElementCreator';
import type { Element } from '../../geometry/types';
import type { TargetValidation } from '../../types/buildErrors';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';

// A two-storey house with a one-storey rear extension (the converter's fixture). The parts are
// the conversion's (`building_parts`, as the converter's test lists them): the editor maps their
// paths to elements and offers to select the element's part.
const fixture = readFileSync(join(import.meta.dirname, '../../../../../crates/vulcan-model-transform/tests/fixtures/hemie_rear_extension.csv'), 'utf8');
const parsed = parseCsvToGeometry(fixture);
const elements = parsed.elements as Element[];
const id = (name: string) => elements.find((e) => e.name === name)!.id;
const paths = (names: string[]) => names.map((name) => `/Zone/Z/BuildingElement/${name}`);
const extension = ['Ext E', 'Ext N', 'Ext W', 'Ext floor', 'Ext roof', 'Ext window'];
const parts: TargetValidation['buildingParts'] = [
  { name: 'Main', elements: paths(['Main S', 'Main E', 'Main N', 'Main W', 'Up S', 'Up E', 'Up N', 'Up W', 'Roof S', 'Roof N', 'Front', 'Main floor']) },
  { name: 'Extension 1', elements: paths(extension) },
];

// A wall's host fields sit in its advanced fields, which read the schema.
beforeAll(async () => {
  configureGeometrySchemaAssetSource({ loadText: async (mode) => JSON.stringify(mode === 'fhs' ? fhsSchema : coreSchema) });
  await Promise.all([canonicalGeometrySchemaPort.preload('core'), canonicalGeometrySchemaPort.preload('fhs')]);
});
afterAll(() => resetGeometrySchemaAssetsForTests());

// The host's element fields: the age band, then the note the editor puts under it.
function AgeBandStub({ ageBandNote }: GeometryInspectorElementFieldsContext) {
  return <div><label>Age band<select /></label>{ageBandNote}</div>;
}
const contributions = defineGeometryInspectorContributions({
  elementFields: { elementTypes: ['BuildingElementOpaque', 'BuildingElementGround', 'BuildingElementTransparent'], render: AgeBandStub },
});

function renderFor(name: string, buildingParts: TargetValidation['buildingParts'] | null = parts) {
  const port = { ...canonicalGeometrySchemaPort, targetRules: () => ({ constructionBands: true }) };
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: port });
  store.setState({ zones: parsed.zones, elementsById: Object.fromEntries(elements.map((e) => [e.id, e])), elementIds: elements.map((e) => e.id), defaultsLoading: false,
    targetValidation: buildingParts ? { hemVersion: 'epc', items: [], buildingParts } : null } as never);
  render(
    <GeometryEditorServicePortsProvider schemaPort={port} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <ElementCreator selection={{ type: 'element', id: id(name) } as never} setSelection={() => {}} useCard={false}
          inspectorContributions={contributions} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return store;
}

const names = (ids: readonly string[]) => ids.map((selected) => elements.find((e) => e.id === selected)!.name).sort();

it.each(['Ext E', 'Ext floor', 'Ext roof', 'Ext window'])('selects every element of the extension from %s', async (name) => {
  const store = renderFor(name);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Select this part' }));
  expect(names(store.getState().selectedElementIds)).toEqual([...extension].sort());
});

it('puts the link under the age band, and highlights the part on hover', async () => {
  const store = renderFor('Ext E');
  const link = await screen.findByRole('button', { name: 'Select this part' });
  expect(link.closest('div')!.previousElementSibling?.textContent).toBe('Age band');
  const user = userEvent.setup();
  await user.hover(link);
  expect(names(store.getState().hoveredElementIds)).toEqual([...extension].sort());
  await user.unhover(link);
  expect(store.getState().hoveredElementIds).toEqual([]);
});

it.each([
  ['before any check', null],
  ['with one part', [{ name: 'Main', elements: paths(elements.map((e) => e.name)) }]],
  ['for an element no part lists', [parts[0]!, { name: 'Extension 1', elements: paths(['Ext N']) }]],
])('offers no part selection %s', (_, buildingParts) => {
  renderFor('Ext E', buildingParts);
  expect(screen.queryByRole('button', { name: 'Select this part' })).toBeNull();
});

// The ground floor and a party wall run under and along both parts: the converter lists them in
// each, so neither part's selection takes them, and they offer no link themselves.
const shared = [
  { name: 'Main', elements: [...parts![0]!.elements, ...paths(['Ext E'])] },
  { name: 'Extension 1', elements: paths([...extension, 'Main floor']) },
];

it('leaves an element two parts list out of the selection', async () => {
  const store = renderFor('Ext N', shared);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Select this part' }));
  expect(names(store.getState().selectedElementIds)).toEqual(['Ext N', 'Ext W', 'Ext floor', 'Ext roof', 'Ext window']);
});

it.each(['Ext E', 'Main floor'])('offers no part selection on %s, which two parts list', async (name) => {
  renderFor(name, shared);
  await screen.findByLabelText('Age band');
  expect(screen.queryByRole('button', { name: 'Select this part' })).toBeNull();
});
