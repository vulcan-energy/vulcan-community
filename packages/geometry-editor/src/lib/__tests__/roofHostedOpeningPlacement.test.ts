// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, BuildingElementTransparent } from '../../geometry/types';
import {
  computeRoofHostedOpeningPlacement,
  moveRoofHostedOpeningToSurfaceDistance,
} from '../roofHostedOpeningPlacement';

const square = (x0: number, y0: number, side: number, z = 0) => [
  { x: x0, y: y0, z },
  { x: x0 + side, y: y0, z },
  { x: x0 + side, y: y0 + side, z },
  { x: x0, y: y0 + side, z },
];

const makeRoof = (overrides: Partial<BuildingElementOpaque> = {}): BuildingElementOpaque =>
  ({
    id: 'roof-1',
    name: 'Main Roof',
    type: 'BuildingElementOpaque',
    parent_element: null,
    coordinates: square(0, 0, 10),
    width: 10,
    height: 10,
    pitch: 30,
    orientation360: 180,
    base_height: 2.5,
    ...overrides,
  }) as BuildingElementOpaque;

const makeOpening = (overrides: Partial<BuildingElementTransparent> = {}): BuildingElementTransparent =>
  ({
    id: 'window-1',
    name: 'Rooflight',
    type: 'BuildingElementTransparent',
    parent_element: 'Main Roof',
    coordinates: square(2, 2, 1),
    width: 1,
    height: 1,
    area: 1,
    pitch: 30,
    orientation360: 180,
    base_height: 3.65,
    frame_area_fraction: 0.25,
    free_area_height: 0.5,
    mid_height: 4.15,
    max_window_open_area: 0.5,
    ...overrides,
  }) as BuildingElementTransparent;

describe('computeRoofHostedOpeningPlacement', () => {
  it('reports roof-surface distance from the low roof edge to the lower opening edge midpoint', () => {
    const marker = computeRoofHostedOpeningPlacement(makeOpening(), makeRoof(), undefined);

    expect(marker?.measurementKind).toBe('roof-surface');
    expect(marker?.openingPoint.x).toBeCloseTo(2.5, 6);
    expect(marker?.openingPoint.y).toBeCloseTo(2, 6);
    expect(marker?.roofPoint.x).toBeCloseTo(2.5, 6);
    expect(marker?.roofPoint.y).toBeCloseTo(0, 6);
    expect(marker?.planDistanceM).toBeCloseTo(2, 6);
    expect(marker?.distanceM).toBeCloseTo(2 / Math.cos(Math.PI / 6), 6);
    expect(marker?.verticalRiseM).toBeCloseTo(2 * Math.tan(Math.PI / 6), 6);
  });

  it('finds the lower parallel opening edge even when the polygon starts at the upper edge', () => {
    const marker = computeRoofHostedOpeningPlacement(
      makeOpening({
        coordinates: [
          { x: 2, y: 3, z: 0 },
          { x: 3, y: 3, z: 0 },
          { x: 3, y: 2, z: 0 },
          { x: 2, y: 2, z: 0 },
        ],
      }),
      makeRoof(),
      undefined,
    );

    expect(marker?.openingPoint.x).toBeCloseTo(2.5, 6);
    expect(marker?.openingPoint.y).toBeCloseTo(2, 6);
    expect(marker?.planDistanceM).toBeCloseTo(2, 6);
  });

  it('does not report a placement marker for flat roofs', () => {
    const marker = computeRoofHostedOpeningPlacement(makeOpening(), makeRoof({ pitch: 0 }), undefined);

    expect(marker).toBeNull();
  });

  it('does not report a placement marker for unaligned opening polygons', () => {
    const marker = computeRoofHostedOpeningPlacement(
      makeOpening({
        coordinates: [
          { x: 2.5, y: 2, z: 0 },
          { x: 3, y: 2.5, z: 0 },
          { x: 2.5, y: 3, z: 0 },
          { x: 2, y: 2.5, z: 0 },
        ],
      }),
      makeRoof(),
      undefined,
    );

    expect(marker).toBeNull();
  });

  it('moves a hosted opening so recomputed roof-surface distance matches the target', () => {
    const opening = makeOpening();
    const roof = makeRoof();
    const movedCoordinates = moveRoofHostedOpeningToSurfaceDistance(
      opening,
      roof,
      undefined,
      3 / Math.cos(Math.PI / 6),
    );

    expect(movedCoordinates).not.toBeNull();
    expect(movedCoordinates?.[0]?.x).toBeCloseTo(2, 6);
    expect(movedCoordinates?.[0]?.y).toBeCloseTo(3, 6);

    const movedMarker = computeRoofHostedOpeningPlacement(
      { coordinates: movedCoordinates! },
      roof,
      undefined,
    );
    expect(movedMarker?.planDistanceM).toBeCloseTo(3, 6);
    expect(movedMarker?.distanceM).toBeCloseTo(3 / Math.cos(Math.PI / 6), 6);
  });

  it('can move the lower opening edge onto the low roof edge', () => {
    const movedCoordinates = moveRoofHostedOpeningToSurfaceDistance(
      makeOpening(),
      makeRoof(),
      undefined,
      0,
    );

    expect(movedCoordinates).not.toBeNull();
    expect(movedCoordinates?.[0]?.y).toBeCloseTo(0, 6);
    expect(movedCoordinates?.[1]?.y).toBeCloseTo(0, 6);
  });

  it('does not move openings that cannot be measured against the host roof', () => {
    const movedCoordinates = moveRoofHostedOpeningToSurfaceDistance(
      makeOpening(),
      makeRoof({ pitch: 0 }),
      undefined,
      1,
    );

    expect(movedCoordinates).toBeNull();
  });
});
