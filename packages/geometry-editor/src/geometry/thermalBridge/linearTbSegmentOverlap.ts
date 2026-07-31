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

/**
 * Length (m) of overlap when two segments lie on parallel lines separated by at most `lineSepTolM`.
 * Returns 0 if not sufficiently parallel, endpoints off the infinite mate line, or overlap &lt; {@link TB_SEGMENT_OVERLAP_MIN_LENGTH_M}.
 */
export function overlapLengthParallelSegments3D(
  a0: Vec3,
  a1: Vec3,
  b0: Vec3,
  b1: Vec3,
  lineSepTolM: number = TB_SEGMENT_OVERLAP_LINE_SEP_TOL_M,
  minOverlapM: number = TB_SEGMENT_OVERLAP_MIN_LENGTH_M,
): number {
  const wa = sub(a1, a0);
  const wb = sub(b1, b0);
  const lenA = len(wa);
  const lenB = len(wb);
  if (lenA < 1e-9 || lenB < 1e-9) return 0;

  const ua = scale(wa, 1 / lenA);
  const ub = scale(wb, 1 / lenB);
  const parallelDot = Math.abs(dot(ua, ub));
  if (parallelDot < TB_SEGMENT_PARALLEL_MIN_ABS_DOT) return 0;

  const w0 = sub(b0, a0);
  const p0 = splitAlongUnit(w0, ua);
  if (len(p0.perp) > lineSepTolM) return 0;

  const w1 = sub(b1, a0);
  const p1 = splitAlongUnit(w1, ua);
  if (len(p1.perp) > lineSepTolM) return 0;

  const t0 = dot(sub(b0, a0), ua);
  const t1 = dot(sub(b1, a0), ua);
  const bMin = Math.min(t0, t1);
  const bMax = Math.max(t0, t1);
  const overlap = Math.max(0, Math.min(lenA, bMax) - Math.max(0, bMin));
  if (overlap < minOverlapM) return 0;
  return overlap;
}

/** Same overlap rule for any two coordinate-based line elements (TB, ductwork, pipework). */
export function overlapLengthBetweenSegmentElements(a: Pick<Element, 'coordinates'>, b: Pick<Element, 'coordinates'>): number {
  const ea = finiteSegmentEndpointsFromCoordinates(a.coordinates);
  const eb = finiteSegmentEndpointsFromCoordinates(b.coordinates);
  if (!ea || !eb) return 0;
  return overlapLengthParallelSegments3D(ea[0], ea[1], eb[0], eb[1]);
}

export function overlapLengthBetweenThermalBridgeSegments(a: ThermalBridgeLinear, b: ThermalBridgeLinear): number {
  return overlapLengthBetweenSegmentElements(a, b);
}
