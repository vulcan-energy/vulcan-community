// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { GeometryDocumentSourceFileRole } from './contracts';
import {
  geometryDocumentNameKey,
  geometryProjectGroupNameKey,
  normalizeGeometryDocumentName,
  normalizeGeometryProjectGroupName,
} from './documentNaming';

export const BROWSER_DIRECTORY_WORKSPACE_METADATA_FORMAT =
  'vulcan-community-directory-workspace' as const;
export const BROWSER_DIRECTORY_WORKSPACE_METADATA_VERSION = 1 as const;

export const BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS = Object.freeze({
  maximumMetadataBytes: 4 * 1024 * 1024,
  maximumDocuments: 4_096,
  maximumProjectGroups: 4_096,
  maximumRetiredIds: 65_536,
  maximumSourceFilesPerDocument: 128,
  maximumSlotsPerSourceFile: 64,
  maximumArchiveBytes: 256 * 1024 * 1024,
  maximumSourceFileBytes: 256 * 1024 * 1024,
  maximumTotalSourceBytesPerDocument: 512 * 1024 * 1024,
  maximumProjectDescriptionCharacters: 2_000,
});

export type BrowserDirectoryWorkspaceArchiveDescriptor = Readonly<{
  byteLength: number;
  sha256: string;
}>;

export type BrowserDirectoryWorkspaceSourceFileDescriptor = Readonly<{
  id: string;
  slots: readonly string[];
  role: GeometryDocumentSourceFileRole;
  fileName: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
}>;

export type BrowserDirectoryWorkspaceDocumentRow = Readonly<{
  id: string;
  fileName: string;
  modifiedAt: string | null;
  projectGroupIds: readonly string[];
  /** Bumped for content or membership changes and used for catalogue CAS. */
  storageRevision: number;
  /** Bumped only when archive or source bytes change. */
  contentRevision: number;
  archive: BrowserDirectoryWorkspaceArchiveDescriptor;
  sourceFiles: readonly BrowserDirectoryWorkspaceSourceFileDescriptor[];
}>;

export type BrowserDirectoryWorkspaceProjectGroupRow = Readonly<{
  id: string;
  name: string;
  description: string;
  storageRevision: number;
}>;

export type BrowserDirectoryWorkspaceMetadata = Readonly<{
  format: typeof BROWSER_DIRECTORY_WORKSPACE_METADATA_FORMAT;
  formatVersion: typeof BROWSER_DIRECTORY_WORKSPACE_METADATA_VERSION;
  workspaceId: string;
  catalogueRevision: number;
  /** Tombstones share the same global namespace as workspace resources. */
  retiredIds: readonly string[];
  documents: readonly BrowserDirectoryWorkspaceDocumentRow[];
  projectGroups: readonly BrowserDirectoryWorkspaceProjectGroupRow[];
}>;

export type BrowserDirectoryWorkspaceMetadataErrorCode =
  | 'invalid-input'
  | 'invalid-metadata'
  | 'unsupported-version'
  | 'limit-exceeded'
  | 'noncanonical-metadata';

export type BrowserDirectoryWorkspaceMetadataErrorDetails = Readonly<{
  cause?: unknown;
}>;

export class BrowserDirectoryWorkspaceMetadataError extends Error {
  readonly code: BrowserDirectoryWorkspaceMetadataErrorCode;
  readonly cause?: unknown;

  constructor(
    code: BrowserDirectoryWorkspaceMetadataErrorCode,
    message: string,
    details: BrowserDirectoryWorkspaceMetadataErrorDetails = {},
  ) {
    super(message);
    this.name = 'BrowserDirectoryWorkspaceMetadataError';
    this.code = code;
    this.cause = details.cause;
  }
}

type ValidationSource = 'input' | 'metadata';

type ValidationContext = Readonly<{
  source: ValidationSource;
  invalidCode: 'invalid-input' | 'invalid-metadata';
}>;

const INPUT_CONTEXT: ValidationContext = Object.freeze({
  source: 'input',
  invalidCode: 'invalid-input',
});
const METADATA_CONTEXT: ValidationContext = Object.freeze({
  source: 'metadata',
  invalidCode: 'invalid-metadata',
});

const OPAQUE_ID_PATTERN =
  /^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const SLOT_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/u;
const MEDIA_TYPE_PATTERN =
  /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[a-z0-9!#$&^_.+-]+=[a-z0-9!#$&^_.+-]+)*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const WINDOWS_RESERVED_BASENAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);
const SOURCE_FILE_ROLES = new Set<GeometryDocumentSourceFileRole>([
  'ifc',
  'guide-overlay-source',
]);
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'byteLength',
)?.get;

function fail(
  context: ValidationContext,
  message: string,
  code: BrowserDirectoryWorkspaceMetadataErrorCode = context.invalidCode,
  cause?: unknown,
): never {
  throw new BrowserDirectoryWorkspaceMetadataError(code, message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (following < 0xdc00 || following > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}

function requireCanonicalString(
  value: unknown,
  description: string,
  context: ValidationContext,
): string {
  if (
    typeof value !== 'string' ||
    !isWellFormedUnicode(value) ||
    value.normalize('NFC') !== value
  ) {
    fail(
      context,
      `${description} must be a canonical NFC Unicode string`,
    );
  }
  return value;
}

function requireOpaqueId(
  value: unknown,
  description: string,
  context: ValidationContext,
): string {
  const id = requireCanonicalString(value, description, context);
  const firstSegment = id.split('.', 1)[0]!;
  if (
    !OPAQUE_ID_PATTERN.test(id) ||
    id.includes('..') ||
    WINDOWS_RESERVED_BASENAMES.has(firstSegment)
  ) {
    fail(
      context,
      `${description} must be a lowercase, filesystem-safe opaque id`,
    );
  }
  return id;
}

function requireRevision(
  value: unknown,
  description: string,
  context: ValidationContext,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    Object.is(value, -0)
  ) {
    fail(
      context,
      `${description} must be a non-negative safe integer`,
    );
  }
  return value as number;
}

function requireByteLength(
  value: unknown,
  maximum: number,
  description: string,
  context: ValidationContext,
  allowEmpty: boolean,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < (allowEmpty ? 0 : 1) ||
    Object.is(value, -0)
  ) {
    fail(
      context,
      `${description} must be a ${allowEmpty ? 'non-negative' : 'positive'} safe integer`,
    );
  }
  if ((value as number) > maximum) {
    fail(context, `${description} exceeds its byte limit`, 'limit-exceeded');
  }
  return value as number;
}

function requireSha256(
  value: unknown,
  description: string,
  context: ValidationContext,
): string {
  const hash = requireCanonicalString(value, description, context);
  if (!SHA256_PATTERN.test(hash)) {
    fail(context, `${description} must be a lowercase SHA-256 hash`);
  }
  return hash;
}

function requireMediaType(
  value: unknown,
  description: string,
  context: ValidationContext,
): string {
  const mediaType = requireCanonicalString(value, description, context);
  if (!MEDIA_TYPE_PATTERN.test(mediaType)) {
    fail(context, `${description} must be a canonical media type`);
  }
  return mediaType;
}

function requireSafeFileName(
  value: unknown,
  description: string,
  context: ValidationContext,
): string {
  const fileName = requireCanonicalString(value, description, context);
  let normalized: string;
  try {
    normalized = normalizeGeometryDocumentName(fileName);
  } catch (cause) {
    fail(context, `${description} must be a safe basename`, undefined, cause);
  }
  if (normalized !== fileName) {
    fail(context, `${description} must already be normalized`);
  }
  return fileName;
}

function requireProjectGroupName(
  value: unknown,
  description: string,
  context: ValidationContext,
): string {
  const name = requireCanonicalString(value, description, context);
  let normalized: string;
  try {
    normalized = normalizeGeometryProjectGroupName(name);
  } catch (cause) {
    fail(context, `${description} is invalid`, undefined, cause);
  }
  if (normalized !== name) {
    fail(context, `${description} must already be normalized`);
  }
  return name;
}

function requireDescription(
  value: unknown,
  description: string,
  context: ValidationContext,
): string {
  const text = requireCanonicalString(value, description, context);
  const maximum =
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumProjectDescriptionCharacters;
  if (
    containsControlCharacter(text) ||
    text.length > maximum * 2 ||
    Array.from(text).length > maximum
  ) {
    fail(
      context,
      `${description} must not contain control characters or exceed ${maximum} characters`,
    );
  }
  return text;
}

function requireModifiedAt(
  value: unknown,
  description: string,
  context: ValidationContext,
): string | null {
  if (value === null) return null;
  const timestamp = requireCanonicalString(value, description, context);
  let canonical = false;
  if (CANONICAL_TIMESTAMP_PATTERN.test(timestamp)) {
    const milliseconds = Date.parse(timestamp);
    if (Number.isFinite(milliseconds)) {
      canonical = new Date(milliseconds).toISOString() === timestamp;
    }
  }
  if (!canonical) {
    fail(
      context,
      `${description} must be null or a canonical UTC millisecond timestamp`,
    );
  }
  return timestamp;
}

function requirePlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
  description: string,
  context: ValidationContext,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(context, `${description} must be an object`);
  }
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    fail(context, `${description} could not be inspected`, undefined, cause);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(context, `${description} must be a plain object`);
  }
  const actual = keys
    .filter((key): key is string => typeof key === 'string')
    .sort(compareStrings);
  const canonicalExpected = [...expectedKeys].sort(compareStrings);
  if (
    actual.length !== keys.length ||
    actual.length !== canonicalExpected.length ||
    actual.some((key, index) => key !== canonicalExpected[index])
  ) {
    fail(
      context,
      `${description} must contain exactly: ${canonicalExpected.join(', ')}`,
    );
  }
  return value as Record<string, unknown>;
}

function readOwnDataProperty(
  record: Record<string, unknown>,
  key: string,
  description: string,
  context: ValidationContext,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch (cause) {
    fail(context, `${description} could not be read`, undefined, cause);
  }
  if (
    descriptor === undefined ||
    !Object.prototype.hasOwnProperty.call(descriptor, 'value')
  ) {
    fail(context, `${description} must be a data property`);
  }
  return descriptor.value;
}

function captureArray<T>(
  value: unknown,
  maximumLength: number,
  description: string,
  context: ValidationContext,
  captureEntry: (entry: unknown, index: number) => T,
): T[] {
  if (!Array.isArray(value)) {
    fail(context, `${description} must be an array`);
  }
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  } catch (cause) {
    fail(context, `${description} could not be inspected`, undefined, cause);
  }
  if (
    lengthDescriptor === undefined ||
    !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    fail(context, `${description} has an invalid length`);
  }
  const length = lengthDescriptor.value as number;
  if (length > maximumLength) {
    fail(context, `${description} exceeds its entry limit`, 'limit-exceeded');
  }
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    fail(context, `${description} could not be inspected`, undefined, cause);
  }
  if (
    keys.length !== length + 1 ||
    keys.some(
      (key) =>
        key !== 'length' &&
        (typeof key !== 'string' ||
          !/^\d+$/u.test(key) ||
          Number(key) >= length),
    )
  ) {
    fail(context, `${description} must be a dense array without extra keys`);
  }
  const captured: T[] = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch (cause) {
      fail(
        context,
        `${description}[${index}] could not be read`,
        undefined,
        cause,
      );
    }
    if (
      descriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      fail(context, `${description}[${index}] must be a data property`);
    }
    captured.push(captureEntry(descriptor.value, index));
  }
  return captured;
}

function captureIdArray(
  value: unknown,
  maximumLength: number,
  description: string,
  context: ValidationContext,
): readonly string[] {
  const ids = captureArray(
    value,
    maximumLength,
    description,
    context,
    (entry, index) =>
      requireOpaqueId(entry, `${description}[${index}]`, context),
  );
  if (new Set(ids).size !== ids.length) {
    fail(context, `${description} must not contain duplicate ids`);
  }
  ids.sort(compareStrings);
  return Object.freeze(ids);
}

function captureSlots(
  value: unknown,
  description: string,
  context: ValidationContext,
): readonly string[] {
  const slots = captureArray(
    value,
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumSlotsPerSourceFile,
    description,
    context,
    (entry, index) => {
      const slot = requireCanonicalString(
        entry,
        `${description}[${index}]`,
        context,
      );
      if (!SLOT_PATTERN.test(slot)) {
        fail(context, `${description}[${index}] must be a safe slot id`);
      }
      return slot;
    },
  );
  if (slots.length === 0) {
    fail(context, `${description} must contain at least one slot`);
  }
  if (new Set(slots).size !== slots.length) {
    fail(context, `${description} must not contain duplicate slots`);
  }
  slots.sort(compareStrings);
  return Object.freeze(slots);
}

function captureArchive(
  value: unknown,
  description: string,
  context: ValidationContext,
): BrowserDirectoryWorkspaceArchiveDescriptor {
  const record = requirePlainRecord(
    value,
    ['byteLength', 'sha256'],
    description,
    context,
  );
  const rawByteLength = readOwnDataProperty(
    record,
    'byteLength',
    `${description}.byteLength`,
    context,
  );
  const rawSha256 = readOwnDataProperty(
    record,
    'sha256',
    `${description}.sha256`,
    context,
  );
  return Object.freeze({
    byteLength: requireByteLength(
      rawByteLength,
      BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumArchiveBytes,
      `${description}.byteLength`,
      context,
      false,
    ),
    sha256: requireSha256(rawSha256, `${description}.sha256`, context),
  });
}

function captureSourceFile(
  value: unknown,
  index: number,
  documentDescription: string,
  context: ValidationContext,
): BrowserDirectoryWorkspaceSourceFileDescriptor {
  const description = `${documentDescription}.sourceFiles[${index}]`;
  const record = requirePlainRecord(
    value,
    [
      'id',
      'slots',
      'role',
      'fileName',
      'mediaType',
      'byteLength',
      'sha256',
    ],
    description,
    context,
  );
  const id = requireOpaqueId(
    readOwnDataProperty(record, 'id', `${description}.id`, context),
    `${description}.id`,
    context,
  );
  const slots = captureSlots(
    readOwnDataProperty(record, 'slots', `${description}.slots`, context),
    `${description}.slots`,
    context,
  );
  const rawRole = readOwnDataProperty(
    record,
    'role',
    `${description}.role`,
    context,
  );
  const role = requireCanonicalString(
    rawRole,
    `${description}.role`,
    context,
  );
  if (!SOURCE_FILE_ROLES.has(role as GeometryDocumentSourceFileRole)) {
    fail(context, `${description}.role is not a supported source-file role`);
  }
  const fileName = requireSafeFileName(
    readOwnDataProperty(record, 'fileName', `${description}.fileName`, context),
    `${description}.fileName`,
    context,
  );
  const mediaType = requireMediaType(
    readOwnDataProperty(
      record,
      'mediaType',
      `${description}.mediaType`,
      context,
    ),
    `${description}.mediaType`,
    context,
  );
  const byteLength = requireByteLength(
    readOwnDataProperty(
      record,
      'byteLength',
      `${description}.byteLength`,
      context,
    ),
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumSourceFileBytes,
    `${description}.byteLength`,
    context,
    true,
  );
  const sha256 = requireSha256(
    readOwnDataProperty(record, 'sha256', `${description}.sha256`, context),
    `${description}.sha256`,
    context,
  );
  return Object.freeze({
    id,
    slots,
    role: role as GeometryDocumentSourceFileRole,
    fileName,
    mediaType,
    byteLength,
    sha256,
  });
}

function captureDocument(
  value: unknown,
  index: number,
  context: ValidationContext,
): BrowserDirectoryWorkspaceDocumentRow {
  const description = `documents[${index}]`;
  const record = requirePlainRecord(
    value,
    [
      'id',
      'fileName',
      'modifiedAt',
      'projectGroupIds',
      'storageRevision',
      'contentRevision',
      'archive',
      'sourceFiles',
    ],
    description,
    context,
  );
  const id = requireOpaqueId(
    readOwnDataProperty(record, 'id', `${description}.id`, context),
    `${description}.id`,
    context,
  );
  const fileName = requireSafeFileName(
    readOwnDataProperty(
      record,
      'fileName',
      `${description}.fileName`,
      context,
    ),
    `${description}.fileName`,
    context,
  );
  const modifiedAt = requireModifiedAt(
    readOwnDataProperty(
      record,
      'modifiedAt',
      `${description}.modifiedAt`,
      context,
    ),
    `${description}.modifiedAt`,
    context,
  );
  const projectGroupIds = captureIdArray(
    readOwnDataProperty(
      record,
      'projectGroupIds',
      `${description}.projectGroupIds`,
      context,
    ),
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumProjectGroups,
    `${description}.projectGroupIds`,
    context,
  );
  const storageRevision = requireRevision(
    readOwnDataProperty(
      record,
      'storageRevision',
      `${description}.storageRevision`,
      context,
    ),
    `${description}.storageRevision`,
    context,
  );
  const contentRevision = requireRevision(
    readOwnDataProperty(
      record,
      'contentRevision',
      `${description}.contentRevision`,
      context,
    ),
    `${description}.contentRevision`,
    context,
  );
  if (storageRevision < contentRevision) {
    fail(
      context,
      `${description}.storageRevision must not precede contentRevision`,
    );
  }
  const archive = captureArchive(
    readOwnDataProperty(record, 'archive', `${description}.archive`, context),
    `${description}.archive`,
    context,
  );
  const sourceFiles = captureArray(
    readOwnDataProperty(
      record,
      'sourceFiles',
      `${description}.sourceFiles`,
      context,
    ),
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumSourceFilesPerDocument,
    `${description}.sourceFiles`,
    context,
    (entry, sourceIndex) =>
      captureSourceFile(entry, sourceIndex, description, context),
  );
  const sourceIds = new Set<string>();
  const sourceSlots = new Set<string>();
  let totalSourceBytes = 0;
  for (const source of sourceFiles) {
    if (sourceIds.has(source.id)) {
      fail(context, `${description} contains duplicate source id ${source.id}`);
    }
    sourceIds.add(source.id);
    for (const slot of source.slots) {
      if (sourceSlots.has(slot)) {
        fail(context, `${description} contains duplicate source slot ${slot}`);
      }
      sourceSlots.add(slot);
    }
    totalSourceBytes += source.byteLength;
    if (
      totalSourceBytes >
      BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumTotalSourceBytesPerDocument
    ) {
      fail(
        context,
        `${description} source files exceed their total byte limit`,
        'limit-exceeded',
      );
    }
  }
  sourceFiles.sort((left, right) => compareStrings(left.id, right.id));
  return Object.freeze({
    id,
    fileName,
    modifiedAt,
    projectGroupIds,
    storageRevision,
    contentRevision,
    archive,
    sourceFiles: Object.freeze(sourceFiles),
  });
}

function captureProjectGroup(
  value: unknown,
  index: number,
  context: ValidationContext,
): BrowserDirectoryWorkspaceProjectGroupRow {
  const description = `projectGroups[${index}]`;
  const record = requirePlainRecord(
    value,
    ['id', 'name', 'description', 'storageRevision'],
    description,
    context,
  );
  return Object.freeze({
    id: requireOpaqueId(
      readOwnDataProperty(record, 'id', `${description}.id`, context),
      `${description}.id`,
      context,
    ),
    name: requireProjectGroupName(
      readOwnDataProperty(record, 'name', `${description}.name`, context),
      `${description}.name`,
      context,
    ),
    description: requireDescription(
      readOwnDataProperty(
        record,
        'description',
        `${description}.description`,
        context,
      ),
      `${description}.description`,
      context,
    ),
    storageRevision: requireRevision(
      readOwnDataProperty(
        record,
        'storageRevision',
        `${description}.storageRevision`,
        context,
      ),
      `${description}.storageRevision`,
      context,
    ),
  });
}

function captureMetadataUnchecked(
  value: unknown,
  context: ValidationContext,
): BrowserDirectoryWorkspaceMetadata {
  const record = requirePlainRecord(
    value,
    [
      'format',
      'formatVersion',
      'workspaceId',
      'catalogueRevision',
      'retiredIds',
      'documents',
      'projectGroups',
    ],
    'workspace metadata',
    context,
  );
  const rawFormat = readOwnDataProperty(
    record,
    'format',
    'workspace metadata.format',
    context,
  );
  if (rawFormat !== BROWSER_DIRECTORY_WORKSPACE_METADATA_FORMAT) {
    fail(context, 'Workspace metadata format is invalid');
  }
  const rawVersion = readOwnDataProperty(
    record,
    'formatVersion',
    'workspace metadata.formatVersion',
    context,
  );
  if (rawVersion !== BROWSER_DIRECTORY_WORKSPACE_METADATA_VERSION) {
    if (Number.isSafeInteger(rawVersion) && (rawVersion as number) >= 0) {
      fail(
        context,
        `Workspace metadata version ${String(rawVersion)} is unsupported`,
        'unsupported-version',
      );
    }
    fail(context, 'Workspace metadata version is invalid');
  }
  const workspaceId = requireOpaqueId(
    readOwnDataProperty(
      record,
      'workspaceId',
      'workspace metadata.workspaceId',
      context,
    ),
    'workspace metadata.workspaceId',
    context,
  );
  const catalogueRevision = requireRevision(
    readOwnDataProperty(
      record,
      'catalogueRevision',
      'workspace metadata.catalogueRevision',
      context,
    ),
    'workspace metadata.catalogueRevision',
    context,
  );
  const retiredIds = captureIdArray(
    readOwnDataProperty(
      record,
      'retiredIds',
      'workspace metadata.retiredIds',
      context,
    ),
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumRetiredIds,
    'workspace metadata.retiredIds',
    context,
  );
  const documents = captureArray(
    readOwnDataProperty(
      record,
      'documents',
      'workspace metadata.documents',
      context,
    ),
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumDocuments,
    'workspace metadata.documents',
    context,
    (entry, index) => captureDocument(entry, index, context),
  );
  const projectGroups = captureArray(
    readOwnDataProperty(
      record,
      'projectGroups',
      'workspace metadata.projectGroups',
      context,
    ),
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumProjectGroups,
    'workspace metadata.projectGroups',
    context,
    (entry, index) => captureProjectGroup(entry, index, context),
  );

  const activeIds = new Set<string>([workspaceId]);
  const documentNames = new Set<string>();
  for (const document of documents) {
    if (activeIds.has(document.id)) {
      fail(context, `Duplicate active workspace id ${document.id}`);
    }
    activeIds.add(document.id);
    const nameKey = geometryDocumentNameKey(document.fileName);
    if (documentNames.has(nameKey)) {
      fail(context, `Duplicate document name ${document.fileName}`);
    }
    documentNames.add(nameKey);
  }
  const projectIds = new Set<string>();
  const projectNames = new Set<string>();
  for (const projectGroup of projectGroups) {
    if (activeIds.has(projectGroup.id)) {
      fail(context, `Duplicate active workspace id ${projectGroup.id}`);
    }
    activeIds.add(projectGroup.id);
    projectIds.add(projectGroup.id);
    const nameKey = geometryProjectGroupNameKey(projectGroup.name);
    if (projectNames.has(nameKey)) {
      fail(context, `Duplicate project group name ${projectGroup.name}`);
    }
    projectNames.add(nameKey);
  }
  for (const retiredId of retiredIds) {
    if (activeIds.has(retiredId)) {
      fail(context, `Retired workspace id ${retiredId} has been reused`);
    }
  }
  for (const document of documents) {
    for (const projectGroupId of document.projectGroupIds) {
      if (!projectIds.has(projectGroupId)) {
        fail(
          context,
          `Document ${document.id} references unknown project group ${projectGroupId}`,
        );
      }
    }
  }

  documents.sort((left, right) => compareStrings(left.id, right.id));
  projectGroups.sort((left, right) => compareStrings(left.id, right.id));
  return Object.freeze({
    format: BROWSER_DIRECTORY_WORKSPACE_METADATA_FORMAT,
    formatVersion: BROWSER_DIRECTORY_WORKSPACE_METADATA_VERSION,
    workspaceId,
    catalogueRevision,
    retiredIds,
    documents: Object.freeze(documents),
    projectGroups: Object.freeze(projectGroups),
  });
}

function captureMetadata(
  value: unknown,
  context: ValidationContext,
): BrowserDirectoryWorkspaceMetadata {
  try {
    return captureMetadataUnchecked(value, context);
  } catch (error) {
    if (error instanceof BrowserDirectoryWorkspaceMetadataError) throw error;
    fail(
      context,
      `Workspace ${context.source} could not be validated`,
      undefined,
      error,
    );
  }
}

function canonicalMetadataText(
  metadata: BrowserDirectoryWorkspaceMetadata,
): string {
  return `${JSON.stringify(metadata, null, 2)}\n`;
}

function intrinsicUint8ArrayByteLength(value: Uint8Array): number {
  if (typeof TYPED_ARRAY_BYTE_LENGTH_GETTER !== 'function') {
    throw new Error('Typed-array byte-length validation is unavailable');
  }
  return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
}

function captureMetadataBytes(value: unknown): Uint8Array {
  let isUint8Array = false;
  try {
    isUint8Array =
      ArrayBuffer.isView(value) &&
      Object.prototype.toString.call(value) === '[object Uint8Array]';
  } catch (cause) {
    fail(
      METADATA_CONTEXT,
      'Workspace metadata bytes could not be identified',
      undefined,
      cause,
    );
  }
  if (!isUint8Array) {
    fail(METADATA_CONTEXT, 'Workspace metadata bytes must be a Uint8Array');
  }
  let byteLength: number;
  try {
    byteLength = intrinsicUint8ArrayByteLength(value as Uint8Array);
  } catch (cause) {
    fail(
      METADATA_CONTEXT,
      'Workspace metadata bytes are detached or invalid',
      undefined,
      cause,
    );
  }
  if (
    byteLength >
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumMetadataBytes
  ) {
    fail(
      METADATA_CONTEXT,
      'Workspace metadata exceeds its byte limit',
      'limit-exceeded',
    );
  }
  try {
    return new Uint8Array(value as Uint8Array);
  } catch (cause) {
    fail(
      METADATA_CONTEXT,
      'Workspace metadata bytes could not be captured',
      undefined,
      cause,
    );
  }
}

function hasByteOrderMark(bytes: Uint8Array): boolean {
  return (
    (bytes.length >= 3 &&
      UTF8_BOM.every((byte, index) => bytes[index] === byte)) ||
    (bytes.length >= 2 &&
      ((bytes[0] === 0xff && bytes[1] === 0xfe) ||
        (bytes[0] === 0xfe && bytes[1] === 0xff))) ||
    (bytes.length >= 4 &&
      ((bytes[0] === 0x00 &&
        bytes[1] === 0x00 &&
        bytes[2] === 0xfe &&
        bytes[3] === 0xff) ||
        (bytes[0] === 0xff &&
          bytes[1] === 0xfe &&
          bytes[2] === 0x00 &&
          bytes[3] === 0x00)))
  );
}

export function encodeBrowserDirectoryWorkspaceMetadata(
  value: BrowserDirectoryWorkspaceMetadata,
): Uint8Array {
  const captured = captureMetadata(value, INPUT_CONTEXT);
  const bytes = new TextEncoder().encode(canonicalMetadataText(captured));
  if (
    bytes.byteLength >
    BROWSER_DIRECTORY_WORKSPACE_METADATA_LIMITS.maximumMetadataBytes
  ) {
    fail(
      INPUT_CONTEXT,
      'Workspace metadata exceeds its byte limit',
      'limit-exceeded',
    );
  }
  return bytes;
}

export function decodeBrowserDirectoryWorkspaceMetadata(
  value: Uint8Array,
): BrowserDirectoryWorkspaceMetadata {
  const bytes = captureMetadataBytes(value);
  if (hasByteOrderMark(bytes)) {
    fail(METADATA_CONTEXT, 'Workspace metadata must not contain a byte-order mark');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    fail(
      METADATA_CONTEXT,
      'Workspace metadata is not valid UTF-8',
      undefined,
      cause,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    fail(
      METADATA_CONTEXT,
      'Workspace metadata is not valid JSON',
      undefined,
      cause,
    );
  }
  const captured = captureMetadata(parsed, METADATA_CONTEXT);
  if (text !== canonicalMetadataText(captured)) {
    fail(
      METADATA_CONTEXT,
      'Workspace metadata JSON is not in canonical form',
      'noncanonical-metadata',
    );
  }
  return captured;
}
