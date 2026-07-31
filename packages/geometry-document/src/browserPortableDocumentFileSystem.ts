// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { normalizeGeometryDocumentName } from './documentNaming';
import {
  decodePortableGeometryDocument,
  encodePortableGeometryDocumentWithMetadata,
} from './portableDocumentCodec';
import {
  PORTABLE_GEOMETRY_DOCUMENT_EXTENSION,
  PORTABLE_GEOMETRY_DOCUMENT_LIMITS,
  PORTABLE_GEOMETRY_DOCUMENT_MIME_TYPE,
  PortableGeometryDocumentError,
  type PortableGeometryDocument,
  type PortableGeometryDocumentEncodeOptions,
} from './portableDocumentContracts';

export type PortableGeometryDocumentFileSystemErrorCode =
  | 'unsupported'
  | 'invalid-selection'
  | 'invalid-binding'
  | 'invalid-request'
  | 'permission-required'
  | 'permission-denied'
  | 'permission-check-failed'
  | 'picker-failed'
  | 'read-failed'
  | 'write-failed'
  | 'operation-in-progress'
  | 'version-conflict'
  | 'document-changed';

export type PortableGeometryDocumentFileSystemErrorDetails = Readonly<{
  fileName?: string;
  cause?: unknown;
}>;

export class PortableGeometryDocumentFileSystemError extends Error {
  readonly code: PortableGeometryDocumentFileSystemErrorCode;
  readonly fileName?: string;
  readonly cause?: unknown;

  constructor(
    code: PortableGeometryDocumentFileSystemErrorCode,
    message: string,
    details: PortableGeometryDocumentFileSystemErrorDetails = {},
  ) {
    super(message);
    this.name = 'PortableGeometryDocumentFileSystemError';
    this.code = code;
    this.fileName = details.fileName;
    this.cause = details.cause;
  }
}

export type PortableGeometryDocumentFileBinding = Readonly<{
  fileName: string;
}>;

export type PortableGeometryDocumentFileSystemCancelled = Readonly<{
  status: 'cancelled';
}>;

export type PortableGeometryDocumentFileSystemOpened = Readonly<{
  status: 'opened';
  binding: PortableGeometryDocumentFileBinding;
  document: PortableGeometryDocument;
}>;

export type PortableGeometryDocumentFileSystemSaved = Readonly<{
  status: 'saved';
  binding: PortableGeometryDocumentFileBinding;
  includedSourceFileIds: readonly string[];
}>;

export type PortableGeometryDocumentFileSystemCapabilities = Readonly<{
  open: boolean;
  saveAs: boolean;
}>;

export type PortableGeometryDocumentFileSystemPermission =
  | 'user-initiated'
  | 'background';

export type PortableGeometryDocumentFileSystemSaveOptions = Readonly<{
  permission: PortableGeometryDocumentFileSystemPermission;
  includeSourceFileIds?: readonly string[];
}>;

export interface PortableGeometryDocumentFileSystem {
  readonly capabilities: PortableGeometryDocumentFileSystemCapabilities;
  open(): Promise<
    | PortableGeometryDocumentFileSystemOpened
    | PortableGeometryDocumentFileSystemCancelled
  >;
  save(
    binding: PortableGeometryDocumentFileBinding,
    document: PortableGeometryDocument,
    options: PortableGeometryDocumentFileSystemSaveOptions,
  ): Promise<PortableGeometryDocumentFileSystemSaved>;
  saveAs(
    document: PortableGeometryDocument,
    options?: PortableGeometryDocumentEncodeOptions,
  ): Promise<
    | PortableGeometryDocumentFileSystemSaved
    | PortableGeometryDocumentFileSystemCancelled
  >;
}

type PickerAcceptType = Readonly<{
  description: string;
  accept: Readonly<Record<string, readonly string[]>>;
}>;

type OpenPickerOptions = Readonly<{
  multiple: false;
  excludeAcceptAllOption: true;
  types: readonly PickerAcceptType[];
}>;

type SavePickerOptions = Readonly<{
  suggestedName: string;
  excludeAcceptAllOption: true;
  types: readonly PickerAcceptType[];
}>;

type OpenPicker = (options: OpenPickerOptions) => Promise<unknown>;
type SavePicker = (options: SavePickerOptions) => Promise<unknown>;

type PermissionDescriptor = Readonly<{ mode: 'read' | 'readwrite' }>;

type CapturedFileHandle = Readonly<{
  target: object;
  fileName: string;
  queryPermission: (
    this: object,
    descriptor: PermissionDescriptor,
  ) => Promise<unknown>;
  requestPermission: (
    this: object,
    descriptor: PermissionDescriptor,
  ) => Promise<unknown>;
  getFile: (this: object) => Promise<unknown>;
  createWritable: (
    this: object,
    options: Readonly<{ keepExistingData: false }>,
  ) => Promise<unknown>;
}>;

type ArchiveFingerprint = Readonly<{
  byteLength: number;
  sha256: string;
}>;

type BindingState = {
  readonly binding: PortableGeometryDocumentFileBinding;
  readonly handle: CapturedFileHandle;
  fingerprint: ArchiveFingerprint;
  operationInProgress: boolean;
};

type WritableSession = Readonly<{
  write: (chunk: Readonly<{
    type: 'write';
    position: 0;
    data: Uint8Array;
  }>) => Promise<unknown>;
  truncate: (size: number) => Promise<unknown>;
  close: () => Promise<unknown>;
  abortOnce: (reason: unknown) => Promise<void>;
}>;

const READ_PERMISSION = Object.freeze({ mode: 'read' } as const);
const READWRITE_PERMISSION = Object.freeze({ mode: 'readwrite' } as const);
const CANCELLED: PortableGeometryDocumentFileSystemCancelled = Object.freeze({
  status: 'cancelled',
});

function pickerTypes(): PickerAcceptType[] {
  return [
    {
      description: 'Vulcan document',
      accept: {
        [PORTABLE_GEOMETRY_DOCUMENT_MIME_TYPE]: [
          PORTABLE_GEOMETRY_DOCUMENT_EXTENSION,
        ],
      },
    },
  ];
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function fileSystemError(
  code: PortableGeometryDocumentFileSystemErrorCode,
  message: string,
  details: PortableGeometryDocumentFileSystemErrorDetails = {},
): PortableGeometryDocumentFileSystemError {
  return new PortableGeometryDocumentFileSystemError(code, message, details);
}

function isNamedError(error: unknown, name: string): boolean {
  return (
    isRecord(error) &&
    typeof error.name === 'string' &&
    error.name === name
  );
}

function isPickerCancellation(error: unknown): boolean {
  return isNamedError(error, 'AbortError');
}

function isPermissionFailure(error: unknown): boolean {
  return isNamedError(error, 'NotAllowedError') || isNamedError(error, 'SecurityError');
}

function capturePicker(
  host: unknown,
  key: 'showOpenFilePicker' | 'showSaveFilePicker',
): OpenPicker | SavePicker | undefined {
  if (!isRecord(host)) return undefined;
  let candidate: unknown;
  try {
    candidate = host[key];
  } catch {
    return undefined;
  }
  if (typeof candidate !== 'function') return undefined;
  return candidate.bind(host) as OpenPicker | SavePicker;
}

function requireSafeVulcanFileName(value: unknown): string {
  if (typeof value !== 'string') {
    throw fileSystemError(
      'invalid-selection',
      'The selected portable document must have a file name',
    );
  }
  let fileName: string;
  try {
    fileName = normalizeGeometryDocumentName(value);
  } catch (cause) {
    throw fileSystemError(
      'invalid-selection',
      'The selected portable document has an unsafe file name',
      { cause },
    );
  }
  if (!fileName.toLowerCase().endsWith(PORTABLE_GEOMETRY_DOCUMENT_EXTENSION)) {
    throw fileSystemError(
      'invalid-selection',
      `Portable documents must use the ${PORTABLE_GEOMETRY_DOCUMENT_EXTENSION} extension`,
      { fileName },
    );
  }
  return fileName;
}

function captureFileHandle(value: unknown): CapturedFileHandle {
  if (!isRecord(value) || value.kind !== 'file') {
    throw fileSystemError(
      'invalid-selection',
      'The file picker must return one file handle',
    );
  }
  const fileName = requireSafeVulcanFileName(value.name);
  const queryPermission = value.queryPermission;
  const requestPermission = value.requestPermission;
  const getFile = value.getFile;
  const createWritable = value.createWritable;
  if (
    typeof queryPermission !== 'function' ||
    typeof requestPermission !== 'function' ||
    typeof getFile !== 'function' ||
    typeof createWritable !== 'function'
  ) {
    throw fileSystemError(
      'invalid-selection',
      'The selected file handle does not support portable document access',
      { fileName },
    );
  }
  return Object.freeze({
    target: value,
    fileName,
    queryPermission,
    requestPermission,
    getFile,
    createWritable,
  }) as CapturedFileHandle;
}

function captureSingleOpenHandle(value: unknown): CapturedFileHandle {
  if (!Array.isArray(value)) {
    throw fileSystemError(
      'invalid-selection',
      'The open picker must return exactly one file handle',
    );
  }
  const handles = Array.from(value);
  if (handles.length !== 1) {
    throw fileSystemError(
      'invalid-selection',
      'Select exactly one portable document',
    );
  }
  return captureFileHandle(handles[0]);
}

function capturePermission(value: unknown): PortableGeometryDocumentFileSystemPermission {
  if (value === 'user-initiated' || value === 'background') return value;
  throw fileSystemError(
    'invalid-request',
    'Portable document save permission mode is required',
  );
}

function snapshotEncodeOptions(
  options: PortableGeometryDocumentEncodeOptions | undefined,
): PortableGeometryDocumentEncodeOptions | undefined {
  if (options === undefined) return undefined;
  if (!isRecord(options)) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      'Portable document encode options must be an object',
    );
  }
  const keys = Object.keys(options);
  if (keys.some((key) => key !== 'includeSourceFileIds')) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      'Portable document encode options may contain only includeSourceFileIds',
    );
  }
  const rawIds = options.includeSourceFileIds;
  if (rawIds === undefined) return Object.freeze({});
  if (!Array.isArray(rawIds)) {
    throw new PortableGeometryDocumentError(
      'invalid-source-selection',
      'includeSourceFileIds must be an array',
    );
  }
  return Object.freeze({
    includeSourceFileIds: Object.freeze(Array.from(rawIds)),
  });
}

function captureSaveOptions(
  options: PortableGeometryDocumentFileSystemSaveOptions,
): Readonly<{
  permission: PortableGeometryDocumentFileSystemPermission;
  encodeOptions: PortableGeometryDocumentEncodeOptions | undefined;
}> {
  if (!isRecord(options)) {
    throw fileSystemError(
      'invalid-request',
      'Portable document save options are required',
    );
  }
  const keys = Object.keys(options);
  if (
    keys.some(
      (key) => key !== 'permission' && key !== 'includeSourceFileIds',
    )
  ) {
    throw fileSystemError(
      'invalid-request',
      'Portable document save options contain an unknown field',
    );
  }
  const permission = capturePermission(options.permission);
  const encodeOptions = snapshotEncodeOptions(
    Object.prototype.hasOwnProperty.call(options, 'includeSourceFileIds')
      ? { includeSourceFileIds: options.includeSourceFileIds }
      : undefined,
  );
  return Object.freeze({ permission, encodeOptions });
}

function captureSuggestedModelFileName(document: PortableGeometryDocument): string {
  if (!isRecord(document)) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      'Portable document must be an object',
    );
  }
  const model = document.model;
  if (!isRecord(model)) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      'Portable document model file name is required',
    );
  }
  const rawFileName = model.fileName;
  if (typeof rawFileName !== 'string') {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      'Portable document model file name is required',
    );
  }
  let fileName: string;
  try {
    fileName = normalizeGeometryDocumentName(rawFileName);
  } catch (cause) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      'Portable document model file name is invalid',
      { cause },
    );
  }
  if (!fileName.toLowerCase().endsWith('.csv')) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      'Portable document model file name must use the .csv extension',
    );
  }
  return fileName;
}

function suggestedBundleFileName(modelFileName: string): string {
  return `${modelFileName.slice(0, -4)}${PORTABLE_GEOMETRY_DOCUMENT_EXTENSION}`;
}

async function ensurePermission(
  handle: CapturedFileHandle,
  descriptor: PermissionDescriptor,
  interaction: PortableGeometryDocumentFileSystemPermission,
): Promise<void> {
  let state: unknown;
  try {
    state = await handle.queryPermission.call(handle.target, descriptor);
  } catch (cause) {
    throw fileSystemError(
      'permission-check-failed',
      `Could not check permission for ${handle.fileName}`,
      { fileName: handle.fileName, cause },
    );
  }
  if (state === 'granted') return;
  if (state === 'denied') {
    throw fileSystemError(
      'permission-denied',
      `Permission was denied for ${handle.fileName}`,
      { fileName: handle.fileName },
    );
  }
  if (state !== 'prompt') {
    throw fileSystemError(
      'permission-check-failed',
      `The browser returned an unknown permission state for ${handle.fileName}`,
      { fileName: handle.fileName },
    );
  }
  if (interaction === 'background') {
    throw fileSystemError(
      'permission-required',
      `User permission is required for ${handle.fileName}`,
      { fileName: handle.fileName },
    );
  }
  let requested: unknown;
  try {
    requested = await handle.requestPermission.call(handle.target, descriptor);
  } catch (cause) {
    throw fileSystemError(
      isPermissionFailure(cause) ? 'permission-denied' : 'permission-check-failed',
      `Could not request permission for ${handle.fileName}`,
      { fileName: handle.fileName, cause },
    );
  }
  if (requested === 'granted') return;
  if (requested === 'prompt') {
    throw fileSystemError(
      'permission-required',
      `User permission is still required for ${handle.fileName}`,
      { fileName: handle.fileName },
    );
  }
  if (requested === 'denied') {
    throw fileSystemError(
      'permission-denied',
      `Permission was denied for ${handle.fileName}`,
      { fileName: handle.fileName },
    );
  }
  throw fileSystemError(
    'permission-check-failed',
    `The browser returned an unknown permission state for ${handle.fileName}`,
    { fileName: handle.fileName },
  );
}

function requireArrayBuffer(value: unknown, fileName: string): ArrayBuffer {
  if (Object.prototype.toString.call(value) !== '[object ArrayBuffer]') {
    throw fileSystemError(
      'read-failed',
      `Could not read portable document bytes from ${fileName}`,
      { fileName },
    );
  }
  return value as ArrayBuffer;
}

async function readArchiveBytes(handle: CapturedFileHandle): Promise<Uint8Array> {
  let file: unknown;
  try {
    file = await handle.getFile.call(handle.target);
  } catch (cause) {
    throw fileSystemError(
      'read-failed',
      `Could not read ${handle.fileName}`,
      { fileName: handle.fileName, cause },
    );
  }
  if (!isRecord(file)) {
    throw fileSystemError(
      'read-failed',
      `The browser returned an invalid file for ${handle.fileName}`,
      { fileName: handle.fileName },
    );
  }
  const declaredSize = file.size;
  const arrayBuffer = file.arrayBuffer;
  if (
    !Number.isSafeInteger(declaredSize) ||
    (declaredSize as number) < 0 ||
    typeof arrayBuffer !== 'function'
  ) {
    throw fileSystemError(
      'read-failed',
      `The browser returned invalid file metadata for ${handle.fileName}`,
      { fileName: handle.fileName },
    );
  }
  if (
    (declaredSize as number) >
    PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumArchiveBytes
  ) {
    throw new PortableGeometryDocumentError(
      'limit-exceeded',
      'Portable ZIP archive exceeds the limit',
    );
  }
  let rawBuffer: unknown;
  try {
    rawBuffer = await arrayBuffer.call(file);
  } catch (cause) {
    throw fileSystemError(
      'read-failed',
      `Could not read portable document bytes from ${handle.fileName}`,
      { fileName: handle.fileName, cause },
    );
  }
  const buffer = requireArrayBuffer(rawBuffer, handle.fileName);
  const bytes = Uint8Array.from(new Uint8Array(buffer));
  if (bytes.byteLength !== declaredSize) {
    throw fileSystemError(
      'read-failed',
      `Portable document size changed while reading ${handle.fileName}`,
      { fileName: handle.fileName },
    );
  }
  if (bytes.byteLength > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumArchiveBytes) {
    throw new PortableGeometryDocumentError(
      'limit-exceeded',
      'Portable ZIP archive exceeds the limit',
    );
  }
  return bytes;
}

async function archiveFingerprint(
  archive: Uint8Array,
): Promise<ArchiveFingerprint> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new PortableGeometryDocumentError(
      'unsupported-feature',
      'SHA-256 Web Crypto support is required for portable documents',
    );
  }
  let digest: ArrayBuffer;
  try {
    const copy = archive.slice();
    digest = await subtle.digest('SHA-256', copy.buffer);
  } catch (cause) {
    throw new PortableGeometryDocumentError(
      'unsupported-feature',
      'Could not calculate the portable archive fingerprint',
      { cause },
    );
  }
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
  return Object.freeze({ byteLength: archive.byteLength, sha256 });
}

function fingerprintsEqual(
  left: ArchiveFingerprint,
  right: ArchiveFingerprint,
): boolean {
  return left.byteLength === right.byteLength && left.sha256 === right.sha256;
}

function versionConflictError(
  handle: CapturedFileHandle,
): PortableGeometryDocumentFileSystemError {
  return fileSystemError(
    'version-conflict',
    `${handle.fileName} changed outside this editor`,
    { fileName: handle.fileName },
  );
}

async function requireUnchangedArchive(
  handle: CapturedFileHandle,
  expectedFingerprint: ArchiveFingerprint,
): Promise<void> {
  const currentArchive = await readArchiveBytes(handle);
  const currentFingerprint = await archiveFingerprint(currentArchive);
  if (!fingerprintsEqual(currentFingerprint, expectedFingerprint)) {
    throw versionConflictError(handle);
  }
}

async function createWritableSession(
  handle: CapturedFileHandle,
): Promise<WritableSession> {
  let stream: unknown;
  try {
    stream = await handle.createWritable.call(handle.target, {
      keepExistingData: false,
    });
  } catch (cause) {
    throw fileSystemError(
      isPermissionFailure(cause) ? 'permission-denied' : 'write-failed',
      `Could not open ${handle.fileName} for writing`,
      { fileName: handle.fileName, cause },
    );
  }
  if (!isRecord(stream)) {
    throw fileSystemError(
      'write-failed',
      `The browser returned an invalid writable stream for ${handle.fileName}`,
      { fileName: handle.fileName },
    );
  }
  const target = stream;
  const writeMethod = stream.write;
  const truncateMethod = stream.truncate;
  const closeMethod = stream.close;
  const abortMethod = stream.abort;
  if (
    typeof writeMethod !== 'function' ||
    typeof truncateMethod !== 'function' ||
    typeof closeMethod !== 'function' ||
    typeof abortMethod !== 'function'
  ) {
    if (typeof abortMethod === 'function') {
      try {
        await abortMethod.call(target, new Error('Invalid writable stream'));
      } catch {
        // Preserve the primary invalid-stream failure.
      }
    }
    throw fileSystemError(
      'write-failed',
      `The browser returned an incomplete writable stream for ${handle.fileName}`,
      { fileName: handle.fileName },
    );
  }
  let aborted = false;
  const abortOnce = async (reason: unknown): Promise<void> => {
    if (aborted) return;
    aborted = true;
    try {
      await abortMethod.call(target, reason);
    } catch {
      // Abort is best effort and must not mask the primary failure.
    }
  };
  return Object.freeze({
    write: (chunk) => writeMethod.call(target, chunk),
    truncate: (size) => truncateMethod.call(target, size),
    close: () => closeMethod.call(target),
    abortOnce,
  });
}

async function writeArchive(
  handle: CapturedFileHandle,
  writable: WritableSession,
  archive: Uint8Array,
): Promise<void> {
  try {
    await writable.write({
      type: 'write',
      position: 0,
      data: archive.slice(),
    });
    await writable.truncate(archive.byteLength);
    await writable.close();
  } catch (cause) {
    await writable.abortOnce(cause);
    throw fileSystemError(
      isPermissionFailure(cause) ? 'permission-denied' : 'write-failed',
      `Could not write ${handle.fileName}`,
      { fileName: handle.fileName, cause },
    );
  }
}

function createSavedResult(
  binding: PortableGeometryDocumentFileBinding,
  includedSourceFileIds: readonly string[],
): PortableGeometryDocumentFileSystemSaved {
  return Object.freeze({
    status: 'saved',
    binding,
    includedSourceFileIds: Object.freeze([...includedSourceFileIds]),
  });
}

export function createBrowserPortableGeometryDocumentFileSystem(
  pickerHost: unknown = globalThis,
): PortableGeometryDocumentFileSystem {
  const openPicker = capturePicker(
    pickerHost,
    'showOpenFilePicker',
  ) as OpenPicker | undefined;
  const savePicker = capturePicker(
    pickerHost,
    'showSaveFilePicker',
  ) as SavePicker | undefined;
  const capabilities = Object.freeze({
    open: openPicker !== undefined,
    saveAs: savePicker !== undefined,
  });
  const bindings = new WeakMap<PortableGeometryDocumentFileBinding, BindingState>();

  const createBinding = (
    handle: CapturedFileHandle,
    fingerprint: ArchiveFingerprint,
  ): BindingState => {
    const binding = Object.freeze({ fileName: handle.fileName });
    const state: BindingState = {
      binding,
      handle,
      fingerprint,
      operationInProgress: false,
    };
    bindings.set(binding, state);
    return state;
  };

  const requireBinding = (
    binding: PortableGeometryDocumentFileBinding,
  ): BindingState => {
    if (!isRecord(binding)) {
      throw fileSystemError(
        'invalid-binding',
        'Portable document file binding is invalid',
      );
    }
    const state = bindings.get(binding);
    if (state === undefined) {
      throw fileSystemError(
        'invalid-binding',
        'Portable document file binding belongs to another session',
      );
    }
    if (state.operationInProgress) {
      throw fileSystemError(
        'operation-in-progress',
        `Another operation is already using ${state.handle.fileName}`,
        { fileName: state.handle.fileName },
      );
    }
    state.operationInProgress = true;
    return state;
  };

  return Object.freeze({
    capabilities,

    async open() {
      if (openPicker === undefined) {
        throw fileSystemError(
          'unsupported',
          'This browser does not support opening portable documents with the File System Access API',
        );
      }
      let picked: unknown;
      try {
        picked = await openPicker({
          multiple: false,
          excludeAcceptAllOption: true,
          types: pickerTypes(),
        });
      } catch (cause) {
        if (isPickerCancellation(cause)) return CANCELLED;
        throw fileSystemError(
          isPermissionFailure(cause) ? 'permission-denied' : 'picker-failed',
          'Could not open the portable document picker',
          { cause },
        );
      }
      const handle = captureSingleOpenHandle(picked);
      await ensurePermission(handle, READ_PERMISSION, 'user-initiated');
      const archive = await readArchiveBytes(handle);
      const [document, fingerprint] = await Promise.all([
        decodePortableGeometryDocument(archive),
        archiveFingerprint(archive),
      ]);
      const state = createBinding(handle, fingerprint);
      return Object.freeze({
        status: 'opened',
        binding: state.binding,
        document,
      });
    },

    async save(
      binding: PortableGeometryDocumentFileBinding,
      document: PortableGeometryDocument,
      rawOptions: PortableGeometryDocumentFileSystemSaveOptions,
    ): Promise<PortableGeometryDocumentFileSystemSaved> {
      const options = captureSaveOptions(rawOptions);
      const state = requireBinding(binding);
      try {
        await ensurePermission(
          state.handle,
          READWRITE_PERMISSION,
          options.permission,
        );
        await requireUnchangedArchive(state.handle, state.fingerprint);
        const writable = await createWritableSession(state.handle);
        let encoded: Awaited<
          ReturnType<typeof encodePortableGeometryDocumentWithMetadata>
        >;
        let fingerprint: ArchiveFingerprint;
        try {
          await requireUnchangedArchive(state.handle, state.fingerprint);
          encoded = await encodePortableGeometryDocumentWithMetadata(
            document,
            options.encodeOptions,
          );
          fingerprint = await archiveFingerprint(encoded.archive);
        } catch (cause) {
          await writable.abortOnce(cause);
          throw cause;
        }
        await writeArchive(state.handle, writable, encoded.archive);
        state.fingerprint = fingerprint;
        return createSavedResult(
          state.binding,
          encoded.includedSourceFileIds,
        );
      } finally {
        state.operationInProgress = false;
      }
    },

    async saveAs(
      document: PortableGeometryDocument,
      rawOptions?: PortableGeometryDocumentEncodeOptions,
    ): Promise<
      | PortableGeometryDocumentFileSystemSaved
      | PortableGeometryDocumentFileSystemCancelled
    > {
      if (savePicker === undefined) {
        throw fileSystemError(
          'unsupported',
          'This browser does not support saving portable documents with the File System Access API',
        );
      }
      const initialModelFileName = captureSuggestedModelFileName(document);
      const encodeOptions = snapshotEncodeOptions(rawOptions);
      let picked: unknown;
      try {
        picked = await savePicker({
          suggestedName: suggestedBundleFileName(initialModelFileName),
          excludeAcceptAllOption: true,
          types: pickerTypes(),
        });
      } catch (cause) {
        if (isPickerCancellation(cause)) return CANCELLED;
        throw fileSystemError(
          isPermissionFailure(cause) ? 'permission-denied' : 'picker-failed',
          'Could not open the portable document save picker',
          { cause },
        );
      }
      const handle = captureFileHandle(picked);
      await ensurePermission(handle, READWRITE_PERMISSION, 'user-initiated');
      const writable = await createWritableSession(handle);
      let encoded: Awaited<
        ReturnType<typeof encodePortableGeometryDocumentWithMetadata>
      >;
      let fingerprint: ArchiveFingerprint;
      try {
        encoded = await encodePortableGeometryDocumentWithMetadata(
          document,
          encodeOptions,
        );
        if (encoded.modelFileName !== initialModelFileName) {
          throw fileSystemError(
            'document-changed',
            'The document name changed while the save picker was open',
            { fileName: handle.fileName },
          );
        }
        fingerprint = await archiveFingerprint(encoded.archive);
      } catch (cause) {
        await writable.abortOnce(cause);
        throw cause;
      }
      await writeArchive(handle, writable, encoded.archive);
      const state = createBinding(handle, fingerprint);
      return createSavedResult(
        state.binding,
        encoded.includedSourceFileIds,
      );
    },
  });
}
