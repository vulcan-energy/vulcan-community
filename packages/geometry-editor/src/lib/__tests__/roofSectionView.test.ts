// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { labelRect } from '../heatingSizingView';
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
});
