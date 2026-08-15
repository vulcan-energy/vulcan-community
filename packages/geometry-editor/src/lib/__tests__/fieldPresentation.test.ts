// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type {
  GeometrySchemaMode,
  GeometrySchemaParameterInfo,
  GeometrySchemaPort,
} from '../../../../../geometry-editor-host/src/schemaPort';
import {
  normalizeFieldUnit,
  resolveFieldPresentation,
} from '../fieldPresentation';
import { resolveFieldLabelContent } from '../schemaDescriptionOverrides';

function schemaInfo(
  name: string,
  options: {
    description?: string;
    units?: string;
    structuredUnits?: string;
  } = {},
): GeometrySchemaParameterInfo {
  return {
    name,
    title: name,
    description: options.description,
    type: 'number',
    units: options.units,
    jsonPath: `#/$defs/Test/properties/${name}`,
    parentKeys: ['$defs', 'Test', 'properties'],
    param: {
      type: 'number',
      ...(options.structuredUnits ? { units: options.structuredUnits } : {}),
      ...(options.description ? { description: options.description } : {}),
    },
    source: 'schema',
  };
}

function schemaPort(
  find: (
    paramId: string,
    elementType: string | undefined,
    mode: GeometrySchemaMode,
  ) => GeometrySchemaParameterInfo | null,
): GeometrySchemaPort {
  return {
    availability: 'available',
    preload: async () => undefined,
    getRootSchema: () => ({}),
    getElementSubschema: () => ({}),
    getBaseFieldsForElementType: () => [],
    getApplianceKeys: () => [],
    getStrictestIntegerKeysForElementType: () => new Set(),
    getSchemaSubtypeForElementData: () => undefined,
    getConditionalRequiredFields: () => [],
    validateProperty: () => ({ valid: true }),
    findParameter: (paramId, _contextPath, elementType, mode = 'core') =>
      find(paramId, elementType, mode),
  };
}

describe('normalizeFieldUnit', () => {
  it.each([
    ['˚', '°'],
    ['degrees', '°'],
    ['degree', '°'],
    ['deg C', '°C'],
    ['degrees C', '°C'],
    ['degrees Celsius', '°C'],
    ['° C', '°C'],
    ['l/s', 'L/s'],
    ['litres/second', 'L/s'],
    ['W/l/s', 'W/(L/s)'],
    ['W/(L/s)', 'W/(L/s)'],
    ['m3/h', 'm³/h'],
    ['m³/hour', 'm³/h'],
    ['cubic metres/hour', 'm³/h'],
    ['cubic metres per hour', 'm³/h'],
    ['W/m2K', 'W/m²·K'],
    ['W/m2.K', 'W/m²·K'],
    ['W/m²K', 'W/m²·K'],
    ['W/m².K', 'W/m²·K'],
    ['W/m²·K', 'W/m²·K'],
    ['W/mK', 'W/m·K'],
    ['W/m.K', 'W/m·K'],
    ['W / m K', 'W/m·K'],
    ['W/m·K', 'W/m·K'],
    ['m².K/W', 'm²·K/W'],
    ['J/m².K', 'J/m²·K'],
    ['kJ/m²K', 'kJ/m²·K'],
    ['Kelvin', 'K'],
    ['litre', 'L'],
    ['litre/minute', 'L/min'],
    ['Celsius', '°C'],
    ['˚C', '°C'],
    ['degrees, range: 0-360, where 0°=North, 90°=East, 180°=South, 270°=West', '°'],
    ['kWp', 'kWp'],
  ])('normalizes %s to %s without converting values', (raw, expected) => {
    expect(normalizeFieldUnit(raw)).toBe(expected);
  });
});

describe('resolveFieldPresentation', () => {
  it('prefers a structured schema unit and records every raw candidate', () => {
    const port = schemaPort((paramId) => schemaInfo(paramId, {
      description: 'Angle (unit: degrees)',
      units: 'degrees',
      structuredUnits: '˚',
    }));

    const result = resolveFieldPresentation({
      mode: 'core',
      propertyKey: 'test_angle',
      elementType: 'TestElement',
      label: 'Test angle (degrees)',
    }, port);

    expect(result.unit).toMatchObject({
      status: 'resolved',
      display: '°',
      source: 'schema_structured',
    });
    expect(result.rawUnitCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'schema_structured', raw: '˚' }),
      expect.objectContaining({ source: 'schema_description', raw: 'degrees' }),
    ]));
    expect(result.label).toBe('Test angle');
  });

  it('resolves description and unit independently when schema copy has no unit', () => {
    const port = schemaPort((paramId) => schemaInfo(paramId, {
      description: 'Measured airflow used by the selected test method.',
    }));

    const result = resolveFieldPresentation({
      mode: 'fhs',
      propertyKey: 'measured_air_flow_rate',
      elementType: 'MechanicalVentilation',
      subtype: 'MVHR',
      label: 'Measured air flow rate',
    }, port);

    expect(result.description).toBe('Measured airflow used by the selected test method.');
    expect(result.descriptionSource).toBe('schema');
    expect(result.unit).toMatchObject({
      status: 'resolved',
      display: 'L/s',
      source: 'override',
    });
  });

  it('uses a typed FHS override when schema lookup cannot reach the field', () => {
    const result = resolveFieldPresentation({
      mode: 'fhs',
      propertyKey: 'rated_power',
      elementType: 'HotWaterDemand',
      subtype: 'Bath',
      label: 'Rated power',
    }, schemaPort(() => null));

    expect(result.unit).toMatchObject({
      status: 'resolved',
      display: 'kW',
      source: 'override',
    });
    expect(result.descriptionSource).toBe('hem_guidance');
  });

  it('resolves override descriptions and units independently across scoped metadata', () => {
    const result = resolveFieldPresentation({
      mode: 'fhs',
      propertyKey: 'width',
      elementType: 'BuildingElementAdjacentConditionedSpace',
      label: 'Width (m)',
    }, schemaPort(() => null));

    expect(result.overrideMetadata?.key).toBe('width_BuildingElementAdjacentConditionedSpace');
    expect(result.unit).toMatchObject({
      status: 'resolved',
      display: 'm',
      source: 'override',
    });
  });

  it('accepts schema and override spellings that normalize to the same unit', () => {
    const result = resolveFieldPresentation({
      mode: 'fhs',
      propertyKey: 'measured_air_flow_rate',
      elementType: 'MechanicalVentilation',
      subtype: 'MVHR',
    }, schemaPort((paramId) => schemaInfo(paramId, {
      description: 'Measured airflow (unit: litres/second)',
    })));

    expect(result.unit).toMatchObject({ status: 'resolved', display: 'L/s' });
  });

  it('reports conflicting schema and override units instead of choosing silently', () => {
    const result = resolveFieldPresentation({
      mode: 'fhs',
      propertyKey: 'rated_power',
      elementType: 'HotWaterDemand',
      subtype: 'Bath',
    }, schemaPort((paramId) => schemaInfo(paramId, {
      structuredUnits: 'W',
    })));

    expect(result.unit).toMatchObject({ status: 'conflict' });
    expect(result.unit.status === 'conflict' ? result.unit.normalizedCandidates : []).toEqual(['W', 'kW']);
  });

  it('classifies fraction explicitly without percentage conversion', () => {
    const result = resolveFieldPresentation({
      mode: 'core',
      propertyKey: 'frame_area_fraction',
      elementType: 'BuildingElementTransparent',
    }, schemaPort(() => null));

    expect(result.unit).toEqual({
      status: 'resolved',
      display: 'fraction',
      source: 'semantic_fraction',
    });
  });

  it('classifies an explicitly unitless numeric field without an adornment', () => {
    const result = resolveFieldPresentation({
      mode: 'fhs',
      propertyKey: 'SFP_in_use_factor',
      elementType: 'MechanicalVentilation',
      subtype: 'MVHR',
    }, schemaPort(() => null));

    expect(result.unit).toEqual({ status: 'unitless', source: 'semantic_unitless' });
  });

  it('reports an unclassified numeric field as unresolved', () => {
    const result = resolveFieldPresentation({
      mode: 'core',
      propertyKey: 'mystery_numeric',
      elementType: 'TestElement',
    }, schemaPort(() => null));

    expect(result.unit).toMatchObject({ status: 'unresolved' });
  });

  it('keeps identical property keys isolated by concrete element context', () => {
    const port = schemaPort((paramId, elementType) => schemaInfo(paramId, {
      structuredUnits: elementType === 'Lighting' ? 'W' : 'kW',
    }));

    const lighting = resolveFieldPresentation({
      mode: 'core',
      propertyKey: 'shared_metric',
      elementType: 'Lighting',
    }, port);
    const hotWater = resolveFieldPresentation({
      mode: 'fhs',
      propertyKey: 'shared_metric',
      elementType: 'HotWaterDemand',
      subtype: 'Bath',
    }, port);

    expect(lighting.unit).toMatchObject({ status: 'resolved', display: 'W' });
    expect(hotWater.unit).toMatchObject({ status: 'resolved', display: 'kW' });
  });

  it.each([
    ['core', 'BuildingElementOpaque', undefined, 'width', 'm'],
    ['core', 'BuildingElementOpaque', undefined, 'area', 'm²'],
    ['core', 'BuildingElementOpaque', undefined, 'pitch', '°'],
    ['core', 'BuildingElementOpaque', undefined, 'u_value', 'W/m²·K'],
    ['core', 'BuildingElementOpaque', undefined, 'areal_heat_capacity', 'J/m²·K'],
    ['core', 'BuildingElementTransparent', undefined, 'frame_area_fraction', 'fraction'],
    ['core', 'BuildingElementTransparent', undefined, 'max_window_open_area', 'm²'],
    ['fhs', 'HotWaterDemand', 'MixerShower', 'flowrate', 'L/min'],
    ['fhs', 'HotWaterDemand', 'Bath', 'size', 'L'],
    ['fhs', 'HotWaterDemand', 'InstantElecShower', 'rated_power', 'kW'],
    ['fhs', 'OnSiteGeneration', undefined, 'peak_power', 'kWp'],
    ['fhs', 'OnSiteGeneration', undefined, 'pitch', '°'],
    ['fhs', 'OnSiteGeneration', undefined, 'inverter_peak_power_dc', 'kW'],
    ['fhs', 'OnSiteGeneration', undefined, 'inverter_peak_power_ac', 'kW'],
    ['core', 'Global', undefined, 'BuildingLength', 'm'],
    ['core', 'Global', undefined, 'BuildingWidth', 'm'],
    ['core', 'Global', undefined, 'GroundFloorArea', 'm²'],
    ['core', 'Global', undefined, 'AirPermeability_test_result', 'm³/(h·m²)'],
    ['fhs', 'Global', undefined, 'defaultThermalBridging', 'W/K'],
    ['core', 'Zone', undefined, 'floorArea', 'm²'],
    ['fhs', 'Zone', undefined, 'volume', 'm³'],
    ['core', 'ThermalBridgeLinear', undefined, 'tb_z0', 'm'],
    ['fhs', 'WaterPipework', undefined, 'service_line_z1', 'm'],
    ['core', 'BuildingElementOpaque', undefined, 'unheated_pitched_roof_ceiling_elevation', 'm'],
    ['core', '*', undefined, '_base_height', 'm'],
  ] as const)(
    'resolves representative %s %s/%s %s as %s',
    (mode, elementType, subtype, propertyKey, expected) => {
      const result = resolveFieldPresentation({ mode, elementType, subtype, propertyKey }, schemaPort(() => null));
      expect(result.unit).toMatchObject({ status: 'resolved', display: expected });
    },
  );

  it.each([
    ['core', 'Lighting', undefined, 'count'],
    ['fhs', 'WetEmitter', 'fancoil', 'n_units'],
    ['fhs', 'MechanicalVentilation', 'MVHR', 'SFP_in_use_factor'],
    ['core', 'Global', undefined, 'NumberOfBedrooms'],
  ] as const)('explicitly classifies unitless %s %s/%s %s', (mode, elementType, subtype, propertyKey) => {
    const result = resolveFieldPresentation({ mode, elementType, subtype, propertyKey }, schemaPort(() => null));
    expect(result.unit).toEqual({ status: 'unitless', source: 'semantic_unitless' });
  });
});

/**
 * R4.6b-3: the arms of the label content rule that NO RENDERED ROW REACHES.
 *
 * The standing rendered-row invariant (`AdvancedFieldsEditor.directRender.test.tsx`)
 * already pins every label a swept route produces, so this table deliberately does not
 * restate it. What it pins is the set of claims the rule's own docstrings make about
 * fields the sweep's fixtures never open — a solar collector's `first_order_hlc`, a heat
 * battery's `heat_storage_kJ_*`, a heat-pump test datum's `cop`, FHS's evidence-free
 * `inlet_diameter_mm` — because a rule that is only tested where it happens to fire
 * today is a rule that will be widened by the next person without noticing what it eats.
 */
describe('resolveFieldLabelContent (R4.6b-3 label content rule)', () => {
  it.each([
    // Step 2, rejection arm 1: a pydantic class name is the TYPE's name, not the field's.
    ['cross_section_shape', 'DuctShape', 'Cross Section Shape'],
    // ...but the test is narrow enough to leave a short curated title alone. `CoP` is the
    // live one: same letters as its key, two "words" by start-casing, and still copy.
    ['cop', 'CoP', 'CoP'],
    // Step 2, rejection arm 2: the title has run the key's own words together.
    ['ColdWaterSource', 'Coldwatersource', 'Cold Water Source'],
    // Same letters, same word boundaries — KEPT, and then spelled (amendment (a)).
    ['SFP_in_use_factor', 'Sfp In Use Factor', 'SFP In Use Factor'],
    // Same letters, and casing the key cannot express: kept, not degraded to "Hlc".
    ['first_order_hlc', 'First Order HLC', 'First Order HLC'],
    // One title word covering two key words, but "kJ" earns it.
    [
      'heat_storage_kJ_per_K_above_Phase_transition',
      'Heat Storage kJ Per K Above Phase Transition',
      'Heat Storage kJ Per K Above Phase Transition',
    ],
    // Different letters: curated copy, kept verbatim (Core's `ach_*` divergence).
    ['ach_max_static_calcs', 'ACH Maximum Static Calcs', 'ACH Maximum Static Calcs'],
    // Step 1: stripped where the row demonstrably still shows `mm`...
    ['external_diameter_mm', undefined, 'External Diameter'],
    // ...and NOT stripped where nothing else would show it.
    ['inlet_diameter_mm', undefined, 'Inlet Diameter Mm'],
    // Step 0: an override beats a title the rule would otherwise have to derive around.
    ['sup_air_flw_ctrl', 'SupplyAirFlowRateControlType', 'Supply Air Flow Rate Control'],
    ['test_data_EN14825', 'Test Data En14825', 'Test Data EN14825'],
    // Step 3 on a key-derived label, both spellings and both profiles' `u_value`.
    ['time_constant_onoff_operation', undefined, 'Time Constant On/Off Operation'],
    ['min_temp_diff_flow_return_for_hp_to_operate', undefined, 'Min Temp Diff Flow Return For HP To Operate'],
    ['u_value', undefined, 'U-Value'],
    ['u_value', 'U-Value', 'U-Value'],
  ] as const)('labels %s (title %s) as %s', (propertyKey, title, expected) => {
    expect(resolveFieldLabelContent(propertyKey, title)).toBe(expected);
  });
});
