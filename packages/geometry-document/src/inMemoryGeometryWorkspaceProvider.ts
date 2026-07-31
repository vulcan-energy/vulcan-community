// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometryDocumentContents,
  GeometryDocumentInput,
} from './contracts';
import { captureGeometryDocumentContents } from './documentContents';
import {
  geometryDocumentNameKey,
  geometryProjectGroupNameKey,
  nextDuplicateGeometryDocumentName,
  normalizeGeometryDocumentName,
  normalizeGeometryProjectGroupName,
} from './documentNaming';
import {
  GeometryWorkspaceProviderError,
  type GeometryDocumentCatalogueEntry,
  type GeometryDocumentCreateRequest,
  type GeometryDocumentDeleteRequest,
  type GeometryDocumentDuplicateReceipt,
  type GeometryDocumentDuplicateRequest,
  type GeometryDocumentMembershipReceipt,
  type GeometryDocumentOpenRequest,
  type GeometryDocumentPersistenceReceipt,
  type GeometryDocumentDeleteReceipt,
  type GeometryDocumentUpdateRequest,
  type GeometryProjectGroupCatalogueEntry,
  type GeometryProjectGroupCreateRequest,
  type GeometryProjectGroupDeleteRequest,
  type GeometryProjectGroupDeleteReceipt,
  type GeometryProjectGroupMutationReceipt,
  type GeometryProjectGroupSetDocumentMembershipRequest,
  type GeometryProjectGroupUpdateRequest,
  type GeometryStoredDocument,
  type GeometryWorkspaceProvider,
  type GeometryWorkspaceProviderCapabilities,
  type GeometryWorkspaceProviderIdKind,
  type GeometryWorkspaceProviderResource,
  type GeometryWorkspaceSnapshot,
} from './providerContracts';

export type InMemoryGeometryWorkspaceDocumentSeed = Readonly<{
  id: string;
  contents: GeometryDocumentInput;
  projectGroupIds?: readonly string[];
  modifiedAt?: string | null;
}>;

export type InMemoryGeometryWorkspaceProjectGroupSeed = Readonly<{
  id: string;
  name: string;
  description?: string;
}>;

export type InMemoryGeometryWorkspaceProviderSeed = Readonly<{
  id: string;
  createId: (kind: GeometryWorkspaceProviderIdKind) => string;
  documents?: readonly InMemoryGeometryWorkspaceDocumentSeed[];
  projectGroups?: readonly InMemoryGeometryWorkspaceProjectGroupSeed[];
}>;

type StoredDocumentState = Readonly<{
  id: string;
  contents: GeometryDocumentContents;
  projectGroupIds: readonly string[];
  modifiedAt: string | null;
  version: number;
}>;

type StoredProjectGroupState = Readonly<{
  id: string;
  name: string;
  description: string;
  version: number;
}>;

const PATH_SEPARATOR = /[\\/]/u;
const OPAQUE_ID_MAX_LENGTH = 128;
const DESCRIPTION_MAX_LENGTH = 2_000;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}

function providerError(
  code: ConstructorParameters<typeof GeometryWorkspaceProviderError>[0],
  message: string,
  resource: GeometryWorkspaceProviderResource,
  id?: string,
): GeometryWorkspaceProviderError {
  return new GeometryWorkspaceProviderError(code, message, {
    resource,
    ...(id === undefined ? {} : { id }),
  });
}

function captureOpaqueId(
  value: unknown,
  resource: GeometryWorkspaceProviderResource,
): string {
  if (typeof value !== 'string') {
    throw providerError('invalid-id', `${resource} id must be a string`, resource);
  }
  const normalized = value.normalize('NFC');
  if (
    normalized.length === 0 ||
    normalized !== value ||
    normalized.trim() !== normalized ||
    normalized === '.' ||
    normalized === '..' ||
    containsControlCharacter(normalized) ||
    PATH_SEPARATOR.test(normalized) ||
    Array.from(normalized).length > OPAQUE_ID_MAX_LENGTH
  ) {
    throw providerError(
      'invalid-id',
      `${resource} id must be a canonical, non-path opaque id`,
      resource,
    );
  }
  return normalized;
}

function captureStorageVersion(value: unknown, resource: GeometryWorkspaceProviderResource): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw providerError(
      'invalid-request',
      `Expected ${resource} storage version must be a non-empty string`,
      resource,
    );
  }
  return value;
}

function captureSessionRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw providerError(
      'invalid-request',
      'Session revision must be a non-negative safe integer',
      'document',
    );
  }
  return value as number;
}

function captureDescription(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw providerError(
      'invalid-request',
      'Project group description must be a string',
      'project-group',
    );
  }
  const normalized = value.normalize('NFC');
  if (
    containsControlCharacter(normalized) ||
    Array.from(normalized).length > DESCRIPTION_MAX_LENGTH
  ) {
    throw providerError(
      'invalid-request',
      `Project group description must not contain control characters or exceed ${DESCRIPTION_MAX_LENGTH} characters`,
      'project-group',
    );
  }
  return normalized;
}

function captureModifiedAt(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw providerError(
      'invalid-request',
      'Document modifiedAt must be null or a non-empty string',
      'document',
    );
  }
  return value;
}

function captureContents(value: unknown): GeometryDocumentContents {
  if (typeof value !== 'object' || value === null) {
    throw providerError(
      'invalid-request',
      'Document contents must be an object',
      'document',
    );
  }
  const candidate = value as GeometryDocumentInput;
  let rawFileName: unknown;
  let rawText: unknown;
  let rawDerivedResources: unknown;
  let rawSourceFiles: unknown;
  try {
    rawFileName = candidate.fileName;
    rawText = candidate.text;
    rawDerivedResources = candidate.derivedResources;
    rawSourceFiles = candidate.sourceFiles;
  } catch (cause) {
    throw new GeometryWorkspaceProviderError(
      'invalid-request',
      'Document contents could not be read',
      { resource: 'document', cause },
    );
  }
  if (typeof rawFileName !== 'string') {
    throw providerError(
      'invalid-name',
      'Document file name must be a string',
      'document',
    );
  }
  if (typeof rawText !== 'string') {
    throw providerError(
      'invalid-request',
      'Document text must be a string',
      'document',
    );
  }
  const fileName = normalizeGeometryDocumentName(rawFileName);
  try {
    return captureGeometryDocumentContents({
      fileName,
      text: rawText,
      ...(rawDerivedResources === undefined
        ? {}
        : { derivedResources: rawDerivedResources }),
      ...(rawSourceFiles === undefined ? {} : { sourceFiles: rawSourceFiles }),
    } as GeometryDocumentInput);
  } catch (cause) {
    throw new GeometryWorkspaceProviderError(
      'invalid-request',
      'Document resources are invalid',
      { resource: 'document', cause },
    );
  }
}

function captureIdList(
  value: unknown,
  resource: GeometryWorkspaceProviderResource,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw providerError(
      'invalid-request',
      'Project group ids must be an array',
      resource,
    );
  }
  const captured = Array.from(value, (id) =>
    captureOpaqueId(id, 'project-group'),
  );
  if (new Set(captured).size !== captured.length) {
    throw providerError(
      'invalid-request',
      'Project group ids must not contain duplicates',
      resource,
    );
  }
  return Object.freeze(captured);
}

function documentStorageVersion(version: number): string {
  return `document:${version}`;
}

function projectGroupStorageVersion(version: number): string {
  return `project-group:${version}`;
}

function documentEntry(state: StoredDocumentState): GeometryDocumentCatalogueEntry {
  return Object.freeze({
    id: state.id,
    fileName: state.contents.fileName,
    modifiedAt: state.modifiedAt,
    storageVersion: documentStorageVersion(state.version),
    projectGroupIds: Object.freeze([...state.projectGroupIds]),
  });
}

function projectGroupEntry(
  state: StoredProjectGroupState,
): GeometryProjectGroupCatalogueEntry {
  return Object.freeze({
    id: state.id,
    name: state.name,
    description: state.description,
    storageVersion: projectGroupStorageVersion(state.version),
  });
}

function settle<T>(operation: () => T): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function createInMemoryGeometryWorkspaceProvider(
  seed: InMemoryGeometryWorkspaceProviderSeed,
): GeometryWorkspaceProvider {
  const rawProviderId = seed.id;
  const rawCreateId = seed.createId;
  const rawDocuments = seed.documents;
  const rawProjectGroups = seed.projectGroups;
  const providerId = captureOpaqueId(rawProviderId, 'workspace');
  if (typeof rawCreateId !== 'function') {
    throw providerError(
      'invalid-request',
      'Workspace provider requires an id allocator',
      'workspace',
      providerId,
    );
  }
  if (rawDocuments !== undefined && !Array.isArray(rawDocuments)) {
    throw providerError(
      'invalid-request',
      'Workspace documents seed must be an array',
      'workspace',
      providerId,
    );
  }
  if (rawProjectGroups !== undefined && !Array.isArray(rawProjectGroups)) {
    throw providerError(
      'invalid-request',
      'Workspace project groups seed must be an array',
      'workspace',
      providerId,
    );
  }

  const documentSeeds = Array.from(rawDocuments ?? []);
  const projectGroupSeeds = Array.from(rawProjectGroups ?? []);
  const documents = new Map<string, StoredDocumentState>();
  const projectGroups = new Map<string, StoredProjectGroupState>();
  const allIds = new Set<string>();
  const documentNameKeys = new Set<string>();
  const projectGroupNameKeys = new Set<string>();

  for (const rawProjectGroup of projectGroupSeeds) {
    const rawId = rawProjectGroup.id;
    const rawName = rawProjectGroup.name;
    const rawDescription = rawProjectGroup.description;
    const id = captureOpaqueId(rawId, 'project-group');
    const name =
      typeof rawName === 'string'
        ? normalizeGeometryProjectGroupName(rawName)
        : (() => {
            throw providerError(
              'invalid-name',
              'Project group name must be a string',
              'project-group',
              id,
            );
          })();
    const description = captureDescription(rawDescription);
    const nameKey = geometryProjectGroupNameKey(name);
    if (allIds.has(id)) {
      throw providerError(
        'duplicate-id',
        `Duplicate workspace id ${id}`,
        'project-group',
        id,
      );
    }
    if (projectGroupNameKeys.has(nameKey)) {
      throw providerError(
        'duplicate-name',
        `Duplicate project group name ${name}`,
        'project-group',
        id,
      );
    }
    allIds.add(id);
    projectGroupNameKeys.add(nameKey);
    projectGroups.set(
      id,
      Object.freeze({ id, name, description, version: 0 }),
    );
  }

  for (const rawDocument of documentSeeds) {
    const rawId = rawDocument.id;
    const rawContents = rawDocument.contents;
    const rawProjectGroupIds = rawDocument.projectGroupIds;
    const rawModifiedAt = rawDocument.modifiedAt;
    const id = captureOpaqueId(rawId, 'document');
    const contents = captureContents(rawContents);
    const memberships = captureIdList(rawProjectGroupIds ?? [], 'document');
    const modifiedAt = captureModifiedAt(rawModifiedAt);
    const nameKey = geometryDocumentNameKey(contents.fileName);
    if (allIds.has(id)) {
      throw providerError(
        'duplicate-id',
        `Duplicate workspace id ${id}`,
        'document',
        id,
      );
    }
    if (documentNameKeys.has(nameKey)) {
      throw providerError(
        'duplicate-name',
        `Duplicate document name ${contents.fileName}`,
        'document',
        id,
      );
    }
    for (const projectGroupId of memberships) {
      if (!projectGroups.has(projectGroupId)) {
        throw providerError(
          'not-found',
          `Unknown project group ${projectGroupId}`,
          'project-group',
          projectGroupId,
        );
      }
    }
    allIds.add(id);
    documentNameKeys.add(nameKey);
    documents.set(
      id,
      Object.freeze({
        id,
        contents,
        projectGroupIds: memberships,
        modifiedAt,
        version: 0,
      }),
    );
  }

  let catalogueVersion = 0;

  const capabilities: GeometryWorkspaceProviderCapabilities = Object.freeze({
    persistence: 'session',
    externalChanges: 'manual-refresh',
    create: true,
    update: true,
    duplicate: true,
    delete: true,
    projectGroups: true,
  });

  function snapshot(): GeometryWorkspaceSnapshot {
    const documentStates = Array.from(documents.values()).sort((left, right) => {
      const leftKey = geometryDocumentNameKey(left.contents.fileName);
      const rightKey = geometryDocumentNameKey(right.contents.fileName);
      if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
    const projectGroupStates = Array.from(projectGroups.values()).sort(
      (left, right) => {
        const leftKey = geometryProjectGroupNameKey(left.name);
        const rightKey = geometryProjectGroupNameKey(right.name);
        if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      },
    );
    return Object.freeze({
      providerId,
      catalogueVersion: `catalogue:${catalogueVersion}`,
      documents: Object.freeze(
        documentStates.map((state) => documentEntry(state)),
      ),
      projectGroups: Object.freeze(
        projectGroupStates.map((state) => projectGroupEntry(state)),
      ),
    });
  }

  function requireDocument(id: string): StoredDocumentState {
    const state = documents.get(id);
    if (state === undefined) {
      throw providerError(
        'not-found',
        `Document ${id} was not found`,
        'document',
        id,
      );
    }
    return state;
  }

  function requireProjectGroup(id: string): StoredProjectGroupState {
    const state = projectGroups.get(id);
    if (state === undefined) {
      throw providerError(
        'not-found',
        `Project group ${id} was not found`,
        'project-group',
        id,
      );
    }
    return state;
  }

  function assertVersion(
    actual: string,
    expected: string,
    resource: 'document' | 'project-group',
    id: string,
  ): void {
    if (actual !== expected) {
      throw providerError(
        'version-conflict',
        `${resource} ${id} has changed`,
        resource,
        id,
      );
    }
  }

  function assertMembershipsExist(memberships: readonly string[]): void {
    for (const projectGroupId of memberships) {
      if (!projectGroups.has(projectGroupId)) {
        throw providerError(
          'not-found',
          `Project group ${projectGroupId} was not found`,
          'project-group',
          projectGroupId,
        );
      }
    }
  }

  function assertDocumentNameAvailable(fileName: string, exceptId?: string): void {
    const key = geometryDocumentNameKey(fileName);
    for (const state of documents.values()) {
      if (state.id !== exceptId && geometryDocumentNameKey(state.contents.fileName) === key) {
        throw providerError(
          'duplicate-name',
          `Document name ${fileName} already exists`,
          'document',
          state.id,
        );
      }
    }
  }

  function assertProjectGroupNameAvailable(name: string, exceptId?: string): void {
    const key = geometryProjectGroupNameKey(name);
    for (const state of projectGroups.values()) {
      if (state.id !== exceptId && geometryProjectGroupNameKey(state.name) === key) {
        throw providerError(
          'duplicate-name',
          `Project group name ${name} already exists`,
          'project-group',
          state.id,
        );
      }
    }
  }

  function allocateId(kind: GeometryWorkspaceProviderIdKind): string {
    let candidate: unknown;
    try {
      candidate = rawCreateId(kind);
    } catch (cause) {
      throw new GeometryWorkspaceProviderError(
        'operation-failed',
        `Could not allocate a ${kind} id`,
        { resource: kind, cause },
      );
    }
    const id = captureOpaqueId(candidate, kind);
    if (allIds.has(id)) {
      throw providerError(
        'duplicate-id',
        `Allocated workspace id ${id} already exists`,
        kind,
        id,
      );
    }
    return id;
  }

  function persistenceReceipt(
    state: StoredDocumentState,
    persistedSessionRevision: number,
  ): GeometryDocumentPersistenceReceipt {
    return Object.freeze({
      entry: documentEntry(state),
      contents: state.contents,
      persistedSessionRevision,
      snapshot: snapshot(),
    });
  }

  const documentOperations: GeometryWorkspaceProvider['documents'] = Object.freeze({
    open(request: GeometryDocumentOpenRequest): Promise<GeometryStoredDocument> {
      return settle(() => {
        const id = captureOpaqueId(request.id, 'document');
        const expectedStorageVersion = captureStorageVersion(
          request.expectedStorageVersion,
          'document',
        );
        const state = requireDocument(id);
        assertVersion(
          documentStorageVersion(state.version),
          expectedStorageVersion,
          'document',
          id,
        );
        return Object.freeze({
          entry: documentEntry(state),
          contents: state.contents,
        });
      });
    },

    create(
      request: GeometryDocumentCreateRequest,
    ): Promise<GeometryDocumentPersistenceReceipt> {
      return settle(() => {
        const contents = captureContents(request.contents);
        const memberships = captureIdList(request.projectGroupIds, 'document');
        const sessionRevision = captureSessionRevision(request.sessionRevision);
        assertMembershipsExist(memberships);
        assertDocumentNameAvailable(contents.fileName);
        const id = allocateId('document');
        const state: StoredDocumentState = Object.freeze({
          id,
          contents,
          projectGroupIds: memberships,
          modifiedAt: null,
          version: 0,
        });
        documents.set(id, state);
        allIds.add(id);
        catalogueVersion += 1;
        return persistenceReceipt(state, sessionRevision);
      });
    },

    update(
      request: GeometryDocumentUpdateRequest,
    ): Promise<GeometryDocumentPersistenceReceipt> {
      return settle(() => {
        const id = captureOpaqueId(request.id, 'document');
        const expectedStorageVersion = captureStorageVersion(
          request.expectedStorageVersion,
          'document',
        );
        const contents = captureContents(request.contents);
        const sessionRevision = captureSessionRevision(request.sessionRevision);
        const current = requireDocument(id);
        assertVersion(
          documentStorageVersion(current.version),
          expectedStorageVersion,
          'document',
          id,
        );
        assertDocumentNameAvailable(contents.fileName, id);
        const state: StoredDocumentState = Object.freeze({
          ...current,
          contents,
          version: current.version + 1,
        });
        documents.set(id, state);
        catalogueVersion += 1;
        return persistenceReceipt(state, sessionRevision);
      });
    },

    duplicate(
      request: GeometryDocumentDuplicateRequest,
    ): Promise<GeometryDocumentDuplicateReceipt> {
      return settle(() => {
        const sourceId = captureOpaqueId(request.sourceId, 'document');
        const expectedStorageVersion = captureStorageVersion(
          request.expectedStorageVersion,
          'document',
        );
        const rawContents = request.contents;
        const rawSessionRevision = request.sessionRevision;
        if (
          (rawContents === undefined) !== (rawSessionRevision === undefined)
        ) {
          throw providerError(
            'invalid-request',
            'Duplicate contents and session revision must be supplied together',
            'document',
            sourceId,
          );
        }
        const current = requireDocument(sourceId);
        assertVersion(
          documentStorageVersion(current.version),
          expectedStorageVersion,
          'document',
          sourceId,
        );
        const sourceContents =
          rawContents === undefined ? current.contents : captureContents(rawContents);
        const sessionRevision =
          rawSessionRevision === undefined
            ? undefined
            : captureSessionRevision(rawSessionRevision);
        const fileName = nextDuplicateGeometryDocumentName(
          sourceContents.fileName,
          Array.from(documents.values(), (state) => state.contents.fileName),
        );
        const contents = captureGeometryDocumentContents({
          fileName,
          text: sourceContents.text,
          derivedResources: sourceContents.derivedResources,
          sourceFiles: sourceContents.sourceFiles,
        });
        const id = allocateId('document');
        const state: StoredDocumentState = Object.freeze({
          id,
          contents,
          projectGroupIds: Object.freeze([...current.projectGroupIds]),
          modifiedAt: null,
          version: 0,
        });
        documents.set(id, state);
        allIds.add(id);
        catalogueVersion += 1;
        return Object.freeze({
          entry: documentEntry(state),
          contents: state.contents,
          ...(sessionRevision === undefined
            ? {}
            : { persistedSessionRevision: sessionRevision }),
          snapshot: snapshot(),
        });
      });
    },

    delete(
      request: GeometryDocumentDeleteRequest,
    ): Promise<GeometryDocumentDeleteReceipt> {
      return settle(() => {
        const id = captureOpaqueId(request.id, 'document');
        const expectedStorageVersion = captureStorageVersion(
          request.expectedStorageVersion,
          'document',
        );
        const current = requireDocument(id);
        assertVersion(
          documentStorageVersion(current.version),
          expectedStorageVersion,
          'document',
          id,
        );
        documents.delete(id);
        catalogueVersion += 1;
        return Object.freeze({
          deletedDocumentId: id,
          snapshot: snapshot(),
        });
      });
    },
  });

  const projectGroupOperations: GeometryWorkspaceProvider['projectGroups'] =
    Object.freeze({
      create(
        request: GeometryProjectGroupCreateRequest,
      ): Promise<GeometryProjectGroupMutationReceipt> {
        return settle(() => {
          const rawName = request.name;
          const rawDescription = request.description;
          if (typeof rawName !== 'string') {
            throw providerError(
              'invalid-name',
              'Project group name must be a string',
              'project-group',
            );
          }
          const name = normalizeGeometryProjectGroupName(rawName);
          const description = captureDescription(rawDescription);
          assertProjectGroupNameAvailable(name);
          const id = allocateId('project-group');
          const state: StoredProjectGroupState = Object.freeze({
            id,
            name,
            description,
            version: 0,
          });
          projectGroups.set(id, state);
          allIds.add(id);
          catalogueVersion += 1;
          return Object.freeze({
            projectGroup: projectGroupEntry(state),
            snapshot: snapshot(),
          });
        });
      },

      update(
        request: GeometryProjectGroupUpdateRequest,
      ): Promise<GeometryProjectGroupMutationReceipt> {
        return settle(() => {
          const id = captureOpaqueId(request.id, 'project-group');
          const expectedStorageVersion = captureStorageVersion(
            request.expectedStorageVersion,
            'project-group',
          );
          const rawName = request.name;
          const rawDescription = request.description;
          const current = requireProjectGroup(id);
          assertVersion(
            projectGroupStorageVersion(current.version),
            expectedStorageVersion,
            'project-group',
            id,
          );
          if (rawName !== undefined && typeof rawName !== 'string') {
            throw providerError(
              'invalid-name',
              'Project group name must be a string',
              'project-group',
              id,
            );
          }
          const name =
            rawName === undefined
              ? current.name
              : normalizeGeometryProjectGroupName(rawName);
          const description =
            rawDescription === undefined
              ? current.description
              : captureDescription(rawDescription);
          assertProjectGroupNameAvailable(name, id);
          if (name === current.name && description === current.description) {
            return Object.freeze({
              projectGroup: projectGroupEntry(current),
              snapshot: snapshot(),
            });
          }
          const state: StoredProjectGroupState = Object.freeze({
            ...current,
            name,
            description,
            version: current.version + 1,
          });
          projectGroups.set(id, state);
          catalogueVersion += 1;
          return Object.freeze({
            projectGroup: projectGroupEntry(state),
            snapshot: snapshot(),
          });
        });
      },

      delete(
        request: GeometryProjectGroupDeleteRequest,
      ): Promise<GeometryProjectGroupDeleteReceipt> {
        return settle(() => {
          const id = captureOpaqueId(request.id, 'project-group');
          const expectedStorageVersion = captureStorageVersion(
            request.expectedStorageVersion,
            'project-group',
          );
          const current = requireProjectGroup(id);
          assertVersion(
            projectGroupStorageVersion(current.version),
            expectedStorageVersion,
            'project-group',
            id,
          );
          const membershipUpdates: StoredDocumentState[] = [];
          for (const state of documents.values()) {
            if (!state.projectGroupIds.includes(id)) continue;
            membershipUpdates.push(
              Object.freeze({
                ...state,
                projectGroupIds: Object.freeze(
                  state.projectGroupIds.filter(
                    (projectGroupId) => projectGroupId !== id,
                  ),
                ),
                version: state.version + 1,
              }),
            );
          }
          projectGroups.delete(id);
          for (const state of membershipUpdates) {
            documents.set(state.id, state);
          }
          catalogueVersion += 1;
          return Object.freeze({
            deletedProjectGroupId: id,
            snapshot: snapshot(),
          });
        });
      },

      setDocumentMembership(
        request: GeometryProjectGroupSetDocumentMembershipRequest,
      ): Promise<GeometryDocumentMembershipReceipt> {
        return settle(() => {
          const documentId = captureOpaqueId(request.documentId, 'document');
          const expectedStorageVersion = captureStorageVersion(
            request.expectedStorageVersion,
            'document',
          );
          const memberships = captureIdList(
            request.projectGroupIds,
            'document',
          );
          const current = requireDocument(documentId);
          assertVersion(
            documentStorageVersion(current.version),
            expectedStorageVersion,
            'document',
            documentId,
          );
          assertMembershipsExist(memberships);
          const unchanged =
            memberships.length === current.projectGroupIds.length &&
            memberships.every(
              (projectGroupId, index) =>
                current.projectGroupIds[index] === projectGroupId,
            );
          if (unchanged) {
            return Object.freeze({
              entry: documentEntry(current),
              snapshot: snapshot(),
            });
          }
          const state: StoredDocumentState = Object.freeze({
            ...current,
            projectGroupIds: memberships,
            version: current.version + 1,
          });
          documents.set(documentId, state);
          catalogueVersion += 1;
          return Object.freeze({
            entry: documentEntry(state),
            snapshot: snapshot(),
          });
        });
      },
    });

  return Object.freeze({
    id: providerId,
    capabilities,
    getSnapshot: () => Promise.resolve(snapshot()),
    documents: documentOperations,
    projectGroups: projectGroupOperations,
  });
}
