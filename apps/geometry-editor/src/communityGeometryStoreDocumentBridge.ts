// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometryDocumentContents,
  GeometryDocumentHostDestructiveRequest,
  GeometryDocumentHostNewRequest,
  GeometryDocumentHostOpenRequest,
  GeometryDocumentHostPort,
  GeometryDocumentSession,
  GeometryDocumentSnapshot,
} from '../../../packages/geometry-document/src';
import { geometryDocumentContentsEqual } from '../../../packages/geometry-document/src/documentContents';
import type { GeometryStoreApi } from '../../../packages/geometry-editor/src/stores/geometryStore';
import { GEOMETRY_DIRTY_RECHECK_DEBOUNCE_MS } from '../../../packages/geometry-editor/src/lib/useGeometryDirty';

export type CommunityGeometryStoreDocumentBridgeOperation =
  | 'load'
  | 'serialize';

export class CommunityGeometryStoreDocumentBridgeError extends Error {
  readonly operation: CommunityGeometryStoreDocumentBridgeOperation;
  readonly cause: unknown;

  constructor(
    operation: CommunityGeometryStoreDocumentBridgeOperation,
    message: string,
    cause: unknown,
  ) {
    super(message);
    this.name = 'CommunityGeometryStoreDocumentBridgeError';
    this.operation = operation;
    this.cause = cause;
  }
}

export type CommunityGeometryStoreDocumentBridgeSnapshot =
  | Readonly<{ status: 'ready'; error: null }>
  | Readonly<{
      status: 'error';
      error: CommunityGeometryStoreDocumentBridgeError;
    }>;

export type CommunityGeometryStoreDocumentBridgeOptions = Readonly<{
  session: GeometryDocumentSession;
  store: GeometryStoreApi;
  documentHost: GeometryDocumentHostPort;
  prepareDocumentForEditor?: CommunityGeometryDocumentEditorPreparer;
}>;

export type CommunityGeometryDocumentEditorPreparer = (
  contents: GeometryDocumentContents,
) => GeometryDocumentContents;

export interface CommunityGeometryStoreDocumentBridge {
  readonly documentHost: GeometryDocumentHostPort;
  getSnapshot(): CommunityGeometryStoreDocumentBridgeSnapshot;
  subscribe(listener: () => void): () => void;
  flush(): GeometryDocumentSnapshot;
  dispose(): void;
}

const READY: CommunityGeometryStoreDocumentBridgeSnapshot = Object.freeze({
  status: 'ready',
  error: null,
});

function bridgeError(
  operation: CommunityGeometryStoreDocumentBridgeOperation,
  cause: unknown,
): CommunityGeometryStoreDocumentBridgeError {
  return new CommunityGeometryStoreDocumentBridgeError(
    operation,
    operation === 'load'
      ? 'The Community geometry document could not be loaded into the editor'
      : 'The Community geometry editor could not serialize the current document',
    cause,
  );
}

/**
 * Couples one public document session to one injected geometry store. The
 * bridge owns the supplied document host and exposes a flush-before-lifecycle
 * wrapper so the files controller always observes the latest canvas state.
 */
export function createCommunityGeometryStoreDocumentBridge(
  options: CommunityGeometryStoreDocumentBridgeOptions,
): CommunityGeometryStoreDocumentBridge {
  const {
    session,
    store,
    documentHost,
    prepareDocumentForEditor = (contents) => contents,
  } = options;
  const listeners = new Set<() => void>();
  let snapshot: CommunityGeometryStoreDocumentBridgeSnapshot = READY;
  let observedDocument = session.getSnapshot();
  let pendingWrite: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let loadingDocument = false;
  let writingSession = false;
  let storeMatchesDocument = false;

  const publish = () => {
    if (disposed) return;
    for (const listener of [...listeners]) listener();
  };

  const setError = (
    operation: CommunityGeometryStoreDocumentBridgeOperation,
    cause: unknown,
  ): CommunityGeometryStoreDocumentBridgeError => {
    const error = bridgeError(operation, cause);
    snapshot = Object.freeze({ status: 'error', error });
    publish();
    return error;
  };

  const clearError = () => {
    if (snapshot.status === 'ready') return;
    snapshot = READY;
    publish();
  };

  const cancelPendingWrite = () => {
    if (pendingWrite === null) return;
    clearTimeout(pendingWrite);
    pendingWrite = null;
  };

  const replaceSessionText = (
    document: GeometryDocumentSnapshot,
    text: string,
  ): GeometryDocumentSnapshot => {
    writingSession = true;
    try {
      return document.isDirty
        ? session.updateDocument({ text })
        : session.replaceDocument({
            fileName: document.fileName,
            text,
            derivedResources: document.derivedResources,
            sourceFiles: document.sourceFiles,
            persisted: true,
          });
    } finally {
      writingSession = false;
    }
  };

  const replaceSessionContents = (
    document: GeometryDocumentSnapshot,
    contents: GeometryDocumentContents,
  ): GeometryDocumentSnapshot => {
    writingSession = true;
    try {
      return document.isDirty
        ? session.updateDocument(contents)
        : session.replaceDocument({ ...contents, persisted: true });
    } finally {
      writingSession = false;
    }
  };

  const loadDocument = (document: GeometryDocumentSnapshot) => {
    cancelPendingWrite();
    loadingDocument = true;
    storeMatchesDocument = false;
    try {
      const preparedContents = prepareDocumentForEditor(document);
      const preparedDocument = geometryDocumentContentsEqual(
        preparedContents,
        document,
      )
        ? document
        : replaceSessionContents(document, preparedContents);
      store.getState().loadFromCSV(preparedDocument.text);
      const canonicalText = store.getState().generateCSV({ allowUnresolvedMigration: true });
      observedDocument = canonicalText === preparedDocument.text
        ? preparedDocument
        : replaceSessionText(preparedDocument, canonicalText);
      storeMatchesDocument = true;
      clearError();
    } catch (cause) {
      setError('load', cause);
    } finally {
      loadingDocument = false;
    }
  };

  const flush = (): GeometryDocumentSnapshot => {
    if (disposed) {
      throw new Error('Community geometry store-document bridge is disposed');
    }
    cancelPendingWrite();
    if (!storeMatchesDocument) {
      if (snapshot.status === 'error') throw snapshot.error;
      throw new Error('Community geometry store and document are not synchronized');
    }

    let text: string;
    try {
      text = store.getState().generateCSV({ allowUnresolvedMigration: true });
    } catch (cause) {
      throw setError('serialize', cause);
    }

    const currentDocument = session.getSnapshot();
    observedDocument = text === currentDocument.text
      ? currentDocument
      : (() => {
          writingSession = true;
          try {
            return session.updateDocument({ text });
          } finally {
            writingSession = false;
          }
        })();
    clearError();
    return observedDocument;
  };

  const scheduleWrite = () => {
    if (disposed || loadingDocument || !storeMatchesDocument) return;
    cancelPendingWrite();
    pendingWrite = setTimeout(() => {
      pendingWrite = null;
      try {
        flush();
      } catch {
        // The error is deliberately retained in the observable bridge snapshot.
      }
    }, GEOMETRY_DIRTY_RECHECK_DEBOUNCE_MS);
  };

  const unsubscribeStore = store.subscribe(scheduleWrite);
  const unsubscribeSession = session.subscribe((nextDocument) => {
    const previousDocument = observedDocument;
    observedDocument = nextDocument;
    if (disposed || writingSession) return;

    const textChanged = nextDocument.text !== previousDocument.text;
    const cleanReplacement =
      nextDocument.revision !== previousDocument.revision &&
      nextDocument.persistedRevision === nextDocument.revision;
    if (textChanged || cleanReplacement) {
      loadDocument(nextDocument);
      return;
    }

    if (
      !nextDocument.isDirty &&
      (previousDocument.isDirty ||
        previousDocument.persistedRevision !== nextDocument.persistedRevision)
    ) {
      loadingDocument = true;
      try {
        store.getState().setLastSavedCsv(nextDocument.text);
      } finally {
        loadingDocument = false;
      }
    }
  });

  loadDocument(observedDocument);

  const runAfterFlush = <Result>(run: () => Promise<Result>): Promise<Result> => {
    try {
      flush();
      return run();
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const saveCurrent = async () => {
    store.getState().requestCsvUpgrade();
    const savedText = store.getState().generateCSV(); // Save requires resolved legacy meaning.
    const upgrading = store.getState().csvUpgradeRequested && store.getState().sourceCsvVersion < 3;
    const document = flush();
    if (document.text !== savedText) {
      // Draft synchronization retains the source format until Save commits.
      writingSession = true;
      try {
        observedDocument = session.updateDocument({ text: savedText });
      } finally {
        writingSession = false;
      }
    }
    const savedRevision = session.getSnapshot().revision;
    const savedDraftText = upgrading ? store.getState().generateCSV({ allowUnresolvedMigration: true }) : undefined;
    const result = await documentHost.save();
    // Store edits reach the document session on a debounce. Compare the live
    // draft too, so a late save cannot acknowledge an edited U-value meaning.
    if (upgrading && result.status === 'completed' && session.getSnapshot().revision === savedRevision
      && store.getState().generateCSV({ allowUnresolvedMigration: true }) === savedDraftText) {
      store.setState({ sourceCsvVersion: 3, sourceProvenanceMarkersVersion: undefined, csvUpgradeRequested: false });
    }
    return result;
  };

  const saveBeforeReplacement = async (run: () => Promise<import('../../../packages/geometry-document/src').GeometryDocumentHostResult>) => {
    const result = await saveCurrent();
    if (result.status !== 'completed') return result;
    // The replacement uses Cancel if another edit became dirty while Save awaited.
    return runAfterFlush(run);
  };

  const bridgeHolder: { current: CommunityGeometryStoreDocumentBridge | null } = {
    current: null,
  };
  const bridgedDocumentHost: GeometryDocumentHostPort = Object.freeze({
    getSnapshot: () => documentHost.getSnapshot(),
    subscribe: (listener: () => void) => documentHost.subscribe(listener),
    updateFileName: (fileName: string) => documentHost.updateFileName(fileName),
    isDirty: () => documentHost.isDirty(),
    save: saveCurrent,
    newDocument: (request?: GeometryDocumentHostNewRequest) => request?.dirtyDecision === 'save'
      ? saveBeforeReplacement(() => documentHost.newDocument({ ...request, dirtyDecision: 'cancel' }))
      : runAfterFlush(() => documentHost.newDocument(request)),
    open: (request: GeometryDocumentHostOpenRequest) => request.dirtyDecision === 'save'
      ? saveBeforeReplacement(() => documentHost.open({ ...request, dirtyDecision: 'cancel' }))
      : runAfterFlush(() => documentHost.open(request)),
    delete: (request: GeometryDocumentHostDestructiveRequest) => request.dirtyDecision === 'save'
      ? saveBeforeReplacement(() => documentHost.delete({ ...request, dirtyDecision: 'cancel' }))
      : runAfterFlush(() => documentHost.delete(request)),
    duplicate: (request: GeometryDocumentHostDestructiveRequest) => request.dirtyDecision === 'save'
      ? saveBeforeReplacement(() => documentHost.duplicate({ ...request, dirtyDecision: 'cancel' }))
      : runAfterFlush(() => documentHost.duplicate(request)),
    dispose: () => bridgeHolder.current?.dispose(),
  });

  const bridge = Object.freeze({
    documentHost: bridgedDocumentHost,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    flush,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelPendingWrite();
      unsubscribeStore();
      unsubscribeSession();
      listeners.clear();
      documentHost.dispose();
    },
  });
  bridgeHolder.current = bridge;

  return bridge;
}
