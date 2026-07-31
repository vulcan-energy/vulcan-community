// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { GeometryDocumentModel } from './contracts';

export const GEOMETRY_CSV_MIME_TYPE = 'text/csv;charset=utf-8';

export type GeometryDocumentFileErrorCode =
  | 'no-file'
  | 'multiple-files'
  | 'not-csv'
  | 'read-failed';

export class GeometryDocumentFileError extends Error {
  readonly code: GeometryDocumentFileErrorCode;
  readonly cause?: unknown;

  constructor(
    code: GeometryDocumentFileErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'GeometryDocumentFileError';
    this.code = code;
    this.cause = cause;
  }
}

export type GeometryDocumentDownload = Readonly<{
  blob: Blob;
  suggestedFileName: string;
}>;

function selectSingleCsvFile(files: ArrayLike<File>): File {
  const snapshot = Array.from(files);
  if (snapshot.length === 0) {
    throw new GeometryDocumentFileError('no-file', 'Select one CSV geometry document');
  }
  if (snapshot.length !== 1) {
    throw new GeometryDocumentFileError(
      'multiple-files',
      'Select only one CSV geometry document',
    );
  }

  const file = snapshot[0];
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new GeometryDocumentFileError(
      'not-csv',
      `Geometry documents must use the .csv extension: ${file.name}`,
    );
  }
  return file;
}

export async function readGeometryDocumentUpload(
  files: ArrayLike<File>,
): Promise<GeometryDocumentModel> {
  const file = selectSingleCsvFile(files);
  try {
    const text = await file.text();
    return Object.freeze({ fileName: file.name, text });
  } catch (error) {
    throw new GeometryDocumentFileError(
      'read-failed',
      `Could not read geometry document: ${file.name}`,
      error,
    );
  }
}

export function readGeometryDocumentDrop(
  transfer: Pick<DataTransfer, 'files'>,
): Promise<GeometryDocumentModel> {
  return readGeometryDocumentUpload(transfer.files);
}

export function createGeometryDocumentDownload(
  document: GeometryDocumentModel,
): GeometryDocumentDownload {
  const suggestedFileName = /\.csv$/i.test(document.fileName)
    ? document.fileName
    : `${document.fileName}.csv`;

  return Object.freeze({
    blob: new Blob([document.text], { type: GEOMETRY_CSV_MIME_TYPE }),
    suggestedFileName,
  });
}
