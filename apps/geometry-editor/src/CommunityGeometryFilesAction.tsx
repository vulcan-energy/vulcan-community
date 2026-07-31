// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  createGeometryDocumentDownload,
  createPortableGeometryDocumentDownload,
  readGeometryDocumentUpload,
  readPortableGeometryDocumentUpload,
  toPortableGeometryDocument,
  type CommunityGeometryFilesController,
  type GeometryDocumentContents,
  type GeometryDocumentDirtyDecision,
  type GeometryDocumentHostPort,
  type GeometryDocumentSnapshot,
} from '../../../packages/geometry-document/src';
import {
  GeometryFilesMenu,
  GeometryPortableDownloadDialog,
  type GeometryFilesMenuDocument,
  type GeometryPortableDownloadSource,
} from '../../../packages/geometry-document-ui/src';
import { CommunityIfcImportDialog } from './CommunityIfcImportDialog';

export type CommunityGeometryDownload = Readonly<{
  blob: Blob;
  suggestedFileName: string;
  includedSourceFileIds?: readonly string[];
}>;

export type CommunityGeometryDownloadHandler = (
  download: CommunityGeometryDownload,
) => void;

export type CommunityGeometryPortableDocumentPreparer = (
  contents: GeometryDocumentContents,
) => Promise<GeometryDocumentContents>;

export type CommunityGeometryFilesActionProps = Readonly<{
  controller: CommunityGeometryFilesController;
  documentHost: GeometryDocumentHostPort;
  flushDocument: () => GeometryDocumentSnapshot;
  preparePortableDocument?: CommunityGeometryPortableDocumentPreparer;
  onDownload?: CommunityGeometryDownloadHandler;
  onImportCad?: () => void;
}>;

type DirtyOperation = Readonly<{
  run: (decision: GeometryDocumentDirtyDecision) => Promise<unknown>;
}>;

type PortableDownloadRequest = Readonly<{
  contents: GeometryDocumentContents;
  sources: readonly GeometryPortableDownloadSource[];
}>;

function browserDownload(download: CommunityGeometryDownload): void {
  if (typeof document === 'undefined') {
    throw new Error('Browser download is unavailable outside a document');
  }
  const createObjectUrl = globalThis.URL?.createObjectURL;
  const revokeObjectUrl = globalThis.URL?.revokeObjectURL;
  if (typeof createObjectUrl !== 'function' || typeof revokeObjectUrl !== 'function') {
    throw new Error('Browser Blob downloads are not supported');
  }
  const url = createObjectUrl.call(globalThis.URL, download.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = download.suggestedFileName;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    revokeObjectUrl.call(globalThis.URL, url);
  }
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : 'The requested local file operation failed';
}

const preparePortableDocumentIdentity: CommunityGeometryPortableDocumentPreparer =
  async (contents) => contents;

function conflictMessage(
  conflict: ReturnType<CommunityGeometryFilesController['getSnapshot']>['activeConflict'],
): string | null {
  if (conflict === null) return null;
  return conflict.kind === 'changed'
    ? 'The open model changed in the local workspace. Refresh before reopening or saving it.'
    : 'The open model was deleted from the local workspace. Save it as a new model or open another one.';
}

function documentReference(document: GeometryFilesMenuDocument) {
  return Object.freeze({
    id: document.id,
    storageVersion: document.storageVersion,
  });
}

function documentTarget(document: GeometryFilesMenuDocument) {
  return Object.freeze({
    id: document.id,
    fileName: document.fileName,
    storageVersion: document.storageVersion,
  });
}

export function CommunityGeometryFilesAction({
  controller,
  documentHost,
  flushDocument,
  preparePortableDocument = preparePortableDocumentIdentity,
  onDownload = browserDownload,
  onImportCad,
}: CommunityGeometryFilesActionProps) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const documentHostSnapshot = useSyncExternalStore(
    documentHost.subscribe,
    documentHost.getSnapshot,
    documentHost.getSnapshot,
  );
  const [pendingDirtyOperation, setPendingDirtyOperation] =
    useState<DirtyOperation | null>(null);
  const [portableDownloadRequest, setPortableDownloadRequest] =
    useState<PortableDownloadRequest | null>(null);
  const [ifcImportOpen, setIfcImportOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const restoreControllerRef = useRef<CommunityGeometryFilesController | null>(null);

  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setLocalError(null);
    setLocalNotice(null);
    try {
      await operation();
    } catch (error) {
      setLocalError(messageFromUnknown(error));
    }
  }, []);

  const flushForAction = useCallback((): GeometryDocumentSnapshot | null => {
    setLocalError(null);
    setLocalNotice(null);
    try {
      return flushDocument();
    } catch (error) {
      setLocalError(messageFromUnknown(error));
      return null;
    }
  }, [flushDocument]);

  const beginDirtyAware = useCallback((
    operation: (decision?: GeometryDocumentDirtyDecision) => Promise<unknown>,
    operationAffectsActiveDocument = true,
  ) => {
    const currentDocument = flushForAction();
    if (currentDocument === null) return;
    if (operationAffectsActiveDocument && currentDocument.isDirty) {
      setPendingDirtyOperation(Object.freeze({
        run: (decision) => operation(decision),
      }));
      return;
    }
    void run(() => operation());
  }, [flushForAction, run]);

  useEffect(() => {
    if (
      snapshot.workspace.status !== 'disconnected' ||
      restoreControllerRef.current === controller
    ) {
      return;
    }
    restoreControllerRef.current = controller;
    void run(() => controller.restoreWorkspace());
  }, [controller, run, snapshot.workspace.status]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      try {
        if (!flushDocument().isDirty) return;
      } catch {
        // A document that cannot be serialized is not safe to abandon.
      }
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushDocument]);

  const importContents = useCallback((contents: GeometryDocumentContents) => {
    beginDirtyAware((dirtyDecision) => documentHost.newDocument({
      contents,
      ...(dirtyDecision === undefined ? {} : { dirtyDecision }),
    }));
  }, [beginDirtyAware, documentHost]);

  const openIfcImporter = useCallback(() => setIfcImportOpen(true), []);

  const readAndImport = useCallback(async (
    read: () => Promise<GeometryDocumentContents>,
  ) => {
    setLocalError(null);
    setLocalNotice(null);
    try {
      importContents(await read());
    } catch (error) {
      setLocalError(messageFromUnknown(error));
    }
  }, [importContents]);

  const downloadPortable = useCallback(async (
    request: PortableDownloadRequest,
    includeSourceFileIds: readonly string[],
  ) => {
    const download = await createPortableGeometryDocumentDownload(
      toPortableGeometryDocument(request.contents),
      { includeSourceFileIds },
    );
    onDownload(download);
    setLocalNotice(`Downloaded ${download.suggestedFileName}`);
  }, [onDownload]);

  const beginPortableDownload = useCallback(() => {
    const editorContents = flushForAction();
    if (editorContents === null) return;
    void run(async () => {
      // Raw CSV remains workspace-relative. Portable documents must replace
      // those paths with typed, self-contained resources before encoding.
      const contents = await preparePortableDocument(editorContents);
      const sources = Object.freeze(
        contents.sourceFiles.map((source) => Object.freeze({
          id: source.id,
          fileName: source.fileName,
          role: source.role,
        })),
      );
      const request = Object.freeze({ contents, sources });
      if (sources.length === 0) {
        await downloadPortable(request, Object.freeze([]));
        return;
      }
      setPortableDownloadRequest(request);
    });
  }, [downloadPortable, flushForAction, preparePortableDocument, run]);

  const connected = snapshot.workspace.status === 'connected';
  const projectPanel = useMemo(() => {
    if (snapshot.workspace.status === 'connected') {
      return Object.freeze({ status: 'ready' as const });
    }
    if (snapshot.workspace.status === 'restoring') {
      return Object.freeze({ status: 'loading' as const });
    }
    return Object.freeze({
      status: 'workspace-required' as const,
      message: 'This draft stays in this tab until you save it. Save or choose a dedicated workspace folder to keep, reopen and organise local models.',
    });
  }, [snapshot.workspace.status]);
  const dirtyDialog = pendingDirtyOperation === null ? null : Object.freeze({
    title: 'Save changes?',
    message: 'Save this model before continuing, discard its unsaved changes, or cancel.',
    onSave: () => {
      const pending = pendingDirtyOperation;
      setPendingDirtyOperation(null);
      void run(() => pending.run('save'));
    },
    onDiscard: () => {
      const pending = pendingDirtyOperation;
      setPendingDirtyOperation(null);
      void run(() => pending.run('discard'));
    },
    onCancel: () => setPendingDirtyOperation(null),
  });

  return (
    <>
      <GeometryFilesMenu
        workspace={snapshot.workspace}
        documents={snapshot.documents}
        projects={snapshot.projects}
        activeDocumentId={documentHostSnapshot.activeDocument?.id ?? null}
        search={snapshot.search}
        filter={snapshot.filter}
        projectPanel={projectPanel}
        isLoading={snapshot.isLoading}
        isBusy={snapshot.isBusy || documentHostSnapshot.operation !== null}
        error={localError ?? snapshot.error?.message ?? null}
        notice={localNotice ?? snapshot.notice}
        activeConflict={conflictMessage(snapshot.activeConflict)}
        dirtyDialog={dirtyDialog}
        onChooseWorkspace={snapshot.workspace.canChoose
          ? () => void run(() => controller.chooseWorkspace())
          : undefined}
        onReconnectWorkspace={snapshot.workspace.status === 'permission-required'
          ? () => void run(() => controller.reconnectWorkspace())
          : undefined}
        onChangeWorkspace={connected && snapshot.workspace.canChoose
          ? () => beginDirtyAware((dirtyDecision) => controller.changeWorkspace(
              dirtyDecision === undefined ? {} : { dirtyDecision },
            ))
          : undefined}
        onDisconnectWorkspace={connected
          ? () => beginDirtyAware((dirtyDecision) => controller.disconnectWorkspace(
              dirtyDecision === undefined ? {} : { dirtyDecision },
            ))
          : undefined}
        onRefresh={connected ? () => void run(() => controller.refresh()) : undefined}
        onSearchChange={(search) => controller.setSearch(search)}
        onFilterChange={(filter) => controller.setFilter(filter)}
        onOpenDocument={(document) => beginDirtyAware((dirtyDecision) =>
          documentHost.open({
            target: documentTarget(document),
            ...(dirtyDecision === undefined ? {} : { dirtyDecision }),
          }))}
        onDuplicateDocument={connected
          ? (document) => beginDirtyAware((dirtyDecision) =>
              documentHost.duplicate({
                target: documentTarget(document),
                confirmed: true,
                ...(dirtyDecision === undefined ? {} : { dirtyDecision }),
              }))
          : undefined}
        onDeleteDocument={connected
          ? (document) => beginDirtyAware(
              (dirtyDecision) => documentHost.delete({
                target: documentTarget(document),
                confirmed: true,
                ...(dirtyDecision === undefined ? {} : { dirtyDecision }),
              }),
              document.id === documentHostSnapshot.activeDocument?.id,
            )
          : undefined}
        onSetDocumentMembership={connected
          ? (document, projectGroupIds) => void run(() =>
              controller.setDocumentMembership({
                document: documentReference(document),
                projectGroupIds,
              }))
          : undefined}
        onCreateProject={connected
          ? (input) => void run(() => controller.createProject(input))
          : undefined}
        onRenameProject={connected
          ? (project, input) => void run(() => controller.updateProject({
              project: { id: project.id, storageVersion: project.storageVersion },
              name: input.name,
              description: input.description,
            }))
          : undefined}
        onDeleteProject={connected
          ? (project) => void run(() => controller.deleteProject({
              project: { id: project.id, storageVersion: project.storageVersion },
              confirmed: true,
            }))
          : undefined}
        onNewDocument={() => beginDirtyAware((dirtyDecision) =>
          documentHost.newDocument(
            dirtyDecision === undefined ? {} : { dirtyDecision },
          ))}
        onImportCsv={(files) => void readAndImport(async () => {
          const model = await readGeometryDocumentUpload(files);
          return Object.freeze({
            ...model,
            derivedResources: Object.freeze([]),
            sourceFiles: Object.freeze([]),
          });
        })}
        onOpenPortable={(files) => void readAndImport(async () => {
          const portable = await readPortableGeometryDocumentUpload(files);
          return Object.freeze({
            fileName: portable.model.fileName,
            text: portable.model.text,
            derivedResources: portable.derivedResources,
            sourceFiles: portable.sourceFiles,
          });
        })}
        onDownloadCsv={() => {
          void run(async () => {
            const contents = flushDocument();
            const download = createGeometryDocumentDownload(
              contents,
            );
            onDownload(download);
            setLocalNotice(`Downloaded ${download.suggestedFileName}`);
          });
        }}
        onDownloadPortable={beginPortableDownload}
        onImportCad={onImportCad ?? openIfcImporter}
      />
      {ifcImportOpen ? (
        <CommunityIfcImportDialog
          isOpen
          onClose={() => setIfcImportOpen(false)}
          onImport={(portable) => importContents(Object.freeze({
            fileName: portable.model.fileName,
            text: portable.model.text,
            derivedResources: portable.derivedResources,
            sourceFiles: portable.sourceFiles,
          }))}
        />
      ) : null}
      {portableDownloadRequest ? (
        <GeometryPortableDownloadDialog
          sources={portableDownloadRequest.sources}
          onCancel={() => setPortableDownloadRequest(null)}
          onDownload={(includeSourceFileIds) => {
            const request = portableDownloadRequest;
            setPortableDownloadRequest(null);
            void run(() => downloadPortable(request, includeSourceFileIds));
          }}
        />
      ) : null}
    </>
  );
}
