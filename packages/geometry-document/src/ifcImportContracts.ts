// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { PortableGeometryDocument } from './portableDocumentContracts';

export const IFC_IMPORT_LIMITS = Object.freeze({
  maximumSourceBytes: 256 * 1024 * 1024,
  maximumModelBytes: 32 * 1024 * 1024,
  maximumAuditBytes: 64 * 1024 * 1024,
});

export type IfcImportMode = 'internal' | 'external' | 'raw';

export type IfcImportProgressPhase =
  | 'runtime'
  | 'dependencies'
  | 'parser'
  | 'source-read'
  | 'conversion'
  | 'floors-roofs'
  | 'walls'
  | 'windows'
  | 'doors'
  | 'spaces'
  | 'assembly'
  | 'csv';

export type IfcImportProgress = Readonly<{
  phase: IfcImportProgressPhase;
  current?: number;
  total?: number;
}>;

export type IfcImportSource = Readonly<{
  fileName: string;
  byteLength: number;
  readBytes(): Promise<Uint8Array>;
}>;

export type IfcImportRequest = Readonly<{
  source: IfcImportSource;
  mode: IfcImportMode;
  delayeringEnabled: boolean;
  wallThicknessMetres?: number;
  signal?: AbortSignal;
  onProgress?: (progress: IfcImportProgress) => void;
}>;

export type IfcImportConverterRequest = Readonly<{
  bytes: Uint8Array;
  mode: IfcImportMode;
  delayeringEnabled: boolean;
  wallThicknessMetres?: number;
  signal?: AbortSignal;
  onProgress(progress: IfcImportProgress): void;
}>;

export type IfcImportConverterResult = Readonly<{
  modelCsv: string;
  auditJsonl: string;
}>;

export interface IfcImportConverter {
  convert(
    request: IfcImportConverterRequest,
  ): Promise<IfcImportConverterResult>;
}

export type LocalIfcImportAdapterOptions = Readonly<{
  loadConverter(): Promise<IfcImportConverter>;
}>;

export interface LocalIfcImportAdapter {
  importDocument(request: IfcImportRequest): Promise<PortableGeometryDocument>;
}

export type IfcImportErrorCode =
  | 'invalid-request'
  | 'invalid-source'
  | 'limit-exceeded'
  | 'runtime-load-failed'
  | 'read-failed'
  | 'conversion-failed'
  | 'invalid-result'
  | 'cancelled';

export type IfcImportErrorDetails = Readonly<{
  fileName?: string;
  cause?: unknown;
}>;

export class IfcImportError extends Error {
  readonly code: IfcImportErrorCode;
  readonly fileName?: string;
  readonly cause?: unknown;

  constructor(
    code: IfcImportErrorCode,
    message: string,
    details: IfcImportErrorDetails = {},
  ) {
    super(message);
    this.name = 'IfcImportError';
    this.code = code;
    this.fileName = details.fileName;
    this.cause = details.cause;
  }
}
