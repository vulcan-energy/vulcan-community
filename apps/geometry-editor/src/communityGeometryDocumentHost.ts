// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createSerializedGeometryDocumentHostPort,
  type CommunityGeometryFilesController,
  type CommunityGeometryFilesResult,
  type CommunityGeometryFilesSnapshot,
  type GeometryDocumentHostDestructiveRequest,
  type GeometryDocumentHostDriver,
  type GeometryDocumentHostDriverSnapshot,
  type GeometryDocumentHostNewRequest,
  type GeometryDocumentHostOpenRequest,
  type GeometryDocumentHostPort,
  type GeometryDocumentHostPreparedOperation,
  type GeometryDocumentHostResult,
  type GeometryDocumentHostTarget,
  type GeometryDocumentSession,
} from '../../../packages/geometry-document/src';

export type CommunityGeometryDocumentHostOptions = Readonly<{
  controller: CommunityGeometryFilesController;
  session: GeometryDocumentSession;
}>;

function targetFromActiveDocument(
  active: CommunityGeometryFilesSnapshot['activeDocument'],
): GeometryDocumentHostTarget | null {
  return active === null
    ? null
    : Object.freeze({
        id: active.id,
        fileName: active.fileName,
        storageVersion: active.storageVersion,
      });
}

function activeDocumentMatchesTarget(
  active: CommunityGeometryFilesSnapshot['activeDocument'],
  target: GeometryDocumentHostTarget | null,
): boolean {
  return active === null
    ? target === null
    : target !== null &&
        active.id === target.id &&
        active.fileName === target.fileName &&
        active.storageVersion === target.storageVersion;
}

function hostResult(
  result: CommunityGeometryFilesResult,
  controller: CommunityGeometryFilesController,
): GeometryDocumentHostResult {
  if (result.status !== 'completed') return result;
  const snapshot = controller.getSnapshot();
  return Object.freeze({
    status: 'completed',
    activeDocument: targetFromActiveDocument(snapshot.activeDocument),
  });
}

function prepared(
  run: () => Promise<GeometryDocumentHostResult>,
): GeometryDocumentHostPreparedOperation {
  return Object.freeze({ run });
}

/**
 * Adapts the Community controller's one document session to the shared editor
 * lifecycle port. The port owns the controller after successful construction.
 */
export function createCommunityGeometryDocumentHost(
  options: CommunityGeometryDocumentHostOptions,
): GeometryDocumentHostPort {
  const { controller, session } = options;
  let sourceSnapshot = controller.getSnapshot();
  if (sourceSnapshot.document !== session.getSnapshot()) {
    throw new TypeError(
      'Community document host controller and session must share one document lifecycle',
    );
  }
  let driverSnapshot: GeometryDocumentHostDriverSnapshot = Object.freeze({
    document: sourceSnapshot.document,
    activeDocument: targetFromActiveDocument(sourceSnapshot.activeDocument),
  });

  const getSnapshot = (): GeometryDocumentHostDriverSnapshot => {
    const nextSourceSnapshot = controller.getSnapshot();
    if (nextSourceSnapshot === sourceSnapshot) return driverSnapshot;
    sourceSnapshot = nextSourceSnapshot;
    if (
      nextSourceSnapshot.document === driverSnapshot.document &&
      activeDocumentMatchesTarget(
        nextSourceSnapshot.activeDocument,
        driverSnapshot.activeDocument,
      )
    ) {
      return driverSnapshot;
    }
    driverSnapshot = Object.freeze({
      document: nextSourceSnapshot.document,
      activeDocument: targetFromActiveDocument(nextSourceSnapshot.activeDocument),
    });
    return driverSnapshot;
  };

  const complete = async (
    operation: Promise<CommunityGeometryFilesResult>,
  ): Promise<GeometryDocumentHostResult> =>
    hostResult(await operation, controller);

  const driver: GeometryDocumentHostDriver = Object.freeze({
    getSnapshot,
    subscribe: (listener: () => void) => controller.subscribe(listener),
    updateFileName: (fileName: string) => session.updateDocument({ fileName }),
    isDirty: () => session.getSnapshot().isDirty,
    prepareSave: () => prepared(() => complete(controller.save())),
    prepareNew: (request: GeometryDocumentHostNewRequest) => prepared(() =>
      complete(request.contents === undefined
        ? controller.newDocument(
            request.dirtyDecision === undefined
              ? {}
              : { dirtyDecision: request.dirtyDecision },
          )
        : controller.importDocument({
            contents: request.contents,
            ...(request.dirtyDecision === undefined
              ? {}
              : { dirtyDecision: request.dirtyDecision }),
          }))),
    prepareOpen: (request: GeometryDocumentHostOpenRequest) => prepared(() =>
      complete(controller.openDocument({
        document: {
          id: request.target.id,
          storageVersion: request.target.storageVersion,
        },
        ...(request.dirtyDecision === undefined
          ? {}
          : { dirtyDecision: request.dirtyDecision }),
      }))),
    prepareDelete: (
      request: GeometryDocumentHostDestructiveRequest,
    ) => prepared(() => complete(controller.deleteDocument({
      document: {
        id: request.target.id,
        storageVersion: request.target.storageVersion,
      },
      confirmed: request.confirmed ?? false,
      ...(request.dirtyDecision === undefined
        ? {}
        : { dirtyDecision: request.dirtyDecision }),
    }))),
    prepareDuplicate: (
      request: GeometryDocumentHostDestructiveRequest,
    ) => prepared(() => complete(controller.duplicateDocument({
      document: {
        id: request.target.id,
        storageVersion: request.target.storageVersion,
      },
      confirmed: request.confirmed ?? false,
      ...(request.dirtyDecision === undefined
        ? {}
        : { dirtyDecision: request.dirtyDecision }),
    }))),
    dispose: () => controller.dispose(),
  });

  return createSerializedGeometryDocumentHostPort({ driver });
}
