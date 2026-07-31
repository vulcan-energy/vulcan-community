// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createLocalIfcImportAdapter,
  decodePortableGeometryDocument,
  encodePortableGeometryDocument,
  IFC_IMPORT_LIMITS,
  IfcImportError,
  type IfcImportConverter,
  type IfcImportConverterResult,
  type IfcImportRequest,
  type IfcImportSource,
} from '../index';

const textBytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const bytesText = (value: Uint8Array): string => new TextDecoder().decode(value);

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

function sourceFixture(
  overrides: Partial<IfcImportSource> = {},
): IfcImportSource & Readonly<{ readBytes: ReturnType<typeof vi.fn> }> {
  const bytes = textBytes('ISO-10303-21;\nLOCAL_IFC_MODEL_BYTES\nEND-ISO-10303-21;');
  return {
    fileName: 'House.ifc',
    byteLength: bytes.byteLength,
    readBytes: vi.fn(async () => Uint8Array.from(bytes)),
    ...overrides,
  };
}

function converterFixture(
  convert?: IfcImportConverter['convert'],
): IfcImportConverter & Readonly<{ convert: ReturnType<typeof vi.fn> }> {
  return {
    convert: vi.fn(
      convert ??
        (async () => ({
          modelCsv: 'Version,v1\nBuildingElementOpaque,wall-1\n',
          auditJsonl: '{"event":"converted"}\n',
        })),
    ),
  };
}

function requestFixture(
  source: IfcImportSource = sourceFixture(),
  overrides: Partial<IfcImportRequest> = {},
): IfcImportRequest {
  return {
    source,
    mode: 'internal',
    delayeringEnabled: true,
    ...overrides,
  };
}

describe('local IFC import adapter', () => {
  it('is side-effect free until an explicit import and then loads before reading or converting', async () => {
    const order: string[] = [];
    const source = sourceFixture({
      readBytes: vi.fn(async () => {
        order.push('read');
        return textBytes('IFC');
      }),
      byteLength: 3,
    });
    const converter = converterFixture(async () => {
      order.push('convert');
      return {
        modelCsv: 'Version,v1\n',
        auditJsonl: '{"event":"converted"}\n',
      };
    });
    const loadConverter = vi.fn(async () => {
      order.push('load');
      return converter;
    });

    const adapter = createLocalIfcImportAdapter({ loadConverter });
    expect(loadConverter).not.toHaveBeenCalled();
    expect(source.readBytes).not.toHaveBeenCalled();

    await adapter.importDocument(requestFixture(source));

    expect(order).toEqual(['load', 'read', 'convert']);
    expect(loadConverter).toHaveBeenCalledTimes(1);
    expect(source.readBytes).toHaveBeenCalledTimes(1);
  });

  it('returns model CSV, IFC audit and original IFC through the public resource contract', async () => {
    const source = sourceFixture({ fileName: '  My House.IFC  ' });
    const converter = converterFixture();
    const adapter = createLocalIfcImportAdapter({
      loadConverter: async () => converter,
    });

    const document = await adapter.importDocument(requestFixture(source));

    expect(document.model).toEqual({
      fileName: 'My House.csv',
      text: 'Version,v1\nBuildingElementOpaque,wall-1\n',
    });
    expect(document.derivedResources).toHaveLength(1);
    expect(document.derivedResources[0]).toMatchObject({
      id: 'ifc-import-audit',
      slots: ['ifc.audit'],
      role: 'ifc-import-audit',
      required: false,
      mediaType: 'application/x-ndjson',
    });
    expect(bytesText(document.derivedResources[0]!.bytes)).toBe(
      '{"event":"converted"}\n',
    );
    expect(document.sourceFiles).toHaveLength(1);
    expect(document.sourceFiles[0]).toMatchObject({
      id: 'original-ifc',
      slots: ['ifc.source'],
      role: 'ifc',
      fileName: 'My House.IFC',
      mediaType: 'model/ifc',
    });
    expect(bytesText(document.sourceFiles[0]!.bytes)).toContain(
      'LOCAL_IFC_MODEL_BYTES',
    );
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.model)).toBe(true);
    expect(Object.isFrozen(document.derivedResources)).toBe(true);
    expect(Object.isFrozen(document.sourceFiles)).toBe(true);

    document.derivedResources[0]!.bytes[0] = 0;
    document.sourceFiles[0]!.bytes[0] = 0;
    expect(bytesText(document.derivedResources[0]!.bytes)).toBe(
      '{"event":"converted"}\n',
    );
    expect(bytesText(document.sourceFiles[0]!.bytes)).toContain(
      'LOCAL_IFC_MODEL_BYTES',
    );
  });

  it('keeps original IFC out of default bundles and includes it only by explicit source id', async () => {
    const adapter = createLocalIfcImportAdapter({
      loadConverter: async () => converterFixture(),
    });
    const document = await adapter.importDocument(requestFixture());

    const defaultArchive = await encodePortableGeometryDocument(document);
    expect(bytesText(defaultArchive)).not.toContain('LOCAL_IFC_MODEL_BYTES');
    const defaultDecoded = await decodePortableGeometryDocument(defaultArchive);
    expect(defaultDecoded.sourceFiles).toEqual([]);

    const explicitArchive = await encodePortableGeometryDocument(document, {
      includeSourceFileIds: ['original-ifc'],
    });
    const explicitDecoded = await decodePortableGeometryDocument(explicitArchive);
    expect(explicitDecoded.sourceFiles.map((source) => source.id)).toEqual([
      'original-ifc',
    ]);
    expect(bytesText(explicitDecoded.sourceFiles[0]!.bytes)).toContain(
      'LOCAL_IFC_MODEL_BYTES',
    );
  });

  it('passes a private byte copy and exact conversion options to the local converter', async () => {
    const original = new Uint8Array([1, 2, 3]);
    const source = sourceFixture({
      byteLength: original.byteLength,
      readBytes: vi.fn(async () => original),
    });
    const signal = new AbortController().signal;
    const progress = vi.fn();
    const converter = converterFixture(async (request) => {
      expect(request).toMatchObject({
        mode: 'external',
        delayeringEnabled: false,
        wallThicknessMetres: 0.25,
        signal,
      });
      expect(request.onProgress).toEqual(expect.any(Function));
      request.onProgress({ phase: 'walls', current: 2, total: 5 });
      request.bytes[0] = 99;
      return {
        modelCsv: 'Version,v1\n',
        auditJsonl: '{"event":"converted"}\n',
      };
    });
    const adapter = createLocalIfcImportAdapter({
      loadConverter: async () => converter,
    });

    const document = await adapter.importDocument(
      requestFixture(source, {
        mode: 'external',
        delayeringEnabled: false,
        wallThicknessMetres: 0.25,
        signal,
        onProgress: progress,
      }),
    );

    expect(converter.convert).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(
      Object.freeze({ phase: 'walls', current: 2, total: 5 }),
    );
    expect(document.sourceFiles[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(original).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('validates mode-specific options before loading the converter or reading source bytes', async () => {
    const source = sourceFixture();
    const loadConverter = vi.fn(async () => converterFixture());
    const adapter = createLocalIfcImportAdapter({ loadConverter });

    for (const request of [
      requestFixture(source, { mode: 'external', wallThicknessMetres: undefined }),
      requestFixture(source, { mode: 'external', wallThicknessMetres: 0 }),
      requestFixture(source, { mode: 'external', wallThicknessMetres: 10.01 }),
      requestFixture(source, { mode: 'internal', wallThicknessMetres: 0.2 }),
      requestFixture(source, { mode: 'raw', wallThicknessMetres: 0.2 }),
      requestFixture(source, { mode: 'other' as 'internal' }),
      requestFixture(source, { delayeringEnabled: 'yes' as unknown as boolean }),
    ]) {
      await expect(adapter.importDocument(request)).rejects.toBeInstanceOf(
        IfcImportError,
      );
    }

    expect(loadConverter).not.toHaveBeenCalled();
    expect(source.readBytes).not.toHaveBeenCalled();
  });

  it('rejects unsafe, extensionless and non-IFC names before loading or reading', async () => {
    const loadConverter = vi.fn(async () => converterFixture());
    const adapter = createLocalIfcImportAdapter({ loadConverter });

    for (const fileName of [
      '../House.ifc',
      'House',
      '.ifc',
      'House.csv',
      'House.ifc\u0000.txt',
    ]) {
      const source = sourceFixture({ fileName });
      await expect(
        adapter.importDocument(requestFixture(source)),
      ).rejects.toMatchObject({ code: 'invalid-source' });
      expect(source.readBytes).not.toHaveBeenCalled();
    }

    expect(loadConverter).not.toHaveBeenCalled();
  });

  it('enforces declared and actual source limits and exact byte length', async () => {
    const loadConverter = vi.fn(async () => converterFixture());
    const adapter = createLocalIfcImportAdapter({ loadConverter });

    const oversized = sourceFixture({
      byteLength: IFC_IMPORT_LIMITS.maximumSourceBytes + 1,
    });
    await expect(
      adapter.importDocument(requestFixture(oversized)),
    ).rejects.toMatchObject({ code: 'limit-exceeded' });
    expect(loadConverter).not.toHaveBeenCalled();
    expect(oversized.readBytes).not.toHaveBeenCalled();

    for (const byteLength of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const malformed = sourceFixture({ byteLength });
      await expect(
        adapter.importDocument(requestFixture(malformed)),
      ).rejects.toMatchObject({ code: 'invalid-source' });
      expect(malformed.readBytes).not.toHaveBeenCalled();
    }

    const changed = sourceFixture({
      byteLength: 4,
      readBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
    });
    await expect(
      adapter.importDocument(requestFixture(changed)),
    ).rejects.toMatchObject({ code: 'read-failed' });

    const invalid = sourceFixture({
      byteLength: 3,
      readBytes: vi.fn(async () => new ArrayBuffer(3) as unknown as Uint8Array),
    });
    await expect(
      adapter.importDocument(requestFixture(invalid)),
    ).rejects.toMatchObject({ code: 'read-failed' });

    const spoofed = sourceFixture({
      byteLength: 3,
      readBytes: vi.fn(async () => ({
        0: 1,
        1: 2,
        2: 3,
        length: 3,
        [Symbol.toStringTag]: 'Uint8Array',
      }) as unknown as Uint8Array),
    });
    await expect(
      adapter.importDocument(requestFixture(spoofed)),
    ).rejects.toMatchObject({ code: 'read-failed' });

    const detachedBytes = new Uint8Array([1, 2, 3]);
    structuredClone(detachedBytes.buffer, {
      transfer: [detachedBytes.buffer],
    });
    const detached = sourceFixture({
      byteLength: 3,
      readBytes: vi.fn(async () => detachedBytes),
    });
    await expect(
      adapter.importDocument(requestFixture(detached)),
    ).rejects.toMatchObject({ code: 'read-failed' });

    let oversizedCloneAttempts = 0;
    class OversizedIfcBytes extends Uint8Array {
      override [Symbol.iterator](): Uint8ArrayIterator<number> {
        oversizedCloneAttempts += 1;
        throw new Error('oversized source must not be cloned');
      }
    }
    const actualOversizedBytes = new OversizedIfcBytes(
      IFC_IMPORT_LIMITS.maximumSourceBytes + 1,
    );
    const actualOversized = sourceFixture({
      byteLength: IFC_IMPORT_LIMITS.maximumSourceBytes,
      readBytes: vi.fn(async () => actualOversizedBytes),
    });
    await expect(
      adapter.importDocument(requestFixture(actualOversized)),
    ).rejects.toMatchObject({ code: 'limit-exceeded' });
    expect(oversizedCloneAttempts).toBe(0);
  });

  it('does not read model bytes when lazy runtime loading fails and permits an explicit retry', async () => {
    const source = sourceFixture();
    const converter = converterFixture();
    const loadConverter = vi
      .fn<() => Promise<IfcImportConverter>>()
      .mockRejectedValueOnce(new Error('runtime unavailable'))
      .mockResolvedValueOnce(converter);
    const adapter = createLocalIfcImportAdapter({ loadConverter });

    await expect(
      adapter.importDocument(requestFixture(source)),
    ).rejects.toMatchObject({ code: 'runtime-load-failed' });
    expect(source.readBytes).not.toHaveBeenCalled();

    await adapter.importDocument(requestFixture(source));
    expect(loadConverter).toHaveBeenCalledTimes(2);
    expect(source.readBytes).toHaveBeenCalledTimes(1);
  });

  it('shares one successful lazy runtime load across concurrent and later imports', async () => {
    const loadGate = deferred<IfcImportConverter>();
    const converter = converterFixture();
    const loadConverter = vi.fn(() => loadGate.promise);
    const adapter = createLocalIfcImportAdapter({ loadConverter });
    const firstSource = sourceFixture({ fileName: 'First.ifc' });
    const secondSource = sourceFixture({ fileName: 'Second.ifc' });

    const first = adapter.importDocument(requestFixture(firstSource));
    const second = adapter.importDocument(requestFixture(secondSource));
    expect(loadConverter).toHaveBeenCalledTimes(1);
    expect(firstSource.readBytes).not.toHaveBeenCalled();
    expect(secondSource.readBytes).not.toHaveBeenCalled();

    loadGate.resolve(converter);
    await Promise.all([first, second]);
    await adapter.importDocument(requestFixture(sourceFixture({ fileName: 'Third.ifc' })));

    expect(loadConverter).toHaveBeenCalledTimes(1);
    expect(converter.convert).toHaveBeenCalledTimes(3);
  });

  it('serializes source reads and conversions for a non-reentrant local runtime', async () => {
    const firstConversion = deferred<{
      modelCsv: string;
      auditJsonl: string;
    }>();
    let conversionCount = 0;
    const converter = converterFixture(async () => {
      conversionCount += 1;
      if (conversionCount === 1) return firstConversion.promise;
      return {
        modelCsv: 'Version,v1\nsecond,model\n',
        auditJsonl: '{"event":"second"}\n',
      };
    });
    const adapter = createLocalIfcImportAdapter({
      loadConverter: async () => converter,
    });
    const firstSource = sourceFixture({ fileName: 'First.ifc' });
    const secondSource = sourceFixture({ fileName: 'Second.ifc' });

    const first = adapter.importDocument(requestFixture(firstSource));
    await vi.waitFor(() => expect(converter.convert).toHaveBeenCalledTimes(1));
    const second = adapter.importDocument(requestFixture(secondSource));
    await Promise.resolve();

    expect(secondSource.readBytes).not.toHaveBeenCalled();
    expect(converter.convert).toHaveBeenCalledTimes(1);

    firstConversion.resolve({
      modelCsv: 'Version,v1\nfirst,model\n',
      auditJsonl: '{"event":"first"}\n',
    });
    await first;
    await second;

    expect(secondSource.readBytes).toHaveBeenCalledTimes(1);
    expect(converter.convert).toHaveBeenCalledTimes(2);
  });

  it('advances the serial tail after source-read and conversion failures', async () => {
    const readConverter = converterFixture();
    const readAdapter = createLocalIfcImportAdapter({
      loadConverter: async () => readConverter,
    });
    const readCause = new Error('read failed');
    await expect(
      readAdapter.importDocument(
        requestFixture(
          sourceFixture({
            readBytes: vi.fn(async () => {
              throw readCause;
            }),
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'read-failed', cause: readCause });
    await readAdapter.importDocument(
      requestFixture(sourceFixture({ fileName: 'After Read Failure.ifc' })),
    );
    expect(readConverter.convert).toHaveBeenCalledTimes(1);

    let conversionCount = 0;
    const conversionCause = new Error('conversion failed');
    const conversionConverter = converterFixture(async () => {
      conversionCount += 1;
      if (conversionCount === 1) throw conversionCause;
      return {
        modelCsv: 'Version,v1\nrecovered,model\n',
        auditJsonl: '{"event":"recovered"}\n',
      };
    });
    const conversionAdapter = createLocalIfcImportAdapter({
      loadConverter: async () => conversionConverter,
    });
    await expect(
      conversionAdapter.importDocument(requestFixture()),
    ).rejects.toMatchObject({
      code: 'conversion-failed',
      cause: conversionCause,
    });
    const recovered = await conversionAdapter.importDocument(
      requestFixture(sourceFixture({ fileName: 'After Conversion Failure.ifc' })),
    );
    expect(recovered.model.text).toContain('recovered,model');
    expect(conversionConverter.convert).toHaveBeenCalledTimes(2);
  });

  it('captures request and source fields exactly once before the first await', async () => {
    const reads = new Map<string, number>();
    const count = <T>(key: string, value: T): T => {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      return value;
    };
    const bytes = textBytes('IFC');
    const readBytes = vi.fn(async () => Uint8Array.from(bytes));
    const source = {
      get fileName() {
        return count('fileName', 'Snapshot.ifc');
      },
      get byteLength() {
        return count('byteLength', bytes.byteLength);
      },
      get readBytes() {
        return count('readBytes', readBytes);
      },
    };
    const request = {
      get source() {
        return count('source', source);
      },
      get mode() {
        return count('mode', 'internal' as const);
      },
      get delayeringEnabled() {
        return count('delayeringEnabled', true);
      },
    };
    const adapter = createLocalIfcImportAdapter({
      loadConverter: async () => converterFixture(),
    });

    await adapter.importDocument(request);

    expect(Object.fromEntries(reads)).toEqual({
      source: 1,
      mode: 1,
      delayeringEnabled: 1,
      fileName: 1,
      byteLength: 1,
      readBytes: 1,
    });
    expect(readBytes).toHaveBeenCalledTimes(1);
  });

  it('maps hostile request, source and signal accessors to typed validation errors', async () => {
    const adapter = createLocalIfcImportAdapter({
      loadConverter: async () => converterFixture(),
    });

    const requestCause = new Error('request source accessor failed');
    const hostileRequest = Object.defineProperty(
      { mode: 'internal', delayeringEnabled: true },
      'source',
      {
        get() {
          throw requestCause;
        },
      },
    ) as IfcImportRequest;
    await expect(adapter.importDocument(hostileRequest)).rejects.toMatchObject({
      code: 'invalid-request',
      cause: requestCause,
    });

    const sourceCause = new Error('source file name accessor failed');
    const hostileSource = Object.defineProperty(
      {
        byteLength: 3,
        readBytes: vi.fn(async () => textBytes('IFC')),
      },
      'fileName',
      {
        get() {
          throw sourceCause;
        },
      },
    ) as IfcImportSource;
    await expect(
      adapter.importDocument(requestFixture(hostileSource)),
    ).rejects.toMatchObject({
      code: 'invalid-source',
      cause: sourceCause,
    });

    const signalCause = new Error('signal accessor failed');
    const hostileSignal = Object.defineProperty(
      {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      'aborted',
      {
        get() {
          throw signalCause;
        },
      },
    ) as unknown as AbortSignal;
    await expect(
      adapter.importDocument(
        requestFixture(sourceFixture(), { signal: hostileSignal }),
      ),
    ).rejects.toMatchObject({
      code: 'invalid-request',
      cause: signalCause,
    });
  });

  it('captures signal listener methods once and maps listener failures without hanging', async () => {
    let addAccessorReads = 0;
    let removeAccessorReads = 0;
    const capturedSignal = {
      aborted: false,
      get addEventListener() {
        addAccessorReads += 1;
        if (addAccessorReads > 1) throw new Error('changed add accessor');
        return vi.fn();
      },
      get removeEventListener() {
        removeAccessorReads += 1;
        if (removeAccessorReads > 1) throw new Error('changed remove accessor');
        return vi.fn();
      },
    } as unknown as AbortSignal;
    const capturedAdapter = createLocalIfcImportAdapter({
      loadConverter: async () => converterFixture(),
    });

    await capturedAdapter.importDocument(
      requestFixture(sourceFixture(), { signal: capturedSignal }),
    );
    expect(addAccessorReads).toBe(1);
    expect(removeAccessorReads).toBe(1);

    const addCause = new Error('add listener failed');
    const invalidAddSignal = {
      aborted: false,
      addEventListener() {
        throw addCause;
      },
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const addAdapter = createLocalIfcImportAdapter({
      loadConverter: async () => converterFixture(),
    });
    await expect(
      addAdapter.importDocument(
        requestFixture(sourceFixture(), { signal: invalidAddSignal }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-request', cause: addCause });

    const removeCause = new Error('remove listener failed');
    const invalidRemoveSignal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener() {
        throw removeCause;
      },
    } as unknown as AbortSignal;
    const removeAdapter = createLocalIfcImportAdapter({
      loadConverter: async () => converterFixture(),
    });
    const removeOutcome = await Promise.race([
      removeAdapter
        .importDocument(
          requestFixture(sourceFixture(), { signal: invalidRemoveSignal }),
        )
        .then(
          () => 'resolved' as const,
          (error: unknown) => error,
        ),
      new Promise<'timeout'>((resolveTimeout) => {
        setTimeout(() => resolveTimeout('timeout'), 100);
      }),
    ]);
    expect(removeOutcome).toMatchObject({
      code: 'invalid-request',
      cause: removeCause,
    });
  });

  it('stops before the next stage when a progress callback cancels the import', async () => {
    const runtimeController = new AbortController();
    const runtimeLoad = vi.fn(async () => converterFixture());
    const runtimeAdapter = createLocalIfcImportAdapter({
      loadConverter: runtimeLoad,
    });
    await expect(
      runtimeAdapter.importDocument(
        requestFixture(sourceFixture(), {
          signal: runtimeController.signal,
          onProgress: ({ phase }) => {
            if (phase === 'runtime') runtimeController.abort();
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(runtimeLoad).not.toHaveBeenCalled();

    const sourceReadController = new AbortController();
    const sourceReadSource = sourceFixture();
    const sourceReadConverter = converterFixture();
    const sourceReadAdapter = createLocalIfcImportAdapter({
      loadConverter: async () => sourceReadConverter,
    });
    await expect(
      sourceReadAdapter.importDocument(
        requestFixture(sourceReadSource, {
          signal: sourceReadController.signal,
          onProgress: ({ phase }) => {
            if (phase === 'source-read') sourceReadController.abort();
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(sourceReadSource.readBytes).not.toHaveBeenCalled();
    expect(sourceReadConverter.convert).not.toHaveBeenCalled();

    const conversionController = new AbortController();
    const conversionSource = sourceFixture();
    const conversionConverter = converterFixture();
    const conversionAdapter = createLocalIfcImportAdapter({
      loadConverter: async () => conversionConverter,
    });
    await expect(
      conversionAdapter.importDocument(
        requestFixture(conversionSource, {
          signal: conversionController.signal,
          onProgress: ({ phase }) => {
            if (phase === 'conversion') conversionController.abort();
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(conversionSource.readBytes).toHaveBeenCalledTimes(1);
    expect(conversionConverter.convert).not.toHaveBeenCalled();
  });

  it('settles promptly for pre-aborted or mid-load cancellation without reading model bytes', async () => {
    const source = sourceFixture();
    const loadGate = deferred<IfcImportConverter>();
    const loadConverter = vi.fn(() => loadGate.promise);
    const adapter = createLocalIfcImportAdapter({ loadConverter });
    const preAborted = new AbortController();
    preAborted.abort('cancelled before import');

    await expect(
      adapter.importDocument(
        requestFixture(source, { signal: preAborted.signal }),
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(loadConverter).not.toHaveBeenCalled();

    const midLoad = new AbortController();
    const promise = adapter.importDocument(
      requestFixture(source, { signal: midLoad.signal }),
    );
    midLoad.abort('cancelled while loading');
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(source.readBytes).not.toHaveBeenCalled();
    loadGate.resolve(converterFixture());
  });

  it('removes every cancellation listener after success and prompt cancellation', async () => {
    const successController = new AbortController();
    const successAdd = vi.spyOn(successController.signal, 'addEventListener');
    const successRemove = vi.spyOn(
      successController.signal,
      'removeEventListener',
    );
    const successAdapter = createLocalIfcImportAdapter({
      loadConverter: async () => converterFixture(),
    });

    await successAdapter.importDocument(
      requestFixture(sourceFixture(), { signal: successController.signal }),
    );
    expect(successAdd).toHaveBeenCalledTimes(2);
    expect(successRemove).toHaveBeenCalledTimes(2);

    const conversionGate = deferred<{
      modelCsv: string;
      auditJsonl: string;
    }>();
    const cancelledController = new AbortController();
    const cancelledAdd = vi.spyOn(
      cancelledController.signal,
      'addEventListener',
    );
    const cancelledRemove = vi.spyOn(
      cancelledController.signal,
      'removeEventListener',
    );
    const cancelledConverter = converterFixture(() => conversionGate.promise);
    const cancelledAdapter = createLocalIfcImportAdapter({
      loadConverter: async () => cancelledConverter,
    });
    const pending = cancelledAdapter.importDocument(
      requestFixture(sourceFixture(), { signal: cancelledController.signal }),
    );
    await vi.waitFor(() =>
      expect(cancelledConverter.convert).toHaveBeenCalledTimes(1),
    );
    cancelledController.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancelledAdd).toHaveBeenCalledTimes(2);
    expect(cancelledRemove).toHaveBeenCalledTimes(2);

    conversionGate.resolve({
      modelCsv: 'Version,v1\n',
      auditJsonl: '{"event":"late"}\n',
    });
  });

  it('settles promptly when cancelled during read while keeping the converter idle', async () => {
    const readGate = deferred<Uint8Array>();
    const source = sourceFixture({
      readBytes: vi.fn(() => readGate.promise),
    });
    const converter = converterFixture();
    const adapter = createLocalIfcImportAdapter({
      loadConverter: async () => converter,
    });
    const controller = new AbortController();
    const promise = adapter.importDocument(
      requestFixture(source, { signal: controller.signal }),
    );
    await vi.waitFor(() => expect(source.readBytes).toHaveBeenCalledTimes(1));

    controller.abort('cancelled while reading');
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(converter.convert).not.toHaveBeenCalled();

    readGate.resolve(textBytes('IFC'));
  });

  it('settles promptly when cancelled during conversion without allowing a concurrent conversion', async () => {
    const conversionGate = deferred<{
      modelCsv: string;
      auditJsonl: string;
    }>();
    const converter = converterFixture(() => conversionGate.promise);
    const adapter = createLocalIfcImportAdapter({
      loadConverter: async () => converter,
    });
    const controller = new AbortController();
    const first = adapter.importDocument(
      requestFixture(sourceFixture({ fileName: 'First.ifc' }), {
        signal: controller.signal,
      }),
    );
    await vi.waitFor(() => expect(converter.convert).toHaveBeenCalledTimes(1));

    controller.abort('cancelled while converting');
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });

    const secondSource = sourceFixture({ fileName: 'Second.ifc' });
    const second = adapter.importDocument(requestFixture(secondSource));
    await Promise.resolve();
    expect(secondSource.readBytes).not.toHaveBeenCalled();
    expect(converter.convert).toHaveBeenCalledTimes(1);

    conversionGate.resolve({
      modelCsv: 'Version,v1\n',
      auditJsonl: '{"event":"late"}\n',
    });
    await vi.waitFor(() => expect(secondSource.readBytes).toHaveBeenCalledTimes(1));
    expect(converter.convert).toHaveBeenCalledTimes(2);
    await second;
  });

  it('suppresses converter progress after cancellation', async () => {
    const conversionGate = deferred<{
      modelCsv: string;
      auditJsonl: string;
    }>();
    let reportProgress!: Parameters<IfcImportConverter['convert']>[0]['onProgress'];
    const converter = converterFixture((request) => {
      reportProgress = request.onProgress;
      return conversionGate.promise;
    });
    const adapter = createLocalIfcImportAdapter({
      loadConverter: async () => converter,
    });
    const controller = new AbortController();
    const progress = vi.fn();
    const pending = adapter.importDocument(
      requestFixture(sourceFixture(), {
        signal: controller.signal,
        onProgress: progress,
      }),
    );
    await vi.waitFor(() => expect(converter.convert).toHaveBeenCalledTimes(1));
    const callsBeforeCancellation = progress.mock.calls.length;

    controller.abort('cancelled while converting');
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(() =>
      reportProgress({ phase: 'walls', current: 1, total: 2 }),
    ).toThrowError(IfcImportError);
    expect(progress).toHaveBeenCalledTimes(callsBeforeCancellation);

    conversionGate.resolve({
      modelCsv: 'Version,v1\n',
      auditJsonl: '{"event":"late"}\n',
    });
  });

  it('rejects a result completed after cancellation', async () => {
    const controller = new AbortController();
    const converter = converterFixture(async () => {
      controller.abort('cancelled before result');
      return {
        modelCsv: 'Version,v1\n',
        auditJsonl: '{"event":"late"}\n',
      };
    });
    const adapter = createLocalIfcImportAdapter({
      loadConverter: async () => converter,
    });

    await expect(
      adapter.importDocument(
        requestFixture(sourceFixture(), { signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('maps source-read and conversion failures without treating unrelated AbortError as cancellation', async () => {
    const readAbort = Object.assign(new Error('read aborted'), { name: 'AbortError' });
    const source = sourceFixture({
      readBytes: vi.fn(async () => {
        throw readAbort;
      }),
    });
    const adapter = createLocalIfcImportAdapter({
      loadConverter: async () => converterFixture(),
    });
    await expect(
      adapter.importDocument(requestFixture(source)),
    ).rejects.toMatchObject({ code: 'read-failed', cause: readAbort });

    const conversionAbort = Object.assign(new Error('conversion aborted'), {
      name: 'AbortError',
    });
    const failingConverter = converterFixture(async () => {
      throw conversionAbort;
    });
    const conversionAdapter = createLocalIfcImportAdapter({
      loadConverter: async () => failingConverter,
    });
    await expect(
      conversionAdapter.importDocument(requestFixture()),
    ).rejects.toMatchObject({ code: 'conversion-failed', cause: conversionAbort });
  });

  it('rejects invalid converter objects and incomplete conversion results', async () => {
    const invalidAdapter = createLocalIfcImportAdapter({
      loadConverter: async () => ({}) as IfcImportConverter,
    });
    await expect(
      invalidAdapter.importDocument(requestFixture()),
    ).rejects.toMatchObject({ code: 'runtime-load-failed' });

    for (const result of [
      null,
      {},
      { modelCsv: '', auditJsonl: '{"event":"converted"}\n' },
      { modelCsv: 'Version,v1\n', auditJsonl: '' },
      { modelCsv: 1, auditJsonl: '{"event":"converted"}\n' },
    ]) {
      const converter = converterFixture(
        async () => result as never,
      );
      const adapter = createLocalIfcImportAdapter({
        loadConverter: async () => converter,
      });
      await expect(
        adapter.importDocument(requestFixture()),
      ).rejects.toMatchObject({ code: 'invalid-result' });
    }
  });

  it('maps hostile converter accessors to typed runtime and result errors', async () => {
    const converterAccessorCause = new Error('convert accessor failed');
    const invalidConverter = Object.defineProperty({}, 'convert', {
      get() {
        throw converterAccessorCause;
      },
    }) as IfcImportConverter;
    const invalidConverterAdapter = createLocalIfcImportAdapter({
      loadConverter: async () => invalidConverter,
    });
    await expect(
      invalidConverterAdapter.importDocument(requestFixture()),
    ).rejects.toMatchObject({
      code: 'runtime-load-failed',
      cause: converterAccessorCause,
    });

    const resultAccessorCause = new Error('model accessor failed');
    const invalidResult = Object.defineProperty(
      { auditJsonl: '{"event":"converted"}\n' },
      'modelCsv',
      {
        get() {
          throw resultAccessorCause;
        },
      },
    );
    const invalidResultAdapter = createLocalIfcImportAdapter({
      loadConverter: async () =>
        converterFixture(async () => invalidResult as IfcImportConverterResult),
    });
    await expect(
      invalidResultAdapter.importDocument(requestFixture()),
    ).rejects.toMatchObject({
      code: 'invalid-result',
      cause: resultAccessorCause,
    });
  });

  it('enforces model and audit output byte limits', async () => {
    const oversizedModel = 'x'.repeat(IFC_IMPORT_LIMITS.maximumModelBytes + 1);
    const modelAdapter = createLocalIfcImportAdapter({
      loadConverter: async () =>
        converterFixture(async () => ({
          modelCsv: oversizedModel,
          auditJsonl: '{"event":"converted"}\n',
        })),
    });
    await expect(
      modelAdapter.importDocument(requestFixture()),
    ).rejects.toMatchObject({ code: 'limit-exceeded' });

    const oversizedAudit = 'x'.repeat(IFC_IMPORT_LIMITS.maximumAuditBytes + 1);
    const auditAdapter = createLocalIfcImportAdapter({
      loadConverter: async () =>
        converterFixture(async () => ({
          modelCsv: 'Version,v1\n',
          auditJsonl: oversizedAudit,
        })),
    });
    await expect(
      auditAdapter.importDocument(requestFixture()),
    ).rejects.toMatchObject({ code: 'limit-exceeded' });
  });

  it('captures conversion result fields once and validates typed progress', async () => {
    const resultReads = new Map<string, number>();
    const progress = vi.fn();
    const converter = converterFixture(async (request) => {
      request.onProgress({ phase: 'floors-roofs', current: 1, total: 3 });
      for (const invalid of [
        { phase: 'unknown' },
        { phase: 'walls', current: -1, total: 3 },
        { phase: 'walls', current: 4, total: 3 },
        { phase: 'walls', current: 1 },
      ]) {
        expect(() => request.onProgress(invalid as never)).toThrowError(
          IfcImportError,
        );
      }
      return {
        get modelCsv() {
          resultReads.set('modelCsv', (resultReads.get('modelCsv') ?? 0) + 1);
          return 'Version,v1\n';
        },
        get auditJsonl() {
          resultReads.set('auditJsonl', (resultReads.get('auditJsonl') ?? 0) + 1);
          return '{"event":"converted"}\n';
        },
      };
    });
    const adapter = createLocalIfcImportAdapter({
      loadConverter: async () => converter,
    });

    await adapter.importDocument(
      requestFixture(sourceFixture(), { onProgress: progress }),
    );

    expect(Object.fromEntries(resultReads)).toEqual({
      modelCsv: 1,
      auditJsonl: 1,
    });
    expect(progress).toHaveBeenCalledWith(
      Object.freeze({ phase: 'floors-roofs', current: 1, total: 3 }),
    );
  });

  it('keeps network, managed workspace and private product concepts out of the public adapter', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../localIfcImportAdapter.ts'),
      'utf8',
    );

    for (const forbidden of [
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      'EventSource',
      'sendBeacon',
      'fileService',
      'workspaceStore',
      'projectStore',
      '@repo/core',
      'supabase',
      'entitlement',
      'account',
      'lodgement',
      'telemetry',
      'showDirectoryPicker',
      'localStorage',
      'indexedDB',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
