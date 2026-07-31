// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, Element, ThermalBridgeLinear } from '../types';
import {
  bestPlanEdgeMatchForLinearTb,
  bestPlanEdgeMatchForMidpointPlan,
  distPointToSegmentXY,
  readThermalBridgeSourceHostIds,
  readThermalBridgeSourceWallIds,
  resolveHostElementForLinearTb,
  tbSegmentMidpoint,
} from './tbLinkage';

describe('tbLinkage', () => {
  it('tbSegmentMidpoint returns centre of TB line', () => {
    const tb = {
      type: 'ThermalBridgeLinear' as const,
      id: 'tb1',
      name: 'T',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 2 },
        { x: 2, y: 0, z: 2 },
      ],
      length: 2,
      linear_thermal_transmittance: 0.1,
    } as ThermalBridgeLinear;
    expect(tbSegmentMidpoint(tb)).toEqual({ x: 1, y: 0, z: 2 });
  });

  it('distPointToSegmentXY: point on segment has dist ~0', () => {
    const d = distPointToSegmentXY(1, 0, 0, 0, 2, 0);
    expect(d.dist).toBeLessThan(1e-6);
  });

  it('resolveHostElementForLinearTb finds by id', () => {
    const w: BuildingElementOpaque = {
      type: 'BuildingElementOpaque',
      id: 'wall-1',
      name: 'South',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      width: 1,
      height: 2.4,
      area: 2.4,
      pitch: 90,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    const byId: Record<string, Element> = { 'wall-1': w };
    expect(resolveHostElementForLinearTb('wall-1', 'z1', byId)).toBe(w);
  });

  it('resolveHostElementForLinearTb finds by name in zone', () => {
    const w: BuildingElementOpaque = {
      type: 'BuildingElementOpaque',
      id: 'w99',
      name: 'South',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      width: 1,
      height: 2.4,
      area: 2.4,
      pitch: 90,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    const byId: Record<string, Element> = { w99: w };
    expect(resolveHostElementForLinearTb('South', 'z1', byId)).toBe(w);
  });

  it('readThermalBridgeSourceWallIds parses host ids', () => {
    expect(
      readThermalBridgeSourceWallIds({
        thermal_bridge_source: { host_wall_id: 'a', host_wall_b_id: 'b' },
      }),
    ).toEqual({ a: 'a', b: 'b' });
  });

  it('readThermalBridgeSourceHostIds uses generic host terminology for legacy source keys', () => {
    expect(
      readThermalBridgeSourceHostIds({
        thermal_bridge_source: { host_wall_id: 'roof-1', host_wall_b_id: 'floor-1' },
      }),
    ).toEqual({ primary: 'roof-1', secondary: 'floor-1' });
  });

  it('bestPlanEdgeMatchForMidpointPlan: rectangle picks bottom edge when midpoint on bottom', () => {
    const plan = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 6 },
      { x: 0, y: 6 },
    ];
    const m = bestPlanEdgeMatchForMidpointPlan(4, 0, plan);
    expect(m).not.toBeNull();
    expect(m!.edgeIndex).toBe(0);
    expect(m!.spanM).toBeCloseTo(8, 5);
    expect(m!.midpointDistToEdgeM).toBeLessThan(1e-6);
  });

  it('bestPlanEdgeMatchForLinearTb: quad roof host matches TB along one edge', () => {
    const roof: BuildingElementOpaque = {
      type: 'BuildingElementOpaque',
      id: 'roof1',
      name: 'Pitched Roof',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 3 },
        { x: 8, y: 0, z: 3 },
        { x: 8, y: 6, z: 3 },
        { x: 0, y: 6, z: 3 },
      ],
      width: 8,
      height: 6,
      area: 48,
      pitch: 45,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    const tb = {
      type: 'ThermalBridgeLinear' as const,
      id: 'tb1',
      name: 'TB',
      zoneId: 'z1',
      parent_element: 'Pitched Roof',
      coordinates: [
        { x: 0, y: 0, z: 3 },
        { x: 8, y: 0, z: 3 },
      ],
      length: 8,
      linear_thermal_transmittance: 0.1,
      isPlaceholder: false,
      extra_json: { junction_type: 'E10' },
    } as ThermalBridgeLinear;
    const m = bestPlanEdgeMatchForLinearTb(tb, roof);
    expect(m).not.toBeNull();
    expect(m!.spanM).toBeCloseTo(8, 5);
    expect(m!.midpointDistToEdgeM).toBeLessThan(1e-5);
  });
});
