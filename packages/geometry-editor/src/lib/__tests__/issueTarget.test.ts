// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { resolveIssueTarget } from '../issueTarget';

const model = {
  zones: [{ id: 'z1', name: 'Zone 1' }, { id: 'z2', name: 'Zone 2' }],
  elements: [
    { id: 'w1', name: 'Window 1', zoneId: 'z1' },
    { id: 'w10', name: 'Window 10', zoneId: 'z1' },
    { id: 'slash', name: 'Wall/A~B', zoneId: 'z1' },
    { id: 'other', name: 'Window 1', zoneId: 'z2' },
  ],
};

describe('resolveIssueTarget', () => {
  it('lands a mechanical ventilation issue on the named fan', () => {
    const fans = { zones: [], elements: [{ id: 'fan', name: 'Main fan' }] };
    expect(resolveIssueTarget('/InfiltrationVentilation/MechanicalVentilation/Main fan/orientation360', fans))
      .toMatchObject({ elementId: 'fan', fieldKey: 'orientation360' });
  });

  it('does not land a ductwork issue on a field Advanced deletes', () => {
    const fans = { zones: [], elements: [{ id: 'fan', name: 'Main fan' }] };
    const target = resolveIssueTarget('/InfiltrationVentilation/MechanicalVentilation/Main fan/ductwork/0/internal_diameter_mm', fans);
    expect(target).toMatchObject({ elementId: 'fan' });
    expect(target.fieldKey).toBeUndefined();
    expect(resolveIssueTarget('/InfiltrationVentilation/MechanicalVentilation/Main fan/ductwork', fans).fieldKey).toBeUndefined();
  });

  it('matches the exact element within its zone, with or without a leading slash', () => {
    expect(resolveIssueTarget('/Zone/Zone 1/BuildingElement/Window 1/mid_height', model))
      .toMatchObject({ zoneId: 'z1', elementId: 'w1', fieldKey: 'mid_height' });
    expect(resolveIssueTarget('Zone/Zone 2/BuildingElement/Window 1/mid_height', model).elementId).toBe('other');
  });

  it('decodes escaped names and drops array indices after the field', () => {
    expect(resolveIssueTarget('/Zone/Zone 1/BuildingElement/Wall~1A~0B/window_part_list/0', model))
      .toMatchObject({ elementId: 'slash', fieldKey: 'window_part_list' });
  });

  it('lands a system plant issue on the System row that holds the plant', () => {
    const tank = { id: 'tank', name: 'Storage Tank', zoneId: 'z1', extra_json: { HotWaterSource: { 'hw cylinder': { type: 'StorageTank' } } } };
    expect(resolveIssueTarget('/HotWaterSource/hw cylinder/location', { ...model, elements: [...model.elements, tank] }))
      .toMatchObject({ section: 'HotWaterSource', elementId: 'tank', fieldKey: 'location' });
    const circuit = { id: 'circuit', name: 'Heating', extra_json: { SpaceHeatSystem: { 'Zone 1 circuit': { type: 'WetDistribution' } } } };
    const rad = { id: 'rad', name: 'Rad 1' };
    const withCircuit = { ...model, elements: [...model.elements, tank, circuit, rad] };
    // The row the message names wins over the system holding it.
    expect(resolveIssueTarget('/SpaceHeatSystem/Zone 1 circuit/emitters/0/n', withCircuit, "Emitter 'Rad 1' on 'Zone 1 circuit': n is required."))
      .toMatchObject({ elementId: 'rad' });
    expect(resolveIssueTarget('/SpaceHeatSystem/Zone 1 circuit/emitters/0/n', withCircuit)).toMatchObject({ elementId: 'circuit', fieldKey: undefined });
    // Only the section the plant is in, and only one holder.
    expect(resolveIssueTarget('/HeatSourceWet/hw cylinder/location', withCircuit).elementId).toBeUndefined();
    const twoTanks = { ...model, elements: [tank, { ...tank, id: 'tank2', name: 'Tank 2' }] };
    expect(resolveIssueTarget('/HotWaterSource/hw cylinder/location', twoTanks).elementId).toBeUndefined();
  });

  it('maps zone-level keys to the zone panel and gives each object its own owner', () => {
    const bridge = resolveIssueTarget('/Zone/Zone 1/ThermalBridging', model);
    expect(bridge).toMatchObject({ zoneId: 'z1', fieldKey: 'simplifiedThermalBridging' });
    expect(bridge.elementId).toBeUndefined();
    expect(resolveIssueTarget('/Zone/Zone 1/BuildingElement/Window 1', model).ownerKey)
      .toBe(resolveIssueTarget('Zone/Zone 1/BuildingElement/Window 1/u_value', model).ownerKey);
    expect(resolveIssueTarget('/Zone/Zone 1/BuildingElement/Window 10', model).ownerKey)
      .not.toBe(resolveIssueTarget('/Zone/Zone 1/BuildingElement/Window 1', model).ownerKey);
    expect(resolveIssueTarget('/HotWaterSource/hw cylinder', model)).toMatchObject({ section: 'HotWaterSource' });
    expect(resolveIssueTarget('/OnSiteGeneration/PV 1/peak_power', { ...model, elements: [...model.elements, { id: 'pv', name: 'PV 1', zoneId: 'z1' }] }))
      .toMatchObject({ section: 'OnSiteGeneration', elementId: 'pv', fieldKey: 'peak_power' });
    expect(resolveIssueTarget('/OnSiteGeneration/Window 1', model).elementId).toBeUndefined(); // ambiguous name
    // An existing building's panel field, under panels/<n>, is the panel's own field.
    expect(resolveIssueTarget('/OnSiteGeneration/PV 1/panels/0/mounting_type', { ...model, elements: [...model.elements, { id: 'pv', name: 'PV 1', zoneId: 'z1' }] }).fieldKey)
      .toBe('mounting_type');
  });
});
