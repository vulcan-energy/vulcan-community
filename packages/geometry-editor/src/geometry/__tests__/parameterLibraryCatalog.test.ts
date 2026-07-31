// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isLibrarySnippet,
  listCategoryJsonOptions,
  listElementPresetOptions,
  loadLibraryManifest,
  manifestIncludesSnippet,
} from '../parameterLibraryCatalog';
import type { GeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';

const resources: GeometryWorkspaceResourcePort = {
  availability: 'available',
  readText: vi.fn(),
  readFile: vi.fn(),
  writeText: vi.fn(),
  writeBytes: vi.fn(),
  removeFile: vi.fn(),
  ensureDirectory: vi.fn(),
  exists: vi.fn(),
  list: vi.fn(),
};

const readFileMock = vi.mocked(resources.readText);
const listFilesMock = vi.mocked(resources.list);

describe('parameterLibraryCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads only array-valued manifest categories', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      heat_source_wet: ['gas_boiler.json'],
      ignored: 'not a list',
    }));

    await expect(loadLibraryManifest(resources)).resolves.toEqual({
      heat_source_wet: ['gas_boiler.json'],
    });
  });

  it('checks manifest membership by id or filename', () => {
    const manifest = { heat_source_wet: ['gas_boiler.json'] };

    expect(manifestIncludesSnippet(manifest, 'heat_source_wet', 'gas_boiler')).toBe(true);
    expect(manifestIncludesSnippet(manifest, 'heat_source_wet', 'gas_boiler.json')).toBe(true);
    expect(manifestIncludesSnippet(manifest, 'heat_source_wet', 'custom_boiler')).toBe(false);
  });

  it('lists actual workspace files while using manifest only for source and ordering', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      heat_source_wet: ['gas_boiler.json', 'missing_library_file.json'],
    }));
    listFilesMock.mockResolvedValueOnce([
      { name: 'custom_boiler.json', kind: 'file' as const },
      { name: 'README.md', kind: 'file' as const },
      { name: 'gas_boiler.json', kind: 'file' as const },
    ]);

    await expect(listCategoryJsonOptions(resources, 'heat_source_wet')).resolves.toEqual([
      {
        id: 'gas_boiler',
        file: 'gas_boiler.json',
        label: 'gas boiler',
        source: 'library',
      },
      {
        id: 'custom_boiler',
        file: 'custom_boiler.json',
        label: 'custom boiler',
        source: 'user',
      },
    ]);
  });

  it('keeps custom snippets available after a refreshed manifest omits them', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      heat_source_wet: ['gas_boiler.json'],
    }));
    listFilesMock.mockResolvedValueOnce([
      { name: 'custom_boiler.json', kind: 'file' as const },
      { name: 'gas_boiler.json', kind: 'file' as const },
    ]);

    const options = await listCategoryJsonOptions(resources, 'heat_source_wet');

    expect(options.map((option) => option.id)).toEqual(['gas_boiler', 'custom_boiler']);
    expect(options.find((option) => option.id === 'custom_boiler')?.source).toBe('user');
  });

  it('filters element presets by file payload type and labels library membership from manifest', async () => {
    readFileMock
      .mockResolvedValueOnce(JSON.stringify({
        element_presets: ['standard_wall.json'],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        type: 'BuildingElementOpaque',
        label: 'Standard Wall',
        source: 'system',
      }))
      .mockResolvedValueOnce(JSON.stringify({
        type: 'BuildingElementOpaque',
        label: 'Customer Wall',
        source: 'system',
      }))
      .mockResolvedValueOnce(JSON.stringify({
        type: 'BuildingElementTransparent',
        label: 'Window',
        source: 'user',
      }));
    listFilesMock.mockResolvedValueOnce([
      { name: 'standard_wall.json', kind: 'file' as const },
      { name: 'window.json', kind: 'file' as const },
      { name: 'customer_wall.json', kind: 'file' as const },
    ]);

    await expect(listElementPresetOptions(resources, 'BuildingElementOpaque')).resolves.toEqual([
      {
        id: 'standard_wall',
        file: 'standard_wall.json',
        label: 'Standard Wall',
        source: 'library',
        type: 'BuildingElementOpaque',
      },
      {
        id: 'customer_wall',
        file: 'customer_wall.json',
        label: 'Customer Wall',
        source: 'user',
        type: 'BuildingElementOpaque',
      },
    ]);
  });

  it('uses the same manifest source for async snippet protection', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify({
      heat_source_wet: ['gas_boiler.json'],
    }));

    await expect(isLibrarySnippet(resources, 'heat_source_wet', 'gas_boiler')).resolves.toBe(true);
  });
});
