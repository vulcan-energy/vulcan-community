// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Enriched field target definitions for batch input changes.
 *
 * Each target maps a user-facing label to:
 *  - The CSV field name (either a direct column or an extra_json key)
 *  - Which CSV sections it applies to
 *  - An optional type filter (e.g. only BuildingElementOpaque rows)
 *  - Schema-derived metadata: units, value type, constraints, description
 *
 * Aligned with FHS `input_fhs.schema.json` and `contracts/geometry-csv/geometry_csv_contract.json`
 * (not every legacy / SAP field name is batch-editable here).
 */

export type JsonValueKind = 'number' | 'string' | 'boolean';

export interface FieldTarget {
  id: string;
  /** Human-readable label shown in the dropdown */
  label: string;
  /** The property name in the CSV / extra_json (or the Metadata key when isMetadata is true) */
  field: string;
  /** Which CSV sections to search */
  sections: readonly string[];
  /** Optional: only match rows whose Type value matches (any entry, for arrays) */
  typeFilter?: string | readonly string[];
  /**
   * Serialization for extra_json writes. Derived from valueType when absent
   * (number → number, everything else → string); set explicitly for
   * boolean-in-JSON fields like security_risk.
   */
  jsonValueKind?: JsonValueKind;
  /** Grouping category for the dropdown */
  category: string;
  /** Display units (from schema description) */
  units?: string;
  /** Short description / tooltip */
  description?: string;
  /** Expected value type */
  valueType: 'number' | 'string' | 'enum';
  /** Validation constraints from the schema */
  constraints?: {
    min?: number;
    max?: number;
    enumValues?: string[];
  };
  /**
   * True when this field lives in the Metadata section (key-value format).
   * Metadata fields use extractMetadataValue / applyMetadataEdit instead of
   * the tabular section parser.
   */
  isMetadata?: boolean;
}

// ── Enums: FHS schema + `geometry_csv_contract` metadata (keep in sync with HEM) ──

export const MASS_DISTRIBUTION_CLASS_ENUM = [
  'I: Mass concentrated at internal side',
  'E: Mass concentrated at external side',
  'IE: Mass divided over internal and external side',
  'D: Mass equally distributed',
  'M: Mass concentrated inside',
] as const;

export const AREAL_HEAT_CAPACITY_ENUM = [
  'Very light',
  'Light',
  'Medium',
  'Heavy',
  'Very heavy',
] as const;

export const AIR_PERMEABILITY_TEST_PRESSURE_ENUM = ['Standard', 'Pulse test only'] as const;

export const VENTILATION_TERRAIN_CLASS_ENUM = [
  'OpenWater',
  'OpenField',
  'Suburban',
  'Urban',
] as const;

export const VENTILATION_SHIELD_CLASS_ENUM = ['Open', 'Normal', 'Shielded'] as const;

export const HEATING_CONTROL_TYPE_ENUM = [
  'SeparateTempControl',
  'SeparateTimeAndTempControl',
] as const;

/** FHS `BuildingElementOpaque.colour` — external absorbance band (not numeric `solar_absorption_coeff`). */
export const OPAQUE_SURFACE_COLOUR_ENUM = ['Light', 'Intermediate', 'Dark'] as const;

// ── Field targets ──

export const FIELD_TARGETS: readonly FieldTarget[] = [
  // ── Airtightness & Thermal Bridging (Metadata key-value fields) ──
  {
    id: 'air_permeability_test_result',
    label: 'Air Permeability Test Result',
    field: 'AirPermeability_test_result',
    sections: ['Metadata'],
    category: 'Airtightness & bridging',
    units: 'm\u00b3/h\u00b7m\u00b2',
    description: 'Air permeability at test pressure (typically 50 Pa)',
    valueType: 'number',
    constraints: { min: 0 },
    isMetadata: true,
  },
  {
    id: 'default_thermal_bridging',
    label: 'Default Thermal Bridging',
    field: 'DefaultThermalBridging',
    sections: ['Metadata'],
    category: 'Airtightness & bridging',
    units: 'W/m\u00b2K',
    description: 'Default y-value used when simplified thermal bridging is enabled',
    valueType: 'number',
    constraints: { min: 0 },
    isMetadata: true,
  },
  {
    id: 'air_permeability_test_pressure',
    label: 'Air Permeability Test Pressure',
    field: 'AirPermeability_test_pressure',
    sections: ['Metadata'],
    category: 'Airtightness & bridging',
    description: 'Test pressure regime merged into InfiltrationVentilation (FHS)',
    valueType: 'enum',
    constraints: { enumValues: [...AIR_PERMEABILITY_TEST_PRESSURE_ENUM] },
    isMetadata: true,
  },
  {
    id: 'ventilation_terrain_class',
    label: 'Ventilation Terrain Class',
    field: 'Ventilation_terrain_class',
    sections: ['Metadata'],
    category: 'Airtightness & bridging',
    description: 'Site exposure for infiltration/ventilation (FHS enum)',
    valueType: 'enum',
    constraints: { enumValues: [...VENTILATION_TERRAIN_CLASS_ENUM] },
    isMetadata: true,
  },
  {
    id: 'ventilation_shield_class',
    label: 'Ventilation Shield Class',
    field: 'Ventilation_shield_class',
    sections: ['Metadata'],
    category: 'Airtightness & bridging',
    description: 'Shielding of the building (FHS enum)',
    valueType: 'enum',
    constraints: { enumValues: [...VENTILATION_SHIELD_CLASS_ENUM] },
    isMetadata: true,
  },
  {
    id: 'ventilation_zone_base_height',
    label: 'Ventilation Zone Base Height',
    field: 'Ventilation_ventilation_zone_base_height',
    sections: ['Metadata'],
    category: 'Airtightness & bridging',
    units: 'm',
    description: 'Base height of the ventilation zone relative to external ground',
    valueType: 'number',
    constraints: { min: -150, max: 750 },
    isMetadata: true,
  },
  {
    id: 'heating_control_type',
    label: 'Heating Control Type',
    field: 'HeatingControlType',
    sections: ['Metadata'],
    category: 'Heating & controls',
    description: 'Time/temperature control category (FHS enum)',
    valueType: 'enum',
    constraints: { enumValues: [...HEATING_CONTROL_TYPE_ENUM] },
    isMetadata: true,
  },

  // ── Walls / Roofs / Doors (Opaque) ──
  {
    id: 'u_value_opaque',
    label: 'U Value',
    field: 'u_value',
    sections: ['Exposed Elements'],
    typeFilter: 'BuildingElementOpaque',
    category: 'Opaque fabric',
    units: 'W/m\u00b2K',
    description: 'Thermal transmittance of opaque building elements',
    valueType: 'number',
  },
  {
    id: 'thermal_resistance_opaque',
    label: 'Thermal Resistance Construction',
    field: 'thermal_resistance_construction',
    sections: ['Exposed Elements'],
    typeFilter: 'BuildingElementOpaque',
    category: 'Opaque fabric',
    units: 'm\u00b2K/W',
    description: 'Thermal resistance of construction (FHS: `thermal_resistance_construction` on opaque elements)',
    valueType: 'number',
  },
  {
    id: 'surface_colour_opaque',
    label: 'Colour',
    field: 'colour',
    sections: ['Exposed Elements'],
    typeFilter: 'BuildingElementOpaque',
    category: 'Opaque fabric',
    description:
      'Light / Intermediate / Dark absorbance band for solar gains (FHS). Not legacy `solar_absorption_coeff`.',
    valueType: 'enum',
    constraints: { enumValues: [...OPAQUE_SURFACE_COLOUR_ENUM] },
  },
  {
    id: 'areal_heat_capacity_opaque',
    label: 'Areal Heat Capacity',
    field: 'areal_heat_capacity',
    sections: ['Exposed Elements'],
    typeFilter: 'BuildingElementOpaque',
    category: 'Opaque fabric',
    description: 'FHS: lightweight / mass category (`BuildingElementOpaque` in Exposed section only).',
    valueType: 'enum',
    constraints: { enumValues: [...AREAL_HEAT_CAPACITY_ENUM] },
  },
  {
    id: 'mass_distribution_class_opaque',
    label: 'Mass Distribution Class',
    field: 'mass_distribution_class',
    sections: ['Exposed Elements'],
    typeFilter: 'BuildingElementOpaque',
    category: 'Opaque fabric',
    description: 'FHS `MassDistributionClass` on `BuildingElementOpaque` (exposed).',
    valueType: 'enum',
    constraints: { enumValues: [...MASS_DISTRIBUTION_CLASS_ENUM] },
  },

  // ── Windows / Transparent ──
  {
    id: 'u_value_window',
    label: 'U Value',
    field: 'u_value',
    sections: ['Window Elements'],
    typeFilter: 'BuildingElementTransparent',
    category: 'Windows',
    units: 'W/m\u00b2K',
    description: 'FHS: `u_value` on `BuildingElementTransparent` (merge path often via extra_json or assembly).',
    valueType: 'number',
  },
  {
    id: 'g_value',
    label: 'G Value',
    field: 'g_value',
    sections: ['Window Elements'],
    typeFilter: 'BuildingElementTransparent',
    category: 'Windows',
    description: 'FHS: total solar transmittance on `BuildingElementTransparent`',
    valueType: 'number',
    constraints: { min: 0, max: 1 },
  },
  {
    id: 'frame_area_fraction',
    label: 'Frame Area Fraction',
    field: 'frame_area_fraction',
    sections: ['Window Elements'],
    typeFilter: 'BuildingElementTransparent',
    category: 'Windows',
    description: 'Ratio of projected frame area to overall projected area of the glazed element',
    valueType: 'number',
    constraints: { min: 0, max: 1 },
  },
  {
    id: 'free_area_height',
    label: 'Free Area Height',
    field: 'free_area_height',
    sections: ['Window Elements'],
    typeFilter: 'BuildingElementTransparent',
    category: 'Windows',
    units: 'm',
    description: 'FHS: opening / vent height (direct column; merged for transparent).',
    valueType: 'number',
    constraints: { min: 0, max: 100 },
  },
  {
    id: 'max_window_open_area',
    label: 'Max Window Open Area',
    field: 'max_window_open_area',
    sections: ['Window Elements'],
    typeFilter: 'BuildingElementTransparent',
    category: 'Windows',
    units: 'm',
    description: 'FHS: design max openable area (direct column where present).',
    valueType: 'number',
    constraints: { min: 0, max: 100 },
  },
  {
    id: 'window_security_risk',
    label: 'Security Risk',
    field: 'security_risk',
    sections: ['Window Elements'],
    typeFilter: 'BuildingElementTransparent',
    category: 'Windows',
    description: 'FHS boolean; use CSV-style TRUE or FALSE (often in extra_json if not a column).',
    valueType: 'enum',
    constraints: { enumValues: ['TRUE', 'FALSE'] },
    jsonValueKind: 'boolean',
  },

  // ── Ground Elements ──
  {
    id: 'u_value_ground',
    label: 'U Value',
    field: 'u_value',
    sections: ['Ground Elements'],
    typeFilter: 'BuildingElementGround',
    category: 'Ground',
    units: 'W/m\u00b2K',
    description: 'FHS: `u_value` on `BuildingElementGround` (not the same R-field name as wall construction).',
    valueType: 'number',
  },
  {
    id: 'thermal_resistance_floor_ground',
    label: 'Thermal Resistance Floor Construction',
    field: 'thermal_resistance_floor_construction',
    sections: ['Ground Elements'],
    typeFilter: 'BuildingElementGround',
    category: 'Ground',
    units: 'm\u00b2K/W',
    description: 'FHS: `thermal_resistance_floor_construction` on ground elements (not `thermal_resistance_construction`).',
    valueType: 'number',
  },
  {
    id: 'psi_wall_floor_junc',
    label: 'Psi Wall Floor Junc',
    field: 'psi_wall_floor_junc',
    sections: ['Ground Elements'],
    category: 'Ground',
    units: 'W/mK',
    description: 'Linear thermal transmittance of wall-floor junction',
    valueType: 'number',
  },
  {
    id: 'height_upper_surface',
    label: 'Height Upper Surface',
    field: 'height_upper_surface',
    sections: ['Ground Elements'],
    category: 'Ground',
    units: 'm',
    description: 'Height of upper surface above external ground level',
    valueType: 'number',
  },
  {
    id: 'thermal_resist_insul_ground',
    label: 'Thermal Resist Insul',
    field: 'thermal_resist_insul',
    sections: ['Ground Elements'],
    category: 'Ground',
    units: 'm\u00b2K/W',
    description: 'Thermal resistance of edge or underfloor insulation',
    valueType: 'number',
  },
  {
    id: 'areal_heat_capacity_ground',
    label: 'Areal Heat Capacity',
    field: 'areal_heat_capacity',
    sections: ['Ground Elements'],
    typeFilter: 'BuildingElementGround',
    category: 'Ground',
    description: 'FHS mass category for ground floor element',
    valueType: 'enum',
    constraints: { enumValues: [...AREAL_HEAT_CAPACITY_ENUM] },
  },
  {
    id: 'mass_distribution_class_ground',
    label: 'Mass Distribution Class',
    field: 'mass_distribution_class',
    sections: ['Ground Elements'],
    typeFilter: 'BuildingElementGround',
    category: 'Ground',
    description: 'FHS layer mass distribution for ground element',
    valueType: 'enum',
    constraints: { enumValues: [...MASS_DISTRIBUTION_CLASS_ENUM] },
  },

  // ── Non-Exposed Elements (see `Non-Exposed Elements` + Type column in CSV) ──
  {
    id: 'u_value_adjacent_conditioned',
    label: 'U Value',
    field: 'u_value',
    sections: ['Non-Exposed Elements'],
    typeFilter: 'BuildingElementAdjacentConditionedSpace',
    category: 'Non-exposed',
    units: 'W/m\u00b2K',
    description: 'FHS: `u_value` on `BuildingElementAdjacentConditionedSpace` (party/zone boundary to conditioned).',
    valueType: 'number',
  },
  {
    id: 'u_value_adjacent_unconditioned',
    label: 'U Value',
    field: 'u_value',
    sections: ['Non-Exposed Elements'],
    typeFilter: 'BuildingElementAdjacentUnconditionedSpace_Simple',
    category: 'Non-exposed',
    units: 'W/m\u00b2K',
    description: 'FHS: `u_value` on `BuildingElementAdjacentUnconditionedSpace_Simple`.',
    valueType: 'number',
  },
  {
    id: 'u_value_party_wall',
    label: 'U Value',
    field: 'u_value',
    sections: ['Non-Exposed Elements'],
    typeFilter: 'BuildingElementPartyWall',
    category: 'Non-exposed',
    units: 'W/m\u00b2K',
    description: 'FHS: `u_value` on `BuildingElementPartyWall`.',
    valueType: 'number',
  },
  {
    id: 'areal_heat_party_wall',
    label: 'Areal Heat Capacity',
    field: 'areal_heat_capacity',
    sections: ['Non-Exposed Elements'],
    typeFilter: 'BuildingElementPartyWall',
    category: 'Non-exposed',
    description: 'FHS: `areal_heat_capacity` on `BuildingElementPartyWall` (separate from exposed opaque).',
    valueType: 'enum',
    constraints: { enumValues: [...AREAL_HEAT_CAPACITY_ENUM] },
  },
  {
    id: 'mass_distribution_party_wall',
    label: 'Mass Distribution Class',
    field: 'mass_distribution_class',
    sections: ['Non-Exposed Elements'],
    typeFilter: 'BuildingElementPartyWall',
    category: 'Non-exposed',
    description: 'FHS: `mass_distribution_class` on `BuildingElementPartyWall`.',
    valueType: 'enum',
    constraints: { enumValues: [...MASS_DISTRIBUTION_CLASS_ENUM] },
  },
  {
    id: 'thermal_resistance_nonexposed',
    label: 'Thermal Resistance Construction',
    field: 'thermal_resistance_construction',
    sections: ['Non-Exposed Elements'],
    category: 'Non-exposed',
    units: 'm\u00b2K/W',
    description:
      'FHS: `thermal_resistance_construction` on rows where it applies (adjacent and party wall types — check `Type` column in CSV).',
    valueType: 'number',
  },
  {
    id: 'areal_heat_capacity_adjacent_unconditioned',
    label: 'Areal Heat Capacity',
    field: 'areal_heat_capacity',
    sections: ['Non-Exposed Elements'],
    typeFilter: 'BuildingElementAdjacentUnconditionedSpace_Simple',
    category: 'Non-exposed',
    description: 'FHS mass category for elements adjacent to unheated spaces',
    valueType: 'enum',
    constraints: { enumValues: [...AREAL_HEAT_CAPACITY_ENUM] },
  },
  {
    id: 'mass_distribution_class_adjacent_unconditioned',
    label: 'Mass Distribution Class',
    field: 'mass_distribution_class',
    sections: ['Non-Exposed Elements'],
    typeFilter: 'BuildingElementAdjacentUnconditionedSpace_Simple',
    category: 'Non-exposed',
    description: 'FHS layer mass distribution for adjacent unconditioned elements',
    valueType: 'enum',
    constraints: { enumValues: [...MASS_DISTRIBUTION_CLASS_ENUM] },
  },
  {
    id: 'thermal_resistance_unconditioned',
    label: 'Thermal Resistance Unconditioned Space',
    field: 'thermal_resistance_unconditioned_space',
    sections: ['Non-Exposed Elements'],
    typeFilter: 'BuildingElementAdjacentUnconditionedSpace_Simple',
    category: 'Non-exposed',
    units: 'm\u00b2K/W',
    description: 'Effective thermal resistance of the unheated adjacent space',
    valueType: 'number',
  },

  // ── Lighting ──
  {
    id: 'lighting_efficacy',
    label: 'Efficacy',
    field: 'efficacy',
    sections: ['Lighting'],
    category: 'Lighting',
    units: 'lm/W',
    description: 'Luminous efficacy of the light fitting',
    valueType: 'number',
  },

  // ── Thermal bridges (per-junction; skipped for simplified-TB zones) ──
  {
    id: 'tb_linear_psi',
    label: 'Psi Value (Linear Thermal Transmittance)',
    field: 'linear_thermal_transmittance',
    sections: ['Thermal Bridging Elements'],
    typeFilter: 'ThermalBridgeLinear',
    category: 'Thermal bridges',
    units: 'W/mK',
    description:
      'Per-junction psi value on ThermalBridgeLinear rows. Rows in zones with simplified thermal bridging are ignored by the merge — use Default Thermal Bridging for those.',
    valueType: 'number',
    constraints: { min: -5, max: 5 },
  },
  {
    id: 'tb_point_heat_transfer_coeff',
    label: 'Point Bridge Heat Transfer Coefficient',
    field: 'heat_transfer_coeff',
    sections: ['Thermal Bridging Elements'],
    typeFilter: 'ThermalBridgePoint',
    category: 'Thermal bridges',
    units: 'W/K',
    description: 'Heat transfer coefficient on ThermalBridgePoint rows',
    valueType: 'number',
    constraints: { min: 0 },
  },

  // ── Window shading (rows attach to windows via linked_window) ──
  {
    id: 'shading_reveal_depth',
    label: 'Reveal Depth',
    field: 'depth',
    sections: ['Window Shading'],
    typeFilter: 'reveal',
    category: 'Window shading',
    units: 'm',
    description: 'Depth of the window reveal (Window Shading rows with Type reveal)',
    valueType: 'number',
    constraints: { min: 0 },
  },
  {
    id: 'shading_overhang_depth',
    label: 'Overhang Depth',
    field: 'depth',
    sections: ['Window Shading'],
    typeFilter: 'overhang',
    category: 'Window shading',
    units: 'm',
    description: 'Depth of the overhang above the window (Window Shading rows with Type overhang)',
    valueType: 'number',
    constraints: { min: 0 },
  },
  {
    id: 'shading_side_fin_depth',
    label: 'Side Fin Depth',
    field: 'depth',
    sections: ['Window Shading'],
    typeFilter: ['sidefinleft', 'sidefinright'],
    category: 'Window shading',
    units: 'm',
    description: 'Depth of left/right side fins (Window Shading rows with Type sidefinleft or sidefinright)',
    valueType: 'number',
    constraints: { min: 0 },
  },
];

/** True when the element type passes the target's typeFilter (no filter = match all). */
export function matchesTypeFilter(target: Pick<FieldTarget, 'typeFilter'>, type: string): boolean {
  if (!target.typeFilter) return true;
  if (typeof target.typeFilter === 'string') return type === target.typeFilter;
  return target.typeFilter.includes(type);
}

/** Serialization kind for extra_json writes, derived from the target. */
export function jsonValueKindForTarget(target: FieldTarget): JsonValueKind {
  if (target.jsonValueKind) return target.jsonValueKind;
  return target.valueType === 'number' ? 'number' : 'string';
}

/**
 * Get the unique category names in display order.
 */
export function getFieldCategories(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of FIELD_TARGETS) {
    if (!seen.has(t.category)) {
      seen.add(t.category);
      result.push(t.category);
    }
  }
  return result;
}

/**
 * Find a field target by ID.
 */
export function getFieldTargetById(id: string): FieldTarget | undefined {
  return FIELD_TARGETS.find((t) => t.id === id);
}

/**
 * Validate a string value against a field target's constraints.
 * Returns null if valid, or an error message string.
 */
export function validateFieldValue(target: FieldTarget, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Value is required';

  if (target.valueType === 'number') {
    const num = Number(trimmed);
    if (isNaN(num)) return 'Must be a valid number';
    if (target.constraints?.min !== undefined && num < target.constraints.min) {
      return `Must be at least ${target.constraints.min}`;
    }
    if (target.constraints?.max !== undefined && num > target.constraints.max) {
      return `Must be at most ${target.constraints.max}`;
    }
  }

  if (target.valueType === 'enum' && target.constraints?.enumValues) {
    if (!target.constraints.enumValues.includes(trimmed)) {
      return `Must be one of: ${target.constraints.enumValues.join(', ')}`;
    }
  }

  return null;
}
