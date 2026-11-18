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
  use: 'loft' | 'vaulted';
}

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
}

const W = 292;
const H = 148;
const FONT = 12;
const PAD_X = 28;
const PAD_TOP = 28;
const PAD_BOTTOM = 32;
const OVERHANG = 8;

const m2 = (v: number): string => v.toFixed(2);

export function roofSectionSummary({ points, eaves, pitch }: RoofSectionInput): string {
  if (points.length === 0) return `eaves ${m2(eaves)} · flat`;
  return `eaves ${m2(eaves)} · ridge ${m2(eaves + Math.max(...points.map((p) => p.z)))} · ${pitch.text}`;
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
    rects.push({ ...labelRect(label, FONT), soft: true });
    return label;
  };

  const apex = px.reduce((a, p) => (p.y < a.y ? p : a));
  const ridge = place([-8, -14].map((dy) => ({ text: `ridge ${m2(eaves + zMax)}`, x: apex.x, y: apex.y + dy, anchor: 'middle' as const })));
  const eavesLabel = place([{ text: `eaves ${m2(eaves)}`, x: first.x, y: eavesY + 18, anchor: 'start' }]);
  const a = px[px.length - 2] ?? first;
  const mid = { x: (a.x + last.x) / 2, y: (a.y + last.y) / 2 };
  const pitchLabel = place([
    { text: pitch.text, x: mid.x + 10, y: mid.y - 4, anchor: 'start' },
    { text: pitch.text, x: mid.x + 10, y: mid.y + 14, anchor: 'start' },
    { text: pitch.text, x: mid.x - 10, y: mid.y - 8, anchor: 'end' },
    { text: pitch.text, x: last.x + 12, y: eavesY - 8, anchor: 'start', tier: 1 },
  ]);
  const fillText = use === 'loft' ? 'loft' : 'heated';
  const fill = place([6, 14, 22].map((dy) => ({ text: fillText, x: (first.x + last.x) / 2, y: eavesY - dy, anchor: 'middle' as const })));

  return {
    width: W,
    height: H,
    outline,
    eavesLine: { x1, y1: eavesY, x2, y2: eavesY },
    ticks: [x1, x2].map((x) => ({ x, y1: eavesY - 5, y2: eavesY + 5 })),
    labels: { ridge, eaves: eavesLabel, pitch: pitchLabel, fill },
    summary: roofSectionSummary(input),
  };
}
