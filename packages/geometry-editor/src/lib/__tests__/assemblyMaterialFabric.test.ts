// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { unavailableGeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import type { BundledAssemblyLibrary } from '../assemblyLibrary';
import type { MaterialRow } from '../assemblyTypes';
import {
  getPartyWallFabricFields,
  getPartyWallCavityFields,
  readPartyWallFabricValue,
  partyWallFabricPatch,
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


describe('target-aware party-wall fabric fields', () => {
  it.each([
    ['a7', { u_value: {}, thermal_resistance_construction: {} }, ['u_value', 'thermal_resistance_construction']],
    ['a8', { u_value: false, thermal_resistance_construction: {} }, ['thermal_resistance_construction']],
    ['a9', { u_value: false, u_value_whole_wall: {}, thermal_resistance_construction: {} }, ['u_value_whole_wall', 'thermal_resistance_construction']],
  ])('uses schema permissions for %s, including false properties', (_target, properties, keys) => {
    const port = { ...unavailableGeometrySchemaPort, availability: 'available' as const, getElementSubschema: () => ({ properties }) };
    expect(getPartyWallFabricFields(port, 'fhs').map((field) => field.key)).toEqual(keys);
  });

  it('does not expose fields until the selected schema is ready', () => {
    const port = { ...unavailableGeometrySchemaPort, availability: 'available' as const, getElementSubschema: () => null };
    expect(getPartyWallFabricFields(port, 'fhs')).toEqual([]);
  });

  it('does not reinterpret a legacy U as half-construction U', () => {
    expect(readPartyWallFabricValue({ u_value: 0.25 }, 'u_value')).toBeNull();
    expect(readPartyWallFabricValue({ u_value: 0.25, u_value_interpretation: 'whole_wall' }, 'u_value')).toBeNull();
    expect(readPartyWallFabricValue({ u_value: 0.25, u_value_interpretation: 'half_construction' }, 'u_value')).toBe(0.25);
  });

  it('records explicitly authored meaning without replacing other facts', () => {
    const extra = { u_value: 0.3, u_value_whole_wall: 0.2, thermal_resistance_construction: 2 };
    expect({ ...extra, ...partyWallFabricPatch('u_value_whole_wall', 0.24) }).toEqual({ ...extra, u_value_whole_wall: 0.24 });
    expect(partyWallFabricPatch('u_value', 0.4)).toEqual({ u_value: 0.4, u_value_interpretation: 'half_construction', u_value_interpreted_value: 0.4 });
    expect(partyWallFabricPatch('thermal_resistance_construction', 3)).toEqual({ thermal_resistance_construction: 3, construction_basis: 'half' });
  });
});


it('filters party-wall cavity choices and resistance using the selected schema', () => {
  const root = { $defs: { Cavity: { enum: ['solid', 'defined_resistance'] } } };
  const port = { ...unavailableGeometrySchemaPort, availability: 'available' as const,
    getRootSchema: () => root,
    getElementSubschema: () => ({ properties: { party_wall_cavity_type: { $ref: '#/$defs/Cavity' }, thermal_resistance_cavity: {} } }),
  };
  expect(getPartyWallCavityFields(port, 'fhs')).toEqual({ options: [{ value: 'solid', label: 'Solid' }, { value: 'defined_resistance', label: 'Defined resistance' }], supportsResistance: true });
  expect(getPartyWallCavityFields({ ...port, getElementSubschema: () => ({ properties: { party_wall_cavity_type: { enum: ['solid'] }, thermal_resistance_cavity: false } }) }, 'fhs')).toEqual({ options: [{ value: 'solid', label: 'Solid' }], supportsResistance: false });
});
