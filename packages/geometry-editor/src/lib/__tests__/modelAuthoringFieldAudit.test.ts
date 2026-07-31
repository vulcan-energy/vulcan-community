// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import coreSchema from '../../../../../data/schemas/core-input.schema.json';
import fhsSchema from '../../../../../data/schemas/input_fhs.schema.json';
import {
  canonicalGeometrySchemaPort,
  configureGeometrySchemaAssetSource,
  resetGeometrySchemaAssetsForTests,
} from '../geometrySchemaPort';
import {
  collectVisibleModelAuthoringNumericFields,
  fieldPresentationGapDiagnostics,
  MODEL_AUTHORING_FIELD_CONFIGURATIONS,
} from '../modelAuthoringFieldAudit';

beforeAll(async () => {
  configureGeometrySchemaAssetSource({
    loadText: async (mode) => JSON.stringify(mode === 'fhs' ? fhsSchema : coreSchema),
  });
  await Promise.all([
    canonicalGeometrySchemaPort.preload('core'),
    canonicalGeometrySchemaPort.preload('fhs'),
  ]);
});

afterAll(() => resetGeometrySchemaAssetsForTests());

describe('model-authoring field-unit completeness', () => {
  it('derives schema and UI-only numeric fields without a test-owned field registry', () => {
    const fields = collectVisibleModelAuthoringNumericFields(canonicalGeometrySchemaPort);

    expect(fields.length).toBeGreaterThan(50);
    expect(fields.some((field) => field.propertyPath.endsWith('frame_area_fraction'))).toBe(true);
    expect(fields.some((field) => field.propertyPath.endsWith('measured_air_flow_rate'))).toBe(true);
    expect(fields.some((field) => field.propertyPath.endsWith('inverter_peak_power_dc'))).toBe(true);
    expect(fields.some((field) => field.propertyPath === 'AirPermeability_test_result')).toBe(true);
    expect(fields.some((field) => field.propertyPath === 'floorArea')).toBe(true);
    expect(fields.some((field) => field.propertyPath === '_base_height')).toBe(true);
    expect(fields.some((field) => field.propertyPath === 'service_line_z1')).toBe(true);
  });

  it('includes the representative conditional Core/FHS authoring contexts', () => {
    const keys = new Set(MODEL_AUTHORING_FIELD_CONFIGURATIONS.map((configuration) => [
      configuration.mode,
      configuration.elementType,
      configuration.subtype ?? '-',
      configuration.opaqueFabricVariant ?? '-',
    ].join('|')));

    expect(Array.from(keys)).toEqual(expect.arrayContaining([
      'core|BuildingElementOpaque|-|wall',
      'fhs|BuildingElementOpaque|-|roof',
      'core|BuildingElementOpaque|-|external_door',
      'core|BuildingElementGround|Slab_edge_insulation|-',
      'fhs|BuildingElementGround|Suspended_floor|-',
      'fhs|BuildingElementGround|Heated_basement|-',
      'core|MechanicalVentilation|MVHR|-',
      'fhs|WetEmitter|radiator|-',
      'fhs|WetEmitter|ufh|-',
      'fhs|WetEmitter|fancoil|-',
      'fhs|HotWaterDemand|Bath|-',
      'fhs|HotWaterDemand|MixerShower|-',
      'fhs|HotWaterDemand|InstantElecShower|-',
      'fhs|HotWaterDemand|OtherWaterUseDetails|-',
      'core|OnSiteGeneration|-|-',
      'fhs|ElectricBattery|-|-',
    ]));
  });

  it('resolves every visible numeric field to a normalized unit or explicit unitless semantics', () => {
    const fields = collectVisibleModelAuthoringNumericFields(canonicalGeometrySchemaPort);
    const diagnostics = fieldPresentationGapDiagnostics(fields);

    expect(
      diagnostics,
      `Unresolved/conflicting model-authoring units:\n${diagnostics.join('\n')}`,
    ).toEqual([]);
  });

  it('sorts diagnostics with mode, type, subtype, path, raw candidates, and metadata source', () => {
    const diagnostics = fieldPresentationGapDiagnostics([
      {
        configuration: { mode: 'fhs', elementType: 'Zeta', subtype: 'B' },
        propertyPath: 'z.value',
        presentation: {
          context: { mode: 'fhs', elementType: 'Zeta', subtype: 'B', propertyKey: 'value' },
          paramId: 'value',
          contextPath: undefined,
          label: 'Value',
          unit: { status: 'unresolved', reason: 'no_unit_metadata' },
          rawUnitCandidates: [],
          schemaInfo: null,
          overrideMetadata: null,
          tooltipInfo: null,
        },
      },
      {
        configuration: { mode: 'core', elementType: 'Alpha' },
        propertyPath: 'a.value',
        presentation: {
          context: { mode: 'core', elementType: 'Alpha', propertyKey: 'value' },
          paramId: 'value',
          contextPath: undefined,
          label: 'Value',
          unit: {
            status: 'conflict',
            normalizedCandidates: ['W', 'kW'],
            candidates: [
              { source: 'schema_structured', raw: 'W', normalized: 'W' },
              { source: 'override', raw: 'kW', normalized: 'kW', metadataSource: 'Alpha:value' },
            ],
          },
          rawUnitCandidates: [
            { source: 'schema_structured', raw: 'W', normalized: 'W' },
            { source: 'override', raw: 'kW', normalized: 'kW', metadataSource: 'Alpha:value' },
          ],
          schemaInfo: null,
          overrideMetadata: null,
          tooltipInfo: null,
        },
      },
    ]);

    expect(diagnostics).toEqual([
      'mode=core type=Alpha subtype=- path=a.value status=conflict raw=schema_structured:W=>W,override:kW=>kW metadata=Alpha:value',
      'mode=fhs type=Zeta subtype=B path=z.value status=unresolved raw=- metadata=-',
    ]);
  });
});
