// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { roundToTwoDecimals } from '../geometry/constants';
import type { ThermalBridgeLinear } from '../geometry/types';
import { readExplicitTbLineMode, type TbLineMode } from './thermalBridgeLineMode';

/** Same threshold as 3D “vertical in plan” thermal bridge rendering. */
export const THERMAL_BRIDGE_PLAN_LEN_EPS_M = 1e-3;
export const DEFAULT_THERMAL_BRIDGE_VERTICAL_RISE_M = 1.0;
export const MIN_THERMAL_BRIDGE_VERTICAL_RISE_M = 0.5;

function finiteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Physical HEM linear bridge length (m): plan, vertical, and slope modes all store the actual run length. */
export function computeThermalBridgeLinearRunLengthM(
  coordinates: Array<{ x?: unknown; y?: unknown; z?: unknown }> | undefined,
): number {
  if (!coordinates || coordinates.length !== 2) return 0;
  const [p0, p1] = coordinates;
  if (!p0 || !p1) return 0;
  const x0 = p0.x,
    y0 = p0.y,
    z0 = p0.z;
  const x1 = p1.x,
    y1 = p1.y,
    z1 = p1.z;
  if (!finiteNum(x0) || !finiteNum(y0) || !finiteNum(x1) || !finiteNum(y1)) return 0;
  const planLen = Math.hypot(x1 - x0, y1 - y0);
  if (planLen >= THERMAL_BRIDGE_PLAN_LEN_EPS_M) {
    const dz = finiteNum(z0) && finiteNum(z1) ? z1 - z0 : 0;
    return Math.hypot(planLen, dz);
  }
  if (finiteNum(z0) && finiteNum(z1)) return Math.abs(z1 - z0);
  return 0;
}

/** HEM `length` (m) aligned with the coordinate-defined physical TB run. */
export function syncThermalBridgeLinearLengthFromCoordinates(
  tb: Pick<ThermalBridgeLinear, 'coordinates'>,
): number {
  return roundToTwoDecimals(computeThermalBridgeLinearRunLengthM(tb.coordinates));
}

/** Authoring/rendering shape implied by coordinates once plan mode has flattened endpoint Zs. */
export function inferThermalBridgeLineModeFromCoordinates(
  coordinates: Array<{ x?: unknown; y?: unknown; z?: unknown }> | undefined,
): TbLineMode {
  if (!coordinates || coordinates.length !== 2) return 'plan';
  const [a, b] = coordinates;
  if (!a || !b || !finiteNum(a.x) || !finiteNum(a.y) || !finiteNum(b.x) || !finiteNum(b.y)) return 'plan';
  const planLen = Math.hypot(b.x - a.x, b.y - a.y);
  if (planLen < THERMAL_BRIDGE_PLAN_LEN_EPS_M) return 'vertical';
  const z0 = finiteNum(a.z) ? a.z : 0;
  const z1 = finiteNum(b.z) ? b.z : z0;
  return Math.abs(z1 - z0) >= THERMAL_BRIDGE_PLAN_LEN_EPS_M ? 'slope' : 'plan';
}

/** Authoring mode: explicit metadata wins; imported/auto geometry can still infer mode from coordinates. */
export function resolveThermalBridgeLineMode(
  tb: Pick<ThermalBridgeLinear, 'coordinates' | 'extra_json'>,
): TbLineMode {
  return readExplicitTbLineMode(tb.extra_json) ?? inferThermalBridgeLineModeFromCoordinates(tb.coordinates);
}

/**
 * Normalize coordinates to the selected authoring mode. This keeps coordinate shape authoritative:
 * - plan: two XY endpoints, one shared physical Z
 * - vertical: one XY point, two physical Z elevations
 * - slope: two XY endpoints with independent physical Z elevations
 */
export function normalizeThermalBridgeLineCoordinatesForMode(
  coordinates: Array<{ x: number; y: number; z: number }> | undefined,
  mode: TbLineMode,
): Array<{ x: number; y: number; z: number }> | undefined {
  if (!coordinates || coordinates.length === 0) return undefined;
  const a = coordinates[0];
  if (!a || !finiteNum(a.x) || !finiteNum(a.y)) return undefined;
  const z0 = finiteNum(a.z) ? roundToTwoDecimals(a.z) : 0;
  const b = coordinates[1] ?? a;
  const bx = finiteNum(b.x) ? b.x : a.x;
  const by = finiteNum(b.y) ? b.y : a.y;
  const z1 = finiteNum(b.z) ? roundToTwoDecimals(b.z) : z0;
  const planLen = Math.hypot(bx - a.x, by - a.y);
  const bottomZ = Math.min(z0, z1);
  const physicalLength = Math.hypot(planLen, z1 - z0);
  const verticalSource = planLen < THERMAL_BRIDGE_PLAN_LEN_EPS_M && Math.abs(z1 - z0) >= THERMAL_BRIDGE_PLAN_LEN_EPS_M;

  if (mode === 'vertical') {
    const dz = Math.max(MIN_THERMAL_BRIDGE_VERTICAL_RISE_M, physicalLength);
    return [
      { x: roundToTwoDecimals(a.x), y: roundToTwoDecimals(a.y), z: roundToTwoDecimals(bottomZ) },
      { x: roundToTwoDecimals(a.x), y: roundToTwoDecimals(a.y), z: roundToTwoDecimals(bottomZ + dz) },
    ];
  }

  if (mode === 'plan') {
    if (verticalSource) {
      const length = Math.abs(z1 - z0);
      return [
        { x: roundToTwoDecimals(a.x), y: roundToTwoDecimals(a.y), z: roundToTwoDecimals(bottomZ) },
        { x: roundToTwoDecimals(a.x + length), y: roundToTwoDecimals(a.y), z: roundToTwoDecimals(bottomZ) },
      ];
    }
    return [
      { x: roundToTwoDecimals(a.x), y: roundToTwoDecimals(a.y), z: z0 },
      { x: roundToTwoDecimals(bx), y: roundToTwoDecimals(by), z: z0 },
    ];
  }

  if (verticalSource) {
    const length = Math.abs(z1 - z0);
    return [
      { x: roundToTwoDecimals(a.x), y: roundToTwoDecimals(a.y), z: roundToTwoDecimals(bottomZ) },
      { x: roundToTwoDecimals(a.x + length), y: roundToTwoDecimals(a.y), z: roundToTwoDecimals(bottomZ) },
    ];
  }

  return [
    { x: roundToTwoDecimals(a.x), y: roundToTwoDecimals(a.y), z: z0 },
    { x: roundToTwoDecimals(bx), y: roundToTwoDecimals(by), z: z1 },
  ];
}

export function createThermalBridgeLineCoordinates(
  start: { x: number; y: number },
  end: { x: number; y: number },
  physicalZ: number,
  mode: TbLineMode,
): Array<{ x: number; y: number; z: number }> {
  const z = roundToTwoDecimals(physicalZ);
  if (mode === 'vertical') {
    return [
      { x: roundToTwoDecimals(start.x), y: roundToTwoDecimals(start.y), z },
      { x: roundToTwoDecimals(start.x), y: roundToTwoDecimals(start.y), z: roundToTwoDecimals(z + DEFAULT_THERMAL_BRIDGE_VERTICAL_RISE_M) },
    ];
  }
  if (mode === 'slope') {
    return [
      { x: roundToTwoDecimals(start.x), y: roundToTwoDecimals(start.y), z },
      { x: roundToTwoDecimals(end.x), y: roundToTwoDecimals(end.y), z: roundToTwoDecimals(z + DEFAULT_THERMAL_BRIDGE_VERTICAL_RISE_M) },
    ];
  }
  return normalizeThermalBridgeLineCoordinatesForMode(
    [
      { x: start.x, y: start.y, z },
      { x: end.x, y: end.y, z },
    ],
    mode,
  )!;
}

/**
 * When the user edits scalar `length` only, adjust endpoint coordinates so the run length matches.
 * - Vertical-in-plan: stretch/shrink along z (preserve z direction).
 * - Plan/slope runs: move second point along the existing 3D ray from the first.
 */
export function applyThermalBridgeLinearLengthToCoordinates(
  tb: Pick<ThermalBridgeLinear, 'coordinates'> & Partial<Pick<ThermalBridgeLinear, 'extra_json'>>,
  lengthM: number,
): Array<{ x: number; y: number; z: number }> | undefined {
  const coords = tb.coordinates;
  if (!coords || coords.length !== 2) return undefined;
  const [a0, b0] = coords;
  if (!a0 || !b0) return undefined;
  const ax = a0.x,
    ay = a0.y,
    az = a0.z;
  const bx = b0.x,
    by = b0.y,
    bz = b0.z;
  if (!finiteNum(ax) || !finiteNum(ay) || !finiteNum(bx) || !finiteNum(by)) return undefined;
  const planLen = Math.hypot(bx - ax, by - ay);
  const L = Math.max(0, lengthM);
  if (planLen < THERMAL_BRIDGE_PLAN_LEN_EPS_M) {
    const z0 = finiteNum(az) ? az : 0;
    const z1Raw = finiteNum(bz) ? bz : z0;
    const sign = z1Raw >= z0 ? 1 : -1;
    const z1 = z0 + sign * L;
    return [
      { x: ax, y: ay, z: roundToTwoDecimals(z0) },
      { x: ax, y: ay, z: roundToTwoDecimals(z1) },
    ];
  }
  const mode = resolveThermalBridgeLineMode(tb as Pick<ThermalBridgeLinear, 'coordinates' | 'extra_json'>);
  if (mode === 'plan') {
    const ux = (bx - ax) / planLen;
    const uy = (by - ay) / planLen;
    const zA = finiteNum(az) ? az : 0;
    return [
      { x: roundToTwoDecimals(ax), y: roundToTwoDecimals(ay), z: roundToTwoDecimals(zA) },
      {
        x: roundToTwoDecimals(ax + ux * L),
        y: roundToTwoDecimals(ay + uy * L),
        z: roundToTwoDecimals(zA),
      },
    ];
  }
  const zA = finiteNum(az) ? az : 0;
  const zB = finiteNum(bz) ? bz : zA;
  const dz = zB - zA;
  const runLen = Math.hypot(planLen, dz);
  if (runLen < THERMAL_BRIDGE_PLAN_LEN_EPS_M) return undefined;
  const scale = L / runLen;
  return [
    { x: roundToTwoDecimals(ax), y: roundToTwoDecimals(ay), z: roundToTwoDecimals(zA) },
    {
      x: roundToTwoDecimals(ax + (bx - ax) * scale),
      y: roundToTwoDecimals(ay + (by - ay) * scale),
      z: roundToTwoDecimals(zA + dz * scale),
    },
  ];
}

export function thermalBridgeLinearHasPositiveRun(tb: Pick<ThermalBridgeLinear, 'coordinates' | 'length'>): boolean {
  const fromField = typeof tb.length === 'number' && Number.isFinite(tb.length) && tb.length > 0;
  if (fromField) return true;
  return computeThermalBridgeLinearRunLengthM(tb.coordinates) > THERMAL_BRIDGE_PLAN_LEN_EPS_M;
}
