// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  cavityHeatFlowDirectionForPitch,
  cavityPhysicalThicknessM,
  explicitWellVentilatedExternalSurfaceResistanceM2KPerW,
  effectiveCavityResistanceM2KPerW,
  explicitUnventilatedCavityResistanceM2KPerW,
  migrateLegacyCavityLayer,
  resolveAssemblyHeatTransferContext,
} from '../assemblyCavityModel';
import type { AssemblyLayerCavity } from '../assemblyTypes';

describe('assemblyCavityModel', () => {
  it('derives high-emissivity explicit cavity resistance from bundled BR 443 conventions', () => {
    expect(
      explicitUnventilatedCavityResistanceM2KPerW(
        {
          kind: 'cavity',
          ventilation: 'unventilated',
          gap_thickness_m: 0.015,
          surface_emissivity: 'high',
        },
        90,
      ).r,
    ).toBeCloseTo(0.17, 6);

    expect(
      explicitUnventilatedCavityResistanceM2KPerW(
        {
          kind: 'cavity',
          ventilation: 'unventilated',
          gap_thickness_m: 0.05,
          surface_emissivity: 'high',
        },
        90,
      ).r,
    ).toBeCloseTo(0.18, 6);
  });

  it('derives low-emissivity explicit cavity resistance from heat-flow direction', () => {
    const layer: AssemblyLayerCavity = {
      kind: 'cavity',
      ventilation: 'unventilated',
      gap_thickness_m: 0.025,
      surface_emissivity: 'low',
    };
    expect(explicitUnventilatedCavityResistanceM2KPerW(layer, 90).r).toBeCloseTo(0.44, 6);
    expect(explicitUnventilatedCavityResistanceM2KPerW(layer, 30).r).toBeCloseTo(0.34, 6);
    expect(explicitUnventilatedCavityResistanceM2KPerW(layer, 180).r).toBeCloseTo(0.5, 6);
  });

  it('rejects low-emissivity explicit cavities below 25 mm', () => {
    const out = explicitUnventilatedCavityResistanceM2KPerW(
      {
        kind: 'cavity',
        ventilation: 'unventilated',
        gap_thickness_m: 0.02,
        surface_emissivity: 'low',
      },
      90,
    );
    expect(out.error).toMatch(/25 mm/);
  });

  it('migrates legacy cavity presets to explicit unventilated cavities', () => {
    expect(
      migrateLegacyCavityLayer({
        kind: 'cavity',
        cavityType: 'plasterboard_on_dabs_15mm_airspace',
        fixedResistance_m2K_W: 0.17,
      }),
    ).toMatchObject({
      kind: 'cavity',
      ventilation: 'unventilated',
      gap_thickness_m: 0.015,
      surface_emissivity: 'high',
    });

    expect(
      migrateLegacyCavityLayer({
        kind: 'cavity',
        cavityType: 'unventilated_low_emissivity_horizontal',
        fixedResistance_m2K_W: 0.44,
      }),
    ).toMatchObject({
      kind: 'cavity',
      ventilation: 'unventilated',
      gap_thickness_m: 0.025,
      surface_emissivity: 'low',
    });
  });

  it('uses explicit gap thickness and legacy fallback thicknesses', () => {
    expect(
      cavityPhysicalThicknessM({
        kind: 'cavity',
        ventilation: 'unventilated',
        gap_thickness_m: 0.03,
        surface_emissivity: 'high',
      }),
    ).toBeCloseTo(0.03, 6);
    expect(
      cavityPhysicalThicknessM({
        kind: 'cavity',
        cavityType: 'dry_lining_battens_22mm_airspace',
        fixedResistance_m2K_W: 0.18,
      }),
    ).toBeCloseTo(0.022, 6);
  });

  it('keeps legacy fixed-R cavities working when no explicit fields exist', () => {
    const out = effectiveCavityResistanceM2KPerW(
      {
        kind: 'cavity',
        cavityType: 'legacy',
        fixedResistance_m2K_W: 0.21,
      },
      90,
      new Map(),
    );
    expect(out.r).toBeCloseTo(0.21, 6);
  });

  it('maps pitch to the calculator heat-flow buckets', () => {
    expect(cavityHeatFlowDirectionForPitch(90)).toBe('horizontal');
    expect(cavityHeatFlowDirectionForPitch(30)).toBe('upwards');
    expect(cavityHeatFlowDirectionForPitch(180)).toBe('downwards');
  });

  it('derives BR 443 external surface resistance for well ventilated cavities', () => {
    expect(
      explicitWellVentilatedExternalSurfaceResistanceM2KPerW(
        {
          kind: 'cavity',
          ventilation: 'well_ventilated',
          gap_thickness_m: 0.05,
          surface_emissivity: 'high',
        },
        90,
      ).rSe,
    ).toBeCloseTo(0.13, 6);

    expect(
      explicitWellVentilatedExternalSurfaceResistanceM2KPerW(
        {
          kind: 'cavity',
          ventilation: 'well_ventilated',
          gap_thickness_m: 0.05,
          surface_emissivity: 'low',
        },
        30,
      ).rSe,
    ).toBeCloseTo(0.17, 6);
  });

  it('resolves effective heat-transfer layers by omitting well ventilated cavity and outer cladding', () => {
    const ctx = resolveAssemblyHeatTransferContext(
      [
        { kind: 'solid', materialId: 'a', thickness_m: 0.1 },
        {
          kind: 'cavity',
          ventilation: 'well_ventilated',
          gap_thickness_m: 0.05,
          surface_emissivity: 'high',
        },
        { kind: 'solid', materialId: 'b', thickness_m: 0.01 },
      ] as any,
      90,
    );
    expect(ctx.errors).toEqual([]);
    expect(ctx.effectiveLayers).toHaveLength(1);
    expect(ctx.externalSurfaceResistance_m2K_W).toBeCloseTo(0.13, 6);
    expect(ctx.ignoredOuterLayerCount).toBe(2);
  });
});
