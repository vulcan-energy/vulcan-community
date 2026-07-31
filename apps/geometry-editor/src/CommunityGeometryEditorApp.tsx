// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import {
  canonicalGeometrySchemaPort,
  DefaultsEditorModal,
  GeometryCanvas,
  GlobalSettingsModal,
  GeometryStoreProvider,
  inspectDefaultsCompatibility,
  type GlobalSettingsDefaultsCompatibility,
  type GlobalSettingsIndicator,
  type GeometryCanvasSelection,
  type GeometryStoreApi,
} from '../../../packages/geometry-editor/src';
import {
  GeometryEditorServicePortsProvider,
  type GeometryWorkspaceResourceListOptions,
  type GeometryWorkspaceResourcePort,
} from '../../../packages/geometry-editor-host/src';
import type { GeometryDocumentHostTarget } from '../../../packages/geometry-document/src';
import type { CommunityGeometryEditorRuntime } from './communityGeometryEditorRuntime';

export type CommunityGeometryEditorAppProps = Readonly<{
  runtime: CommunityGeometryEditorRuntime;
  store: GeometryStoreApi;
}>;

const COMMUNITY_GEOMETRY_VIEWPORT_INSETS = Object.freeze({
  desktopTopPx: 0,
  mobileTopPx: 0,
});

function documentTarget(
  documents: ReturnType<CommunityGeometryEditorRuntime['controller']['getSnapshot']>['documents'],
  fileName: string,
): GeometryDocumentHostTarget {
  const requestedStem = fileName.replace(/\.(?:csv|json)$/i, '');
  const document = documents.find((candidate) =>
    candidate.fileName === fileName ||
    candidate.fileName.replace(/\.(?:csv|json)$/i, '') === requestedStem);
  if (document === undefined) {
    throw new Error(`Community workspace document ${fileName} is unavailable`);
  }
  return Object.freeze({
    id: document.id,
    fileName: document.fileName,
    storageVersion: document.storageVersion,
  });
}

/**
 * Vanilla Community composition of the canonical editor. Ownership of the
 * supplied runtime transfers to this component for its mounted lifetime.
 */
export function CommunityGeometryEditorApp({
  runtime,
  store,
}: CommunityGeometryEditorAppProps) {
  const [selection, setSelection] = useState<GeometryCanvasSelection>(null);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [globalSettingsIndicator, setGlobalSettingsIndicator] =
    useState<GlobalSettingsIndicator | null>(null);
  const [defaultsEditor, setDefaultsEditor] = useState<Readonly<{
    path: string;
    compatibility: GlobalSettingsDefaultsCompatibility | undefined;
  }> | null>(null);
  const controllerSnapshot = useSyncExternalStore(
    runtime.controller.subscribe,
    runtime.controller.getSnapshot,
    runtime.controller.getSnapshot,
  );
  const bridgeSnapshot = useSyncExternalStore(
    runtime.documentBridge.subscribe,
    runtime.documentBridge.getSnapshot,
    runtime.documentBridge.getSnapshot,
  );
  const modelBuildSnapshot = useSyncExternalStore(
    runtime.modelBuild.subscribe,
    runtime.modelBuild.getSnapshot,
    runtime.modelBuild.getSnapshot,
  );
  const workspaceResourceSnapshot = useSyncExternalStore(
    runtime.workspaceResources.subscribe,
    runtime.workspaceResources.getSnapshot,
    runtime.workspaceResources.getSnapshot,
  );
  const defaultsPath = useSyncExternalStore(
    store.subscribe,
    () => store.getState().defaultsPath,
    () => store.getState().defaultsPath,
  );

  const workspaceResourcePort = useMemo<GeometryWorkspaceResourcePort>(() => {
    const port = runtime.workspaceResources.port;
    return Object.freeze({
      availability: workspaceResourceSnapshot.availability,
      readText: (path: string) => port.readText(path),
      readFile: (path: string) => port.readFile(path),
      writeText: (path: string, content: string) => port.writeText(path, content),
      writeBytes: (path: string, content: Blob | BufferSource) =>
        port.writeBytes(path, content),
      removeFile: (path: string) => port.removeFile(path),
      ensureDirectory: (path: string) => port.ensureDirectory(path),
      exists: (path: string) => port.exists(path),
      list: (path: string, options?: GeometryWorkspaceResourceListOptions) =>
        port.list(path, options),
    });
  }, [runtime.workspaceResources.port, workspaceResourceSnapshot]);

  useEffect(() => () => runtime.dispose(), [runtime]);

  const resolveDocumentTarget = useCallback(
    (fileName: string) => documentTarget(controllerSnapshot.documents, fileName),
    [controllerSnapshot.documents],
  );
  const bridgeError = bridgeSnapshot.status === 'error'
    ? bridgeSnapshot.error
    : null;
  const saveError = bridgeError !== null
    ? bridgeError.message
    : controllerSnapshot.error?.operation === 'save'
      ? controllerSnapshot.error.message
      : null;
  const saveErrorTitle = bridgeError?.operation === 'load'
    ? 'Open failed'
    : 'Save failed';
  const saveStatus = controllerSnapshot.operation === 'save'
    || modelBuildSnapshot.status === 'building'
    ? 'saving' as const
    : saveError !== null
      ? 'error' as const
      : controllerSnapshot.notice === 'Saved' && !controllerSnapshot.document.isDirty
        ? 'success' as const
        : 'idle' as const;
  const fileControls = useMemo(() => ({
    documentHost: runtime.documentHost,
    resolveDocumentTarget,
    saveStatus,
    saveError,
    buildError: modelBuildSnapshot.buildError,
    buildErrorItems: modelBuildSnapshot.buildErrorItems,
    fileNameExtension: '.csv',
    saveErrorTitle,
    onOpenDefaults: () => setGlobalSettingsOpen(true),
    defaultsPath,
    globalSettingsIndicator,
  }), [
    defaultsPath,
    globalSettingsIndicator,
    modelBuildSnapshot.buildError,
    modelBuildSnapshot.buildErrorItems,
    resolveDocumentTarget,
    runtime.documentHost,
    saveError,
    saveErrorTitle,
    saveStatus,
  ]);

  return (
    <GeometryStoreProvider store={store}>
      <GeometryEditorServicePortsProvider
        schemaPort={canonicalGeometrySchemaPort}
        workspaceResourcePort={workspaceResourcePort}
      >
        <div className="community-geometry-editor-shell">
          <GeometryCanvas
            selection={selection}
            setSelection={setSelection}
            viewportInsets={COMMUNITY_GEOMETRY_VIEWPORT_INSETS}
            initialElementsPanelPlacement="right"
            editorContributions={runtime.contributions}
            workspaceResourcePort={workspaceResourcePort}
            fileControls={fileControls}
          />
        </div>
        <GlobalSettingsModal
          isOpen={globalSettingsOpen}
          onClose={() => setGlobalSettingsOpen(false)}
          workspaceResourcePort={workspaceResourcePort}
          inspectDefaultsCompatibility={inspectDefaultsCompatibility}
          onEditDefaults={(path, compatibility) => {
            setDefaultsEditor(Object.freeze({ path, compatibility }));
          }}
          onIndicatorChange={setGlobalSettingsIndicator}
        />
        {defaultsEditor ? (
          <DefaultsEditorModal
            isOpen
            filePath={defaultsEditor.path}
            onClose={() => setDefaultsEditor(null)}
            defaultsCompatibility={defaultsEditor.compatibility}
            inspectCompatibility={inspectDefaultsCompatibility}
            onCommitted={(_merged, compatibility) => {
              setDefaultsEditor((current) => current === null
                ? null
                : Object.freeze({ ...current, compatibility }));
            }}
          />
        ) : null}
        <footer className="community-origin-link">
          <a
            href="https://usevulcan.app/open-source"
            target="_blank"
            rel="noreferrer"
          >
            Powered by Vulcan
          </a>
        </footer>
      </GeometryEditorServicePortsProvider>
    </GeometryStoreProvider>
  );
}
