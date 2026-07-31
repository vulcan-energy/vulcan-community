// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  decodePortableGeometryDocument,
  encodePortableGeometryDocumentWithMetadata,
} from './portableDocumentCodec';
import {
  PORTABLE_GEOMETRY_DOCUMENT_EXTENSION,
  PORTABLE_GEOMETRY_DOCUMENT_LIMITS,
  PORTABLE_GEOMETRY_DOCUMENT_MIME_TYPE,
  PortableGeometryDocumentError,
  type PortableGeometryDocument,
  type PortableGeometryDocumentDownload,
  type PortableGeometryDocumentEncodeOptions,
} from './portableDocumentContracts';
import { normalizeGeometryDocumentName } from './documentNaming';

type CapturedPortableUpload = Readonly<{
  target: object;
  fileName: string;
  declaredSize: number;
  arrayBuffer: (this: object) => Promise<unknown>;
}>;

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function capturePortableUpload(files: ArrayLike<File>): CapturedPortableUpload {
  let snapshot: unknown[];
  try {
    snapshot = Array.from(files as ArrayLike<unknown>);
  } catch (cause) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      'Portable document selection could not be inspected',
      { cause },
    );
  }
  if (snapshot.length !== 1) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      'Select exactly one portable document',
    );
  }
  const candidate = snapshot[0];
  if (!isRecord(candidate)) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      'The selected portable document is not a file',
    );
  }

  let rawName: unknown;
  let rawSize: unknown;
  let arrayBuffer: unknown;
  try {
    rawName = candidate.name;
    rawSize = candidate.size;
    arrayBuffer = candidate.arrayBuffer;
  } catch (cause) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      'The selected portable document could not be inspected',
      { cause },
    );
  }

  let fileName: string;
  try {
    fileName = normalizeGeometryDocumentName(rawName as string);
  } catch (cause) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      'The selected portable document has an unsafe file name',
      { cause },
    );
  }
  if (!fileName.toLowerCase().endsWith(PORTABLE_GEOMETRY_DOCUMENT_EXTENSION)) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      `Portable documents must use the ${PORTABLE_GEOMETRY_DOCUMENT_EXTENSION} extension`,
    );
  }
  if (
    !Number.isSafeInteger(rawSize) ||
    (rawSize as number) < 0 ||
    typeof arrayBuffer !== 'function'
  ) {
    throw new PortableGeometryDocumentError(
      'invalid-input',
      `The selected portable document has invalid file metadata: ${fileName}`,
    );
  }
  if ((rawSize as number) > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumArchiveBytes) {
    throw new PortableGeometryDocumentError(
      'limit-exceeded',
      'Portable ZIP archive exceeds the limit',
    );
  }

  return Object.freeze({
    target: candidate,
    fileName,
    declaredSize: rawSize as number,
    arrayBuffer: arrayBuffer as CapturedPortableUpload['arrayBuffer'],
  });
}

/** Universal upload path; unlike the optional FSA adapter it retains no file handle. */
export async function readPortableGeometryDocumentUpload(
  files: ArrayLike<File>,
): Promise<PortableGeometryDocument> {
  const file = capturePortableUpload(files);
  let rawBuffer: unknown;
  try {
    rawBuffer = await file.arrayBuffer.call(file.target);
  } catch (cause) {
    throw new PortableGeometryDocumentError(
      'read-failed',
      `Could not read portable document: ${file.fileName}`,
      { cause },
    );
  }
  let archive: Uint8Array;
  try {
    if (Object.prototype.toString.call(rawBuffer) !== '[object ArrayBuffer]') {
      throw new PortableGeometryDocumentError(
        'read-failed',
        `Could not read portable document bytes: ${file.fileName}`,
      );
    }
    const buffer = rawBuffer as ArrayBuffer;
    if (buffer.byteLength !== file.declaredSize) {
      throw new PortableGeometryDocumentError(
        'read-failed',
        `Portable document size changed while reading: ${file.fileName}`,
      );
    }
    if (buffer.byteLength > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumArchiveBytes) {
      throw new PortableGeometryDocumentError(
        'limit-exceeded',
        'Portable ZIP archive exceeds the limit',
      );
    }
    archive = Uint8Array.from(new Uint8Array(buffer));
  } catch (cause) {
    if (cause instanceof PortableGeometryDocumentError) throw cause;
    throw new PortableGeometryDocumentError(
      'read-failed',
      `Could not inspect portable document bytes: ${file.fileName}`,
      { cause },
    );
  }
  return decodePortableGeometryDocument(archive);
}

export async function createPortableGeometryDocumentDownload(
  document: PortableGeometryDocument,
  options?: PortableGeometryDocumentEncodeOptions,
): Promise<PortableGeometryDocumentDownload> {
  try {
    const encoded = await encodePortableGeometryDocumentWithMetadata(
      document,
      options,
    );
    const stem = encoded.modelFileName.toLowerCase().endsWith('.csv')
      ? encoded.modelFileName.slice(0, -4)
      : encoded.modelFileName;
    return Object.freeze({
      blob: new Blob([encoded.archive], {
        type: PORTABLE_GEOMETRY_DOCUMENT_MIME_TYPE,
      }),
      suggestedFileName: `${stem}${PORTABLE_GEOMETRY_DOCUMENT_EXTENSION}`,
      includedSourceFileIds: encoded.includedSourceFileIds,
    });
  } catch (error) {
    if (error instanceof PortableGeometryDocumentError) throw error;
    throw new PortableGeometryDocumentError(
      'read-failed',
      'Could not create the portable document download',
      { cause: error },
    );
  }
}
