// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  inferRadiatorThermalMode,
  pruneRadiatorEmitterExtraJson,
} from '../radiatorEmitterBranches';

describe('inferRadiatorThermalMode', () => {
  it('infers per-metre from c_per_m or length', () => {
    expect(inferRadiatorThermalMode({ c_per_m: 1.2, length: 2 })).toBe('per_metre');
    expect(inferRadiatorThermalMode({ length: 2 })).toBe('per_metre');
  });

  it('infers lumped from c or thermal_mass', () => {
    expect(inferRadiatorThermalMode({ c: 0.1 })).toBe('lumped');
    expect(inferRadiatorThermalMode({ thermal_mass: 1 })).toBe('lumped');
  });

  it('prefers per-metre when both representations are present (matches Rust)', () => {
    expect(
      inferRadiatorThermalMode({ c_per_m: 1.2, length: 2, c: 0.1, thermal_mass: 1 }),
    ).toBe('per_metre');
  });

  it('treats a lone thermal_mass_per_m as per-metre intent', () => {
    expect(inferRadiatorThermalMode({ thermal_mass_per_m: 0.5 })).toBe('per_metre');
  });

  it('defaults to lumped when nothing is set', () => {
    expect(inferRadiatorThermalMode({})).toBe('lumped');
  });
});

describe('pruneRadiatorEmitterExtraJson', () => {
  it('drops lumped fields in per-metre mode', () => {
    const pruned = pruneRadiatorEmitterExtraJson(
      { c_per_m: 1.2, length: 2, thermal_mass_per_m: 1, c: 0.1, thermal_mass: 1, frac_convective: 0.92 },
      'per_metre',
    );
    expect(pruned).toEqual({ c_per_m: 1.2, length: 2, thermal_mass_per_m: 1, frac_convective: 0.92 });
  });

  it('drops per-metre fields in lumped mode', () => {
    const pruned = pruneRadiatorEmitterExtraJson(
      { c_per_m: 1.2, length: 2, thermal_mass_per_m: 1, c: 0.1, thermal_mass: 2, n: 1.2 },
      'lumped',
    );
    expect(pruned).toEqual({ c: 0.1, thermal_mass: 2, n: 1.2 });
  });

  it('does not mutate the input', () => {
    const input = { c_per_m: 1.2, length: 2, c: 0.1 };
    pruneRadiatorEmitterExtraJson(input, 'per_metre');
    expect(input).toEqual({ c_per_m: 1.2, length: 2, c: 0.1 });
  });
});
