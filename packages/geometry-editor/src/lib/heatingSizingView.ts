// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * View model of the heating sizing block in the System and WetEmitter panels: verdict to pill,
 * sentence and chart geometry. Pure, so the layout rules (label clamping, label placement, scales)
 * are tested without a DOM. The components only draw what this returns.
 */

import {
  MIN_FLOW_SEARCH_MAX_C,
  NO_TARGET_SIZING_REASON_PREFIX,
  type HeatingSizing,
  type HeatSourceSizing,
  type SystemSizing,
} from './heatingSizing';


const NBSP = ' ';
const MINUS = '−';

export const fmtKw = (v: number): string => `${v.toFixed(1)}${NBSP}kW`;

/** Up to one decimal, typographic minus, degree sign. */
export function fmtTemp(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return `${rounded < 0 ? MINUS : ''}${Math.abs(rounded)}${NBSP}°C`;
}

export type PillTone = 'success' | 'error' | 'warning';
export interface SizingPill { label: string; tone: PillTone }

export interface SizingNote { kind: 'note'; text: string }

const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);
const note = (reason: string | null): SizingNote => ({ kind: 'note', text: reason ? `Not sized: ${sentence(reason)}` : 'Not sized.' });

export type SizingGate =
  | { kind: 'hidden' }
  | SizingNote
  | { kind: 'result'; result: HeatingSizing };

/** What the store state allows: nothing, one dim line, or the (possibly previous) result. */
export function sizingGate(state: { status: string; result?: HeatingSizing; reason?: string }): SizingGate {
  switch (state.status) {
    case 'ready':
    case 'computing':
      return state.result ? { kind: 'result', result: state.result } : { kind: 'hidden' };
    case 'unavailable':
      return state.reason?.startsWith(NO_TARGET_SIZING_REASON_PREFIX) ? { kind: 'hidden' } : note(state.reason ?? null);
    case 'error':
      return note(state.reason ?? null);
    default:
      return { kind: 'hidden' };
  }
}

// ---- Label placement ----

/** `soft`: another label, padded by 4 px each side, so up to 8 px of overlap still leaves the text clear. */
export interface Rect { x: number; y: number; w: number; h: number; soft?: boolean }
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, b: Rect): boolean => r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;

/** Width estimate for SVG text; generous, so a label placed clear of others is clear in any font. */
const textWidth = (text: string, fontSize: number): number => text.length * fontSize * 0.6;

/** `tier`: 0 sits next to what it names; 1 is a fallback, taken only when every tier-0 spot is blocked. */
export interface SvgLabel { text: string; x: number; y: number; anchor: 'start' | 'middle' | 'end'; tier?: number }

const labelRect = (l: SvgLabel, fontSize: number): Rect => {
  const w = textWidth(l.text, fontSize);
  const x = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - w : l.x - w / 2;
  return { x, y: l.y - fontSize - 2, w, h: fontSize + 8 };
};

export interface LabelObstacles {
  /** Things a label must not cover: the dashed line, dots, other labels. */
  rects: Rect[];
  /** Points sampled along the curve; each one inside the label costs a little. */
  points: { x: number; y: number }[];
}

const OUT_OF_BOUNDS = 1e6;
const RECT_HIT = 1000;
const POINT_HIT = 40;
/** Crossing the curve is cheaper than any rect hit, and a fallback tier costs more than any curve crossing. */
const CURVE_CAP = 900;
const TIER_COST = 950;

function labelCost(c: SvgLabel, fontSize: number, bounds: Rect, obstacles: LabelObstacles): number {
  const r = labelRect(c, fontSize);
  let cost = (c.tier ?? 0) * TIER_COST + (inside(r, bounds) ? 0 : OUT_OF_BOUNDS);
  for (const o of obstacles.rects) {
    if (!overlaps(r, o)) continue;
    const vertical = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y);
    cost += o.soft && vertical <= 8 ? 5 * vertical : RECT_HIT + Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x);
  }
  const ink = { x: r.x - 2, y: r.y + 2, w: r.w + 4, h: r.h - 2 };
  let onCurve = 0;
  for (const p of obstacles.points) if (p.x >= ink.x && p.x <= ink.x + ink.w && p.y >= ink.y && p.y <= ink.y + ink.h) onCurve += POINT_HIT;
  return cost + Math.min(onCurve, CURVE_CAP);
}

/** The candidate that covers the least; the first of equals, so the caller orders candidates by preference. */
export function chooseLabel(candidates: SvgLabel[], fontSize: number, bounds: Rect, obstacles: LabelObstacles): SvgLabel {
  let best = candidates[0];
  let bestCost = Infinity;
  for (const c of candidates) {
    const cost = labelCost(c, fontSize, bounds, obstacles);
    if (cost < bestCost) [best, bestCost] = [c, cost];
  }
  return best;
}

// ---- Wording shared by the panel, the warnings and the CLI ----

/** One zone: its loss is the house's. More: a zone's own. */
export const subjectOf = (zoneCount: number): 'house' | 'zone' => (zoneCount > 1 ? 'zone' : 'house');
const subject = (zoneCount: number): string => `The ${subjectOf(zoneCount)}`;
const needsLabel = (kw: number, zoneCount: number): string => `${zoneCount > 1 ? 'Zone' : 'House'} needs ${fmtKw(kw)}`;

/** The conditions every verdict was judged at. */
export function designConditions(sizing: Pick<HeatingSizing, 'coldestHourC' | 'setpointC' | 'weatherName'>): string {
  const file = sizing.weatherName ? `the ${sizing.weatherName} weather file` : 'the weather file';
  return `Coldest hour in ${file}: ${fmtTemp(sizing.coldestHourC)} outside, ${fmtTemp(sizing.setpointC)} inside.`;
}

/** What a too small or too big heat source means; null for a source that is big enough. */
export function heatSourceSentence(entry: HeatSourceSizing): string | null {
  if (entry.verdict === 'too-small' && entry.balancePointC !== null) {
    return entry.hasBackupHeater
      ? `Below ${fmtTemp(entry.balancePointC)} outside, the backup heater covers the gap.`
      : `Below ${fmtTemp(entry.balancePointC)} outside, rooms run below set-point.`;
  }
  return entry.verdict === 'too-big' ? 'It will switch on and off all year.' : null;
}

/** The basis line after the design conditions. */
export function heatSourceExtras(entry: HeatSourceSizing): string[] {
  const extras: string[] = [];
  if (entry.designBelowTestPointK !== null && entry.testPointC !== null) extras.push(`Output declared at ${fmtTemp(entry.testPointC)}.`);
  if (entry.systems.length > 1) extras.push(`Serves ${entry.systems.length} systems.`);
  return extras;
}

export type SizedSystem = SystemSizing & { designLossKw: number; flowTempAtDesignC: number; outputAtDesignKw: number };
export const isSized = (s: SystemSizing): s is SizedSystem =>
  s.status === 'ok' && s.verdict !== null && s.designLossKw !== null && s.flowTempAtDesignC !== null && s.outputAtDesignKw !== null && s.curve.length > 0;

/** Where the radiators start to give enough heat, against the curve the chart draws. */
export function emitterSentence(s: Pick<SystemSizing, 'minFlowC' | 'curve' | 'flowTempAtDesignC'>): string {
  if (s.minFlowC === null) {
    return `Radiators do not give enough heat at any flow temperature up to ${fmtTemp(Math.max(MIN_FLOW_SEARCH_MAX_C, s.flowTempAtDesignC ?? 0))}.`;
  }
  const first = s.curve[0].flowC;
  return s.minFlowC <= first
    ? `Radiators give enough heat at any flow temperature from ${fmtTemp(first)}.`
    : `Radiators give enough heat from ${fmtTemp(s.minFlowC)} flow.`;
}

/** The emitters' output at the design flow temperature against the need. */
export function emitterOutputSentence(s: SizedSystem, zoneCount: number): string {
  return `Radiators give ${fmtKw(s.outputAtDesignKw)} at ${fmtTemp(s.flowTempAtDesignC)} flow. ${subject(zoneCount)} needs ${fmtKw(s.designLossKw)}.`;
}

// ---- Heat source ----

export interface HeatSourceBar {
  /** Everything in percent of the track width. */
  segStartPct: number;
  segEndPct: number;
  markerPct: number;
  tone: PillTone;
  markerLabel: string;
  segLabel: string;
  /** translateX of each label, in percent of its own width: keeps it inside the track (0 at the left end, -100 at the right). */
  markerLabelShiftPct: number;
  segLabelShiftPct: number;
}

export interface HeatSourceView {
  kind: 'heatSource';
  pill: SizingPill;
  sentence: string | null;
  bar: HeatSourceBar;
  basis: string;
}

const MIN_SEGMENT_PCT = 1.2;

export function heatSourceView(
  entry: HeatSourceSizing,
  sizing: Pick<HeatingSizing, 'coldestHourC' | 'setpointC' | 'weatherName' | 'zoneCount'>,
): HeatSourceView | SizingNote {
  if (entry.status !== 'ok') return note(entry.reason);
  const { designLossKw, maxKw, verdict } = entry;
  if (designLossKw === null || maxKw === null || verdict === null) return note('The result is incomplete');

  const tone: PillTone = verdict === 'ok' ? 'success' : verdict === 'too-small' ? 'error' : 'warning';
  const label = verdict === 'ok' ? 'Big enough' : verdict === 'too-small' ? 'Too small' : 'Too big';

  const trackMax = Math.max(designLossKw, maxKw) * 1.08;
  const pct = (kw: number) => (kw / trackMax) * 100;
  const segStartPct = entry.minKw === null ? 0 : pct(entry.minKw);
  const segEndPct = Math.max(pct(maxKw), segStartPct + MIN_SEGMENT_PCT);
  const markerPct = pct(designLossKw);
  const source = entry.kind === 'HeatPump' ? 'Heat pump' : 'Boiler';
  const segCentrePct = (segStartPct + segEndPct) / 2;

  return {
    kind: 'heatSource',
    pill: { label, tone },
    sentence: heatSourceSentence(entry),
    basis: [designConditions(sizing), ...heatSourceExtras(entry)].join(' '),
    bar: {
      segStartPct,
      segEndPct,
      markerPct,
      tone,
      markerLabel: needsLabel(designLossKw, sizing.zoneCount),
      segLabel: entry.minKw === null ? `${source} up to ${fmtKw(maxKw)}` : `${source} ${entry.minKw.toFixed(1)} to ${fmtKw(maxKw)}`,
      markerLabelShiftPct: -markerPct,
      segLabelShiftPct: -segCentrePct,
    },
  };
}

// ---- Emitters ----

/** The sizing block's content width in the 340 px panel: 1 user unit is 1 px, so text is not scaled. */
export const CHART_WIDTH = 292;
export const CHART_HEIGHT = 156;
const MARGIN = { l: 34, r: 12, t: 28, b: 40 };
const LABEL_FONT = 12;

export interface EmitterChart {
  width: number;
  height: number;
  plot: { x0: number; x1: number; y0: number; y1: number };
  curvePath: string;
  designLineY: number;
  needLabel: SvgLabel;
  /** Zones are in plot x; a null zone is absent. */
  redZone: { x: number; width: number } | null;
  greenZone: { x: number; width: number } | null;
  redLabel: SvgLabel | null;
  greenLabel: SvgLabel | null;
  dot: { x: number; y: number; label: SvgLabel; tone: 'success' | 'error' } | null;
  cross: { x: number; y: number } | null;
  xTicks: { x: number; text: string }[];
  yTicks: { y: number; text: string }[];
  xTitle: SvgLabel;
  yTitle: SvgLabel;
}

export interface SystemView {
  kind: 'system';
  pill: SizingPill;
  sentence: string;
  chart: EmitterChart;
  caption: string;
}

export interface EmitterLineView {
  kind: 'emitterLine';
  pill: SizingPill;
  sentence: string;
}

/** Tick spacing for a y axis of `max`: whole numbers (1, 2, 5 x 10^k) when the range allows, else one decimal. */
export function yTickStep(max: number): { step: number; decimals: number } {
  const raw = max / 4;
  const exp = Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * 10 ** exp).find((v) => v >= raw)!;
  if (step >= 1) return { step, decimals: 0 };
  // Below 4 kW of range: 0.1, 0.2 or 0.5 with one decimal; a finer step keeps its own decimals.
  return { step, decimals: step >= 0.1 ? 1 : Math.ceil(-Math.log10(step)) };
}

const systemPill = (s: SizedSystem): SizingPill => ({
  label: `${s.verdict === 'ok' ? 'Big enough' : 'Too small'} at ${fmtTemp(s.flowTempAtDesignC)}`,
  tone: s.verdict === 'ok' ? 'success' : 'error',
});

function emitterChart(s: SizedSystem, zoneCount: number): EmitterChart {
  const W = CHART_WIDTH;
  const H = CHART_HEIGHT;
  const plot = { x0: MARGIN.l, x1: W - MARGIN.r, y0: MARGIN.t, y1: H - MARGIN.b };
  const pw = plot.x1 - plot.x0;
  const ph = plot.y1 - plot.y0;
  // The curve sets the x domain: 30 to 70 C, or to the design flow temperature when that is higher.
  const f0 = s.curve[0].flowC;
  const f1 = Math.max(s.curve[s.curve.length - 1].flowC, f0 + 1);
  const xOf = (flow: number) => plot.x0 + ((flow - f0) / (f1 - f0)) * pw;

  const peak = Math.max(s.designLossKw, ...s.curve.map((p) => p.outputKw));
  const { step, decimals } = yTickStep(peak * 1.05);
  const yMax = Math.ceil((peak * 1.05) / step - 1e-9) * step;
  const yOf = (kw: number) => plot.y1 - (kw / yMax) * ph;

  const yTicks: EmitterChart['yTicks'] = [];
  for (let i = 0; i * step <= yMax + 1e-9; i++) yTicks.push({ y: yOf(i * step), text: (i * step).toFixed(decimals) });
  const xTicks: EmitterChart['xTicks'] = [];
  for (let f = Math.ceil(f0 / 10) * 10; f <= f1; f += 10) xTicks.push({ x: xOf(f), text: String(f) });

  const curvePath = s.curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.flowC).toFixed(1)} ${yOf(p.outputKw).toFixed(1)}`).join(' ');
  const designLineY = yOf(s.designLossKw);

  // Red left of the first flow that covers the need, green from there. Not in view (null, or past the
  // last point): all red. At or below the first point: all green.
  const m = s.minFlowC;
  const split = m === null || m > f1 ? plot.x1 : m <= f0 ? plot.x0 : xOf(m);
  const redZone = split > plot.x0 ? { x: plot.x0, width: split - plot.x0 } : null;
  const greenZone = split < plot.x1 ? { x: split, width: plot.x1 - split } : null;
  const zoneLabel = (zone: { x: number; width: number } | null, text: string): SvgLabel | null =>
    zone && zone.width >= textWidth(text, LABEL_FONT) + 8 ? { text, x: zone.x + zone.width / 2, y: plot.y0 - 7, anchor: 'middle' } : null;
  const cross = m !== null && m > f0 && m <= f1 ? { x: xOf(m), y: designLineY } : null;

  const bounds: Rect = { x: plot.x0 + 1, y: plot.y0 + 1, w: pw - 2, h: ph - 2 };
  // Curve samples 1.6 px apart.
  const points: LabelObstacles['points'] = [];
  for (let i = 0; i + 1 < s.curve.length; i++) {
    const [a, b] = [s.curve[i], s.curve[i + 1]];
    for (let k = 0; k < 4; k++) {
      const t = k / 4;
      points.push({ x: xOf(a.flowC + (b.flowC - a.flowC) * t), y: yOf(a.outputKw + (b.outputKw - a.outputKw) * t) });
    }
  }
  const obstacles: LabelObstacles = { rects: [{ x: plot.x0, y: designLineY - 3, w: pw, h: 6 }], points };
  if (cross) obstacles.rects.push({ x: cross.x - 6, y: designLineY - 6, w: 12, h: 12 });

  // "House needs" hugs its dashed line, the left end first (the curve is usually low there); far from it only as a fallback.
  const needText = needsLabel(s.designLossKw, zoneCount);
  const needW = textWidth(needText, LABEL_FONT);
  const needStarts = [0, 1, 0.75, 0.5, 0.25].map((f) => plot.x0 + 4 + f * Math.max(0, pw - 8 - needW));
  const needCandidates = [[-8, 18, 0], [-22, 32, 1]].flatMap(([above, below, tier]) =>
    needStarts.flatMap((x) => [above, below].map((dy): SvgLabel => ({ text: needText, x, y: designLineY + dy, anchor: 'start', tier }))));

  const inRange = s.flowTempAtDesignC >= f0 && s.flowTempAtDesignC <= f1;
  let dot: EmitterChart['dot'] = null;
  let needLabel: SvgLabel;
  if (inRange) {
    const x = xOf(s.flowTempAtDesignC);
    const y = yOf(s.outputAtDesignKw);
    const text = `Your design: ${fmtKw(s.outputAtDesignKw)}`;
    // The curve usually rises to the right, so the room is below-right and above-left of the dot.
    const rising = yOf(s.curve[s.curve.length - 1].outputKw) < yOf(s.curve[0].outputKw);
    const right = (dy: number, tier: number): SvgLabel => ({ text, x: x + 8, y: y + dy, anchor: 'start', tier });
    const left = (dy: number, tier: number): SvgLabel => ({ text, x: x - 8, y: y + dy, anchor: 'end', tier });
    const dotCandidates = [
      ...(rising ? [right(16, 0), left(-8, 0), right(-8, 0), left(16, 0)] : [right(-8, 0), left(16, 0), right(16, 0), left(-8, 0)]),
      right(30, 1), left(-22, 1), right(-22, 1), left(30, 1),
    ];
    // Both labels are chosen together: the best "Your design" spot is no good if it leaves "House needs" none.
    const dotObstacles = { rects: [...obstacles.rects, { x: x - 6, y: y - 6, w: 12, h: 12 }], points };
    let bestCost = Infinity;
    let bestDot = dotCandidates[0];
    needLabel = needCandidates[0];
    for (const d of dotCandidates) {
      const withDot = { ...dotObstacles, rects: [...dotObstacles.rects, { ...labelRect(d, LABEL_FONT), soft: true }] };
      const n = chooseLabel(needCandidates, LABEL_FONT, bounds, withDot);
      const cost = labelCost(d, LABEL_FONT, bounds, dotObstacles) + labelCost(n, LABEL_FONT, bounds, withDot);
      if (cost < bestCost) [bestCost, bestDot, needLabel] = [cost, d, n];
    }
    dot = { x, y, label: bestDot, tone: s.verdict === 'ok' ? 'success' : 'error' };
  } else {
    needLabel = chooseLabel(needCandidates, LABEL_FONT, bounds, obstacles);
  }

  return {
    width: W,
    height: H,
    plot,
    curvePath,
    designLineY,
    needLabel,
    redZone,
    greenZone,
    redLabel: zoneLabel(redZone, 'Not enough heat'),
    greenLabel: zoneLabel(greenZone, 'Enough heat'),
    dot,
    cross,
    xTicks,
    yTicks,
    xTitle: { text: 'Flow temperature, °C', x: (plot.x0 + plot.x1) / 2, y: H - 4, anchor: 'middle' },
    yTitle: { text: 'kW', x: 4, y: plot.y0 - 13, anchor: 'start' },
  };
}

export function systemView(entry: SystemSizing, sizing: Pick<HeatingSizing, 'zoneCount'>): SystemView | SizingNote {
  if (!isSized(entry)) return note(entry.status === 'ok' ? 'The result is incomplete' : entry.reason);
  return {
    kind: 'system',
    pill: systemPill(entry),
    sentence: emitterSentence(entry),
    chart: emitterChart(entry, sizing.zoneCount),
    caption: 'Radiator output at each flow temperature.',
  };
}

const lowerFirst = (text: string): string => text[0].toLowerCase() + text.slice(1);

/** The WetEmitter panel: its system's verdict in one line; nothing unless the system was sized. */
export function emitterLineView(entry: SystemSizing, sizing: Pick<HeatingSizing, 'zoneCount'>): EmitterLineView | null {
  if (!isSized(entry)) return null;
  return { kind: 'emitterLine', pill: systemPill(entry), sentence: `Its system: ${lowerFirst(emitterOutputSentence(entry, sizing.zoneCount))}` };
}
