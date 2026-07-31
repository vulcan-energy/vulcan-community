// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserPortableGeometryDocumentFileSystem,
  decodePortableGeometryDocument,
  encodePortableGeometryDocument,
  PORTABLE_GEOMETRY_DOCUMENT_LIMITS,
  PORTABLE_GEOMETRY_DOCUMENT_MIME_TYPE,
  PortableGeometryDocumentFileSystemError,
  type PortableGeometryDocument,
} from '../index';

const textBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const documentFixture = (): PortableGeometryDocument => ({
  model: { fileName: 'House.csv', text: 'Version,v1\n' },
  derivedResources: [
    {
      id: 'overlay',
      slots: ['guide-overlay.image.floor-0'],
      role: 'guide-overlay-image',
      required: true,
      mediaType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    },
  ],
  sourceFiles: [
    {
      id: 'original-ifc',
      slots: ['ifc.source'],
      role: 'ifc',
      fileName: 'House.ifc',
      mediaType: 'model/ifc',
      bytes: textBytes('ORIGINAL_IFC'),
    },
    {
      id: 'original-plan-pdf',
      slots: ['guide-overlay.source.floor-0'],
      role: 'guide-overlay-source',
      fileName: 'Plan.pdf',
      mediaType: 'application/pdf',
      bytes: textBytes('ORIGINAL_PLAN_PDF'),
    },
  ],
});

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function arrayBufferFrom(bytes: Uint8Array): ArrayBuffer {
  const copy = Uint8Array.from(bytes);
  return copy.buffer.slice(
    copy.byteOffset,
    copy.byteOffset + copy.byteLength,
  ) as ArrayBuffer;
}

type MockFileHandleOptions = Readonly<{
  name?: string;
  queryPermission?: PermissionState | readonly PermissionState[];
  requestPermission?: PermissionState;
  createWritableGate?: Promise<void>;
  closeGate?: Promise<void>;
  writeError?: unknown;
  truncateError?: unknown;
  closeError?: unknown;
  abortError?: unknown;
}>;

function createMockFileHandle(
  initialBytes: Uint8Array,
  options: MockFileHandleOptions = {},
) {
  let persistedBytes = Uint8Array.from(initialBytes);
  const permissionStates = Array.isArray(options.queryPermission)
    ? [...options.queryPermission]
    : [options.queryPermission ?? 'granted'];
  let permissionIndex = 0;
  const arrayBuffer = vi.fn(async () => arrayBufferFrom(persistedBytes));
  const getFile = vi.fn(async () => ({
    name: options.name ?? 'House.vulcan',
    size: persistedBytes.byteLength,
    type: PORTABLE_GEOMETRY_DOCUMENT_MIME_TYPE,
    arrayBuffer,
  }) as unknown as File);
  const queryPermission = vi.fn(async () => {
    const state = permissionStates[
      Math.min(permissionIndex, permissionStates.length - 1)
    ]!;
    permissionIndex += 1;
    return state;
  });
  const requestPermission = vi.fn(async () =>
    options.requestPermission ?? 'granted');
  const streams: Array<{
    write: ReturnType<typeof vi.fn>;
    truncate: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  }> = [];
  const createWritable = vi.fn(async (writableOptions: unknown) => {
    await options.createWritableGate;
    let stagedBytes = new Uint8Array();
    const write = vi.fn(async (chunk: {
      type: string;
      position: number;
      data: Uint8Array;
    }) => {
      if (options.writeError !== undefined) throw options.writeError;
      expect(chunk.type).toBe('write');
      expect(chunk.position).toBe(0);
      stagedBytes = Uint8Array.from(chunk.data);
    });
    const truncate = vi.fn(async (size: number) => {
      if (options.truncateError !== undefined) throw options.truncateError;
      stagedBytes = stagedBytes.slice(0, size);
    });
    const close = vi.fn(async () => {
      await options.closeGate;
      if (options.closeError !== undefined) throw options.closeError;
      persistedBytes = Uint8Array.from(stagedBytes);
    });
    const abort = vi.fn(async () => {
      if (options.abortError !== undefined) throw options.abortError;
    });
    streams.push({ write, truncate, close, abort });
    expect(writableOptions).toEqual({ keepExistingData: false });
    return { write, truncate, close, abort };
  });
  let pathReads = 0;
  const handle = {
    kind: 'file',
    name: options.name ?? 'House.vulcan',
    get path() {
      pathReads += 1;
      throw new Error('path must remain private');
    },
    queryPermission,
    requestPermission,
    getFile,
    createWritable,
  };

  return {
    handle,
    queryPermission,
    requestPermission,
    getFile,
    arrayBuffer,
    createWritable,
    streams,
    getBytes: () => Uint8Array.from(persistedBytes),
    replaceBytes: (bytes: Uint8Array) => {
      persistedBytes = Uint8Array.from(bytes);
    },
    getPathReads: () => pathReads,
  };
}

function createPickerHost(options: Readonly<{
  open?: () => Promise<unknown>;
  save?: () => Promise<unknown>;
}> = {}) {
  const showOpenFilePicker = options.open === undefined
    ? undefined
    : vi.fn(options.open);
  const showSaveFilePicker = options.save === undefined
    ? undefined
    : vi.fn(options.save);
  return { showOpenFilePicker, showSaveFilePicker };
}

async function openBinding(
  archive: Uint8Array,
  options: MockFileHandleOptions = {},
) {
  const mock = createMockFileHandle(archive, options);
  const host = createPickerHost({ open: async () => [mock.handle] });
  const fileSystem = createBrowserPortableGeometryDocumentFileSystem(host);
  const opened = await fileSystem.open();
  if (opened.status !== 'opened') throw new Error('Expected opened binding');
  return { fileSystem, opened, mock, host };
}

describe('browser portable-document File System Access adapter', () => {
  it('reports open and save-as support independently without touching a document', () => {
    let pickerReads = 0;
    const host = {
      get showOpenFilePicker() {
        pickerReads += 1;
        return vi.fn();
      },
    };

    const fileSystem = createBrowserPortableGeometryDocumentFileSystem(host);

    expect(fileSystem.capabilities).toEqual({ open: true, saveAs: false });
    expect(Object.isFrozen(fileSystem.capabilities)).toBe(true);
    expect(pickerReads).toBe(1);
  });

  it('fails unsupported operations with a typed error', async () => {
    const fileSystem = createBrowserPortableGeometryDocumentFileSystem({});

    await expect(fileSystem.open()).rejects.toBeInstanceOf(
      PortableGeometryDocumentFileSystemError,
    );
    await expect(fileSystem.open()).rejects.toMatchObject({ code: 'unsupported' });
    await expect(
      fileSystem.saveAs(documentFixture()),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('opens exactly one .vulcan file with strict picker options and no handle leak', async () => {
    const document = documentFixture();
    const archive = await encodePortableGeometryDocument(document);
    const mock = createMockFileHandle(archive);
    const host = createPickerHost({ open: async () => [mock.handle] });
    const fileSystem = createBrowserPortableGeometryDocumentFileSystem(host);

    const result = await fileSystem.open();

    expect(host.showOpenFilePicker).toHaveBeenCalledWith({
      multiple: false,
      excludeAcceptAllOption: true,
      types: [{
        description: 'Vulcan document',
        accept: {
          [PORTABLE_GEOMETRY_DOCUMENT_MIME_TYPE]: ['.vulcan'],
        },
      }],
    });
    expect(result).toMatchObject({
      status: 'opened',
      document: { ...document, sourceFiles: [] },
      binding: { fileName: 'House.vulcan' },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status !== 'opened') throw new Error('Expected opened result');
    expect(Object.isFrozen(result.binding)).toBe(true);
    expect(Reflect.ownKeys(result.binding)).toEqual(['fileName']);
    expect(mock.queryPermission).toHaveBeenCalledWith({ mode: 'read' });
    expect(mock.getPathReads()).toBe(0);
  });

  it('returns cancellation only for an exact picker AbortError', async () => {
    const cancelled = createBrowserPortableGeometryDocumentFileSystem(
      createPickerHost({
        open: async () => {
          throw new DOMException('cancelled', 'AbortError');
        },
      }),
    );
    const failed = createBrowserPortableGeometryDocumentFileSystem(
      createPickerHost({
        open: async () => {
          throw new Error('operation aborted by another failure');
        },
      }),
    );

    const result = await cancelled.open();
    expect(result).toEqual({ status: 'cancelled' });
    expect(Object.isFrozen(result)).toBe(true);
    await expect(failed.open()).rejects.toMatchObject({ code: 'picker-failed' });
  });

  it.each([
    { label: 'zero handles', picked: [], code: 'invalid-selection' },
    {
      label: 'multiple handles',
      picked: [{ kind: 'file' }, { kind: 'file' }],
      code: 'invalid-selection',
    },
    {
      label: 'directory handle',
      picked: [{ kind: 'directory', name: 'workspace.vulcan' }],
      code: 'invalid-selection',
    },
    {
      label: 'wrong extension',
      picked: [{ kind: 'file', name: 'model.csv' }],
      code: 'invalid-selection',
    },
  ])('rejects $label', async ({ picked, code }) => {
    const fileSystem = createBrowserPortableGeometryDocumentFileSystem(
      createPickerHost({ open: async () => picked }),
    );

    await expect(fileSystem.open()).rejects.toMatchObject({ code });
  });

  it('checks the declared archive size before reading file bytes', async () => {
    const arrayBuffer = vi.fn();
    const handle = {
      kind: 'file',
      name: 'Huge.vulcan',
      queryPermission: vi.fn(async () => 'granted'),
      requestPermission: vi.fn(),
      createWritable: vi.fn(),
      getFile: vi.fn(async () => ({
        name: 'Huge.vulcan',
        size: PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumArchiveBytes + 1,
        arrayBuffer,
      })),
    };
    const fileSystem = createBrowserPortableGeometryDocumentFileSystem(
      createPickerHost({ open: async () => [handle] }),
    );

    await expect(fileSystem.open()).rejects.toMatchObject({
      name: 'PortableGeometryDocumentError',
      code: 'limit-exceeded',
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('maps only file-read failures and preserves codec errors', async () => {
    const readFailure = createMockFileHandle(new Uint8Array(), {});
    readFailure.getFile.mockRejectedValueOnce(new DOMException('gone', 'AbortError'));
    const failedFileSystem = createBrowserPortableGeometryDocumentFileSystem(
      createPickerHost({ open: async () => [readFailure.handle] }),
    );
    const invalidArchive = createMockFileHandle(new Uint8Array([1, 2, 3]));
    const invalidFileSystem = createBrowserPortableGeometryDocumentFileSystem(
      createPickerHost({ open: async () => [invalidArchive.handle] }),
    );

    await expect(failedFileSystem.open()).rejects.toMatchObject({
      code: 'read-failed',
    });
    await expect(invalidFileSystem.open()).rejects.toMatchObject({
      name: 'PortableGeometryDocumentError',
      code: 'invalid-archive',
    });
  });

  it('handles prompt, denied, background and rechecked permission states explicitly', async () => {
    const archive = await encodePortableGeometryDocument(documentFixture());
    const prompted = await openBinding(archive, {
      queryPermission: ['prompt', 'prompt'],
      requestPermission: 'granted',
    });
    expect(prompted.mock.requestPermission).toHaveBeenCalledWith({ mode: 'read' });

    await expect(
      prompted.fileSystem.save(
        prompted.opened.binding,
        documentFixture(),
        { permission: 'background' },
      ),
    ).rejects.toMatchObject({ code: 'permission-required' });
    expect(prompted.mock.requestPermission).toHaveBeenCalledTimes(1);

    const denied = createMockFileHandle(archive, { queryPermission: 'denied' });
    const deniedFileSystem = createBrowserPortableGeometryDocumentFileSystem(
      createPickerHost({ open: async () => [denied.handle] }),
    );
    await expect(deniedFileSystem.open()).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(denied.requestPermission).not.toHaveBeenCalled();
  });

  it('fails closed on rejected, unknown, and newly revoked permission states', async () => {
    const archive = await encodePortableGeometryDocument(documentFixture());
    const rejected = createMockFileHandle(archive);
    rejected.queryPermission.mockRejectedValueOnce(new Error('permission API failed'));
    const rejectedFileSystem = createBrowserPortableGeometryDocumentFileSystem(
      createPickerHost({ open: async () => [rejected.handle] }),
    );
    await expect(rejectedFileSystem.open()).rejects.toMatchObject({
      code: 'permission-check-failed',
    });

    const unknown = createMockFileHandle(archive);
    unknown.queryPermission.mockResolvedValueOnce('unknown');
    const unknownFileSystem = createBrowserPortableGeometryDocumentFileSystem(
      createPickerHost({ open: async () => [unknown.handle] }),
    );
    await expect(unknownFileSystem.open()).rejects.toMatchObject({
      code: 'permission-check-failed',
    });

    const revoked = await openBinding(archive, {
      queryPermission: ['granted', 'denied'],
    });
    await expect(
      revoked.fileSystem.save(
        revoked.opened.binding,
        documentFixture(),
        { permission: 'user-initiated' },
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(revoked.mock.queryPermission).toHaveBeenCalledTimes(2);
    expect(revoked.mock.createWritable).not.toHaveBeenCalled();
  });

  it('rejects a changed file-size snapshot after reading', async () => {
    const archive = await encodePortableGeometryDocument(documentFixture());
    const mock = createMockFileHandle(archive);
    mock.getFile.mockResolvedValueOnce({
      name: 'House.vulcan',
      size: archive.byteLength + 1,
      type: 'application/octet-stream',
      arrayBuffer: vi.fn(async () => arrayBufferFrom(archive)),
    } as unknown as File);
    const fileSystem = createBrowserPortableGeometryDocumentFileSystem(
      createPickerHost({ open: async () => [mock.handle] }),
    );

    await expect(fileSystem.open()).rejects.toMatchObject({ code: 'read-failed' });
  });

  it('saves to the opaque existing binding, truncates, and reports success only after close', async () => {
    const original = await encodePortableGeometryDocument(documentFixture());
    const closeGate = deferred<void>();
    const opened = await openBinding(original, { closeGate: closeGate.promise });
    const replacement = documentFixture() as {
      model: { fileName: string; text: string };
    } & PortableGeometryDocument;
    replacement.model = {
      fileName: 'Renamed.csv',
      text: 'Version,v1\nBuildingElement,replacement\n',
    };
    const savePromise = opened.fileSystem.save(
      opened.opened.binding,
      replacement,
      { permission: 'user-initiated' },
    );
    let settled = false;
    void savePromise.then(() => { settled = true; });
    await vi.waitFor(() => {
      expect(opened.mock.streams).toHaveLength(1);
      expect(opened.mock.streams[0]!.close).toHaveBeenCalledTimes(1);
    });
    expect(settled).toBe(false);

    closeGate.resolve();
    const saved = await savePromise;
    expect(saved).toMatchObject({
      status: 'saved',
      binding: opened.opened.binding,
      includedSourceFileIds: [],
    });
    expect(Object.isFrozen(saved)).toBe(true);
    expect(Object.isFrozen(saved.includedSourceFileIds)).toBe(true);
    expect(opened.mock.createWritable).toHaveBeenCalledWith({
      keepExistingData: false,
    });
    const stream = opened.mock.streams[0]!;
    expect(stream.write).toHaveBeenCalledTimes(1);
    expect(stream.truncate).toHaveBeenCalledWith(opened.mock.getBytes().byteLength);
    await expect(decodePortableGeometryDocument(opened.mock.getBytes())).resolves
      .toMatchObject({ model: replacement.model, sourceFiles: [] });
  });

  it('save-as invokes the picker synchronously and defers document/source reads until writable creation', async () => {
    const pickerGate = deferred<unknown>();
    const writableGate = deferred<void>();
    const emptyArchive = await encodePortableGeometryDocument(documentFixture());
    const mock = createMockFileHandle(emptyArchive, {
      createWritableGate: writableGate.promise,
    });
    const host = createPickerHost({ save: () => pickerGate.promise });
    const fileSystem = createBrowserPortableGeometryDocumentFileSystem(host);
    const document = documentFixture() as {
      model: { fileName: string; text: string };
      derivedResources: PortableGeometryDocument['derivedResources'];
      sourceFiles: PortableGeometryDocument['sourceFiles'];
    };
    let sourceReads = 0;
    const selectedSource = document.sourceFiles[0]!;
    Object.defineProperty(selectedSource, 'bytes', {
      enumerable: true,
      get: () => {
        sourceReads += 1;
        return textBytes('POST_PICKER_IFC');
      },
    });
    const includeSourceFileIds = ['original-ifc'];

    const savePromise = fileSystem.saveAs(document, { includeSourceFileIds });
    expect(host.showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(host.showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'House.vulcan',
      excludeAcceptAllOption: true,
      types: [{
        description: 'Vulcan document',
        accept: {
          [PORTABLE_GEOMETRY_DOCUMENT_MIME_TYPE]: ['.vulcan'],
        },
      }],
    });
    expect(sourceReads).toBe(0);
    includeSourceFileIds.push('original-plan-pdf');
    document.model.text = 'Version,v1\nBuildingElement,post-picker\n';

    pickerGate.resolve(mock.handle);
    await vi.waitFor(() => expect(mock.createWritable).toHaveBeenCalledTimes(1));
    expect(sourceReads).toBe(0);
    writableGate.resolve();
    const saved = await savePromise;

    expect(saved.status).toBe('saved');
    expect(sourceReads).toBe(1);
    expect(saved).toMatchObject({ includedSourceFileIds: ['original-ifc'] });
    const decoded = await decodePortableGeometryDocument(mock.getBytes());
    expect(decoded.model.text).toContain('post-picker');
    expect(decoded.sourceFiles.map((source) => source.id)).toEqual(['original-ifc']);
  });

  it('never accesses sourceFiles for a default save', async () => {
    const original = await encodePortableGeometryDocument(documentFixture());
    const opened = await openBinding(original);
    const document = documentFixture();
    Object.defineProperty(document, 'sourceFiles', {
      enumerable: true,
      get: () => {
        throw new Error('default save must not inspect sources');
      },
    });

    await expect(
      opened.fileSystem.save(
        opened.opened.binding,
        document,
        { permission: 'user-initiated' },
      ),
    ).resolves.toMatchObject({
      status: 'saved',
      includedSourceFileIds: [],
    });
  });

  it('save-as cancellation, denial, and writable failure read no source bytes', async () => {
    const scenarios = [
      {
        host: createPickerHost({
          save: async () => { throw new DOMException('cancelled', 'AbortError'); },
        }),
        expected: 'cancelled',
      },
      {
        host: createPickerHost({
          save: async () => createMockFileHandle(new Uint8Array(), {
            queryPermission: 'denied',
          }).handle,
        }),
        expected: 'permission-denied',
      },
      {
        host: createPickerHost({
          save: async () => {
            const mock = createMockFileHandle(new Uint8Array());
            mock.handle.createWritable = vi.fn(async () => {
              throw new Error('cannot create');
            });
            return mock.handle;
          },
        }),
        expected: 'write-failed',
      },
    ] as const;

    for (const scenario of scenarios) {
      const document = documentFixture();
      let sourceReads = 0;
      Object.defineProperty(document.sourceFiles[0]!, 'bytes', {
        enumerable: true,
        get: () => {
          sourceReads += 1;
          return textBytes('private');
        },
      });
      const fileSystem = createBrowserPortableGeometryDocumentFileSystem(
        scenario.host,
      );
      const promise = fileSystem.saveAs(document, {
        includeSourceFileIds: ['original-ifc'],
      });
      if (scenario.expected === 'cancelled') {
        await expect(promise).resolves.toEqual({ status: 'cancelled' });
      } else {
        await expect(promise).rejects.toMatchObject({ code: scenario.expected });
      }
      expect(sourceReads).toBe(0);
    }
  });

  it('aborts on encode/name/write/truncate/close failures without masking the primary error', async () => {
    const original = await encodePortableGeometryDocument(documentFixture());

    const renamed = createMockFileHandle(original);
    const pickerGate = deferred<unknown>();
    const renamedFileSystem = createBrowserPortableGeometryDocumentFileSystem(
      createPickerHost({ save: () => pickerGate.promise }),
    );
    const changed = documentFixture() as {
      model: { fileName: string; text: string };
    } & PortableGeometryDocument;
    const renamedPromise = renamedFileSystem.saveAs(changed);
    changed.model.fileName = 'Other.csv';
    pickerGate.resolve(renamed.handle);
    await expect(renamedPromise).rejects.toMatchObject({ code: 'document-changed' });
    expect(renamed.streams[0]!.abort).toHaveBeenCalledTimes(1);
    expect(renamed.streams[0]!.write).not.toHaveBeenCalled();

    for (const [stage, options] of [
      ['write', { writeError: new DOMException('write abort', 'AbortError') }],
      ['truncate', { truncateError: new Error('truncate failed') }],
      ['close', { closeError: new Error('close failed'), abortError: new Error('abort failed') }],
    ] as const) {
      const opened = await openBinding(original, options);
      const promise = opened.fileSystem.save(
        opened.opened.binding,
        documentFixture(),
        { permission: 'user-initiated' },
      );
      await expect(promise).rejects.toMatchObject({
        code: 'write-failed',
        cause: options[`${stage}Error` as keyof typeof options],
      });
      const stream = opened.mock.streams[0]!;
      expect(stream.abort).toHaveBeenCalledTimes(1);
      if (stage !== 'close') expect(stream.close).not.toHaveBeenCalled();
    }
  });

  it('fails a same-binding concurrent operation and detects external replacement before writing', async () => {
    const original = await encodePortableGeometryDocument(documentFixture());
    const writableGate = deferred<void>();
    const opened = await openBinding(original, {
      createWritableGate: writableGate.promise,
    });

    const first = opened.fileSystem.save(
      opened.opened.binding,
      documentFixture(),
      { permission: 'user-initiated' },
    );
    await expect(
      opened.fileSystem.save(
        opened.opened.binding,
        documentFixture(),
        { permission: 'user-initiated' },
      ),
    ).rejects.toMatchObject({ code: 'operation-in-progress' });
    writableGate.resolve();
    await first;

    const externallyChanged = await encodePortableGeometryDocument({
      ...documentFixture(),
      model: { fileName: 'House.csv', text: 'Version,v1\nexternal,change\n' },
    });
    opened.mock.replaceBytes(externallyChanged);
    const createCalls = opened.mock.handle.createWritable.mock.calls.length;
    await expect(
      opened.fileSystem.save(
        opened.opened.binding,
        documentFixture(),
        { permission: 'user-initiated' },
      ),
    ).rejects.toMatchObject({ code: 'version-conflict' });
    expect(opened.mock.handle.createWritable).toHaveBeenCalledTimes(createCalls);
  });

  it('detects external replacement while acquiring the writable', async () => {
    const original = await encodePortableGeometryDocument(documentFixture());
    const external = await encodePortableGeometryDocument({
      ...documentFixture(),
      model: { fileName: 'House.csv', text: 'Version,v1\nexternal,change\n' },
    });
    const writableGate = deferred<void>();
    const opened = await openBinding(original, {
      createWritableGate: writableGate.promise,
    });

    const savePromise = opened.fileSystem.save(
      opened.opened.binding,
      documentFixture(),
      { permission: 'user-initiated' },
    );

    await vi.waitFor(() =>
      expect(opened.mock.createWritable).toHaveBeenCalledTimes(1));
    opened.mock.replaceBytes(external);
    writableGate.resolve();

    await expect(savePromise).rejects.toMatchObject({
      code: 'version-conflict',
    });
    expect(opened.mock.streams[0]!.abort).toHaveBeenCalledTimes(1);
    expect(opened.mock.streams[0]!.write).not.toHaveBeenCalled();
    expect(opened.mock.getBytes()).toEqual(external);
  });

  it('rejects a forged or cross-adapter binding without reading its properties', async () => {
    const archive = await encodePortableGeometryDocument(documentFixture());
    const opened = await openBinding(archive);
    let fileNameReads = 0;
    const forged = Object.defineProperty({}, 'fileName', {
      get: () => {
        fileNameReads += 1;
        throw new Error('opaque binding properties must not be trusted');
      },
    });

    await expect(
      opened.fileSystem.save(
        forged as { fileName: string },
        documentFixture(),
        { permission: 'user-initiated' },
      ),
    ).rejects.toMatchObject({ code: 'invalid-binding' });
    expect(fileNameReads).toBe(0);

    const secondAdapter = createBrowserPortableGeometryDocumentFileSystem({});
    await expect(
      secondAdapter.save(
        opened.opened.binding,
        documentFixture(),
        { permission: 'user-initiated' },
      ),
    ).rejects.toMatchObject({ code: 'invalid-binding' });
  });

  it('keeps private workspace, directory, persistence and network concepts out of the source', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../browserPortableDocumentFileSystem.ts'),
      'utf8',
    );

    for (const forbidden of [
      '@repo/core',
      'workspaceStore',
      'fileService',
      'showDirectoryPicker',
      'FileSystemDirectoryHandle',
      'indexedDB',
      'localStorage',
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      'sendBeacon',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
