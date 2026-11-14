// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Heating sizing check. Compares each zone's static design heat loss (the target's
 * `design_heat_loss` export, hem-target-core/src/design_heat_loss.rs) with the heat
 * sources and emitters of the prepared HEM core input the target runs.
 *
 * Pure and JSON in, JSON out, so the web app and the community CLI can share it.
 * Missing or unsupported data gives an explicit status and reason, never a guessed number.
 * Field names follow hem_engine_upstream/src/input.rs (HeatSourceWetDetails,
 * SpaceHeatSystemDetails::WetDistribution, WetEmitter, EcoDesignController).
 */

export interface ZoneDesignHeatLoss {
  htcWPerK: number;
  fabricWPerK: number;
  thermalBridgesWPerK: number;
  ventilationWPerK: number;
  designLossKw: number;
}

export interface DesignHeatLoss {
  coldestHourC: number;
  setpointC: number;
  /** Display name of the weather file coldestHourC comes from (e.g. "Bedford", "London"); the host names it. */
  weatherName: string;
  zones: Record<string, ZoneDesignHeatLoss>;
}

export type SizingStatus = 'ok' | 'no-data' | 'unsupported' | 'error';

export interface CurvePoint {
  flowC: number;
  outputKw: number;
}

/** One SpaceHeatSystem: its zone's design loss against its emitters. */
export interface SystemSizing {
  name: string;
  kind: string;
  zone: string | null;
  /** HeatSource names: one object in Core and FHS, a priority list in HEM:EPC. */
  heatSources: string[];
  status: SizingStatus;
  reason: string | null;
  designLossKw: number | null;
  /** The system's design_flow_temp setting. Weather compensation runs it only at or below min_outdoor_temp. */
  designFlowTempC: number | null;
  flowTempAtDesignC: number | null;
  /** The most the radiators give at flowTempAtDesignC, in steady state (see radiatorOutputKw). */
  outputAtDesignKw: number | null;
  /** Emitter output in 1 K steps from CURVE_MIN_FLOW_C to CURVE_MAX_FLOW_C, or to the design flow temperature (rounded up) when that is higher. */
  curve: CurvePoint[];
  /**
   * Lowest flow temperature, rounded up to 0.1 C, whose output covers the design loss; the design
   * flow temperature itself when that covers it and is lower. Null when no flow up to
   * MIN_FLOW_SEARCH_MAX_C (or the design flow, if higher) covers it. verdict is 'ok' exactly when
   * flowTempAtDesignC >= minFlowC.
   */
  minFlowC: number | null;
  verdict: 'ok' | 'too-small' | null;
  /**
   * ceil(minFlowC) when it is worth suggesting as the design flow temperature, else null. Only when
   * the radiators are big enough, the design day runs the design_flow_temp setting (with weather
   * compensation: a design day at or below min_outdoor_temp, or a curve clamped at the setting; a
   * milder design day runs less than the setting, so the two are not the same thing), it is at
   * least 1 °C below that flow, it is not below 30 °C (the chart's first flow), the weather
   * compensation lower limit (min_flow_temp) or any heat pump's lowest tested flow, and every heat
   * source is an outside air heat pump that serves only this system and is still big enough and
   * not too big at it.
   */
  suggestedFlowC: number | null;
  notes: string[];
}

/** One HeatSourceWet: the summed design loss of the zones it serves against its range. */
export interface HeatSourceSizing {
  name: string;
  kind: string;
  systems: string[];
  status: SizingStatus;
  reason: string | null;
  designLossKw: number | null;
  flowTempC: number | null;
  minKw: number | null;
  maxKw: number | null;
  verdict: 'ok' | 'too-small' | 'too-big' | null;
  shortfallKw: number | null;
  /** Outside temperature where the served zones' HTC x (setpoint - T) equals maxKw. */
  balancePointC: number | null;
  /** Heat pumps only: power_max_backup > 0 or a backup boiler. */
  hasBackupHeater: boolean | null;
  /** A zone it serves also has a heating system that is not sized (e.g. a direct electric heater), which can cover a shortfall. */
  otherSystemsInZone: boolean;
  /** Heat pumps only: temp_test of the EN 14825 point whose capacity is maxKw. */
  testPointC: number | null;
  /** Heat pumps only: how far the coldest hour is below testPointC (K); null when it is not. */
  designBelowTestPointK: number | null;
  notes: string[];
}

export interface HeatingSizing {
  /** The design conditions the verdicts were judged at (the weather file's coldest hour; the zones' set-point). */
  coldestHourC: number;
  setpointC: number;
  /** DesignHeatLoss.weatherName: the weather file the coldest hour is from. */
  weatherName: string;
  /** Zones in the design heat loss. 1: a zone's loss is the whole house's ("the house needs"); more: "the zone needs". */
  zoneCount: number;
  systems: SystemSizing[];
  heatSources: HeatSourceSizing[];
  notes: string[];
}

export const CURVE_MIN_FLOW_C = 30;
/** The curve's top unless the design flow temperature is higher. */
export const CURVE_MAX_FLOW_C = 70;
/** The highest flow temperature searched for minFlowC unless the design flow temperature is higher. */
export const MIN_FLOW_SEARCH_MAX_C = 100;

type Json = Record<string, unknown>;

/** Plain names for the model kinds that are not sized, with the verb that agrees with each. Unknown kinds fall back to a generic sentence. */
const UNSIZED: Record<string, [name: string, verb: 'is' | 'are']> = {
  InstantElecHeater: ['Direct electric heaters', 'are'],
  ElecStorageHeater: ['Electric storage heaters', 'are'],
  WarmAir: ['Warm air systems', 'are'],
  HeatBattery: ['Heat batteries', 'are'],
  HIU: ['Heat networks', 'are'],
  PrimaryThermalStore: ['Thermal stores', 'are'],
  ufh: ['Underfloor heating', 'is'],
  fancoil: ['Fan coils', 'are'],
  Ground: ['Ground source heat pumps', 'are'],
  WaterGround: ['Ground water source heat pumps', 'are'],
  WaterSurface: ['Surface water source heat pumps', 'are'],
  ExhaustAirMEV: ['Exhaust air heat pumps', 'are'],
  ExhaustAirMVHR: ['Exhaust air heat pumps', 'are'],
  ExhaustAirMixed: ['Exhaust air heat pumps', 'are'],
  HeatNetwork: ['Heat network heat pumps', 'are'],
};

/** "<Plain name> are not sized yet." */
export function notSizedYet(kind: string, generic: string): string {
  const known = UNSIZED[kind];
  return known ? `${known[0]} ${known[1]} not sized yet.` : generic;
}

/** Start of the host's reason when the pinned target has no sizing (VulcanHeatingSizing.ts); the editor shows nothing for it. */
export const NO_TARGET_SIZING_REASON_PREFIX = 'Heating sizing is not available for this target.';

const NO_LOSS = 'The design heat loss is zero or negative, so there is nothing to size against.';
/** How the zone's loss divides between two systems is not known, so neither is judged against all of it. */
export const SHARED_ZONE = 'More than one heating system serves this zone.';

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Json | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
const objects = (v: unknown): Json[] =>
  Array.isArray(v) ? v.flatMap((x) => (obj(x) ? [x as Json] : [])) : [];
const entries = (v: unknown): [string, Json][] =>
  Object.entries(obj(v) ?? {}).flatMap(([k, x]) => (obj(x) ? [[k, x as Json]] : []));

/** numpy.interp as the engine uses it (np_interp): linear, clamped at the ends. */
function interp(x: number, points: [number, number][]): number {
  const [first, last] = [points[0], points[points.length - 1]];
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  const i = points.findIndex(([px]) => px >= x);
  const [x0, y0] = points[i - 1];
  const [x1, y1] = points[i];
  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}

/**
 * Flow temperature in the coldest hour. Copies the engine's weather compensation,
 * hem_engine_upstream/src/core/heating_systems/emitters.rs `temp_flow_return`: classes
 * II, III, VI and VII run min_flow_temp above max_outdoor_temp, design_flow_temp below
 * min_outdoor_temp and interpolate between; other classes run design_flow_temp.
 * HEM:EPC (hem-core heating_systems/emitters.py `temp_flow_return`) replaces the outdoor
 * limits with a curve a T^2 + b T + c (when weather_comp_a is set), clamped to
 * min_flow_temp..design_flow_temp. Its load compensation depends on the room temperature,
 * which a static check does not know; it runs only when load_comp_a is set, in classes I, IV,
 * V and VIII, or in II, III, VI and VII on a weather_comp curve. Elsewhere the engine ignores
 * the load_comp fields, and so does this check. The Rust engine has no load compensation.
 */
function flowAtDesign(system: Json, coldestC: number): number | string {
  const design = num(system.design_flow_temp);
  if (design === null) return 'The system has no design flow temperature.';
  const ctrl = obj(system.ecodesign_controller);
  const controlClass = num(ctrl?.ecodesign_control_class) ?? 0;
  const weatherCompensated = [2, 3, 6, 7].includes(controlClass);
  const onCurve = ctrl?.weather_comp_a != null;
  if (ctrl?.load_comp_a != null && ([1, 4, 5, 8].includes(controlClass) || (weatherCompensated && onCurve))) {
    return 'Load compensation sets the flow temperature from the room temperature, which this check does not know.';
  }
  if (!weatherCompensated) return design;
  if (onCurve) {
    const curve = ['weather_comp_a', 'weather_comp_b', 'weather_comp_c'].map((k) => num(ctrl?.[k]));
    const [a, b, c] = curve;
    const minFlowC = num(ctrl?.min_flow_temp);
    if (a === null || b === null || c === null || minFlowC === null) {
      return 'The weather compensation curve needs weather_comp_a, weather_comp_b, weather_comp_c and min_flow_temp.';
    }
    return Math.max(minFlowC, Math.min(design, a * coldestC ** 2 + b * coldestC + c));
  }
  const lo = num(ctrl?.min_outdoor_temp);
  const hi = num(ctrl?.max_outdoor_temp);
  const minFlow = num(ctrl?.min_flow_temp);
  if (lo === null || hi === null || minFlow === null) {
    return 'Weather compensation needs min_outdoor_temp, max_outdoor_temp and min_flow_temp.';
  }
  if (coldestC < lo) return design;
  if (coldestC > hi) return minFlow;
  return minFlow + (coldestC - hi) * ((design - minFlow) / (lo - hi));
}

/** c and n of each radiator; c_per_m x length as the engine reads it (emitters.rs, Emitters::new). */
function radiatorConstants(emitters: Json[]): [number, number][] | string {
  const out: [number, number][] = [];
  for (const e of emitters) {
    const cPerM = num(e.c_per_m);
    const length = num(e.length);
    const c = cPerM !== null && length !== null ? cPerM * length : num(e.c);
    const n = num(e.n);
    if (c === null || n === null) return 'A radiator has no c (or c_per_m and length) or n.';
    out.push([c, n]);
  }
  return out;
}

/*
 * Radiator output follows the HEM engine's own steady state. Rust: hem_engine_upstream/src/core/
 * heating_systems/emitters.rs; Python (HEM:EPC): hem-core heating_systems/emitters.py. The two
 * are the same here, so one form serves every target.
 *
 * 1. Output from the mean water temperature T_E (`power_output_emitter`, emitters.rs:773,
 *    emitters.py:802): P = sum of c x max(0, T_E - T_room)^n over the radiators.
 * 2. T_E is the mean of flow and return (`demand_energy_flow_return`, emitters.rs:1430-1434,
 *    emitters.py:1725): temp_emitter_max = (flow + return) / 2. In steady state the emitters sit
 *    at that maximum while they give all they can.
 * 3. The return comes from the circuit (`return_temp_from_flow_rate`, emitters.rs:1705-1838,
 *    emitters.py:2109-2251). Variable flow: return = flow - temp_diff_emit_dsgn while the flow
 *    rate P / (cp x temp_diff_emit_dsgn) is inside min_flow_rate..max_flow_rate (l/min);
 *    outside it the rate stays at the limit. Fixed flow: the rate is design_flow_rate. At a set
 *    rate the return solves P = cp x rate x (flow - return) (`update_return_temp`, bisection,
 *    emitters.rs:1867, emitters.py:2290). The 6/7 rule in `temp_flow_return` (emitters.rs:752-758,
 *    emitters.py:752-754) is only that bisection's starting point; it does not reach the result.
 *    Water is 1 kg/l and 4184 J/kg K (material_properties.rs:68, material_properties.py:72).
 * 4. T_room is the zone air temperature (`temp_internal_air`). This check takes it as the
 *    heat-loss set-point.
 *
 * So the water drop dT(P) = P / (cp x rate(P)) and the radiators give P at flow F when
 * P = sum c x (F - dT(P) / 2 - T_room)^n.
 */
const radiatorOutputKw = (rads: [number, number][], meanWaterC: number, roomC: number) =>
  rads.reduce((sum, [c, n]) => sum + c * Math.max(0, meanWaterC - roomC) ** n, 0);

/** kW that 1 l/min of water carries per K of drop: 1 kg/l x 4.184 kJ/kg K / 60 s. */
const WATER_KW_PER_L_MIN_K = 4.184 / 60;

/** The drop across the radiators (K) when they give `kw`, from the circuit's flow rate (step 3 above). */
function waterDrop(system: Json): ((kw: number) => number) | string {
  if (system.variable_flow === true) {
    const dropK = num(system.temp_diff_emit_dsgn);
    const [lo, hi] = [num(system.min_flow_rate), num(system.max_flow_rate)];
    if (dropK === null) return 'Variable flow needs temp_diff_emit_dsgn.';
    if (lo === null || hi === null) return 'Variable flow needs min_flow_rate and max_flow_rate.';
    return (kw) => {
      if (kw <= 0) return 0;
      const rate = Math.min(hi, Math.max(lo, kw / (WATER_KW_PER_L_MIN_K * dropK)));
      return kw / (WATER_KW_PER_L_MIN_K * rate);
    };
  }
  if (system.variable_flow === false) {
    const rate = num(system.design_flow_rate);
    if (rate === null) return 'Fixed flow needs design_flow_rate.';
    return (kw) => kw / (WATER_KW_PER_L_MIN_K * rate);
  }
  return 'The system has no variable_flow.';
}

/**
 * The most the radiators give at `flowC`: the P that solves P = output(flow - dT(P) / 2). The
 * right side falls as P rises, so bisection between 0 and the output at mean = flow finds it.
 */
function maxOutputKw(rads: [number, number][], drop: (kw: number) => number, flowC: number, roomC: number): number {
  let [lo, hi] = [0, radiatorOutputKw(rads, flowC, roomC)];
  for (let i = 0; i < 100 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    if (radiatorOutputKw(rads, flowC - drop(mid) / 2, roomC) >= mid) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** True when any object nested in v has name === target (a HeatSource reference). */
const refersTo = (v: unknown, target: string): boolean =>
  v !== null && typeof v === 'object' &&
  ((v as Json).name === target || Object.values(v as Json).some((x) => refersTo(x, target)));

const heatSourceNames = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).flatMap((h) => str(obj(h)?.name) ?? []);

function sizeSystem(name: string, system: Json, zone: string | null, loss: DesignHeatLoss): SystemSizing {
  const result: SystemSizing = {
    name,
    kind: str(system.type) ?? 'unknown',
    zone,
    heatSources: heatSourceNames(system.HeatSource),
    status: 'ok',
    reason: null,
    designLossKw: null,
    designFlowTempC: null,
    flowTempAtDesignC: null,
    outputAtDesignKw: null,
    curve: [],
    minFlowC: null,
    verdict: null,
    suggestedFlowC: null,
    notes: [],
  };
  const fail = (status: SizingStatus, reason: string) => ({ ...result, status, reason });
  const zoneLoss = zone === null ? undefined : loss.zones[zone];
  result.designLossKw = zoneLoss?.designLossKw ?? null;
  if (result.kind !== 'WetDistribution') {
    return fail('unsupported', notSizedYet(result.kind, 'This system type is not sized yet.'));
  }
  if (zone === null) return fail('error', 'The system has no Zone.');
  if (!zoneLoss) return fail('error', `Zone "${zone}" has no design heat loss.`);
  if (zoneLoss.designLossKw <= 0) return fail('no-data', NO_LOSS);
  const emitters = objects(system.emitters);
  if (emitters.length === 0) return fail('no-data', 'The system has no emitters.');
  const other = [...new Set(emitters.map((e) => str(e.wet_emitter_type) ?? 'unknown'))].filter(
    (k) => k !== 'radiator',
  );
  if (other.length > 0) {
    return fail('unsupported', other.length === 1
      ? notSizedYet(other[0], 'This emitter type is not sized yet.')
      : `Only radiators are sized yet. This system also has ${other.map((k) => UNSIZED[k]?.[0].toLowerCase() ?? 'other emitters').join(' and ')}.`);
  }
  const rads = radiatorConstants(emitters);
  if (typeof rads === 'string') return fail('no-data', rads);
  if ((num(system.bypass_fraction_recirculated) ?? 0) > 0) {
    return fail('unsupported', 'A bypass that sends return water back into the flow is not sized yet.');
  }
  const drop = waterDrop(system);
  if (typeof drop === 'string') return fail('no-data', drop);
  const flowC = flowAtDesign(system, loss.coldestHourC);
  if (typeof flowC === 'string') return fail('no-data', flowC);

  const roomC = loss.setpointC;
  const lossKw = zoneLoss.designLossKw;
  for (let f = CURVE_MIN_FLOW_C; f <= Math.max(CURVE_MAX_FLOW_C, Math.ceil(flowC)); f++) {
    result.curve.push({ flowC: f, outputKw: maxOutputKw(rads, drop, f, roomC) });
  }
  result.designFlowTempC = num(system.design_flow_temp);
  result.flowTempAtDesignC = flowC;
  result.outputAtDesignKw = maxOutputKw(rads, drop, flowC, roomC);
  // Flow F covers the loss when the radiators give it with the water dropping dT(loss).
  const covers = (f: number) => radiatorOutputKw(rads, f - drop(lossKw) / 2, roomC) >= lossKw;
  result.verdict = covers(flowC) ? 'ok' : 'too-small';
  const minFlowC = lowestFlowCovering(covers, roomC, Math.max(MIN_FLOW_SEARCH_MAX_C, flowC));
  // Rounding up can pass a design flow that already covers the loss; then that flow is the answer.
  result.minFlowC = minFlowC !== null && result.verdict === 'ok' ? Math.min(minFlowC, flowC) : minFlowC;
  return result;
}

/**
 * Lowest flow up to `maxC` that covers the loss, rounded up to 0.1 C, by bisection: output
 * rises with flow above the room temperature and is zero at or below it.
 */
function lowestFlowCovering(covers: (flowC: number) => boolean, roomC: number, maxC: number): number | null {
  if (!covers(maxC)) return null;
  let [lo, hi] = [roomC, maxC];
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (covers(mid)) hi = mid;
    else lo = mid;
  }
  // `hi` covers the loss. Round up to 0.1 C, stepping once more if floating point fell short.
  const rounded = Math.ceil(Math.round(hi * 1e6) / 1e5) / 10;
  return covers(rounded) ? rounded : Math.round(rounded * 10 + 1) / 10;
}

type Range = {
  minKw: number | null;
  maxKw: number;
  hasBackupHeater: boolean | null;
  testPointC: number | null;
  designBelowTestPointK: number | null;
  notes: string[];
};
type Fail = { status: SizingStatus; reason: string };
const noData = (reason: string): Fail => ({ status: 'no-data', reason });

/**
 * Air-to-water heat pump range at the system design flow temperature (the engine's
 * design_flow_temp_op_cond). Capacity is test point A (-7 C) of test_data_EN14825,
 * interpolated across the tested design flow temperatures and clamped at the ends as
 * the engine's HeatPumpTestData::data_at_test_condition does. Below A, the coldest
 * declared point (A or F) is used as declared, with no derating, and the gap is reported.
 * The minimum follows heat_pump.rs `load_ratio_continuous_min`: min_modulation_rate_20
 * (air sink) or _35 (water, glycol) interpolated to _55 when 55 C data exists; none for
 * on/off control.
 */
function outsideAirRange(src: Json, flowC: number, coldestC: number): Range | Fail {
  const rows = objects(src.test_data_EN14825);
  const declared = ['A', 'F'].flatMap((letter) => {
    const points = rows.filter((r) => r.test_letter === letter);
    return points.length ? [{ letter, points, temp: Math.max(...points.map((r) => num(r.temp_test) ?? NaN)) }] : [];
  });
  if (declared.length === 0) return noData('The heat pump has no EN 14825 test point A or F.');
  if (declared.some((d) => Number.isNaN(d.temp))) return noData('A heat pump test row has no temp_test.');
  const a = declared.find((d) => d.letter === 'A');
  const point = a && coldestC >= a.temp ? a : declared.reduce((p, d) => (d.temp <= p.temp ? d : p));
  const points = point.points;
  const notes: string[] = [];
  const designBelowTestPointK = coldestC < point.temp ? point.temp - coldestC : null;
  if (designBelowTestPointK !== null) {
    notes.push(`Declared output at ${point.temp} C; design day is ${coldestC} C.`);
  } else if (point.letter === 'F') {
    notes.push(`The coldest hour is below test point A, so test point F (${point.temp} C) is used.`);
  }
  const capacityCurve = points
    .map((r): [number, number] => [num(r.design_flow_temp) ?? NaN, num(r.capacity) ?? NaN])
    .sort((a, b) => a[0] - b[0]);
  if (capacityCurve.some(([f, c]) => Number.isNaN(f) || Number.isNaN(c))) {
    return noData('A heat pump test row has no design_flow_temp or capacity.');
  }
  const [lo, hi] = [capacityCurve[0][0], capacityCurve[capacityCurve.length - 1][0]];
  if (flowC < lo || flowC > hi) {
    const used = flowC < lo ? lo : hi;
    notes.push(
      `The design flow temperature (${flowC} C) is outside the tested range (${lo} to ${hi} C). The capacity at ${used} C is used, as the engine does.`,
    );
  }
  const maxKw = interp(flowC, capacityCurve);

  let minRate: number | null;
  if (src.modulating_control === false) {
    // The engine runs on/off units at full output (load_ratio_continuous_min = 1.0), but an
    // on/off unit cycles by design, so oversize is not judged.
    minRate = null;
    notes.push('On/off heat pump: it cycles by design, so "too big" is not checked.');
  } else {
    const low: [number, number | null] =
      src.sink_type === 'Air' ? [20, num(src.min_modulation_rate_20)] : [35, num(src.min_modulation_rate_35)];
    const high: [number, number | null] | null = capacityCurve.some(([f]) => f === 55)
      ? [55, num(src.min_modulation_rate_55)]
      : null;
    if (low[1] === null || (high && high[1] === null)) {
      minRate = null;
      notes.push('The minimum modulation rate is not given, so "too big" is not checked.');
    } else {
      minRate = high ? interp(flowC, [low as [number, number], high as [number, number]]) : low[1];
    }
  }
  return {
    minKw: minRate === null ? null : minRate * maxKw,
    maxKw,
    hasBackupHeater: (num(src.power_max_backup) ?? 0) > 0 || obj(src.boiler) !== null,
    testPointC: point.temp,
    designBelowTestPointK,
    notes,
  };
}

/**
 * Heat pump rules by source_type. Only outside air test points are at the outdoor design
 * temperature; ground, water, exhaust-air and heat-network points are not, so those types
 * need their own rule before they are sized.
 */
const HEAT_PUMP_RULES: Record<string, (src: Json, flowC: number, coldestC: number) => Range | Fail> = {
  OutsideAir: outsideAirRange,
};

function heatPumpRange(src: Json, flowC: number, coldestC: number): Range | Fail {
  const source = str(src.source_type) ?? 'unknown';
  const rule = HEAT_PUMP_RULES[source];
  if (rule) return rule(src, flowC, coldestC);
  return {
    status: 'unsupported',
    reason: notSizedYet(source, 'This heat pump type is not sized yet.'),
  };
}

/** Boiler: rated_power, down to modulation_load x rated_power (input.rs HeatSourceWetDetails::Boiler). */
function boilerRange(src: Json): Range | Fail {
  const rated = num(src.rated_power);
  const mod = num(src.modulation_load);
  if (rated === null || mod === null) return noData('The boiler has no rated_power or modulation_load.');
  return { minKw: mod * rated, maxKw: rated, hasBackupHeater: null, testPointC: null, designBelowTestPointK: null, notes: [] };
}

function sizeHeatSource(
  name: string,
  src: Json,
  systems: { sizing: SystemSizing; raw: Json }[],
  sources: [string, Json][],
  loss: DesignHeatLoss,
  sharedZones: Map<string, SystemSizing[]>,
): HeatSourceSizing {
  const served = systems.filter((s) => s.sizing.heatSources.includes(name));
  const result: HeatSourceSizing = {
    name,
    kind: str(src.type) ?? 'unknown',
    systems: served.map((s) => s.sizing.name),
    status: 'ok',
    reason: null,
    designLossKw: null,
    flowTempC: null,
    minKw: null,
    maxKw: null,
    verdict: null,
    shortfallKw: null,
    balancePointC: null,
    hasBackupHeater: null,
    otherSystemsInZone: false,
    testPointC: null,
    designBelowTestPointK: null,
    notes: [],
  };
  const fail = (status: SizingStatus, reason: string) => ({ ...result, status, reason });
  if (served.length === 0) {
    // E.g. a PrimaryThermalStore's HeatSource entry names the heat pump that charges it.
    const feeds = sources.find(([other, s]) => other !== name && refersTo(s, name));
    if (feeds) {
      return fail('unsupported', `It only feeds "${feeds[0]}", which is not sized yet.`);
    }
    return fail('no-data', 'No space heating system uses this heat source.');
  }

  // Sum each served zone once: two systems in one zone share its loss.
  const zones = new Map(served.map((s) => [s.sizing.zone, s.sizing.zone ? loss.zones[s.sizing.zone] : undefined]));
  // Sized systems on other heat sources fail the shared-zone rule below; what is left is unsized (unsupported).
  result.otherSystemsInZone = systems.some((s) => !served.includes(s) && s.sizing.zone !== null && zones.has(s.sizing.zone));
  const unknown = served.find((s) => !s.sizing.zone || !loss.zones[s.sizing.zone]);
  if (!unknown) {
    result.designLossKw = [...zones.values()].reduce((sum, z) => sum + z!.designLossKw, 0);
  }
  if (result.kind !== 'HeatPump' && result.kind !== 'Boiler') {
    return fail('unsupported', notSizedYet(result.kind, 'This heat source type is not sized yet.'));
  }
  // A zone shared with a system on another heat source: its loss divides between them in an unknown way.
  const split = served.some((s) => sharedZones.get(s.sizing.zone ?? '')?.some((o) => !o.heatSources.includes(name)));
  if (split) return fail('unsupported', SHARED_ZONE);
  for (const s of served.filter((x) => x.sizing.heatSources.length > 1)) {
    result.notes.push(`System "${s.sizing.name}" has several heat sources. This one is compared alone.`);
  }
  const notWet = served.find((s) => s.sizing.kind !== 'WetDistribution');
  if (notWet) return fail('unsupported', `It serves "${notWet.sizing.name}". ${notSizedYet(notWet.sizing.kind, 'This system type is not sized yet.')}`);
  if (unknown) return fail('error', `The design heat loss of system "${unknown.sizing.name}" is not known.`);
  if (result.designLossKw! <= 0) return fail('no-data', NO_LOSS);

  const flows = served.map((s) => num(s.raw.design_flow_temp));
  if (flows.some((f) => f === null)) return fail('no-data', 'A system it serves has no design flow temperature.');
  const flowC = Math.max(...(flows as number[]));
  result.flowTempC = flowC;
  if (new Set(flows).size > 1) {
    result.notes.push(`Its systems have different design flow temperatures. The highest (${flowC} C) is used.`);
  }
  const range = result.kind === 'HeatPump' ? heatPumpRange(src, flowC, loss.coldestHourC) : boilerRange(src);
  if ('reason' in range) return fail(range.status, range.reason);

  const designLossKw = result.designLossKw!;
  const { notes, ...values } = range;
  Object.assign(result, values);
  result.notes.push(...notes);
  if (range.maxKw < designLossKw) {
    const htcWPerK = [...zones.values()].reduce((sum, z) => sum + z!.htcWPerK, 0);
    result.verdict = 'too-small';
    result.shortfallKw = designLossKw - range.maxKw;
    result.balancePointC = loss.setpointC - (range.maxKw * 1000) / htcWPerK;
  } else {
    result.verdict = range.minKw !== null && range.minKw > designLossKw ? 'too-big' : 'ok';
  }
  return result;
}

/** SystemSizing.suggestedFlowC. */
function suggestedFlow(
  s: SystemSizing,
  raw: Json,
  sources: Map<string, Json>,
  heatSources: Map<string, HeatSourceSizing>,
  coldestC: number,
): number | null {
  if (s.status !== 'ok' || s.verdict !== 'ok' || s.minFlowC === null || s.flowTempAtDesignC === null || s.designFlowTempC === null) return null;
  // Interpolation at exactly min_outdoor_temp can land a rounding error away from the setting.
  if (Math.abs(s.flowTempAtDesignC - s.designFlowTempC) > 1e-9) return null;
  const flowC = Math.ceil(s.minFlowC);
  if (flowC > s.flowTempAtDesignC - 1 || flowC < CURVE_MIN_FLOW_C || s.heatSources.length === 0) return null;
  // Weather compensation (flowAtDesign) never runs below min_flow_temp.
  const ctrl = obj(raw.ecodesign_controller);
  const limit = [2, 3, 6, 7].includes(num(ctrl?.ecodesign_control_class) ?? 0) ? num(ctrl?.min_flow_temp) : null;
  if (limit !== null && flowC < limit) return null;
  for (const name of s.heatSources) {
    const src = sources.get(name);
    const entry = heatSources.get(name);
    if (!src || str(src.type) !== 'HeatPump' || entry?.status !== 'ok' || entry.designLossKw === null) return null;
    // Another system it serves can keep the higher flow.
    if (entry.systems.length > 1) return null;
    // Below the lowest tested flow the capacity is a clamped extrapolation.
    const tested = objects(src.test_data_EN14825).map((r) => num(r.design_flow_temp) ?? NaN);
    if (flowC < Math.min(...tested)) return null;
    const range = heatPumpRange(src, flowC, coldestC);
    if ('reason' in range || range.maxKw < entry.designLossKw || (range.minKw !== null && range.minKw > entry.designLossKw)) return null;
  }
  return flowC;
}

/** Sizes every SpaceHeatSystem and HeatSourceWet of a prepared HEM core input. */
export function sizeHeating(model: Json, loss: DesignHeatLoss): HeatingSizing {
  // WetDistribution names its Zone. Other systems are named by Zone.SpaceHeatSystem (input.rs ZoneInput).
  const zoneOf = new Map<string, string>();
  for (const [zone, z] of entries(model.Zone)) {
    for (const sys of [z.SpaceHeatSystem].flat()) if (typeof sys === 'string') zoneOf.set(sys, zone);
  }
  const systems = entries(model.SpaceHeatSystem).map(([name, raw]) => ({
    sizing: sizeSystem(name, raw, str(raw.Zone) ?? zoneOf.get(name) ?? null, loss),
    raw,
  }));
  // Systems that could be sized, by zone; a zone with more than one marks them all unsupported.
  const byZone = new Map<string, SystemSizing[]>();
  for (const { sizing } of systems) {
    if (sizing.status !== 'unsupported' && sizing.zone !== null) byZone.set(sizing.zone, [...(byZone.get(sizing.zone) ?? []), sizing]);
  }
  const sharedZones = new Map([...byZone].filter(([, list]) => list.length > 1));
  for (const s of systems) {
    if (!sharedZones.has(s.sizing.zone ?? '')) continue;
    s.sizing = { ...s.sizing, status: 'unsupported', reason: SHARED_ZONE, flowTempAtDesignC: null, outputAtDesignKw: null, curve: [], minFlowC: null, verdict: null };
  }
  const sources = entries(model.HeatSourceWet);
  const sourceNames = new Set(sources.map(([name]) => name));
  for (const { sizing } of systems) {
    for (const h of sizing.heatSources.filter((x) => !sourceNames.has(x))) {
      sizing.notes.push(`Heat source "${h}" is not in HeatSourceWet.`);
    }
  }
  const heatSources = sources.map(([name, src]) => sizeHeatSource(name, src, systems, sources, loss, sharedZones));
  const sourceByName = new Map(sources);
  const sizingByName = new Map(heatSources.map((h) => [h.name, h]));
  for (const s of systems) s.sizing.suggestedFlowC = suggestedFlow(s.sizing, s.raw, sourceByName, sizingByName, loss.coldestHourC);
  return {
    coldestHourC: loss.coldestHourC,
    setpointC: loss.setpointC,
    weatherName: loss.weatherName,
    zoneCount: Object.keys(loss.zones).length,
    systems: systems.map((s) => s.sizing),
    heatSources,
    notes: heatSources.length > 0 ? ['Space heating only. Hot water is not included.'] : [],
  };
}
