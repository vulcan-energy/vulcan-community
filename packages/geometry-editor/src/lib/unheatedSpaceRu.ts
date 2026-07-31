// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unheated-space buffer resistance R_u (m²·K/W) per BS EN ISO 6946 / HEM technical note.
 * Tables match SAP/HEM guidance archetypes (integral garages, stairwells, corridors).
 */

/** R_u = A_i / (Σ(A_e × U_e) + 0.33 n V); A_i and A_e in m², U in W/m²K, V in m³, n in ach. */
export function computeRuIso6946(params: {
  areaInterfaceM2: number;
  sumAeUeWperK: number;
  volumeM3: number;
  nAirChangesPerHour: number;
}): number | null {
  const { areaInterfaceM2: Ai, sumAeUeWperK, volumeM3: V, nAirChangesPerHour: n } = params;
  if (!Number.isFinite(Ai) || Ai <= 0) return null;
  if (!Number.isFinite(sumAeUeWperK) || sumAeUeWperK < 0) return null;
  if (!Number.isFinite(V) || V < 0) return null;
  if (!Number.isFinite(n) || n < 0) return null;
  const denom = sumAeUeWperK + 0.33 * n * V;
  if (denom <= 0) return null;
  return Ai / denom;
}

export type GarageRowId =
  | 'single_full_three'
  | 'single_one_wall_floor'
  | 'single_partial_forward'
  | 'double_full_three'
  | 'double_half'
  | 'double_partial_forward';

export const GARAGE_ROW_LABELS: Record<GarageRowId, string> = {
  single_full_three: 'Single fully integral — side, end wall, and floor',
  single_one_wall_floor: 'Single fully integral — one wall and floor',
  single_partial_forward: 'Single partially integral (displaced forward) — side, end wall, and floor',
  double_full_three: 'Double fully integral — side, end wall, and floor',
  double_half: 'Double half integral — side, halves of end wall, and floor',
  double_partial_forward: 'Double partially integral (displaced forward) — part side, end, some floor',
};

/** Inside = dwelling insulated envelope wraps garage; Outside = separating walls are external walls. */
export function ruFromGarageTable(row: GarageRowId, envelope: 'inside' | 'outside'): number {
  const t: Record<GarageRowId, { inside: number; outside: number }> = {
    single_full_three: { inside: 0.7, outside: 0.35 },
    single_one_wall_floor: { inside: 0.55, outside: 0.25 },
    single_partial_forward: { inside: 0.6, outside: 0.3 },
    double_full_three: { inside: 0.6, outside: 0.35 },
    double_half: { inside: 0.35, outside: 0.25 },
    double_partial_forward: { inside: 0.3, outside: 0.25 },
  };
  return t[row][envelope];
}

export type StairwellFacing = 'exposed' | 'not_exposed';

export function ruFromStairwellTable(facing: StairwellFacing): number {
  return facing === 'exposed' ? 2.1 : 2.5;
}

export type CorridorRowId =
  | 'exp_above_below'
  | 'exp_above_or_below'
  | 'not_exp_above_below'
  | 'not_exp_above_or_below';

export const CORRIDOR_ROW_LABELS: Record<CorridorRowId, string> = {
  exp_above_below: 'Facing wall exposed; corridors above and below (facing wall, floor, ceiling)',
  exp_above_or_below: 'Facing wall exposed; corridor above or below (facing wall, floor or ceiling)',
  not_exp_above_below: 'Facing wall not exposed; corridors above and below (floor and ceiling)',
  not_exp_above_or_below: 'Facing wall not exposed; corridor above or below (floor or ceiling)',
};

export function ruFromCorridorTable(row: CorridorRowId): number {
  const m: Record<CorridorRowId, number> = {
    exp_above_below: 0.6,
    exp_above_or_below: 0.5,
    not_exp_above_below: 0.9,
    not_exp_above_or_below: 0.7,
  };
  return m[row];
}

export function roundRu(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Persisted in extra_json (see EXTRA_JSON_UI_KEYS) for calculator round-trip. */
export const RU_CALCULATOR_STATE_KEY = 'ru_calculator_state_v1' as const;

export type RuCalculatorFormulaStateV1 = {
  sumMode: 'combined' | 'split';
  ai: string;
  sumAeUe: string;
  exposedAe: string;
  uManual: string;
  exposedAssemblyId: string;
  vol: string;
  n: string;
};

export type RuCalculatorTableStateV1 = {
  tableCategory: 'garage_single' | 'garage_double' | 'stairwell' | 'corridor';
  garageRow: GarageRowId;
  garageEnvelope: 'inside' | 'outside';
  stairwellFacing: StairwellFacing;
  corridorRow: CorridorRowId;
};

export type RuCalculatorStateV1 = {
  v: 1;
  mode: 'table' | 'formula';
  formula: RuCalculatorFormulaStateV1;
  table: RuCalculatorTableStateV1;
};

const GARAGE_ROWS = new Set<GarageRowId>([
  'single_full_three',
  'single_one_wall_floor',
  'single_partial_forward',
  'double_full_three',
  'double_half',
  'double_partial_forward',
]);

const CORRIDOR_ROWS = new Set<CorridorRowId>([
  'exp_above_below',
  'exp_above_or_below',
  'not_exp_above_below',
  'not_exp_above_or_below',
]);

export const DEFAULT_RU_CALCULATOR_FORMULA_V1: RuCalculatorFormulaStateV1 = {
  sumMode: 'combined',
  ai: '',
  sumAeUe: '',
  exposedAe: '',
  uManual: '',
  exposedAssemblyId: '',
  vol: '',
  n: '3',
};

export const DEFAULT_RU_CALCULATOR_TABLE_V1: RuCalculatorTableStateV1 = {
  tableCategory: 'garage_single',
  garageRow: 'single_full_three',
  garageEnvelope: 'outside',
  stairwellFacing: 'exposed',
  corridorRow: 'exp_above_below',
};

export function parseRuCalculatorStateV1(raw: unknown): RuCalculatorStateV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (o.mode !== 'table' && o.mode !== 'formula') return null;
  const f = o.formula;
  if (!f || typeof f !== 'object') return null;
  const fm = f as Record<string, unknown>;
  if (fm.sumMode !== 'combined' && fm.sumMode !== 'split') return null;
  const formula: RuCalculatorFormulaStateV1 = {
    sumMode: fm.sumMode,
    ai: typeof fm.ai === 'string' ? fm.ai : '',
    sumAeUe: typeof fm.sumAeUe === 'string' ? fm.sumAeUe : '',
    exposedAe: typeof fm.exposedAe === 'string' ? fm.exposedAe : '',
    uManual: typeof fm.uManual === 'string' ? fm.uManual : '',
    exposedAssemblyId: typeof fm.exposedAssemblyId === 'string' ? fm.exposedAssemblyId : '',
    vol: typeof fm.vol === 'string' ? fm.vol : '',
    n: typeof fm.n === 'string' ? fm.n : '3',
  };

  const t = o.table;
  const table: RuCalculatorTableStateV1 = { ...DEFAULT_RU_CALCULATOR_TABLE_V1 };
  if (t && typeof t === 'object') {
    const tm = t as Record<string, unknown>;
    const cat = tm.tableCategory;
    if (
      cat === 'garage_single' ||
      cat === 'garage_double' ||
      cat === 'stairwell' ||
      cat === 'corridor'
    ) {
      table.tableCategory = cat;
    }
    const gr = tm.garageRow;
    if (typeof gr === 'string' && GARAGE_ROWS.has(gr as GarageRowId)) {
      table.garageRow = gr as GarageRowId;
    }
    const ge = tm.garageEnvelope;
    if (ge === 'inside' || ge === 'outside') table.garageEnvelope = ge;
    const sf = tm.stairwellFacing;
    if (sf === 'exposed' || sf === 'not_exposed') table.stairwellFacing = sf;
    const cr = tm.corridorRow;
    if (typeof cr === 'string' && CORRIDOR_ROWS.has(cr as CorridorRowId)) {
      table.corridorRow = cr as CorridorRowId;
    }
  }

  return {
    v: 1,
    mode: o.mode,
    formula,
    table,
  };
}

/** Always source A_i from the current element area when available. */
export function initialRuCalculatorStateV1(
  persisted: RuCalculatorStateV1 | null,
  defaultInterfaceAreaM2: number | undefined,
): RuCalculatorStateV1 {
  const elementAreaText =
    defaultInterfaceAreaM2 != null &&
    Number.isFinite(defaultInterfaceAreaM2) &&
    defaultInterfaceAreaM2 > 0
      ? String(Math.round(defaultInterfaceAreaM2 * 100) / 100)
      : '';

  if (persisted) {
    const formula = { ...persisted.formula };
    if (elementAreaText) formula.ai = elementAreaText;
    return { ...persisted, formula };
  }
  const formula = { ...DEFAULT_RU_CALCULATOR_FORMULA_V1 };
  if (elementAreaText) formula.ai = elementAreaText;
  return {
    v: 1,
    mode: 'table',
    formula,
    table: { ...DEFAULT_RU_CALCULATOR_TABLE_V1 },
  };
}

/** Σ(A_e × U_e) from one exposed surface area and U-value (W/m²K). */
export function sumAeUeFromAreaAndU(areaM2: number, uWm2K: number): number | null {
  if (!Number.isFinite(areaM2) || areaM2 < 0) return null;
  if (!Number.isFinite(uWm2K) || uWm2K < 0) return null;
  return areaM2 * uWm2K;
}
