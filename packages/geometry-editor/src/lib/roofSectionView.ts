// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * View model of the roof section in the Roof panel: the height profile along the cut drawn to scale
 * with its labels placed clear of the outline and of each other. Pure, like heatingSizingView.
 */

import { chooseLabel, labelRect, type Rect, type SvgLabel } from './heatingSizingView';

export interface RoofSectionInput {
  /** The roof's height profile along the cut, s from one eaves (m), z above the eaves (m); empty for a flat roof. */
  points: Array<{ s: number; z: number }>;
  /** Eaves elevation above ground (m). */
  eaves: number;
  /** Pitch label, e.g. "45°" (a mansard: "70° / 30°"); editable = a link that focuses the pitch field. */
  pitch: { text: string; editable: boolean };
  use: 'loft' | 'room' | 'vaulted';
  /** A room in the roof, the points above its floor: its walls `inset` in from each eaves (m), the
   * knee wall and max ceiling heights, the flat ceiling and room widths. */
  room?: { inset: number; knee: number; ceiling: number; ceilingWidth: number; width: number; mono: boolean; setIn: boolean };
}

/** The room-in-roof fields a section label edits. */
export type RoomField = 'maxCeilingHeight' | 'kneeWallHeight' | 'ceilingWidth' | 'roomWidth';

export interface RoofSectionView {
  width: 292;
  height: 148;
  /** SVG path of the roof profile, closed along the eaves line. */
  outline: string;
  eavesLine: { x1: number; y1: number; x2: number; y2: number };
  /** Small end ticks of the eaves line, as [x, y1, y2]. */
  ticks: Array<{ x: number; y1: number; y2: number }>;
  labels: { ridge: SvgLabel; eaves: SvgLabel; pitch: SvgLabel; fill: SvgLabel };
  summary: string;
  /** A room in the roof: its outline, knee walls and flat ceiling, and its measurements as links. */
  room?: { outline: string; lines: Array<{ x1: number; y1: number; x2: number; y2: number }>; links: Array<{ label: SvgLabel; field: RoomField }> };
}

const W = 292;
const H = 148;
const FONT = 12;
const PAD_X = 28;
const PAD_TOP = 28;
const PAD_BOTTOM = 32;
const OVERHANG = 8;

const m2 = (v: number): string => v.toFixed(2);

const base = (input: RoofSectionInput) => (input.room ? 'floor' : 'eaves');

export function roofSectionSummary(input: RoofSectionInput): string {
  const { points, eaves, pitch } = input;
  if (points.length === 0) return `eaves ${m2(eaves)} · flat`;
  return `${base(input)} ${m2(eaves)} · ridge ${m2(eaves + Math.max(...points.map((p) => p.z)))} · ${pitch.text}`;
}

/** The roof's height at s along the section (linear between its points). */
function heightAt(points: Array<{ s: number; z: number }>, s: number): number {
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (s >= a.s - 1e-9 && s <= b.s + 1e-9) return b.s - a.s < 1e-9 ? Math.max(a.z, b.z) : a.z + ((s - a.s) / (b.s - a.s)) * (b.z - a.z);
  }
  return 0;
}

export function roofSectionView(input: RoofSectionInput): RoofSectionView | null {
  const { points, eaves, pitch, use } = input;
  if (points.length === 0) return null;
  const sMax = Math.max(...points.map((p) => p.s));
  const zMax = Math.max(...points.map((p) => p.z));
  // Same metres per pixel both ways: the tighter of the two limits.
  const k = Math.min((W - 2 * PAD_X) / sMax, zMax > 0 ? (H - PAD_TOP - PAD_BOTTOM) / zMax : Infinity);
  const ox = (W - sMax * k) / 2;
  const eavesY = PAD_TOP + (H - PAD_TOP - PAD_BOTTOM - zMax * k) / 2 + zMax * k;
  const px = points.map((p) => ({ x: ox + p.s * k, y: eavesY - p.z * k }));
  const last = px[px.length - 1];
  const first = px[0];
  const outline = `M${[...px, { x: last.x, y: eavesY }, { x: first.x, y: eavesY }].map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L')}Z`;
  const x1 = first.x - OVERHANG;
  const x2 = last.x + OVERHANG;

  // Dots along the outline keep labels off it.
  const curve: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < px.length - 1; i++) {
    const n = Math.max(1, Math.ceil(Math.hypot(px[i + 1].x - px[i].x, px[i + 1].y - px[i].y) / 3));
    for (let j = 0; j <= n; j++) curve.push({ x: px[i].x + ((px[i + 1].x - px[i].x) * j) / n, y: px[i].y + ((px[i + 1].y - px[i].y) * j) / n });
  }
  const bounds: Rect = { x: 0, y: 0, w: W, h: H };
  const rects: Rect[] = [{ x: x1, y: eavesY - 1, w: x2 - x1, h: 2 }];
  const place = (candidates: SvgLabel[]): SvgLabel => {
    const label = chooseLabel(candidates, FONT, bounds, { rects, points: curve });
    // A room has no fill word: its blank label takes no room.
    if (label.text) rects.push({ ...labelRect(label, FONT), soft: true });
    return label;
  };

  const apex = px.reduce((a, p) => (p.y < a.y ? p : a));
  const ridge = place([-8, -14].map((dy) => ({ text: `ridge ${m2(eaves + zMax)}`, x: apex.x, y: apex.y + dy, anchor: 'middle' as const })));
  const eavesLabel = place([{ text: `${base(input)} ${m2(eaves)}`, x: first.x, y: eavesY + 18, anchor: 'start' }]);
  // On a room's own slope, above its knee walls: a void below them can be at another pitch.
  const j = input.room ? points.reduce((at, q, i) => (i > 0 && Math.min(q.z, points[i - 1].z) >= input.room!.knee - 1e-6 ? i : at), -1) : -1;
  const [a, b] = j > 0 ? [px[j - 1], px[j]] : [px[px.length - 2] ?? first, last];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const pitchLabel = place([
    { text: pitch.text, x: mid.x + 10, y: mid.y - 4, anchor: 'start' },
    { text: pitch.text, x: mid.x + 10, y: mid.y + 14, anchor: 'start' },
    { text: pitch.text, x: mid.x - 10, y: mid.y - 8, anchor: 'end' },
    { text: pitch.text, x: last.x + 12, y: eavesY - 8, anchor: 'start', tier: 1 },
  ]);
  const fillText = use === 'loft' ? 'loft' : use === 'room' ? '' : 'heated';
  const fill = place([6, 14, 22].map((dy) => ({ text: fillText, x: (first.x + last.x) / 2, y: eavesY - dy, anchor: 'middle' as const })));

  // The room: under the roof and the flat ceiling, between its walls.
  let room: RoofSectionView['room'];
  if (input.room) {
    const r = input.room;
    const [s0, s1] = [r.inset, r.mono ? sMax : sMax - r.inset];
    const crossings = points.slice(0, -1).flatMap((a, i) => {
      const b = points[i + 1];
      return (a.z - r.ceiling) * (b.z - r.ceiling) < 0 ? [a.s + ((r.ceiling - a.z) / (b.z - a.z)) * (b.s - a.s)] : [];
    });
    const ss = [s0, ...points.map((p) => p.s), ...crossings, s1].filter((x) => x >= s0 - 1e-9 && x <= s1 + 1e-9).sort((a, b) => a - b);
    const at = (x: number, z: number) => ({ x: ox + x * k, y: eavesY - z * k });
    const top = ss.map((x) => at(x, Math.min(heightAt(points, x), r.ceiling)));
    const outlineRoom = `M${[at(s0, 0), ...top, at(s1, 0)].map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L')}Z`;
    const lines = [
      ...(r.setIn && r.knee > 0 ? [s0, ...(r.mono ? [] : [s1])].map((x) => ({ x1: at(x, 0).x, y1: eavesY, x2: at(x, 0).x, y2: at(x, r.knee).y })) : []),
      ...(r.ceilingWidth > 0 && crossings.length ? [{ x1: at(Math.min(...crossings), 0).x, y1: at(0, r.ceiling).y, x2: at(r.mono ? s1 : Math.max(...crossings), 0).x, y2: at(0, r.ceiling).y }] : []),
    ];
    // The room's lines keep its labels off them, as the outline does.
    for (const l of lines) rects.push({ x: Math.min(l.x1, l.x2) - 2, y: Math.min(l.y1, l.y2) - 2, w: Math.abs(l.x2 - l.x1) + 4, h: Math.abs(l.y2 - l.y1) + 4 });
    const mid = at((s0 + s1) / 2, 0).x;
    const ceilingY = at(0, r.ceiling).y;
    const link = (field: RoomField, candidates: SvgLabel[]) => ({ field, label: place(candidates) });
    // The fixed ones first; the max ceiling height takes the room's middle where it is free.
    const knee = r.knee > 0 ? [link('kneeWallHeight', [s0, s1].flatMap((x, i) => [(r.knee * k) / 2 + 4, 12].map((dy) => ({ text: `knee ${m2(r.knee)}`, x: at(x, 0).x + (i ? -8 : 8), y: eavesY - r.knee * k + dy, anchor: i ? 'end' as const : 'start' as const }))))] : [];
    const ends = lines.length && r.ceilingWidth > 0 ? lines[lines.length - 1] : null;
    const flatText = `flat ${m2(r.ceilingWidth)}`;
    const flat = ends ? [link('ceilingWidth', [
      ...[12, -6].map((dy) => ({ text: flatText, x: mid, y: ceilingY + dy, anchor: 'middle' as const })),
      { text: flatText, x: ends.x2 + 10, y: ceilingY - 4, anchor: 'start' as const },
      { text: flatText, x: ends.x1 - 10, y: ceilingY - 4, anchor: 'end' as const },
    ])] : [];
    // The width under the floor line, as a dimension; inside the room if that is taken.
    const widthText = `width ${m2(r.width)}`;
    const width = r.setIn ? [link('roomWidth', [
      { text: widthText, x: mid, y: eavesY + 18, anchor: 'middle' as const },
      { text: widthText, x: at(s1, 0).x, y: eavesY + 18, anchor: 'end' as const },
      ...[10, 16].map((dy) => ({ text: widthText, x: mid, y: eavesY - dy, anchor: 'middle' as const })),
    ])] : [];
    const max = link('maxCeilingHeight', [0.3, 0.45, 0.6, 0.75].map((f) => ({ text: `max ${m2(r.ceiling)}`, x: mid, y: ceilingY + 12 + (eavesY - ceilingY - 12) * f, anchor: 'middle' as const })));
    room = { outline: outlineRoom, lines, links: [max, ...knee, ...flat, ...width] };
  }

  return {
    width: W,
    height: H,
    outline,
    eavesLine: { x1, y1: eavesY, x2, y2: eavesY },
    ticks: [x1, x2].map((x) => ({ x, y1: eavesY - 5, y2: eavesY + 5 })),
    labels: { ridge, eaves: eavesLabel, pitch: pitchLabel, fill },
    summary: roofSectionSummary(input),
    ...(room ? { room } : {}),
  };
}
