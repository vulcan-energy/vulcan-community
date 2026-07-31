// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometryDocumentContents,
  GeometryDocumentInput,
  GeometryDocumentSession,
  GeometryDocumentSnapshot,
} from './contracts';
import {
  captureGeometryDocumentContents,
  geometryDocumentContentsEqual,
} from './documentContents';
import type {
  GeometryDocumentCatalogueEntry,
  GeometryDocumentDeleteReceipt,
  GeometryDocumentDuplicateReceipt,
  GeometryDocumentMembershipReceipt,
  GeometryDocumentPersistenceReceipt,
  GeometryProjectGroupCatalogueEntry,
  GeometryProjectGroupDeleteReceipt,
  GeometryStoredDocument,
  GeometryWorkspaceProvider,
  GeometryWorkspaceSnapshot,
} from './providerContracts';

export type GeometryDocumentDirtyDecision = 'save' | 'discard' | 'cancel';

export type GeometryDocumentCoordinatorErrorCode =
  | 'dirty-decision-required'
  | 'invalid-confirmation'
  | 'invalid-dirty-decision'
  | 'invalid-replacement-state'
  | 'invalid-provider-receipt'
  | 'invalid-save-receipt'
  | 'replacement-required';

export class GeometryDocumentCoordinatorError extends Error {
  readonly code: GeometryDocumentCoordinatorErrorCode;
  readonly cause?: unknown;

  constructor(
    code: GeometryDocumentCoordinatorErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'GeometryDocumentCoordinatorError';
    this.code = code;
    this.cause = cause;
  }
}

export type GeometryDocumentCoordinatorCompleted = Readonly<{
  status: 'completed';
  activeDocument: GeometryDocumentCatalogueEntry | null;
}>;

export type GeometryDocumentCoordinatorCancelled = Readonly<{
  status: 'cancelled';
}>;

export type GeometryDocumentCoordinatorSuperseded = Readonly<{
  status: 'superseded';
}>;

export type GeometryDocumentCoordinatorResult =
  | GeometryDocumentCoordinatorCompleted
  | GeometryDocumentCoordinatorCancelled
  | GeometryDocumentCoordinatorSuperseded;

export type GeometryDocumentCoordinatorOptions = Readonly<{
  provider: GeometryWorkspaceProvider;
  session: GeometryDocumentSession;
  activeDocument?: GeometryDocumentCatalogueEntry | null;
}>;

export type GeometryDocumentOpenRequest = Readonly<{
  document: GeometryDocumentCatalogueEntry;
  dirtyDecision?: GeometryDocumentDirtyDecision;
}>;

export type GeometryDocumentNewRequest = Readonly<{
  contents: GeometryDocumentInput;
  dirtyDecision?: GeometryDocumentDirtyDecision;
  /** Marks the replacement as a clean baseline even when it is not yet catalogued. */
  persisted?: boolean;
}>;

export type GeometryDocumentDeleteRequest = Readonly<{
  document: GeometryDocumentCatalogueEntry;
  confirmed: boolean;
  dirtyDecision?: GeometryDocumentDirtyDecision;
  replacement?: GeometryDocumentInput;
}>;

export type GeometryDocumentDuplicateAndOpenRequest = Readonly<{
  document: GeometryDocumentCatalogueEntry;
  confirmed: boolean;
  dirtyDecision?: GeometryDocumentDirtyDecision;
}>;

export type GeometryDocumentMembershipMutationRequest = Readonly<{
  document: GeometryDocumentCatalogueEntry;
  projectGroupIds: readonly string[];
}>;

export type GeometryProjectGroupDeletionRequest = Readonly<{
  projectGroup: GeometryProjectGroupCatalogueEntry;
  confirmed: boolean;
}>;

export interface GeometryDocumentCoordinator {
  getActiveDocument(): GeometryDocumentCatalogueEntry | null;
  save(): Promise<GeometryDocumentCoordinatorResult>;
  open(
    request: GeometryDocumentOpenRequest,
  ): Promise<GeometryDocumentCoordinatorResult>;
  newDocument(
    request: GeometryDocumentNewRequest,
  ): Promise<GeometryDocumentCoordinatorResult>;
  delete(
    request: GeometryDocumentDeleteRequest,
  ): Promise<GeometryDocumentCoordinatorResult>;
  duplicateAndOpen(
    request: GeometryDocumentDuplicateAndOpenRequest,
  ): Promise<GeometryDocumentCoordinatorResult>;
  setDocumentMembership(
    request: GeometryDocumentMembershipMutationRequest,
  ): Promise<GeometryDocumentCoordinatorResult>;
  deleteProjectGroup(
    request: GeometryProjectGroupDeletionRequest,
  ): Promise<GeometryDocumentCoordinatorResult>;
}

function captureContents(
  contents: GeometryDocumentInput,
): GeometryDocumentContents {
  return captureGeometryDocumentContents(contents);
}

function captureDocumentEntry(
  entry: GeometryDocumentCatalogueEntry,
): GeometryDocumentCatalogueEntry {
  const id = entry.id;
  const fileName = entry.fileName;
  const modifiedAt = entry.modifiedAt;
  const storageVersion = entry.storageVersion;
  const rawProjectGroupIds = entry.projectGroupIds;
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    typeof fileName !== 'string' ||
    fileName.length === 0 ||
    (modifiedAt !== null && typeof modifiedAt !== 'string') ||
    typeof storageVersion !== 'string' ||
    storageVersion.length === 0 ||
    !Array.isArray(rawProjectGroupIds)
  ) {
    throw new TypeError('Document catalogue entry is invalid');
  }
  const projectGroupIds = Object.freeze(
    Array.from(rawProjectGroupIds, (projectGroupId) => {
      if (typeof projectGroupId !== 'string' || projectGroupId.length === 0) {
        throw new TypeError('Document project-group id is invalid');
      }
      return projectGroupId;
    }),
  );
  if (new Set(projectGroupIds).size !== projectGroupIds.length) {
    throw new TypeError('Document project-group ids must be unique');
  }
  return Object.freeze({
    id,
    fileName,
    modifiedAt,
    storageVersion,
    projectGroupIds,
  });
}

function captureProjectGroupEntry(
  entry: GeometryProjectGroupCatalogueEntry,
): GeometryProjectGroupCatalogueEntry {
  const id = entry.id;
  const name = entry.name;
  const description = entry.description;
  const storageVersion = entry.storageVersion;
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    typeof name !== 'string' ||
    name.length === 0 ||
    typeof description !== 'string' ||
    typeof storageVersion !== 'string' ||
    storageVersion.length === 0
  ) {
    throw new TypeError('Project-group catalogue entry is invalid');
  }
  return Object.freeze({ id, name, description, storageVersion });
}

function captureProjectGroupIds(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Project-group ids must be an array');
  }
  const captured = Array.from(value, (projectGroupId) => {
      if (typeof projectGroupId !== 'string' || projectGroupId.length === 0) {
        throw new TypeError('Project-group id is invalid');
      }
      return projectGroupId;
    });
  if (new Set(captured).size !== captured.length) {
    throw new TypeError('Project-group ids must be unique');
  }
  captured.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return Object.freeze(captured);
}

type CapturedGeometryWorkspaceSnapshot = Readonly<{
  providerId: string;
  catalogueVersion: string;
  documents: readonly GeometryDocumentCatalogueEntry[];
  projectGroups: readonly GeometryProjectGroupCatalogueEntry[];
}>;

function captureWorkspaceSnapshot(
  snapshot: GeometryWorkspaceSnapshot,
): CapturedGeometryWorkspaceSnapshot {
  const providerId = snapshot.providerId;
  const catalogueVersion = snapshot.catalogueVersion;
  const rawDocuments = snapshot.documents;
  const rawProjectGroups = snapshot.projectGroups;
  if (
    typeof providerId !== 'string' ||
    providerId.length === 0 ||
    typeof catalogueVersion !== 'string' ||
    catalogueVersion.length === 0 ||
    !Array.isArray(rawDocuments) ||
    !Array.isArray(rawProjectGroups)
  ) {
    throw new TypeError('Workspace snapshot is invalid');
  }

  const documents = Object.freeze(
    Array.from(rawDocuments, (entry) => captureDocumentEntry(entry)),
  );
  const projectGroups = Object.freeze(
    Array.from(rawProjectGroups, (entry) => captureProjectGroupEntry(entry)),
  );
  const documentIds = new Set(documents.map((entry) => entry.id));
  const projectGroupIds = new Set(projectGroups.map((entry) => entry.id));
  if (
    documentIds.size !== documents.length ||
    projectGroupIds.size !== projectGroups.length
  ) {
    throw new TypeError('Workspace snapshot contains duplicate ids');
  }
  for (const document of documents) {
    if (
      document.projectGroupIds.some(
        (projectGroupId) => !projectGroupIds.has(projectGroupId),
      )
    ) {
      throw new TypeError(
        'Workspace snapshot contains an unknown project-group membership',
      );
    }
  }

  return Object.freeze({
    providerId,
    catalogueVersion,
    documents,
    projectGroups,
  });
}

function stringListsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function documentEntriesEqual(
  left: GeometryDocumentCatalogueEntry,
  right: GeometryDocumentCatalogueEntry,
): boolean {
  return (
    left.id === right.id &&
    left.fileName === right.fileName &&
    left.modifiedAt === right.modifiedAt &&
    left.storageVersion === right.storageVersion &&
    stringListsEqual(left.projectGroupIds, right.projectGroupIds)
  );
}

type CapturedGeometryDocumentPersistenceReceipt = Readonly<{
  entry: GeometryDocumentCatalogueEntry;
  contents: GeometryDocumentContents;
  persistedSessionRevision: number;
}>;

type CapturedGeometryStoredDocument = Readonly<{
  entry: GeometryDocumentCatalogueEntry;
  contents: GeometryDocumentContents;
}>;

type CapturedGeometryDocumentDuplicateReceipt =
  CapturedGeometryStoredDocument &
    Readonly<{
      persistedSessionRevision?: number;
    }>;

type CapturedGeometryDocumentMembershipReceipt = Readonly<{
  entry: GeometryDocumentCatalogueEntry;
  snapshot: CapturedGeometryWorkspaceSnapshot;
}>;

type CapturedGeometryProjectGroupDeleteReceipt = Readonly<{
  deletedProjectGroupId: string;
  snapshot: CapturedGeometryWorkspaceSnapshot;
}>;

function capturePersistenceReceipt(
  receipt: GeometryDocumentPersistenceReceipt,
): CapturedGeometryDocumentPersistenceReceipt {
  try {
    const rawEntry = receipt.entry;
    const rawContents = receipt.contents;
    const persistedSessionRevision = receipt.persistedSessionRevision;
    return Object.freeze({
      entry: captureDocumentEntry(rawEntry),
      contents: captureContents(rawContents),
      persistedSessionRevision,
    });
  } catch (cause) {
    throw new GeometryDocumentCoordinatorError(
      'invalid-save-receipt',
      'Provider save receipt could not be captured',
      cause,
    );
  }
}

function captureStoredDocument(
  stored: GeometryStoredDocument,
): CapturedGeometryStoredDocument {
  try {
    const rawEntry = stored.entry;
    const rawContents = stored.contents;
    return Object.freeze({
      entry: captureDocumentEntry(rawEntry),
      contents: captureContents(rawContents),
    });
  } catch (cause) {
    throw new GeometryDocumentCoordinatorError(
      'invalid-provider-receipt',
      'Provider open receipt could not be captured',
      cause,
    );
  }
}

function captureDuplicateReceipt(
  receipt: GeometryDocumentDuplicateReceipt,
): CapturedGeometryDocumentDuplicateReceipt {
  try {
    const rawEntry = receipt.entry;
    const rawContents = receipt.contents;
    const persistedSessionRevision = receipt.persistedSessionRevision;
    return Object.freeze({
      entry: captureDocumentEntry(rawEntry),
      contents: captureContents(rawContents),
      ...(persistedSessionRevision === undefined
        ? {}
        : { persistedSessionRevision }),
    });
  } catch (cause) {
    throw new GeometryDocumentCoordinatorError(
      'invalid-provider-receipt',
      'Provider duplicate receipt could not be captured',
      cause,
    );
  }
}

function captureMembershipReceipt(
  receipt: GeometryDocumentMembershipReceipt,
): CapturedGeometryDocumentMembershipReceipt {
  try {
    const rawEntry = receipt.entry;
    const rawSnapshot = receipt.snapshot;
    return Object.freeze({
      entry: captureDocumentEntry(rawEntry),
      snapshot: captureWorkspaceSnapshot(rawSnapshot),
    });
  } catch (cause) {
    throw new GeometryDocumentCoordinatorError(
      'invalid-provider-receipt',
      'Provider membership receipt could not be captured',
      cause,
    );
  }
}

function captureProjectGroupDeleteReceipt(
  receipt: GeometryProjectGroupDeleteReceipt,
): CapturedGeometryProjectGroupDeleteReceipt {
  try {
    const deletedProjectGroupId = receipt.deletedProjectGroupId;
    const rawSnapshot = receipt.snapshot;
    if (
      typeof deletedProjectGroupId !== 'string' ||
      deletedProjectGroupId.length === 0
    ) {
      throw new TypeError('Deleted project-group id is invalid');
    }
    return Object.freeze({
      deletedProjectGroupId,
      snapshot: captureWorkspaceSnapshot(rawSnapshot),
    });
  } catch (cause) {
    throw new GeometryDocumentCoordinatorError(
      'invalid-provider-receipt',
      'Provider project-group deletion receipt could not be captured',
      cause,
    );
  }
}

function captureDeletedDocumentId(
  receipt: GeometryDocumentDeleteReceipt,
): string {
  return receipt.deletedDocumentId;
}

function completed(
  activeDocument: GeometryDocumentCatalogueEntry | null,
): GeometryDocumentCoordinatorCompleted {
  return Object.freeze({ status: 'completed', activeDocument });
}

const CANCELLED: GeometryDocumentCoordinatorCancelled = Object.freeze({
  status: 'cancelled',
});

const SUPERSEDED: GeometryDocumentCoordinatorSuperseded = Object.freeze({
  status: 'superseded',
});

function captureDirtyDecision(
  value: unknown,
): GeometryDocumentDirtyDecision | undefined {
  if (
    value === undefined ||
    value === 'save' ||
    value === 'discard' ||
    value === 'cancel'
  ) {
    return value;
  }
  throw new GeometryDocumentCoordinatorError(
    'invalid-dirty-decision',
    'Dirty decision must be Save, Discard, or Cancel',
  );
}

function captureConfirmation(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  throw new GeometryDocumentCoordinatorError(
    'invalid-confirmation',
    'Confirmation must be an explicit boolean',
  );
}

class DefaultGeometryDocumentCoordinator
  implements GeometryDocumentCoordinator
{
  private readonly provider: GeometryWorkspaceProvider;
  private readonly providerId: string;
  private readonly session: GeometryDocumentSession;
  private activeDocument: GeometryDocumentCatalogueEntry | null;
  private navigationGeneration = 0;
  private documentGeneration = 0;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: GeometryDocumentCoordinatorOptions) {
    this.provider = options.provider;
    this.providerId = options.provider.id;
    this.session = options.session;
    const activeDocument = options.activeDocument;
    this.activeDocument = activeDocument
      ? captureDocumentEntry(activeDocument)
      : null;
  }

  getActiveDocument(): GeometryDocumentCatalogueEntry | null {
    return this.activeDocument;
  }

  save(): Promise<GeometryDocumentCoordinatorResult> {
    return this.runMutation(async () => {
      const capturedSession = this.session.getSnapshot();
      const capturedDocumentGeneration = this.documentGeneration;
      const capturedActive = this.activeDocument;
      const requestContents = captureContents(capturedSession);
      const rawReceipt = capturedActive
        ? await this.provider.documents.update({
            id: capturedActive.id,
            expectedStorageVersion: capturedActive.storageVersion,
            contents: requestContents,
            sessionRevision: capturedSession.revision,
          })
        : await this.provider.documents.create({
            contents: requestContents,
            projectGroupIds: [],
            sessionRevision: capturedSession.revision,
          });
      const receipt = capturePersistenceReceipt(rawReceipt);

      this.validateSaveReceipt(
        receipt,
        capturedSession,
        capturedActive?.id ?? null,
      );
      const acknowledged = this.session.acknowledgePersisted(
        capturedSession,
      );

      if (
        capturedDocumentGeneration === this.documentGeneration &&
        this.activeDocument === capturedActive &&
        acknowledged.persistedRevision === receipt.persistedSessionRevision
      ) {
        this.activeDocument = receipt.entry;
      }

      return completed(this.activeDocument);
    });
  }

  async open(
    request: GeometryDocumentOpenRequest,
  ): Promise<GeometryDocumentCoordinatorResult> {
    const document = captureDocumentEntry(request.document);
    const dirtyDecision = captureDirtyDecision(request.dirtyDecision);
    const navigation = ++this.navigationGeneration;

    if (this.session.getSnapshot().isDirty) {
      const dirtyResult = await this.resolveDirtyDecision(dirtyDecision);
      if (dirtyResult === 'cancelled') return CANCELLED;
      if (dirtyResult === 'superseded') return SUPERSEDED;
      if (
        navigation !== this.navigationGeneration ||
        this.session.getSnapshot().revision !== dirtyResult
      ) {
        return SUPERSEDED;
      }
    }

    if (
      this.activeDocument?.id === document.id &&
      this.activeDocument.storageVersion === document.storageVersion &&
      !this.session.getSnapshot().isDirty
    ) {
      return completed(this.activeDocument);
    }

    const replaceGuard = this.session.getSnapshot();
    const rawStored = await this.provider.documents.open({
      id: document.id,
      expectedStorageVersion: document.storageVersion,
    });
    const stored = captureStoredDocument(rawStored);
    if (
      navigation !== this.navigationGeneration ||
      this.session.getSnapshot().revision !== replaceGuard.revision
    ) {
      return SUPERSEDED;
    }
    if (
      stored.entry.id !== document.id ||
      stored.entry.storageVersion !== document.storageVersion ||
      stored.entry.fileName !== stored.contents.fileName
    ) {
      throw new GeometryDocumentCoordinatorError(
        'invalid-provider-receipt',
        'Provider open response does not match the requested document',
      );
    }

    this.session.replaceDocument({ ...stored.contents, persisted: true });
    this.activeDocument = stored.entry;
    this.documentGeneration += 1;
    return completed(this.activeDocument);
  }

  async newDocument(
    request: GeometryDocumentNewRequest,
  ): Promise<GeometryDocumentCoordinatorResult> {
    const contents = captureContents(request.contents);
    const dirtyDecision = captureDirtyDecision(request.dirtyDecision);
    const persisted = request.persisted ?? false;
    if (typeof persisted !== 'boolean') {
      throw new GeometryDocumentCoordinatorError(
        'invalid-replacement-state',
        'New document persisted state must be a boolean',
      );
    }
    const navigation = ++this.navigationGeneration;

    if (this.session.getSnapshot().isDirty) {
      const dirtyResult = await this.resolveDirtyDecision(dirtyDecision);
      if (dirtyResult === 'cancelled') return CANCELLED;
      if (dirtyResult === 'superseded') return SUPERSEDED;
      if (
        navigation !== this.navigationGeneration ||
        this.session.getSnapshot().revision !== dirtyResult
      ) {
        return SUPERSEDED;
      }
    }

    this.session.replaceDocument({ ...contents, persisted });
    this.activeDocument = null;
    this.documentGeneration += 1;
    return completed(null);
  }

  async delete(
    request: GeometryDocumentDeleteRequest,
  ): Promise<GeometryDocumentCoordinatorResult> {
    const document = captureDocumentEntry(request.document);
    const confirmed = captureConfirmation(request.confirmed);
    const dirtyDecision = captureDirtyDecision(request.dirtyDecision);
    const rawReplacement = request.replacement;
    const replacement = rawReplacement
      ? captureContents(rawReplacement)
      : null;
    if (!confirmed) return CANCELLED;

    const deletingActive = this.activeDocument?.id === document.id;
    const navigation = deletingActive
      ? ++this.navigationGeneration
      : this.navigationGeneration;

    if (deletingActive && this.session.getSnapshot().isDirty) {
      const dirtyResult = await this.resolveDirtyDecision(dirtyDecision);
      if (dirtyResult === 'cancelled') return CANCELLED;
      if (dirtyResult === 'superseded') return SUPERSEDED;
      if (
        navigation !== this.navigationGeneration ||
        this.session.getSnapshot().revision !== dirtyResult
      ) {
        return SUPERSEDED;
      }
    }
    if (deletingActive && !replacement) {
      throw new GeometryDocumentCoordinatorError(
        'replacement-required',
        'Deleting the active document requires an explicit replacement draft',
      );
    }

    const target =
      deletingActive && this.activeDocument?.id === document.id
        ? this.activeDocument
        : document;
    const sessionBeforeDelete = this.session.getSnapshot();
    const rawReceipt = await this.runMutation(() =>
      this.provider.documents.delete({
        id: target.id,
        expectedStorageVersion: target.storageVersion,
      }),
    );
    if (captureDeletedDocumentId(rawReceipt) !== target.id) {
      throw new GeometryDocumentCoordinatorError(
        'invalid-provider-receipt',
        'Provider delete receipt does not match the requested document',
      );
    }

    if (deletingActive) {
      if (
        navigation !== this.navigationGeneration ||
        this.activeDocument?.id !== target.id
      ) {
        return SUPERSEDED;
      }
      this.activeDocument = null;
      if (this.session.getSnapshot().revision === sessionBeforeDelete.revision) {
        this.session.replaceDocument({ ...replacement!, persisted: false });
      }
      this.documentGeneration += 1;
    }

    return completed(this.activeDocument);
  }

  async duplicateAndOpen(
    request: GeometryDocumentDuplicateAndOpenRequest,
  ): Promise<GeometryDocumentCoordinatorResult> {
    const requestedDocument = captureDocumentEntry(request.document);
    const confirmed = captureConfirmation(request.confirmed);
    const dirtyDecision = captureDirtyDecision(request.dirtyDecision);
    if (!confirmed) return CANCELLED;

    const navigation = ++this.navigationGeneration;
    const duplicatingActive = this.activeDocument?.id === requestedDocument.id;
    let capturedSession: GeometryDocumentSnapshot | null = null;

    if (duplicatingActive) {
      capturedSession = this.session.getSnapshot();
    } else if (this.session.getSnapshot().isDirty) {
      const dirtyResult = await this.resolveDirtyDecision(dirtyDecision);
      if (dirtyResult === 'cancelled') return CANCELLED;
      if (dirtyResult === 'superseded') return SUPERSEDED;
      if (
        navigation !== this.navigationGeneration ||
        this.session.getSnapshot().revision !== dirtyResult
      ) {
        return SUPERSEDED;
      }
    }
    const replaceGuard = this.session.getSnapshot();

    const source =
      duplicatingActive && this.activeDocument?.id === requestedDocument.id
        ? this.activeDocument
        : requestedDocument;
    let sourceEntry = source;
    let sourceContents: GeometryDocumentContents;
    if (capturedSession) {
      sourceContents = captureContents(capturedSession);
    } else {
      const rawStored = await this.provider.documents.open({
        id: source.id,
        expectedStorageVersion: source.storageVersion,
      });
      const stored = captureStoredDocument(rawStored);
      if (
        navigation !== this.navigationGeneration ||
        this.session.getSnapshot().revision !== replaceGuard.revision
      ) {
        return SUPERSEDED;
      }
      if (
        stored.entry.id !== source.id ||
        stored.entry.storageVersion !== source.storageVersion ||
        stored.entry.fileName !== source.fileName ||
        stored.contents.fileName !== source.fileName
      ) {
        throw new GeometryDocumentCoordinatorError(
          'invalid-provider-receipt',
          'Provider open response does not match the duplicate source',
        );
      }
      sourceEntry = stored.entry;
      sourceContents = stored.contents;
    }
    const rawReceipt = await this.runMutation(() =>
      this.provider.documents.duplicate({
        sourceId: source.id,
        expectedStorageVersion: source.storageVersion,
        ...(capturedSession
          ? {
              contents: captureContents(capturedSession),
              sessionRevision: capturedSession.revision,
            }
          : {}),
      }),
    );

    const receipt = captureDuplicateReceipt(rawReceipt);
    if (
      navigation !== this.navigationGeneration ||
      this.session.getSnapshot().revision !== replaceGuard.revision
    ) {
      return SUPERSEDED;
    }
    const sourceMemberships = new Set(sourceEntry.projectGroupIds);
    const receiptMemberships = new Set(receipt.entry.projectGroupIds);
    const membershipsMatch =
      sourceMemberships.size === sourceEntry.projectGroupIds.length &&
      receiptMemberships.size === receipt.entry.projectGroupIds.length &&
      receiptMemberships.size === sourceMemberships.size &&
      [...receiptMemberships].every((projectGroupId) =>
        sourceMemberships.has(projectGroupId),
      );
    if (
      receipt.entry.id === source.id ||
      receipt.entry.fileName !== receipt.contents.fileName ||
      !membershipsMatch ||
      !geometryDocumentContentsEqual(
        receipt.contents,
        captureGeometryDocumentContents({
          fileName: receipt.contents.fileName,
          text: sourceContents.text,
          derivedResources: sourceContents.derivedResources,
          sourceFiles: sourceContents.sourceFiles,
        }),
      )
    ) {
      throw new GeometryDocumentCoordinatorError(
        'invalid-provider-receipt',
        'Provider duplicate receipt does not describe a valid independent copy',
      );
    }
    if (
      capturedSession &&
      receipt.persistedSessionRevision !== capturedSession.revision
    ) {
      throw new GeometryDocumentCoordinatorError(
        'invalid-save-receipt',
        'Duplicate receipt does not match the captured document revision',
      );
    }

    this.session.replaceDocument({ ...receipt.contents, persisted: true });
    this.activeDocument = receipt.entry;
    this.documentGeneration += 1;
    return completed(this.activeDocument);
  }

  async setDocumentMembership(
    request: GeometryDocumentMembershipMutationRequest,
  ): Promise<GeometryDocumentCoordinatorResult> {
    const requestedDocument = captureDocumentEntry(request.document);
    const projectGroupIds = captureProjectGroupIds(request.projectGroupIds);

    return this.runMutation(async () => {
      const target =
        this.activeDocument?.id === requestedDocument.id
          ? this.activeDocument
          : requestedDocument;
      const rawReceipt =
        await this.provider.projectGroups.setDocumentMembership({
          documentId: target.id,
          expectedStorageVersion: target.storageVersion,
          projectGroupIds,
        });
      const receipt = captureMembershipReceipt(rawReceipt);

      this.validateMembershipReceipt(
        receipt,
        target,
        projectGroupIds,
      );
      this.navigationGeneration += 1;
      this.reconcileActiveDocumentAfterMembership(
        receipt.snapshot,
        target.id,
        receipt.entry,
      );
      return completed(this.activeDocument);
    });
  }

  async deleteProjectGroup(
    request: GeometryProjectGroupDeletionRequest,
  ): Promise<GeometryDocumentCoordinatorResult> {
    const projectGroup = captureProjectGroupEntry(request.projectGroup);
    const confirmed = captureConfirmation(request.confirmed);
    if (!confirmed) return CANCELLED;

    return this.runMutation(async () => {
      const rawReceipt = await this.provider.projectGroups.delete({
        id: projectGroup.id,
        expectedStorageVersion: projectGroup.storageVersion,
      });
      const receipt = captureProjectGroupDeleteReceipt(rawReceipt);

      this.validateProjectGroupDeleteReceipt(receipt, projectGroup.id);
      this.navigationGeneration += 1;
      this.reconcileActiveDocumentAfterProjectGroupDelete(
        receipt.snapshot,
        projectGroup.id,
      );
      return completed(this.activeDocument);
    });
  }

  private async resolveDirtyDecision(
    decision: GeometryDocumentDirtyDecision | undefined,
  ): Promise<number | 'cancelled' | 'superseded'> {
    const dirtySnapshot = this.session.getSnapshot();
    if (!dirtySnapshot.isDirty) return dirtySnapshot.revision;
    if (!decision) {
      throw new GeometryDocumentCoordinatorError(
        'dirty-decision-required',
        'Choose Save, Discard, or Cancel before replacing a dirty document',
      );
    }
    if (decision === 'cancel') return 'cancelled';
    if (decision === 'save') {
      await this.save();
      const savedSnapshot = this.session.getSnapshot();
      if (savedSnapshot.isDirty) return 'superseded';
      return savedSnapshot.revision;
    }
    return dirtySnapshot.revision;
  }

  private validateSaveReceipt(
    receipt: CapturedGeometryDocumentPersistenceReceipt,
    capturedSession: GeometryDocumentSnapshot,
    expectedDocumentId: string | null,
  ): void {
    const entryMatchesRequest =
      expectedDocumentId === null || receipt.entry.id === expectedDocumentId;
    const contentsMatchRequest =
      receipt.entry.fileName === capturedSession.fileName &&
      geometryDocumentContentsEqual(receipt.contents, capturedSession);
    if (
      receipt.persistedSessionRevision !== capturedSession.revision ||
      !entryMatchesRequest ||
      !contentsMatchRequest
    ) {
      throw new GeometryDocumentCoordinatorError(
        'invalid-save-receipt',
        'Provider save receipt does not match the captured document write',
      );
    }
  }

  private validateMembershipReceipt(
    receipt: CapturedGeometryDocumentMembershipReceipt,
    target: GeometryDocumentCatalogueEntry,
    projectGroupIds: readonly string[],
  ): void {
    this.validateSnapshotProvider(receipt.snapshot);
    const snapshotEntry = this.findSnapshotDocument(
      receipt.snapshot,
      target.id,
    );
    const knownProjectGroupIds = new Set(
      receipt.snapshot.projectGroups.map((entry) => entry.id),
    );
    if (
      receipt.entry.id !== target.id ||
      receipt.entry.fileName !== target.fileName ||
      receipt.entry.modifiedAt !== target.modifiedAt ||
      !stringListsEqual(receipt.entry.projectGroupIds, projectGroupIds) ||
      projectGroupIds.some(
        (projectGroupId) => !knownProjectGroupIds.has(projectGroupId),
      ) ||
      !documentEntriesEqual(receipt.entry, snapshotEntry)
    ) {
      throw new GeometryDocumentCoordinatorError(
        'invalid-provider-receipt',
        'Provider membership receipt does not match the requested mutation',
      );
    }
    this.validateDocumentMetadataTransition(
      target,
      receipt.entry,
      projectGroupIds,
    );
  }

  private validateProjectGroupDeleteReceipt(
    receipt: CapturedGeometryProjectGroupDeleteReceipt,
    projectGroupId: string,
  ): void {
    this.validateSnapshotProvider(receipt.snapshot);
    if (
      receipt.deletedProjectGroupId !== projectGroupId ||
      receipt.snapshot.projectGroups.some(
        (entry) => entry.id === projectGroupId,
      )
    ) {
      throw new GeometryDocumentCoordinatorError(
        'invalid-provider-receipt',
        'Provider project-group deletion receipt does not match the request',
      );
    }
  }

  private validateSnapshotProvider(
    snapshot: CapturedGeometryWorkspaceSnapshot,
  ): void {
    if (snapshot.providerId !== this.providerId) {
      throw new GeometryDocumentCoordinatorError(
        'invalid-provider-receipt',
        'Provider receipt contains a snapshot from another workspace',
      );
    }
  }

  private findSnapshotDocument(
    snapshot: CapturedGeometryWorkspaceSnapshot,
    documentId: string,
  ): GeometryDocumentCatalogueEntry {
    const entry = snapshot.documents.find(
      (document) => document.id === documentId,
    );
    if (!entry) {
      throw new GeometryDocumentCoordinatorError(
        'invalid-provider-receipt',
        'Provider receipt snapshot omits the affected document',
      );
    }
    return entry;
  }

  private validateDocumentMetadataTransition(
    before: GeometryDocumentCatalogueEntry,
    after: GeometryDocumentCatalogueEntry,
    expectedProjectGroupIds: readonly string[],
  ): void {
    const membershipsChanged = !stringListsEqual(
      before.projectGroupIds,
      expectedProjectGroupIds,
    );
    const storageVersionChanged =
      before.storageVersion !== after.storageVersion;
    if (
      before.id !== after.id ||
      before.fileName !== after.fileName ||
      before.modifiedAt !== after.modifiedAt ||
      !stringListsEqual(after.projectGroupIds, expectedProjectGroupIds) ||
      membershipsChanged !== storageVersionChanged
    ) {
      throw new GeometryDocumentCoordinatorError(
        'invalid-provider-receipt',
        'Provider receipt changes document metadata outside project grouping',
      );
    }
  }

  private reconcileActiveDocumentAfterMembership(
    snapshot: CapturedGeometryWorkspaceSnapshot,
    targetDocumentId: string,
    targetEntry: GeometryDocumentCatalogueEntry,
  ): void {
    const active = this.activeDocument;
    if (!active) return;
    const snapshotEntry = this.findSnapshotDocument(snapshot, active.id);

    if (active.id === targetDocumentId) {
      if (!documentEntriesEqual(snapshotEntry, targetEntry)) {
        throw new GeometryDocumentCoordinatorError(
          'invalid-provider-receipt',
          'Membership receipt disagrees with the active snapshot entry',
        );
      }
      this.validateDocumentMetadataTransition(
        active,
        snapshotEntry,
        targetEntry.projectGroupIds,
      );
    } else if (!documentEntriesEqual(snapshotEntry, active)) {
      throw new GeometryDocumentCoordinatorError(
        'invalid-provider-receipt',
        'Membership mutation unexpectedly changed the active document',
      );
    }

    this.activeDocument = snapshotEntry;
  }

  private reconcileActiveDocumentAfterProjectGroupDelete(
    snapshot: CapturedGeometryWorkspaceSnapshot,
    deletedProjectGroupId: string,
  ): void {
    const active = this.activeDocument;
    if (!active) return;
    const snapshotEntry = this.findSnapshotDocument(snapshot, active.id);
    if (!documentEntriesEqual(active, snapshotEntry)) {
      const expectedProjectGroupIds = active.projectGroupIds.filter(
        (projectGroupId) => projectGroupId !== deletedProjectGroupId,
      );
      this.validateDocumentMetadataTransition(
        active,
        snapshotEntry,
        expectedProjectGroupIds,
      );
    }
    this.activeDocument = snapshotEntry;
  }

  private runMutation<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.mutationTail.then(task, task);
    this.mutationTail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}

export function createGeometryDocumentCoordinator(
  options: GeometryDocumentCoordinatorOptions,
): GeometryDocumentCoordinator {
  return new DefaultGeometryDocumentCoordinator(options);
}
