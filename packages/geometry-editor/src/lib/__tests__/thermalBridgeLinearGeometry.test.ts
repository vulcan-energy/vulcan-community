// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  applyThermalBridgeLinearLengthToCoordinates,
  computeThermalBridgeLinearRunLengthM,
  createThermalBridgeLineCoordinates,
  inferThermalBridgeLineModeFromCoordinates,
  normalizeThermalBridgeLineCoordinatesForMode,
  resolveThermalBridgeLineMode,
  syncThermalBridgeLinearLengthFromCoordinates,
  thermalBridgeLinearHasPositiveRun,
} from '../thermalBridgeLinearGeometry';
import type { ThermalBridgeLinear } from '../../geometry/types';

describe('computeThermalBridgeLinearRunLengthM', () => {
  it('uses plan length for horizontal segments', () => {
    expect(
      computeThermalBridgeLinearRunLengthM([
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 4, z: 0 },
      ]),
    ).toBe(5);
  });

  it('uses |Δz| when plan length is negligible', () => {
    expect(
      computeThermalBridgeLinearRunLengthM([
        { x: 1, y: 1, z: 0 },
        { x: 1, y: 1, z: 2.4 },
      ]),
    ).toBeCloseTo(2.4);
  });

  it('uses actual 3D length for sloped segments', () => {
    expect(
      computeThermalBridgeLinearRunLengthM([
        { x: 0, y: 0, z: 1 },
        { x: 3, y: 4, z: 2 },
      ]),
    ).toBeCloseTo(Math.sqrt(26));
  });
});

describe('createThermalBridgeLineCoordinates', () => {
  it('creates slope coordinates with a non-zero default rise', () => {
    expect(createThermalBridgeLineCoordinates({ x: 1, y: 2 }, { x: 4, y: 2 }, 0.5, 'slope')).toEqual([
      { x: 1, y: 2, z: 0.5 },
      { x: 4, y: 2, z: 1.5 },
    ]);
  });
});

describe('inferThermalBridgeLineModeFromCoordinates', () => {
  it('distinguishes plan, vertical, and slope from normalized coordinates', () => {
    expect(
      inferThermalBridgeLineModeFromCoordinates([
        { x: 0, y: 0, z: 2 },
        { x: 3, y: 0, z: 2 },
      ]),
    ).toBe('plan');
    expect(
      inferThermalBridgeLineModeFromCoordinates([
        { x: 0, y: 0, z: 2 },
        { x: 0, y: 0, z: 3 },
      ]),
    ).toBe('vertical');
    expect(
      inferThermalBridgeLineModeFromCoordinates([
        { x: 0, y: 0, z: 2 },
        { x: 3, y: 0, z: 3 },
      ]),
    ).toBe('slope');
  });
});

describe('normalizeThermalBridgeLineCoordinatesForMode', () => {
  it('flattens both endpoint Z values when converting to plan mode', () => {
    expect(
      normalizeThermalBridgeLineCoordinatesForMode(
        [
          { x: 0, y: 0, z: 1 },
          { x: 2, y: 0, z: 3 },
        ],
        'plan',
      ),
    ).toEqual([
      { x: 0, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
    ]);
  });

  it('preserves length and bottom Z when converting vertical geometry to plan mode', () => {
    expect(
      normalizeThermalBridgeLineCoordinatesForMode(
        [
          { x: 4, y: 5, z: 3 },
          { x: 4, y: 5, z: 1 },
        ],
        'plan',
      ),
    ).toEqual([
      { x: 4, y: 5, z: 1 },
      { x: 6, y: 5, z: 1 },
    ]);
  });

  it('preserves actual physical length and bottom Z when converting slope geometry to vertical mode', () => {
    expect(
      normalizeThermalBridgeLineCoordinatesForMode(
        [
          { x: 0, y: 0, z: 2 },
          { x: 3, y: 4, z: 3 },
        ],
        'vertical',
      ),
    ).toEqual([
      { x: 0, y: 0, z: 2 },
      { x: 0, y: 0, z: 7.1 },
    ]);
  });
});

describe('resolveThermalBridgeLineMode', () => {
  it('infers slope from coordinates when metadata is absent', () => {
    const tb = {
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 2 },
      ],
    } as ThermalBridgeLinear;
    expect(resolveThermalBridgeLineMode(tb)).toBe('slope');
  });

  it('uses explicit metadata for authoring mode', () => {
    const tb = {
      extra_json: { _tb_line_mode: 'plan' },
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 2 },
      ],
    } as ThermalBridgeLinear;
    expect(resolveThermalBridgeLineMode(tb)).toBe('plan');
  });
});

describe('applyThermalBridgeLinearLengthToCoordinates', () => {
  it('extends vertical runs along z', () => {
    const tb = {
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 2 },
      ],
    } as ThermalBridgeLinear;
    const next = applyThermalBridgeLinearLengthToCoordinates(tb, 3);
    expect(next?.[0].z).toBe(1);
    expect(next?.[1].z).toBe(4);
  });

  it('scales sloped runs along the 3D vector', () => {
    const tb = {
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 3, y: 4, z: 2 },
      ],
    } as ThermalBridgeLinear;
    const next = applyThermalBridgeLinearLengthToCoordinates(tb, Math.sqrt(26) * 2);
    expect(next?.[1]).toEqual({ x: 6, y: 8, z: 3 });
  });

  it('keeps explicit plan-mode length edits flat even if stale endpoint Z differs', () => {
    const tb = {
      extra_json: { _tb_line_mode: 'plan' },
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 3, y: 4, z: 2 },
      ],
    } as ThermalBridgeLinear;
    const next = applyThermalBridgeLinearLengthToCoordinates(tb, 10);
    expect(next).toEqual([
      { x: 0, y: 0, z: 1 },
      { x: 6, y: 8, z: 1 },
    ]);
  });
});

describe('syncThermalBridgeLinearLengthFromCoordinates', () => {
  it('rounds run length for vertical jambs', () => {
    const tb = {
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1.555 },
      ],
    } as ThermalBridgeLinear;
    expect(syncThermalBridgeLinearLengthFromCoordinates(tb)).toBe(1.56);
  });
});

describe('thermalBridgeLinearHasPositiveRun', () => {
  it('is true when length is zero but Δz is positive', () => {
    const tb: ThermalBridgeLinear = {
      id: 't',
      name: 't',
      zoneId: 'z',
      type: 'ThermalBridgeLinear',
      length: 0,
      linear_thermal_transmittance: 0.1,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
    };
    expect(thermalBridgeLinearHasPositiveRun(tb)).toBe(true);
  });
});
