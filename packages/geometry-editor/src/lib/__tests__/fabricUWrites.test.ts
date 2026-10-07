// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { unavailableGeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { computeOpaqueUAndTotals } from '../assemblyCalculator';
import { DEFAULT_EXTERNAL_SURFACE_RESISTANCE_M2K_W } from '../assemblyCavityModel';
import { computeFabricUWritesFromConstructionR } from '../fabricUWrites';
import { roundUValueToTwoSignificantFigures } from '../iso6946AnnexF';
import { roundToTwoDecimals } from '../../geometry/constants';
import { validateElementCore } from '../../geometry/validation/validateElement';
import type { Element } from '../../geometry/types';

/** HEM drops `u_value` and recomputes U from `thermal_resistance_construction` with its own films. */
const hemU = (r: number, pitch: number) => computeOpaqueUAndTotals(r, pitch).u;

function uRMismatchWarnings(uValue: number, r: number, pitch = 90): string[] {
  const element = {
    id: 'w1',
    name: 'Wall',
    type: 'BuildingElementOpaque',
    zoneId: 'z1',
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }],
    width: 5,
    height: 2.4,
    area: 12,
    pitch,
    orientation360: 180,
    base_height: 0,
    extra_json: { u_value: uValue, thermal_resistance_construction: r },
  } as unknown as Element;
  return validateElementCore(element, { schemaPort: unavailableGeometrySchemaPort })
    .warnings.map((w) => w.message)
    .filter((m) => m.includes('U/R mismatch'));
}

describe('fabricUWrites', () => {
  it('computeFabricUWritesFromConstructionR matches rounded-R U pipeline', () => {
    const rMean = 2.345678;
    const rSeries = 2.111;
    const pitch = 90;
    const out = computeFabricUWritesFromConstructionR(rMean, rSeries, pitch);

    const rW = roundToTwoDecimals(rMean);
    const uComb = computeOpaqueUAndTotals(rW, pitch).u;
    const rSer = roundToTwoDecimals(rSeries);
    const uSer = computeOpaqueUAndTotals(rSer, pitch).u;

    expect(out.thermalResistanceConstruction_m2K_W).toBe(rW);
    expect(out.uCombinedFromRoundedConstruction_W_m2K).toBeCloseTo(uComb, 12);
    expect(out.uForHem_W_m2K).toBe(roundUValueToTwoSignificantFigures(uComb));
    expect(out.thermalResistanceSeries_m2K_W).toBe(rSer);
    expect(out.uncorrectedU_twoSf_W_m2K).toBe(roundUValueToTwoSignificantFigures(uSer));
  });

  it('leaves the default case (default R_se, no Annex F) unchanged', () => {
    const rMean = 2.345678;
    const out = computeFabricUWritesFromConstructionR(
      rMean,
      2.111,
      90,
      DEFAULT_EXTERNAL_SURFACE_RESISTANCE_M2K_W,
      0,
    );
    const rW = roundToTwoDecimals(rMean);
    expect(out.thermalResistanceConstruction_m2K_W).toBe(rW);
    expect(out.uForHem_W_m2K).toBe(
      roundUValueToTwoSignificantFigures(
        computeOpaqueUAndTotals(rW, 90, DEFAULT_EXTERNAL_SURFACE_RESISTANCE_M2K_W).u,
      ),
    );
  });

  it('expresses a ventilated-cavity R_se in the written R so HEM reproduces the written U', () => {
    const out = computeFabricUWritesFromConstructionR(2, 2, 90, 0.13);
    expect(hemU(out.thermalResistanceConstruction_m2K_W, 90)).toBeCloseTo(0.44, 2);
    expect(uRMismatchWarnings(0.44, out.thermalResistanceConstruction_m2K_W)).toEqual([]);
    expect(out.uForHem_W_m2K).toBe(0.44);
  });

  it('expresses the Annex F ΔU in the written R so HEM reproduces the corrected U', () => {
    const out = computeFabricUWritesFromConstructionR(
      5,
      5,
      90,
      DEFAULT_EXTERNAL_SURFACE_RESISTANCE_M2K_W,
      0.036,
    );
    expect(hemU(out.thermalResistanceConstruction_m2K_W, 90)).toBeCloseTo(0.23, 2);
    expect(uRMismatchWarnings(0.23, out.thermalResistanceConstruction_m2K_W)).toEqual([]);
    expect(out.uForHem_W_m2K).toBe(0.23);
  });
});
