// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createRoot } from 'react-dom/client';

import {
  createBrowserDirectoryWorkspaceAccess,
  createIndexedDbBrowserDirectoryWorkspaceHandleStore,
  createInMemoryGeometryDocumentSession,
} from '../../../packages/geometry-document/src';
import {
  canonicalGeometrySchemaPort,
  configureGeometrySchemaAssetSource,
  createGeometryStore,
} from '../../../packages/geometry-editor/src';
import { CommunityGeometryEditorApp } from './CommunityGeometryEditorApp';
import {
  applyCommunityEditorAppearance,
  createCommunityGeometryStoreOptions,
} from './communityEditorConfig';
import { createCommunityGeometryEditorRuntime } from './communityGeometryEditorRuntime';
import { createCommunityGeometryWorkspaceResources } from './communityGeometryWorkspaceResources';
import { loadCommunitySchemaText } from './communitySchemaAssets';
import '../../../packages/geometry-editor/src/design-system.css';
import '../../../packages/geometry-editor/src/components/Badge.css';
import './community-app.css';

const workspaceResources = createCommunityGeometryWorkspaceResources();
applyCommunityEditorAppearance();
configureGeometrySchemaAssetSource({ loadText: loadCommunitySchemaText });
await Promise.all([
  canonicalGeometrySchemaPort.preload('core'),
  canonicalGeometrySchemaPort.preload('fhs'),
]);
const store = createGeometryStore({
  ...createCommunityGeometryStoreOptions(),
  defaultDefaultsPath: 'input/defaults/defaults_template.json',
  schemaPort: canonicalGeometrySchemaPort,
  workspaceResourcePort: workspaceResources.port,
});
const blankDocument = Object.freeze({
  fileName: 'draft_model.csv',
  text: store.getState().generateCSV(),
});
const session = createInMemoryGeometryDocumentSession({
  ...blankDocument,
  persisted: false,
});
const handleStore = createIndexedDbBrowserDirectoryWorkspaceHandleStore();
const workspaceAccess = createBrowserDirectoryWorkspaceAccess(globalThis, {
  handleStore,
});
const runtime = createCommunityGeometryEditorRuntime({
  workspaceAccess,
  session,
  blankDocument,
  store,
  workspaceResources,
});
const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Community geometry editor root element is missing');
}

createRoot(rootElement).render(
  <CommunityGeometryEditorApp runtime={runtime} store={store} />,
);
