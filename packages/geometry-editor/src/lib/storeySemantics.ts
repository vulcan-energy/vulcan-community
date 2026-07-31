// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * FHS-facing storey numbers are one-based: 1 is the ground floor, 2 is the
 * first floor above ground, and 0 is one basement level below ground.
 *
 * Canvas coordinates and Floor.zIndex remain zero-based internal storey bands.
 */
export function canvasFloorToFhsStorey(zIndex: number): number {
  return Math.floor(zIndex) + 1;
}

export function fhsStoreyToCanvasFloor(storey: number): number {
  return Math.floor(storey) - 1;
}

export function formatStoreyNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, '');
}

export function fhsFloorCodeForCanvasFloor(zIndex: number): string {
  return `F${formatStoreyNumber(canvasFloorToFhsStorey(zIndex))}`;
}

export function fhsFloorDescriptorForCanvasFloor(zIndex: number): string | undefined {
  const storey = canvasFloorToFhsStorey(zIndex);
  if (storey === 1) return 'Ground';
  if (storey <= 0) return `Basement ${1 - storey}`;
  return undefined;
}

export function fhsFloorLabelForCanvasFloor(zIndex: number): string {
  const code = fhsFloorCodeForCanvasFloor(zIndex);
  const descriptor = fhsFloorDescriptorForCanvasFloor(zIndex);
  return descriptor ? `${code}: ${descriptor}` : code;
}
