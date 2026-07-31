// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const canonicalEditorSourceRoot = resolve(import.meta.dirname, '../..');

const readCanonicalEditorSource = (relativePath: string) =>
  readFileSync(resolve(canonicalEditorSourceRoot, relativePath), 'utf8');

describe('GeometryCanvas architecture boundaries', () => {
  it('keeps the embedded element editor behind stable render boundaries', () => {
    const geometryCanvasSource = readCanonicalEditorSource('components/GeometryCanvas.tsx');
    const elementCreatorSource = readCanonicalEditorSource('components/ElementCreator.tsx');

    expect(elementCreatorSource).toContain('export const ElementCreator = React.memo');
    expect(geometryCanvasSource).toContain('const handleZoneDelete = useCallback');
    expect(geometryCanvasSource).toContain('const handleConfirmZoneDelete = useCallback');
    expect(geometryCanvasSource).toContain('const handleCancelZoneDelete = useCallback');
    expect(geometryCanvasSource).toContain('const handleElementDelete = useCallback');
    expect(geometryCanvasSource).toContain('const handleConfirmElementDelete = useCallback');
    expect(geometryCanvasSource).toContain('const handleCancelElementDelete = useCallback');
  });
});
