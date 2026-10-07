// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { unavailableGeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import type { BundledAssemblyLibrary } from '../assemblyLibrary';
import type { AssemblyExample, MaterialRow } from '../assemblyTypes';
import {
  applyCreationDefaultAssemblyToElement,
  assemblyPitchDegForElement,
  computePatchFromSavedAssembly,
  libraryElementTypeForElement,
} from '../multiSelectAssemblyApply';
import { validateElementCore } from '../../geometry/validation/validateElement';
import type { Element } from '../../geometry/types';

const brick = {
  id: 'mat:brick',
  name: 'Brick',
  lambda_W_mK: 0.77,
  density_kg_m3: 1700,
  specificHeat_J_kgK: 800,
} as unknown as MaterialRow;
const insulation = {
  id: 'mat:insulation',
  name: 'Mineral wool',
  lambda_W_mK: 0.035,
  density_kg_m3: 30,
  specificHeat_J_kgK: 1030,
} as unknown as MaterialRow;
const noMass = { id: 'mat:no-mass', name: 'Board without ρ/c', lambda_W_mK: 0.035 } as unknown as MaterialRow;

const roofRow = {
  id: 'test:roof',
  name: 'Flat roof',
  elementType: 'roof',
  layers: [{ kind: 'solid', materialId: insulation.id, thickness_m: 0.15 }],
} as AssemblyExample;
const ventilatedWallRow = {
  id: 'test:ventilated-wall',
  name: 'Rainscreen wall',
  elementType: 'wall',
  layers: [
    { kind: 'solid', materialId: insulation.id, thickness_m: 0.1 },
    { kind: 'cavity', ventilation: 'well_ventilated', gap_thickness_m: 0.05, surface_emissivity: 'low' },
    { kind: 'solid', materialId: brick.id, thickness_m: 0.1 },
  ],
} as AssemblyExample;
const noMassWallRow = {
  id: 'test:no-mass-wall',
  name: 'No mass wall',
  elementType: 'wall',
  layers: [{ kind: 'solid', materialId: noMass.id, thickness_m: 0.1 }],
} as AssemblyExample;

const library: BundledAssemblyLibrary = {
  materialsById: new Map([brick, insulation, noMass].map((m) => [m.id, m])),
  cavityResistanceByType: new Map(),
  cavityRows: [],
  examples: [roofRow, ventilatedWallRow, noMassWallRow],
  materialCategories: [],
};

function opaque(pitch: number, coordinates: Array<{ x: number; y: number; z: number }>, extra_json = {}): Element {
  return {
    id: `el-${pitch}`,
    name: 'Element',
    type: 'BuildingElementOpaque',
    zoneId: 'z1',
    coordinates,
    pitch,
    orientation360: 180,
    base_height: 0,
    extra_json,
  } as unknown as Element;
}

const square = [
  { x: 0, y: 0, z: 0 },
  { x: 5, y: 0, z: 0 },
  { x: 5, y: 4, z: 0 },
  { x: 0, y: 4, z: 0 },
];
const wallLine = [
  { x: 0, y: 0, z: 0 },
  { x: 5, y: 0, z: 0 },
];

describe('flat roof (pitch 0) bulk assembly apply', () => {
  it('keeps pitch 0, classifies as a roof, and matches the single-element U', () => {
    const flatRoof = opaque(0, square);
    expect(assemblyPitchDegForElement(flatRoof)).toBe(0);
    expect(libraryElementTypeForElement(flatRoof)).toBe('roof');

    const single = computePatchFromSavedAssembly(roofRow, library, 'BuildingElementOpaque', 0);
    const bulk = applyCreationDefaultAssemblyToElement(flatRoof, { library, ids: { roof: roofRow.id } });
    expect((bulk.extra_json as Record<string, unknown>).u_value).toBe(single!.patch.u_value);
  });
});

describe('saved ventilated-cavity assembly', () => {
  it('writes an R that HEM turns back into the written U (no U/R mismatch warning)', () => {
    const comp = computePatchFromSavedAssembly(ventilatedWallRow, library, 'BuildingElementOpaque', 90);
    expect(comp!.errors).toEqual([]);
    const patched = opaque(90, wallLine, comp!.patch);
    const warnings = validateElementCore(patched, { schemaPort: unavailableGeometrySchemaPort })
      .warnings.map((w) => w.message)
      .filter((m) => m.includes('U/R mismatch'));
    expect(warnings).toEqual([]);
  });
});

describe('areal heat capacity without material ρ/c', () => {
  it('clears a stale areal_heat_capacity instead of keeping it', () => {
    const wall = opaque(90, wallLine, { areal_heat_capacity: 'Very heavy' });
    const applied = applyCreationDefaultAssemblyToElement(wall, { library, ids: { wall: noMassWallRow.id } });
    const extra = applied.extra_json as Record<string, unknown>;
    expect(extra.thermal_resistance_construction).toBeDefined();
    expect(extra.areal_heat_capacity).toBeUndefined();
  });
});
