// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  calculateMemoizedLabelPositions,
  getSmartLabelPillTexts,
  rectsOverlap,
  transformCachedLabelPosition,
} from '../labelUtils';

describe('getSmartLabelPillTexts', () => {
  it('shows radiator unit count alongside line length', () => {
    const pills = getSmartLabelPillTexts(
      {
        id: 'rad-1',
        name: 'Radiator',
        type: 'WetEmitter',
        subcategory: 'radiator',
        unit_number: 3,
        parent_element: null,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
        ],
      } as any,
      { showLineDimensions: false },
    );

    expect(pills).toEqual(['3 units', '2.0m']);
  });

  it('does not show a unit-count pill for underfloor heating', () => {
    const pills = getSmartLabelPillTexts(
      {
        id: 'ufh-1',
        name: 'UFH',
        type: 'WetEmitter',
        subcategory: 'ufh',
        unit_number: 3,
        area: 12,
        parent_element: null,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 3, y: 0, z: 0 },
          { x: 3, y: 4, z: 0 },
        ],
      } as any,
      { showLineDimensions: false },
    );

    expect(pills).toEqual(['12.0m²']);
  });

  it('recalculates cached label bounds when derived line dimension text changes', () => {
    const projectIdentity = (
      coord: { x: number; y: number },
    ): { x: number; y: number } => ({ x: coord.x, y: coord.y });
    const baseElement = {
      id: 'label-cache-line-dimensions',
      name: 'Wall',
      type: 'BuildingElementOpaque',
      parent_element: null,
      coordinates: [
        { x: 0, y: 100, z: 0 },
        { x: 10, y: 100, z: 0 },
      ],
    } as any;

    const smallHeightPositions = calculateMemoizedLabelPositions(
      [{ ...baseElement, height: 2 }],
      { width: 800, height: 600 },
      true,
      projectIdentity,
      1,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    );
    const smallWidth = smallHeightPositions.get(baseElement.id)?.rect.width ?? 0;

    const largeHeightPositions = calculateMemoizedLabelPositions(
      [{ ...baseElement, height: 12345 }],
      { width: 800, height: 600 },
      true,
      projectIdentity,
      1,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    );

    expect(largeHeightPositions.get(baseElement.id)?.rect.width ?? 0).toBeGreaterThan(smallWidth);
  });

  it('recalculates label placement when coordinates move labels into collision', () => {
    const projectIdentity = (
      coord: { x: number; y: number },
    ): { x: number; y: number } => ({ x: coord.x, y: coord.y });
    const elementA = {
      id: 'label-cache-move-a',
      name: 'Wall A',
      type: 'BuildingElementOpaque',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
    } as any;
    const elementBFar = {
      id: 'label-cache-move-b',
      name: 'Wall B',
      type: 'BuildingElementOpaque',
      parent_element: null,
      coordinates: [
        { x: 200, y: 100, z: 0 },
        { x: 210, y: 100, z: 0 },
      ],
    } as any;

    calculateMemoizedLabelPositions(
      [elementA, elementBFar],
      { width: 800, height: 600 },
      false,
      projectIdentity,
      1,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    );

    const elementBNear = {
      ...elementBFar,
      coordinates: [
        { x: 0, y: 100, z: 0 },
        { x: 10, y: 100, z: 0 },
      ],
    };
    const movedPositions = calculateMemoizedLabelPositions(
      [elementA, elementBNear],
      { width: 800, height: 600 },
      false,
      projectIdentity,
      1,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    );
    const labelA = movedPositions.get(elementA.id);
    const labelB = movedPositions.get(elementBNear.id);
    expect(labelA).toBeTruthy();
    expect(labelB).toBeTruthy();

    const rectA = transformCachedLabelPosition(labelA!, elementA, projectIdentity, 1, { x: 0, y: 0 }, { x: 0, y: 0 });
    const rectB = transformCachedLabelPosition(labelB!, elementBNear, projectIdentity, 1, { x: 0, y: 0 }, { x: 0, y: 0 });

    expect(rectsOverlap(rectA, rectB)).toBe(false);
  });
});
