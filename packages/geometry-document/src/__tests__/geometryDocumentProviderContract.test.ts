// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createInMemoryGeometryWorkspaceProvider,
  filterGeometryDocumentCatalogueEntries,
  GeometryWorkspaceProviderError,
  type GeometryWorkspaceProviderIdKind,
} from '../index';

const seed = () => ({
  id: 'community-local',
  createId: (() => {
    let nextDocument = 1;
    let nextProject = 1;
    return (kind: GeometryWorkspaceProviderIdKind) =>
      kind === 'document'
        ? `document-${nextDocument++}`
        : `project-${nextProject++}`;
  })(),
  documents: [
    {
      id: 'document-home',
      contents: { fileName: 'Home.csv', text: 'home,0\n' },
      projectGroupIds: ['project-a'],
    },
  ],
  projectGroups: [
    {
      id: 'project-a',
      name: 'Project A',
      description: 'Local grouping only',
    },
  ],
});

describe('in-memory geometry workspace provider', () => {
  it('creates isolated providers with stable frozen capabilities and deep-frozen snapshots', async () => {
    const first = createInMemoryGeometryWorkspaceProvider(seed());
    const second = createInMemoryGeometryWorkspaceProvider(seed());

    expect(first).not.toBe(second);
    expect(first.capabilities).toEqual({
      persistence: 'session',
      externalChanges: 'manual-refresh',
      create: true,
      update: true,
      duplicate: true,
      delete: true,
      projectGroups: true,
    });
    expect(Object.isFrozen(first.capabilities)).toBe(true);

    const snapshot = await first.getSnapshot();
    expect(snapshot).toMatchObject({
      providerId: 'community-local',
      catalogueVersion: 'catalogue:0',
      documents: [
        {
          id: 'document-home',
          fileName: 'Home.csv',
          storageVersion: 'document:0',
          projectGroupIds: ['project-a'],
          modifiedAt: null,
        },
      ],
      projectGroups: [
        {
          id: 'project-a',
          name: 'Project A',
          storageVersion: 'project-group:0',
        },
      ],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.documents)).toBe(true);
    expect(Object.isFrozen(snapshot.documents[0])).toBe(true);
    expect(Object.isFrozen(snapshot.documents[0]!.projectGroupIds)).toBe(true);
    expect(Object.isFrozen(snapshot.projectGroups)).toBe(true);

    await first.documents.create({
      contents: { fileName: 'First only.csv', text: 'first\n' },
      projectGroupIds: [],
      sessionRevision: 1,
    });
    expect((await second.getSnapshot()).documents).toHaveLength(1);
  });

  it('opens and updates by stable id/version and echoes only the captured session revision', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider(seed());
    const initial = (await provider.getSnapshot()).documents[0]!;

    await expect(
      provider.documents.open({
        id: initial.id,
        expectedStorageVersion: initial.storageVersion,
      }),
    ).resolves.toMatchObject({
      entry: initial,
      contents: { fileName: 'Home.csv', text: 'home,0\n' },
    });

    const receipt = await provider.documents.update({
      id: initial.id,
      expectedStorageVersion: initial.storageVersion,
      contents: { fileName: 'Home renamed.csv', text: 'home,1\n' },
      sessionRevision: 7,
    });

    expect(receipt).toMatchObject({
      persistedSessionRevision: 7,
      entry: {
        id: initial.id,
        fileName: 'Home renamed.csv',
        storageVersion: 'document:1',
      },
      contents: { fileName: 'Home renamed.csv', text: 'home,1\n' },
      snapshot: { catalogueVersion: 'catalogue:1' },
    });
    expect(Object.isFrozen(receipt)).toBe(true);

    await expect(
      provider.documents.update({
        id: initial.id,
        expectedStorageVersion: initial.storageVersion,
        contents: { fileName: 'stale.csv', text: 'stale\n' },
        sessionRevision: 8,
      }),
    ).rejects.toMatchObject({
      name: 'GeometryWorkspaceProviderError',
      code: 'version-conflict',
      resource: 'document',
    });
    expect((await provider.documents.open({
      id: receipt.entry.id,
      expectedStorageVersion: receipt.entry.storageVersion,
    })).contents.text).toBe('home,1\n');
  });

  it('fails concurrent stale saves closed instead of letting an older write win', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider(seed());
    const initial = (await provider.getSnapshot()).documents[0]!;

    const first = provider.documents.update({
      id: initial.id,
      expectedStorageVersion: initial.storageVersion,
      contents: { fileName: 'Home.csv', text: 'first\n' },
      sessionRevision: 1,
    });
    const stale = provider.documents.update({
      id: initial.id,
      expectedStorageVersion: initial.storageVersion,
      contents: { fileName: 'Home.csv', text: 'stale\n' },
      sessionRevision: 2,
    });

    const firstReceipt = await first;
    await expect(stale).rejects.toMatchObject({ code: 'version-conflict' });
    await expect(
      provider.documents.open({
        id: firstReceipt.entry.id,
        expectedStorageVersion: firstReceipt.entry.storageVersion,
      }),
    ).resolves.toMatchObject({ contents: { text: 'first\n' } });
  });

  it('snapshots request getters and mutable arrays exactly once before returning', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider(seed());
    const reads = {
      contents: 0,
      fileName: 0,
      text: 0,
      projectGroupIds: 0,
      sessionRevision: 0,
    };
    const memberships = ['project-a'];
    const contents = {
      get fileName() {
        reads.fileName += 1;
        return 'Captured.csv';
      },
      get text() {
        reads.text += 1;
        return 'captured\n';
      },
    };
    const request = {
      get contents() {
        reads.contents += 1;
        return contents;
      },
      get projectGroupIds() {
        reads.projectGroupIds += 1;
        return memberships;
      },
      get sessionRevision() {
        reads.sessionRevision += 1;
        return 4;
      },
    };

    const pending = provider.documents.create(request);
    memberships[0] = 'missing-after-call';
    const receipt = await pending;

    expect(reads).toEqual({
      contents: 1,
      fileName: 1,
      text: 1,
      projectGroupIds: 1,
      sessionRevision: 1,
    });
    expect(receipt.entry.projectGroupIds).toEqual(['project-a']);
    expect(receipt.contents).toEqual({
      fileName: 'Captured.csv',
      text: 'captured\n',
      derivedResources: [],
      sourceFiles: [],
    });
  });

  it('allocates concurrent duplicates atomically and inherits live project memberships', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider(seed());
    const source = (await provider.getSnapshot()).documents[0]!;

    const firstPending = provider.documents.duplicate({
      sourceId: source.id,
      expectedStorageVersion: source.storageVersion,
    });
    const secondPending = provider.documents.duplicate({
      sourceId: source.id,
      expectedStorageVersion: source.storageVersion,
    });
    const [first, second] = await Promise.all([firstPending, secondPending]);

    expect([first.entry.fileName, second.entry.fileName]).toEqual([
      'Home 2.csv',
      'Home 3.csv',
    ]);
    expect(first.entry.id).not.toBe(second.entry.id);
    expect(first.entry.projectGroupIds).toEqual(['project-a']);
    expect(second.entry.projectGroupIds).toEqual(['project-a']);
    expect(first.contents.text).toBe('home,0\n');
    expect(second.contents.text).toBe('home,0\n');
  });

  it('requires duplicate content and its captured session revision together', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider(seed());
    const source = (await provider.getSnapshot()).documents[0]!;
    const before = await provider.getSnapshot();

    await expect(
      provider.documents.duplicate({
        sourceId: source.id,
        expectedStorageVersion: source.storageVersion,
        contents: { fileName: 'Dirty.csv', text: 'dirty\n' },
      }),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    expect(await provider.getSnapshot()).toEqual(before);
  });

  it('leaves no partial document or membership when duplicate id allocation fails', async () => {
    const config = seed();
    config.createId = () => 'document-home';
    const provider = createInMemoryGeometryWorkspaceProvider(config);
    const before = await provider.getSnapshot();
    const source = before.documents[0]!;

    await expect(
      provider.documents.duplicate({
        sourceId: source.id,
        expectedStorageVersion: source.storageVersion,
      }),
    ).rejects.toMatchObject({ code: 'duplicate-id' });
    expect(await provider.getSnapshot()).toEqual(before);
  });

  it('never reuses a deleted opaque id for a different resource', async () => {
    const config = seed();
    config.createId = () => 'document-home';
    const provider = createInMemoryGeometryWorkspaceProvider(config);
    const document = (await provider.getSnapshot()).documents[0]!;
    await provider.documents.delete({
      id: document.id,
      expectedStorageVersion: document.storageVersion,
    });
    const afterDelete = await provider.getSnapshot();

    await expect(
      provider.documents.create({
        contents: { fileName: 'Replacement.csv', text: 'replacement\n' },
        projectGroupIds: [],
        sessionRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'duplicate-id' });
    expect(await provider.getSnapshot()).toEqual(afterDelete);
  });

  it('tombstones deleted opaque ids across document and project-group resource kinds', async () => {
    const documentIdConfig = seed();
    documentIdConfig.createId = () => 'document-home';
    const documentIdProvider = createInMemoryGeometryWorkspaceProvider(
      documentIdConfig,
    );
    const deletedDocument = (await documentIdProvider.getSnapshot()).documents[0]!;
    await documentIdProvider.documents.delete({
      id: deletedDocument.id,
      expectedStorageVersion: deletedDocument.storageVersion,
    });
    const afterDocumentDelete = await documentIdProvider.getSnapshot();

    await expect(
      documentIdProvider.projectGroups.create({ name: 'Project B' }),
    ).rejects.toMatchObject({
      code: 'duplicate-id',
      resource: 'project-group',
      id: deletedDocument.id,
    });
    expect(await documentIdProvider.getSnapshot()).toEqual(afterDocumentDelete);

    const projectIdConfig = seed();
    projectIdConfig.createId = () => 'project-a';
    const projectIdProvider = createInMemoryGeometryWorkspaceProvider(
      projectIdConfig,
    );
    const deletedProjectGroup = (await projectIdProvider.getSnapshot())
      .projectGroups[0]!;
    await projectIdProvider.projectGroups.delete({
      id: deletedProjectGroup.id,
      expectedStorageVersion: deletedProjectGroup.storageVersion,
    });
    const afterProjectDelete = await projectIdProvider.getSnapshot();

    await expect(
      projectIdProvider.documents.create({
        contents: { fileName: 'Replacement.csv', text: 'replacement\n' },
        projectGroupIds: [],
        sessionRevision: 1,
      }),
    ).rejects.toMatchObject({
      code: 'duplicate-id',
      resource: 'document',
      id: deletedProjectGroup.id,
    });
    expect(await projectIdProvider.getSnapshot()).toEqual(afterProjectDelete);
  });

  it('fails stale deletes closed, removes deleted documents, and never deletes documents with a project group', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider(seed());
    const before = await provider.getSnapshot();
    const source = before.documents[0]!;

    await expect(
      provider.documents.delete({
        id: source.id,
        expectedStorageVersion: 'document:stale',
      }),
    ).rejects.toMatchObject({ code: 'version-conflict' });
    expect(await provider.getSnapshot()).toEqual(before);

    const project = before.projectGroups[0]!;
    const deletedProject = await provider.projectGroups.delete({
      id: project.id,
      expectedStorageVersion: project.storageVersion,
    });
    expect(deletedProject.snapshot.projectGroups).toEqual([]);
    expect(deletedProject.snapshot.documents).toHaveLength(1);
    expect(deletedProject.snapshot.documents[0]!.projectGroupIds).toEqual([]);

    const currentDocument = deletedProject.snapshot.documents[0]!;
    const deletedDocument = await provider.documents.delete({
      id: currentDocument.id,
      expectedStorageVersion: currentDocument.storageVersion,
    });
    expect(deletedDocument.snapshot.documents).toEqual([]);
  });

  it('preserves documents on project-group deletion and invalidates their prior membership version', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider(seed());
    const before = await provider.getSnapshot();
    const documentBefore = before.documents[0]!;
    const projectGroup = before.projectGroups[0]!;

    const deletion = await provider.projectGroups.delete({
      id: projectGroup.id,
      expectedStorageVersion: projectGroup.storageVersion,
    });
    const documentAfter = deletion.snapshot.documents[0]!;

    expect(deletion.snapshot.projectGroups).toEqual([]);
    expect(deletion.snapshot.documents).toHaveLength(1);
    expect(documentAfter).toMatchObject({
      id: documentBefore.id,
      fileName: documentBefore.fileName,
      projectGroupIds: [],
    });
    expect(documentAfter.storageVersion).not.toBe(
      documentBefore.storageVersion,
    );

    await expect(
      provider.documents.open({
        id: documentBefore.id,
        expectedStorageVersion: documentBefore.storageVersion,
      }),
    ).rejects.toMatchObject({
      code: 'version-conflict',
      resource: 'document',
      id: documentBefore.id,
    });
    await expect(
      provider.documents.open({
        id: documentAfter.id,
        expectedStorageVersion: documentAfter.storageVersion,
      }),
    ).resolves.toMatchObject({
      entry: documentAfter,
      contents: { fileName: 'Home.csv', text: 'home,0\n' },
    });
  });

  it('validates project groups and document memberships by stable ids', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider(seed());
    const document = (await provider.getSnapshot()).documents[0]!;
    const created = await provider.projectGroups.create({
      name: 'Project B',
      description: 'Second group',
    });
    const updated = await provider.projectGroups.update({
      id: created.projectGroup.id,
      expectedStorageVersion: created.projectGroup.storageVersion,
      name: 'Project B renamed',
    });
    const membership = await provider.projectGroups.setDocumentMembership({
      documentId: document.id,
      expectedStorageVersion: document.storageVersion,
      projectGroupIds: ['project-a', updated.projectGroup.id],
    });

    expect(membership.entry.projectGroupIds).toEqual([
      'project-a',
      updated.projectGroup.id,
    ]);
    expect(new Set(membership.entry.projectGroupIds).size).toBe(2);

    const beforeFailure = await provider.getSnapshot();
    await expect(
      provider.projectGroups.setDocumentMembership({
        documentId: membership.entry.id,
        expectedStorageVersion: membership.entry.storageVersion,
        projectGroupIds: ['missing-project'],
      }),
    ).rejects.toMatchObject({
      code: 'not-found',
      resource: 'project-group',
    });
    expect(await provider.getSnapshot()).toEqual(beforeFailure);
  });

  it('filters with a discriminated all, unassigned, or project-group scope', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider(seed());
    const created = await provider.documents.create({
      contents: { fileName: 'Unassigned.csv', text: 'unassigned\n' },
      projectGroupIds: [],
      sessionRevision: 1,
    });
    const entries = created.snapshot.documents;

    expect(
      filterGeometryDocumentCatalogueEntries(entries, { kind: 'all' }).map(
        (entry) => entry.fileName,
      ),
    ).toEqual(['Home.csv', 'Unassigned.csv']);
    expect(
      filterGeometryDocumentCatalogueEntries(entries, {
        kind: 'unassigned',
      }).map((entry) => entry.fileName),
    ).toEqual(['Unassigned.csv']);
    expect(
      filterGeometryDocumentCatalogueEntries(entries, {
        kind: 'project',
        projectGroupId: 'project-a',
      }).map((entry) => entry.fileName),
    ).toEqual(['Home.csv']);
    expect(() =>
      filterGeometryDocumentCatalogueEntries(entries, {
        kind: 'project',
        projectGroupId: '',
      }),
    ).toThrow(GeometryWorkspaceProviderError);
  });

  it('returns documents and project groups in deterministic name order', async () => {
    const config = seed();
    config.documents[0]!.contents.fileName = 'Zulu.csv';
    config.projectGroups[0]!.name = 'Zulu project';
    const provider = createInMemoryGeometryWorkspaceProvider(config);
    await provider.projectGroups.create({ name: 'alpha project' });
    await provider.documents.create({
      contents: { fileName: 'alpha.csv', text: 'alpha\n' },
      projectGroupIds: [],
      sessionRevision: 1,
    });

    const snapshot = await provider.getSnapshot();
    expect(snapshot.documents.map((entry) => entry.fileName)).toEqual([
      'alpha.csv',
      'Zulu.csv',
    ]);
    expect(snapshot.projectGroups.map((entry) => entry.name)).toEqual([
      'alpha project',
      'Zulu project',
    ]);
  });

  it('reports unknown ids as typed not-found errors without name fallback', async () => {
    const provider = createInMemoryGeometryWorkspaceProvider(seed());

    await expect(
      provider.documents.open({
        id: 'Home.csv',
        expectedStorageVersion: 'document:0',
      }),
    ).rejects.toMatchObject({
      code: 'not-found',
      resource: 'document',
    });
  });

  it('rejects duplicate ids, unknown seed memberships, and case/Unicode name collisions', () => {
    const duplicateId = seed();
    duplicateId.projectGroups[0]!.id = 'document-home';
    expect(() => createInMemoryGeometryWorkspaceProvider(duplicateId)).toThrow(
      GeometryWorkspaceProviderError,
    );

    const unknownMembership = seed();
    unknownMembership.documents[0]!.projectGroupIds = ['missing'];
    expect(() => createInMemoryGeometryWorkspaceProvider(unknownMembership)).toThrow(
      GeometryWorkspaceProviderError,
    );

    const duplicateName = seed();
    duplicateName.documents.push({
      id: 'document-two',
      contents: { fileName: 'home.CSV', text: 'two\n' },
      projectGroupIds: [],
    });
    expect(() => createInMemoryGeometryWorkspaceProvider(duplicateName)).toThrow(
      GeometryWorkspaceProviderError,
    );

    const unicodeProjectCollision = seed();
    unicodeProjectCollision.projectGroups.push({
      id: 'project-two',
      name: 'Project A\u0301',
      description: '',
    });
    unicodeProjectCollision.projectGroups[0]!.name = 'Project Á';
    expect(() =>
      createInMemoryGeometryWorkspaceProvider(unicodeProjectCollision),
    ).toThrow(GeometryWorkspaceProviderError);
  });

  it('contains no filesystem, network, account, batch, lodgement, telemetry, or private imports', () => {
    const packageRoot = resolve(import.meta.dirname, '..');
    for (const fileName of [
      'providerContracts.ts',
      'documentNaming.ts',
      'inMemoryGeometryWorkspaceProvider.ts',
      'geometryDocumentCoordinator.ts',
    ]) {
      const source = readFileSync(resolve(packageRoot, fileName), 'utf8');
      expect(source).not.toMatch(
        /FileSystemDirectoryHandle|showDirectoryPicker|indexedDB|(?:window\.)?fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/,
      );
      expect(source).not.toMatch(
        /@repo\/core|web\/src|workspaceStore|projectStore|authStore|batch|lodgement|telemetry/i,
      );
    }
  });
});
