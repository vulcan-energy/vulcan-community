// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  BrowserDirectoryWorkspaceError,
  type BrowserDirectoryWorkspaceAccess,
  type BrowserDirectoryWorkspaceAccessOptions,
  type BrowserDirectoryWorkspaceCancelled,
  type BrowserDirectoryWorkspaceConnected,
  type BrowserDirectoryWorkspaceCreateId,
  type BrowserDirectoryWorkspaceHandleStore,
  type BrowserDirectoryWorkspaceNotRemembered,
  type BrowserDirectoryWorkspacePermissionRequired,
  type CapturedBrowserDirectoryHandle,
} from './browserDirectoryWorkspaceContracts';
import { openBrowserDirectoryGeometryWorkspaceProvider } from './browserDirectoryGeometryWorkspaceProvider';
import { createBrowserDirectoryWorkspaceResourceAccess } from './browserDirectoryWorkspaceResources';

type DirectoryPicker = (
  options: Readonly<{ mode: 'readwrite' }>,
) => Promise<unknown>;

type CapturedHandleStore = Readonly<{
  target: BrowserDirectoryWorkspaceHandleStore;
  load: BrowserDirectoryWorkspaceHandleStore['load'];
  save: BrowserDirectoryWorkspaceHandleStore['save'];
  clear: BrowserDirectoryWorkspaceHandleStore['clear'];
}>;

const CANCELLED: BrowserDirectoryWorkspaceCancelled = Object.freeze({
  status: 'cancelled',
});
const NOT_REMEMBERED: BrowserDirectoryWorkspaceNotRemembered = Object.freeze({
  status: 'not-remembered',
});

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNamedError(value: unknown, name: string): boolean {
  return isRecord(value) && value.name === name;
}

function capturePicker(host: unknown): DirectoryPicker | undefined {
  if (!isRecord(host)) return undefined;
  let candidate: unknown;
  try {
    candidate = host.showDirectoryPicker;
  } catch {
    return undefined;
  }
  return typeof candidate === 'function'
    ? (candidate.bind(host) as DirectoryPicker)
    : undefined;
}

function captureSafeDirectoryName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BrowserDirectoryWorkspaceError(
      'invalid-selection',
      'The selected workspace folder must have a name',
    );
  }
  const normalized = value.normalize('NFC');
  if (
    normalized.length === 0 ||
    normalized !== value ||
    normalized.trim() !== normalized ||
    Array.from(normalized).length > 255 ||
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined &&
        (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
      );
    })
  ) {
    throw new BrowserDirectoryWorkspaceError(
      'invalid-selection',
      'The selected workspace folder has an unsafe name',
    );
  }
  return normalized;
}

function captureDirectoryHandle(value: unknown): CapturedBrowserDirectoryHandle {
  if (!isRecord(value) || value.kind !== 'directory') {
    throw new BrowserDirectoryWorkspaceError(
      'invalid-selection',
      'The directory picker must return one folder handle',
    );
  }
  let name: unknown;
  let queryPermission: unknown;
  let requestPermission: unknown;
  let getFileHandle: unknown;
  let getDirectoryHandle: unknown;
  let removeEntry: unknown;
  let entries: unknown;
  try {
    name = value.name;
    queryPermission = value.queryPermission;
    requestPermission = value.requestPermission;
    getFileHandle = value.getFileHandle;
    getDirectoryHandle = value.getDirectoryHandle;
    removeEntry = value.removeEntry;
    entries = value.entries;
  } catch (cause) {
    throw new BrowserDirectoryWorkspaceError(
      'invalid-selection',
      'The selected workspace folder could not be inspected',
      { cause },
    );
  }
  const directoryName = captureSafeDirectoryName(name);
  if (
    typeof queryPermission !== 'function' ||
    typeof requestPermission !== 'function' ||
    typeof getFileHandle !== 'function' ||
    typeof getDirectoryHandle !== 'function' ||
    typeof removeEntry !== 'function' ||
    typeof entries !== 'function'
  ) {
    throw new BrowserDirectoryWorkspaceError(
      'invalid-selection',
      'The selected folder does not support durable workspace access',
      { directoryName },
    );
  }
  return Object.freeze({
    target: value,
    name: directoryName,
    queryPermission,
    requestPermission,
    getFileHandle,
    getDirectoryHandle,
    removeEntry,
    entries,
  }) as CapturedBrowserDirectoryHandle;
}

function captureHandleStore(
  value: BrowserDirectoryWorkspaceHandleStore | undefined,
): CapturedHandleStore | undefined {
  if (value === undefined) return undefined;
  let load: unknown;
  let save: unknown;
  let clear: unknown;
  try {
    load = value.load;
    save = value.save;
    clear = value.clear;
  } catch (cause) {
    throw new BrowserDirectoryWorkspaceError(
      'invalid-request',
      'Workspace handle store could not be inspected',
      { cause },
    );
  }
  if (
    typeof load !== 'function' ||
    typeof save !== 'function' ||
    typeof clear !== 'function'
  ) {
    throw new BrowserDirectoryWorkspaceError(
      'invalid-request',
      'Workspace handle store must implement load, save and clear',
    );
  }
  return Object.freeze({ target: value, load, save, clear }) as CapturedHandleStore;
}

function defaultCreateId(): BrowserDirectoryWorkspaceCreateId {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid !== 'function') {
    return () => {
      throw new BrowserDirectoryWorkspaceError(
        'unsupported',
        'Secure random UUID support is required for a durable workspace',
      );
    };
  }
  return (kind) => `${kind}-${randomUuid.call(globalThis.crypto)}`;
}

function captureCreateId(
  value: BrowserDirectoryWorkspaceCreateId | undefined,
): BrowserDirectoryWorkspaceCreateId {
  if (value === undefined) return defaultCreateId();
  if (typeof value !== 'function') {
    throw new BrowserDirectoryWorkspaceError(
      'invalid-request',
      'Workspace id allocator must be a function',
    );
  }
  return value;
}

async function loadRememberedHandle(
  handleStore: CapturedHandleStore | undefined,
): Promise<CapturedBrowserDirectoryHandle | null> {
  if (handleStore === undefined) return null;
  let value: unknown;
  try {
    value = await handleStore.load.call(handleStore.target);
  } catch (cause) {
    throw new BrowserDirectoryWorkspaceError(
      'handle-store-failed',
      'The remembered workspace handle could not be loaded',
      { cause },
    );
  }
  return value === null ? null : captureDirectoryHandle(value);
}

async function saveRememberedHandle(
  handleStore: CapturedHandleStore | undefined,
  handle: CapturedBrowserDirectoryHandle,
): Promise<void> {
  if (handleStore === undefined) return;
  try {
    await handleStore.save.call(handleStore.target, handle.target);
  } catch (cause) {
    throw new BrowserDirectoryWorkspaceError(
      'handle-store-failed',
      'The selected workspace handle could not be remembered',
      { directoryName: handle.name, cause },
    );
  }
}

async function connect(
  handle: CapturedBrowserDirectoryHandle,
  createId: BrowserDirectoryWorkspaceCreateId,
  permission: 'user-initiated' | 'background',
  initialize: boolean,
): Promise<BrowserDirectoryWorkspaceConnected> {
  const opened = await openBrowserDirectoryGeometryWorkspaceProvider({
    handle,
    createId,
    permission,
    initialize,
  });
  return Object.freeze({
    status: 'connected',
    binding: Object.freeze({
      directoryName: handle.name,
      workspaceId: opened.workspaceId,
    }),
    provider: opened.provider,
    resourceAccess: createBrowserDirectoryWorkspaceResourceAccess(handle),
  });
}
export function createBrowserDirectoryWorkspaceAccess(
  host: unknown = globalThis,
  options: BrowserDirectoryWorkspaceAccessOptions = {},
): BrowserDirectoryWorkspaceAccess {
  if (!isRecord(options)) {
    throw new BrowserDirectoryWorkspaceError(
      'invalid-request',
      'Workspace access options must be an object',
    );
  }
  const picker = capturePicker(host);
  const createId = captureCreateId(options.createId);
  const handleStore = captureHandleStore(options.handleStore);
  const capabilities = Object.freeze({
    choose: picker !== undefined,
    restore: handleStore !== undefined,
  });

  return Object.freeze({
    capabilities,

    async choose() {
      if (picker === undefined) {
        throw new BrowserDirectoryWorkspaceError(
          'unsupported',
          'Directory workspace selection is not supported in this browser',
        );
      }
      let selected: unknown;
      try {
        selected = await picker({ mode: 'readwrite' });
      } catch (cause) {
        if (isNamedError(cause, 'AbortError')) return CANCELLED;
        throw new BrowserDirectoryWorkspaceError(
          'picker-failed',
          'The workspace folder picker failed',
          { cause },
        );
      }
      const handle = captureDirectoryHandle(selected);
      const connected = await connect(handle, createId, 'user-initiated', true);
      await saveRememberedHandle(handleStore, handle);
      return connected;
    },

    async restore() {
      const handle = await loadRememberedHandle(handleStore);
      if (handle === null) return NOT_REMEMBERED;
      try {
        return await connect(handle, createId, 'background', false);
      } catch (cause) {
        if (
          cause instanceof BrowserDirectoryWorkspaceError &&
          cause.code === 'permission-required'
        ) {
          return Object.freeze({
            status: 'permission-required',
            directoryName: handle.name,
          }) satisfies BrowserDirectoryWorkspacePermissionRequired;
        }
        throw cause;
      }
    },

    async reconnect() {
      const handle = await loadRememberedHandle(handleStore);
      if (handle === null) return NOT_REMEMBERED;
      return connect(handle, createId, 'user-initiated', false);
    },

    async forget() {
      if (handleStore === undefined) return;
      try {
        await handleStore.clear.call(handleStore.target);
      } catch (cause) {
        throw new BrowserDirectoryWorkspaceError(
          'handle-store-failed',
          'The remembered workspace handle could not be forgotten',
          { cause },
        );
      }
    },
  });
}
