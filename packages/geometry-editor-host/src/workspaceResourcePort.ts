// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type GeometryWorkspaceResourceEntry = Readonly<{
  name: string;
  kind: 'file' | 'directory';
}>;

export type GeometryWorkspaceResourceListOptions = Readonly<{
  withKind?: boolean;
}>;

/**
 * Local workspace resources used by public editor features such as presets,
 * overlays and document sidecars. The Official host adapts its managed
 * workspace; the Community host adapts the user-selected local workspace.
 */
export interface GeometryWorkspaceResourcePort {
  readonly availability: 'available' | 'unavailable';
  readText(path: string): Promise<string>;
  readFile(path: string): Promise<File>;
  writeText(path: string, content: string): Promise<void>;
  writeBytes(path: string, content: Blob | BufferSource): Promise<void>;
  removeFile(path: string): Promise<void>;
  ensureDirectory(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(
    path: string,
    options?: GeometryWorkspaceResourceListOptions,
  ): Promise<readonly (string | GeometryWorkspaceResourceEntry)[]>;
}

function unavailable(operation: string): never {
  throw new Error(`Geometry workspace resource ${operation} is unavailable`);
}

/** Explicit no-workspace composition; callers must gate controls on availability. */
export const unavailableGeometryWorkspaceResourcePort: GeometryWorkspaceResourcePort =
  Object.freeze({
    availability: 'unavailable',
    readText: async () => unavailable('read'),
    readFile: async () => unavailable('read'),
    writeText: async () => unavailable('write'),
    writeBytes: async () => unavailable('write'),
    removeFile: async () => unavailable('delete'),
    ensureDirectory: async () => unavailable('directory creation'),
    exists: async () => false,
    list: async () => Object.freeze([]),
  });
