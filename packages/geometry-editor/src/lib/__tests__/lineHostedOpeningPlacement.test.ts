// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, BuildingElementTransparent } from '../../geometry/types';
import {
  computeLineHostedOpeningClearance,
  isLineHostedOpeningElement,
  moveLineHostedOpeningToClearance,
} from '../lineHostedOpeningPlacement';

const makeWall = (overrides: Partial<BuildingElementOpaque> = {}): BuildingElementOpaque =>
  ({
    id: 'wall-1',
    name: 'Wall',
    type: 'BuildingElementOpaque',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ],
    width: 5,
    height: 2.4,
    area: 12,
    is_external_door: false,
    ...overrides,
  }) as BuildingElementOpaque;

const makeWindow = (overrides: Partial<BuildingElementTransparent> = {}): BuildingElementTransparent =>
  ({
    id: 'window-1',
    name: 'Window',
    type: 'BuildingElementTransparent',
    parent_element: 'Wall',
    coordinates: [
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    width: 1,
    height: 1,
    area: 1,
    frame_area_fraction: 0.25,
    free_area_height: 0.5,
    mid_height: 1.5,
    max_window_open_area: 0.5,
    ...overrides,
  }) as BuildingElementTransparent;

describe('lineHostedOpeningPlacement', () => {
  it('reports both distances from a line-hosted opening to the wall vertices', () => {
    const clearance = computeLineHostedOpeningClearance(makeWindow(), makeWall());

    expect(clearance?.startDistanceM).toBeCloseTo(1, 6);
    expect(clearance?.endDistanceM).toBeCloseTo(3, 6);
    expect(clearance?.openingLengthM).toBeCloseTo(1, 6);
    expect(clearance?.isWithinWall).toBe(true);
    expect(clearance?.startGuideSegment[0]).toEqual({ x: 0, y: 0 });
    expect(clearance?.startGuideSegment[1]).toEqual({ x: 1, y: 0 });
    expect(clearance?.endGuideSegment[0]).toEqual({ x: 2, y: 0 });
    expect(clearance?.endGuideSegment[1]).toEqual({ x: 5, y: 0 });
  });

  it('uses wall-axis projection rather than screen distance', () => {
    const clearance = computeLineHostedOpeningClearance(
      makeWindow({
        coordinates: [
          { x: 1, y: 0.08, z: 0 },
          { x: 2, y: -0.04, z: 0 },
        ],
      }),
      makeWall(),
    );

    expect(clearance?.startDistanceM).toBeCloseTo(1, 6);
    expect(clearance?.endDistanceM).toBeCloseTo(3, 6);
    expect(clearance?.openingSegment[0]).toEqual({ x: 1, y: 0 });
    expect(clearance?.openingSegment[1]).toEqual({ x: 2, y: 0 });
  });

  it('moves the opening by editing the start-side clearance and preserves opening length', () => {
    const moved = moveLineHostedOpeningToClearance(makeWindow(), makeWall(), 'start', 2);

    expect(moved?.[0]?.x).toBeCloseTo(2, 6);
    expect(moved?.[1]?.x).toBeCloseTo(3, 6);
    const clearance = computeLineHostedOpeningClearance({ coordinates: moved! }, makeWall());
    expect(clearance?.startDistanceM).toBeCloseTo(2, 6);
    expect(clearance?.endDistanceM).toBeCloseTo(2, 6);
    expect(clearance?.openingLengthM).toBeCloseTo(1, 6);
  });

  it('moves the opening by editing the end-side clearance and preserves reversed coordinate order', () => {
    const opening = makeWindow({
      coordinates: [
        { x: 2, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    });
    const moved = moveLineHostedOpeningToClearance(opening, makeWall(), 'end', 1);

    expect(moved?.[0]?.x).toBeCloseTo(4, 6);
    expect(moved?.[1]?.x).toBeCloseTo(3, 6);
    const clearance = computeLineHostedOpeningClearance({ coordinates: moved! }, makeWall());
    expect(clearance?.startDistanceM).toBeCloseTo(3, 6);
    expect(clearance?.endDistanceM).toBeCloseTo(1, 6);
  });

  it('rejects edits that would push the opening beyond the wall ends', () => {
    expect(moveLineHostedOpeningToClearance(makeWindow(), makeWall(), 'start', 4.5)).toBeNull();
    expect(moveLineHostedOpeningToClearance(makeWindow(), makeWall(), 'end', 4.5)).toBeNull();
  });

  it('only treats transparent elements and external-door opaque elements as line openings', () => {
    expect(isLineHostedOpeningElement(makeWindow())).toBe(true);
    expect(isLineHostedOpeningElement(makeWall({ is_external_door: true }))).toBe(true);
    expect(isLineHostedOpeningElement(makeWall({ is_external_door: true, pitch: 30 }))).toBe(false);
    expect(isLineHostedOpeningElement(makeWall({
      is_external_door: true,
      pitch: 0,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
    }))).toBe(false);
    expect(isLineHostedOpeningElement(makeWall({ is_external_door: false }))).toBe(false);
  });
});
