// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dormer vertical wall × **host** sloped roof (R8/R9), when the wall footprint is not a host roof boundary edge.
 */
import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, Element } from '../types';
import { proposeDormerWallToHostRoofR8R9ThermalBridges } from './proposeDormerWallToHostRoofR8R9';

function hostSlopedRoof(): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id: 'host-roof',
    name: 'Host Pitched Roof',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 2 },
      { x: 8, y: 0, z: 2 },
      { x: 8, y: 5, z: 2 },
      { x: 0, y: 5, z: 2 },
    ],
    width: 8,
    height: 2,
    area: 40,
    pitch: 32,
    is_unheated_pitched_roof: true,
    isPlaceholder: false,
  } as BuildingElementOpaque;
}

function dormerCheekOnHost(): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id: 'cheek',
    name: 'Hip Dormer Left Cheek',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: 2, y: 1, z: 2 },
      { x: 2, y: 3.5, z: 2 },
    ],
    width: 2.5,
    height: 0.8,
    area: 2,
    pitch: 90,
    isPlaceholder: false,
    extra_json: {
      dormer_bundle: {
        kind: 'dormer',
        host_element_name: 'Host Pitched Roof',
        role: 'left-cheek-wall',
      },
    },
  } as BuildingElementOpaque;
}

describe('proposeDormerWallToHostRoofR8R9ThermalBridges', () => {
  it('emits cold R9 on the projected ceiling boundary when a vertical dormer cheek bears on that host roof', () => {
    const roof = hostSlopedRoof();
    const cheek = dormerCheekOnHost();
    const p = proposeDormerWallToHostRoofR8R9ThermalBridges([roof, cheek] as Element[]);
    expect(p.length).toBeGreaterThanOrEqual(1);
    const row = p[0]!;
    expect(row.junctionCode).toBe('R9');
    expect(row.edgeRole).toBe('sloped_roof_to_adjacent_wall_r8_r9');
    expect(row.proposalId.startsWith('dormerhostr89:')).toBe(true);
    expect(row.parentElementForTb).toBe('Host Pitched Roof');
    expect(row.roofAdjacentPairIds).toEqual(['host-roof', 'cheek']);
    expect(row.suggestedLengthM).toBeCloseTo(2.5, 5);
    expect(row.coordinates[0]!.z).toBeCloseTo(row.coordinates[1]!.z, 5);
    expect(row.reason).toContain('projected ceiling boundary');
  });

  it('uses inferred wall-top ceiling elevation for cold dormer R9 when the host roof base is higher', () => {
    const floors = [
      { id: 'f0', name: 'Ground', zIndex: 0, height: 2.8, isRoofSpace: false },
      { id: 'f1', name: 'First', zIndex: 1, height: 2.8, isRoofSpace: false },
      { id: 'f2', name: 'Roof', zIndex: 2, height: 0, isRoofSpace: true },
    ];
    const roof = {
      ...hostSlopedRoof(),
      floorId: 'f2',
      base_height: 6.2,
      coordinates: [
        { x: 0, y: 0, z: 2 },
        { x: 8, y: 0, z: 2 },
        { x: 8, y: 5, z: 2 },
        { x: 0, y: 5, z: 2 },
      ],
    } as BuildingElementOpaque;
    const cheek = {
      ...dormerCheekOnHost(),
      floorId: 'f1',
      height: 2.8,
      coordinates: [
        { x: 2, y: 1, z: 1 },
        { x: 2, y: 3.5, z: 1 },
      ],
    } as BuildingElementOpaque;

    const p = proposeDormerWallToHostRoofR8R9ThermalBridges([roof, cheek] as Element[], floors);
    const row = p[0]!;

    expect(row.junctionCode).toBe('R9');
    expect(row.suggestedLengthM).toBeCloseTo(2.5, 5);
    expect(row.coordinates[0]!.z).toBeCloseTo(5.6, 5);
    expect(row.coordinates[1]!.z).toBeCloseTo(5.6, 5);
  });

  it('emits warm R8 on the host roof plane', () => {
    const roof = {
      ...hostSlopedRoof(),
      is_unheated_pitched_roof: false,
    } as BuildingElementOpaque;
    const cheek = {
      ...dormerCheekOnHost(),
      height: 3,
    } as BuildingElementOpaque;
    const p = proposeDormerWallToHostRoofR8R9ThermalBridges([roof, cheek] as Element[]);
    expect(p.length).toBeGreaterThanOrEqual(1);
    const row = p[0]!;
    expect(row.junctionCode).toBe('R8');
    expect(row.suggestedLengthM).toBeGreaterThan(2.5);
    expect(Math.abs(row.coordinates[0]!.z - row.coordinates[1]!.z)).toBeGreaterThan(0.1);
    expect(row.reason).toContain('footprint on roof plane');
  });

  it('returns nothing when host name does not match any sloped roof', () => {
    const roof = hostSlopedRoof();
    const cheek = {
      ...dormerCheekOnHost(),
      extra_json: {
        dormer_bundle: {
          host_element_name: 'Missing Roof',
          role: 'left-cheek-wall',
        },
      },
    } as BuildingElementOpaque;
    expect(proposeDormerWallToHostRoofR8R9ThermalBridges([roof, cheek] as Element[])).toHaveLength(0);
  });
});
