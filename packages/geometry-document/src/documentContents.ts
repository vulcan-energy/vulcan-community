// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometryDocumentContents,
  GeometryDocumentDerivedResource,
  GeometryDocumentInput,
  GeometryDocumentSourceFile,
} from './contracts';
import { capturePortableGeometryDocumentResources } from './portableDocumentCodec';
import type { PortableGeometryDocument } from './portableDocumentContracts';

const EMPTY_RESOURCES = Object.freeze([]);

function ownedBytesAccessor(bytes: Uint8Array): PropertyDescriptor {
  const stored = Uint8Array.from(bytes);
  return {
    enumerable: true,
    configurable: false,
    get: () => stored.slice(),
  };
}

function immutableDerivedResource(
  resource: GeometryDocumentDerivedResource,
): GeometryDocumentDerivedResource {
  const captured = {
    id: resource.id,
    slots: Object.freeze([...resource.slots]),
    role: resource.role,
    required: resource.required,
    mediaType: resource.mediaType,
  } as Omit<GeometryDocumentDerivedResource, 'bytes'> &
    Partial<Pick<GeometryDocumentDerivedResource, 'bytes'>>;
  Object.defineProperty(captured, 'bytes', ownedBytesAccessor(resource.bytes));
  return Object.freeze(captured) as GeometryDocumentDerivedResource;
}

function immutableSourceFile(
  source: GeometryDocumentSourceFile,
): GeometryDocumentSourceFile {
  const captured = {
    id: source.id,
    slots: Object.freeze([...source.slots]),
    role: source.role,
    fileName: source.fileName,
    mediaType: source.mediaType,
  } as Omit<GeometryDocumentSourceFile, 'bytes'> &
    Partial<Pick<GeometryDocumentSourceFile, 'bytes'>>;
  Object.defineProperty(captured, 'bytes', ownedBytesAccessor(source.bytes));
  return Object.freeze(captured) as GeometryDocumentSourceFile;
}

export function captureGeometryDocumentContents(
  input: GeometryDocumentInput,
): GeometryDocumentContents {
  const fileName = input.fileName;
  const text = input.text;
  if (typeof fileName !== 'string' || typeof text !== 'string') {
    throw new TypeError('Geometry document fileName and text must be strings');
  }
  const rawDerivedResources = input.derivedResources;
  const rawSourceFiles = input.sourceFiles;
  const derivedResources =
    rawDerivedResources === undefined ? EMPTY_RESOURCES : rawDerivedResources;
  const sourceFiles =
    rawSourceFiles === undefined ? EMPTY_RESOURCES : rawSourceFiles;
  const captured = capturePortableGeometryDocumentResources(
    derivedResources,
    sourceFiles,
  );
  return Object.freeze({
    fileName,
    text,
    derivedResources: Object.freeze(
      captured.derivedResources.map(immutableDerivedResource),
    ),
    sourceFiles: Object.freeze(captured.sourceFiles.map(immutableSourceFile)),
  });
}

export function toPortableGeometryDocument(
  contents: GeometryDocumentContents,
): PortableGeometryDocument {
  const document = {
    model: Object.freeze({
      fileName: contents.fileName,
      text: contents.text,
    }),
  } as Pick<PortableGeometryDocument, 'model'> &
    Partial<Omit<PortableGeometryDocument, 'model'>>;
  Object.defineProperties(document, {
    derivedResources: {
      enumerable: true,
      configurable: false,
      get: () => contents.derivedResources,
    },
    sourceFiles: {
      enumerable: true,
      configurable: false,
      get: () => contents.sourceFiles,
    },
  });
  return Object.freeze(document) as PortableGeometryDocument;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function stringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function derivedResourcesEqual(
  left: readonly GeometryDocumentDerivedResource[],
  right: readonly GeometryDocumentDerivedResource[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((resource, index) => {
    const candidate = right[index]!;
    return (
      resource.id === candidate.id &&
      stringArraysEqual(resource.slots, candidate.slots) &&
      resource.role === candidate.role &&
      resource.required === candidate.required &&
      resource.mediaType === candidate.mediaType &&
      bytesEqual(resource.bytes, candidate.bytes)
    );
  });
}

function sourceFilesEqual(
  left: readonly GeometryDocumentSourceFile[],
  right: readonly GeometryDocumentSourceFile[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((source, index) => {
    const candidate = right[index]!;
    return (
      source.id === candidate.id &&
      stringArraysEqual(source.slots, candidate.slots) &&
      source.role === candidate.role &&
      source.fileName === candidate.fileName &&
      source.mediaType === candidate.mediaType &&
      bytesEqual(source.bytes, candidate.bytes)
    );
  });
}

export function geometryDocumentContentsEqual(
  left: GeometryDocumentContents,
  right: GeometryDocumentContents,
): boolean {
  return (
    left.fileName === right.fileName &&
    left.text === right.text &&
    derivedResourcesEqual(left.derivedResources, right.derivedResources) &&
    sourceFilesEqual(left.sourceFiles, right.sourceFiles)
  );
}
