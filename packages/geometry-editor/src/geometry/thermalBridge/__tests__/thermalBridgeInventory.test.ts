// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { classifyThermalBridgeForInventory, impliedPlanSpanMForLinearTbHost } from '../thermalBridgeInventory';
import type { BuildingElementOpaque, Element, ThermalBridgeLinear } from '../../types';

describe('classifyThermalBridgeForInventory', () => {
  it('marks unnamed placeholder as problematic', () => {
    const tb = {
      id: 'tb1',
      type: 'ThermalBridgeLinear',
      name: '',
      zoneId: 'z',
      parent_element: 'Wall',
      isPlaceholder: true,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      extra_json: { junction_type: 'E5' },
    } as ThermalBridgeLinear;
    const elementsById: Record<string, Element> = {};
    const zones = [{ id: 'z', name: 'Zone 1' }];
    const row = classifyThermalBridgeForInventory(tb, elementsById, zones, new Map());
    expect(row.bucket).toBe('problematic');
    expect(row.notes.some((n) => n.includes('Placeholder'))).toBe(true);
    expect(row.notes.some((n) => n.includes('Unnamed'))).toBe(true);
  });

  it('validated when junction auto-suggested and no issues', () => {
    const tb = {
      id: 'tb2',
      type: 'ThermalBridgeLinear',
      name: 'TB',
      zoneId: 'z',
      parent_element: 'Wall',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 8, y: 0, z: 0 },
      ],
      extra_json: { junction_type: 'E10' },
      length: 8,
    } as ThermalBridgeLinear;
    const wall = {
      id: 'w1',
      type: 'BuildingElementOpaque',
      name: 'Wall',
      zoneId: 'z',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 8, y: 0, z: 0 },
      ],
    } as Element;
    const elementsById: Record<string, Element> = { w1: wall };
    const zones = [{ id: 'z', name: 'Z1' }];
    const row = classifyThermalBridgeForInventory(tb, elementsById, zones, new Map());
    expect(row.bucket).toBe('validated');
    expect(row.notes.length).toBe(0);
  });

  it('BuildingElementGround polygon: implied span uses nearest edge', () => {
    const ground = {
      id: 'g1',
      type: 'BuildingElementGround' as const,
      name: 'Basement slab',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
        { x: 6, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      floor_type: 'Heated_basement' as const,
      width: 6,
      height: 0,
      area: 24,
      total_area: 24,
      perimeter: 20,
      isPlaceholder: false,
    };
    const tb = {
      id: 'tb-e22',
      type: 'ThermalBridgeLinear',
      name: 'E22',
      zoneId: 'z',
      parent_element: 'Basement slab',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
      ],
      length: 6,
      extra_json: { junction_type: 'E22' },
      isPlaceholder: false,
    } as ThermalBridgeLinear;
    const elementsById: Record<string, Element> = { g1: ground };
    const zones = [{ id: 'z', name: 'Z1' }];
    const row = classifyThermalBridgeForInventory(tb, elementsById, zones, new Map());
    expect(row.impliedHostSpanM).toBeCloseTo(6, 5);
  });

  it('does not flag vertical E4 jamb (plan length ~0) against horizontal window edge span', () => {
    const windowEl = {
      type: 'BuildingElementTransparent',
      id: 'win1',
      name: 'Window',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0.8 },
        { x: 1.84, y: 0, z: 0.8 },
      ],
      width: 1.84,
      height: 1.2,
      area: 2,
      pitch: 90,
      isPlaceholder: false,
    } as Element;
    const tb = {
      id: 'tb-e4-j',
      type: 'ThermalBridgeLinear',
      name: 'TB E4',
      zoneId: 'z',
      parent_element: 'Window',
      coordinates: [
        { x: 0, y: 0, z: 0.8 },
        { x: 0, y: 0, z: 2 },
      ],
      length: 1.2,
      extra_json: { junction_type: 'E4' },
      isPlaceholder: false,
    } as ThermalBridgeLinear;
    const elementsById: Record<string, Element> = { win1: windowEl };
    const zones = [{ id: 'z', name: 'Zone 1' }];
    const row = classifyThermalBridgeForInventory(tb, elementsById, zones, new Map());
    expect(row.notes.some((n) => n.includes('nearest host plan edge span'))).toBe(false);
    expect(row.bucket).toBe('validated');
  });

  it('polygon roof host: implied span uses nearest edge (e.g. 8 m bottom edge)', () => {
    const roof: BuildingElementOpaque = {
      type: 'BuildingElementOpaque',
      id: 'r1',
      name: 'Pitched Roof (S)',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 2 },
        { x: 8, y: 0, z: 2 },
        { x: 8, y: 6, z: 2 },
        { x: 0, y: 6, z: 2 },
      ],
      pitch: 45,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    const tb = {
      id: 'tb3',
      type: 'ThermalBridgeLinear',
      name: 'TB E10',
      zoneId: 'z',
      parent_element: 'Pitched Roof (S)',
      coordinates: [
        { x: 0, y: 0, z: 2 },
        { x: 8, y: 0, z: 2 },
      ],
      length: 8,
      extra_json: { junction_type: 'E10' },
      isPlaceholder: false,
    } as ThermalBridgeLinear;
    expect(impliedPlanSpanMForLinearTbHost(tb, roof)).toBeCloseTo(8, 5);
    const elementsById: Record<string, Element> = { r1: roof };
    const zones = [{ id: 'z', name: 'Z1' }];
    const row = classifyThermalBridgeForInventory(tb, elementsById, zones, new Map());
    expect(row.impliedHostSpanM).toBeCloseTo(8, 5);
    expect(row.bucket).toBe('validated');
  });

  it('R8 with roof-adjacent thermal_bridge_source: no length vs roof-edge span inventory note (interior ψ-line)', () => {
    const roof: BuildingElementOpaque = {
      type: 'BuildingElementOpaque',
      id: 'r1',
      name: 'Pitched Roof (S)',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 2 },
        { x: 8, y: 0, z: 2 },
        { x: 8, y: 6, z: 2 },
        { x: 0, y: 6, z: 2 },
      ],
      pitch: 45,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    const cheek: BuildingElementOpaque = {
      type: 'BuildingElementOpaque',
      id: 'w-d',
      name: 'Dormer cheek',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 4, y: 3, z: 2 },
        { x: 4, y: 6, z: 2 },
      ],
      width: 3,
      height: 2,
      area: 6,
      pitch: 90,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    const tb = {
      id: 'tb-r8',
      type: 'ThermalBridgeLinear',
      name: 'TB R8',
      zoneId: 'z',
      parent_element: 'Pitched Roof (S)',
      coordinates: [
        { x: 4, y: 3, z: 2 },
        { x: 5.386, y: 3, z: 2 },
      ],
      length: 1.6,
      extra_json: {
        junction_type: 'R8',
        thermal_bridge_source: { host_wall_id: 'r1', host_wall_b_id: 'w-d' },
      },
      isPlaceholder: false,
    } as ThermalBridgeLinear;
    const elementsById: Record<string, Element> = { r1: roof, 'w-d': cheek, 'tb-r8': tb };
    const zones = [{ id: 'z', name: 'Zone 1' }];
    const row = classifyThermalBridgeForInventory(tb, elementsById, zones, new Map());
    expect(row.notes.some((n) => n.includes('nearest host plan edge span'))).toBe(false);
    expect(row.bucket).toBe('validated');
    expect(row.impliedHostSpanM).toBeCloseTo(8, 5);
  });

  it('R10 with roof-to-roof thermal_bridge_source: no length vs roof-edge span inventory note (interior ψ-line)', () => {
    const roof: BuildingElementOpaque = {
      type: 'BuildingElementOpaque',
      id: 'r1',
      name: 'Pitched Roof (S)',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 2 },
        { x: 8, y: 0, z: 2 },
        { x: 8, y: 6, z: 2 },
        { x: 0, y: 6, z: 2 },
      ],
      pitch: 45,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    const dormerRoof: BuildingElementOpaque = {
      type: 'BuildingElementOpaque',
      id: 'dormer-roof',
      name: 'Dormer roof',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 3, y: 2, z: 2 },
        { x: 5, y: 2, z: 2 },
        { x: 5, y: 4, z: 2 },
        { x: 3, y: 4, z: 2 },
      ],
      width: 2,
      height: 2,
      area: 4,
      pitch: 35,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    const tb = {
      id: 'tb-r10',
      type: 'ThermalBridgeLinear',
      name: 'TB R10',
      zoneId: 'z',
      parent_element: 'Pitched Roof (S)',
      coordinates: [
        { x: 3.5, y: 3, z: 2 },
        { x: 4.5, y: 3, z: 2 },
      ],
      length: 1,
      extra_json: {
        junction_type: 'R10',
        thermal_bridge_source: { host_wall_id: 'r1', host_wall_b_id: 'dormer-roof' },
      },
      isPlaceholder: false,
    } as ThermalBridgeLinear;
    const elementsById: Record<string, Element> = { r1: roof, 'dormer-roof': dormerRoof, 'tb-r10': tb };
    const zones = [{ id: 'z', name: 'Zone 1' }];
    const row = classifyThermalBridgeForInventory(tb, elementsById, zones, new Map());
    expect(row.notes.some((n) => n.includes('nearest host plan edge span'))).toBe(false);
    expect(row.bucket).toBe('validated');
  });
});
