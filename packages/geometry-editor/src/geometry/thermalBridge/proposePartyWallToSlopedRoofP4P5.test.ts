// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, BuildingElementPartyWall, Element, Floor } from '../types';
import { proposePartyWallToSlopedRoofP4P5ThermalBridges } from './proposePartyWallToSlopedRoofP4P5';

/** Valid triangle: party on edge (0,0)–(0,3) */
const slopedFixed: BuildingElementOpaque = {
  type: 'BuildingElementOpaque',
  id: 'r2',
  name: 'Pitched roof',
  zoneId: 'z1',
  parent_element: null,
  coordinates: [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 3, z: 0 },
    { x: 2, y: 0, z: 0 },
  ],
  width: 1,
  height: 0.1,
  area: 3,
  pitch: 40,
  isPlaceholder: false,
} as BuildingElementOpaque;

const party: BuildingElementPartyWall = {
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
  height: 2.4,
  area: 4.8,
  pitch: 90,
  isPlaceholder: false,
};

describe('proposePartyWallToSlopedRoofP4P5ThermalBridges', () => {
  it('proposes P4 or P5 when a party line lies on a sloped roof plan edge', () => {
    const p = proposePartyWallToSlopedRoofP4P5ThermalBridges([slopedFixed, party] as Element[]);
    expect(p.length).toBeGreaterThanOrEqual(1);
    expect(p[0]!.edgeRole).toBe('party_wall_to_sloped_roof');
    expect(['P4', 'P5'].includes(p[0]!.junctionCode)).toBe(true);
    expect(p[0]!.hostElementIds).toEqual(['r2', 'pw']);
  });

  it('runs a warm P5 along the roof slope and a cold P4 on the flat ceiling line', () => {
    // Eaves (0,0)→(4,0); the party wall lies on the gable edge x = 0, which climbs 3 m in plan.
    const roof = {
      ...slopedFixed,
      base_height: 5,
      coordinates: [
        { x: 0, y: 0, z: 5 },
        { x: 4, y: 0, z: 5 },
        { x: 4, y: 3, z: 5 },
        { x: 0, y: 3, z: 5 },
      ],
    } as BuildingElementOpaque;
    const gableParty = {
      ...party,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
    } as BuildingElementPartyWall;
    const rise = 3 * Math.tan((40 * Math.PI) / 180);

    const [warm] = proposePartyWallToSlopedRoofP4P5ThermalBridges([roof, gableParty] as Element[]);
    expect(warm!.junctionCode).toBe('P5');
    expect(warm!.suggestedLengthM).toBeCloseTo(3 / Math.cos((40 * Math.PI) / 180), 2);
    expect(warm!.coordinates.map((p) => p.z).sort()).toEqual([5, Number((5 + rise).toFixed(2))]);

    const [cold] = proposePartyWallToSlopedRoofP4P5ThermalBridges([
      { ...roof, is_unheated_pitched_roof: true },
      gableParty,
    ] as Element[]);
    expect(cold!.junctionCode).toBe('P4');
    expect(cold!.suggestedLengthM).toBe(3);
    expect(cold!.coordinates[0]!.z).toBe(cold!.coordinates[1]!.z);
  });

  it('proposes against an Orientation-state roof only when its plane basis is available', () => {
    const roof = {
      ...slopedFixed,
      extra_json: { _slope_pitch_axis: 'orientation' },
      orientation360: 270,
    } as BuildingElementOpaque;
    expect(proposePartyWallToSlopedRoofP4P5ThermalBridges([roof, party] as Element[], undefined, 0))
      .toHaveLength(1);
    expect(proposePartyWallToSlopedRoofP4P5ThermalBridges([roof, party] as Element[]))
      .toEqual([]);
  });

  it('uses the inferred ceiling elevation for cold P4 when the roof base is higher', () => {
    const floors: Floor[] = [
      { id: 'f1', name: 'Upper', zIndex: 1, height: 2.8, isRoofSpace: false },
      { id: 'f2', name: 'Roof', zIndex: 2, height: 0, isRoofSpace: true },
    ];
    const wallTopSource = {
      type: 'BuildingElementOpaque',
      id: 'upper-wall',
      name: 'Upper wall',
      zoneId: 'z1',
      floorId: 'f1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 3, z: 1 },
      ],
      width: 3,
      height: 2.8,
      area: 8.4,
      pitch: 90,
      base_height: 2.8,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    const roof = {
      ...slopedFixed,
      floorId: 'f2',
      base_height: 6.2,
      is_unheated_pitched_roof: true,
      coordinates: slopedFixed.coordinates.map((point) => ({ ...point, z: 2 })),
    } as BuildingElementOpaque;
    const partyWall = {
      ...party,
      floorId: 'f1',
      height: 2.8,
      coordinates: party.coordinates.map((point) => ({ ...point, z: 1 })),
    } as BuildingElementPartyWall;

    const p = proposePartyWallToSlopedRoofP4P5ThermalBridges(
      [wallTopSource, roof, partyWall] as Element[],
      floors,
    );

    expect(p.length).toBeGreaterThanOrEqual(1);
    expect(p[0]!.junctionCode).toBe('P4');
    expect(p[0]!.coordinates[0]!.z).toBeCloseTo(5.6, 5);
    expect(p[0]!.coordinates[1]!.z).toBeCloseTo(5.6, 5);
  });
});
