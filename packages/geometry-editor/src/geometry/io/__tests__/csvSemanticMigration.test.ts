// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { assertCsvMigrationResolved, csvMigrationIssues, resolveCsvUValueMeaning, normalizeCsvConstructionProvenance } from '../csvSemanticMigration';
import { createGeometryStore } from '../../../stores/geometryStore';
import { parseCsvToGeometry } from '../parseCsvToGeometry';
import { GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR } from '../../../lib/overrideProvenance';
import type { Element } from '../../types';

const wall = (id = 'p'): Element => ({ id, name: `Party ${id}`, type: 'BuildingElementPartyWall', zoneId: 'z', width: 2, height: 3, area: 6, parent_element: null, coordinates: [], extra_json: { u_value: .25, advanced: 'keep' } });

describe('CSV v3 explicit U-value migration', () => {
  it('does not acknowledge an unchanged or edited legacy number, validation, or a version stamp', () => {
    const element = wall();
    expect(csvMigrationIssues([element])).toHaveLength(1);
    expect(() => assertCsvMigrationResolved([element])).toThrow('CSV_U_VALUE_MEANING_REQUIRED');
    expect(() => assertCsvMigrationResolved([{ ...element, extra_json: { u_value: .3 } }])).toThrow('Party p');
  });
  it('retains authored values and unknown advanced fields after an explicit whole-wall decision', () => {
    const original = wall();
    const resolved = resolveCsvUValueMeaning(original, 'whole_wall');
    expect(resolved.extra_json).toEqual({ u_value: .25, u_value_whole_wall: .25, u_value_interpretation: 'whole_wall', u_value_interpreted_value: .25, advanced: 'keep' });
    expect(original.extra_json).toEqual({ u_value: .25, advanced: 'keep' });
    expect(csvMigrationIssues([resolved])).toEqual([]);
    expect(resolved.extra_json).not.toHaveProperty('thermal_resistance_construction');
  });
  it('does not overwrite an independently supplied whole-wall value during legacy review', () => {
    const original = wall();
    original.extra_json = { ...original.extra_json, u_value_whole_wall: .2 };
    expect(resolveCsvUValueMeaning(original, 'whole_wall').extra_json?.u_value_whole_wall).toBe(.2);
  });
  it('requires renewed review after a legacy number changes, but v3 meaning stays explicit', () => {
    const resolved = resolveCsvUValueMeaning(wall(), 'half_construction');
    const changed = { ...resolved, extra_json: { ...resolved.extra_json, u_value: .3 } };
    expect(csvMigrationIssues([changed], 2)).toHaveLength(1);
    expect(() => assertCsvMigrationResolved([changed], 2)).toThrow('CSV_U_VALUE_MEANING_REQUIRED');
    expect(csvMigrationIssues([changed], 3)).toEqual([]);
    expect(csvMigrationIssues([resolveCsvUValueMeaning(changed, 'half_construction')], 2)).toEqual([]);
  });
  it('keeps previous half-construction U distinct from whole-wall U', () => {
    const resolved = resolveCsvUValueMeaning(wall(), 'half_construction');
    expect(resolved.extra_json).not.toHaveProperty('u_value_whole_wall');
    expect(() => assertCsvMigrationResolved([resolved])).not.toThrow();
  });
  it('uses unchanged assembly evidence automatically but does not trust edited values', () => {
    const element = wall();
    element.extra_json = { ...element.extra_json, thermal_resistance_construction: 2, vulcan_assembly_v1: {
      schemaVersion: 1, correctedU_W_m2K: .25, thermalResistanceConstruction_m2K_W: 2,
      assemblySnapshot: { elementMode: 'BuildingElementPartyWall' },
    } };
    const [derived] = normalizeCsvConstructionProvenance([element]);
    expect(derived.extra_json?.construction_basis).toBe('half');
    expect(csvMigrationIssues([derived], 2)).toEqual([]);
    const editedAfterImport = { ...derived, extra_json: { ...derived.extra_json, u_value: .3 } };
    expect(csvMigrationIssues([editedAfterImport], 2)).toHaveLength(1);
    const [edited] = normalizeCsvConstructionProvenance([{ ...element, extra_json: { ...element.extra_json, u_value: .3 } }]);
    expect(csvMigrationIssues([edited])).toHaveLength(1);
  });
  it('exports computed internal area basis and preserves it on reopen', () => {
    const store = createGeometryStore();
    const partition: Element = { ...wall(), type: 'BuildingElementAdjacentConditionedSpace', coordinates: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }], extra_json: { thermal_resistance_construction: 2, construction_basis: 'full' } };
    store.setState({ zones: [{ id: 'z', name: 'Living', floorArea: 10, height: 3 }], elementsById: { p: partition }, elementIds: ['p'] });
    const csv = store.getState().generateCSV();
    expect(csv).toContain('both_faces');
    const reopened = createGeometryStore();
    reopened.getState().loadFromCSV(csv);
    const again = reopened.getState().generateCSV();
    expect(again).toContain('both_faces');
    expect(Object.values(reopened.getState().elementsById)[0].extra_json?.construction_basis).toBe('full');
  });
  it('shows interpretation validation only for an upgrade or the current format', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const element = wall();
    store.setState({ sourceCsvVersion: 2, elementsById: { p: element }, elementIds: ['p'] });
    const hasMigrationIssue = () => JSON.stringify(store.getState().validateElement(element)).includes('CSV_U_VALUE_MEANING_REQUIRED');
    expect(hasMigrationIssue()).toBe(false);
    store.getState().requestCsvUpgrade();
    expect(hasMigrationIssue()).toBe(true);
    store.setState({ sourceCsvVersion: 3, csvUpgradeRequested: false });
    expect(hasMigrationIssue()).toBe(true);
  });
  it('blocks export until explicitly resolved, then saves incomplete input and reopens once', () => {
    const store = createGeometryStore();
    store.setState({ sourceCsvVersion: 2, zones: [{ id: 'z', name: 'Living', floorArea: 10, height: 3 }], elementsById: { p: wall(), q: wall('q') }, elementIds: ['p', 'q'] });
    expect(store.getState().generateCSV()).toContain('VulcanCsvVersion,2');
    store.getState().requestCsvUpgrade();
    expect(() => store.getState().generateCSV()).toThrow('CSV_U_VALUE_MEANING_REQUIRED');
    expect(store.getState().generateCSV({ allowUnresolvedMigration: true })).toContain('VulcanCsvVersion,2');
    store.getState().resolveCsvUValueInterpretation(['p'], 'whole_wall');
    expect(store.getState().getCsvMigrationIssues()).toHaveLength(1);
    store.getState().resolveCsvUValueInterpretation(['q'], 'half_construction');
    store.getState().setTargetBundleId('test:immutable-pin');
    const csv = store.getState().generateCSV();
    expect(csv).toContain('VulcanCsvVersion,3');
    const reopened = createGeometryStore();
    reopened.getState().loadFromCSV(csv);
    expect(reopened.getState().getCsvMigrationIssues()).toEqual([]);
    expect(reopened.getState().targetBundleId).toBe('test:immutable-pin');
    expect(reopened.getState().generateCSV()).toContain('u_value_whole_wall');
  });
  it('keeps ProvenanceMarkers independent from a missing format marker through an explicit upgrade', () => {
    const original = `Metadata
ProvenanceMarkers,3

Zone
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,100,40,2.5,FALSE

Ground Elements
Name,Zone,Type,area,total_area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,base_height,parent_element,coords,extra_json
Manual ground,Living,BuildingElementGround,20,45,5,4,18,Slab_no_edge_insulation,,,,,,"{""_ground_total_area_manual"":true}"

Non-Exposed Elements
Name,Zone,Type,area,pitch,width,height,parent_element,coords,extra_json
Party,Living,BuildingElementPartyWall,6,90,2,3,,,"{""u_value"":0.25}"
`;
    const parsed = parseCsvToGeometry(original);
    expect(parsed.metadata.provenanceMarkersVersion).toBe(3);
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().loadFromCSV(original);
    const state = store.getState();
    expect(state.sourceCsvVersion).toBe(1);
    const ground = Object.values(state.elementsById).find(element => element.name === 'Manual ground')!;
    const party = Object.values(state.elementsById).find(element => element.name === 'Party')!;
    expect(ground.total_area).toBe(45);
    expect(ground[GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag]).toBe(true);
    expect(state.getCsvMigrationIssues()).toHaveLength(1);
    expect(state.generateCSV()).toContain('VulcanCsvVersion,1');
    state.requestCsvUpgrade();
    expect(() => state.generateCSV()).toThrow('CSV_U_VALUE_MEANING_REQUIRED');
    state.resolveCsvUValueInterpretation([party.id], 'half_construction');
    const upgraded = store.getState().generateCSV();
    expect(upgraded).toContain('VulcanCsvVersion,3');
    expect(upgraded).not.toContain('ProvenanceMarkers,');
    const reopened = createGeometryStore({ defaultDefaultsPath: null });
    reopened.getState().loadFromCSV(upgraded);
    const reopenedGround = Object.values(reopened.getState().elementsById).find(element => element.name === 'Manual ground')!;
    expect(reopenedGround.total_area).toBe(45);
    expect(reopenedGround[GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag]).toBe(true);
    expect(reopened.getState().getCsvMigrationIssues()).toEqual([]);
    expect(original).not.toContain('VulcanCsvVersion');
  });

  it.each([
    { format: 3, legacy: undefined, authoritative: true },
    { format: 3, legacy: 1, authoritative: true },
    { format: 3, legacy: 99, authoritative: true },
    { format: 2, legacy: undefined, authoritative: false },
    { format: 2, legacy: 1, authoritative: false },
    { format: 2, legacy: 2, authoritative: true },
    { format: undefined, legacy: 3, authoritative: true },
    { format: undefined, legacy: undefined, authoritative: false },
  ])('resolves absent override markers using format $format and legacy row $legacy', ({ format, legacy, authoritative }) => {
    const metadata = ['Metadata', ...(format === undefined ? [] : [`VulcanCsvVersion,${format}`]), ...(legacy === undefined ? [] : [`ProvenanceMarkers,${legacy}`])].join('\n');
    const parsed = parseCsvToGeometry(`${metadata}

Zone
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,100,40,2.5,FALSE

Ground Elements
Name,Zone,Type,area,total_area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,base_height,parent_element,coords,extra_json
Ground,Living,BuildingElementGround,20,45,5,4,18,Slab_no_edge_insulation,,,,,,{}

Window Elements
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,linked_wall,frame_area_fraction,free_area_height,mid_height,max_window_open_area,coords,extra_json
Window,Living,BuildingElementTransparent,2,90,1,2,0,1,,0.25,1,2,0.6,,"{""security_risk"":true}"
`);
    expect(parsed.metadata.legacyProvenanceMarkersVersion).toBe(legacy);
    const ground = parsed.elements.find(element => element.name === 'Ground')!;
    expect(ground[GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag]).toBe(!authoritative);
    expect(ground.total_area).toBe(authoritative ? 20 : 45);
    // v3 without a row also carries authoritative absence for zone override flags.
    if (format === 3) expect(parsed.zones[0]._floorAreaUserOverride).toBe(false);
    const window = parsed.elements.find(element => element.name === 'Window')!;
    expect(window._windowSecurityRiskUserOverride).toBe(format === 3 || (legacy ?? 0) >= 3 ? false : undefined);
  });

  it('does not use an old provenance row to accept an unknown CSV format', () => {
    expect(() => parseCsvToGeometry('Metadata\nVulcanCsvVersion,4\nProvenanceMarkers,3\n')).toThrow('Unsupported VulcanCsvVersion: 4');
  });

  it.each([
    { format: undefined, legacy: undefined },
    { format: 1, legacy: undefined },
    { format: 2, legacy: undefined },
    { format: 2, legacy: 1 },
    { format: 2, legacy: 2 },
    { format: 2, legacy: 3 },
    { format: 2, legacy: 99 },
  ])('ordinary legacy Save preserves format $format, provenance row $legacy and authored override flags', ({ format, legacy }) => {
    const metadata = ['Metadata', ...(format === undefined ? [] : [`VulcanCsvVersion,${format}`]), ...(legacy === undefined ? [] : [`ProvenanceMarkers,${legacy}`])].join('\n');
    const original = `${metadata}

Zone
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,100,40,2.5,FALSE

Ground Elements
Name,Zone,Type,area,total_area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,base_height,parent_element,coords,extra_json
Automatic,Living,BuildingElementGround,20,,5,4,18,Slab_no_edge_insulation,,,,,,{}
Manual,Living,BuildingElementGround,20,45,5,4,18,Slab_no_edge_insulation,,,,,,"{""_ground_total_area_manual"":true}"

Non-Exposed Elements
Name,Zone,Type,area,pitch,width,height,parent_element,coords,extra_json
Party,Living,BuildingElementPartyWall,6,90,2,3,,,"{""u_value"":0.25}"
`;
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().loadFromCSV(original);
    expect(store.getState().getCsvMigrationIssues()).toHaveLength(1);
    const ordinarySave = store.getState().generateCSV();
    expect(ordinarySave).toContain(`VulcanCsvVersion,${format ?? 1}`);
    const provenanceRow = ordinarySave.split('\n').find(line => line.startsWith('ProvenanceMarkers,'));
    expect(provenanceRow?.split(',')[1]).toBe(legacy === undefined ? undefined : String(legacy));
    const reopened = createGeometryStore({ defaultDefaultsPath: null });
    reopened.getState().loadFromCSV(ordinarySave);
    expect(reopened.getState().sourceCsvVersion).toBe(format ?? 1);
    expect(reopened.getState().getCsvMigrationIssues()).toHaveLength(1);
    for (const name of ['Automatic', 'Manual']) {
      const before = Object.values(store.getState().elementsById).find(element => element.name === name)!;
      const after = Object.values(reopened.getState().elementsById).find(element => element.name === name)!;
      expect(after[GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag]).toBe(name === 'Manual');
      expect(after.total_area).toBe(before.total_area);
    }
    expect(reopened.getState().generateCSV()).not.toContain('u_value_interpretation');
  });

  it('invalidates target readiness on A/B/A changes without rewriting authored state', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const elementsById = { p: wall() };
    store.setState({ targetBundleId: 'A', elementsById, elementIds: ['p'], lastSavedCsv: 'historic saved source', complianceSettings: { ...store.getState().complianceSettings, scenariosBaseModelEnabled: true } });
    store.getState().setCSVValidation('model.csv', [], [], { is_valid: true, errors: [] });
    const readyA = store.getState();
    store.getState().setTargetBundleId('A');
    expect(store.getState()).toBe(readyA);
    store.getState().setTargetBundleId('B');
    expect(store.getState().csvValidationCache).toEqual({});
    expect(store.getState().complianceSettings.scenariosBaseModelEnabled).toBe(false);
    expect(store.getState().elementsById).toBe(elementsById);
    expect(store.getState().lastSavedCsv).toBe('historic saved source');
    store.getState().setCSVValidation('model.csv', [], [], { is_valid: true, errors: [] });
    store.setState({ complianceSettings: { ...store.getState().complianceSettings, scenariosBaseModelEnabled: true } });
    store.getState().setTargetBundleId('A');
    expect(store.getState().csvValidationCache).toEqual({});
    expect(store.getState().complianceSettings.scenariosBaseModelEnabled).toBe(false);
    expect(store.getState().elementsById).toBe(elementsById);
  });

});
