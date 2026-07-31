// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { resolveThermalBridgeLinearFloorIdAfterHostsReady } from '../thermalBridgeFloorIngest';
import type { Element } from '../../geometry/types';

describe('resolveThermalBridgeLinearFloorIdAfterHostsReady', () => {
  it('uses host parent floorId when extra_json floor_id is stale (no matching floor row)', () => {
    const ground = 'floor-ground';
    const upper = 'floor-upper';
    const walls: Element[] = [
      {
        id: 'w0',
        zoneId: 'z1',
        name: 'Wall (S)',
        type: 'BuildingElementOpaque',
        floorId: ground,
        width: 1,
        height: 1,
        area: 1,
        pitch: 90,
        orientation360: 0,
        base_height: 0,
        is_unheated_pitched_roof: false,
        is_external_door: false,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
      } as Element,
      {
        id: 'wu',
        zoneId: 'z1',
        name: 'Unheated Wall (S)',
        type: 'BuildingElementAdjacentUnconditionedSpace_Simple',
        floorId: upper,
        width: 1,
        height: 1,
        area: 1,
        pitch: 90,
        orientation360: 0,
        parent_element: null,
        coordinates: [
          { x: 0, y: 0, z: 1 },
          { x: 1, y: 0, z: 1 },
        ],
      } as Element,
    ];

    const tb: Element = {
      id: 'tb',
      zoneId: 'z1',
      name: 'TB E6',
      type: 'ThermalBridgeLinear',
      zoneId_fk: '',
      heat_transfer_coeff: 0,
      length: 1,
      linear_thermal_transmittance: 0.1,
      parent_element: 'Unheated Wall (S)',
      coordinates: [
        { x: 0, y: 0, z: 2.4 },
        { x: 1, y: 0, z: 2.4 },
      ],
      extra_json: { junction_type: 'E6', floor_id: 'stale-export-id' },
    } as Element;

    const floors = [
      { id: ground, zIndex: 0 },
      { id: upper, zIndex: 1 },
    ];

    const out = resolveThermalBridgeLinearFloorIdAfterHostsReady(tb, walls, floors);
    expect(out).toBe(1);
  });

  it('falls back to host vertex storey when ids are stale / not in floors list', () => {
    const canonicalAt2 = 'floor-z2';
    const walls: Element[] = [
      {
        id: 'roof',
        zoneId: 'z1',
        name: 'Pitched Roof (S)',
        type: 'BuildingElementOpaque',
        floorId: 'stale-host-floor-id',
        width: 1,
        height: 1,
        area: 1,
        pitch: 45,
        orientation360: 0,
        base_height: 0,
        is_unheated_pitched_roof: true,
        is_external_door: false,
        coordinates: [
          { x: 0, y: 0, z: 2 },
          { x: 1, y: 0, z: 2 },
        ],
      } as Element,
    ];

    const tb: Element = {
      id: 'tb',
      zoneId: 'z1',
      name: 'TB',
      type: 'ThermalBridgeLinear',
      zoneId_fk: '',
      heat_transfer_coeff: 0,
      length: 1,
      linear_thermal_transmittance: 0.1,
      parent_element: 'Pitched Roof (S)',
      coordinates: [
        { x: 0, y: 0, z: 2.4 },
        { x: 1, y: 0, z: 2.4 },
      ],
      extra_json: { floor_id: 'unknown-json-id' },
    } as Element;

    const floors = [{ id: canonicalAt2, zIndex: 2 }];

    const out = resolveThermalBridgeLinearFloorIdAfterHostsReady(tb, walls, floors);
    expect(out).toBe(2);
  });

  /**
   * Regression: if every TB row shares the same persisted `extra_json.floor_id` (e.g. duplicated in CSV)
   * and that string matches an existing floor in `floors`, the resolver must not pin all TBs to that
   * floor when their hosts sit on different storeys (`Math.floor(host.coords[0].z)`).
   */
  it('does not accept extra_json.floor_id when it matches a floor whose storey disagrees with the host', () => {
    const staleUnifiedExportId = 'ssvwz927h';
    const floorGround = { id: staleUnifiedExportId, zIndex: 0 };
    const floorMid = { id: 'mid-tier-roof', zIndex: 1 };
    const floors = [floorGround, floorMid];

    const wallGround: Element = {
      id: 'w0',
      zoneId: 'z1',
      name: 'Wall (S)',
      type: 'BuildingElementOpaque',
      floorId: staleUnifiedExportId,
      width: 1,
      height: 2.4,
      area: 1,
      pitch: 90,
      orientation360: 180,
      base_height: 0,
      is_unheated_pitched_roof: false,
      is_external_door: false,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    } as Element;

    const pitchedRoofLower: Element = {
      id: 'pr',
      zoneId: 'z1',
      name: 'Pitched Roof (S)',
      type: 'BuildingElementOpaque',
      floorId: floorMid.id,
      width: 1,
      height: 1,
      area: 1,
      pitch: 45,
      orientation360: 180,
      base_height: 2.4,
      is_unheated_pitched_roof: true,
      is_external_door: false,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
    } as Element;

    const elements = [wallGround, pitchedRoofLower];

    const tbWall: Element = {
      id: 'tb0',
      zoneId: 'z1',
      name: 'TB E5',
      type: 'ThermalBridgeLinear',
      zoneId_fk: '',
      heat_transfer_coeff: 0,
      length: 8,
      linear_thermal_transmittance: 0.32,
      parent_element: 'Wall (S)',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 8, y: 0, z: 0 },
      ],
      extra_json: { junction_type: 'E5', floor_id: staleUnifiedExportId },
    } as Element;

    const tbRoof: Element = {
      id: 'tb1',
      zoneId: 'z1',
      name: 'TB E10',
      type: 'ThermalBridgeLinear',
      zoneId_fk: '',
      heat_transfer_coeff: 0,
      length: 8,
      linear_thermal_transmittance: 0.12,
      parent_element: 'Pitched Roof (S)',
      coordinates: [
        { x: 0, y: 0, z: 2.4 },
        { x: 8, y: 0, z: 2.4 },
      ],
      extra_json: { junction_type: 'E10', floor_id: staleUnifiedExportId },
    } as Element;

    expect(resolveThermalBridgeLinearFloorIdAfterHostsReady(tbWall, elements, floors)).toBe(0);

    expect(resolveThermalBridgeLinearFloorIdAfterHostsReady(tbRoof, elements, floors)).toBe(1);
  });

  it('allows E22 basement floor membership to differ from the basement host storey', () => {
    const basement: Element = {
      id: 'g',
      zoneId: 'z1',
      name: 'Basement slab',
      type: 'BuildingElementGround',
      floor_type: 'Heated_basement',
      depth_basement_floor: 2.8,
      width: 4,
      height: 0,
      area: 16,
      total_area: 16,
      perimeter: 16,
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
    } as Element;

    const tb: Element = {
      id: 'tb-e22',
      zoneId: 'z1',
      name: 'TB E22',
      type: 'ThermalBridgeLinear',
      zoneId_fk: '',
      heat_transfer_coeff: 0,
      length: 4,
      linear_thermal_transmittance: 0.22,
      parent_element: 'Basement slab',
      coordinates: [
        { x: 0, y: 0, z: -2.8 },
        { x: 4, y: 0, z: -2.8 },
      ],
      extra_json: { junction_type: 'E22', floor_id: -1 },
    } as Element;

    const floors = [
      { id: 'floor-basement', zIndex: -1 },
      { id: 'floor-ground', zIndex: 0 },
    ];

    expect(resolveThermalBridgeLinearFloorIdAfterHostsReady(tb, [basement], floors)).toBe(-1);
  });
});
