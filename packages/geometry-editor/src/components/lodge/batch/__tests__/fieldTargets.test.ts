// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  FIELD_TARGETS,
  getFieldCategories,
  getFieldTargetById,
  validateFieldValue,
  matchesTypeFilter,
  jsonValueKindForTarget,
  type FieldTarget,
} from '../../../../geometry/fieldTargets';

describe('FIELD_TARGETS', () => {
  it('has unique IDs', () => {
    const ids = FIELD_TARGETS.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all targets have required fields', () => {
    for (const t of FIELD_TARGETS) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.field).toBeTruthy();
      expect(t.sections.length).toBeGreaterThan(0);
      expect(t.category).toBeTruthy();
      expect(['number', 'string', 'enum']).toContain(t.valueType);
    }
  });

  it('uses raw-field-faithful display labels for FHS fabric and window targets', () => {
    expect(getFieldTargetById('u_value_opaque')?.label).toBe('U Value');
    expect(getFieldTargetById('u_value_window')?.label).toBe('U Value');
    expect(getFieldTargetById('g_value')?.label).toBe('G Value');
    expect(getFieldTargetById('frame_area_fraction')?.label).toBe('Frame Area Fraction');
    expect(getFieldTargetById('free_area_height')?.label).toBe('Free Area Height');
    expect(getFieldTargetById('max_window_open_area')?.label).toBe('Max Window Open Area');
    expect(getFieldTargetById('security_risk')?.label).toBeUndefined();
    expect(getFieldTargetById('window_security_risk')?.label).toBe('Security Risk');
    expect(getFieldTargetById('areal_heat_capacity_opaque')?.label).toBe('Areal Heat Capacity');
    expect(getFieldTargetById('mass_distribution_class_opaque')?.label).toBe('Mass Distribution Class');
    expect(getFieldTargetById('mass_distribution_class_ground')?.label).toBe('Mass Distribution Class');
    expect(getFieldTargetById('u_value_party_wall')?.label).toBe('U Value');
    expect(getFieldTargetById('mass_distribution_party_wall')?.label).toBe('Mass Distribution Class');
    expect(getFieldTargetById('mass_distribution_class_adjacent_unconditioned')?.label).toBe('Mass Distribution Class');
  });

  it('contains the original 5 fabric targets', () => {
    const ids = FIELD_TARGETS.map((t) => t.id);
    expect(ids).toContain('u_value_opaque');
    expect(ids).toContain('u_value_ground');
    expect(ids).toContain('u_value_window');
    expect(ids).toContain('g_value');
    expect(ids).toContain('frame_area_fraction');
  });

  it('contains new expanded targets', () => {
    const ids = FIELD_TARGETS.map((t) => t.id);
    expect(ids).toContain('surface_colour_opaque');
    expect(ids).toContain('areal_heat_capacity_opaque');
    expect(ids).toContain('thermal_resistance_opaque');
    expect(ids).toContain('u_value_adjacent_conditioned');
    expect(ids).toContain('u_value_adjacent_unconditioned');
    expect(ids).toContain('u_value_party_wall');
    expect(ids).toContain('lighting_efficacy');
    expect(ids).toContain('psi_wall_floor_junc');
    expect(ids).toContain('height_upper_surface');
  });

  it('contains metadata field targets', () => {
    const ids = FIELD_TARGETS.map((t) => t.id);
    expect(ids).toContain('air_permeability_test_result');
    expect(ids).toContain('default_thermal_bridging');
    expect(ids).toContain('ventilation_zone_base_height');
  });

  it('metadata targets have isMetadata flag set', () => {
    const metaTargets = FIELD_TARGETS.filter((t) => t.isMetadata);
    expect(metaTargets.map((t) => t.id).sort()).toEqual([
      'air_permeability_test_pressure',
      'air_permeability_test_result',
      'default_thermal_bridging',
      'heating_control_type',
      'ventilation_shield_class',
      'ventilation_terrain_class',
      'ventilation_zone_base_height',
    ]);
    for (const t of metaTargets) {
      expect(t.sections).toContain('Metadata');
    }
  });

  it('non-metadata targets do not have isMetadata set', () => {
    const nonMetaTargets = FIELD_TARGETS.filter((t) => !t.isMetadata);
    expect(nonMetaTargets.length).toBeGreaterThan(0);
    for (const t of nonMetaTargets) {
      expect(t.isMetadata).toBeFalsy();
    }
  });

  it('enum targets have non-empty enumValues', () => {
    for (const t of FIELD_TARGETS) {
      if (t.valueType === 'enum') {
        expect(t.constraints?.enumValues?.length, `target ${t.id} enum`).toBeGreaterThan(0);
      }
    }
  });

  it('exposes a stable field catalog (ids) for batch coverage reviews', () => {
    const ids = FIELD_TARGETS.map((t) => t.id).sort();
    expect(ids).toMatchInlineSnapshot(`
      [
        "air_permeability_test_pressure",
        "air_permeability_test_result",
        "areal_heat_capacity_adjacent_unconditioned",
        "areal_heat_capacity_ground",
        "areal_heat_capacity_opaque",
        "areal_heat_party_wall",
        "default_thermal_bridging",
        "frame_area_fraction",
        "free_area_height",
        "g_value",
        "heating_control_type",
        "height_upper_surface",
        "lighting_efficacy",
        "mass_distribution_class_adjacent_unconditioned",
        "mass_distribution_class_ground",
        "mass_distribution_class_opaque",
        "mass_distribution_party_wall",
        "max_window_open_area",
        "psi_wall_floor_junc",
        "shading_overhang_depth",
        "shading_reveal_depth",
        "shading_side_fin_depth",
        "surface_colour_opaque",
        "tb_linear_psi",
        "tb_point_heat_transfer_coeff",
        "thermal_resist_insul_ground",
        "thermal_resistance_floor_ground",
        "thermal_resistance_nonexposed",
        "thermal_resistance_opaque",
        "thermal_resistance_unconditioned",
        "u_value_adjacent_conditioned",
        "u_value_adjacent_unconditioned",
        "u_value_ground",
        "u_value_opaque",
        "u_value_party_wall",
        "u_value_window",
        "ventilation_shield_class",
        "ventilation_terrain_class",
        "ventilation_zone_base_height",
        "window_security_risk",
      ]
    `);
  });

  it('contains per-junction thermal bridge targets', () => {
    const psi = getFieldTargetById('tb_linear_psi')!;
    expect(psi.field).toBe('linear_thermal_transmittance');
    expect(psi.sections).toContain('Thermal Bridging Elements');
    expect(psi.typeFilter).toBe('ThermalBridgeLinear');
    // Psi values can legitimately be negative for some accredited junction details
    expect(validateFieldValue(psi, '-0.05')).toBeNull();
    expect(validateFieldValue(psi, '0.15')).toBeNull();

    const point = getFieldTargetById('tb_point_heat_transfer_coeff')!;
    expect(point.field).toBe('heat_transfer_coeff');
    expect(point.typeFilter).toBe('ThermalBridgePoint');
  });

  it('contains window shading depth targets', () => {
    const reveal = getFieldTargetById('shading_reveal_depth')!;
    expect(reveal.field).toBe('depth');
    expect(reveal.sections).toContain('Window Shading');
    expect(reveal.typeFilter).toBe('reveal');

    const overhang = getFieldTargetById('shading_overhang_depth')!;
    expect(overhang.typeFilter).toBe('overhang');

    const sideFin = getFieldTargetById('shading_side_fin_depth')!;
    expect(sideFin.typeFilter).toEqual(['sidefinleft', 'sidefinright']);
  });

  it('all targets reference valid CSV sections', () => {
    const validSections = new Set([
      'Metadata', 'Exposed Elements', 'Window Elements', 'Ground Elements',
      'Non-Exposed Elements', 'Thermal Bridging Elements', 'Zone',
      'Window Shading', 'Lighting', 'Ventilation Systems',
      'Combustion Appliances', 'Water Pipework', 'Wet Emitters',
      'Appliances', 'Hot Water Outlets', 'Context Shading',
      'On-Site Generation', 'Systems', 'Space Labels', 'Test Section',
    ]);
    for (const t of FIELD_TARGETS) {
      for (const section of t.sections) {
        expect(validSections.has(section), `"${section}" in target "${t.id}" is not a valid CSV section`)
          .toBe(true);
      }
    }
  });
});

describe('getFieldCategories', () => {
  it('returns categories in display order', () => {
    const cats = getFieldCategories();
    expect(cats.length).toBeGreaterThanOrEqual(5);
    expect(cats[0]).toBe('Airtightness & bridging');
    // Order follows first appearance in FIELD_TARGETS (heating control sits in Metadata block)
    expect(cats[1]).toBe('Heating & controls');
    expect(cats[2]).toBe('Opaque fabric');
  });

  it('has no duplicate categories', () => {
    const cats = getFieldCategories();
    expect(new Set(cats).size).toBe(cats.length);
  });

  it('includes all expected categories', () => {
    const cats = getFieldCategories();
    expect(cats).toContain('Airtightness & bridging');
    expect(cats).toContain('Heating & controls');
    expect(cats).toContain('Opaque fabric');
    expect(cats).toContain('Windows');
    expect(cats).toContain('Ground');
    expect(cats).toContain('Non-exposed');
    expect(cats).toContain('Lighting');
    expect(cats).toContain('Thermal bridges');
    expect(cats).toContain('Window shading');
  });
});

describe('matchesTypeFilter', () => {
  it('matches everything when the target has no typeFilter', () => {
    const target = getFieldTargetById('lighting_efficacy')!;
    expect(matchesTypeFilter(target, 'anything')).toBe(true);
  });

  it('matches a single-string typeFilter exactly', () => {
    const target = getFieldTargetById('u_value_opaque')!;
    expect(matchesTypeFilter(target, 'BuildingElementOpaque')).toBe(true);
    expect(matchesTypeFilter(target, 'BuildingElementTransparent')).toBe(false);
  });

  it('matches any entry of an array typeFilter', () => {
    const target = getFieldTargetById('shading_side_fin_depth')!;
    expect(matchesTypeFilter(target, 'sidefinleft')).toBe(true);
    expect(matchesTypeFilter(target, 'sidefinright')).toBe(true);
    expect(matchesTypeFilter(target, 'reveal')).toBe(false);
  });
});

describe('jsonValueKindForTarget', () => {
  it('returns number for numeric targets', () => {
    expect(jsonValueKindForTarget(getFieldTargetById('u_value_opaque')!)).toBe('number');
    expect(jsonValueKindForTarget(getFieldTargetById('tb_linear_psi')!)).toBe('number');
  });

  it('returns string for enum targets', () => {
    expect(jsonValueKindForTarget(getFieldTargetById('surface_colour_opaque')!)).toBe('string');
    expect(jsonValueKindForTarget(getFieldTargetById('mass_distribution_class_opaque')!)).toBe('string');
  });

  it('returns boolean for the window security risk target', () => {
    expect(jsonValueKindForTarget(getFieldTargetById('window_security_risk')!)).toBe('boolean');
  });
});

describe('getFieldTargetById', () => {
  it('finds a target by ID', () => {
    const target = getFieldTargetById('u_value_opaque');
    expect(target).toBeDefined();
    expect(target!.field).toBe('u_value');
    expect(target!.category).toBe('Opaque fabric');
  });

  it('returns undefined for unknown ID', () => {
    expect(getFieldTargetById('nonexistent')).toBeUndefined();
  });
});

describe('validateFieldValue', () => {
  const numericTarget: FieldTarget = {
    id: 'test_num',
    label: 'Test Number',
    field: 'test',
    sections: ['Exposed Elements'],
    category: 'Test',
    valueType: 'number',
  };

  const constrainedTarget: FieldTarget = {
    id: 'test_constrained',
    label: 'Test Constrained',
    field: 'test',
    sections: ['Exposed Elements'],
    category: 'Test',
    valueType: 'number',
    constraints: { min: 0, max: 1 },
  };

  const enumTarget: FieldTarget = {
    id: 'test_enum',
    label: 'Test Enum',
    field: 'test',
    sections: ['Exposed Elements'],
    category: 'Test',
    valueType: 'enum',
    constraints: { enumValues: ['D', 'E', 'I', 'IE', 'M'] },
  };

  it('accepts valid numbers', () => {
    expect(validateFieldValue(numericTarget, '0.18')).toBeNull();
    expect(validateFieldValue(numericTarget, '42')).toBeNull();
    expect(validateFieldValue(numericTarget, '-5.5')).toBeNull();
    expect(validateFieldValue(numericTarget, '0')).toBeNull();
  });

  it('rejects empty values', () => {
    expect(validateFieldValue(numericTarget, '')).toBe('Value is required');
    expect(validateFieldValue(numericTarget, '   ')).toBe('Value is required');
  });

  it('rejects non-numeric input for number type', () => {
    expect(validateFieldValue(numericTarget, 'abc')).toBe('Must be a valid number');
    expect(validateFieldValue(numericTarget, 'not-a-number')).toBe('Must be a valid number');
  });

  it('validates min constraint', () => {
    expect(validateFieldValue(constrainedTarget, '-0.1')).toBe('Must be at least 0');
    expect(validateFieldValue(constrainedTarget, '0')).toBeNull();
    expect(validateFieldValue(constrainedTarget, '0.5')).toBeNull();
  });

  it('validates max constraint', () => {
    expect(validateFieldValue(constrainedTarget, '1.1')).toBe('Must be at most 1');
    expect(validateFieldValue(constrainedTarget, '1')).toBeNull();
  });

  it('validates enum values', () => {
    expect(validateFieldValue(enumTarget, 'D')).toBeNull();
    expect(validateFieldValue(enumTarget, 'IE')).toBeNull();
    expect(validateFieldValue(enumTarget, 'X')).toContain('Must be one of');
  });

  it('validates g_value target from real FIELD_TARGETS', () => {
    const gValue = getFieldTargetById('g_value')!;
    expect(validateFieldValue(gValue, '0.63')).toBeNull();
    expect(validateFieldValue(gValue, '1.1')).toBe('Must be at most 1');
    expect(validateFieldValue(gValue, '-0.1')).toBe('Must be at least 0');
  });

  it('validates surface colour (FHS enum) target', () => {
    const colour = getFieldTargetById('surface_colour_opaque')!;
    expect(validateFieldValue(colour, 'Light')).toBeNull();
    expect(validateFieldValue(colour, 'Blue')).toContain('Must be one of');
  });

  it('validates air_permeability_test_result target', () => {
    const target = getFieldTargetById('air_permeability_test_result')!;
    expect(validateFieldValue(target, '4.2')).toBeNull();
    expect(validateFieldValue(target, '0')).toBeNull();
    expect(validateFieldValue(target, '-1')).toBe('Must be at least 0');
    expect(validateFieldValue(target, 'abc')).toBe('Must be a valid number');
  });

  it('validates default_thermal_bridging target', () => {
    const target = getFieldTargetById('default_thermal_bridging')!;
    expect(validateFieldValue(target, '0.15')).toBeNull();
    expect(validateFieldValue(target, '0.08')).toBeNull();
    expect(validateFieldValue(target, '0')).toBeNull();
    expect(validateFieldValue(target, '-0.1')).toBe('Must be at least 0');
  });

  it('validates FHS areal_heat_capacity string enums', () => {
    const t = getFieldTargetById('areal_heat_capacity_opaque')!;
    expect(validateFieldValue(t, 'Medium')).toBeNull();
    expect(validateFieldValue(t, '150000')).not.toBeNull();
  });

  it('validates FHS mass_distribution_class string enums', () => {
    const t = getFieldTargetById('mass_distribution_class_opaque')!;
    expect(validateFieldValue(t, 'D: Mass equally distributed')).toBeNull();
    expect(validateFieldValue(t, 'D')).not.toBeNull();
  });

  it('validates contract metadata string enums', () => {
    expect(validateFieldValue(getFieldTargetById('air_permeability_test_pressure')!, 'Standard'))
      .toBeNull();
    expect(validateFieldValue(getFieldTargetById('ventilation_terrain_class')!, 'Suburban')).toBeNull();
    expect(validateFieldValue(getFieldTargetById('heating_control_type')!, 'SeparateTempControl'))
      .toBeNull();
  });
});
