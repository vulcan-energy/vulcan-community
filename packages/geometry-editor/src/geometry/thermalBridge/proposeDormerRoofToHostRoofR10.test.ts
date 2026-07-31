// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, Element } from '../types';
import { proposeDormerRoofToHostRoofR10ThermalBridges } from './proposeDormerRoofToHostRoofR10';

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
    is_unheated_pitched_roof: false,
    isPlaceholder: false,
  } as BuildingElementOpaque;
}

function dormerRoofOnHost(): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id: 'dormer-roof',
    name: 'Gable Dormer Left Roof',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: 2, y: 1, z: 2 },
      { x: 4, y: 1, z: 2 },
      { x: 4, y: 2, z: 2 },
      { x: 3, y: 3, z: 2 },
      { x: 2, y: 2, z: 2 },
    ],
    width: 4,
    height: 1,
    area: 4,
    pitch: 35,
    is_unheated_pitched_roof: false,
    isPlaceholder: false,
    extra_json: {
      dormer_bundle: {
        kind: 'dormer',
        host_element_name: 'Host Pitched Roof',
        role: 'left-roof',
      },
    },
  } as BuildingElementOpaque;
}

describe('proposeDormerRoofToHostRoofR10ThermalBridges', () => {
  it('emits R10 for warm dormer roof edges tying back into a warm host roof plane', () => {
    const roof = hostSlopedRoof();
    const dormerRoof = dormerRoofOnHost();
    const p = proposeDormerRoofToHostRoofR10ThermalBridges([roof, dormerRoof] as Element[]);

    expect(p.length).toBeGreaterThanOrEqual(1);
    const row = p[0]!;
    expect(row.junctionCode).toBe('R10');
    expect(row.edgeRole).toBe('dormer_roof_to_host_roof_r10');
    expect(row.proposalId.startsWith('dormerroofr10:')).toBe(true);
    expect(row.parentElementForTb).toBe('Host Pitched Roof');
    expect(row.hostElementIds).toEqual(['host-roof', 'dormer-roof']);
  });

  it('returns nothing when the host roof is an unheated pitched roof', () => {
    const roof = {
      ...hostSlopedRoof(),
      is_unheated_pitched_roof: true,
    } as BuildingElementOpaque;
    const dormerRoof = dormerRoofOnHost();

    expect(proposeDormerRoofToHostRoofR10ThermalBridges([roof, dormerRoof] as Element[])).toHaveLength(0);
  });

  it('returns nothing when the dormer roof is an unheated pitched roof', () => {
    const roof = hostSlopedRoof();
    const dormerRoof = {
      ...dormerRoofOnHost(),
      is_unheated_pitched_roof: true,
    } as BuildingElementOpaque;

    expect(proposeDormerRoofToHostRoofR10ThermalBridges([roof, dormerRoof] as Element[])).toHaveLength(0);
  });

  it('returns nothing when host name does not match any sloped roof', () => {
    const roof = hostSlopedRoof();
    const dormerRoof = {
      ...dormerRoofOnHost(),
      extra_json: {
        dormer_bundle: {
          host_element_name: 'Missing Roof',
          role: 'left-roof',
        },
      },
    } as BuildingElementOpaque;
    expect(proposeDormerRoofToHostRoofR10ThermalBridges([roof, dormerRoof] as Element[])).toHaveLength(0);
  });
});
