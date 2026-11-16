// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { parseCsvToGeometry } from '../parseCsvToGeometry';
import { createGeometryStore } from '../../../stores/geometryStore';
import type { Element, Zone } from '../../types';

describe('parseCsvToGeometry — miscellaneous section handling', () => {
  const windowCsv = (referenceRow: string, midHeight: number, partMidHeight: number) => `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,
${referenceRow}
Ventilation_ventilation_zone_base_height,2.4,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Window Elements,,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,linked_wall,frame_area_fraction,free_area_height,mid_height,max_window_open_area,coords,extra_json
Window 1,Living,BuildingElementTransparent,1.2,90,1,1.2,0,3.2,,0.1,0.4,${midHeight},0.4,"0.000,0.000,1.000|1.000,0.000,1.000","{""window_part_list"":[{""mid_height_air_flow_path"":${partMidHeight}}]}"
`.trim();

  it('treats unversioned Vulcan CSVs as version 1 with legacy ground-relative window mid-heights', () => {
    const parsed = parseCsvToGeometry(windowCsv('', 3.8, 3.8));
    const window = parsed.elements.find((element) => element.type === 'BuildingElementTransparent');

    expect(window?.mid_height).toBe(3.8);
    expect((window?.extra_json as any).window_part_list).toEqual([{ mid_height_air_flow_path: 3.8 }]);
    expect(parsed.metadata.vulcanCsvVersion).toBe(1);
  });

  it('keeps stored numbers exact through save and load', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,
VulcanCsvVersion,3,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Exposed Elements,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
South Wall,Living,BuildingElementOpaque,9.6,90,4,2.4,180,0,FALSE,FALSE,,"0,0,0|4,0,0","{}"

Window Elements,,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,linked_wall,frame_area_fraction,free_area_height,mid_height,max_window_open_area,coords,extra_json
Window 1,Living,BuildingElementTransparent,1.6125,90,1.25,1.29,180,0.905,South Wall,0.125,0.645,1.234,1.782,"1.000,0.000,0.905|2.250,0.000,0.905","{}"

Thermal Bridging Elements,,,,,,,,,
Name,Zone,Type,heat_transfer_coeff,length,linear_thermal_transmittance,parent_element,coords,extra_json
Corner,Living,ThermalBridgeLinear,,8.345,0.045,,,"{}"
Point,Living,ThermalBridgePoint,0.004,,,,,"{}"

On-Site Generation,,,,,,,,,,
Name,Type,generation_type,pitch,orientation360,base_height,peak_power,width,height,coords,extra_json
PV 1,OnSiteGeneration,PhotovoltaicSystem,35,180,0,3.375,1.6125,1.0125,,"{}"
`.trim();
    const store = createGeometryStore();
    store.getState().loadFromCSV(csv);
    const reopened = createGeometryStore();
    reopened.getState().loadFromCSV(store.getState().generateCSV());
    const byName = (name: string) => Object.values(reopened.getState().elementsById).find((element) => element.name === name) as any;

    expect(byName('Window 1')).toMatchObject({
      base_height: 0.905, frame_area_fraction: 0.125, free_area_height: 0.645, mid_height: 1.234, max_window_open_area: 1.782,
    });
    expect(byName('Corner')).toMatchObject({ length: 8.345, linear_thermal_transmittance: 0.045 });
    expect(byName('Point')).toMatchObject({ heat_transfer_coeff: 0.004 });
    expect(byName('PV 1')).toMatchObject({ peak_power: 3.375, width: 1.6125, height: 1.0125 });
  });

  it('hydrates version-2 ventilation-zone-relative window mid-heights into editor coordinates', () => {
    const parsed = parseCsvToGeometry(windowCsv('VulcanCsvVersion,2,,,,,,,,,,,,,', 1.4, 1.4));
    const window = parsed.elements.find((element) => element.type === 'BuildingElementTransparent');

    expect(window?.mid_height).toBe(3.8);
    expect((window?.extra_json as any).window_part_list).toEqual([{ mid_height_air_flow_path: 3.8 }]);
    expect(parsed.metadata.vulcanCsvVersion).toBe(2);
  });

  it('preserves v1 window coordinates on ordinary save and during an unresolved upgrade', () => {
    const csv = windowCsv('TargetBundleId,unknown-source', 3.8, 3.8) + `

Non-Exposed Elements
Name,Zone,Type,area,pitch,width,height,parent_element,extra_json
Party,Living,BuildingElementPartyWall,6,90,2,3,,"{""u_value"":0.25}"
`;
    const store = createGeometryStore();
    store.getState().loadFromCSV(csv);
    const ordinarySave = store.getState().generateCSV();
    expect(ordinarySave).toContain('VulcanCsvVersion,1');
    expect(ordinarySave).toContain('mid_height_air_flow_path"":3.8');
    store.getState().requestCsvUpgrade();
    expect(() => store.getState().generateCSV()).toThrow('CSV_U_VALUE_MEANING_REQUIRED');
    const draft = store.getState().generateCSV({ allowUnresolvedMigration: true });
    expect(draft).toContain('VulcanCsvVersion,1');
    const reopened = createGeometryStore();
    reopened.getState().loadFromCSV(draft);
    const window = Object.values(reopened.getState().elementsById).find(element => element.type === 'BuildingElementTransparent');
    expect(window?.mid_height).toBe(3.8);
    expect(reopened.getState().getCsvMigrationIssues()).toHaveLength(1);
    const party = Object.values(store.getState().elementsById).find(element => element.type === 'BuildingElementPartyWall')!;
    store.getState().resolveCsvUValueInterpretation([party.id], 'whole_wall');
    expect(store.getState().generateCSV({ allowUnresolvedMigration: true })).toContain('VulcanCsvVersion,1');
    const upgraded = store.getState().generateCSV();
    expect(upgraded).toContain('VulcanCsvVersion,4');
    const upgradedWindow = parseCsvToGeometry(upgraded).elements.find(element => element.type === 'BuildingElementTransparent')!;
    expect(upgradedWindow.mid_height).toBe(3.8);
    expect(upgradedWindow.extra_json?.window_part_list).toEqual([{ mid_height_air_flow_path: 3.8 }]);
  });

  it('rejects unsupported future Vulcan CSV versions instead of guessing', () => {
    expect(() => parseCsvToGeometry(windowCsv('VulcanCsvVersion,5,,,,,,,,,,,,,', 1.4, 1.4)))
      .toThrow('Unsupported VulcanCsvVersion: 5');
  });

  it.each(['', '2.5', 'not-a-version'])(
    'rejects malformed Vulcan CSV version %j instead of treating it as legacy',
    (version) => {
      expect(() => parseCsvToGeometry(windowCsv(`VulcanCsvVersion,${version},,,,,,,,,,,,,`, 1.4, 1.4)))
        .toThrow('Invalid VulcanCsvVersion');
    },
  );

  it('exports HEM-relative window and window-part mid-heights as idempotent current-version CSV', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const zone = { id: 'zone-1', name: 'Living', type: 'Zone' } as Zone;
    const window = {
      id: 'window-1',
      name: 'Window 1',
      type: 'BuildingElementTransparent',
      zoneId: zone.id,
      width: 1,
      height: 1.2,
      area: 1.2,
      base_height: 3.2,
      mid_height: 3.8,
      coordinates: [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }],
      extra_json: { window_part_list: [{ mid_height_air_flow_path: 3.8 }] },
    } as Element;
    store.setState({
      zones: [zone],
      elementsById: { [window.id]: window },
      elementIds: [window.id],
      complianceSettings: {
        ...store.getState().complianceSettings,
        Ventilation_ventilation_zone_base_height: 2.4,
      },
    });

    const csv = store.getState().generateCSV();
    expect(csv).toContain('VulcanCsvVersion,4');
    expect(csv).toContain('"{""window_part_list"":[{""mid_height_air_flow_path"":1.4}]}"');

    const parsed = parseCsvToGeometry(csv);
    const roundTrippedWindow = parsed.elements.find((element) => element.type === 'BuildingElementTransparent');
    expect(roundTrippedWindow?.mid_height).toBe(3.8);
    expect((roundTrippedWindow?.extra_json as any).window_part_list).toEqual([
      { mid_height_air_flow_path: 3.8 },
    ]);

    const reloaded = createGeometryStore({ defaultDefaultsPath: null });
    reloaded.getState().loadFromCSV(csv);
    const savedAgain = reloaded.getState().generateCSV();
    expect(savedAgain).toContain('VulcanCsvVersion,4');
    expect(savedAgain).toContain('"{""window_part_list"":[{""mid_height_air_flow_path"":1.4}]}"');
  });

  it('round-trips custom window and part mid-heights across a negative ventilation-zone base', () => {
    const parsed = parseCsvToGeometry(`
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,
VulcanCsvVersion,2,,,,,,,,,,,,,
Ventilation_ventilation_zone_base_height,-1.2,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Basement,Zone,60,25,2.4,FALSE

Window Elements,,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,linked_wall,frame_area_fraction,free_area_height,mid_height,max_window_open_area,coords,extra_json
Window 1,Basement,BuildingElementTransparent,1.2,90,1,1.2,0,-0.8,,0.1,0.4,0.9,0.4,"0.000,0.000,-1.000|1.000,0.000,-1.000","{""window_part_list"":[{""mid_height_air_flow_path"":1.1,""note"":""preserve""}]}"
`.trim());
    const window = parsed.elements.find((element) => element.type === 'BuildingElementTransparent');

    expect(window?.mid_height).toBe(-0.3);
    expect((window?.extra_json as any).window_part_list).toEqual([
      { mid_height_air_flow_path: -0.1, note: 'preserve' },
    ]);
  });

  // HEM measures vents and MVHR terminals from the ventilation zone base, as it does windows.
  const ventCsv = (version: string, base: number, vent: number, terminal: string, terminalZ: number) => `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,
${version}
Ventilation_ventilation_zone_base_height,${base},,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Ventilation Systems,,,,,,,,,,,,,
Name,Type,length,duct_type,terminal_type,parent_element,host_element,mid_height_air_flow_path,area_cm2,orientation360,pitch,vent_type,coords,extra_json
MVHR 1,MechanicalVentilation,,,,,,,,,,MVHR,,"{}"
Trickle,Vents,,,,,,${vent},30,90,90,,"4.000,5.000,1.000","{}"
Intake,MechanicalVentilationTerminal,,,intake,MVHR 1,,${terminal},,315,90,,"1.000,0.000,${terminalZ}","{}"
`.trim();
  const ventHeights = (csv: string) => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().loadFromCSV(csv);
    const byName = (name: string) => Object.values(store.getState().elementsById).find((e) => e.name === name) as any;
    return { store, vent: byName('Trickle').mid_height_air_flow_path, terminal: byName('Intake').mid_height_air_flow_path };
  };

  it.each([
    [2.8, 1.5, 1.8, 4.3, 4.6],
    [-2.5, 1.5, 1.8, -1, -0.7],
  ])('round-trips version-4 vent and terminal heights over base %s', (base, ventCell, terminalCell, vent, terminal) => {
    const loaded = ventHeights(ventCsv('VulcanCsvVersion,4,,,,,,,,,,,,,', base, ventCell, String(terminalCell), terminal));
    expect(loaded).toMatchObject({ vent, terminal });
    const csv = loaded.store.getState().generateCSV();
    expect(csv).toContain('VulcanCsvVersion,4');
    expect(csv).toContain(`Trickle,Vents,,,,,,${ventCell},`);
    expect(csv).toContain(`Intake,MechanicalVentilationTerminal,,,intake,MVHR 1,,${terminalCell},`);
    const reloaded = ventHeights(csv);
    expect(reloaded).toMatchObject({ vent, terminal });
    expect(reloaded.store.getState().generateCSV()).toBe(csv);
  });

  it('writes a terminal with no height column from its point, less the base', () => {
    const loaded = ventHeights(ventCsv('VulcanCsvVersion,4,,,,,,,,,,,,,', 2.8, 1.5, '', 4.6));
    expect(loaded.store.getState().generateCSV()).toContain('Intake,MechanicalVentilationTerminal,,,intake,MVHR 1,,1.8,');
  });

  it('keeps version-3 ground-relative vent and terminal heights until the file is upgraded', () => {
    const loaded = ventHeights(ventCsv('VulcanCsvVersion,3,,,,,,,,,,,,,', 2.8, 4.3, '4.6', 4.6));
    expect(loaded).toMatchObject({ vent: 4.3, terminal: 4.6 });
    const ordinarySave = loaded.store.getState().generateCSV();
    expect(ordinarySave).toContain('VulcanCsvVersion,3');
    expect(ordinarySave).toContain('Trickle,Vents,,,,,,4.3,');
    loaded.store.getState().requestCsvUpgrade();
    const upgraded = loaded.store.getState().generateCSV();
    expect(upgraded).toContain('VulcanCsvVersion,4');
    expect(upgraded).toContain('Trickle,Vents,,,,,,1.5,');
    expect(upgraded).toContain('Intake,MechanicalVentilationTerminal,,,intake,MVHR 1,,1.8,');
    expect(ventHeights(upgraded)).toMatchObject({ vent: 4.3, terminal: 4.6 });
  });

  // The file states the base the export subtracted, where the converter reads it, so a reload adds
  // back the same base: a Systems row's, or the editor's derived base written as a Metadata row.
  const baseSourceCsv = (metadataRows: string, systemsBase?: number) => `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,
VulcanCsvVersion,4,,,,,,,,,,,,,
${metadataRows}

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Window Elements,,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,linked_wall,frame_area_fraction,free_area_height,mid_height,max_window_open_area,coords,extra_json
Window 1,Living,BuildingElementTransparent,1.2,90,1,1.2,0,3.2,,0.1,0.4,1.4,0.4,"0.000,0.000,1.000|1.000,0.000,1.000","{}"

Ventilation Systems,,,,,,,,,,,,,
Name,Type,length,duct_type,terminal_type,parent_element,host_element,mid_height_air_flow_path,area_cm2,orientation360,pitch,vent_type,coords,extra_json
Trickle,Vents,,,,,,1.5,30,90,90,,"4.000,5.000,1.000","{}"
${systemsBase === undefined ? '' : `
Systems,,,,,,,
Name,Zone,Type,subcategory,system_preset,base_height,coords,extra_json
Ventilation,,System,InfiltrationVentilation,,,,"{""InfiltrationVentilation"":{""ventilation_zone_base_height"":${systemsBase}}}"`}
`.trim();
  const openBaseSource = (csv: string) => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().loadFromCSV(csv);
    const byName = (name: string) => Object.values(store.getState().elementsById).find((e) => e.name === name) as any;
    return { store, vent: byName('Trickle').mid_height_air_flow_path, window: byName('Window 1').mid_height };
  };

  const flatRows = [
    'General_build_type,flat,,,,,,,,,,,,,',
    'General_storeys_in_dwelling,1,,,,,,,,,,,,,',
    'General_storey_of_dwelling,2,,,,,,,,,,,,,',
    'AirPermeability_ventilation_zone_height,2.4,,,,,,,,,,,,,',
  ].join('\n');

  it('adds back a Systems row base and leaves that row to state it', () => {
    const opened = openBaseSource(baseSourceCsv('', 2.8));
    expect(opened).toMatchObject({ vent: 4.3, window: 4.2 });
    const csv = opened.store.getState().generateCSV();
    expect(csv).not.toContain('Ventilation_ventilation_zone_base_height');
    expect(csv).toContain('Trickle,Vents,,,,,,1.5,');
    expect(csv).toContain(',1.4,0.4,');
    expect(openBaseSource(csv).store.getState().generateCSV()).toBe(csv);
  });

  it('writes the derived base it subtracted and adds it back on reload', () => {
    const opened = openBaseSource(baseSourceCsv(flatRows));
    const csv = opened.store.getState().generateCSV();
    expect(csv).toContain('Ventilation_ventilation_zone_base_height,2.4,');
    const reopened = openBaseSource(csv);
    expect(reopened.store.getState().generateCSV()).toBe(csv);
    expect(reopened).toMatchObject({ vent: opened.vent, window: opened.window });
  });

  it('writes a non-zero base the file lacked rather than leave the converter another', () => {
    const opened = openBaseSource(baseSourceCsv(flatRows));
    opened.store.setState({ complianceSettings: {
      ...opened.store.getState().complianceSettings,
      absentMetadataRows: ['Ventilation_ventilation_zone_base_height'],
    } });
    expect(opened.store.getState().generateCSV()).toContain('Ventilation_ventilation_zone_base_height,2.4,');
  });

  it('parses the canonical property postcode metadata row', () => {
    const parsed = parseCsvToGeometry(`Metadata,,,,,,,,,,,,,
Postcode,MK40 1AA,,,,,,,,,,,,,`);

    expect(parsed.metadata.propertyPostcode).toBe('MK40 1AA');
  });

  it('accepts only SAP built-form codes 1 through 6', () => {
    for (const code of [1, 2, 3, 4, 5, 6] as const) {
      const parsed = parseCsvToGeometry(`Metadata,,,,,,,,,,,,,
General_built_form,${code},,,,,,,,,,,,,`);

      expect(parsed.metadata.complianceSettings.built_form).toBe(code);
    }

    for (const value of ['0', '7', '2.5', 'not-a-code', '']) {
      const parsed = parseCsvToGeometry(`Metadata,,,,,,,,,,,,,
General_built_form,${value},,,,,,,,,,,,,`);

      expect(parsed.metadata.complianceSettings.built_form).toBeUndefined();
    }
  });

  it('parses GuideOverlaySource metadata when present', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,
GuideOverlay,v1|input/overlays/2026-04-24T15-41-22-468Z_floorplans_p3.png|0.5|0|0|142.7|3|1.2|3.4|4.2|3.4,,,,,,,,,,,,,
GuideOverlaySource,v1|pdf|input/overlay-sources/2026-04-24T15-41-22-468Z_floorplans.pdf|floorplans.pdf|3|input/overlays/2026-04-24T15-41-22-468Z_floorplans_p3.png,,,,,,,,,,,,,
`.trim();

    const parsed = parseCsvToGeometry(csv);

    expect((parsed.metadata as any).guideOverlay).toEqual({
      path: 'input/overlays/2026-04-24T15-41-22-468Z_floorplans_p3.png',
      opacity01: 0.5,
      pos_m: { x: 0, y: 0 },
      pxPerM: 142.7,
      calibration: {
        a_world_m: { x: 1.2, y: 3.4 },
        b_world_m: { x: 4.2, y: 3.4 },
        real_m: 3,
      },
    });
    expect((parsed.metadata as any).guideOverlaySource).toEqual({
      kind: 'pdf',
      source_path: 'input/overlay-sources/2026-04-24T15-41-22-468Z_floorplans.pdf',
      source_filename: 'floorplans.pdf',
      page: 3,
      derived_overlay_path: 'input/overlays/2026-04-24T15-41-22-468Z_floorplans_p3.png',
    });
  });

  it('parses FloorHeightOverride metadata rows, including basement (negative) floors', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,
FloorHeightOverride,0,2.55,,,,,,,,,,,,,
FloorHeightOverride,-1,2.1,,,,,,,,,,,,,
`.trim();

    const parsed = parseCsvToGeometry(csv);

    expect(parsed.metadata.floorHeightOverrides).toEqual([
      { zIndex: 0, height: 2.55 },
      { zIndex: -1, height: 2.1 },
    ]);
  });

  it('drops a malformed FloorHeightOverride row (non-integer zIndex or non-finite height)', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,
FloorHeightOverride,1.5,2.4,,,,,,,,,,,,,
FloorHeightOverride,1,not-a-number,,,,,,,,,,,,,
`.trim();

    const parsed = parseCsvToGeometry(csv);

    expect(parsed.metadata.floorHeightOverrides).toEqual([]);
  });

  it('parses FloorBaseHeightOverride metadata rows', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,
FloorBaseHeightOverride,0,0.3,,,,,,,,,,,,,
FloorBaseHeightOverride,-1,-2.7,,,,,,,,,,,,,
`.trim();

    const parsed = parseCsvToGeometry(csv);

    expect(parsed.metadata.floorBaseHeightOverrides).toEqual([
      { zIndex: 0, baseHeight: 0.3 },
      { zIndex: -1, baseHeight: -2.7 },
    ]);
  });

  it('parses zone rows whose names begin with "Zone "', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone 1,Zone,60,25,2.4,FALSE

Exposed Elements,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
WallOrientation180,Zone 1,BuildingElementOpaque,12,90,5,2.4,180,0,FALSE,FALSE,,"0,0,0|5,0,0","{}"
`.trim();

    const { zones, elements } = parseCsvToGeometry(csv);

    expect(zones).toHaveLength(1);
    expect(zones[0].name).toBe('Zone 1');
    expect(elements.find((e) => e.name === 'WallOrientation180')).toBeDefined();
    expect(elements.find((e) => e.name === 'WallOrientation180')?.zoneId).toBe(zones[0].id);
  });

  it('restores window shading extra_json from current exports', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Window Shading,,,,,,,,,,,,,,
Name,Zone,Type,linked_window,depth,height,distance,transparency,coords,extra_json
Shade 1,Living,object,Window 1,,1.4,0.6,0.25,"5.000,6.000,0.000","{""source"":""manual"",""note"":""keep me""}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const shade = elements.find((e) => e.type === 'WindowShading' && e.name === 'Shade 1');

    expect(shade).toBeDefined();
    expect((shade as any).coordinates).toEqual([{ x: 5, y: 6, z: 0 }]);
    expect((shade as any).extra_json).toEqual({ source: 'manual', note: 'keep me' });
  });

  it('restores lighting extra_json from current exports', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Lighting,,,,,,,,,,,,,
Name,Zone,efficacy,count,power,coords,extra_json
Living lights,Living,90,4,24,"2.000,3.000,0.000","{""calc_mode"":""detailed""}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const lighting = elements.find((e) => e.type === 'Lighting' && e.name === 'Living lights');

    expect(lighting).toBeDefined();
    expect((lighting as any).coordinates).toEqual([{ x: 2, y: 3, z: 0 }]);
    expect((lighting as any).extra_json).toEqual({ calc_mode: 'detailed' });
  });

  it('restores Appliances extra_json from current exports', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Appliances,,,,,
Name,Type,appliancekey,base_height,coords,extra_json
Fridge 1,Appliance,Fridge,,"1.000,2.000,0.000","{""energy_supply"":""mains_gas""}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const fridge = elements.find((e) => e.type === 'Appliance' && e.name === 'Fridge 1');

    expect(fridge).toBeDefined();
    expect(fridge?.extra_json).toEqual({ energy_supply: 'mains_gas' });
  });

  it('restores Hot Water Outlets extra_json from current exports', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Hot Water Outlets,,,,,,,,,
Name,Type,subcategory,flowrate,size,rated_power,allow_low_flowrate,coords,extra_json
Mixer Shower,HotWaterDemand,MixerShower,8.5,,,TRUE,"3.000,4.000,1.000","{""wwhrs"":""system_a""}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const shower = elements.find((e) => e.type === 'HotWaterDemand' && e.name === 'Mixer Shower');

    expect(shower).toBeDefined();
    expect(shower?.extra_json).toEqual({ wwhrs: 'system_a' });
  });

  it('leaves pipework_type blank for Water Pipework rows that do not give it', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Water Pipework,,,,,,,,
Name,Type,length,location,coords,extra_json
Pipe,WaterPipework,3.5,internal,"0.000,0.000,0.000|3.500,0.000,0.000","{}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const pipe = elements.find((e) => e.type === 'WaterPipework' && e.name === 'Pipe');

    expect(pipe).toBeDefined();
    expect((pipe as any).pipework_type).toBeUndefined();
  });

  it('maps additive object base_height columns to viewer-only elevation metadata outside ventilation', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Ventilation Systems,,,,,,,,,,,,,
Name,Type,length,duct_type,parent_element,mid_height_air_flow_path,area_cm2,orientation360,pitch,vent_type,coords,extra_json
iMEV,MechanicalVentilation,,,Window A,1.2,,,,Intermittent MEV,"2.000,3.000,0.000","{}"
Trickle,Vents,,,,1.4,5000,90,90,,"4.000,5.000,0.000","{}"

Wet Emitters,,,,,,,,,,
Name,Zone,Type,subcategory,area,unit_number,base_height,coords,extra_json
Radiator,Living,WetEmitter,radiator,,1,0.75,"1.000,2.000,0.000","{}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);

    expect(elements.find((e) => e.name === 'iMEV')).toMatchObject({ parent_element: 'Window A' });
    expect(elements.find((e) => e.name === 'iMEV')).not.toHaveProperty('_base_height');
    expect(elements.find((e) => e.name === 'Trickle')).not.toHaveProperty('_base_height');
    expect(elements.find((e) => e.name === 'Radiator')).toMatchObject({ _base_height: 0.75 });
  });

  it('maps ground base_height only for slab and suspended floor placement, not basements', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Ground Elements,,,,,,,,,,,,,
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,base_height,parent_element,coords,extra_json
Raised Slab,Living,BuildingElementGround,25,5,0.2,20,Slab_no_edge_insulation,,,0.3,,"0,0,0|5,0,0|5,5,0|0,5,0","{}"
Raised Suspended,Living,BuildingElementGround,25,5,0.2,20,Suspended_floor,,,0.4,,"0,0,0|5,0,0|5,5,0|0,5,0","{""height_upper_surface"":0.15}"
Basement,Living,BuildingElementGround,25,5,0.2,20,Heated_basement,2.8,,0.9,,"0,0,0|5,0,0|5,5,0|0,5,0","{}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);

    expect(elements.find((e) => e.name === 'Raised Slab')).toMatchObject({ _base_height: 0.3 });
    expect(elements.find((e) => e.name === 'Raised Suspended')).toMatchObject({ _base_height: 0.4 });
    expect(elements.find((e) => e.name === 'Basement')).not.toHaveProperty('_base_height');
  });

  it('opens legacy system_type dispatch rows', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Zone,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,50,20,2.5,FALSE

Systems,,,,,,,,,,,,,
Name,Zone,system_type,coords,extra_json
Battery,Living,ElectricBattery,"-3.620,3.920,0.000","{""capacity"":10,""battery_location"":""inside""}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const battery = elements.find((e) => e.type === 'ElectricBattery' && e.name === 'Battery');

    expect(battery).toBeDefined();
    expect((battery as any).capacity).toBe(10);
    expect((battery as any).coordinates).toEqual([{ x: -3.62, y: 3.92, z: 0 }]);
  });

  it('normalizes malformed multi-point System coordinates to the first point', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Systems,,,,,,,
Name,Zone,Type,subcategory,system_preset,base_height,coords,extra_json
Heat Pump 1,,System,HeatSourceWet,a2a_heat_pump,0,"0.000,0.000,0.000|-1.000,0.000,0.000","{}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const system = elements.find((e) => e.type === 'System' && e.name === 'Heat Pump 1');

    expect(system).toBeDefined();
    expect(system?.coordinates).toEqual([{ x: 0, y: 0, z: 0 }]);
  });

  it('imports manual MVHR terminal orientation and pitch without a host', () => {
    const csv = `
Ventilation Systems,,,,,,,,,,,,,
Name,Type,length,duct_type,terminal_type,parent_element,host_element,mid_height_air_flow_path,area_cm2,orientation360,pitch,vent_type,coords,extra_json
Manual intake,MechanicalVentilationTerminal,,,intake,MVHR 1,,4.2,,315,90,,"12.000,8.000,4.200","{}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const terminal = elements.find((element) => element.type === 'MechanicalVentilationTerminal');

    expect(terminal).toMatchObject({
      host_element: null,
      mid_height_air_flow_path: 4.2,
      orientation360: 315,
      pitch: 90,
    });
  });

  const terminalHostCsv = (duplicateHost: boolean) => `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone A,Zone,60,25,2.4,FALSE
${duplicateHost ? 'Zone B,Zone,60,25,2.4,FALSE' : ''}

Exposed Elements,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
Wall A,Zone A,BuildingElementOpaque,1,90,1,2,0,0,FALSE,FALSE,,"0.000,0.000,0.000|1.000,0.000,0.000","{}"
${duplicateHost ? 'Wall A,Zone B,BuildingElementOpaque,1,90,1,2,0,0,FALSE,FALSE,,"0.000,0.000,0.000|1.000,0.000,0.000","{}"' : ''}

Ventilation Systems,,,,,,,,,,,,,
Name,Type,length,duct_type,terminal_type,parent_element,host_element,mid_height_air_flow_path,area_cm2,orientation360,pitch,vent_type,coords,extra_json
MVHR 1,MechanicalVentilation,,,,,,,,,,,,"{}"
Manual intake,MechanicalVentilationTerminal,,,intake,MVHR 1,Wall A,4.2,,315,90,,"0.000,0.000,1.000","{}"

Systems,,,,,,,
Name,Zone,Type,subcategory,system_preset,base_height,coords,extra_json
Wall A,,System,HeatSourceWet,a2a_heat_pump,0,"0.000,0.000,9.000","{}"
`.trim();

  it('retains an ambiguous terminal host instead of guessing across zones', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });

    const result = store.getState().loadFromCSV(terminalHostCsv(true));
    const terminal = Object.values(store.getState().elementsById).find(
      (element) => element.type === 'MechanicalVentilationTerminal',
    );
    const groundFloor = store.getState().floors.find((floor) => floor.zIndex === 0);

    expect(terminal).toMatchObject({
      host_element: 'Wall A',
      orientation360: 315,
      pitch: 90,
      floorId: groundFloor?.id,
    });
    expect(result.warnings).toContain(
      "MechanicalVentilationTerminal 'Manual intake' retained ambiguous host 'Wall A'",
    );
  });

  it('keeps a unique global terminal host connected during import', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });

    const result = store.getState().loadFromCSV(terminalHostCsv(false));
    const terminal = Object.values(store.getState().elementsById).find(
      (element) => element.type === 'MechanicalVentilationTerminal',
    );

    expect(terminal).toMatchObject({ host_element: 'Wall A' });
    expect(result.warnings).not.toContain(
      "MechanicalVentilationTerminal 'Manual intake' retained ambiguous host 'Wall A'",
    );
  });

  const roofOpeningCsv = (duplicateHost: boolean) => `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone A,Zone,60,25,2.4,FALSE
${duplicateHost ? 'Zone B,Zone,60,25,2.4,FALSE' : ''}

Exposed Elements,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
Roof A,Zone A,BuildingElementOpaque,100,30,10,2,90,2,FALSE,FALSE,,"0.000,0.000,2.000|10.000,0.000,2.000|10.000,10.000,7.774|0.000,10.000,7.774","{}"
${duplicateHost ? 'Roof A,Zone B,BuildingElementOpaque,100,45,10,2,180,8,FALSE,FALSE,,"0.000,0.000,8.000|10.000,0.000,8.000|10.000,10.000,18.000|0.000,10.000,18.000","{}"' : ''}

Window Elements,,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,linked_wall,frame_area_fraction,free_area_height,mid_height,max_window_open_area,coords,extra_json
Rooflight A,Zone A,BuildingElementTransparent,1,0,1,1,0,0,Roof A,0.1,0.4,0.5,0.4,"1.000,1.000,2.500|2.000,1.000,2.500|1.000,2.000,2.500","{}"
`.trim();

  it('resolves hosted roof openings in their zone when roof names repeat', () => {
    const duplicateStore = createGeometryStore({ defaultDefaultsPath: null });
    const uniqueStore = createGeometryStore({ defaultDefaultsPath: null });

    duplicateStore.getState().loadFromCSV(roofOpeningCsv(true));
    uniqueStore.getState().loadFromCSV(roofOpeningCsv(false));

    const duplicateOpening = Object.values(duplicateStore.getState().elementsById).find(
      (element) => element.name === 'Rooflight A',
    );
    const uniqueOpening = Object.values(uniqueStore.getState().elementsById).find(
      (element) => element.name === 'Rooflight A',
    );

    expect(duplicateOpening).toMatchObject({ pitch: 30, orientation360: 90, base_height: uniqueOpening?.base_height });
    expect(duplicateOpening?.coordinates).toEqual(uniqueOpening?.coordinates);
  });

  it('strips deprecated Building Services blocks (no header row) so later sections still parse', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Building Services,,,,,,,,,,,,,
Legacy Vent,Living,MechanicalVentilation,,,,,,,,,

Hot Water Outlets,,,,,,,,
Name,Type,subcategory,flowrate,size,rated_power,allow_low_flowrate,coords
Bath 1,HotWaterDemand,Bath,,180,,,"12.500,7.250,0.000"
`.trim();

    const { elements } = parseCsvToGeometry(csv);

    expect(elements.find((e) => e.name === 'Legacy Vent')).toBeUndefined();
    expect(elements.find((e) => e.type === 'HotWaterDemand' && e.name === 'Bath 1')).toBeDefined();
  });

  it('keeps a positive input ventilation vent_type (HEM:EPC)', () => {
    const csv = `
Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Ventilation Systems,,,,,,,,,,,,,
Name,Type,length,duct_type,parent_element,mid_height_air_flow_path,area_cm2,orientation360,pitch,vent_type,coords,extra_json
Loft unit,MechanicalVentilation,,,,1.5,,0,90,Positive input ventilation,,"{}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const piv = elements.find((e) => e.name === 'Loft unit') as { vent_type?: string } | undefined;
    expect(piv?.vent_type).toBe('Positive input ventilation');
  });

  it('preserves pitch 0° (facing up) — not coerced to 90 by `|| 90`', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Z1,Zone,60,25,2.4,FALSE

Non-Exposed Elements,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,parent_element,coords,extra_json
Internal Floor,Z1,BuildingElementAdjacentConditionedSpace,36,0,6,2,,"0,0,1|1,0,1|1,1,1|0,1,1","{}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const el = elements.find((e) => e.name === 'Internal Floor');
    expect(el).toBeDefined();
    expect((el as { pitch?: number }).pitch).toBe(0);
  });

  it('normalizes wall-default pitch 90 to 0 for coplanar horizontal non-exposed polygons (tb_test_2 class)', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Z1,Zone,60,25,2.4,FALSE

Non-Exposed Elements,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,parent_element,coords,extra_json
Internal Floor,Z1,BuildingElementAdjacentConditionedSpace,36,90,6,6,,"-5.500,-2.980,1.000|0.500,-2.980,1.000|0.500,3.020,1.000|-5.500,3.020,1.000","{}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const el = elements.find((e) => e.name === 'Internal Floor');
    expect((el as { pitch?: number }).pitch).toBe(0);
  });
});
