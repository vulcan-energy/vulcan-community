// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque } from '../geometry/types';
import { isRoofLikeOpaqueElement } from './roofElement';

describe('isRoofLikeOpaqueElement', () => {
  it('treats sloped opaques named with "roof" as roof fabric', () => {
    const o: BuildingElementOpaque = {
      type: 'BuildingElementOpaque',
      id: 'r',
      name: 'Pitched Roof (S) 1',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      width: 1,
      height: 1,
      area: 1,
      pitch: 30,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    expect(isRoofLikeOpaqueElement(o)).toBe(true);
  });

  it('does not treat vertical (pitch 90°) "… Dormer …" walls as roof despite "roof" in the name', () => {
    const w: BuildingElementOpaque = {
      type: 'BuildingElementOpaque',
      id: 'w',
      name: 'Pitched Roof (S) 1 Dormer Front Wall',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      width: 2,
      height: 0.8,
      area: 1.6,
      pitch: 90,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    expect(isRoofLikeOpaqueElement(w)).toBe(false);
  });
});
