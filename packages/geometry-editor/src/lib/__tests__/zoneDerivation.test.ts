// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import {
  calculateDerivedHeight,
  getCumulativeBaseHeightsByFloorId,
  getStrictStoreyHeight,
  getMaxLineWallHeightOnFloor,
} from '../zoneDerivation';

const LINE_WALL_TYPES = [
  'BuildingElementOpaque',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
] as const satisfies ReadonlyArray<Element['type']>;

describe('calculateDerivedHeight wall filtering', () => {
  it('excludes line-hosted external doors', () => {
    const elements = [
      {
        id: 'wall-with-door',
        name: 'Wall with door',
        type: 'BuildingElementOpaque',
        zoneId: 'zone-door-filter',
        height: 2.85,
        width: 4.67,
        pitch: 90,
        coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4.67, y: 0, z: 0 }],
        parent_element: null,
      },
      {
        id: 'external-door',
        name: 'External door',
        type: 'BuildingElementOpaque',
        zoneId: 'zone-door-filter',
        height: 2,
        width: 1,
        pitch: 90,
        is_external_door: true,
        coordinates: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
        parent_element: 'Wall with door',
      },
    ] as unknown as Element[];

    expect(calculateDerivedHeight('zone-door-filter', elements)).toBe(2.85);
  });

  it.each(LINE_WALL_TYPES)('excludes non-vertical two-point %s elements', (type) => {
    const elements = [
      {
        id: 'vertical-wall',
        name: 'Vertical wall',
        type: 'BuildingElementOpaque',
        zoneId: 'zone-pitch-filter',
        height: 2.85,
        width: 4,
        pitch: 90,
        coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
        parent_element: null,
      },
      {
        id: `pitched-${type}`,
        name: `Pitched ${type}`,
        type,
        zoneId: 'zone-pitch-filter',
        height: 2,
        width: 4,
        pitch: 30,
        coordinates: [{ x: 0, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }],
        parent_element: null,
      },
    ] as unknown as Element[];

    expect(calculateDerivedHeight('zone-pitch-filter', elements)).toBe(2.85);
  });
});

describe('getMaxLineWallHeightOnFloor wall filtering', () => {
  it('uses only vertical fabric lines, excluding slopes, windows, and external doors', () => {
    const elements = [
      {
        id: 'vertical-wall',
        name: 'Vertical wall',
        type: 'BuildingElementOpaque',
        height: 2.85,
        width: 4,
        pitch: 90,
        is_external_door: false,
        coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
        parent_element: null,
      },
      {
        id: 'pitched-wall',
        name: 'Pitched wall',
        type: 'BuildingElementOpaque',
        height: 8,
        width: 4,
        pitch: 30,
        coordinates: [{ x: 0, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }],
        parent_element: null,
      },
      {
        id: 'external-door',
        name: 'External door',
        type: 'BuildingElementOpaque',
        height: 4,
        width: 1,
        pitch: 90,
        is_external_door: true,
        coordinates: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
        parent_element: 'Vertical wall',
      },
      {
        id: 'window',
        name: 'Window',
        type: 'BuildingElementTransparent',
        height: 6,
        width: 2,
        pitch: 90,
        coordinates: [{ x: 1, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }],
        parent_element: 'Vertical wall',
      },
    ] as unknown as Element[];

    expect(getMaxLineWallHeightOnFloor(0, elements)).toBe(2.85);
  });
});

describe('getStrictStoreyHeight source resolution', () => {
  it('does not inherit a height from another floor or a stored fallback', () => {
    const lowerFloor = { id: 'floor-0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false };
    const upperFloor = { id: 'floor-1', name: 'First', zIndex: 1, height: 2.4, isRoofSpace: false };
    const lowerWall = {
      id: 'lower-wall',
      name: 'Lower wall',
      type: 'BuildingElementOpaque',
      height: 2.4,
      width: 4,
      pitch: 90,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      parent_element: null,
    } as unknown as Element;

    expect(getStrictStoreyHeight(upperFloor, [lowerWall])).toBe(0);
    expect(getStrictStoreyHeight({ ...upperFloor, height: 3.1 }, [])).toBe(0);
    expect(getStrictStoreyHeight({ ...upperFloor, height: 3.1, heightUserOverride: true }, [])).toBe(3.1);
    expect(getStrictStoreyHeight(lowerFloor, [lowerWall])).toBe(2.4);
  });

  it('keeps an upper base unresolved when an intervening floor has no strict height', () => {
    const modelFloors = [
      { id: 'floor-0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false },
      { id: 'floor-1', name: 'First', zIndex: 1, height: 3.1, isRoofSpace: false },
      { id: 'floor-2', name: 'Second', zIndex: 2, height: 2.4, isRoofSpace: false },
    ];
    const lowerWall = {
      id: 'lower-wall',
      name: 'Lower wall',
      type: 'BuildingElementOpaque',
      height: 2.4,
      width: 4,
      pitch: 90,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      parent_element: null,
    } as unknown as Element;

    const bases = getCumulativeBaseHeightsByFloorId(modelFloors, [lowerWall]);

    expect(bases.get('floor-0')).toBe(0);
    expect(bases.get('floor-1')).toBe(2.4);
    expect(bases.get('floor-2')).toBeNull();
  });
});
