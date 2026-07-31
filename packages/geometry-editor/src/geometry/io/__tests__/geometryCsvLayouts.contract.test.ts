// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { ElectricBattery } from '../../types';
import {
  decodePromotedExtraJsonFields,
  encodePromotedExtraJsonFields,
  EXPECTED_SECTION_HEADERS,
  PROMOTED_EXTRA_JSON_FIELDS,
  ZONE_HEADERS_BASE,
  ZONE_HEADERS_FHS,
  validateGeometrySectionHeaders,
  zoneExportHeaders,
} from '../geometryCsvLayouts';

describe('geometryCsvLayouts — export/import contract', () => {
  it('zoneExportHeaders matches validation for Zone sections', () => {
    validateGeometrySectionHeaders('Zone', [...ZONE_HEADERS_BASE]);
    validateGeometrySectionHeaders('Zone', [...ZONE_HEADERS_FHS]);
    expect(zoneExportHeaders(false)).toEqual(ZONE_HEADERS_BASE);
    expect(zoneExportHeaders(true)).toEqual(ZONE_HEADERS_FHS);
  });

  it('allows extra legacy columns when every canonical column is present', () => {
    validateGeometrySectionHeaders('Lighting', [
      'Name',
      'Zone',
      'simplified lighting',
      'efficacy',
      'count',
      'power',
      'coords',
      'extra_json',
    ]);
  });

  it('rejects Lighting when a canonical column is missing', () => {
    expect(() =>
      validateGeometrySectionHeaders('Lighting', ['Name', 'Zone', 'efficacy', 'count', 'power', 'coords']),
    ).toThrow(/missing required columns/);
  });

  it('allows legacy saved-file headers when import can default or alias safely', () => {
    validateGeometrySectionHeaders('Hot Water Outlets', [
      'Name',
      'Type',
      'subcategory',
      'flowrate',
      'size',
      'rated_power',
      'coords',
      'extra_json',
    ]);
    validateGeometrySectionHeaders('Context Shading', [
      'Name',
      'Type',
      'start angle',
      'end angle',
      'distance',
      'height',
      'parent_element',
      'coords',
      'extra_json',
    ]);
    validateGeometrySectionHeaders('Systems', [
      'Name',
      'Zone',
      'Type',
      'system_type',
      'coords',
      'extra_json',
    ]);
    validateGeometrySectionHeaders('Non-Exposed Elements', [
      'Name',
      'Zone',
      'Type',
      'area',
      'pitch',
      'width',
      'height',
      'parent_element',
      'extra_json',
    ]);
    validateGeometrySectionHeaders('Ventilation Systems', [
      'Name',
      'Type',
      'length',
      'duct_type',
      'parent_element',
      'mid_height_air_flow_path',
      'area_cm2',
      'orientation360',
      'pitch',
      'vent_type',
      'extra_json',
    ]);
    validateGeometrySectionHeaders('Appliances', ['Name', 'Type', 'appliancekey', 'extra_json']);
  });

  it('every EXPECTED_SECTION_HEADERS entry matches ingestGeometryTabularSections sections', () => {
    const keys = Object.keys(EXPECTED_SECTION_HEADERS) as (keyof typeof EXPECTED_SECTION_HEADERS)[];
    for (const sectionName of keys) {
      const headers = [...EXPECTED_SECTION_HEADERS[sectionName]];
      expect(headers.length).toBeGreaterThan(0);
      expect(new Set(headers).size).toBe(headers.length);
      validateGeometrySectionHeaders(sectionName, headers);
    }
  });

  it('includes MVHR terminal linkage columns in Ventilation Systems exports', () => {
    expect(EXPECTED_SECTION_HEADERS['Ventilation Systems']).toEqual([
      'Name',
      'Type',
      'length',
      'duct_type',
      'terminal_type',
      'parent_element',
      'host_element',
      'mid_height_air_flow_path',
      'area_cm2',
      'orientation360',
      'pitch',
      'vent_type',
      'coords',
      'extra_json',
    ]);
  });

  it('declares the typed battery fields transported through extra_json', () => {
    expect(PROMOTED_EXTRA_JSON_FIELDS.ElectricBattery).toEqual([
      'capacity',
      'charge_discharge_efficiency_round_trip',
      'battery_location',
    ]);
  });

  it('encodes live top-level values over stale payload copies', () => {
    const battery = {
      id: 'battery-1',
      name: 'Battery 1',
      type: 'ElectricBattery',
      capacity: 7.2,
      charge_discharge_efficiency_round_trip: 0.91,
      battery_location: 'outside',
      coordinates: [{ x: 0, y: 0, z: 0 }],
      parent_element: null,
      extra_json: {
        capacity: 5,
        charge_discharge_efficiency_round_trip: 0.85,
        battery_location: 'inside',
        minimum_charge_rate_one_way_trip: 0.1,
      },
    } satisfies ElectricBattery;

    expect(encodePromotedExtraJsonFields(battery)).toEqual({
      capacity: 7.2,
      charge_discharge_efficiency_round_trip: 0.91,
      battery_location: 'outside',
      minimum_charge_rate_one_way_trip: 0.1,
    });
  });

  it('separates promoted fields from advanced payload data on decode', () => {
    expect(decodePromotedExtraJsonFields('ElectricBattery', {
      capacity: 7.2,
      charge_discharge_efficiency_round_trip: 0.91,
      battery_location: 'outside',
      minimum_charge_rate_one_way_trip: 0.1,
    })).toEqual({
      promotedFields: {
        capacity: 7.2,
        charge_discharge_efficiency_round_trip: 0.91,
        battery_location: 'outside',
      },
      advancedExtraJson: {
        minimum_charge_rate_one_way_trip: 0.1,
      },
    });
  });
});
