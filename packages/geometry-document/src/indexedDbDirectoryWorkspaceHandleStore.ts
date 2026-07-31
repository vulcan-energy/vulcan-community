// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  BrowserDirectoryWorkspaceError,
  type BrowserDirectoryWorkspaceHandleStore,
} from './browserDirectoryWorkspaceContracts';

const DATABASE_NAME = 'vulcan-community-directory-workspace';
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = 'directory-handles';
const ACTIVE_HANDLE_KEY = 'active-directory-handle';

type EventRequest = {
  result?: unknown;
  error?: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

type OpenRequest = EventRequest & {
  onupgradeneeded: (() => void) | null;
  onblocked: (() => void) | null;
};

type TransactionLike = {
  error?: unknown;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  objectStore(name: string): unknown;
};

type DatabaseLike = {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): unknown;
  transaction(name: string, mode: 'readonly' | 'readwrite'): unknown;
  close(): void;
};

type IndexedDbFactory = {
  target: object;
  open: (this: object, name: string, version: number) => unknown;
};

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function failure(message: string, cause?: unknown): BrowserDirectoryWorkspaceError {
  return new BrowserDirectoryWorkspaceError(
    'handle-store-failed',
    message,
    cause === undefined ? {} : { cause },
  );
}

function captureFactory(host: unknown): IndexedDbFactory {
  if (!isRecord(host)) {
    throw new BrowserDirectoryWorkspaceError(
      'unsupported',
      'IndexedDB is required to remember a workspace folder',
    );
  }
  let factory: unknown;
  let open: unknown;
  try {
    factory = host.indexedDB;
    open = isRecord(factory) ? factory.open : undefined;
  } catch (cause) {
    throw new BrowserDirectoryWorkspaceError(
      'unsupported',
      'IndexedDB could not be inspected',
      { cause },
    );
  }
  if (!isRecord(factory) || typeof open !== 'function') {
    throw new BrowserDirectoryWorkspaceError(
      'unsupported',
      'IndexedDB is required to remember a workspace folder',
    );
  }
  return Object.freeze({ target: factory, open }) as IndexedDbFactory;
}

function captureOpenRequest(value: unknown): OpenRequest {
  if (!isRecord(value)) throw failure('IndexedDB open request is invalid');
  return value as unknown as OpenRequest;
}

function captureDatabase(value: unknown): DatabaseLike {
  if (!isRecord(value)) throw failure('IndexedDB database is invalid');
  const objectStoreNames = value.objectStoreNames;
  const createObjectStore = value.createObjectStore;
  const transaction = value.transaction;
  const close = value.close;
  if (
    !isRecord(objectStoreNames) ||
    typeof objectStoreNames.contains !== 'function' ||
    typeof createObjectStore !== 'function' ||
    typeof transaction !== 'function' ||
    typeof close !== 'function'
  ) {
    throw failure('IndexedDB database is incomplete');
  }
  return value as unknown as DatabaseLike;
}

async function openDatabase(factory: IndexedDbFactory): Promise<DatabaseLike> {
  let request: OpenRequest;
  try {
    request = captureOpenRequest(
      factory.open.call(factory.target, DATABASE_NAME, DATABASE_VERSION),
    );
  } catch (cause) {
    if (cause instanceof BrowserDirectoryWorkspaceError) throw cause;
    throw failure('IndexedDB could not be opened', cause);
  }
  return new Promise<DatabaseLike>((resolve, reject) => {
    request.onupgradeneeded = () => {
      try {
        const database = captureDatabase(request.result);
        if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
          database.createObjectStore(OBJECT_STORE_NAME);
        }
      } catch (cause) {
        reject(failure('IndexedDB workspace store could not be created', cause));
      }
    };
    request.onsuccess = () => {
      try {
        resolve(captureDatabase(request.result));
      } catch (cause) {
        reject(cause);
      }
    };
    request.onerror = () => reject(failure('IndexedDB could not be opened', request.error));
    request.onblocked = () => reject(failure('IndexedDB upgrade is blocked'));
  });
}

function captureTransaction(value: unknown): TransactionLike {
  if (!isRecord(value) || typeof value.objectStore !== 'function') {
    throw failure('IndexedDB transaction is invalid');
  }
  return value as unknown as TransactionLike;
}

function captureObjectStore(value: unknown): Record<PropertyKey, unknown> {
  if (!isRecord(value)) throw failure('IndexedDB object store is invalid');
  return value;
}

function waitForTransaction(transaction: TransactionLike): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(failure('IndexedDB transaction failed', transaction.error));
    transaction.onabort = () =>
      reject(failure('IndexedDB transaction was aborted', transaction.error));
  });
}

function waitForRequest(value: unknown): Promise<unknown> {
  if (!isRecord(value)) return Promise.reject(failure('IndexedDB request is invalid'));
  const request = value as unknown as EventRequest;
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(failure('IndexedDB request failed', request.error));
  });
}

async function withDatabase<T>(
  factory: IndexedDbFactory,
  operation: (database: DatabaseLike) => Promise<T>,
): Promise<T> {
  const database = await openDatabase(factory);
  try {
    return await operation(database);
  } finally {
    database.close();
  }
}

export function createIndexedDbBrowserDirectoryWorkspaceHandleStore(
  host: unknown = globalThis,
): BrowserDirectoryWorkspaceHandleStore {
  const factory = captureFactory(host);
  return Object.freeze({
    load: () =>
      withDatabase(factory, async (database) => {
        const transaction = captureTransaction(
          database.transaction(OBJECT_STORE_NAME, 'readonly'),
        );
        const completion = waitForTransaction(transaction);
        const store = captureObjectStore(transaction.objectStore(OBJECT_STORE_NAME));
        if (typeof store.get !== 'function') {
          throw failure('IndexedDB object store cannot read handles');
        }
        const result = await waitForRequest(store.get(ACTIVE_HANDLE_KEY));
        await completion;
        return result === undefined ? null : result;
      }),

    save: (handle: unknown) =>
      withDatabase(factory, async (database) => {
        const transaction = captureTransaction(
          database.transaction(OBJECT_STORE_NAME, 'readwrite'),
        );
        const completion = waitForTransaction(transaction);
        const store = captureObjectStore(transaction.objectStore(OBJECT_STORE_NAME));
        if (typeof store.put !== 'function') {
          throw failure('IndexedDB object store cannot save handles');
        }
        store.put(handle, ACTIVE_HANDLE_KEY);
        await completion;
      }),

    clear: () =>
      withDatabase(factory, async (database) => {
        const transaction = captureTransaction(
          database.transaction(OBJECT_STORE_NAME, 'readwrite'),
        );
        const completion = waitForTransaction(transaction);
        const store = captureObjectStore(transaction.objectStore(OBJECT_STORE_NAME));
        if (typeof store.delete !== 'function') {
          throw failure('IndexedDB object store cannot forget handles');
        }
        store.delete(ACTIVE_HANDLE_KEY);
        await completion;
      }),
  });
}
