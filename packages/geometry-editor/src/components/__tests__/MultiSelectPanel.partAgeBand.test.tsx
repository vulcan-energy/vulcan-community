// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { defineGeometryInspectorContributions, type GeometryInspectorElementFieldsContext } from '../../../../geometry-editor-host/src/inspectorContributions';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { parseCsvToGeometry } from '../../geometry/io/parseCsvToGeometry';
import { MultiSelectPanel } from '../MultiSelectPanel';
import type { Element } from '../../geometry/types';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';

// A selected building part holds walls, a floor, a roof and windows: one age band sets each of
// its walls, floor and roof, and its windows and doors keep following their wall.
const fixture = readFileSync(join(import.meta.dirname, '../../../../../crates/vulcan-model-transform/tests/fixtures/hemie_rear_extension.csv'), 'utf8');
const elements = parseCsvToGeometry(fixture).elements as Element[];

function AgeBandStub({ section, onPatchExtraJson, mixed, omitAgeBand }: GeometryInspectorElementFieldsContext) {
  // A type group's own fields: its age band is left out, as the shared one shows.
  if (!section) return <span data-group-fields data-omit-age-band={String(!!omitAgeBand)} />;
  if (section !== 'age_band') return null;
  return <button type="button" data-mixed={mixed?.join(',')} onClick={() => onPatchExtraJson((current) => ({ ...current, age_band: 'L' }))}>Set age band</button>;
}
const contributions = defineGeometryInspectorContributions({
  elementFields: { elementTypes: ['BuildingElementOpaque', 'BuildingElementGround', 'BuildingElementTransparent'], render: AgeBandStub },
});

it('sets one age band on every wall, floor and roof of a selected part', async () => {
  const port = { ...canonicalGeometrySchemaPort, targetRules: () => ({ constructionBands: true }) };
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: port });
  const extension = { elementIds: ['Ext E', 'Ext N', 'Ext W', 'Ext floor', 'Ext roof', 'Ext window'].map((name) => elements.find((e) => e.name === name)!.id) };
  store.setState({ elementsById: Object.fromEntries(elements.map((e) => [e.id, e])), elementIds: elements.map((e) => e.id),
    selectedElementIds: extension.elementIds, defaultsLoading: false } as never);
  render(
    <GeometryEditorServicePortsProvider schemaPort={port} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <MultiSelectPanel selectedElementIds={extension.elementIds} onDelete={() => {}} inspectorContributions={contributions} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Set age band' }));
  const band = (name: string) => (store.getState().elementsById[elements.find((e) => e.name === name)!.id]!.extra_json as Record<string, unknown>).age_band;
  expect(['Ext E', 'Ext N', 'Ext W', 'Ext floor', 'Ext roof'].map(band)).toEqual(['L', 'L', 'L', 'L', 'L']);
  expect(band('Ext window')).toBeUndefined();
  expect(band('Main S')).toBe('B');
});

it('leaves the age band out of a type group\'s fields while the shared one shows', () => {
  const port = { ...canonicalGeometrySchemaPort, targetRules: () => ({ constructionBands: true }) };
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: port });
  // Three walls of one construction, and a floor.
  const ids = ['Ext E', 'Ext N', 'Ext W', 'Ext floor'].map((name) => elements.find((e) => e.name === name)!.id);
  store.setState({ elementsById: Object.fromEntries(elements.map((e) => [e.id, e])), elementIds: elements.map((e) => e.id),
    selectedElementIds: ids, defaultsLoading: false } as never);
  render(
    <GeometryEditorServicePortsProvider schemaPort={port} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <MultiSelectPanel selectedElementIds={ids} onDelete={() => {}} inspectorContributions={contributions} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  expect(screen.getByRole('button', { name: 'Set age band' })).toBeInTheDocument();
  expect(document.querySelector('[data-group-fields]')?.getAttribute('data-omit-age-band')).toBe('true');
});
