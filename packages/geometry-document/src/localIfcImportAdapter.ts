// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { normalizeGeometryDocumentName } from './documentNaming';
import {
  IFC_IMPORT_LIMITS,
  IfcImportError,
  type IfcImportConverter,
  type IfcImportConverterResult,
  type IfcImportMode,
  type IfcImportProgress,
  type IfcImportProgressPhase,
  type IfcImportRequest,
  type LocalIfcImportAdapter,
  type LocalIfcImportAdapterOptions,
} from './ifcImportContracts';
import type { PortableGeometryDocument } from './portableDocumentContracts';
import {
  captureGeometryDocumentContents,
  toPortableGeometryDocument,
} from './documentContents';

type CapturedSource = Readonly<{
  target: object;
  fileName: string;
  modelFileName: string;
  byteLength: number;
  readBytes: (this: object) => Promise<Uint8Array>;
}>;

type CapturedSignal = Readonly<{
  target: AbortSignal;
  readAborted(): boolean;
  addAbortListener(listener: EventListener): void;
  removeAbortListener(listener: EventListener): void;
}>;

type CapturedRequest = Readonly<{
  source: CapturedSource;
  mode: IfcImportMode;
  delayeringEnabled: boolean;
  wallThicknessMetres?: number;
  signal?: CapturedSignal;
  onProgress?: (progress: IfcImportProgress) => void;
}>;

type CapturedConverter = Readonly<{
  target: object;
  convert: IfcImportConverter['convert'];
}>;

const IFC_EXTENSION = '.ifc';
const IFC_SOURCE_ID = 'original-ifc';
const IFC_AUDIT_ID = 'ifc-import-audit';
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'byteLength',
)?.get;
const IFC_PROGRESS_PHASES = new Set<IfcImportProgressPhase>([
  'runtime',
  'dependencies',
  'parser',
  'source-read',
  'conversion',
  'floors-roofs',
  'walls',
  'windows',
  'doors',
  'spaces',
  'assembly',
  'csv',
]);

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUint8ArrayValue(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === '[object Uint8Array]'
  );
}

function readUint8ArrayByteLength(value: Uint8Array): number {
  if (typeof TYPED_ARRAY_BYTE_LENGTH_GETTER !== 'function') {
    throw new Error('Typed-array byte-length validation is unavailable');
  }
  return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
}

function importError(
  code: ConstructorParameters<typeof IfcImportError>[0],
  message: string,
  details: ConstructorParameters<typeof IfcImportError>[2] = {},
): IfcImportError {
  return new IfcImportError(code, message, details);
}

function cancelledError(fileName: string): IfcImportError {
  return importError('cancelled', `IFC import was cancelled for ${fileName}`, {
    fileName,
  });
}

function throwIfAborted(signal: CapturedSignal | undefined, fileName: string): void {
  if (signal === undefined) return;
  if (signal.readAborted()) throw cancelledError(fileName);
}

function captureSignal(value: unknown): CapturedSignal | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw importError('invalid-request', 'IFC import signal is invalid');
  }
  let aborted: unknown;
  let addEventListener: unknown;
  let removeEventListener: unknown;
  try {
    aborted = value.aborted;
    addEventListener = value.addEventListener;
    removeEventListener = value.removeEventListener;
  } catch (cause) {
    throw importError('invalid-request', 'IFC import signal is invalid', {
      cause,
    });
  }
  if (
    typeof aborted !== 'boolean' ||
    typeof addEventListener !== 'function' ||
    typeof removeEventListener !== 'function'
  ) {
    throw importError('invalid-request', 'IFC import signal is invalid');
  }
  const target = value as unknown as AbortSignal;
  return Object.freeze({
    target,
    readAborted() {
      let current: unknown;
      try {
        current = value.aborted;
      } catch (cause) {
        throw importError('invalid-request', 'IFC import signal is invalid', {
          cause,
        });
      }
      if (typeof current !== 'boolean') {
        throw importError('invalid-request', 'IFC import signal is invalid');
      }
      return current;
    },
    addAbortListener(listener: EventListener) {
      try {
        addEventListener.call(value, 'abort', listener, { once: true });
      } catch (cause) {
        throw importError('invalid-request', 'Could not observe IFC cancellation', {
          cause,
        });
      }
    },
    removeAbortListener(listener: EventListener) {
      try {
        removeEventListener.call(value, 'abort', listener);
      } catch (cause) {
        throw importError(
          'invalid-request',
          'Could not release the IFC cancellation listener',
          { cause },
        );
      }
    },
  });
}

function captureProgress(value: unknown): IfcImportProgress {
  if (!isRecord(value)) {
    throw importError('invalid-result', 'IFC converter progress is invalid');
  }
  const phase = value.phase;
  const current = value.current;
  const total = value.total;
  if (
    typeof phase !== 'string' ||
    !IFC_PROGRESS_PHASES.has(phase as IfcImportProgressPhase)
  ) {
    throw importError('invalid-result', 'IFC converter progress phase is invalid');
  }
  if (current === undefined && total === undefined) {
    return Object.freeze({ phase: phase as IfcImportProgressPhase });
  }
  if (
    !Number.isSafeInteger(current) ||
    !Number.isSafeInteger(total) ||
    (current as number) < 0 ||
    (total as number) < 0 ||
    (current as number) > (total as number)
  ) {
    throw importError('invalid-result', 'IFC converter progress counts are invalid');
  }
  return Object.freeze({
    phase: phase as IfcImportProgressPhase,
    current: current as number,
    total: total as number,
  });
}

function captureSource(value: unknown): CapturedSource {
  if (!isRecord(value)) {
    throw importError('invalid-source', 'IFC import source is invalid');
  }
  let rawFileName: unknown;
  let byteLength: unknown;
  let readBytes: unknown;
  try {
    rawFileName = value.fileName;
    byteLength = value.byteLength;
    readBytes = value.readBytes;
  } catch (cause) {
    throw importError('invalid-source', 'IFC import source is invalid', {
      cause,
    });
  }
  if (typeof rawFileName !== 'string' || typeof readBytes !== 'function') {
    throw importError('invalid-source', 'IFC import source is incomplete');
  }
  let fileName: string;
  try {
    fileName = normalizeGeometryDocumentName(rawFileName);
  } catch (cause) {
    throw importError('invalid-source', 'IFC source file name is unsafe', {
      cause,
    });
  }
  if (!fileName.toLowerCase().endsWith(IFC_EXTENSION)) {
    throw importError('invalid-source', 'IFC source file must use the .ifc extension', {
      fileName,
    });
  }
  if (!Number.isSafeInteger(byteLength) || (byteLength as number) <= 0) {
    throw importError('invalid-source', 'IFC source byte length is invalid', {
      fileName,
    });
  }
  if ((byteLength as number) > IFC_IMPORT_LIMITS.maximumSourceBytes) {
    throw importError('limit-exceeded', 'IFC source exceeds the byte limit', {
      fileName,
    });
  }
  return Object.freeze({
    target: value,
    fileName,
    modelFileName: `${fileName.slice(0, -IFC_EXTENSION.length)}.csv`,
    byteLength: byteLength as number,
    readBytes: readBytes as CapturedSource['readBytes'],
  });
}

function captureRequest(value: unknown): CapturedRequest {
  if (!isRecord(value)) {
    throw importError('invalid-request', 'IFC import request is invalid');
  }
  let rawSource: unknown;
  let mode: unknown;
  let delayeringEnabled: unknown;
  let wallThicknessMetres: unknown;
  let rawSignal: unknown;
  let onProgress: unknown;
  try {
    rawSource = value.source;
    mode = value.mode;
    delayeringEnabled = value.delayeringEnabled;
    wallThicknessMetres = value.wallThicknessMetres;
    rawSignal = value.signal;
    onProgress = value.onProgress;
  } catch (cause) {
    throw importError('invalid-request', 'IFC import request is invalid', {
      cause,
    });
  }
  const signal = captureSignal(rawSignal);
  if (mode !== 'internal' && mode !== 'external' && mode !== 'raw') {
    throw importError('invalid-request', 'IFC import mode is invalid');
  }
  if (typeof delayeringEnabled !== 'boolean') {
    throw importError('invalid-request', 'IFC delayering choice is required');
  }
  if (mode === 'external') {
    if (
      typeof wallThicknessMetres !== 'number' ||
      !Number.isFinite(wallThicknessMetres) ||
      wallThicknessMetres < 0.01 ||
      wallThicknessMetres > 10
    ) {
      throw importError(
        'invalid-request',
        'External IFC import requires a wall thickness from 0.01 to 10 metres',
      );
    }
  } else if (wallThicknessMetres !== undefined) {
    throw importError(
      'invalid-request',
      'Wall thickness is supported only for external IFC import',
    );
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') {
    throw importError('invalid-request', 'IFC progress callback is invalid');
  }
  const source = captureSource(rawSource);
  return Object.freeze({
    source,
    mode,
    delayeringEnabled,
    ...(wallThicknessMetres === undefined ? {} : { wallThicknessMetres }),
    ...(signal === undefined ? {} : { signal }),
    ...(onProgress === undefined
      ? {}
      : { onProgress: onProgress as (progress: IfcImportProgress) => void }),
  });
}

function captureConverter(value: unknown): CapturedConverter {
  if (!isRecord(value)) {
    throw importError('runtime-load-failed', 'IFC converter did not load');
  }
  const convert = value.convert;
  if (typeof convert !== 'function') {
    throw importError('runtime-load-failed', 'IFC converter is invalid');
  }
  return Object.freeze({
    target: value,
    convert: convert as IfcImportConverter['convert'],
  });
}

function captureConverterResult(value: unknown): IfcImportConverterResult {
  if (!isRecord(value)) {
    throw importError('invalid-result', 'IFC converter result is invalid');
  }
  const modelCsv = value.modelCsv;
  const auditJsonl = value.auditJsonl;
  if (
    typeof modelCsv !== 'string' ||
    modelCsv.length === 0 ||
    typeof auditJsonl !== 'string' ||
    auditJsonl.length === 0
  ) {
    throw importError('invalid-result', 'IFC converter result is incomplete');
  }
  return Object.freeze({ modelCsv, auditJsonl });
}

function awaitWithCancellation<T>(
  promise: Promise<T>,
  signal: CapturedSignal | undefined,
  fileName: string,
): Promise<T> {
  if (signal === undefined) return promise;
  throwIfAborted(signal, fileName);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let registered = false;
    const onAbort: EventListener = () =>
      rejectAfterCleanup(cancelledError(fileName));
    const cleanup = (): IfcImportError | null => {
      if (!registered) return null;
      registered = false;
      try {
        signal.removeAbortListener(onAbort);
        return null;
      } catch (cause) {
        return cause instanceof IfcImportError
          ? cause
          : importError(
              'invalid-request',
              'Could not release the IFC cancellation listener',
              { cause },
            );
      }
    };
    const rejectAfterCleanup = (cause: unknown): void => {
      if (settled) return;
      settled = true;
      const cleanupError = cleanup();
      reject(cleanupError ?? cause);
    };
    const resolveAfterCleanup = (result: T): void => {
      if (settled) return;
      settled = true;
      const cleanupError = cleanup();
      if (cleanupError !== null) {
        reject(cleanupError);
        return;
      }
      resolve(result);
    };
    try {
      registered = true;
      signal.addAbortListener(onAbort);
      throwIfAborted(signal, fileName);
    } catch (cause) {
      rejectAfterCleanup(cause);
      void promise.catch(() => undefined);
      return;
    }
    promise.then(resolveAfterCleanup, rejectAfterCleanup);
  });
}

function createDocument(
  request: CapturedRequest,
  sourceBytes: Uint8Array,
  result: IfcImportConverterResult,
): PortableGeometryDocument {
  const encoder = new TextEncoder();
  const modelByteLength = encoder.encode(result.modelCsv).byteLength;
  if (modelByteLength > IFC_IMPORT_LIMITS.maximumModelBytes) {
    throw importError('limit-exceeded', 'Converted IFC model exceeds the byte limit', {
      fileName: request.source.fileName,
    });
  }
  const auditBytes = encoder.encode(result.auditJsonl);
  if (auditBytes.byteLength > IFC_IMPORT_LIMITS.maximumAuditBytes) {
    throw importError('limit-exceeded', 'IFC audit exceeds the byte limit', {
      fileName: request.source.fileName,
    });
  }
  return toPortableGeometryDocument(
    captureGeometryDocumentContents({
      fileName: request.source.modelFileName,
      text: result.modelCsv,
      derivedResources: [
        {
          id: IFC_AUDIT_ID,
          slots: ['ifc.audit'],
          role: 'ifc-import-audit',
          required: false,
          mediaType: 'application/x-ndjson',
          bytes: auditBytes,
        },
      ],
      sourceFiles: [
        {
          id: IFC_SOURCE_ID,
          slots: ['ifc.source'],
          role: 'ifc',
          fileName: request.source.fileName,
          mediaType: 'model/ifc',
          bytes: sourceBytes,
        },
      ],
    }),
  );
}

export function createLocalIfcImportAdapter(
  options: LocalIfcImportAdapterOptions,
): LocalIfcImportAdapter {
  if (!isRecord(options)) {
    throw importError('invalid-request', 'IFC adapter options are invalid');
  }
  const optionsTarget = options;
  let loadConverter: unknown;
  try {
    loadConverter = options.loadConverter;
  } catch (cause) {
    throw importError('invalid-request', 'IFC adapter options are invalid', {
      cause,
    });
  }
  if (typeof loadConverter !== 'function') {
    throw importError('invalid-request', 'IFC converter loader is required');
  }

  let converter: CapturedConverter | null = null;
  let converterPromise: Promise<CapturedConverter> | null = null;
  let conversionTail: Promise<void> = Promise.resolve();

  const getConverter = (): Promise<CapturedConverter> => {
    if (converter !== null) return Promise.resolve(converter);
    if (converterPromise !== null) return converterPromise;
    converterPromise = (async () => {
      let loaded: unknown;
      try {
        loaded = await loadConverter.call(optionsTarget);
      } catch (cause) {
        throw importError('runtime-load-failed', 'Could not load the IFC converter', {
          cause,
        });
      }
      try {
        return captureConverter(loaded);
      } catch (cause) {
        if (cause instanceof IfcImportError) throw cause;
        throw importError('runtime-load-failed', 'IFC converter is invalid', {
          cause,
        });
      }
    })();
    converterPromise.then(
      (loaded) => {
        converter = loaded;
      },
      () => {
        converterPromise = null;
      },
    );
    return converterPromise;
  };

  return Object.freeze({
    async importDocument(rawRequest: IfcImportRequest) {
      const request = captureRequest(rawRequest);
      const emitProgress = (progress: IfcImportProgress): void => {
        throwIfAborted(request.signal, request.source.fileName);
        const captured = captureProgress(progress);
        throwIfAborted(request.signal, request.source.fileName);
        request.onProgress?.(captured);
        throwIfAborted(request.signal, request.source.fileName);
      };
      throwIfAborted(request.signal, request.source.fileName);
      emitProgress({ phase: 'runtime' });
      const loadedConverter = await awaitWithCancellation(
        getConverter(),
        request.signal,
        request.source.fileName,
      );
      throwIfAborted(request.signal, request.source.fileName);

      const operation = conversionTail.then(async () => {
        throwIfAborted(request.signal, request.source.fileName);
        emitProgress({ phase: 'source-read' });
        let rawBytes: unknown;
        try {
          rawBytes = await request.source.readBytes.call(request.source.target);
        } catch (cause) {
          throwIfAborted(request.signal, request.source.fileName);
          throw importError('read-failed', 'Could not read the IFC source', {
            fileName: request.source.fileName,
            cause,
          });
        }
        throwIfAborted(request.signal, request.source.fileName);
        if (!isUint8ArrayValue(rawBytes)) {
          throw importError('read-failed', 'IFC source did not return bytes', {
            fileName: request.source.fileName,
          });
        }
        let actualSourceByteLength: number;
        try {
          actualSourceByteLength = readUint8ArrayByteLength(rawBytes);
        } catch (cause) {
          throw importError('read-failed', 'Could not inspect the IFC source bytes', {
            fileName: request.source.fileName,
            cause,
          });
        }
        if (actualSourceByteLength > IFC_IMPORT_LIMITS.maximumSourceBytes) {
          throw importError('limit-exceeded', 'IFC source exceeds the byte limit', {
            fileName: request.source.fileName,
          });
        }
        if (actualSourceByteLength !== request.source.byteLength) {
          throw importError('read-failed', 'IFC source size changed while reading', {
            fileName: request.source.fileName,
          });
        }
        let sourceBytes: Uint8Array;
        try {
          sourceBytes = Uint8Array.from(rawBytes as Uint8Array);
        } catch (cause) {
          throw importError('read-failed', 'Could not capture the IFC source bytes', {
            fileName: request.source.fileName,
            cause,
          });
        }
        if (sourceBytes.byteLength > IFC_IMPORT_LIMITS.maximumSourceBytes) {
          throw importError('limit-exceeded', 'IFC source exceeds the byte limit', {
            fileName: request.source.fileName,
          });
        }
        if (sourceBytes.byteLength !== request.source.byteLength) {
          throw importError('read-failed', 'IFC source size changed while reading', {
            fileName: request.source.fileName,
          });
        }
        const reportProgress = (progress: IfcImportProgress): void => {
          emitProgress(progress);
        };
        emitProgress({ phase: 'conversion' });
        let rawResult: unknown;
        try {
          rawResult = await loadedConverter.convert.call(
            loadedConverter.target,
            Object.freeze({
              bytes: sourceBytes.slice(),
              mode: request.mode,
              delayeringEnabled: request.delayeringEnabled,
              ...(request.wallThicknessMetres === undefined
                ? {}
                : { wallThicknessMetres: request.wallThicknessMetres }),
              ...(request.signal === undefined
                ? {}
                : { signal: request.signal.target }),
              onProgress: reportProgress,
            }),
          );
        } catch (cause) {
          throwIfAborted(request.signal, request.source.fileName);
          if (cause instanceof IfcImportError) throw cause;
          throw importError('conversion-failed', 'IFC conversion failed', {
            fileName: request.source.fileName,
            cause,
          });
        }
        throwIfAborted(request.signal, request.source.fileName);
        let result: IfcImportConverterResult;
        try {
          result = captureConverterResult(rawResult);
        } catch (cause) {
          if (cause instanceof IfcImportError) throw cause;
          throw importError('invalid-result', 'IFC converter result is invalid', {
            fileName: request.source.fileName,
            cause,
          });
        }
        return createDocument(
          request,
          sourceBytes,
          result,
        );
      });
      conversionTail = operation.then(
        () => undefined,
        () => undefined,
      );
      return awaitWithCancellation(
        operation,
        request.signal,
        request.source.fileName,
      );
    },
  });
}
