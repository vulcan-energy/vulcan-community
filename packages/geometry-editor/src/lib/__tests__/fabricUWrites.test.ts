// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { computeOpaqueUAndTotals } from '../assemblyCalculator';
import { computeFabricUWritesFromConstructionR } from '../fabricUWrites';
import { roundUValueToTwoSignificantFigures } from '../iso6946AnnexF';
import { roundToTwoDecimals } from '../../geometry/constants';

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
    expect(out.uCombinedTwoSf_W_m2K).toBe(roundUValueToTwoSignificantFigures(uComb));
    expect(out.thermalResistanceSeries_m2K_W).toBe(rSer);
    expect(out.uncorrectedU_twoSf_W_m2K).toBe(roundUValueToTwoSignificantFigures(uSer));
  });
});
