// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { MaterialRow } from '../assemblyTypes';
import { fhsMassDistributionFromSuggestion, suggestMassDistributionClass } from '../assemblyMassHeuristic';

function m(id: string, category: string, lambda: number): MaterialRow {
  return { id, name: id, shortName: id, category, lambda_W_mK: lambda };
}

const mats = new Map<string, MaterialRow>([
  ['mat.br443.brick_outer', m('mat.br443.brick_outer', 'brick_block', 0.77)],
  ['mat.br443.timber_softwood', m('mat.br443.timber_softwood', 'timber', 0.13)],
  ['mat.iso.eps', m('mat.iso.eps', 'insulation', 0.04)],
  ['mat.iso.brick', m('mat.iso.brick', 'brick_block', 0.8)],
]);

describe('suggestMassDistributionClass', () => {
  it('returns D when there is no insulation layer', () => {
    const layers = [
      { kind: 'solid' as const, materialId: 'mat.br443.brick_outer', thickness_m: 0.1 },
      { kind: 'solid' as const, materialId: 'mat.br443.brick_outer', thickness_m: 0.1 },
    ];
    expect(suggestMassDistributionClass(layers, mats)).toBe('D');
  });

  it('classifies IE when heavy masonry is both sides of insulation (similar thickness)', () => {
    const layers = [
      { kind: 'solid' as const, materialId: 'mat.br443.brick_outer', thickness_m: 0.1 },
      { kind: 'solid' as const, materialId: 'mat.iso.eps', thickness_m: 0.1 },
      { kind: 'solid' as const, materialId: 'mat.iso.brick', thickness_m: 0.1 },
    ];
    expect(suggestMassDistributionClass(layers, mats)).toBe('IE');
  });

  it('classifies I when outer heavy leaf is much thinner (EWI-style asymmetry)', () => {
    const layers = [
      { kind: 'solid' as const, materialId: 'mat.br443.brick_outer', thickness_m: 0.2 },
      { kind: 'solid' as const, materialId: 'mat.iso.eps', thickness_m: 0.1 },
      { kind: 'solid' as const, materialId: 'mat.iso.brick', thickness_m: 0.02 },
    ];
    expect(suggestMassDistributionClass(layers, mats)).toBe('I');
  });

  it('classifies M when insulation layers sit both sides of the heavy core', () => {
    const layers = [
      { kind: 'solid' as const, materialId: 'mat.iso.eps', thickness_m: 0.05 },
      { kind: 'solid' as const, materialId: 'mat.br443.brick_outer', thickness_m: 0.15 },
      { kind: 'solid' as const, materialId: 'mat.iso.eps', thickness_m: 0.05 },
    ];
    expect(suggestMassDistributionClass(layers, mats)).toBe('M');
  });

  it('classifies I when only inner leaf is heavy (external insulation)', () => {
    const layers = [
      { kind: 'solid' as const, materialId: 'mat.br443.brick_outer', thickness_m: 0.1 },
      { kind: 'solid' as const, materialId: 'mat.iso.eps', thickness_m: 0.1 },
      { kind: 'solid' as const, materialId: 'mat.br443.timber_softwood', thickness_m: 0.02 },
    ];
    expect(suggestMassDistributionClass(layers, mats)).toBe('I');
  });

  it('classifies E when only outer leaf is heavy (internal insulation)', () => {
    const layers = [
      { kind: 'solid' as const, materialId: 'mat.br443.timber_softwood', thickness_m: 0.02 },
      { kind: 'solid' as const, materialId: 'mat.iso.eps', thickness_m: 0.1 },
      { kind: 'solid' as const, materialId: 'mat.iso.brick', thickness_m: 0.1 },
    ];
    expect(suggestMassDistributionClass(layers, mats)).toBe('E');
  });

  it('does not treat BR 443 catalogue timber as heavy', () => {
    const layers = [
      { kind: 'solid' as const, materialId: 'mat.br443.timber_softwood', thickness_m: 0.05 },
      { kind: 'solid' as const, materialId: 'mat.iso.eps', thickness_m: 0.1 },
      { kind: 'solid' as const, materialId: 'mat.br443.timber_softwood', thickness_m: 0.05 },
    ];
    expect(suggestMassDistributionClass(layers, mats)).toBe('D');
  });

  it('treats gypsum plasterboard (boards_sheets) as heavy like legacy BR 443 gypsum rows', () => {
    const matsG = new Map(mats);
    matsG.set('mat.br443.gypsum_std', m('mat.br443.gypsum_std', 'boards_sheets', 0.21));
    const layers = [
      { kind: 'solid' as const, materialId: 'mat.br443.gypsum_std', thickness_m: 0.1 },
      { kind: 'solid' as const, materialId: 'mat.iso.eps', thickness_m: 0.1 },
      { kind: 'solid' as const, materialId: 'mat.iso.brick', thickness_m: 0.1 },
    ];
    expect(suggestMassDistributionClass(layers, matsG)).toBe('IE');
  });
});

describe('fhsMassDistributionFromSuggestion', () => {
  it('maps TP-07 letters to FHS enum strings', () => {
    expect(fhsMassDistributionFromSuggestion('D')).toBe('D: Mass equally distributed');
    expect(fhsMassDistributionFromSuggestion('IE')).toBe('IE: Mass divided over internal and external side');
  });
});
