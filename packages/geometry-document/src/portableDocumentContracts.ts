// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometryDocumentDerivedResource,
  GeometryDocumentKnownDerivedResourceRole,
  GeometryDocumentModel,
  GeometryDocumentSourceFile,
  GeometryDocumentSourceFileRole,
} from './contracts';

export const PORTABLE_GEOMETRY_DOCUMENT_FORMAT =
  'vulcan-portable-document' as const;
export const PORTABLE_GEOMETRY_DOCUMENT_VERSION = 1 as const;
export const PORTABLE_GEOMETRY_DOCUMENT_EXTENSION = '.vulcan' as const;
export const PORTABLE_GEOMETRY_DOCUMENT_MIME_TYPE =
  'application/vnd.vulcan.document+zip' as const;

export const PORTABLE_GEOMETRY_DOCUMENT_LIMITS = Object.freeze({
  maximumArchiveBytes: 256 * 1024 * 1024,
  maximumManifestBytes: 1024 * 1024,
  maximumModelBytes: 32 * 1024 * 1024,
  maximumEntryBytes: 256 * 1024 * 1024,
  maximumTotalUncompressedBytes: 512 * 1024 * 1024,
  maximumEntries: 256,
  maximumSlotsPerResource: 64,
});

export type PortableGeometryDocumentKnownDerivedRole =
  GeometryDocumentKnownDerivedResourceRole;

export type PortableGeometryDocumentSourceRole = GeometryDocumentSourceFileRole;

export type PortableGeometryDocumentDerivedResource =
  GeometryDocumentDerivedResource;

export type PortableGeometryDocumentSourceFile = GeometryDocumentSourceFile;

export type PortableGeometryDocument = Readonly<{
  model: GeometryDocumentModel;
  derivedResources: readonly PortableGeometryDocumentDerivedResource[];
  sourceFiles: readonly PortableGeometryDocumentSourceFile[];
}>;

export type PortableGeometryDocumentEncodeOptions = Readonly<{
  includeSourceFileIds?: readonly string[];
}>;

export type PortableGeometryDocumentDownload = Readonly<{
  blob: Blob;
  suggestedFileName: string;
  includedSourceFileIds: readonly string[];
}>;

export type PortableGeometryDocumentErrorCode =
  | 'invalid-input'
  | 'invalid-archive'
  | 'invalid-manifest'
  | 'unsupported-version'
  | 'unsupported-feature'
  | 'unsafe-entry-path'
  | 'unsafe-model-reference'
  | 'duplicate-entry'
  | 'unexpected-entry'
  | 'missing-entry'
  | 'limit-exceeded'
  | 'integrity-failed'
  | 'invalid-source-selection'
  | 'read-failed';

export type PortableGeometryDocumentErrorDetails = Readonly<{
  entryPath?: string;
  resourceId?: string;
  cause?: unknown;
}>;

export class PortableGeometryDocumentError extends Error {
  readonly code: PortableGeometryDocumentErrorCode;
  readonly entryPath?: string;
  readonly resourceId?: string;
  readonly cause?: unknown;

  constructor(
    code: PortableGeometryDocumentErrorCode,
    message: string,
    details: PortableGeometryDocumentErrorDetails = {},
  ) {
    super(message);
    this.name = 'PortableGeometryDocumentError';
    this.code = code;
    this.entryPath = details.entryPath;
    this.resourceId = details.resourceId;
    this.cause = details.cause;
  }
}
