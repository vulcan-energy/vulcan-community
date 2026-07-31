// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { AssemblyLayer, CavityRow, MaterialRow } from '../assemblyTypes';
import {
  assemblySearchHaystack,
  buildAssemblyDisplayName,
  repeatingBridgeSuffixes,
  truncatedAssemblyMaterialLabel,
} from '../assemblyNaming';

describe('truncatedAssemblyMaterialLabel', () => {
  it('leaves short strings unchanged', () => {
    expect(truncatedAssemblyMaterialLabel('Plasterboard')).toBe('Plasterboard');
  });

  it('truncates long catalogue-style names at a word boundary when sensible', () => {
    const s = truncatedAssemblyMaterialLabel('Mediumweight Concrete Block - Perlite-Filled', 28);
    expect(s.length).toBeLessThanOrEqual(28);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('repeatingBridgeSuffixes', () => {
  const mats = new Map<string, MaterialRow>([
    ['tim', { id: 'tim', name: 'Softwood joist full', shortName: 'Timber', lambda_W_mK: 0.13 }],
    ['stl', { id: 'stl', name: 'Steel column', shortName: 'Steel', lambda_W_mK: 50 }],
  ]);

  it('formats framing fraction as +pct% bridgeShortName', () => {
    const s = repeatingBridgeSuffixes(
      [{ id: '1', bridgeMaterialId: 'tim', definition: { mode: 'framing_fraction', framingFraction: 0.25 } }],
      mats,
    );
    expect(s).toBe(' +25% Timber');
  });

  it('formats spacing/width in mm', () => {
    const s = repeatingBridgeSuffixes(
      [{ id: '1', bridgeMaterialId: 'stl', definition: { mode: 'spacing_width', spacing_m: 0.4, width_m: 0.05 } }],
      mats,
    );
    expect(s).toBe(' +400×50mm Steel');
  });
});

describe('buildAssemblyDisplayName', () => {
  const cavityRows: CavityRow[] = [
    {
      cavityType: 'unventilated_wall_cavity_high_emissivity',
      fixedResistance_m2K_W: 0.18,
      shortLabel: 'Unventilated wall cavity',
    },
  ];
  const materials = new Map<string, MaterialRow>([
    ['in', { id: 'in', name: 'Inner brick long', shortName: 'Inner brick', lambda_W_mK: 0.56 }],
    ['out', { id: 'out', name: 'Outer brick long', shortName: 'Outer brick', lambda_W_mK: 0.77 }],
  ]);

  it('joins layers with bridges on solid', () => {
    const layers: AssemblyLayer[] = [
      {
        kind: 'solid',
        materialId: 'in',
        thickness_m: 0.1025,
        repeatingBridges: [
          { id: 'b', bridgeMaterialId: 'out', definition: { mode: 'framing_fraction', framingFraction: 0.1 } },
        ],
      },
      { kind: 'cavity', cavityType: 'unventilated_wall_cavity_high_emissivity', fixedResistance_m2K_W: 0.18 },
      { kind: 'solid', materialId: 'out', thickness_m: 0.1025 },
    ];
    const name = buildAssemblyDisplayName(layers, materials, cavityRows);
    expect(name).toContain('103mm Inner brick +10% Outer brick');
    expect(name).toContain('Unventilated wall cavity R0.18');
    expect(name).toContain('103mm Outer brick');
  });

  it('formats explicit ventilated cavities in the display name', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'in', thickness_m: 0.1 },
      {
        kind: 'cavity',
        ventilation: 'well_ventilated',
        gap_thickness_m: 0.05,
        surface_emissivity: 'high',
      },
    ];
    const name = buildAssemblyDisplayName(layers, materials, cavityRows);
    expect(name).toContain('50mm well ventilated cavity');
    expect(name).toContain('high emissivity');
  });
});

describe('assemblySearchHaystack', () => {
  it('includes full material names and id', () => {
    const ex = {
      id: 'user:asm:abc',
      name: 'short stack',
      elementType: 'wall',
      layers: [
        { kind: 'solid' as const, materialId: 'm1', thickness_m: 0.1 },
      ],
      sourceType: 'user' as const,
    };
    const mats = new Map<string, MaterialRow>([
      ['m1', { id: 'm1', name: 'Very Long Material Name For Search', shortName: 'Short', lambda_W_mK: 1 }],
    ]);
    const hay = assemblySearchHaystack(ex, mats);
    expect(hay).toContain('very long material name for search');
    expect(hay).toContain('user:asm:abc');
    expect(hay).toContain('short');
  });
});
