// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementGround, Element } from '../types';
import { proposeBasementGroundE22ThermalBridges } from './proposeBasementFloorE22';

const basement: BuildingElementGround = {
  type: 'BuildingElementGround',
  id: 'bg',
  name: 'Basement slab',
  zoneId: 'z1',
  parent_element: null,
  coordinates: [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 1, z: 0 },
    { x: 0, y: 1, z: 0 },
  ],
  width: 1,
  height: 0.1,
  area: 2,
  total_area: 2,
  perimeter: 6,
  floor_type: 'Unheated_basement',
  depth_basement_floor: 2.8,
  isPlaceholder: false,
} as BuildingElementGround;

describe('proposeBasementGroundE22ThermalBridges', () => {
  it('emits E22 per plan edge for basement floor types', () => {
    const p = proposeBasementGroundE22ThermalBridges([basement] as Element[]);
    expect(p).toHaveLength(4);
    for (const row of p) {
      expect(row.junctionCode).toBe('E22');
      expect(row.edgeRole).toBe('basement_floor_edge');
      expect(row.coordinates.every((c) => c.z === -2.8)).toBe(true);
      expect(row.floorStoreyIndexForTb).toBe(-1);
    }
  });

  it('falls back to explicit negative geometry when basement depth is unavailable', () => {
    const explicit = {
      ...basement,
      depth_basement_floor: undefined,
      coordinates: basement.coordinates.map((c) => ({ ...c, z: -1 })),
    } as BuildingElementGround;
    const p = proposeBasementGroundE22ThermalBridges([explicit] as Element[]);
    expect(p).toHaveLength(4);
    expect(p.every((row) => row.coordinates.every((c) => c.z === -1))).toBe(true);
    expect(p.every((row) => row.floorStoreyIndexForTb === -1)).toBe(true);
  });
});
