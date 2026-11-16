// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';
import { A7_AREAL_HEAT_CAPACITY_INPUT, type ArealHeatCapacityInput } from '../../../../geometry-editor-host/src/schemaPort';

it('never writes a model-input metadata row with a blank value', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().setComplianceSettings({ GroundFloorArea: '', Ventilation_altitude: null, built_form: '' } as never);
  const csv = store.getState().generateCSV({ allowUnresolvedMigration: true });
  expect(csv).not.toMatch(/^(GroundFloorArea|Ventilation_altitude|General_built_form),(null)?,/m);
});

it('reads the pin from the Metadata rows only, and identical repeats are not a conflict', () => {
  const id = 'python-fhs-a9-918addad-b9b90138-v1';
  const pinOf = (csv: string) => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().loadFromCSV(csv);
    return store.getState().targetBundleId;
  };
  expect(pinOf(`Metadata,,\nTargetBundleId,${id},\nTargetBundleId,${id},\n`)).toBe(id);
  expect(pinOf('Metadata,,\nVulcanCsvVersion,3\n\nZone,,\nName,Type,volume,floor_area,height,simplified thermal bridging\nZone 1,Zone,10,4,2.5,FALSE\n\nLighting,,\nName,Zone,efficacy,count,power,base_height,coords,extra_json\nTargetBundleId,Zone 1,,,,,,\n')).toBeUndefined();
  expect(() => pinOf(`Metadata,,\nTargetBundleId,${id},\nTargetBundleId,other,\n`)).toThrow('conflicting TargetBundleId');
});

it('keeps the product settings rows as typed through load and save', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV('Metadata,,\nProduct_radiator,650047,\nProduct_radiator_length,Large,\nProduct_ufh,,\n');
  expect(store.getState().complianceSettings.productSettings).toEqual({ Product_radiator: '650047', Product_radiator_length: 'Large', Product_ufh: '' });
  const csv = store.getState().generateCSV({ allowUnresolvedMigration: true });
  expect(csv).toMatch(/^Product_radiator,650047,/m);
  expect(csv).toMatch(/^Product_radiator_length,Large,/m);
  expect(csv).toMatch(/^Product_ufh,,/m);
});

it('drops a retired HEMIE_ row on load and says what to do instead', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const { warnings } = store.getState().loadFromCSV('Metadata,,\nHEMIE_age_band,D\nHEMIE_region,England\n');
  expect(store.getState().complianceSettings.hemieSettings).toEqual({ HEMIE_age_band: 'D' });
  expect(warnings).toContain('The region setting was removed: it now comes from the postcode. For a postcode area that spans two nations, choose the Nation next to the Postcode in Global Settings.');
  expect(store.getState().generateCSV({ allowUnresolvedMigration: true })).not.toMatch(/^HEMIE_region,/m);
});

it('keeps a numeric areal heat capacity through save and reload on a target that takes numbers', () => {
  const csv = `Metadata,,
TargetBundleId,epc-target

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Exposed Elements,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
Door,Living,BuildingElementOpaque,2,90,1,2,180,0,FALSE,TRUE,,"0,0,0|1,0,0","{""areal_heat_capacity"":20000}"
`;
  const capacity = (input: ArealHeatCapacityInput | undefined) => {
    const store = createGeometryStore({ defaultDefaultsPath: null, arealHeatCapacityForPin: (id) => (id === 'epc-target' ? input : undefined) });
    const { warnings } = store.getState().loadFromCSV(csv);
    // A pin the host cannot resolve keeps the value and says so.
    expect(warnings.some((w) => w.includes('does not know the target this file pins (epc-target)'))).toBe(!input);
    const saved = store.getState().generateCSV({ allowUnresolvedMigration: true });
    store.getState().loadFromCSV(saved);
    const door = Object.values(store.getState().elementsById).find((e) => e.name === 'Door');
    return (door?.extra_json as Record<string, unknown> | undefined)?.areal_heat_capacity ?? (door as unknown as Record<string, unknown>)?.areal_heat_capacity;
  };
  expect(capacity({ classes: 'full_depth', numberTypes: 'all' })).toBe(20000);
  // A target that reads classes only: the nearest class on its scale.
  expect(capacity(A7_AREAL_HEAT_CAPACITY_INPUT)).toBe('Very light');
  expect(capacity(undefined)).toBe(20000);
});

it('re-derives the class an applied assembly wrote for the target, and keeps a user\'s class', () => {
  // A 303 kJ/(m²·K) cavity wall snapped on the a7 scale (Very heavy, 250 kJ), a partition whose
  // halved layer sum was snapped the same way, and a wall whose class the user chose.
  const envelope = (layerSum: number, written: number) =>
    `""vulcan_assembly_v1"":{""schemaVersion"":1,""assemblyId"":""a"",""arealHeatCapacity_J_m2K"":${layerSum},""arealHeatCapacityWrittenToElement_J_m2K"":${written}}`;
  const csv = (target: string) => `Metadata,,
TargetBundleId,${target}

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Exposed Elements,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
Cavity,Living,BuildingElementOpaque,10,90,4,2.5,180,0,FALSE,FALSE,,"0,0,0|4,0,0","{""areal_heat_capacity"":""Very heavy"",${envelope(303000, 250000)}}"
Chosen,Living,BuildingElementOpaque,10,90,4,2.5,0,0,FALSE,FALSE,,"0,4,0|4,4,0","{""areal_heat_capacity"":""Very heavy""}"
Partition,Living,BuildingElementAdjacentConditionedSpace,10,90,4,2.5,90,0,FALSE,FALSE,,"0,0,0|0,4,0","{""areal_heat_capacity"":""Light"",${envelope(85000, 75000)}}"
`;
  const a9 = { classes: 'full_depth', numberTypes: ['BuildingElementAdjacentConditionedSpace'] } as const;
  const targets: Record<string, ArealHeatCapacityInput> = { a7: A7_AREAL_HEAT_CAPACITY_INPUT, a9, epc: { classes: 'full_depth', numberTypes: 'all' } };
  const load = (target: string) => {
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      arealHeatCapacityForPin: (id) => targets[id],
    });
    store.getState().loadFromCSV(csv(target));
    // Save and load again: the derived values are stable.
    store.getState().loadFromCSV(store.getState().generateCSV({ allowUnresolvedMigration: true }));
    const extra = (name: string) => Object.values(store.getState().elementsById).find((e) => e.name === name)!.extra_json as Record<string, any>;
    return { cavity: extra('Cavity'), chosen: extra('Chosen'), partition: extra('Partition') };
  };
  const a7 = load('a7');
  expect(a7.cavity.areal_heat_capacity).toBe('Very heavy');
  expect(a7.cavity.vulcan_assembly_v1.arealHeatCapacityWrittenToElement_J_m2K).toBe(250000);
  expect(a7.partition.areal_heat_capacity).toBe('Light');
  const onA9 = load('a9');
  expect(onA9.cavity.areal_heat_capacity).toBe('Very light');
  expect(onA9.cavity.vulcan_assembly_v1.arealHeatCapacityWrittenToElement_J_m2K).toBe(240000);
  // a9 takes a number on a partition: the half layer sum, which the converter doubles.
  expect(onA9.partition.areal_heat_capacity).toBe(85000);
  expect(onA9.partition.vulcan_assembly_v1.arealHeatCapacityWrittenToElement_J_m2K).toBe(85000);
  expect(onA9.chosen.areal_heat_capacity).toBe('Very heavy');
  // HEM:EPC takes a number on every element.
  const onEpc = load('epc');
  expect(onEpc.cavity.areal_heat_capacity).toBe(303000);
  expect(onEpc.partition.areal_heat_capacity).toBe(85000);
  expect(onEpc.chosen.areal_heat_capacity).toBe('Very heavy');

  // Changing the target in the session re-derives them the same way: a7 → a9 → a7.
  const store = createGeometryStore({ defaultDefaultsPath: null, arealHeatCapacityForPin: (id) => targets[id] });
  store.getState().loadFromCSV(csv('a7'));
  const extra = (name: string) => Object.values(store.getState().elementsById).find((e) => e.name === name)!.extra_json as Record<string, any>;
  store.getState().setTargetBundleId('a9');
  expect([extra('Cavity').areal_heat_capacity, extra('Partition').areal_heat_capacity, extra('Chosen').areal_heat_capacity]).toEqual(['Very light', 85000, 'Very heavy']);
  store.getState().setTargetBundleId('a7');
  expect([extra('Cavity').areal_heat_capacity, extra('Partition').areal_heat_capacity, extra('Chosen').areal_heat_capacity]).toEqual(['Very heavy', 'Light', 'Very heavy']);
  expect(extra('Partition').vulcan_assembly_v1.arealHeatCapacityWrittenToElement_J_m2K).toBe(75000);
});

it('keeps an existing wall\'s build-up through save and load: the converter sends it as layers', () => {
  const envelope = {
    schemaVersion: 1, assemblyId: 'calculator:layered', appliedAt: '2026-11-16T00:00:00Z',
    assemblySnapshot: { elementMode: 'BuildingElementOpaque', pitchDegrees: 90, layers: [
      { kind: 'solid', materialId: 'brick', thickness_m: 0.1025 },
      { kind: 'cavity', ventilation: 'unventilated', gap_thickness_m: 0.05 },
      { kind: 'solid', materialId: 'pir', thickness_m: 0.1 },
    ] },
    correctedU_W_m2K: 0.2, uValueWrittenToElement_W_m2K: 0.2, thermalResistanceConstruction_m2K_W: 4.83, arealHeatCapacity_J_m2K: 190000,
  };
  const extra = JSON.stringify({ u_value: 0.2, vulcan_assembly_v1: envelope }).replace(/"/g, '""');
  const csv = `Metadata,,
IsExistingBuilding,TRUE

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Exposed Elements,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
Front,Living,BuildingElementOpaque,10,90,4,2.5,180,0,FALSE,FALSE,,"0,0,0|4,0,0","${extra}"
`;
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv);
  store.getState().loadFromCSV(store.getState().generateCSV({ allowUnresolvedMigration: true }));
  const front = Object.values(store.getState().elementsById).find((e) => e.name === 'Front')!;
  expect((front.extra_json as Record<string, unknown>).vulcan_assembly_v1).toEqual(envelope);
});

it('keeps the HEMIE_ model settings as typed through load and save', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV('Metadata,,\nHEMIE_age_band,D\nHEMIE_construction_external_wall,"{""wall_construction_type"":""cavity""}"\n');
  expect(store.getState().complianceSettings.hemieSettings).toEqual({
    HEMIE_age_band: 'D',
    HEMIE_construction_external_wall: '{"wall_construction_type":"cavity"}',
  });
  const csv = store.getState().generateCSV({ allowUnresolvedMigration: true });
  expect(csv).toMatch(/^HEMIE_age_band,D,/m);
  expect(csv).toMatch(/^HEMIE_construction_external_wall,"\{""wall_construction_type"":""cavity""\}",/m);
});

it('keeps roof, floor and outside surface details through save and load, on the setting row and the element', () => {
  const row = '{""joist_depth"":100,""roof_characteristics"":""Lined with boards and felt"",""surface_material"":""Slate"",""finish"":""Dense, dark slate""}';
  const own = '{""insulation_type"":""retrofitted"",""insulation_thermal_conductivity"":0.022,""surface_material"":""Fibre-cement"",""finish"":""Wall finishes"",""ceiling_thickness"":12.5}';
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(`Metadata,,
IsExistingBuilding,TRUE
HEMIE_construction_unheated_pitched_roof,"${row}"

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Exposed Elements,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
Wall,Living,BuildingElementOpaque,10,90,4,2.5,180,0,FALSE,FALSE,,"0,0,0|4,0,0","${own}"
`);
  const state = () => ({
    row: JSON.parse(store.getState().complianceSettings.hemieSettings!.HEMIE_construction_unheated_pitched_roof!),
    own: Object.values(store.getState().elementsById).find((e) => e.type === 'BuildingElementOpaque')!.extra_json,
  });
  const before = state();
  expect(before.row).toEqual({ joist_depth: 100, roof_characteristics: 'Lined with boards and felt', surface_material: 'Slate', finish: 'Dense, dark slate' });
  expect(before.own).toMatchObject({ insulation_type: 'retrofitted', insulation_thermal_conductivity: 0.022, surface_material: 'Fibre-cement', finish: 'Wall finishes', ceiling_thickness: 12.5 });
  store.getState().loadFromCSV(store.getState().generateCSV({ allowUnresolvedMigration: true }));
  expect(state()).toEqual(before);
});
