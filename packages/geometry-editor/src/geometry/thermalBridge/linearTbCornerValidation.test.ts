// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { e16e17CornerPlanMessage, intersectLinesXY, tbPlanAnchorXY } from './linearTbCornerValidation';
import type { BuildingElementOpaque, ThermalBridgeLinear } from '../types';

function wall(
  id: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id,
    name: id,
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: x0, y: y0, z: 0 },
      { x: x1, y: y1, z: 0 },
    ],
    width: 1,
    height: 2.4,
    area: 2.4,
    pitch: 90,
    isPlaceholder: false,
  } as BuildingElementOpaque;
}

describe('linearTbCornerValidation', () => {
  it('intersectLinesXY returns meeting of two 2-point walls at origin', () => {
    const p = intersectLinesXY(0, 0, 1, 0, 0, 0, 0, 1);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(0, 5);
    expect(p!.y).toBeCloseTo(0, 5);
  });

  it('tbPlanAnchorXY uses duplicate plan point for vertical TB', () => {
    const tb = {
      type: 'ThermalBridgeLinear' as const,
      id: 't',
      coordinates: [
        { x: 2, y: 3, z: 0 },
        { x: 2, y: 3, z: 2.4 },
      ],
    } as ThermalBridgeLinear;
    expect(tbPlanAnchorXY(tb)).toEqual({ x: 2, y: 3 });
  });

  it('e16e17CornerPlanMessage: null when TB at intersection', () => {
    const a = wall('wa', 0, 0, 1, 0);
    const b = wall('wb', 0, 0, 0, 1);
    const tb = {
      type: 'ThermalBridgeLinear' as const,
      id: 't',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 2 },
      ],
    } as ThermalBridgeLinear;
    expect(e16e17CornerPlanMessage(tb, a, b)).toBeNull();
  });

  it('e16e17CornerPlanMessage: message when TB displaced in plan', () => {
    const a = wall('wa', 0, 0, 1, 0);
    const b = wall('wb', 0, 0, 0, 1);
    const tb = {
      type: 'ThermalBridgeLinear' as const,
      id: 't',
      coordinates: [
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 2 },
      ],
    } as ThermalBridgeLinear;
    const m = e16e17CornerPlanMessage(tb, a, b);
    expect(m).toBeTruthy();
    expect(m).toMatch(/m from the intersection/);
  });
});
