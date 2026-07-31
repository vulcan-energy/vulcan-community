// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Layer resistance and U-value helpers aligned with hem_engine surface films
 * (BS EN ISO 13789 Table 8 — see hem_engine building_element.rs).
 */

import type { AssemblyLayer, AssemblyLayerSolid, MaterialRow, RepeatingBridgeDefinition } from './assemblyTypes';
import {
  effectiveCavityResistanceM2KPerW,
  migrateLegacyCavityLayer,
  resolveAssemblyHeatTransferContext,
  resolveSuspendedGroundVentilatedVoidContext,
} from './assemblyCavityModel';

/** Mirror hem_engine/src/core/space_heat_demand/building_element.rs */
const H_RI = 5.13;
const H_CI_UPWARDS = 5.0;
const H_CI_HORIZONTAL = 2.5;
const H_CI_DOWNWARDS = 0.7;
const H_CE = 20.0;
const H_RE = 4.14;

export const R_SI_HORIZONTAL = 1.0 / (H_RI + H_CI_HORIZONTAL);
export const R_SI_UPWARDS = 1.0 / (H_RI + H_CI_UPWARDS);
export const R_SI_DOWNWARDS = 1.0 / (H_RI + H_CI_DOWNWARDS);
export const R_SE = 1.0 / (H_CE + H_RE);

const PITCH_LIMIT_HORIZ_CEILING = 60.0;
const PITCH_LIMIT_HORIZ_FLOOR = 120.0;

const FRAC_EPS = 1e-9;

export const CALCULATION_ENGINE_VERSION = 'vulcan-assembly-calc/0.6.0';

/** Volumetric heat capacity C_v = ρ·c (J/(m³·K)), or from tabulated MJ/(m³·K). */
export function volumetricHeatCapacityJPerM3K(m: MaterialRow): number | null {
  const cvMj = m.volumetric_heat_capacity_MJ_m3K;
  if (cvMj != null && cvMj > 0) {
    return cvMj * 1e6;
  }
  const rho = m.density_kg_m3;
  const cp = m.specific_heat_J_kg_K;
  if (rho != null && cp != null && rho > 0 && cp > 0) {
    return rho * cp;
  }
  return null;
}

/**
 * Areal heat capacity C'' = ∫ C_v dz for one solid layer (J/(m²·K)).
 * Repeating bridges: area-weighted volumetric capacity × thickness (parallel in-plane), same fractions as thermal resistance.
 * Cavities contribute ~0 and are omitted at the assembly level.
 */
export function arealHeatCapacityParallelSolidLayer(
  layer: AssemblyLayerSolid,
  materialsById: Map<string, MaterialRow>,
): { jPerM2K: number; errors: string[] } {
  const errors: string[] = [];
  const baseMat = materialsById.get(layer.materialId);
  const CvClear = baseMat ? volumetricHeatCapacityJPerM3K(baseMat) : null;
  if (!baseMat || CvClear == null) {
    return { jPerM2K: 0, errors: ['Unknown material or missing density/specific heat (or volumetric heat capacity).'] };
  }
  const d = layer.thickness_m;
  if (!(d > 0)) return { jPerM2K: 0, errors: [] };

  const bridges = layer.repeatingBridges ?? [];
  if (bridges.length === 0) {
    return { jPerM2K: d * CvClear, errors: [] };
  }

  const fractions: number[] = [];
  const cvTerms: number[] = [];

  for (let bi = 0; bi < bridges.length; bi++) {
    const b = bridges[bi]!;
    const tag = `Repeating bridge ${bi + 1}`;
    if (!b.bridgeMaterialId?.trim()) {
      errors.push(`${tag}: select a bridge material.`);
      continue;
    }
    const bm = materialsById.get(b.bridgeMaterialId);
    const CvB = bm ? volumetricHeatCapacityJPerM3K(bm) : null;
    if (!bm || CvB == null) {
      errors.push(`${tag}: unknown bridge material or missing ρ/c.`);
      continue;
    }
    const { fraction: f, error: fe } = areaFractionFromBridgeDefinition(b.definition);
    if (fe) {
      errors.push(`${tag}: ${fe}`);
      continue;
    }
    if (!(f > 0)) {
      errors.push(`${tag}: fraction must be greater than zero.`);
      continue;
    }
    fractions.push(f);
    cvTerms.push(f * CvB);
  }

  if (errors.length > 0) {
    return { jPerM2K: 0, errors };
  }

  const sumF = fractions.reduce((a, b) => a + b, 0);
  if (sumF > 1 + 1e-5) {
    return { jPerM2K: 0, errors: ['Total bridge fractions exceed 100% of the layer area.'] };
  }

  let weightedCv = 0;
  for (const t of cvTerms) weightedCv += t;
  const fClear = Math.max(0, 1 - sumF);
  if (fClear > FRAC_EPS) {
    weightedCv += fClear * CvClear;
  }

  return { jPerM2K: d * weightedCv, errors: [] };
}

/** Sum C'' over solid layers; cavities ignored. Returns null if any solid layer cannot be resolved. */
export function sumAssemblyArealHeatCapacity(
  layers: AssemblyLayer[],
  materialsById: Map<string, MaterialRow>,
): { jPerM2K: number | null; errors: string[] } {
  const errors: string[] = [];
  let total = 0;
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i]!;
    if (L.kind === 'cavity') continue;
    const { jPerM2K, errors: e } = arealHeatCapacityParallelSolidLayer(L, materialsById);
    if (e.length > 0) {
      errors.push(...e.map((msg) => `Layer ${i + 1}: ${msg}`));
      continue;
    }
    total += jPerM2K;
  }
  if (errors.length > 0) {
    return { jPerM2K: null, errors };
  }
  return { jPerM2K: total, errors: [] };
}

/** FHS-style discrete fabric mass: approved areal heat capacity bands (J/(m²·K)). */
export const FHS_AREAL_HEAT_CAPACITY_BANDS_J_M2K = [
  50_000, 75_000, 110_000, 175_000, 250_000,
] as const;

const AHC_MATCH_EPS = 1e-3;

/**
 * Map a computed C'' to the nearest allowed band. When two bands are equidistant,
 * the smaller value is chosen.
 */
export function snapToNearestFhsArealHeatCapacity(jPerM2K: number): number {
  if (!Number.isFinite(jPerM2K)) {
    return FHS_AREAL_HEAT_CAPACITY_BANDS_J_M2K[0];
  }
  let best: (typeof FHS_AREAL_HEAT_CAPACITY_BANDS_J_M2K)[number] = FHS_AREAL_HEAT_CAPACITY_BANDS_J_M2K[0];
  let bestD = Infinity;
  for (const b of FHS_AREAL_HEAT_CAPACITY_BANDS_J_M2K) {
    const d = Math.abs(jPerM2K - b);
    if (d < bestD - AHC_MATCH_EPS) {
      bestD = d;
      best = b;
    } else if (Math.abs(d - bestD) <= AHC_MATCH_EPS && b < best) {
      best = b;
    }
  }
  return best;
}

/** True if `v` equals one of the discrete FHS bands (within tolerance). */
export function matchesFhsDiscreteArealHeatCapacity(v: number): boolean {
  if (!Number.isFinite(v)) return false;
  for (const b of FHS_AREAL_HEAT_CAPACITY_BANDS_J_M2K) {
    if (Math.abs(v - b) <= AHC_MATCH_EPS) return true;
  }
  return false;
}

export type FhsArealHeatCapacityBand =
  | 'Very light'
  | 'Light'
  | 'Medium'
  | 'Heavy'
  | 'Very heavy';

const FHS_AREAL_HEAT_CAPACITY_LABEL_BY_J_M2K: Record<number, FhsArealHeatCapacityBand> = {
  50000: 'Very light',
  75000: 'Light',
  110000: 'Medium',
  175000: 'Heavy',
  250000: 'Very heavy',
};

const FHS_AREAL_HEAT_CAPACITY_J_M2K_BY_LABEL: Record<FhsArealHeatCapacityBand, number> = {
  'Very light': 50_000,
  'Light': 75_000,
  'Medium': 110_000,
  'Heavy': 175_000,
  'Very heavy': 250_000,
};

export function arealHeatCapacityBandFromJPerM2K(
  jPerM2K: number | null | undefined,
): FhsArealHeatCapacityBand | undefined {
  if (jPerM2K == null || !Number.isFinite(jPerM2K)) return undefined;
  const snapped = snapToNearestFhsArealHeatCapacity(jPerM2K);
  return FHS_AREAL_HEAT_CAPACITY_LABEL_BY_J_M2K[snapped];
}

export function arealHeatCapacityJPerM2KFromBand(
  value: unknown,
): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim() as FhsArealHeatCapacityBand;
  return FHS_AREAL_HEAT_CAPACITY_J_M2K_BY_LABEL[trimmed];
}

/**
 * Value for `extra_json.areal_heat_capacity`: rounded layer sum when FHS snap is off,
 * otherwise the nearest FHS enum label.
 */
export function resolveFabricArealHeatCapacityForElement(
  rawJPerM2K: number | null | undefined,
  fhsComplianceSnap: boolean,
): number | FhsArealHeatCapacityBand | undefined {
  if (rawJPerM2K == null || !Number.isFinite(rawJPerM2K)) return undefined;
  if (fhsComplianceSnap) return arealHeatCapacityBandFromJPerM2K(rawJPerM2K);
  return Math.round(rawJPerM2K);
}

/** Internal surface resistance R_si for element pitch (degrees from horizontal, HEM schema). */
export function rSiForPitch(pitchDeg: number): number {
  if (pitchDeg >= PITCH_LIMIT_HORIZ_CEILING && pitchDeg <= PITCH_LIMIT_HORIZ_FLOOR) {
    return R_SI_HORIZONTAL;
  }
  if (pitchDeg < PITCH_LIMIT_HORIZ_CEILING) {
    return R_SI_UPWARDS;
  }
  return R_SI_DOWNWARDS;
}

export function convertUvalueToResistance(uValue: number, pitchDeg: number): number {
  return 1.0 / uValue - rSiForPitch(pitchDeg) - R_SE;
}

export function resistanceFromSolidLayer(thicknessM: number, lambdaWmK: number): number {
  if (!(thicknessM > 0) || !(lambdaWmK > 0)) return 0;
  return thicknessM / lambdaWmK;
}

/** Area fraction (0,1] from bridge definition; errors for invalid input. */
export function areaFractionFromBridgeDefinition(def: RepeatingBridgeDefinition): {
  fraction: number;
  error?: string;
} {
  if (def.mode === 'framing_fraction') {
    const f = def.framingFraction;
    if (!(f > 0) || f > 1 + FRAC_EPS) {
      return { fraction: 0, error: 'Framing fraction must be greater than 0 and at most 1.' };
    }
    return { fraction: Math.min(1, f) };
  }
  const { spacing_m: sp, width_m: w } = def;
  if (!(sp > 0) || !(w > 0)) {
    return { fraction: 0, error: 'Spacing and width must be greater than zero.' };
  }
  if (w > sp + FRAC_EPS) {
    return { fraction: 0, error: 'Width must not exceed spacing.' };
  }
  return { fraction: w / sp };
}

/**
 * Parallel-path equivalent resistance for one solid thickness with multiple bridge materials.
 * G_total = f_clear/R_clear + Σ f_i/R_i ; R_eq = 1/G_total.
 */
export function equivalentResistanceParallelSolidLayer(
  layer: AssemblyLayerSolid,
  materialsById: Map<string, MaterialRow>,
): { r: number; errors: string[] } {
  const errors: string[] = [];
  const baseMat = materialsById.get(layer.materialId);
  if (!baseMat || !(baseMat.lambda_W_mK > 0)) {
    return { r: 0, errors: ['Unknown or invalid base layer material.'] };
  }
  const d = layer.thickness_m;
  if (!(d > 0)) return { r: 0, errors: [] };

  const Rclear = resistanceFromSolidLayer(d, baseMat.lambda_W_mK);
  const bridges = layer.repeatingBridges ?? [];
  if (bridges.length === 0) {
    return { r: Rclear, errors: [] };
  }

  const fractions: number[] = [];
  const conductanceTerms: number[] = [];

  for (let bi = 0; bi < bridges.length; bi++) {
    const b = bridges[bi]!;
    const tag = `Repeating bridge ${bi + 1}`;
    if (!b.bridgeMaterialId?.trim()) {
      errors.push(`${tag}: select a bridge material.`);
      continue;
    }
    const bm = materialsById.get(b.bridgeMaterialId);
    if (!bm || !(bm.lambda_W_mK > 0)) {
      errors.push(`${tag}: unknown bridge material.`);
      continue;
    }
    const { fraction: f, error: fe } = areaFractionFromBridgeDefinition(b.definition);
    if (fe) {
      errors.push(`${tag}: ${fe}`);
      continue;
    }
    if (!(f > 0)) {
      errors.push(`${tag}: fraction must be greater than zero.`);
      continue;
    }
    const Rb = resistanceFromSolidLayer(d, bm.lambda_W_mK);
    if (!(Rb > 0)) {
      errors.push(`${tag}: invalid bridge resistance.`);
      continue;
    }
    fractions.push(f);
    conductanceTerms.push(f / Rb);
  }

  if (errors.length > 0) {
    return { r: 0, errors };
  }

  const sumF = fractions.reduce((a, b) => a + b, 0);
  if (sumF > 1 + 1e-5) {
    return { r: 0, errors: ['Total bridge fractions exceed 100% of the layer area.'] };
  }

  let G = 0;
  for (const t of conductanceTerms) G += t;
  const fClear = Math.max(0, 1 - sumF);
  if (fClear > FRAC_EPS) {
    G += fClear / Rclear;
  }

  if (G <= 0) {
    return { r: 0, errors: ['Could not compute parallel resistance.'] };
  }

  return { r: 1 / G, errors: [] };
}

function resistanceSolidLayerSeriesOnly(layer: AssemblyLayerSolid, materialsById: Map<string, MaterialRow>): number {
  const mat = materialsById.get(layer.materialId);
  if (!mat) return 0;
  return resistanceFromSolidLayer(layer.thickness_m, mat.lambda_W_mK);
}

/** Ensure repeating bridge rows have ids (CSV round-trip / older snapshots). */
export function normalizeAssemblyLayers(layers: AssemblyLayer[]): AssemblyLayer[] {
  return layers.map((L) => {
    if (L.kind === 'cavity') {
      return migrateLegacyCavityLayer(L);
    }
    if (L.kind !== 'solid' || !L.repeatingBridges?.length) return L;
    return {
      ...L,
      repeatingBridges: L.repeatingBridges.map((b, i) =>
        b.id?.trim()
          ? b
          : { ...b, id: `bridge-migrated-${i}-${Math.random().toString(36).slice(2, 9)}` },
      ),
    };
  });
}

/**
 * Structural checks for layered assemblies (heated side → outside).
 * Invalid layouts still get a numeric R sum elsewhere, but Apply / Save should stay blocked.
 */
export function validateAssemblyLayerLayout(layers: AssemblyLayer[]): string[] {
  const errors: string[] = [];
  const n = layers.length;
  if (n === 0) {
    errors.push('Add at least one layer.');
    return errors;
  }

  if (n === 1 && layers[0]!.kind === 'cavity') {
    errors.push(
      'A cavity cannot be the only layer — add solid layers on the heated side and on the outside.',
    );
    return errors;
  }

  if (layers[0]!.kind === 'cavity') {
    errors.push(
      'The innermost layer cannot be a cavity — put a solid leaf against the heated space first.',
    );
  }
  if (n > 1 && layers[n - 1]!.kind === 'cavity') {
    errors.push('The outermost layer cannot be a cavity — put a solid outer leaf last.');
  }

  for (let i = 0; i < n - 1; i++) {
    if (layers[i]!.kind === 'cavity' && layers[i + 1]!.kind === 'cavity') {
      errors.push('Two cavities cannot be adjacent — add a solid layer between them.');
      break;
    }
  }

  for (let i = 0; i < n; i++) {
    const L = layers[i]!;
    if (L.kind === 'solid') {
      if (!L.materialId?.trim()) {
        errors.push(`Layer ${i + 1}: select a material.`);
      }
      if (!(L.thickness_m > 0)) {
        errors.push(`Layer ${i + 1}: thickness must be greater than zero.`);
      }
    } else {
      if (
        L.ventilation !== undefined &&
        L.ventilation !== 'unventilated' &&
        L.ventilation !== 'well_ventilated'
      ) {
        errors.push(`Layer ${i + 1}: cavity ventilation must be unventilated or well ventilated.`);
      }
      if (L.gap_thickness_m !== undefined && !(L.gap_thickness_m > 0)) {
        errors.push(`Layer ${i + 1}: cavity gap must be greater than zero.`);
      }
      if (
        L.surface_emissivity !== undefined &&
        L.surface_emissivity !== 'high' &&
        L.surface_emissivity !== 'low'
      ) {
        errors.push(`Layer ${i + 1}: cavity emissivity must be high or low.`);
      }
    }
  }

  const wellVentilatedCount = layers.filter((L) => L.kind === 'cavity' && L.ventilation === 'well_ventilated').length;
  if (wellVentilatedCount > 1) {
    errors.push('Only one well ventilated cavity is supported in a single assembly stack.');
  }

  return errors;
}

/**
 * Move layer at `from` to gap `insertAt` in the original ordering (0 = before first … n = after last).
 * Used for drag-and-drop when the user drops on a **line** between positions.
 */
export function moveLayerToGap(layers: AssemblyLayer[], from: number, insertAt: number): AssemblyLayer[] {
  const n = layers.length;
  if (n === 0 || from < 0 || from >= n || insertAt < 0 || insertAt > n) return layers;
  const next = [...layers];
  const [item] = next.splice(from, 1);
  let at = insertAt;
  if (insertAt > from) at--;
  next.splice(at, 0, item!);
  return next;
}

/**
 * ISO 6946 **lower limit** construction resistance: isothermal planes → parallel paths within each
 * bridged solid layer, then layers in series. Same as the former `sumConstructionResistance` behaviour.
 */
export function sumConstructionResistance(
  layers: AssemblyLayer[],
  materialsById: Map<string, MaterialRow>,
  cavityResistanceByType: Map<string, number>,
  pitchDeg = 90,
): { rLayers: number; layerResistances: number[]; errors: string[] } {
  const heatTransfer = resolveAssemblyHeatTransferContext(layers, pitchDeg);
  const effectiveLayers = heatTransfer.effectiveLayers;
  const layerResistances: number[] = [];
  const errors: string[] = [...heatTransfer.errors];
  let rLayers = 0;

  for (let i = 0; i < effectiveLayers.length; i++) {
    const L = effectiveLayers[i];
    if (L.kind === 'solid') {
      const { r: ri, errors: eSolid } = equivalentResistanceParallelSolidLayer(L, materialsById);
      errors.push(...eSolid);
      layerResistances.push(ri);
      rLayers += ri;
    } else {
      const { r, error } = effectiveCavityResistanceM2KPerW(L, pitchDeg, cavityResistanceByType);
      if (error) errors.push(error);
      layerResistances.push(r);
      rLayers += r;
    }
  }

  return { rLayers, layerResistances, errors };
}

/**
 * ISO 6946:2017 §6.7.2.1 — if the ratio of upper-limit to lower-limit **construction** resistance exceeds this
 * value, the simplified combined method is not applicable.
 */
export const ISO6946_MAX_UPPER_TO_LOWER_RESISTANCE_RATIO = 1.5;

/**
 * ISO 6946:2017 Annex — formula (10): maximum relative error (%) for the combined total resistance estimate,
 * using the mean total resistance in the denominator (surface films identical in both limits).
 */
export function iso6946Formula10MaxRelativeErrorPercent(
  rConstructionLower_m2K_W: number,
  rConstructionUpper_m2K_W: number,
  rConstructionMean_m2K_W: number,
  pitchDeg: number,
): number {
  const rSi = rSiForPitch(pitchDeg);
  const rTot = rSi + rConstructionMean_m2K_W + R_SE;
  if (!(rTot > 0)) return 0;
  const rTotUpper = rSi + rConstructionUpper_m2K_W + R_SE;
  const rTotLower = rSi + rConstructionLower_m2K_W + R_SE;
  return ((rTotUpper - rTotLower) / (2 * rTot)) * 100;
}

const FRAC_ALIGN_EPS = 1e-5;

function fractionVectorsAligned(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > FRAC_ALIGN_EPS) return false;
  }
  return true;
}

/**
 * Segment area fractions (sum 1) and thermal resistances for each in-plane strip of a bridged solid layer.
 * Order: clear field first, then each repeating bridge row in order.
 */
export function solidLayerSegmentsFractionsAndResistances(
  layer: AssemblyLayerSolid,
  materialsById: Map<string, MaterialRow>,
): { fractions: number[]; resistances: number[]; errors: string[] } {
  const errors: string[] = [];
  const baseMat = materialsById.get(layer.materialId);
  if (!baseMat || !(baseMat.lambda_W_mK > 0)) {
    return { fractions: [], resistances: [], errors: ['Unknown or invalid base layer material.'] };
  }
  const d = layer.thickness_m;
  if (!(d > 0)) {
    return { fractions: [], resistances: [], errors: [] };
  }

  const Rclear = resistanceFromSolidLayer(d, baseMat.lambda_W_mK);
  const bridges = layer.repeatingBridges ?? [];
  if (bridges.length === 0) {
    return { fractions: [1], resistances: [Rclear], errors: [] };
  }

  const fractions: number[] = [];
  const resistances: number[] = [];

  for (let bi = 0; bi < bridges.length; bi++) {
    const b = bridges[bi]!;
    const tag = `Repeating bridge ${bi + 1}`;
    if (!b.bridgeMaterialId?.trim()) {
      errors.push(`${tag}: select a bridge material.`);
      continue;
    }
    const bm = materialsById.get(b.bridgeMaterialId);
    if (!bm || !(bm.lambda_W_mK > 0)) {
      errors.push(`${tag}: unknown bridge material.`);
      continue;
    }
    const { fraction: f, error: fe } = areaFractionFromBridgeDefinition(b.definition);
    if (fe) {
      errors.push(`${tag}: ${fe}`);
      continue;
    }
    if (!(f > 0)) {
      errors.push(`${tag}: fraction must be greater than zero.`);
      continue;
    }
    const Rb = resistanceFromSolidLayer(d, bm.lambda_W_mK);
    if (!(Rb > 0)) {
      errors.push(`${tag}: invalid bridge resistance.`);
      continue;
    }
    fractions.push(f);
    resistances.push(Rb);
  }

  if (errors.length > 0) {
    return { fractions: [], resistances: [], errors };
  }

  const sumF = fractions.reduce((a, b) => a + b, 0);
  if (sumF > 1 + 1e-5) {
    return { fractions: [], resistances: [], errors: ['Total bridge fractions exceed 100% of the layer area.'] };
  }

  const fClear = Math.max(0, 1 - sumF);
  const outFrac: number[] = [];
  const outR: number[] = [];
  if (fClear > FRAC_EPS) {
    outFrac.push(fClear);
    outR.push(Rclear);
  }
  for (let i = 0; i < fractions.length; i++) {
    outFrac.push(fractions[i]!);
    outR.push(resistances[i]!);
  }

  if (outFrac.length === 0) {
    return { fractions: [], resistances: [], errors: ['Could not resolve bridged segments.'] };
  }

  return { fractions: outFrac, resistances: outR, errors: [] };
}

function cavityLayerR(
  L: Extract<AssemblyLayer, { kind: 'cavity' }>,
  cavityResistanceByType: Map<string, number>,
  pitchDeg: number,
): { r: number; error?: string } {
  return effectiveCavityResistanceM2KPerW(L, pitchDeg, cavityResistanceByType);
}

/**
 * ISO 6946 **upper limit** construction resistance: adiabatic vertical strips → each column is a series
 * of layer resistances; columns combine in parallel (area-weighted).
 * Every **bridged** solid layer must use the **same** in-plane fraction vector (aligned framing).
 * Uniform solids and cavities add the same resistance to each column.
 */
export function sumConstructionResistanceUpperLimit(
  layers: AssemblyLayer[],
  materialsById: Map<string, MaterialRow>,
  cavityResistanceByType: Map<string, number>,
  pitchDeg = 90,
): { rLayers: number; errors: string[] } {
  const heatTransfer = resolveAssemblyHeatTransferContext(layers, pitchDeg);
  const effectiveLayers = heatTransfer.effectiveLayers;
  const errors: string[] = [...heatTransfer.errors];
  let referenceFrac: number[] | null = null;

  for (let i = 0; i < effectiveLayers.length; i++) {
    const L = effectiveLayers[i]!;
    if (L.kind !== 'solid' || !L.repeatingBridges?.length) continue;
    const { fractions, errors: segErr } = solidLayerSegmentsFractionsAndResistances(L, materialsById);
    errors.push(...segErr.map((e) => `Layer ${i + 1}: ${e}`));
    if (segErr.length > 0) continue;
    if (referenceFrac === null) {
      referenceFrac = fractions;
    } else if (!fractionVectorsAligned(referenceFrac, fractions)) {
      errors.push(
        `Layer ${i + 1}: repeating-bridge fractions must match all other bridged layers (ISO 6946 upper limit).`,
      );
    }
  }

  if (errors.length > 0) {
    return { rLayers: 0, errors };
  }

  if (referenceFrac == null) {
    let sum = 0;
  for (let i = 0; i < effectiveLayers.length; i++) {
      const L = effectiveLayers[i]!;
      if (L.kind === 'solid') {
        const mat = materialsById.get(L.materialId);
        if (!mat || !(mat.lambda_W_mK > 0)) {
          errors.push(`Layer ${i + 1}: unknown or invalid material.`);
          continue;
        }
        sum += resistanceFromSolidLayer(L.thickness_m, mat.lambda_W_mK);
      } else {
        const { r, error } = cavityLayerR(L, cavityResistanceByType, pitchDeg);
        if (error) errors.push(error);
        sum += r;
      }
    }
    return { rLayers: sum, errors };
  }

  const K = referenceFrac.length;
  const rCol = new Array<number>(K).fill(0);

  for (let i = 0; i < effectiveLayers.length; i++) {
    const L = effectiveLayers[i]!;
    if (L.kind === 'solid') {
      if (!L.repeatingBridges?.length) {
        const mat = materialsById.get(L.materialId);
        if (!mat || !(mat.lambda_W_mK > 0)) {
          errors.push(`Layer ${i + 1}: unknown or invalid material.`);
          continue;
        }
        const rUniform = resistanceFromSolidLayer(L.thickness_m, mat.lambda_W_mK);
        for (let k = 0; k < K; k++) rCol[k] += rUniform;
      } else {
        const { fractions, resistances, errors: segErr } = solidLayerSegmentsFractionsAndResistances(
          L,
          materialsById,
        );
        if (segErr.length > 0) {
          errors.push(...segErr.map((e) => `Layer ${i + 1}: ${e}`));
          continue;
        }
        if (!fractionVectorsAligned(referenceFrac, fractions)) {
          errors.push(
            `Layer ${i + 1}: repeating-bridge fractions must match all other bridged layers (ISO 6946 upper limit).`,
          );
          continue;
        }
        for (let k = 0; k < K; k++) {
          rCol[k] += resistances[k] ?? 0;
        }
      }
    } else {
      const { r, error } = cavityLayerR(L, cavityResistanceByType, pitchDeg);
      if (error) errors.push(error);
      for (let k = 0; k < K; k++) rCol[k] += r;
    }
  }

  if (errors.length > 0) {
    return { rLayers: 0, errors };
  }

  let g = 0;
  for (let k = 0; k < K; k++) {
    const Rk = rCol[k]!;
    if (!(Rk > 0)) {
      return { rLayers: 0, errors: [`Upper limit: invalid column resistance (column ${k + 1}).`] };
    }
    g += referenceFrac[k]! / Rk;
  }
  if (!(g > 0)) {
    return { rLayers: 0, errors: ['Upper limit: could not combine column resistances.'] };
  }

  return { rLayers: 1 / g, errors: [] };
}

/**
 * BS EN ISO 6946 **Combined Method** construction resistance: arithmetic mean of lower and upper limits.
 * Total element U should be `U = 1 / (R_si + R_construction_mean + R_se)` (surface films unchanged).
 *
 * §6.7.2.1: if `R_upper/R_lower` exceeds `ISO6946_MAX_UPPER_TO_LOWER_RESISTANCE_RATIO` (1.5), `errors` includes an
 * applicability message and the assembly calculator UI keeps Apply disabled (simplified method not valid).
 */
export function computeIso6946CombinedConstructionResistance(
  layers: AssemblyLayer[],
  materialsById: Map<string, MaterialRow>,
  cavityResistanceByType: Map<string, number>,
  pitchDeg = 90,
): {
  rConstructionLower_m2K_W: number;
  rConstructionUpper_m2K_W: number;
  rConstructionMean_m2K_W: number;
  layerResistancesLower: number[];
  errors: string[];
} {
  const lower = sumConstructionResistance(layers, materialsById, cavityResistanceByType, pitchDeg);
  const upper = sumConstructionResistanceUpperLimit(layers, materialsById, cavityResistanceByType, pitchDeg);
  const errors = [...lower.errors, ...upper.errors];
  if (errors.length > 0) {
    return {
      rConstructionLower_m2K_W: 0,
      rConstructionUpper_m2K_W: 0,
      rConstructionMean_m2K_W: 0,
      layerResistancesLower: lower.layerResistances,
      errors,
    };
  }
  const rL = lower.rLayers;
  const rU = upper.rLayers;
  if (!(rL > 0) || !(rU > 0)) {
    return {
      rConstructionLower_m2K_W: rL,
      rConstructionUpper_m2K_W: rU,
      rConstructionMean_m2K_W: 0,
      layerResistancesLower: lower.layerResistances,
      errors: ['Invalid construction resistance limits.'],
    };
  }
  const rMean = (rL + rU) / 2;
  const applicabilityErrors: string[] = [];
  const ratio = rU / rL;
  if (ratio > ISO6946_MAX_UPPER_TO_LOWER_RESISTANCE_RATIO) {
    applicabilityErrors.push(
      `ISO 6946 §6.7.2.1: upper/lower construction resistance ratio (${ratio.toFixed(2)}) exceeds ${ISO6946_MAX_UPPER_TO_LOWER_RESISTANCE_RATIO}; the simplified combined method does not apply. Use a detailed calculation if you need a declared U-value.`,
    );
  }
  return {
    rConstructionLower_m2K_W: rL,
    rConstructionUpper_m2K_W: rU,
    rConstructionMean_m2K_W: rMean,
    layerResistancesLower: lower.layerResistances,
    errors: applicabilityErrors,
  };
}

/** Suspended ground floor split using a ventilated cavity as the underfloor void. */
export function computeSuspendedGroundFloorConstructionMeansFromVoid(
  layers: AssemblyLayer[],
  materialsById: Map<string, MaterialRow>,
  cavityResistanceByType: Map<string, number>,
  pitchDeg = 180,
): {
  hasVentilatedVoid: boolean;
  heightUpperSurfaceM: number | null;
  rfMean_m2K_W: number;
  rgMean_m2K_W: number;
  rfLayers: AssemblyLayer[];
  rgLayers: AssemblyLayer[];
  errors: string[];
} {
  const voidContext = resolveSuspendedGroundVentilatedVoidContext(layers);
  if (!voidContext.hasVentilatedVoid) {
    return {
      hasVentilatedVoid: false,
      heightUpperSurfaceM: null,
      rfMean_m2K_W: 0,
      rgMean_m2K_W: 0,
      rfLayers: layers,
      rgLayers: [],
      errors: [],
    };
  }
  if (voidContext.errors.length > 0) {
    return {
      hasVentilatedVoid: true,
      heightUpperSurfaceM: voidContext.heightUpperSurfaceM,
      rfMean_m2K_W: 0,
      rgMean_m2K_W: 0,
      rfLayers: voidContext.rfLayers,
      rgLayers: voidContext.rgLayers,
      errors: [...voidContext.errors],
    };
  }
  const isoF = computeIso6946CombinedConstructionResistance(
    voidContext.rfLayers,
    materialsById,
    cavityResistanceByType,
    pitchDeg,
  );
  if (voidContext.rgLayers.length === 0) {
    return {
      hasVentilatedVoid: true,
      heightUpperSurfaceM: voidContext.heightUpperSurfaceM,
      rfMean_m2K_W: isoF.rConstructionMean_m2K_W,
      rgMean_m2K_W: 0,
      rfLayers: voidContext.rfLayers,
      rgLayers: voidContext.rgLayers,
      errors: [...isoF.errors],
    };
  }
  const isoG = computeIso6946CombinedConstructionResistance(
    voidContext.rgLayers,
    materialsById,
    cavityResistanceByType,
    pitchDeg,
  );
  return {
    hasVentilatedVoid: true,
    heightUpperSurfaceM: voidContext.heightUpperSurfaceM,
    rfMean_m2K_W: isoF.rConstructionMean_m2K_W,
    rgMean_m2K_W: isoG.rConstructionMean_m2K_W,
    rfLayers: voidContext.rfLayers,
    rgLayers: voidContext.rgLayers,
    errors: [...isoF.errors, ...isoG.errors],
  };
}

/** Series-only construction R (ignores parallel bridges) — for audit “clear field” U when bridges exist. */
export function sumConstructionResistanceSeriesOnly(
  layers: AssemblyLayer[],
  materialsById: Map<string, MaterialRow>,
  cavityResistanceByType: Map<string, number>,
  pitchDeg = 90,
): { rLayers: number; layerResistances: number[]; errors: string[] } {
  const heatTransfer = resolveAssemblyHeatTransferContext(layers, pitchDeg);
  const effectiveLayers = heatTransfer.effectiveLayers;
  const layerResistances: number[] = [];
  const errors: string[] = [...heatTransfer.errors];
  let rLayers = 0;

  for (let i = 0; i < effectiveLayers.length; i++) {
    const L = effectiveLayers[i];
    if (L.kind === 'solid') {
      const mat = materialsById.get(L.materialId);
      if (!mat) {
        errors.push(`Unknown material id: ${L.materialId}`);
        layerResistances.push(0);
        continue;
      }
      const ri = resistanceSolidLayerSeriesOnly(L, materialsById);
      layerResistances.push(ri);
      rLayers += ri;
    } else {
      const { r, error } = effectiveCavityResistanceM2KPerW(L, pitchDeg, cavityResistanceByType);
      if (error) errors.push(error);
      layerResistances.push(r);
      rLayers += r;
    }
  }

  return { rLayers, layerResistances, errors };
}

export function computeOpaqueUAndTotals(
  rLayers: number,
  pitchDeg: number,
  externalSurfaceResistance_m2K_W = R_SE,
): { u: number; rTot: number; rSi: number; rSe: number } {
  const rSi = rSiForPitch(pitchDeg);
  const rSe = externalSurfaceResistance_m2K_W;
  const rTot = rSi + rLayers + rSe;
  const u = rTot > 0 ? 1.0 / rTot : 0;
  return { u, rTot, rSi, rSe };
}
