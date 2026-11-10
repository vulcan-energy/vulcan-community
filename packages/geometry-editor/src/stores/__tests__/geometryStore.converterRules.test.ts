// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { __setFHSSchemaObjectForTests, __setSchemaObjectForTests } from '../../lib/schemaCache';
import { parseCsvSections } from '../../geometry/io/csvSectionRows';
import { createGeometryStore } from '../geometryStore';

// Each row loads the sample with one change and states what the converter does with it: the
// blocking issue the editor must show, or the cell the save must write. A regression here gives a
// wrong number or a silent change in the engine input.

const fixture = (path: string) => readFileSync(join(import.meta.dirname, '../../../../..', path), 'utf8');
const sample = fixture('packages/geometry-editor/src/geometry/__fixtures__/example_semi_detached.csv');
const defaults = { InfiltrationVentilation: { shield_class: 'Normal', altitude: 30, Leaks: { test_result: 4 } }, NumberOfBedrooms: 1 };

beforeAll(() => {
  const schema = JSON.parse(fixture('hem_fhs_upstream/schema/input_fhs.schema.json'));
  __setFHSSchemaObjectForTests(schema);
  __setSchemaObjectForTests(schema);
});
afterAll(() => {
  __setFHSSchemaObjectForTests(null as never);
  __setSchemaObjectForTests(null as never);
});

type Case = {
  name: string;
  edit: (csv: string) => string;
  /** Defaults that arrive after the load, as the file's defaults read does. */
  defaults?: boolean;
  /** `element|field`, `|field` on any element, or issue text the editor must block on. */
  blocks?: string[];
  /** Must not block on these. */
  allows?: string[];
  /** `section|row name|column` (or `Metadata|key`) → saved cell; null means the row is not written. */
  saves?: Record<string, string | null>;
  /** The load must stop with this message: the converter stops the whole conversion. */
  refuses?: string;
  /** Edits after the load (and the defaults), before the checks. */
  then?: (store: ReturnType<typeof createGeometryStore>) => void;
  /** Text the load notices must contain, or must not contain. */
  notice?: string;
  noNotice?: string;
};

const replace = (from: string, to: string) => (csv: string) => {
  if (!csv.includes(from)) throw new Error(`fixture text not found: ${from}`);
  return csv.replace(from, to);
};
const radiator = (unit: string) => replace('Radiator,Zone 1,WetEmitter,radiator,,1,', `Radiator,Zone 1,WetEmitter,radiator,,${unit},`);
const ufh = (unit: string) => replace('Underfloor Heating,Zone 1,WetEmitter,ufh,8.89,,', `Underfloor Heating,Zone 1,WetEmitter,ufh,8.89,${unit},`);

const withoutShieldAndAltitude = (csv: string) => csv.replace(/^Ventilation_(shield_class|altitude),.*\n/gm, '');
const systemsVentilation = (csv: string) => replace(
  'Name,Zone,Type,subcategory,system_preset,base_height,coords,extra_json\n',
  'Name,Zone,Type,subcategory,system_preset,base_height,coords,extra_json\nInfiltration,Zone 1,System,InfiltrationVentilation,,,"0,0,0","{""InfiltrationVentilation"":{""shield_class"":""Shielded"",""altitude"":120,""ventilation_zone_base_height"":1.5}}"\n',
)(replace('Ventilation_ventilation_zone_base_height,0,,,,,,,,,,,,,\n', '')(withoutShieldAndAltitude(csv)));

const kitchen = (zone: string, type: string, keepCoords = true) => (csv: string) => csv.replace(
  /^Kitchen,Zone 1,0,kitchen,("[^"]*")/m,
  (_row, coords: string) => `Kitchen,${zone},0,${type},${keepCoords ? coords : ''}`,
);

const appendSection = (text: string) => (csv: string) => `${csv.trimEnd()}\n\n${text}\n`;
const noFloorAreaExtra = (csv: string) => csv.replace('""emitter_floor_area"":8.89,', '');

const CASES: Case[] = [
  // Converter: unit_number is a whole number of 1 or more, or blank (E055 otherwise), on every emitter.
  { name: 'radiator unit_number 0.5', edit: radiator('0.5'), blocks: ['Radiator|unit_number'], saves: { 'Wet Emitters|Radiator|unit_number': '0.5' } },
  { name: 'radiator unit_number 1.5', edit: radiator('1.5'), blocks: ['Radiator|unit_number'], saves: { 'Wet Emitters|Radiator|unit_number': '1.5' } },
  { name: 'radiator unit_number abc', edit: radiator('abc'), blocks: ['Radiator|unit_number'], saves: { 'Wet Emitters|Radiator|unit_number': 'abc' } },
  { name: 'radiator unit_number 0', edit: radiator('0'), blocks: ['Radiator|unit_number'], saves: { 'Wet Emitters|Radiator|unit_number': '0' } },
  { name: 'radiator unit_number 3', edit: radiator('3'), allows: ['Radiator|unit_number'], saves: { 'Wet Emitters|Radiator|unit_number': '3' } },
  { name: 'ufh unit_number 0', edit: ufh('0'), blocks: ['Underfloor Heating|unit_number'], saves: { 'Wet Emitters|Underfloor Heating|unit_number': '0' } },
  { name: 'ufh unit_number 1.5', edit: ufh('1.5'), blocks: ['Underfloor Heating|unit_number'] },
  // Text in a numeric cell is E055 or a schema type error in the converter: it stays as typed and blocks.
  { name: 'text in a required wall width', edit: replace('Wall (S),Zone 1,BuildingElementOpaque,7.38,90,4,', 'Wall (S),Zone 1,BuildingElementOpaque,7.38,90,four,'),
    blocks: ["Wall (S) (BuildingElementOpaque): Width is 'four', which is not a number"], saves: { 'Exposed Elements|Wall (S)|width': 'four' } },
  { name: 'text in a wall area is not filled', edit: replace('Wall (S),Zone 1,BuildingElementOpaque,7.38,', 'Wall (S),Zone 1,BuildingElementOpaque,tbc,'),
    blocks: ['Wall (S)|area'], noNotice: 'Wall (S) area', saves: { 'Exposed Elements|Wall (S)|area': 'tbc' } },
  { name: 'text in an optional window cell', edit: replace('Wall (S),0.25,0.95,1.65,', 'Wall (S),n/a,0.95,1.65,'),
    blocks: ['Window|frame_area_fraction'], saves: { 'Window Elements|Window|frame_area_fraction': 'n/a' } },
  { name: 'a number followed by text', edit: replace('Light,Zone 1,80,', 'Light,Zone 1,80lm,'),
    blocks: ['Light|efficacy'], saves: { 'Lighting|Light|efficacy': '80lm' } },
  { name: 'text in a zone cell', edit: replace('Zone 1,Zone,198.77,', 'Zone 1,Zone,big,'),
    blocks: ["Volume is 'big', which is not a number"], saves: { 'Zone|Zone 1|volume': 'big' } },
  { name: 'text in a ventilation unit position', edit: replace(',,2.7,,0,180,Centralised', ',,2.7,,north,180,Centralised'),
    blocks: ['Centralised Continuous MEV|orientation360'], saves: { 'Ventilation Systems|Centralised Continuous MEV|orientation360': 'north' } },
  { name: 'text in a Metadata count', edit: replace('NumberOfBedrooms,2,', 'NumberOfBedrooms,two,'), defaults: true,
    blocks: ["Number of Bedrooms is 'two', which the target does not accept"], saves: { 'Metadata|NumberOfBedrooms': 'two' } },
  { name: 'text in a Metadata length', edit: replace('BuildingLength,8.9,', 'BuildingLength,long,'),
    blocks: ["Building length (m) is 'long'"], saves: { 'Metadata|BuildingLength': 'long' } },
  { name: 'text in a Metadata air test result', edit: replace('AirPermeability_test_result,4,', 'AirPermeability_test_result,x,'),
    blocks: ["Test Result is 'x'"], saves: { 'Metadata|AirPermeability_test_result': 'x' } },
  { name: 'a part count', edit: replace('NumberOfBedrooms,2,', 'NumberOfBedrooms,2.5,'), defaults: true,
    blocks: ["Number of Bedrooms is '2.5'"], saves: { 'Metadata|NumberOfBedrooms': '2.5' } },
  // A Metadata value outside its fixed options is E026 or E055 in the converter: kept and blocking.
  { name: 'a test pressure that is not an option', edit: replace('AirPermeability_test_pressure,Standard,', 'AirPermeability_test_pressure,50,'), defaults: true,
    blocks: ["Test Pressure is '50'"], saves: { 'Metadata|AirPermeability_test_pressure': '50' } },
  { name: 'a heating control that is not an option', edit: replace('HeatingControlType,SeparateTempControl,', 'HeatingControlType,Thermostat,'), defaults: true,
    blocks: ["Heating Control Type is 'Thermostat'"], saves: { 'Metadata|HeatingControlType': 'Thermostat' } },
  { name: 'a yes/no setting that is not TRUE or FALSE', edit: replace('PartGcompliance,TRUE,', 'PartGcompliance,yes,'), defaults: true,
    blocks: ["Part G Compliance is 'yes'"], saves: { 'Metadata|PartGcompliance': 'yes' } },
  { name: 'a number typed over the text is saved', edit: replace('Light,Zone 1,80,', 'Light,Zone 1,80lm,'),
    then: (store) => {
      const light = Object.values(store.getState().elementsById).find((element) => element.name === 'Light')!;
      store.getState().updateElement(light.id, { efficacy: 75 } as never);
    },
    allows: ['Light|efficacy'], saves: { 'Lighting|Light|efficacy': '75' } },
  // The converter builds a fancoil's n_units and a UFH emitter's floor area from the row's columns.
  { name: 'fancoil with no unit count', edit: replace('Radiator,Zone 1,WetEmitter,radiator,,1,', 'Radiator,Zone 1,WetEmitter,fancoil,,,'), blocks: ['|n_units'] },
  { name: 'fancoil unit count gives n_units', edit: replace('Radiator,Zone 1,WetEmitter,radiator,,1,', 'Radiator,Zone 1,WetEmitter,fancoil,,2,'), allows: ['|n_units'] },
  { name: 'ufh with no area', edit: (csv) => noFloorAreaExtra(replace('Underfloor Heating,Zone 1,WetEmitter,ufh,8.89,', 'Underfloor Heating,Zone 1,WetEmitter,ufh,,')(csv)),
    blocks: ['Underfloor Heating|emitter_floor_area'] },
  { name: 'ufh area gives emitter_floor_area', edit: noFloorAreaExtra, allows: ['Underfloor Heating|emitter_floor_area'] },
  { name: 'ufh area 0', edit: replace('Underfloor Heating,Zone 1,WetEmitter,ufh,8.89,', 'Underfloor Heating,Zone 1,WetEmitter,ufh,0,'), blocks: ['Underfloor Heating|area'] },
  // An absent Metadata row takes the converter's value: a Systems InfiltrationVentilation row
  // first, then the defaults template (which a load always reads after the file).
  { name: 'absent rows take the defaults', edit: withoutShieldAndAltitude, defaults: true, notice: 'Shield Class Normal (from the defaults file)',
    saves: { 'Metadata|Ventilation_shield_class': 'Normal', 'Metadata|Ventilation_altitude': '30' } },
  // With no Systems row and no defaults value, the converter has nothing: the row stays absent and
  // blocks where the target requires it, with what the labels or geometry show as a hint.
  { name: 'absent base height with no defaults value', defaults: true, edit: replace('Ventilation_ventilation_zone_base_height,0,,,,,,,,,,,,,\n', ''),
    blocks: ['Ventilation Zone Base Height (m) is not set. Enter it in Global Settings. The geometry gives 0.'], saves: { 'Metadata|Ventilation_ventilation_zone_base_height': null } },
  { name: 'absent bathroom count with no defaults value', defaults: true, edit: replace('NumberOfBathrooms,1,,,,,,,,,,,,,\n', ''),
    blocks: ['Number of bathrooms is not set. Enter it in Global Settings. Space labels show 1.'], saves: { 'Metadata|NumberOfBathrooms': null } },
  { name: 'a Systems row supplies the absent rows', edit: systemsVentilation, defaults: true, noNotice: 'Shield Class',
    allows: ['Shield Class', 'Altitude (m)'], saves: { 'Metadata|Ventilation_shield_class': null, 'Metadata|Ventilation_altitude': null, 'Metadata|Ventilation_ventilation_zone_base_height': null } },
  // The converter does not read Space Labels: every row loads and saves as it is, and none blocks.
  { name: 'label with blank Zone', edit: kitchen('', 'kitchen'), notice: 'Kitchen',
    saves: { 'Space Labels|Kitchen|Zone': '', 'Space Labels|Kitchen|room_type': 'kitchen' } },
  { name: 'label with unknown Zone', edit: kitchen('Zone 9', 'kitchen'), notice: 'Kitchen', saves: { 'Space Labels|Kitchen|Zone': 'Zone 9' } },
  { name: 'label with blank room_type', edit: kitchen('Zone 1', ''), notice: 'Kitchen', saves: { 'Space Labels|Kitchen|room_type': '' } },
  { name: 'label with blank coords', edit: kitchen('Zone 1', 'kitchen', false), notice: 'Kitchen', saves: { 'Space Labels|Kitchen|coords': '' } },
  // A present Metadata row with no value is E066 in the converter: it stays blank and blocks.
  { name: 'blank NumberOfBathrooms row', edit: replace('NumberOfBathrooms,1,', 'NumberOfBathrooms,,'),
    blocks: ['Number of bathrooms is not set. Enter it in Global Settings. Space labels show 1.'], saves: { 'Metadata|NumberOfBathrooms': '' } },
  { name: 'blank BuildingLength row', edit: replace('BuildingLength,8.9,', 'BuildingLength,,'),
    blocks: ['Building length (m) is not set. Enter it in Global Settings. The geometry gives'], saves: { 'Metadata|BuildingLength': '' } },
  { name: 'blank HeatingControlType row', edit: replace('HeatingControlType,SeparateTempControl,', 'HeatingControlType,,'), defaults: true,
    blocks: ['Heating Control Type is not set'], saves: { 'Metadata|HeatingControlType': '' } },
  // The converter validates every file against the FHS target, whatever ComplianceValidationEnabled
  // says; switched off, it does not write false for an absent KitchenExtractorHoodExternal row.
  { name: 'compliance validation off still blocks', defaults: true,
    edit: (csv) => replace('ComplianceValidationEnabled,TRUE,', 'ComplianceValidationEnabled,FALSE,')(csv).replace(/^KitchenExtractorHoodExternal,.*\n/m, ''),
    blocks: ['Kitchen cooker hood extracts to outside is not set'], saves: { 'Metadata|KitchenExtractorHoodExternal': null } },
  // The converter reads the zone's living-room split whatever the switch says; the switch is saved as it was.
  { name: 'compliance validation off keeps the zone split', edit: replace('ComplianceValidationEnabled,TRUE,', 'ComplianceValidationEnabled,FALSE,'),
    saves: { 'Zone|Zone 1|livingroom_area': '12.78', 'Zone|Zone 1|restofdwelling_area': '58.21', 'Metadata|ComplianceValidationEnabled': 'FALSE' } },
  // A second zone's rest-of-dwelling area is its floor area: the converter adds a blank as 0, so the notice names it.
  { name: 'a second zone with no split takes its floor area',
    edit: replace('simplified thermal bridging,livingroom_area,restofdwelling_area\nZone 1,Zone,198.77,70.99,2.8,FALSE,12.78,58.21\n',
      'simplified thermal bridging\nZone 1,Zone,198.77,70.99,2.8,FALSE\nZone 2,Zone,10,4,2.5,FALSE\n'),
    notice: 'Zone 2 restofdwelling_area blank → 4', saves: { 'Zone|Zone 2|restofdwelling_area': '4' } },
  { name: 'absent KitchenExtractorHoodExternal takes false', defaults: true, edit: (csv) => csv.replace(/^KitchenExtractorHoodExternal,.*\n/m, ''),
    saves: { 'Metadata|KitchenExtractorHoodExternal': 'FALSE' } },
  // A blank link in a table with the column is "linked to nothing" (E059); a table with no such
  // column lets the converter build the zone's wet system. The save keeps the table's form.
  { name: 'emitters with blank space_heat_system', edit: (csv) => csv.replace(/,Zone 1 circuit,,"/g, ',,,"'),
    blocks: ['Radiator|space_heat_system'], saves: { 'Wet Emitters|Radiator|space_heat_system': '' } },
  // The section implies the row type: a blank Type keeps the row (the converter reads it too).
  { name: 'pipework with blank Type', edit: replace('Pipe,WaterPipework,5.08,', 'Pipe,,5.08,'), saves: { 'Water Pipework|Pipe|length': '5.08' } },
  { name: 'emitter with blank Type', edit: replace('Radiator,Zone 1,WetEmitter,radiator,,1,', 'Radiator,Zone 1,,radiator,,1,'), saves: { 'Wet Emitters|Radiator|unit_number': '1' } },
  // Context Shading takes its kind from Type only in a file with no shading_type column.
  { name: 'context shading blank shading_type', blocks: ['Tree|shading_type'],
    edit: appendSection('Context Shading,,,,,,,\nName,Type,shading_type,start_angle,end_angle,distance,height,coords\nTree,obstacle,,0,30,10,5,"0,0,0"') },
  { name: 'context shading kind from Type', allows: ['Tree|shading_type'],
    edit: appendSection('Context Shading,,,,,,\nName,Type,start_angle,end_angle,distance,height,coords\nTree,obstacle,0,30,10,5,"0,0,0"') },
  // The converter takes a blank wall area as width × height; the editor saves the net area and says so.
  { name: 'blank wall area', edit: replace('Wall (S),Zone 1,BuildingElementOpaque,7.38,', 'Wall (S),Zone 1,BuildingElementOpaque,,'), notice: 'Wall (S) area blank →' },
  // A Metadata value the file gives is saved as given, whatever the geometry suggests.
  { name: 'build type house with no ground outline', saves: { 'Metadata|General_build_type': 'house' },
    edit: replace('Slab_no_edge_insulation,,0.2,,,"-29.700,-6.470,0.000|-25.700,-6.470,0.000|-25.700,2.430,0.000|-29.700,2.430,0.000"', 'Slab_no_edge_insulation,,0.2,,,""') },
  // A Systems row with a blank extra_json adds nothing: the converter keeps the defaults' heat
  // source. Any object there, editor markers only included, becomes an entry named after the row.
  { name: 'heat source row with blank extra_json', saves: { 'Systems|Heat Pump|extra_json': '' },
    edit: (csv) => csv.replace(/^(Heat Pump,Zone 1,System,HeatSourceWet,hp_large,,"[^"]*"),.*$/m, '$1,') },
  // A blank window mid_height stays blank: the converter then takes the air-flow height from the
  // window's extra_json or the defaults, not from the opening's centre.
  { name: 'window with blank mid_height', edit: replace('Wall (S),0.25,0.95,1.65,0.8,', 'Wall (S),0.25,0.95,,0.8,'),
    noNotice: 'Window mid_height', saves: { 'Window Elements|Window|mid_height': '' } },
  // A file with no elements still converts against the target, which requires these rows.
  { name: 'metadata-only file', defaults: true, edit: (csv) => replace('BuildingLength,8.9,,,,,,,,,,,,,\n', '')(csv.slice(0, csv.indexOf('Zone,,'))),
    blocks: ['Building length (m) is not set'] },
  // Element names are keys in the engine input: a name the load brings up to date is named.
  { name: 'an older auto name brought up to date', edit: (csv) => csv.replace(/Wall \(S\) 1,Zone 1,/, 'Wall 1,Zone 1,'), notice: 'Wall 1 name → Wall (S) 1' },
  // A 0 the save writes blank reaches the converter as blank, so it is named.
  { name: 'a 0 width saved blank', edit: replace('Party Wall (E),Zone 1,BuildingElementPartyWall,24.92,90,8.9,', 'Party Wall (E),Zone 1,BuildingElementPartyWall,24.92,90,0,'),
    notice: 'Party Wall (E) width 0 → blank' },
  // Only a blank pitch is worked out from coords by the converter; a filled width is named.
  { name: 'a blank wall width filled from coords', edit: replace('Wall (S),Zone 1,BuildingElementOpaque,7.38,90,4,', 'Wall (S),Zone 1,BuildingElementOpaque,7.38,90,,'),
    notice: 'Wall (S) width blank → 4' },
  // The converter reads a thermal bridge table with no point-bridge, link or coords column.
  { name: 'thermal bridges in the older layout', saves: { 'Thermal Bridging Elements|TB_E5|length': '8.9', 'Thermal Bridging Elements|TB_E5|linear_thermal_transmittance': '0.32' },
    edit: (csv) => csv.replace(/Name,Zone,Type,heat_transfer_coeff,length,linear_thermal_transmittance,parent_element,coords,extra_json\n(?:Auto_TB[^\n]*\n)+/,
      'Name,Zone,Type,length,linear_thermal_transmittance,extra_json\nTB_E5,Zone 1,ThermalBridgeLinear,8.9,0.32,"{""junction_type"":""E5""}"\n') },
  // A row the converter stops on (E008-E029) stops the load, naming the row.
  { name: 'element in an unknown zone', edit: replace('Wall (S),Zone 1,BuildingElementOpaque', 'Wall (S),Zone 9,BuildingElementOpaque'), refuses: "names zone 'Zone 9'" },
  { name: 'element with no name', edit: replace('Wall (S),Zone 1,BuildingElementOpaque', ',Zone 1,BuildingElementOpaque'), refuses: 'An Exposed Elements row has no Name' },
  { name: 'hot water outlet with no Type', edit: replace('Tap,HotWaterDemand,', 'Tap,,'), refuses: "Hot Water Outlets row 'Tap' has no Type" },
  { name: 'Systems row with no Name', edit: replace('Heat Pump,Zone 1,System,', ',Zone 1,System,'), refuses: 'A Systems row has no Name' },
  // The converter rejects or leaves out a row whose Type it does not route (E056, E028, E065): the
  // load stops, naming the row and its Type, rather than dropping the row.
  { name: 'thermal bridge with an unknown Type', edit: replace('Auto_TB_1,Zone 1,ThermalBridgeLinear,', 'Auto_TB_1,Zone 1,ThermalBridgeLiner,'),
    refuses: "Thermal Bridging Elements row 'Auto_TB_1' has Type 'ThermalBridgeLiner'" },
  { name: 'floor with an unknown Type', edit: replace('Floor,Zone 1,BuildingElementGround,', 'Floor,Zone 1,BuildingElementGrnd,'),
    refuses: "Ground Elements row 'Floor' has Type 'BuildingElementGrnd'" },
  { name: 'Systems row with an unknown Type', edit: replace('Heat Pump,Zone 1,System,', 'Heat Pump,Zone 1,Systm,'), refuses: "Systems row 'Heat Pump' has Type 'Systm'" },
  { name: 'ventilation row with an unknown Type', edit: replace('Background Vent 1,Vents,', 'Background Vent 1,Vent,'),
    refuses: "Ventilation Systems row 'Background Vent 1' has Type 'Vent'" },
  { name: 'a row with no Name', edit: replace('Light,Zone 1,80,', ',Zone 1,80,'), refuses: 'A Lighting row has no Name' },
  // The converter reads these sections whatever the Type cell says: the row is kept, and the new Type
  // is not named because the model does not change.
  { name: 'emitter with another Type', edit: replace('Underfloor Heating,Zone 1,WetEmitter,', 'Underfloor Heating,Zone 1,Radiator,'),
    noNotice: 'Underfloor Heating Type', saves: { 'Wet Emitters|Underfloor Heating|area': '8.89' } },
  { name: 'pipework with another Type', edit: replace('Pipe,WaterPipework,', 'Pipe,Pipework,'),
    noNotice: 'Pipe Type', saves: { 'Water Pipework|Pipe|length': '5.08' } },
  // The converter routes a Systems row by its first non-blank Type, system_type or subcategory cell.
  { name: 'a Systems row typed in the legacy system_type column', noNotice: 'Type blank',
    edit: (csv) => csv.replace('Name,Zone,Type,subcategory,system_preset,', 'Name,Zone,system_type,subcategory,system_preset,'),
    saves: { 'Systems|Zone 1 circuit|Type': 'System' } },
  // Files saved by older editors carry a numeric areal heat capacity, which the converter rejects:
  // the load snaps it to its band and names the change.
  { name: 'a numeric areal heat capacity', edit: replace('"{}"\nWall (N),', '"{""areal_heat_capacity"":123456}"\nWall (N),'),
    notice: 'Wall (S) areal_heat_capacity 123456 → Medium', saves: { 'Exposed Elements|Wall (S)|extra_json': '{"areal_heat_capacity":"Medium"}' } },
  // The converter's older aliases and a SpaceHeatSystem row with its system in extra_json give it the
  // model their editor type gives, so they load as that type, unnamed.
  { name: 'a legacy Wall alias', edit: replace('Wall (N),Zone 1,BuildingElementOpaque,', 'Wall (N),Zone 1,Wall,'),
    noNotice: 'Type Wall', saves: { 'Exposed Elements|Wall (N)|Type': 'BuildingElementOpaque' } },
  { name: 'a Systems row of Type SpaceHeatSystem', edit: replace('Zone 1 circuit,Zone 1,System,', 'Zone 1 circuit,Zone 1,SpaceHeatSystem,'),
    noNotice: 'Type SpaceHeatSystem', saves: { 'Systems|Zone 1 circuit|Type': 'System', 'Systems|Zone 1 circuit|subcategory': 'SpaceHeatSystem' } },
  { name: 'combustion appliance with another Type', saves: { 'Combustion Appliances|Fire|fuel_type': 'wood' },
    edit: appendSection('Combustion Appliances,,,,,,,,\nName,Type,appliance_type,exhaust_situation,fuel_type,supply_situation,base_height,coords,extra_json\nFire,Appliance,open_fireplace,into_room,wood,room_air,,"0,0,0",') },
  // A row the save leaves out is named.
  { name: 'a row the editor does not keep', edit: appendSection('Test Section,\nName,Value\nProbe,1'), notice: 'Probe row in Test Section → left out' },
  // ComplianceValidationEnabled reads as the converter reads it: TRUE or FALSE in any case; a blank is
  // the absent row (on); other text is E055. The cell saves as typed.
  { name: 'ComplianceValidationEnabled that is not TRUE or FALSE', edit: replace('ComplianceValidationEnabled,TRUE,', 'ComplianceValidationEnabled,yes,'),
    blocks: ["ComplianceValidationEnabled is 'yes'"], saves: { 'Metadata|ComplianceValidationEnabled': 'yes' } },
  { name: 'blank ComplianceValidationEnabled is on', defaults: true,
    edit: (csv) => replace('ComplianceValidationEnabled,TRUE,', 'ComplianceValidationEnabled,,')(csv).replace(/^KitchenExtractorHoodExternal,.*\n/m, ''),
    allows: ['Kitchen cooker hood extracts to outside'], saves: { 'Metadata|ComplianceValidationEnabled': '', 'Metadata|KitchenExtractorHoodExternal': 'FALSE' } },
  // The editor's checks stay on whatever the switch says; the last non-blank row is saved, as the converter reads it.
  { name: 'ComplianceValidationEnabled FALSE then blank', edit: replace('ComplianceValidationEnabled,TRUE,', 'ComplianceValidationEnabled,FALSE,\nComplianceValidationEnabled,,'),
    then: (store) => expect(store.getState().complianceSettings.complianceValidationEnabled).toBe(true),
    saves: { 'Metadata|ComplianceValidationEnabled': 'FALSE' } },
  // The converter ignores ScenariosBaseModelEnabled.
  { name: 'ScenariosBaseModelEnabled that is not TRUE or FALSE', edit: replace('ScenariosBaseModelEnabled,TRUE,', 'ScenariosBaseModelEnabled,yes,'),
    allows: ["ScenariosBaseModelEnabled is 'yes'"], saves: { 'Metadata|ScenariosBaseModelEnabled': 'yes' } },
  // The converter keeps distribution pipework whatever ComplianceValidationEnabled says.
  { name: 'distribution pipework is saved', edit: replace('Pipe,WaterPipework,5.08,internal,primary,', 'Pipe,WaterPipework,5.08,internal,distribution,'),
    saves: { 'Water Pipework|Pipe|pipework_type': 'distribution' } },
  // The load takes the living-room split from the labels whatever the switch says, and names the change.
  { name: 'compliance validation off still takes the split from the labels',
    edit: (csv) => replace('ComplianceValidationEnabled,TRUE,', 'ComplianceValidationEnabled,FALSE,')(replace('FALSE,12.78,58.21', 'FALSE,20,50.99')(csv)),
    notice: 'Zone 1 livingroom_area 20 → 12.78', saves: { 'Zone|Zone 1|livingroom_area': '12.78' } },
  // A point bridge's coefficient may sit in extra_json alone: the converter reads it there.
  { name: 'point bridge coefficient in extra_json', allows: ['PB1|heat_transfer_coeff'],
    edit: replace('linear_thermal_transmittance,parent_element,coords,extra_json\n', 'linear_thermal_transmittance,parent_element,coords,extra_json\nPB1,Zone 1,ThermalBridgePoint,,,,,"0,0,0","{""heat_transfer_coeff"":0.5}"\n') },
  // A value filled from the defaults and then edited is the user's: new defaults leave it.
  { name: 'an edited filled value survives new defaults', edit: (csv) => csv, defaults: true,
    then: (store) => {
      store.getState().setComplianceSettings({ Ventilation_shield_class: 'Sheltered' } as never);
      store.setState({ defaultsJson: { ...defaults } } as never);
    },
    saves: { 'Metadata|Ventilation_shield_class': 'Sheltered' } },
];

function load(c: Case) {
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: canonicalGeometrySchemaPort });
  const { warnings } = store.getState().loadFromCSV(c.edit(sample));
  if (c.defaults) store.setState({ defaultsJson: defaults, defaultsLoading: false } as never);
  c.then?.(store);
  const state = store.getState();
  const issues = new Set<string>();
  for (const element of Object.values(state.elementsById)) {
    for (const issue of state.validateElement(element, state.elementsById).issues) issues.add(`${element.name}|${issue.fieldKey ?? ''}`);
  }
  const all = state.collectAllGeometryWarnings().criticalIssues;
  const csv = state.generateCSV({ allowUnresolvedMigration: true });
  const cells = new Map<string, string>();
  for (const section of parseCsvSections(csv)) {
    for (const row of section.rows) {
      for (const [column, value] of Object.entries(row.data)) cells.set(`${section.name}|${row.data.Name}|${column}`, value);
    }
  }
  for (const line of csv.split('\n')) {
    const [key, value] = line.split(',');
    if (key && value !== undefined && !cells.has(`Metadata|${key}`)) cells.set(`Metadata|${key}`, value);
  }
  return { issues, all, cells, notices: [...warnings, state.lateLoadNotice ?? ''].join(' '), state };
}

it.each(CASES)('$name', (c) => {
  if (c.refuses) {
    expect(() => load(c)).toThrow(c.refuses);
    return;
  }
  const { issues, all, cells, notices } = load(c);
  if (c.notice) expect(notices).toContain(c.notice);
  if (c.noNotice) expect(notices).not.toContain(c.noNotice);
  // `|field` matches the field on any element (a type change can rename an auto-named element).
  const blocked = (key: string) => issues.has(key) || all.some((text) => text.includes(key))
    || (key.startsWith('|') && [...issues].some((issue) => issue.endsWith(key)));
  for (const key of c.blocks ?? []) expect(blocked(key), `blocks ${key}`).toBe(true);
  for (const key of c.allows ?? []) expect(blocked(key), `allows ${key}`).toBe(false);
  for (const [key, value] of Object.entries(c.saves ?? {})) expect(cells.get(key) ?? null, key).toBe(value);
});

it('opens a new document with no issues', () => {
  const state = createGeometryStore({ defaultDefaultsPath: null, schemaPort: canonicalGeometrySchemaPort }).getState();
  expect(state.collectAllGeometryWarnings().criticalIssues).toEqual([]);
});

// HEM a9 guards the party wall lining condition with `required: [party_wall_cavity_type]` beside
// its `anyOf`. The converter asks for a lining only for the three listed cavity types.
it('asks for a party wall lining only for the cavity types the target lists', () => {
  const upstream = fixture('hem_fhs_upstream/schema/input_fhs.schema.json');
  const from = '"if":{"anyOf":[{"properties":{"party_wall_cavity_type"';
  const guarded = JSON.stringify(JSON.parse(upstream));
  if (!guarded.includes(from)) throw new Error('schema text not found');
  const schema = JSON.parse(guarded.replace(from, '"if":{"required":["party_wall_cavity_type"],"anyOf":[{"properties":{"party_wall_cavity_type"'));
  __setFHSSchemaObjectForTests(schema);
  __setSchemaObjectForTests(schema);
  try {
    expect(load({ name: 'solid', defaults: true, edit: (csv) => csv }).issues.has('Party Wall (E)|party_wall_lining_type')).toBe(false);
    const sealed = load({ name: 'unfilled_sealed', defaults: true, edit: (csv) => csv.replace(/""party_wall_cavity_type"":""solid""/g, '""party_wall_cavity_type"":""unfilled_sealed""') });
    expect(sealed.issues.has('Party Wall (E)|party_wall_lining_type')).toBe(true);
  } finally {
    const plain = JSON.parse(upstream);
    __setFHSSchemaObjectForTests(plain);
    __setSchemaObjectForTests(plain);
  }
});
