// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { roundToTwoDecimals } from '../geometry/constants';
import type { ElementType } from '../geometry/types';
import type { DrawMode } from '../hooks/useDrawingMode';
import {
  DEFAULT_THERMAL_BRIDGE_VERTICAL_RISE_M,
  inferThermalBridgeLineModeFromCoordinates,
  normalizeThermalBridgeLineCoordinatesForMode,
} from './thermalBridgeLinearGeometry';
import type { TbLineMode } from './thermalBridgeLineMode';

export const SERVICE_LINE_ELEMENT_TYPES = [
  'ThermalBridgeLinear',
  'WaterPipework',
  'MechanicalVentilationDuctwork',
] as const satisfies readonly ElementType[];

export function isServiceLineElementType(type: string): type is (typeof SERVICE_LINE_ELEMENT_TYPES)[number] {
  return (SERVICE_LINE_ELEMENT_TYPES as readonly string[]).includes(type);
}

export function isServiceLineDrawMode(mode: DrawMode): mode is 'tb-plan-line' | 'tb-vertical-line' | 'tb-slope-line' {
  return mode === 'tb-plan-line' || mode === 'tb-vertical-line' || mode === 'tb-slope-line';
}

export function serviceLineModeFromDrawMode(mode: DrawMode): TbLineMode {
  if (mode === 'tb-vertical-line') return 'vertical';
  if (mode === 'tb-slope-line') return 'slope';
  return 'plan';
}

export function serviceLineModeFromShapeValue(shape: string): TbLineMode {
  if (shape === 'tb-vertical-line') return 'vertical';
  if (shape === 'tb-slope-line') return 'slope';
  return 'plan';
}

export function serviceLineShapeValueForMode(mode: TbLineMode): 'tb-plan-line' | 'tb-vertical-line' | 'tb-slope-line' {
  if (mode === 'vertical') return 'tb-vertical-line';
  if (mode === 'slope') return 'tb-slope-line';
  return 'tb-plan-line';
}

export function inferServiceLineModeFromCoordinates(
  coordinates: Array<{ x: number; y: number; z: number }> | undefined,
): TbLineMode {
  return inferThermalBridgeLineModeFromCoordinates(coordinates);
}

export function normalizeServiceLineCoordinatesForMode(
  coordinates: Array<{ x: number; y: number; z: number }> | undefined,
  mode: TbLineMode,
): Array<{ x: number; y: number; z: number }> | undefined {
  return normalizeThermalBridgeLineCoordinatesForMode(coordinates, mode);
}

export function getServiceLineLengthFromCoordinates(
  coordinates: Array<{ x: number; y: number; z: number }> | undefined,
): number {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return 0;
  const [a, b] = coordinates;
  if (!a || !b) return 0;
  return roundToTwoDecimals(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
}

export function getServiceLinePlanLengthFromCoordinates(
  coordinates: Array<{ x: number; y: number; z: number }> | undefined,
): number {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return 0;
  const [a, b] = coordinates;
  if (!a || !b) return 0;
  return roundToTwoDecimals(Math.hypot(b.x - a.x, b.y - a.y));
}

export function applyServiceLinePlanLengthToCoordinates(
  coordinates: Array<{ x: number; y: number; z: number }> | undefined,
  planLengthM: number,
): Array<{ x: number; y: number; z: number }> | undefined {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return undefined;
  if (!Number.isFinite(planLengthM) || planLengthM <= 0) return undefined;
  const [a, b] = coordinates;
  if (!a || !b) return undefined;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const currentPlanLength = Math.hypot(dx, dy);
  if (currentPlanLength <= Number.EPSILON) return undefined;
  const scale = planLengthM / currentPlanLength;
  return [
    {
      x: roundToTwoDecimals(a.x),
      y: roundToTwoDecimals(a.y),
      z: roundToTwoDecimals(a.z),
    },
    {
      x: roundToTwoDecimals(a.x + dx * scale),
      y: roundToTwoDecimals(a.y + dy * scale),
      z: roundToTwoDecimals(b.z),
    },
  ];
}

export function createServiceLineCoordinates(
  start: { x: number; y: number },
  end: { x: number; y: number },
  physicalZ: number,
  mode: TbLineMode,
): Array<{ x: number; y: number; z: number }> {
  const z = roundToTwoDecimals(physicalZ);
  if (mode === 'vertical') {
    return [
      { x: roundToTwoDecimals(start.x), y: roundToTwoDecimals(start.y), z },
      {
        x: roundToTwoDecimals(start.x),
        y: roundToTwoDecimals(start.y),
        z: roundToTwoDecimals(z + DEFAULT_THERMAL_BRIDGE_VERTICAL_RISE_M),
      },
    ];
  }

  if (mode === 'slope') {
    return [
      { x: roundToTwoDecimals(start.x), y: roundToTwoDecimals(start.y), z },
      {
        x: roundToTwoDecimals(end.x),
        y: roundToTwoDecimals(end.y),
        z: roundToTwoDecimals(z + DEFAULT_THERMAL_BRIDGE_VERTICAL_RISE_M),
      },
    ];
  }

  return [
    { x: roundToTwoDecimals(start.x), y: roundToTwoDecimals(start.y), z },
    { x: roundToTwoDecimals(end.x), y: roundToTwoDecimals(end.y), z },
  ];
}
