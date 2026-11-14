// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalGeometrySchemaPort, configureGeometrySchemaAssetSource, resetGeometrySchemaAssetsForTests } from '../geometrySchemaPort';
import { validateElementCore } from '../../geometry/validation/validateElement';
import {
  __setSchemaObjectForTests,
  getConditionalRequiredFieldsForMode,
  resolveElementSubschemaForProfile,
} from '../schemaCache';
import { allowedWindowShadingTypes } from '../windowOpenings';

const epc = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../../data/schemas/hem_epc_orchestrator_input.schema.json'), 'utf8'));
const mv = (subtype: string) => resolveElementSubschemaForProfile(epc, 'core', 'MechanicalVentilation', subtype)!;

describe('HEM:EPC schema resolvers', () => {
  it('shows each ventilation type its own inputs', () => {
    expect(Object.keys(mv('MVHR').properties!)).toContain('mvhr_location');
    expect(mv('MVHR').required).toContain('mvhr_location');
    expect(mv('MVHR').properties).not.toHaveProperty('vent_position');
    const intermittent = mv('Intermittent MEV');
    expect(intermittent.required).toEqual(expect.arrayContaining(["leakage_when_stopped", "SFP"]));
    expect(intermittent.properties).not.toHaveProperty('installation_type');
    expect(mv('Positive input ventilation').properties).not.toHaveProperty('leakage_when_stopped');
    expect(mv('Centralised continuous MEV').properties).toHaveProperty('installation_type');
    expect(mv('Centralised continuous MEV').properties).not.toHaveProperty('mvhr_location');
  });

  it('carries element conditions so they show while editing', () => {
    __setSchemaObjectForTests(epc);
    const roof = { pitch: 45, u_value: 0.2 };
    expect(getConditionalRequiredFieldsForMode(false, 'BuildingElementOpaque', roof)).toEqual(
      expect.arrayContaining(['is_unheated_pitched_roof', 'orientation360']),
    );
    expect(getConditionalRequiredFieldsForMode(false, 'BuildingElementOpaque', { pitch: 0, u_value: 0.2 })).not.toContain('orientation360');
    expect(getConditionalRequiredFieldsForMode(false, 'BuildingElementOpaque', { pitch: 90 })).toContain('thermal_resistance_construction');
    expect(getConditionalRequiredFieldsForMode(false, 'BuildingElementPartyWall', { party_wall_cavity_type: 'unfilled_sealed' })).toContain('party_wall_lining_type');
    __setSchemaObjectForTests(null);
  });

  it('reads window shading types from the schema, with no reveal on an existing building', () => {
    const port = {
      availability: 'available',
      getElementSubschema: (_mode: string, type: string) => resolveElementSubschemaForProfile(epc, 'core', type),
      getRootSchema: () => epc,
    } as never;
    expect(allowedWindowShadingTypes(port, 'core')).toEqual(['overhang', 'sidefinright', 'sidefinleft', 'reveal', 'object']);
    expect(allowedWindowShadingTypes(port, 'core', true)).not.toContain('reveal');
  });
});

describe('HEM:EPC conditions in the live validation', () => {
  afterAll(() => resetGeometrySchemaAssetsForTests());

  it('names U-or-R and the roof and orientation inputs while editing', async () => {
    configureGeometrySchemaAssetSource({ loadText: async () => JSON.stringify(epc) });
    await canonicalGeometrySchemaPort.preload('core');
    const wall = {
      id: 'w1', name: 'Wall', zoneId: 'z', floorId: 'f', type: 'BuildingElementOpaque', width: 3, height: 2.4, area: 7.2,
      pitch: 45, base_height: 0, coordinates: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }], isPlaceholder: false,
    };
    const UR = 'State the U-value or the thermal resistance (one, not both).';
    const run = (element: object, complianceSettings = {}) => validateElementCore(element as never, {
      schemaPort: { ...canonicalGeometrySchemaPort, targetSchemaMode: () => 'core' }, elementsById: { w1: element as never }, complianceValidationEnabled: false, complianceSettings,
    } as never).issues.map((issue) => issue.message).join('|');
    const none = run(wall);
    expect(none).toContain(UR);
    expect(none).toContain('Orientation360');
    expect(none).toContain('Is Unheated Pitched Roof');
    expect(run({ ...wall, u_value: 0.3, thermal_resistance_construction: 3 })).toContain(UR);
    expect(run({ ...wall, u_value: 0.3 })).not.toContain(UR);
  });
});
