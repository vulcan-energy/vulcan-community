// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  createGeometryDocumentCoordinator,
  createInMemoryGeometryDocumentSession,
  createInMemoryGeometryWorkspaceProvider,
  GeometryDocumentCoordinatorError,
  type GeometryDocumentCatalogueEntry,
  type GeometryStoredDocument,
  type GeometryWorkspaceProvider,
} from '../index';

const createIdSequence = () => {
  let documentId = 1;
  let projectId = 1;
  return (kind: 'document' | 'project-group') =>
    kind === 'document'
      ? `document-${documentId++}`
      : `project-${projectId++}`;
};

async function createSeededWorkspace() {
  const provider = createInMemoryGeometryWorkspaceProvider({
    id: 'coordinator-provider',
    createId: createIdSequence(),
    documents: [
      {
        id: 'document-current',
        contents: { fileName: 'Current.csv', text: 'current,0\n' },
        projectGroupIds: ['project-a'],
      },
      {
        id: 'document-target',
        contents: { fileName: 'Target.csv', text: 'target,0\n' },
        projectGroupIds: [],
      },
    ],
    projectGroups: [{ id: 'project-a', name: 'Project A' }],
  });
  const snapshot = await provider.getSnapshot();
  return {
    provider,
    current: snapshot.documents.find((entry) => entry.id === 'document-current')!,
    target: snapshot.documents.find((entry) => entry.id === 'document-target')!,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('geometry document coordinator', () => {
  it('reloads a clean active document when its storage version changes', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const updated = await provider.documents.update({
      id: current.id,
      expectedStorageVersion: current.storageVersion,
      contents: { fileName: 'Current.csv', text: 'external,1\n' },
      sessionRevision: 42,
    });
    const open = vi.fn(provider.documents.open);
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: { ...provider.documents, open },
      },
      session,
      activeDocument: current,
    });

    await expect(coordinator.open({ document: updated.entry })).resolves.toMatchObject({
      status: 'completed',
      activeDocument: { storageVersion: updated.entry.storageVersion },
    });
    expect(open).toHaveBeenCalledWith({
      id: current.id,
      expectedStorageVersion: updated.entry.storageVersion,
    });
    expect(session.getSnapshot()).toMatchObject({
      text: 'external,1\n',
      isDirty: false,
    });
  });

  it('keeps an exact clean active id and storage version as a no-op', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const open = vi.fn(provider.documents.open);
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: { ...provider.documents, open },
      },
      session,
      activeDocument: current,
    });

    await expect(coordinator.open({ document: current })).resolves.toMatchObject({
      status: 'completed',
      activeDocument: current,
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('acknowledges only the exact revision captured by a confirmed provider write', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const gate = deferred<Awaited<ReturnType<typeof provider.documents.update>>>();
    let capturedRequest: Parameters<typeof provider.documents.update>[0] | null = null;
    const controlledProvider = {
      ...provider,
      documents: {
        ...provider.documents,
        update: vi.fn((request) => {
          capturedRequest = request;
          return gate.promise;
        }),
      },
    } as GeometryWorkspaceProvider;
    const coordinator = createGeometryDocumentCoordinator({
      provider: controlledProvider,
      session,
      activeDocument: current,
    });

    const saveCandidate = session.updateDocument({ text: 'current,1\n' });
    const pendingSave = coordinator.save();
    await vi.waitFor(() => expect(capturedRequest).not.toBeNull());
    const newerEdit = session.updateDocument({ text: 'current,2\n' });
    const persisted = {
      ...(await provider.documents.update(capturedRequest!)),
      persistedSessionRevision: saveCandidate.revision,
    };
    gate.resolve(persisted);

    await expect(pendingSave).resolves.toMatchObject({ status: 'completed' });
    expect(session.getSnapshot()).toMatchObject({
      revision: newerEdit.revision,
      persistedRevision: saveCandidate.revision,
      text: 'current,2\n',
      isDirty: true,
    });
  });

  it('requires an explicit dirty decision and cancellation makes no provider call', async () => {
    const { provider, current, target } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    session.updateDocument({ text: 'dirty\n' });
    const open = vi.fn(provider.documents.open);
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: { ...provider.documents, open },
      },
      session,
      activeDocument: current,
    });

    await expect(coordinator.open({ document: target })).rejects.toBeInstanceOf(
      GeometryDocumentCoordinatorError,
    );
    await expect(
      coordinator.open({ document: target, dirtyDecision: 'cancel' }),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(open).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ text: 'dirty\n', isDirty: true });

    await expect(
      coordinator.open({
        document: target,
        dirtyDecision: 'proceed' as 'discard',
      }),
    ).rejects.toMatchObject({ code: 'invalid-dirty-decision' });
    expect(open).not.toHaveBeenCalled();
  });

  it('cancels dirty New before replacing the session or calling the provider', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    session.updateDocument({ text: 'dirty\n' });
    const create = vi.fn(provider.documents.create);
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: { ...provider.documents, create },
      },
      session,
      activeDocument: current,
    });

    await expect(
      coordinator.newDocument({
        contents: { fileName: 'New.csv', text: '' },
        dirtyDecision: 'cancel',
      }),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(create).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ text: 'dirty\n', isDirty: true });
  });

  it('can replace with a pristine un-catalogued draft without inventing an edit', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const coordinator = createGeometryDocumentCoordinator({
      provider,
      session,
      activeDocument: current,
    });

    await expect(
      coordinator.newDocument({
        contents: { fileName: 'Draft.csv', text: '' },
        persisted: true,
      }),
    ).resolves.toEqual({ status: 'completed', activeDocument: null });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Draft.csv',
      text: '',
      isDirty: false,
    });
  });

  it('keeps the legacy new-document default dirty for existing callers', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const coordinator = createGeometryDocumentCoordinator({
      provider,
      session,
      activeDocument: current,
    });

    await coordinator.newDocument({ contents: { fileName: 'Draft.csv', text: '' } });
    expect(session.getSnapshot().isDirty).toBe(true);
  });

  it('saves before opening when requested and opens the target cleanly', async () => {
    const { provider, current, target } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    session.updateDocument({ text: 'current,saved-before-open\n' });
    const coordinator = createGeometryDocumentCoordinator({
      provider,
      session,
      activeDocument: current,
    });

    await expect(
      coordinator.open({ document: target, dirtyDecision: 'save' }),
    ).resolves.toMatchObject({
      status: 'completed',
      activeDocument: { id: target.id },
    });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Target.csv',
      text: 'target,0\n',
      isDirty: false,
    });
    const savedCurrent = (await provider.getSnapshot()).documents.find(
      (entry) => entry.id === current.id,
    )!;
    expect((await provider.documents.open({
      id: savedCurrent.id,
      expectedStorageVersion: savedCurrent.storageVersion,
    })).contents.text).toBe('current,saved-before-open\n');
  });

  it('does not let a stale open completion replace a later selection', async () => {
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current\n',
      persisted: true,
    });
    const current: GeometryDocumentCatalogueEntry = Object.freeze({
      id: 'current',
      fileName: 'Current.csv',
      modifiedAt: null,
      storageVersion: 'current:v0',
      projectGroupIds: Object.freeze([]),
    });
    const firstEntry = { ...current, id: 'first', fileName: 'First.csv', storageVersion: 'first:v0' };
    const secondEntry = { ...current, id: 'second', fileName: 'Second.csv', storageVersion: 'second:v0' };
    const firstGate = deferred<GeometryStoredDocument>();
    const secondGate = deferred<GeometryStoredDocument>();
    const open = vi.fn(({ id }: { id: string }) =>
      id === 'first' ? firstGate.promise : secondGate.promise,
    );
    const provider = {
      id: 'deferred-provider',
      capabilities: Object.freeze({
        persistence: 'session',
        externalChanges: 'manual-refresh',
        create: true,
        update: true,
        duplicate: true,
        delete: true,
        projectGroups: true,
      }),
      getSnapshot: vi.fn(),
      documents: { open },
      projectGroups: {},
    } as unknown as GeometryWorkspaceProvider;
    const coordinator = createGeometryDocumentCoordinator({
      provider,
      session,
      activeDocument: current,
    });

    const firstOpen = coordinator.open({ document: firstEntry });
    const secondOpen = coordinator.open({ document: secondEntry });
    secondGate.resolve({
      entry: secondEntry,
      contents: Object.freeze({ fileName: 'Second.csv', text: 'second\n' }),
    });
    await expect(secondOpen).resolves.toMatchObject({ status: 'completed' });
    firstGate.resolve({
      entry: firstEntry,
      contents: Object.freeze({ fileName: 'First.csv', text: 'first\n' }),
    });
    await expect(firstOpen).resolves.toEqual({ status: 'superseded' });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Second.csv',
      text: 'second\n',
    });
  });

  it('keeps the active dirty session on cancelled or failed deletion and replaces it only after success', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    session.updateDocument({ text: 'dirty\n' });
    const remove = vi.fn(provider.documents.delete);
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: { ...provider.documents, delete: remove },
      },
      session,
      activeDocument: current,
    });

    await expect(
      coordinator.delete({
        document: current,
        confirmed: false,
        dirtyDecision: 'discard',
        replacement: { fileName: 'Draft.csv', text: '' },
      }),
    ).resolves.toEqual({ status: 'cancelled' });
    await expect(
      coordinator.delete({
        document: current,
        confirmed: true,
        dirtyDecision: 'cancel',
        replacement: { fileName: 'Draft.csv', text: '' },
      }),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(remove).not.toHaveBeenCalled();
    expect((await provider.getSnapshot()).documents).toHaveLength(2);

    await provider.documents.update({
      id: current.id,
      expectedStorageVersion: current.storageVersion,
      contents: { fileName: 'Current.csv', text: 'external-change\n' },
      sessionRevision: 99,
    });

    await expect(
      coordinator.delete({
        document: current,
        confirmed: true,
        dirtyDecision: 'discard',
        replacement: { fileName: 'Draft.csv', text: '' },
      }),
    ).rejects.toMatchObject({ code: 'version-conflict' });
    expect(session.getSnapshot()).toMatchObject({ text: 'dirty\n', isDirty: true });

    const refreshed = (await provider.getSnapshot()).documents.find(
      (entry) => entry.id === current.id,
    )!;
    const refreshedCoordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: { ...provider.documents, delete: remove },
      },
      session,
      activeDocument: refreshed,
    });
    await expect(
      refreshedCoordinator.delete({
        document: refreshed,
        confirmed: true,
        dirtyDecision: 'discard',
        replacement: { fileName: 'Draft.csv', text: '' },
      }),
    ).resolves.toMatchObject({ status: 'completed', activeDocument: null });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Draft.csv',
      text: '',
      isDirty: true,
    });
  });

  it('duplicates the exact dirty current revision, inherits memberships, and opens the saved copy', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const dirty = session.updateDocument({
      fileName: 'Current edited.csv',
      text: 'current,dirty-copy\n',
    });
    const coordinator = createGeometryDocumentCoordinator({
      provider,
      session,
      activeDocument: current,
    });

    const result = await coordinator.duplicateAndOpen({
      document: current,
      confirmed: true,
    });

    expect(result).toMatchObject({
      status: 'completed',
      activeDocument: {
        fileName: 'Current edited 2.csv',
        projectGroupIds: ['project-a'],
      },
    });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Current edited 2.csv',
      text: 'current,dirty-copy\n',
      isDirty: false,
    });
    expect(session.getSnapshot().revision).toBeGreaterThan(dirty.revision);

    const original = (await provider.getSnapshot()).documents.find(
      (entry) => entry.id === current.id,
    )!;
    expect((await provider.documents.open({
      id: original.id,
      expectedStorageVersion: original.storageVersion,
    })).contents.text).toBe('current,0\n');
  });

  it('cancels duplicate-and-open before any provider mutation', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    session.updateDocument({ text: 'dirty\n' });
    const duplicate = vi.fn(provider.documents.duplicate);
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: { ...provider.documents, duplicate },
      },
      session,
      activeDocument: current,
    });

    await expect(
      coordinator.duplicateAndOpen({ document: current, confirmed: false }),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(duplicate).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ text: 'dirty\n', isDirty: true });
  });

  it('snapshots a destructive request once before awaiting the provider', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    session.updateDocument({ text: 'dirty\n' });
    const coordinator = createGeometryDocumentCoordinator({
      provider,
      session,
      activeDocument: current,
    });
    let replacementReads = 0;
    const request = {
      document: current,
      confirmed: true,
      dirtyDecision: 'discard' as const,
      get replacement() {
        replacementReads += 1;
        return replacementReads === 1
          ? { fileName: 'Captured draft.csv', text: 'captured\n' }
          : { fileName: 'Changed draft.csv', text: 'changed\n' };
      },
    };

    await expect(coordinator.delete(request)).resolves.toMatchObject({
      status: 'completed',
    });
    expect(replacementReads).toBe(1);
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Captured draft.csv',
      text: 'captured\n',
    });
  });

  it('does not let a stale delete completion clear a later-opened document', async () => {
    const { provider, current, target } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const deleteGate = deferred<
      Awaited<ReturnType<typeof provider.documents.delete>>
    >();
    let capturedDeleteRequest:
      | Parameters<typeof provider.documents.delete>[0]
      | null = null;
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: {
          ...provider.documents,
          delete: vi.fn((request) => {
            capturedDeleteRequest = request;
            return deleteGate.promise;
          }),
        },
      },
      session,
      activeDocument: current,
    });

    const pendingDelete = coordinator.delete({
      document: current,
      confirmed: true,
      replacement: { fileName: 'Draft.csv', text: '' },
    });
    await vi.waitFor(() => expect(capturedDeleteRequest).not.toBeNull());
    await expect(coordinator.open({ document: target })).resolves.toMatchObject({
      status: 'completed',
      activeDocument: { id: target.id },
    });

    deleteGate.resolve(
      await provider.documents.delete(capturedDeleteRequest!),
    );

    await expect(pendingDelete).resolves.toEqual({ status: 'superseded' });
    expect(coordinator.getActiveDocument()).toMatchObject({ id: target.id });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Target.csv',
      text: 'target,0\n',
      isDirty: false,
    });
  });

  it.each(['open', 'new', 'delete', 'duplicate'] as const)(
    'does not let an edit made during save-before-%s be discarded',
    async (operation) => {
      const { provider, current, target } = await createSeededWorkspace();
      const session = createInMemoryGeometryDocumentSession({
        fileName: 'Current.csv',
        text: 'current,0\n',
        persisted: true,
      });
      session.updateDocument({ text: 'current,save-candidate\n' });
      const updateGate = deferred<
        Awaited<ReturnType<typeof provider.documents.update>>
      >();
      let capturedUpdateRequest:
        | Parameters<typeof provider.documents.update>[0]
        | null = null;
      const open = vi.fn(provider.documents.open);
      const remove = vi.fn(provider.documents.delete);
      const duplicate = vi.fn(provider.documents.duplicate);
      const coordinator = createGeometryDocumentCoordinator({
        provider: {
          ...provider,
          documents: {
            ...provider.documents,
            open,
            delete: remove,
            duplicate,
            update: vi.fn((request) => {
              capturedUpdateRequest = request;
              return updateGate.promise;
            }),
          },
        },
        session,
        activeDocument: current,
      });

      const pendingOperation =
        operation === 'open'
          ? coordinator.open({ document: target, dirtyDecision: 'save' })
          : operation === 'new'
            ? coordinator.newDocument({
                contents: { fileName: 'New.csv', text: '' },
                dirtyDecision: 'save',
              })
            : operation === 'delete'
              ? coordinator.delete({
                  document: current,
                  confirmed: true,
                  dirtyDecision: 'save',
                  replacement: { fileName: 'Draft.csv', text: '' },
                })
              : coordinator.duplicateAndOpen({
                  document: target,
                  confirmed: true,
                  dirtyDecision: 'save',
                });

      await vi.waitFor(() => expect(capturedUpdateRequest).not.toBeNull());
      const newerEdit = session.updateDocument({ text: 'current,newer-edit\n' });
      updateGate.resolve(
        await provider.documents.update(capturedUpdateRequest!),
      );

      await expect(pendingOperation).resolves.toEqual({ status: 'superseded' });
      expect(session.getSnapshot()).toMatchObject({
        revision: newerEdit.revision,
        text: 'current,newer-edit\n',
        isDirty: true,
      });
      expect(coordinator.getActiveDocument()).toMatchObject({ id: current.id });
      expect(open).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(duplicate).not.toHaveBeenCalled();
    },
  );

  it.each(['entry-id', 'entry-name', 'contents'] as const)(
    'rejects a save receipt whose %s does not match the captured update',
    async (mismatch) => {
      const { provider, current, target } = await createSeededWorkspace();
      const session = createInMemoryGeometryDocumentSession({
        fileName: 'Current.csv',
        text: 'current,0\n',
        persisted: true,
      });
      const dirty = session.updateDocument({
        fileName: 'Current renamed.csv',
        text: 'current,dirty\n',
      });
      const snapshot = await provider.getSnapshot();
      const validEntry = Object.freeze({
        ...current,
        fileName: dirty.fileName,
        storageVersion: 'document-current:v-forged',
      });
      const forgedReceipt = Object.freeze({
        entry:
          mismatch === 'entry-id'
            ? Object.freeze({ ...validEntry, id: target.id })
            : mismatch === 'entry-name'
              ? Object.freeze({ ...validEntry, fileName: 'Wrong.csv' })
              : validEntry,
        contents: Object.freeze(
          mismatch === 'contents'
            ? { fileName: dirty.fileName, text: 'wrong\n' }
            : { fileName: dirty.fileName, text: dirty.text },
        ),
        persistedSessionRevision: dirty.revision,
        snapshot,
      });
      const coordinator = createGeometryDocumentCoordinator({
        provider: {
          ...provider,
          documents: {
            ...provider.documents,
            update: vi.fn().mockResolvedValue(forgedReceipt),
          },
        },
        session,
        activeDocument: current,
      });

      await expect(coordinator.save()).rejects.toMatchObject({
        code: 'invalid-save-receipt',
      });
      expect(session.getSnapshot()).toMatchObject({
        revision: dirty.revision,
        text: dirty.text,
        isDirty: true,
      });
      expect(coordinator.getActiveDocument()).toMatchObject({ id: current.id });
    },
  );

  it('captures a provider save receipt revision exactly once', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const dirty = session.updateDocument({ text: 'current,dirty\n' });
    let revisionReads = 0;
    const receipt = {
      entry: Object.freeze({
        ...current,
        storageVersion: 'document-current:v-next',
      }),
      contents: Object.freeze({
        fileName: dirty.fileName,
        text: dirty.text,
      }),
      get persistedSessionRevision() {
        revisionReads += 1;
        return revisionReads === 1 ? dirty.revision : 0;
      },
      snapshot: await provider.getSnapshot(),
    };
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: {
          ...provider.documents,
          update: vi.fn().mockResolvedValue(receipt),
        },
      },
      session,
      activeDocument: current,
    });

    await expect(coordinator.save()).resolves.toMatchObject({
      status: 'completed',
    });
    expect(revisionReads).toBe(1);
    expect(session.getSnapshot()).toMatchObject({
      persistedRevision: dirty.revision,
      isDirty: false,
    });
  });

  it('captures the initial active document and a delete replacement exactly once', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    let activeReads = 0;
    const options = {
      provider,
      session,
      get activeDocument() {
        activeReads += 1;
        return activeReads === 1 ? current : null;
      },
    };
    const coordinator = createGeometryDocumentCoordinator(options);
    let replacementReads = 0;
    const request = {
      document: current,
      confirmed: true,
      get replacement() {
        replacementReads += 1;
        return replacementReads === 1
          ? { fileName: 'Captured.csv', text: 'captured\n' }
          : { fileName: 'Changed.csv', text: 'changed\n' };
      },
    };

    await expect(coordinator.delete(request)).resolves.toMatchObject({
      status: 'completed',
      activeDocument: null,
    });
    expect(activeReads).toBe(1);
    expect(replacementReads).toBe(1);
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Captured.csv',
      text: 'captured\n',
    });
  });

  it('does not let a local edit made during open get replaced by its completion', async () => {
    const { provider, current, target } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const openGate = deferred<GeometryStoredDocument>();
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: {
          ...provider.documents,
          open: vi.fn().mockReturnValue(openGate.promise),
        },
      },
      session,
      activeDocument: current,
    });

    const pendingOpen = coordinator.open({ document: target });
    const edited = session.updateDocument({ text: 'local edit\n' });
    openGate.resolve(
      await provider.documents.open({
        id: target.id,
        expectedStorageVersion: target.storageVersion,
      }),
    );

    await expect(pendingOpen).resolves.toEqual({ status: 'superseded' });
    expect(session.getSnapshot()).toMatchObject({
      revision: edited.revision,
      text: 'local edit\n',
      isDirty: true,
    });
    expect(coordinator.getActiveDocument()).toMatchObject({ id: current.id });
  });

  it('rejects an open response for a different document without replacing the session', async () => {
    const { provider, current, target } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const targetStored = await provider.documents.open({
      id: target.id,
      expectedStorageVersion: target.storageVersion,
    });
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: {
          ...provider.documents,
          open: vi.fn().mockResolvedValue({
            ...targetStored,
            entry: Object.freeze({ ...targetStored.entry, id: current.id }),
          }),
        },
      },
      session,
      activeDocument: current,
    });

    await expect(coordinator.open({ document: target })).rejects.toMatchObject({
      code: 'invalid-provider-receipt',
    });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Current.csv',
      text: 'current,0\n',
      isDirty: false,
    });
    expect(coordinator.getActiveDocument()).toMatchObject({ id: current.id });
  });

  it('rejects a delete receipt for a different document before replacing the session', async () => {
    const { provider, current, target } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: {
          ...provider.documents,
          delete: vi.fn().mockResolvedValue({
            deletedDocumentId: target.id,
            snapshot: await provider.getSnapshot(),
          }),
        },
      },
      session,
      activeDocument: current,
    });

    await expect(
      coordinator.delete({
        document: current,
        confirmed: true,
        replacement: { fileName: 'Draft.csv', text: '' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-provider-receipt' });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Current.csv',
      text: 'current,0\n',
      isDirty: false,
    });
    expect(coordinator.getActiveDocument()).toMatchObject({ id: current.id });
  });

  it('rejects a duplicate response that aliases its source document', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: {
          ...provider.documents,
          duplicate: vi.fn().mockResolvedValue({
            entry: Object.freeze({
              ...current,
              fileName: 'Current 2.csv',
            }),
            contents: Object.freeze({
              fileName: 'Current 2.csv',
              text: 'current,0\n',
            }),
            persistedSessionRevision: 0,
            snapshot: await provider.getSnapshot(),
          }),
        },
      },
      session,
      activeDocument: current,
    });

    await expect(
      coordinator.duplicateAndOpen({
        document: current,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'invalid-provider-receipt' });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Current.csv',
      text: 'current,0\n',
      isDirty: false,
    });
    expect(coordinator.getActiveDocument()).toMatchObject({ id: current.id });
  });

  it('rejects a malformed create receipt before acknowledging an unsaved draft', async () => {
    const { provider, target } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Draft.csv',
      text: 'draft\n',
      persisted: false,
    });
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: {
          ...provider.documents,
          create: vi.fn().mockResolvedValue({
            entry: Object.freeze({ ...target, fileName: 'Wrong.csv' }),
            contents: Object.freeze({ fileName: 'Wrong.csv', text: 'draft\n' }),
            persistedSessionRevision: session.getSnapshot().revision,
            snapshot: await provider.getSnapshot(),
          }),
        },
      },
      session,
    });

    await expect(coordinator.save()).rejects.toMatchObject({
      code: 'invalid-save-receipt',
    });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Draft.csv',
      text: 'draft\n',
      isDirty: true,
    });
    expect(coordinator.getActiveDocument()).toBeNull();
  });

  it('keeps save bookkeeping current when a competing navigation is cancelled', async () => {
    const { provider, current, target } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    session.updateDocument({ text: 'current,first-save\n' });
    const updateGate = deferred<
      Awaited<ReturnType<typeof provider.documents.update>>
    >();
    let capturedUpdateRequest:
      | Parameters<typeof provider.documents.update>[0]
      | null = null;
    let shouldBlock = true;
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: {
          ...provider.documents,
          update: vi.fn((request) => {
            if (shouldBlock) {
              shouldBlock = false;
              capturedUpdateRequest = request;
              return updateGate.promise;
            }
            return provider.documents.update(request);
          }),
        },
      },
      session,
      activeDocument: current,
    });

    const pendingOpen = coordinator.open({
      document: target,
      dirtyDecision: 'save',
    });
    await vi.waitFor(() => expect(capturedUpdateRequest).not.toBeNull());
    await expect(
      coordinator.open({ document: target, dirtyDecision: 'cancel' }),
    ).resolves.toEqual({ status: 'cancelled' });
    const firstReceipt = await provider.documents.update(capturedUpdateRequest!);
    updateGate.resolve(firstReceipt);

    await expect(pendingOpen).resolves.toEqual({ status: 'superseded' });
    expect(session.getSnapshot()).toMatchObject({
      text: 'current,first-save\n',
      isDirty: false,
    });
    expect(coordinator.getActiveDocument()).toMatchObject({
      id: current.id,
      storageVersion: firstReceipt.entry.storageVersion,
    });

    session.updateDocument({ text: 'current,second-save\n' });
    await expect(coordinator.save()).resolves.toMatchObject({
      status: 'completed',
      activeDocument: { id: current.id },
    });
    expect(session.getSnapshot()).toMatchObject({
      text: 'current,second-save\n',
      isDirty: false,
    });
  });

  it('guards an open against a session edit triggered while capturing its response', async () => {
    const { provider, current, target } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    let textReads = 0;
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: {
          ...provider.documents,
          open: vi.fn().mockResolvedValue({
            entry: target,
            contents: {
              fileName: 'Target.csv',
              get text() {
                textReads += 1;
                session.updateDocument({ text: 'accessor edit\n' });
                return 'target,0\n';
              },
            },
          }),
        },
      },
      session,
      activeDocument: current,
    });

    await expect(coordinator.open({ document: target })).resolves.toEqual({
      status: 'superseded',
    });
    expect(textReads).toBe(1);
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Current.csv',
      text: 'accessor edit\n',
      isDirty: true,
    });
    expect(coordinator.getActiveDocument()).toMatchObject({ id: current.id });
  });

  it('guards duplicate-and-open against an edit triggered while capturing its receipt', async () => {
    const { provider, current } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const duplicatedRevision = session.updateDocument({
      text: 'current,duplicate-candidate\n',
    });
    let textReads = 0;
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: {
          ...provider.documents,
          duplicate: vi.fn().mockResolvedValue({
            entry: Object.freeze({
              ...current,
              id: 'document-copy',
              fileName: 'Current 2.csv',
              storageVersion: 'document:0',
            }),
            contents: {
              fileName: 'Current 2.csv',
              get text() {
                textReads += 1;
                session.updateDocument({ text: 'accessor newer edit\n' });
                return duplicatedRevision.text;
              },
            },
            persistedSessionRevision: duplicatedRevision.revision,
            snapshot: await provider.getSnapshot(),
          }),
        },
      },
      session,
      activeDocument: current,
    });

    await expect(
      coordinator.duplicateAndOpen({ document: current, confirmed: true }),
    ).resolves.toEqual({ status: 'superseded' });
    expect(textReads).toBe(1);
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Current.csv',
      text: 'accessor newer edit\n',
      isDirty: true,
    });
    expect(coordinator.getActiveDocument()).toMatchObject({ id: current.id });
  });

  it.each(['open', 'new', 'delete', 'duplicate'] as const)(
    'does not let an edit made after a discard decision begins get lost to %s',
    async (operation) => {
      const { provider, current, target } = await createSeededWorkspace();
      const session = createInMemoryGeometryDocumentSession({
        fileName: 'Current.csv',
        text: 'current,0\n',
        persisted: true,
      });
      session.updateDocument({ text: 'discard candidate\n' });
      const coordinator = createGeometryDocumentCoordinator({
        provider,
        session,
        activeDocument: current,
      });

      const pendingOperation =
        operation === 'open'
          ? coordinator.open({ document: target, dirtyDecision: 'discard' })
          : operation === 'new'
            ? coordinator.newDocument({
                contents: { fileName: 'New.csv', text: '' },
                dirtyDecision: 'discard',
              })
            : operation === 'delete'
              ? coordinator.delete({
                  document: current,
                  confirmed: true,
                  dirtyDecision: 'discard',
                  replacement: { fileName: 'Draft.csv', text: '' },
                })
              : coordinator.duplicateAndOpen({
                  document: target,
                  confirmed: true,
                  dirtyDecision: 'discard',
                });
      const newerEdit = session.updateDocument({ text: 'newer edit\n' });

      await expect(pendingOperation).resolves.toEqual({ status: 'superseded' });
      expect(session.getSnapshot()).toMatchObject({
        revision: newerEdit.revision,
        fileName: 'Current.csv',
        text: 'newer edit\n',
        isDirty: true,
      });
      expect(coordinator.getActiveDocument()).toMatchObject({ id: current.id });
    },
  );

  it('does not replace a newly edited session when duplicating a different document', async () => {
    const { provider, current, target } = await createSeededWorkspace();
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const duplicateGate = deferred<
      Awaited<ReturnType<typeof provider.documents.duplicate>>
    >();
    let capturedRequest:
      | Parameters<typeof provider.documents.duplicate>[0]
      | null = null;
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: {
          ...provider.documents,
          duplicate: vi.fn((request) => {
            capturedRequest = request;
            return duplicateGate.promise;
          }),
        },
      },
      session,
      activeDocument: current,
    });

    const pendingDuplicate = coordinator.duplicateAndOpen({
      document: target,
      confirmed: true,
    });
    await vi.waitFor(() => expect(capturedRequest).not.toBeNull());
    const newerEdit = session.updateDocument({ text: 'newer edit\n' });
    duplicateGate.resolve(
      await provider.documents.duplicate(capturedRequest!),
    );

    await expect(pendingDuplicate).resolves.toEqual({ status: 'superseded' });
    expect(session.getSnapshot()).toMatchObject({
      revision: newerEdit.revision,
      fileName: 'Current.csv',
      text: 'newer edit\n',
      isDirty: true,
    });
    expect(coordinator.getActiveDocument()).toMatchObject({ id: current.id });
  });

  it('rejects a duplicate receipt that repeats one source membership and omits another', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider({
      id: 'membership-receipt-provider',
      createId: createIdSequence(),
      projectGroups: [
        { id: 'project-a', name: 'Project A' },
        { id: 'project-b', name: 'Project B' },
      ],
      documents: [
        {
          id: 'document-current',
          contents: { fileName: 'Current.csv', text: 'current,0\n' },
          projectGroupIds: ['project-a', 'project-b'],
        },
      ],
    });
    const current = (await provider.getSnapshot()).documents[0];
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'Current.csv',
      text: 'current,0\n',
      persisted: true,
    });
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...provider,
        documents: {
          ...provider.documents,
          duplicate: vi.fn().mockResolvedValue({
            entry: Object.freeze({
              ...current,
              id: 'document-copy',
              fileName: 'Current 2.csv',
              projectGroupIds: Object.freeze(['project-a', 'project-a']),
            }),
            contents: Object.freeze({
              fileName: 'Current 2.csv',
              text: 'current,0\n',
            }),
            persistedSessionRevision: 0,
            snapshot: await provider.getSnapshot(),
          }),
        },
      },
      session,
      activeDocument: current,
    });

    await expect(
      coordinator.duplicateAndOpen({ document: current, confirmed: true }),
    ).rejects.toMatchObject({ code: 'invalid-provider-receipt' });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'Current.csv',
      text: 'current,0\n',
      isDirty: false,
    });
    expect(coordinator.getActiveDocument()).toMatchObject({ id: current.id });
  });
});
