// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  AIR_HEAT_CAPACITY_WH_PER_M3K,
  calculateGroundUValue,
  computeGroundUValueFromElementModel,
  computeIso13370GroundUFromDt,
  DEFAULT_BASEMENT_VENTILATION_RATE_ACH,
  defaultSuspendedAreaPerPerimeterVent,
  getSuspendedVentPartFBreakdown,
  parseWindShieldLocation,
  WIND_SHIELD_LOCATION_ENUM,
} from '../groundUValueCalculator';

describe('groundUValueCalculator', () => {
  it('parses wind shield location and defaults sensibly', () => {
    expect(parseWindShieldLocation('Sheltered')).toBe('Sheltered');
    expect(parseWindShieldLocation('Exposed')).toBe('Exposed');
    expect(parseWindShieldLocation('Average')).toBe('Average');
    expect(parseWindShieldLocation(undefined)).toBe('Average');
    expect(parseWindShieldLocation('typo')).toBe('Average');
    expect(WIND_SHIELD_LOCATION_ENUM).toEqual(['Sheltered', 'Average', 'Exposed']);
  });

  it('returns null for basement floor types when depth is missing', () => {
    expect(
      calculateGroundUValue({
        floorType: 'Heated_basement',
        totalArea: 42,
        perimeter: 28,
        thicknessWalls: 0.3,
        thermalResistanceFloorConstruction: 4.2,
      }),
    ).toBeNull();
  });

  it('calculates heated basement floor U using ISO 13370 equivalent thickness incl. depth', () => {
    const u = calculateGroundUValue({
      floorType: 'Heated_basement',
      totalArea: 42,
      perimeter: 28,
      thicknessWalls: 0.3,
      thermalResistanceFloorConstruction: 4.2,
      depthBasementFloorM: 2,
    });
    expect(u).not.toBeNull();
    expect(u!).toBeGreaterThan(0);
    expect(u!).toBeLessThan(1);
    const b = (2 * 42) / 28;
    const dT = 0.3 + 2 + 1.5 * (0.17 + 4.2 + 0.04);
    expect(computeIso13370GroundUFromDt(b, dT)).toBeCloseTo(u!, 12);
  });

  it('returns null for unheated basement when ISO 13370 section 7.4 fields are missing', () => {
    expect(
      calculateGroundUValue({
        floorType: 'Unheated_basement',
        totalArea: 80,
        perimeter: 36,
        thicknessWalls: 0.25,
        thermalResistanceFloorConstruction: 3.5,
        depthBasementFloorM: 2,
      }),
    ).toBeNull();
  });

  it('calculates unheated basement U_ub using ISO 13370 section 7.4 terms', () => {
    const totalArea = 80;
    const perimeter = 36;
    const thicknessWalls = 0.25;
    const rFloor = 3.5;
    const z = 2;
    const uFs = 0.2;
    const uW = 0.18;
    const h = 1.2;
    const rWallBase = 0.15;

    const u = calculateGroundUValue({
      floorType: 'Unheated_basement',
      totalArea,
      perimeter,
      thicknessWalls,
      thermalResistanceFloorConstruction: rFloor,
      depthBasementFloorM: z,
      unheatedBasement: {
        thermalTransmittanceFloorAboveBasement: uFs,
        thermalTransmWalls: uW,
        heightBasementWalls: h,
        thermalResistanceBasementWalls: rWallBase,
      },
    });

    const lambda = 1.5;
    const rSi = 0.17;
    const rSe = 0.04;
    const b = (2 * totalArea) / perimeter;
    const dTFloor = thicknessWalls + z + lambda * (rSi + rFloor + rSe);
    const uFgB = computeIso13370GroundUFromDt(b, dTFloor)!;
    const dTWall = lambda * (rSi + rWallBase + rSe);
    const uWgB =
      (2 * lambda) / (Math.PI * z)
      * (1 + (0.5 * dTWall) / z)
      * Math.log(z / dTWall + 1);
    const airVolume = totalArea * (z + h);
    const basementHeatTransfer =
      totalArea * uFgB
      + z * perimeter * uWgB
      + h * perimeter * uW
      + AIR_HEAT_CAPACITY_WH_PER_M3K * DEFAULT_BASEMENT_VENTILATION_RATE_ACH * airVolume;
    const expected = 1 / (1 / uFs + totalArea / basementHeatTransfer);

    expect(u).not.toBeNull();
    expect(u).toBeCloseTo(expected, 12);
    expect(u!).toBeLessThan(uFs);
  });

  it('deeper basement floor reduces U (larger equivalent thickness)', () => {
    const shallow = calculateGroundUValue({
      floorType: 'Heated_basement',
      totalArea: 80,
      perimeter: 36,
      thicknessWalls: 0.25,
      thermalResistanceFloorConstruction: 3.5,
      depthBasementFloorM: 1,
    });
    const deep = calculateGroundUValue({
      floorType: 'Heated_basement',
      totalArea: 80,
      perimeter: 36,
      thicknessWalls: 0.25,
      thermalResistanceFloorConstruction: 3.5,
      depthBasementFloorM: 3,
    });
    expect(shallow).not.toBeNull();
    expect(deep).not.toBeNull();
    expect(deep!).toBeLessThan(shallow!);
  });

  it('calculates slab U-value from geometry and Rf', () => {
    const u = calculateGroundUValue({
      floorType: 'Slab_no_edge_insulation',
      totalArea: 42,
      perimeter: 28,
      thicknessWalls: 0.3,
      thermalResistanceFloorConstruction: 4.2,
    });
    expect(u).not.toBeNull();
    expect(u!).toBeGreaterThan(0);
    expect(u!).toBeLessThan(1);
  });

  it('calculates suspended U-value with ventilation term', () => {
    const u = calculateGroundUValue({
      floorType: 'Suspended_floor',
      totalArea: 50,
      perimeter: 30,
      thicknessWalls: 0.3,
      thermalResistanceFloorConstruction: 3.8,
      suspended: {
        heightUpperSurface: 0.15,
        thermalTransmWalls: 0.25,
        areaPerPerimeterVent: 0.0015,
        shieldFactLocation: 'Average',
      },
    });
    expect(u).not.toBeNull();
    expect(u!).toBeGreaterThan(0);
    expect(u!).toBeLessThan(1);
  });

  it('reduces suspended U when R_g is in series with soil path', () => {
    const base = calculateGroundUValue({
      floorType: 'Suspended_floor',
      totalArea: 50,
      perimeter: 30,
      thicknessWalls: 0.3,
      thermalResistanceFloorConstruction: 3.8,
      suspended: {
        heightUpperSurface: 0.15,
        thermalTransmWalls: 0.25,
        areaPerPerimeterVent: 0.0015,
        shieldFactLocation: 'Average',
        thermalResistanceGroundInsulation: 0,
      },
    });
    const withRg = calculateGroundUValue({
      floorType: 'Suspended_floor',
      totalArea: 50,
      perimeter: 30,
      thicknessWalls: 0.3,
      thermalResistanceFloorConstruction: 3.8,
      suspended: {
        heightUpperSurface: 0.15,
        thermalTransmWalls: 0.25,
        areaPerPerimeterVent: 0.0015,
        shieldFactLocation: 'Average',
        thermalResistanceGroundInsulation: 2,
      },
    });
    expect(base).not.toBeNull();
    expect(withRg).not.toBeNull();
    expect(withRg!).toBeLessThan(base!);
  });

  it('changes suspended U when wind speed differs from default', () => {
    const u5 = calculateGroundUValue({
      floorType: 'Suspended_floor',
      totalArea: 50,
      perimeter: 30,
      thicknessWalls: 0.3,
      thermalResistanceFloorConstruction: 3.8,
      suspended: {
        heightUpperSurface: 0.15,
        thermalTransmWalls: 0.25,
        areaPerPerimeterVent: 0.0015,
        shieldFactLocation: 'Average',
        windSpeedMps: 5,
      },
    });
    const u2 = calculateGroundUValue({
      floorType: 'Suspended_floor',
      totalArea: 50,
      perimeter: 30,
      thicknessWalls: 0.3,
      thermalResistanceFloorConstruction: 3.8,
      suspended: {
        heightUpperSurface: 0.15,
        thermalTransmWalls: 0.25,
        areaPerPerimeterVent: 0.0015,
        shieldFactLocation: 'Average',
        windSpeedMps: 2,
      },
    });
    expect(u5).not.toBeNull();
    expect(u2).not.toBeNull();
    expect(u2!).not.toBe(u5!);
  });

  it('provides suspended vent default', () => {
    const val = defaultSuspendedAreaPerPerimeterVent(36, 24);
    expect(val).not.toBeNull();
    expect(val!).toBeGreaterThan(0);
  });

  it('getSuspendedVentPartFBreakdown matches defaultSuspendedAreaPerPerimeterVent', () => {
    const b = getSuspendedVentPartFBreakdown(36, 24);
    expect(b).not.toBeNull();
    expect(b!.result_m2_per_m).toBe(defaultSuspendedAreaPerPerimeterVent(36, 24));
    expect(b!.limiting).toBe('perimeter_run');
    const largeFloor = getSuspendedVentPartFBreakdown(100, 10);
    expect(largeFloor?.limiting).toBe('floor_area');
  });

  it('computeGroundUValueFromElementModel matches calculateGroundUValue for a slab', () => {
    const fromModel = computeGroundUValueFromElementModel(
      {
        total_area: 42,
        perimeter: 28,
        thickness_walls: 0.3,
        floor_type: 'Slab_no_edge_insulation',
      },
      { thermal_resistance_floor_construction: 4.2 },
      'Slab_no_edge_insulation',
    );
    const direct = calculateGroundUValue({
      floorType: 'Slab_no_edge_insulation',
      totalArea: 42,
      perimeter: 28,
      thicknessWalls: 0.3,
      thermalResistanceFloorConstruction: 4.2,
    });
    expect(fromModel).toBeCloseTo(direct!, 10);
  });

  it('computeGroundUValueFromElementModel returns null when construction R is missing', () => {
    expect(
      computeGroundUValueFromElementModel(
        { total_area: 42, perimeter: 28, thickness_walls: 0.3, floor_type: 'Slab_no_edge_insulation' },
        {},
        'Slab_no_edge_insulation',
      ),
    ).toBeNull();
  });

  it('computeGroundUValueFromElementModel defaults suspended wind speed when absent', () => {
    const computed = computeGroundUValueFromElementModel(
      {
        total_area: 50,
        perimeter: 30,
        thickness_walls: 0.3,
        floor_type: 'Suspended_floor',
      },
      {
        thermal_resistance_floor_construction: 3.8,
        height_upper_surface: 0.15,
        thermal_transm_walls: 0.25,
        area_per_perimeter_vent: 0.0015,
        shield_fact_location: 'Average',
      },
      'Suspended_floor',
    );
    const direct = calculateGroundUValue({
      floorType: 'Suspended_floor',
      totalArea: 50,
      perimeter: 30,
      thicknessWalls: 0.3,
      thermalResistanceFloorConstruction: 3.8,
      suspended: {
        heightUpperSurface: 0.15,
        thermalTransmWalls: 0.25,
        areaPerPerimeterVent: 0.0015,
        shieldFactLocation: 'Average',
        windSpeedMps: 5,
      },
    });
    expect(computed).toBeCloseTo(direct!, 10);
  });

  it('computeGroundUValueFromElementModel uses live geometry overrides', () => {
    const computed = computeGroundUValueFromElementModel(
      {
        total_area: 1,
        perimeter: 1,
        thickness_walls: 0.1,
        floor_type: 'Slab_no_edge_insulation',
      },
      { thermal_resistance_floor_construction: 4.2 },
      'Slab_no_edge_insulation',
      {
        totalArea: 42,
        perimeter: 28,
        thicknessWalls: 0.3,
      },
    );
    const direct = calculateGroundUValue({
      floorType: 'Slab_no_edge_insulation',
      totalArea: 42,
      perimeter: 28,
      thicknessWalls: 0.3,
      thermalResistanceFloorConstruction: 4.2,
    });
    expect(computed).toBeCloseTo(direct!, 10);
  });

  it('computeGroundUValueFromElementModel uses windInput override like the modal', () => {
    const adv = {
      thermal_resistance_floor_construction: 3.8,
      height_upper_surface: 0.15,
      thermal_transm_walls: 0.25,
      area_per_perimeter_vent: 0.0015,
      shield_fact_location: 'Average',
      wind_speed_mps: 2,
    };
    const cur = {
      total_area: 50,
      perimeter: 30,
      thickness_walls: 0.3,
      floor_type: 'Suspended_floor' as const,
    };
    const u5 = computeGroundUValueFromElementModel(cur, adv, 'Suspended_floor', { windInput: '5' });
    const uFromAdvOnly = computeGroundUValueFromElementModel(cur, adv, 'Suspended_floor');
    expect(u5).not.toBeNull();
    expect(uFromAdvOnly).not.toBeNull();
    expect(u5).not.toBe(uFromAdvOnly);
  });

  it('computeGroundUValueFromElementModel matches direct unheated basement calculation', () => {
    const cur = {
      total_area: 80,
      perimeter: 36,
      thickness_walls: 0.25,
      depth_basement_floor: 2,
      floor_type: 'Unheated_basement' as const,
    };
    const adv = {
      thermal_resistance_floor_construction: 3.5,
      thermal_transm_envi_base: 0.2,
      thermal_transm_walls: 0.18,
      height_basement_walls: 1.2,
      thermal_resist_walls_base: 0.15,
    };
    const computed = computeGroundUValueFromElementModel(cur, adv, 'Unheated_basement');
    const direct = calculateGroundUValue({
      floorType: 'Unheated_basement',
      totalArea: 80,
      perimeter: 36,
      thicknessWalls: 0.25,
      thermalResistanceFloorConstruction: 3.5,
      depthBasementFloorM: 2,
      unheatedBasement: {
        thermalTransmittanceFloorAboveBasement: 0.2,
        thermalTransmWalls: 0.18,
        heightBasementWalls: 1.2,
        thermalResistanceBasementWalls: 0.15,
      },
    });
    expect(computed).toBeCloseTo(direct!, 10);
  });
});
