// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * End-to-end checks: element outline helpers + issue finder behave consistently for representative hosts.
 */
import { describe, expect, it } from 'vitest';
import type { Element, ThermalBridgeLinear } from '../../types';
import { findLinearThermalBridgeIssues } from '../findLinearThermalBridgeIssues';
import { planCoordinatesForHostElement } from '../tbLinkage';

describe('thermalBridgeValidationPipeline', () => {
  it('BuildingElementGround outline enables nearest-edge validation (E22-style)', () => {
    const ground = {
      id: 'g1',
      type: 'BuildingElementGround' as const,
      name: 'Basement',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      floor_type: 'Heated_basement' as const,
      depth_basement_floor: 2.8,
      width: 5,
      height: 0,
      area: 20,
      total_area: 20,
      perimeter: 18,
      isPlaceholder: false,
    };
    const tb = {
      id: 'tb1',
      type: 'ThermalBridgeLinear',
      name: 'TB',
      zoneId: 'z',
      parent_element: 'Basement',
      coordinates: [
        { x: 0, y: 0, z: -2.8 },
        { x: 5, y: 0, z: -2.8 },
      ],
      length: 5,
      linear_thermal_transmittance: 0.05,
      extra_json: { junction_type: 'E22' },
      isPlaceholder: false,
    } as ThermalBridgeLinear;

    expect(planCoordinatesForHostElement(ground)).not.toBeNull();
    const issues = findLinearThermalBridgeIssues([ground, tb] as Element[]);
    expect(issues.filter((i) => i.elementId === 'tb1')).toHaveLength(0);
  });

  it('warns when an E22 basement-floor line is left at ground level instead of basement depth', () => {
    const ground = {
      id: 'g1',
      type: 'BuildingElementGround' as const,
      name: 'Basement',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      floor_type: 'Unheated_basement' as const,
      depth_basement_floor: 2.8,
      width: 5,
      height: 0,
      area: 20,
      total_area: 20,
      perimeter: 18,
      isPlaceholder: false,
    };
    const tb = {
      id: 'tb1',
      type: 'ThermalBridgeLinear',
      name: 'TB',
      zoneId: 'z',
      parent_element: 'Basement',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ],
      length: 5,
      linear_thermal_transmittance: 0.22,
      extra_json: { junction_type: 'E22' },
      isPlaceholder: false,
    } as ThermalBridgeLinear;

    const issues = findLinearThermalBridgeIssues([ground, tb] as Element[]);
    expect(issues.some((i) => i.kind === 'mismatch_basement_e22_elevation')).toBe(true);
  });
});
