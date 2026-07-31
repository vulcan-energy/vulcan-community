// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared fabric U-value writes for assembly apply paths (layered calculator + saved library).
 * Combines ISO 6946 mean/series construction R with surface films, then rounds R for persistence
 * and applies two significant figures to U where required for HEM.
 */

import { roundToTwoDecimals } from '../geometry/constants';
import { computeOpaqueUAndTotals } from './assemblyCalculator';
import { roundUValueToTwoSignificantFigures } from './iso6946AnnexF';

export interface FabricUWritesFromConstructionR {
  /** Rounded combined-method construction R (written to `thermal_resistance_construction`). */
  thermalResistanceConstruction_m2K_W: number;
  /** U from rounded combined R + films — same basis as Annex F “before” when annex uses combined-method U. */
  uCombinedFromRoundedConstruction_W_m2K: number;
  /** Two significant figures of {@link uCombinedFromRoundedConstruction_W_m2K} — HEM U when no Annex F corrections. */
  uCombinedTwoSf_W_m2K: number;
  /** Rounded series-only construction R (audit). */
  thermalResistanceSeries_m2K_W: number;
  /** Series-only U with films, two significant figures — `uncorrectedU_W_m2K` / clear-field audit. */
  uncorrectedU_twoSf_W_m2K: number;
}

/**
 * From raw combined-mean and series construction resistances (m²K/W), produce rounded R values and
 * 2 s.f. U values aligned with {@link AssemblyCalculatorModal} apply and
 * {@link computePatchFromSavedAssembly}.
 */
export function computeFabricUWritesFromConstructionR(
  rConstructionMean_m2K_W: number,
  rConstructionSeries_m2K_W: number,
  pitchDeg: number,
  externalSurfaceResistance_m2K_W?: number,
): FabricUWritesFromConstructionR {
  const thermalResistanceConstruction_m2K_W = roundToTwoDecimals(rConstructionMean_m2K_W);
  const uCombinedFromRoundedConstruction_W_m2K = computeOpaqueUAndTotals(
    thermalResistanceConstruction_m2K_W,
    pitchDeg,
    externalSurfaceResistance_m2K_W,
  ).u;
  const uCombinedTwoSf_W_m2K = roundUValueToTwoSignificantFigures(uCombinedFromRoundedConstruction_W_m2K);

  const thermalResistanceSeries_m2K_W = roundToTwoDecimals(rConstructionSeries_m2K_W);
  const uSeriesRaw = computeOpaqueUAndTotals(
    thermalResistanceSeries_m2K_W,
    pitchDeg,
    externalSurfaceResistance_m2K_W,
  ).u;
  const uncorrectedU_twoSf_W_m2K = roundUValueToTwoSignificantFigures(uSeriesRaw);

  return {
    thermalResistanceConstruction_m2K_W,
    uCombinedFromRoundedConstruction_W_m2K,
    uCombinedTwoSf_W_m2K,
    thermalResistanceSeries_m2K_W,
    uncorrectedU_twoSf_W_m2K,
  };
}
