// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import {
  buildBulkFieldPatches,
  describeBulkFieldDistribution,
  LIGHTING_BULK_FIELD_DESCRIPTORS,
  THERMAL_BRIDGE_POINT_BULK_FIELD_DESCRIPTORS,
} from '../bulkFieldDescriptors';

const lighting = (
  id: string,
  values: Partial<{ efficacy: number; count: number; power: number; bulbs: Element['bulbs']; extra_json: Record<string, unknown> }> = {},
): Element => ({
  id,
  type: 'Lighting',
  name: id,
  coordinates: [],
  ...values,
} as Element);

const thermalBridgePoint = (id: string, heatTransferCoeff: number): Element => ({
  id,
  type: 'ThermalBridgePoint',
  name: id,
  coordinates: [{ x: 0, y: 0, z: 0 }],
  heat_transfer_coeff: heatTransferCoeff,
} as Element);

const polygonWall = (id: string): Element => ({
  id,
  type: 'BuildingElementOpaque',
  name: id,
  coordinates: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
  ],
} as Element);

describe('bulk field descriptors', () => {
  const lightingEfficacy = LIGHTING_BULK_FIELD_DESCRIPTORS.efficacy;
  const thermalBridgePointHeatTransferCoeff = THERMAL_BRIDGE_POINT_BULK_FIELD_DESCRIPTORS.heatTransferCoeff;

  it('characterizes a uniform Lighting selection through the same field descriptor', () => {
    expect(
      describeBulkFieldDistribution(
        [lighting('light-a', { efficacy: 90 }), lighting('light-b', { efficacy: 90 })],
        lightingEfficacy,
      ),
    ).toEqual({
      eligibleIds: ['light-a', 'light-b'],
      entries: [{ value: 90, count: 2 }],
    });
  });

  it('characterizes mixed Lighting values, including the legacy bulb fallback', () => {
    expect(
      describeBulkFieldDistribution(
        [
          lighting('direct', { efficacy: 120 }),
          lighting('nested', { bulbs: { led: { efficacy: 80 } } }),
          lighting('unset'),
        ],
        lightingEfficacy,
      ),
    ).toEqual({
      eligibleIds: ['direct', 'nested', 'unset'],
      entries: [
        { value: 120, count: 1 },
        { value: 80, count: 1 },
        { value: undefined, count: 1 },
      ],
    });
  });

  it('excludes ineligible types and polygon-shaped elements from thermal-bridge point patches', () => {
    const selections = [
      thermalBridgePoint('point-a', 4),
      lighting('light-a', { efficacy: 90 }),
      polygonWall('wall-a'),
    ];

    expect(
      describeBulkFieldDistribution(selections, thermalBridgePointHeatTransferCoeff),
    ).toEqual({
      eligibleIds: ['point-a'],
      entries: [{ value: 4, count: 1 }],
    });
    expect(
      buildBulkFieldPatches(selections, thermalBridgePointHeatTransferCoeff, 7.5),
    ).toEqual({
      'point-a': { heat_transfer_coeff: 7.5 },
    });
  });

  it('builds exact per-id Lighting patches without dropping sibling values or extra_json', () => {
    const selections = [
      lighting('direct', {
        efficacy: 90,
        count: 4,
        power: 8,
        extra_json: { retained: 'yes', _lighting_entry_mode: 'guided' },
      }),
      lighting('nested', {
        bulbs: { led: { efficacy: 70, count: 2, power: 6 } },
        extra_json: { retained: 'nested' },
      }),
      thermalBridgePoint('point-a', 4),
    ];

    expect(buildBulkFieldPatches(selections, lightingEfficacy, 110)).toEqual({
      direct: {
        efficacy: 110,
        count: 4,
        power: 8,
        bulbs: { led: { efficacy: 110, count: 4, power: 8 } },
        extra_json: { retained: 'yes', _lighting_entry_mode: 'detailed' },
      },
      nested: {
        efficacy: 110,
        count: 2,
        power: 6,
        bulbs: { led: { efficacy: 110, count: 2, power: 6 } },
        extra_json: { retained: 'nested', _lighting_entry_mode: 'detailed' },
      },
    });
  });
});
