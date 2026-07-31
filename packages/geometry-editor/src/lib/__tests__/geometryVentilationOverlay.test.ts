// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { frameInsetFromFrameAreaFraction, rectSizeForMaxOpenArea } from '../geometryVentilationOverlay';

describe('rectSizeForMaxOpenArea', () => {
  it('matches opening when area equals full opening', () => {
    const { w, h } = rectSizeForMaxOpenArea(6, 2, 3);
    expect(w * h).toBeCloseTo(6, 8);
    expect(w).toBeCloseTo(2, 8);
    expect(h).toBeCloseTo(3, 8);
  });

  it('keeps area exact when height is the limiting dimension (regression)', () => {
    const W = 2;
    const H = 1.5;
    const A = 3;
    const { w, h } = rectSizeForMaxOpenArea(A, W, H);
    expect(w * h).toBeCloseTo(A, 8);
    expect(w).toBeCloseTo(2, 8);
    expect(h).toBeCloseTo(1.5, 8);
  });

  it('uses same aspect as opening when both dimensions fit', () => {
    const { w, h } = rectSizeForMaxOpenArea(2.5, 2, 1.5);
    expect(w * h).toBeCloseTo(2.5, 8);
    expect(w / h).toBeCloseTo(2 / 1.5, 8);
  });
});

describe('frameInsetFromFrameAreaFraction', () => {
  it('returns 0 for zero fraction', () => {
    expect(frameInsetFromFrameAreaFraction(0, 2, 2)).toBe(0);
  });

  it('solves square half-frame', () => {
    const W = 2;
    const H = 2;
    const f = 0.25;
    const s = frameInsetFromFrameAreaFraction(f, W, H);
    const inner = (W - 2 * s) * (H - 2 * s);
    expect(inner).toBeCloseTo((1 - f) * W * H, 6);
  });

  it('allows full frame fraction of 1.0 without capping to 0.95', () => {
    const s = frameInsetFromFrameAreaFraction(1, 2, 2);
    expect(s).toBeCloseTo(1, 8);
    const inner = (2 - 2 * s) * (2 - 2 * s);
    expect(inner).toBeCloseTo(0, 8);
  });
});
