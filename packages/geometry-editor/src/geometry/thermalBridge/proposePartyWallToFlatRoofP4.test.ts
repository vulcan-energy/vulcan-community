// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, BuildingElementPartyWall, Element } from '../types';
import { proposePartyWallToFlatRoofP4ThermalBridges } from './proposePartyWallToFlatRoofP4';

const flatRoofRect: BuildingElementOpaque = {
  type: 'BuildingElementOpaque',
  id: 'roof-flat',
  name: 'Main roof',
  zoneId: 'z1',
  parent_element: null,
  coordinates: [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 4, y: 3, z: 0 },
    { x: 0, y: 3, z: 0 },
  ],
  width: 10,
  height: 0.25,
  area: 12,
  pitch: 0,
  isPlaceholder: false,
} as BuildingElementOpaque;

const partyOnLeftEdge: BuildingElementPartyWall = {
  type: 'BuildingElementPartyWall',
  id: 'pw',
  name: 'Party',
  zoneId: 'z1',
  parent_element: null,
  coordinates: [
    { x: 0, y: 0.5, z: 0 },
    { x: 0, y: 2.5, z: 0 },
  ],
  width: 2,
  height: 3,
  area: 6,
  pitch: 90,
  isPlaceholder: false,
};

describe('proposePartyWallToFlatRoofP4ThermalBridges', () => {
  it('proposes P4 when a party line lies on a flat roof polygon edge', () => {
    const p = proposePartyWallToFlatRoofP4ThermalBridges([flatRoofRect, partyOnLeftEdge] as Element[]);
    expect(p.length).toBeGreaterThanOrEqual(1);
    expect(p.some((x) => x.edgeRole === 'party_wall_to_flat_roof' && x.junctionCode === 'P4')).toBe(true);
    expect(p.find((x) => x.edgeRole === 'party_wall_to_flat_roof')!.hostElementIds).toEqual(['roof-flat', 'pw']);
  });
});
