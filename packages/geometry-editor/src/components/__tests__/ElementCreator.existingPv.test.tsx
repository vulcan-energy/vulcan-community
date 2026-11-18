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

// An existing building's PV: panels and mounting first, peak power and inverter as defaults.
const pv = {
  id: 'pv', type: 'OnSiteGeneration', name: 'PV South', pitch: 35, orientation360: 180,
  coordinates: [{ x: 0, y: 0, z: 5 }, { x: 4, y: 0, z: 5 }, { x: 4, y: 2, z: 5 }, { x: 0, y: 2, z: 5 }],
  extra_json: {},
} as unknown as Element;

it('renders the existing-building PV form', async () => {
  const port = { ...canonicalGeometrySchemaPort, targetRules: () => ({ hemDatabaseProducts: true }) };
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: port });
  store.setState({ elementsById: { pv }, elementIds: ['pv'], defaultsLoading: false } as never);
  store.getState().setComplianceSettings({ IsExistingBuilding: true });
  render(
    <GeometryEditorServicePortsProvider schemaPort={port} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <ElementCreator selection={{ type: 'global', id: 'pv' } as never} setSelection={vi.fn()} useCard={false}
          inspectorContributions={emptyGeometryInspectorContributions} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  const labels = [...document.querySelectorAll('.element-label')].map((label) => label.textContent);
  expect(labels.slice(0, 2)).toEqual(['Panels', 'Mounting']);
  const peak = screen.getByLabelText('Peak power');
  expect(peak).toHaveAttribute('placeholder', 'default from the drawn area');
  expect(peak.closest('.element-input')!.textContent).toContain('kWp');
  expect(screen.getByLabelText('Inverter')).toBeInTheDocument();
  await userEvent.setup().type(screen.getByLabelText('Panels'), '10');
  expect(store.getState().elementsById.pv.extra_json).toMatchObject({ panel_count: 10 });
  expect(screen.getByLabelText('Peak power')).toHaveAttribute('placeholder', 'default for 10 panels');
});
