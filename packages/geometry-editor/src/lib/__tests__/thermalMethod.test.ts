// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { sharedRoofPlanes } from '../hemieFabric';
import { offeredMethods, statedMethod, switchMethod, TANK_METHOD_GROUPS } from '../inputMethods';
import { bandOnlyFields, inferThermalMethod, thermalMethods, thermalMethodSwitchPatch } from '../thermalMethod';

const line = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }];
const el = (fields: Record<string, unknown>) => ({ id: 'e', name: 'E', zoneId: 'z', coordinates: line, ...fields }) as unknown as Element;
const wall = (extra: Record<string, unknown>) => el({ type: 'BuildingElementOpaque', pitch: 90, extra_json: extra });
const assembly = { vulcan_assembly_v1: { schemaVersion: 1, assemblyId: 'a', appliedAt: 't', thermalResistanceConstruction_m2K_W: 4 } };

it('offers the methods each target takes', () => {
  expect(thermalMethods('BuildingElementOpaque', true).map((m) => m.label)).toEqual(['Age band', 'Calculation', 'U-value']);
  expect(thermalMethods('BuildingElementOpaque', false).map((m) => m.label)).toEqual(['U-value', 'Layers']);
  expect(thermalMethods('BuildingElementGround', false).map((m) => m.label)).toEqual(['U-value', 'Calculation']);
  expect(thermalMethods('BuildingElementTransparent', true).map((m) => m.label)).toEqual(['Age band', 'U-value']);
  expect(thermalMethods('BuildingElementTransparent', false)).toEqual([]);
  expect(thermalMethods('BuildingElementPartyWall', true)).toEqual([]);
  // No calculated U-value (incomplete drawing): an existing building's floor offers no calculation.
  expect(thermalMethods('BuildingElementGround', true, false).map((m) => m.value)).toEqual(['band', 'u_value']);
});

it('opens on the method the stored values state; a U-value wins over a band', () => {
  expect(inferThermalMethod(wall({ age_band: 'D' }), true)).toBe('band');
  expect(inferThermalMethod(wall({ age_band: 'D', u_value: 0.3 }), true)).toBe('u_value');
  expect(inferThermalMethod(wall({ ...assembly, u_value: 0.2 }), true)).toBe('calculation');
  expect(inferThermalMethod(wall({}), false)).toBe('u_value');
  const ground = (extra: Record<string, unknown>) => el({ type: 'BuildingElementGround', extra_json: extra });
  expect(inferThermalMethod(ground({ u_value: 0.2 }), false)).toBe('calculation');
  expect(inferThermalMethod(ground({ u_value: 0.2, _ground_u_value_manual: true }), false)).toBe('u_value');
  expect(inferThermalMethod(ground({ u_value: 0.2 }), true, 0.2001)).toBe('calculation');
  expect(inferThermalMethod(ground({ u_value: 0.5 }), true, 0.2)).toBe('u_value');
  expect(inferThermalMethod(ground({}), true)).toBe('band');
});

it('clears the old method only, in one patch', () => {
  // A wall's band and type give its heat capacity, so a U-value keeps them.
  expect(bandOnlyFields('external_wall')).toEqual([]);
  expect(bandOnlyFields('window')).toEqual(['age_band', 'glazing_gap']);
  expect(bandOnlyFields('flat_roof')).toEqual(['insulation_thickness', 'ceiling_thickness', 'ceiling_thermal_conductivity', 'joist_depth',
    'percentage_area_of_timber_joists', 'insulation_thermal_conductivity']);
  expect(bandOnlyFields('suspended_floor')).toEqual(['age_band', 'insulation_location', 'insulation_thickness', 'insulation_type', 'insulation_thermal_conductivity']);
  expect(thermalMethodSwitchPatch(wall({ age_band: 'D', wall_construction_type: 'cavity' }), 'band', 'u_value', { constructionBands: true, constructionType: 'external_wall' }).extra_json)
    .toEqual({ age_band: 'D', wall_construction_type: 'cavity' });
  // A window with no g-value takes it from its glazing type, so the glazing type stays.
  const window = el({ type: 'BuildingElementTransparent', extra_json: { age_band: 'D', glazing_type: 'double', glazing_gap: 12, frame_material: 'wood' } });
  expect(thermalMethodSwitchPatch(window, 'band', 'u_value', { constructionBands: true, constructionType: 'window' }).extra_json)
    .toEqual({ glazing_type: 'double', frame_material: 'wood' });
  // A roof's insulation location sets its type and default mass class; its age band reaches its rooflights.
  const roof = el({ type: 'BuildingElementOpaque', pitch: 40, extra_json: { age_band: 'C', insulation_location: 'at_joists', insulation_thickness: 100 } });
  expect(thermalMethodSwitchPatch(roof, 'band', 'u_value', { constructionBands: true, constructionType: 'unheated_pitched_roof' }).extra_json)
    .toEqual({ age_band: 'C', insulation_location: 'at_joists' });
  const entered = el({ type: 'BuildingElementOpaque', pitch: 90, u_value: 0.4, extra_json: { u_value: 0.4, areal_heat_capacity: 'Medium' } });
  expect(thermalMethodSwitchPatch(entered, 'u_value', 'band', { constructionBands: true })).toEqual({ u_value: undefined, extra_json: { areal_heat_capacity: 'Medium' } });
  expect(thermalMethodSwitchPatch(wall({ ...assembly, u_value: 0.2, mass_distribution_class: 'IE' }), 'calculation', 'u_value', { constructionBands: false }).extra_json)
    .toEqual({ mass_distribution_class: 'IE' });
  const ground = el({ type: 'BuildingElementGround', extra_json: { u_value: 0.4, _ground_u_value_manual: true } });
  expect(thermalMethodSwitchPatch(ground, 'u_value', 'calculation', { constructionBands: false, groundComputedU: 0.21 }).extra_json).toEqual({ u_value: 0.21 });
  expect(thermalMethodSwitchPatch(ground, 'u_value', 'calculation', { constructionBands: true, groundComputedU: 0.21 }).extra_json).toEqual({ u_value: 0.21, _ground_u_value_manual: true });
});

it('keeps one cylinder size and one heat loss', () => {
  const [size, loss] = TANK_METHOD_GROUPS;
  const existing = { volume: {}, tank_volume_category: {}, external_diameter: {}, external_height: {}, daily_losses: {}, energy_efficiency_class: {}, installation_year: {} };
  expect(offeredMethods(size!, existing).map((m) => m.value)).toEqual(['category', 'volume', 'dimensions']);
  expect(offeredMethods(size!, { volume: {} })).toHaveLength(1);
  const sizes = offeredMethods(size!, existing);
  expect(statedMethod(sizes, { external_diameter: 0.5 }).value).toBe('dimensions');
  expect(statedMethod(sizes, {}, 'category').value).toBe('category');
  expect(switchMethod(sizes, 'category', { volume: 200, external_diameter: 0.5, tank_volume_category: 'Medium', daily_losses: 1.6 }))
    .toEqual({ tank_volume_category: 'Medium', daily_losses: 1.6 });
  expect(statedMethod(offeredMethods(loss!, existing), {}, 'year').value).toBe('year');
});

it('finds the planes of one roof over one building part', () => {
  const ground = (id: string, x0: number) => el({ id, type: 'BuildingElementGround', floor_type: 'Slab_no_edge_insulation',
    coordinates: [{ x: x0, y: 0, z: 0 }, { x: x0 + 4, y: 0, z: 0 }, { x: x0 + 4, y: 4, z: 0 }, { x: x0, y: 4, z: 0 }] });
  const roof = (id: string, x0: number, y0: number) => el({ id, name: id, type: 'BuildingElementOpaque', pitch: 40, is_unheated_pitched_roof: true,
    coordinates: [{ x: x0, y: y0, z: 5 }, { x: x0 + 4, y: y0, z: 5 }, { x: x0 + 4, y: y0 + 2, z: 6 }, { x: x0, y: y0 + 2, z: 6 }] });
  const elements = [ground('g1', 0), ground('g2', 10), roof('S', 0, 0), roof('N', 0, 2), roof('Ext', 10, 0), wall({}), roof('Off1', 30, 0), roof('Off2', 30, 2)];
  expect(sharedRoofPlanes(elements[2]!, elements).map((e) => e.id)).toEqual(['N']);
  expect(sharedRoofPlanes(elements[4]!, elements)).toEqual([]);
  expect(sharedRoofPlanes(elements[5]!, elements)).toEqual([]);
  // Planes over no ground floor: the part is not known, so no sharing is claimed.
  expect(sharedRoofPlanes(elements[6]!, elements)).toEqual([]);
});
