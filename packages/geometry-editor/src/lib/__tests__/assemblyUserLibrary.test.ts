// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  assemblyDisplayName,
  buildUserAssemblyExample,
  canonicalUserAssemblyJson,
  fnv1aHex16,
  libraryElementTypeForMode,
  userAssemblyIdFromCanonical,
  userMaterialIdFromNameLambda,
} from '../assemblyUserLibrary';
import type { AssemblyLayer, CavityRow, ExternalDetailProfileLink, MaterialRow } from '../assemblyTypes';

describe('canonicalUserAssemblyJson', () => {
  it('is stable for the same stack', () => {
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'a', thickness_m: 0.1 },
      { kind: 'cavity', cavityType: 'cav', fixedResistance_m2K_W: 0.18 },
    ];
    const a = canonicalUserAssemblyJson(layers, 'BuildingElementOpaque', 'wall');
    const b = canonicalUserAssemblyJson(layers, 'BuildingElementOpaque', 'wall');
    expect(a).toBe(b);
  });

  it('changes when library element type changes', () => {
    const layers: AssemblyLayer[] = [{ kind: 'solid', materialId: 'a', thickness_m: 0.1 }];
    const w = canonicalUserAssemblyJson(layers, 'BuildingElementOpaque', 'wall');
    const r = canonicalUserAssemblyJson(layers, 'BuildingElementOpaque', 'roof');
    expect(w).not.toBe(r);
  });

  it('changes when explicit cavity properties change', () => {
    const a = canonicalUserAssemblyJson(
      [
        {
          kind: 'cavity',
          ventilation: 'unventilated',
          gap_thickness_m: 0.05,
          surface_emissivity: 'high',
        },
      ],
      'BuildingElementOpaque',
      'wall',
    );
    const b = canonicalUserAssemblyJson(
      [
        {
          kind: 'cavity',
          ventilation: 'well_ventilated',
          gap_thickness_m: 0.05,
          surface_emissivity: 'high',
        },
      ],
      'BuildingElementOpaque',
      'wall',
    );
    expect(a).not.toBe(b);
  });

  it('includes the external detail profile in the canonical assembly identity', () => {
    const layers: AssemblyLayer[] = [{ kind: 'solid', materialId: 'a', thickness_m: 0.1 }];
    const profileA: ExternalDetailProfileLink = {
      source: 'recognised_construction_details',
      profileId: 'rcd:wall:1:ins:4:it:0.032:bt:0.11',
      label: 'Full fill wall',
    };
    const profileB: ExternalDetailProfileLink = {
      ...profileA,
      profileId: 'rcd:wall:1:ins:5:it:0.032:bt:0.11',
    };

    const withoutProfile = canonicalUserAssemblyJson(layers, 'BuildingElementOpaque', 'wall');
    const withProfileA = canonicalUserAssemblyJson(layers, 'BuildingElementOpaque', 'wall', profileA);
    const withProfileB = canonicalUserAssemblyJson(layers, 'BuildingElementOpaque', 'wall', profileB);

    expect(withProfileA).not.toBe(withoutProfile);
    expect(withProfileA).not.toBe(withProfileB);
  });
});

describe('userAssemblyIdFromCanonical', () => {
  it('matches fnv1aHex16 prefix', () => {
    const c = '{"a":1}';
    expect(userAssemblyIdFromCanonical(c)).toBe(`user:asm:${fnv1aHex16(c)}`);
  });
});

describe('userMaterialIdFromNameLambda', () => {
  it('is case-insensitive on name', () => {
    expect(userMaterialIdFromNameLambda('OSB', 0.13)).toBe(userMaterialIdFromNameLambda('osb', 0.13));
  });

  it('changes when lambda changes', () => {
    expect(userMaterialIdFromNameLambda('OSB', 0.13)).not.toBe(userMaterialIdFromNameLambda('OSB', 0.14));
  });
});

describe('assemblyDisplayName', () => {
  it('joins solid and cavity parts using short names and cavity labels', () => {
    const m = new Map<string, MaterialRow>([
      ['bre.x', { id: 'bre.x', name: 'Brickwork long name', shortName: 'Brick', lambda_W_mK: 0.77 }],
    ]);
    const cavityRows: CavityRow[] = [
      {
        cavityType: 'unventilated_wall_cavity',
        fixedResistance_m2K_W: 0.18,
        shortLabel: 'Wall cavity',
      },
    ];
    const layers: AssemblyLayer[] = [
      { kind: 'solid', materialId: 'bre.x', thickness_m: 0.1025 },
      { kind: 'cavity', cavityType: 'unventilated_wall_cavity', fixedResistance_m2K_W: 0.18 },
    ];
    const s = assemblyDisplayName(layers, m, cavityRows);
    expect(s).toContain('103mm');
    expect(s).toContain('Brick');
    expect(s).not.toContain('Brickwork long name');
    expect(s).toContain('Wall cavity R0.18');
  });
});

describe('libraryElementTypeForMode', () => {
  it('maps modes', () => {
    expect(libraryElementTypeForMode('BuildingElementGround', 'wall')).toBe('ground_floor');
    expect(libraryElementTypeForMode('BuildingElementOpaque', 'roof')).toBe('roof');
    expect(libraryElementTypeForMode('BuildingElementAdjacentUnconditionedSpace_Simple', 'wall')).toBe('wall');
    expect(libraryElementTypeForMode('BuildingElementPartyWall', 'roof')).toBe('wall');
  });
});

describe('buildUserAssemblyExample', () => {
  it('produces deterministic id and display name', () => {
    const materials = new Map<string, MaterialRow>([
      ['m1', { id: 'm1', name: 'Gypsum plasterboard long', shortName: 'PB', lambda_W_mK: 0.25 }],
    ]);
    const cavityRows: CavityRow[] = [];
    const layers: AssemblyLayer[] = [{ kind: 'solid', materialId: 'm1', thickness_m: 0.0125 }];
    const a = buildUserAssemblyExample(layers, 'BuildingElementOpaque', 'wall', materials, cavityRows);
    const b = buildUserAssemblyExample(layers, 'BuildingElementOpaque', 'wall', materials, cavityRows);
    expect(a.id).toBe(b.id);
    expect(a.name).toBe('13mm PB');
    expect(a.elementType).toBe('wall');
    expect(a.sourceType).toBe('user');
  });

  it('persists the selected external detail profile on user-saved assemblies', () => {
    const materials = new Map<string, MaterialRow>([
      ['m1', { id: 'm1', name: 'Concrete block', shortName: 'Block', lambda_W_mK: 0.11 }],
    ]);
    const externalDetailProfile: ExternalDetailProfileLink = {
      source: 'recognised_construction_details',
      profileId: 'rcd:wall:1:ins:4:it:0.032:bt:0.11',
      label: 'Masonry cavity wall full fill insulation',
    };

    const assembly = buildUserAssemblyExample(
      [{ kind: 'solid', materialId: 'm1', thickness_m: 0.1 }],
      'BuildingElementOpaque',
      'wall',
      materials,
      [],
      externalDetailProfile,
    );

    expect(assembly.externalDetailProfile).toEqual(externalDetailProfile);
  });
});
