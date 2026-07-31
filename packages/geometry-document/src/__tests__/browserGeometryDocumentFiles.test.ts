// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  createGeometryDocumentDownload,
  GEOMETRY_CSV_MIME_TYPE,
  GeometryDocumentFileError,
  readGeometryDocumentDrop,
  readGeometryDocumentUpload,
} from '../index';

function createTextFile(
  name: string,
  text: string,
  options: Readonly<{
    type?: string;
    beforeRead?: () => void;
    error?: Error;
  }> = {},
): File {
  return {
    name,
    type: options.type ?? '',
    text: vi.fn(async () => {
      options.beforeRead?.();
      if (options.error) throw options.error;
      return text;
    }),
  } as unknown as File;
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(blob);
  });
}

describe('browser geometry document files', () => {
  it('snapshots one uploaded CSV before awaiting and preserves exact name and text', async () => {
    const csvText = 'id,value\r\n001," exact value "\r\n';
    const liveFiles: { length: number; 0: File } = {
      length: 1,
      0: undefined as unknown as File,
    };
    const original = createTextFile('Exact Name.CSV', csvText, {
      type: 'application/octet-stream',
      beforeRead: () => {
        liveFiles[0] = createTextFile('replacement.csv', 'replacement');
      },
    });
    liveFiles[0] = original;

    const document = await readGeometryDocumentUpload(liveFiles);

    expect(document).toEqual({ fileName: 'Exact Name.CSV', text: csvText });
    expect(Object.isFrozen(document)).toBe(true);
  });

  it('routes dropped files through the same exact reader', async () => {
    const file = createTextFile('drop.csv', 'drop,text\n');

    await expect(readGeometryDocumentDrop({
      files: [file] as unknown as FileList,
    })).resolves.toEqual({
      fileName: 'drop.csv',
      text: 'drop,text\n',
    });
  });

  it.each([
    { files: [] as File[], code: 'no-file' },
    {
      files: [createTextFile('a.csv', 'a'), createTextFile('b.csv', 'b')],
      code: 'multiple-files',
    },
    {
      files: [createTextFile('model.json', '{}', { type: 'text/csv' })],
      code: 'not-csv',
    },
  ] as const)('reports the typed $code selection error', async ({ files, code }) => {
    const promise = readGeometryDocumentUpload(files);

    await expect(promise).rejects.toBeInstanceOf(GeometryDocumentFileError);
    await expect(promise).rejects.toMatchObject({ code });
  });

  it('wraps file read failures in a typed read-failed error', async () => {
    const file = createTextFile('broken.csv', '', {
      error: new Error('reader failed'),
    });

    await expect(readGeometryDocumentUpload([file])).rejects.toMatchObject({
      name: 'GeometryDocumentFileError',
      code: 'read-failed',
    });
  });

  it('creates an exact frozen CSV Blob description and normalizes only a missing extension', async () => {
    const text = 'id,value\n1,"unchanged"\n';
    const appended = createGeometryDocumentDownload({ fileName: 'model', text });
    const preserved = createGeometryDocumentDownload({ fileName: 'MODEL.CSV', text });

    expect(Object.isFrozen(appended)).toBe(true);
    expect(appended.suggestedFileName).toBe('model.csv');
    expect(preserved.suggestedFileName).toBe('MODEL.CSV');
    expect(appended.blob.type).toBe(GEOMETRY_CSV_MIME_TYPE);
    await expect(readBlobText(appended.blob)).resolves.toBe(text);
  });
});
