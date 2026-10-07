// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared fabric U-value writes for assembly apply paths (layered calculator + saved library).
 * Combines ISO 6946 mean/series construction R with surface films, then rounds R for persistence
 * and applies two significant figures to U where required for HEM.
 *
 * HEM drops `u_value` whenever `thermal_resistance_construction` is present and recomputes U from R
 * with its own films (R_si by pitch + fixed R_se). When the assembly U carries an Annex F ΔU or a
 * ventilated-cavity R_se, the written R is therefore the HEM-convention R for the final U.
 */

import { roundToTwoDecimals } from '../geometry/constants';
import { computeOpaqueUAndTotals, convertUvalueToResistance } from './assemblyCalculator';
import { DEFAULT_EXTERNAL_SURFACE_RESISTANCE_M2K_W } from './assemblyCavityModel';
import {
  computeAnnexFCorrections,
  roundUValueToTwoSignificantFigures,
  type AnnexFComputationInput,
  type AnnexFComputationResult,
} from './iso6946AnnexF';

export interface FabricUWritesFromConstructionR {
  /**
   * Construction R written to `thermal_resistance_construction`: the rounded combined-method R, or —
   * when Annex F ΔU / a non-default R_se applies — the rounded R from which HEM reproduces {@link uForHem_W_m2K}.
   */
  thermalResistanceConstruction_m2K_W: number;
  /** U from rounded combined R + films — same basis as Annex F “before” when annex uses combined-method U. */
  uCombinedFromRoundedConstruction_W_m2K: number;
  /** Final U for HEM, two significant figures (Annex F ΔU included). */
  uForHem_W_m2K: number;
  /** Rounded series-only construction R (audit). */
  thermalResistanceSeries_m2K_W: number;
  /** Series-only U with films, two significant figures — `uncorrectedU_W_m2K` / clear-field audit. */
  uncorrectedU_twoSf_W_m2K: number;
  /** Set when the corrections leave no positive construction R for HEM; nothing should be written. */
  error: string | null;
}

/**
 * From raw combined-mean and series construction resistances (m²K/W), produce rounded R values and
 * 2 s.f. U values aligned with {@link AssemblyCalculatorModal} apply and
 * {@link computePatchFromSavedAssembly}. `annexFDeltaU_W_m2K` is the Annex F ΔU total added to the
 * combined-method U (0 when no corrections apply).
 */
export function computeFabricUWritesFromConstructionR(
  rConstructionMean_m2K_W: number,
  rConstructionSeries_m2K_W: number,
  pitchDeg: number,
  externalSurfaceResistance_m2K_W?: number,
  annexFDeltaU_W_m2K = 0,
): FabricUWritesFromConstructionR {
  const roundedConstructionR = roundToTwoDecimals(rConstructionMean_m2K_W);
  const uCombinedFromRoundedConstruction_W_m2K = computeOpaqueUAndTotals(
    roundedConstructionR,
    pitchDeg,
    externalSurfaceResistance_m2K_W,
  ).u;
  const needsHemConvention =
    annexFDeltaU_W_m2K !== 0 ||
    (externalSurfaceResistance_m2K_W !== undefined &&
      externalSurfaceResistance_m2K_W !== DEFAULT_EXTERNAL_SURFACE_RESISTANCE_M2K_W);
  const uFinal = needsHemConvention
    ? computeOpaqueUAndTotals(rConstructionMean_m2K_W, pitchDeg, externalSurfaceResistance_m2K_W).u +
      annexFDeltaU_W_m2K
    : uCombinedFromRoundedConstruction_W_m2K;
  const thermalResistanceConstruction_m2K_W = needsHemConvention
    ? roundToTwoDecimals(convertUvalueToResistance(uFinal, pitchDeg))
    : roundedConstructionR;
  const uForHem_W_m2K = roundUValueToTwoSignificantFigures(uFinal);
  const error =
    Number.isFinite(thermalResistanceConstruction_m2K_W) && thermalResistanceConstruction_m2K_W > 0
      ? null
      : 'The Annex F / surface-resistance corrections leave a non-positive construction resistance for HEM — reduce the corrections.';

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
    uForHem_W_m2K,
    thermalResistanceSeries_m2K_W,
    uncorrectedU_twoSf_W_m2K,
    error,
  };
}

/**
 * ISO 6946 Annex F on the whole construction, plus the ΔU to pass to
 * {@link computeFabricUWritesFromConstructionR} for the element as written.
 *
 * Annex F corrects the U of the real construction between its two environments, so R₁/R_tot (and
 * U before correction) use the full construction. Half-construction elements (party wall, adjacent
 * conditioned space) then take half of the corrected construction resistance, like the uncorrected
 * one; the returned ΔU is the change in the half element's U that reproduces that.
 */
export function computeAssemblyAnnexF(
  input: Omit<AnnexFComputationInput, 'uCombined_W_m2K' | 'rTotSeriesWithFilms_m2K_W'> & {
    rFullMean_m2K_W: number;
    rFullSeries_m2K_W: number;
    pitchDeg: number;
    externalSurfaceResistance_m2K_W: number;
    halfConstruction: boolean;
  },
): { annex: AnnexFComputationResult; deltaUForElement_W_m2K: number } {
  const { rFullMean_m2K_W, rFullSeries_m2K_W, pitchDeg, externalSurfaceResistance_m2K_W, halfConstruction } =
    input;
  const full = computeOpaqueUAndTotals(rFullMean_m2K_W, pitchDeg, externalSurfaceResistance_m2K_W);
  const annex = computeAnnexFCorrections({
    ...input,
    uCombined_W_m2K: full.u,
    rTotSeriesWithFilms_m2K_W: computeOpaqueUAndTotals(rFullSeries_m2K_W, pitchDeg, externalSurfaceResistance_m2K_W)
      .rTot,
  });
  if (!halfConstruction) return { annex, deltaUForElement_W_m2K: annex.deltaU_total_W_m2K };
  const films = full.rSi + full.rSe;
  const rCorrectedFull = 1 / annex.uAfterAnnexF_W_m2K - films;
  const uHalf = (r: number) => computeOpaqueUAndTotals(r / 2, pitchDeg, externalSurfaceResistance_m2K_W).u;
  return { annex, deltaUForElement_W_m2K: uHalf(rCorrectedFull) - uHalf(rFullMean_m2K_W) };
}
