// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  buildSpaceHeatSystemSampleBaselineExtraJson,
  buildSpaceHeatSystemPresetExtraJson,
  firstSpaceHeatSystemType,
  isWetDistributionSpaceHeatSystem,
  spaceHeatSystemUsesHeatSourceWet,
  updateSpaceHeatSystemHeatSourceNameInExtraJson,
} from '../systemEditorUtils';

describe('systemEditorUtils SpaceHeatSystem preset shaping', () => {
  const wetDistributionPreset = {
    SpaceHeatSystem: {
      'Space heating': {
        type: 'WetDistribution',
        thermal_mass: 0.14,
        emitters: [{ wet_emitter_type: 'Radiator' }],
        temp_diff_emit_dsgn: 10,
        variable_flow: true,
        min_flow_rate: 3,
        max_flow_rate: 18,
        HeatSource: {
          name: 'hp',
          temp_flow_limit_upper: 65,
        },
        ecodesign_controller: {
          ecodesign_control_class: 2,
          min_outdoor_temp: -4,
          max_outdoor_temp: 20,
          min_flow_temp: 30,
        },
        design_flow_temp: 55,
      },
    },
  };

  it('normalizes a library preset to the authored SpaceHeatSystem key used by the editor', () => {
    expect(
      buildSpaceHeatSystemPresetExtraJson(
        wetDistributionPreset,
        'Zone 1 UFH system',
        'Zone 1',
        'Heat pump 1',
      ),
    ).toEqual({
      SpaceHeatSystem: {
        'Zone 1 UFH system': {
          type: 'WetDistribution',
          thermal_mass: 0.14,
          temp_diff_emit_dsgn: 10,
          variable_flow: true,
          min_flow_rate: 3,
          max_flow_rate: 18,
          HeatSource: {
            name: 'Heat pump 1',
            temp_flow_limit_upper: 65,
          },
          ecodesign_controller: {
            ecodesign_control_class: 2,
            min_outdoor_temp: -4,
            max_outdoor_temp: 20,
            min_flow_temp: 30,
          },
          design_flow_temp: 55,
          Zone: 'Zone 1',
        },
      },
    });
  });

  it('updates the HeatSourceWet reference without replacing the authored system key', () => {
    const extraJson = buildSpaceHeatSystemPresetExtraJson(
      wetDistributionPreset,
      'Zone 1 UFH system',
      'Zone 1',
      'Heat pump 1',
    );

    expect(
      updateSpaceHeatSystemHeatSourceNameInExtraJson(
        extraJson,
        'Zone 1 UFH system',
        'Heat pump 2',
      ),
    ).toMatchObject({
      SpaceHeatSystem: {
        'Zone 1 UFH system': {
          HeatSource: {
            name: 'Heat pump 2',
            temp_flow_limit_upper: 65,
          },
        },
      },
    });
  });

  it('preserves direct-electric preset shape when building sample baselines', () => {
    const directElectricPreset = {
      SpaceHeatSystem: {
        instant_elec_heater: {
          type: 'InstantElecHeater',
          EnergySupply: 'mains elec',
          rated_power: 2.5,
        },
      },
    };

    expect(
      buildSpaceHeatSystemSampleBaselineExtraJson(
        directElectricPreset,
        {},
        'Instant electric heater',
        'Zone 1',
        'Heat pump 1',
      ),
    ).toEqual(directElectricPreset);
  });

  it('sets direct-electric Zone from the selected canvas zone when the preset has a Zone field', () => {
    const storageHeaterPreset = {
      SpaceHeatSystem: {
        elec_storage_heater: {
          type: 'ElecStorageHeater',
          EnergySupply: 'mains elec',
          Zone: 'Living',
          pwr_in: 2.5,
        },
      },
    };

    expect(
      buildSpaceHeatSystemSampleBaselineExtraJson(
        storageHeaterPreset,
        {},
        'Storage heater',
        'Zone 1',
        null,
      ),
    ).toEqual({
      SpaceHeatSystem: {
        elec_storage_heater: {
          type: 'ElecStorageHeater',
          EnergySupply: 'mains elec',
          Zone: 'Zone 1',
          pwr_in: 2.5,
        },
      },
    });
  });

  it('uses the current authored system key for direct-electric sample baselines when present', () => {
    const directElectricPreset = {
      SpaceHeatSystem: {
        instant_elec_heater: {
          type: 'InstantElecHeater',
          EnergySupply: 'mains elec',
          rated_power: 2.5,
        },
      },
    };

    expect(
      buildSpaceHeatSystemSampleBaselineExtraJson(
        directElectricPreset,
        {
          SpaceHeatSystem: {
            'Edited dry system': {
              type: 'InstantElecHeater',
            },
          },
        },
        'Instant electric heater',
        'Zone 1',
        'Heat pump 1',
      ),
    ).toEqual({
      SpaceHeatSystem: {
        'Edited dry system': {
          type: 'InstantElecHeater',
          EnergySupply: 'mains elec',
          rated_power: 2.5,
        },
      },
    });
  });

  it('normalizes WarmAir presets to the authored system key and linked heat source', () => {
    const warmAirPreset = {
      SpaceHeatSystem: {
        'Warm air heat pump': {
          type: 'WarmAir',
          temp_diff_emit_dsgn: 10,
          frac_convective: 0.9,
          Zone: 'Preset zone',
          HeatSource: {
            name: 'a2a_hp',
            temp_flow_limit_upper: 65,
          },
        },
      },
    };

    expect(
      buildSpaceHeatSystemSampleBaselineExtraJson(
        warmAirPreset,
        {},
        'Living warm air',
        'Zone 1',
        'custom_a2a',
      ),
    ).toEqual({
      SpaceHeatSystem: {
        'Living warm air': {
          type: 'WarmAir',
          temp_diff_emit_dsgn: 10,
          frac_convective: 0.9,
          HeatSource: {
            name: 'custom_a2a',
            temp_flow_limit_upper: 65,
          },
        },
      },
    });
  });

  it('preserves WarmAir preset heat source when no project heat source is available yet', () => {
    const warmAirPreset = {
      SpaceHeatSystem: {
        'Warm air heat pump': {
          type: 'WarmAir',
          temp_diff_emit_dsgn: 10,
          frac_convective: 0.9,
          HeatSource: {
            name: 'a2a_hp',
            temp_flow_limit_upper: 65,
          },
        },
      },
    };

    expect(
      buildSpaceHeatSystemSampleBaselineExtraJson(
        warmAirPreset,
        {},
        'Living warm air',
        'Zone 1',
        null,
      ),
    ).toEqual({
      SpaceHeatSystem: {
        'Living warm air': {
          type: 'WarmAir',
          temp_diff_emit_dsgn: 10,
          frac_convective: 0.9,
          HeatSource: {
            name: 'a2a_hp',
            temp_flow_limit_upper: 65,
          },
        },
      },
    });
  });

  it('identifies wet distribution SpaceHeatSystem payloads by their stored type', () => {
    expect(firstSpaceHeatSystemType(wetDistributionPreset)).toBe('WetDistribution');
    expect(isWetDistributionSpaceHeatSystem(wetDistributionPreset)).toBe(true);
    expect(isWetDistributionSpaceHeatSystem({
      SpaceHeatSystem: {
        instant_elec_heater: { type: 'InstantElecHeater' },
      },
    })).toBe(false);
    expect(spaceHeatSystemUsesHeatSourceWet(wetDistributionPreset)).toBe(true);
    expect(spaceHeatSystemUsesHeatSourceWet({
      SpaceHeatSystem: {
        'Warm air heat pump': { type: 'WarmAir' },
      },
    })).toBe(true);
    expect(spaceHeatSystemUsesHeatSourceWet({
      SpaceHeatSystem: {
        instant_elec_heater: { type: 'InstantElecHeater' },
      },
    })).toBe(false);
  });
});
