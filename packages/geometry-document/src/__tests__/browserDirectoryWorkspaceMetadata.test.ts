// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  BROWSER_DIRECTORY_WORKSPACE_METADATA_FORMAT,
  BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS,
  BROWSER_DIRECTORY_WORKSPACE_METADATA_VERSION,
  BrowserDirectoryWorkspaceMetadataError,
  decodeBrowserDirectoryWorkspaceMetadata,
  encodeBrowserDirectoryWorkspaceMetadata,
  type BrowserDirectoryWorkspaceMetadata,
} from '../browserDirectoryWorkspaceMetadata';

const hash = (digit: string): string => digit.repeat(64);

const validMetadata = (): BrowserDirectoryWorkspaceMetadata => ({
  format: BROWSER_DIRECTORY_WORKSPACE_METADATA_FORMAT,
  formatVersion: BROWSER_DIRECTORY_WORKSPACE_METADATA_VERSION,
  workspaceId: 'workspace-local',
  catalogueRevision: 7,
  retiredIds: ['document-retired'],
  documents: [
    {
      id: 'document-house',
      fileName: 'House.csv',
      modifiedAt: '2026-07-22T10:30:00.000Z',
      projectGroupIds: ['project-alpha'],
      storageRevision: 5,
      contentRevision: 3,
      archive: {
        byteLength: 1_024,
        sha256: hash('a'),
      },
      sourceFiles: [
        {
          id: 'original-ifc',
          slots: ['ifc.source'],
          role: 'ifc',
          fileName: 'House.ifc',
          mediaType: 'model/ifc',
          byteLength: 512,
          sha256: hash('c'),
        },
      ],
    },
  ],
  projectGroups: [
    {
      id: 'project-alpha',
      name: 'Project Alpha',
      description: 'Local-only grouping',
      storageRevision: 4,
    },
  ],
});

const jsonBytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

const mutableCopy = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(validMetadata())) as Record<string, unknown>;

const expectMetadataError = (
  operation: () => unknown,
  code: BrowserDirectoryWorkspaceMetadataError['code'],
): void => {
  try {
    operation();
    throw new Error('Expected metadata operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserDirectoryWorkspaceMetadataError);
    expect(error).toMatchObject({ code });
  }
};

describe('browser directory workspace metadata v1', () => {
  it('encodes deterministic canonical JSON, sorts set-like rows, and decodes a deeply frozen value', () => {
    const metadata = validMetadata();
    const unsorted: BrowserDirectoryWorkspaceMetadata = {
      ...metadata,
      retiredIds: ['workspace-retired', ...metadata.retiredIds],
      documents: [
        {
          ...metadata.documents[0]!,
          projectGroupIds: ['project-zeta', 'project-alpha'],
          sourceFiles: [
            {
              id: 'zeta-overlay',
              slots: ['zeta.slot', 'alpha.slot'],
              role: 'guide-overlay-source',
              fileName: 'Overlay.png',
              mediaType: 'image/png',
              byteLength: 1,
              sha256: hash('d'),
            },
            ...metadata.documents[0]!.sourceFiles,
          ],
        },
        {
          id: 'document-alpha',
          fileName: 'Alpha.csv',
          modifiedAt: null,
          projectGroupIds: [],
          storageRevision: 0,
          contentRevision: 0,
          archive: {
            byteLength: 200,
            sha256: hash('e'),
          },
          sourceFiles: [],
        },
      ],
      projectGroups: [
        {
          id: 'project-zeta',
          name: 'Project Zeta',
          description: '',
          storageRevision: 0,
        },
        ...metadata.projectGroups,
      ],
    };

    const encoded = encodeBrowserDirectoryWorkspaceMetadata(unsorted);
    const text = new TextDecoder().decode(encoded);
    const decoded = decodeBrowserDirectoryWorkspaceMetadata(encoded);

    expect(text).toBe(`${JSON.stringify(decoded, null, 2)}\n`);
    expect(decoded).toMatchObject({
      format: 'vulcan-community-directory-workspace',
      formatVersion: 1,
      workspaceId: 'workspace-local',
      catalogueRevision: 7,
      retiredIds: ['document-retired', 'workspace-retired'],
    });
    expect(decoded.documents.map(({ id }) => id)).toEqual([
      'document-alpha',
      'document-house',
    ]);
    expect(decoded.projectGroups.map(({ id }) => id)).toEqual([
      'project-alpha',
      'project-zeta',
    ]);
    expect(decoded.documents[1]!.projectGroupIds).toEqual([
      'project-alpha',
      'project-zeta',
    ]);
    expect(decoded.documents[1]!.sourceFiles[1]!.slots).toEqual([
      'alpha.slot',
      'zeta.slot',
    ]);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.documents)).toBe(true);
    expect(Object.isFrozen(decoded.documents[1])).toBe(true);
    expect(Object.isFrozen(decoded.documents[1]!.archive)).toBe(true);
    expect(
      Object.isFrozen(
        decoded.documents[1]!.sourceFiles[1]!.slots,
      ),
    ).toBe(true);
    expect(text).not.toContain('"path"');
  });

  it('rejects malformed UTF-8, byte-order marks, oversized input, and noncanonical JSON', () => {
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(new Uint8Array([0xc3, 0x28])),
      'invalid-metadata',
    );
    expectMetadataError(
      () =>
        decodeBrowserDirectoryWorkspaceMetadata(
          new Uint8Array([0xef, 0xbb, 0xbf, ...jsonBytes(validMetadata())]),
        ),
      'invalid-metadata',
    );
    expectMetadataError(
      () =>
        decodeBrowserDirectoryWorkspaceMetadata(
          new Uint8Array(
            BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumMetadataBytes +
              1,
          ),
        ),
      'limit-exceeded',
    );

    const hostileBytes = encodeBrowserDirectoryWorkspaceMetadata(validMetadata());
    Object.defineProperty(hostileBytes, Symbol.toStringTag, {
      configurable: true,
      get: () => {
        throw new Error('hostile byte tag');
      },
    });
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(hostileBytes),
      'invalid-metadata',
    );

    const canonical = encodeBrowserDirectoryWorkspaceMetadata(validMetadata());
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(canonical.slice(0, -1)),
      'noncanonical-metadata',
    );
    expectMetadataError(
      () =>
        decodeBrowserDirectoryWorkspaceMetadata(
          new TextEncoder().encode(JSON.stringify(validMetadata())),
        ),
      'noncanonical-metadata',
    );
  });

  it('rejects unsupported versions and unknown keys at every persisted object boundary', () => {
    const unsupported = mutableCopy();
    unsupported.formatVersion = 2;
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(unsupported)),
      'unsupported-version',
    );

    const topLevelPath = mutableCopy();
    topLevelPath.workspacePath = '/private/customer/models';
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(topLevelPath)),
      'invalid-metadata',
    );

    const nestedPath = mutableCopy();
    const documents = nestedPath.documents as Array<Record<string, unknown>>;
    const archive = documents[0]!.archive as Record<string, unknown>;
    archive.path = '../documents/private.vulcan';
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(nestedPath)),
      'invalid-metadata',
    );
  });

  it.each([
    ['unsafe workspace id', (value: Record<string, unknown>) => {
      value.workspaceId = '../workspace';
    }],
    ['unsafe document id', (value: Record<string, unknown>) => {
      const documents = value.documents as Array<Record<string, unknown>>;
      documents[0]!.id = 'Document/House';
    }],
    ['unsafe document name', (value: Record<string, unknown>) => {
      const documents = value.documents as Array<Record<string, unknown>>;
      documents[0]!.fileName = '../House.csv';
    }],
    ['noncanonical document name', (value: Record<string, unknown>) => {
      const documents = value.documents as Array<Record<string, unknown>>;
      documents[0]!.fileName = ' House.csv ';
    }],
    ['unsafe project name', (value: Record<string, unknown>) => {
      const projects = value.projectGroups as Array<Record<string, unknown>>;
      projects[0]!.name = 'Project\u0000Alpha';
    }],
    ['negative revision', (value: Record<string, unknown>) => {
      const documents = value.documents as Array<Record<string, unknown>>;
      documents[0]!.contentRevision = -1;
    }],
    ['fractional catalogue revision', (value: Record<string, unknown>) => {
      value.catalogueRevision = 1.5;
    }],
    ['uppercase hash', (value: Record<string, unknown>) => {
      const documents = value.documents as Array<Record<string, unknown>>;
      const archive = documents[0]!.archive as Record<string, unknown>;
      archive.sha256 = hash('A');
    }],
    ['noncanonical modified time', (value: Record<string, unknown>) => {
      const documents = value.documents as Array<Record<string, unknown>>;
      documents[0]!.modifiedAt = '2026-07-22T10:30:00Z';
    }],
  ])('rejects %s', (_description, mutate) => {
    const value = mutableCopy();
    mutate(value);
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(value)),
      'invalid-metadata',
    );
  });

  it('rejects duplicate active ids, duplicate display names, duplicate tombstones, and tombstone reuse', () => {
    const duplicateId = mutableCopy();
    const duplicateIdProjects = duplicateId.projectGroups as Array<
      Record<string, unknown>
    >;
    duplicateIdProjects[0]!.id = 'document-house';
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(duplicateId)),
      'invalid-metadata',
    );

    const duplicateDocumentName = validMetadata();
    expectMetadataError(
      () =>
        encodeBrowserDirectoryWorkspaceMetadata({
          ...duplicateDocumentName,
          documents: [
            ...duplicateDocumentName.documents,
            {
              ...duplicateDocumentName.documents[0]!,
              id: 'document-other',
              fileName: 'house.CSV',
            },
          ],
        }),
      'invalid-input',
    );

    const duplicateProjectName = validMetadata();
    expectMetadataError(
      () =>
        encodeBrowserDirectoryWorkspaceMetadata({
          ...duplicateProjectName,
          projectGroups: [
            ...duplicateProjectName.projectGroups,
            {
              ...duplicateProjectName.projectGroups[0]!,
              id: 'project-other',
              name: 'project alpha',
            },
          ],
        }),
      'invalid-input',
    );

    const duplicateRetired = mutableCopy();
    duplicateRetired.retiredIds = ['document-retired', 'document-retired'];
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(duplicateRetired)),
      'invalid-metadata',
    );

    const reusedTombstone = mutableCopy();
    reusedTombstone.retiredIds = ['document-house'];
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(reusedTombstone)),
      'invalid-metadata',
    );
  });

  it('rejects duplicate or unknown project memberships without accepting partial catalogue state', () => {
    const duplicate = mutableCopy();
    const duplicateDocuments = duplicate.documents as Array<
      Record<string, unknown>
    >;
    duplicateDocuments[0]!.projectGroupIds = [
      'project-alpha',
      'project-alpha',
    ];
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(duplicate)),
      'invalid-metadata',
    );

    const unknown = mutableCopy();
    const unknownDocuments = unknown.documents as Array<Record<string, unknown>>;
    unknownDocuments[0]!.projectGroupIds = ['project-missing'];
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(unknown)),
      'invalid-metadata',
    );
  });

  it('keeps content and membership CAS revisions separate and rejects impossible revision order', () => {
    const metadata = validMetadata();
    const membershipOnly = encodeBrowserDirectoryWorkspaceMetadata({
      ...metadata,
      documents: [
        {
          ...metadata.documents[0]!,
          projectGroupIds: [],
          storageRevision: metadata.documents[0]!.storageRevision + 1,
        },
      ],
    });
    expect(decodeBrowserDirectoryWorkspaceMetadata(membershipOnly).documents[0])
      .toMatchObject({ storageRevision: 6, contentRevision: 3 });

    const impossible = mutableCopy();
    const impossibleDocuments = impossible.documents as Array<
      Record<string, unknown>
    >;
    impossibleDocuments[0]!.storageRevision = 2;
    impossibleDocuments[0]!.contentRevision = 3;
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(impossible)),
      'invalid-metadata',
    );
  });

  it('validates source-sidecar descriptors without duplicating archive paths or derived manifests', () => {
    const duplicateSource = mutableCopy();
    const duplicateDocuments = duplicateSource.documents as Array<
      Record<string, unknown>
    >;
    const duplicateSources = duplicateDocuments[0]!.sourceFiles as Array<
      Record<string, unknown>
    >;
    duplicateSources.push({ ...duplicateSources[0] });
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(duplicateSource)),
      'invalid-metadata',
    );

    const duplicateSlot = mutableCopy();
    const slotDocuments = duplicateSlot.documents as Array<Record<string, unknown>>;
    const slotSources = slotDocuments[0]!.sourceFiles as Array<Record<string, unknown>>;
    slotSources.push({
      ...slotSources[0],
      id: 'other-source',
    });
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(duplicateSlot)),
      'invalid-metadata',
    );

    const unsafeSourceName = mutableCopy();
    const unsafeDocuments = unsafeSourceName.documents as Array<
      Record<string, unknown>
    >;
    const unsafeSources = unsafeDocuments[0]!.sourceFiles as Array<
      Record<string, unknown>
    >;
    unsafeSources[0]!.fileName = 'C:\\customer\\House.ifc';
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(unsafeSourceName)),
      'invalid-metadata',
    );

    const badSourceRole = mutableCopy();
    const roleDocuments = badSourceRole.documents as Array<
      Record<string, unknown>
    >;
    const roleSources = roleDocuments[0]!.sourceFiles as Array<
      Record<string, unknown>
    >;
    roleSources[0]!.role = 'customer-private-file';
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(badSourceRole)),
      'invalid-metadata',
    );

    const invalidMediaType = mutableCopy();
    const mediaDocuments = invalidMediaType.documents as Array<
      Record<string, unknown>
    >;
    const mediaSources = mediaDocuments[0]!.sourceFiles as Array<
      Record<string, unknown>
    >;
    mediaSources[0]!.mediaType = 'not a media type';
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(invalidMediaType)),
      'invalid-metadata',
    );
  });

  it('enforces structural and per-entry limits before accepting metadata', () => {
    const metadata = validMetadata();
    const tooManyDocuments = Array.from(
      {
        length:
          BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumDocuments + 1,
      },
      (_, index) => ({
        ...metadata.documents[0]!,
        id: `document-${index.toString(36)}`,
        fileName: `House ${index}.csv`,
        projectGroupIds: [],
      }),
    );
    expectMetadataError(
      () =>
        encodeBrowserDirectoryWorkspaceMetadata({
          ...metadata,
          documents: tooManyDocuments,
        }),
      'limit-exceeded',
    );

    const oversizedArchive = mutableCopy();
    const documents = oversizedArchive.documents as Array<
      Record<string, unknown>
    >;
    const archive = documents[0]!.archive as Record<string, unknown>;
    archive.byteLength =
      BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumArchiveBytes + 1;
    expectMetadataError(
      () => decodeBrowserDirectoryWorkspaceMetadata(jsonBytes(oversizedArchive)),
      'limit-exceeded',
    );

    const excessiveSources = validMetadata();
    const source = excessiveSources.documents[0]!.sourceFiles[0]!;
    expectMetadataError(
      () =>
        encodeBrowserDirectoryWorkspaceMetadata({
          ...excessiveSources,
          documents: [
            {
              ...excessiveSources.documents[0]!,
              sourceFiles: [
                {
                  ...source,
                  byteLength:
                    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumSourceFileBytes,
                },
                {
                  ...source,
                  id: 'second-source',
                  slots: ['ifc.second-source'],
                  byteLength:
                    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumSourceFileBytes,
                },
                {
                  ...source,
                  id: 'third-source',
                  slots: ['ifc.third-source'],
                  byteLength: 1,
                },
              ],
            },
          ],
        }),
      'limit-exceeded',
    );
  });
});
