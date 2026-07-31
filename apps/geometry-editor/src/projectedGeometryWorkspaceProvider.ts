// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { GeometryDocumentContents } from '../../../packages/geometry-document/src/contracts';
import {
  captureGeometryDocumentContents,
  geometryDocumentContentsEqual,
} from '../../../packages/geometry-document/src/documentContents';
import {
  GeometryWorkspaceProviderError,
  type GeometryDocumentCatalogueEntry,
  type GeometryDocumentDeleteRequest,
  type GeometryDocumentDuplicateReceipt,
  type GeometryDocumentDuplicateRequest,
  type GeometryDocumentOpenRequest,
  type GeometryDocumentPersistenceReceipt,
  type GeometryDocumentCreateRequest,
  type GeometryDocumentUpdateRequest,
  type GeometryProjectGroupCreateRequest,
  type GeometryProjectGroupDeleteRequest,
  type GeometryProjectGroupSetDocumentMembershipRequest,
  type GeometryProjectGroupUpdateRequest,
  type GeometryWorkspaceProvider,
  type GeometryWorkspaceSnapshot,
} from '../../../packages/geometry-document/src/providerContracts';
import type { GeometryWorkspaceResourcePort } from '../../../packages/geometry-editor-host/src/workspaceResourcePort';
import { projectEditorGeometryDocumentToDurable } from './geometryDocumentResourceProjection';

export type ProjectedGeometryWorkspaceProviderOptions = Readonly<{
  provider: GeometryWorkspaceProvider;
  workspaceResourcePort: GeometryWorkspaceResourcePort;
}>;

function providerError(
  message: string,
  cause: unknown,
  id?: string,
): GeometryWorkspaceProviderError {
  return new GeometryWorkspaceProviderError('operation-failed', message, {
    resource: 'document',
    ...(id === undefined ? {} : { id }),
    cause,
  });
}

function entryEqual(
  left: GeometryDocumentCatalogueEntry,
  right: GeometryDocumentCatalogueEntry,
): boolean {
  return left.id === right.id
    && left.fileName === right.fileName
    && left.modifiedAt === right.modifiedAt
    && left.storageVersion === right.storageVersion
    && left.projectGroupIds.length === right.projectGroupIds.length
    && left.projectGroupIds.every(
      (projectGroupId, index) => projectGroupId === right.projectGroupIds[index],
    );
}

function snapshotContainsEntry(
  snapshot: GeometryWorkspaceSnapshot,
  providerId: string,
  entry: GeometryDocumentCatalogueEntry,
): boolean {
  if (snapshot.providerId !== providerId) return false;
  const snapshotEntry = snapshot.documents.find((candidate) => candidate.id === entry.id);
  return snapshotEntry !== undefined && entryEqual(snapshotEntry, entry);
}

function invalidReceipt(
  operation: 'create' | 'update' | 'duplicate',
  id?: string,
): GeometryWorkspaceProviderError {
  const cause = new Error(`Underlying durable ${operation} receipt did not match its write`);
  return providerError(
    `Durable workspace ${operation} returned an invalid document receipt`,
    cause,
    id,
  );
}

function validatePersistenceReceipt(
  receipt: GeometryDocumentPersistenceReceipt,
  durableContents: GeometryDocumentContents,
  sessionRevision: number,
  providerId: string,
  operation: 'create' | 'update',
  expectedId?: string,
): void {
  let valid = false;
  try {
    valid = receipt.persistedSessionRevision === sessionRevision
      && (expectedId === undefined || receipt.entry.id === expectedId)
      && receipt.entry.fileName === durableContents.fileName
      && geometryDocumentContentsEqual(receipt.contents, durableContents)
      && snapshotContainsEntry(receipt.snapshot, providerId, receipt.entry);
  } catch {
    valid = false;
  }
  if (!valid) throw invalidReceipt(operation, expectedId ?? receipt.entry?.id);
}

function validateDuplicateReceipt(
  receipt: GeometryDocumentDuplicateReceipt,
  durableContents: GeometryDocumentContents,
  request: GeometryDocumentDuplicateRequest,
  providerId: string,
): void {
  let valid = false;
  try {
    const expectedContents = captureGeometryDocumentContents({
      ...durableContents,
      fileName: receipt.entry.fileName,
    });
    valid = receipt.entry.id !== request.sourceId
      && receipt.entry.fileName === receipt.contents.fileName
      && receipt.persistedSessionRevision === request.sessionRevision
      && geometryDocumentContentsEqual(receipt.contents, expectedContents)
      && snapshotContainsEntry(receipt.snapshot, providerId, receipt.entry);
  } catch {
    valid = false;
  }
  if (!valid) throw invalidReceipt('duplicate', request.sourceId);
}

async function projectContents(
  contents: Parameters<typeof captureGeometryDocumentContents>[0],
  workspaceResourcePort: GeometryWorkspaceResourcePort,
  operation: 'create' | 'update' | 'duplicate',
  id?: string,
): Promise<Readonly<{
  editor: GeometryDocumentContents;
  durable: GeometryDocumentContents;
}>> {
  try {
    const editor = captureGeometryDocumentContents(contents);
    const durable = await projectEditorGeometryDocumentToDurable(
      editor,
      workspaceResourcePort,
    );
    return { editor, durable };
  } catch (cause) {
    if (cause instanceof GeometryWorkspaceProviderError) throw cause;
    throw providerError(
      `Could not prepare document resources for workspace ${operation}`,
      cause,
      id,
    );
  }
}

function restoredContents(
  editor: GeometryDocumentContents,
  fileName: string,
): GeometryDocumentContents {
  return captureGeometryDocumentContents({ ...editor, fileName });
}

/**
 * Projects editor-only workspace path rows immediately before durable writes.
 * External receipts retain editor contents so coordinator equality checks keep
 * describing the exact captured session revision.
 */
export function createProjectedGeometryWorkspaceProvider(
  options: ProjectedGeometryWorkspaceProviderOptions,
): GeometryWorkspaceProvider {
  const { provider, workspaceResourcePort } = options;

  const create = async (
    request: GeometryDocumentCreateRequest,
  ): Promise<GeometryDocumentPersistenceReceipt> => {
    const projected = await projectContents(
      request.contents,
      workspaceResourcePort,
      'create',
    );
    const receipt = await provider.documents.create({
      ...request,
      contents: projected.durable,
    });
    validatePersistenceReceipt(
      receipt,
      projected.durable,
      request.sessionRevision,
      provider.id,
      'create',
    );
    return Object.freeze({
      ...receipt,
      contents: restoredContents(projected.editor, receipt.entry.fileName),
    });
  };

  const update = async (
    request: GeometryDocumentUpdateRequest,
  ): Promise<GeometryDocumentPersistenceReceipt> => {
    const projected = await projectContents(
      request.contents,
      workspaceResourcePort,
      'update',
      request.id,
    );
    const receipt = await provider.documents.update({
      ...request,
      contents: projected.durable,
    });
    validatePersistenceReceipt(
      receipt,
      projected.durable,
      request.sessionRevision,
      provider.id,
      'update',
      request.id,
    );
    return Object.freeze({
      ...receipt,
      contents: restoredContents(projected.editor, receipt.entry.fileName),
    });
  };

  const duplicate = async (
    request: GeometryDocumentDuplicateRequest,
  ): Promise<GeometryDocumentDuplicateReceipt> => {
    if (request.contents === undefined) {
      return provider.documents.duplicate(request);
    }
    const projected = await projectContents(
      request.contents,
      workspaceResourcePort,
      'duplicate',
      request.sourceId,
    );
    const receipt = await provider.documents.duplicate({
      ...request,
      contents: projected.durable,
    });
    validateDuplicateReceipt(receipt, projected.durable, request, provider.id);
    return Object.freeze({
      ...receipt,
      contents: restoredContents(projected.editor, receipt.entry.fileName),
    });
  };

  return Object.freeze({
    id: provider.id,
    capabilities: provider.capabilities,
    getSnapshot: () => provider.getSnapshot(),
    documents: Object.freeze({
      open: (request: GeometryDocumentOpenRequest) => provider.documents.open(request),
      create,
      update,
      duplicate,
      delete: (request: GeometryDocumentDeleteRequest) =>
        provider.documents.delete(request),
    }),
    projectGroups: Object.freeze({
      create: (request: GeometryProjectGroupCreateRequest) =>
        provider.projectGroups.create(request),
      update: (request: GeometryProjectGroupUpdateRequest) =>
        provider.projectGroups.update(request),
      delete: (request: GeometryProjectGroupDeleteRequest) =>
        provider.projectGroups.delete(request),
      setDocumentMembership: (
        request: GeometryProjectGroupSetDocumentMembershipRequest,
      ) =>
        provider.projectGroups.setDocumentMembership(request),
    }),
  });
}
