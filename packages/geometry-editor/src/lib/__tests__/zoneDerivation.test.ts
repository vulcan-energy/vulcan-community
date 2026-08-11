// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { calculateDerivedHeight } from '../zoneDerivation';

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
