// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementTransparent, Floor } from '../../geometry/types';
import {
  buildTransparentOpeningNumericPatch,
  calculateDerivedWindowMaxOpenArea,
  deriveTransparentOpeningDerivedValues,
} from '../transparentOpeningDerivedFields';

const makeOpening = (
  overrides: Partial<BuildingElementTransparent> = {},
): BuildingElementTransparent => ({
  id: 'window-1',
  name: 'Window 1',
  type: 'BuildingElementTransparent',
  zoneId: 'zone-1',
  width: 0.9,
  height: 1.2,
  area: 1.08,
  base_height: 0.8,
  parent_element: null,
  frame_area_fraction: 0.1,
  free_area_height: 0.4,
  mid_height: 1.4,
  max_window_open_area: 0.36,
  coordinates: [
    { x: 0, y: 0, z: 0 },
    { x: 0.9, y: 0, z: 0 },
  ],
  ...overrides,
});

const floors: Floor[] = [
  { id: 'floor-0', name: 'Floor 0', zIndex: 0, height: 2.4, isRoofSpace: false },
  { id: 'floor-1', name: 'Floor 1', zIndex: 1, height: 2.6, isRoofSpace: false },
];

describe('transparent opening derived fields', () => {
  it('derives max open area from width and free-area height, capped by opening area', () => {
    expect(calculateDerivedWindowMaxOpenArea(1.2, 1, 0.4)).toBe(0.48);
    expect(calculateDerivedWindowMaxOpenArea(1.2, 0.3, 0.5)).toBe(0.36);
  });

  it('derives transparent opening automatic values from one helper', () => {
    expect(deriveTransparentOpeningDerivedValues(makeOpening())).toEqual({
      midHeight: 1.4,
      maxWindowOpenArea: 0.36,
    });
  });

  it('uses floorId when coordinates are missing for derived mid-height', () => {
    const derived = deriveTransparentOpeningDerivedValues(
      makeOpening({
        base_height: 0,
        height: 1,
        coordinates: undefined,
        floorId: '1',
      }),
      {},
      { effectiveFloors: floors },
    );

    expect(derived.midHeight).toBe(2.9);
  });

  it('updates mid_height when base_height changes and the current value is automatic', () => {
    const patch = buildTransparentOpeningNumericPatch(makeOpening(), { base_height: 1 });

    expect(patch).toEqual({
      base_height: 1,
      mid_height: 1.6,
    });
  });

  it('repairs zero mid_height as an unset automatic value', () => {
    const patch = buildTransparentOpeningNumericPatch(
      makeOpening({ mid_height: 0 }),
      { base_height: 1 },
    );

    expect(patch).toEqual({
      base_height: 1,
      mid_height: 1.6,
    });
  });

  it('preserves a manual mid_height when base_height changes', () => {
    const patch = buildTransparentOpeningNumericPatch(
      makeOpening({ mid_height: 1.33 }),
      { base_height: 1 },
    );

    expect(patch).toEqual({ base_height: 1 });
  });

  it('updates max_window_open_area when free_area_height changes and the current value is automatic', () => {
    const patch = buildTransparentOpeningNumericPatch(makeOpening(), { free_area_height: 0.6 });

    expect(patch).toEqual({
      free_area_height: 0.6,
      max_window_open_area: 0.54,
    });
  });

  it('repairs zero max_window_open_area as an unset automatic value', () => {
    const patch = buildTransparentOpeningNumericPatch(
      makeOpening({ max_window_open_area: 0 }),
      { free_area_height: 0.6 },
    );

    expect(patch).toEqual({
      free_area_height: 0.6,
      max_window_open_area: 0.54,
    });
  });

  it('preserves a manual max_window_open_area when free_area_height changes', () => {
    const patch = buildTransparentOpeningNumericPatch(
      makeOpening({ max_window_open_area: 0.5 }),
      { free_area_height: 0.6 },
    );

    expect(patch).toEqual({ free_area_height: 0.6 });
  });

  it('uses the floor-derived base height when base_height is zero', () => {
    const patch = buildTransparentOpeningNumericPatch(
      makeOpening({
        base_height: 0,
        height: 1,
        mid_height: 2.9,
        coordinates: [
          { x: 0, y: 0, z: 1 },
          { x: 0.9, y: 0, z: 1 },
        ],
      }),
      { height: 1.4 },
      { effectiveFloors: floors },
    );

    expect(patch).toEqual({
      height: 1.4,
      mid_height: 3.1,
    });
  });
});
