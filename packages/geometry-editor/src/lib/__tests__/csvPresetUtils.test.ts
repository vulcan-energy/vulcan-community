// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { stripUiKeysFromCsv, parseCSVLine, upsertScenariosBaseModelEnabledLine } from '../csvPresetUtils';

describe('parseCSVLine', () => {
  it('should split simple comma-separated values', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('should handle quoted fields', () => {
    expect(parseCSVLine('"hello, world",b,c')).toEqual(['hello, world', 'b', 'c']);
  });

  it('should handle escaped quotes inside quoted fields', () => {
    expect(parseCSVLine('"say ""hi""",b')).toEqual(['say "hi"', 'b']);
  });

  it('should handle empty cells', () => {
    expect(parseCSVLine('a,,c,')).toEqual(['a', '', 'c', '']);
  });
});

// Helper: encode a JSON object as a CSV cell (double-quote escaping)
function jsonCsvCell(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  // CSV: wrap in quotes, double any inner quotes
  return '"' + json.replace(/"/g, '""') + '"';
}

describe('stripUiKeysFromCsv', () => {
  it('should strip _element_preset from extra_json in exposed elements', () => {
    const extraJson = jsonCsvCell({ mass_distribution_class: 'IE', _element_preset: 'standard_external_wall' });
    const csv = [
      'Zone,,,,,,,,,,,,,',
      'Name,Type,volume,floor_area,height,simplified thermal bridging',
      'Living,Zone,60,25,2.4,FALSE',
      '',
      'Exposed Elements,,,,,,,,,,,,,,',
      'Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json',
      `wall1,Living,BuildingElementOpaque,12,90,5,2.4,180,0,FALSE,FALSE,,,${extraJson}`,
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).toContain('mass_distribution_class');
    expect(result).not.toContain('_element_preset');
  });

  it('should preserve other extra_json keys when removing _element_preset', () => {
    const extraJson = jsonCsvCell({ g_value: 0.75, _element_preset: 'standard_window' });
    const csv = [
      'Exposed Elements,,,,,,,,,,,,,,',
      'Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json',
      `win1,Living,BuildingElementTransparent,1.08,90,0.9,1.2,180,0.8,FALSE,FALSE,,,${extraJson}`,
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).toContain('g_value');
    expect(result).toContain('0.75');
    expect(result).not.toContain('_element_preset');
  });

  it('should strip _system_source from system extra_json before merge', () => {
    const extraJson = jsonCsvCell({
      HeatSourceWet: {
        boiler: { type: 'Boiler', rated_power: 30 },
      },
      _system_source: 'custom',
    });
    const csv = [
      'Systems,,,,,,,',
      'Name,Zone,Type,subcategory,system_preset,coords,extra_json',
      `boiler,Living,System,HeatSourceWet,gas_boiler,,${extraJson}`,
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).toContain('HeatSourceWet');
    expect(result).toContain('rated_power');
    expect(result).toContain('30');
    expect(result).not.toContain('_system_source');
  });

  it('should strip vulcan_assembly_v1 from extra_json before merge', () => {
    const extraJson = jsonCsvCell({
      u_value: 0.18,
      vulcan_assembly_v1: { schemaVersion: 1, assemblySnapshot: { layers: [] } },
    });
    const csv = [
      'Exposed Elements,,,,,,,,,,,,,,',
      'Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json',
      `wall1,Living,BuildingElementOpaque,12,90,5,2.4,180,0,FALSE,FALSE,,,${extraJson}`,
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).toContain('u_value');
    expect(result).toContain('0.18');
    expect(result).not.toContain('vulcan_assembly_v1');
    expect(result).not.toContain('assemblySnapshot');
  });

  it('should strip ru_calculator_state_v1 from extra_json before merge', () => {
    const extraJson = jsonCsvCell({
      thermal_resistance_construction: 3.2,
      ru_calculator_state_v1: { mode: 'split', layers: [] },
    });
    const csv = [
      'Exposed Elements,,,,,,,,,,,,,,',
      'Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json',
      `wall1,Living,BuildingElementOpaque,12,90,5,2.4,180,0,FALSE,FALSE,,,${extraJson}`,
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).toContain('thermal_resistance_construction');
    expect(result).not.toContain('ru_calculator_state_v1');
  });

  it('should strip _pv_* keys from on-site generation extra_json before merge', () => {
    const extraJson = jsonCsvCell({
      inverter_type: 'string_inverter',
      _pv_footprint_flip: false,
      _pv_bottom_is_long: true,
    });
    const csv = [
      'On-Site Generation,,,,,,,,,',
      'Name,Type,generation_type,pitch,orientation360,base_height,peak_power,coords,extra_json',
      `pv1,OnSiteGeneration,PhotovoltaicSystem,35,180,0,4,,${extraJson}`,
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).toContain('inverter_type');
    expect(result).toContain('string_inverter');
    expect(result).not.toContain('_pv_footprint_flip');
    expect(result).not.toContain('_pv_bottom_is_long');
  });

  it('should strip psi_source from extra_json before merge', () => {
    const extraJson = jsonCsvCell({ junction_type: 'E5', psi_source: 'r2', linear_thermal_transmittance: 0.16 });
    const csv = [
      'Thermal Bridging Elements,,,,,,,,',
      'Name,Zone,Type,length,linear_thermal_transmittance,coords,extra_json',
      `tb1,Living,ThermalBridgeLinear,4,0.16,,${extraJson}`,
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).toContain('junction_type');
    expect(result).toContain('linear_thermal_transmittance');
    expect(result).not.toContain('psi_source');
  });

  it('should preserve junction_preset_id and junction_preset_name on thermal bridges (evidence link)', () => {
    const extraJson = jsonCsvCell({
      junction_type: 'E5',
      floor_id: 'c4uw7eul0',
      junction_preset_id: '550e8400-e29b-41d4-a716-446655440000',
      junction_preset_name: 'Test junction',
      psi_source: 'r2',
    });
    const csv = [
      'Thermal Bridging Elements,,,,,,,,',
      'Name,Zone,Type,heat_transfer_coeff,length,linear_thermal_transmittance,parent_element,coords,extra_json',
      `Thermal Bridge,Living,ThermalBridgeLinear,,5.02,0.32,Wall,"0,0,0|1,0,0",${extraJson}`,
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).toContain('junction_preset_id');
    expect(result).toContain('550e8400-e29b-41d4-a716-446655440000');
    expect(result).toContain('junction_preset_name');
    expect(result).toContain('Test junction');
    expect(result).not.toContain('psi_source');
  });

  it('should clear the extra_json cell if _element_preset was the only key', () => {
    const extraJson = jsonCsvCell({ _element_preset: 'standard_external_wall' });
    const csv = [
      'Exposed Elements,,,,,,,,,,,,,,',
      'Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json',
      `wall1,Living,BuildingElementOpaque,12,90,5,2.4,180,0,FALSE,FALSE,,,${extraJson}`,
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).not.toContain('_element_preset');
    // The cell should be empty (trailing comma)
    const lines = result.split('\n');
    const dataLine = lines[lines.length - 1];
    expect(dataLine.endsWith(',,')).toBe(true);
  });

  it('should leave CSV unchanged when no _element_preset is present', () => {
    const extraJson = jsonCsvCell({ areal_heat_capacity: 19000 });
    const csv = [
      'Exposed Elements,,,,,,,,,,,,,,',
      'Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json',
      `wall1,Living,BuildingElementOpaque,12,90,5,2.4,180,0,FALSE,FALSE,,,${extraJson}`,
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).toBe(csv);
  });

  it('should handle rows with no extra_json column gracefully', () => {
    const csv = [
      'Zone,,,,,,,,,,,,,',
      'Name,Type,volume,floor_area,height,simplified thermal bridging',
      'Living,Zone,60,25,2.4,FALSE',
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).toBe(csv);
  });

  it('should handle multiple sections with different extra_json column positions', () => {
    const wallExtra = jsonCsvCell({ _element_preset: 'std_wall', r_value: 0.5 });
    const sysExtra = jsonCsvCell({ _element_preset: 'should_strip', capacity: 5 });
    const csv = [
      'Exposed Elements,,,,,,,,,,,,,,',
      'Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json',
      `wall1,Living,BuildingElementOpaque,12,90,5,2.4,180,0,FALSE,FALSE,,,${wallExtra}`,
      '',
      'Systems,,,,,,,',
      'Name,Zone,Type,subcategory,system_preset,coords,extra_json',
      `hp1,Living,System,HeatSourceWet,hp,,${sysExtra}`,
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).not.toContain('_element_preset');
    expect(result).toContain('r_value');
    expect(result).toContain('0.5');
    expect(result).toContain('capacity');
    expect(result).toContain('5');
  });

  it('should leave invalid JSON in extra_json cells untouched', () => {
    const csv = [
      'Exposed Elements,,,,,,,,,,,,,,',
      'Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json',
      'wall1,Living,BuildingElementOpaque,12,90,5,2.4,180,0,FALSE,FALSE,,,not valid json',
    ].join('\n');

    const result = stripUiKeysFromCsv(csv);
    expect(result).toBe(csv);
  });

  it('strips _vulcan_ui_party_element from non-exposed extra_json', () => {
    const extraJson = jsonCsvCell({ _vulcan_ui_party_element: true, u_value: 0.4 });
    const csv = [
      'Non-Exposed Elements,,,,,,,,,,,',
      'Name,Zone,Type,area,pitch,width,height,parent_element,coords,extra_json',
      `adj1,Living,BuildingElementAdjacentConditionedSpace,10,0,3,3,,"0,0,0|3,0,0",${extraJson}`,
    ].join('\n');
    const result = stripUiKeysFromCsv(csv);
    expect(result).not.toContain('_vulcan_ui_party_element');
    expect(result).toContain('u_value');
  });

  it('strips _vulcan_ui_tb_adjacent_element_id from extra_json', () => {
    const extraJson = jsonCsvCell({
      junction_type: 'P2',
      _vulcan_ui_tb_adjacent_element_id: 'adj42',
    });
    const csv = [
      'Thermal Bridging Elements,,,,,,,,',
      'Name,Zone,Type,length,linear_thermal_transmittance,coords,extra_json',
      `tb1,Living,ThermalBridgeLinear,4,0.12,,${extraJson}`,
    ].join('\n');
    const result = stripUiKeysFromCsv(csv);
    expect(result).toContain('junction_type');
    expect(result).toContain('P2');
    expect(result).not.toContain('_vulcan_ui_tb_adjacent_element_id');
    expect(result).not.toContain('adj42');
  });
});

describe('upsertScenariosBaseModelEnabledLine', () => {
  it('inserts after ComplianceValidationEnabled when key missing', () => {
    const csv = `Metadata,,,,,,,,,,,,,
ComplianceValidationEnabled,TRUE,,,,,,,,,,,,,
,,,,,,,,,,,,
Zone,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
x,Zone,1,1,1,FALSE
`;
    const out = upsertScenariosBaseModelEnabledLine(csv, false);
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.trimStart().startsWith('ScenariosBaseModelEnabled,'));
    expect(i).toBeGreaterThan(-1);
    expect(lines[i]!.split(',')[1]?.trim().toUpperCase()).toBe('FALSE');
    expect(i).toBe(
      lines.findIndex((l) => l.trimStart().startsWith('ComplianceValidationEnabled,')) + 1
    );
  });

  it('replaces existing line', () => {
    const csv = `Metadata,,,,,,,,,,,,,
ScenariosBaseModelEnabled,FALSE,,,,,,,,,,,,,
`;
    const out = upsertScenariosBaseModelEnabledLine(csv, true);
    expect(out).toMatch(/ScenariosBaseModelEnabled,TRUE,/);
    expect((out.match(/ScenariosBaseModelEnabled/g) || []).length).toBe(1);
  });
});
