// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ISO 6946 Annex F air-void (ΔU_g) integration with assembly cavity layers.
 * Table F.1 levels are suggested per `cavityType` in `cavity_resistances.json`; optional per-layer override.
 */

import type { AssemblyLayer, AssemblyLayerCavity, CavityRow } from './assemblyTypes';
import { defaultR1LayerIndex } from './iso6946AnnexF';
import { isExplicitWellVentilatedCavity } from './assemblyCavityModel';

/** User-facing labels for Table F.1 levels (ΔU″ bands). */
export const ISO6946_ANNEX_F_AIR_VOID_EFFECT_LABELS: Record<0 | 1 | 2, string> = {
  0: 'No extra correction',
  1: 'Smaller added effect',
  2: 'Larger added effect',
};

export function collectCavityLayerIndices(layers: AssemblyLayer[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (layer?.kind === 'cavity' && isExplicitWellVentilatedCavity(layer)) break;
    if (layer?.kind === 'cavity') out.push(i);
  }
  return out;
}

/** Default Annex F Table F.1 level from library row; missing → 0. */
export function defaultAnnexFAirVoidLevelForCavityType(
  cavityType: string | undefined,
  cavityRows: CavityRow[],
): 0 | 1 | 2 {
  if (!cavityType) return 0;
  const row = cavityRows.find((c) => c.cavityType === cavityType);
  const d = row?.iso6946AnnexFAirVoidLevelDefault;
  if (d === 0 || d === 1 || d === 2) return d;
  return 0;
}

/** Effective Table F.1 level for a cavity layer (override or library default). */
export function effectiveAnnexFAirVoidLevelForCavityLayer(
  layer: AssemblyLayerCavity,
  cavityRows: CavityRow[],
): 0 | 1 | 2 {
  if (layer.annexFAirVoidLevelOverride !== undefined) {
    return layer.annexFAirVoidLevelOverride;
  }
  return defaultAnnexFAirVoidLevelForCavityType(layer.cavityType, cavityRows);
}

/**
 * Which cavity layer drives ΔU_g / R₁ for F.3: single cavity → that index; multiple → user primary if valid, else first cavity in stack order.
 */
export function resolveAnnexFPrimaryCavityLayerIndex(
  layers: AssemblyLayer[],
  userPrimaryIndex: number | null,
): number | null {
  const cavities = collectCavityLayerIndices(layers);
  if (cavities.length === 0) return null;
  if (cavities.length === 1) return cavities[0]!;
  if (userPrimaryIndex != null && cavities.includes(userPrimaryIndex)) return userPrimaryIndex;
  return cavities[0]!;
}

/** Effective air void level for Annex F (0 if no cavity). */
export function effectiveAnnexFAirVoidLevelForStack(
  layers: AssemblyLayer[],
  cavityRows: CavityRow[],
  primaryCavityIndex: number | null,
): 0 | 1 | 2 {
  if (primaryCavityIndex == null) return 0;
  const L = layers[primaryCavityIndex];
  if (!L || L.kind !== 'cavity') return 0;
  return effectiveAnnexFAirVoidLevelForCavityLayer(L, cavityRows);
}

/**
 * R₁ layer index for F.3 / F.6: primary cavity if present; else largest solid series R (ISO default heuristic).
 */
export function resolveAnnexFR1LayerIndex(
  layers: AssemblyLayer[],
  layerSeriesR_m2K_W: number[],
  primaryCavityIndex: number | null,
): number {
  if (primaryCavityIndex != null && layers[primaryCavityIndex]?.kind === 'cavity') {
    return primaryCavityIndex;
  }
  return defaultR1LayerIndex(layers, layerSeriesR_m2K_W);
}
