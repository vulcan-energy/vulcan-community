// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * BS EN ISO 6946:2017 Annex F — corrections to thermal transmittance (ΔU) applied to the
 * simplified-method U from §6.5 / §6.7: U_c = U + ΔU_g + ΔU_f + ΔU_r (Annex F; ΔU from (F.3), (F.4), (F.6)).
 *
 * R₁ and R_tot in F.3 / F.6 use the **series-only** construction (thermal bridging ignored in layer R),
 * with R_tot including surface resistances per §6.7.1.2 formula (4).
 */

import { roundToTwoDecimals } from '../geometry/constants';
import type { AssemblyLayer, Iso6946AnnexFEnvelopeV1 } from './assemblyTypes';

/** Table F.1 — default ΔU″ (W/m²K) for air-void levels 0…2. */
export function iso6946TableF1DeltaUPrime(level: 0 | 1 | 2): number {
  switch (level) {
    case 0:
      return 0;
    case 1:
      return 0.01;
    case 2:
      return 0.04;
    default:
      return 0;
  }
}

/** Formula (F.3): ΔU_g = ΔU″ (R₁/R_tot)² */
export function iso6946DeltaUgF3(deltaUPrime_W_m2K: number, R1_m2K_W: number, Rtot_m2K_W: number): number {
  if (!(Rtot_m2K_W > 0) || !(R1_m2K_W >= 0) || !(deltaUPrime_W_m2K >= 0)) return 0;
  return deltaUPrime_W_m2K * (R1_m2K_W / Rtot_m2K_W) ** 2;
}

/** Formula (F.4): ΔU_f = n_f χ */
export function iso6946DeltaUfF4(nF_per_m2: number, chi_W_per_m2K: number): number {
  if (!(nF_per_m2 > 0) || !(chi_W_per_m2K > 0)) return 0;
  return nF_per_m2 * chi_W_per_m2K;
}

/**
 * Formula (F.6): ΔU_r = p f x (R₁/R_tot)² — p in mm/day; f·x from product / national data (default 0.04).
 */
export function iso6946DeltaUrF6(
  pMmPerDay: number,
  fTimesX: number,
  R1_m2K_W: number,
  Rtot_m2K_W: number,
): number {
  if (!(pMmPerDay > 0) || !(fTimesX > 0) || !(Rtot_m2K_W > 0) || !(R1_m2K_W >= 0)) return 0;
  return pMmPerDay * fTimesX * (R1_m2K_W / Rtot_m2K_W) ** 2;
}

/**
 * UK default: indicative heating-season average precipitation rate (mm/day) for inverted-roof
 * correction when no project-specific value is supplied (replace with Table B.7 / national data when wired).
 */
export const ISO6946_DEFAULT_UK_PRECIPITATION_HEATING_SEASON_MM_PER_DAY = 2.5;

/** Default (F.6) product f·x for butt-jointed insulation + open covering (ISO 6946 note). */
export const ISO6946_DEFAULT_INVERTED_ROOF_F_TIMES_X = 0.04;

/** ISO 6946:2017 — final U to be reported with two significant figures (§6.5.2). */
export function roundUValueToTwoSignificantFigures(u_W_m2K: number): number {
  if (!Number.isFinite(u_W_m2K) || u_W_m2K === 0) return u_W_m2K;
  const sign = u_W_m2K < 0 ? -1 : 1;
  const abs = Math.abs(u_W_m2K);
  const exp = Math.floor(Math.log10(abs));
  const power = 2 - 1 - exp;
  const shift = 10 ** power;
  return (sign * Math.round(abs * shift)) / shift;
}

export interface AnnexFComputationInput {
  /** U from combined method + films (1/R_tot), before Annex F. */
  uCombined_W_m2K: number;
  /** R_tot = R_si + ΣR_layers (series only) + R_se */
  rTotSeriesWithFilms_m2K_W: number;
  /** Per-layer series resistances (same order as `layers`). */
  layerSeriesR_m2K_W: number[];
  layers: AssemblyLayer[];
  /** Layer index for R₁ (solid or cavity — user picks target layer). */
  r1LayerIndex: number;
  airVoidLevel: 0 | 1 | 2;
  fastenerNf_per_m2: number;
  fastenerChi_W_per_m2K: number;
  invertedRoofEnabled: boolean;
  /** Only applied when inverted roof + roof fabric. */
  opaqueSubtype: 'wall' | 'roof';
  pMmPerDay: number;
  fTimesX: number;
}

export interface AnnexFComputationResult {
  R1_m2K_W: number;
  deltaU_g_W_m2K: number;
  deltaU_f_W_m2K: number;
  deltaU_r_W_m2K: number;
  deltaU_total_W_m2K: number;
  uBeforeAnnexF_W_m2K: number;
  uAfterAnnexF_W_m2K: number;
  uForHem_W_m2K: number;
}

function clampLayerIndex(layers: AssemblyLayer[], idx: number): number {
  if (layers.length === 0) return 0;
  return Math.max(0, Math.min(idx, layers.length - 1));
}

/** Prefer solid layer with largest series R for default R₁ target. */
export function defaultR1LayerIndex(layers: AssemblyLayer[], layerSeriesR: number[]): number {
  let bestI = 0;
  let bestR = -1;
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (L?.kind !== 'solid') continue;
    const r = layerSeriesR[i] ?? 0;
    if (r > bestR) {
      bestR = r;
      bestI = i;
    }
  }
  return bestI;
}

/** Whether to persist `annexF_v1` under `vulcan_assembly_v1` (omit when defaults and no effect). */
export function shouldPersistAnnexF_v1(args: {
  annex: AnnexFComputationResult;
  airVoidLevel: 0 | 1 | 2;
  /** True if any cavity layer has an explicit Annex F air-void level override. */
  hasAnnexFAirVoidLevelOverrideOnAnyCavity: boolean;
  annexFastenerEnabled: boolean;
  annexNf: number;
  annexChi: number;
  annexInvertedRoof: boolean;
  annexPMm: number;
  annexFTimesX: number;
}): boolean {
  const {
    annex,
    airVoidLevel,
    hasAnnexFAirVoidLevelOverrideOnAnyCavity,
    annexFastenerEnabled,
    annexNf,
    annexChi,
    annexInvertedRoof,
    annexPMm,
    annexFTimesX,
  } = args;
  if (Math.abs(annex.deltaU_total_W_m2K) > 1e-12) return true;
  if (airVoidLevel > 0) return true;
  if (hasAnnexFAirVoidLevelOverrideOnAnyCavity) return true;
  if (annexFastenerEnabled && (annexNf > 0 || annexChi > 0)) return true;
  if (annexInvertedRoof) return true;
  if (Math.abs(annexPMm - ISO6946_DEFAULT_UK_PRECIPITATION_HEATING_SEASON_MM_PER_DAY) > 1e-9) return true;
  if (Math.abs(annexFTimesX - ISO6946_DEFAULT_INVERTED_ROOF_F_TIMES_X) > 1e-9) return true;
  return false;
}

export function buildAnnexF_v1EnvelopeSnapshot(
  annex: AnnexFComputationResult,
  args: {
    airVoidLevel: 0 | 1 | 2;
    airVoidLayerIndex: number;
    fastenerNf_per_m2: number;
    fastenerChi_W_per_m2K: number;
    invertedRoof: boolean;
    p_mm_per_day: number;
    f_times_x: number;
  },
): Iso6946AnnexFEnvelopeV1 {
  return {
    airVoidLevel: args.airVoidLevel,
    airVoidLayerIndex: args.airVoidLayerIndex,
    fastenerNf_per_m2: args.fastenerNf_per_m2,
    fastenerChi_W_per_m2K: args.fastenerChi_W_per_m2K,
    invertedRoof: args.invertedRoof,
    p_mm_per_day: args.p_mm_per_day,
    f_times_x: args.f_times_x,
    deltaU_g_W_m2K: roundToTwoDecimals(annex.deltaU_g_W_m2K),
    deltaU_f_W_m2K: roundToTwoDecimals(annex.deltaU_f_W_m2K),
    deltaU_r_W_m2K: roundToTwoDecimals(annex.deltaU_r_W_m2K),
    uBeforeAnnexF_W_m2K: roundToTwoDecimals(annex.uBeforeAnnexF_W_m2K),
    uAfterAnnexF_beforeRounding_W_m2K: roundToTwoDecimals(annex.uAfterAnnexF_W_m2K),
  };
}

export function computeAnnexFCorrections(input: AnnexFComputationInput): AnnexFComputationResult {
  const u0 = input.uCombined_W_m2K;
  const Rtot = input.rTotSeriesWithFilms_m2K_W;
  const idx = clampLayerIndex(input.layers, input.r1LayerIndex);
  const R1 = input.layerSeriesR_m2K_W[idx] ?? 0;

  const dPrime = iso6946TableF1DeltaUPrime(input.airVoidLevel);
  const dUg = iso6946DeltaUgF3(dPrime, R1, Rtot);

  const dUf = iso6946DeltaUfF4(input.fastenerNf_per_m2, input.fastenerChi_W_per_m2K);

  let dUr = 0;
  if (
    input.invertedRoofEnabled &&
    input.opaqueSubtype === 'roof' &&
    input.pMmPerDay > 0 &&
    input.fTimesX > 0
  ) {
    dUr = iso6946DeltaUrF6(input.pMmPerDay, input.fTimesX, R1, Rtot);
  }

  const dTot = dUg + dUf + dUr;
  const u1 = u0 + dTot;
  const uHem = roundUValueToTwoSignificantFigures(u1);

  return {
    R1_m2K_W: R1,
    deltaU_g_W_m2K: dUg,
    deltaU_f_W_m2K: dUf,
    deltaU_r_W_m2K: dUr,
    deltaU_total_W_m2K: dTot,
    uBeforeAnnexF_W_m2K: u0,
    uAfterAnnexF_W_m2K: u1,
    uForHem_W_m2K: uHem,
  };
}
