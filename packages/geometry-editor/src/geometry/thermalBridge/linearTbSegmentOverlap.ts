// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pairwise overlap length for 3D line segments (parallel, coincident within tolerance).
 * Used for thermal bridges (ψ·L), duct runs, and pipe runs — likely double-counting when overlapping.
 */
import type { Element, ThermalBridgeLinear } from '../types';
import {
  TB_SEGMENT_OVERLAP_LINE_SEP_TOL_M,
  TB_SEGMENT_OVERLAP_MIN_LENGTH_M,
  TB_SEGMENT_PARALLEL_MIN_ABS_DOT,
} from './thermalBridgeTolerances';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function len(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function scale(u: Vec3, s: number): Vec3 {
  return { x: u.x * s, y: u.y * s, z: u.z * s };
}

/** Project `w` onto unit direction `u`; returns component vectors parallel and perpendicular to `u`. */
function splitAlongUnit(w: Vec3, u: Vec3): { parallel: Vec3; perp: Vec3 } {
  const t = dot(w, u);
  const parallel = scale(u, t);
  return { parallel, perp: sub(w, parallel) };
}

/** Two finite endpoints from any element with at least two XYZ coordinates (duct, pipe, thermal bridge line). */
export function finiteSegmentEndpointsFromCoordinates(
  coordinates: Element['coordinates'] | undefined,
): [Vec3, Vec3] | null {
  if (!coordinates || coordinates.length < 2) return null;
  const p0 = coordinates[0];
  const p1 = coordinates[1];
  if (
    typeof p0?.x !== 'number' ||
    typeof p0?.y !== 'number' ||
    typeof p0?.z !== 'number' ||
    typeof p1?.x !== 'number' ||
    typeof p1?.y !== 'number' ||
    typeof p1?.z !== 'number'
  ) {
    return null;
  }
  return [
    { x: p0.x, y: p0.y, z: p0.z },
    { x: p1.x, y: p1.y, z: p1.z },
  ];
}

/** The stretch two segments share: its length (m) and its two ends on segment `a` (world coords). */
export interface SegmentOverlapStretch {
  length: number;
  start: Vec3;
  end: Vec3;
}

/**
 * Overlap when two segments lie on parallel lines separated by at most `lineSepTolM`.
 * Returns null if not sufficiently parallel, endpoints off the infinite mate line, or overlap &lt; {@link TB_SEGMENT_OVERLAP_MIN_LENGTH_M}.
 */
export function overlapStretchParallelSegments3D(
  a0: Vec3,
  a1: Vec3,
  b0: Vec3,
  b1: Vec3,
  lineSepTolM: number = TB_SEGMENT_OVERLAP_LINE_SEP_TOL_M,
  minOverlapM: number = TB_SEGMENT_OVERLAP_MIN_LENGTH_M,
): SegmentOverlapStretch | null {
  const wa = sub(a1, a0);
  const wb = sub(b1, b0);
  const lenA = len(wa);
  const lenB = len(wb);
  if (lenA < 1e-9 || lenB < 1e-9) return null;

  const ua = scale(wa, 1 / lenA);
  const ub = scale(wb, 1 / lenB);
  const parallelDot = Math.abs(dot(ua, ub));
  if (parallelDot < TB_SEGMENT_PARALLEL_MIN_ABS_DOT) return null;

  const w0 = sub(b0, a0);
  const p0 = splitAlongUnit(w0, ua);
  if (len(p0.perp) > lineSepTolM) return null;

  const w1 = sub(b1, a0);
  const p1 = splitAlongUnit(w1, ua);
  if (len(p1.perp) > lineSepTolM) return null;

  const t0 = dot(sub(b0, a0), ua);
  const t1 = dot(sub(b1, a0), ua);
  const tStart = Math.max(0, Math.min(t0, t1));
  const tEnd = Math.min(lenA, Math.max(t0, t1));
  const overlap = Math.max(0, tEnd - tStart);
  if (overlap < minOverlapM) return null;
  const at = (t: number): Vec3 => ({ x: a0.x + ua.x * t, y: a0.y + ua.y * t, z: a0.z + ua.z * t });
  return { length: overlap, start: at(tStart), end: at(tEnd) };
}

/** Length (m) of {@link overlapStretchParallelSegments3D}, or 0 when the segments don't overlap. */
export function overlapLengthParallelSegments3D(
  a0: Vec3,
  a1: Vec3,
  b0: Vec3,
  b1: Vec3,
  lineSepTolM: number = TB_SEGMENT_OVERLAP_LINE_SEP_TOL_M,
  minOverlapM: number = TB_SEGMENT_OVERLAP_MIN_LENGTH_M,
): number {
  return overlapStretchParallelSegments3D(a0, a1, b0, b1, lineSepTolM, minOverlapM)?.length ?? 0;
}

/** Same overlap rule for any two coordinate-based line elements (TB, ductwork, pipework). */
export function overlapStretchBetweenSegmentElements(
  a: Pick<Element, 'coordinates'>,
  b: Pick<Element, 'coordinates'>,
): SegmentOverlapStretch | null {
  const ea = finiteSegmentEndpointsFromCoordinates(a.coordinates);
  const eb = finiteSegmentEndpointsFromCoordinates(b.coordinates);
  if (!ea || !eb) return null;
  return overlapStretchParallelSegments3D(ea[0], ea[1], eb[0], eb[1]);
}

export function overlapLengthBetweenSegmentElements(a: Pick<Element, 'coordinates'>, b: Pick<Element, 'coordinates'>): number {
  return overlapStretchBetweenSegmentElements(a, b)?.length ?? 0;
}

export function overlapLengthBetweenThermalBridgeSegments(a: ThermalBridgeLinear, b: ThermalBridgeLinear): number {
  return overlapLengthBetweenSegmentElements(a, b);
}
