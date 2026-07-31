// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  createInMemoryGeometryDocumentSession,
  type GeometryDocumentSnapshot,
} from '../index';

describe('in-memory geometry document session', () => {
  it('represents persisted and draft initial documents explicitly', () => {
    const persisted = createInMemoryGeometryDocumentSession({
      fileName: 'home.csv',
      text: 'version,0\n',
      persisted: true,
    });
    const draft = createInMemoryGeometryDocumentSession({
      fileName: 'draft.csv',
      text: '',
      persisted: false,
    });

    expect(persisted.getSnapshot()).toEqual({
      fileName: 'home.csv',
      text: 'version,0\n',
      derivedResources: [],
      sourceFiles: [],
      revision: 0,
      persistedRevision: 0,
      isDirty: false,
    });
    expect(draft.getSnapshot()).toMatchObject({
      revision: 0,
      persistedRevision: null,
      isDirty: true,
    });
    expect(Object.isFrozen(persisted.getSnapshot())).toBe(true);
    expect(Object.isFrozen(draft.getSnapshot())).toBe(true);
  });

  it('publishes one immutable revision for an atomic change and nothing for a no-op', () => {
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'home.csv',
      text: 'version,0\n',
      persisted: true,
    });
    const initial = session.getSnapshot();
    const listener = vi.fn<(snapshot: GeometryDocumentSnapshot) => void>();
    session.subscribe(listener);

    expect(listener).not.toHaveBeenCalled();
    const changed = session.updateDocument({
      fileName: 'renamed.csv',
      text: 'version,1\n',
    });
    const noOp = session.updateDocument({
      fileName: 'renamed.csv',
      text: 'version,1\n',
    });

    expect(changed).toMatchObject({ revision: 1, isDirty: true });
    expect(Object.isFrozen(changed)).toBe(true);
    expect(noOp).toBe(changed);
    expect(session.getSnapshot()).toBe(changed);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(changed);
    expect(initial).toEqual({
      fileName: 'home.csv',
      text: 'version,0\n',
      derivedResources: [],
      sourceFiles: [],
      revision: 0,
      persistedRevision: 0,
      isDirty: false,
    });
  });

  it('does not let a late save acknowledgement clear a newer edit', () => {
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'home.csv',
      text: 'version,0\n',
      persisted: true,
    });
    const firstSaveCandidate = session.updateDocument({ text: 'version,1\n' });
    const newerEdit = session.updateDocument({ text: 'version,2\n' });

    expect(session.acknowledgePersisted(firstSaveCandidate)).toMatchObject({
      text: 'version,2\n',
      revision: newerEdit.revision,
      persistedRevision: firstSaveCandidate.revision,
      isDirty: true,
    });
    expect(session.acknowledgePersisted(newerEdit).isDirty).toBe(false);
  });

  it('represents the final storage state when same-document saves finish out of order', () => {
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'home.csv',
      text: 'version,0\n',
      persisted: true,
    });
    const olderWrite = session.updateDocument({ text: 'version,1\n' });
    const newerWrite = session.updateDocument({ text: 'version,2\n' });

    expect(session.acknowledgePersisted(newerWrite)).toMatchObject({
      persistedRevision: newerWrite.revision,
      isDirty: false,
    });
    expect(session.acknowledgePersisted(olderWrite)).toMatchObject({
      revision: newerWrite.revision,
      persistedRevision: olderWrite.revision,
      isDirty: true,
    });
  });

  it('ignores an acknowledgement captured from a document that has since been replaced', () => {
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'first.csv',
      text: 'first,0\n',
      persisted: true,
    });
    const oldSave = session.updateDocument({ text: 'first,1\n' });
    const replacement = session.replaceDocument({
      fileName: 'second.csv',
      text: 'second,0\n',
      persisted: true,
    });

    expect(replacement).toMatchObject({
      fileName: 'second.csv',
      revision: oldSave.revision + 1,
      persistedRevision: oldSave.revision + 1,
      isDirty: false,
    });
    expect(session.acknowledgePersisted(oldSave)).toBe(replacement);
    expect(session.getSnapshot()).toBe(replacement);
  });

  it('rejects persisted candidates not issued by this session', () => {
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'home.csv',
      text: '',
      persisted: false,
    });
    const other = createInMemoryGeometryDocumentSession({
      fileName: 'other.csv',
      text: '',
      persisted: false,
    });

    expect(() =>
      session.acknowledgePersisted(other.getSnapshot()),
    ).toThrow(TypeError);
  });

  it('notifies subscribers in order and supports idempotent unsubscribe', () => {
    const session = createInMemoryGeometryDocumentSession({
      fileName: 'home.csv',
      text: 'version,0\n',
      persisted: true,
    });
    const calls: string[] = [];
    const unsubscribeFirst = session.subscribe((snapshot) => {
      calls.push(`first:${snapshot.revision}:${snapshot.persistedRevision}`);
    });
    session.subscribe((snapshot) => {
      calls.push(`second:${snapshot.revision}:${snapshot.persistedRevision}`);
    });

    const edited = session.updateDocument({ text: 'version,1\n' });
    unsubscribeFirst();
    unsubscribeFirst();
    session.acknowledgePersisted(edited);

    expect(calls).toEqual([
      'first:1:0',
      'second:1:0',
      'second:1:1',
    ]);
  });
});
