// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  encodePortableGeometryDocument,
  PORTABLE_GEOMETRY_DOCUMENT_LIMITS,
  PortableGeometryDocumentError,
  readPortableGeometryDocumentUpload,
} from '../index';

function archiveFile(
  name: string,
  archive: Uint8Array,
  options: Readonly<{
    declaredSize?: number;
    beforeRead?: () => void;
    error?: Error;
  }> = {},
): File {
  const bytes = archive.slice();
  return {
    name,
    type: 'application/octet-stream',
    size: options.declaredSize ?? bytes.byteLength,
    arrayBuffer: vi.fn(async () => {
      options.beforeRead?.();
      if (options.error) throw options.error;
      return bytes.slice().buffer;
    }),
  } as unknown as File;
}

describe('browser portable document files', () => {
  it('snapshots one case-insensitive .vulcan upload and decodes its exact contents', async () => {
    const expected = Object.freeze({
      model: Object.freeze({ fileName: 'House.csv', text: 'id,value\n1,exact\n' }),
      derivedResources: Object.freeze([]),
      sourceFiles: Object.freeze([]),
    });
    const archive = await encodePortableGeometryDocument(expected);
    const liveFiles: { length: number; 0: File } = {
      length: 1,
      0: undefined as unknown as File,
    };
    const original = archiveFile('House.VULCAN', archive, {
      beforeRead: () => {
        liveFiles[0] = archiveFile('replacement.vulcan', new Uint8Array());
      },
    });
    liveFiles[0] = original;

    await expect(readPortableGeometryDocumentUpload(liveFiles)).resolves.toEqual(expected);
    expect(original.arrayBuffer).toHaveBeenCalledOnce();
  });

  it.each([
    { files: [] as File[], code: 'invalid-input' },
    {
      files: [
        archiveFile('one.vulcan', new Uint8Array()),
        archiveFile('two.vulcan', new Uint8Array()),
      ],
      code: 'invalid-input',
    },
    {
      files: [archiveFile('model.zip', new Uint8Array())],
      code: 'invalid-input',
    },
  ] as const)('fails closed for an invalid upload selection', async ({ files, code }) => {
    const promise = readPortableGeometryDocumentUpload(files);
    await expect(promise).rejects.toBeInstanceOf(PortableGeometryDocumentError);
    await expect(promise).rejects.toMatchObject({ code });
  });

  it('rejects an over-limit declared size before reading any bytes', async () => {
    const file = archiveFile('too-large.vulcan', new Uint8Array(), {
      declaredSize: PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumArchiveBytes + 1,
    });

    await expect(readPortableGeometryDocumentUpload([file])).rejects.toMatchObject({
      code: 'limit-exceeded',
    });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects changing file size and wraps reader failures without hiding codec errors', async () => {
    const changed = archiveFile('changed.vulcan', new Uint8Array([1, 2]), {
      declaredSize: 1,
    });
    await expect(readPortableGeometryDocumentUpload([changed])).rejects.toMatchObject({
      code: 'read-failed',
    });

    const broken = archiveFile('broken.vulcan', new Uint8Array(), {
      error: new Error('reader failed'),
    });
    await expect(readPortableGeometryDocumentUpload([broken])).rejects.toMatchObject({
      code: 'read-failed',
    });

    const malformed = archiveFile('malformed.vulcan', new Uint8Array([1, 2, 3]));
    await expect(readPortableGeometryDocumentUpload([malformed])).rejects.toMatchObject({
      code: 'invalid-archive',
    });
  });

  it('wraps hostile and detached reader results as typed read failures', async () => {
    const hostileBytes = Object.defineProperty({}, Symbol.toStringTag, {
      get: () => {
        throw new Error('hostile tag');
      },
    });
    const hostile = {
      name: 'hostile.vulcan',
      type: 'application/octet-stream',
      size: 0,
      arrayBuffer: vi.fn(async () => hostileBytes),
    } as unknown as File;

    await expect(readPortableGeometryDocumentUpload([hostile])).rejects.toMatchObject({
      code: 'read-failed',
    });

    const detachedBuffer = new ArrayBuffer(0);
    structuredClone(detachedBuffer, { transfer: [detachedBuffer] });
    const detached = {
      name: 'detached.vulcan',
      type: 'application/octet-stream',
      size: 0,
      arrayBuffer: vi.fn(async () => detachedBuffer),
    } as unknown as File;

    await expect(readPortableGeometryDocumentUpload([detached])).rejects.toMatchObject({
      code: 'read-failed',
    });
  });
});
