// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type GroundFloorType =
  | 'Heated_basement'
  | 'Slab_no_edge_insulation'
  | 'Slab_edge_insulation'
  | 'Suspended_floor'
  | 'Unheated_basement';

export type WindShieldLocation = 'Sheltered' | 'Average' | 'Exposed';

/** HEM `$defs/WindShieldLocation` in `input_core.schema.json` — ISO 13370 ventilation shielding factors. */
export const WIND_SHIELD_LOCATION_ENUM: readonly WindShieldLocation[] = ['Sheltered', 'Average', 'Exposed'];

/**
 * Coerce a stored `extra_json.shield_fact_location` value to a valid enum member.
 * Unknown or empty values become `Average` (matches ground U calculation fallbacks).
 */
export function parseWindShieldLocation(value: unknown): WindShieldLocation {
  if (value === 'Sheltered' || value === 'Average' || value === 'Exposed') return value;
  return 'Average';
}

export interface EdgeInsulationInput {
  type: 'horizontal' | 'vertical';
  edge_thermal_resistance: number;
  width?: number;
  depth?: number;
}

/**
 * Default wind speed (m/s) for the suspended-floor ventilation term in BS EN ISO 13370 (1450·v·f·V/B).
 * Matches BR 497 (2nd ed.) §4.7.2 junction assumptions and `underfloorVoidTemperature.ts` (5 m/s).
 */
export const DEFAULT_WIND_SPEED_MPS_GROUND_U = 5;

/** Default basement air change rate (ach) permitted by BS EN ISO 13370 §7.4 when no specific value is known. */
export const DEFAULT_BASEMENT_VENTILATION_RATE_ACH = 0.3;

/** Volumetric heat capacity of air used by HEM / ISO 13370 basement ventilation terms, in Wh/(m³·K). */
export const AIR_HEAT_CAPACITY_WH_PER_M3K = 0.33;

export interface GroundUValueInputs {
  floorType: GroundFloorType;
  totalArea: number;
  perimeter: number;
  thicknessWalls: number;
  thermalResistanceFloorConstruction: number;
  edgeInsulation?: EdgeInsulationInput[] | null;
  suspended?: {
    heightUpperSurface: number;
    thermalTransmWalls: number;
    areaPerPerimeterVent: number;
    shieldFactLocation: WindShieldLocation;
    /** Ground insulation on base of underfloor space (HEM `thermal_resist_insul`, R_g, m²K/W). Series with soil U_g path. */
    thermalResistanceGroundInsulation?: number;
    /** Wind speed for ISO 13370 ventilation term (m/s). Defaults to {@link DEFAULT_WIND_SPEED_MPS_GROUND_U}. */
    windSpeedMps?: number;
  };
  /**
   * Depth of basement floor below external ground level z (m). BS EN ISO 13370 §9.1-style basement floor
   * path (see BR 443 §10.1): equivalent thickness includes wall stem, depth, and λ(R_si + R_f + R_se).
   * Required when {@link floorType} is `Heated_basement` or `Unheated_basement`.
   */
  depthBasementFloorM?: number;
  unheatedBasement?: {
    /** U_f;s: floor between the internal environment and the unheated basement, W/(m²·K). */
    thermalTransmittanceFloorAboveBasement: number;
    /** U_w: basement walls above ground, W/(m²·K). */
    thermalTransmWalls: number;
    /** h: height of basement walls above ground, m. */
    heightBasementWalls: number;
    /** R_w;b: resistance of basement walls below ground, excluding surface resistances, m²K/W. */
    thermalResistanceBasementWalls: number;
    /** n: basement ventilation rate, ach. Defaults to 0.3. */
    ventilationRateAch?: number;
  };
}

const R_SI = 0.17;
const R_SE = 0.04;
const LAMBDA_G = 1.5;

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function characteristicLength(totalArea: number, perimeter: number): number | null {
  if (!isPositive(totalArea) || !isPositive(perimeter)) return null;
  return (2 * totalArea) / perimeter;
}

/**
 * BS EN ISO 13370 eq. (4) family: steady-state ground heat flow factor U_g (W/m²K) for slab-on-ground
 * from characteristic length b (m) and total equivalent thickness d_t (m).
 */
export function computeIso13370GroundUFromDt(b: number, dT: number): number | null {
  if (!isPositive(b) || !isPositive(dT)) return null;
  const numerator = 2 * LAMBDA_G * Math.log((Math.PI * b) / dT + 1);
  const denominator = Math.PI * b + dT;
  if (!isPositive(denominator)) return null;
  return numerator / denominator;
}

function computeBasementFloorGroundU(
  totalArea: number,
  perimeter: number,
  thicknessWalls: number,
  thermalResistanceFloorConstruction: number,
  depthBasementFloorM: number,
): number | null {
  const b = characteristicLength(totalArea, perimeter);
  if (!b || !isPositive(thicknessWalls) || !isPositive(thermalResistanceFloorConstruction)) return null;
  if (!Number.isFinite(depthBasementFloorM) || depthBasementFloorM < 0) return null;
  const dT =
    thicknessWalls
    + depthBasementFloorM
    + LAMBDA_G * (R_SI + thermalResistanceFloorConstruction + R_SE);
  return computeIso13370GroundUFromDt(b, dT);
}

function computeBasementWallGroundU(
  depthBasementFloorM: number,
  thermalResistanceBasementWalls: number,
): number | null {
  if (!isPositive(depthBasementFloorM) || !isPositive(thermalResistanceBasementWalls)) return null;
  const dTWall = LAMBDA_G * (R_SI + thermalResistanceBasementWalls + R_SE);
  if (!isPositive(dTWall)) return null;
  const u =
    (2 * LAMBDA_G) / (Math.PI * depthBasementFloorM)
    * (1 + (0.5 * dTWall) / depthBasementFloorM)
    * Math.log(depthBasementFloorM / dTWall + 1);
  return isPositive(u) ? u : null;
}

function computeUg(totalArea: number, perimeter: number, thicknessWalls: number): number | null {
  const b = characteristicLength(totalArea, perimeter);
  if (!b || !isPositive(thicknessWalls)) return null;
  const dG = thicknessWalls + LAMBDA_G * (R_SI + R_SE);
  return computeIso13370GroundUFromDt(b, dG);
}

/** Series combination: R_g (m²K/W) with soil conductance U_g (W/m²K) → effective U. */
function effectiveUgWithGroundInsulation(uG: number, rG: number): number {
  if (!(rG > 0)) return uG;
  return uG / (1 + uG * rG);
}

function edgeResistanceAdjustment(edgeInsulation?: EdgeInsulationInput[] | null, b?: number | null): number {
  if (!edgeInsulation || edgeInsulation.length === 0 || !b || !isPositive(b)) return 0;
  let best = 0;
  for (const edge of edgeInsulation) {
    const edgeR = Number(edge.edge_thermal_resistance);
    if (!isPositive(edgeR)) continue;
    const extent = edge.type === 'horizontal' ? Number(edge.width) : Number(edge.depth);
    const coverage = isPositive(extent) ? Math.min(1, extent / b) : 0;
    best = Math.max(best, edgeR * coverage);
  }
  return best;
}

function shieldFactor(shield: WindShieldLocation): number {
  if (shield === 'Sheltered') return 0.02;
  if (shield === 'Exposed') return 0.1;
  return 0.05;
}

/** Terms used in {@link defaultSuspendedAreaPerPerimeterVent} (max of two linear rates, m²/m). */
export type SuspendedVentPartFBreakdown = {
  /** 1500 mm² per metre along the floor perimeter. */
  byPerimeterRun_m2_per_m: number;
  /** (500 mm² per m² of floor × floor area) ÷ perimeter. */
  byFloorArea_m2_per_m: number;
  /** max of the two; matches {@link defaultSuspendedAreaPerPerimeterVent}. */
  result_m2_per_m: number;
  limiting: 'perimeter_run' | 'floor_area' | 'both';
};

export function getSuspendedVentPartFBreakdown(totalArea: number, perimeter: number): SuspendedVentPartFBreakdown | null {
  if (!isPositive(totalArea) || !isPositive(perimeter)) return null;
  const byPerimeterRun_m2_per_m = 0.0015; // 1500 mm² per m run
  const byFloorArea_m2_per_m = (0.0005 * totalArea) / perimeter; // 500 mm² per m² floor area
  const result_m2_per_m = Math.max(byPerimeterRun_m2_per_m, byFloorArea_m2_per_m);
  const eps = 1e-9;
  const limiting: SuspendedVentPartFBreakdown['limiting'] =
    Math.abs(byPerimeterRun_m2_per_m - byFloorArea_m2_per_m) < eps
      ? 'both'
      : byPerimeterRun_m2_per_m > byFloorArea_m2_per_m
        ? 'perimeter_run'
        : 'floor_area';
  return { byPerimeterRun_m2_per_m, byFloorArea_m2_per_m, result_m2_per_m, limiting };
}

/** Default `area_perimeter_vent` (m²/m) for suspended ground floors: max(0.0015, 0.0005×area/perimeter). */
export function defaultSuspendedAreaPerPerimeterVent(totalArea: number, perimeter: number): number | null {
  const b = getSuspendedVentPartFBreakdown(totalArea, perimeter);
  return b ? b.result_m2_per_m : null;
}

export function calculateGroundUValue(inputs: GroundUValueInputs): number | null {
  const baseArea = inputs.totalArea;
  const b = characteristicLength(baseArea, inputs.perimeter);
  if (!b || !isPositive(inputs.thermalResistanceFloorConstruction)) return null;

  if (inputs.floorType === 'Suspended_floor') {
    const uGRaw = computeUg(baseArea, inputs.perimeter, inputs.thicknessWalls);
    if (!uGRaw) return null;
    const suspended = inputs.suspended;
    if (!suspended) return null;
    const {
      heightUpperSurface,
      thermalTransmWalls,
      areaPerPerimeterVent,
      shieldFactLocation,
      thermalResistanceGroundInsulation = 0,
      windSpeedMps = DEFAULT_WIND_SPEED_MPS_GROUND_U,
    } = suspended;
    if (!isPositive(heightUpperSurface) || !isPositive(thermalTransmWalls) || areaPerPerimeterVent < 0) {
      return null;
    }
    if (!(Number.isFinite(windSpeedMps) && windSpeedMps >= 0)) return null;
    if (!(Number.isFinite(thermalResistanceGroundInsulation) && thermalResistanceGroundInsulation >= 0)) return null;

    const uG = effectiveUgWithGroundInsulation(uGRaw, thermalResistanceGroundInsulation);
    const uX =
      (2 * heightUpperSurface * thermalTransmWalls) / b
      + (1450 * areaPerPerimeterVent * shieldFactor(shieldFactLocation) * windSpeedMps) / b;
    const combinedGround = uG + Math.max(0, uX);
    if (!isPositive(combinedGround)) return null;
    return 1 / (2 * R_SI + inputs.thermalResistanceFloorConstruction + 1 / combinedGround);
  }

  if (inputs.floorType === 'Heated_basement') {
    const z = inputs.depthBasementFloorM;
    if (z == null || !isPositive(z)) return null;
    return computeBasementFloorGroundU(
      baseArea,
      inputs.perimeter,
      inputs.thicknessWalls,
      inputs.thermalResistanceFloorConstruction,
      z,
    );
  }

  if (inputs.floorType === 'Unheated_basement') {
    const z = inputs.depthBasementFloorM;
    const unheated = inputs.unheatedBasement;
    if (z == null || !isPositive(z) || !unheated) return null;
    const {
      thermalTransmittanceFloorAboveBasement: uFs,
      thermalTransmWalls: uW,
      heightBasementWalls: h,
      thermalResistanceBasementWalls: rWallBase,
      ventilationRateAch = DEFAULT_BASEMENT_VENTILATION_RATE_ACH,
    } = unheated;
    if (!isPositive(uFs) || !isPositive(uW) || !isPositive(h) || !isPositive(rWallBase)) return null;
    if (!(Number.isFinite(ventilationRateAch) && ventilationRateAch >= 0)) return null;

    const uFgB = computeBasementFloorGroundU(
      baseArea,
      inputs.perimeter,
      inputs.thicknessWalls,
      inputs.thermalResistanceFloorConstruction,
      z,
    );
    const uWgB = computeBasementWallGroundU(z, rWallBase);
    if (!uFgB || !uWgB) return null;

    const basementAirVolume = baseArea * (z + h);
    const basementHeatTransfer =
      baseArea * uFgB
      + z * inputs.perimeter * uWgB
      + h * inputs.perimeter * uW
      + AIR_HEAT_CAPACITY_WH_PER_M3K * ventilationRateAch * basementAirVolume;
    if (!isPositive(basementHeatTransfer)) return null;

    const inverseU = 1 / uFs + baseArea / basementHeatTransfer;
    return isPositive(inverseU) ? 1 / inverseU : null;
  }

  const uGRaw = computeUg(baseArea, inputs.perimeter, inputs.thicknessWalls);
  if (!uGRaw) return null;

  const edgeAdj =
    inputs.floorType === 'Slab_edge_insulation'
      ? edgeResistanceAdjustment(inputs.edgeInsulation, b)
      : 0;
  const effectiveRf = inputs.thermalResistanceFloorConstruction + edgeAdj;
  return 1 / (R_SI + effectiveRf + 1 / uGRaw);
}

function readFiniteGroundUModel(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export type ComputeGroundUFromElementModelOptions = {
  /** Modal live wind field; when omitted, uses `extra_json.wind_speed_mps` (suspended floors). */
  windInput?: string | null;
  /** Effective ground area override (m²), auto-derived or manually authored, used before `currentData.total_area`. */
  totalArea?: number | null;
  /** Geometry-derived exposed perimeter override (m), used before `currentData.perimeter`. */
  perimeter?: number | null;
  /** Live wall-thickness override (m), used before `currentData.thickness_walls`. */
  thicknessWalls?: number | null;
  /** Live basement depth override (m), used before `currentData.depth_basement_floor`. */
  depthBasementFloorM?: number | null;
};

/**
 * BS EN ISO 13370 ground-floor U (W/m²K) from element fields + `extra_json`, matching the
 * ground U calculator modal. Returns null when required inputs are missing or the calculation
 * does not yield a finite positive U.
 */
export function computeGroundUValueFromElementModel(
  /** Element models / plain objects; `unknown` + narrow avoids `Record` index signature requirements. */
  currentData: unknown,
  advancedFieldsData: unknown,
  subtype: string | undefined,
  options?: ComputeGroundUFromElementModelOptions,
): number | null {
  const adv =
    advancedFieldsData && typeof advancedFieldsData === 'object' && !Array.isArray(advancedFieldsData)
      ? (advancedFieldsData as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const cur =
    currentData && typeof currentData === 'object' && !Array.isArray(currentData)
      ? (currentData as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const totalArea = readFiniteGroundUModel(options?.totalArea) ?? readFiniteGroundUModel(cur.total_area);
  const perimeter = readFiniteGroundUModel(options?.perimeter) ?? readFiniteGroundUModel(cur.perimeter);
  const thicknessWalls = readFiniteGroundUModel(options?.thicknessWalls) ?? readFiniteGroundUModel(cur.thickness_walls);
  const rFloor = readFiniteGroundUModel(adv.thermal_resistance_floor_construction);
  const depthBasementFloorM =
    readFiniteGroundUModel(options?.depthBasementFloorM) ?? readFiniteGroundUModel(cur.depth_basement_floor);
  const floorType = (cur.floor_type ?? subtype ?? 'Slab_no_edge_insulation') as GroundFloorType;
  const thermalTransmittanceFloorAboveBasement =
    readFiniteGroundUModel(adv.thermal_transm_envi_base) ?? readFiniteGroundUModel(cur.thermal_transm_envi_base);
  const thermalTransmBasementWalls =
    readFiniteGroundUModel(adv.thermal_transm_walls) ?? readFiniteGroundUModel(cur.thermal_transm_walls);
  const heightBasementWalls =
    readFiniteGroundUModel(adv.height_basement_walls) ?? readFiniteGroundUModel(cur.height_basement_walls);
  const thermalResistanceBasementWalls =
    readFiniteGroundUModel(adv.thermal_resist_walls_base) ?? readFiniteGroundUModel(cur.thermal_resist_walls_base);

  const windParsed =
    options?.windInput != null && options.windInput !== undefined
      ? readFiniteGroundUModel(options.windInput)
      : readFiniteGroundUModel(adv.wind_speed_mps);

  const rgParsed = Math.max(0, readFiniteGroundUModel(adv.thermal_resist_insul) ?? 0);

  const suspendedInputs =
    floorType === 'Suspended_floor'
      ? {
          heightUpperSurface: readFiniteGroundUModel(adv.height_upper_surface) ?? 0,
          thermalTransmWalls: readFiniteGroundUModel(adv.thermal_transm_walls) ?? 0,
          areaPerPerimeterVent: readFiniteGroundUModel(adv.area_per_perimeter_vent) ?? 0,
          shieldFactLocation: parseWindShieldLocation(adv.shield_fact_location),
          thermalResistanceGroundInsulation: Math.max(0, rgParsed),
          windSpeedMps: windParsed ?? DEFAULT_WIND_SPEED_MPS_GROUND_U,
        }
      : undefined;

  const isBasementFloor = floorType === 'Heated_basement' || floorType === 'Unheated_basement';
  const unheatedBasementInputs =
    floorType === 'Unheated_basement'
      ? {
          thermalTransmittanceFloorAboveBasement: thermalTransmittanceFloorAboveBasement ?? 0,
          thermalTransmWalls: thermalTransmBasementWalls ?? 0,
          heightBasementWalls: heightBasementWalls ?? 0,
          thermalResistanceBasementWalls: thermalResistanceBasementWalls ?? 0,
        }
      : undefined;

  const requiredOk = (() => {
    if (rFloor == null || rFloor <= 0) return false;
    if (totalArea == null || totalArea <= 0) return false;
    if (perimeter == null || perimeter <= 0) return false;
    if (thicknessWalls == null || thicknessWalls <= 0) return false;
    if (isBasementFloor && (depthBasementFloorM == null || depthBasementFloorM <= 0)) return false;
    if (floorType === 'Unheated_basement') {
      if (!unheatedBasementInputs) return false;
      if (!(unheatedBasementInputs.thermalTransmittanceFloorAboveBasement > 0)) return false;
      if (!(unheatedBasementInputs.thermalTransmWalls > 0)) return false;
      if (!(unheatedBasementInputs.heightBasementWalls > 0)) return false;
      if (!(unheatedBasementInputs.thermalResistanceBasementWalls > 0)) return false;
    }
    if (floorType === 'Suspended_floor' && suspendedInputs) {
      if (!(suspendedInputs.heightUpperSurface > 0)) return false;
      if (!(suspendedInputs.thermalTransmWalls > 0)) return false;
      if (suspendedInputs.areaPerPerimeterVent < 0) return false;
      if (!(suspendedInputs.windSpeedMps >= 0)) return false;
    }
    return true;
  })();

  if (!requiredOk) return null;

  const u = calculateGroundUValue({
    floorType,
    totalArea: totalArea!,
    perimeter: perimeter!,
    thicknessWalls: thicknessWalls!,
    thermalResistanceFloorConstruction: rFloor!,
    edgeInsulation: Array.isArray(adv.edge_insulation) ? (adv.edge_insulation as EdgeInsulationInput[]) : null,
    suspended: suspendedInputs as GroundUValueInputs['suspended'],
    unheatedBasement: unheatedBasementInputs,
    ...(isBasementFloor && depthBasementFloorM != null ? { depthBasementFloorM } : {}),
  });

  return u != null && Number.isFinite(u) && u > 0 ? u : null;
}
