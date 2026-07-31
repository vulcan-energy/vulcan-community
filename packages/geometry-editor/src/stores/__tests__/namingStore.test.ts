// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAMING_PREFERENCES,
  NAMING_RULE_DEFINITIONS,
  formatAutoElementName,
  formatFloorLabel,
  formatOrientationLabel,
  type NamingPreferences,
} from '../namingStore';

const defaultPreferences = (): NamingPreferences => ({
  ...DEFAULT_NAMING_PREFERENCES,
  rules: Object.fromEntries(
    Object.entries(DEFAULT_NAMING_PREFERENCES.rules).map(([id, rule]) => [
      id,
      { ...rule, optionLabels: { ...rule.optionLabels } },
    ]),
  ) as NamingPreferences['rules'],
});

describe('namingStore', () => {
  it('formats floor labels using FHS storey numbers', () => {
    expect(formatFloorLabel(0)).toBe('F1');
    expect(formatFloorLabel(1)).toBe('F2');
    expect(formatFloorLabel(-1)).toBe('F0');
  });

  it('preserves existing auto-name formatting by default', () => {
    const preferences = defaultPreferences();

    expect(formatAutoElementName(
      { ruleId: 'externalWall', defaultLabel: 'Wall', orientation: '(S)' },
      preferences,
    )).toBe('Wall (S)');
    expect(formatAutoElementName(
      { ruleId: 'thermalBridge', defaultLabel: 'TB', detail: 'E5' },
      preferences,
    )).toBe('TB E5');
  });

  it('formats orientation labels using the selected naming style', () => {
    expect(formatOrientationLabel(180, 'short-brackets')).toBe('(S)');
    expect(formatOrientationLabel(180, 'short')).toBe('S');
    expect(formatOrientationLabel(180, 'long')).toBe('South');
    expect(formatOrientationLabel(180, 'bearing')).toBe('180 deg');
    expect(formatOrientationLabel(44.9, 'short-brackets')).toBe('(NE)');
    expect(formatOrientationLabel(359.9, 'long')).toBe('North');
  });

  it('uses one global separator and floor position for rows that include floor', () => {
    const preferences = defaultPreferences();
    preferences.includeFloor = true;
    preferences.separator = '-';
    preferences.tokenOrder = ['name', 'orientation', 'floor', 'number'];

    expect(formatAutoElementName(
      { ruleId: 'externalWall', defaultLabel: 'Wall', floor: 'F1', orientation: '(S)' },
      preferences,
    )).toBe('Wall-(S)-F1');
  });

  it('uses global token order for floor, orientation, and auto-increment number', () => {
    const preferences = defaultPreferences();
    preferences.includeFloor = true;
    preferences.separator = '-';
    preferences.tokenOrder = ['name', 'number', 'floor', 'orientation'];

    expect(formatAutoElementName(
      { ruleId: 'externalWall', defaultLabel: 'Wall', floor: 'F1', orientation: '(S)', number: '2' },
      preferences,
    )).toBe('Wall-2-F1-(S)');
  });

  it('uses global orientation switch while keeping required detail in the name', () => {
    const preferences = defaultPreferences();
    preferences.includeOrientation = false;

    expect(formatAutoElementName(
      { ruleId: 'internalWall', defaultLabel: 'Internal Wall', orientation: '(S)' },
      preferences,
    )).toBe('Internal Wall');
    expect(formatAutoElementName(
      { ruleId: 'thermalBridge', defaultLabel: 'TB', detail: 'E5' },
      preferences,
    )).toBe('TB E5');
  });

  it('does not expose a generic Element naming rule', () => {
    expect(NAMING_RULE_DEFINITIONS.map((definition) => definition.id)).not.toContain('generic');
  });

  it('does not expose unused combustion appliance naming', () => {
    expect(NAMING_RULE_DEFINITIONS.map((definition) => definition.id)).not.toContain('combustionAppliance');
  });

  it('does not group hot water demand or infiltration ventilation under system naming options', () => {
    const systemDefinition = NAMING_RULE_DEFINITIONS.find((definition) => definition.id === 'systemDerived');
    const systemOptionIds = systemDefinition?.options?.map((option) => option.id) ?? [];

    expect(systemOptionIds).not.toContain('HotWaterDemand');
    expect(systemOptionIds).not.toContain('InfiltrationVentilation');
    expect(NAMING_RULE_DEFINITIONS.map((definition) => definition.id)).toEqual(
      expect.arrayContaining(['mechanicalVentilationDerived', 'hotWaterDerived']),
    );
  });

  it('exposes adjacent surface names that the generator can emit', () => {
    const ruleIds = NAMING_RULE_DEFINITIONS.map((definition) => definition.id);
    expect(ruleIds).toEqual(expect.arrayContaining(['partyWall', 'partyFloor', 'partyCeiling']));
    expect(ruleIds).not.toContain('partyRoof');
    expect(ruleIds).not.toContain('internalRoof');
    expect(ruleIds).not.toContain('unheatedRoof');
  });

  it('uses per-option labels for derived element data', () => {
    const preferences = defaultPreferences();
    preferences.rules.systemDerived.label = 'Boiler';
    preferences.rules.systemDerived.optionLabels.HeatSourceWet = 'Heat source';
    preferences.includeFloor = true;

    expect(formatAutoElementName(
      { ruleId: 'systemDerived', defaultLabel: 'System', derivedLabel: 'Heat source wet', derivedOptionId: 'HeatSourceWet', floor: 'F1' },
      preferences,
    )).toBe('F1 Heat source');
    expect(formatAutoElementName(
      { ruleId: 'systemDerived', defaultLabel: 'System', derivedLabel: 'Heat Pump', derivedOptionId: 'Heat Pump', floor: 'F1' },
      preferences,
    )).toBe('F1 Heat Pump');
  });
});
