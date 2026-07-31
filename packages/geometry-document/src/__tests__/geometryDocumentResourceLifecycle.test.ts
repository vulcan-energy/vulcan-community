// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  createGeometryDocumentCoordinator,
  createInMemoryGeometryDocumentSession,
  createInMemoryGeometryWorkspaceProvider,
  decodePortableGeometryDocument,
  encodePortableGeometryDocument,
  GeometryWorkspaceProviderError,
  PortableGeometryDocumentError,
  toPortableGeometryDocument,
  type GeometryDocumentContents,
  type GeometryWorkspaceProviderIdKind,
} from '../index';

function richContents(
  modelText = 'model,0\n',
  auditBytes = new Uint8Array([1, 2, 3]),
  sourceBytes = new Uint8Array([4, 5, 6]),
) {
  return {
    fileName: 'House.csv',
    text: modelText,
    derivedResources: [
      {
        id: 'ifc-import-audit',
        slots: ['ifc.audit'],
        role: 'ifc-import-audit',
        required: false,
        mediaType: 'application/x-ndjson',
        bytes: auditBytes,
      },
    ],
    sourceFiles: [
      {
        id: 'original-ifc',
        slots: ['ifc.source'],
        role: 'ifc' as const,
        fileName: 'House.ifc',
        mediaType: 'model/ifc',
        bytes: sourceBytes,
      },
    ],
  };
}

function createIdSequence() {
  let documentId = 1;
  let projectId = 1;
  return (kind: GeometryWorkspaceProviderIdKind) =>
    kind === 'document'
      ? `document-${documentId++}`
      : `project-${projectId++}`;
}

function expectRichContents(
  contents: GeometryDocumentContents,
  expectedModelText = 'model,0\n',
  expectedAuditBytes = [1, 2, 3],
  expectedSourceBytes = [4, 5, 6],
) {
  expect(contents).toMatchObject({
    fileName: 'House.csv',
    text: expectedModelText,
    derivedResources: [
      {
        id: 'ifc-import-audit',
        slots: ['ifc.audit'],
        role: 'ifc-import-audit',
        required: false,
        mediaType: 'application/x-ndjson',
      },
    ],
    sourceFiles: [
      {
        id: 'original-ifc',
        slots: ['ifc.source'],
        role: 'ifc',
        fileName: 'House.ifc',
        mediaType: 'model/ifc',
      },
    ],
  });
  expect([...contents.derivedResources[0]!.bytes]).toEqual(expectedAuditBytes);
  expect([...contents.sourceFiles[0]!.bytes]).toEqual(expectedSourceBytes);
}

describe('complete geometry document resource lifecycle', () => {
  it('captures rich session input and prevents caller mutation through inputs or snapshots', () => {
    const auditBytes = new Uint8Array([1, 2, 3]);
    const sourceBytes = new Uint8Array([4, 5, 6]);
    const input = richContents('model,0\n', auditBytes, sourceBytes);
    const session = createInMemoryGeometryDocumentSession({
      ...input,
      persisted: true,
    });

    input.derivedResources[0]!.slots[0] = 'changed.audit';
    input.sourceFiles[0]!.fileName = 'Changed.ifc';
    auditBytes[0] = 99;
    sourceBytes[0] = 98;

    const snapshot = session.getSnapshot();
    expectRichContents(snapshot);
    expect(Object.isFrozen(snapshot.derivedResources)).toBe(true);
    expect(Object.isFrozen(snapshot.derivedResources[0])).toBe(true);
    expect(Object.isFrozen(snapshot.derivedResources[0]!.slots)).toBe(true);
    expect(Object.isFrozen(snapshot.sourceFiles)).toBe(true);

    snapshot.derivedResources[0]!.bytes[0] = 77;
    snapshot.sourceFiles[0]!.bytes[0] = 76;
    expectRichContents(session.getSnapshot());
  });

  it('preserves resources on model edits and marks only semantic resource changes dirty', () => {
    const session = createInMemoryGeometryDocumentSession({
      ...richContents(),
      persisted: true,
    });
    const initial = session.getSnapshot();

    const identical = session.updateDocument({
      derivedResources: richContents().derivedResources,
      sourceFiles: richContents().sourceFiles,
    });
    expect(identical).toBe(initial);

    const modelEdit = session.updateDocument({ text: 'model,1\n' });
    expectRichContents(modelEdit, 'model,1\n');
    expect(modelEdit).toMatchObject({ revision: 1, isDirty: true });

    const changedResource = session.updateDocument({
      derivedResources: richContents(
        'ignored\n',
        new Uint8Array([9, 2, 3]),
      ).derivedResources,
    });
    expectRichContents(changedResource, 'model,1\n', [9, 2, 3]);
    expect(changedResource.revision).toBe(2);
  });

  it('becomes clean after exact model and resource reversion without rewinding revisions', () => {
    const session = createInMemoryGeometryDocumentSession({
      ...richContents(),
      persisted: true,
    });

    session.updateDocument({ text: 'model,changed\n' });
    const modelReverted = session.updateDocument({ text: 'model,0\n' });
    expect(modelReverted).toMatchObject({
      revision: 2,
      persistedRevision: 0,
      isDirty: false,
    });

    session.updateDocument({
      derivedResources: richContents(
        'ignored\n',
        new Uint8Array([9, 9, 9]),
      ).derivedResources,
    });
    const resourceReverted = session.updateDocument({
      derivedResources: richContents().derivedResources,
    });
    expect(resourceReverted).toMatchObject({
      revision: 4,
      persistedRevision: 0,
      isDirty: false,
    });
  });

  it('uses intrinsic Uint8Array bytes without invoking hostile iteration and rejects detached views', () => {
    let iteratorReads = 0;
    class HostileBytes extends Uint8Array {
      override get byteLength() {
        return 1;
      }

      override *[Symbol.iterator](): Uint8ArrayIterator<number> {
        iteratorReads += 1;
        yield 9;
        yield 8;
        yield 7;
      }
    }
    const hostile = new HostileBytes([1]);
    const session = createInMemoryGeometryDocumentSession({
      ...richContents('model,0\n', hostile),
      persisted: true,
    });
    expect([...session.getSnapshot().derivedResources[0]!.bytes]).toEqual([1]);
    expect(iteratorReads).toBe(0);

    const detached = new Uint8Array([2]);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(() =>
      createInMemoryGeometryDocumentSession({
        ...richContents('model,0\n', detached),
        persisted: true,
      }),
    ).toThrowError(PortableGeometryDocumentError);
  });

  it('wraps hostile provider resource accessors once as typed invalid requests', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider({
      id: 'community-hostile-resource-getters',
      createId: createIdSequence(),
    });
    for (const property of ['derivedResources', 'sourceFiles'] as const) {
      const cause = new Error(`hostile ${property}`);
      let reads = 0;
      const contents = {
        fileName: 'House.csv',
        text: 'model,0\n',
        get [property]() {
          reads += 1;
          throw cause;
        },
      };
      await expect(
        provider.documents.create({
          contents,
          projectGroupIds: [],
          sessionRevision: 0,
        }),
      ).rejects.toMatchObject({
        name: 'GeometryWorkspaceProviderError',
        code: 'invalid-request',
        resource: 'document',
        cause,
      } satisfies Partial<GeometryWorkspaceProviderError>);
      expect(reads).toBe(1);
    }
  });

  it('round-trips complete documents through create, open, update and duplicate', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider({
      id: 'community-resource-workspace',
      createId: createIdSequence(),
    });
    const created = await provider.documents.create({
      contents: richContents(),
      projectGroupIds: [],
      sessionRevision: 3,
    });
    expectRichContents(created.contents);

    created.contents.derivedResources[0]!.bytes[0] = 55;
    created.contents.sourceFiles[0]!.bytes[0] = 54;
    const opened = await provider.documents.open({
      id: created.entry.id,
      expectedStorageVersion: created.entry.storageVersion,
    });
    expectRichContents(opened.contents);

    const updated = await provider.documents.update({
      id: opened.entry.id,
      expectedStorageVersion: opened.entry.storageVersion,
      contents: richContents('model,1\n', new Uint8Array([7, 8, 9])),
      sessionRevision: 4,
    });
    expectRichContents(updated.contents, 'model,1\n', [7, 8, 9]);

    const duplicate = await provider.documents.duplicate({
      sourceId: updated.entry.id,
      expectedStorageVersion: updated.entry.storageVersion,
    });
    expect(duplicate.contents.fileName).toBe('House 2.csv');
    expectRichContents(
      { ...duplicate.contents, fileName: 'House.csv' },
      'model,1\n',
      [7, 8, 9],
    );
  });

  it('keeps dirty rich resources through coordinator save and duplicate-and-open', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider({
      id: 'community-coordinator-resources',
      createId: createIdSequence(),
      documents: [
        {
          id: 'document-current',
          contents: richContents(),
        },
      ],
    });
    const active = (await provider.getSnapshot()).documents[0]!;
    const session = createInMemoryGeometryDocumentSession({
      ...richContents(),
      persisted: true,
    });
    const coordinator = createGeometryDocumentCoordinator({
      provider,
      session,
      activeDocument: active,
    });

    session.updateDocument({
      sourceFiles: richContents(
        'ignored\n',
        undefined,
        new Uint8Array([6, 5, 4]),
      ).sourceFiles,
    });
    const saved = await coordinator.save();
    expect(saved).toMatchObject({ status: 'completed' });
    expect(session.getSnapshot().isDirty).toBe(false);

    const savedEntry = coordinator.getActiveDocument()!;
    const stored = await provider.documents.open({
      id: savedEntry.id,
      expectedStorageVersion: savedEntry.storageVersion,
    });
    expectRichContents(stored.contents, 'model,0\n', [1, 2, 3], [6, 5, 4]);

    const duplicated = await coordinator.duplicateAndOpen({
      document: savedEntry,
      confirmed: true,
    });
    expect(duplicated).toMatchObject({
      status: 'completed',
      activeDocument: { fileName: 'House 2.csv' },
    });
    expectRichContents(
      { ...session.getSnapshot(), fileName: 'House.csv' },
      'model,0\n',
      [1, 2, 3],
      [6, 5, 4],
    );
  });

  it('replaces the complete resource set when opening another saved document', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider({
      id: 'community-open-resources',
      createId: createIdSequence(),
      documents: [
        { id: 'first', contents: richContents() },
        {
          id: 'second',
          contents: {
            ...richContents(
              'second,0\n',
              new Uint8Array([8]),
              new Uint8Array([9]),
            ),
            fileName: 'Second.csv',
          },
        },
      ],
    });
    const catalogue = await provider.getSnapshot();
    const first = catalogue.documents.find((entry) => entry.id === 'first')!;
    const second = catalogue.documents.find((entry) => entry.id === 'second')!;
    const session = createInMemoryGeometryDocumentSession({
      ...richContents(),
      persisted: true,
    });
    const coordinator = createGeometryDocumentCoordinator({
      provider,
      session,
      activeDocument: first,
    });

    await expect(coordinator.open({ document: second })).resolves.toMatchObject({
      status: 'completed',
    });
    expect(session.getSnapshot().fileName).toBe('Second.csv');
    expectRichContents(
      { ...session.getSnapshot(), fileName: 'House.csv' },
      'second,0\n',
      [8],
      [9],
    );
  });

  it('rejects forged inactive-duplicate contents before replacing the session', async () => {
    const realProvider = createInMemoryGeometryWorkspaceProvider({
      id: 'community-inactive-duplicate',
      createId: createIdSequence(),
      documents: [
        { id: 'current', contents: richContents() },
        {
          id: 'target',
          contents: {
            ...richContents(
              'target,0\n',
              new Uint8Array([8]),
              new Uint8Array([9]),
            ),
            fileName: 'Target.csv',
          },
        },
      ],
    });
    const catalogue = await realProvider.getSnapshot();
    const current = catalogue.documents.find((entry) => entry.id === 'current')!;
    const target = catalogue.documents.find((entry) => entry.id === 'target')!;
    const duplicate = vi.fn(async () => ({
      entry: Object.freeze({
        id: 'forged-copy',
        fileName: 'Target 2.csv',
        modifiedAt: null,
        storageVersion: 'document:0',
        projectGroupIds: Object.freeze([]),
      }),
      contents: Object.freeze({
        fileName: 'Target 2.csv',
        text: 'ATTACKER\n',
        derivedResources: Object.freeze([]),
        sourceFiles: Object.freeze([]),
      }),
      snapshot: await realProvider.getSnapshot(),
    }));
    const provider = {
      ...realProvider,
      documents: { ...realProvider.documents, duplicate },
    };
    const session = createInMemoryGeometryDocumentSession({
      ...richContents(),
      persisted: true,
    });
    const coordinator = createGeometryDocumentCoordinator({
      provider,
      session,
      activeDocument: current,
    });

    await expect(
      coordinator.duplicateAndOpen({ document: target, confirmed: true }),
    ).rejects.toMatchObject({ code: 'invalid-provider-receipt' });
    expect(session.getSnapshot()).toMatchObject({
      fileName: 'House.csv',
      text: 'model,0\n',
    });
  });

  it('rejects inactive duplicate memberships that match only the caller entry', async () => {
    const realProvider = createInMemoryGeometryWorkspaceProvider({
      id: 'community-inactive-membership-duplicate',
      createId: createIdSequence(),
      projectGroups: [
        { id: 'stored-project', name: 'Stored project' },
        { id: 'forged-project', name: 'Forged project' },
      ],
      documents: [
        { id: 'current', contents: richContents() },
        {
          id: 'target',
          contents: { ...richContents(), fileName: 'Target.csv' },
          projectGroupIds: ['stored-project'],
        },
      ],
    });
    const catalogue = await realProvider.getSnapshot();
    const current = catalogue.documents.find((entry) => entry.id === 'current')!;
    const target = catalogue.documents.find((entry) => entry.id === 'target')!;
    const duplicate = vi.fn(async (
      request: Parameters<typeof realProvider.documents.duplicate>[0],
    ) => {
      const receipt = await realProvider.documents.duplicate(request);
      return Object.freeze({
        ...receipt,
        entry: Object.freeze({
          ...receipt.entry,
          projectGroupIds: Object.freeze(['forged-project']),
        }),
      });
    });
    const coordinator = createGeometryDocumentCoordinator({
      provider: {
        ...realProvider,
        documents: { ...realProvider.documents, duplicate },
      },
      session: createInMemoryGeometryDocumentSession({
        ...richContents(),
        persisted: true,
      }),
      activeDocument: current,
    });

    await expect(
      coordinator.duplicateAndOpen({
        document: Object.freeze({
          ...target,
          projectGroupIds: Object.freeze(['forged-project']),
        }),
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'invalid-provider-receipt' });
  });

  it('maps malformed open, save and duplicate resource receipts to coordinator errors', async () => {
    const malformedContents = {
      ...richContents(),
      derivedResources: [
        {
          ...richContents().derivedResources[0]!,
          bytes: 'not-bytes',
        },
      ],
    } as unknown as GeometryDocumentContents;

    const openProvider = createInMemoryGeometryWorkspaceProvider({
      id: 'community-malformed-open',
      createId: createIdSequence(),
      documents: [
        { id: 'current', contents: richContents() },
        {
          id: 'target',
          contents: { ...richContents(), fileName: 'Target.csv' },
        },
      ],
    });
    const openCatalogue = await openProvider.getSnapshot();
    const openCurrent = openCatalogue.documents.find(
      (entry) => entry.id === 'current',
    )!;
    const openTarget = openCatalogue.documents.find(
      (entry) => entry.id === 'target',
    )!;
    const openSession = createInMemoryGeometryDocumentSession({
      ...richContents(),
      persisted: true,
    });
    const openCoordinator = createGeometryDocumentCoordinator({
      provider: {
        ...openProvider,
        documents: {
          ...openProvider.documents,
          open: vi.fn(async () => ({
            entry: openTarget,
            contents: malformedContents,
          })),
        },
      },
      session: openSession,
      activeDocument: openCurrent,
    });
    await expect(
      openCoordinator.open({ document: openTarget }),
    ).rejects.toMatchObject({
      name: 'GeometryDocumentCoordinatorError',
      code: 'invalid-provider-receipt',
      cause: { name: 'PortableGeometryDocumentError', code: 'invalid-input' },
    });

    const saveProvider = createInMemoryGeometryWorkspaceProvider({
      id: 'community-malformed-save',
      createId: createIdSequence(),
      documents: [{ id: 'current', contents: richContents() }],
    });
    const saveActive = (await saveProvider.getSnapshot()).documents[0]!;
    const saveSession = createInMemoryGeometryDocumentSession({
      ...richContents(),
      persisted: true,
    });
    saveSession.updateDocument({ text: 'model,1\n' });
    const saveCoordinator = createGeometryDocumentCoordinator({
      provider: {
        ...saveProvider,
        documents: {
          ...saveProvider.documents,
          update: vi.fn(async (request) => ({
            entry: saveActive,
            contents: malformedContents,
            persistedSessionRevision: request.sessionRevision,
            snapshot: await saveProvider.getSnapshot(),
          })),
        },
      },
      session: saveSession,
      activeDocument: saveActive,
    });
    await expect(saveCoordinator.save()).rejects.toMatchObject({
      name: 'GeometryDocumentCoordinatorError',
      code: 'invalid-save-receipt',
      cause: { name: 'PortableGeometryDocumentError', code: 'invalid-input' },
    });

    const duplicateProvider = createInMemoryGeometryWorkspaceProvider({
      id: 'community-malformed-duplicate',
      createId: createIdSequence(),
      documents: [{ id: 'current', contents: richContents() }],
    });
    const duplicateActive = (await duplicateProvider.getSnapshot()).documents[0]!;
    const duplicateSession = createInMemoryGeometryDocumentSession({
      ...richContents(),
      persisted: true,
    });
    const duplicateCoordinator = createGeometryDocumentCoordinator({
      provider: {
        ...duplicateProvider,
        documents: {
          ...duplicateProvider.documents,
          duplicate: vi.fn(async () => ({
            entry: Object.freeze({
              ...duplicateActive,
              id: 'copy',
              fileName: 'House 2.csv',
            }),
            contents: malformedContents,
            persistedSessionRevision: duplicateSession.getSnapshot().revision,
            snapshot: await duplicateProvider.getSnapshot(),
          })),
        },
      },
      session: duplicateSession,
      activeDocument: duplicateActive,
    });
    await expect(
      duplicateCoordinator.duplicateAndOpen({
        document: duplicateActive,
        confirmed: true,
      }),
    ).rejects.toMatchObject({
      name: 'GeometryDocumentCoordinatorError',
      code: 'invalid-provider-receipt',
      cause: { name: 'PortableGeometryDocumentError', code: 'invalid-input' },
    });
  });

  it('retains source privacy choices after a provider round trip', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider({
      id: 'community-portable-resources',
      createId: createIdSequence(),
      documents: [{ id: 'document-house', contents: richContents() }],
    });
    const entry = (await provider.getSnapshot()).documents[0]!;
    const opened = await provider.documents.open({
      id: entry.id,
      expectedStorageVersion: entry.storageVersion,
    });
    const document = toPortableGeometryDocument(opened.contents);

    const defaultDecoded = await decodePortableGeometryDocument(
      await encodePortableGeometryDocument(document),
    );
    expect(defaultDecoded.derivedResources).toHaveLength(1);
    expect(defaultDecoded.sourceFiles).toEqual([]);

    const explicitDecoded = await decodePortableGeometryDocument(
      await encodePortableGeometryDocument(document, {
        includeSourceFileIds: ['original-ifc'],
      }),
    );
    expect(explicitDecoded.sourceFiles).toHaveLength(1);
    expect([...explicitDecoded.sourceFiles[0]!.bytes]).toEqual([4, 5, 6]);
  });

  it('does not inspect source files when adapting a session for default portable encoding', async () => {
    let sourceReads = 0;
    const contents = {
      fileName: 'House.csv',
      text: 'model,0\n',
      derivedResources: Object.freeze([]),
      get sourceFiles() {
        sourceReads += 1;
        return richContents().sourceFiles;
      },
    } as GeometryDocumentContents;
    const document = toPortableGeometryDocument(contents);

    await expect(
      decodePortableGeometryDocument(
        await encodePortableGeometryDocument(document),
      ),
    ).resolves.toMatchObject({ sourceFiles: [] });
    expect(sourceReads).toBe(0);

    await expect(
      decodePortableGeometryDocument(
        await encodePortableGeometryDocument(document, {
          includeSourceFileIds: ['original-ifc'],
        }),
      ),
    ).resolves.toMatchObject({
      sourceFiles: [{ id: 'original-ifc' }],
    });
    expect(sourceReads).toBe(1);
  });
});
