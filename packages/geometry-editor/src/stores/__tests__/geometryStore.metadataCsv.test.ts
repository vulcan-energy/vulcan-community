// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';

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
  const capacity = (numeric: boolean) => {
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      arealHeatCapacityForTarget: (id) => (numeric && id === 'epc-target' ? { classes: 'full_depth', numberTypes: 'all' } : undefined),
    });
    store.getState().loadFromCSV(csv);
    const saved = store.getState().generateCSV({ allowUnresolvedMigration: true });
    store.getState().loadFromCSV(saved);
    const door = Object.values(store.getState().elementsById).find((e) => e.name === 'Door');
    return (door?.extra_json as Record<string, unknown> | undefined)?.areal_heat_capacity ?? (door as unknown as Record<string, unknown>)?.areal_heat_capacity;
  };
  expect(capacity(true)).toBe(20000);
  // An FHS target reads bands only, so the load snaps to the nearest one.
  expect(capacity(false)).toBe('Very light');
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
  const load = (target: string) => {
    const store = createGeometryStore({
      defaultDefaultsPath: null,
      arealHeatCapacityForTarget: (id) => (id === 'a9' ? a9 : id === 'epc' ? { classes: 'full_depth', numberTypes: 'all' } : undefined),
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
