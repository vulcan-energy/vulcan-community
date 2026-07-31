// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometryWorkspaceProvider,
  GeometryWorkspaceProviderIdKind,
} from './providerContracts';

export type BrowserDirectoryWorkspaceErrorCode =
  | 'unsupported'
  | 'invalid-selection'
  | 'invalid-binding'
  | 'invalid-request'
  | 'picker-failed'
  | 'permission-required'
  | 'permission-denied'
  | 'permission-check-failed'
  | 'handle-store-failed'
  | 'workspace-not-found'
  | 'workspace-corrupt'
  | 'unsupported-version'
  | 'read-failed'
  | 'write-failed'
  | 'operation-in-progress'
  | 'version-conflict'
  | 'recovery-failed';

export type BrowserDirectoryWorkspaceErrorDetails = Readonly<{
  directoryName?: string;
  resourceId?: string;
  cause?: unknown;
}>;

export class BrowserDirectoryWorkspaceError extends Error {
  readonly code: BrowserDirectoryWorkspaceErrorCode;
  readonly directoryName?: string;
  readonly resourceId?: string;
  readonly cause?: unknown;

  constructor(
    code: BrowserDirectoryWorkspaceErrorCode,
    message: string,
    details: BrowserDirectoryWorkspaceErrorDetails = {},
  ) {
    super(message);
    this.name = 'BrowserDirectoryWorkspaceError';
    this.code = code;
    this.directoryName = details.directoryName;
    this.resourceId = details.resourceId;
    this.cause = details.cause;
  }
}

export type BrowserDirectoryWorkspaceCreateIdKind =
  | 'workspace'
  | GeometryWorkspaceProviderIdKind;

export type BrowserDirectoryWorkspaceCreateId = (
  kind: BrowserDirectoryWorkspaceCreateIdKind,
) => string;

/**
 * Stores only a structured-cloneable directory handle. Implementations must
 * never persist model bytes, catalogue rows, project data, paths or account data.
 */
export interface BrowserDirectoryWorkspaceHandleStore {
  load(): Promise<unknown | null>;
  save(handle: unknown): Promise<void>;
  clear(): Promise<void>;
}

export type BrowserDirectoryWorkspaceBinding = Readonly<{
  directoryName: string;
  workspaceId: string;
}>;

export type BrowserDirectoryWorkspaceResourceEntry = Readonly<{
  name: string;
  kind: 'file' | 'directory';
}>;

export type BrowserDirectoryWorkspaceResourceListOptions = Readonly<{
  withKind?: boolean;
}>;

/**
 * User-owned files rooted in the selected workspace folder. Provider-owned
 * catalogue, archive and source namespaces are deliberately inaccessible.
 */
export interface BrowserDirectoryWorkspaceResourceAccess {
  readonly availability: 'available';
  readText(path: string): Promise<string>;
  readFile(path: string): Promise<File>;
  writeText(path: string, content: string): Promise<void>;
  writeBytes(path: string, content: Blob | BufferSource): Promise<void>;
  removeFile(path: string): Promise<void>;
  ensureDirectory(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(
    path: string,
    options?: BrowserDirectoryWorkspaceResourceListOptions,
  ): Promise<readonly (string | BrowserDirectoryWorkspaceResourceEntry)[]>;
}

export type BrowserDirectoryWorkspaceConnected = Readonly<{
  status: 'connected';
  binding: BrowserDirectoryWorkspaceBinding;
  provider: GeometryWorkspaceProvider;
  resourceAccess: BrowserDirectoryWorkspaceResourceAccess;
}>;

export type BrowserDirectoryWorkspaceCancelled = Readonly<{
  status: 'cancelled';
}>;

export type BrowserDirectoryWorkspaceNotRemembered = Readonly<{
  status: 'not-remembered';
}>;

export type BrowserDirectoryWorkspacePermissionRequired = Readonly<{
  status: 'permission-required';
  directoryName: string;
}>;

export type BrowserDirectoryWorkspaceRestoreResult =
  | BrowserDirectoryWorkspaceConnected
  | BrowserDirectoryWorkspaceNotRemembered
  | BrowserDirectoryWorkspacePermissionRequired;

export type BrowserDirectoryWorkspaceChooseResult =
  | BrowserDirectoryWorkspaceConnected
  | BrowserDirectoryWorkspaceCancelled;

export type BrowserDirectoryWorkspaceCapabilities = Readonly<{
  choose: boolean;
  restore: boolean;
}>;

export interface BrowserDirectoryWorkspaceAccess {
  readonly capabilities: BrowserDirectoryWorkspaceCapabilities;
  choose(): Promise<BrowserDirectoryWorkspaceChooseResult>;
  restore(): Promise<BrowserDirectoryWorkspaceRestoreResult>;
  reconnect(): Promise<
    BrowserDirectoryWorkspaceConnected | BrowserDirectoryWorkspaceNotRemembered
  >;
  forget(): Promise<void>;
}

export type BrowserDirectoryWorkspaceAccessOptions = Readonly<{
  createId?: BrowserDirectoryWorkspaceCreateId;
  handleStore?: BrowserDirectoryWorkspaceHandleStore;
}>;

export type BrowserDirectoryWorkspacePermission =
  | 'user-initiated'
  | 'background';

export type BrowserDirectoryWorkspacePermissionDescriptor = Readonly<{
  mode: 'readwrite';
}>;

export type CapturedBrowserDirectoryHandle = Readonly<{
  target: object;
  name: string;
  queryPermission: (
    this: object,
    descriptor: BrowserDirectoryWorkspacePermissionDescriptor,
  ) => Promise<unknown>;
  requestPermission: (
    this: object,
    descriptor: BrowserDirectoryWorkspacePermissionDescriptor,
  ) => Promise<unknown>;
  getFileHandle: (
    this: object,
    name: string,
    options?: Readonly<{ create?: boolean }>,
  ) => Promise<unknown>;
  getDirectoryHandle: (
    this: object,
    name: string,
    options?: Readonly<{ create?: boolean }>,
  ) => Promise<unknown>;
  removeEntry: (
    this: object,
    name: string,
    options?: Readonly<{ recursive?: boolean }>,
  ) => Promise<unknown>;
  entries: (
    this: object,
  ) => AsyncIterableIterator<readonly [string, unknown]>;
}>;
