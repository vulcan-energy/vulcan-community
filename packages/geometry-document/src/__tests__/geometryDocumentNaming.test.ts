// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  GeometryWorkspaceProviderError,
  nextDuplicateGeometryDocumentName,
  normalizeGeometryDocumentName,
  normalizeGeometryProjectGroupName,
} from '../index';

describe('geometry document naming', () => {
  it('allocates the next case-insensitive sibling while preserving the extension', () => {
    expect(
      nextDuplicateGeometryDocumentName('House.csv', [
        'house.CSV',
        'House 2.csv',
        'House 4.csv',
      ]),
    ).toBe('House 5.csv');
    expect(
      nextDuplicateGeometryDocumentName('apartment1.vulcan', [
        'apartment1.vulcan',
        'apartment2.vulcan',
        'apartment3.vulcan',
      ]),
    ).toBe('apartment4.vulcan');
  });

  it('normalizes Unicode before collision checks', () => {
    expect(normalizeGeometryDocumentName('  Cafe\u0301.csv  ')).toBe('Café.csv');
    expect(
      nextDuplicateGeometryDocumentName('Café.csv', ['cafe\u0301.CSV']),
    ).toBe('Café 2.csv');
  });

  it.each([
    '',
    '   ',
    '.',
    '..',
    '.csv',
    'folder/model.csv',
    'folder\\model.csv',
    'line\nbreak.csv',
    `${'a'.repeat(241)}.csv`,
  ])('rejects the unsafe or non-portable document name %j', (name) => {
    expect(() => normalizeGeometryDocumentName(name)).toThrow(
      GeometryWorkspaceProviderError,
    );
  });

  it('reports non-string names as typed validation errors', () => {
    expect(() =>
      normalizeGeometryDocumentName(null as unknown as string),
    ).toThrow(GeometryWorkspaceProviderError);
    expect(() =>
      normalizeGeometryProjectGroupName({} as unknown as string),
    ).toThrow(GeometryWorkspaceProviderError);
  });

  it('normalizes project-group names without treating them as paths', () => {
    expect(normalizeGeometryProjectGroupName('  Project Cafe\u0301  ')).toBe(
      'Project Café',
    );
    expect(normalizeGeometryProjectGroupName('North / South')).toBe(
      'North / South',
    );
    expect(() => normalizeGeometryProjectGroupName('line\nbreak')).toThrow(
      GeometryWorkspaceProviderError,
    );
    expect(() => normalizeGeometryProjectGroupName('x'.repeat(121))).toThrow(
      GeometryWorkspaceProviderError,
    );
  });
});
