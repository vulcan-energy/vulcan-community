// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GeometryEditorServicePortsProvider,
  type GeometryWorkspaceResourcePort,
} from '../../../../geometry-editor-host/src/index';
import { DefaultsEditorModal } from '../../components/DefaultsEditorModal';
import {
  canonicalGeometrySchemaPort,
  configureGeometrySchemaAssetSource,
  resetGeometrySchemaAssetsForTests,
} from '../../lib/geometrySchemaPort';
import { inspectDefaultsCompatibility } from '../../lib/defaultsCompatibility';
import {
  createGeometryStore,
  GeometryStoreProvider,
} from '../../stores/geometryStore';

const coreSchemaText = readFileSync(
  join(import.meta.dirname, '../../../../../hem_engine_upstream/schemas/core-input.schema.json'),
  'utf8',
);
const fhsSchemaText = readFileSync(
  join(import.meta.dirname, '../../../../../hem_fhs_upstream/schema/input_fhs.schema.json'),
  'utf8',
);

const editableDefaultsText = JSON.stringify({
  Zone: {
    Main: {
      BuildingElement: {
        wall: {
          type: 'BuildingElementOpaque',
          pitch: 90,
          u_value: 0.18,
        },
      },
    },
  },
});

function createResources(
  overrides: Partial<GeometryWorkspaceResourcePort> = {},
): GeometryWorkspaceResourcePort {
  return {
    availability: 'available',
    readText: vi.fn(async () => '{"Zone":{}}'),
    readFile: vi.fn(),
    writeText: vi.fn(async () => undefined),
    writeBytes: vi.fn(),
    removeFile: vi.fn(),
    ensureDirectory: vi.fn(),
    exists: vi.fn(async () => true),
    list: vi.fn(async () => []),
    ...overrides,
  };
}

describe('public schema and defaults authoring', () => {
  beforeEach(() => {
    resetGeometrySchemaAssetsForTests();
    configureGeometrySchemaAssetSource({
      loadText: async (mode) => (mode === 'fhs' ? fhsSchemaText : coreSchemaText),
    });
  });

  it('loads the public Core/FHS schemas through one available editor port', async () => {
    await canonicalGeometrySchemaPort.preload('core');
    await canonicalGeometrySchemaPort.preload('fhs');

    expect(canonicalGeometrySchemaPort.availability).toBe('available');
    expect(
      canonicalGeometrySchemaPort.getElementSubschema(
        'fhs',
        'BuildingElementOpaque',
      )?.properties,
    ).toHaveProperty('u_value');
    expect(
      canonicalGeometrySchemaPort.getStrictestIntegerKeysForElementType(
        'OnSiteGeneration',
      ),
    ).toContain('orientation360');
    expect(
      canonicalGeometrySchemaPort.findParameter(
        'u_value',
        ['$defs', 'BuildingElement'],
        'BuildingElementOpaque',
        'core',
      ),
    ).toMatchObject({ name: 'u_value' });
  });

  it('keeps defaults compatibility inspection in public code', () => {
    expect(inspectDefaultsCompatibility('{"Zone":{}}')).toEqual(
      expect.objectContaining({
        foundTypes: [],
        hasRequiredRootSections: false,
        warnings: expect.arrayContaining([
          'No zones found in defaults - zone property inheritance may fail',
          'Missing required root section: InfiltrationVentilation',
        ]),
      }),
    );
  });

  it('reads, fully edits, checks and writes defaults through host-neutral ports', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    const resources = createResources({ writeText });
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      schemaPort: canonicalGeometrySchemaPort,
      workspaceResourcePort: resources,
    });
    store.getState().setDefaultsPath('input/defaults/defaults_template.json');
    const inspectCompatibility = vi.fn((content: string) => ({
      warnings: content.includes('BuildingElement')
        ? []
        : ['Missing BuildingElement defaults'],
      foundTypes: [],
      hasRequiredRootSections: content.includes('BuildingElement'),
    }));
    const onCommitted = vi.fn();

    render(
      <GeometryEditorServicePortsProvider
        schemaPort={canonicalGeometrySchemaPort}
        workspaceResourcePort={resources}
      >
        <GeometryStoreProvider store={store}>
          <DefaultsEditorModal
            isOpen
            filePath="input/defaults/defaults_template.json"
            onClose={vi.fn()}
            inspectCompatibility={inspectCompatibility}
            onCommitted={onCommitted}
          />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );

    expect(await screen.findByRole('heading', { name: /Fabric defaults/ })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Edit full JSON/i }));
    const editor = await screen.findByRole('textbox', { name: /Defaults JSON/i });
    fireEvent.change(editor, {
      target: { value: '{"Zone":{"z":{"BuildingElement":{}}}}' },
    });
    await user.click(screen.getByRole('button', { name: /Save full defaults/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        'input/defaults/defaults_template.json',
        '{\n  "Zone": {\n    "z": {\n      "BuildingElement": {}\n    }\n  }\n}\n',
      );
    });
    expect(inspectCompatibility).toHaveBeenCalled();
    expect(onCommitted).toHaveBeenCalledWith(
      { Zone: { z: { BuildingElement: {} } } },
      expect.objectContaining({ warnings: [] }),
    );
    expect(store.getState().defaultsJson).toEqual({
      Zone: { z: { BuildingElement: {} } },
    });
  });

  it('keeps the raw JSON escape hatch available for malformed defaults without rereading the file', async () => {
    const user = userEvent.setup();
    const readText = vi.fn(async () => '{ definitely not JSON');
    const resources = createResources({ readText });
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      schemaPort: canonicalGeometrySchemaPort,
      workspaceResourcePort: resources,
    });

    render(
      <GeometryEditorServicePortsProvider
        schemaPort={canonicalGeometrySchemaPort}
        workspaceResourcePort={resources}
      >
        <GeometryStoreProvider store={store}>
          <DefaultsEditorModal
            isOpen
            filePath="input/defaults/broken.json"
            onClose={vi.fn()}
          />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );

    expect(await screen.findByText(/Invalid JSON:/i)).toBeInTheDocument();
    expect(screen.getByText(/repair the defaults file/i)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Edit full JSON/i }));

    expect(await screen.findByRole('textbox', { name: /Defaults JSON/i })).toHaveValue(
      '{ definitely not JSON',
    );
    expect(screen.getByText('input/defaults/broken.json')).toBeInTheDocument();
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it('rejects raw defaults whose root is not an object', async () => {
    const user = userEvent.setup();
    const resources = createResources({ readText: vi.fn(async () => '[]') });
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      schemaPort: canonicalGeometrySchemaPort,
      workspaceResourcePort: resources,
    });

    render(
      <GeometryEditorServicePortsProvider
        schemaPort={canonicalGeometrySchemaPort}
        workspaceResourcePort={resources}
      >
        <GeometryStoreProvider store={store}>
          <DefaultsEditorModal
            isOpen
            filePath="input/defaults/not-an-object.json"
            onClose={vi.fn()}
          />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );

    expect(await screen.findByText('Defaults JSON must have an object at its root.')).toBeInTheDocument();
    expect(screen.getByText(/repair the defaults file/i)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Edit full JSON/i }));

    expect(await screen.findByText('Defaults JSON must have an object at its root.')).toBeInTheDocument();
  });

  it('keeps the malformed-file diagnostic when discarding raw repairs', async () => {
    const user = userEvent.setup();
    const resources = createResources({ readText: vi.fn(async () => '{ definitely not JSON') });
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      schemaPort: canonicalGeometrySchemaPort,
      workspaceResourcePort: resources,
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={resources}>
        <GeometryStoreProvider store={store}>
          <DefaultsEditorModal isOpen filePath="input/defaults/broken.json" onClose={vi.fn()} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Edit full JSON/i }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Defaults JSON/i }), {
      target: { value: '{"Zone":{}}' },
    });
    await user.click(screen.getByRole('button', { name: /^Back to fabric defaults$/i }));

    expect(confirm).toHaveBeenCalledWith('Discard unsaved defaults changes?');
    expect(await screen.findByText(/Invalid JSON:/i)).toBeInTheDocument();
    expect(screen.getByText(/repair the defaults file/i)).toBeInTheDocument();
  });

  it('clears a malformed-file diagnostic after a successful raw repair', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    const resources = createResources({
      readText: vi.fn(async () => '{ definitely not JSON'),
      writeText,
    });
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      schemaPort: canonicalGeometrySchemaPort,
      workspaceResourcePort: resources,
    });

    render(
      <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={resources}>
        <GeometryStoreProvider store={store}>
          <DefaultsEditorModal isOpen filePath="input/defaults/broken.json" onClose={vi.fn()} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Edit full JSON/i }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Defaults JSON/i }), {
      target: { value: '{"Zone":{}}' },
    });
    await user.click(screen.getByRole('button', { name: /Save full defaults/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    expect(screen.queryByText(/Invalid JSON:/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Fabric defaults$/i }));
    expect(screen.queryByText(/repair the defaults file/i)).not.toBeInTheDocument();
  });

  it('tracks structured drafts and confirms discarding them in both view directions', async () => {
    const user = userEvent.setup();
    const resources = createResources({ readText: vi.fn(async () => editableDefaultsText) });
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      schemaPort: canonicalGeometrySchemaPort,
      workspaceResourcePort: resources,
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={resources}>
        <GeometryStoreProvider store={store}>
          <DefaultsEditorModal isOpen filePath="input/defaults/editable.json" onClose={vi.fn()} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );

    const uValue = await screen.findByDisplayValue('0.18');
    await user.clear(uValue);
    await user.type(uValue, '0.25');
    await waitFor(() => expect(screen.getByRole('button', { name: /Save fabric defaults/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /Edit full JSON/i }));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved defaults changes?');
    expect(screen.queryByRole('textbox', { name: /Defaults JSON/i })).not.toBeInTheDocument();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: /Edit full JSON/i }));
    const rawEditor = await screen.findByRole('textbox', { name: /Defaults JSON/i });
    expect(rawEditor).toHaveValue(editableDefaultsText);

    fireEvent.change(rawEditor, { target: { value: `${editableDefaultsText}\n` } });
    await user.click(screen.getByRole('button', { name: /^Fabric defaults$/i }));
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it('confirms unsaved raw drafts before closing from the header or backdrop', async () => {
    const user = userEvent.setup();
    const resources = createResources({ readText: vi.fn(async () => editableDefaultsText) });
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      schemaPort: canonicalGeometrySchemaPort,
      workspaceResourcePort: resources,
    });
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={resources}>
        <GeometryStoreProvider store={store}>
          <DefaultsEditorModal isOpen filePath="input/defaults/editable.json" onClose={onClose} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Edit full JSON/i }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Defaults JSON/i }), {
      target: { value: `${editableDefaultsText}\n` },
    });
    await user.click(screen.getByRole('button', { name: /Close modal/i }));
    fireEvent.click(document.querySelector('.modal-backdrop')!);

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows save failures in the shared raw session', async () => {
    const user = userEvent.setup();
    const resources = createResources({
      readText: vi.fn(async () => editableDefaultsText),
      writeText: vi.fn(async () => { throw new Error('disk full'); }),
    });
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      schemaPort: canonicalGeometrySchemaPort,
      workspaceResourcePort: resources,
    });

    render(
      <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={resources}>
        <GeometryStoreProvider store={store}>
          <DefaultsEditorModal isOpen filePath="input/defaults/editable.json" onClose={vi.fn()} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Edit full JSON/i }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Defaults JSON/i }), {
      target: { value: `${editableDefaultsText}\n` },
    });
    await user.click(screen.getByRole('button', { name: /Save full defaults/i }));

    expect(await screen.findByText('disk full')).toBeInTheDocument();
  });

  it('resets the session and rereads defaults when reopened', async () => {
    const user = userEvent.setup();
    const first = editableDefaultsText;
    const second = editableDefaultsText.replace('0.18', '0.19');
    const readText = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const resources = createResources({ readText });
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      schemaPort: canonicalGeometrySchemaPort,
      workspaceResourcePort: resources,
    });
    const renderModal = (isOpen: boolean) => (
      <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={resources}>
        <GeometryStoreProvider store={store}>
          <DefaultsEditorModal isOpen={isOpen} filePath="input/defaults/editable.json" onClose={vi.fn()} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>
    );
    const { rerender } = render(renderModal(true));

    await user.click(await screen.findByRole('button', { name: /Edit full JSON/i }));
    expect(await screen.findByRole('textbox', { name: /Defaults JSON/i })).toHaveValue(first);

    rerender(renderModal(false));
    rerender(renderModal(true));
    await waitFor(() => expect(readText).toHaveBeenCalledTimes(2));
    await user.click(await screen.findByRole('button', { name: /Edit full JSON/i }));
    expect(await screen.findByRole('textbox', { name: /Defaults JSON/i })).toHaveValue(second);
  });
});
