// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { AssemblyLayer, AssemblyLayerCavity } from './assemblyTypes';

export type AssemblyCavityHeatFlow = 'horizontal' | 'upwards' | 'downwards';
export type AssemblyCavityVentilation = 'unventilated' | 'well_ventilated';

export const DEFAULT_EXPLICIT_UNVENTILATED_CAVITY_GAP_M = 0.05;
export const LOW_EMISSIVITY_MIN_GAP_M = 0.025;
export const DEFAULT_EXTERNAL_SURFACE_RESISTANCE_M2K_W = 0.04;

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function cavityHeatFlowDirectionForPitch(pitchDeg: number): AssemblyCavityHeatFlow {
  if (pitchDeg >= 60 && pitchDeg <= 120) return 'horizontal';
  if (pitchDeg < 60) return 'upwards';
  return 'downwards';
}

export function cavityHeatFlowLabel(flow: AssemblyCavityHeatFlow): string {
  switch (flow) {
    case 'horizontal':
      return 'horizontal';
    case 'upwards':
      return 'upwards';
    case 'downwards':
      return 'downwards';
    default:
      return 'horizontal';
  }
}

export function cavitySurfaceEmissivityLabel(value: 'high' | 'low' | undefined): string {
  return value === 'low' ? 'low emissivity' : 'high emissivity';
}

export function cavityVentilationLabel(value: AssemblyCavityVentilation | undefined): string {
  return value === 'well_ventilated' ? 'well ventilated' : 'unventilated';
}

export function isExplicitCavity(layer: AssemblyLayerCavity): boolean {
  return (
    (layer.ventilation === 'unventilated' || layer.gap_thickness_m !== undefined || layer.surface_emissivity !== undefined) &&
    (layer.ventilation === undefined || layer.ventilation === 'unventilated' || layer.ventilation === 'well_ventilated') &&
    (layer.surface_emissivity === 'high' || layer.surface_emissivity === 'low')
  );
}

export function isExplicitUnventilatedCavity(layer: AssemblyLayerCavity): boolean {
  return isExplicitCavity(layer) && (layer.ventilation ?? 'unventilated') === 'unventilated';
}

export function isExplicitWellVentilatedCavity(layer: AssemblyLayerCavity): boolean {
  return isExplicitCavity(layer) && layer.ventilation === 'well_ventilated';
}

export function explicitUnventilatedCavityResistanceM2KPerW(
  layer: AssemblyLayerCavity,
  pitchDeg: number,
): { r: number; error?: string } {
  const gapM = finitePositive(layer.gap_thickness_m);
  if (gapM == null) {
    return { r: 0, error: 'Explicit cavity gap must be greater than zero.' };
  }
  const emissivity = layer.surface_emissivity;
  if (emissivity !== 'high' && emissivity !== 'low') {
    return { r: 0, error: 'Explicit cavity emissivity must be high or low.' };
  }

  if (emissivity === 'high') {
    // Conservative BR 443-based conventions available in-repo:
    // - 15 mm dabs void = 0.17 m2K/W
    // - typical unventilated cavity / 22 mm lining void = 0.18 m2K/W
    // Full ISO 6946 tabulated air-layer data is not bundled in the product.
    return { r: gapM <= 0.0155 ? 0.17 : 0.18 };
  }

  if (gapM + 1e-9 < LOW_EMISSIVITY_MIN_GAP_M) {
    return {
      r: 0,
      error: 'Low-emissivity cavities need a gap of at least 25 mm in the current BR 443-based convention.',
    };
  }

  const heatFlow = cavityHeatFlowDirectionForPitch(pitchDeg);
  switch (heatFlow) {
    case 'horizontal':
      return { r: 0.44 };
    case 'upwards':
      return { r: 0.34 };
    case 'downwards':
      return { r: 0.5 };
    default:
      return { r: 0.44 };
  }
}

export function effectiveCavityResistanceM2KPerW(
  layer: AssemblyLayerCavity,
  pitchDeg: number,
  cavityResistanceByType: Map<string, number>,
): { r: number; error?: string } {
  if (isExplicitWellVentilatedCavity(layer)) {
    return { r: 0, error: 'Well ventilated cavities do not contribute a layer resistance directly.' };
  }
  if (isExplicitUnventilatedCavity(layer)) {
    return explicitUnventilatedCavityResistanceM2KPerW(layer, pitchDeg);
  }

  let r = finitePositive(layer.fixedResistance_m2K_W) ?? 0;
  if (!(r > 0) && layer.cavityType) {
    r = cavityResistanceByType.get(layer.cavityType) ?? 0;
  }
  if (!(r > 0)) {
    return {
      r: 0,
      error: layer.cavityType
        ? `Cavity "${layer.cavityType}" has no valid fixed resistance`
        : 'Cavity has no valid resistance definition.',
    };
  }
  return { r };
}

export function cavityPhysicalThicknessM(layer: AssemblyLayerCavity): number | null {
  const explicitGap = finitePositive(layer.gap_thickness_m);
  if (explicitGap != null) return explicitGap;

  switch (layer.cavityType) {
    case 'plasterboard_on_dabs_15mm_airspace':
      return 0.015;
    case 'dry_lining_battens_22mm_airspace':
      return 0.022;
    case 'unventilated_low_emissivity_horizontal':
    case 'unventilated_low_emissivity_upwards':
    case 'unventilated_low_emissivity_downwards':
      return LOW_EMISSIVITY_MIN_GAP_M;
    case 'unventilated_wall_cavity_high_emissivity':
      return DEFAULT_EXPLICIT_UNVENTILATED_CAVITY_GAP_M;
    default:
      return layer.cavityType || finitePositive(layer.fixedResistance_m2K_W) != null
        ? DEFAULT_EXPLICIT_UNVENTILATED_CAVITY_GAP_M
        : null;
  }
}

export function migrateLegacyCavityLayer(layer: AssemblyLayerCavity): AssemblyLayerCavity {
  if (isExplicitCavity(layer)) {
    return layer.ventilation === undefined ? { ...layer, ventilation: 'unventilated' } : layer;
  }

  const base = {
    kind: 'cavity' as const,
    ventilation: 'unventilated' as const,
    annexFAirVoidLevelOverride: layer.annexFAirVoidLevelOverride,
    cavityType: layer.cavityType,
  };

  switch (layer.cavityType) {
    case 'plasterboard_on_dabs_15mm_airspace':
      return { ...base, gap_thickness_m: 0.015, surface_emissivity: 'high' };
    case 'dry_lining_battens_22mm_airspace':
      return { ...base, gap_thickness_m: 0.022, surface_emissivity: 'high' };
    case 'unventilated_low_emissivity_horizontal':
    case 'unventilated_low_emissivity_upwards':
    case 'unventilated_low_emissivity_downwards':
      return { ...base, gap_thickness_m: LOW_EMISSIVITY_MIN_GAP_M, surface_emissivity: 'low' };
    case 'unventilated_wall_cavity_high_emissivity':
      return { ...base, gap_thickness_m: DEFAULT_EXPLICIT_UNVENTILATED_CAVITY_GAP_M, surface_emissivity: 'high' };
    default: {
      const migratedGap = cavityPhysicalThicknessM(layer) ?? DEFAULT_EXPLICIT_UNVENTILATED_CAVITY_GAP_M;
      return { ...base, gap_thickness_m: migratedGap, surface_emissivity: 'high' };
    }
  }
}

export function explicitWellVentilatedExternalSurfaceResistanceM2KPerW(
  layer: AssemblyLayerCavity,
  pitchDeg: number,
): { rSe: number; error?: string } {
  const gapM = finitePositive(layer.gap_thickness_m);
  if (gapM == null) {
    return { rSe: 0, error: 'Ventilated cavity gap must be greater than zero.' };
  }
  const emissivity = layer.surface_emissivity;
  if (emissivity !== 'high' && emissivity !== 'low') {
    return { rSe: 0, error: 'Ventilated cavity emissivity must be high or low.' };
  }
  const heatFlow = cavityHeatFlowDirectionForPitch(pitchDeg);
  if (heatFlow === 'downwards') {
    return {
      rSe: 0,
      error: 'Well ventilated cavities are not supported for downward heat flow in the current BR 443-based model.',
    };
  }
  if (emissivity === 'high') {
    return { rSe: heatFlow === 'horizontal' ? 0.13 : 0.1 };
  }
  return { rSe: heatFlow === 'horizontal' ? 0.29 : 0.17 };
}

export interface AssemblyHeatTransferContext {
  effectiveLayers: AssemblyLayer[];
  externalSurfaceResistance_m2K_W: number;
  wellVentilatedCavityIndex: number | null;
  ignoredOuterLayerCount: number;
  errors: string[];
}

export interface SuspendedGroundVentilatedVoidContext {
  hasVentilatedVoid: boolean;
  voidLayerIndex: number | null;
  heightUpperSurfaceM: number | null;
  rfLayers: AssemblyLayer[];
  rgLayers: AssemblyLayer[];
  errors: string[];
}

export function resolveSuspendedGroundVentilatedVoidContext(
  layers: AssemblyLayer[],
): SuspendedGroundVentilatedVoidContext {
  const wellVentilatedIndices: number[] = [];
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (L?.kind === 'cavity' && isExplicitWellVentilatedCavity(L)) wellVentilatedIndices.push(i);
  }
  if (wellVentilatedIndices.length === 0) {
    return {
      hasVentilatedVoid: false,
      voidLayerIndex: null,
      heightUpperSurfaceM: null,
      rfLayers: layers,
      rgLayers: [],
      errors: [],
    };
  }
  if (wellVentilatedIndices.length > 1) {
    const first = wellVentilatedIndices[0]!;
    return {
      hasVentilatedVoid: true,
      voidLayerIndex: first,
      heightUpperSurfaceM: cavityPhysicalThicknessM(layers[first] as AssemblyLayerCavity),
      rfLayers: layers.slice(0, first),
      rgLayers: layers.slice(first + 1),
      errors: ['Only one ventilated underfloor void is supported in a suspended-floor assembly.'],
    };
  }
  const index = wellVentilatedIndices[0]!;
  const cavity = layers[index] as AssemblyLayerCavity;
  const heightUpperSurfaceM = cavityPhysicalThicknessM(cavity);
  const errors: string[] = [];
  if (index === 0) {
    errors.push('Add at least one floor-construction layer above the ventilated underfloor void.');
  }
  if (!(heightUpperSurfaceM != null && heightUpperSurfaceM > 0)) {
    errors.push('Ventilated underfloor void needs a positive gap to derive height_upper_surface.');
  }
  return {
    hasVentilatedVoid: true,
    voidLayerIndex: index,
    heightUpperSurfaceM,
    rfLayers: layers.slice(0, index),
    rgLayers: layers.slice(index + 1),
    errors,
  };
}

export function resolveAssemblyHeatTransferContext(
  layers: AssemblyLayer[],
  pitchDeg: number,
): AssemblyHeatTransferContext {
  const wellVentilatedIndices: number[] = [];
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (L?.kind === 'cavity' && isExplicitWellVentilatedCavity(L)) wellVentilatedIndices.push(i);
  }
  if (wellVentilatedIndices.length === 0) {
    return {
      effectiveLayers: layers,
      externalSurfaceResistance_m2K_W: DEFAULT_EXTERNAL_SURFACE_RESISTANCE_M2K_W,
      wellVentilatedCavityIndex: null,
      ignoredOuterLayerCount: 0,
      errors: [],
    };
  }
  if (wellVentilatedIndices.length > 1) {
    const firstIndex = wellVentilatedIndices[0]!;
    return {
      effectiveLayers: layers.slice(0, firstIndex),
      externalSurfaceResistance_m2K_W: DEFAULT_EXTERNAL_SURFACE_RESISTANCE_M2K_W,
      wellVentilatedCavityIndex: firstIndex,
      ignoredOuterLayerCount: Math.max(0, layers.length - firstIndex),
      errors: ['Only one well ventilated cavity is supported in a single assembly stack.'],
    };
  }
  const index = wellVentilatedIndices[0]!;
  const cavity = layers[index] as AssemblyLayerCavity;
  const { rSe, error } = explicitWellVentilatedExternalSurfaceResistanceM2KPerW(cavity, pitchDeg);
  return {
    effectiveLayers: layers.slice(0, index),
    externalSurfaceResistance_m2K_W: error ? DEFAULT_EXTERNAL_SURFACE_RESISTANCE_M2K_W : rSe,
    wellVentilatedCavityIndex: index,
    ignoredOuterLayerCount: Math.max(0, layers.length - index),
    errors: error ? [error] : [],
  };
}
