// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  derivePitchFromGeometry,
  resolveBuildingElementPitch,
} from '../derivePitchFromGeometry';

const horizontalSquare = [
  { x: 0, y: 0, z: 2.5 },
  { x: 4, y: 0, z: 2.5 },
  { x: 4, y: 3, z: 2.5 },
  { x: 0, y: 3, z: 2.5 },
];

const verticalWall = [
  { x: 0, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
  { x: 4, y: 0, z: 2.4 },
  { x: 0, y: 0, z: 2.4 },
];

// 30° pitched roof: rises 1m over 1.732m horizontal run.
const slopedRoof30 = [
  { x: 0, y: 0, z: 0 },
  { x: 1.732, y: 0, z: 1 },
  { x: 1.732, y: 4, z: 1 },
  { x: 0, y: 4, z: 0 },
];

describe('derivePitchFromGeometry', () => {
  it('returns 0 for a horizontal opaque polygon (flat roof)', () => {
    expect(derivePitchFromGeometry(horizontalSquare, 'BuildingElementOpaque')).toBe(0);
  });

  it('returns 0 for a horizontal transparent polygon (skylight)', () => {
    expect(derivePitchFromGeometry(horizontalSquare, 'BuildingElementTransparent')).toBe(0);
  });

  it('returns 180 for a horizontal ground polygon (floor)', () => {
    expect(derivePitchFromGeometry(horizontalSquare, 'BuildingElementGround')).toBe(180);
  });

  it('returns 0 for a horizontal adjacent polygon (interior divider)', () => {
    expect(
      derivePitchFromGeometry(horizontalSquare, 'BuildingElementAdjacentConditionedSpace'),
    ).toBe(0);
  });

  it('returns 90 for a vertical wall polygon', () => {
    expect(derivePitchFromGeometry(verticalWall, 'BuildingElementOpaque')).toBe(90);
  });

  it('returns ~30 for a 30° pitched roof polygon', () => {
    expect(derivePitchFromGeometry(slopedRoof30, 'BuildingElementOpaque')).toBe(30);
  });

  it('returns undefined for fewer than 3 vertices', () => {
    expect(
      derivePitchFromGeometry(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        'BuildingElementOpaque',
      ),
    ).toBeUndefined();
  });

  it('returns undefined for a degenerate (collinear) polygon', () => {
    expect(
      derivePitchFromGeometry(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
        ],
        'BuildingElementOpaque',
      ),
    ).toBeUndefined();
  });

  it('returns undefined when coordinates are missing', () => {
    expect(derivePitchFromGeometry(undefined, 'BuildingElementOpaque')).toBeUndefined();
  });
});

describe('resolveBuildingElementPitch', () => {
  it('returns the explicit pitch when set and finite', () => {
    expect(
      resolveBuildingElementPitch({
        type: 'BuildingElementOpaque',
        pitch: 45,
        coordinates: horizontalSquare,
      }),
    ).toBe(45);
  });

  it('derives from geometry when pitch is missing', () => {
    expect(
      resolveBuildingElementPitch({
        type: 'BuildingElementOpaque',
        coordinates: horizontalSquare,
      }),
    ).toBe(0);
  });

  it('derives from geometry when pitch is null', () => {
    expect(
      resolveBuildingElementPitch({
        type: 'BuildingElementOpaque',
        pitch: null,
        coordinates: verticalWall,
      }),
    ).toBe(90);
  });

  it('derives from geometry when pitch is NaN', () => {
    expect(
      resolveBuildingElementPitch({
        type: 'BuildingElementOpaque',
        pitch: Number.NaN,
        coordinates: verticalWall,
      }),
    ).toBe(90);
  });

  it('normalises explicit 90 to 0 on horizontal adjacent polygons', () => {
    expect(
      resolveBuildingElementPitch({
        type: 'BuildingElementAdjacentConditionedSpace',
        pitch: 90,
        coordinates: horizontalSquare,
      }),
    ).toBe(0);
  });

  it('keeps explicit 90 on vertical adjacent polygons', () => {
    expect(
      resolveBuildingElementPitch({
        type: 'BuildingElementAdjacentConditionedSpace',
        pitch: 90,
        coordinates: verticalWall,
      }),
    ).toBe(90);
  });

  it('returns undefined when neither explicit nor geometry-derivable', () => {
    expect(
      resolveBuildingElementPitch({
        type: 'BuildingElementOpaque',
        coordinates: undefined,
      }),
    ).toBeUndefined();
  });
});
