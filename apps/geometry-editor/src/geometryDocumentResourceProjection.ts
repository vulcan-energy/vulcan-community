// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometryDocumentContents,
  GeometryDocumentDerivedResource,
  GeometryDocumentKnownDerivedResourceRole,
  GeometryDocumentSourceFile,
  GeometryDocumentSourceFileRole,
} from '../../../packages/geometry-document/src/contracts';
import { normalizeGeometryDocumentName } from '../../../packages/geometry-document/src/documentNaming';
import type { GeometryWorkspaceResourcePort } from '../../../packages/geometry-editor-host/src/workspaceResourcePort';
import {
  decodeGuideOverlayMetadataValue,
  decodeGuideOverlaySourceMetadataValue,
  encodeGuideOverlayMetadataValue,
  encodeGuideOverlaySourceMetadataValue,
  type GuideOverlay,
  type GuideOverlaySource,
} from '../../../packages/geometry-editor/src/geometry/guideOverlay';
import {
  findTabularGeometryCsvStart,
  isSectionHeaderLine,
  parseCsvLine,
} from '../../../packages/geometry-editor/src/geometry/io/csvSectionRows';

const PATH_METADATA_KEYS = new Set([
  'DefaultsPath',
  'GuideOverlay',
  'GuideOverlaySource',
  'JunctionPsiDefaultsPath',
] as const);

const OWNED_DERIVED_ROLES = new Set<GeometryDocumentKnownDerivedResourceRole>([
  'defaults',
  'junction-psi-defaults',
  'guide-overlay-state',
  'guide-overlay-image',
]);
const OWNED_SOURCE_ROLES = new Set<GeometryDocumentSourceFileRole>([
  'guide-overlay-source',
]);
const OWNED_SLOT_PREFIXES = [
  'model.defaults',
  'model.junction-psi-defaults',
  'guide-overlay.',
] as const;
const OWNED_FIXED_IDS = new Set([
  'model-defaults',
  'junction-psi-defaults',
  'guide-overlay-state',
]);
const OWNED_DYNAMIC_ID = /^guide-overlay-(?:image|source)-\d+$/u;
const VIRTUAL_ROOT = '__vulcan_document__';
const GUIDE_STATE_FORMAT = 'vulcan-geometry-guide-overlay-state';
const GUIDE_STATE_VERSION = 1;

type PathMetadataKey = typeof PATH_METADATA_KEYS extends Set<infer Key>
  ? Key
  : never;

export type GeometryDocumentResourceProjectionErrorCode =
  | 'invalid-metadata'
  | 'invalid-resource'
  | 'resource-conflict'
  | 'resource-read-failed';

export type GeometryDocumentResourceProjectionErrorDetails = Readonly<{
  metadataKey?: PathMetadataKey;
  path?: string;
  resourceId?: string;
  cause?: unknown;
}>;

export class GeometryDocumentResourceProjectionError extends Error {
  readonly code: GeometryDocumentResourceProjectionErrorCode;
  readonly metadataKey?: PathMetadataKey;
  readonly path?: string;
  readonly resourceId?: string;
  readonly cause?: unknown;

  constructor(
    code: GeometryDocumentResourceProjectionErrorCode,
    message: string,
    details: GeometryDocumentResourceProjectionErrorDetails = {},
  ) {
    super(message);
    this.name = 'GeometryDocumentResourceProjectionError';
    this.code = code;
    this.metadataKey = details.metadataKey;
    this.path = details.path;
    this.resourceId = details.resourceId;
    this.cause = details.cause;
  }
}

export type GeometryDocumentVirtualResourceRegistration = Readonly<{
  path: string;
  fileName: string;
  kind: 'derived' | 'source';
  resourceId: string;
  mediaType: string;
  /** Owned by this projection result. */
  bytes: Uint8Array;
}>;

export type GeometryDocumentEditorProjection = Readonly<{
  contents: GeometryDocumentContents;
  registrations: readonly GeometryDocumentVirtualResourceRegistration[];
}>;

type CsvRecord = Readonly<{
  line: string;
  ending: string;
}>;

type GuideRow<T> = Readonly<{
  floorIndex: number;
  value: T;
}>;

type EditorReferences = Readonly<{
  forbiddenRowCount: number;
  sanitizedText: string;
  defaultsPath?: string;
  junctionPsiDefaultsPath?: string;
  overlays: readonly GuideRow<GuideOverlay>[];
  overlaySources: readonly GuideRow<GuideOverlaySource>[];
}>;

/** Exact workspace paths carried by the editor CSV path-metadata rows. */
export function geometryDocumentWorkspaceReferencePaths(
  contents: Pick<GeometryDocumentContents, 'text'>,
): readonly string[] {
  const references = parseEditorReferences(contents.text);
  return Object.freeze([...new Set([
    references.defaultsPath,
    references.junctionPsiDefaultsPath,
    ...references.overlays.map(({ value }) => value.path),
    ...references.overlaySources.flatMap(({ value }) => [
      value.source_path,
      value.derived_overlay_path,
    ]),
  ].filter((path): path is string => path !== undefined))]);
}

type GuideStateOverlay = Readonly<{
  imageResourceId: string;
  opacity01: number;
  pos_m: Readonly<{ x: number; y: number }>;
  pxPerM?: number;
  calibration?: Readonly<{
    a_world_m: Readonly<{ x: number; y: number }>;
    b_world_m: Readonly<{ x: number; y: number }>;
    real_m: number;
  }>;
}>;

type GuideStateSource = Readonly<{
  sourceResourceId: string;
  imageResourceId: string;
  kind: 'image' | 'pdf';
  page?: number;
}>;

type GuideStateFloor = Readonly<{
  floorIndex: number;
  overlay?: GuideStateOverlay;
  source?: GuideStateSource;
}>;

type GuideState = Readonly<{
  format: typeof GUIDE_STATE_FORMAT;
  formatVersion: typeof GUIDE_STATE_VERSION;
  floors: readonly GuideStateFloor[];
}>;

function projectionError(
  code: GeometryDocumentResourceProjectionErrorCode,
  message: string,
  details: GeometryDocumentResourceProjectionErrorDetails = {},
): GeometryDocumentResourceProjectionError {
  return new GeometryDocumentResourceProjectionError(code, message, details);
}

function splitCsvRecords(value: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  const matcher = /([^\r\n]*)(\r\n|\n|\r|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(value)) !== null) {
    if (match[0] === '') break;
    records.push({ line: match[1]!, ending: match[2]! });
    if (match[2] === '') break;
  }
  return records;
}

function firstField(record: CsvRecord, index: number): string {
  const line = index === 0 && record.line.startsWith('\ufeff')
    ? record.line.slice(1)
    : record.line;
  return (parseCsvLine(line)[0] ?? '').trim();
}

function nonBlankPath(
  fields: readonly string[],
  metadataKey: PathMetadataKey,
  fieldIndex = 1,
): string {
  const value = (fields[fieldIndex] ?? '').trim();
  if (!value) {
    throw projectionError(
      'invalid-metadata',
      `${metadataKey} must reference a non-blank workspace path`,
      { metadataKey },
    );
  }
  return value;
}

function setSingletonPath(
  current: string | undefined,
  next: string,
  metadataKey: PathMetadataKey,
): string {
  if (current !== undefined) {
    throw projectionError(
      'invalid-metadata',
      `${metadataKey} must appear at most once`,
      { metadataKey, path: next },
    );
  }
  return next;
}

function parseGuideFloor(
  fields: readonly string[],
  metadataKey: 'GuideOverlay' | 'GuideOverlaySource',
): Readonly<{ floorIndex: number; payload: string }> {
  const second = (fields[1] ?? '').trim();
  const currentFormat = /^-?\d+$/u.test(second);
  const floorIndex = currentFormat ? Number.parseInt(second, 10) : 0;
  const payload = (fields[currentFormat ? 2 : 1] ?? '').trim();
  if (!Number.isSafeInteger(floorIndex) || !payload) {
    throw projectionError(
      'invalid-metadata',
      `${metadataKey} contains an invalid floor or payload`,
      { metadataKey },
    );
  }
  return { floorIndex, payload };
}

function parseEditorReferences(csv: string): EditorReferences {
  const records = splitCsvRecords(csv);
  const nonEmptyRecords = records
    .map((record, index) => ({ index, line: record.line.trim() }))
    .filter(({ line }) => line.length > 0)
    .map((entry, index) => ({
      ...entry,
      line: index === 0 && entry.line.startsWith('\ufeff')
        ? entry.line.slice(1)
        : entry.line,
    }));
  const tabularStart = findTabularGeometryCsvStart(
    nonEmptyRecords.map(({ line }) => line),
  );
  const metadataRecordIndexes = new Set(
    nonEmptyRecords.slice(0, tabularStart).map(({ index }) => index),
  );
  const retained: CsvRecord[] = [];
  const overlays = new Map<number, GuideOverlay>();
  const overlaySources = new Map<number, GuideOverlaySource>();
  let defaultsPath: string | undefined;
  let junctionPsiDefaultsPath: string | undefined;
  let forbiddenRowCount = 0;

  records.forEach((record, index) => {
    const key = firstField(record, index);
    if (
      !metadataRecordIndexes.has(index) ||
      !PATH_METADATA_KEYS.has(key as PathMetadataKey)
    ) {
      retained.push(record);
      return;
    }
    const metadataKey = key as PathMetadataKey;
    const line = index === 0 && record.line.startsWith('\ufeff')
      ? record.line.slice(1)
      : record.line;
    const fields = parseCsvLine(line);
    forbiddenRowCount += 1;

    switch (metadataKey) {
      case 'DefaultsPath':
        defaultsPath = setSingletonPath(
          defaultsPath,
          nonBlankPath(fields, metadataKey),
          metadataKey,
        );
        break;
      case 'JunctionPsiDefaultsPath':
        junctionPsiDefaultsPath = setSingletonPath(
          junctionPsiDefaultsPath,
          nonBlankPath(fields, metadataKey),
          metadataKey,
        );
        break;
      case 'GuideOverlay': {
        const { floorIndex, payload } = parseGuideFloor(fields, metadataKey);
        const overlay = decodeGuideOverlayMetadataValue(payload);
        if (!overlay || overlays.has(floorIndex)) {
          throw projectionError(
            'invalid-metadata',
            `GuideOverlay for floor ${floorIndex} is malformed or duplicated`,
            { metadataKey, path: overlay?.path },
          );
        }
        overlays.set(floorIndex, overlay);
        break;
      }
      case 'GuideOverlaySource': {
        const { floorIndex, payload } = parseGuideFloor(fields, metadataKey);
        const source = decodeGuideOverlaySourceMetadataValue(payload);
        if (!source || overlaySources.has(floorIndex)) {
          throw projectionError(
            'invalid-metadata',
            `GuideOverlaySource for floor ${floorIndex} is malformed or duplicated`,
            { metadataKey, path: source?.source_path },
          );
        }
        overlaySources.set(floorIndex, source);
        break;
      }
    }
  });

  return {
    forbiddenRowCount,
    sanitizedText: retained.map(({ line, ending }) => `${line}${ending}`).join(''),
    defaultsPath,
    junctionPsiDefaultsPath,
    overlays: [...overlays.entries()]
      .sort(([left], [right]) => left - right)
      .map(([floorIndex, value]) => ({ floorIndex, value })),
    overlaySources: [...overlaySources.entries()]
      .sort(([left], [right]) => left - right)
      .map(([floorIndex, value]) => ({ floorIndex, value })),
  };
}

function ownsSlot(slot: string): boolean {
  return OWNED_SLOT_PREFIXES.some((prefix) =>
    prefix.endsWith('.') ? slot.startsWith(prefix) : slot === prefix,
  );
}

function ownsId(id: string): boolean {
  return OWNED_FIXED_IDS.has(id) || OWNED_DYNAMIC_ID.test(id);
}

function assertNoProjectionConflict(
  derivedResources: readonly GeometryDocumentDerivedResource[],
  sourceFiles: readonly GeometryDocumentSourceFile[],
): void {
  for (const resource of derivedResources) {
    if (OWNED_DERIVED_ROLES.has(resource.role as GeometryDocumentKnownDerivedResourceRole)) {
      continue;
    }
    if (ownsId(resource.id) || resource.slots.some(ownsSlot)) {
      throw projectionError(
        'resource-conflict',
        `Derived resource ${resource.id} occupies a document-projection identifier or slot`,
        { resourceId: resource.id },
      );
    }
  }
  for (const source of sourceFiles) {
    if (OWNED_SOURCE_ROLES.has(source.role)) continue;
    if (ownsId(source.id) || source.slots.some(ownsSlot)) {
      throw projectionError(
        'resource-conflict',
        `Source resource ${source.id} occupies a document-projection identifier or slot`,
        { resourceId: source.id },
      );
    }
  }
}

function cloneDerived(resource: GeometryDocumentDerivedResource): GeometryDocumentDerivedResource {
  return {
    ...resource,
    slots: [...resource.slots],
    bytes: Uint8Array.from(resource.bytes),
  };
}

function cloneSource(source: GeometryDocumentSourceFile): GeometryDocumentSourceFile {
  return {
    ...source,
    slots: [...source.slots],
    bytes: Uint8Array.from(source.bytes),
  };
}

async function readRequiredFile(
  port: GeometryWorkspaceResourcePort,
  metadataKey: PathMetadataKey,
  path: string,
): Promise<Readonly<{ bytes: Uint8Array; mediaType: string; fileName: string }>> {
  try {
    const resource = await port.readFile(path);
    return {
      bytes: new Uint8Array(await resource.arrayBuffer()),
      mediaType: resource.type,
      fileName: resource.name,
    };
  } catch (cause) {
    throw projectionError(
      'resource-read-failed',
      `Could not read ${metadataKey} workspace resource at ${path}`,
      { metadataKey, path, cause },
    );
  }
}

function fallbackMediaType(path: string, current: string, fallback: string): string {
  if (current.trim()) return current.trim().toLowerCase();
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.xml')) return 'application/xml';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.csv')) return 'text/csv';
  return fallback;
}

function safeSourceName(name: string, path: string): string {
  try {
    return normalizeGeometryDocumentName(name);
  } catch (cause) {
    throw projectionError(
      'invalid-metadata',
      `Guide overlay source has an unsafe file name: ${name}`,
      { metadataKey: 'GuideOverlaySource', path, cause },
    );
  }
}

function floorSlot(floorIndex: number): string {
  return floorIndex < 0 ? `negative-${Math.abs(floorIndex)}` : String(floorIndex);
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function compareResourceId(
  left: Readonly<{ id: string }>,
  right: Readonly<{ id: string }>,
): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function assertUniqueResources(
  derivedResources: readonly GeometryDocumentDerivedResource[],
  sourceFiles: readonly GeometryDocumentSourceFile[],
): void {
  const ids = new Set<string>();
  const slots = new Set<string>();
  for (const resource of [...derivedResources, ...sourceFiles]) {
    if (ids.has(resource.id)) {
      throw projectionError(
        'resource-conflict',
        `Document projection produced duplicate resource id ${resource.id}`,
        { resourceId: resource.id },
      );
    }
    ids.add(resource.id);
    for (const slot of resource.slots) {
      if (slots.has(slot)) {
        throw projectionError(
          'resource-conflict',
          `Document projection produced duplicate resource slot ${slot}`,
          { resourceId: resource.id },
        );
      }
      slots.add(slot);
    }
  }
}

/**
 * Resolves editor-only workspace paths into durable typed resources. The input
 * remains the canonical editor CSV; only the returned copy is safe for a
 * workspace provider or portable bundle.
 */
export async function projectEditorGeometryDocumentToDurable(
  contents: GeometryDocumentContents,
  workspaceResourcePort: GeometryWorkspaceResourcePort,
): Promise<GeometryDocumentContents> {
  const references = parseEditorReferences(contents.text);
  assertNoProjectionConflict(contents.derivedResources, contents.sourceFiles);
  const derivedResources = contents.derivedResources
    .filter((resource) =>
      !OWNED_DERIVED_ROLES.has(resource.role as GeometryDocumentKnownDerivedResourceRole),
    )
    .map(cloneDerived);
  const sourceFiles = contents.sourceFiles
    .filter((source) => !OWNED_SOURCE_ROLES.has(source.role))
    .map(cloneSource);

  if (references.defaultsPath) {
    const resource = await readRequiredFile(
      workspaceResourcePort,
      'DefaultsPath',
      references.defaultsPath,
    );
    derivedResources.push({
      id: 'model-defaults',
      slots: ['model.defaults'],
      role: 'defaults',
      required: true,
      mediaType: fallbackMediaType(
        references.defaultsPath,
        resource.mediaType,
        'application/json',
      ),
      bytes: resource.bytes,
    });
  }

  if (references.junctionPsiDefaultsPath) {
    const resource = await readRequiredFile(
      workspaceResourcePort,
      'JunctionPsiDefaultsPath',
      references.junctionPsiDefaultsPath,
    );
    derivedResources.push({
      id: 'junction-psi-defaults',
      slots: ['model.junction-psi-defaults'],
      role: 'junction-psi-defaults',
      required: true,
      mediaType: fallbackMediaType(
        references.junctionPsiDefaultsPath,
        resource.mediaType,
        'text/csv',
      ),
      bytes: resource.bytes,
    });
  }

  const overlaysByFloor = new Map(
    references.overlays.map(({ floorIndex, value }) => [floorIndex, value]),
  );
  const sourcesByFloor = new Map(
    references.overlaySources.map(({ floorIndex, value }) => [floorIndex, value]),
  );
  for (const [floorIndex, source] of sourcesByFloor) {
    const overlay = overlaysByFloor.get(floorIndex);
    if (overlay && overlay.path !== source.derived_overlay_path) {
      throw projectionError(
        'invalid-metadata',
        `Guide overlay and source paths disagree for floor ${floorIndex}`,
        { metadataKey: 'GuideOverlaySource', path: source.derived_overlay_path },
      );
    }
  }

  const guideFloors = [...new Set([
    ...overlaysByFloor.keys(),
    ...sourcesByFloor.keys(),
  ])].sort((left, right) => left - right);
  if (guideFloors.length > 0) {
    const imagePaths = new Map<string, { id: string; floors: number[] }>();
    const sourcePaths = new Map<
      string,
      { id: string; floors: number[]; kind: 'image' | 'pdf'; fileName: string }
    >();

    for (const floorIndex of guideFloors) {
      const overlay = overlaysByFloor.get(floorIndex);
      const source = sourcesByFloor.get(floorIndex);
      const imagePath = overlay?.path ?? source?.derived_overlay_path;
      if (!imagePath) {
        throw projectionError(
          'invalid-metadata',
          `Guide overlay floor ${floorIndex} has no derived image path`,
          { metadataKey: 'GuideOverlay' },
        );
      }
      let image = imagePaths.get(imagePath);
      if (!image) {
        image = { id: `guide-overlay-image-${imagePaths.size + 1}`, floors: [] };
        imagePaths.set(imagePath, image);
      }
      image.floors.push(floorIndex);

      if (source) {
        const fileName = safeSourceName(source.source_filename, source.source_path);
        let sourceResource = sourcePaths.get(source.source_path);
        if (!sourceResource) {
          sourceResource = {
            id: `guide-overlay-source-${sourcePaths.size + 1}`,
            floors: [],
            kind: source.kind,
            fileName,
          };
          sourcePaths.set(source.source_path, sourceResource);
        } else if (
          sourceResource.kind !== source.kind || sourceResource.fileName !== fileName
        ) {
          throw projectionError(
            'invalid-metadata',
            `Guide overlay source path has conflicting metadata: ${source.source_path}`,
            { metadataKey: 'GuideOverlaySource', path: source.source_path },
          );
        }
        sourceResource.floors.push(floorIndex);
      }
    }

    for (const [path, image] of imagePaths) {
      const resource = await readRequiredFile(workspaceResourcePort, 'GuideOverlay', path);
      derivedResources.push({
        id: image.id,
        slots: image.floors.map(
          (floorIndex) => `guide-overlay.image.floor-${floorSlot(floorIndex)}`,
        ),
        role: 'guide-overlay-image',
        required: true,
        mediaType: fallbackMediaType(path, resource.mediaType, 'application/octet-stream'),
        bytes: resource.bytes,
      });
    }
    for (const [path, source] of sourcePaths) {
      const resource = await readRequiredFile(
        workspaceResourcePort,
        'GuideOverlaySource',
        path,
      );
      sourceFiles.push({
        id: source.id,
        slots: source.floors.map(
          (floorIndex) => `guide-overlay.source.floor-${floorSlot(floorIndex)}`,
        ),
        role: 'guide-overlay-source',
        fileName: source.fileName,
        mediaType: fallbackMediaType(
          path,
          resource.mediaType,
          source.kind === 'pdf' ? 'application/pdf' : 'application/octet-stream',
        ),
        bytes: resource.bytes,
      });
    }

    const state: GuideState = {
      format: GUIDE_STATE_FORMAT,
      formatVersion: GUIDE_STATE_VERSION,
      floors: guideFloors.map((floorIndex) => {
        const overlay = overlaysByFloor.get(floorIndex);
        const source = sourcesByFloor.get(floorIndex);
        const imagePath = overlay?.path ?? source!.derived_overlay_path;
        const imageResourceId = imagePaths.get(imagePath)!.id;
        const sourceResourceId = source
          ? sourcePaths.get(source.source_path)!.id
          : undefined;
        return {
          floorIndex,
          ...(overlay
            ? {
                overlay: {
                  imageResourceId,
                  opacity01: overlay.opacity01,
                  pos_m: { ...overlay.pos_m },
                  ...(overlay.pxPerM === undefined ? {} : { pxPerM: overlay.pxPerM }),
                  ...(overlay.calibration === undefined
                    ? {}
                    : {
                        calibration: {
                          a_world_m: { ...overlay.calibration.a_world_m },
                          b_world_m: { ...overlay.calibration.b_world_m },
                          real_m: overlay.calibration.real_m,
                        },
                      }),
                },
              }
            : {}),
          ...(source && sourceResourceId
            ? {
                source: {
                  sourceResourceId,
                  imageResourceId,
                  kind: source.kind,
                  ...(source.page === undefined ? {} : { page: source.page }),
                },
              }
            : {}),
        };
      }),
    };
    derivedResources.push({
      id: 'guide-overlay-state',
      slots: ['guide-overlay.state'],
      role: 'guide-overlay-state',
      required: true,
      mediaType: 'application/json',
      bytes: jsonBytes(state),
    });
  }

  derivedResources.sort(compareResourceId);
  sourceFiles.sort(compareResourceId);
  assertUniqueResources(derivedResources, sourceFiles);
  return {
    fileName: contents.fileName,
    text: references.sanitizedText,
    derivedResources,
    sourceFiles,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, description: string, resourceId: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw projectionError(
      'invalid-resource',
      `${description} must be a finite number`,
      { resourceId },
    );
  }
  return value;
}

function point(value: unknown, description: string, resourceId: string): { x: number; y: number } {
  if (!isRecord(value)) {
    throw projectionError('invalid-resource', `${description} must be an object`, {
      resourceId,
    });
  }
  return {
    x: finiteNumber(value.x, `${description}.x`, resourceId),
    y: finiteNumber(value.y, `${description}.y`, resourceId),
  };
}

function resourceId(value: unknown, description: string, ownerId: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw projectionError(
      'invalid-resource',
      `${description} must be a resource id`,
      { resourceId: ownerId },
    );
  }
  return value;
}

function parseGuideState(resource: GeometryDocumentDerivedResource): GuideState {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(resource.bytes));
  } catch (cause) {
    throw projectionError(
      'invalid-resource',
      `Guide overlay state ${resource.id} is not valid UTF-8 JSON`,
      { resourceId: resource.id, cause },
    );
  }
  if (
    !isRecord(raw)
    || raw.format !== GUIDE_STATE_FORMAT
    || raw.formatVersion !== GUIDE_STATE_VERSION
    || !Array.isArray(raw.floors)
  ) {
    throw projectionError(
      'invalid-resource',
      `Guide overlay state ${resource.id} has an unsupported format`,
      { resourceId: resource.id },
    );
  }
  const seenFloors = new Set<number>();
  const floors = raw.floors.map((rawFloor, index): GuideStateFloor => {
    if (!isRecord(rawFloor)) {
      throw projectionError(
        'invalid-resource',
        `Guide overlay floor ${index} must be an object`,
        { resourceId: resource.id },
      );
    }
    const floorIndex = rawFloor.floorIndex;
    if (!Number.isSafeInteger(floorIndex) || seenFloors.has(floorIndex as number)) {
      throw projectionError(
        'invalid-resource',
        `Guide overlay state contains an invalid or duplicate floor`,
        { resourceId: resource.id },
      );
    }
    seenFloors.add(floorIndex as number);
    let overlay: GuideStateOverlay | undefined;
    if (rawFloor.overlay !== undefined) {
      if (!isRecord(rawFloor.overlay)) {
        throw projectionError('invalid-resource', 'Guide overlay entry must be an object', {
          resourceId: resource.id,
        });
      }
      const rawOverlay = rawFloor.overlay;
      let calibration: GuideStateOverlay['calibration'];
      if (rawOverlay.calibration !== undefined) {
        if (!isRecord(rawOverlay.calibration)) {
          throw projectionError(
            'invalid-resource',
            'Guide overlay calibration must be an object',
            { resourceId: resource.id },
          );
        }
        calibration = {
          a_world_m: point(
            rawOverlay.calibration.a_world_m,
            'Guide overlay calibration.a_world_m',
            resource.id,
          ),
          b_world_m: point(
            rawOverlay.calibration.b_world_m,
            'Guide overlay calibration.b_world_m',
            resource.id,
          ),
          real_m: finiteNumber(
            rawOverlay.calibration.real_m,
            'Guide overlay calibration.real_m',
            resource.id,
          ),
        };
      }
      overlay = {
        imageResourceId: resourceId(
          rawOverlay.imageResourceId,
          'Guide overlay imageResourceId',
          resource.id,
        ),
        opacity01: finiteNumber(
          rawOverlay.opacity01,
          'Guide overlay opacity01',
          resource.id,
        ),
        pos_m: point(rawOverlay.pos_m, 'Guide overlay pos_m', resource.id),
        ...(rawOverlay.pxPerM === undefined
          ? {}
          : {
              pxPerM: finiteNumber(
                rawOverlay.pxPerM,
                'Guide overlay pxPerM',
                resource.id,
              ),
            }),
        ...(calibration === undefined ? {} : { calibration }),
      };
    }
    let source: GuideStateSource | undefined;
    if (rawFloor.source !== undefined) {
      if (!isRecord(rawFloor.source)) {
        throw projectionError('invalid-resource', 'Guide overlay source entry must be an object', {
          resourceId: resource.id,
        });
      }
      const rawSource = rawFloor.source;
      if (rawSource.kind !== 'image' && rawSource.kind !== 'pdf') {
        throw projectionError('invalid-resource', 'Guide overlay source kind is invalid', {
          resourceId: resource.id,
        });
      }
      const page = rawSource.page;
      if (
        rawSource.kind === 'pdf'
        && (!Number.isSafeInteger(page) || (page as number) <= 0)
      ) {
        throw projectionError(
          'invalid-resource',
          'Guide overlay PDF source page must be a positive integer',
          { resourceId: resource.id },
        );
      }
      source = {
        sourceResourceId: resourceId(
          rawSource.sourceResourceId,
          'Guide overlay sourceResourceId',
          resource.id,
        ),
        imageResourceId: resourceId(
          rawSource.imageResourceId,
          'Guide overlay source imageResourceId',
          resource.id,
        ),
        kind: rawSource.kind,
        ...(page === undefined ? {} : { page: page as number }),
      };
    }
    if (!overlay && !source) {
      throw projectionError(
        'invalid-resource',
        `Guide overlay floor ${String(floorIndex)} has no overlay or source`,
        { resourceId: resource.id },
      );
    }
    return { floorIndex: floorIndex as number, overlay, source };
  });
  return {
    format: GUIDE_STATE_FORMAT,
    formatVersion: GUIDE_STATE_VERSION,
    floors: floors.sort((left, right) => left.floorIndex - right.floorIndex),
  };
}

function extensionForMediaType(mediaType: string): string {
  switch (mediaType.split(';', 1)[0]!.toLowerCase()) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/webp': return '.webp';
    case 'application/json': return '.json';
    case 'text/csv': return '.csv';
    case 'application/pdf': return '.pdf';
    case 'application/xml':
    case 'text/xml': return '.xml';
    default: return '.bin';
  }
}

function registrationPathForSource(source: GeometryDocumentSourceFile): string {
  return `${VIRTUAL_ROOT}/sources/${source.id}/${source.fileName}`;
}

function derivedRegistrationPath(
  resource: GeometryDocumentDerivedResource,
): string {
  switch (resource.role) {
    case 'defaults': return `${VIRTUAL_ROOT}/derived/model-defaults.json`;
    case 'junction-psi-defaults': return `${VIRTUAL_ROOT}/derived/junction-psi-defaults.csv`;
    case 'guide-overlay-state': return `${VIRTUAL_ROOT}/derived/guide-overlay-state.json`;
    case 'guide-overlay-image':
      return `${VIRTUAL_ROOT}/derived/${resource.id}${extensionForMediaType(resource.mediaType)}`;
    default:
      return `${VIRTUAL_ROOT}/derived/${resource.id}${extensionForMediaType(resource.mediaType)}`;
  }
}

function csvField(value: string | number): string {
  const raw = String(value);
  return /[",\r\n]/u.test(raw) ? `"${raw.replace(/"/gu, '""')}"` : raw;
}

function metadataRow(key: PathMetadataKey, ...values: readonly (string | number)[]): string {
  return [key, ...values].map(csvField).join(',');
}

function addMetadataRows(csv: string, rows: readonly string[]): string {
  if (rows.length === 0) return csv;
  const records = splitCsvRecords(csv);
  const firstNonEmptyIndex = records.findIndex(
    (record) => record.line.trim().length > 0,
  );
  const firstNonEmptyRecord = records[firstNonEmptyIndex];
  const firstNonEmptyLine = firstNonEmptyRecord === undefined
    ? ''
    : firstNonEmptyIndex === 0 && firstNonEmptyRecord.line.startsWith('\ufeff')
      ? firstNonEmptyRecord.line.slice(1)
      : firstNonEmptyRecord.line;
  const firstNonEmptyFields = parseCsvLine(firstNonEmptyLine);
  const metadataIndex = firstNonEmptyIndex >= 0
    && isSectionHeaderLine(firstNonEmptyFields)
    && firstNonEmptyFields[0]!.trim() === 'Metadata'
    ? firstNonEmptyIndex
    : -1;
  const preferredEnding = records.find((record) => record.ending)?.ending ?? '\n';
  const additions = rows.map((line) => `${line}${preferredEnding}`).join('');
  if (metadataIndex < 0) {
    return `Metadata,${preferredEnding}${additions}${csv}`;
  }
  const metadata = records[metadataIndex]!;
  const insertionOffset = records
    .slice(0, metadataIndex + 1)
    .reduce((total, record) => total + record.line.length + record.ending.length, 0);
  const separator = metadata.ending === '' ? preferredEnding : '';
  return `${csv.slice(0, insertionOffset)}${separator}${additions}${csv.slice(insertionOffset)}`;
}

function oneDerivedRole(
  resources: readonly GeometryDocumentDerivedResource[],
  role: GeometryDocumentKnownDerivedResourceRole,
): GeometryDocumentDerivedResource | undefined {
  const matches = resources.filter((resource) => resource.role === role);
  if (matches.length > 1) {
    throw projectionError(
      'resource-conflict',
      `Durable document contains multiple ${role} resources`,
      { resourceId: matches[1]!.id },
    );
  }
  return matches[0];
}

/**
 * Hydrates durable typed resources into virtual workspace paths understood by
 * the canonical editor. The caller can expose `registrations` through a
 * resource-port decorator; this function performs no filesystem operation.
 */
export function projectDurableGeometryDocumentToEditor(
  contents: GeometryDocumentContents,
): GeometryDocumentEditorProjection {
  const parsed = parseEditorReferences(contents.text);
  if (parsed.forbiddenRowCount > 0) {
    throw projectionError(
      'invalid-resource',
      'Durable geometry document must not contain workspace path metadata rows',
    );
  }
  assertUniqueResources(contents.derivedResources, contents.sourceFiles);

  const sourcePathById = new Map<string, string>();
  for (const source of contents.sourceFiles) {
    const path = registrationPathForSource(source);
    sourcePathById.set(source.id, path);
  }
  const derivedPathById = new Map<string, string>();
  for (const resource of contents.derivedResources) {
    derivedPathById.set(
      resource.id,
      derivedRegistrationPath(resource),
    );
  }

  const registrations: GeometryDocumentVirtualResourceRegistration[] = [
    ...contents.derivedResources.map((resource) => {
      const path = derivedPathById.get(resource.id)!;
      return {
        path,
        fileName: path.slice(path.lastIndexOf('/') + 1),
        kind: 'derived' as const,
        resourceId: resource.id,
        mediaType: resource.mediaType,
        bytes: Uint8Array.from(resource.bytes),
      };
    }),
    ...contents.sourceFiles.map((source) => ({
      path: sourcePathById.get(source.id)!,
      fileName: source.fileName,
      kind: 'source' as const,
      resourceId: source.id,
      mediaType: source.mediaType,
      bytes: Uint8Array.from(source.bytes),
    })),
  ];
  const registrationPaths = new Set<string>();
  for (const registration of registrations) {
    if (registrationPaths.has(registration.path)) {
      throw projectionError(
        'resource-conflict',
        `Durable resources map to the same virtual path ${registration.path}`,
        { resourceId: registration.resourceId, path: registration.path },
      );
    }
    registrationPaths.add(registration.path);
  }

  const rows: string[] = [];
  const defaults = oneDerivedRole(contents.derivedResources, 'defaults');
  if (defaults) rows.push(metadataRow('DefaultsPath', derivedPathById.get(defaults.id)!));
  const junctionDefaults = oneDerivedRole(
    contents.derivedResources,
    'junction-psi-defaults',
  );
  if (junctionDefaults) {
    rows.push(
      metadataRow(
        'JunctionPsiDefaultsPath',
        derivedPathById.get(junctionDefaults.id)!,
      ),
    );
  }

  const guideStateResource = oneDerivedRole(
    contents.derivedResources,
    'guide-overlay-state',
  );
  const hasGuidePayload = contents.derivedResources.some(
    (resource) => resource.role === 'guide-overlay-image',
  ) || contents.sourceFiles.some((source) => source.role === 'guide-overlay-source');
  if (!guideStateResource && hasGuidePayload) {
    throw projectionError(
      'invalid-resource',
      'Guide overlay image/source resources require one guide-overlay-state resource',
    );
  }
  if (guideStateResource) {
    const state = parseGuideState(guideStateResource);
    const derivedById = new Map(
      contents.derivedResources.map((resource) => [resource.id, resource]),
    );
    const sourceById = new Map(contents.sourceFiles.map((source) => [source.id, source]));
    for (const floor of state.floors) {
      if (floor.overlay) {
        const image = derivedById.get(floor.overlay.imageResourceId);
        if (!image || image.role !== 'guide-overlay-image') {
          throw projectionError(
            'invalid-resource',
            `Guide overlay floor ${floor.floorIndex} references a missing image`,
            { resourceId: floor.overlay.imageResourceId },
          );
        }
        const overlay: GuideOverlay = {
          path: derivedPathById.get(image.id)!,
          opacity01: floor.overlay.opacity01,
          pos_m: { ...floor.overlay.pos_m },
          ...(floor.overlay.pxPerM === undefined ? {} : { pxPerM: floor.overlay.pxPerM }),
          ...(floor.overlay.calibration === undefined
            ? {}
            : {
                calibration: {
                  a_world_m: { ...floor.overlay.calibration.a_world_m },
                  b_world_m: { ...floor.overlay.calibration.b_world_m },
                  real_m: floor.overlay.calibration.real_m,
                },
              }),
        };
        rows.push(
          metadataRow(
            'GuideOverlay',
            floor.floorIndex,
            encodeGuideOverlayMetadataValue(overlay),
          ),
        );
      }
      if (floor.source) {
        const image = derivedById.get(floor.source.imageResourceId);
        if (!image || image.role !== 'guide-overlay-image') {
          throw projectionError(
            'invalid-resource',
            `Guide overlay source floor ${floor.floorIndex} references a missing image`,
            { resourceId: floor.source.imageResourceId },
          );
        }
        const source = sourceById.get(floor.source.sourceResourceId);
        // Source files are deliberately optional in portable downloads. The
        // derived overlay remains usable when the original source is absent.
        if (!source) continue;
        if (source.role !== 'guide-overlay-source') {
          throw projectionError(
            'invalid-resource',
            `Guide overlay source floor ${floor.floorIndex} references the wrong source role`,
            { resourceId: source.id },
          );
        }
        const hydratedSource: GuideOverlaySource = {
          kind: floor.source.kind,
          source_path: sourcePathById.get(source.id)!,
          source_filename: source.fileName,
          ...(floor.source.page === undefined ? {} : { page: floor.source.page }),
          derived_overlay_path: derivedPathById.get(image.id)!,
        };
        rows.push(
          metadataRow(
            'GuideOverlaySource',
            floor.floorIndex,
            encodeGuideOverlaySourceMetadataValue(hydratedSource),
          ),
        );
      }
    }
  }

  return {
    contents: {
      fileName: contents.fileName,
      text: addMetadataRows(contents.text, rows),
      derivedResources: contents.derivedResources.map(cloneDerived),
      sourceFiles: contents.sourceFiles.map(cloneSource),
    },
    registrations,
  };
}
