// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { parseCsvToGeometry } from '../parseCsvToGeometry';

describe('parseCsvToGeometry — miscellaneous section handling', () => {
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

  it('defaults Water Pipework rows without pipework_type to primary', () => {
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
    expect((pipe as any).pipework_type).toBe('primary');
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
