// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  buildAnnexF_v1EnvelopeSnapshot,
  computeAnnexFCorrections,
  defaultR1LayerIndex,
  ISO6946_DEFAULT_INVERTED_ROOF_F_TIMES_X,
  ISO6946_DEFAULT_UK_PRECIPITATION_HEATING_SEASON_MM_PER_DAY,
  iso6946DeltaUgF3,
  iso6946TableF1DeltaUPrime,
  roundUValueToTwoSignificantFigures,
  shouldPersistAnnexF_v1,
} from '../iso6946AnnexF';
import type { AssemblyLayer } from '../assemblyTypes';

describe('iso6946AnnexF', () => {
  it('roundUValueToTwoSignificantFigures matches ISO reporting', () => {
    expect(roundUValueToTwoSignificantFigures(0.183)).toBeCloseTo(0.18, 10);
    expect(roundUValueToTwoSignificantFigures(0.18)).toBe(0.18);
    expect(roundUValueToTwoSignificantFigures(1.23)).toBeCloseTo(1.2, 10);
  });

  it('Table F.1 ΔU″', () => {
    expect(iso6946TableF1DeltaUPrime(0)).toBe(0);
    expect(iso6946TableF1DeltaUPrime(1)).toBe(0.01);
    expect(iso6946TableF1DeltaUPrime(2)).toBe(0.04);
  });

  it('F.3 ΔU_g example', () => {
    const d = iso6946DeltaUgF3(0.04, 2, 5);
    expect(d).toBeCloseTo(0.04 * (2 / 5) ** 2, 12);
  });

  it('computeAnnexFCorrections: zero extras leaves U unchanged before rounding', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'a', thickness_m: 0.1 },
      { kind: 'solid', materialId: 'b', thickness_m: 0.2 },
    ];
    const layerR = [0.5, 1.0];
    const Rtot = 0.13 + 0.5 + 1.0 + 0.04;
    const u0 = 1 / Rtot;
    const out = computeAnnexFCorrections({
      uCombined_W_m2K: u0,
      rTotSeriesWithFilms_m2K_W: Rtot,
      layerSeriesR_m2K_W: layerR,
      layers,
      r1LayerIndex: 1,
      airVoidLevel: 0,
      fastenerNf_per_m2: 0,
      fastenerChi_W_per_m2K: 0,
      invertedRoofEnabled: false,
      opaqueSubtype: 'wall',
      pMmPerDay: 2.5,
      fTimesX: 0.04,
    });
    expect(out.deltaU_total_W_m2K).toBe(0);
    expect(out.uAfterAnnexF_W_m2K).toBeCloseTo(u0, 10);
    expect(out.uForHem_W_m2K).toBe(roundUValueToTwoSignificantFigures(u0));
  });

  it('defaultR1LayerIndex picks solid with largest R', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'a', thickness_m: 0.1 },
      { kind: 'cavity', cavityType: 'c', fixedResistance_m2K_W: 0.18 },
      { kind: 'solid', materialId: 'b', thickness_m: 0.2 },
    ];
    expect(defaultR1LayerIndex(layers, [0.1, 0.18, 3.0])).toBe(2);
  });

  it('shouldPersistAnnexF_v1 is false for defaults and zero ΔU', () => {
    const annex = computeAnnexFCorrections({
      uCombined_W_m2K: 0.2,
      rTotSeriesWithFilms_m2K_W: 5,
      layerSeriesR_m2K_W: [1, 2],
      layers: [
        { kind: 'solid', materialId: 'a', thickness_m: 0.1 },
        { kind: 'solid', materialId: 'b', thickness_m: 0.1 },
      ],
      r1LayerIndex: 0,
      airVoidLevel: 0,
      fastenerNf_per_m2: 0,
      fastenerChi_W_per_m2K: 0,
      invertedRoofEnabled: false,
      opaqueSubtype: 'wall',
      pMmPerDay: ISO6946_DEFAULT_UK_PRECIPITATION_HEATING_SEASON_MM_PER_DAY,
      fTimesX: ISO6946_DEFAULT_INVERTED_ROOF_F_TIMES_X,
    });
    expect(
      shouldPersistAnnexF_v1({
        annex,
        airVoidLevel: 0,
        hasAnnexFAirVoidLevelOverrideOnAnyCavity: false,
        annexFastenerEnabled: false,
        annexNf: 0,
        annexChi: 0,
        annexInvertedRoof: false,
        annexPMm: ISO6946_DEFAULT_UK_PRECIPITATION_HEATING_SEASON_MM_PER_DAY,
        annexFTimesX: ISO6946_DEFAULT_INVERTED_ROOF_F_TIMES_X,
      }),
    ).toBe(false);
  });

  it('buildAnnexF_v1EnvelopeSnapshot rounds audit fields', () => {
    const annex = computeAnnexFCorrections({
      uCombined_W_m2K: 0.2,
      rTotSeriesWithFilms_m2K_W: 5,
      layerSeriesR_m2K_W: [2, 1],
      layers: [
        { kind: 'solid', materialId: 'a', thickness_m: 0.1 },
        { kind: 'solid', materialId: 'b', thickness_m: 0.1 },
      ],
      r1LayerIndex: 0,
      airVoidLevel: 2,
      fastenerNf_per_m2: 0,
      fastenerChi_W_per_m2K: 0,
      invertedRoofEnabled: false,
      opaqueSubtype: 'wall',
      pMmPerDay: 2.5,
      fTimesX: 0.04,
    });
    const snap = buildAnnexF_v1EnvelopeSnapshot(annex, {
      airVoidLevel: 2,
      airVoidLayerIndex: 0,
      fastenerNf_per_m2: 0,
      fastenerChi_W_per_m2K: 0,
      invertedRoof: false,
      p_mm_per_day: 2.5,
      f_times_x: 0.04,
    });
    expect(snap.airVoidLevel).toBe(2);
    expect(typeof snap.deltaU_g_W_m2K).toBe('number');
  });
});
