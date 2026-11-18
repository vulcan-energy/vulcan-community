// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { buildErrorListItems, displayBuildErrorRows, globalSettingsFieldOf, targetValidationIssues, withTargetIssues } from '../buildErrorDisplay';
import { resolveIssueTarget } from '../issueTarget';

const model = {
  zones: [{ id: 'z1', name: 'Zone 1' }],
  elements: [{ id: 'pw', name: 'Party Wall', zoneId: 'z1' }],
};

describe('targetValidationIssues', () => {
  it('lands one versioned issue per cause on its element or zone', () => {
    const { elements, zones } = targetValidationIssues({
      hemVersion: '1.0.0a8',
      items: [
        { source: 'schema', code: 'E_TARGET_INPUT', path: '/Zone/Zone 1/BuildingElement/Party Wall/thermal_resistance_construction', message: 'Supply the party-wall resistance.' },
        // A schema consequence of the same element folds under its cause.
        { source: 'schema', code: 'E026', keyword: 'required', path: '/Zone/Zone 1/BuildingElement/Party Wall', message: '"thermal_resistance_construction" is a required property' },
        { source: 'schema', code: 'E_A8_THERMAL_BRIDGING', path: '/Zone/Zone 1/ThermalBridging', message: 'HEM 1.0.0a8 requires detailed thermal-bridge records.' },
        { source: 'schema', code: 'E026', path: '/HotWaterSource/hw cylinder', message: 'not an element' },
      ],
    }, model);
    expect(elements.get('pw')).toEqual([{ message: 'Supply the party-wall resistance.', fieldKey: 'thermal_resistance_construction', source: 'schema' }]);
    expect(zones.get('z1')?.map((issue) => issue.message)).toEqual(['HEM 1.0.0a8 requires detailed thermal-bridge records.']);
    expect(elements.size + zones.size).toBe(2);
  });

  it('turns a clean live result into a badged one only when issues exist', () => {
    const clean = { hasIssues: false, issues: [], hasWarnings: false, warnings: [] };
    expect(withTargetIssues(clean, undefined)).toBe(clean);
    expect(withTargetIssues(clean, [{ message: 'x', source: 'schema' }])).toMatchObject({ hasIssues: true, issues: [{ message: 'x' }] });
  });

  it('shows a field the editor already flags once, and one version prefix', () => {
    const local = { hasIssues: true, issues: [{ message: 'U-value required', fieldKey: 'u_value', source: 'schema' as const }], hasWarnings: false, warnings: [] };
    const { elements } = targetValidationIssues({
      hemVersion: '0.13.2',
      items: [
        { source: 'schema', code: 'E_TARGET_INPUT', path: '/Zone/Zone 1/BuildingElement/Party Wall/u_value', message: 'needs its u_value.' },
        { source: 'schema', code: 'E_TARGET_INPUT', path: '/Zone/Zone 1/BuildingElement/Party Wall', message: 'HEM 2.0.0a4: Check the wall.' },
      ],
    }, model);
    expect(withTargetIssues(local, elements.get('pw')).issues.map((issue) => issue.message)).toEqual(['U-value required', 'Check the wall.']);
  });

  it('gives a missing required field to that field, so a field the editor flags shows once', () => {
    const pv = { zones: [], elements: [{ id: 'pv', name: 'PV South' }] };
    const { elements } = targetValidationIssues({
      hemVersion: '0.13.2',
      items: [{ source: 'schema', code: 'E_TARGET_INPUT', path: '/OnSiteGeneration/PV South', message: `On-Site Generation row 'PV South': "mounting_type" is a required property. There is no default; state it on its row.` }],
    }, pv);
    expect(elements.get('pv')?.[0]?.fieldKey).toBe('mounting_type');
    const local = { hasIssues: true, issues: [{ message: 'Mounting type is not set', fieldKey: 'mounting_type', source: 'geometry' as const }], hasWarnings: false, warnings: [] };
    expect(withTargetIssues(local, elements.get('pv')).issues.map((issue) => issue.message)).toEqual(['Mounting type is not set']);
  });

  it('keeps a target warning a warning: it neither blocks nor absorbs the element errors', () => {
    const { elements } = targetValidationIssues({
      hemVersion: '1.0.0a8',
      items: [
        { source: 'schema', severity: 'warning', code: 'W_TARGET_INPUT', path: '/Zone/Zone 1/BuildingElement/Party Wall/window_part_list', message: 'HEM 1.0.0a8: Check the opening height.' },
        { source: 'schema', code: 'E026', keyword: 'required', path: '/Zone/Zone 1/BuildingElement/Party Wall', message: '"u_value" is a required property' },
      ],
    }, model);
    const clean = { hasIssues: false, issues: [], hasWarnings: false, warnings: [] };
    const result = withTargetIssues(clean, elements.get('pw'));
    expect(result.warnings).toMatchObject([{ message: 'Check the opening height.', fieldKey: 'window_part_list' }]);
    expect(result.issues).toHaveLength(1);
    expect(withTargetIssues(clean, elements.get('pw')?.filter((issue) => issue.warning))).toMatchObject({ hasIssues: false, hasWarnings: true });
  });

  it('leaves lodgement evidence to the check list: it is no warning on the element', () => {
    const { elements } = targetValidationIssues({
      hemVersion: '0.13.2',
      items: [{ source: 'schema', severity: 'warning', code: 'W_TARGET_EVIDENCE', path: '/Zone/Zone 1/BuildingElement/Party Wall/u_value', message: "'Party Wall' states its U-value: 0.5. Enter it only if documented: keep the document." }],
    }, model);
    expect(elements.get('pw')).toBeUndefined();
  });
});

describe('displayBuildErrorRows', () => {
  it('words an unstated input mid-sentence, keeps proper names, and asks yes/no rows as a choice', () => {
    const message = (row: string) => displayBuildErrorRows(
      [{ source: 'schema', code: 'E_EPC_REQUIRED_INPUT', path: `/Metadata/${row}`, message: `${row} is not stated.` }],
      (path) => resolveIssueTarget(path, model),
    )[0]?.userMessage;
    expect(message('NumberOfBedrooms')).toBe('Enter number of bedrooms.');
    expect(message('PartGcompliance')).toBe('Enter Part G compliance.');
    expect(message('IsExistingBuilding')).toBe('Choose yes or no for existing building.');
    expect(message('HasElectricitySmartMeter')).toBe('Choose yes or no for electricity smart meter.');
  });

  it('asks for a light on a zone that has none', () => {
    const [row] = displayBuildErrorRows(
      [{ source: 'schema', code: 'E026', keyword: 'type', path: '/Zone/Zone 1/Lighting', message: 'null is not of type "object"' }],
      (path) => resolveIssueTarget(path, model),
    );
    expect(row).toMatchObject({ userMessage: 'Add at least one light to this zone.', target: { zoneId: 'z1' } });
  });

  it('places an existing-building fabric row where Global Settings shows it', () => {
    const [row] = displayBuildErrorRows(
      [{ source: 'schema', code: 'E_EPC_HEMIE_SETTINGS', path: '/Metadata/HEMIE_construction_external_wall', message: 'The external wall fabric default states no wall construction type.' }],
      (path) => resolveIssueTarget(path, model),
    );
    expect(row?.location).toBe('Global Settings > Fabric > External wall');
  });

  it('places air test, ventilation and dwelling rows where Global Settings shows them', () => {
    const location = (path: string) => displayBuildErrorRows(
      [{ source: 'schema', code: 'E_EPC_HEMIE_AIR_TEST', path, message: 'm' }],
      (p) => resolveIssueTarget(p, model),
    )[0]?.location;
    expect(location('/InfiltrationVentilation/Leaks')).toBe('Global Settings > Air tightness');
    expect(location('/InfiltrationVentilation/ventilation_zone_base_height')).toBe('Global Settings > Ventilation environment');
    expect(location('/InfiltrationVentilation/Leaks/ventilation_zone_height')).toBe('Global Settings > Ventilation environment');
    expect(location('/Metadata/NumberOfBedrooms')).toBe('Global Settings > Dwelling details');
  });

  it('names the HEM:EPC form groups for the same rows', () => {
    const location = (path: string) => displayBuildErrorRows(
      [{ source: 'schema', code: 'E_EPC_REQUIRED_INPUT', path, message: 'm' }],
      (p) => resolveIssueTarget(p, model),
      { epcForm: true },
    )[0]?.location;
    expect(location('/InfiltrationVentilation/Leaks')).toBe('Global Settings > Air test');
    expect(location('/InfiltrationVentilation/cross_vent_possible')).toBe('Global Settings > Site');
    expect(location('/InfiltrationVentilation/Leaks/ventilation_zone_height')).toBe('Global Settings > Site');
    expect(location('/Metadata/NumberOfBedrooms')).toBe('Global Settings > Rooms and services');
    expect(location('/Metadata/General_build_type')).toBe('Global Settings > Property');
    // An appliance presence row is the Rooms and services question, not an Appliances section.
    expect(location('/Appliances/has_dryer')).toBe('Global Settings > Rooms and services');
    // An untested building's leakage inputs are asked with the air test.
    expect(location('/Metadata/HEMIE_number_of_open_fireplaces')).toBe('Global Settings > Air test');
    expect(location('/Metadata/HEMIE_double_glazing_installation_period')).toBe('Global Settings > Air test');
    expect(location('/Metadata/HEMIE_heat_loss_corridor')).toBe('Global Settings > Air test');
  });

  it('names an unstated HEM:EPC input by its label, where the form asks it', () => {
    const [row] = displayBuildErrorRows(
      [{ source: 'schema', code: 'E_EPC_REQUIRED_INPUT', path: '/Metadata/ColdWaterSource', message: 'ColdWaterSource is not stated. Enter it in Global Settings.' }],
      (p) => resolveIssueTarget(p, model),
      { epcForm: true },
    );
    expect(row).toMatchObject({ userMessage: 'Enter cold water source.', location: 'Global Settings > Rooms and services' });
  });

  it('links a zone row to the one element its message names', () => {
    const walls = { zones: [{ id: 'z1', name: 'Floor 0' }], elements: [
      { id: 'n2', name: 'Wall (N) 2', zoneId: 'z1' }, { id: 'w', name: 'Wall (W)', zoneId: 'z1' }] };
    const [row] = displayBuildErrorRows([{ source: 'build', path: '/Zone/Floor 0',
      message: "The walls 'Wall (N) 2' do not join end to end into one closed outline." }], (p, m) => resolveIssueTarget(p, walls, m));
    expect(row?.target).toMatchObject({ zoneId: 'z1', elementId: 'n2' });
    expect(row?.target.fieldKey).toBeUndefined();
    // A schema row names fields, not elements.
    const [schema] = displayBuildErrorRows([{ source: 'schema', keyword: 'additionalProperties', path: '/Zone/Floor 0',
      message: "Additional properties are not allowed ('Wall (W)' was unexpected)" }], (p, m) => resolveIssueTarget(p, walls, m));
    expect(schema?.target.elementId).toBeUndefined();
  });
});

describe('globalSettingsFieldOf', () => {
  it('names the Global Settings field a model-settings path comes from', () => {
    expect(globalSettingsFieldOf('/Metadata/NumberOfBedrooms')).toBe('NumberOfBedrooms');
    expect(globalSettingsFieldOf('/InfiltrationVentilation/Leaks')).toBe('AirPermeability_test_result');
    expect(globalSettingsFieldOf('/InfiltrationVentilation/Leaks/test_pressure')).toBe('AirPermeability_test_pressure');
    expect(globalSettingsFieldOf('/InfiltrationVentilation/terrain_class')).toBe('Ventilation_terrain_class');
    expect(globalSettingsFieldOf('/Zone/Zone 1/Lighting')).toBeUndefined();
    expect(globalSettingsFieldOf('/Appliances/has_dishwasher')).toBe('Appliances_has_dishwasher');
    expect(globalSettingsFieldOf('/Appliances/Oven')).toBeUndefined();
    // A top-level input Global Settings asks for, named by its path.
    expect(globalSettingsFieldOf('/ElectricitySmartMeterGUID')).toBe('ElectricitySmartMeterGUID');
    expect(globalSettingsFieldOf('/Zone')).toBeUndefined();
  });

  it('places a missing top-level dwelling input at its Global Settings field, worded as the form asks', () => {
    const item = { source: 'schema' as const, keyword: 'required', path: '', message: '"NumberOfHotTappedRooms" is a required property' };
    expect(globalSettingsFieldOf(item.path, item.message)).toBe('NumberOfHotTappedRooms');
    expect(displayBuildErrorRows([item], (p) => resolveIssueTarget(p, model))[0]?.userMessage).toBe('Enter number of hot-tapped rooms.');
    expect(globalSettingsFieldOf('', '"Zone" is a required property')).toBeUndefined();
  });
});

describe('buildErrorListItems', () => {
  const live = [{ source: 'schema' as const, message: 'live' }, { source: 'schema' as const, message: 'notice', severity: 'warning' as const }];
  it("lists the last save's errors, else the live check's errors and notices, then the save's other notices", () => {
    const saved = [{ source: 'build' as const, message: 'saved' }];
    expect(buildErrorListItems(saved, live)).toBe(saved);
    const notices = [{ source: 'build' as const, message: 'n', severity: 'warning' as const }, live[1]!];
    expect(buildErrorListItems(notices, live).map((item) => item.message)).toEqual(['live', 'notice', 'n']);
    expect(buildErrorListItems([], live.slice(1)).map((item) => item.message)).toEqual(['notice']);
    expect(buildErrorListItems(notices, undefined)).toBe(notices);
  });
});
