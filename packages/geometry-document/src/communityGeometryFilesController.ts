// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  BrowserDirectoryWorkspaceAccess,
  BrowserDirectoryWorkspaceConnected,
} from './browserDirectoryWorkspaceContracts';
import { BrowserDirectoryWorkspaceError } from './browserDirectoryWorkspaceContracts';
import type {
  GeometryDocumentContents,
  GeometryDocumentInput,
  GeometryDocumentSession,
  GeometryDocumentSnapshot,
} from './contracts';
import { captureGeometryDocumentContents } from './documentContents';
import {
  createGeometryDocumentCoordinator,
  GeometryDocumentCoordinatorError,
  type GeometryDocumentCoordinator,
  type GeometryDocumentDirtyDecision,
} from './geometryDocumentCoordinator';
import {
  GeometryWorkspaceProviderError,
  type GeometryDocumentCatalogueEntry,
  type GeometryDocumentCatalogueFilter,
  type GeometryProjectGroupCatalogueEntry,
  type GeometryWorkspaceProvider,
  type GeometryWorkspaceSnapshot,
} from './providerContracts';

export type CommunityGeometryFilesOperation =
  | 'restore-workspace'
  | 'reconnect-workspace'
  | 'choose-workspace'
  | 'change-workspace'
  | 'disconnect-workspace'
  | 'refresh'
  | 'save'
  | 'new-document'
  | 'import-document'
  | 'open-document'
  | 'duplicate-document'
  | 'delete-document'
  | 'create-project'
  | 'update-project'
  | 'delete-project'
  | 'set-document-membership';

export type CommunityGeometryFilesControllerErrorCode =
  | 'disposed'
  | 'dirty-decision-required'
  | 'invalid-request'
  | 'operation-failed'
  | 'operation-in-progress'
  | 'stale-document'
  | 'stale-project'
  | 'workspace-required';

export class CommunityGeometryFilesControllerError extends Error {
  readonly code: CommunityGeometryFilesControllerErrorCode;
  readonly operation: CommunityGeometryFilesOperation | null;
  readonly cause?: unknown;

  constructor(
    code: CommunityGeometryFilesControllerErrorCode,
    message: string,
    options: Readonly<{
      operation?: CommunityGeometryFilesOperation | null;
      cause?: unknown;
    }> = {},
  ) {
    super(message);
    this.name = 'CommunityGeometryFilesControllerError';
    this.code = code;
    this.operation = options.operation ?? null;
    this.cause = options.cause;
  }
}

export type CommunityGeometryFilesVisibleErrorSource =
  | 'controller'
  | 'workspace-access'
  | 'workspace-provider'
  | 'document-coordinator';

export type CommunityGeometryFilesVisibleError = Readonly<{
  source: CommunityGeometryFilesVisibleErrorSource;
  code: string;
  message: string;
  operation: CommunityGeometryFilesOperation;
}>;

export type CommunityGeometryFilesWorkspace =
  | Readonly<{ status: 'disconnected'; canChoose: boolean }>
  | Readonly<{
      status: 'restoring';
      canChoose: boolean;
      directoryName?: string;
    }>
  | Readonly<{
      status: 'permission-required';
      canChoose: boolean;
      directoryName: string;
    }>
  | Readonly<{
      status: 'connected';
      canChoose: boolean;
      directoryName: string;
    }>;

export type CommunityGeometryFilesActiveConflict =
  | Readonly<{
      kind: 'changed';
      documentId: string;
      loadedStorageVersion: string;
      availableStorageVersion: string;
    }>
  | Readonly<{
      kind: 'deleted';
      documentId: string;
      loadedStorageVersion: string;
      availableStorageVersion: null;
    }>;

export type CommunityGeometryFilesSnapshot = Readonly<{
  workspace: CommunityGeometryFilesWorkspace;
  document: GeometryDocumentSnapshot;
  documents: readonly GeometryDocumentCatalogueEntry[];
  projects: readonly GeometryProjectGroupCatalogueEntry[];
  visibleDocuments: readonly GeometryDocumentCatalogueEntry[];
  activeDocument: GeometryDocumentCatalogueEntry | null;
  activeDocumentId: string | null;
  catalogueVersion: string | null;
  search: string;
  filter: GeometryDocumentCatalogueFilter;
  isBusy: boolean;
  isLoading: boolean;
  operation: CommunityGeometryFilesOperation | null;
  error: CommunityGeometryFilesVisibleError | null;
  notice: string | null;
  activeConflict: CommunityGeometryFilesActiveConflict | null;
}>;

export type CommunityGeometryFilesCompleted = Readonly<{
  status: 'completed';
}>;

export type CommunityGeometryFilesCancelled = Readonly<{
  status: 'cancelled';
}>;

export type CommunityGeometryFilesSuperseded = Readonly<{
  status: 'superseded';
}>;

export type CommunityGeometryFilesResult =
  | CommunityGeometryFilesCompleted
  | CommunityGeometryFilesCancelled
  | CommunityGeometryFilesSuperseded;

export type CommunityGeometryDocumentReference = Readonly<{
  id: string;
  storageVersion: string;
}>;

export type CommunityGeometryProjectReference = Readonly<{
  id: string;
  storageVersion: string;
}>;

export type CommunityGeometryFilesDirtyOptions = Readonly<{
  dirtyDecision?: GeometryDocumentDirtyDecision;
}>;

export type CommunityGeometryFilesControllerOptions = Readonly<{
  workspaceAccess: BrowserDirectoryWorkspaceAccess;
  session: GeometryDocumentSession;
  blankDocument?: GeometryDocumentInput;
}>;

export interface CommunityGeometryFilesController {
  getSnapshot(): CommunityGeometryFilesSnapshot;
  subscribe(listener: () => void): () => void;
  dispose(): void;
  clearFeedback(): void;
  setSearch(search: string): void;
  setFilter(filter: GeometryDocumentCatalogueFilter): void;
  restoreWorkspace(): Promise<CommunityGeometryFilesResult>;
  reconnectWorkspace(): Promise<CommunityGeometryFilesResult>;
  chooseWorkspace(
    options?: CommunityGeometryFilesDirtyOptions,
  ): Promise<CommunityGeometryFilesResult>;
  changeWorkspace(
    options?: CommunityGeometryFilesDirtyOptions,
  ): Promise<CommunityGeometryFilesResult>;
  disconnectWorkspace(
    options?: CommunityGeometryFilesDirtyOptions,
  ): Promise<CommunityGeometryFilesResult>;
  refresh(): Promise<CommunityGeometryFilesResult>;
  save(): Promise<CommunityGeometryFilesResult>;
  newDocument(
    request?: CommunityGeometryFilesDirtyOptions &
      Readonly<{ contents?: GeometryDocumentInput }>,
  ): Promise<CommunityGeometryFilesResult>;
  importDocument(
    request: CommunityGeometryFilesDirtyOptions &
      Readonly<{ contents: GeometryDocumentInput }>,
  ): Promise<CommunityGeometryFilesResult>;
  openDocument(
    request: CommunityGeometryFilesDirtyOptions &
      Readonly<{ document: CommunityGeometryDocumentReference }>,
  ): Promise<CommunityGeometryFilesResult>;
  duplicateDocument(
    request: CommunityGeometryFilesDirtyOptions &
      Readonly<{
        document: CommunityGeometryDocumentReference;
        confirmed: boolean;
      }>,
  ): Promise<CommunityGeometryFilesResult>;
  deleteDocument(
    request: CommunityGeometryFilesDirtyOptions &
      Readonly<{
        document: CommunityGeometryDocumentReference;
        confirmed: boolean;
      }>,
  ): Promise<CommunityGeometryFilesResult>;
  createProject(
    request: Readonly<{ name: string; description?: string }>,
  ): Promise<CommunityGeometryFilesResult>;
  updateProject(
    request: Readonly<{
      project: CommunityGeometryProjectReference;
      name?: string;
      description?: string;
    }>,
  ): Promise<CommunityGeometryFilesResult>;
  deleteProject(
    request: Readonly<{
      project: CommunityGeometryProjectReference;
      confirmed: boolean;
    }>,
  ): Promise<CommunityGeometryFilesResult>;
  setDocumentMembership(
    request: Readonly<{
      document: CommunityGeometryDocumentReference;
      projectGroupIds: readonly string[];
    }>,
  ): Promise<CommunityGeometryFilesResult>;
}

type CapturedWorkspaceSnapshot = Readonly<{
  providerId: string;
  catalogueVersion: string;
  documents: readonly GeometryDocumentCatalogueEntry[];
  projectGroups: readonly GeometryProjectGroupCatalogueEntry[];
}>;

type ControllerConnection = Readonly<{
  directoryName: string;
  provider: GeometryWorkspaceProvider;
  providerId: string;
  coordinator: GeometryDocumentCoordinator;
}>;

const DEFAULT_BLANK_DOCUMENT = Object.freeze({
  fileName: 'Untitled.csv',
  text: '',
});
const EMPTY_DOCUMENTS: readonly GeometryDocumentCatalogueEntry[] = Object.freeze([]);
const EMPTY_PROJECTS: readonly GeometryProjectGroupCatalogueEntry[] = Object.freeze([]);
const ALL_FILTER: GeometryDocumentCatalogueFilter = Object.freeze({ kind: 'all' });
const COMPLETED: CommunityGeometryFilesCompleted = Object.freeze({
  status: 'completed',
});
const CANCELLED: CommunityGeometryFilesCancelled = Object.freeze({
  status: 'cancelled',
});
const SUPERSEDED: CommunityGeometryFilesSuperseded = Object.freeze({
  status: 'superseded',
});
const SUPERSEDED_SIGNAL = Symbol('community-files-operation-superseded');

function captureNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CommunityGeometryFilesControllerError(
      'invalid-request',
      `${label} must be a non-empty string`,
    );
  }
  return value;
}

function captureDocumentEntry(value: GeometryDocumentCatalogueEntry): GeometryDocumentCatalogueEntry {
  let id: unknown;
  let fileName: unknown;
  let modifiedAt: unknown;
  let storageVersion: unknown;
  let rawProjectGroupIds: unknown;
  try {
    id = value.id;
    fileName = value.fileName;
    modifiedAt = value.modifiedAt;
    storageVersion = value.storageVersion;
    rawProjectGroupIds = value.projectGroupIds;
  } catch (cause) {
    throw new CommunityGeometryFilesControllerError(
      'operation-failed',
      'A workspace document entry could not be read',
      { cause },
    );
  }
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
    throw new CommunityGeometryFilesControllerError(
      'operation-failed',
      'A workspace document entry is invalid',
    );
  }
  const projectGroupIds = Object.freeze(
    Array.from(rawProjectGroupIds, (projectGroupId) =>
      captureNonEmptyString(projectGroupId, 'Project id'),
    ),
  );
  if (new Set(projectGroupIds).size !== projectGroupIds.length) {
    throw new CommunityGeometryFilesControllerError(
      'operation-failed',
      'A workspace document has duplicate project memberships',
    );
  }
  return Object.freeze({
    id,
    fileName,
    modifiedAt,
    storageVersion,
    projectGroupIds,
  });
}

function captureProjectEntry(
  value: GeometryProjectGroupCatalogueEntry,
): GeometryProjectGroupCatalogueEntry {
  let id: unknown;
  let name: unknown;
  let description: unknown;
  let storageVersion: unknown;
  try {
    id = value.id;
    name = value.name;
    description = value.description;
    storageVersion = value.storageVersion;
  } catch (cause) {
    throw new CommunityGeometryFilesControllerError(
      'operation-failed',
      'A workspace project entry could not be read',
      { cause },
    );
  }
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    typeof name !== 'string' ||
    name.length === 0 ||
    typeof description !== 'string' ||
    typeof storageVersion !== 'string' ||
    storageVersion.length === 0
  ) {
    throw new CommunityGeometryFilesControllerError(
      'operation-failed',
      'A workspace project entry is invalid',
    );
  }
  return Object.freeze({ id, name, description, storageVersion });
}

function captureWorkspaceSnapshot(
  value: GeometryWorkspaceSnapshot,
  expectedProviderId: string,
): CapturedWorkspaceSnapshot {
  let providerId: unknown;
  let catalogueVersion: unknown;
  let rawDocuments: unknown;
  let rawProjectGroups: unknown;
  try {
    providerId = value.providerId;
    catalogueVersion = value.catalogueVersion;
    rawDocuments = value.documents;
    rawProjectGroups = value.projectGroups;
  } catch (cause) {
    throw new CommunityGeometryFilesControllerError(
      'operation-failed',
      'The workspace catalogue could not be read',
      { cause },
    );
  }
  if (
    providerId !== expectedProviderId ||
    typeof catalogueVersion !== 'string' ||
    catalogueVersion.length === 0 ||
    !Array.isArray(rawDocuments) ||
    !Array.isArray(rawProjectGroups)
  ) {
    throw new CommunityGeometryFilesControllerError(
      'operation-failed',
      'The workspace catalogue is invalid',
    );
  }
  const projectGroups = Object.freeze(rawProjectGroups.map(captureProjectEntry));
  const documents = Object.freeze(rawDocuments.map(captureDocumentEntry));
  const projectIds = new Set(projectGroups.map((project) => project.id));
  const documentIds = new Set(documents.map((document) => document.id));
  if (
    projectIds.size !== projectGroups.length ||
    documentIds.size !== documents.length ||
    documents.some((document) =>
      document.projectGroupIds.some((projectId) => !projectIds.has(projectId)),
    )
  ) {
    throw new CommunityGeometryFilesControllerError(
      'operation-failed',
      'The workspace catalogue has inconsistent ids or memberships',
    );
  }
  return Object.freeze({
    providerId,
    catalogueVersion,
    documents,
    projectGroups,
  });
}

function captureFilter(value: GeometryDocumentCatalogueFilter): GeometryDocumentCatalogueFilter {
  const kind = value.kind;
  if (kind === 'all' || kind === 'unassigned') {
    return Object.freeze({ kind });
  }
  if (kind === 'project') {
    return Object.freeze({
      kind,
      projectGroupId: captureNonEmptyString(
        value.projectGroupId,
        'Project id',
      ),
    });
  }
  throw new CommunityGeometryFilesControllerError(
    'invalid-request',
    'Unknown catalogue filter',
  );
}

function filtersEqual(
  left: GeometryDocumentCatalogueFilter,
  right: GeometryDocumentCatalogueFilter,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind !== 'project' ||
      (right.kind === 'project' &&
        left.projectGroupId === right.projectGroupId))
  );
}

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
  throw new CommunityGeometryFilesControllerError(
    'invalid-request',
    'Dirty decision must be Save, Discard, or Cancel',
  );
}

function captureConfirmed(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new CommunityGeometryFilesControllerError(
      'invalid-request',
      'Confirmation must be an explicit boolean',
    );
  }
  return value;
}

function captureProjectGroupIds(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) {
    throw new CommunityGeometryFilesControllerError(
      'invalid-request',
      'Project memberships must be an array',
    );
  }
  const captured = Object.freeze(
    Array.from(value, (projectId) =>
      captureNonEmptyString(projectId, 'Project id'),
    ),
  );
  if (new Set(captured).size !== captured.length) {
    throw new CommunityGeometryFilesControllerError(
      'invalid-request',
      'Project memberships must be unique',
    );
  }
  return captured;
}

function visibleError(
  error: unknown,
  operation: CommunityGeometryFilesOperation,
): CommunityGeometryFilesVisibleError {
  if (error instanceof BrowserDirectoryWorkspaceError) {
    return Object.freeze({
      source: 'workspace-access',
      code: error.code,
      message: error.message,
      operation,
    });
  }
  if (error instanceof GeometryWorkspaceProviderError) {
    return Object.freeze({
      source: 'workspace-provider',
      code: error.code,
      message: error.message,
      operation,
    });
  }
  if (error instanceof GeometryDocumentCoordinatorError) {
    return Object.freeze({
      source: 'document-coordinator',
      code: error.code,
      message: error.message,
      operation,
    });
  }
  if (error instanceof CommunityGeometryFilesControllerError) {
    return Object.freeze({
      source: 'controller',
      code: error.code,
      message: error.message,
      operation,
    });
  }
  return Object.freeze({
    source: 'controller',
    code: 'operation-failed',
    message: 'The requested local files operation failed',
    operation,
  });
}

function normalizeError(
  error: unknown,
  operation: CommunityGeometryFilesOperation,
): Error {
  if (
    error instanceof BrowserDirectoryWorkspaceError ||
    error instanceof GeometryWorkspaceProviderError ||
    error instanceof GeometryDocumentCoordinatorError ||
    error instanceof CommunityGeometryFilesControllerError
  ) {
    return error;
  }
  return new CommunityGeometryFilesControllerError(
    'operation-failed',
    'The requested local files operation failed',
    { operation, cause: error },
  );
}

function isLoadingOperation(
  operation: CommunityGeometryFilesOperation | null,
): boolean {
  return (
    operation === 'restore-workspace' ||
    operation === 'reconnect-workspace' ||
    operation === 'choose-workspace' ||
    operation === 'change-workspace' ||
    operation === 'refresh'
  );
}

class DefaultCommunityGeometryFilesController {
  private readonly workspaceAccess: BrowserDirectoryWorkspaceAccess;
  private readonly session: GeometryDocumentSession;
  private readonly blankDocument: GeometryDocumentContents;
  private readonly canChoose: boolean;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeSession: () => void;
  private connection: ControllerConnection | null = null;
  private providerSnapshot: CapturedWorkspaceSnapshot | null = null;
  private workspace: CommunityGeometryFilesWorkspace;
  private document: GeometryDocumentSnapshot;
  private cleanBaseline: GeometryDocumentContents;
  private search = '';
  private filter: GeometryDocumentCatalogueFilter = ALL_FILTER;
  private operation: CommunityGeometryFilesOperation | null = null;
  private error: CommunityGeometryFilesVisibleError | null = null;
  private notice: string | null = null;
  private activeConflict: CommunityGeometryFilesActiveConflict | null = null;
  private currentSnapshot: CommunityGeometryFilesSnapshot;
  private generation = 0;
  private disposed = false;

  constructor(options: CommunityGeometryFilesControllerOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new CommunityGeometryFilesControllerError(
        'invalid-request',
        'Community files controller options are required',
      );
    }
    this.workspaceAccess = options.workspaceAccess;
    this.session = options.session;
    this.blankDocument = captureGeometryDocumentContents(
      options.blankDocument ?? DEFAULT_BLANK_DOCUMENT,
    );
    let capabilities: BrowserDirectoryWorkspaceAccess['capabilities'];
    try {
      capabilities = this.workspaceAccess.capabilities;
      this.document = this.session.getSnapshot();
    } catch (cause) {
      throw new CommunityGeometryFilesControllerError(
        'invalid-request',
        'Community files controller dependencies could not be inspected',
        { cause },
      );
    }
    if (
      typeof capabilities !== 'object' ||
      capabilities === null ||
      typeof capabilities.choose !== 'boolean' ||
      typeof capabilities.restore !== 'boolean'
    ) {
      throw new CommunityGeometryFilesControllerError(
        'invalid-request',
        'Workspace access capabilities are invalid',
      );
    }
    this.canChoose = capabilities.choose;
    this.workspace = Object.freeze({
      status: 'disconnected',
      canChoose: this.canChoose,
    });
    this.cleanBaseline = this.document.isDirty
      ? this.blankDocument
      : captureGeometryDocumentContents(this.document);
    this.currentSnapshot = this.buildSnapshot();
    this.unsubscribeSession = this.session.subscribe((snapshot) => {
      if (this.disposed || snapshot === this.document) return;
      this.document = snapshot;
      if (!snapshot.isDirty) {
        this.cleanBaseline = captureGeometryDocumentContents(snapshot);
      }
      this.publish();
    });
  }

  getSnapshot(): CommunityGeometryFilesSnapshot {
    return this.currentSnapshot;
  }

  subscribe(listener: () => void): () => void {
    this.assertUsable();
    if (typeof listener !== 'function') {
      throw new CommunityGeometryFilesControllerError(
        'invalid-request',
        'Community files subscriber must be a function',
      );
    }
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.unsubscribeSession();
    this.listeners.clear();
  }

  clearFeedback(): void {
    this.assertUsable();
    if (this.error === null && this.notice === null) return;
    this.error = null;
    this.notice = null;
    this.publish();
  }

  setSearch(search: string): void {
    this.assertUsable();
    if (typeof search !== 'string') {
      throw new CommunityGeometryFilesControllerError(
        'invalid-request',
        'Catalogue search must be a string',
      );
    }
    if (search === this.search) return;
    this.search = search;
    this.publish();
  }

  setFilter(filter: GeometryDocumentCatalogueFilter): void {
    this.assertUsable();
    const captured = captureFilter(filter);
    if (
      captured.kind === 'project' &&
      !this.providerSnapshot?.projectGroups.some(
        (project) => project.id === captured.projectGroupId,
      )
    ) {
      const error = new CommunityGeometryFilesControllerError(
        'stale-project',
        'The selected project is no longer in this catalogue',
      );
      this.error = visibleError(error, 'refresh');
      this.publish();
      throw error;
    }
    if (filtersEqual(this.filter, captured)) return;
    this.filter = captured;
    this.publish();
  }

  restoreWorkspace(): Promise<CommunityGeometryFilesResult> {
    return this.run('restore-workspace', async (token) => {
      if (this.connection !== null) {
        throw new CommunityGeometryFilesControllerError(
          'invalid-request',
          'A workspace is already connected',
        );
      }
      const previousWorkspace = this.workspace;
      this.workspace = Object.freeze({
        status: 'restoring',
        canChoose: this.canChoose,
        ...(previousWorkspace.status === 'permission-required'
          ? { directoryName: previousWorkspace.directoryName }
          : {}),
      });
      this.publish();
      try {
        const result = await this.workspaceAccess.restore();
        this.assertCurrent(token);
        if (result.status === 'not-remembered') {
          this.clearConnection();
          return COMPLETED;
        }
        if (result.status === 'permission-required') {
          this.connection = null;
          this.providerSnapshot = null;
          this.activeConflict = null;
          this.workspace = Object.freeze({
            status: 'permission-required',
            canChoose: this.canChoose,
            directoryName: captureNonEmptyString(
              result.directoryName,
              'Directory name',
            ),
          });
          this.publish();
          return COMPLETED;
        }
        await this.installConnection(result, token);
        this.notice = 'Workspace connected';
        return COMPLETED;
      } catch (cause) {
        if (this.isCurrent(token)) {
          this.workspace = previousWorkspace;
          this.publish();
        }
        throw cause;
      }
    });
  }

  reconnectWorkspace(): Promise<CommunityGeometryFilesResult> {
    return this.run('reconnect-workspace', async (token) => {
      const result = await this.workspaceAccess.reconnect();
      this.assertCurrent(token);
      if (result.status === 'not-remembered') {
        this.clearConnection();
        return COMPLETED;
      }
      await this.installConnection(result, token);
      this.notice = 'Workspace connected';
      return COMPLETED;
    });
  }

  chooseWorkspace(
    options: CommunityGeometryFilesDirtyOptions = {},
  ): Promise<CommunityGeometryFilesResult> {
    return this.chooseOrChange('choose-workspace', options);
  }

  changeWorkspace(
    options: CommunityGeometryFilesDirtyOptions = {},
  ): Promise<CommunityGeometryFilesResult> {
    return this.chooseOrChange('change-workspace', options);
  }

  disconnectWorkspace(
    options: CommunityGeometryFilesDirtyOptions = {},
  ): Promise<CommunityGeometryFilesResult> {
    return this.run('disconnect-workspace', async (token) => {
      const dirtyResult = await this.resolveDirty(
        captureDirtyDecision(options.dirtyDecision),
        token,
      );
      if (dirtyResult.status !== 'completed') return dirtyResult;
      this.assertCurrent(token);
      await this.workspaceAccess.forget();
      this.assertCurrent(token);
      this.clearConnection();
      this.assertCurrent(token);
      this.notice = 'Workspace disconnected';
      return COMPLETED;
    });
  }

  refresh(): Promise<CommunityGeometryFilesResult> {
    return this.run('refresh', async (token) => {
      await this.refreshInternal(token);
      return COMPLETED;
    });
  }

  save(): Promise<CommunityGeometryFilesResult> {
    return this.run('save', (token) => this.saveInternal(token));
  }

  newDocument(
    request: CommunityGeometryFilesDirtyOptions &
      Readonly<{ contents?: GeometryDocumentInput }> = {},
  ): Promise<CommunityGeometryFilesResult> {
    return this.replaceWithCleanDocument(
      'new-document',
      () =>
        captureGeometryDocumentContents(
          request.contents ?? this.blankDocument,
        ),
      () => captureDirtyDecision(request.dirtyDecision),
      'New local draft',
    );
  }

  importDocument(
    request: CommunityGeometryFilesDirtyOptions &
      Readonly<{ contents: GeometryDocumentInput }>,
  ): Promise<CommunityGeometryFilesResult> {
    return this.replaceWithCleanDocument(
      'import-document',
      () => captureGeometryDocumentContents(request.contents),
      () => captureDirtyDecision(request.dirtyDecision),
      'Opened local document',
    );
  }

  openDocument(
    request: CommunityGeometryFilesDirtyOptions &
      Readonly<{ document: CommunityGeometryDocumentReference }>,
  ): Promise<CommunityGeometryFilesResult> {
    return this.run('open-document', async (token) => {
      const document = this.resolveDocument(request.document);
      const coordinator = this.requireConnection().coordinator;
      const dirtyDecision = captureDirtyDecision(request.dirtyDecision);
      const savesCurrentDocument =
        this.session.getSnapshot().isDirty && dirtyDecision === 'save';
      const result = await coordinator.open({
        document,
        dirtyDecision,
      });
      this.assertCurrent(token);
      if (result.status !== 'completed') return result;
      if (savesCurrentDocument) await this.refreshInternal(token);
      else this.reconcileActiveConflict();
      this.notice = 'Opened';
      return COMPLETED;
    });
  }

  duplicateDocument(
    request: CommunityGeometryFilesDirtyOptions &
      Readonly<{
        document: CommunityGeometryDocumentReference;
        confirmed: boolean;
      }>,
  ): Promise<CommunityGeometryFilesResult> {
    return this.run('duplicate-document', async (token) => {
      const document = this.resolveDocument(request.document);
      const result = await this.requireConnection().coordinator.duplicateAndOpen({
        document,
        confirmed: captureConfirmed(request.confirmed),
        dirtyDecision: captureDirtyDecision(request.dirtyDecision),
      });
      this.assertCurrent(token);
      if (result.status !== 'completed') return result;
      await this.refreshInternal(token);
      this.notice = 'Duplicated';
      return COMPLETED;
    });
  }

  deleteDocument(
    request: CommunityGeometryFilesDirtyOptions &
      Readonly<{
        document: CommunityGeometryDocumentReference;
        confirmed: boolean;
      }>,
  ): Promise<CommunityGeometryFilesResult> {
    return this.run('delete-document', async (token) => {
      const document = this.resolveDocument(request.document);
      const coordinator = this.requireConnection().coordinator;
      const deletingActive = coordinator.getActiveDocument()?.id === document.id;
      const result = await coordinator.delete({
        document,
        confirmed: captureConfirmed(request.confirmed),
        dirtyDecision: captureDirtyDecision(request.dirtyDecision),
        replacement: this.blankDocument,
      });
      this.assertCurrent(token);
      if (result.status !== 'completed') return result;
      if (deletingActive && coordinator.getActiveDocument() === null) {
        this.session.replaceDocument({
          ...this.blankDocument,
          persisted: true,
        });
        this.assertCurrent(token);
      }
      await this.refreshInternal(token);
      this.notice = 'Deleted';
      return COMPLETED;
    });
  }

  createProject(
    request: Readonly<{ name: string; description?: string }>,
  ): Promise<CommunityGeometryFilesResult> {
    return this.run('create-project', async (token) => {
      const name = request.name;
      const description = request.description;
      const connection = this.requireConnection();
      await connection.provider.projectGroups.create({ name, description });
      this.assertCurrent(token);
      await this.refreshInternal(token);
      this.notice = 'Project created';
      return COMPLETED;
    });
  }

  updateProject(
    request: Readonly<{
      project: CommunityGeometryProjectReference;
      name?: string;
      description?: string;
    }>,
  ): Promise<CommunityGeometryFilesResult> {
    return this.run('update-project', async (token) => {
      const project = this.resolveProject(request.project);
      const name = request.name;
      const description = request.description;
      const connection = this.requireConnection();
      await connection.provider.projectGroups.update({
        id: project.id,
        expectedStorageVersion: project.storageVersion,
        ...(name === undefined ? {} : { name }),
        ...(description === undefined ? {} : { description }),
      });
      this.assertCurrent(token);
      await this.refreshInternal(token);
      this.notice = 'Project updated';
      return COMPLETED;
    });
  }

  deleteProject(
    request: Readonly<{
      project: CommunityGeometryProjectReference;
      confirmed: boolean;
    }>,
  ): Promise<CommunityGeometryFilesResult> {
    return this.run('delete-project', async (token) => {
      const project = this.resolveProject(request.project);
      const result = await this.requireConnection().coordinator.deleteProjectGroup({
        projectGroup: project,
        confirmed: captureConfirmed(request.confirmed),
      });
      this.assertCurrent(token);
      if (result.status !== 'completed') return result;
      await this.refreshInternal(token);
      this.notice = 'Project deleted';
      return COMPLETED;
    });
  }

  setDocumentMembership(
    request: Readonly<{
      document: CommunityGeometryDocumentReference;
      projectGroupIds: readonly string[];
    }>,
  ): Promise<CommunityGeometryFilesResult> {
    return this.run('set-document-membership', async (token) => {
      const document = this.resolveDocument(request.document);
      const projectGroupIds = captureProjectGroupIds(request.projectGroupIds);
      const knownProjects = new Set(
        this.providerSnapshot?.projectGroups.map((project) => project.id),
      );
      if (projectGroupIds.some((projectId) => !knownProjects.has(projectId))) {
        throw new CommunityGeometryFilesControllerError(
          'stale-project',
          'A selected project is no longer in this catalogue',
        );
      }
      const result = await this.requireConnection().coordinator.setDocumentMembership({
        document,
        projectGroupIds,
      });
      this.assertCurrent(token);
      if (result.status !== 'completed') return result;
      await this.refreshInternal(token);
      this.notice = 'Project membership updated';
      return COMPLETED;
    });
  }

  private chooseOrChange(
    operation: 'choose-workspace' | 'change-workspace',
    options: CommunityGeometryFilesDirtyOptions,
  ): Promise<CommunityGeometryFilesResult> {
    return this.run(operation, async (token) => {
      const dirtyDecision = captureDirtyDecision(options.dirtyDecision);
      const shouldResolveDirty = this.connection !== null;
      const discardedContents =
        shouldResolveDirty &&
        this.session.getSnapshot().isDirty &&
        dirtyDecision === 'discard'
          ? captureGeometryDocumentContents(this.session.getSnapshot())
          : null;
      if (shouldResolveDirty) {
        const dirtyResult = await this.resolveDirty(dirtyDecision, token);
        if (dirtyResult.status !== 'completed') return dirtyResult;
        this.assertCurrent(token);
      }
      try {
        const result = await this.workspaceAccess.choose();
        this.assertCurrent(token);
        if (result.status === 'cancelled') {
          if (discardedContents !== null) {
            this.session.replaceDocument({
              ...discardedContents,
              persisted: false,
            });
            this.assertCurrent(token);
          }
          return CANCELLED;
        }
        await this.installConnection(result, token);
        this.notice = 'Workspace connected';
        return COMPLETED;
      } catch (cause) {
        if (discardedContents !== null && this.isCurrent(token)) {
          this.session.replaceDocument({
            ...discardedContents,
            persisted: false,
          });
        }
        throw cause;
      }
    });
  }

  private replaceWithCleanDocument(
    operation: 'new-document' | 'import-document',
    captureContents: () => GeometryDocumentContents,
    captureDecision: () => GeometryDocumentDirtyDecision | undefined,
    notice: string,
  ): Promise<CommunityGeometryFilesResult> {
    return this.run(operation, async (token) => {
      const contents = captureContents();
      const dirtyDecision = captureDecision();
      if (this.connection !== null) {
        const result = await this.connection.coordinator.newDocument({
          contents,
          dirtyDecision,
          persisted: true,
        });
        this.assertCurrent(token);
        if (result.status !== 'completed') return result;
        await this.refreshInternal(token);
      } else {
        const dirtyResult = await this.resolveDirty(dirtyDecision, token);
        if (dirtyResult.status !== 'completed') return dirtyResult;
        const connectionAfterDirty = this.getConnection();
        if (connectionAfterDirty !== null) {
          const result = await connectionAfterDirty.coordinator.newDocument({
            contents,
            persisted: true,
          });
          this.assertCurrent(token);
          if (result.status !== 'completed') return result;
          await this.refreshInternal(token);
        } else {
          this.session.replaceDocument({ ...contents, persisted: true });
        }
      }
      this.activeConflict = null;
      this.notice = notice;
      return COMPLETED;
    });
  }

  private async resolveDirty(
    decision: GeometryDocumentDirtyDecision | undefined,
    token: number,
  ): Promise<CommunityGeometryFilesResult> {
    if (!this.session.getSnapshot().isDirty) return COMPLETED;
    if (decision === undefined) {
      throw new CommunityGeometryFilesControllerError(
        'dirty-decision-required',
        'Choose Save, Discard, or Cancel before replacing this document',
      );
    }
    if (decision === 'cancel') return CANCELLED;
    if (decision === 'save') {
      const saved = await this.saveInternal(token);
      if (saved.status !== 'completed') return saved;
      return this.session.getSnapshot().isDirty ? SUPERSEDED : COMPLETED;
    }
    this.session.replaceDocument({ ...this.cleanBaseline, persisted: true });
    return COMPLETED;
  }

  private async saveInternal(token: number): Promise<CommunityGeometryFilesResult> {
    if (this.connection === null) {
      if (this.workspace.status === 'permission-required') {
        throw new BrowserDirectoryWorkspaceError(
          'permission-required',
          'Reconnect the remembered workspace before saving',
          { directoryName: this.workspace.directoryName },
        );
      }
      const chosen = await this.workspaceAccess.choose();
      this.assertCurrent(token);
      if (chosen.status === 'cancelled') return CANCELLED;
      await this.installConnection(chosen, token);
    }
    const connection = this.requireConnection();
    const active = connection.coordinator.getActiveDocument();
    if (active !== null && !this.session.getSnapshot().isDirty) {
      this.notice = 'Saved';
      return COMPLETED;
    }
    const result = await connection.coordinator.save();
    this.assertCurrent(token);
    if (result.status !== 'completed') return result;
    await this.refreshInternal(token);
    this.notice = this.session.getSnapshot().isDirty
      ? 'Saved; newer local changes remain'
      : 'Saved';
    return COMPLETED;
  }

  private async installConnection(
    result: BrowserDirectoryWorkspaceConnected,
    token: number,
  ): Promise<void> {
    let directoryName: unknown;
    let workspaceId: unknown;
    let provider: GeometryWorkspaceProvider;
    let providerId: unknown;
    try {
      directoryName = result.binding.directoryName;
      workspaceId = result.binding.workspaceId;
      provider = result.provider;
      providerId = provider.id;
    } catch (cause) {
      throw new CommunityGeometryFilesControllerError(
        'operation-failed',
        'The selected workspace connection is invalid',
        { cause },
      );
    }
    const safeDirectoryName = captureNonEmptyString(
      directoryName,
      'Directory name',
    );
    const safeProviderId = captureNonEmptyString(providerId, 'Workspace id');
    if (workspaceId !== safeProviderId) {
      throw new CommunityGeometryFilesControllerError(
        'operation-failed',
        'The selected workspace binding does not match its provider',
      );
    }
    const rawSnapshot = await provider.getSnapshot();
    this.assertCurrent(token);
    const snapshot = captureWorkspaceSnapshot(rawSnapshot, safeProviderId);
    const coordinator = createGeometryDocumentCoordinator({
      provider,
      session: this.session,
    });
    this.connection = Object.freeze({
      directoryName: safeDirectoryName,
      provider,
      providerId: safeProviderId,
      coordinator,
    });
    this.providerSnapshot = snapshot;
    this.activeConflict = null;
    this.workspace = Object.freeze({
      status: 'connected',
      canChoose: this.canChoose,
      directoryName: safeDirectoryName,
    });
    this.reconcileFilter();
    this.publish();
    this.assertCurrent(token);
  }

  private async refreshInternal(token: number): Promise<void> {
    const connection = this.requireConnection();
    const rawSnapshot = await connection.provider.getSnapshot();
    this.assertCurrent(token);
    const snapshot = captureWorkspaceSnapshot(
      rawSnapshot,
      connection.providerId,
    );
    this.providerSnapshot = snapshot;
    this.reconcileFilter();
    this.reconcileActiveConflict();
    this.publish();
    this.assertCurrent(token);
  }

  private reconcileFilter(): void {
    if (this.filter.kind !== 'project') return;
    const projectGroupId = this.filter.projectGroupId;
    if (
      !this.providerSnapshot?.projectGroups.some(
        (project) => project.id === projectGroupId,
      )
    ) {
      this.filter = ALL_FILTER;
    }
  }

  private reconcileActiveConflict(): void {
    const active = this.connection?.coordinator.getActiveDocument() ?? null;
    if (active === null) {
      this.activeConflict = null;
      return;
    }
    const available = this.providerSnapshot?.documents.find(
      (document) => document.id === active.id,
    );
    if (available === undefined) {
      this.activeConflict = Object.freeze({
        kind: 'deleted',
        documentId: active.id,
        loadedStorageVersion: active.storageVersion,
        availableStorageVersion: null,
      });
      return;
    }
    this.activeConflict =
      available.storageVersion === active.storageVersion
        ? null
        : Object.freeze({
            kind: 'changed',
            documentId: active.id,
            loadedStorageVersion: active.storageVersion,
            availableStorageVersion: available.storageVersion,
          });
  }

  private resolveDocument(
    reference: CommunityGeometryDocumentReference,
  ): GeometryDocumentCatalogueEntry {
    let id: unknown;
    let storageVersion: unknown;
    try {
      id = reference.id;
      storageVersion = reference.storageVersion;
    } catch (cause) {
      throw new CommunityGeometryFilesControllerError(
        'invalid-request',
        'Document reference could not be read',
        { cause },
      );
    }
    const safeId = captureNonEmptyString(id, 'Document id');
    const safeVersion = captureNonEmptyString(
      storageVersion,
      'Document storage version',
    );
    const document = this.providerSnapshot?.documents.find(
      (entry) => entry.id === safeId,
    );
    if (document === undefined || document.storageVersion !== safeVersion) {
      throw new CommunityGeometryFilesControllerError(
        'stale-document',
        'This document row has changed; refresh before trying again',
      );
    }
    return document;
  }

  private resolveProject(
    reference: CommunityGeometryProjectReference,
  ): GeometryProjectGroupCatalogueEntry {
    let id: unknown;
    let storageVersion: unknown;
    try {
      id = reference.id;
      storageVersion = reference.storageVersion;
    } catch (cause) {
      throw new CommunityGeometryFilesControllerError(
        'invalid-request',
        'Project reference could not be read',
        { cause },
      );
    }
    const safeId = captureNonEmptyString(id, 'Project id');
    const safeVersion = captureNonEmptyString(
      storageVersion,
      'Project storage version',
    );
    const project = this.providerSnapshot?.projectGroups.find(
      (entry) => entry.id === safeId,
    );
    if (project === undefined || project.storageVersion !== safeVersion) {
      throw new CommunityGeometryFilesControllerError(
        'stale-project',
        'This project row has changed; refresh before trying again',
      );
    }
    return project;
  }

  private requireConnection(): ControllerConnection {
    if (this.connection === null) {
      throw new CommunityGeometryFilesControllerError(
        'workspace-required',
        'Choose a local workspace folder first',
      );
    }
    return this.connection;
  }

  private getConnection(): ControllerConnection | null {
    return this.connection;
  }

  private clearConnection(): void {
    this.connection = null;
    this.providerSnapshot = null;
    this.activeConflict = null;
    this.filter = ALL_FILTER;
    this.workspace = Object.freeze({
      status: 'disconnected',
      canChoose: this.canChoose,
    });
    this.publish();
  }

  private buildSnapshot(): CommunityGeometryFilesSnapshot {
    const documents = this.providerSnapshot?.documents ?? EMPTY_DOCUMENTS;
    const projects = this.providerSnapshot?.projectGroups ?? EMPTY_PROJECTS;
    const normalizedSearch = this.search.trim().toLowerCase();
    const visibleDocuments = Object.freeze(
      documents.filter((document) => {
        const matchesFilter =
          this.filter.kind === 'all' ||
          (this.filter.kind === 'unassigned'
            ? document.projectGroupIds.length === 0
            : document.projectGroupIds.includes(this.filter.projectGroupId));
        return (
          matchesFilter &&
          (normalizedSearch.length === 0 ||
            document.fileName.toLowerCase().includes(normalizedSearch))
        );
      }),
    );
    const activeDocument =
      this.connection?.coordinator.getActiveDocument() ?? null;
    return Object.freeze({
      workspace: this.workspace,
      document: this.document,
      documents,
      projects,
      visibleDocuments,
      activeDocument,
      activeDocumentId: activeDocument?.id ?? null,
      catalogueVersion: this.providerSnapshot?.catalogueVersion ?? null,
      search: this.search,
      filter: this.filter,
      isBusy: this.operation !== null,
      isLoading: isLoadingOperation(this.operation),
      operation: this.operation,
      error: this.error,
      notice: this.notice,
      activeConflict: this.activeConflict,
    });
  }

  private publish(): void {
    if (this.disposed) return;
    this.currentSnapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new CommunityGeometryFilesControllerError(
        'disposed',
        'This Community files controller has been disposed',
      );
    }
  }

  private assertCurrent(token: number): void {
    if (!this.isCurrent(token)) throw SUPERSEDED_SIGNAL;
  }

  private isCurrent(token: number): boolean {
    return !this.disposed && this.generation === token;
  }

  private async run(
    operation: CommunityGeometryFilesOperation,
    action: (token: number) => Promise<CommunityGeometryFilesResult>,
  ): Promise<CommunityGeometryFilesResult> {
    this.assertUsable();
    if (this.operation !== null) {
      const error = new CommunityGeometryFilesControllerError(
        'operation-in-progress',
        'Another local files operation is already in progress',
        { operation },
      );
      this.error = visibleError(error, operation);
      this.publish();
      throw error;
    }
    const token = ++this.generation;
    this.operation = operation;
    this.error = null;
    this.notice = null;
    this.publish();
    try {
      return await action(token);
    } catch (cause) {
      if (cause === SUPERSEDED_SIGNAL) return SUPERSEDED;
      const error = normalizeError(cause, operation);
      if (this.isCurrent(token)) {
        this.error = visibleError(error, operation);
        this.publish();
      }
      throw error;
    } finally {
      if (this.isCurrent(token)) {
        this.operation = null;
        this.publish();
      }
    }
  }
}

export function createCommunityGeometryFilesController(
  options: CommunityGeometryFilesControllerOptions,
): CommunityGeometryFilesController {
  const controller = new DefaultCommunityGeometryFilesController(options);
  const facade: CommunityGeometryFilesController = {
    getSnapshot: () => controller.getSnapshot(),
    subscribe: (listener) => controller.subscribe(listener),
    dispose: () => controller.dispose(),
    clearFeedback: () => controller.clearFeedback(),
    setSearch: (search) => controller.setSearch(search),
    setFilter: (filter) => controller.setFilter(filter),
    restoreWorkspace: () => controller.restoreWorkspace(),
    reconnectWorkspace: () => controller.reconnectWorkspace(),
    chooseWorkspace: (request) => controller.chooseWorkspace(request),
    changeWorkspace: (request) => controller.changeWorkspace(request),
    disconnectWorkspace: (request) => controller.disconnectWorkspace(request),
    refresh: () => controller.refresh(),
    save: () => controller.save(),
    newDocument: (request) => controller.newDocument(request),
    importDocument: (request) => controller.importDocument(request),
    openDocument: (request) => controller.openDocument(request),
    duplicateDocument: (request) => controller.duplicateDocument(request),
    deleteDocument: (request) => controller.deleteDocument(request),
    createProject: (request) => controller.createProject(request),
    updateProject: (request) => controller.updateProject(request),
    deleteProject: (request) => controller.deleteProject(request),
    setDocumentMembership: (request) =>
      controller.setDocumentMembership(request),
  };
  return Object.freeze(facade);
}
