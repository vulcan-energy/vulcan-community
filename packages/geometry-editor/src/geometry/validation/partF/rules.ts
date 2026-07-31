// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Part F (England — Domestic ventilation) sufficiency checks for the elements panel.
//
// Source of truth: hem_fhs_upstream/src/future_homes_standard/fhs_part_f_validation.rs:14-481
// Mirrors upstream's `mod part_f` pure-formula helpers plus its pathway dispatch
// (`validate_dwelling_ventilation`). When upstream changes a constant, the diff
// against that file is the only thing to read; tests in `partF.test.ts` lock the
// numbers in.
//
// Unit notes (matching upstream):
//   - `design_outdoor_air_flow_rate` is m³/h (engine internally calls it
//     `design_outdoor_air_flow_rate_m3_h`; see ventilation.rs:1328).
//   - Background vent `area_cm2` is cm².
//   - Helper formulas yield m³/h or cm² so direct comparison works without conversion.
//   - L/s thresholds (kitchen extract) are converted via × 3.6 → m³/h.

import type { Element, Vents, MechanicalVentilation } from '../../types';

// ---------------- Constants (verbatim from upstream) ----------------

const SECONDS_PER_HOUR = 3600;
const LITRES_PER_CUBIC_METRE = 1000;

// Match upstream's evaluation order verbatim — `lps * 3600 / 1000` resolves to a different
// IEEE-754 double than `lps * (3600/1000)`. The literal `133.2` and the value `37 l/s`
// converted via this path produce the same double, so equality / `>=` parity holds.
function lpsToM3h(lps: number): number {
  return (lps * SECONDS_PER_HOUR) / LITRES_PER_CUBIC_METRE;
}

// fhs_part_f_validation.rs:14-27
export function minimumWholeDwellingRateContinuousM3h(
  totalFloorAreaM2: number,
  bedrooms: number,
): number {
  const VENT_PER_M2 = 0.3; // l/s.m² floor area
  const floorAreaTermLs = totalFloorAreaM2 * VENT_PER_M2;
  const bedroomTermLs = 13 + bedrooms * 6; // Table 1.3 Part F
  return lpsToM3h(Math.max(floorAreaTermLs, bedroomTermLs));
}

// fhs_part_f_validation.rs:29-40
export function minimumKitchenVentFlowRateLs(isKitchenVentExternal: boolean): number {
  return isKitchenVentExternal ? 30 : 60;
}

// fhs_part_f_validation.rs:42-57
export function minimumWholeDwellingRateIntermittentM3h(
  bathrooms: number,
  utilityRooms: number,
  sanitaryAccommodations: number,
  isKitchenVentExternal: boolean,
): number {
  const ratePerBathroom = 15;
  const ratePerUtility = 30;
  const ratePerSanitary = 6;
  const kitchenLs = minimumKitchenVentFlowRateLs(isKitchenVentExternal);
  const totalLs =
    bathrooms * ratePerBathroom +
    utilityRooms * ratePerUtility +
    sanitaryAccommodations * ratePerSanitary +
    kitchenLs; // Assume one kitchen
  return lpsToM3h(totalLs);
}

// fhs_part_f_validation.rs:59-62
export function minimumBackgroundAreaContinuousCm2(habitableRooms: number): number {
  return habitableRooms * 40;
}

// fhs_part_f_validation.rs:64-80
export function minimumBackgroundAreaIntermittentCm2(
  habitableRooms: number,
  bathrooms: number,
  storeys: number,
): number {
  const perBathroom = 40;
  const [perHabitable, perKitchen] = storeys === 1 ? [100, 100] : [80, 80];
  return habitableRooms * perHabitable + bathrooms * perBathroom + perKitchen;
}

// fhs_part_f_validation.rs:82-84
export function minimumBackgroundCountContinuous(bedrooms: number): number {
  return bedrooms + 2;
}

// fhs_part_f_validation.rs:172-180 (sufficient_background_vent_count_intermittent)
export function minimumBackgroundCountIntermittent(bedrooms: number): number {
  return bedrooms < 2 ? 4 : 5;
}

// ---------------- Public types ----------------

export type PartFRule =
  | 'background_area_continuous'
  | 'background_count_continuous'
  | 'background_area_intermittent'
  | 'background_count_intermittent'
  | 'whole_dwelling_continuous'
  | 'whole_dwelling_intermittent'
  | 'imev_count'
  | 'decentralised_cmev_count'
  | 'large_imev'
  | 'mvhr_no_background_vents';

export type PartFPathway = 'intermittent' | 'continuous' | 'always';

export interface PartFFinding {
  rule: PartFRule;
  pathway: PartFPathway;
  required: number;
  supplied: number;
  units: 'cm²' | 'm³/h' | 'count';
  /** Short label suited to a pill qualifier — e.g. "Background area: 80 / 200 cm²". */
  shortLabel: string;
  /** Full sentence for tooltips and ValidationIssue messages. */
  fullMessage: string;
  /** Element ids the user can fix this on. Empty ⇒ surface as MissingElement only. */
  affectedElementIds: string[];
}

export interface PartFInput {
  /** From `complianceSettings.NumberOfBedrooms`, etc. Counts default to 0 when undefined. */
  bedrooms: number;
  habitableRooms: number;
  wetRooms: number;
  bathrooms: number;
  utilityRooms: number;
  sanitaryAccommodations: number;
  storeys: number;
  isKitchenVentExternal: boolean;
  /** Live floor area (sum of habitable space-label polygon areas). */
  totalFloorAreaM2: number;
  /** All non-placeholder Vents in the model. */
  vents: Vents[];
  /** All non-placeholder MechanicalVentilation in the model. */
  mechanicalVentilation: MechanicalVentilation[];
}

// ---------------- Helpers ----------------

function sumArea(vents: Vents[]): number {
  return vents.reduce((acc, v) => acc + (Number.isFinite(v.area_cm2) ? v.area_cm2 : 0), 0);
}

function sumFlow(mv: MechanicalVentilation[]): number {
  // Flow lives in extra_json on MechanicalVentilation; fall back to 0 when missing.
  return mv.reduce((acc, m) => {
    const extra = (m as { extra_json?: Record<string, unknown> }).extra_json;
    const raw = extra && typeof extra === 'object' ? extra.design_outdoor_air_flow_rate : undefined;
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
    return acc + n;
  }, 0);
}

function maxFlow(mv: MechanicalVentilation[]): number {
  let m = 0;
  for (const v of mv) {
    const extra = (v as { extra_json?: Record<string, unknown> }).extra_json;
    const raw = extra && typeof extra === 'object' ? extra.design_outdoor_air_flow_rate : undefined;
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
    if (n > m) m = n;
  }
  return m;
}

function fmt(n: number, units: 'cm²' | 'm³/h' | 'count'): string {
  if (units === 'count') return `${Math.round(n)}`;
  // 1 dp is plenty for the panel.
  return `${Math.round(n * 10) / 10} ${units}`;
}

// ---------------- Per-rule evaluators ----------------

function backgroundAreaContinuous(input: PartFInput, vents: Vents[]): PartFFinding | null {
  const required = minimumBackgroundAreaContinuousCm2(input.habitableRooms);
  const supplied = sumArea(vents);
  if (supplied >= required) return null;
  return {
    rule: 'background_area_continuous',
    pathway: 'continuous',
    required,
    supplied,
    units: 'cm²',
    shortLabel: `Background area: ${fmt(supplied, 'cm²')} / ${fmt(required, 'cm²')}`,
    fullMessage: `Part F: background ventilation area below the continuous-pathway minimum (${fmt(required, 'cm²')} required for ${input.habitableRooms} habitable rooms; current total ${fmt(supplied, 'cm²')}).`,
    affectedElementIds: vents.length === 1 ? [vents[0].id] : [],
  };
}

function backgroundCountContinuous(input: PartFInput, vents: Vents[]): PartFFinding | null {
  const required = minimumBackgroundCountContinuous(input.bedrooms);
  const supplied = vents.length;
  if (supplied >= required) return null;
  return {
    rule: 'background_count_continuous',
    pathway: 'continuous',
    required,
    supplied,
    units: 'count',
    shortLabel: `Vents: ${supplied} / ${required}`,
    fullMessage: `Part F: at least ${required} background vents required for the continuous pathway (bedrooms + 2). Current count: ${supplied}.`,
    affectedElementIds: [],
  };
}

function backgroundAreaIntermittent(input: PartFInput, vents: Vents[]): PartFFinding | null {
  const required = minimumBackgroundAreaIntermittentCm2(
    input.habitableRooms,
    input.bathrooms,
    input.storeys,
  );
  const supplied = sumArea(vents);
  if (supplied >= required) return null;
  return {
    rule: 'background_area_intermittent',
    pathway: 'intermittent',
    required,
    supplied,
    units: 'cm²',
    shortLabel: `Background area: ${fmt(supplied, 'cm²')} / ${fmt(required, 'cm²')}`,
    fullMessage: `Part F: background ventilation area below the intermittent-pathway minimum (${fmt(required, 'cm²')} required; current total ${fmt(supplied, 'cm²')}).`,
    affectedElementIds: vents.length === 1 ? [vents[0].id] : [],
  };
}

function backgroundCountIntermittent(input: PartFInput, vents: Vents[]): PartFFinding | null {
  const required = minimumBackgroundCountIntermittent(input.bedrooms);
  const supplied = vents.length;
  if (supplied >= required) return null;
  return {
    rule: 'background_count_intermittent',
    pathway: 'intermittent',
    required,
    supplied,
    units: 'count',
    shortLabel: `Vents: ${supplied} / ${required}`,
    fullMessage: `Part F: at least ${required} background vents required for the intermittent pathway (Part F section 1.57). Current count: ${supplied}.`,
    affectedElementIds: [],
  };
}

function wholeDwellingContinuous(
  input: PartFInput,
  continuousMechVents: MechanicalVentilation[],
): PartFFinding | null {
  const required = minimumWholeDwellingRateContinuousM3h(input.totalFloorAreaM2, input.bedrooms);
  const supplied = sumFlow(continuousMechVents);
  if (supplied >= required) return null;
  return {
    rule: 'whole_dwelling_continuous',
    pathway: 'always',
    required,
    supplied,
    units: 'm³/h',
    shortLabel: `Continuous extract: ${fmt(supplied, 'm³/h')} / ${fmt(required, 'm³/h')}`,
    fullMessage: `Part F: combined continuous extract rate below the whole-dwelling minimum (${fmt(required, 'm³/h')} required; current total ${fmt(supplied, 'm³/h')}).`,
    affectedElementIds: continuousMechVents.map((m) => m.id),
  };
}

function wholeDwellingIntermittent(
  input: PartFInput,
  intermittentMev: MechanicalVentilation[],
): PartFFinding | null {
  const required = minimumWholeDwellingRateIntermittentM3h(
    input.bathrooms,
    input.utilityRooms,
    input.sanitaryAccommodations,
    input.isKitchenVentExternal,
  );
  const supplied = sumFlow(intermittentMev);
  if (supplied >= required) return null;
  return {
    rule: 'whole_dwelling_intermittent',
    pathway: 'intermittent',
    required,
    supplied,
    units: 'm³/h',
    shortLabel: `Intermittent extract: ${fmt(supplied, 'm³/h')} / ${fmt(required, 'm³/h')}`,
    fullMessage: `Part F: combined intermittent extract rate below the whole-dwelling minimum (${fmt(required, 'm³/h')} required; current total ${fmt(supplied, 'm³/h')}).`,
    affectedElementIds: intermittentMev.map((m) => m.id),
  };
}

function imevCount(input: PartFInput, intermittentMev: MechanicalVentilation[]): PartFFinding | null {
  const required = input.wetRooms;
  const supplied = intermittentMev.length;
  if (supplied >= required) return null;
  return {
    rule: 'imev_count',
    pathway: 'intermittent',
    required,
    supplied,
    units: 'count',
    shortLabel: `iMEV: ${supplied} / ${required}`,
    fullMessage: `Part F: at least one intermittent MEV per wet room (${required} wet rooms; current iMEV count ${supplied}).`,
    affectedElementIds: [],
  };
}

function decentralisedCmevCount(
  input: PartFInput,
  centralisedMev: MechanicalVentilation[],
  decentralisedMev: MechanicalVentilation[],
): PartFFinding | null {
  // Only enforced when decentralised exists and there are no centralised vents (matches upstream).
  if (decentralisedMev.length === 0 || centralisedMev.length > 0) return null;
  const required = input.wetRooms;
  const supplied = decentralisedMev.length;
  if (supplied >= required) return null;
  return {
    rule: 'decentralised_cmev_count',
    pathway: 'continuous',
    required,
    supplied,
    units: 'count',
    shortLabel: `Decentralised cMEV: ${supplied} / ${required}`,
    fullMessage: `Part F: at least one decentralised continuous MEV per wet room (${required} wet rooms; current count ${supplied}).`,
    affectedElementIds: [],
  };
}

function largeImev(
  input: PartFInput,
  intermittentMev: MechanicalVentilation[],
): PartFFinding | null {
  if (intermittentMev.length === 0) return null;
  const requiredM3h = lpsToM3h(minimumKitchenVentFlowRateLs(input.isKitchenVentExternal));
  const largest = maxFlow(intermittentMev);
  if (largest >= requiredM3h) return null;
  return {
    rule: 'large_imev',
    pathway: 'intermittent',
    required: requiredM3h,
    supplied: largest,
    units: 'm³/h',
    shortLabel: `Kitchen iMEV: ${fmt(largest, 'm³/h')} / ${fmt(requiredM3h, 'm³/h')}`,
    fullMessage: `Part F: at least one intermittent MEV must meet the kitchen extract minimum (${fmt(requiredM3h, 'm³/h')} ≈ ${minimumKitchenVentFlowRateLs(input.isKitchenVentExternal)} l/s ${input.isKitchenVentExternal ? 'extracting outside' : 'not extracting outside'}). Largest iMEV: ${fmt(largest, 'm³/h')}.`,
    affectedElementIds: intermittentMev.map((m) => m.id),
  };
}

function mvhrNoBackgroundVents(
  vents: Vents[],
  mvhr: MechanicalVentilation[],
): PartFFinding | null {
  if (mvhr.length === 0 || vents.length === 0) return null;
  return {
    rule: 'mvhr_no_background_vents',
    pathway: 'continuous',
    required: 0,
    supplied: vents.length,
    units: 'count',
    shortLabel: `MVHR + ${vents.length} vent${vents.length === 1 ? '' : 's'}`,
    fullMessage:
      'Part F: dwellings with MVHR should have no background vents — remove existing vents or switch ventilation strategy.',
    affectedElementIds: vents.map((v) => v.id),
  };
}

// ---------------- Public entry point ----------------

export function evaluatePartF(input: PartFInput): PartFFinding[] {
  const vents = input.vents;
  const mv = input.mechanicalVentilation;

  // No mech vents at all → upstream raises "Dwelling lacks any mechanical vents." That case is
  // already covered by the existing detectMissingElements() emit at line 222 — we don't duplicate.
  if (mv.length === 0) return [];

  const intermittent = mv.filter((m) => m.vent_type === 'Intermittent MEV');
  const mvhr = mv.filter((m) => m.vent_type === 'MVHR');
  const centralised = mv.filter((m) => m.vent_type === 'Centralised continuous MEV');
  const decentralised = mv.filter((m) => m.vent_type === 'Decentralised continuous MEV');
  const continuousMech = [...centralised, ...decentralised, ...mvhr];

  const hasIntermittentPathway = intermittent.length > 0;
  const hasContinuousPathway = mvhr.length > 0 || centralised.length > 0 || decentralised.length > 0;

  // Pathway-scoped failures (collected even when the OR-rule will hide them; we filter at the end).
  const intermittentFails: PartFFinding[] = [];
  if (hasIntermittentPathway) {
    const f1 = backgroundAreaIntermittent(input, vents);
    if (f1) intermittentFails.push(f1);
    const f2 = wholeDwellingIntermittent(input, intermittent);
    if (f2) intermittentFails.push(f2);
    const f3 = imevCount(input, intermittent);
    if (f3) intermittentFails.push(f3);
    const f4 = largeImev(input, intermittent);
    if (f4) intermittentFails.push(f4);
    const f5 = backgroundCountIntermittent(input, vents);
    if (f5) intermittentFails.push(f5);
  }

  const continuousFails: PartFFinding[] = [];
  if (hasContinuousPathway) {
    if (mvhr.length > 0) {
      const conflict = mvhrNoBackgroundVents(vents, mvhr);
      if (conflict) continuousFails.push(conflict);
    }
    if (centralised.length > 0 || decentralised.length > 0) {
      const f1 = backgroundAreaContinuous(input, vents);
      if (f1) continuousFails.push(f1);
      const f2 = backgroundCountContinuous(input, vents);
      if (f2) continuousFails.push(f2);
      const f3 = decentralisedCmevCount(input, centralised, decentralised);
      if (f3) continuousFails.push(f3);
    }
  }

  // OR-of-pathways: when both pathways are present, the dwelling passes overall iff either
  // pathway has zero failures. Mirrors upstream lines 470-474. We surface only the failures
  // from the pathway(s) that don't have a passing alternative.
  let pathwayFails: PartFFinding[] = [];
  if (hasIntermittentPathway && hasContinuousPathway) {
    const intermittentClean = intermittentFails.length === 0;
    const continuousClean = continuousFails.length === 0;
    if (!intermittentClean && !continuousClean) {
      pathwayFails = [...intermittentFails, ...continuousFails];
    }
    // else: at least one pathway is passing → nothing to surface from pathway-scoped checks.
  } else if (hasIntermittentPathway) {
    pathwayFails = intermittentFails;
  } else if (hasContinuousPathway) {
    pathwayFails = continuousFails;
  }

  // Whole-dwelling continuous extract is always evaluated when continuous mech is present —
  // independent of the OR-of-pathways outcome (upstream lines 311-324).
  const alwaysFails: PartFFinding[] = [];
  if (continuousMech.length > 0) {
    const wd = wholeDwellingContinuous(input, continuousMech);
    if (wd) alwaysFails.push(wd);
  }

  // Deduplicate: backgroundArea/Count rules only differ between pathways. If the user happens to
  // have both pathways and we'd surface both, prefer the more onerous (continuous tends to set
  // larger area thresholds; intermittent sets larger count thresholds; we keep both since the
  // shape differs — but a single rule from each list is enough).
  const seen = new Set<PartFRule>();
  const out: PartFFinding[] = [];
  for (const f of [...pathwayFails, ...alwaysFails]) {
    if (seen.has(f.rule)) continue;
    seen.add(f.rule);
    out.push(f);
  }
  return out;
}

// ---------------- Convenience: build PartFInput from a resolved detection context ----------------

/**
 * Shape produced by `resolveEffectivePartFContext` (or assembled from upstream Part F
 * detection callers). All count fields may be `undefined` when not yet resolved.
 */
export interface PartFContextLike {
  totalFloorAreaM2: number;
  bedrooms?: number;
  habitableRooms?: number;
  wetRooms?: number;
  bathrooms?: number;
  utilityRooms?: number;
  sanitaryAccommodations?: number;
  storeys?: number;
  isKitchenVentExternal?: boolean;
}

/**
 * Per-field defaults for elements whose live value is unset. The store often holds
 * `area_cm2 = 0` or no `design_outdoor_air_flow_rate` until the user types one;
 * `defaults_template.json` is what the simulation actually sees. Pass these in to make
 * Part F validation match engine behaviour.
 */
export interface PartFElementDefaults {
  /** Default `area_cm2` for `Vents` elements. */
  ventArea?: number;
  /** Returns the default `design_outdoor_air_flow_rate` for a given `vent_type`, or undefined. */
  mechVentFlowFor?: (ventType: MechanicalVentilation['vent_type']) => number | undefined;
}

/**
 * Builds the evaluator input from a resolved context + element list. Returns null when
 * any required count is still undefined or when there are no real (non-placeholder)
 * elements to evaluate. Filters Vents/MV out of placeholders.
 *
 * `defaults` is optional — pass it to substitute defaults_template values for unset element
 * fields, matching what the engine would see at simulation time. Without it, the function
 * is pure and returns whatever the live elements carry. The store call sites pass defaults
 * via the existing `defaultsCache` helpers; tests can pass synthetic defaults or omit them
 * entirely.
 */
export function partFInputFromContext(
  ctx: PartFContextLike,
  elements: Element[],
  defaults?: PartFElementDefaults,
): PartFInput | null {
  const required = [
    ctx.bedrooms,
    ctx.habitableRooms,
    ctx.wetRooms,
    ctx.bathrooms,
    ctx.utilityRooms,
    ctx.sanitaryAccommodations,
    ctx.storeys,
  ];
  if (required.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;

  const realElements = elements.filter((e) => !e.isPlaceholder);
  if (realElements.length === 0) return null;

  const ventDefaultArea = defaults?.ventArea;

  const vents = realElements
    .filter((e): e is Vents => e.type === 'Vents')
    .map((v) => {
      const live = Number.isFinite(v.area_cm2) ? v.area_cm2 : 0;
      if (live > 0) return v;
      const fallback = typeof ventDefaultArea === 'number' && Number.isFinite(ventDefaultArea)
        ? ventDefaultArea
        : 0;
      return fallback > 0 ? { ...v, area_cm2: fallback } : v;
    });

  const mv = realElements
    .filter((e): e is MechanicalVentilation => e.type === 'MechanicalVentilation')
    .map((m) => {
      const ej = (m as { extra_json?: Record<string, unknown> }).extra_json ?? {};
      const liveFlow = ej.design_outdoor_air_flow_rate;
      if (typeof liveFlow === 'number' && Number.isFinite(liveFlow)) return m;
      const fallback = defaults?.mechVentFlowFor?.(m.vent_type);
      if (typeof fallback !== 'number' || !Number.isFinite(fallback)) return m;
      return {
        ...m,
        extra_json: { ...ej, design_outdoor_air_flow_rate: fallback },
      };
    });

  return {
    bedrooms: ctx.bedrooms!,
    habitableRooms: ctx.habitableRooms!,
    wetRooms: ctx.wetRooms!,
    bathrooms: ctx.bathrooms!,
    utilityRooms: ctx.utilityRooms!,
    sanitaryAccommodations: ctx.sanitaryAccommodations!,
    storeys: ctx.storeys!,
    isKitchenVentExternal: ctx.isKitchenVentExternal !== false,
    totalFloorAreaM2: ctx.totalFloorAreaM2,
    vents,
    mechanicalVentilation: mv,
  };
}
