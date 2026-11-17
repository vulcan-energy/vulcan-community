// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from 'vitest';
import {
  computeGroundUValueFromElementModel,
  defaultSuspendedAreaPerPerimeterVent,
  getSuspendedVentPartFBreakdown,
  hasGroundUValueCalculator,
  parseWindShieldLocation,
  setGroundUValueCalculator,
  WIND_SHIELD_LOCATION_ENUM,
} from '../groundFloor';

// The floor calculation's numbers are tested in Rust (`ground_u_value.rs`); this checks the port.
afterEach(() => setGroundUValueCalculator(null));

describe('ground floor port', () => {
  it('gives no number with no calculator registered', () => {
    expect(hasGroundUValueCalculator()).toBe(false);
    expect(computeGroundUValueFromElementModel({ total_area: 20 }, { thermal_resistance_floor_construction: 1 }, 'Slab_no_edge_insulation')).toBeNull();
  });

  it('sends the HEM element fields, with live overrides and the wind speed, and maps undefined to null', () => {
    const calls: { element: Record<string, unknown>; wind: number | undefined }[] = [];
    setGroundUValueCalculator((json, wind) => {
      calls.push({ element: JSON.parse(json), wind });
      return calls.length === 1 ? 0.2345 : undefined;
    });
    expect(hasGroundUValueCalculator()).toBe(true);
    const current = { total_area: 30, perimeter: 22, thickness_walls: 0.3, floor_type: 'Suspended_floor', extra_json: { x: 1 } };
    const advanced = { thermal_resistance_floor_construction: 2, height_upper_surface: 0.3, wind_speed_mps: 4 };
    expect(computeGroundUValueFromElementModel(current, advanced, undefined, { totalArea: 32, perimeter: 24 })).toBe(0.2345);
    expect(calls[0]).toEqual({
      element: {
        floor_type: 'Suspended_floor',
        total_area: 32,
        perimeter: 24,
        thickness_walls: 0.3,
        depth_basement_floor: null,
        thermal_resistance_floor_construction: 2,
        height_upper_surface: 0.3,
        wind_speed_mps: 4,
      },
      wind: 4,
    });
    // The modal's own wind field wins; the subtype stands in for a missing floor type.
    expect(computeGroundUValueFromElementModel({ total_area: 30 }, {}, 'Heated_basement', { windInput: '6' })).toBeNull();
    expect(calls[1]).toMatchObject({ element: { floor_type: 'Heated_basement' }, wind: 6 });
  });
});

describe('ground floor helpers', () => {
  it('parses wind shield location and defaults to Average', () => {
    expect(parseWindShieldLocation('Sheltered')).toBe('Sheltered');
    expect(parseWindShieldLocation('Exposed')).toBe('Exposed');
    expect(parseWindShieldLocation(undefined)).toBe('Average');
    expect(parseWindShieldLocation('typo')).toBe('Average');
    expect(WIND_SHIELD_LOCATION_ENUM).toEqual(['Sheltered', 'Average', 'Exposed']);
  });

  it('gives the Part F suspended-floor vent area and which rate limits it', () => {
    const b = getSuspendedVentPartFBreakdown(36, 24);
    expect(b!.result_m2_per_m).toBe(defaultSuspendedAreaPerPerimeterVent(36, 24));
    expect(b!.limiting).toBe('perimeter_run');
    expect(getSuspendedVentPartFBreakdown(100, 10)?.limiting).toBe('floor_area');
  });
});
