// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  createServiceLineCoordinates,
  applyServiceLinePlanLengthToCoordinates,
  getServiceLineLengthFromCoordinates,
  getServiceLinePlanLengthFromCoordinates,
  inferServiceLineModeFromCoordinates,
  isServiceLineElementType,
  normalizeServiceLineCoordinatesForMode,
  serviceLineModeFromDrawMode,
} from '../serviceLineDrawModes';

describe('serviceLineDrawModes', () => {
  it('treats thermal bridges, pipework, and ductwork as service lines', () => {
    expect(isServiceLineElementType('ThermalBridgeLinear')).toBe(true);
    expect(isServiceLineElementType('WaterPipework')).toBe(true);
    expect(isServiceLineElementType('MechanicalVentilationDuctwork')).toBe(true);
    expect(isServiceLineElementType('BuildingElementOpaque')).toBe(false);
  });

  it('maps shared draw modes to service-line geometry modes', () => {
    expect(serviceLineModeFromDrawMode('tb-plan-line')).toBe('plan');
    expect(serviceLineModeFromDrawMode('tb-vertical-line')).toBe('vertical');
    expect(serviceLineModeFromDrawMode('tb-slope-line')).toBe('slope');
  });

  it('creates one-click vertical service-line coordinates with actual rise', () => {
    expect(createServiceLineCoordinates({ x: 2, y: 3 }, { x: 2, y: 3 }, 0.25, 'vertical')).toEqual([
      { x: 2, y: 3, z: 0.25 },
      { x: 2, y: 3, z: 1.25 },
    ]);
  });

  it('creates slope service-line coordinates with an editable default rise', () => {
    expect(createServiceLineCoordinates({ x: 2, y: 3 }, { x: 6, y: 3 }, 0.25, 'slope')).toEqual([
      { x: 2, y: 3, z: 0.25 },
      { x: 6, y: 3, z: 1.25 },
    ]);
  });

  it('infers slope mode and computes actual 3D service-line length', () => {
    const coords = [
      { x: 0, y: 0, z: 1 },
      { x: 3, y: 4, z: 13 },
    ];
    expect(inferServiceLineModeFromCoordinates(coords)).toBe('slope');
    expect(getServiceLinePlanLengthFromCoordinates(coords)).toBe(5);
    expect(getServiceLineLengthFromCoordinates(coords)).toBe(13);
  });

  it('stretches plan length while preserving endpoint elevations', () => {
    expect(
      applyServiceLinePlanLengthToCoordinates([
        { x: 1, y: 1, z: 0.2 },
        { x: 4, y: 5, z: 1.2 },
      ], 10),
    ).toEqual([
      { x: 1, y: 1, z: 0.2 },
      { x: 7, y: 9, z: 1.2 },
    ]);
  });

  it('normalizes vertical service lines to plan while preserving length and bottom z', () => {
    expect(
      normalizeServiceLineCoordinatesForMode([
        { x: 2, y: 3, z: 5 },
        { x: 2, y: 3, z: 8 },
      ], 'plan'),
    ).toEqual([
      { x: 2, y: 3, z: 5 },
      { x: 5, y: 3, z: 5 },
    ]);
  });
});
