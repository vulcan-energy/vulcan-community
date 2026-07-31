// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { computeElement3DFrameTarget } from '../geometry3dFrame';
import type { Geometry3DPrimitive } from '../geometry3dPrimitivesTypes';

describe('computeElement3DFrameTarget', () => {
  it('returns centroid for a wall segment primitive', () => {
    const primitives: Geometry3DPrimitive[] = [
      {
        kind: 'wall-segment',
        elementId: 'w1',
        elementType: 'BuildingElementOpaque',
        start: [0, 0],
        end: [4, 0],
        baseElevationM: 2,
        heightM: 2,
        thicknessM: 0.1,
        color: '#ccc',
        isOpening: false,
        isCurrentFloor: true,
      },
    ];
    const t = computeElement3DFrameTarget('w1', primitives);
    expect(t).not.toBeNull();
    expect(t![1]).toBe(3);
  });

  it('returns null when no primitive matches', () => {
    expect(computeElement3DFrameTarget('missing', [])).toBeNull();
  });
});
