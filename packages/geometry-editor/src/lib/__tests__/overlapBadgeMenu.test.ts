// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getOverlapBadgeMenuLayerStyle,
  getOverlapBadgeMenuViewportPosition,
} from '../overlapBadgeMenu';

const canonicalGeometryCanvasPath = resolve(
  import.meta.dirname,
  '../../components/GeometryCanvas.tsx',
);

describe('getOverlapBadgeMenuViewportPosition', () => {
  it('recomputes the menu anchor from the current pan offset', () => {
    const worldCenter = { x: 4, y: 2, z: 0 };
    const scale = 50;
    const canvasCenter = { x: 400, y: 300 };

    const initial = getOverlapBadgeMenuViewportPosition(worldCenter, {
      scale,
      panOffset: { x: 0, y: 0 },
      canvasCenter,
    });

    const afterPan = getOverlapBadgeMenuViewportPosition(worldCenter, {
      scale,
      panOffset: { x: 120, y: -35 },
      canvasCenter,
    });

    expect(afterPan).toEqual({
      x: initial.x + 120,
      y: initial.y - 35,
    });
  });

  it('builds layer-local menu styles for the transformed floating layer', () => {
    const worldCenter = { x: 1, y: -2, z: 0 };
    const style = getOverlapBadgeMenuLayerStyle(worldCenter, {
      scale: 1,
      panOffset: { x: 10, y: 20 },
      canvasCenter: { x: 300, y: 200 },
    });

    expect(style).toEqual({
      position: 'absolute',
      left: 368,
      top: 328,
      pointerEvents: 'auto',
    });
  });

  it('keeps the overlap menu in the live viewport preview transform path', () => {
    const source = readFileSync(canonicalGeometryCanvasPath, 'utf8');

    expect(source).toContain('const overlapBadgeMenuLayer = overlapBadgeMenuLayerRef.current');
    expect(source).toContain('[developmentContextChipsLayer, canvasFloatingEditorsLayer, overlapBadgeMenuLayer]');
    expect(source).toContain('ref={overlapBadgeMenuLayerRef}');
  });
});
