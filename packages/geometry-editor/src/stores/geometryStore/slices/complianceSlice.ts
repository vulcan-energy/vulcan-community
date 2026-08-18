// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { StateCreator } from 'zustand';
import type { GeometryState } from '../../geometryStore';
import type { SapBuiltFormCode } from '../../../geometry/types';

export interface ComplianceSlice {
  complianceSettings: {
    PartO_active_cooling_required?: boolean;
    NumberOfBedrooms?: number;
    NumberOfWetRooms?: number;
    GroundFloorArea?: number;
    HeatingControlType?: 'SeparateTempControl' | 'SeparateTimeAndTempControl';
    PartGcompliance?: boolean;
    ColdWaterSource?: 'mains water' | 'header tank';
    complianceValidationEnabled?: boolean;
    /**
     * Optional; from CSV `ScenariosBaseModelEnabled`. When `false`, the Scenarios tab hides the base model.
     * (Worker sets on merge from strict FHS/ECaaS results.)
     */
    scenariosBaseModelEnabled?: boolean;
    // Air permeability attributes
    AirPermeability_test_pressure?: 'Standard' | 'Pulse test only';
    AirPermeability_test_result?: number;
    AirPermeability_env_area?: number;
    AirPermeability_ventilation_zone_height?: number;
    // Ventilation environment attributes (InfiltrationVentilation top-level)
    Ventilation_shield_class?: 'Open' | 'Normal' | 'Shielded';
    Ventilation_terrain_class?: 'OpenWater' | 'OpenField' | 'Suburban' | 'Urban';
    Ventilation_altitude?: number;
    Ventilation_ventilation_zone_base_height?: number;
    Ventilation_noise_nuisance?: boolean;
    /** FHS dwelling form — optional manual overrides of geometry-derived values. */
    BuildingLength?: number;
    BuildingWidth?: number;
    NumberOfHabitableRooms?: number;
    NumberOfHotTappedRooms?: number;
    NumberOfUtilityRooms?: number;
    NumberOfBathrooms?: number;
    NumberOfSanitaryAccommodations?: number;
    KitchenExtractorHoodExternal?: boolean;
    /** FHS General.build_type. Undefined means use geometry-derived suggestion when available. */
    build_type?: 'flat' | 'house';
    /** Explicit SAP 10.2 Built-Form code. Never inferred or defaulted from geometry. */
    built_form?: SapBuiltFormCode;
    /** FHS General.storeys_in_dwelling. Undefined means use geometry-derived suggestion when available. */
    storeys_in_dwelling?: number;
    /** FHS General.storey_of_dwelling. Required by FHS when build_type is flat. */
    storey_of_dwelling?: number;
    /** FHS General.storeys_in_building. Required by FHS when build_type is flat. */
    storeys_in_building?: number;
  };
  setComplianceSettings: (settings: Partial<ComplianceSlice['complianceSettings']>) => void;
  replaceComplianceSettings: (settings: Partial<ComplianceSlice['complianceSettings']>) => void;
}
export type GeometryStoreSlice = StateCreator<GeometryState, [], [], ComplianceSlice>;

/** Minimum FHS-compliant defaults for required compliance fields.
 *  Applied automatically when compliance validation is first enabled so that
 *  the model starts in a saveable state.  Users can still change every value. */
const FHS_COMPLIANCE_DEFAULTS: Partial<GeometryState['complianceSettings']> = {
  PartGcompliance: true,
  ColdWaterSource: 'mains water',
  NumberOfBedrooms: 1,
  NumberOfWetRooms: 1,
  HeatingControlType: 'SeparateTempControl',
};

export const createInitialComplianceSettings = (): GeometryState['complianceSettings'] => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = localStorage.getItem('geometry-compliance-validation-enabled');
      if (saved !== null) {
        const enabled = saved === 'true';
        return enabled
          ? { complianceValidationEnabled: true, ...FHS_COMPLIANCE_DEFAULTS }
          : { complianceValidationEnabled: false };
      }
    }
  } catch {
    // Ignore localStorage errors
  }
  // First-time user: default to FHS compliance enabled with required fields
  // pre-populated so the model is immediately in a saveable/valid state.
  return { complianceValidationEnabled: true, ...FHS_COMPLIANCE_DEFAULTS };
};

function applyFhsComplianceDefaultsIfEnabled(settings: Record<string, unknown>): void {
  if (!settings.complianceValidationEnabled) return;
  for (const [key, value] of Object.entries(FHS_COMPLIANCE_DEFAULTS)) {
    if (settings[key] === undefined) {
      settings[key] = value;
    }
  }
}

function deleteExplicitUndefined(
  target: Record<string, unknown>,
  patch: Partial<GeometryState['complianceSettings']>,
): void {
  for (const key of Object.keys(patch)) {
    if (
      Object.prototype.hasOwnProperty.call(patch, key) &&
      (patch as Record<string, unknown>)[key] === undefined
    ) {
      delete target[key];
    }
  }
}

function removeHouseOnlyFlatFields(settings: Record<string, unknown>): void {
  if (settings.build_type === 'house') {
    delete settings.storey_of_dwelling;
    delete settings.storeys_in_building;
  }
}

export const createComplianceSlice: GeometryStoreSlice = (set) => ({
  complianceSettings: createInitialComplianceSettings(),
  setComplianceSettings: (settings) => {
    set((state) => {
      const newSettings: Record<string, unknown> = { ...state.complianceSettings, ...settings };

      // Spreading `key: undefined` leaves the key present with value undefined.
      // For any field the caller explicitly set to undefined, drop the key so
      // "no override" is unambiguous for persistence and UI. This is important
      // for geometry-derived fields (GroundFloorArea, BuildingLength,
      // build_type, storeys_*, room counts) where undefined means "fall through
      // to the live geometry-derived value rather than store an override".
      deleteExplicitUndefined(newSettings, settings);

      removeHouseOnlyFlatFields(newSettings);

      if ('complianceValidationEnabled' in settings) {
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.setItem(
              'geometry-compliance-validation-enabled',
              String(settings.complianceValidationEnabled || false)
            );
          }
        } catch {
          // Ignore localStorage errors
        }

        // When compliance validation is being enabled, auto-populate any
        // required FHS fields that haven't been set yet so the user starts
        // from a valid (saveable) state rather than seeing immediate errors.
        applyFhsComplianceDefaultsIfEnabled(newSettings);
      }

      return { complianceSettings: newSettings as GeometryState['complianceSettings'] };
    });
  },
  replaceComplianceSettings: (settings) => {
    const nextSettings: Record<string, unknown> = { ...settings };
    deleteExplicitUndefined(nextSettings, settings);
    removeHouseOnlyFlatFields(nextSettings);
    applyFhsComplianceDefaultsIfEnabled(nextSettings);
    set({ complianceSettings: nextSettings as GeometryState['complianceSettings'] });
  },
});
