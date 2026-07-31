// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { getFieldTooltipInfo, getSchemaParamIdForField } from '../fieldTooltipMap';

describe('fieldTooltipMap', () => {
  it('resolves system advanced-field path labels to the leaf schema field', () => {
    expect(getSchemaParamIdForField('ecodesign_controller · ecodesign_control_class', 'System')).toBe(
      'ecodesign_control_class',
    );
    expect(getSchemaParamIdForField('ecodesign_controller · min_flow_temp', 'System')).toBe('min_flow_temp');
    expect(getSchemaParamIdForField('ecodesign_controller · min_outdoor_temp', 'System')).toBe('min_outdoor_temp');
    expect(getSchemaParamIdForField('ecodesign_controller · max_outdoor_temp', 'System')).toBe('max_outdoor_temp');
  });

  it('finds the existing Ecodesign tooltip overrides for system advanced-field labels', () => {
    const info = getFieldTooltipInfo('ecodesign_controller · min_flow_temp', 'System', true);

    expect(info.paramId).toBe('min_flow_temp');
    expect(info.hardcodedInfo?.description).toContain('Weather-compensation minimum flow temperature');
  });

  it('uses MVHR relationship tooltip copy for primary terminal labels', () => {
    expect(getFieldTooltipInfo('MVHR unit:', 'MechanicalVentilationTerminal', true).hardcodedInfo?.description).toBe(
      'Assigns this duct or terminal to the MVHR unit used in the exported model.',
    );
    expect(getFieldTooltipInfo('Mounted on:', 'MechanicalVentilationTerminal', true).hardcodedInfo?.description).toBe(
      'External wall or window that sets this terminal’s position, pitch, and orientation.',
    );
  });

  it('uses MVHR system tooltip copy for schema fields with sparse descriptions', () => {
    expect(getFieldTooltipInfo('Energy Supply', 'MechanicalVentilation', true).paramId).toBe('EnergySupply');
    expect(getFieldTooltipInfo('Sfp In Use Factor', 'MechanicalVentilation', true).paramId).toBe(
      'SFP_in_use_factor',
    );
    expect(getFieldTooltipInfo('Sfp In Use Factor', 'MechanicalVentilation', true).hardcodedInfo?.description).toContain(
      'Adjustment applied to the entered SFP',
    );
    expect(getFieldTooltipInfo('Sfp In Use Factor', 'MechanicalVentilation', true).hardcodedInfo?.description).toContain(
      'Typical values are 1–2.5',
    );
    const measuredAirFlow = getFieldTooltipInfo('Measured Air Flow Rate', 'MechanicalVentilation', true);
    expect(measuredAirFlow.hardcodedInfo?.description).toContain('litres per second');
    expect(measuredAirFlow.hardcodedInfo?.units).toBe('l/s');
    expect(
      getFieldTooltipInfo('Design Zone Cooling Covered By Mech Vent', 'MechanicalVentilation', true).hardcodedInfo
        ?.description,
    ).toContain('Design cooling load covered');
    expect(
      getFieldTooltipInfo('Design Zone Heating Covered By Mech Vent', 'MechanicalVentilation', true).hardcodedInfo
        ?.description,
    ).toContain('Design heating load covered');
  });
});
