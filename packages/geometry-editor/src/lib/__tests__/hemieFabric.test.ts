// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { hemieConstructionType, hemieFabric, hemieHeatCapacityBands, hemieFabricGroups, hemieFabricLabel, hemieFieldLabel, hemieLeftoverKeys, hemieValueLabel, postcodeBorderArea, postcodeOutsideArea, postcodeRegion } from '../hemieFabric';

const line = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }];
const plane = [...line, { x: 4, y: 4, z: 0 }];
const el = (fields: Record<string, unknown>) => ({ id: 'e', name: 'E', zoneId: 'z', coordinates: line, ...fields }) as unknown as Element;
const settings = { HEMIE_age_band: 'D', HEMIE_construction_external_wall: '{"wall_construction_type":"cavity"}' };

it('maps elements to the construction type the converter gives them', () => {
  expect(hemieConstructionType(el({ type: 'BuildingElementOpaque', pitch: 90 }))).toBe('external_wall');
  expect(hemieConstructionType(el({ type: 'BuildingElementOpaque', is_external_door: true }))).toBe('external_door');
  expect(hemieConstructionType(el({ type: 'BuildingElementOpaque', coordinates: plane, pitch: 0 }))).toBe('flat_roof');
  expect(hemieConstructionType(el({ type: 'BuildingElementOpaque', coordinates: plane, pitch: 35, is_unheated_pitched_roof: true }))).toBe('unheated_pitched_roof');
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
  expect(hemieFabricLabel(hemieFabric(wall, settings)!)).toBe('External wall · Band D · Cavity');
  const extension = el({ name: 'X', type: 'BuildingElementOpaque', pitch: 90, extra_json: { age_band: 'K', wall_construction_type: 'timber frame' } });
  expect(hemieFabricLabel(hemieFabric(extension, settings)!)).toBe('External wall · Band K · Timber frame');
  expect(hemieFabricLabel(hemieFabric(el({ type: 'BuildingElementOpaque', pitch: 90, u_value: 0.3 }), settings)!)).toBe('External wall · Entered U-value');
  expect(hemieFabric(el({ type: 'Appliance' }), settings)).toBeUndefined();
  const window = el({ type: 'BuildingElementTransparent', parent_element: 'X' });
  expect(hemieFabric(window, settings, [extension])).toMatchObject({ band: 'K', hostBand: 'K' });
  expect(hemieFabric(window, settings, [wall])).toMatchObject({ band: 'D', hostBand: undefined });
});

it('labels fields and values for people, with units', () => {
  expect(hemieFieldLabel('glazing_gap')).toBe('Glazing gap (mm)');
  expect(hemieFieldLabel('areal_heat_capacity')).toBe('Areal heat capacity (J/m²·K)');
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

it('groups elements by fabric, largest group first', () => {
  const groups = hemieFabricGroups([
    el({ id: 'a', type: 'BuildingElementOpaque', pitch: 90 }),
    el({ id: 'b', type: 'BuildingElementOpaque', pitch: 90 }),
    el({ id: 'c', type: 'BuildingElementOpaque', pitch: 90, extra_json: { age_band: 'K' } }),
    el({ id: 'd', type: 'Appliance' }),
  ], settings);
  expect(groups.map(({ label, ids }) => [label, ids])).toEqual([['External wall · Band D · Cavity', ['a', 'b']], ['External wall · Band K · Cavity', ['c']]]);
  expect(groups[0]!.color).not.toBe(groups[1]!.color);
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
  expect(['MK40 1AA', 'cf10 1aa', 'EH1 1AA', 'BT1 1AA'].map((postcode) => postcodeRegion(postcode)))
    .toEqual(['England', 'Wales', 'Scotland', 'Northern Ireland']);
  for (const outside of ['IM1 1AA', 'GY1 1AA', 'JE2 1AA']) {
    expect(postcodeRegion(outside)).toBeUndefined();
    expect(postcodeOutsideArea(outside)).toBe(outside.slice(0, 2));
  }
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
  for (const type of ['heated_basement_floor', 'heated_pitched_roof', 'window', 'external_door', 'party_or_sheltered_door']) {
    expect(arms.some(({ types }) => types.includes(type)), type).toBe(false);
    expect(hemieHeatCapacityBands(type), type).toEqual([]);
  }
  for (const type of ['party_floor', 'party_ceiling', 'park_home_wall', undefined]) expect(hemieHeatCapacityBands(type)).toBeUndefined();
});
