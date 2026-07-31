// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { GeometryWorkspaceProviderError } from './providerContracts';

const DOCUMENT_NAME_MAX_LENGTH = 240;
const PROJECT_GROUP_NAME_MAX_LENGTH = 120;
const PATH_SEPARATOR = /[\\/]/u;

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

function normalizedLength(value: string): number {
  return Array.from(value).length;
}

function normalizeDisplayName(
  value: string,
  resource: 'document' | 'project-group',
  maximumLength: number,
  rejectPathSeparators: boolean,
): string {
  if (typeof value !== 'string') {
    throw new GeometryWorkspaceProviderError(
      'invalid-name',
      `${resource} name must be a string`,
      { resource },
    );
  }
  const normalized = value.normalize('NFC').trim();
  if (normalized.length === 0) {
    throw new GeometryWorkspaceProviderError(
      'invalid-name',
      `${resource} name must not be blank`,
      { resource },
    );
  }
  if (normalized === '.' || normalized === '..') {
    throw new GeometryWorkspaceProviderError(
      'invalid-name',
      `${resource} name must not be a dot segment`,
      { resource },
    );
  }
  if (rejectPathSeparators && PATH_SEPARATOR.test(normalized)) {
    throw new GeometryWorkspaceProviderError(
      'invalid-name',
      `${resource} name must not contain a path separator`,
      { resource },
    );
  }
  if (containsControlCharacter(normalized)) {
    throw new GeometryWorkspaceProviderError(
      'invalid-name',
      `${resource} name must not contain control characters`,
      { resource },
    );
  }
  if (normalizedLength(normalized) > maximumLength) {
    throw new GeometryWorkspaceProviderError(
      'invalid-name',
      `${resource} name must not exceed ${maximumLength} characters`,
      { resource },
    );
  }
  return normalized;
}

type DocumentNameParts = Readonly<{
  stem: string;
  extension: string;
}>;

function splitDocumentName(fileName: string): DocumentNameParts {
  const extensionStart = fileName.lastIndexOf('.');
  if (extensionStart === 0) {
    throw new GeometryWorkspaceProviderError(
      'invalid-name',
      'document name must include a stem before its extension',
      { resource: 'document' },
    );
  }
  if (extensionStart < 0) {
    return { stem: fileName, extension: '' };
  }
  return {
    stem: fileName.slice(0, extensionStart),
    extension: fileName.slice(extensionStart),
  };
}

export function normalizeGeometryDocumentName(value: string): string {
  const normalized = normalizeDisplayName(
    value,
    'document',
    DOCUMENT_NAME_MAX_LENGTH,
    true,
  );
  const { stem } = splitDocumentName(normalized);
  if (stem.trim().length === 0) {
    throw new GeometryWorkspaceProviderError(
      'invalid-name',
      'document name must include a non-blank stem',
      { resource: 'document' },
    );
  }
  return normalized;
}

export function normalizeGeometryProjectGroupName(value: string): string {
  return normalizeDisplayName(
    value,
    'project-group',
    PROJECT_GROUP_NAME_MAX_LENGTH,
    false,
  );
}

export function geometryDocumentNameKey(value: string): string {
  return normalizeGeometryDocumentName(value).toLowerCase();
}

export function geometryProjectGroupNameKey(value: string): string {
  return normalizeGeometryProjectGroupName(value).toLowerCase();
}

type NumberedStem = Readonly<{
  base: string;
  separator: string;
  number: number;
}>;

function parseNumberedStem(stem: string): NumberedStem | null {
  const match = stem.match(/^(.*?)(\s*)(\d+)$/u);
  if (match === null || match[1].length === 0) return null;
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number)) return null;
  return { base: match[1], separator: match[2], number };
}

export function nextDuplicateGeometryDocumentName(
  sourceName: string,
  siblingNames: readonly string[],
): string {
  const source = normalizeGeometryDocumentName(sourceName);
  const sourceParts = splitDocumentName(source);
  const numberedSource = parseNumberedStem(sourceParts.stem);
  const base = numberedSource?.base ?? sourceParts.stem;
  const separator = numberedSource?.separator ?? ' ';
  let highestNumber = numberedSource?.number ?? 1;
  const sourceExtensionKey = sourceParts.extension.toLowerCase();
  const baseKey = base.toLowerCase();
  const existingKeys = new Set<string>();

  for (const siblingName of siblingNames) {
    const sibling = normalizeGeometryDocumentName(siblingName);
    existingKeys.add(sibling.toLowerCase());
    const siblingParts = splitDocumentName(sibling);
    if (siblingParts.extension.toLowerCase() !== sourceExtensionKey) continue;
    const numberedSibling = parseNumberedStem(siblingParts.stem);
    if (numberedSibling === null) continue;
    if (numberedSibling.separator !== separator) continue;
    if (numberedSibling.base.toLowerCase() !== baseKey) continue;
    highestNumber = Math.max(highestNumber, numberedSibling.number);
  }

  let nextNumber = highestNumber + 1;
  while (true) {
    const candidate = normalizeGeometryDocumentName(
      `${base}${separator}${nextNumber}${sourceParts.extension}`,
    );
    if (!existingKeys.has(candidate.toLowerCase())) return candidate;
    nextNumber += 1;
    if (!Number.isSafeInteger(nextNumber)) {
      throw new GeometryWorkspaceProviderError(
        'operation-failed',
        'No safe duplicate document number remains',
        { resource: 'document' },
      );
    }
  }
}
