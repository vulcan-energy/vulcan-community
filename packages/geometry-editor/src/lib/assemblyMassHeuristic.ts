// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Suggested HEM `mass_distribution_class` from a layered stack (inside → outside).
 *
 * Definitions match **HEM-TP-07** (*Calculating thermal mass within the Home Energy Model*),
 * which aligns with BS EN ISO 52016-1:2017 / input field semantics:
 *
 * - **I** — Mass concentrated on internal side: external thermal insulation (main mass near
 *   the inside surface), or equivalent.
 * - **E** — Mass concentrated on external side: internal thermal insulation (main mass near
 *   the outside surface), or equivalent.
 * - **IE** — Mass divided internal and external: thermal insulation **between** two main mass
 *   components, or equivalent.
 * - **D** — Mass equally distributed: uninsulated construction, heavy/lightweight concrete, or
 *   lightweight construction with negligible mass, or equivalent.
 * - **M** — Mass concentrated **inside** (mid-construction): both internal and external
 *   insulation (main mass near the centre), or equivalent.
 *
 * Insulation is detected as `category === 'insulation'` or λ &lt; 0.05 W/(m·K). “Heavy” uses
 * `materials.json` categories plus gypsum plasterboard / plaster-dab ids (see below). Where two heavy leaves sandwich
 * insulation but one is much thinner (typical EWI rainscreen vs load-bearing leaf), the thinner
 * side is down-weighted so **I** / **E** can be distinguished from **IE** (HEM-TP-07 notes that
 * some builds still need assessor judgement).
 */

import type { AssemblyLayer, MaterialRow } from './assemblyTypes';

/** Legacy/internal short codes used by the heuristic and older saved data. */
export type MassDistributionClassSuggestion = 'D' | 'I' | 'E' | 'IE' | 'M';

/** FHS-facing enum labels required by the current schema. */
export type FhsMassDistributionClass =
  | 'I: Mass concentrated at internal side'
  | 'E: Mass concentrated at external side'
  | 'IE: Mass divided over internal and external side'
  | 'D: Mass equally distributed'
  | 'M: Mass concentrated inside';

const FHS_MASS_DISTRIBUTION_CLASS_BY_CODE: Record<
  MassDistributionClassSuggestion,
  FhsMassDistributionClass
> = {
  I: 'I: Mass concentrated at internal side',
  E: 'E: Mass concentrated at external side',
  IE: 'IE: Mass divided over internal and external side',
  D: 'D: Mass equally distributed',
  M: 'M: Mass concentrated inside',
};

const FHS_MASS_DISTRIBUTION_CLASS_VALUES = new Set<FhsMassDistributionClass>(
  Object.values(FHS_MASS_DISTRIBUTION_CLASS_BY_CODE),
);

export function toFhsMassDistributionClass(
  value: string | null | undefined,
): FhsMassDistributionClass | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (FHS_MASS_DISTRIBUTION_CLASS_VALUES.has(trimmed as FhsMassDistributionClass)) {
    return trimmed as FhsMassDistributionClass;
  }
  const legacyCode = trimmed.toUpperCase() as MassDistributionClassSuggestion;
  return FHS_MASS_DISTRIBUTION_CLASS_BY_CODE[legacyCode];
}

/** TP-07 heuristic output → exact FHS enum string (envelope / persisted fields). */
export function fhsMassDistributionFromSuggestion(code: MassDistributionClassSuggestion): FhsMassDistributionClass {
  return FHS_MASS_DISTRIBUTION_CLASS_BY_CODE[code];
}

/** Categories whose materials are treated as thermally heavy for this heuristic. */
const HEAVY_CATEGORIES = new Set([
  'brick_block',
  'concrete',
  'screeds_renders',
  'tiles',
  'gravels_beddings',
]);

/** When both sides of the insulation band have heavy layers, classify as I or E if one flank is below this fraction of the other (thickness sum). */
const HEAVY_SIDE_ASYMMETRY = 0.35;

/** Gypsum plasterboard (incl. BR 443 catalogue ids) counts as thermally significant mass for TP-07. */
function isHeavyGypsumPlasterboard(mat: MaterialRow): boolean {
  const id = mat.id.toLowerCase();
  return id.includes('gypsum') || id.includes('plasterboard');
}

/** Plaster dabs layer — treated like dense lining for the mass heuristic. */
function isHeavyPlasterDabs(mat: MaterialRow): boolean {
  return mat.id.toLowerCase().includes('plaster_dabs');
}

function isInsulation(mat: MaterialRow | undefined): boolean {
  if (!mat) return false;
  if (mat.category === 'insulation') return true;
  return mat.lambda_W_mK > 0 && mat.lambda_W_mK < 0.05;
}

function isHeavy(mat: MaterialRow | undefined): boolean {
  if (!mat) return false;
  const c = mat.category || '';
  if (HEAVY_CATEGORIES.has(c)) return true;
  if (c === 'boards_sheets') return isHeavyGypsumPlasterboard(mat);
  if (c === 'plaster') return isHeavyPlasterDabs(mat);
  return false;
}

function heavyThicknessSum(
  layers: AssemblyLayer[],
  materialsById: Map<string, MaterialRow>,
  pred: (i: number) => boolean,
): number {
  let s = 0;
  for (let i = 0; i < layers.length; i++) {
    if (!pred(i)) continue;
    const L = layers[i];
    if (L.kind !== 'solid') continue;
    const m = materialsById.get(L.materialId);
    if (!isHeavy(m)) continue;
    s += L.thickness_m > 0 ? L.thickness_m : 0;
  }
  return s;
}

function heavyIndexBounds(
  layers: AssemblyLayer[],
  materialsById: Map<string, MaterialRow>,
): { minH: number; maxH: number } | null {
  let minH = Number.POSITIVE_INFINITY;
  let maxH = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (L.kind !== 'solid') continue;
    const m = materialsById.get(L.materialId);
    if (!isHeavy(m)) continue;
    minH = Math.min(minH, i);
    maxH = Math.max(maxH, i);
  }
  if (!Number.isFinite(minH)) return null;
  return { minH, maxH };
}

export function suggestMassDistributionClass(
  layers: AssemblyLayer[],
  materialsById: Map<string, MaterialRow>,
): MassDistributionClassSuggestion {
  const insulationIndices: number[] = [];
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (L.kind === 'solid') {
      const m = materialsById.get(L.materialId);
      if (isInsulation(m)) insulationIndices.push(i);
    }
  }

  if (insulationIndices.length === 0) return 'D';

  const firstIns = Math.min(...insulationIndices);
  const lastIns = Math.max(...insulationIndices);
  const minIns = firstIns;
  const maxIns = lastIns;

  const bounds = heavyIndexBounds(layers, materialsById);

  let heavyInside = false;
  let heavyOutside = false;
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (L.kind !== 'solid') continue;
    const m = materialsById.get(L.materialId);
    if (!isHeavy(m)) continue;
    if (i < firstIns) heavyInside = true;
    if (i > lastIns) heavyOutside = true;
  }

  // M: insulation on both sides of the heavy core (mass concentrated mid-construction).
  if (bounds) {
    const { minH, maxH } = bounds;
    if (minIns < minH && maxIns > maxH) return 'M';
  }

  const wi = heavyThicknessSum(layers, materialsById, (i) => i < firstIns);
  const wo = heavyThicknessSum(layers, materialsById, (i) => i > lastIns);

  if (heavyInside && heavyOutside) {
    const maxW = Math.max(wi, wo, 1e-9);
    if (wo / maxW < HEAVY_SIDE_ASYMMETRY) return 'I';
    if (wi / maxW < HEAVY_SIDE_ASYMMETRY) return 'E';
    return 'IE';
  }
  if (heavyInside) return 'I';
  if (heavyOutside) return 'E';
  return 'D';
}
