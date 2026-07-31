// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createCommunityGeometryFilesController,
  type CommunityGeometryFilesController,
  type CommunityGeometryFilesControllerOptions,
  type GeometryDocumentHostPort,
} from '../../../packages/geometry-document/src';
import {
  CommunityGeometryFilesAction,
  type CommunityGeometryDownloadHandler,
} from './CommunityGeometryFilesAction';
import { createCommunityGeometryDocumentHost } from './communityGeometryDocumentHost';
import {
  createCommunityGeometryStoreDocumentBridge,
  type CommunityGeometryStoreDocumentBridge,
} from './communityGeometryStoreDocumentBridge';
import { createCommunityGeometryEditorContributions } from './editorContributions';
import type { GeometryStoreApi } from '../../../packages/geometry-editor/src/stores/geometryStore';
import {
  createCommunityGeometryWorkspaceAccess,
  type CommunityGeometryWorkspaceResources,
} from './communityGeometryWorkspaceResources';
import { projectEditorGeometryDocumentToDurable } from './geometryDocumentResourceProjection';
import { installCommunityStarterWorkspace } from './communityStarterWorkspace';
import {
  createCommunityModelBuildDocumentHost,
  type CommunityModelBuildDocumentHost,
  type CommunityModelBuilder,
} from './communityModelBuildDocumentHost';
import { createCommunityModelWorkerBuilder } from './communityModelWorkerClient';
import { loadCommunitySchemaText } from './communitySchemaAssets';

export type CommunityGeometryEditorRuntimeOptions =
  CommunityGeometryFilesControllerOptions & Readonly<{
    store: GeometryStoreApi;
    workspaceResources: CommunityGeometryWorkspaceResources;
    onDownload?: CommunityGeometryDownloadHandler;
    onImportCad?: () => void;
    modelBuilder?: CommunityModelBuilder;
  }>;

export type CommunityGeometryEditorRuntime = Readonly<{
  controller: CommunityGeometryFilesController;
  documentHost: GeometryDocumentHostPort;
  documentBridge: CommunityGeometryStoreDocumentBridge;
  modelBuild: CommunityModelBuildDocumentHost;
  workspaceResources: CommunityGeometryWorkspaceResources;
  contributions: ReturnType<typeof createCommunityGeometryEditorContributions>;
  dispose(): void;
}>;

/** Creates all per-mount Community document state; no process-wide singleton is used. */
export function createCommunityGeometryEditorRuntime(
  options: CommunityGeometryEditorRuntimeOptions,
): CommunityGeometryEditorRuntime {
  const { workspaceResources } = options;
  const workspaceAccess = createCommunityGeometryWorkspaceAccess({
    access: options.workspaceAccess,
    resources: workspaceResources,
    initializeConnectedWorkspace: installCommunityStarterWorkspace,
  });
  const controller = createCommunityGeometryFilesController({
    workspaceAccess,
    session: options.session,
    ...(options.blankDocument === undefined
      ? {}
      : { blankDocument: options.blankDocument }),
  });
  const documentHost = createCommunityGeometryDocumentHost({
    controller,
    session: options.session,
  });
  const documentBridge = createCommunityGeometryStoreDocumentBridge({
    documentHost,
    session: options.session,
    store: options.store,
    prepareDocumentForEditor: workspaceResources.activateDocument,
  });
  const modelBuild = createCommunityModelBuildDocumentHost({
    documentHost: documentBridge.documentHost,
    flush: documentBridge.flush,
    session: options.session,
    workspaceResourcePort: workspaceResources.port,
    getDefaultsPath: () => options.store.getState().defaultsPath,
    getProfile: () => options.store.getState().complianceSettings
      .complianceValidationEnabled === true ? 'fhs' : 'core',
    loadSchemaText: loadCommunitySchemaText,
    builder: options.modelBuilder ?? createCommunityModelWorkerBuilder(),
  });
  const contributions = createCommunityGeometryEditorContributions({
    renderFilesAction: () => (
      <CommunityGeometryFilesAction
        controller={controller}
        documentHost={modelBuild.documentHost}
        flushDocument={documentBridge.flush}
        preparePortableDocument={(contents) =>
          projectEditorGeometryDocumentToDurable(
            contents,
            workspaceResources.port,
          )}
        onDownload={options.onDownload}
        onImportCad={options.onImportCad}
      />
    ),
  });
  return Object.freeze({
    controller,
    documentHost: modelBuild.documentHost,
    documentBridge,
    modelBuild,
    workspaceResources,
    contributions,
    dispose: () => {
      modelBuild.documentHost.dispose();
      workspaceResources.unbind();
      workspaceResources.clearDocumentResources();
    },
  });
}
