// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  overlapLengthParallelSegments3D,
  overlapLengthBetweenThermalBridgeSegments,
} from './linearTbSegmentOverlap';
import {
  TB_SEGMENT_OVERLAP_LINE_SEP_TOL_M,
  TB_SEGMENT_OVERLAP_MIN_LENGTH_M,
  TB_SEGMENT_PARALLEL_MIN_ABS_DOT,
} from './thermalBridgeTolerances';
import type { ThermalBridgeLinear } from '../types';

describe('overlapLengthParallelSegments3D', () => {
  it('returns full length when segments are identical', () => {
    const a0 = { x: 0, y: 0, z: 0 };
    const a1 = { x: 5, y: 0, z: 0 };
    expect(overlapLengthParallelSegments3D(a0, a1, a0, a1)).toBeCloseTo(5, 5);
  });

  it('returns partial overlap when one segment is inside the other', () => {
    const a0 = { x: 0, y: 0, z: 0 };
    const a1 = { x: 5, y: 0, z: 0 };
    const b0 = { x: 1, y: 0, z: 0 };
    const b1 = { x: 4, y: 0, z: 0 };
    expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBeCloseTo(3, 5);
  });

  it('returns 0 when parallel but separated in 3D (different storey)', () => {
    const a0 = { x: 0, y: 0, z: 0 };
    const a1 = { x: 5, y: 0, z: 0 };
    const b0 = { x: 0, y: 0, z: 2.4 };
    const b1 = { x: 5, y: 0, z: 2.4 };
    expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBe(0);
  });

  it('returns 0 for perpendicular segments (point contact only)', () => {
    const a0 = { x: 0, y: 0, z: 0 };
    const a1 = { x: 5, y: 0, z: 0 };
    const b0 = { x: 2, y: 0, z: 0 };
    const b1 = { x: 2, y: 3, z: 0 };
    expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBe(0);
  });

  it('returns 0 when parallel in plan but separated sideways beyond lineSepTol', () => {
    const a0 = { x: 0, y: 0, z: 0 };
    const a1 = { x: 5, y: 0, z: 0 };
    const b0 = { x: 0, y: TB_SEGMENT_OVERLAP_LINE_SEP_TOL_M + 0.02, z: 0 };
    const b1 = { x: 5, y: TB_SEGMENT_OVERLAP_LINE_SEP_TOL_M + 0.02, z: 0 };
    expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBe(0);
  });

  it('returns 0 for endpoint-only meeting (zero-length overlap along shared line)', () => {
    const a0 = { x: 0, y: 0, z: 0 };
    const a1 = { x: 4, y: 0, z: 0 };
    const b0 = { x: 4, y: 0, z: 0 };
    const b1 = { x: 8, y: 0, z: 0 };
    expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBe(0);
  });

  it('returns 0 when overlap interval would be shorter than TB_SEGMENT_OVERLAP_MIN_LENGTH_M', () => {
    const a0 = { x: 0, y: 0, z: 0 };
    const a1 = { x: 5, y: 0, z: 0 };
    const gap = TB_SEGMENT_OVERLAP_MIN_LENGTH_M / 2;
    const b0 = { x: 5 - gap, y: 0, z: 0 };
    const b1 = { x: 10, y: 0, z: 0 };
    const overlap = overlapLengthParallelSegments3D(a0, a1, b0, b1);
    expect(overlap).toBeLessThan(TB_SEGMENT_OVERLAP_MIN_LENGTH_M);
    expect(overlap).toBe(0);
  });

  it('returns >0 when overlap length just clears MIN (same axis)', () => {
    const a0 = { x: 0, y: 0, z: 0 };
    const a1 = { x: 5, y: 0, z: 0 };
    const eps = TB_SEGMENT_OVERLAP_MIN_LENGTH_M + 0.002;
    const b0 = { x: 5 - eps, y: 0, z: 0 };
    const b1 = { x: 10, y: 0, z: 0 };
    expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBeGreaterThanOrEqual(TB_SEGMENT_OVERLAP_MIN_LENGTH_M);
  });

  it('returns 0 when directions differ beyond parallel cone (~5°)', () => {
    const a0 = { x: 0, y: 0, z: 0 };
    const a1 = { x: 5, y: 0, z: 0 };
    const ang = (8 * Math.PI) / 180;
    const b1 = { x: 5 * Math.cos(ang), y: 5 * Math.sin(ang), z: 0 };
    const b0 = { x: 1 * Math.cos(ang), y: 1 * Math.sin(ang), z: 0 };
    expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBe(0);
  });

  describe('parallel-cone and tube boundary stress', () => {
    it('accepts directions just inside parallel cone when both endpoints stay inside lineSepTol strip', () => {
      const deg = 4;
      const ang = (deg * Math.PI) / 180;
      expect(Math.abs(Math.cos(ang)) > TB_SEGMENT_PARALLEL_MIN_ABS_DOT).toBe(true);
      const a0 = { x: 0, y: 0, z: 0 };
      const a1 = { x: 2, y: 0, z: 0 };
      const dx = 0.5;
      const dyAlong = dx * Math.tan(ang);
      const b0 = { x: 0.1, y: 0.05, z: 0 };
      const b1 = { x: 0.1 + dx, y: 0.05 + dyAlong, z: 0 };
      expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBeGreaterThan(TB_SEGMENT_OVERLAP_MIN_LENGTH_M);
    });

    it('rejects directions just outside parallel cone (|cos θ| < threshold)', () => {
      const a0 = { x: 0, y: 0, z: 0 };
      const a1 = { x: 10, y: 0, z: 0 };
      const deg = 6.5;
      const ang = (deg * Math.PI) / 180;
      const b0 = { x: 1 * Math.cos(ang), y: 1 * Math.sin(ang), z: 0 };
      const b1 = { x: 9 * Math.cos(ang), y: 9 * Math.sin(ang), z: 0 };
      expect(Math.abs(Math.cos(ang)) < TB_SEGMENT_PARALLEL_MIN_ABS_DOT).toBe(true);
      expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBe(0);
    });

    it('returns 0 when parallel offset is just beyond lineSepTol (sideways slip)', () => {
      const tol = TB_SEGMENT_OVERLAP_LINE_SEP_TOL_M;
      const a0 = { x: 0, y: 0, z: 0 };
      const a1 = { x: 6, y: 0, z: 0 };
      const dy = tol + 0.015;
      const b0 = { x: 0, y: dy, z: 0 };
      const b1 = { x: 6, y: dy, z: 0 };
      expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBe(0);
    });

    it('returns 0 when only one segment endpoint lies inside the mate tube (skew short segment)', () => {
      const a0 = { x: 0, y: 0, z: 0 };
      const a1 = { x: 8, y: 0, z: 0 };
      const b0 = { x: 1, y: 0.05, z: 0 };
      const b1 = { x: 7, y: 0.18, z: 0 };
      expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBe(0);
    });

    it('returns 0 when projected overlap is strictly below MIN (noise-scale coincidence)', () => {
      const a0 = { x: 0, y: 0, z: 0 };
      const a1 = { x: 0.08, y: 0, z: 0 };
      const b0 = { x: 0.03, y: 0, z: 0 };
      const b1 = { x: 0.058, y: 0, z: 0 };
      expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBeLessThan(TB_SEGMENT_OVERLAP_MIN_LENGTH_M);
      expect(overlapLengthParallelSegments3D(a0, a1, b0, b1)).toBe(0);
    });
  });
});

describe('overlapLengthBetweenThermalBridgeSegments', () => {
  function tb(
    id: string,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    jt = 'E5',
  ): ThermalBridgeLinear {
    return {
      type: 'ThermalBridgeLinear',
      id,
      name: id,
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: x0, y: y0, z: z0 },
        { x: x1, y: y1, z: z1 },
      ],
      length: Math.hypot(x1 - x0, y1 - y0, z1 - z0),
      linear_thermal_transmittance: 0.1,
      isPlaceholder: false,
      extra_json: { junction_type: jt },
    } as ThermalBridgeLinear;
  }

  it('detects overlap between different junction types on same run', () => {
    const a = tb('a', 0, 0, 0, 4, 0, 0, 'E5');
    const b = tb('b', 2, 0, 0, 5, 0, 0, 'P7');
    expect(overlapLengthBetweenThermalBridgeSegments(a, b)).toBeGreaterThan(0.05);
  });
});
