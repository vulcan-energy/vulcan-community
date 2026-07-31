// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, BuildingElementPartyWall, Element } from '../types';
import { proposePartyWallToExternalE18 } from './proposePartyWallToExternalE18';

const baseWall: BuildingElementOpaque = {
  type: 'BuildingElementOpaque',
  id: 'w',
  name: 'Ext',
  zoneId: 'z1',
  parent_element: null,
  coordinates: [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 4, z: 0 },
  ],
  width: 4,
  height: 2.5,
  area: 10,
  pitch: 90,
  isPlaceholder: false,
} as BuildingElementOpaque;

const baseParty: BuildingElementPartyWall = {
  type: 'BuildingElementPartyWall',
  id: 'p',
  name: 'Party',
  zoneId: 'z1',
  parent_element: null,
  coordinates: [
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 3, z: 0 },
  ],
  width: 2,
  height: 2.4,
  area: 2,
  isPlaceholder: false,
} as BuildingElementPartyWall;

describe('proposePartyWallToExternalE18', () => {
  it('proposes E18 along vertical mid-overlap of party and external line', () => {
    const out = proposePartyWallToExternalE18([baseWall, baseParty] as Element[]);
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.junctionCode).toBe('E18');
    expect(row.edgeRole).toBe('party_to_external_e18');
    expect(row.suggestedLengthM).toBeCloseTo(2.4, 5);
    expect(row.openingId).toBe('p');
    expect(row.hostElementIds).toEqual(['w', 'p']);
    expect(row.coordinates[0]!.x).toBe(0);
    expect(row.coordinates[0]!.y).toBe(2);
  });

  it('proposes E18 at a perpendicular junction when party meets external wall at a corner (no colinear overlap)', () => {
    const ext: BuildingElementOpaque = {
      ...baseWall,
      id: 'w-h',
      name: 'South facade',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      width: 10,
      height: 2.5,
    } as BuildingElementOpaque;

    const party: BuildingElementPartyWall = {
      ...baseParty,
      id: 'p-v',
      name: 'Party east',
      coordinates: [
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 4, z: 0 },
      ],
      width: 4,
      height: 2.4,
    } as BuildingElementPartyWall;

    const out = proposePartyWallToExternalE18([ext, party] as Element[]);
    expect(out).toHaveLength(1);
    expect(out[0]!.proposalId.startsWith('e18corner:')).toBe(true);
    expect(out[0]!.coordinates[0]!.x).toBeCloseTo(10, 5);
    expect(out[0]!.coordinates[0]!.y).toBeCloseTo(0, 5);
    expect(out[0]!.junctionCode).toBe('E18');
    expect(out[0]!.hostElementIds).toEqual(['w-h', 'p-v']);
  });
});
