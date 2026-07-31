// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometryDocumentContents,
  GeometryDocumentInput,
} from './contracts';
import { captureGeometryDocumentContents } from './documentContents';
import {
  geometryDocumentNameKey,
  geometryProjectGroupNameKey,
  nextDuplicateGeometryDocumentName,
  normalizeGeometryDocumentName,
  normalizeGeometryProjectGroupName,
} from './documentNaming';
import {
  decodePortableGeometryDocument,
  encodePortableGeometryDocument,
} from './portableDocumentCodec';
import {
  GeometryWorkspaceProviderError,
  type GeometryDocumentCatalogueEntry,
  type GeometryDocumentCreateRequest,
  type GeometryDocumentDeleteReceipt,
  type GeometryDocumentDeleteRequest,
  type GeometryDocumentDuplicateReceipt,
  type GeometryDocumentDuplicateRequest,
  type GeometryDocumentMembershipReceipt,
  type GeometryDocumentOpenRequest,
  type GeometryDocumentPersistenceReceipt,
  type GeometryDocumentUpdateRequest,
  type GeometryProjectGroupCatalogueEntry,
  type GeometryProjectGroupCreateRequest,
  type GeometryProjectGroupDeleteReceipt,
  type GeometryProjectGroupDeleteRequest,
  type GeometryProjectGroupMutationReceipt,
  type GeometryProjectGroupSetDocumentMembershipRequest,
  type GeometryProjectGroupUpdateRequest,
  type GeometryStoredDocument,
  type GeometryWorkspaceProvider,
  type GeometryWorkspaceSnapshot,
} from './providerContracts';
import {
  BROWSER_DIRECTORY_WORKSPACE_METADATA_FORMAT,
  BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS,
  BROWSER_DIRECTORY_WORKSPACE_METADATA_VERSION,
  BrowserDirectoryWorkspaceMetadataError,
  decodeBrowserDirectoryWorkspaceMetadata,
  encodeBrowserDirectoryWorkspaceMetadata,
  type BrowserDirectoryWorkspaceMetadata,
} from './browserDirectoryWorkspaceMetadata';
import {
  BrowserDirectoryWorkspaceError,
  type BrowserDirectoryWorkspaceCreateId,
  type BrowserDirectoryWorkspacePermission,
  type CapturedBrowserDirectoryHandle,
} from './browserDirectoryWorkspaceContracts';

const WORKSPACE_METADATA_FILE = 'vulcan-workspace.json';
const WORKSPACE_TRANSACTION_FILE = '.vulcan-transaction.json';
const WORKSPACE_LOCK_FILE = '.vulcan-workspace.lock';
const DOCUMENTS_DIRECTORY = 'documents';
const SOURCES_DIRECTORY = 'sources';
const READWRITE_PERMISSION = Object.freeze({ mode: 'readwrite' } as const);
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const TEXT_ENCODER = new TextEncoder();
const TRANSACTION_FORMAT = 'vulcan-community-directory-transaction';
const TRANSACTION_VERSION = 1;
// Nesting two canonical metadata objects can add two indentation bytes per
// line. Six times the individual metadata cap is a conservative bound for the
// two inputs plus their added indentation and envelope.
const MAXIMUM_TRANSACTION_BYTES =
  BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumMetadataBytes * 6 + 4_096;

type MetadataDocument = BrowserDirectoryWorkspaceMetadata['documents'][number];
type MetadataProjectGroup = BrowserDirectoryWorkspaceMetadata['projectGroups'][number];

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
}>;

type CapturedFileNode = Readonly<{
  target: object;
  name: string;
  getFile: (this: object) => Promise<unknown>;
  createWritable: (
    this: object,
    options: Readonly<{
      keepExistingData: boolean;
      mode: 'exclusive';
    }>,
  ) => Promise<unknown>;
}>;

type FileBytes = Readonly<{
  bytes: Uint8Array;
  lastModified: number | null;
}>;

type WritableNode = Readonly<{
  target: object;
  write: (this: object, chunk: unknown) => Promise<unknown>;
  truncate: (this: object, size: number) => Promise<unknown>;
  close: (this: object) => Promise<unknown>;
  abort: (this: object, reason?: unknown) => Promise<unknown>;
}>;

type LoadedDocumentRow = Readonly<{
  metadata: MetadataDocument;
  entry: GeometryDocumentCatalogueEntry;
}>;

type LoadedDocument = LoadedDocumentRow & Readonly<{
  contents: GeometryDocumentContents;
}>;

type LoadedWorkspace = Readonly<{
  metadata: BrowserDirectoryWorkspaceMetadata;
  metadataBytes: Uint8Array;
  documents: ReadonlyMap<string, LoadedDocumentRow>;
  projectGroups: ReadonlyMap<string, GeometryProjectGroupCatalogueEntry>;
  snapshot: GeometryWorkspaceSnapshot;
}>;

type WorkspaceTransaction = Readonly<{
  base: BrowserDirectoryWorkspaceMetadata;
  next: BrowserDirectoryWorkspaceMetadata;
}>;

export type OpenBrowserDirectoryGeometryWorkspaceProviderOptions = Readonly<{
  handle: CapturedBrowserDirectoryHandle;
  createId: BrowserDirectoryWorkspaceCreateId;
  permission: BrowserDirectoryWorkspacePermission;
  initialize: boolean;
}>;

export type OpenedBrowserDirectoryGeometryWorkspaceProvider = Readonly<{
  workspaceId: string;
  provider: GeometryWorkspaceProvider;
}>;

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNamedError(value: unknown, name: string): boolean {
  return isRecord(value) && value.name === name;
}

function browserError(
  code: ConstructorParameters<typeof BrowserDirectoryWorkspaceError>[0],
  message: string,
  cause?: unknown,
): BrowserDirectoryWorkspaceError {
  return new BrowserDirectoryWorkspaceError(code, message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function providerError(
  code: ConstructorParameters<typeof GeometryWorkspaceProviderError>[0],
  message: string,
  resource: ConstructorParameters<typeof GeometryWorkspaceProviderError>[2]['resource'],
  id?: string,
  cause?: unknown,
): GeometryWorkspaceProviderError {
  return new GeometryWorkspaceProviderError(code, message, {
    resource,
    ...(id === undefined ? {} : { id }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function captureDirectoryNode(value: unknown): CapturedDirectoryNode {
  if (!isRecord(value) || value.kind !== 'directory') {
    throw browserError(
      'workspace-corrupt',
      'A durable workspace directory entry is invalid',
    );
  }
  let name: unknown;
  let getFileHandle: unknown;
  let getDirectoryHandle: unknown;
  let removeEntry: unknown;
  try {
    name = value.name;
    getFileHandle = value.getFileHandle;
    getDirectoryHandle = value.getDirectoryHandle;
    removeEntry = value.removeEntry;
  } catch (cause) {
    throw browserError(
      'workspace-corrupt',
      'A durable workspace directory entry could not be inspected',
      cause,
    );
  }
  if (
    typeof name !== 'string' ||
    typeof getFileHandle !== 'function' ||
    typeof getDirectoryHandle !== 'function' ||
    typeof removeEntry !== 'function'
  ) {
    throw browserError(
      'workspace-corrupt',
      'A durable workspace directory entry is incomplete',
    );
  }
  return Object.freeze({
    target: value,
    name,
    getFileHandle,
    getDirectoryHandle,
    removeEntry,
  }) as CapturedDirectoryNode;
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
  });
}

function captureFileNode(value: unknown, expectedName: string): CapturedFileNode {
  if (!isRecord(value) || value.kind !== 'file') {
    throw browserError('workspace-corrupt', `Expected workspace file ${expectedName}`);
  }
  let name: unknown;
  let getFile: unknown;
  let createWritable: unknown;
  try {
    name = value.name;
    getFile = value.getFile;
    createWritable = value.createWritable;
  } catch (cause) {
    throw browserError(
      'workspace-corrupt',
      `Workspace file ${expectedName} could not be inspected`,
      cause,
    );
  }
  if (
    name !== expectedName ||
    typeof getFile !== 'function' ||
    typeof createWritable !== 'function'
  ) {
    throw browserError(
      'workspace-corrupt',
      `Workspace file ${expectedName} is invalid`,
    );
  }
  return Object.freeze({ target: value, name, getFile, createWritable }) as CapturedFileNode;
}

function captureWritable(value: unknown): WritableNode {
  if (!isRecord(value)) {
    throw browserError('write-failed', 'Workspace writable stream is invalid');
  }
  let write: unknown;
  let truncate: unknown;
  let close: unknown;
  let abort: unknown;
  try {
    write = value.write;
    truncate = value.truncate;
    close = value.close;
    abort = value.abort;
  } catch (cause) {
    throw browserError(
      'write-failed',
      'Workspace writable stream could not be inspected',
      cause,
    );
  }
  if (
    typeof write !== 'function' ||
    typeof truncate !== 'function' ||
    typeof close !== 'function' ||
    typeof abort !== 'function'
  ) {
    throw browserError('write-failed', 'Workspace writable stream is incomplete');
  }
  return Object.freeze({ target: value, write, truncate, close, abort }) as WritableNode;
}

async function directoryAt(
  root: CapturedDirectoryNode,
  names: readonly string[],
  create: boolean,
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
      throw browserError(
        'read-failed',
        `Workspace directory ${name} could not be opened`,
        cause,
      );
    }
    current = captureDirectoryNode(value);
  }
  return current;
}

async function fileNodeAt(
  root: CapturedDirectoryNode,
  path: readonly string[],
  create: boolean,
): Promise<CapturedFileNode | null> {
  if (path.length === 0) {
    throw browserError('invalid-request', 'Workspace file path is empty');
  }
  const fileName = path[path.length - 1]!;
  let directory: CapturedDirectoryNode;
  try {
    directory = await directoryAt(root, path.slice(0, -1), create);
  } catch (cause) {
    if (!create && cause instanceof BrowserDirectoryWorkspaceError && isNamedError(cause.cause, 'NotFoundError')) {
      return null;
    }
    throw cause;
  }
  let value: unknown;
  try {
    value = await directory.getFileHandle.call(
      directory.target,
      fileName,
      create ? { create: true } : undefined,
    );
  } catch (cause) {
    if (!create && isNamedError(cause, 'NotFoundError')) return null;
    throw browserError(
      create ? 'write-failed' : 'read-failed',
      `Workspace file ${fileName} could not be opened`,
      cause,
    );
  }
  return captureFileNode(value, fileName);
}

async function readFileNode(
  file: CapturedFileNode,
  maximumBytes: number,
): Promise<FileBytes> {
  let value: unknown;
  try {
    value = await file.getFile.call(file.target);
  } catch (cause) {
    throw browserError('read-failed', `Workspace file ${file.name} could not be read`, cause);
  }
  if (!isRecord(value)) {
    throw browserError('workspace-corrupt', `Workspace file ${file.name} is invalid`);
  }
  const size = value.size;
  const arrayBuffer = value.arrayBuffer;
  const lastModified = value.lastModified;
  if (
    !Number.isSafeInteger(size) ||
    (size as number) < 0 ||
    typeof arrayBuffer !== 'function'
  ) {
    throw browserError('workspace-corrupt', `Workspace file ${file.name} is invalid`);
  }
  if ((size as number) > maximumBytes) {
    throw browserError('workspace-corrupt', `Workspace file ${file.name} exceeds its size limit`);
  }
  let buffer: unknown;
  try {
    buffer = await arrayBuffer.call(value);
  } catch (cause) {
    throw browserError('read-failed', `Workspace file ${file.name} bytes could not be read`, cause);
  }
  if (!(buffer instanceof ArrayBuffer)) {
    throw browserError('workspace-corrupt', `Workspace file ${file.name} returned invalid bytes`);
  }
  const bytes = new Uint8Array(buffer.slice(0));
  if (bytes.byteLength !== size || bytes.byteLength > maximumBytes) {
    throw browserError('workspace-corrupt', `Workspace file ${file.name} changed while it was read`);
  }
  return Object.freeze({
    bytes,
    lastModified:
      Number.isSafeInteger(lastModified) && (lastModified as number) >= 0
        ? (lastModified as number)
        : null,
  });
}

async function readFileAt(
  root: CapturedDirectoryNode,
  path: readonly string[],
  maximumBytes: number,
): Promise<FileBytes | null> {
  const file = await fileNodeAt(root, path, false);
  return file === null ? null : readFileNode(file, maximumBytes);
}

async function writeFileAt(
  root: CapturedDirectoryNode,
  path: readonly string[],
  bytes: Uint8Array,
): Promise<void> {
  const existing = await fileNodeAt(root, path, false);
  const created = existing === null;
  const file = existing ?? await fileNodeAt(root, path, true);
  if (file === null) throw browserError('write-failed', 'Workspace file was not created');
  let writable: WritableNode | null = null;
  let primaryError: unknown;
  try {
    writable = captureWritable(
      await file.createWritable.call(file.target, {
        keepExistingData: false,
        mode: 'exclusive',
      }),
    );
    const copy = Uint8Array.from(bytes);
    await writable.write.call(writable.target, {
      type: 'write',
      position: 0,
      data: copy,
    });
    await writable.truncate.call(writable.target, copy.byteLength);
    await writable.close.call(writable.target);
  } catch (cause) {
    primaryError = cause;
    if (writable !== null) {
      try {
        await writable.abort.call(writable.target, cause);
      } catch {
        // The primary write failure is authoritative.
      }
    }
  }
  if (primaryError !== undefined) {
    if (created) {
      try {
        const residual = await readFileAt(root, path, 1);
        if (residual !== null && residual.bytes.byteLength === 0) {
          await removeFileAt(root, path);
        }
      } catch {
        // Preserve the primary write failure. A non-empty or uninspectable
        // reserved file must remain visible to later fail-closed recovery.
      }
    }
    if (isNamedError(primaryError, 'NoModificationAllowedError')) {
      throw browserError(
        'operation-in-progress',
        'Another workspace operation is in progress',
        primaryError,
      );
    }
    if (primaryError instanceof BrowserDirectoryWorkspaceError) throw primaryError;
    throw browserError('write-failed', 'Workspace file could not be written', primaryError);
  }
  const verified = await readFileNode(file, Math.max(bytes.byteLength, 1));
  if (!bytesEqual(verified.bytes, bytes)) {
    throw browserError('write-failed', 'Workspace file verification failed');
  }
}

async function writeFileAtWithExpectedBytes(
  root: CapturedDirectoryNode,
  path: readonly string[],
  expectedBytes: Uint8Array,
  nextBytes: Uint8Array,
): Promise<void> {
  const file = await fileNodeAt(root, path, false);
  if (file === null) {
    throw browserError('version-conflict', 'Workspace catalogue disappeared');
  }
  let writable: WritableNode | null = null;
  let primaryError: unknown;
  try {
    writable = captureWritable(
      await file.createWritable.call(file.target, {
        keepExistingData: false,
        mode: 'exclusive',
      }),
    );
    const current = await readFileNode(
      file,
      BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumMetadataBytes,
    );
    if (!bytesEqual(current.bytes, expectedBytes)) {
      throw browserError(
        'version-conflict',
        'Workspace catalogue changed after its writer was acquired',
      );
    }
    const copy = Uint8Array.from(nextBytes);
    await writable.write.call(writable.target, {
      type: 'write',
      position: 0,
      data: copy,
    });
    await writable.truncate.call(writable.target, copy.byteLength);
    await writable.close.call(writable.target);
  } catch (cause) {
    primaryError = cause;
    if (writable !== null) {
      try {
        await writable.abort.call(writable.target, cause);
      } catch {
        // The primary conflict/write error remains authoritative.
      }
    }
  }
  if (primaryError !== undefined) {
    if (primaryError instanceof BrowserDirectoryWorkspaceError) {
      throw primaryError;
    }
    if (isNamedError(primaryError, 'NoModificationAllowedError')) {
      throw browserError(
        'operation-in-progress',
        'Another workspace operation is in progress',
        primaryError,
      );
    }
    throw browserError('write-failed', 'Workspace catalogue could not be written', primaryError);
  }
  const verified = await readFileNode(
    file,
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumMetadataBytes,
  );
  if (!bytesEqual(verified.bytes, nextBytes)) {
    throw browserError('write-failed', 'Workspace catalogue verification failed');
  }
}

async function removeFileAt(
  root: CapturedDirectoryNode,
  path: readonly string[],
): Promise<void> {
  if (path.length === 0) return;
  let parent: CapturedDirectoryNode;
  try {
    parent = await directoryAt(root, path.slice(0, -1), false);
  } catch (cause) {
    if (cause instanceof BrowserDirectoryWorkspaceError && isNamedError(cause.cause, 'NotFoundError')) return;
    throw cause;
  }
  try {
    await parent.removeEntry.call(parent.target, path[path.length - 1]!);
  } catch (cause) {
    if (isNamedError(cause, 'NotFoundError')) return;
    throw browserError('write-failed', 'Workspace file cleanup failed', cause);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw browserError('unsupported', 'SHA-256 Web Crypto support is required');
  }
  let digest: ArrayBuffer;
  try {
    const copy = Uint8Array.from(bytes);
    digest = await subtle.digest('SHA-256', copy.buffer);
  } catch (cause) {
    throw browserError('read-failed', 'Workspace integrity could not be calculated', cause);
  }
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function archivePath(document: MetadataDocument): readonly string[] {
  return Object.freeze([
    DOCUMENTS_DIRECTORY,
    document.id,
    `${document.contentRevision}.vulcan`,
  ]);
}

function sourcePath(
  document: MetadataDocument,
  sourceId: string,
): readonly string[] {
  return Object.freeze([
    SOURCES_DIRECTORY,
    document.id,
    String(document.contentRevision),
    `${sourceId}.bin`,
  ]);
}

function isPermissionState(value: unknown): value is PermissionState {
  return value === 'granted' || value === 'prompt' || value === 'denied';
}

async function ensurePermission(
  handle: CapturedBrowserDirectoryHandle,
  permission: BrowserDirectoryWorkspacePermission,
): Promise<void> {
  let state: unknown;
  try {
    state = await handle.queryPermission.call(handle.target, READWRITE_PERMISSION);
  } catch (cause) {
    throw new BrowserDirectoryWorkspaceError(
      'permission-check-failed',
      'Workspace folder permission could not be checked',
      { directoryName: handle.name, cause },
    );
  }
  if (!isPermissionState(state)) {
    throw new BrowserDirectoryWorkspaceError(
      'permission-check-failed',
      'Workspace folder returned an unknown permission state',
      { directoryName: handle.name },
    );
  }
  if (state === 'granted') return;
  if (state === 'denied') {
    throw new BrowserDirectoryWorkspaceError(
      'permission-denied',
      'Workspace folder permission was denied',
      { directoryName: handle.name },
    );
  }
  if (permission === 'background') {
    throw new BrowserDirectoryWorkspaceError(
      'permission-required',
      'Reconnect to the workspace folder to continue',
      { directoryName: handle.name },
    );
  }
  try {
    state = await handle.requestPermission.call(handle.target, READWRITE_PERMISSION);
  } catch (cause) {
    throw new BrowserDirectoryWorkspaceError(
      'permission-check-failed',
      'Workspace folder permission request failed',
      { directoryName: handle.name, cause },
    );
  }
  if (state === 'granted') return;
  if (state === 'denied' || state === 'prompt') {
    throw new BrowserDirectoryWorkspaceError(
      'permission-denied',
      'Workspace folder permission was not granted',
      { directoryName: handle.name },
    );
  }
  throw new BrowserDirectoryWorkspaceError(
    'permission-check-failed',
    'Workspace folder returned an unknown permission state',
    { directoryName: handle.name },
  );
}

async function acquireWorkspaceLock(
  root: CapturedDirectoryNode,
): Promise<WritableNode> {
  const file = await fileNodeAt(root, [WORKSPACE_LOCK_FILE], true);
  if (file === null) throw browserError('write-failed', 'Workspace lock was not created');
  try {
    return captureWritable(
      await file.createWritable.call(file.target, {
        keepExistingData: true,
        mode: 'exclusive',
      }),
    );
  } catch (cause) {
    if (isNamedError(cause, 'NoModificationAllowedError')) {
      throw browserError(
        'operation-in-progress',
        'Another workspace operation is in progress',
        cause,
      );
    }
    throw browserError('write-failed', 'Workspace lock could not be acquired', cause);
  }
}

async function withWorkspaceLock<T>(
  root: CapturedDirectoryNode,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireWorkspaceLock(root);
  let result: T | undefined;
  let primaryError: unknown;
  try {
    result = await operation();
  } catch (cause) {
    primaryError = cause;
  }
  try {
    await lock.abort.call(lock.target, primaryError);
  } catch (cause) {
    if (primaryError === undefined) {
      primaryError = browserError('write-failed', 'Workspace lock could not be released', cause);
    }
  }
  if (primaryError !== undefined) throw primaryError;
  return result as T;
}

function mapMetadataError(cause: unknown): BrowserDirectoryWorkspaceError {
  if (cause instanceof BrowserDirectoryWorkspaceMetadataError) {
    if (cause.code === 'unsupported-version') {
      return browserError(
        'unsupported-version',
        'The workspace metadata version is not supported',
        cause,
      );
    }
    return browserError(
      'workspace-corrupt',
      'The workspace metadata is invalid',
      cause,
    );
  }
  return browserError(
    'workspace-corrupt',
    'The workspace metadata could not be decoded',
    cause,
  );
}

async function readMetadata(
  root: CapturedDirectoryNode,
): Promise<Readonly<{
  metadata: BrowserDirectoryWorkspaceMetadata;
  bytes: Uint8Array;
}> | null> {
  const file = await readFileAt(
    root,
    [WORKSPACE_METADATA_FILE],
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumMetadataBytes,
  );
  if (file === null) return null;
  try {
    return Object.freeze({
      metadata: decodeBrowserDirectoryWorkspaceMetadata(file.bytes),
      bytes: Uint8Array.from(file.bytes),
    });
  } catch (cause) {
    throw mapMetadataError(cause);
  }
}

function emptyMetadata(workspaceId: string): BrowserDirectoryWorkspaceMetadata {
  try {
    return decodeBrowserDirectoryWorkspaceMetadata(
      encodeBrowserDirectoryWorkspaceMetadata({
        format: BROWSER_DIRECTORY_WORKSPACE_METADATA_FORMAT,
        formatVersion: BROWSER_DIRECTORY_WORKSPACE_METADATA_VERSION,
        workspaceId,
        catalogueRevision: 0,
        retiredIds: [],
        documents: [],
        projectGroups: [],
      }),
    );
  } catch (cause) {
    throw mapMetadataError(cause);
  }
}

function canonicalMetadata(
  value: BrowserDirectoryWorkspaceMetadata,
): BrowserDirectoryWorkspaceMetadata {
  try {
    return decodeBrowserDirectoryWorkspaceMetadata(
      encodeBrowserDirectoryWorkspaceMetadata(value),
    );
  } catch (cause) {
    throw mapMetadataError(cause);
  }
}

function metadataJsonValue(
  metadata: BrowserDirectoryWorkspaceMetadata,
): unknown {
  const bytes = encodeBrowserDirectoryWorkspaceMetadata(metadata);
  return JSON.parse(TEXT_DECODER.decode(bytes)) as unknown;
}

function encodeTransaction(transaction: WorkspaceTransaction): Uint8Array {
  const value = {
    format: TRANSACTION_FORMAT,
    formatVersion: TRANSACTION_VERSION,
    base: metadataJsonValue(transaction.base),
    next: metadataJsonValue(transaction.next),
  };
  return TEXT_ENCODER.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function exactKeys(
  value: Record<PropertyKey, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return (
    keys.length === sorted.length &&
    keys.every((key, index) => key === sorted[index])
  );
}

function decodeTransaction(bytes: Uint8Array): WorkspaceTransaction {
  if (
    bytes.byteLength > MAXIMUM_TRANSACTION_BYTES
  ) {
    throw browserError('recovery-failed', 'Workspace transaction exceeds its size limit');
  }
  let value: unknown;
  try {
    value = JSON.parse(TEXT_DECODER.decode(bytes));
  } catch (cause) {
    throw browserError('recovery-failed', 'Workspace transaction is invalid', cause);
  }
  if (
    !isRecord(value) ||
    !exactKeys(value, ['format', 'formatVersion', 'base', 'next']) ||
    value.format !== TRANSACTION_FORMAT ||
    value.formatVersion !== TRANSACTION_VERSION
  ) {
    throw browserError('recovery-failed', 'Workspace transaction is invalid');
  }
  let base: BrowserDirectoryWorkspaceMetadata;
  let next: BrowserDirectoryWorkspaceMetadata;
  try {
    base = canonicalMetadata(value.base as BrowserDirectoryWorkspaceMetadata);
    next = canonicalMetadata(value.next as BrowserDirectoryWorkspaceMetadata);
  } catch (cause) {
    throw browserError('recovery-failed', 'Workspace transaction metadata is invalid', cause);
  }
  if (base.workspaceId !== next.workspaceId) {
    throw browserError('recovery-failed', 'Workspace transaction changes workspace identity');
  }
  const transaction = Object.freeze({ base, next });
  const canonical = encodeTransaction(transaction);
  if (!bytesEqual(canonical, bytes)) {
    throw browserError('recovery-failed', 'Workspace transaction is not canonical');
  }
  return transaction;
}

function documentContentKey(document: MetadataDocument): string {
  return `${document.id}:${document.contentRevision}`;
}

async function cleanupRemovedContent(
  root: CapturedDirectoryNode,
  removeFrom: BrowserDirectoryWorkspaceMetadata,
  keepIn: BrowserDirectoryWorkspaceMetadata,
): Promise<void> {
  const kept = new Set(keepIn.documents.map(documentContentKey));
  for (const document of removeFrom.documents) {
    if (kept.has(documentContentKey(document))) continue;
    await removeFileAt(root, archivePath(document));
    for (const source of document.sourceFiles) {
      await removeFileAt(root, sourcePath(document, source.id));
    }
  }
}

async function recoverWorkspaceTransaction(
  root: CapturedDirectoryNode,
): Promise<void> {
  const transactionFile = await readFileAt(
    root,
    [WORKSPACE_TRANSACTION_FILE],
    MAXIMUM_TRANSACTION_BYTES,
  );
  if (transactionFile === null) return;
  if (transactionFile.bytes.byteLength === 0) {
    // A first-write process stop can leave only the file-system-created empty
    // placeholder. Content writes begin only after a non-empty WAL closes, so
    // this state has no prepared paths to roll back.
    await removeFileAt(root, [WORKSPACE_TRANSACTION_FILE]);
    return;
  }
  const transaction = decodeTransaction(transactionFile.bytes);
  const current = await readMetadata(root);
  if (current === null) {
    throw browserError('recovery-failed', 'Workspace transaction has no metadata');
  }
  const baseBytes = encodeBrowserDirectoryWorkspaceMetadata(transaction.base);
  const nextBytes = encodeBrowserDirectoryWorkspaceMetadata(transaction.next);
  if (bytesEqual(current.bytes, baseBytes)) {
    await cleanupRemovedContent(root, transaction.next, transaction.base);
  } else if (bytesEqual(current.bytes, nextBytes)) {
    await cleanupRemovedContent(root, transaction.base, transaction.next);
  } else {
    throw browserError(
      'recovery-failed',
      'Workspace transaction does not match the current catalogue',
    );
  }
  await removeFileAt(root, [WORKSPACE_TRANSACTION_FILE]);
}

async function commitMetadata(
  root: CapturedDirectoryNode,
  base: BrowserDirectoryWorkspaceMetadata,
  next: BrowserDirectoryWorkspaceMetadata,
): Promise<void> {
  const transaction = Object.freeze({ base, next });
  await writeFileAt(root, [WORKSPACE_TRANSACTION_FILE], encodeTransaction(transaction));
  const current = await readMetadata(root);
  const baseBytes = encodeBrowserDirectoryWorkspaceMetadata(base);
  if (current === null || !bytesEqual(current.bytes, baseBytes)) {
    throw browserError(
      'version-conflict',
      'Workspace catalogue changed before it could be committed',
    );
  }
  const nextBytes = encodeBrowserDirectoryWorkspaceMetadata(next);
  try {
    await writeFileAtWithExpectedBytes(
      root,
      [WORKSPACE_METADATA_FILE],
      baseBytes,
      nextBytes,
    );
  } catch (cause) {
    if (
      cause instanceof BrowserDirectoryWorkspaceError &&
      cause.code === 'version-conflict'
    ) {
      await cleanupRemovedContent(root, next, base);
      await removeFileAt(root, [WORKSPACE_TRANSACTION_FILE]);
    }
    throw cause;
  }
  const verified = await readMetadata(root);
  if (verified === null || !bytesEqual(verified.bytes, nextBytes)) {
    throw browserError('write-failed', 'Workspace catalogue verification failed');
  }
  try {
    await cleanupRemovedContent(root, base, next);
    await removeFileAt(root, [WORKSPACE_TRANSACTION_FILE]);
  } catch {
    // The logical mutation is already durably committed. Keep the WAL so the
    // next operation retries physical cleanup instead of reporting a plain
    // failure for a change the catalogue already reflects.
  }
}

function captureStoredContents(
  portable: Awaited<ReturnType<typeof decodePortableGeometryDocument>>,
  sourceFiles: GeometryDocumentContents['sourceFiles'],
): GeometryDocumentContents {
  return captureGeometryDocumentContents({
    fileName: portable.model.fileName,
    text: portable.model.text,
    derivedResources: portable.derivedResources,
    sourceFiles,
  });
}

async function documentCatalogueEntry(
  metadata: MetadataDocument,
): Promise<GeometryDocumentCatalogueEntry> {
  const integrity = await sha256(
    TEXT_ENCODER.encode(
      JSON.stringify([
        metadata.id,
        metadata.fileName,
        metadata.modifiedAt,
        metadata.projectGroupIds,
        metadata.storageRevision,
        metadata.contentRevision,
        [metadata.archive.byteLength, metadata.archive.sha256],
        metadata.sourceFiles.map((source) => [
          source.id,
          source.slots,
          source.role,
          source.fileName,
          source.mediaType,
          source.byteLength,
          source.sha256,
        ]),
      ]),
    ),
  );
  return Object.freeze({
    id: metadata.id,
    fileName: metadata.fileName,
    modifiedAt: metadata.modifiedAt,
    storageVersion: `document:${metadata.storageRevision}:${integrity}`,
    projectGroupIds: Object.freeze([...metadata.projectGroupIds]),
  });
}

async function loadDocument(
  root: CapturedDirectoryNode,
  metadata: MetadataDocument,
  integrityFailure: 'workspace-corrupt' | 'version-conflict',
): Promise<LoadedDocument> {
  const failIntegrity = (message: string, cause?: unknown): never => {
    throw new BrowserDirectoryWorkspaceError(integrityFailure, message, {
      resourceId: metadata.id,
      ...(cause === undefined ? {} : { cause }),
    });
  };
  const archive = await readFileAt(
    root,
    archivePath(metadata),
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumArchiveBytes,
  );
  if (archive === null) {
    failIntegrity(`Document ${metadata.id} archive is missing`);
  }
  const capturedArchive = archive as FileBytes;
  const archiveHash = await sha256(capturedArchive.bytes);
  if (
    capturedArchive.bytes.byteLength !== metadata.archive.byteLength ||
    archiveHash !== metadata.archive.sha256
  ) {
    failIntegrity(`Document ${metadata.id} archive changed outside the workspace`);
  }
  let portable:
    | Awaited<ReturnType<typeof decodePortableGeometryDocument>>
    | null = null;
  try {
    portable = await decodePortableGeometryDocument(capturedArchive.bytes);
  } catch (cause) {
    failIntegrity(`Document ${metadata.id} archive is invalid`, cause);
  }
  if (portable === null) {
    failIntegrity(`Document ${metadata.id} archive is invalid`);
  }
  const decodedPortable = portable as Awaited<
    ReturnType<typeof decodePortableGeometryDocument>
  >;
  if (
    decodedPortable.model.fileName !== metadata.fileName ||
    decodedPortable.sourceFiles.length !== 0
  ) {
    failIntegrity(`Document ${metadata.id} archive does not match its catalogue row`);
  }
  const sourceFiles = [] as Array<GeometryDocumentContents['sourceFiles'][number]>;
  for (const descriptor of metadata.sourceFiles) {
    const source = await readFileAt(
      root,
      sourcePath(metadata, descriptor.id),
      BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumSourceFileBytes,
    );
    if (source === null) {
      failIntegrity(`Document ${metadata.id} source ${descriptor.id} is missing`);
    }
    const capturedSource = source as FileBytes;
    const sourceHash = await sha256(capturedSource.bytes);
    if (
      capturedSource.bytes.byteLength !== descriptor.byteLength ||
      sourceHash !== descriptor.sha256
    ) {
      failIntegrity(
        `Document ${metadata.id} source ${descriptor.id} changed outside the workspace`,
      );
    }
    sourceFiles.push({
      id: descriptor.id,
      slots: descriptor.slots,
      role: descriptor.role,
      fileName: descriptor.fileName,
      mediaType: descriptor.mediaType,
      bytes: Uint8Array.from(capturedSource.bytes),
    });
  }
  const entry = await documentCatalogueEntry(metadata);
  return Object.freeze({
    metadata,
    entry,
    contents: captureStoredContents(decodedPortable, sourceFiles),
  });
}

async function projectStorageVersion(
  project: MetadataProjectGroup,
): Promise<string> {
  const hash = await sha256(
    TEXT_ENCODER.encode(
      JSON.stringify([
        project.id,
        project.name,
        project.description,
        project.storageRevision,
      ]),
    ),
  );
  return `project-group:${project.storageRevision}:${hash}`;
}

async function loadWorkspace(
  root: CapturedDirectoryNode,
): Promise<LoadedWorkspace> {
  const stored = await readMetadata(root);
  if (stored === null) {
    throw browserError('workspace-not-found', 'Workspace metadata was not found');
  }
  const documents = new Map<string, LoadedDocumentRow>();
  for (const document of stored.metadata.documents) {
    documents.set(
      document.id,
      Object.freeze({
        metadata: document,
        entry: await documentCatalogueEntry(document),
      }),
    );
  }
  const projectGroups = new Map<string, GeometryProjectGroupCatalogueEntry>();
  for (const project of stored.metadata.projectGroups) {
    projectGroups.set(
      project.id,
      Object.freeze({
        id: project.id,
        name: project.name,
        description: project.description,
        storageVersion: await projectStorageVersion(project),
      }),
    );
  }
  const catalogueHash = await sha256(
    TEXT_ENCODER.encode(
      [
        await sha256(stored.bytes),
        ...Array.from(documents.values(), ({ entry }) => entry.storageVersion),
      ].join(':'),
    ),
  );
  const snapshot: GeometryWorkspaceSnapshot = Object.freeze({
    providerId: stored.metadata.workspaceId,
    catalogueVersion: `catalogue:${stored.metadata.catalogueRevision}:${catalogueHash}`,
    documents: Object.freeze(
      stored.metadata.documents.map((document) => documents.get(document.id)!.entry),
    ),
    projectGroups: Object.freeze(
      stored.metadata.projectGroups.map((project) => projectGroups.get(project.id)!),
    ),
  });
  return Object.freeze({
    metadata: stored.metadata,
    metadataBytes: stored.bytes,
    documents,
    projectGroups,
    snapshot,
  });
}

function captureSessionRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw providerError(
      'invalid-request',
      'Session revision must be a non-negative safe integer',
      'document',
    );
  }
  return value as number;
}

function captureExpectedStorageVersion(
  value: unknown,
  resource: 'document' | 'project-group',
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw providerError(
      'invalid-request',
      `Expected ${resource} storage version must be a non-empty string`,
      resource,
    );
  }
  return value;
}

function captureRequestId(
  value: unknown,
  resource: 'document' | 'project-group',
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw providerError('invalid-id', `${resource} id is invalid`, resource);
  }
  return value;
}

function captureContents(value: unknown): GeometryDocumentContents {
  if (!isRecord(value)) {
    throw providerError('invalid-request', 'Document contents are invalid', 'document');
  }
  let fileName: unknown;
  let text: unknown;
  let derivedResources: unknown;
  let sourceFiles: unknown;
  try {
    fileName = value.fileName;
    text = value.text;
    derivedResources = value.derivedResources;
    sourceFiles = value.sourceFiles;
  } catch (cause) {
    throw providerError(
      'invalid-request',
      'Document contents could not be read',
      'document',
      undefined,
      cause,
    );
  }
  if (typeof fileName !== 'string') {
    throw providerError('invalid-name', 'Document name must be a string', 'document');
  }
  if (typeof text !== 'string') {
    throw providerError('invalid-request', 'Document text must be a string', 'document');
  }
  const normalizedFileName = normalizeGeometryDocumentName(fileName);
  if (!normalizedFileName.toLowerCase().endsWith('.csv')) {
    throw providerError(
      'invalid-name',
      'Document name must use the .csv extension',
      'document',
    );
  }
  try {
    return captureGeometryDocumentContents({
      fileName: normalizedFileName,
      text,
      ...(derivedResources === undefined
        ? {}
        : { derivedResources: derivedResources as GeometryDocumentInput['derivedResources'] }),
      ...(sourceFiles === undefined
        ? {}
        : { sourceFiles: sourceFiles as GeometryDocumentInput['sourceFiles'] }),
    });
  } catch (cause) {
    if (cause instanceof GeometryWorkspaceProviderError) throw cause;
    throw providerError(
      'invalid-request',
      'Document resources are invalid',
      'document',
      undefined,
      cause,
    );
  }
}

function captureMemberships(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw providerError(
      'invalid-request',
      'Project group ids must be an array',
      'document',
    );
  }
  const memberships = Array.from(value, (id) =>
    captureRequestId(id, 'project-group'),
  );
  if (new Set(memberships).size !== memberships.length) {
    throw providerError(
      'invalid-request',
      'Project group ids must not contain duplicates',
      'document',
    );
  }
  memberships.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return Object.freeze(memberships);
}

function captureDescription(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw providerError(
      'invalid-request',
      'Project group description must be a string',
      'project-group',
    );
  }
  const normalized = value.normalize('NFC');
  if (
    normalized !== value ||
    Array.from(normalized).length >
      BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumProjectDescriptionCharacters ||
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined &&
        (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
      );
    })
  ) {
    throw providerError(
      'invalid-request',
      'Project group description is invalid',
      'project-group',
    );
  }
  return normalized;
}

function assertMembershipsExist(
  workspace: LoadedWorkspace,
  memberships: readonly string[],
): void {
  for (const id of memberships) {
    if (!workspace.projectGroups.has(id)) {
      throw providerError(
        'not-found',
        `Project group ${id} was not found`,
        'project-group',
        id,
      );
    }
  }
}

function assertDocumentNameAvailable(
  workspace: LoadedWorkspace,
  fileName: string,
  exceptId?: string,
): void {
  const key = geometryDocumentNameKey(fileName);
  for (const document of workspace.documents.values()) {
    if (
      document.entry.id !== exceptId &&
      geometryDocumentNameKey(document.entry.fileName) === key
    ) {
      throw providerError(
        'duplicate-name',
        `Document name ${fileName} already exists`,
        'document',
        document.entry.id,
      );
    }
  }
}

function assertProjectNameAvailable(
  workspace: LoadedWorkspace,
  name: string,
  exceptId?: string,
): void {
  const key = geometryProjectGroupNameKey(name);
  for (const project of workspace.projectGroups.values()) {
    if (
      project.id !== exceptId &&
      geometryProjectGroupNameKey(project.name) === key
    ) {
      throw providerError(
        'duplicate-name',
        `Project group name ${name} already exists`,
        'project-group',
        project.id,
      );
    }
  }
}

function allocateId(
  createId: BrowserDirectoryWorkspaceCreateId,
  kind: 'document' | 'project-group',
  metadata: BrowserDirectoryWorkspaceMetadata,
): string {
  let id: unknown;
  try {
    id = createId(kind);
  } catch (cause) {
    throw providerError(
      'operation-failed',
      `Could not allocate a ${kind} id`,
      kind,
      undefined,
      cause,
    );
  }
  if (typeof id !== 'string') {
    throw providerError('invalid-id', `Allocated ${kind} id is invalid`, kind);
  }
  const used = new Set<string>([
    metadata.workspaceId,
    ...metadata.retiredIds,
    ...metadata.documents.map((document) => document.id),
    ...metadata.projectGroups.map((project) => project.id),
  ]);
  if (used.has(id)) {
    throw providerError(
      'duplicate-id',
      `Allocated workspace id ${id} already exists`,
      kind,
      id,
    );
  }
  return id;
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

async function buildDocumentMetadata(
  id: string,
  storageRevision: number,
  contentRevision: number,
  modifiedAt: string | null,
  projectGroupIds: readonly string[],
  contents: GeometryDocumentContents,
): Promise<Readonly<{
  row: MetadataDocument;
  archiveBytes: Uint8Array;
  sources: readonly Readonly<{ id: string; bytes: Uint8Array }>[];
}>> {
  const archiveBytes = await encodePortableGeometryDocument({
    model: { fileName: contents.fileName, text: contents.text },
    derivedResources: contents.derivedResources,
    sourceFiles: contents.sourceFiles,
  });
  const sourceDescriptors = await Promise.all(
    contents.sourceFiles.map(async (source) => ({
      id: source.id,
      slots: Object.freeze([...source.slots]),
      role: source.role,
      fileName: source.fileName,
      mediaType: source.mediaType,
      byteLength: source.bytes.byteLength,
      sha256: await sha256(source.bytes),
    })),
  );
  const row: MetadataDocument = Object.freeze({
    id,
    fileName: contents.fileName,
    modifiedAt,
    projectGroupIds: Object.freeze([...projectGroupIds]),
    storageRevision,
    contentRevision,
    archive: Object.freeze({
      byteLength: archiveBytes.byteLength,
      sha256: await sha256(archiveBytes),
    }),
    sourceFiles: Object.freeze(sourceDescriptors),
  });
  return Object.freeze({
    row,
    archiveBytes: Uint8Array.from(archiveBytes),
    sources: Object.freeze(
      contents.sourceFiles.map((source) =>
        Object.freeze({ id: source.id, bytes: Uint8Array.from(source.bytes) }),
      ),
    ),
  });
}

async function writePreparedDocument(
  root: CapturedDirectoryNode,
  prepared: Awaited<ReturnType<typeof buildDocumentMetadata>>,
): Promise<void> {
  if ((await readFileAt(
    root,
    archivePath(prepared.row),
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumArchiveBytes,
  )) !== null) {
    throw browserError('write-failed', 'Prepared document archive already exists');
  }
  await writeFileAt(root, archivePath(prepared.row), prepared.archiveBytes);
  for (const source of prepared.sources) {
    if ((await readFileAt(
      root,
      sourcePath(prepared.row, source.id),
      BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumSourceFileBytes,
    )) !== null) {
      throw browserError('write-failed', 'Prepared source file already exists');
    }
    await writeFileAt(root, sourcePath(prepared.row, source.id), source.bytes);
  }
}

async function commitPreparedMetadata(
  root: CapturedDirectoryNode,
  base: BrowserDirectoryWorkspaceMetadata,
  next: BrowserDirectoryWorkspaceMetadata,
  prepared?: Awaited<ReturnType<typeof buildDocumentMetadata>>,
): Promise<void> {
  try {
    if (prepared !== undefined) {
      // Persist the recovery intent before creating any immutable content. If
      // the tab or browser stops during an archive/source write, the next
      // operation can identify those paths from `next` and roll them back
      // against `base`.
      await writeFileAt(
        root,
        [WORKSPACE_TRANSACTION_FILE],
        encodeTransaction(Object.freeze({ base, next })),
      );
      await writePreparedDocument(root, prepared);
    }
    await commitMetadata(root, base, next);
  } catch (cause) {
    try {
      await recoverWorkspaceTransaction(root);
      const current = await readMetadata(root);
      if (
        current !== null &&
        bytesEqual(current.bytes, encodeBrowserDirectoryWorkspaceMetadata(next))
      ) {
        return;
      }
      await cleanupRemovedContent(root, next, base);
    } catch {
      // Preserve the original failure; the durable WAL remains for later recovery.
    }
    throw cause;
  }
}

function withDocumentRow(
  metadata: BrowserDirectoryWorkspaceMetadata,
  row: MetadataDocument,
): BrowserDirectoryWorkspaceMetadata {
  return canonicalMetadata({
    ...metadata,
    catalogueRevision: metadata.catalogueRevision + 1,
    documents: [
      ...metadata.documents.filter((document) => document.id !== row.id),
      row,
    ],
  });
}

function withProjectRow(
  metadata: BrowserDirectoryWorkspaceMetadata,
  row: MetadataProjectGroup,
): BrowserDirectoryWorkspaceMetadata {
  return canonicalMetadata({
    ...metadata,
    catalogueRevision: metadata.catalogueRevision + 1,
    projectGroups: [
      ...metadata.projectGroups.filter((project) => project.id !== row.id),
      row,
    ],
  });
}

function requireLoadedDocument(
  workspace: LoadedWorkspace,
  id: string,
): LoadedDocumentRow {
  const document = workspace.documents.get(id);
  if (document === undefined) {
    throw providerError('not-found', `Document ${id} was not found`, 'document', id);
  }
  return document;
}

function requireLoadedProject(
  workspace: LoadedWorkspace,
  id: string,
): Readonly<{
  metadata: MetadataProjectGroup;
  entry: GeometryProjectGroupCatalogueEntry;
}> {
  const entry = workspace.projectGroups.get(id);
  const metadata = workspace.metadata.projectGroups.find((project) => project.id === id);
  if (entry === undefined || metadata === undefined) {
    throw providerError(
      'not-found',
      `Project group ${id} was not found`,
      'project-group',
      id,
    );
  }
  return Object.freeze({ metadata, entry });
}

function assertVersion(
  actual: string,
  expected: string,
  resource: 'document' | 'project-group',
  id: string,
): void {
  if (actual !== expected) {
    throw providerError(
      'version-conflict',
      `${resource} ${id} has changed`,
      resource,
      id,
    );
  }
}

function captureCreateRequest(request: GeometryDocumentCreateRequest) {
  let contents: unknown;
  let projectGroupIds: unknown;
  let sessionRevision: unknown;
  try {
    contents = request.contents;
    projectGroupIds = request.projectGroupIds;
    sessionRevision = request.sessionRevision;
  } catch (cause) {
    throw providerError(
      'invalid-request',
      'Document create request could not be read',
      'document',
      undefined,
      cause,
    );
  }
  return Object.freeze({
    contents: captureContents(contents),
    projectGroupIds: captureMemberships(projectGroupIds),
    sessionRevision: captureSessionRevision(sessionRevision),
  });
}

function captureUpdateRequest(request: GeometryDocumentUpdateRequest) {
  let id: unknown;
  let expectedStorageVersion: unknown;
  let contents: unknown;
  let sessionRevision: unknown;
  try {
    id = request.id;
    expectedStorageVersion = request.expectedStorageVersion;
    contents = request.contents;
    sessionRevision = request.sessionRevision;
  } catch (cause) {
    throw providerError(
      'invalid-request',
      'Document update request could not be read',
      'document',
      undefined,
      cause,
    );
  }
  return Object.freeze({
    id: captureRequestId(id, 'document'),
    expectedStorageVersion: captureExpectedStorageVersion(
      expectedStorageVersion,
      'document',
    ),
    contents: captureContents(contents),
    sessionRevision: captureSessionRevision(sessionRevision),
  });
}

function persistenceReceipt(
  workspace: LoadedWorkspace,
  document: LoadedDocument,
  persistedSessionRevision: number,
): GeometryDocumentPersistenceReceipt {
  return Object.freeze({
    entry: document.entry,
    contents: document.contents,
    persistedSessionRevision,
    snapshot: workspace.snapshot,
  });
}

function captureDuplicateRequest(request: GeometryDocumentDuplicateRequest) {
  let sourceId: unknown;
  let expectedStorageVersion: unknown;
  let rawContents: unknown;
  let rawSessionRevision: unknown;
  try {
    sourceId = request.sourceId;
    expectedStorageVersion = request.expectedStorageVersion;
    rawContents = request.contents;
    rawSessionRevision = request.sessionRevision;
  } catch (cause) {
    throw providerError(
      'invalid-request',
      'Document duplicate request could not be read',
      'document',
      undefined,
      cause,
    );
  }
  if ((rawContents === undefined) !== (rawSessionRevision === undefined)) {
    throw providerError(
      'invalid-request',
      'Duplicate contents and session revision must be supplied together',
      'document',
    );
  }
  return Object.freeze({
    sourceId: captureRequestId(sourceId, 'document'),
    expectedStorageVersion: captureExpectedStorageVersion(
      expectedStorageVersion,
      'document',
    ),
    ...(rawContents === undefined
      ? {}
      : {
          contents: captureContents(rawContents),
          sessionRevision: captureSessionRevision(rawSessionRevision),
        }),
  });
}

async function assertNoReservedWorkspaceData(
  root: CapturedDirectoryNode,
): Promise<void> {
  for (const reservedDirectory of [DOCUMENTS_DIRECTORY, SOURCES_DIRECTORY]) {
    try {
      await root.getDirectoryHandle.call(root.target, reservedDirectory);
      throw browserError(
        'workspace-corrupt',
        `Workspace metadata is missing but reserved ${reservedDirectory} data exists`,
      );
    } catch (cause) {
      if (
        cause instanceof BrowserDirectoryWorkspaceError ||
        !isNamedError(cause, 'NotFoundError')
      ) {
        throw cause;
      }
    }
  }
}

async function initializeOrLoadWorkspace(
  root: CapturedDirectoryNode,
  createId: BrowserDirectoryWorkspaceCreateId,
  initialize: boolean,
): Promise<BrowserDirectoryWorkspaceMetadata> {
  await recoverWorkspaceTransaction(root);
  let existing: Awaited<ReturnType<typeof readMetadata>>;
  try {
    existing = await readMetadata(root);
  } catch (cause) {
    if (!initialize) throw cause;
    const raw = await readFileAt(
      root,
      [WORKSPACE_METADATA_FILE],
      BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumMetadataBytes,
    );
    if (raw === null || raw.bytes.byteLength !== 0) throw cause;
    // Explicit selection may repair only the zero-byte placeholder left before
    // the first catalogue close, and only while no reserved content exists.
    await assertNoReservedWorkspaceData(root);
    await removeFileAt(root, [WORKSPACE_METADATA_FILE]);
    existing = null;
  }
  if (existing !== null) return existing.metadata;
  if (!initialize) {
    throw browserError('workspace-not-found', 'The remembered workspace no longer exists');
  }
  await assertNoReservedWorkspaceData(root);
  let workspaceId: unknown;
  try {
    workspaceId = createId('workspace');
  } catch (cause) {
    throw browserError('invalid-request', 'Workspace identity could not be allocated', cause);
  }
  if (typeof workspaceId !== 'string') {
    throw browserError('invalid-request', 'Workspace identity must be a string');
  }
  const metadata = emptyMetadata(workspaceId);
  await writeFileAt(
    root,
    [WORKSPACE_METADATA_FILE],
    encodeBrowserDirectoryWorkspaceMetadata(metadata),
  );
  await directoryAt(root, [DOCUMENTS_DIRECTORY], true);
  await directoryAt(root, [SOURCES_DIRECTORY], true);
  return metadata;
}

export async function openBrowserDirectoryGeometryWorkspaceProvider(
  options: OpenBrowserDirectoryGeometryWorkspaceProviderOptions,
): Promise<OpenedBrowserDirectoryGeometryWorkspaceProvider> {
  if (!isRecord(options)) {
    throw browserError('invalid-request', 'Workspace provider options are invalid');
  }
  const handle = options.handle;
  const createId = options.createId;
  const permission = options.permission;
  const initialize = options.initialize;
  if (
    !isRecord(handle) ||
    typeof createId !== 'function' ||
    (permission !== 'user-initiated' && permission !== 'background') ||
    typeof initialize !== 'boolean'
  ) {
    throw browserError('invalid-request', 'Workspace provider options are invalid');
  }
  const root = rootDirectoryNode(handle);
  await ensurePermission(handle, permission);
  const initialMetadata = await withWorkspaceLock(root, () =>
    initializeOrLoadWorkspace(root, createId, initialize),
  );
  const providerId = initialMetadata.workspaceId;
  let operationTail: Promise<void> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(async () => {
      await ensurePermission(handle, 'background');
      return withWorkspaceLock(root, async () => {
        await recoverWorkspaceTransaction(root);
        return operation();
      });
    });
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  const capabilities = Object.freeze({
    persistence: 'durable' as const,
    externalChanges: 'manual-refresh' as const,
    create: true,
    update: true,
    duplicate: true,
    delete: true,
    projectGroups: true,
  });

  const documents: GeometryWorkspaceProvider['documents'] = Object.freeze({
    open(request: GeometryDocumentOpenRequest): Promise<GeometryStoredDocument> {
      let id: string;
      let expectedStorageVersion: string;
      try {
        id = captureRequestId(request.id, 'document');
        expectedStorageVersion = captureExpectedStorageVersion(
          request.expectedStorageVersion,
          'document',
        );
      } catch (cause) {
        return Promise.reject(cause);
      }
      return enqueue(async () => {
        const workspace = await loadWorkspace(root);
        if (workspace.metadata.workspaceId !== providerId) {
          throw browserError('workspace-corrupt', 'Workspace identity changed');
        }
        const catalogueDocument = requireLoadedDocument(workspace, id);
        assertVersion(
          catalogueDocument.entry.storageVersion,
          expectedStorageVersion,
          'document',
          id,
        );
        const document = await loadDocument(
          root,
          catalogueDocument.metadata,
          'version-conflict',
        );
        return Object.freeze({
          entry: document.entry,
          contents: document.contents,
        });
      });
    },

    create(
      request: GeometryDocumentCreateRequest,
    ): Promise<GeometryDocumentPersistenceReceipt> {
      let captured: ReturnType<typeof captureCreateRequest>;
      try {
        captured = captureCreateRequest(request);
      } catch (cause) {
        return Promise.reject(cause);
      }
      return enqueue(async () => {
        const workspace = await loadWorkspace(root);
        assertMembershipsExist(workspace, captured.projectGroupIds);
        assertDocumentNameAvailable(workspace, captured.contents.fileName);
        const id = allocateId(createId, 'document', workspace.metadata);
        const prepared = await buildDocumentMetadata(
          id,
          0,
          0,
          currentTimestamp(),
          captured.projectGroupIds,
          captured.contents,
        );
        const next = withDocumentRow(workspace.metadata, prepared.row);
        await commitPreparedMetadata(root, workspace.metadata, next, prepared);
        const committed = await loadWorkspace(root);
        const stored = await loadDocument(
          root,
          requireLoadedDocument(committed, id).metadata,
          'workspace-corrupt',
        );
        return persistenceReceipt(
          committed,
          stored,
          captured.sessionRevision,
        );
      });
    },

    update(
      request: GeometryDocumentUpdateRequest,
    ): Promise<GeometryDocumentPersistenceReceipt> {
      let captured: ReturnType<typeof captureUpdateRequest>;
      try {
        captured = captureUpdateRequest(request);
      } catch (cause) {
        return Promise.reject(cause);
      }
      return enqueue(async () => {
        const workspace = await loadWorkspace(root);
        const catalogueDocument = requireLoadedDocument(workspace, captured.id);
        assertVersion(
          catalogueDocument.entry.storageVersion,
          captured.expectedStorageVersion,
          'document',
          captured.id,
        );
        const current = await loadDocument(
          root,
          catalogueDocument.metadata,
          'version-conflict',
        );
        assertDocumentNameAvailable(
          workspace,
          captured.contents.fileName,
          captured.id,
        );
        const prepared = await buildDocumentMetadata(
          captured.id,
          current.metadata.storageRevision + 1,
          current.metadata.contentRevision + 1,
          currentTimestamp(),
          current.metadata.projectGroupIds,
          captured.contents,
        );
        const next = withDocumentRow(workspace.metadata, prepared.row);
        await commitPreparedMetadata(root, workspace.metadata, next, prepared);
        const committed = await loadWorkspace(root);
        const stored = await loadDocument(
          root,
          requireLoadedDocument(committed, captured.id).metadata,
          'workspace-corrupt',
        );
        return persistenceReceipt(
          committed,
          stored,
          captured.sessionRevision,
        );
      });
    },

    duplicate(
      request: GeometryDocumentDuplicateRequest,
    ): Promise<GeometryDocumentDuplicateReceipt> {
      let captured: ReturnType<typeof captureDuplicateRequest>;
      try {
        captured = captureDuplicateRequest(request);
      } catch (cause) {
        return Promise.reject(cause);
      }
      return enqueue(async () => {
        const workspace = await loadWorkspace(root);
        const catalogueSource = requireLoadedDocument(workspace, captured.sourceId);
        assertVersion(
          catalogueSource.entry.storageVersion,
          captured.expectedStorageVersion,
          'document',
          captured.sourceId,
        );
        const source = await loadDocument(
          root,
          catalogueSource.metadata,
          'version-conflict',
        );
        const sourceContents = captured.contents ?? source.contents;
        const fileName = nextDuplicateGeometryDocumentName(
          sourceContents.fileName,
          workspace.snapshot.documents.map((entry) => entry.fileName),
        );
        const contents = captureGeometryDocumentContents({
          fileName,
          text: sourceContents.text,
          derivedResources: sourceContents.derivedResources,
          sourceFiles: sourceContents.sourceFiles,
        });
        const id = allocateId(createId, 'document', workspace.metadata);
        const prepared = await buildDocumentMetadata(
          id,
          0,
          0,
          currentTimestamp(),
          source.metadata.projectGroupIds,
          contents,
        );
        const next = withDocumentRow(workspace.metadata, prepared.row);
        await commitPreparedMetadata(root, workspace.metadata, next, prepared);
        const committed = await loadWorkspace(root);
        const duplicate = await loadDocument(
          root,
          requireLoadedDocument(committed, id).metadata,
          'workspace-corrupt',
        );
        return Object.freeze({
          entry: duplicate.entry,
          contents: duplicate.contents,
          ...(captured.sessionRevision === undefined
            ? {}
            : { persistedSessionRevision: captured.sessionRevision }),
          snapshot: committed.snapshot,
        });
      });
    },

    delete(
      request: GeometryDocumentDeleteRequest,
    ): Promise<GeometryDocumentDeleteReceipt> {
      let id: string;
      let expectedStorageVersion: string;
      try {
        id = captureRequestId(request.id, 'document');
        expectedStorageVersion = captureExpectedStorageVersion(
          request.expectedStorageVersion,
          'document',
        );
      } catch (cause) {
        return Promise.reject(cause);
      }
      return enqueue(async () => {
        const workspace = await loadWorkspace(root);
        const current = requireLoadedDocument(workspace, id);
        assertVersion(
          current.entry.storageVersion,
          expectedStorageVersion,
          'document',
          id,
        );
        const next = canonicalMetadata({
          ...workspace.metadata,
          catalogueRevision: workspace.metadata.catalogueRevision + 1,
          retiredIds: [...workspace.metadata.retiredIds, id],
          documents: workspace.metadata.documents.filter(
            (document) => document.id !== id,
          ),
        });
        await commitPreparedMetadata(root, workspace.metadata, next);
        const committed = await loadWorkspace(root);
        return Object.freeze({
          deletedDocumentId: id,
          snapshot: committed.snapshot,
        });
      });
    },
  });

  const projectGroups: GeometryWorkspaceProvider['projectGroups'] = Object.freeze({
    create(
      request: GeometryProjectGroupCreateRequest,
    ): Promise<GeometryProjectGroupMutationReceipt> {
      let name: string;
      let description: string;
      try {
        if (typeof request.name !== 'string') {
          throw providerError(
            'invalid-name',
            'Project group name must be a string',
            'project-group',
          );
        }
        name = normalizeGeometryProjectGroupName(request.name);
        description = captureDescription(request.description);
      } catch (cause) {
        return Promise.reject(cause);
      }
      return enqueue(async () => {
        const workspace = await loadWorkspace(root);
        assertProjectNameAvailable(workspace, name);
        const id = allocateId(createId, 'project-group', workspace.metadata);
        const next = withProjectRow(workspace.metadata, {
          id,
          name,
          description,
          storageRevision: 0,
        });
        await commitPreparedMetadata(root, workspace.metadata, next);
        const committed = await loadWorkspace(root);
        return Object.freeze({
          projectGroup: committed.projectGroups.get(id)!,
          snapshot: committed.snapshot,
        });
      });
    },

    update(
      request: GeometryProjectGroupUpdateRequest,
    ): Promise<GeometryProjectGroupMutationReceipt> {
      let id: string;
      let expectedStorageVersion: string;
      let rawName: unknown;
      let rawDescription: unknown;
      try {
        id = captureRequestId(request.id, 'project-group');
        expectedStorageVersion = captureExpectedStorageVersion(
          request.expectedStorageVersion,
          'project-group',
        );
        rawName = request.name;
        rawDescription = request.description;
      } catch (cause) {
        return Promise.reject(cause);
      }
      return enqueue(async () => {
        const workspace = await loadWorkspace(root);
        const current = requireLoadedProject(workspace, id);
        assertVersion(
          current.entry.storageVersion,
          expectedStorageVersion,
          'project-group',
          id,
        );
        if (rawName !== undefined && typeof rawName !== 'string') {
          throw providerError(
            'invalid-name',
            'Project group name must be a string',
            'project-group',
            id,
          );
        }
        const name =
          rawName === undefined
            ? current.metadata.name
            : normalizeGeometryProjectGroupName(rawName);
        const description =
          rawDescription === undefined
            ? current.metadata.description
            : captureDescription(rawDescription);
        assertProjectNameAvailable(workspace, name, id);
        if (
          name === current.metadata.name &&
          description === current.metadata.description
        ) {
          return Object.freeze({
            projectGroup: current.entry,
            snapshot: workspace.snapshot,
          });
        }
        const next = withProjectRow(workspace.metadata, {
          ...current.metadata,
          name,
          description,
          storageRevision: current.metadata.storageRevision + 1,
        });
        await commitPreparedMetadata(root, workspace.metadata, next);
        const committed = await loadWorkspace(root);
        return Object.freeze({
          projectGroup: committed.projectGroups.get(id)!,
          snapshot: committed.snapshot,
        });
      });
    },

    delete(
      request: GeometryProjectGroupDeleteRequest,
    ): Promise<GeometryProjectGroupDeleteReceipt> {
      let id: string;
      let expectedStorageVersion: string;
      try {
        id = captureRequestId(request.id, 'project-group');
        expectedStorageVersion = captureExpectedStorageVersion(
          request.expectedStorageVersion,
          'project-group',
        );
      } catch (cause) {
        return Promise.reject(cause);
      }
      return enqueue(async () => {
        const workspace = await loadWorkspace(root);
        const current = requireLoadedProject(workspace, id);
        assertVersion(
          current.entry.storageVersion,
          expectedStorageVersion,
          'project-group',
          id,
        );
        const documents = workspace.metadata.documents.map((document) =>
          document.projectGroupIds.includes(id)
            ? {
                ...document,
                projectGroupIds: document.projectGroupIds.filter(
                  (projectId) => projectId !== id,
                ),
                storageRevision: document.storageRevision + 1,
              }
            : document,
        );
        const next = canonicalMetadata({
          ...workspace.metadata,
          catalogueRevision: workspace.metadata.catalogueRevision + 1,
          retiredIds: [...workspace.metadata.retiredIds, id],
          documents,
          projectGroups: workspace.metadata.projectGroups.filter(
            (project) => project.id !== id,
          ),
        });
        await commitPreparedMetadata(root, workspace.metadata, next);
        return Object.freeze({
          deletedProjectGroupId: id,
          snapshot: (await loadWorkspace(root)).snapshot,
        });
      });
    },

    setDocumentMembership(
      request: GeometryProjectGroupSetDocumentMembershipRequest,
    ): Promise<GeometryDocumentMembershipReceipt> {
      let documentId: string;
      let expectedStorageVersion: string;
      let memberships: readonly string[];
      try {
        documentId = captureRequestId(request.documentId, 'document');
        expectedStorageVersion = captureExpectedStorageVersion(
          request.expectedStorageVersion,
          'document',
        );
        memberships = captureMemberships(request.projectGroupIds);
      } catch (cause) {
        return Promise.reject(cause);
      }
      return enqueue(async () => {
        const workspace = await loadWorkspace(root);
        const current = requireLoadedDocument(workspace, documentId);
        assertVersion(
          current.entry.storageVersion,
          expectedStorageVersion,
          'document',
          documentId,
        );
        assertMembershipsExist(workspace, memberships);
        const unchanged =
          memberships.length === current.metadata.projectGroupIds.length &&
          memberships.every(
            (projectId, index) =>
              projectId === current.metadata.projectGroupIds[index],
          );
        if (unchanged) {
          return Object.freeze({
            entry: current.entry,
            snapshot: workspace.snapshot,
          });
        }
        const next = withDocumentRow(workspace.metadata, {
          ...current.metadata,
          projectGroupIds: memberships,
          storageRevision: current.metadata.storageRevision + 1,
        });
        await commitPreparedMetadata(root, workspace.metadata, next);
        const committed = await loadWorkspace(root);
        return Object.freeze({
          entry: requireLoadedDocument(committed, documentId).entry,
          snapshot: committed.snapshot,
        });
      });
    },
  });

  const provider: GeometryWorkspaceProvider = Object.freeze({
    id: providerId,
    capabilities,
    getSnapshot: () => enqueue(async () => {
      const workspace = await loadWorkspace(root);
      if (workspace.metadata.workspaceId !== providerId) {
        throw browserError('workspace-corrupt', 'Workspace identity changed');
      }
      return workspace.snapshot;
    }),
    documents,
    projectGroups,
  });

  return Object.freeze({ workspaceId: providerId, provider });
}
