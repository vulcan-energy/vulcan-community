// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';

import type { GeometryWorkspaceResourcePort } from '../index';
import {
  createGeometryStore,
} from '../../../geometry-editor/src/stores/geometryStore';

const DEFAULT_DEFAULTS_PATH = 'input/defaults/defaults_template.json';
const csvWithoutDefaultsPath = 'Metadata,,,,\nZone,,,,\n';
const csvWithExplicitDefaultsPath = [
  'Metadata,,,,,,,,,,,,,',
  'DefaultsPath,input/defaults/community.json,,,,,,,,,,,,',
  'Zone,,,,',
  '',
].join('\n');

function createWorkspaceResourcePort(
  readText: GeometryWorkspaceResourcePort['readText'],
): GeometryWorkspaceResourcePort {
  return {
    availability: 'available',
    readText,
    readFile: vi.fn(),
    writeText: vi.fn(),
    writeBytes: vi.fn(),
    removeFile: vi.fn(),
    ensureDirectory: vi.fn(),
    exists: vi.fn(async () => false),
    list: vi.fn(async () => []),
  };
}

describe('geometry store default defaults-path policy', () => {
  it('preserves the Official default for creation, export, legacy load and reset', () => {
    const store = createGeometryStore();

    expect(store.getState().defaultsPath).toBe(DEFAULT_DEFAULTS_PATH);
    expect(store.getState().generateCSV()).toContain(`DefaultsPath,${DEFAULT_DEFAULTS_PATH},`);

    store.getState().loadFromCSV(csvWithoutDefaultsPath);
    expect(store.getState().defaultsPath).toBe(DEFAULT_DEFAULTS_PATH);

    store.getState().setDefaultsPath('input/defaults/other.json');
    store.getState().clearAll();
    expect(store.getState().defaultsPath).toBe(DEFAULT_DEFAULTS_PATH);
  });

  it('allows an embedding host to omit an unavailable default while retaining explicit document metadata', () => {
    const readText = vi.fn(async () => '{}');
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      workspaceResourcePort: createWorkspaceResourcePort(readText),
    });

    expect(store.getState().defaultsPath).toBeUndefined();
    expect(store.getState().generateCSV()).not.toContain('DefaultsPath,');

    store.getState().loadFromCSV(csvWithoutDefaultsPath);
    expect(store.getState().defaultsPath).toBeUndefined();
    expect(store.getState().generateCSV()).not.toContain('DefaultsPath,');
    expect(readText).not.toHaveBeenCalled();

    store.getState().loadFromCSV(csvWithExplicitDefaultsPath);
    expect(store.getState().defaultsPath).toBe('input/defaults/community.json');
    expect(store.getState().generateCSV()).toContain(
      'DefaultsPath,input/defaults/community.json,',
    );
    expect(readText).toHaveBeenCalledWith('input/defaults/community.json');

    store.getState().clearAll();
    expect(store.getState().defaultsPath).toBeUndefined();
    expect(store.getState().generateCSV()).not.toContain('DefaultsPath,');

    store.getState().setDefaultsPath('input/defaults/other.json');
    store.getState().resetGeometryDocumentForAccountBoundary();
    expect(store.getState().defaultsPath).toBeUndefined();
  });
});
