// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { syncSpaceHeatSystemZoneNameInExtraJson } from '../spaceHeatSystemSync';

describe('syncSpaceHeatSystemZoneNameInExtraJson', () => {
  it('syncs WetDistribution Zone to the current element zone name', () => {
    const extraJson = {
      SpaceHeatSystem: {
        'Living circuit': {
          type: 'WetDistribution',
          Zone: 'Old zone',
          HeatSource: { name: 'hp' },
        },
      },
      _system_source: 'custom',
    };

    expect(syncSpaceHeatSystemZoneNameInExtraJson(extraJson, 'Living')).toEqual({
      SpaceHeatSystem: {
        'Living circuit': {
          type: 'WetDistribution',
          Zone: 'Living',
          HeatSource: { name: 'hp' },
        },
      },
      _system_source: 'custom',
    });
  });

  it('adds Zone to WetDistribution systems that do not carry one yet', () => {
    const extraJson = {
      SpaceHeatSystem: {
        'Living circuit': {
          type: 'WetDistribution',
          HeatSource: { name: 'hp' },
        },
      },
    };

    expect(syncSpaceHeatSystemZoneNameInExtraJson(extraJson, 'Living')).toEqual({
      SpaceHeatSystem: {
        'Living circuit': {
          type: 'WetDistribution',
          Zone: 'Living',
          HeatSource: { name: 'hp' },
        },
      },
    });
  });

  it('removes Zone from zoned systems when no element zone is selected', () => {
    const extraJson = {
      SpaceHeatSystem: {
        'Living circuit': {
          type: 'WetDistribution',
          Zone: 'Living',
        },
      },
    };

    expect(syncSpaceHeatSystemZoneNameInExtraJson(extraJson, '')).toEqual({
      SpaceHeatSystem: {
        'Living circuit': {
          type: 'WetDistribution',
        },
      },
    });
  });

  it('does not add Zone to InstantElecHeater payloads that do not use it', () => {
    const extraJson = {
      SpaceHeatSystem: {
        instant_elec_heater: {
          type: 'InstantElecHeater',
          rated_power: 2.5,
        },
      },
    };

    expect(syncSpaceHeatSystemZoneNameInExtraJson(extraJson, 'Living')).toBe(extraJson);
  });

  it('does not add Zone to WarmAir payloads that do not use it', () => {
    const extraJson = {
      SpaceHeatSystem: {
        'Living warm air': {
          type: 'WarmAir',
          HeatSource: { name: 'a2a_hp' },
        },
      },
    };

    expect(syncSpaceHeatSystemZoneNameInExtraJson(extraJson, 'Living')).toBe(extraJson);
  });

  it('syncs electric storage systems because their schema payload includes Zone', () => {
    const extraJson = {
      SpaceHeatSystem: {
        elec_storage_heater: {
          type: 'ElecStorageHeater',
          Zone: 'Old zone',
          n_units: 1,
        },
      },
    };

    expect(syncSpaceHeatSystemZoneNameInExtraJson(extraJson, 'Living')).toEqual({
      SpaceHeatSystem: {
        elec_storage_heater: {
          type: 'ElecStorageHeater',
          Zone: 'Living',
          n_units: 1,
        },
      },
    });
  });
});
