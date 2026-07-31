// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Field Tooltip Mapping Utility
 *
 * Maps UI field names to schema parameter IDs and provides hardcoded descriptions
 * for fields that are not in the schema (CSV-only fields that don't get merged).
 *
 * This utility is used by both MultiSelectPanel and ElementCreator to provide
 * schema-based tooltips for form fields.
 *
 * IMPORTANT: Many fields are element-type-specific. Use getFieldTooltipInfo with
 * the elementType parameter for accurate mapping.
 */

import { getHardcodedFieldInfo } from './schemaDescriptionOverrides';
import type { HardcodedFieldInfo } from './schemaDescriptionOverrides';
import {
  unavailableGeometrySchemaPort,
  type GeometrySchemaPort,
} from '../../../geometry-editor-host/src/schemaPort';

// Back-compat re-exports (audit script imports these from `fieldTooltipMap.ts`)
export { getHardcodedFieldInfo } from './schemaDescriptionOverrides';
export type { HardcodedFieldInfo } from './schemaDescriptionOverrides';

/**
 * Context paths for different element types in the schema
 */
export function getContextPathForElementType(elementType: string): string[] | undefined {
  const contextMap: Record<string, string[]> = {
    'BuildingElementOpaque': ['$defs', 'BuildingElement'],
    'BuildingElementTransparent': ['$defs', 'BuildingElement'],
    'BuildingElementGround': ['$defs', 'BuildingElement'],
    'BuildingElementAdjacentConditionedSpace': ['$defs', 'BuildingElement'],
    'BuildingElementAdjacentUnconditionedSpace_Simple': ['$defs', 'BuildingElement'],
    'BuildingElementPartyWall': ['$defs', 'BuildingElement'],
    'ThermalBridgeLinear': ['$defs', 'ThermalBridgingDetails'],
    'ThermalBridgePoint': ['$defs', 'ThermalBridgingDetails'],
    'WindowShading': ['$defs', 'WindowShadingObject'],  // WindowShadingObject is a oneOf structure
    'Lighting': ['$defs', 'ZoneLighting'],
    'MechanicalVentilationDuctwork': ['$defs', 'MechanicalVentilationDuctwork'],
    'MechanicalVentilationTerminal': ['$defs', 'MechanicalVentilationTerminal'],
    'WaterPipework': ['$defs', 'WaterPipework'],
    'WetEmitter': ['$defs', 'WetEmitter'],
    'Appliance': ['$defs', 'Appliance'],
    'HotWaterDemand': ['$defs', 'HotWaterDemand'],
    'ContextShading': ['$defs', 'ContextShading'],
    'Vents': ['$defs', 'Vents'],
    'MechanicalVentilation': ['$defs', 'MechanicalVentilation'],
    'CombustionAppliances': ['$defs', 'CombustionAppliances'],
    // Systems / On-site generation
    'OnSiteGeneration': ['$defs', 'PhotovoltaicSystem'],
    'ElectricBattery': ['$defs', 'ElectricBattery'],
  };

  return contextMap[elementType];
}

// Tooltip overrides (including UI/CSV-only fields) are centralized in `schemaDescriptionOverrides.ts`.

/**
 * Element-type-specific field mappings
 * Maps UI field labels to schema parameter IDs based on element type
 */
const ELEMENT_TYPE_FIELD_MAP: Record<string, Record<string, string>> = {
  'BuildingElementOpaque': {
    'width': 'width',
    'height': 'height',
    'area': 'area',
    'pitch': 'pitch',
    'orientation': 'orientation360',
    'orientation360': 'orientation360',
    'base_height': 'base_height',
    'is_unheated_pitched_roof': 'is_unheated_pitched_roof',
    'is_external_door': 'is_external_door',
    'colour': 'colour',
    'u_value': 'u_value',
    'areal_heat_capacity': 'areal_heat_capacity',
    'mass_distribution_class': 'mass_distribution_class',
    // Handle UI label variations (normalized from "Unheated Pitched Roof" → "unheated_pitched_roof")
    'unheated_pitched_roof': 'is_unheated_pitched_roof',
    'external_door': 'is_external_door',
    // Handle PascalCase title from schema (e.g., "MassDistributionClass" → "mass_distribution_class")
    'massdistributionclass': 'mass_distribution_class',
  },
  'BuildingElementTransparent': {
    'width': 'width',
    'height': 'height',
    'area': 'area',
    'pitch': 'pitch',
    'orientation': 'orientation360',
    'orientation360': 'orientation360',
    'base_height': 'base_height',
    'free_area_height': 'free_area_height',
    'mid_height': 'mid_height',
    'max_window_open_area': 'max_window_open_area',
    'frame_area_fraction': 'frame_area_fraction',
    /** Advanced-field schema title for `security_risk` */
    'security_risk?': 'security_risk',
  },
  'BuildingElementGround': {
    'area': 'area',
    'total_area': 'total_area',
    'perimeter': 'perimeter',
    'floor_type': 'floor_type',
    'depth_basement_floor': 'depth_basement_floor',
    'thickness_walls': 'thickness_walls',
    'pitch': 'pitch',
    'u_value': 'u_value',
    'areal_heat_capacity': 'areal_heat_capacity',
    'mass_distribution_class': 'mass_distribution_class',
    'thermal_transm_walls': 'thermal_transm_walls',
    'thermal_transmittance_walls': 'thermal_transm_walls',
    'suspended_wall_u-value': 'thermal_transm_walls',
    'suspended_wall_u_value': 'thermal_transm_walls',
  },
  'BuildingElementAdjacentConditionedSpace': {
    'width': 'width',
    'height': 'height',
    'area': 'area',
    'pitch': 'pitch',
    'u_value': 'u_value',
    'areal_heat_capacity': 'areal_heat_capacity',
    'mass_distribution_class': 'mass_distribution_class',
  },
  'BuildingElementAdjacentUnconditionedSpace_Simple': {
    'width': 'width',
    'height': 'height',
    'area': 'area',
    'pitch': 'pitch',
    'u_value': 'u_value',
    'areal_heat_capacity': 'areal_heat_capacity',
    'mass_distribution_class': 'mass_distribution_class',
  },
  'BuildingElementPartyWall': {
    'width': 'width',
    'height': 'height',
    'area': 'area',
    'pitch': 'pitch',
    'u_value': 'u_value',
    'areal_heat_capacity': 'areal_heat_capacity',
    'mass_distribution_class': 'mass_distribution_class',
    'party_wall_cavity_type': 'party_wall_cavity_type',
    'party_wall_lining_type': 'party_wall_lining_type',
    'thermal_resistance_cavity': 'thermal_resistance_cavity',
  },
  'ThermalBridgeLinear': {
    'length': 'length',
    'linear_thermal_transmittance': 'linear_thermal_transmittance',
    'junction_type': 'junction_type',
  },
  'ThermalBridgePoint': {
    'heat_transfer_coeff': 'heat_transfer_coeff',
    'heat_transfer_coefficient': 'heat_transfer_coeff', // Handle normalized label from "Heat Transfer Coefficient"
  },
  'WindowShading': {
    'shading_type': 'type',  // Schema uses 'type' as discriminator, UI uses 'shading_type'
    'type': 'type',  // Also handle direct 'type' lookup
    'depth': 'depth',
    'height': 'height',
    'distance': 'distance',
    'transparency': 'transparency',
  },
  'Lighting': {
    'efficacy': 'efficacy',
    'count': 'count',
    'power': 'power',
  },
  'MechanicalVentilationDuctwork': {
    'mvhr_unit': 'mvhr_unit',
    'parent_element': 'parent_element',
    'duct_type': 'duct_type',
    'length': 'length',
    'cross_section_shape': 'cross_section_shape',
    'duct_perimeter_mm': 'duct_perimeter_mm',
    'external_diameter_mm': 'external_diameter_mm',
    'internal_diameter_mm': 'internal_diameter_mm',
    'insulation_thermal_conductivity': 'insulation_thermal_conductivity',
    'insulation_thickness_mm': 'insulation_thickness_mm',
    'reflective': 'reflective',
  },
  'MechanicalVentilationTerminal': {
    'terminal_type': 'terminal_type',
    'mvhr_unit': 'mvhr_unit',
    'parent_element': 'parent_element',
    'mounted_on': 'mounted_on',
    'host_element': 'host_element',
    'mid_height_air_flow_path': 'mid_height_air_flow_path',
  },
  'WaterPipework': {
    'location': 'location',
    'pipe_contents': 'pipe_contents', // Schema field for pipe contents (water/air/glycol25)
    'WaterPipeContentsType': 'pipe_contents', // Handle PascalCase label variant
    'pipework_type': 'pipework_type', // CSV-only field for primary/distribution (not in schema)
    'length': 'length',
    'external_diameter_mm': 'external_diameter_mm',
    'internal_diameter_mm': 'internal_diameter_mm',
    'insulation_thickness_mm': 'insulation_thickness_mm',
    'insulation_thermal_conductivity': 'insulation_thermal_conductivity',
    'surface_reflectivity': 'surface_reflectivity',
    'Surface Reflectivity': 'surface_reflectivity', // Handle PascalCase label variant
  },
  'WetEmitter': {
    'subcategory': 'subcategory',
    'unit_number': 'unit_number',
    'area': 'area',
    'wet_emitter_type': 'wet_emitter_type',
  },
  'Appliance': {
    // Appliance schema has Energysupply, kWh_per_100cycle, etc. - not appliancekey
    // appliancekey is CSV-only
  },
  'HotWaterDemand': {
    'subcategory': 'subcategory',
    'size': 'size',
    'flowrate': 'flowrate',
    'allow_low_flowrate': 'allow_low_flowrate',
    'air_pressure_shower': 'allow_low_flowrate',
    'air_pressure_shower?': 'allow_low_flowrate',
    'rated_power': 'rated_power',
  },
  'ContextShading': {
    'shading_type': 'shading_type',
    'context_shading_shading_type': 'shading_type',  // Also handle the full field name variant
    'start_angle': 'start_angle',
    'end_angle': 'end_angle',
    'distance': 'distance',
    'height': 'height',
  },
  'Vents': {
    'mid_height_air_flow_path': 'mid_height_air_flow_path',
    'area_cm2': 'area_cm2',
    'area': 'area_cm2', // Handle "Area (cm²)" label normalization
    'orientation360': 'orientation360',
    'pitch': 'pitch',
    'parent_element': 'parent_element',
  },
  'MechanicalVentilation': {
    'vent_type': 'vent_type',
    // Advanced fields
    'Control': 'Control',
    'EnergySupply': 'EnergySupply',
    'Energysupply': 'EnergySupply', // Handle title case variant
    'energy_supply': 'EnergySupply',
    'SFP': 'SFP',
    'Sfp': 'SFP', // Handle title case variant
    'SFP_in_use_factor': 'SFP_in_use_factor',
    'sfp_in_use_factor': 'SFP_in_use_factor',
    'Sfp In Use Factor': 'SFP_in_use_factor', // Handle title case variant
    'design_outdoor_air_flow_rate': 'design_outdoor_air_flow_rate',
    'Design Outdoor Air Flow Rate': 'design_outdoor_air_flow_rate', // Handle title case variant
    'design_zone_cooling_covered_by_mech_vent': 'design_zone_cooling_covered_by_mech_vent',
    'Design Zone Cooling Covered By Mech Vent': 'design_zone_cooling_covered_by_mech_vent',
    'design_zone_heating_covered_by_mech_vent': 'design_zone_heating_covered_by_mech_vent',
    'Design Zone Heating Covered By Mech Vent': 'design_zone_heating_covered_by_mech_vent',
    'ductwork': 'ductwork',
    'Ductwork': 'ductwork', // Handle title case variant
    'mvhr_eff': 'mvhr_eff',
    'Mvhr Eff': 'mvhr_eff', // Handle title case variant
    'mvhr_location': 'mvhr_location',
    'Mvhr Location': 'mvhr_location', // Handle title case variant
    'sup_air_flw_ctrl': 'sup_air_flw_ctrl',
    'Sup Air Flw Ctrl': 'sup_air_flw_ctrl', // Handle title case variant
    'Supply Air Flow Rate Control': 'sup_air_flw_ctrl', // Handle full title variant
    'sup_air_temp_ctrl': 'sup_air_temp_ctrl',
    'Sup Air Temp Ctrl': 'sup_air_temp_ctrl', // Handle title case variant
    'Supply Air Temperature Control': 'sup_air_temp_ctrl', // Handle full title variant
    'measured_air_flow_rate': 'measured_air_flow_rate',
    'Measured Air Flow Rate': 'measured_air_flow_rate', // Handle title case variant
    'measured_fan_power': 'measured_fan_power',
    'Measured Fan Power': 'measured_fan_power', // Handle title case variant
  },
  'CombustionAppliances': {
    'appliance_type': 'appliance_type',
    'exhaust_situation': 'exhaust_situation',
    'fuel_type': 'fuel_type',
    'supply_situation': 'supply_situation',
  },
  // On-site generation (PV) - Advanced Fields UI
  'OnSiteGeneration': {
    // Core PV properties (most are base fields in main UI, but we still
    // want schema-aware tooltips for them in Advanced Fields)
    'type': 'type',
    'peak_power': 'peak_power',
    'pitch': 'pitch',
    'orientation360': 'orientation360',
    'orientation': 'orientation360',
    'base_height': 'base_height',
    'height': 'height',
    'width': 'width',
    // Generation / inverter properties
    'ventilation_strategy': 'ventilation_strategy',
    'energysupply': 'EnergySupply',
    'energy_supply': 'EnergySupply',
    'shading': 'shading',
    'inverter_peak_power_dc': 'inverter_peak_power_dc',
    'inverter_peak_power_ac': 'inverter_peak_power_ac',
    'inverter_is_inside': 'inverter_is_inside',
    'inverter_type': 'inverter_type',
  },
  // Electric battery – system object under EnergySupply
  'ElectricBattery': {
    'battery_age': 'battery_age',
    'capacity': 'capacity',
    'charge_discharge_efficiency_round_trip': 'charge_discharge_efficiency_round_trip',
    'battery_location': 'battery_location',
    'grid_charging_possible': 'grid_charging_possible',
    'maximum_charge_rate_one_way_trip': 'maximum_charge_rate_one_way_trip',
    'maximum_discharge_rate_one_way_trip': 'maximum_discharge_rate_one_way_trip',
    'minimum_charge_rate_one_way_trip': 'minimum_charge_rate_one_way_trip',
  },
};

function fieldLabelLookupCandidates(fieldLabel: string): string[] {
  const trimmed = fieldLabel.trim();
  const candidates = [trimmed];
  const pathParts = trimmed.split('·').map((part) => part.trim()).filter(Boolean);
  if (pathParts.length > 1) {
    candidates.push(pathParts[pathParts.length - 1]);
  }
  return Array.from(new Set(candidates));
}

function normalizeFieldLabelCandidate(fieldLabel: string): string {
  let normalized = fieldLabel
    .replace(/\s*\([^)]*\)\s*/g, '') // Remove units in parentheses like "(m)", "(m²)", "(degrees)"
    .replace(/:/g, '') // Remove trailing colons
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .trim();

  // Convert PascalCase to snake_case (e.g., "MassDistributionClass" → "mass_distribution_class")
  // This handles cases where JsonForms displays the title in PascalCase but schema uses snake_case
  if (normalized.match(/^[A-Z][a-zA-Z0-9]*$/)) {
    // It's PascalCase - convert to snake_case
    normalized = normalized
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2') // Insert underscore before capital letters
      .toLowerCase();
  } else {
    // Already has underscores or is lowercase - just lowercase it
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

function getSchemaParamIdForNormalizedField(
  normalized: string,
  elementType?: string,
): string | null {
  // Try element-type-specific mapping first
  if (elementType && ELEMENT_TYPE_FIELD_MAP[elementType]) {
    const typeMap = ELEMENT_TYPE_FIELD_MAP[elementType];

    // 1) Fast-path exact match on normalized key (most mappings are already normalized)
    if (typeMap[normalized]) {
      return typeMap[normalized];
    }

    // 2) Robust fallback: match case-insensitively against map keys.
    // This fixes cases where the UI label comes from schema `title` (e.g. "Sfp")
    // but our map stores "SFP"/"Sfp" while normalization produces "sfp".
    for (const [k, v] of Object.entries(typeMap)) {
      if (k.toLowerCase() === normalized) {
        return v;
      }
    }
  }

  // Fallback: try common fields that work across multiple types
  const commonFields: Record<string, string> = {
    'width': 'width',
    'height': 'height',
    'area': 'area',
    'pitch': 'pitch',
    'orientation': 'orientation360',
    'orientation360': 'orientation360',
    'base_height': 'base_height',
    'length': 'length',
    'u-value': 'u_value',
    'subcategory': 'subcategory',
    'unit_number': 'unit_number',
  };

  if (commonFields[normalized]) {
    return commonFields[normalized];
  }

  // If normalized label is already a valid schema field name, use it directly
  // This handles cases where the label matches the schema field exactly
  if (normalized.match(/^[a-z][a-z0-9_]*$/)) {
    return normalized;
  }

  return null;
}

/**
 * Map UI field label to schema parameter ID
 * Handles variations in naming (e.g., "Free Area Height (m)" → "free_area_height")
 * Uses element-type-specific mapping when available
 */
export function getSchemaParamIdForField(
  fieldLabel: string,
  elementType?: string
): string | null {
  for (const candidate of fieldLabelLookupCandidates(fieldLabel)) {
    const paramId = getSchemaParamIdForNormalizedField(
      normalizeFieldLabelCandidate(candidate),
      elementType,
    );
    if (paramId) return paramId;
  }
  return null;
}

/**
 * Get tooltip information for a field
 * Returns either schema-based info or hardcoded info
 */
export interface FieldTooltipInfo {
  paramId: string | null;
  contextPath: string[] | undefined;
  hardcodedInfo: HardcodedFieldInfo | null;
  /**
   * True when the paramId exists in the schema (even if it has no description).
   * This is used to decide whether we can show *some* schema tooltip affordance.
   */
  schemaFound: boolean;
  /**
   * True when the schema provides a non-empty description for the paramId.
   * When false, we may prefer hardcoded fallback descriptions (if available).
   */
  schemaHasDescription: boolean;
  /**
   * Back-compat alias: historically meant "schema has a usable description".
   * Prefer `schemaFound` / `schemaHasDescription` in new code.
   */
  isInSchema: boolean;
}

export function getFieldTooltipInfo(
  fieldLabel: string,
  elementType?: string,
  useFHSSchema = false,
  schemaPort: GeometrySchemaPort = unavailableGeometrySchemaPort,
): FieldTooltipInfo {
  // First, try to get schema parameter ID
  const paramId = getSchemaParamIdForField(fieldLabel, elementType);
  const contextPath = elementType ? getContextPathForElementType(elementType) : undefined;

  // Check if field has hardcoded info (not in schema)
  // Try both the original label and the normalized paramId
  const normalizedLabels = fieldLabelLookupCandidates(fieldLabel).map(normalizeFieldLabelCandidate);

  // Try schema first (schema-first approach):
  // If the schema contains a real description for this param, prefer schema tooltip.
  let schemaFound = false;
  let schemaHasDescription = false;
  if (paramId && schemaPort.availability === 'available') {
    try {
      const info = schemaPort.findParameter(
        paramId,
        contextPath,
        elementType,
        useFHSSchema ? 'fhs' : 'core',
      );
      schemaFound = !!info;
      schemaHasDescription = !!(info && info.description && info.description.trim().length > 0);
    } catch {
      // ignore; we'll fall back to hardcoded/missing
    }
  }

  // Fallback to hardcoded info (for CSV-only fields or missing schema descriptions)
  const hardcodedInfo = schemaHasDescription
    ? null
    : (getHardcodedFieldInfo(fieldLabel, elementType) ||
       normalizedLabels.map((label) => getHardcodedFieldInfo(label, elementType)).find(Boolean) ||
       (paramId ? getHardcodedFieldInfo(paramId, elementType) : null));

  const isInSchema = paramId !== null && schemaHasDescription;

  return {
    paramId,
    contextPath,
    hardcodedInfo,
    schemaFound,
    schemaHasDescription,
    isInSchema,
  };
}
