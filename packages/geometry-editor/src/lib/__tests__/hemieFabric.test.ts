// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { hemieConstructionType, hemieFabric, hemieHeatCapacityBands, hemieFieldLabel, hemieLeftoverKeys, hemieDefaultPlaceholder, hemieValueLabel,
  hemieConstructionKeys, hemieDetailFields, hemieHiddenDetails, hemieFinishEnum, hemieOutsideSurface, statedOutsideSurfaceMethod, postcodeBorderArea, postcodeOutsideArea, postcodeRegion, statedBuildType } from '../hemieFabric';

const line = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }];
const plane = [...line, { x: 4, y: 4, z: 0 }];
const el = (fields: Record<string, unknown>) => ({ id: 'e', name: 'E', zoneId: 'z', coordinates: line, ...fields }) as unknown as Element;
const settings = { HEMIE_age_band: 'D', HEMIE_construction_external_wall: '{"wall_construction_type":"cavity"}' };

it('maps elements to the construction type the converter gives them', () => {
  expect(hemieConstructionType(el({ type: 'BuildingElementOpaque', pitch: 90 }))).toBe('external_wall');
  expect(hemieConstructionType(el({ type: 'BuildingElementOpaque', is_external_door: true }))).toBe('external_door');
  expect(hemieConstructionType(el({ type: 'BuildingElementOpaque', coordinates: plane, pitch: 0 }))).toBe('flat_roof');
  expect(hemieConstructionType(el({ type: 'BuildingElementOpaque', coordinates: plane, pitch: 35, is_unheated_pitched_roof: true }))).toBe('unheated_pitched_roof');
  // A thatched loft plane takes the thatched roof construction (`hemie.rs`); a heated slope never does.
  expect(hemieConstructionType(el({ type: 'BuildingElementOpaque', coordinates: plane, pitch: 35, is_unheated_pitched_roof: true, extra_json: { thatched: true } }))).toBe('thatched_roof');
  expect(hemieConstructionType(el({ type: 'BuildingElementOpaque', coordinates: plane, pitch: 35, extra_json: { thatched: true } }))).toBe('heated_pitched_roof');
  expect(hemieConstructionType(el({ type: 'BuildingElementGround', coordinates: plane, floor_type: 'Suspended_floor' }))).toBe('suspended_floor');
  expect(hemieConstructionType(el({ type: 'BuildingElementPartyWall' }))).toBe('party_wall');
  expect(hemieConstructionType(el({ type: 'BuildingElementTransparent' }))).toBe('window');
  expect(hemieConstructionType(el({ type: 'BuildingElementOpaque', coordinates: plane, pitch: 90 }))).toBeUndefined();
  const party = { type: 'BuildingElementAdjacentConditionedSpace', coordinates: plane, extra_json: { _vulcan_ui_party_element: true } };
  expect(hemieConstructionType(el({ ...party, pitch: 180 }))).toBe('party_floor');
  expect(hemieConstructionType(el({ ...party, pitch: 0 }))).toBe('party_ceiling');
  expect(hemieConstructionType(el({ ...party, pitch: 0, extra_json: {} }))).toBeUndefined();
  const unheated = { type: 'BuildingElementAdjacentUnconditionedSpace_Simple', coordinates: plane };
  expect(hemieConstructionType(el({ ...unheated, pitch: 180 }))).toBe('above_internal_unconditioned_area_floor');
  expect(hemieConstructionType(el({ ...unheated, pitch: 0 }))).toBeUndefined();
  const bayRoof = { type: 'BuildingElementOpaque', coordinates: plane, extra_json: { hemie_bundle: { kind: 'bay', role: 'roof' } } };
  expect(hemieConstructionType(el({ ...bayRoof, pitch: 0 }))).toBe('mini_flat_roof');
  expect(hemieConstructionType(el({ ...bayRoof, pitch: 35 }))).toBe('mini_pitched_roof');
});

it('gives a park home its main walls, ground floor and roof the park home constructions', () => {
  const park = (fields: Record<string, unknown>) => hemieConstructionType(el(fields), [], 'park home');
  expect(park({ type: 'BuildingElementOpaque', pitch: 90 })).toBe('park_home_wall');
  expect(park({ type: 'BuildingElementGround', coordinates: plane, floor_type: 'Suspended_floor' })).toBe('park_home_floor');
  expect(park({ type: 'BuildingElementOpaque', coordinates: plane, pitch: 0 })).toBe('park_home_flat_roof');
  expect(park({ type: 'BuildingElementOpaque', coordinates: plane, pitch: 35, is_unheated_pitched_roof: true })).toBe('park_home_pitched_roof');
  expect(park({ type: 'BuildingElementOpaque', coordinates: plane, pitch: 35, is_unheated_pitched_roof: true, extra_json: { thatched: true } })).toBe('park_home_pitched_roof');
  expect(park({ type: 'BuildingElementOpaque', coordinates: plane, pitch: 0, extra_json: { hemie_bundle: { kind: 'bay', role: 'roof' } } })).toBe('mini_flat_roof');
  expect(park({ type: 'BuildingElementTransparent' })).toBe('window');
  expect(statedBuildType({ unreadMetadataRows: { General_build_type: 'park home' } })).toBe('park home');
});

it("gives a room in the roof's flat ceiling the unheated pitched roof construction", () => {
  const up = (z: number) => [{ x: 0, y: 0, z }, { x: 4, y: 0, z }];
  const storey = [el({ id: 'w0', type: 'BuildingElementOpaque', coordinates: up(0), pitch: 90, height: 2.5 })];
  const room = [
    el({ id: 'k', type: 'BuildingElementOpaque', coordinates: up(1), pitch: 90, height: 1.2 }),
    el({ id: 'g', type: 'BuildingElementOpaque', coordinates: up(1), pitch: 90, height: 2, extra_json: { geometry_face: { top_profile: [] } } }),
    el({ id: 's', type: 'BuildingElementOpaque', coordinates: plane.map((p) => ({ ...p, z: 2 })), pitch: 45 }),
  ];
  const ceiling = el({ id: 'c', type: 'BuildingElementOpaque', coordinates: plane.map((p) => ({ ...p, z: 2 })), pitch: 0 });
  expect(hemieConstructionType(ceiling, [...storey, ...room, ceiling])).toBe('unheated_pitched_roof');
  // Without the gable the top floor is a storey, and the flat plane a flat roof.
  expect(hemieConstructionType(ceiling, [...storey, room[0]!, room[2]!, ceiling])).toBe('flat_roof');
});

it('gives a door in a party or sheltered wall the party or sheltered door construction', () => {
  const walls = [el({ name: 'PW', type: 'BuildingElementPartyWall' }), el({ name: 'SW', type: 'BuildingElementAdjacentUnconditionedSpace_Simple' }), el({ name: 'EW', type: 'BuildingElementOpaque', pitch: 90 })];
  const door = (host: string) => el({ type: 'BuildingElementOpaque', is_external_door: true, parent_element: host });
  expect(hemieConstructionType(door('PW'), walls)).toBe('party_or_sheltered_door');
  expect(hemieConstructionType(door('SW'), walls)).toBe('party_or_sheltered_door');
  expect(hemieConstructionType(door('EW'), walls)).toBe('external_door');
});

it('takes the band and construction from the element, else its host wall, else the Defaults', () => {
  const wall = el({ type: 'BuildingElementOpaque', pitch: 90 });
  expect(hemieFabric(wall, settings)).toMatchObject({ constructionType: 'external_wall', band: 'D' });
  const extension = el({ name: 'X', type: 'BuildingElementOpaque', pitch: 90, extra_json: { age_band: 'K', wall_construction_type: 'timber frame' } });
  expect(hemieFabric(extension, settings)).toMatchObject({ band: 'K' });
  expect(hemieFabric(el({ type: 'Appliance' }), settings)).toBeUndefined();
  const window = el({ type: 'BuildingElementTransparent', parent_element: 'X' });
  expect(hemieFabric(window, settings, [extension])).toMatchObject({ band: 'K', hostBand: 'K' });
  expect(hemieFabric(window, settings, [wall])).toMatchObject({ band: 'D', hostBand: undefined });
});

it('labels fields and values for people, with units', () => {
  expect(hemieFieldLabel('glazing_gap')).toBe('Glazing gap (mm)');
  expect(hemieFieldLabel('areal_heat_capacity')).toBe('Heat capacity per area (J/m²·K)');
  expect(hemieValueLabel('glazing_gap', 12)).toBe('12 mm');
  expect(hemieValueLabel('frame_material', 'wood or PVC')).toBe('Wood or PVC');
  expect(hemieValueLabel('insulation_location', 'at_joists')).toBe('At joists');
  expect(hemieValueLabel('insulation_location', 'at_joists', 'flat_roof')).toBe('At joists (cold roof)');
  expect(hemieValueLabel('insulation_location', 'above_joists', 'mini_flat_roof')).toBe('Above joists (warm roof)');
  expect(hemieValueLabel('glazing_gap', 16)).toBe('16 mm or more');
  expect(hemieValueLabel('retrofit_insulation', true)).toBe('Yes');
});

it('lists the existing-building fields an element holds', () => {
  expect(hemieLeftoverKeys(el({ type: 'BuildingElementOpaque', extra_json: { age_band: 'K', is_front_door: true, u_value: 1 } }))).toEqual(['age_band', 'is_front_door']);
});

it('knows every UK postcode area and the Crown dependency areas', () => {
  // The 121 UK postcode areas (BT included) and the three Crown dependency areas.
  const areas = ('AB AL B BA BB BD BH BL BN BR BS BT CA CB CF CH CM CO CR CT CV CW DA DD DE DG DH DL DN DT DY E EC EH EN '
    + 'EX FK FY G GL GU HA HD HG HP HR HS HU HX IG IP IV KA KT KW KY L LA LD LE LL LN LS LU M ME MK ML N NE NG NN NP NR '
    + 'NW OL OX PA PE PH PL PO PR RG RH RM S SA SE SG SK SL SM SN SO SP SR SS ST SW SY TA TD TF TN TQ TR TS TW UB W WA '
    + 'WC WD WF WN WR WS WV YO ZE GY IM JE').split(' ');
  expect(areas).toHaveLength(124);
  const unknown = areas.filter((area) => {
    const postcode = `${area}1 1AA`;
    return !postcodeRegion(postcode) && !postcodeBorderArea(postcode) && !postcodeOutsideArea(postcode);
  });
  expect(unknown).toEqual([]);
});

it('derives the region from the postcode area, and asks it in a border area', () => {
  expect(['MK40 1AA', 'cf10 1aa', 'EH1 1AA', 'BT1 1AA', 'IM1 1AA'].map((postcode) => postcodeRegion(postcode)))
    .toEqual(['England', 'Wales', 'Scotland', 'Northern Ireland', 'Isle of Man']);
  for (const outside of ['GY1 1AA', 'JE2 1AA']) expect(postcodeRegion(outside)).toBeUndefined();
  for (const outside of ['IM1 1AA', 'GY1 1AA', 'JE2 1AA']) expect(postcodeOutsideArea(outside)).toBe(outside.slice(0, 2));
  expect(postcodeBorderArea('CH5 1AA')).toBe('CH');
  expect(postcodeRegion('CH5 1AA')).toBeUndefined();
  expect(postcodeRegion('CH5 1AA', 'Wales')).toBe('Wales');
  expect(postcodeRegion('MK40 1AA', 'Wales')).toBe('England');
  for (const malformed of ['', 'MK40', 'XX1 1AA', 'M1X 1AA1', undefined]) expect(postcodeRegion(malformed)).toBeUndefined();
});

it('offers each construction type the areal heat capacity the converter takes', () => {
  // `heat_capacity_rule` in hemie.rs: each match arm's types and what they take.
  const rust = readFileSync(join(import.meta.dirname, '../../../../../crates/vulcan-model-transform/src/hemie.rs'), 'utf8');
  const body = /fn heat_capacity_rule[^{]*\{([\s\S]*?)\n\}/.exec(rust)![1]!;
  const arms = [...body.matchAll(/((?:\|?\s*"[a-z_]+"\s*)+)=> HeatCapacity::(\w+)(?:\(&(\w+)\))?/g)]
    .map(([, types, rule, table]) => ({ types: [...types!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!), rule, table }));
  expect(arms.length).toBeGreaterThan(2);
  const labels = JSON.parse(/const HEAT_CAPACITY_BANDS: \[&str; \d\] = (\[[^\]]*\])/.exec(rust)![1]!);
  for (const { types, rule, table } of arms) {
    for (const type of types) {
      if (rule === 'Fixed') expect(hemieHeatCapacityBands(type), type).toBeUndefined();
      else {
        expect(rule, type).toBe('Bands');
        const length = Number(new RegExp(`const ${table}: \\[f64; (\\d)\\]`).exec(rust)![1]);
        expect(hemieHeatCapacityBands(type), type).toEqual(labels);
        expect(hemieHeatCapacityBands(type), type).toHaveLength(length);
      }
    }
  }
  // The `_ =>` arm: a number only; party floors and ceilings take no heat capacity.
  for (const type of ['heated_basement_floor', 'heated_pitched_roof', 'window', 'external_door', 'party_or_sheltered_door',
    'park_home_wall', 'park_home_floor', 'park_home_flat_roof', 'park_home_pitched_roof']) {
    expect(arms.some(({ types }) => types.includes(type)), type).toBe(false);
    expect(hemieHeatCapacityBands(type), type).toEqual([]);
  }
  for (const type of ['party_floor', 'party_ceiling', undefined]) expect(hemieHeatCapacityBands(type)).toBeUndefined();
});

it('shows the door and window heat capacity the converter fills as the placeholder', () => {
  const rust = readFileSync(join(import.meta.dirname, '../../../../../crates/vulcan-model-transform/src/hemie.rs'), 'utf8');
  const value = (name: string) => Number(new RegExp(`const ${name}: f64 = ([\\d_.]+);`).exec(rust)![1].replace(/_/g, '')).toLocaleString('en-GB');
  expect(hemieDefaultPlaceholder('external_door', 'areal_heat_capacity')).toBe(`${value('DOOR_HEAT_CAPACITY')} (default)`);
  expect(hemieDefaultPlaceholder('party_or_sheltered_door', 'areal_heat_capacity')).toBe(`${value('DOOR_HEAT_CAPACITY')} (default)`);
  expect(hemieDefaultPlaceholder('window', 'areal_heat_capacity')).toBe(`${value('WINDOW_HEAT_CAPACITY')} (default)`);
  expect(hemieDefaultPlaceholder('window', 'glazing_type')).toBeUndefined();
});

const schema = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../../data/schemas/hem_epc_orchestrator_input.schema.json'), 'utf8')) as {
  $defs: Record<string, { properties?: Record<string, unknown>; enum?: string[] }>;
};
const mapping = (schema.$defs.Geometry!.properties!.constructions as { additionalProperties: { discriminator: { mapping: Record<string, string> } } })
  .additionalProperties.discriminator.mapping;
const fieldsOf = (type: string) => Object.keys(schema.$defs[mapping[type]!.split('/').pop()!]!.properties ?? {});
const DETAILS = new Set(['insulation_type', 'insulation_thermal_conductivity', 'ceiling_thickness', 'ceiling_thermal_conductivity', 'joist_depth',
  'percentage_area_of_timber_joists', 'roof_characteristics', 'rafter_depth', 'percentage_area_of_timber_rafters', 'air_gap_thermal_resistance',
  'internal_finish_thickness', 'internal_finish_thermal_conductivity', 'surface_material', 'finish']);

it('offers every roof, floor and outside surface detail a construction type takes, and no other', () => {
  for (const type of Object.keys(mapping)) {
    const offered = hemieConstructionKeys(type);
    const takes = fieldsOf(type);
    for (const key of offered) expect(takes, `${type} ${key}`).toContain(key);
    for (const key of takes.filter((k) => DETAILS.has(k))) expect(offered, `${type} ${key}`).toContain(key);
  }
});

it('lists each surface material\'s finishes from its schema enum, as HEMIE pairs them', () => {
  for (const type of Object.keys(mapping)) {
    const material = schema.$defs[mapping[type]!.split('/').pop()!]!.properties?.surface_material as { anyOf?: { $ref?: string }[] } | undefined;
    const materials = schema.$defs[material?.anyOf?.[0]?.$ref?.split('/').pop() ?? '']?.enum ?? [];
    expect(hemieOutsideSurface(type)?.includes('material') ?? false, type).toBe(materials.length > 0);
    for (const value of materials) expect(schema.$defs[hemieFinishEnum(type, value) ?? '']?.enum?.length, `${type} ${value}`).toBeGreaterThan(0);
  }
  expect(hemieFinishEnum('external_wall', 'Fibre-cement')).toBe('FibreCementWallFinish');
  expect(hemieFinishEnum('flat_roof', 'Fibre-cement')).toBe('FibreCementRoofFinish');
  expect(hemieFinishEnum('park_home_wall', 'CanExel / Engineered HDF')).toBe('ParkHomeHDFFinish');
  expect(hemieOutsideSurface('above_external_area_floor')).toEqual(['colour', 'coefficient']);
  expect(hemieOutsideSurface('suspended_floor')).toBeUndefined();
});

it('ranks the stated outside surface as HEMIE does', () => {
  expect(statedOutsideSurfaceMethod({}, 'solar_absorption_coeff')).toBeUndefined();
  expect(statedOutsideSurfaceMethod({ colour: 'Dark' }, 'solar_absorption_coeff')).toBe('colour');
  expect(statedOutsideSurfaceMethod({ colour: 'Dark', surface_material: 'Brick' }, 'solar_absorption_coeff')).toBe('material');
  expect(statedOutsideSurfaceMethod({ colour: 'Dark', solar_absorption_coefficient: 0.5 }, 'solar_absorption_coefficient')).toBe('coefficient');
});

it('shows the defaults the schema does not state as placeholders, by type, age band and location', () => {
  // The schema's own defaults (`ConstructionFieldInput` shows them).
  for (const field of ['ceiling_thickness', 'internal_finish_thickness', 'insulation_thermal_conductivity', 'colour', 'roof_characteristics']) {
    expect(hemieDefaultPlaceholder('flat_roof', field), field).toBeUndefined();
  }
  expect(hemieDefaultPlaceholder('flat_roof', 'ceiling_thermal_conductivity')).toBe('Plasterboard (default)');
  expect(hemieDefaultPlaceholder('suspended_floor', 'insulation_type')).toBe('As built (default)');
  expect(hemieDefaultPlaceholder('flat_roof', 'percentage_area_of_timber_joists')).toBe('13 (default)');
  expect(hemieDefaultPlaceholder('external_wall', 'surface_material')).toBeUndefined();
  // Insulation thickness and beam depths by the band's tables.
  const at = (band: string, location?: string) => ({ band, location });
  expect(hemieDefaultPlaceholder('flat_roof', 'insulation_thickness', { location: 'at_joists' })).toBe('By age band (default)');
  expect(hemieDefaultPlaceholder('flat_roof', 'insulation_thickness', at('K', 'at_joists'))).toBe('175 (default)');
  expect(hemieDefaultPlaceholder('flat_roof', 'insulation_thickness', at('K'))).toBe('None (default)');
  expect(hemieDefaultPlaceholder('unheated_pitched_roof', 'insulation_thickness', at('K', 'at_joists'))).toBe('270 (default)');
  expect(hemieDefaultPlaceholder('unheated_pitched_roof', 'insulation_thickness', at('K', 'unknown'))).toBe('270 (default)');
  expect(hemieDefaultPlaceholder('unheated_pitched_roof', 'insulation_thickness', at('K', 'at_rafters'))).toBe('285 (default)');
  expect(hemieDefaultPlaceholder('heated_pitched_roof', 'insulation_thickness', at('L'))).toBe('238 (default)');
  expect(hemieDefaultPlaceholder('suspended_floor', 'insulation_thickness', at('H'))).toBe('0 (default)');
  expect(hemieDefaultPlaceholder('above_external_area_floor', 'insulation_thickness', at('M'))).toBe('140 (default)');
  for (const type of ['mini_flat_roof', 'mini_pitched_roof', 'thatched_roof']) {
    expect(hemieDefaultPlaceholder(type, 'insulation_thickness', at('K', 'at_joists')), type).toBe('None (default)');
  }
  expect(hemieDefaultPlaceholder('unheated_pitched_roof', 'joist_depth')).toBe('By age band (default)');
  expect(hemieDefaultPlaceholder('unheated_pitched_roof', 'joist_depth', at('G'))).toBe('100 (default)');
  expect(hemieDefaultPlaceholder('heated_pitched_roof', 'rafter_depth', at('H'))).toBe('150 (default)');
  expect(hemieFieldLabel('percentage_area_of_timber_joists')).toBe('Timber joist area (%)');
  expect(hemieFieldLabel('insulation_thermal_conductivity')).toBe('Insulation conductivity (W/m·K)');
  expect(hemieValueLabel('insulation_type', 'as built')).toBe('As built');
});

it('shows a roof the beams its insulation location reads', () => {
  const beams = (type: string, location?: string) => hemieDetailFields(type, location).filter((key) => /joist|rafter/.test(key));
  expect(beams('unheated_pitched_roof', 'at_joists')).toEqual(['joist_depth', 'percentage_area_of_timber_joists']);
  expect(beams('unheated_pitched_roof', 'at_joists_and_rafters')).toEqual(['joist_depth', 'percentage_area_of_timber_joists']);
  expect(beams('unheated_pitched_roof', 'unknown')).toEqual(['joist_depth', 'percentage_area_of_timber_joists']);
  expect(beams('mini_pitched_roof', 'at_rafters')).toEqual(['rafter_depth', 'percentage_area_of_timber_rafters']);
  expect(beams('flat_roof', 'above_joists')).toEqual([]);
  expect(beams('flat_roof', 'at_joists')).toEqual(['joist_depth', 'percentage_area_of_timber_joists']);
  expect(beams('unheated_pitched_roof')).toEqual([]);
  expect(beams('heated_pitched_roof')).toEqual(['rafter_depth', 'percentage_area_of_timber_rafters']);
  expect(hemieDetailFields('unheated_pitched_roof', undefined)).toContain('ceiling_thickness');
  expect(hemieHiddenDetails('unheated_pitched_roof', 'at_rafters', { joist_depth: 100, rafter_depth: 150 })).toEqual(['joist_depth']);
});
