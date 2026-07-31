// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometryDocumentInput,
  GeometryDocumentSnapshot,
} from './contracts';
import { captureGeometryDocumentContents } from './documentContents';
import type { GeometryDocumentDirtyDecision } from './geometryDocumentCoordinator';

export type GeometryDocumentHostOperation =
  | 'save'
  | 'new'
  | 'open'
  | 'delete'
  | 'duplicate';

export type GeometryDocumentHostTarget = Readonly<{
  id: string;
  fileName: string;
  storageVersion: string;
}>;

export type GeometryDocumentHostSnapshot = Readonly<{
  document: GeometryDocumentSnapshot;
  activeDocument: GeometryDocumentHostTarget | null;
  operation: GeometryDocumentHostOperation | null;
}>;

export type GeometryDocumentHostCompleted = Readonly<{
  status: 'completed';
  activeDocument?: GeometryDocumentHostTarget | null;
}>;

export type GeometryDocumentHostCancelled = Readonly<{
  status: 'cancelled';
}>;

export type GeometryDocumentHostSuperseded = Readonly<{
  status: 'superseded';
}>;

export type GeometryDocumentHostResult =
  | GeometryDocumentHostCompleted
  | GeometryDocumentHostCancelled
  | GeometryDocumentHostSuperseded;

export type GeometryDocumentHostNewRequest = Readonly<{
  contents?: GeometryDocumentInput;
  dirtyDecision?: GeometryDocumentDirtyDecision;
}>;

export type GeometryDocumentHostOpenRequest = Readonly<{
  target: GeometryDocumentHostTarget;
  dirtyDecision?: GeometryDocumentDirtyDecision;
}>;

export type GeometryDocumentHostDestructiveRequest = Readonly<{
  target: GeometryDocumentHostTarget;
  confirmed?: boolean;
  dirtyDecision?: GeometryDocumentDirtyDecision;
}>;

export type GeometryDocumentHostPreparedOperation = Readonly<{
  run(): Promise<GeometryDocumentHostResult>;
}>;

export type GeometryDocumentHostDriverSnapshot = Readonly<{
  document: GeometryDocumentSnapshot;
  activeDocument: GeometryDocumentHostTarget | null;
}>;

/**
 * Host-specific document operations. Every `prepare*` method is synchronous so
 * the serialized public port can prove that mutable request state was captured
 * before an earlier queued operation yields.
 */
export interface GeometryDocumentHostDriver {
  getSnapshot(): GeometryDocumentHostDriverSnapshot;
  subscribe(listener: () => void): () => void;
  updateFileName(fileName: string): void;
  isDirty(): boolean;
  prepareSave(): GeometryDocumentHostPreparedOperation;
  prepareNew(
    request: GeometryDocumentHostNewRequest,
  ): GeometryDocumentHostPreparedOperation;
  prepareOpen(
    request: GeometryDocumentHostOpenRequest,
  ): GeometryDocumentHostPreparedOperation;
  prepareDelete(
    request: GeometryDocumentHostDestructiveRequest,
  ): GeometryDocumentHostPreparedOperation;
  prepareDuplicate(
    request: GeometryDocumentHostDestructiveRequest,
  ): GeometryDocumentHostPreparedOperation;
  dispose(): void;
}

export interface GeometryDocumentHostPort {
  getSnapshot(): GeometryDocumentHostSnapshot;
  subscribe(listener: () => void): () => void;
  updateFileName(fileName: string): void;
  isDirty(): boolean;
  save(): Promise<GeometryDocumentHostResult>;
  newDocument(
    request?: GeometryDocumentHostNewRequest,
  ): Promise<GeometryDocumentHostResult>;
  open(
    request: GeometryDocumentHostOpenRequest,
  ): Promise<GeometryDocumentHostResult>;
  delete(
    request: GeometryDocumentHostDestructiveRequest,
  ): Promise<GeometryDocumentHostResult>;
  duplicate(
    request: GeometryDocumentHostDestructiveRequest,
  ): Promise<GeometryDocumentHostResult>;
  dispose(): void;
}

export type SerializedGeometryDocumentHostPortOptions = Readonly<{
  driver: GeometryDocumentHostDriver;
}>;

const SUPERSEDED: GeometryDocumentHostSuperseded = Object.freeze({
  status: 'superseded',
});
const CANCELLED: GeometryDocumentHostCancelled = Object.freeze({
  status: 'cancelled',
});

function captureString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string`);
  }
  return value;
}

function captureTarget(value: unknown): GeometryDocumentHostTarget {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Geometry document host target must be an object');
  }
  const candidate = value as Partial<GeometryDocumentHostTarget>;
  return Object.freeze({
    id: captureString(candidate.id, 'Geometry document host target id'),
    fileName: captureString(
      candidate.fileName,
      'Geometry document host target fileName',
    ),
    storageVersion: captureString(
      candidate.storageVersion,
      'Geometry document host target storageVersion',
    ),
  });
}

function captureDirtyDecision(
  value: unknown,
): GeometryDocumentDirtyDecision | undefined {
  if (value === undefined) return undefined;
  if (value === 'save' || value === 'discard' || value === 'cancel') return value;
  throw new TypeError('Geometry document dirty decision is invalid');
}

function captureNewRequest(value: unknown): GeometryDocumentHostNewRequest {
  if (value === undefined) return Object.freeze({});
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Geometry document new request must be an object');
  }
  const candidate = value as GeometryDocumentHostNewRequest;
  const contents = candidate.contents;
  const dirtyDecision = captureDirtyDecision(candidate.dirtyDecision);
  return Object.freeze({
    ...(contents === undefined
      ? {}
      : { contents: captureGeometryDocumentContents(contents) }),
    ...(dirtyDecision === undefined ? {} : { dirtyDecision }),
  });
}

function captureOpenRequest(value: unknown): GeometryDocumentHostOpenRequest {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Geometry document open request must be an object');
  }
  const candidate = value as GeometryDocumentHostOpenRequest;
  const target = captureTarget(candidate.target);
  const dirtyDecision = captureDirtyDecision(candidate.dirtyDecision);
  return Object.freeze({
    target,
    ...(dirtyDecision === undefined ? {} : { dirtyDecision }),
  });
}

function captureDestructiveRequest(
  value: unknown,
): GeometryDocumentHostDestructiveRequest {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Geometry document destructive request must be an object');
  }
  const candidate = value as GeometryDocumentHostDestructiveRequest;
  const target = captureTarget(candidate.target);
  const confirmed = candidate.confirmed;
  const dirtyDecision = captureDirtyDecision(candidate.dirtyDecision);
  if (confirmed !== undefined && typeof confirmed !== 'boolean') {
    throw new TypeError('Geometry document confirmation must be a boolean');
  }
  return Object.freeze({
    target,
    ...(confirmed === undefined ? {} : { confirmed }),
    ...(dirtyDecision === undefined ? {} : { dirtyDecision }),
  });
}

function targetsEqual(
  left: GeometryDocumentHostTarget | null,
  right: GeometryDocumentHostTarget | null,
): boolean {
  return left === right || (
    left !== null &&
    right !== null &&
    left.id === right.id &&
    left.fileName === right.fileName &&
    left.storageVersion === right.storageVersion
  );
}

function captureDriverSnapshot(
  value: GeometryDocumentHostDriverSnapshot,
): GeometryDocumentHostDriverSnapshot {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Geometry document host driver snapshot must be an object');
  }
  const rawDocument = value.document;
  if (typeof rawDocument !== 'object' || rawDocument === null) {
    throw new TypeError('Geometry document host driver snapshot must contain a document');
  }
  const revision = rawDocument.revision;
  const persistedRevision = rawDocument.persistedRevision;
  const isDirty = rawDocument.isDirty;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('Geometry document host document revision must be a non-negative safe integer');
  }
  if (
    persistedRevision !== null &&
    (!Number.isSafeInteger(persistedRevision) ||
      persistedRevision < 0 ||
      persistedRevision > revision)
  ) {
    throw new TypeError('Geometry document host persistedRevision is invalid');
  }
  if (typeof isDirty !== 'boolean') {
    throw new TypeError('Geometry document host document isDirty must be a boolean');
  }
  const contents = captureGeometryDocumentContents(rawDocument);
  const document: GeometryDocumentSnapshot = Object.freeze({
    ...contents,
    revision,
    persistedRevision,
    isDirty,
  });
  const rawActiveDocument = value.activeDocument;
  const activeDocument = rawActiveDocument === null
    ? null
    : captureTarget(rawActiveDocument);
  return Object.freeze({ document, activeDocument });
}

function capturePreparedRun(
  prepared: GeometryDocumentHostPreparedOperation,
): () => Promise<GeometryDocumentHostResult> {
  if (typeof prepared !== 'object' || prepared === null) {
    throw new TypeError('Prepared geometry document operation must be an object');
  }
  const run = prepared.run;
  if (typeof run !== 'function') {
    throw new TypeError('Prepared geometry document operation must provide run()');
  }
  return () => Reflect.apply(run, prepared, []);
}

function captureResult(value: unknown): GeometryDocumentHostResult {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Geometry document host result must be an object');
  }
  const candidate = value as {
    readonly status?: unknown;
    readonly activeDocument?: unknown;
  };
  const status = candidate.status;
  if (status === 'cancelled') return CANCELLED;
  if (status === 'superseded') return SUPERSEDED;
  if (status !== 'completed') {
    throw new TypeError('Geometry document host result status is invalid');
  }
  const rawActiveDocument = candidate.activeDocument;
  return Object.freeze({
    status,
    ...(rawActiveDocument === undefined
      ? {}
      : {
          activeDocument: rawActiveDocument === null
            ? null
            : captureTarget(rawActiveDocument),
        }),
  });
}

export function createSerializedGeometryDocumentHostPort(
  options: SerializedGeometryDocumentHostPortOptions,
): GeometryDocumentHostPort {
  const driver = options.driver;
  if (typeof driver !== 'object' || driver === null) {
    throw new TypeError('Geometry document host driver is required');
  }

  let disposed = false;
  let operation: GeometryDocumentHostOperation | null = null;
  let rawDriverSnapshot = driver.getSnapshot();
  let driverSnapshot = captureDriverSnapshot(rawDriverSnapshot);
  let snapshot: GeometryDocumentHostSnapshot = Object.freeze({
    ...driverSnapshot,
    operation,
  });
  let tail: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  let unsubscribeDriver: (() => void) | null = null;

  const publish = () => {
    if (disposed) return;
    for (const listener of [...listeners]) listener();
  };

  const synchronize = () => {
    if (disposed) return snapshot;
    const nextRawDriverSnapshot = driver.getSnapshot();
    const nextDriverSnapshot = nextRawDriverSnapshot === rawDriverSnapshot
      ? driverSnapshot
      : captureDriverSnapshot(nextRawDriverSnapshot);
    if (
      nextDriverSnapshot.document === driverSnapshot.document &&
      targetsEqual(nextDriverSnapshot.activeDocument, driverSnapshot.activeDocument) &&
      snapshot.operation === operation
    ) {
      return snapshot;
    }
    rawDriverSnapshot = nextRawDriverSnapshot;
    driverSnapshot = nextDriverSnapshot;
    snapshot = Object.freeze({ ...driverSnapshot, operation });
    return snapshot;
  };

  const synchronizeAndPublish = () => {
    const previous = snapshot;
    synchronize();
    if (snapshot !== previous) publish();
  };

  const enqueue = (
    nextOperation: GeometryDocumentHostOperation,
    run: () => Promise<GeometryDocumentHostResult>,
  ): Promise<GeometryDocumentHostResult> => {
    const execute = async (): Promise<GeometryDocumentHostResult> => {
      if (disposed) return SUPERSEDED;
      operation = nextOperation;
      synchronizeAndPublish();
      try {
        const result = await run();
        if (disposed) return SUPERSEDED;
        const capturedResult = captureResult(result);
        synchronizeAndPublish();
        return capturedResult;
      } catch (error) {
        if (disposed) return SUPERSEDED;
        throw error;
      } finally {
        if (!disposed) {
          operation = null;
          synchronizeAndPublish();
        }
      }
    };
    const result = tail.then(execute);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const port: GeometryDocumentHostPort = {
    getSnapshot: () => synchronize(),
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      if (unsubscribeDriver === null) {
        let unsubscribe: unknown;
        try {
          unsubscribe = driver.subscribe(synchronizeAndPublish);
        } catch (error) {
          listeners.delete(listener);
          throw error;
        }
        if (typeof unsubscribe !== 'function') {
          listeners.delete(listener);
          throw new TypeError(
            'Geometry document host driver subscribe() must return an unsubscribe function',
          );
        }
        unsubscribeDriver = unsubscribe as () => void;
      }
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
        if (listeners.size === 0 && unsubscribeDriver !== null) {
          const unsubscribe = unsubscribeDriver;
          unsubscribeDriver = null;
          unsubscribe();
        }
      };
    },
    updateFileName: (fileName) => {
      if (disposed) return;
      driver.updateFileName(captureString(fileName, 'Geometry document fileName'));
      synchronizeAndPublish();
    },
    isDirty: () => disposed ? snapshot.document.isDirty : driver.isDirty(),
    save: () => {
      if (disposed) return Promise.resolve(SUPERSEDED);
      const run = capturePreparedRun(driver.prepareSave());
      return enqueue('save', run);
    },
    newDocument: (request) => {
      if (disposed) return Promise.resolve(SUPERSEDED);
      const captured = captureNewRequest(request);
      const run = capturePreparedRun(driver.prepareNew(captured));
      return enqueue('new', run);
    },
    open: (request) => {
      if (disposed) return Promise.resolve(SUPERSEDED);
      const captured = captureOpenRequest(request);
      const run = capturePreparedRun(driver.prepareOpen(captured));
      return enqueue('open', run);
    },
    delete: (request) => {
      if (disposed) return Promise.resolve(SUPERSEDED);
      const captured = captureDestructiveRequest(request);
      const run = capturePreparedRun(driver.prepareDelete(captured));
      return enqueue('delete', run);
    },
    duplicate: (request) => {
      if (disposed) return Promise.resolve(SUPERSEDED);
      const captured = captureDestructiveRequest(request);
      const run = capturePreparedRun(driver.prepareDuplicate(captured));
      return enqueue('duplicate', run);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeDriver?.();
      unsubscribeDriver = null;
      listeners.clear();
      driver.dispose();
    },
  };

  return Object.freeze(port);
}
