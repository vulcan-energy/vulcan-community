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

    await user.click(await screen.findByRole('button', { name: /Edit full JSON/i }));

    expect(await screen.findByRole('textbox', { name: /Defaults JSON/i })).toHaveValue(
      '{ definitely not JSON',
    );
    expect(await screen.findByText(/Invalid JSON:/i)).toBeInTheDocument();
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

    await user.click(await screen.findByRole('button', { name: /Edit full JSON/i }));

    expect(await screen.findByText('Defaults JSON must have an object at its root.')).toBeInTheDocument();
  });
});
