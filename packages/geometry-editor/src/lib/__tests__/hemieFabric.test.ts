// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { hemieConstructionType, hemieFabric, hemieFabricGroups, hemieFabricLabel, hemieFieldLabel, hemieLeftoverKeys, hemieValueLabel, postcodeBorderArea, postcodeOutsideArea, postcodeRegion } from '../hemieFabric';

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
