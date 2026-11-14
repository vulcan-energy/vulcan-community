// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { flattenSystemSubtypePlantSchemas, systemPlantTypes } from '../systemSchemaFlatten';
import { __setSchemaObjectForTests, getBaseFieldsForElementType, getElementSubschemaForMode } from '../schemaCache';
import { buildSystemAdvancedUischema } from '../systemAdvancedUischema';
import epcSchema from '../../../../../data/schemas/hem_epc_orchestrator_input.schema.json';

const root = epcSchema as unknown as { properties: Record<string, { additionalProperties?: unknown; anyOf?: { additionalProperties?: unknown }[] }> };

/** One plant of an EPC section, under the shape the editor hands the flatten. */
function flatPlant(section: string, plant: Record<string, unknown>, existingBuilding: boolean) {
  const subschema = { properties: { [section]: { properties: { plant: root.properties[section].additionalProperties ?? root.properties[section].anyOf?.[0].additionalProperties } } } };
  const flat = flattenSystemSubtypePlantSchemas(subschema, section, { plant }, root, existingBuilding);
  const node = (flat.properties as Record<string, { properties: Record<string, { properties: Record<string, unknown>; required?: string[] }> }>)[section].properties.plant;
  return { node, controls: JSON.stringify(buildSystemAdvancedUischema(section, flat)) };
}

describe('an EPC plant takes the form of its type and pathway', () => {
  it('shows a new-build storage tank as editable fields, not one object box', () => {
    const { node, controls } = flatPlant('HotWaterSource', { type: 'StorageTank' }, false);
    expect(Object.keys(node.properties)).toEqual(expect.arrayContaining(['volume', 'daily_losses', 'heat_exchanger_surface_area']));
    expect(controls).toContain('/properties/volume');
    expect(controls).not.toMatch(/"scope":"#\/properties\/HotWaterSource\/properties\/plant"/);
  });

  it('shows an existing-building storage tank with its descriptors and without the converter marker', () => {
    const { node } = flatPlant('HotWaterSource', { type: 'StorageTank' }, true);
    expect(Object.keys(node.properties)).toEqual(expect.arrayContaining(['tank_volume_category', 'energy_efficiency_class', 'installation_year', 'location']));
    expect(node.properties).not.toHaveProperty('model_type');
    expect(node.required).not.toContain('model_type');
  });

  it('keeps a full-only type on an existing building', () => {
    const { node } = flatPlant('HeatSourceWet', { type: 'Boiler' }, true);
    expect(node.properties).toHaveProperty('boiler_location');
  });
});

describe('the types a system category offers', () => {
  it('come from the target schema, without the converter marker', () => {
    expect(systemPlantTypes(root, 'HotWaterSource')).toEqual(expect.arrayContaining(['StorageTank', 'CombiBoiler']));
    expect(systemPlantTypes(root, 'SpaceHeatSystem')).toContain('WetDistribution');
    expect(systemPlantTypes(root, 'SpaceHeatSystem')).not.toContain('meta');
    expect(systemPlantTypes(root, 'SpaceCoolSystem')).toContain('AirConditioning');
  });
});

describe('primary pipework on the EPC target', () => {
  it('has the pipe fields a row must state', () => {
    __setSchemaObjectForTests(epcSchema as never);
    const fields = Object.keys(getElementSubschemaForMode(false, 'WaterPipework')?.properties ?? {});
    expect(fields).toEqual(expect.arrayContaining(['external_diameter_mm', 'internal_diameter_mm', 'insulation_thickness_mm', 'insulation_thermal_conductivity', 'pipe_contents', 'surface_reflectivity']));
    expect(getBaseFieldsForElementType('WaterPipework')).toContain('length');
  });
});
