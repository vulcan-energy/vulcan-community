// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  createPortableGeometryDocumentDownload,
  decodePortableGeometryDocument,
  encodePortableGeometryDocument,
  PORTABLE_GEOMETRY_DOCUMENT_EXTENSION,
  PORTABLE_GEOMETRY_DOCUMENT_FORMAT,
  PORTABLE_GEOMETRY_DOCUMENT_LIMITS,
  PORTABLE_GEOMETRY_DOCUMENT_MIME_TYPE,
  type PortableGeometryDocument,
} from '../index';

const textBytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const FflateUint8Array = strToU8('', true)
  .constructor as unknown as Uint8ArrayConstructor;

const richDocument = (): PortableGeometryDocument => ({
  model: {
    fileName: 'House.csv',
    text: 'Version,v1\nBuildingElement,wall-1\n',
  },
  derivedResources: [
    {
      id: 'model-defaults',
      slots: ['model.defaults'],
      role: 'defaults',
      required: true,
      mediaType: 'application/json',
      bytes: textBytes('{"schema":"FHS"}'),
    },
    {
      id: 'overlay-ground',
      slots: ['guide-overlay.image.floor-0', 'guide-overlay.image.shared'],
      role: 'guide-overlay-image',
      required: true,
      mediaType: 'image/png',
      bytes: new Uint8Array([137, 80, 78, 71]),
    },
    {
      id: 'ifc-audit',
      slots: ['ifc.audit'],
      role: 'ifc-import-audit',
      required: false,
      mediaType: 'application/x-ndjson',
      bytes: textBytes('{"event":"converted"}\n'),
    },
  ],
  sourceFiles: [
    {
      id: 'original-ifc',
      slots: ['ifc.source'],
      role: 'ifc',
      fileName: 'House.ifc',
      mediaType: 'model/ifc',
      bytes: textBytes('UNIQUE_IFC_SOURCE_MARKER'),
    },
    {
      id: 'original-plan-pdf',
      slots: ['guide-overlay.source.floor-0'],
      role: 'guide-overlay-source',
      fileName: 'House plan.pdf',
      mediaType: 'application/pdf',
      bytes: textBytes('UNIQUE_PLAN_SOURCE_MARKER'),
    },
  ],
});

const encodeRich = (includeSourceFileIds: readonly string[] = []) =>
  encodePortableGeometryDocument(richDocument(), { includeSourceFileIds });

const fixedZip = (files: Record<string, Uint8Array>): Uint8Array => {
  const compatible = Object.fromEntries(
    Object.entries(files).map(([path, bytes]) => {
      const copy = new FflateUint8Array(bytes.byteLength);
      copy.set(bytes);
      return [path, copy];
    }),
  );
  return zipSync(compatible, {
    level: 0,
    mtime: new Date(1980, 0, 1, 0, 0, 0),
    os: 0,
  });
};

const deflatedZip = (files: Record<string, Uint8Array>): Uint8Array => {
  const compatible = Object.fromEntries(
    Object.entries(files).map(([path, bytes]) => {
      const copy = new FflateUint8Array(bytes.byteLength);
      copy.set(bytes);
      return [path, copy];
    }),
  );
  return zipSync(compatible, {
    level: 9,
    mtime: new Date(1980, 0, 1, 0, 0, 0),
    os: 0,
  });
};

const patchCentralUncompressedSize = (
  archive: Uint8Array,
  entryPath: string,
  byteLength: number,
): Uint8Array => {
  const copy = archive.slice();
  const signature = [0x50, 0x4b, 0x01, 0x02];
  for (let offset = 0; offset <= copy.byteLength - 46; offset += 1) {
    if (!signature.every((byte, index) => copy[offset + index] === byte)) {
      continue;
    }
    const readU16 = (at: number) => copy[at]! | (copy[at + 1]! << 8);
    const nameLength = readU16(offset + 28);
    const extraLength = readU16(offset + 30);
    const commentLength = readU16(offset + 32);
    const name = strFromU8(copy.subarray(offset + 46, offset + 46 + nameLength));
    if (name === entryPath) {
      for (let index = 0; index < 4; index += 1) {
        copy[offset + 24 + index] = (byteLength >>> (index * 8)) & 0xff;
      }
      return copy;
    }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Missing central directory entry ${entryPath}`);
};

const patchCentralStoreSizes = (
  archive: Uint8Array,
  entryPath: string,
  byteLength: number,
): Uint8Array => {
  const copy = archive.slice();
  const signature = [0x50, 0x4b, 0x01, 0x02];
  for (let offset = 0; offset <= copy.byteLength - 46; offset += 1) {
    if (!signature.every((byte, index) => copy[offset + index] === byte)) {
      continue;
    }
    const readU16 = (at: number) => copy[at]! | (copy[at + 1]! << 8);
    const nameLength = readU16(offset + 28);
    const extraLength = readU16(offset + 30);
    const commentLength = readU16(offset + 32);
    const name = strFromU8(copy.subarray(offset + 46, offset + 46 + nameLength));
    if (name === entryPath) {
      for (const sizeOffset of [20, 24]) {
        for (let index = 0; index < 4; index += 1) {
          copy[offset + sizeOffset + index] =
            (byteLength >>> (index * 8)) & 0xff;
        }
      }
      return copy;
    }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Missing central directory entry ${entryPath}`);
};

const patchLocalEntryName = (
  archive: Uint8Array,
  entryPath: string,
): Uint8Array => {
  const copy = archive.slice();
  const signature = [0x50, 0x4b, 0x03, 0x04];
  for (let offset = 0; offset <= copy.byteLength - 30; offset += 1) {
    if (!signature.every((byte, index) => copy[offset + index] === byte)) {
      continue;
    }
    const readU16 = (at: number) => copy[at]! | (copy[at + 1]! << 8);
    const nameLength = readU16(offset + 26);
    const nameOffset = offset + 30;
    const name = strFromU8(copy.subarray(nameOffset, nameOffset + nameLength));
    if (name === entryPath) {
      copy[nameOffset] = copy[nameOffset] === 0x78 ? 0x79 : 0x78;
      return copy;
    }
  }
  throw new Error(`Missing local ZIP entry ${entryPath}`);
};

const mutateManifest = (
  archive: Uint8Array,
  mutate: (manifest: Record<string, unknown>) => void,
): Uint8Array => {
  const files = unzipSync(archive);
  const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as Record<
    string,
    unknown
  >;
  mutate(manifest);
  files['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  return fixedZip(files);
};

const readBlobBytes = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    });
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsArrayBuffer(blob);
  });

describe('portable geometry document bundle v1', () => {
  it('round-trips a CSV-only document through the versioned format', async () => {
    const exactText = '\ufeffid,value\n1,Cafe\u0301\n';
    const encoded = await encodePortableGeometryDocument({
      model: { fileName: 'House.csv', text: exactText },
      derivedResources: [],
      sourceFiles: [],
    }, {});
    const decoded = await decodePortableGeometryDocument(encoded);

    expect(PORTABLE_GEOMETRY_DOCUMENT_FORMAT).toBe('vulcan-portable-document');
    expect(PORTABLE_GEOMETRY_DOCUMENT_EXTENSION).toBe('.vulcan');
    expect(PORTABLE_GEOMETRY_DOCUMENT_MIME_TYPE).toBe(
      'application/vnd.vulcan.document+zip',
    );
    expect(decoded).toMatchObject({
      model: { fileName: 'House.csv', text: exactText },
      derivedResources: [],
      sourceFiles: [],
    });
  });

  it('writes the exact allowlisted ZIP layout and canonical manifest', async () => {
    const encoded = await encodeRich(['original-ifc']);
    const files = unzipSync(encoded);

    expect(Object.keys(files)).toEqual([
      'manifest.json',
      'model/model.csv',
      'derived/ifc-audit',
      'derived/model-defaults',
      'derived/overlay-ground',
      'sources/original-ifc',
    ]);
    const manifestText = strFromU8(files['manifest.json']!);
    const manifest = JSON.parse(manifestText) as {
      format: string;
      formatVersion: number;
      derivedResources: Array<{ id: string; slots: string[] }>;
      sourceFiles: Array<{ id: string; fileName: string }>;
    };
    expect(manifestText.endsWith('\n')).toBe(true);
    expect(manifest).toMatchObject({
      format: PORTABLE_GEOMETRY_DOCUMENT_FORMAT,
      formatVersion: 1,
      derivedResources: [
        { id: 'ifc-audit', slots: ['ifc.audit'] },
        { id: 'model-defaults', slots: ['model.defaults'] },
        {
          id: 'overlay-ground',
          slots: [
            'guide-overlay.image.floor-0',
            'guide-overlay.image.shared',
          ],
        },
      ],
      sourceFiles: [{ id: 'original-ifc', fileName: 'House.ifc' }],
    });
  });

  it('is byte-deterministic across repeated and permuted inputs/selections', async () => {
    const first = richDocument();
    const second: PortableGeometryDocument = {
      model: first.model,
      derivedResources: [...first.derivedResources].reverse(),
      sourceFiles: [...first.sourceFiles].reverse(),
    };
    const expected = await encodePortableGeometryDocument(first, {
      includeSourceFileIds: ['original-plan-pdf', 'original-ifc'],
    });

    expect(
      await encodePortableGeometryDocument(second, {
        includeSourceFileIds: ['original-ifc', 'original-plan-pdf'],
      }),
    ).toEqual(expected);
    expect(
      await encodePortableGeometryDocument(first, {
        includeSourceFileIds: ['original-plan-pdf', 'original-ifc'],
      }),
    ).toEqual(expected);
  });

  it('does not inspect or include source files by default', async () => {
    let sourceReads = 0;
    const input = richDocument();
    Object.defineProperty(input, 'sourceFiles', {
      enumerable: true,
      get: () => {
        sourceReads += 1;
        throw new Error('sources are private without explicit selection');
      },
    });

    const encoded = await encodePortableGeometryDocument(input);
    const archiveText = strFromU8(encoded, true);

    expect(sourceReads).toBe(0);
    expect(Object.keys(unzipSync(encoded))).not.toContain('sources/original-ifc');
    expect(archiveText).not.toContain('House.ifc');
    expect(archiveText).not.toContain('UNIQUE_IFC_SOURCE_MARKER');
    await expect(decodePortableGeometryDocument(encoded)).resolves.toMatchObject({
      sourceFiles: [],
    });
  });

  it('includes only explicitly selected source IDs and never reads excluded bytes', async () => {
    const input = richDocument();
    const excluded = input.sourceFiles[1]!;
    Object.defineProperty(excluded, 'bytes', {
      enumerable: true,
      get: () => {
        throw new Error('excluded source bytes must not be read');
      },
    });

    const encoded = await encodePortableGeometryDocument(input, {
      includeSourceFileIds: ['original-ifc'],
    });
    const decoded = await decodePortableGeometryDocument(encoded);

    expect(decoded.sourceFiles).toHaveLength(1);
    expect(decoded.sourceFiles[0]).toMatchObject({
      id: 'original-ifc',
      role: 'ifc',
      fileName: 'House.ifc',
      mediaType: 'model/ifc',
    });
    expect(new TextDecoder().decode(decoded.sourceFiles[0]!.bytes)).toBe(
      'UNIQUE_IFC_SOURCE_MARKER',
    );
    expect(strFromU8(encoded, true)).not.toContain('UNIQUE_PLAN_SOURCE_MARKER');
  });

  it('fails closed on unknown or duplicate source selections', async () => {
    await expect(
      encodeRich(['missing-source']),
    ).rejects.toMatchObject({ code: 'invalid-source-selection' });
    await expect(
      encodeRich(['original-ifc', 'original-ifc']),
    ).rejects.toMatchObject({ code: 'invalid-source-selection' });
  });

  it.each([
    'DefaultsPath,input/defaults/fhs.json',
    'GuideOverlay,0,v1|input/overlays/plan.png|0.5|0|0',
    'GuideOverlaySource,0,v1|pdf|input/source.pdf|source.pdf|1|input/plan.png',
    'JunctionPsiDefaultsPath,input/psi/defaults.csv',
  ])('rejects legacy workspace/source path row %s', async (row) => {
    await expect(
      encodePortableGeometryDocument({
        model: { fileName: 'House.csv', text: `${row}\n` },
        derivedResources: [],
        sourceFiles: [],
      }),
    ).rejects.toMatchObject({ code: 'unsafe-model-reference' });
  });

  it('accepts tabular geometry values that happen to match a path metadata key', async () => {
    const text = [
      'Metadata,,,,',
      'GlobalOrientationOffset,0,,,',
      'Zone,,,,',
      'Name,Floor Area,Volume,Floor Index,Floor-to-ceiling Height',
      'DefaultsPath,10,25,0,2.5',
    ].join('\r\n') + '\r\n';

    const decoded = await decodePortableGeometryDocument(
      await encodePortableGeometryDocument({
        model: { fileName: 'House.csv', text },
        derivedResources: [],
        sourceFiles: [],
      }),
    );

    expect(decoded.model.text).toBe(text);
  });

  it('still rejects a path reference in the leading Metadata section', async () => {
    const text = [
      'Metadata,,,,',
      'DefaultsPath,input/defaults/fhs.json,,,',
      'Zone,,,,',
      'Name,Floor Area,Volume,Floor Index,Floor-to-ceiling Height',
      'Zone 1,10,25,0,2.5',
    ].join('\n') + '\n';

    await expect(
      encodePortableGeometryDocument({
        model: { fileName: 'House.csv', text },
        derivedResources: [],
        sourceFiles: [],
      }),
    ).rejects.toMatchObject({ code: 'unsafe-model-reference' });
  });

  it('snapshots getters and byte arrays once before hashing', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    let bytesReads = 0;
    const input: PortableGeometryDocument = {
      model: { fileName: 'House.csv', text: 'Version,v1\n' },
      derivedResources: [
        {
          id: 'derived',
          slots: ['test.derived'],
          role: 'test-optional',
          required: false,
          mediaType: 'application/octet-stream',
          get bytes() {
            bytesReads += 1;
            return bytes;
          },
        },
      ],
      sourceFiles: [],
    };

    const encodedPromise = encodePortableGeometryDocument(input);
    bytes[0] = 9;
    const decoded = await decodePortableGeometryDocument(await encodedPromise);

    expect(bytesReads).toBe(1);
    expect(Array.from(decoded.derivedResources[0]!.bytes)).toEqual([1, 2, 3]);
  });

  it('returns frozen metadata and copy-on-read bytes isolated from archive and sibling decodes', async () => {
    const encoded = await encodeRich(['original-ifc']);
    const first = await decodePortableGeometryDocument(encoded);
    const second = await decodePortableGeometryDocument(encoded);
    first.derivedResources[0]!.bytes[0] = 0;
    first.sourceFiles[0]!.bytes[0] = 0;

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.model)).toBe(true);
    expect(Object.isFrozen(first.derivedResources)).toBe(true);
    expect(Object.isFrozen(first.derivedResources[0])).toBe(true);
    expect(Object.isFrozen(first.derivedResources[0]!.slots)).toBe(true);
    expect(Object.isFrozen(first.sourceFiles)).toBe(true);
    expect(first.derivedResources[0]!.bytes[0]).not.toBe(0);
    expect(first.sourceFiles[0]!.bytes[0]).not.toBe(0);
    expect(second.derivedResources[0]!.bytes[0]).not.toBe(0);
    expect(second.sourceFiles[0]!.bytes[0]).not.toBe(0);
    expect(encoded[0]).not.toBe(0);
  });

  it('detects payload and manifest length/hash corruption', async () => {
    const encoded = await encodeRich();
    const files = unzipSync(encoded);
    files['derived/overlay-ground']![0] ^= 0xff;
    await expect(
      decodePortableGeometryDocument(fixedZip(files)),
    ).rejects.toMatchObject({ code: 'integrity-failed' });

    const badLength = mutateManifest(encoded, (manifest) => {
      const resources = manifest.derivedResources as Array<{
        byteLength: number;
      }>;
      resources[0]!.byteLength += 1;
    });
    await expect(decodePortableGeometryDocument(badLength)).rejects.toMatchObject({
      code: 'integrity-failed',
    });

    const oneByte = await encodePortableGeometryDocument({
      model: { fileName: 'House.csv', text: 'Version,v1\n' },
      derivedResources: [
        {
          id: 'compressed-data',
          slots: ['test.compressed'],
          role: 'test-optional',
          required: false,
          mediaType: 'application/octet-stream',
          bytes: new Uint8Array([0]),
        },
      ],
      sourceFiles: [],
    });
    const compressedFiles = unzipSync(oneByte);
    compressedFiles['derived/compressed-data'] = new Uint8Array(4096);
    const truncatedCentralDirectory = patchCentralUncompressedSize(
      deflatedZip(compressedFiles),
      'derived/compressed-data',
      1,
    );
    await expect(
      decodePortableGeometryDocument(truncatedCentralDirectory),
    ).rejects.toMatchObject({ code: 'unsupported-feature' });

    const storeArchive = fixedZip(compressedFiles);
    await expect(
      decodePortableGeometryDocument(
        patchCentralStoreSizes(storeArchive, 'derived/compressed-data', 1),
      ),
    ).rejects.toMatchObject({ code: 'invalid-archive' });
  });

  it('rejects traversal, undeclared and duplicate archive entries before hydration', async () => {
    const encoded = await encodeRich();
    const files = unzipSync(encoded);
    await expect(
      decodePortableGeometryDocument(
        fixedZip({ ...files, '../escape': textBytes('private') }),
      ),
    ).rejects.toMatchObject({ code: 'unsafe-entry-path' });
    await expect(
      decodePortableGeometryDocument(
        fixedZip({ ...files, 'derived/undeclared': textBytes('private') }),
      ),
    ).rejects.toMatchObject({ code: 'unexpected-entry' });
  });

  it('rejects noncanonical local headers and bytes after the archive', async () => {
    const encoded = await encodeRich();

    await expect(
      decodePortableGeometryDocument(
        patchLocalEntryName(encoded, 'derived/ifc-audit'),
      ),
    ).rejects.toMatchObject({ code: 'invalid-archive' });

    const withTrailingBytes = new Uint8Array(encoded.byteLength + 3);
    withTrailingBytes.set(encoded);
    withTrailingBytes.set([1, 2, 3], encoded.byteLength);
    await expect(
      decodePortableGeometryDocument(withTrailingBytes),
    ).rejects.toMatchObject({ code: 'invalid-archive' });
  });

  it('rejects malformed archives/manifests, unknown fields and newer versions', async () => {
    await expect(
      decodePortableGeometryDocument(new Uint8Array([1, 2, 3])),
    ).rejects.toMatchObject({ code: 'invalid-archive' });

    const encoded = await encodeRich();
    const malformedUtf8 = unzipSync(encoded);
    const manifestBytes = malformedUtf8['manifest.json']!;
    const fileNameStart = strFromU8(manifestBytes).indexOf('House.csv');
    expect(fileNameStart).toBeGreaterThan(0);
    manifestBytes[fileNameStart] = 0x80;
    await expect(
      decodePortableGeometryDocument(fixedZip(malformedUtf8)),
    ).rejects.toMatchObject({ code: 'invalid-manifest' });

    const malformed = unzipSync(encoded);
    malformed['manifest.json'] = textBytes('{');
    await expect(
      decodePortableGeometryDocument(fixedZip(malformed)),
    ).rejects.toMatchObject({ code: 'invalid-manifest' });

    await expect(
      decodePortableGeometryDocument(
        mutateManifest(encoded, (manifest) => {
          manifest.privateWorkspaceId = 'workspace-private';
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-manifest' });

    await expect(
      decodePortableGeometryDocument(
        mutateManifest(encoded, (manifest) => {
          manifest.formatVersion = 2;
        }),
      ),
    ).rejects.toMatchObject({ code: 'unsupported-version' });
  });

  it('preserves unknown optional roles but rejects unknown required roles', async () => {
    const optional: PortableGeometryDocument = {
      model: { fileName: 'House.csv', text: 'Version,v1\n' },
      derivedResources: [
        {
          id: 'extension-data',
          slots: ['extension.data'],
          role: 'future-extension',
          required: false,
          mediaType: 'application/octet-stream',
          bytes: new Uint8Array([4, 2]),
        },
      ],
      sourceFiles: [],
    };
    const encoded = await encodePortableGeometryDocument(optional);
    await expect(decodePortableGeometryDocument(encoded)).resolves.toMatchObject({
      derivedResources: [{ role: 'future-extension', required: false }],
    });

    const required = mutateManifest(encoded, (manifest) => {
      const resources = manifest.derivedResources as Array<{
        required: boolean;
      }>;
      resources[0]!.required = true;
    });
    await expect(decodePortableGeometryDocument(required)).rejects.toMatchObject({
      code: 'unsupported-feature',
    });
  });

  it('rejects source roles masquerading as derived resources', async () => {
    const document = richDocument();
    await expect(
      encodePortableGeometryDocument({
        ...document,
        derivedResources: [
          {
            id: 'raw-ifc',
            slots: ['ifc.source'],
            role: 'ifc',
            required: false,
            mediaType: 'model/ifc',
            bytes: textBytes('raw source'),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });

    await expect(
      encodePortableGeometryDocument({
        ...document,
        derivedResources: [
          {
            id: 'raw-ifc-extension',
            slots: ['ifc.source'],
            role: 'future-extension',
            required: false,
            mediaType: 'model/ifc',
            bytes: textBytes('RAW_IFC_DEFAULT_LEAK'),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('enforces entry-count limits before compression or extraction', async () => {
    const derivedResources = Array.from(
      { length: PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumEntries - 1 },
      (_, index) => ({
        id: `resource-${index}`,
        slots: [`test.resource-${index}`],
        role: 'test-optional',
        required: false,
        mediaType: 'application/octet-stream',
        bytes: new Uint8Array(),
      }),
    );
    await expect(
      encodePortableGeometryDocument({
        model: { fileName: 'House.csv', text: '' },
        derivedResources,
        sourceFiles: [],
      }),
    ).rejects.toMatchObject({ code: 'limit-exceeded' });
  });

  it('does not count excluded source descriptors against the archive entry limit', async () => {
    const sourceFiles = Array.from(
      { length: PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumEntries - 1 },
      (_, index) => ({
        id: `source-${index}`,
        slots: [`source.slot-${index}`],
        role: 'ifc' as const,
        fileName: `Source-${index}.ifc`,
        mediaType: 'model/ifc',
        bytes: new Uint8Array([index % 251]),
      }),
    );
    const encoded = await encodePortableGeometryDocument(
      {
        model: { fileName: 'House.csv', text: '' },
        derivedResources: [],
        sourceFiles,
      },
      { includeSourceFileIds: ['source-0'] },
    );

    await expect(decodePortableGeometryDocument(encoded)).resolves.toMatchObject({
      sourceFiles: [{ id: 'source-0' }],
    });
  });

  it('creates an immutable browser-download description with the same exact archive', async () => {
    const document = richDocument();
    const download = await createPortableGeometryDocumentDownload(document, {
      includeSourceFileIds: ['original-ifc'],
    });

    expect(Object.isFrozen(download)).toBe(true);
    expect(Object.isFrozen(download.includedSourceFileIds)).toBe(true);
    expect(download.suggestedFileName).toBe('House.vulcan');
    expect(download.blob.type).toBe(PORTABLE_GEOMETRY_DOCUMENT_MIME_TYPE);
    expect(await readBlobBytes(download.blob)).toEqual(
      await encodePortableGeometryDocument(document, {
        includeSourceFileIds: ['original-ifc'],
      }),
    );
    expect(download.includedSourceFileIds).toEqual(['original-ifc']);
  });
});
