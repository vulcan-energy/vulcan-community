// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  BrowserDirectoryWorkspaceError,
  CommunityGeometryFilesControllerError,
  createCommunityGeometryFilesController,
  createInMemoryGeometryDocumentSession,
  createInMemoryGeometryWorkspaceProvider,
  type BrowserDirectoryWorkspaceAccess,
  type BrowserDirectoryWorkspaceConnected,
  type GeometryDocumentInput,
  type GeometryWorkspaceProvider,
} from '../index';

const BLANK_DOCUMENT = Object.freeze({
  fileName: 'Untitled.csv',
  text: '',
});

function createIdSequence() {
  let documentId = 1;
  let projectId = 1;
  return (kind: 'document' | 'project-group') =>
    kind === 'document'
      ? `document-${documentId++}`
      : `project-${projectId++}`;
}

function createProvider(
  id: string,
  options: Readonly<{
    documents?: readonly Readonly<{
      id: string;
      contents: GeometryDocumentInput;
      projectGroupIds?: readonly string[];
    }>[];
    projects?: readonly Readonly<{
      id: string;
      name: string;
      description?: string;
    }>[];
  }> = {},
) {
  return createInMemoryGeometryWorkspaceProvider({
    id,
    createId: createIdSequence(),
    documents: options.documents,
    projectGroups: options.projects,
  });
}

function connected(
  directoryName: string,
  provider: GeometryWorkspaceProvider,
): BrowserDirectoryWorkspaceConnected {
  return Object.freeze({
    status: 'connected',
    binding: Object.freeze({
      directoryName,
      workspaceId: provider.id,
    }),
    provider,
  });
}

function createAccess(
  overrides: Partial<BrowserDirectoryWorkspaceAccess> = {},
): BrowserDirectoryWorkspaceAccess {
  return {
    capabilities: Object.freeze({ choose: true, restore: true }),
    choose: vi.fn(async () => ({ status: 'cancelled' as const })),
    restore: vi.fn(async () => ({ status: 'not-remembered' as const })),
    reconnect: vi.fn(async () => ({ status: 'not-remembered' as const })),
    forget: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createCleanSession(contents: GeometryDocumentInput = BLANK_DOCUMENT) {
  return createInMemoryGeometryDocumentSession({
    ...contents,
    persisted: true,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('Community geometry files controller', () => {
  it('starts with one clean disconnected draft and publishes stable frozen snapshots', () => {
    const session = createCleanSession();
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess(),
      session,
      blankDocument: BLANK_DOCUMENT,
    });
    const first = controller.getSnapshot();

    expect(first).toMatchObject({
      workspace: { status: 'disconnected', canChoose: true },
      activeDocument: null,
      activeDocumentId: null,
      search: '',
      filter: { kind: 'all' },
      isBusy: false,
      isLoading: false,
      operation: null,
      error: null,
      activeConflict: null,
      document: { fileName: 'Untitled.csv', text: '', isDirty: false },
      documents: [],
      projects: [],
      visibleDocuments: [],
    });
    expect(Reflect.ownKeys(first.workspace)).toEqual(['status', 'canChoose']);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.workspace)).toBe(true);
    expect(Object.isFrozen(first.documents)).toBe(true);
    expect(controller.getSnapshot()).toBe(first);

    const subscriber = vi.fn();
    const unsubscribe = controller.subscribe(subscriber);
    controller.setSearch('  model  ');
    const searched = controller.getSnapshot();
    expect(searched).not.toBe(first);
    expect(searched.search).toBe('  model  ');
    expect(subscriber).toHaveBeenCalledOnce();
    controller.setSearch('  model  ');
    expect(controller.getSnapshot()).toBe(searched);
    expect(subscriber).toHaveBeenCalledOnce();
    unsubscribe();
    controller.dispose();
  });

  it('restores without prompting, exposes only a safe directory name, then reconnects explicitly', async () => {
    const provider = createProvider('workspace-restore', {
      documents: [
        {
          id: 'document-a',
          contents: { fileName: 'Model A.csv', text: 'a,b\n' },
        },
      ],
    });
    const access = createAccess({
      restore: vi.fn(async () => ({
        status: 'permission-required' as const,
        directoryName: 'Community models',
      })),
      reconnect: vi.fn(async () => connected('Community models', provider)),
    });
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: access,
      session: createCleanSession(),
      blankDocument: BLANK_DOCUMENT,
    });

    await expect(controller.restoreWorkspace()).resolves.toEqual({
      status: 'completed',
    });
    expect(controller.getSnapshot().workspace).toEqual({
      status: 'permission-required',
      canChoose: true,
      directoryName: 'Community models',
    });
    expect(access.reconnect).not.toHaveBeenCalled();

    await expect(controller.reconnectWorkspace()).resolves.toEqual({
      status: 'completed',
    });
    const snapshot = controller.getSnapshot();
    expect(snapshot.workspace).toEqual({
      status: 'connected',
      canChoose: true,
      directoryName: 'Community models',
    });
    expect(Reflect.ownKeys(snapshot.workspace)).toEqual([
      'status',
      'canChoose',
      'directoryName',
    ]);
    expect(JSON.stringify(snapshot.workspace)).not.toContain(provider.id);
    expect(snapshot.documents.map((entry) => entry.id)).toEqual(['document-a']);
  });

  it('chooses and changes folders transactionally while retaining the previous connection on cancellation or failure', async () => {
    const providerA = createProvider('workspace-a');
    const providerB = createProvider('workspace-b');
    const choose = vi
      .fn<BrowserDirectoryWorkspaceAccess['choose']>()
      .mockResolvedValueOnce(connected('Folder A', providerA))
      .mockResolvedValueOnce({ status: 'cancelled' })
      .mockResolvedValueOnce(connected('Folder B', {
        ...providerB,
        getSnapshot: vi.fn(async () => {
          throw new BrowserDirectoryWorkspaceError(
            'workspace-corrupt',
            'The selected workspace is corrupt',
          );
        }),
      }));
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({ choose }),
      session: createCleanSession(),
      blankDocument: BLANK_DOCUMENT,
    });

    await controller.chooseWorkspace();
    const connectedA = controller.getSnapshot();
    await expect(controller.changeWorkspace()).resolves.toEqual({
      status: 'cancelled',
    });
    expect(controller.getSnapshot().workspace).toEqual(connectedA.workspace);

    await expect(controller.changeWorkspace()).rejects.toMatchObject({
      code: 'workspace-corrupt',
    });
    expect(controller.getSnapshot().workspace).toEqual(connectedA.workspace);
    expect(controller.getSnapshot().error).toMatchObject({
      source: 'workspace-access',
      code: 'workspace-corrupt',
    });
  });

  it('uses Save, Discard or Cancel before switching a dirty document', async () => {
    const providerA = createProvider('workspace-dirty-a');
    const providerB = createProvider('workspace-dirty-b');
    const choose = vi
      .fn<BrowserDirectoryWorkspaceAccess['choose']>()
      .mockResolvedValueOnce(connected('Folder A', providerA))
      .mockResolvedValueOnce(connected('Folder B', providerB));
    const session = createCleanSession({ fileName: 'Draft.csv', text: 'old\n' });
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({ choose }),
      session,
      blankDocument: BLANK_DOCUMENT,
    });
    await controller.chooseWorkspace();
    session.updateDocument({ text: 'dirty\n' });

    await expect(controller.changeWorkspace()).rejects.toMatchObject({
      code: 'dirty-decision-required',
    });
    await expect(
      controller.changeWorkspace({ dirtyDecision: 'cancel' }),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(choose).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({ text: 'dirty\n', isDirty: true });

    await expect(
      controller.changeWorkspace({ dirtyDecision: 'save' }),
    ).resolves.toEqual({ status: 'completed' });
    expect(controller.getSnapshot().workspace).toMatchObject({
      status: 'connected',
      directoryName: 'Folder B',
    });
    expect(session.getSnapshot().isDirty).toBe(false);
    await expect(providerA.getSnapshot()).resolves.toMatchObject({
      documents: [expect.objectContaining({ fileName: 'Draft.csv' })],
    });
    expect((await providerB.getSnapshot()).documents).toEqual([]);
  });

  it('connects a first folder without replacing or prompting for an uncatalogued dirty draft', async () => {
    const provider = createProvider('workspace-first-connect');
    const session = createCleanSession({ fileName: 'Draft.csv', text: 'base\n' });
    session.updateDocument({ text: 'unsaved local draft\n' });
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({
        choose: vi.fn(async () => connected('First folder', provider)),
      }),
      session,
      blankDocument: BLANK_DOCUMENT,
    });

    await expect(controller.chooseWorkspace()).resolves.toEqual({
      status: 'completed',
    });
    expect(controller.getSnapshot()).toMatchObject({
      workspace: { status: 'connected', directoryName: 'First folder' },
      activeDocument: null,
      document: { text: 'unsaved local draft\n', isDirty: true },
    });
    expect((await provider.getSnapshot()).documents).toEqual([]);
  });

  it('restores discarded dirty contents when the change-folder picker is cancelled', async () => {
    const provider = createProvider('workspace-discard-cancel');
    const choose = vi
      .fn<BrowserDirectoryWorkspaceAccess['choose']>()
      .mockResolvedValueOnce(connected('Current folder', provider))
      .mockResolvedValueOnce({ status: 'cancelled' });
    const session = createCleanSession({ fileName: 'Draft.csv', text: 'base\n' });
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({ choose }),
      session,
      blankDocument: BLANK_DOCUMENT,
    });
    await controller.chooseWorkspace();
    session.updateDocument({ text: 'keep this dirty edit\n' });

    await expect(
      controller.changeWorkspace({ dirtyDecision: 'discard' }),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(controller.getSnapshot()).toMatchObject({
      workspace: { status: 'connected', directoryName: 'Current folder' },
      document: { text: 'keep this dirty edit\n', isDirty: true },
    });
  });

  it('chooses a folder on first Save, preserves a dirty draft on picker cancellation, and creates the document exactly once', async () => {
    const provider = createProvider('workspace-first-save');
    const choose = vi
      .fn<BrowserDirectoryWorkspaceAccess['choose']>()
      .mockResolvedValueOnce({ status: 'cancelled' })
      .mockResolvedValueOnce(connected('My models', provider));
    const session = createCleanSession({ fileName: 'First.csv', text: 'base\n' });
    session.updateDocument({ text: 'edited\n' });
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({ choose }),
      session,
      blankDocument: BLANK_DOCUMENT,
    });

    await expect(controller.save()).resolves.toEqual({ status: 'cancelled' });
    expect(session.getSnapshot()).toMatchObject({ text: 'edited\n', isDirty: true });
    expect(controller.getSnapshot().workspace.status).toBe('disconnected');

    await expect(controller.save()).resolves.toEqual({ status: 'completed' });
    expect(session.getSnapshot().isDirty).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      activeDocumentId: 'document-1',
      notice: 'Saved',
      documents: [expect.objectContaining({ id: 'document-1', fileName: 'First.csv' })],
    });
    expect((await provider.getSnapshot()).documents).toHaveLength(1);
  });

  it('treats new and imported documents as clean exchange baselines and never prompts immediately', async () => {
    const session = createCleanSession({ fileName: 'Before.csv', text: 'before\n' });
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess(),
      session,
      blankDocument: BLANK_DOCUMENT,
    });

    await expect(
      controller.importDocument({
        contents: { fileName: 'Imported.csv', text: 'imported\n' },
      }),
    ).resolves.toEqual({ status: 'completed' });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Imported.csv',
      text: 'imported\n',
      isDirty: false,
    });

    session.updateDocument({ text: 'edited imported\n' });
    await expect(controller.newDocument()).rejects.toMatchObject({
      code: 'dirty-decision-required',
    });
    await expect(
      controller.newDocument({ dirtyDecision: 'cancel' }),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(session.getSnapshot().text).toBe('edited imported\n');
    await expect(
      controller.newDocument({ dirtyDecision: 'discard' }),
    ).resolves.toEqual({ status: 'completed' });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Untitled.csv',
      text: '',
      isDirty: false,
    });
  });

  it('keeps the old catalogue visible while refreshing and flags an active external version without replacing local contents', async () => {
    const baseProvider = createProvider('workspace-refresh', {
      documents: [
        {
          id: 'document-active',
          contents: { fileName: 'Active.csv', text: 'stored v1\n' },
        },
      ],
    });
    const refreshGate = deferred<Awaited<ReturnType<GeometryWorkspaceProvider['getSnapshot']>>>();
    let reads = 0;
    const provider: GeometryWorkspaceProvider = {
      ...baseProvider,
      getSnapshot: vi.fn(() => {
        reads += 1;
        return reads === 1 ? baseProvider.getSnapshot() : refreshGate.promise;
      }),
    };
    const session = createCleanSession();
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({
        choose: vi.fn(async () => connected('Refresh folder', provider)),
      }),
      session,
      blankDocument: BLANK_DOCUMENT,
    });
    await controller.chooseWorkspace();
    const firstEntry = controller.getSnapshot().documents[0]!;
    await controller.openDocument({ document: firstEntry });
    session.updateDocument({ text: 'unsaved local edit\n' });

    const external = await baseProvider.documents.update({
      id: firstEntry.id,
      expectedStorageVersion: firstEntry.storageVersion,
      contents: { fileName: 'Active.csv', text: 'stored v2\n' },
      sessionRevision: 99,
    });
    const pendingRefresh = controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      isLoading: true,
      documents: [expect.objectContaining({ storageVersion: firstEntry.storageVersion })],
      document: { text: 'unsaved local edit\n', isDirty: true },
    });
    refreshGate.resolve(external.snapshot);
    await pendingRefresh;

    const refreshed = controller.getSnapshot();
    expect(refreshed.documents[0]!.storageVersion).toBe(
      external.entry.storageVersion,
    );
    expect(refreshed.activeDocument).toEqual(firstEntry);
    expect(refreshed.activeConflict).toEqual({
      kind: 'changed',
      documentId: firstEntry.id,
      loadedStorageVersion: firstEntry.storageVersion,
      availableStorageVersion: external.entry.storageVersion,
    });
    expect(session.getSnapshot()).toMatchObject({
      text: 'unsaved local edit\n',
      isDirty: true,
    });

    await controller.openDocument({
      document: external.entry,
      dirtyDecision: 'discard',
    });
    expect(controller.getSnapshot().activeConflict).toBeNull();
    expect(session.getSnapshot()).toMatchObject({ text: 'stored v2\n', isDirty: false });
  });

  it('requires exact current opaque id and storage-version references for row and project mutations', async () => {
    const baseProvider = createProvider('workspace-cas-ui', {
      documents: [
        {
          id: 'document-a',
          contents: { fileName: 'A.csv', text: 'a\n' },
        },
      ],
      projects: [{ id: 'project-a', name: 'Project A' }],
    });
    const open = vi.fn(baseProvider.documents.open);
    const duplicate = vi.fn(baseProvider.documents.duplicate);
    const remove = vi.fn(baseProvider.documents.delete);
    const updateProject = vi.fn(baseProvider.projectGroups.update);
    const provider: GeometryWorkspaceProvider = {
      ...baseProvider,
      documents: { ...baseProvider.documents, open, duplicate, delete: remove },
      projectGroups: { ...baseProvider.projectGroups, update: updateProject },
    };
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({
        choose: vi.fn(async () => connected('CAS folder', provider)),
      }),
      session: createCleanSession(),
      blankDocument: BLANK_DOCUMENT,
    });
    await controller.chooseWorkspace();
    const document = controller.getSnapshot().documents[0]!;
    const project = controller.getSnapshot().projects[0]!;
    const staleDocument = { ...document, storageVersion: 'document:stale' };
    const staleProject = { ...project, storageVersion: 'project-group:stale' };

    await expect(
      controller.openDocument({ document: staleDocument }),
    ).rejects.toMatchObject({ code: 'stale-document' });
    await expect(
      controller.duplicateDocument({ document: staleDocument, confirmed: true }),
    ).rejects.toMatchObject({ code: 'stale-document' });
    await expect(
      controller.deleteDocument({ document: staleDocument, confirmed: true }),
    ).rejects.toMatchObject({ code: 'stale-document' });
    await expect(
      controller.updateProject({ project: staleProject, name: 'Changed' }),
    ).rejects.toMatchObject({ code: 'stale-project' });
    expect(open).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toMatchObject({
      source: 'controller',
      code: 'stale-project',
    });
  });

  it('does not replace a newer local edit when an in-flight open becomes stale', async () => {
    const baseProvider = createProvider('workspace-stale-open', {
      documents: [
        {
          id: 'document-a',
          contents: { fileName: 'A.csv', text: 'stored\n' },
        },
      ],
    });
    const openGate = deferred<Awaited<ReturnType<GeometryWorkspaceProvider['documents']['open']>>>();
    let capturedRequest:
      | Parameters<GeometryWorkspaceProvider['documents']['open']>[0]
      | null = null;
    const provider: GeometryWorkspaceProvider = {
      ...baseProvider,
      documents: {
        ...baseProvider.documents,
        open: vi.fn((request) => {
          capturedRequest = request;
          return openGate.promise;
        }),
      },
    };
    const session = createCleanSession();
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({
        choose: vi.fn(async () => connected('Stale open folder', provider)),
      }),
      session,
      blankDocument: BLANK_DOCUMENT,
    });
    await controller.chooseWorkspace();
    const pendingOpen = controller.openDocument({
      document: controller.getSnapshot().documents[0]!,
    });
    await vi.waitFor(() => expect(capturedRequest).not.toBeNull());
    session.updateDocument({ text: 'new local edit\n' });
    openGate.resolve(await baseProvider.documents.open(capturedRequest!));

    await expect(pendingOpen).resolves.toEqual({ status: 'superseded' });
    expect(controller.getSnapshot()).toMatchObject({
      activeDocument: null,
      document: { text: 'new local edit\n', isDirty: true },
    });
  });

  it('persists only the captured revision when a newer edit arrives during Save and then flags the storage version', async () => {
    const baseProvider = createProvider('workspace-stale-save', {
      documents: [
        {
          id: 'document-a',
          contents: { fileName: 'A.csv', text: 'stored\n' },
        },
      ],
    });
    const updateGate = deferred<Awaited<ReturnType<GeometryWorkspaceProvider['documents']['update']>>>();
    let capturedUpdate:
      | Parameters<GeometryWorkspaceProvider['documents']['update']>[0]
      | null = null;
    const provider: GeometryWorkspaceProvider = {
      ...baseProvider,
      documents: {
        ...baseProvider.documents,
        update: vi.fn((request) => {
          capturedUpdate = request;
          return updateGate.promise;
        }),
      },
    };
    const session = createCleanSession();
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({
        choose: vi.fn(async () => connected('Stale save folder', provider)),
      }),
      session,
      blankDocument: BLANK_DOCUMENT,
    });
    await controller.chooseWorkspace();
    await controller.openDocument({ document: controller.getSnapshot().documents[0]! });
    session.updateDocument({ text: 'captured edit\n' });
    const pendingSave = controller.save();
    await vi.waitFor(() => expect(capturedUpdate).not.toBeNull());
    session.updateDocument({ text: 'newer edit\n' });
    const persisted = await baseProvider.documents.update(capturedUpdate!);
    updateGate.resolve(persisted);

    await expect(pendingSave).resolves.toEqual({ status: 'completed' });
    expect(controller.getSnapshot()).toMatchObject({
      notice: 'Saved; newer local changes remain',
      document: { text: 'newer edit\n', isDirty: true },
      activeDocument: {
        id: 'document-a',
        storageVersion: persisted.entry.storageVersion,
      },
      activeConflict: null,
    });
    await expect(
      baseProvider.documents.open({
        id: persisted.entry.id,
        expectedStorageVersion: persisted.entry.storageVersion,
      }),
    ).resolves.toMatchObject({ contents: { text: 'captured edit\n' } });
  });

  it('supports local project CRUD, membership, provider-order search and catalogue filters', async () => {
    const provider = createProvider('workspace-projects', {
      documents: [
        { id: 'document-z', contents: { fileName: 'Zulu.csv', text: 'z\n' } },
        { id: 'document-a', contents: { fileName: 'Alpha.csv', text: 'a\n' } },
        { id: 'document-b', contents: { fileName: 'Beta.csv', text: 'b\n' } },
      ],
    });
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({
        choose: vi.fn(async () => connected('Projects folder', provider)),
      }),
      session: createCleanSession(),
      blankDocument: BLANK_DOCUMENT,
    });
    await controller.chooseWorkspace();
    await controller.createProject({ name: 'Retrofit', description: 'First' });
    let project = controller.getSnapshot().projects[0]!;
    await controller.updateProject({
      project,
      name: 'Retrofit plans',
      description: 'Updated description',
    });
    project = controller.getSnapshot().projects[0]!;
    expect(project).toMatchObject({
      name: 'Retrofit plans',
      description: 'Updated description',
    });

    let beta = controller
      .getSnapshot()
      .documents.find((entry) => entry.id === 'document-b')!;
    await controller.setDocumentMembership({
      document: beta,
      projectGroupIds: [project.id],
    });
    beta = controller
      .getSnapshot()
      .documents.find((entry) => entry.id === 'document-b')!;
    expect(beta.projectGroupIds).toEqual([project.id]);

    controller.setSearch('  A  ');
    expect(controller.getSnapshot().visibleDocuments.map((entry) => entry.fileName)).toEqual([
      'Alpha.csv',
      'Beta.csv',
    ]);
    controller.setFilter({ kind: 'project', projectGroupId: project.id });
    expect(controller.getSnapshot().visibleDocuments.map((entry) => entry.fileName)).toEqual([
      'Beta.csv',
    ]);
    controller.setSearch('');
    controller.setFilter({ kind: 'unassigned' });
    expect(controller.getSnapshot().visibleDocuments.map((entry) => entry.fileName)).toEqual([
      'Alpha.csv',
      'Zulu.csv',
    ]);

    controller.setFilter({ kind: 'project', projectGroupId: project.id });
    await controller.deleteProject({ project, confirmed: true });
    expect(controller.getSnapshot()).toMatchObject({
      filter: { kind: 'all' },
      projects: [],
    });
    expect(
      controller.getSnapshot().documents.every(
        (entry) => entry.projectGroupIds.length === 0,
      ),
    ).toBe(true);
  });

  it('duplicates unsaved active contents with memberships and leaves a clean blank after deleting the active copy', async () => {
    const provider = createProvider('workspace-duplicate', {
      projects: [{ id: 'project-a', name: 'Project A' }],
      documents: [
        {
          id: 'document-source',
          contents: { fileName: 'Source.csv', text: 'stored\n' },
          projectGroupIds: ['project-a'],
        },
      ],
    });
    const session = createCleanSession();
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({
        choose: vi.fn(async () => connected('Duplicate folder', provider)),
      }),
      session,
      blankDocument: BLANK_DOCUMENT,
    });
    await controller.chooseWorkspace();
    const source = controller.getSnapshot().documents[0]!;
    await controller.openDocument({ document: source });
    session.updateDocument({ text: 'unsaved duplicate source\n' });

    await controller.duplicateDocument({ document: source, confirmed: true });
    const copy = controller.getSnapshot().activeDocument!;
    expect(copy.id).not.toBe(source.id);
    expect(copy.projectGroupIds).toEqual(['project-a']);
    expect(session.getSnapshot()).toMatchObject({
      text: 'unsaved duplicate source\n',
      isDirty: false,
    });

    await controller.deleteDocument({ document: copy, confirmed: true });
    expect(controller.getSnapshot()).toMatchObject({
      activeDocument: null,
      activeDocumentId: null,
      document: { fileName: 'Untitled.csv', text: '', isDirty: false },
    });
    expect(controller.getSnapshot().documents.map((entry) => entry.id)).toEqual([
      source.id,
    ]);
  });

  it('disconnects without deleting a workspace and applies dirty Cancel, Discard and Save before forgetting', async () => {
    const provider = createProvider('workspace-disconnect', {
      documents: [
        {
          id: 'document-a',
          contents: { fileName: 'A.csv', text: 'stored\n' },
        },
      ],
    });
    const forget = vi.fn(async () => undefined);
    const access = createAccess({
      choose: vi.fn(async () => connected('Disconnect folder', provider)),
      forget,
    });
    const session = createCleanSession();
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: access,
      session,
      blankDocument: BLANK_DOCUMENT,
    });
    await controller.chooseWorkspace();
    await controller.openDocument({ document: controller.getSnapshot().documents[0]! });
    session.updateDocument({ text: 'dirty\n' });

    await expect(
      controller.disconnectWorkspace({ dirtyDecision: 'cancel' }),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(forget).not.toHaveBeenCalled();
    expect(controller.getSnapshot().workspace.status).toBe('connected');

    await controller.disconnectWorkspace({ dirtyDecision: 'discard' });
    expect(forget).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      workspace: { status: 'disconnected' },
      activeDocument: null,
      document: { text: 'stored\n', isDirty: false },
    });
    expect((await provider.getSnapshot()).documents).toHaveLength(1);
  });

  it('rejects overlapping operations and ignores stale async completion after disposal', async () => {
    const provider = createProvider('workspace-flight');
    const chooseGate = deferred<BrowserDirectoryWorkspaceConnected>();
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({ choose: vi.fn(() => chooseGate.promise) }),
      session: createCleanSession(),
      blankDocument: BLANK_DOCUMENT,
    });
    const pendingChoose = controller.chooseWorkspace();
    expect(controller.getSnapshot()).toMatchObject({
      isBusy: true,
      isLoading: true,
      operation: 'choose-workspace',
    });
    await expect(controller.refresh()).rejects.toBeInstanceOf(
      CommunityGeometryFilesControllerError,
    );
    await expect(controller.refresh()).rejects.toMatchObject({
      code: 'operation-in-progress',
    });
    chooseGate.resolve(connected('Flight folder', provider));
    await pendingChoose;

    const restoreGate = deferred<BrowserDirectoryWorkspaceConnected>();
    const staleController = createCommunityGeometryFilesController({
      workspaceAccess: createAccess({ restore: vi.fn(() => restoreGate.promise) }),
      session: createCleanSession(),
      blankDocument: BLANK_DOCUMENT,
    });
    const subscriber = vi.fn();
    staleController.subscribe(subscriber);
    const pendingRestore = staleController.restoreWorkspace();
    const notificationsBeforeDispose = subscriber.mock.calls.length;
    expect(notificationsBeforeDispose).toBeGreaterThan(0);
    staleController.dispose();
    restoreGate.resolve(connected('Stale folder', provider));
    await expect(pendingRestore).resolves.toEqual({ status: 'superseded' });
    expect(subscriber).toHaveBeenCalledTimes(notificationsBeforeDispose);
  });

  it('publishes typed safe visible errors and preserves the prior state on provider failure', async () => {
    const provider = createProvider('workspace-error');
    const access = createAccess({
      choose: vi.fn(async () => connected('Error folder', {
        ...provider,
        getSnapshot: vi.fn(async () => {
          throw new Error('/private/customer/path could not be read');
        }),
      })),
    });
    const controller = createCommunityGeometryFilesController({
      workspaceAccess: access,
      session: createCleanSession(),
      blankDocument: BLANK_DOCUMENT,
    });

    await expect(controller.chooseWorkspace()).rejects.toMatchObject({
      code: 'operation-failed',
    });
    expect(controller.getSnapshot()).toMatchObject({
      workspace: { status: 'disconnected' },
      error: {
        source: 'controller',
        code: 'operation-failed',
        operation: 'choose-workspace',
      },
    });
    expect(controller.getSnapshot().error?.message).not.toContain('/private/');
    expect(Object.isFrozen(controller.getSnapshot().error)).toBe(true);
  });
});
