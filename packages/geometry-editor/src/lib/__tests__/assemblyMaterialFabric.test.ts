// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BundledAssemblyLibrary } from '../assemblyLibrary';
import type { MaterialRow } from '../assemblyTypes';
import {
  adjustConstructionResistanceForHeatedAdjacentElement,
  applyHeatedAdjacentHalfToArealJPerM2K,
  buildAssemblyMaterialPickerSections,
  isVulcanUiPartyFloorElement,
  materialSelectableInAssemblyCalculator,
  GROUND_EXCLUDED_MATERIAL_CATEGORIES,
  OPAQUE_EXCLUDED_MATERIAL_CATEGORIES,
} from '../assemblyMaterialFabric';

function tinyLibrary(materials: MaterialRow[]): BundledAssemblyLibrary {
  return {
    materialsById: new Map(materials.map((m) => [m.id, m])),
    cavityResistanceByType: new Map(),
    cavityRows: [],
    examples: [],
    materialCategories: [
      { id: 'brick_block', label: 'Brick & block' },
      { id: 'soils_subgrade', label: 'Soils' },
      { id: 'carpet', label: 'Carpet' },
    ],
  };
}

describe('OPAQUE_EXCLUDED_MATERIAL_CATEGORIES', () => {
  it('includes soils and carpet', () => {
    expect(OPAQUE_EXCLUDED_MATERIAL_CATEGORIES.has('soils_subgrade')).toBe(true);
    expect(OPAQUE_EXCLUDED_MATERIAL_CATEGORIES.has('carpet')).toBe(true);
  });
});

describe('GROUND_EXCLUDED_MATERIAL_CATEGORIES', () => {
  it('includes soils_subgrade for ground-floor picker', () => {
    expect(GROUND_EXCLUDED_MATERIAL_CATEGORIES.has('soils_subgrade')).toBe(true);
  });
});

describe('adjustConstructionResistanceForHeatedAdjacentElement', () => {
  it('halves construction resistance for party walls', () => {
    expect(
      adjustConstructionResistanceForHeatedAdjacentElement('BuildingElementPartyWall', 2.4, 2.1),
    ).toEqual({ rMean: 1.2, rSeries: 1.05 });
  });

  it('leaves other element modes unchanged', () => {
    expect(
      adjustConstructionResistanceForHeatedAdjacentElement('BuildingElementOpaque', 2.4, 2.1),
    ).toEqual({ rMean: 2.4, rSeries: 2.1 });
  });

  it('halves for adjacent conditioned elements regardless of party-floor flag', () => {
    expect(
      adjustConstructionResistanceForHeatedAdjacentElement('BuildingElementAdjacentConditionedSpace', 2.4, 2.1),
    ).toEqual({ rMean: 1.2, rSeries: 1.05 });
  });
});

describe('applyHeatedAdjacentHalfToArealJPerM2K', () => {
  it('halves for party wall and adjacent conditioned elements', () => {
    expect(applyHeatedAdjacentHalfToArealJPerM2K(100_000, 'BuildingElementPartyWall')).toBe(50_000);
    expect(
      applyHeatedAdjacentHalfToArealJPerM2K(100_000, 'BuildingElementAdjacentConditionedSpace'),
    ).toBe(50_000);
    expect(
      applyHeatedAdjacentHalfToArealJPerM2K(100_000, 'BuildingElementOpaque'),
    ).toBe(100_000);
  });
});

describe('isVulcanUiPartyFloorElement', () => {
  it('only treats horizontal adjacent conditioned polygons as party floors', () => {
    expect(
      isVulcanUiPartyFloorElement({
        type: 'BuildingElementAdjacentConditionedSpace',
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
        ],
        pitch: 0,
        extra_json: { _vulcan_ui_party_element: true },
      }),
    ).toBe(true);
    expect(
      isVulcanUiPartyFloorElement({
        type: 'BuildingElementAdjacentConditionedSpace',
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        pitch: 90,
        extra_json: { _vulcan_ui_party_element: true },
      }),
    ).toBe(false);
    expect(
      isVulcanUiPartyFloorElement({
        type: 'BuildingElementAdjacentConditionedSpace',
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
        ],
        pitch: 30,
        extra_json: { _vulcan_ui_party_element: true },
      }),
    ).toBe(false);
  });
});

describe('materialSelectableInAssemblyCalculator', () => {
  const soil: MaterialRow = {
    id: 'mat.iso.soil',
    name: 'Soil',
    shortName: 'Soil',
    category: 'soils_subgrade',
    lambda_W_mK: 1.2,
  };
  const brick: MaterialRow = {
    id: 'mat.br443.brick_outer',
    name: 'Brick',
    shortName: 'Brick',
    category: 'brick_block',
    lambda_W_mK: 0.77,
  };
  const userMat: MaterialRow = {
    id: 'user:mat:abc',
    name: 'Custom',
    shortName: 'Custom',
    lambda_W_mK: 0.04,
  };

  it('excludes soils_subgrade for ground (HEM ground path — do not stack soil as construction R)', () => {
    expect(materialSelectableInAssemblyCalculator('BuildingElementGround', soil)).toBe(false);
    expect(materialSelectableInAssemblyCalculator('BuildingElementGround', brick)).toBe(true);
  });

  it('excludes soils and carpet for opaque', () => {
    expect(materialSelectableInAssemblyCalculator('BuildingElementOpaque', soil)).toBe(false);
    expect(materialSelectableInAssemblyCalculator('BuildingElementOpaque', brick)).toBe(true);
  });

  it('allows soils for thermal-bridge junction region picker (excludes carpet)', () => {
    expect(materialSelectableInAssemblyCalculator('ThermalBridgeJunctionRegion', soil)).toBe(true);
    expect(materialSelectableInAssemblyCalculator('ThermalBridgeJunctionRegion', brick)).toBe(true);
    const carpet: MaterialRow = {
      id: 'mat.carpet',
      name: 'Carpet',
      shortName: 'Carpet',
      category: 'carpet',
      lambda_W_mK: 0.06,
    };
    expect(materialSelectableInAssemblyCalculator('ThermalBridgeJunctionRegion', carpet)).toBe(false);
  });

  it('always allows user materials', () => {
    expect(materialSelectableInAssemblyCalculator('BuildingElementOpaque', userMat)).toBe(true);
  });
});

describe('buildAssemblyMaterialPickerSections', () => {
  const lib = tinyLibrary([
    {
      id: 'mat.br443.brick_outer',
      name: 'Brick',
      shortName: 'Brick',
      category: 'brick_block',
      lambda_W_mK: 0.77,
    },
    {
      id: 'mat.iso.soil',
      name: 'Soil',
      shortName: 'Soil',
      category: 'soils_subgrade',
      lambda_W_mK: 1.2,
    },
  ]);

  it('omits excluded categories for opaque mode', () => {
    const sections = buildAssemblyMaterialPickerSections(lib, 'BuildingElementOpaque', undefined);
    const flat = sections.flatMap((s) => s.options.map((o) => o.value));
    expect(flat).toContain('mat.br443.brick_outer');
    expect(flat).not.toContain('mat.iso.soil');
  });

  it('omits soil for ground mode', () => {
    const sections = buildAssemblyMaterialPickerSections(lib, 'BuildingElementGround', undefined);
    const flat = sections.flatMap((s) => s.options.map((o) => o.value));
    expect(flat).not.toContain('mat.iso.soil');
  });

  it('prepends legacy section when current material is excluded', () => {
    const sections = buildAssemblyMaterialPickerSections(lib, 'BuildingElementOpaque', 'mat.iso.soil');
    expect(sections[0]?.title).toContain('not in typical list');
    expect(sections[0]?.options.some((o) => o.value === 'mat.iso.soil')).toBe(true);
    const rest = sections.slice(1).flatMap((s) => s.options.map((o) => o.value));
    expect(rest).not.toContain('mat.iso.soil');
  });

  it('prepends legacy section for ground when snapshot references excluded soil', () => {
    const sections = buildAssemblyMaterialPickerSections(lib, 'BuildingElementGround', 'mat.iso.soil');
    expect(sections[0]?.title).toContain('not in typical list');
    expect(sections[0]?.options.some((o) => o.value === 'mat.iso.soil')).toBe(true);
  });
});
