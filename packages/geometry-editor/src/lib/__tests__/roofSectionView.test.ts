// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { labelRect } from '../heatingSizingView';
import { roomSection, type RoofRoom } from '../roofPart';
import { roofSectionSummary, roofSectionView, type RoofSectionInput } from '../roofSectionView';

const pitch = { text: '45°', editable: true };
const gable: RoofSectionInput = { points: [{ s: 0, z: 0 }, { s: 2.5, z: 2.5 }, { s: 5, z: 0 }], eaves: 5.1, pitch, use: 'loft' };
const mono: RoofSectionInput = { points: [{ s: 0, z: 0 }, { s: 3, z: 1.73 }], eaves: 5.1, pitch, use: 'vaulted' };

const nums = (d: string): number[] => d.match(/-?\d+(\.\d+)?/g)!.map(Number);

describe('roofSectionView', () => {
  it('summarises gable, mono and flat roofs', () => {
    expect(roofSectionSummary(gable)).toBe('eaves 5.10 · ridge 7.60 · 45°');
    expect(roofSectionSummary(mono)).toBe('eaves 5.10 · ridge 6.83 · 45°');
    expect(roofSectionSummary({ ...gable, points: [] })).toBe('eaves 5.10 · flat');
    expect(roofSectionView({ ...gable, points: [] })).toBeNull();
  });

  it.each([['gable', gable], ['mono', mono]])('%s is drawn to scale with labels inside the box and apart', (_n, input) => {
    const v = roofSectionView(input)!;
    const [x0, y0, x1, y1] = nums(v.outline);
    const ptsIn = input.points;
    const kx = (x1 - x0) / (ptsIn[1].s - ptsIn[0].s);
    const ky = (y0 - y1) / (ptsIn[1].z - ptsIn[0].z);
    expect(kx).toBeCloseTo(ky, 1);
    const rects = Object.values(v.labels).map((l) => labelRect(l, 12));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(v.width);
      expect(r.y + r.h).toBeLessThanOrEqual(v.height);
    }
    // Text boxes (without the padding labelRect adds below) do not overlap.
    rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => {
      const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h - 4 && b.y < a.y + a.h - 4;
      expect(hit).toBe(false);
    }));
    expect(v.labels.ridge.text).toBe(`ridge ${(5.1 + Math.max(...ptsIn.map((p) => p.z))).toFixed(2)}`);
  });

  it('a set-in room: the room drawn inside the roof, its measurements as links apart and inside the box', () => {
    // w 5, set in 1.1 from each eaves, knee 1.1, ceiling 2.1 (0.8 wide), at 45°.
    const room: RoofSectionInput = {
      points: [{ s: 0, z: 0 }, { s: 2.5, z: 2.5 }, { s: 5, z: 0 }],
      eaves: 5.1,
      pitch: { text: '45°', editable: false },
      use: 'room',
      room: { inset: 1.1, knee: 1.1, ceiling: 2.1, ceilingWidth: 0.8, width: 2.8, mono: false, setIn: true },
    };
    const v = roofSectionView(room)!;
    expect(roofSectionSummary(room)).toBe('floor 5.10 · ridge 7.60 · 45°');
    expect(v.room!.links.map((l) => [l.field, l.label.text])).toEqual([
      ['maxCeilingHeight', 'max 2.10'],
      ['kneeWallHeight', 'knee 1.10'],
      ['ceilingWidth', 'flat 0.80'],
      ['roomWidth', 'width 2.80'],
    ]);
    // Two knee walls and the flat ceiling.
    expect(v.room!.lines).toHaveLength(3);
    const rects = [...Object.values(v.labels), ...v.room!.links.map((l) => l.label)].filter((l) => l.text).map((l) => labelRect(l, 12));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(v.width);
      expect(r.y + r.h).toBeLessThanOrEqual(v.height);
    }
    rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => {
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h - 4 && b.y < a.y + a.h - 4).toBe(false);
    }));
  });

  it('a set-in room whose slope is lowered: the void kinks at the knee wall tops, and the pitch is on the room slope', () => {
    // 7 m deep, wᵢ 4.0, h_v 2.4, h_w 1.0, w_c 1.0: the room slope sits 0.4 m under one from the eaves.
    const tan = 2.8 / 3;
    const r = { w: 7, length: 8, wi: 4, hv: 2.4, wc: 1, hw: 1, pitch: (Math.atan(tan) * 180) / Math.PI, shift: 1 - 1.5 * tan, mono: false } as RoofRoom;
    const points = roomSection(r, [{ s: 0, z: 0 }, { s: 3.5, z: 3.5 * tan }, { s: 7, z: 0 }]);
    expect(points.map((q) => [Number(q.s.toFixed(6)), Number(q.z.toFixed(6))])).toEqual([[0, 0], [1.5, 1], [3.5, 2.866667], [5.5, 1], [7, 0]]);
    const v = roofSectionView({ points, eaves: 2.5, pitch: { text: '43°', editable: false }, use: 'room', room: { inset: 1.5, knee: 1, ceiling: 2.4, ceilingWidth: 1, width: 4, mono: false, setIn: true } })!;
    const xs = nums(v.outline).filter((_, i) => i % 2 === 0);
    // Beside the ridge-to-knee slope, short of the kink.
    expect(v.labels.pitch.x).toBeGreaterThan(xs[2]);
    expect(v.labels.pitch.x).toBeLessThan(xs[3]);
  });
});
