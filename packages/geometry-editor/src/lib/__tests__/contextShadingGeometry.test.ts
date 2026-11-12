// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { calculateContextShadingDistanceFromCoordinates } from '../contextShadingGeometry';

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
    expect(calculateContextShadingDistanceFromCoordinates(shading, parent)).toBe(20);
  });
});
