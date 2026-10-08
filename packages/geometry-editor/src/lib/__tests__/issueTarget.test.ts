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
  it('matches the exact element within its zone, with or without a leading slash', () => {
    expect(resolveIssueTarget('/Zone/Zone 1/BuildingElement/Window 1/mid_height', model))
      .toMatchObject({ zoneId: 'z1', elementId: 'w1', fieldKey: 'mid_height' });
    expect(resolveIssueTarget('Zone/Zone 2/BuildingElement/Window 1/mid_height', model).elementId).toBe('other');
  });

  it('decodes escaped names and drops array indices after the field', () => {
    expect(resolveIssueTarget('/Zone/Zone 1/BuildingElement/Wall~1A~0B/window_part_list/0', model))
      .toMatchObject({ elementId: 'slash', fieldKey: 'window_part_list' });
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
  });
});
