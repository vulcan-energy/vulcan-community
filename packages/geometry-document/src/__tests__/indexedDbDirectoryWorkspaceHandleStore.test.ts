// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  BrowserDirectoryWorkspaceError,
  createIndexedDbBrowserDirectoryWorkspaceHandleStore,
} from '../index';

function createIndexedDbMock() {
  let stored: unknown = undefined;
  let hasStore = false;
  const putValues: unknown[] = [];
  const deletedKeys: unknown[] = [];

  function request<T>(value: T) {
    const result = { result: value } as {
      result: T;
      error?: unknown;
      onsuccess?: () => void;
      onerror?: () => void;
    };
    queueMicrotask(() => result.onsuccess?.());
    return result;
  }

  const database = {
    objectStoreNames: {
      contains: vi.fn(() => hasStore),
    },
    createObjectStore: vi.fn(() => {
      hasStore = true;
    }),
    transaction: vi.fn(() => {
      const transaction = {
        error: null,
        oncomplete: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        objectStore: vi.fn(() => ({
          get: vi.fn(() => request(stored)),
          put: vi.fn((value: unknown, key: unknown) => {
            expect(key).toBe('active-directory-handle');
            putValues.push(value);
            stored = value;
            return request(undefined);
          }),
          delete: vi.fn((key: unknown) => {
            deletedKeys.push(key);
            stored = undefined;
            return request(undefined);
          }),
        })),
      };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    }),
    close: vi.fn(),
  };

  const indexedDB = {
    open: vi.fn(() => {
      const openRequest = {
        result: database,
        error: null,
        onupgradeneeded: undefined as (() => void) | undefined,
        onsuccess: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        onblocked: undefined as (() => void) | undefined,
      };
      queueMicrotask(() => {
        if (!hasStore) openRequest.onupgradeneeded?.();
        openRequest.onsuccess?.();
      });
      return openRequest;
    }),
  };

  return { indexedDB, database, putValues, deletedKeys };
}

describe('IndexedDB directory workspace handle store', () => {
  it('stores, restores and forgets only the opaque directory handle', async () => {
    const mock = createIndexedDbMock();
    const store = createIndexedDbBrowserDirectoryWorkspaceHandleStore({
      indexedDB: mock.indexedDB,
    });
    const handle = Object.freeze({ kind: 'directory', name: 'Local workspace' });

    expect(await store.load()).toBeNull();
    await store.save(handle);
    expect(await store.load()).toBe(handle);
    await store.clear();
    expect(await store.load()).toBeNull();

    expect(mock.indexedDB.open).toHaveBeenCalledWith(
      'vulcan-community-directory-workspace',
      1,
    );
    expect(mock.putValues).toEqual([handle]);
    expect(mock.deletedKeys).toEqual(['active-directory-handle']);
  });

  it('rejects unsupported hosts at construction without a fallback store', () => {
    expect(() =>
      createIndexedDbBrowserDirectoryWorkspaceHandleStore({}),
    ).toThrow(BrowserDirectoryWorkspaceError);
    expect(() =>
      createIndexedDbBrowserDirectoryWorkspaceHandleStore({}),
    ).toThrow(/IndexedDB/i);
  });

  it('does not expose a model, catalogue, project or path persistence API', () => {
    const mock = createIndexedDbMock();
    const store = createIndexedDbBrowserDirectoryWorkspaceHandleStore({
      indexedDB: mock.indexedDB,
    });

    expect(Reflect.ownKeys(store)).toEqual(['load', 'save', 'clear']);
    expect(JSON.stringify(store)).not.toMatch(
      /model|catalogue|project|source|path|workspaceStore|account/iu,
    );
  });
});
