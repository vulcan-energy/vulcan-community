// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometryDocumentContents,
  GeometryDocumentPatch,
  GeometryDocumentReplacement,
  GeometryDocumentSession,
  GeometryDocumentSnapshot,
  GeometryDocumentSubscriber,
} from './contracts';
import {
  captureGeometryDocumentContents,
  geometryDocumentContentsEqual,
} from './documentContents';

function createSnapshot(
  contents: GeometryDocumentContents,
  revision: number,
  persistedRevision: number | null,
  isDirty: boolean,
): GeometryDocumentSnapshot {
  return Object.freeze({
    ...contents,
    revision,
    persistedRevision,
    isDirty,
  });
}

class InMemoryGeometryDocumentSession implements GeometryDocumentSession {
  private currentSnapshot: GeometryDocumentSnapshot;
  private currentDocumentStartRevision = 0;
  private persistedContents: GeometryDocumentContents | null = null;
  private readonly issuedSnapshots = new WeakSet<GeometryDocumentSnapshot>();
  private readonly subscribers = new Set<GeometryDocumentSubscriber>();

  constructor(initial: GeometryDocumentReplacement) {
    const contents = captureGeometryDocumentContents(initial);
    const persisted = initial.persisted;
    this.persistedContents = persisted ? contents : null;
    this.currentSnapshot = this.issueSnapshot(contents, 0, persisted ? 0 : null);
  }

  getSnapshot(): GeometryDocumentSnapshot {
    return this.currentSnapshot;
  }

  replaceDocument(
    replacement: GeometryDocumentReplacement,
  ): GeometryDocumentSnapshot {
    const contents = captureGeometryDocumentContents(replacement);
    const persisted = replacement.persisted;
    const revision = this.currentSnapshot.revision + 1;
    this.currentDocumentStartRevision = revision;
    this.persistedContents = persisted ? contents : null;
    this.currentSnapshot = this.issueSnapshot(
      contents,
      revision,
      persisted ? revision : null,
    );
    this.notify();
    return this.currentSnapshot;
  }

  updateDocument(patch: GeometryDocumentPatch): GeometryDocumentSnapshot {
    const current = this.currentSnapshot;
    const rawFileName = patch.fileName;
    const rawText = patch.text;
    const rawDerivedResources = patch.derivedResources;
    const rawSourceFiles = patch.sourceFiles;
    const contents = captureGeometryDocumentContents({
      fileName: rawFileName === undefined ? current.fileName : rawFileName,
      text: rawText === undefined ? current.text : rawText,
      derivedResources:
        rawDerivedResources === undefined
          ? current.derivedResources
          : rawDerivedResources,
      sourceFiles:
        rawSourceFiles === undefined ? current.sourceFiles : rawSourceFiles,
    });

    if (geometryDocumentContentsEqual(contents, current)) {
      return current;
    }

    this.currentSnapshot = this.issueSnapshot(
      contents,
      current.revision + 1,
      current.persistedRevision,
    );
    this.notify();
    return this.currentSnapshot;
  }

  acknowledgePersisted(
    candidate: GeometryDocumentSnapshot,
  ): GeometryDocumentSnapshot {
    const current = this.currentSnapshot;
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      !this.issuedSnapshots.has(candidate)
    ) {
      throw new TypeError(
        'Persisted candidate must be a snapshot issued by this document session',
      );
    }
    const revision = candidate.revision;
    if (revision > current.revision) {
      throw new RangeError(
        `Cannot acknowledge future revision ${revision}; current revision is ${current.revision}`,
      );
    }
    if (revision < this.currentDocumentStartRevision) {
      return current;
    }
    const persistedContents = captureGeometryDocumentContents(candidate);
    if (
      revision === current.persistedRevision &&
      this.persistedContents !== null &&
      geometryDocumentContentsEqual(
        persistedContents,
        this.persistedContents,
      )
    ) {
      return current;
    }

    this.persistedContents = persistedContents;
    this.currentSnapshot = this.issueSnapshot(
      current,
      current.revision,
      revision,
    );
    this.notify();
    return this.currentSnapshot;
  }

  subscribe(subscriber: GeometryDocumentSubscriber): () => void {
    this.subscribers.add(subscriber);
    let subscribed = true;

    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.subscribers.delete(subscriber);
    };
  }

  private notify(): void {
    const snapshot = this.currentSnapshot;
    for (const subscriber of [...this.subscribers]) {
      subscriber(snapshot);
    }
  }

  private issueSnapshot(
    contents: GeometryDocumentContents,
    revision: number,
    persistedRevision: number | null,
  ): GeometryDocumentSnapshot {
    const snapshot = createSnapshot(
      contents,
      revision,
      persistedRevision,
      this.persistedContents === null ||
        !geometryDocumentContentsEqual(contents, this.persistedContents),
    );
    this.issuedSnapshots.add(snapshot);
    return snapshot;
  }
}

export function createInMemoryGeometryDocumentSession(
  initial: GeometryDocumentReplacement,
): GeometryDocumentSession {
  return new InMemoryGeometryDocumentSession(initial);
}
