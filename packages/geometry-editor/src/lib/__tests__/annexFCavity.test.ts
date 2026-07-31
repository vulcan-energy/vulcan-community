// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { AssemblyLayer, CavityRow } from '../assemblyTypes';
import {
  collectCavityLayerIndices,
  defaultAnnexFAirVoidLevelForCavityType,
  effectiveAnnexFAirVoidLevelForStack,
  resolveAnnexFPrimaryCavityLayerIndex,
  resolveAnnexFR1LayerIndex,
} from '../annexFCavity';

const sampleRows: CavityRow[] = [
  {
    cavityType: 'unventilated_wall_cavity_high_emissivity',
    fixedResistance_m2K_W: 0.18,
    shortLabel: 'Wall cavity',
    iso6946AnnexFAirVoidLevelDefault: 0,
  },
];

describe('annexFCavity', () => {
  it('collectCavityLayerIndices', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'a', thickness_m: 0.1 },
      { kind: 'cavity', cavityType: 'c', fixedResistance_m2K_W: 0.18 },
    ];
    expect(collectCavityLayerIndices(layers)).toEqual([1]);
  });

  it('resolveAnnexFPrimaryCavityLayerIndex: single cavity', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'cavity', cavityType: 'c', fixedResistance_m2K_W: 0.18 },
      { kind: 'solid', materialId: 'a', thickness_m: 0.1 },
    ];
    expect(resolveAnnexFPrimaryCavityLayerIndex(layers, null)).toBe(0);
  });

  it('resolveAnnexFR1LayerIndex uses cavity when primary is cavity', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'a', thickness_m: 0.1 },
      { kind: 'cavity', cavityType: 'c', fixedResistance_m2K_W: 0.18 },
    ];
    expect(resolveAnnexFR1LayerIndex(layers, [0.5, 0.18], 1)).toBe(1);
  });

  it('effectiveAnnexFAirVoidLevelForStack reads primary cavity layer', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'cavity', cavityType: 'unventilated_wall_cavity_high_emissivity', fixedResistance_m2K_W: 0.18 },
      { kind: 'solid', materialId: 'a', thickness_m: 0.1 },
    ];
    expect(effectiveAnnexFAirVoidLevelForStack(layers, sampleRows, 0)).toBe(
      defaultAnnexFAirVoidLevelForCavityType('unventilated_wall_cavity_high_emissivity', sampleRows),
    );
  });
});
