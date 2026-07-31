// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createLocalIfcImportAdapter,
  IfcImportError,
  type IfcImportConverter,
  type IfcImportConverterRequest,
  type IfcImportConverterResult,
  type IfcImportProgress,
  type IfcImportRequest,
  type LocalIfcImportAdapter,
} from '../../../packages/geometry-document/src';

export type CommunityIfcImporterOptions = Readonly<{
  createWorker?: () => Worker;
}>;

export interface CommunityIfcImporter extends LocalIfcImportAdapter {
  dispose(): void;
}

type CommunityIfcWorkerRequest = Readonly<{
  type: 'convert';
  id: number;
  bytes: ArrayBuffer;
  mode: IfcImportConverterRequest['mode'];
  delayeringEnabled: boolean;
  wallThicknessMetres?: number;
}>;

type CommunityIfcWorkerProgress = Readonly<{
  type: 'progress';
  id: number;
  progress: IfcImportProgress;
}>;

type CommunityIfcWorkerResult = Readonly<{
  type: 'result';
  id: number;
  modelCsv: string;
  auditJsonl: string;
}>;

type CommunityIfcWorkerFailure = Readonly<{
  type: 'error';
  id: number;
  error: string;
}>;

type CommunityIfcWorkerResponse =
  | CommunityIfcWorkerProgress
  | CommunityIfcWorkerResult
  | CommunityIfcWorkerFailure;

type PendingConversion = Readonly<{
  onProgress(progress: IfcImportProgress): void;
  resolve(result: IfcImportConverterResult): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}>;

function defaultWorker(): Worker {
  return new Worker(new URL('./communityIfcWorker.ts', import.meta.url), {
    type: 'module',
    name: 'vulcan-community-ifc',
  });
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : 'Community IFC conversion failed';
}

function converterError(message: string, cause?: unknown): IfcImportError {
  return new IfcImportError('conversion-failed', message, { cause });
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function responseId(value: unknown): number | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.id)) return null;
  return value.id as number;
}

function captureWorkerResponse(value: unknown): CommunityIfcWorkerResponse {
  const id = responseId(value);
  if (id === null || !isRecord(value) || typeof value.type !== 'string') {
    throw converterError('Community IFC worker returned an invalid response');
  }
  if (value.type === 'progress') {
    if (!isRecord(value.progress)) {
      throw converterError('Community IFC worker returned invalid progress');
    }
    return Object.freeze({
      type: 'progress',
      id,
      progress: value.progress as IfcImportProgress,
    });
  }
  if (value.type === 'result') {
    if (
      typeof value.modelCsv !== 'string'
      || typeof value.auditJsonl !== 'string'
    ) {
      throw converterError('Community IFC worker returned an invalid result');
    }
    return Object.freeze({
      type: 'result',
      id,
      modelCsv: value.modelCsv,
      auditJsonl: value.auditJsonl,
    });
  }
  if (value.type === 'error' && typeof value.error === 'string') {
    return Object.freeze({ type: 'error', id, error: value.error });
  }
  throw converterError('Community IFC worker returned an invalid response');
}

function createCommunityIfcWorkerConverter(
  options: CommunityIfcImporterOptions,
): IfcImportConverter & Readonly<{ dispose(): void }> {
  let worker: Worker | null = null;
  let nextId = 1;
  let disposed = false;
  const pending = new Map<number, PendingConversion>();

  const releasePending = (request: PendingConversion): void => {
    if (request.signal !== undefined && request.onAbort !== undefined) {
      request.signal.removeEventListener('abort', request.onAbort);
    }
  };

  const rejectAll = (error: Error): void => {
    for (const request of pending.values()) {
      releasePending(request);
      request.reject(error);
    }
    pending.clear();
  };

  const detachWorker = (): void => {
    if (worker === null) return;
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.terminate();
    worker = null;
  };

  const resetWorker = (error: Error): void => {
    detachWorker();
    rejectAll(error);
  };

  const onMessage = (event: MessageEvent<unknown>): void => {
    let response: CommunityIfcWorkerResponse;
    try {
      response = captureWorkerResponse(event.data);
    } catch (error) {
      resetWorker(
        error instanceof Error
          ? error
          : converterError('Community IFC worker returned an invalid response'),
      );
      return;
    }
    const request = pending.get(response.id);
    if (request === undefined) return;
    if (response.type === 'progress') {
      try {
        request.onProgress(response.progress);
      } catch (error) {
        resetWorker(
          error instanceof Error
            ? error
            : converterError('Community IFC progress handling failed'),
        );
      }
      return;
    }
    pending.delete(response.id);
    releasePending(request);
    if (response.type === 'result') {
      request.resolve(Object.freeze({
        modelCsv: response.modelCsv,
        auditJsonl: response.auditJsonl,
      }));
      return;
    }
    request.reject(converterError(response.error));
  };

  const onError = (event: ErrorEvent): void => {
    resetWorker(converterError(
      event.message.trim().length > 0
        ? event.message
        : 'Community IFC worker failed',
      event.error,
    ));
  };

  const requireWorker = (): Worker => {
    if (disposed) {
      throw converterError('Community IFC importer was disposed');
    }
    if (worker !== null) return worker;
    worker = (options.createWorker ?? defaultWorker)();
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    return worker;
  };

  return Object.freeze({
    convert(request: IfcImportConverterRequest) {
      if (disposed) {
        return Promise.reject(
          converterError('Community IFC importer was disposed'),
        );
      }
      if (request.signal?.aborted) {
        return Promise.reject(
          new IfcImportError('cancelled', 'IFC import was cancelled'),
        );
      }
      const id = nextId;
      nextId += 1;
      const activeWorker = requireWorker();
      const bytes = Uint8Array.from(request.bytes);
      const message: CommunityIfcWorkerRequest = Object.freeze({
        type: 'convert',
        id,
        bytes: bytes.buffer,
        mode: request.mode,
        delayeringEnabled: request.delayeringEnabled,
        ...(request.wallThicknessMetres === undefined
          ? {}
          : { wallThicknessMetres: request.wallThicknessMetres }),
      });
      return new Promise<IfcImportConverterResult>((resolve, reject) => {
        const onAbort = request.signal === undefined
          ? undefined
          : () => resetWorker(
              new IfcImportError('cancelled', 'IFC import was cancelled'),
            );
        const pendingRequest = Object.freeze({
          onProgress: request.onProgress,
          resolve,
          reject,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          ...(onAbort === undefined ? {} : { onAbort }),
        });
        pending.set(id, pendingRequest);
        if (request.signal !== undefined && onAbort !== undefined) {
          request.signal.addEventListener('abort', onAbort, { once: true });
        }
        if (request.signal?.aborted) {
          onAbort?.();
          return;
        }
        try {
          activeWorker.postMessage(message, [message.bytes]);
        } catch (error) {
          pending.delete(id);
          releasePending(pendingRequest);
          reject(converterError(messageFromUnknown(error), error));
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      detachWorker();
      rejectAll(converterError('Community IFC importer was disposed'));
    },
  });
}

/**
 * Creates a lazy, browser-local IFC importer. The worker is not created and no
 * runtime assets are downloaded until the first import begins.
 */
export function createCommunityIfcImporter(
  options: CommunityIfcImporterOptions = {},
): CommunityIfcImporter {
  const converter = createCommunityIfcWorkerConverter(options);
  const adapter = createLocalIfcImportAdapter({
    loadConverter: async () => converter,
  });
  return Object.freeze({
    importDocument(request: IfcImportRequest) {
      return adapter.importDocument(request);
    },
    dispose() {
      converter.dispose();
    },
  });
}
