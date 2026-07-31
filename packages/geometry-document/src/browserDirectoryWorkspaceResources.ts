// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  BrowserDirectoryWorkspaceError,
  type BrowserDirectoryWorkspaceResourceAccess,
  type BrowserDirectoryWorkspaceResourceEntry,
  type BrowserDirectoryWorkspaceResourceListOptions,
  type CapturedBrowserDirectoryHandle,
} from './browserDirectoryWorkspaceContracts';

type CapturedDirectoryNode = Readonly<{
  target: object;
  name: string;
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

type CapturedFileNode = Readonly<{
  target: object;
  name: string;
  getFile: (this: object) => Promise<unknown>;
  createWritable: (this: object) => Promise<unknown>;
}>;

type CapturedWritableNode = Readonly<{
  target: object;
  write: (this: object, value: unknown) => Promise<unknown>;
  close: (this: object) => Promise<unknown>;
  abort: (this: object) => Promise<unknown>;
}>;

const READWRITE_PERMISSION = Object.freeze({ mode: 'readwrite' as const });
const MAX_SEGMENT_CODE_POINTS = 255;
const MAX_PATH_CODE_POINTS = 4096;

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNamedError(value: unknown, name: string): boolean {
  return isRecord(value) && value.name === name;
}

function resourceError(
  handle: CapturedBrowserDirectoryHandle,
  resourceId: string,
  code: ConstructorParameters<typeof BrowserDirectoryWorkspaceError>[0],
  message: string,
  cause?: unknown,
): BrowserDirectoryWorkspaceError {
  return new BrowserDirectoryWorkspaceError(code, message, {
    directoryName: handle.name,
    resourceId,
    ...(cause === undefined ? {} : { cause }),
  });
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint !== undefined &&
    (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
  );
}

function isReservedRootName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === 'vulcan-workspace.json' ||
    lower === 'documents' ||
    lower === 'sources' ||
    lower === '__vulcan_document__' ||
    lower.startsWith('.vulcan-')
  );
}

function invalidPath(
  handle: CapturedBrowserDirectoryHandle,
  resourceId: string,
): BrowserDirectoryWorkspaceError {
  return resourceError(
    handle,
    resourceId,
    'invalid-request',
    'Workspace resource path is unsafe',
  );
}

function captureResourcePath(
  handle: CapturedBrowserDirectoryHandle,
  value: string,
  allowRoot: boolean,
): readonly string[] {
  if (typeof value !== 'string') {
    throw resourceError(
      handle,
      '',
      'invalid-request',
      'Workspace resource path must be a string',
    );
  }
  if (value === '') {
    if (allowRoot) return Object.freeze([]);
    throw invalidPath(handle, value);
  }
  if (
    value.normalize('NFC') !== value ||
    value.trim() !== value ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    /^[A-Za-z]:\//.test(value) ||
    Array.from(value).length > MAX_PATH_CODE_POINTS ||
    Array.from(value).some(isControlCharacter)
  ) {
    throw invalidPath(handle, value);
  }
  const segments = value.split('/');
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        segment.trim() !== segment ||
        Array.from(segment).length > MAX_SEGMENT_CODE_POINTS ||
        segment.toLowerCase().startsWith('.vulcan-'),
    ) ||
    isReservedRootName(segments[0]!)
  ) {
    throw invalidPath(handle, value);
  }
  return Object.freeze(segments);
}

function captureListWithKind(
  handle: CapturedBrowserDirectoryHandle,
  resourceId: string,
  options: BrowserDirectoryWorkspaceResourceListOptions | undefined,
): boolean {
  if (options === undefined) return false;
  if (!isRecord(options)) {
    throw resourceError(
      handle,
      resourceId,
      'invalid-request',
      'Workspace resource list options must be an object',
    );
  }
  let withKind: unknown;
  try {
    withKind = options.withKind;
  } catch (cause) {
    throw resourceError(
      handle,
      resourceId,
      'invalid-request',
      'Workspace resource list options could not be inspected',
      cause,
    );
  }
  if (withKind !== undefined && typeof withKind !== 'boolean') {
    throw resourceError(
      handle,
      resourceId,
      'invalid-request',
      'Workspace resource list withKind option must be boolean',
    );
  }
  return withKind === true;
}

function rootDirectoryNode(
  handle: CapturedBrowserDirectoryHandle,
): CapturedDirectoryNode {
  return Object.freeze({
    target: handle.target,
    name: handle.name,
    getFileHandle: handle.getFileHandle,
    getDirectoryHandle: handle.getDirectoryHandle,
    removeEntry: handle.removeEntry,
    entries: handle.entries,
  });
}

function captureDirectoryNode(
  handle: CapturedBrowserDirectoryHandle,
  resourceId: string,
  value: unknown,
): CapturedDirectoryNode {
  if (!isRecord(value) || value.kind !== 'directory') {
    throw resourceError(
      handle,
      resourceId,
      'read-failed',
      'Workspace resource directory is invalid',
    );
  }
  let name: unknown;
  let getFileHandle: unknown;
  let getDirectoryHandle: unknown;
  let removeEntry: unknown;
  let entries: unknown;
  try {
    name = value.name;
    getFileHandle = value.getFileHandle;
    getDirectoryHandle = value.getDirectoryHandle;
    removeEntry = value.removeEntry;
    entries = value.entries;
  } catch (cause) {
    throw resourceError(
      handle,
      resourceId,
      'read-failed',
      'Workspace resource directory could not be inspected',
      cause,
    );
  }
  if (
    typeof name !== 'string' ||
    typeof getFileHandle !== 'function' ||
    typeof getDirectoryHandle !== 'function' ||
    typeof removeEntry !== 'function' ||
    typeof entries !== 'function'
  ) {
    throw resourceError(
      handle,
      resourceId,
      'read-failed',
      'Workspace resource directory is incomplete',
    );
  }
  return Object.freeze({
    target: value,
    name,
    getFileHandle,
    getDirectoryHandle,
    removeEntry,
    entries,
  }) as CapturedDirectoryNode;
}

function captureFileNode(
  handle: CapturedBrowserDirectoryHandle,
  resourceId: string,
  expectedName: string,
  value: unknown,
  code: 'read-failed' | 'write-failed',
): CapturedFileNode {
  if (!isRecord(value) || value.kind !== 'file') {
    throw resourceError(
      handle,
      resourceId,
      code,
      'Workspace resource file is invalid',
    );
  }
  let name: unknown;
  let getFile: unknown;
  let createWritable: unknown;
  try {
    name = value.name;
    getFile = value.getFile;
    createWritable = value.createWritable;
  } catch (cause) {
    throw resourceError(
      handle,
      resourceId,
      code,
      'Workspace resource file could not be inspected',
      cause,
    );
  }
  if (
    name !== expectedName ||
    typeof getFile !== 'function' ||
    typeof createWritable !== 'function'
  ) {
    throw resourceError(
      handle,
      resourceId,
      code,
      'Workspace resource file is incomplete',
    );
  }
  return Object.freeze({ target: value, name, getFile, createWritable }) as CapturedFileNode;
}

function captureWritableNode(
  handle: CapturedBrowserDirectoryHandle,
  resourceId: string,
  value: unknown,
): CapturedWritableNode {
  if (!isRecord(value)) {
    throw resourceError(
      handle,
      resourceId,
      'write-failed',
      'Workspace resource writable stream is invalid',
    );
  }
  let write: unknown;
  let close: unknown;
  let abort: unknown;
  try {
    write = value.write;
    close = value.close;
    abort = value.abort;
  } catch (cause) {
    throw resourceError(
      handle,
      resourceId,
      'write-failed',
      'Workspace resource writable stream could not be inspected',
      cause,
    );
  }
  if (
    typeof write !== 'function' ||
    typeof close !== 'function' ||
    typeof abort !== 'function'
  ) {
    throw resourceError(
      handle,
      resourceId,
      'write-failed',
      'Workspace resource writable stream is incomplete',
    );
  }
  return Object.freeze({ target: value, write, close, abort }) as CapturedWritableNode;
}

async function ensureBackgroundPermission(
  handle: CapturedBrowserDirectoryHandle,
  resourceId: string,
): Promise<void> {
  let state: unknown;
  try {
    state = await handle.queryPermission.call(handle.target, READWRITE_PERMISSION);
  } catch (cause) {
    throw resourceError(
      handle,
      resourceId,
      'permission-check-failed',
      'Workspace folder permission could not be checked',
      cause,
    );
  }
  if (state === 'granted') return;
  if (state === 'prompt') {
    throw resourceError(
      handle,
      resourceId,
      'permission-required',
      'Reconnect to the workspace folder to continue',
    );
  }
  if (state === 'denied') {
    throw resourceError(
      handle,
      resourceId,
      'permission-denied',
      'Workspace folder permission was denied',
    );
  }
  throw resourceError(
    handle,
    resourceId,
    'permission-check-failed',
    'Workspace folder returned an unknown permission state',
  );
}

async function directoryAt(
  handle: CapturedBrowserDirectoryHandle,
  root: CapturedDirectoryNode,
  resourceId: string,
  names: readonly string[],
  create: boolean,
  code: 'read-failed' | 'write-failed',
): Promise<CapturedDirectoryNode> {
  let current = root;
  for (const name of names) {
    let value: unknown;
    try {
      value = await current.getDirectoryHandle.call(
        current.target,
        name,
        create ? { create: true } : undefined,
      );
    } catch (cause) {
      throw resourceError(
        handle,
        resourceId,
        code,
        `Workspace resource directory ${name} could not be opened`,
        cause,
      );
    }
    current = captureDirectoryNode(handle, resourceId, value);
  }
  return current;
}

async function fileNodeAt(
  handle: CapturedBrowserDirectoryHandle,
  root: CapturedDirectoryNode,
  resourceId: string,
  path: readonly string[],
  create: boolean,
  code: 'read-failed' | 'write-failed',
): Promise<CapturedFileNode> {
  const name = path[path.length - 1]!;
  const directory = await directoryAt(
    handle,
    root,
    resourceId,
    path.slice(0, -1),
    create,
    code,
  );
  let value: unknown;
  try {
    value = await directory.getFileHandle.call(
      directory.target,
      name,
      create ? { create: true } : undefined,
    );
  } catch (cause) {
    throw resourceError(
      handle,
      resourceId,
      code,
      `Workspace resource file ${name} could not be opened`,
      cause,
    );
  }
  return captureFileNode(handle, resourceId, name, value, code);
}

async function readFileValue(
  handle: CapturedBrowserDirectoryHandle,
  resourceId: string,
  file: CapturedFileNode,
): Promise<File> {
  let value: unknown;
  try {
    value = await file.getFile.call(file.target);
  } catch (cause) {
    throw resourceError(
      handle,
      resourceId,
      'read-failed',
      'Workspace resource file could not be read',
      cause,
    );
  }
  if (!isRecord(value)) {
    throw resourceError(
      handle,
      resourceId,
      'read-failed',
      'Workspace resource file is invalid',
    );
  }
  let name: unknown;
  let size: unknown;
  let text: unknown;
  let arrayBuffer: unknown;
  try {
    name = value.name;
    size = value.size;
    text = value.text;
    arrayBuffer = value.arrayBuffer;
  } catch (cause) {
    throw resourceError(
      handle,
      resourceId,
      'read-failed',
      'Workspace resource file could not be inspected',
      cause,
    );
  }
  if (
    name !== file.name ||
    !Number.isSafeInteger(size) ||
    (size as number) < 0 ||
    typeof text !== 'function' ||
    typeof arrayBuffer !== 'function'
  ) {
    throw resourceError(
      handle,
      resourceId,
      'read-failed',
      'Workspace resource file is incomplete',
    );
  }
  return value as unknown as File;
}

async function writeFileValue(
  handle: CapturedBrowserDirectoryHandle,
  root: CapturedDirectoryNode,
  resourceId: string,
  path: readonly string[],
  content: string | Blob | BufferSource,
): Promise<void> {
  const file = await fileNodeAt(
    handle,
    root,
    resourceId,
    path,
    true,
    'write-failed',
  );
  let writable: CapturedWritableNode;
  try {
    writable = captureWritableNode(
      handle,
      resourceId,
      await file.createWritable.call(file.target),
    );
  } catch (cause) {
    if (cause instanceof BrowserDirectoryWorkspaceError) throw cause;
    throw resourceError(
      handle,
      resourceId,
      'write-failed',
      'Workspace resource writable stream could not be created',
      cause,
    );
  }
  try {
    await writable.write.call(writable.target, content);
    await writable.close.call(writable.target);
  } catch (cause) {
    try {
      await writable.abort.call(writable.target);
    } catch {
      // Preserve the primary write failure.
    }
    throw resourceError(
      handle,
      resourceId,
      'write-failed',
      'Workspace resource file could not be written',
      cause,
    );
  }
}

function isBufferSource(value: unknown): value is BufferSource {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function captureBinaryContent(
  handle: CapturedBrowserDirectoryHandle,
  resourceId: string,
  value: Blob | BufferSource,
): Blob | BufferSource {
  if (
    (typeof Blob !== 'undefined' && value instanceof Blob) ||
    isBufferSource(value)
  ) {
    return value;
  }
  throw resourceError(
    handle,
    resourceId,
    'invalid-request',
    'Workspace resource bytes must be a Blob or BufferSource',
  );
}

/** Creates resource operations over the exact captured handle used by the provider. */
export function createBrowserDirectoryWorkspaceResourceAccess(
  handle: CapturedBrowserDirectoryHandle,
): BrowserDirectoryWorkspaceResourceAccess {
  const root = rootDirectoryNode(handle);
  return Object.freeze({
    availability: 'available' as const,

    async readText(path: string) {
      const parts = captureResourcePath(handle, path, false);
      await ensureBackgroundPermission(handle, path);
      const file = await readFileValue(
        handle,
        path,
        await fileNodeAt(handle, root, path, parts, false, 'read-failed'),
      );
      try {
        return await file.text();
      } catch (cause) {
        throw resourceError(
          handle,
          path,
          'read-failed',
          'Workspace resource text could not be read',
          cause,
        );
      }
    },

    async readFile(path: string) {
      const parts = captureResourcePath(handle, path, false);
      await ensureBackgroundPermission(handle, path);
      return readFileValue(
        handle,
        path,
        await fileNodeAt(handle, root, path, parts, false, 'read-failed'),
      );
    },

    async writeText(path: string, content: string) {
      const parts = captureResourcePath(handle, path, false);
      if (typeof content !== 'string') {
        throw resourceError(
          handle,
          path,
          'invalid-request',
          'Workspace resource text must be a string',
        );
      }
      await ensureBackgroundPermission(handle, path);
      await writeFileValue(handle, root, path, parts, content);
    },

    async writeBytes(path: string, content: Blob | BufferSource) {
      const parts = captureResourcePath(handle, path, false);
      const captured = captureBinaryContent(handle, path, content);
      await ensureBackgroundPermission(handle, path);
      await writeFileValue(handle, root, path, parts, captured);
    },

    async removeFile(path: string) {
      const parts = captureResourcePath(handle, path, false);
      await ensureBackgroundPermission(handle, path);
      const name = parts[parts.length - 1]!;
      const directory = await directoryAt(
        handle,
        root,
        path,
        parts.slice(0, -1),
        false,
        'write-failed',
      );
      await fileNodeAt(handle, root, path, parts, false, 'write-failed');
      try {
        await directory.removeEntry.call(directory.target, name);
      } catch (cause) {
        throw resourceError(
          handle,
          path,
          'write-failed',
          'Workspace resource file could not be removed',
          cause,
        );
      }
    },

    async ensureDirectory(path: string) {
      const parts = captureResourcePath(handle, path, true);
      await ensureBackgroundPermission(handle, path);
      await directoryAt(handle, root, path, parts, true, 'write-failed');
    },

    async exists(path: string) {
      const parts = captureResourcePath(handle, path, false);
      await ensureBackgroundPermission(handle, path);
      try {
        await fileNodeAt(handle, root, path, parts, false, 'read-failed');
        return true;
      } catch (cause) {
        if (
          cause instanceof BrowserDirectoryWorkspaceError &&
          isNamedError(cause.cause, 'NotFoundError')
        ) {
          return false;
        }
        throw cause;
      }
    },

    async list(
      path: string,
      options?: BrowserDirectoryWorkspaceResourceListOptions,
    ) {
      const parts = captureResourcePath(handle, path, true);
      const withKind = captureListWithKind(handle, path, options);
      await ensureBackgroundPermission(handle, path);
      const directory = await directoryAt(
        handle,
        root,
        path,
        parts,
        false,
        'read-failed',
      );
      let iterator: AsyncIterableIterator<readonly [string, unknown]>;
      try {
        iterator = directory.entries.call(directory.target);
      } catch (cause) {
        throw resourceError(
          handle,
          path,
          'read-failed',
          'Workspace resource directory could not be listed',
          cause,
        );
      }
      const entries: BrowserDirectoryWorkspaceResourceEntry[] = [];
      try {
        for await (const entry of iterator) {
          if (!Array.isArray(entry) || entry.length !== 2) {
            throw new TypeError('Invalid workspace directory entry');
          }
          const [name, node] = entry;
          if (
            typeof name !== 'string' ||
            name.normalize('NFC') !== name ||
            name.trim() !== name ||
            name === '.' ||
            name === '..' ||
            name.includes('/') ||
            name.includes('\\') ||
            Array.from(name).length > MAX_SEGMENT_CODE_POINTS ||
            Array.from(name).some(isControlCharacter) ||
            !isRecord(node) ||
            (node.kind !== 'file' && node.kind !== 'directory')
          ) {
            throw new TypeError('Invalid workspace directory entry');
          }
          if (
            name.toLowerCase().startsWith('.vulcan-') ||
            (parts.length === 0 && isReservedRootName(name))
          ) {
            continue;
          }
          entries.push(
            Object.freeze({
              name,
              kind: node.kind,
            }),
          );
        }
      } catch (cause) {
        throw resourceError(
          handle,
          path,
          'read-failed',
          'Workspace resource directory could not be listed',
          cause,
        );
      }
      entries.sort((left, right) => left.name.localeCompare(right.name));
      return Object.freeze(
        withKind ? entries : entries.map((entry) => entry.name),
      );
    },
  });
}
