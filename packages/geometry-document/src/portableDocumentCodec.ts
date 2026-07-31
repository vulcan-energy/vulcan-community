// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { strToU8, unzipSync, zipSync } from 'fflate';
import type { GeometryDocumentModel } from './contracts';
import { normalizeGeometryDocumentName } from './documentNaming';
import {
  findTabularGeometryCsvStart,
  isGeometryCsvSectionHeaderLine,
  isTabularGeometryCsvSectionHeaderLine,
  parseGeometryCsvLine,
} from './geometryCsvSections';
import {
  PORTABLE_GEOMETRY_DOCUMENT_FORMAT,
  PORTABLE_GEOMETRY_DOCUMENT_LIMITS,
  PORTABLE_GEOMETRY_DOCUMENT_VERSION,
  PortableGeometryDocumentError,
  type PortableGeometryDocument,
  type PortableGeometryDocumentDerivedResource,
  type PortableGeometryDocumentEncodeOptions,
  type PortableGeometryDocumentErrorCode,
  type PortableGeometryDocumentKnownDerivedRole,
  type PortableGeometryDocumentSourceFile,
  type PortableGeometryDocumentSourceRole,
} from './portableDocumentContracts';

const MODEL_ENTRY_PATH = 'model/model.csv';
const MANIFEST_ENTRY_PATH = 'manifest.json';
const MODEL_MEDIA_TYPE = 'text/csv;charset=utf-8';
const ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u;
const SLOT_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/u;
const ROLE_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/u;
const MEDIA_TYPE_PATTERN =
  /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[a-z0-9!#$&^_.+-]+=[a-z0-9!#$&^_.+-]+)*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const WINDOWS_DRIVE_PATH = /^[a-z]:/iu;
const LEGACY_PATH_METADATA_KEYS = new Set([
  'DefaultsPath',
  'GuideOverlay',
  'GuideOverlaySource',
  'JunctionPsiDefaultsPath',
]);
const RESERVED_ENTRY_SEGMENTS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
const FORWARD_SLASH = String.fromCodePoint(47);
const BACKSLASH = String.fromCodePoint(92);
const KNOWN_DERIVED_ROLES = new Set<PortableGeometryDocumentKnownDerivedRole>([
  'defaults',
  'junction-psi-defaults',
  'guide-overlay-state',
  'guide-overlay-image',
  'ifc-import-audit',
]);
const SOURCE_ROLES = new Set<PortableGeometryDocumentSourceRole>([
  'ifc',
  'guide-overlay-source',
]);
const SOURCE_MEDIA_TYPES = new Set([
  'application/ifc',
  'application/pdf',
  'application/step',
  'application/xml',
  'model/ifc',
  'text/ifc',
  'text/xml',
]);
const FflateUint8Array = strToU8('', true)
  .constructor as unknown as Uint8ArrayConstructor;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'byteLength',
)?.get;

type CapturedDerivedResource = Readonly<{
  id: string;
  slots: readonly string[];
  role: string;
  required: boolean;
  mediaType: string;
  bytes: Uint8Array;
}>;

type CapturedSourceFile = Readonly<{
  id: string;
  slots: readonly string[];
  role: PortableGeometryDocumentSourceRole;
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
}>;

type CapturedPortableDocument = Readonly<{
  model: GeometryDocumentModel;
  modelBytes: Uint8Array;
  derivedResources: readonly CapturedDerivedResource[];
  sourceFiles: readonly CapturedSourceFile[];
  includedSourceFileIds: readonly string[];
}>;

type ManifestModel = Readonly<{
  path: typeof MODEL_ENTRY_PATH;
  fileName: string;
  mediaType: typeof MODEL_MEDIA_TYPE;
  byteLength: number;
  sha256: string;
}>;

type ManifestDerivedResource = Readonly<{
  id: string;
  slots: readonly string[];
  role: string;
  required: boolean;
  path: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
}>;

type ManifestSourceFile = Readonly<{
  id: string;
  slots: readonly string[];
  role: PortableGeometryDocumentSourceRole;
  fileName: string;
  path: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
}>;

type PortableManifestV1 = Readonly<{
  format: typeof PORTABLE_GEOMETRY_DOCUMENT_FORMAT;
  formatVersion: typeof PORTABLE_GEOMETRY_DOCUMENT_VERSION;
  model: ManifestModel;
  derivedResources: readonly ManifestDerivedResource[];
  sourceFiles: readonly ManifestSourceFile[];
}>;

type EncodedPortableGeometryDocument = Readonly<{
  archive: Uint8Array;
  modelFileName: string;
  includedSourceFileIds: readonly string[];
}>;

function portableError(
  code: PortableGeometryDocumentErrorCode,
  message: string,
  details: ConstructorParameters<typeof PortableGeometryDocumentError>[2] = {},
): PortableGeometryDocumentError {
  return new PortableGeometryDocumentError(code, message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  code: 'invalid-input' | 'invalid-manifest',
  description: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw portableError(code, `${description} must be an object`);
  }
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  code: 'invalid-input' | 'invalid-manifest',
  description: string,
): void {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  if (
    actual.length !== canonicalExpected.length ||
    actual.some((key, index) => key !== canonicalExpected[index])
  ) {
    throw portableError(
      code,
      `${description} must contain exactly: ${canonicalExpected.join(', ')}`,
    );
  }
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

function requireCanonicalString(
  value: unknown,
  code: 'invalid-input' | 'invalid-manifest',
  description: string,
): string {
  if (
    typeof value !== 'string' ||
    !isWellFormedUnicode(value) ||
    value.normalize('NFC') !== value
  ) {
    throw portableError(
      code,
      `${description} must be a canonical NFC Unicode string`,
    );
  }
  return value;
}

function requireId(
  value: unknown,
  code: 'invalid-input' | 'invalid-manifest',
  description: string,
): string {
  const id = requireCanonicalString(value, code, description);
  if (!ID_PATTERN.test(id)) {
    throw portableError(code, `${description} must be a lowercase opaque id`);
  }
  return id;
}

function requireRole(
  value: unknown,
  code: 'invalid-input' | 'invalid-manifest',
  description: string,
): string {
  const role = requireCanonicalString(value, code, description);
  if (!ROLE_PATTERN.test(role)) {
    throw portableError(code, `${description} must be a lowercase role id`);
  }
  return role;
}

function requireMediaType(
  value: unknown,
  code: 'invalid-input' | 'invalid-manifest',
  description: string,
): string {
  const mediaType = requireCanonicalString(value, code, description);
  if (!MEDIA_TYPE_PATTERN.test(mediaType)) {
    throw portableError(code, `${description} must be a canonical media type`);
  }
  return mediaType;
}

function requireBoolean(
  value: unknown,
  code: 'invalid-input' | 'invalid-manifest',
  description: string,
): boolean {
  if (typeof value !== 'boolean') {
    throw portableError(code, `${description} must be a boolean`);
  }
  return value;
}

function requireByteLength(
  value: unknown,
  code: 'invalid-input' | 'invalid-manifest',
  description: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw portableError(code, `${description} must be a non-negative safe integer`);
  }
  return value as number;
}

function requireSha256(
  value: unknown,
  code: 'invalid-input' | 'invalid-manifest',
  description: string,
): string {
  const hash = requireCanonicalString(value, code, description);
  if (!SHA256_PATTERN.test(hash)) {
    throw portableError(code, `${description} must be a lowercase SHA-256 hash`);
  }
  return hash;
}

function requireFileName(
  value: unknown,
  code: 'invalid-input' | 'invalid-manifest',
  description: string,
  requireCsv: boolean,
): string {
  const fileName = requireCanonicalString(value, code, description);
  let normalized: string;
  try {
    normalized = normalizeGeometryDocumentName(fileName);
  } catch (cause) {
    throw portableError(code, `${description} must be a safe basename`, { cause });
  }
  if (normalized !== fileName) {
    throw portableError(code, `${description} must already be normalized`);
  }
  if (requireCsv && !fileName.toLowerCase().endsWith('.csv')) {
    throw portableError(code, `${description} must use the .csv extension`);
  }
  return fileName;
}

function requireSlots(
  value: unknown,
  code: 'invalid-input' | 'invalid-manifest',
  description: string,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw portableError(code, `${description} must be an array`);
  }
  if (
    value.length === 0 ||
    value.length > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumSlotsPerResource
  ) {
    throw portableError(
      code,
      `${description} must contain between 1 and ${PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumSlotsPerResource} entries`,
    );
  }
  const slots = Array.from(value, (rawSlot, index) => {
    const slot = requireCanonicalString(
      rawSlot,
      code,
      `${description}[${index}]`,
    );
    if (!SLOT_PATTERN.test(slot)) {
      throw portableError(code, `${description}[${index}] is not a safe slot id`);
    }
    return slot;
  }).sort(compareStrings);
  if (new Set(slots).size !== slots.length) {
    throw portableError(code, `${description} must not contain duplicate slots`);
  }
  return Object.freeze(slots);
}

function isUint8ArrayValue(value: unknown): value is Uint8Array {
  try {
    return (
      ArrayBuffer.isView(value) &&
      Object.prototype.toString.call(value) === '[object Uint8Array]'
    );
  } catch {
    return false;
  }
}

function intrinsicUint8ArrayByteLength(value: Uint8Array): number {
  if (typeof TYPED_ARRAY_BYTE_LENGTH_GETTER !== 'function') {
    throw new Error('Typed-array byte-length validation is unavailable');
  }
  return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
}

function requireBytes(
  value: unknown,
  description: string,
): Uint8Array {
  if (!isUint8ArrayValue(value)) {
    throw portableError('invalid-input', `${description} must be a Uint8Array`);
  }
  let byteLength: number;
  try {
    byteLength = intrinsicUint8ArrayByteLength(value);
  } catch (cause) {
    throw portableError('invalid-input', `${description} is detached or invalid`, {
      cause,
    });
  }
  if (byteLength > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumEntryBytes) {
    throw portableError('limit-exceeded', `${description} exceeds the entry limit`);
  }
  try {
    const captured = new Uint8Array(value);
    if (intrinsicUint8ArrayByteLength(captured) !== byteLength) {
      throw new Error('Typed-array byte length changed during capture');
    }
    return captured;
  } catch (cause) {
    throw portableError('invalid-input', `${description} could not be captured`, {
      cause,
    });
  }
}

function toFflateBytes(bytes: Uint8Array): Uint8Array {
  const compatible = new FflateUint8Array(bytes.byteLength);
  compatible.set(bytes);
  return compatible;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasReservedSourceSemantics(
  role: string,
  slots: readonly string[],
  mediaType: string,
): boolean {
  const roleSegments = role.split(/[.-]/u);
  const slotSegments = slots.flatMap((slot) => slot.split('.'));
  const sourceTokens = new Set(['original', 'raw', 'source']);
  const baseMediaType = mediaType.split(';', 1)[0]!;
  return (
    SOURCE_ROLES.has(role as PortableGeometryDocumentSourceRole) ||
    roleSegments.some((segment) => sourceTokens.has(segment)) ||
    slotSegments.some((segment) => sourceTokens.has(segment)) ||
    SOURCE_MEDIA_TYPES.has(baseMediaType)
  );
}

function rejectLegacyModelReferences(text: string): void {
  const lines = text
    .split(/\r\n|\n|\r/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines[0]?.startsWith('\ufeff')) lines[0] = lines[0].slice(1);

  const firstFields = lines.length === 0
    ? []
    : parseGeometryCsvLine(lines[0]!);
  const candidateLines = isGeometryCsvSectionHeaderLine(firstFields)
    ? isTabularGeometryCsvSectionHeaderLine(firstFields)
      ? []
      : lines.slice(0, findTabularGeometryCsvStart(lines))
    : lines;

  for (const line of candidateLines) {
    const firstField = (parseGeometryCsvLine(line)[0] ?? '').trim();
    if (LEGACY_PATH_METADATA_KEYS.has(firstField)) {
      throw portableError(
        'unsafe-model-reference',
        `Portable model CSV must replace ${firstField} with typed bundle resources`,
      );
    }
  }
}

function captureModel(value: unknown): Readonly<{
  model: GeometryDocumentModel;
  bytes: Uint8Array;
}> {
  const modelRecord = requireRecord(value, 'invalid-input', 'model');
  requireExactKeys(modelRecord, ['fileName', 'text'], 'invalid-input', 'model');
  const rawFileName = modelRecord.fileName;
  const rawText = modelRecord.text;
  const fileName = requireFileName(
    rawFileName,
    'invalid-input',
    'model.fileName',
    true,
  );
  if (typeof rawText !== 'string' || !isWellFormedUnicode(rawText)) {
    throw portableError(
      'invalid-input',
      'model.text must be a well-formed Unicode string',
    );
  }
  const text = rawText;
  rejectLegacyModelReferences(text);
  const bytes = strToU8(text);
  if (bytes.byteLength > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumModelBytes) {
    throw portableError('limit-exceeded', 'Portable model CSV exceeds the model limit');
  }
  return Object.freeze({
    model: Object.freeze({ fileName, text }),
    bytes,
  });
}

function captureDerivedResources(value: unknown): readonly CapturedDerivedResource[] {
  if (!Array.isArray(value)) {
    throw portableError('invalid-input', 'derivedResources must be an array');
  }
  if (value.length + 2 > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumEntries) {
    throw portableError('limit-exceeded', 'Portable document has too many resources');
  }
  const ids = new Set<string>();
  const slots = new Set<string>();
  const captured = Array.from(value, (rawResource, index) => {
    const resource = requireRecord(
      rawResource,
      'invalid-input',
      `derivedResources[${index}]`,
    );
    requireExactKeys(
      resource,
      ['id', 'slots', 'role', 'required', 'mediaType', 'bytes'],
      'invalid-input',
      `derivedResources[${index}]`,
    );
    const rawId = resource.id;
    const rawSlots = resource.slots;
    const rawRole = resource.role;
    const rawRequired = resource.required;
    const rawMediaType = resource.mediaType;
    const rawBytes = resource.bytes;
    const id = requireId(rawId, 'invalid-input', `derivedResources[${index}].id`);
    const resourceSlots = requireSlots(
      rawSlots,
      'invalid-input',
      `derivedResources[${index}].slots`,
    );
    const role = requireRole(
      rawRole,
      'invalid-input',
      `derivedResources[${index}].role`,
    );
    const required = requireBoolean(
      rawRequired,
      'invalid-input',
      `derivedResources[${index}].required`,
    );
    const mediaType = requireMediaType(
      rawMediaType,
      'invalid-input',
      `derivedResources[${index}].mediaType`,
    );
    const bytes = requireBytes(rawBytes, `derivedResources[${index}].bytes`);
    if (ids.has(id)) {
      throw portableError('invalid-input', `Duplicate derived resource id ${id}`, {
        resourceId: id,
      });
    }
    if (hasReservedSourceSemantics(role, resourceSlots, mediaType)) {
      throw portableError(
        'invalid-input',
        `Source semantics cannot be encoded as derived resource ${id}`,
        { resourceId: id },
      );
    }
    if (required && !KNOWN_DERIVED_ROLES.has(role as PortableGeometryDocumentKnownDerivedRole)) {
      throw portableError(
        'unsupported-feature',
        `Unknown required derived resource role ${role}`,
        { resourceId: id },
      );
    }
    for (const slot of resourceSlots) {
      if (slots.has(slot)) {
        throw portableError('invalid-input', `Duplicate derived resource slot ${slot}`);
      }
      slots.add(slot);
    }
    ids.add(id);
    return Object.freeze({ id, slots: resourceSlots, role, required, mediaType, bytes });
  });
  captured.sort((left, right) => compareStrings(left.id, right.id));
  return Object.freeze(captured);
}

function captureSourceSelection(
  options: PortableGeometryDocumentEncodeOptions | undefined,
): readonly string[] {
  if (options === undefined) return Object.freeze([]);
  const record = requireRecord(options, 'invalid-input', 'encode options');
  const optionKeys = Object.keys(record);
  if (optionKeys.some((key) => key !== 'includeSourceFileIds')) {
    throw portableError(
      'invalid-input',
      'encode options may contain only includeSourceFileIds',
    );
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'includeSourceFileIds')) {
    return Object.freeze([]);
  }
  const rawIds = record.includeSourceFileIds;
  if (rawIds === undefined) return Object.freeze([]);
  if (!Array.isArray(rawIds)) {
    throw portableError(
      'invalid-source-selection',
      'includeSourceFileIds must be an array',
    );
  }
  const ids = Array.from(rawIds, (rawId, index) =>
    requireId(
      rawId,
      'invalid-input',
      `includeSourceFileIds[${index}]`,
    ),
  ).sort(compareStrings);
  if (new Set(ids).size !== ids.length) {
    throw portableError(
      'invalid-source-selection',
      'includeSourceFileIds must not contain duplicates',
    );
  }
  return Object.freeze(ids);
}

function captureSourceFiles(
  documentRecord: Record<string, unknown>,
  selectedIds: readonly string[] | null,
  derivedResources: readonly CapturedDerivedResource[],
): readonly CapturedSourceFile[] {
  if (selectedIds !== null && selectedIds.length === 0) {
    return Object.freeze([]);
  }
  const rawSourceFiles = documentRecord.sourceFiles;
  if (!Array.isArray(rawSourceFiles)) {
    throw portableError('invalid-input', 'sourceFiles must be an array');
  }
  if (
    selectedIds === null &&
    rawSourceFiles.length + derivedResources.length + 2 >
    PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumEntries
  ) {
    throw portableError('limit-exceeded', 'Portable document has too many resources');
  }
  const selected = selectedIds === null ? null : new Set(selectedIds);
  const found = new Set<string>();
  const derivedIds = new Set(derivedResources.map((resource) => resource.id));
  const derivedSlots = new Set(
    derivedResources.flatMap((resource) => [...resource.slots]),
  );
  const captured: CapturedSourceFile[] = [];

  for (let index = 0; index < rawSourceFiles.length; index += 1) {
    const source = requireRecord(
      rawSourceFiles[index],
      'invalid-input',
      `sourceFiles[${index}]`,
    );
    const rawId = source.id;
    const id = requireId(rawId, 'invalid-input', `sourceFiles[${index}].id`);
    if (selected !== null && !selected.has(id)) continue;
    if (found.has(id)) {
      throw portableError(
        'invalid-source-selection',
        `Selected source id ${id} is ambiguous`,
        { resourceId: id },
      );
    }
    requireExactKeys(
      source,
      ['id', 'slots', 'role', 'fileName', 'mediaType', 'bytes'],
      'invalid-input',
      `sourceFiles[${index}]`,
    );
    const rawSlots = source.slots;
    const rawRole = source.role;
    const rawFileName = source.fileName;
    const rawMediaType = source.mediaType;
    const rawBytes = source.bytes;
    const sourceSlots = requireSlots(
      rawSlots,
      'invalid-input',
      `sourceFiles[${index}].slots`,
    );
    const role = requireRole(
      rawRole,
      'invalid-input',
      `sourceFiles[${index}].role`,
    );
    if (!SOURCE_ROLES.has(role as PortableGeometryDocumentSourceRole)) {
      throw portableError(
        'invalid-input',
        `Unknown source file role ${role}`,
        { resourceId: id },
      );
    }
    const fileName = requireFileName(
      rawFileName,
      'invalid-input',
      `sourceFiles[${index}].fileName`,
      false,
    );
    const mediaType = requireMediaType(
      rawMediaType,
      'invalid-input',
      `sourceFiles[${index}].mediaType`,
    );
    const bytes = requireBytes(rawBytes, `sourceFiles[${index}].bytes`);
    if (derivedIds.has(id)) {
      throw portableError('invalid-input', `Resource id ${id} is not unique`, {
        resourceId: id,
      });
    }
    for (const slot of sourceSlots) {
      if (derivedSlots.has(slot)) {
        throw portableError('invalid-input', `Resource slot ${slot} is not unique`);
      }
      derivedSlots.add(slot);
    }
    found.add(id);
    captured.push(
      Object.freeze({
        id,
        slots: sourceSlots,
        role: role as PortableGeometryDocumentSourceRole,
        fileName,
        mediaType,
        bytes,
      }),
    );
  }

  if (selectedIds !== null) {
    for (const selectedId of selectedIds) {
      if (!found.has(selectedId)) {
        throw portableError(
          'invalid-source-selection',
          `Unknown selected source id ${selectedId}`,
          { resourceId: selectedId },
        );
      }
    }
  }
  captured.sort((left, right) => compareStrings(left.id, right.id));
  return Object.freeze(captured);
}

function assertCapturedPayloadLimits(
  modelBytes: Uint8Array,
  derivedResources: readonly CapturedDerivedResource[],
  sourceFiles: readonly CapturedSourceFile[],
): void {
  if (
    derivedResources.length + sourceFiles.length + 2 >
    PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumEntries
  ) {
    throw portableError('limit-exceeded', 'Portable document has too many entries');
  }
  const totalPayloadBytes =
    modelBytes.byteLength +
    derivedResources.reduce(
      (total, resource) => total + resource.bytes.byteLength,
      0,
    ) +
    sourceFiles.reduce(
      (total, source) => total + source.bytes.byteLength,
      0,
    );
  if (
    totalPayloadBytes >
    PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumTotalUncompressedBytes
  ) {
    throw portableError(
      'limit-exceeded',
      'Portable document exceeds the total uncompressed limit',
    );
  }
}

function capturePortableDocument(
  document: PortableGeometryDocument,
  options: PortableGeometryDocumentEncodeOptions | undefined,
): CapturedPortableDocument {
  const documentRecord = requireRecord(document, 'invalid-input', 'document');
  requireExactKeys(
    documentRecord,
    ['model', 'derivedResources', 'sourceFiles'],
    'invalid-input',
    'document',
  );
  const rawModel = documentRecord.model;
  const rawDerivedResources = documentRecord.derivedResources;
  const selectedIds = captureSourceSelection(options);
  const capturedModel = captureModel(rawModel);
  const derivedResources = captureDerivedResources(rawDerivedResources);
  const sourceFiles = captureSourceFiles(
    documentRecord,
    selectedIds,
    derivedResources,
  );
  assertCapturedPayloadLimits(
    capturedModel.bytes,
    derivedResources,
    sourceFiles,
  );
  return Object.freeze({
    model: capturedModel.model,
    modelBytes: capturedModel.bytes,
    derivedResources,
    sourceFiles,
    includedSourceFileIds: Object.freeze([...selectedIds]),
  });
}

/** Explicitly captures every local resource, including source files. */
export function capturePortableGeometryDocumentResources(
  derivedResourcesInput: unknown,
  sourceFilesInput: unknown,
): Readonly<{
  derivedResources: readonly PortableGeometryDocumentDerivedResource[];
  sourceFiles: readonly PortableGeometryDocumentSourceFile[];
}> {
  const derivedResources = captureDerivedResources(derivedResourcesInput);
  const sourceFiles = captureSourceFiles(
    { sourceFiles: sourceFilesInput },
    null,
    derivedResources,
  );
  assertCapturedPayloadLimits(
    new FflateUint8Array(0),
    derivedResources,
    sourceFiles,
  );
  return Object.freeze({ derivedResources, sourceFiles });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw portableError(
      'unsupported-feature',
      'SHA-256 Web Crypto support is required for portable documents',
    );
  }
  let digest: ArrayBuffer;
  try {
    const copy = bytes.slice();
    digest = await subtle.digest('SHA-256', copy.buffer);
  } catch (cause) {
    throw portableError('unsupported-feature', 'Could not calculate SHA-256', {
      cause,
    });
  }
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function derivedEntryPath(id: string): string {
  return `derived/${id}`;
}

function sourceEntryPath(id: string): string {
  return `sources/${id}`;
}

function canonicalManifestText(manifest: PortableManifestV1): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function encodePortableGeometryDocumentWithMetadata(
  document: PortableGeometryDocument,
  options?: PortableGeometryDocumentEncodeOptions,
): Promise<EncodedPortableGeometryDocument> {
  const captured = capturePortableDocument(document, options);
  const [modelHash, derivedHashes, sourceHashes] = await Promise.all([
    sha256(captured.modelBytes),
    Promise.all(captured.derivedResources.map((resource) => sha256(resource.bytes))),
    Promise.all(captured.sourceFiles.map((source) => sha256(source.bytes))),
  ]);

  const model: ManifestModel = Object.freeze({
    path: MODEL_ENTRY_PATH,
    fileName: captured.model.fileName,
    mediaType: MODEL_MEDIA_TYPE,
    byteLength: captured.modelBytes.byteLength,
    sha256: modelHash,
  });
  const derivedResources = Object.freeze(
    captured.derivedResources.map((resource, index): ManifestDerivedResource =>
      Object.freeze({
        id: resource.id,
        slots: resource.slots,
        role: resource.role,
        required: resource.required,
        path: derivedEntryPath(resource.id),
        mediaType: resource.mediaType,
        byteLength: resource.bytes.byteLength,
        sha256: derivedHashes[index]!,
      }),
    ),
  );
  const sourceFiles = Object.freeze(
    captured.sourceFiles.map((source, index): ManifestSourceFile =>
      Object.freeze({
        id: source.id,
        slots: source.slots,
        role: source.role,
        fileName: source.fileName,
        path: sourceEntryPath(source.id),
        mediaType: source.mediaType,
        byteLength: source.bytes.byteLength,
        sha256: sourceHashes[index]!,
      }),
    ),
  );
  const manifest: PortableManifestV1 = Object.freeze({
    format: PORTABLE_GEOMETRY_DOCUMENT_FORMAT,
    formatVersion: PORTABLE_GEOMETRY_DOCUMENT_VERSION,
    model,
    derivedResources,
    sourceFiles,
  });
  const manifestBytes = toFflateBytes(
    strToU8(canonicalManifestText(manifest)),
  );
  if (
    manifestBytes.byteLength >
    PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumManifestBytes
  ) {
    throw portableError('limit-exceeded', 'Portable manifest exceeds the limit');
  }
  const entries: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >;
  entries[MANIFEST_ENTRY_PATH] = manifestBytes;
  entries[MODEL_ENTRY_PATH] = toFflateBytes(captured.modelBytes);
  for (const resource of captured.derivedResources) {
    entries[derivedEntryPath(resource.id)] = toFflateBytes(resource.bytes);
  }
  for (const source of captured.sourceFiles) {
    entries[sourceEntryPath(source.id)] = toFflateBytes(source.bytes);
  }

  let archive: Uint8Array;
  try {
    archive = zipSync(entries, {
      level: 0,
      mtime: new Date(1980, 0, 1, 0, 0, 0),
      os: 0,
    });
  } catch (cause) {
    throw portableError('invalid-input', 'Could not create portable ZIP archive', {
      cause,
    });
  }
  if (archive.byteLength > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumArchiveBytes) {
    throw portableError('limit-exceeded', 'Portable ZIP archive exceeds the limit');
  }
  return Object.freeze({
    archive,
    modelFileName: captured.model.fileName,
    includedSourceFileIds: captured.includedSourceFileIds,
  });
}

export async function encodePortableGeometryDocument(
  document: PortableGeometryDocument,
  options?: PortableGeometryDocumentEncodeOptions,
): Promise<Uint8Array> {
  return (await encodePortableGeometryDocumentWithMetadata(document, options)).archive;
}

function validateEntryPath(path: string): void {
  if (
    path.length === 0 ||
    path.length > 512 ||
    !isWellFormedUnicode(path) ||
    path.normalize('NFC') !== path ||
    path.startsWith(FORWARD_SLASH) ||
    path.includes(BACKSLASH) ||
    WINDOWS_DRIVE_PATH.test(path) ||
    path.endsWith(FORWARD_SLASH)
  ) {
    throw portableError('unsafe-entry-path', `Unsafe ZIP entry path ${path}`, {
      entryPath: path,
    });
  }
  const segments = path.split(FORWARD_SLASH);
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        RESERVED_ENTRY_SEGMENTS.has(segment) ||
        [...segment].some((character) => {
          const codePoint = character.codePointAt(0)!;
          return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
        }),
    )
  ) {
    throw portableError('unsafe-entry-path', `Unsafe ZIP entry path ${path}`, {
      entryPath: path,
    });
  }
}

function unzipPortableArchive(archive: Uint8Array): Record<string, Uint8Array> {
  if (!isUint8ArrayValue(archive)) {
    throw portableError('invalid-archive', 'Portable archive must be a Uint8Array');
  }
  const captured = archive.slice();
  if (captured.byteLength > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumArchiveBytes) {
    throw portableError('limit-exceeded', 'Portable ZIP archive exceeds the limit');
  }
  const seenPaths = new Set<string>();
  let entryCount = 0;
  let totalUncompressed = 0;
  try {
    const files = unzipSync(captured, {
      filter: (entry) => {
        validateEntryPath(entry.name);
        if (seenPaths.has(entry.name)) {
          throw portableError(
            'duplicate-entry',
            `Duplicate ZIP entry ${entry.name}`,
            { entryPath: entry.name },
          );
        }
        seenPaths.add(entry.name);
        entryCount += 1;
        if (entryCount > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumEntries) {
          throw portableError('limit-exceeded', 'Portable ZIP has too many entries');
        }
        if (entry.compression !== 0) {
          throw portableError(
            'unsupported-feature',
            `Portable document v1 requires ZIP STORE entries; received method ${entry.compression}`,
            { entryPath: entry.name },
          );
        }
        if (entry.size !== entry.originalSize) {
          throw portableError(
            'invalid-archive',
            'ZIP STORE entry sizes do not agree',
            { entryPath: entry.name },
          );
        }
        if (entry.originalSize > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumEntryBytes) {
          throw portableError('limit-exceeded', 'Portable ZIP entry exceeds the limit', {
            entryPath: entry.name,
          });
        }
        totalUncompressed += entry.originalSize;
        if (
          totalUncompressed >
          PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumTotalUncompressedBytes
        ) {
          throw portableError(
            'limit-exceeded',
            'Portable ZIP exceeds the uncompressed limit',
          );
        }
        return true;
      },
    });
    return files;
  } catch (error) {
    if (error instanceof PortableGeometryDocumentError) throw error;
    throw portableError('invalid-archive', 'Could not read portable ZIP archive', {
      cause: error,
    });
  }
}

function parseManifest(files: Record<string, Uint8Array>): PortableManifestV1 {
  const manifestBytes = files[MANIFEST_ENTRY_PATH];
  if (manifestBytes === undefined) {
    throw portableError('missing-entry', 'Portable ZIP is missing manifest.json', {
      entryPath: MANIFEST_ENTRY_PATH,
    });
  }
  if (
    manifestBytes.byteLength >
    PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumManifestBytes
  ) {
    throw portableError('limit-exceeded', 'Portable manifest exceeds the limit', {
      entryPath: MANIFEST_ENTRY_PATH,
    });
  }
  let raw: unknown;
  try {
    const manifestText = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(manifestBytes);
    raw = JSON.parse(manifestText);
  } catch (cause) {
    throw portableError('invalid-manifest', 'Portable manifest is not valid UTF-8 JSON', {
      entryPath: MANIFEST_ENTRY_PATH,
      cause,
    });
  }
  const manifest = requireRecord(raw, 'invalid-manifest', 'manifest');
  const rawFormat = manifest.format;
  const rawVersion = manifest.formatVersion;
  if (rawFormat !== PORTABLE_GEOMETRY_DOCUMENT_FORMAT) {
    throw portableError('invalid-manifest', 'Unknown portable document format');
  }
  if (rawVersion !== PORTABLE_GEOMETRY_DOCUMENT_VERSION) {
    throw portableError(
      'unsupported-version',
      `Unsupported portable document version ${String(rawVersion)}`,
    );
  }
  requireExactKeys(
    manifest,
    ['format', 'formatVersion', 'model', 'derivedResources', 'sourceFiles'],
    'invalid-manifest',
    'manifest',
  );
  const model = parseManifestModel(manifest.model);
  const derivedResources = parseManifestDerivedResources(manifest.derivedResources);
  const sourceFiles = parseManifestSourceFiles(manifest.sourceFiles);
  if (
    derivedResources.length + sourceFiles.length + 2 >
    PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumEntries
  ) {
    throw portableError('limit-exceeded', 'Portable manifest declares too many entries');
  }
  const ids = new Set(derivedResources.map((resource) => resource.id));
  const slots = new Set(
    derivedResources.flatMap((resource) => [...resource.slots]),
  );
  for (const source of sourceFiles) {
    if (ids.has(source.id)) {
      throw portableError('invalid-manifest', `Duplicate resource id ${source.id}`, {
        resourceId: source.id,
      });
    }
    ids.add(source.id);
    for (const slot of source.slots) {
      if (slots.has(slot)) {
        throw portableError('invalid-manifest', `Duplicate resource slot ${slot}`);
      }
      slots.add(slot);
    }
  }
  return Object.freeze({
    format: PORTABLE_GEOMETRY_DOCUMENT_FORMAT,
    formatVersion: PORTABLE_GEOMETRY_DOCUMENT_VERSION,
    model,
    derivedResources,
    sourceFiles,
  });
}

function parseManifestModel(value: unknown): ManifestModel {
  const model = requireRecord(value, 'invalid-manifest', 'manifest.model');
  requireExactKeys(
    model,
    ['path', 'fileName', 'mediaType', 'byteLength', 'sha256'],
    'invalid-manifest',
    'manifest.model',
  );
  if (model.path !== MODEL_ENTRY_PATH) {
    throw portableError('invalid-manifest', 'Portable model path must be model/model.csv');
  }
  const fileName = requireFileName(
    model.fileName,
    'invalid-manifest',
    'manifest.model.fileName',
    true,
  );
  if (model.mediaType !== MODEL_MEDIA_TYPE) {
    throw portableError('invalid-manifest', 'Portable model media type is invalid');
  }
  const byteLength = requireByteLength(
    model.byteLength,
    'invalid-manifest',
    'manifest.model.byteLength',
  );
  if (byteLength > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumModelBytes) {
    throw portableError('limit-exceeded', 'Portable model CSV exceeds the model limit');
  }
  const hash = requireSha256(
    model.sha256,
    'invalid-manifest',
    'manifest.model.sha256',
  );
  return Object.freeze({
    path: MODEL_ENTRY_PATH,
    fileName,
    mediaType: MODEL_MEDIA_TYPE,
    byteLength,
    sha256: hash,
  });
}

function parseManifestDerivedResources(
  value: unknown,
): readonly ManifestDerivedResource[] {
  if (!Array.isArray(value)) {
    throw portableError('invalid-manifest', 'derivedResources must be an array');
  }
  const ids = new Set<string>();
  const slots = new Set<string>();
  const resources = Array.from(value, (rawResource, index) => {
    const resource = requireRecord(
      rawResource,
      'invalid-manifest',
      `derivedResources[${index}]`,
    );
    requireExactKeys(
      resource,
      ['id', 'slots', 'role', 'required', 'path', 'mediaType', 'byteLength', 'sha256'],
      'invalid-manifest',
      `derivedResources[${index}]`,
    );
    const id = requireId(resource.id, 'invalid-manifest', `derivedResources[${index}].id`);
    const resourceSlots = requireSlots(
      resource.slots,
      'invalid-manifest',
      `derivedResources[${index}].slots`,
    );
    const role = requireRole(
      resource.role,
      'invalid-manifest',
      `derivedResources[${index}].role`,
    );
    const required = requireBoolean(
      resource.required,
      'invalid-manifest',
      `derivedResources[${index}].required`,
    );
    const path = requireCanonicalString(
      resource.path,
      'invalid-manifest',
      `derivedResources[${index}].path`,
    );
    if (path !== derivedEntryPath(id)) {
      throw portableError('invalid-manifest', `Derived resource ${id} has an invalid path`, {
        resourceId: id,
        entryPath: path,
      });
    }
    const mediaType = requireMediaType(
      resource.mediaType,
      'invalid-manifest',
      `derivedResources[${index}].mediaType`,
    );
    const byteLength = requireByteLength(
      resource.byteLength,
      'invalid-manifest',
      `derivedResources[${index}].byteLength`,
    );
    if (byteLength > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumEntryBytes) {
      throw portableError('limit-exceeded', `Derived resource ${id} exceeds the entry limit`, {
        resourceId: id,
      });
    }
    const hash = requireSha256(
      resource.sha256,
      'invalid-manifest',
      `derivedResources[${index}].sha256`,
    );
    if (ids.has(id)) {
      throw portableError('invalid-manifest', `Duplicate derived resource id ${id}`, {
        resourceId: id,
      });
    }
    if (hasReservedSourceSemantics(role, resourceSlots, mediaType)) {
      throw portableError(
        'invalid-manifest',
        `Source semantics cannot be declared as derived resource ${id}`,
        { resourceId: id },
      );
    }
    if (required && !KNOWN_DERIVED_ROLES.has(role as PortableGeometryDocumentKnownDerivedRole)) {
      throw portableError(
        'unsupported-feature',
        `Unknown required derived resource role ${role}`,
        { resourceId: id },
      );
    }
    for (const slot of resourceSlots) {
      if (slots.has(slot)) {
        throw portableError('invalid-manifest', `Duplicate derived resource slot ${slot}`);
      }
      slots.add(slot);
    }
    ids.add(id);
    return Object.freeze({
      id,
      slots: resourceSlots,
      role,
      required,
      path,
      mediaType,
      byteLength,
      sha256: hash,
    });
  });
  resources.sort((left, right) => compareStrings(left.id, right.id));
  return Object.freeze(resources);
}

function parseManifestSourceFiles(value: unknown): readonly ManifestSourceFile[] {
  if (!Array.isArray(value)) {
    throw portableError('invalid-manifest', 'sourceFiles must be an array');
  }
  const ids = new Set<string>();
  const slots = new Set<string>();
  const sources = Array.from(value, (rawSource, index) => {
    const source = requireRecord(
      rawSource,
      'invalid-manifest',
      `sourceFiles[${index}]`,
    );
    requireExactKeys(
      source,
      ['id', 'slots', 'role', 'fileName', 'path', 'mediaType', 'byteLength', 'sha256'],
      'invalid-manifest',
      `sourceFiles[${index}]`,
    );
    const id = requireId(source.id, 'invalid-manifest', `sourceFiles[${index}].id`);
    const sourceSlots = requireSlots(
      source.slots,
      'invalid-manifest',
      `sourceFiles[${index}].slots`,
    );
    const role = requireRole(
      source.role,
      'invalid-manifest',
      `sourceFiles[${index}].role`,
    );
    if (!SOURCE_ROLES.has(role as PortableGeometryDocumentSourceRole)) {
      throw portableError('unsupported-feature', `Unknown source file role ${role}`, {
        resourceId: id,
      });
    }
    const fileName = requireFileName(
      source.fileName,
      'invalid-manifest',
      `sourceFiles[${index}].fileName`,
      false,
    );
    const path = requireCanonicalString(
      source.path,
      'invalid-manifest',
      `sourceFiles[${index}].path`,
    );
    if (path !== sourceEntryPath(id)) {
      throw portableError('invalid-manifest', `Source file ${id} has an invalid path`, {
        resourceId: id,
        entryPath: path,
      });
    }
    const mediaType = requireMediaType(
      source.mediaType,
      'invalid-manifest',
      `sourceFiles[${index}].mediaType`,
    );
    const byteLength = requireByteLength(
      source.byteLength,
      'invalid-manifest',
      `sourceFiles[${index}].byteLength`,
    );
    if (byteLength > PORTABLE_GEOMETRY_DOCUMENT_LIMITS.maximumEntryBytes) {
      throw portableError('limit-exceeded', `Source file ${id} exceeds the entry limit`, {
        resourceId: id,
      });
    }
    const hash = requireSha256(
      source.sha256,
      'invalid-manifest',
      `sourceFiles[${index}].sha256`,
    );
    if (ids.has(id)) {
      throw portableError('invalid-manifest', `Duplicate source file id ${id}`, {
        resourceId: id,
      });
    }
    for (const slot of sourceSlots) {
      if (slots.has(slot)) {
        throw portableError('invalid-manifest', `Duplicate source file slot ${slot}`);
      }
      slots.add(slot);
    }
    ids.add(id);
    return Object.freeze({
      id,
      slots: sourceSlots,
      role: role as PortableGeometryDocumentSourceRole,
      fileName,
      path,
      mediaType,
      byteLength,
      sha256: hash,
    });
  });
  sources.sort((left, right) => compareStrings(left.id, right.id));
  return Object.freeze(sources);
}

function requireExactEntries(
  files: Record<string, Uint8Array>,
  manifest: PortableManifestV1,
): void {
  const declared = new Set<string>([
    MANIFEST_ENTRY_PATH,
    manifest.model.path,
    ...manifest.derivedResources.map((resource) => resource.path),
    ...manifest.sourceFiles.map((source) => source.path),
  ]);
  for (const path of Object.keys(files)) {
    if (!declared.has(path)) {
      throw portableError('unexpected-entry', `Unexpected ZIP entry ${path}`, {
        entryPath: path,
      });
    }
  }
  for (const path of declared) {
    if (files[path] === undefined) {
      throw portableError('missing-entry', `Missing ZIP entry ${path}`, {
        entryPath: path,
      });
    }
  }
}

async function verifyEntry(
  bytes: Uint8Array,
  expectedLength: number,
  expectedHash: string,
  path: string,
): Promise<void> {
  if (bytes.byteLength !== expectedLength) {
    throw portableError('integrity-failed', `Byte length mismatch for ${path}`, {
      entryPath: path,
    });
  }
  if ((await sha256(bytes)) !== expectedHash) {
    throw portableError('integrity-failed', `SHA-256 mismatch for ${path}`, {
      entryPath: path,
    });
  }
}

function decodedResourceWithOwnedBytes<T extends object>(
  metadata: T,
  bytes: Uint8Array,
): Readonly<T & { bytes: Uint8Array }> {
  const storedBytes = bytes.slice();
  const captured = { ...metadata } as T & { bytes?: Uint8Array };
  Object.defineProperty(captured, 'bytes', {
    enumerable: true,
    configurable: false,
    get: () => storedBytes.slice(),
  });
  return Object.freeze(captured) as Readonly<T & { bytes: Uint8Array }>;
}

export async function decodePortableGeometryDocument(
  archive: Uint8Array,
): Promise<PortableGeometryDocument> {
  const archiveSnapshot = isUint8ArrayValue(archive)
    ? Uint8Array.from(archive)
    : archive;
  const files = unzipPortableArchive(archive);
  const manifest = parseManifest(files);
  requireExactEntries(files, manifest);

  const modelBytes = files[manifest.model.path]!;
  const derivedBytes = manifest.derivedResources.map(
    (resource) => files[resource.path]!.slice(),
  );
  const sourceBytes = manifest.sourceFiles.map(
    (source) => files[source.path]!.slice(),
  );
  await Promise.all([
    verifyEntry(
      modelBytes,
      manifest.model.byteLength,
      manifest.model.sha256,
      manifest.model.path,
    ),
    ...manifest.derivedResources.map((resource, index) =>
      verifyEntry(
        derivedBytes[index]!,
        resource.byteLength,
        resource.sha256,
        resource.path,
      ),
    ),
    ...manifest.sourceFiles.map((source, index) =>
      verifyEntry(
        sourceBytes[index]!,
        source.byteLength,
        source.sha256,
        source.path,
      ),
    ),
  ]);

  let modelText: string;
  try {
    modelText = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(modelBytes);
  } catch (cause) {
    throw portableError('integrity-failed', 'Portable model is not valid UTF-8', {
      entryPath: manifest.model.path,
      cause,
    });
  }
  if (!isWellFormedUnicode(modelText)) {
    throw portableError('integrity-failed', 'Portable model text is not well-formed Unicode', {
      entryPath: manifest.model.path,
    });
  }
  rejectLegacyModelReferences(modelText);

  const derivedResources = Object.freeze(
    manifest.derivedResources.map(
      (resource, index): PortableGeometryDocumentDerivedResource =>
        decodedResourceWithOwnedBytes(
          {
            id: resource.id,
            slots: resource.slots,
            role: resource.role,
            required: resource.required,
            mediaType: resource.mediaType,
          },
          derivedBytes[index]!,
        ),
    ),
  );
  const sourceFiles = Object.freeze(
    manifest.sourceFiles.map(
      (source, index): PortableGeometryDocumentSourceFile =>
        decodedResourceWithOwnedBytes(
          {
            id: source.id,
            slots: source.slots,
            role: source.role,
            fileName: source.fileName,
            mediaType: source.mediaType,
          },
          sourceBytes[index]!,
        ),
    ),
  );
  const decoded = Object.freeze({
    model: Object.freeze({
      fileName: manifest.model.fileName,
      text: modelText,
    }),
    derivedResources,
    sourceFiles,
  });
  const canonicalArchive = await encodePortableGeometryDocument(decoded, {
    includeSourceFileIds: sourceFiles.map((source) => source.id),
  });
  if (
    !isUint8ArrayValue(archiveSnapshot) ||
    canonicalArchive.byteLength !== archiveSnapshot.byteLength ||
    canonicalArchive.some((byte, index) => byte !== archiveSnapshot[index])
  ) {
    throw portableError(
      'invalid-archive',
      'Portable document archive is not in canonical v1 form',
    );
  }
  return decoded;
}
