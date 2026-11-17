// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type GroundFloorType =
  | 'Heated_basement'
  | 'Slab_no_edge_insulation'
  | 'Slab_edge_insulation'
  | 'Suspended_floor'
  | 'Unheated_basement';

/** The one wording of each ground floor type: the form, the multi-select panel and the calculator all use it. */
export const GROUND_FLOOR_TYPE_LABELS: Readonly<Record<GroundFloorType, string>> = {
  Heated_basement: 'Heated basement',
  Slab_no_edge_insulation: 'Ground floor, no edge insulation',
  Slab_edge_insulation: 'Ground floor, edge insulated',
  Suspended_floor: 'Suspended floor',
  Unheated_basement: 'Unheated basement',
};

export type WindShieldLocation = 'Sheltered' | 'Average' | 'Exposed';

/** HEM `$defs/WindShieldLocation` in `input_core.schema.json` — ISO 13370 ventilation shielding factors. */
export const WIND_SHIELD_LOCATION_ENUM: readonly WindShieldLocation[] = ['Sheltered', 'Average', 'Exposed'];

/**
 * Coerce a stored `extra_json.shield_fact_location` value to a valid enum member.
 * Unknown or empty values become `Average` (BR 443 §9.2: average exposure unless a local value is needed).
 */
export function parseWindShieldLocation(value: unknown): WindShieldLocation {
  if (value === 'Sheltered' || value === 'Average' || value === 'Exposed') return value;
  return 'Average';
}

/** Mean wind speed (m/s) the floor calculation takes for a suspended floor with none stated: BR 443 §9.2, UK average. */
export const DEFAULT_WIND_SPEED_MPS_GROUND_U = 5;

/** Basement ventilation rate (ach) when no specific value is known: BS EN ISO 13370 §7.4, BR 443 §10.2. */
export const DEFAULT_BASEMENT_VENTILATION_RATE_ACH = 0.3;

/** Heat capacity of air in the BS EN ISO 13370 §7.4 ventilation term (0.33·n·V), Wh/(m³·K). */
export const AIR_HEAT_CAPACITY_WH_PER_M3K = 0.33;

/** What the floor-calculation link says where the number is not available (no calculator in this host). */
export const GROUND_U_DERIVED_TEXT = "Calculated from the floor's resistance and size (BR 443)";

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
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

/**
 * The floor calculation (BS EN ISO 13370 as BR 443 directs) lives once, in Rust
 * (`vulcan-model-transform` `ground_floor_u_value`). A host whose WASM carries it registers it here;
 * the arguments are the HEM ground element's fields as JSON and the row's wind speed. It returns
 * the U-value (W/m²K, four decimals) or undefined when an input it needs is missing.
 */
export type GroundUValueCalculator = (elementJson: string, windSpeedMps: number | undefined) => number | undefined;

let calculator: GroundUValueCalculator | null = null;

export function setGroundUValueCalculator(next: GroundUValueCalculator | null): void {
  calculator = next;
}

/** True when this host can show the calculated number (and open the calculator). */
export function hasGroundUValueCalculator(): boolean {
  return calculator !== null;
}

/** The floor calculation for a HEM ground element's fields; null with no calculator registered or a missing input. */
export function calculateGroundUValue(element: Readonly<Record<string, unknown>>, windSpeedMps?: number): number | null {
  if (!calculator) return null;
  return calculator(JSON.stringify(element), windSpeedMps) ?? null;
}

function readFinite(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** A value the converter reads as stated: a finite number, or a non-blank numeric string. */
export function isStatedNumber(value: unknown): boolean {
  return readFinite(value) !== null;
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
 * The floor calculation from an editor element: its row fields, its `extra_json` (advanced
 * fields, which win for the fields the converter reads from there) and the live overrides, in the
 * HEM element shape the converter passes. Null with no calculator registered, or when an input is
 * missing.
 */
export function computeGroundUValueFromElementModel(
  currentData: unknown,
  advancedFieldsData: unknown,
  subtype: string | undefined,
  options?: ComputeGroundUFromElementModelOptions,
): number | null {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const cur = record(currentData);
  const adv = record(advancedFieldsData);
  const element: Record<string, unknown> = { ...cur, ...adv };
  delete element.extra_json;
  element.floor_type = cur.floor_type ?? subtype ?? 'Slab_no_edge_insulation';
  element.total_area = readFinite(options?.totalArea) ?? readFinite(cur.total_area);
  element.perimeter = readFinite(options?.perimeter) ?? readFinite(cur.perimeter);
  element.thickness_walls = readFinite(options?.thicknessWalls) ?? readFinite(cur.thickness_walls);
  element.depth_basement_floor = readFinite(options?.depthBasementFloorM) ?? readFinite(cur.depth_basement_floor);
  const wind = options?.windInput != null ? readFinite(options.windInput) : readFinite(adv.wind_speed_mps);
  return calculateGroundUValue(element, wind ?? undefined);
}
