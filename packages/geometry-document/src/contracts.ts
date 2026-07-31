// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type GeometryDocumentModel = Readonly<{
  fileName: string;
  text: string;
}>;

export type GeometryDocumentKnownDerivedResourceRole =
  | 'defaults'
  | 'junction-psi-defaults'
  | 'guide-overlay-state'
  | 'guide-overlay-image'
  | 'ifc-import-audit';

export type GeometryDocumentSourceFileRole =
  | 'ifc'
  | 'guide-overlay-source';

export type GeometryDocumentDerivedResource = Readonly<{
  id: string;
  slots: readonly string[];
  role: GeometryDocumentKnownDerivedResourceRole | (string & {});
  required: boolean;
  mediaType: string;
  /** Each read returns bytes owned by the caller. */
  bytes: Uint8Array;
}>;

export type GeometryDocumentSourceFile = Readonly<{
  id: string;
  slots: readonly string[];
  role: GeometryDocumentSourceFileRole;
  fileName: string;
  mediaType: string;
  /** Each read returns bytes owned by the caller. */
  bytes: Uint8Array;
}>;

export type GeometryDocumentContents = GeometryDocumentModel & Readonly<{
  derivedResources: readonly GeometryDocumentDerivedResource[];
  sourceFiles: readonly GeometryDocumentSourceFile[];
}>;

export type GeometryDocumentInput = GeometryDocumentModel & Readonly<{
  derivedResources?: readonly GeometryDocumentDerivedResource[];
  sourceFiles?: readonly GeometryDocumentSourceFile[];
}>;

export type GeometryDocumentReplacement = GeometryDocumentInput & Readonly<{
  persisted: boolean;
}>;

export type GeometryDocumentPatch = Readonly<{
  fileName?: string;
  text?: string;
  derivedResources?: readonly GeometryDocumentDerivedResource[];
  sourceFiles?: readonly GeometryDocumentSourceFile[];
}>;

export type GeometryDocumentSnapshot = GeometryDocumentContents & Readonly<{
  revision: number;
  persistedRevision: number | null;
  isDirty: boolean;
}>;

export type GeometryDocumentSubscriber = (
  snapshot: GeometryDocumentSnapshot,
) => void;

export interface GeometryDocumentSession {
  getSnapshot(): GeometryDocumentSnapshot;
  replaceDocument(
    replacement: GeometryDocumentReplacement,
  ): GeometryDocumentSnapshot;
  updateDocument(patch: GeometryDocumentPatch): GeometryDocumentSnapshot;
  acknowledgePersisted(candidate: GeometryDocumentSnapshot): GeometryDocumentSnapshot;
  subscribe(subscriber: GeometryDocumentSubscriber): () => void;
}
