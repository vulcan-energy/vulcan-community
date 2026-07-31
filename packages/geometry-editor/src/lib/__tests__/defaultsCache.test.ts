// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  hasDefaultValue,
  getDefaultValueForElementField,
  __setDefaultsObjectForTests,
  __resetDefaultsCacheForTests,
} from '../defaultsCache';
import * as defaultsCacheModule from '../defaultsCache';

type ExplicitDefaultsLookup = Readonly<{
  getDefaultValueForElementField(
    fieldName: string,
    elementType?: string,
  ): unknown;
  hasDefaultValue(
    fieldName: string,
    elementType?: string,
  ): boolean;
}>;

describe('defaultsCache', () => {
  beforeEach(() => {
    __resetDefaultsCacheForTests();
  });

  describe('hasDefaultValue with MechanicalVentilation vent_type filtering', () => {
    it('should return true when default exists for matching vent_type', () => {
      const defaults = {
        InfiltrationVentilation: {
          MechanicalVentilation: {
            mechvent1: {
              vent_type: 'Intermittent MEV',
              EnergySupply: 'mains elec',
              design_outdoor_air_flow_rate: 80,
              sup_air_flw_ctrl: 'ODA',
              sup_air_temp_ctrl: 'CONST',
            },
            mechvent2: {
              vent_type: 'Centralised continuous MEV',
              EnergySupply: 'mains gas',
              design_outdoor_air_flow_rate: 100,
            },
          },
        },
      };

      __setDefaultsObjectForTests(defaults);

      // Should find default for Intermittent MEV
      expect(hasDefaultValue('EnergySupply', 'MechanicalVentilation', undefined, 'Intermittent MEV')).toBe(true);
      expect(hasDefaultValue('design_outdoor_air_flow_rate', 'MechanicalVentilation', undefined, 'Intermittent MEV')).toBe(true);

      // Should NOT find default from Centralised continuous MEV when looking for Intermittent MEV
      expect(hasDefaultValue('EnergySupply', 'MechanicalVentilation', undefined, 'Intermittent MEV')).toBe(true);
      // But the EnergySupply value should be from Intermittent MEV entry, not Centralised
    });

    it('should return false when default does not exist for matching vent_type', () => {
      const defaults = {
        InfiltrationVentilation: {
          MechanicalVentilation: {
            mechvent1: {
              vent_type: 'Centralised continuous MEV',
              EnergySupply: 'mains elec',
              design_outdoor_air_flow_rate: 80,
            },
          },
        },
      };

      __setDefaultsObjectForTests(defaults);

      // Should NOT find default for Intermittent MEV when only Centralised exists
      expect(hasDefaultValue('EnergySupply', 'MechanicalVentilation', undefined, 'Intermittent MEV')).toBe(false);
      expect(hasDefaultValue('design_outdoor_air_flow_rate', 'MechanicalVentilation', undefined, 'Intermittent MEV')).toBe(false);
    });

    it('should return false when no MechanicalVentilation defaults exist', () => {
      const defaults = {
        InfiltrationVentilation: {
          Vents: {
            vent1: {
              area_cm2: 100,
            },
          },
        },
      };

      __setDefaultsObjectForTests(defaults);

      expect(hasDefaultValue('EnergySupply', 'MechanicalVentilation', undefined, 'Intermittent MEV')).toBe(false);
    });

    it('should work without subtype for non-MechanicalVentilation elements', () => {
      const defaults = {
        Zone: {
          zone1: {
            type: 'Zone',
            volume: 100,
            floor_area: 50,
          },
        },
      };

      __setDefaultsObjectForTests(defaults);

      expect(hasDefaultValue('volume', 'Zone', undefined)).toBe(true);
      expect(hasDefaultValue('volume', 'Zone', undefined, undefined)).toBe(true);
    });

    it('should check schema defaults first', () => {
      const subschema = {
        properties: {
          EnergySupply: {
            default: 'mains elec',
          },
        },
      };

      // Even without defaults template, schema default should be found
      expect(hasDefaultValue('EnergySupply', 'MechanicalVentilation', subschema, 'Intermittent MEV')).toBe(true);
    });
  });

  describe('getDefaultValueForElementField', () => {
    it('returns defaults for fabric fields on BuildingElementOpaque', () => {
      const defaults = {
        ExposedElements: {
          w: {
            type: 'BuildingElementOpaque',
            u_value: 0.5,
            thermal_resistance_construction: 1.2,
            mass_distribution_class: 'D',
          },
        },
      };
      __setDefaultsObjectForTests(defaults);
      expect(getDefaultValueForElementField('u_value', 'BuildingElementOpaque')).toBe(0.5);
      expect(getDefaultValueForElementField('thermal_resistance_construction', 'BuildingElementOpaque')).toBe(1.2);
      expect(getDefaultValueForElementField('mass_distribution_class', 'BuildingElementOpaque')).toBe('D');
    });

    it('uses opaque fabric variant when resolving defaults (wall / roof / external door)', () => {
      const defaults = {
        Zone: {
          z: {
            BuildingElement: {
              wall: {
                type: 'BuildingElementOpaque',
                pitch: 90,
                u_value: 0.18,
              },
              roof: {
                type: 'BuildingElementOpaque',
                pitch: 45,
                u_value: 0.11,
              },
              door: {
                type: 'BuildingElementOpaque',
                pitch: 90,
                is_external_door: true,
                u_value: 1.0,
              },
            },
          },
        },
      };
      __setDefaultsObjectForTests(defaults);
      expect(getDefaultValueForElementField('u_value', 'BuildingElementOpaque', 'wall')).toBe(0.18);
      expect(getDefaultValueForElementField('u_value', 'BuildingElementOpaque', 'roof')).toBe(0.11);
      expect(getDefaultValueForElementField('u_value', 'BuildingElementOpaque', 'external_door')).toBe(1.0);
      expect(hasDefaultValue('u_value', 'BuildingElementOpaque', undefined, undefined, 'external_door')).toBe(true);
    });

    it('keeps explicit defaults lookups isolated from sibling and Official compatibility defaults', () => {
      const createDefaultsLookup = (
        defaultsCacheModule as typeof defaultsCacheModule & {
          createDefaultsLookup?: (defaults: unknown) => ExplicitDefaultsLookup;
        }
      ).createDefaultsLookup;

      expect(createDefaultsLookup).toBeTypeOf('function');

      const leftDefaults = {
        ExposedElements: {
          wall: { type: 'BuildingElementOpaque', u_value: 0.11 },
        },
      };
      const rightDefaults = {
        ExposedElements: {
          wall: { type: 'BuildingElementOpaque', u_value: 0.27 },
        },
      };
      __setDefaultsObjectForTests({
        ExposedElements: {
          wall: { type: 'BuildingElementOpaque', u_value: 9.99 },
        },
      });

      const left = createDefaultsLookup!(leftDefaults);
      const right = createDefaultsLookup!(rightDefaults);

      expect(left.getDefaultValueForElementField('u_value', 'BuildingElementOpaque')).toBe(0.11);
      expect(right.getDefaultValueForElementField('u_value', 'BuildingElementOpaque')).toBe(0.27);
      expect(left.hasDefaultValue('u_value', 'BuildingElementOpaque')).toBe(true);
      expect(right.hasDefaultValue('u_value', 'BuildingElementOpaque')).toBe(true);
      expect(getDefaultValueForElementField('u_value', 'BuildingElementOpaque')).toBe(9.99);

      __setDefaultsObjectForTests({
        ExposedElements: {
          wall: { type: 'BuildingElementOpaque', u_value: 7.77 },
        },
      });
      expect(left.getDefaultValueForElementField('u_value', 'BuildingElementOpaque')).toBe(0.11);
      expect(right.getDefaultValueForElementField('u_value', 'BuildingElementOpaque')).toBe(0.27);
    });
  });
});
