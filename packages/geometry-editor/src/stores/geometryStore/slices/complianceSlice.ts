// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { StateCreator } from 'zustand';
import type { GeometryState } from '../../geometryStore';
import type { SapBuiltFormCode } from '../../../geometry/types';

/** Model-level product settings: Metadata rows a target that uses products reads. Kept as typed. */
export const PRODUCT_SETTING_ROWS = ['Product_radiator', 'Product_ufh', 'Product_radiator_length'] as const;
export type ProductSettingRow = (typeof PRODUCT_SETTING_ROWS)[number];

export interface ComplianceSlice {
  complianceSettings: {
    PartO_active_cooling_required?: boolean;
    NumberOfBedrooms?: number;
    NumberOfWetRooms?: number;
    GroundFloorArea?: number;
    HeatingControlType?: 'SeparateTempControl' | 'SeparateTimeAndTempControl';
    PartGcompliance?: boolean;
    ColdWaterSource?: 'mains water' | 'header tank';
    /**
     * The file's `ComplianceValidationEnabled` cell as typed: the last non-blank row, or blank when
     * every row is blank. Vulcan and the converter ignore it; the save keeps only FALSE, the switch
     * the community tools read as their core mode.
     */
    complianceValidationCell?: string;
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
    /** Metadata rows only some targets take (TARGET_INPUT_ROWS); unset means the file has no row. */
    HasElectricitySmartMeter?: boolean;
    IsExistingBuilding?: boolean;
    Ventilation_cross_vent_possible?: boolean;
    Appliances_has_dryer?: boolean;
    Appliances_has_dishwasher?: boolean;
    Appliances_has_separate_fridge_or_freezer?: boolean;
    /** FHS General.build_type. Undefined means use geometry-derived suggestion when available. */
    build_type?: string;
    /** Explicit SAP 10.2 Built-Form code. Never inferred or defaulted from geometry. */
    built_form?: SapBuiltFormCode;
    /** FHS General.storeys_in_dwelling. Undefined means use geometry-derived suggestion when available. */
    storeys_in_dwelling?: number;
    /** FHS General.storey_of_dwelling. Required by FHS when build_type is flat. */
    storey_of_dwelling?: number;
    /** FHS General.storeys_in_building. Required by FHS when build_type is flat. */
    storeys_in_building?: number;
    /** Model-input rows the loaded file has with a blank or unreadable value, by row, as in the file (see parseCsvToGeometry). */
    unreadMetadataRows?: Record<string, string>;
    /** Product settings (PRODUCT_SETTING_ROWS) as typed; the converter checks them. */
    productSettings?: Partial<Record<ProductSettingRow, string>>;
    /** Model-input rows the loaded file lacks and the defaults have not yet filled. */
    absentMetadataRows?: string[];
    /**
     * Settings a new model holds at their FHS initial value, and rows filled from the defaults, that
     * the user has not set since. A target that requires one (TargetRules.requiredMetadataRows) or
     * whose schema rejects it starts it empty instead (withoutTargetInitialValues).
     */
    initialValueRows?: string[];
    /** Settings the user emptied and has not set since: no defaults fill puts a value back. */
    clearedValueRows?: string[];
  };
  setComplianceSettings: (settings: Partial<ComplianceSlice['complianceSettings']>) => void;
  replaceComplianceSettings: (settings: Partial<ComplianceSlice['complianceSettings']>) => void;
}
export type GeometryStoreSlice = StateCreator<GeometryState, [], [], ComplianceSlice>;

/** Minimum FHS-compliant defaults for required compliance fields, so a new model starts in a
 *  saveable state. Users can still change every value. */
const FHS_COMPLIANCE_DEFAULTS: Partial<GeometryState['complianceSettings']> = {
  PartGcompliance: true,
  ColdWaterSource: 'mains water',
  NumberOfBedrooms: 1,
  NumberOfWetRooms: 1,
  HeatingControlType: 'SeparateTempControl',
};

export const createInitialComplianceSettings = (): GeometryState['complianceSettings'] => ({
  ...FHS_COMPLIANCE_DEFAULTS,
  initialValueRows: Object.keys(FHS_COMPLIANCE_DEFAULTS),
});

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
      // A row the user sets is no longer an initial value.
      const initial = state.complianceSettings.initialValueRows?.filter((key) => !(key in settings));
      if (initial) newSettings.initialValueRows = initial;
      const patch = settings as Record<string, unknown>;
      const cleared = Object.keys(patch).filter((key) => patch[key] === undefined);
      const kept = (state.complianceSettings.clearedValueRows ?? []).filter((key) => !(key in patch));
      if (cleared.length || kept.length) newSettings.clearedValueRows = [...kept, ...cleared];
      else delete newSettings.clearedValueRows;

      // Spreading `key: undefined` leaves the key present with value undefined.
      // For any field the caller explicitly set to undefined, drop the key so
      // "no override" is unambiguous for persistence and UI. This is important
      // for geometry-derived fields (GroundFloorArea, BuildingLength,
      // build_type, storeys_*, room counts) where undefined means "fall through
      // to the live geometry-derived value rather than store an override".
      deleteExplicitUndefined(newSettings, settings);

      removeHouseOnlyFlatFields(newSettings);

      return { complianceSettings: newSettings as GeometryState['complianceSettings'] };
    });
  },
  replaceComplianceSettings: (settings) => {
    const nextSettings: Record<string, unknown> = { ...settings };
    deleteExplicitUndefined(nextSettings, settings);
    removeHouseOnlyFlatFields(nextSettings);
    // A loaded file keeps exactly what it says: a value it lacks stays unset and is reported.
    set({ complianceSettings: nextSettings as GeometryState['complianceSettings'] });
  },
});
