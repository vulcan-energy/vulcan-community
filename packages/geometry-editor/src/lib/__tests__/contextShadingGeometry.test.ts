// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  calculateContextShadingAngularRangeFromCoordinates,
  calculateContextShadingDistanceFromCoordinates,
  resolveContextShadingOrigin,
} from '../contextShadingGeometry';
import type { ContextShading } from '../../geometry/types';

describe('context shading origin', () => {
  it('measures from the parent floor area centroid, not its vertex mean', () => {
    // 10 x 6 rectangle centred on (5, 3), with a bay-like cluster of collinear vertices on the east edge.
    const parent = {
      coordinates: [
        { x: 0, y: 0 }, { x: 10, y: 0 },
        { x: 10, y: 1 }, { x: 10, y: 1.5 }, { x: 10, y: 2 }, { x: 10, y: 2.5 }, { x: 10, y: 3 },
        { x: 10, y: 6 }, { x: 0, y: 6 }, { x: 0, y: 0 },
      ],
    };
    // A point shading 20 m due north of the true centre.
    const shading = { coordinates: [{ x: 5, y: 23 }] };
    expect(calculateContextShadingDistanceFromCoordinates(shading, parent, null)).toBe(20);
  });

  const square = { coordinates: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] };

  it('resolves to the saved origin when set, else the parent area centroid', () => {
    expect(resolveContextShadingOrigin({ x: 1, y: -2 }, square)).toEqual({ x: 1, y: -2 });
    expect(resolveContextShadingOrigin(null, square)).toEqual({ x: 2, y: 2 });
  });

  it('measures angles and distance from a saved origin', () => {
    // A point due east of the saved origin (0, 0) but north-east of the square's centre (2, 2).
    const shading = { coordinates: [{ x: 10, y: 0 }] } as ContextShading;
    expect(calculateContextShadingAngularRangeFromCoordinates(shading, square, { x: 0, y: 0 }))
      .toEqual({ start_angle: 90, end_angle: 90 });
    expect(calculateContextShadingDistanceFromCoordinates(shading, square, { x: 0, y: 0 })).toBe(10);
  });
});
