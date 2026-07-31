// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometryDocumentContents,
  GeometryDocumentInput,
} from './contracts';

export type GeometryWorkspaceProviderIdKind = 'document' | 'project-group';

export type GeometryWorkspaceProviderErrorCode =
  | 'invalid-id'
  | 'invalid-name'
  | 'invalid-request'
  | 'duplicate-id'
  | 'duplicate-name'
  | 'not-found'
  | 'version-conflict'
  | 'unsupported-operation'
  | 'operation-failed';

export type GeometryWorkspaceProviderResource =
  | 'workspace'
  | 'catalogue'
  | 'document'
  | 'project-group';

export type GeometryWorkspaceProviderErrorDetails = Readonly<{
  resource: GeometryWorkspaceProviderResource;
  id?: string;
  cause?: unknown;
}>;

export class GeometryWorkspaceProviderError extends Error {
  readonly code: GeometryWorkspaceProviderErrorCode;
  readonly resource: GeometryWorkspaceProviderResource;
  readonly id?: string;
  readonly cause?: unknown;

  constructor(
    code: GeometryWorkspaceProviderErrorCode,
    message: string,
    details: GeometryWorkspaceProviderErrorDetails,
  ) {
    super(message);
    this.name = 'GeometryWorkspaceProviderError';
    this.code = code;
    this.resource = details.resource;
    this.id = details.id;
    this.cause = details.cause;
  }
}

export type GeometryWorkspaceProviderCapabilities = Readonly<{
  persistence: 'session' | 'durable';
  externalChanges: 'manual-refresh' | 'automatic';
  create: boolean;
  update: boolean;
  duplicate: boolean;
  delete: boolean;
  projectGroups: boolean;
}>;

export type GeometryDocumentCatalogueEntry = Readonly<{
  id: string;
  fileName: string;
  modifiedAt: string | null;
  storageVersion: string;
  projectGroupIds: readonly string[];
}>;

export type GeometryProjectGroupCatalogueEntry = Readonly<{
  id: string;
  name: string;
  description: string;
  storageVersion: string;
}>;

export type GeometryWorkspaceSnapshot = Readonly<{
  providerId: string;
  catalogueVersion: string;
  documents: readonly GeometryDocumentCatalogueEntry[];
  projectGroups: readonly GeometryProjectGroupCatalogueEntry[];
}>;

export type GeometryDocumentCatalogueFilter =
  | Readonly<{ kind: 'all' }>
  | Readonly<{ kind: 'unassigned' }>
  | Readonly<{ kind: 'project'; projectGroupId: string }>;

function requireOpaqueId(
  value: unknown,
  resource: GeometryWorkspaceProviderResource,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GeometryWorkspaceProviderError(
      'invalid-id',
      `${resource} id must be a non-empty string`,
      { resource },
    );
  }
  return value;
}

export function filterGeometryDocumentCatalogueEntries(
  entries: readonly GeometryDocumentCatalogueEntry[],
  filter: GeometryDocumentCatalogueFilter,
): readonly GeometryDocumentCatalogueEntry[] {
  const kind = filter.kind;
  if (kind === 'all') {
    return Object.freeze([...entries]);
  }
  if (kind === 'unassigned') {
    return Object.freeze(
      entries.filter((entry) => entry.projectGroupIds.length === 0),
    );
  }
  if (kind === 'project') {
    const projectGroupId = requireOpaqueId(
      filter.projectGroupId,
      'project-group',
    );
    return Object.freeze(
      entries.filter((entry) =>
        entry.projectGroupIds.includes(projectGroupId),
      ),
    );
  }

  throw new GeometryWorkspaceProviderError(
    'invalid-request',
    'Unknown geometry document catalogue filter',
    { resource: 'catalogue' },
  );
}

export type GeometryStoredDocument = Readonly<{
  entry: GeometryDocumentCatalogueEntry;
  contents: GeometryDocumentContents;
}>;

export type GeometryDocumentOpenRequest = Readonly<{
  id: string;
  expectedStorageVersion: string;
}>;

export type GeometryDocumentCreateRequest = Readonly<{
  contents: GeometryDocumentInput;
  projectGroupIds: readonly string[];
  sessionRevision: number;
}>;

export type GeometryDocumentUpdateRequest = Readonly<{
  id: string;
  expectedStorageVersion: string;
  contents: GeometryDocumentInput;
  sessionRevision: number;
}>;

export type GeometryDocumentDuplicateRequest = Readonly<{
  sourceId: string;
  expectedStorageVersion: string;
  contents?: GeometryDocumentInput;
  sessionRevision?: number;
}>;

export type GeometryDocumentDeleteRequest = Readonly<{
  id: string;
  expectedStorageVersion: string;
}>;

export type GeometryDocumentPersistenceReceipt = Readonly<{
  entry: GeometryDocumentCatalogueEntry;
  contents: GeometryDocumentContents;
  persistedSessionRevision: number;
  snapshot: GeometryWorkspaceSnapshot;
}>;

export type GeometryDocumentDuplicateReceipt = Readonly<{
  entry: GeometryDocumentCatalogueEntry;
  contents: GeometryDocumentContents;
  persistedSessionRevision?: number;
  snapshot: GeometryWorkspaceSnapshot;
}>;

export type GeometryDocumentDeleteReceipt = Readonly<{
  deletedDocumentId: string;
  snapshot: GeometryWorkspaceSnapshot;
}>;

export type GeometryDocumentMembershipReceipt = Readonly<{
  entry: GeometryDocumentCatalogueEntry;
  snapshot: GeometryWorkspaceSnapshot;
}>;

export interface GeometryWorkspaceDocumentOperations {
  open(request: GeometryDocumentOpenRequest): Promise<GeometryStoredDocument>;
  create(
    request: GeometryDocumentCreateRequest,
  ): Promise<GeometryDocumentPersistenceReceipt>;
  update(
    request: GeometryDocumentUpdateRequest,
  ): Promise<GeometryDocumentPersistenceReceipt>;
  duplicate(
    request: GeometryDocumentDuplicateRequest,
  ): Promise<GeometryDocumentDuplicateReceipt>;
  delete(
    request: GeometryDocumentDeleteRequest,
  ): Promise<GeometryDocumentDeleteReceipt>;
}

export type GeometryProjectGroupCreateRequest = Readonly<{
  name: string;
  description?: string;
}>;

export type GeometryProjectGroupUpdateRequest = Readonly<{
  id: string;
  expectedStorageVersion: string;
  name?: string;
  description?: string;
}>;

export type GeometryProjectGroupDeleteRequest = Readonly<{
  id: string;
  expectedStorageVersion: string;
}>;

export type GeometryProjectGroupSetDocumentMembershipRequest = Readonly<{
  documentId: string;
  expectedStorageVersion: string;
  projectGroupIds: readonly string[];
}>;

export type GeometryProjectGroupMutationReceipt = Readonly<{
  projectGroup: GeometryProjectGroupCatalogueEntry;
  snapshot: GeometryWorkspaceSnapshot;
}>;

export type GeometryProjectGroupDeleteReceipt = Readonly<{
  deletedProjectGroupId: string;
  snapshot: GeometryWorkspaceSnapshot;
}>;

export interface GeometryWorkspaceProjectGroupOperations {
  create(
    request: GeometryProjectGroupCreateRequest,
  ): Promise<GeometryProjectGroupMutationReceipt>;
  update(
    request: GeometryProjectGroupUpdateRequest,
  ): Promise<GeometryProjectGroupMutationReceipt>;
  delete(
    request: GeometryProjectGroupDeleteRequest,
  ): Promise<GeometryProjectGroupDeleteReceipt>;
  setDocumentMembership(
    request: GeometryProjectGroupSetDocumentMembershipRequest,
  ): Promise<GeometryDocumentMembershipReceipt>;
}

export interface GeometryWorkspaceProvider {
  readonly id: string;
  readonly capabilities: GeometryWorkspaceProviderCapabilities;
  getSnapshot(): Promise<GeometryWorkspaceSnapshot>;
  readonly documents: GeometryWorkspaceDocumentOperations;
  readonly projectGroups: GeometryWorkspaceProjectGroupOperations;
}
