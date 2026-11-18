// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import { AdvancedFieldsEditor } from '../AdvancedFieldsEditor';

afterEach(cleanup);

it("says the target's files did not load, with Retry, instead of an empty panel", () => {
  const preload = vi.fn(async () => {});
  const port = { ...canonicalGeometrySchemaPort, getElementSubschema: () => null, getRootSchema: () => null, loadFailed: () => true, preload };
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: port });
  render(
    <GeometryStoreProvider store={store}>
      <GeometryEditorServicePortsProvider schemaPort={port} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
        <AdvancedFieldsEditor elementType="BuildingElementOpaque" currentData={{}} onChange={() => {}} useFHSSchema
          workspaceResourcePort={unavailableGeometryWorkspaceResourcePort} thermalMethod="u_value" />
      </GeometryEditorServicePortsProvider>
    </GeometryStoreProvider>,
  );
  expect(screen.getByRole('alert').textContent).toContain('HEM files could not load');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(preload).toHaveBeenCalledWith('fhs');
});
