// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Floor } from '../geometry/types';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function deriveFloorsFromElements(elements: Element[]): Floor[] {
  const zValues = new Set<number>([0]);
  for (const element of elements) {
    for (const coord of element.coordinates ?? []) {
      if (isFiniteNumber(coord.z)) zValues.add(Math.floor(coord.z));
    }
  }
  return [...zValues]
    .sort((a, b) => a - b)
    .map((zIndex) => ({
      id: String(zIndex),
      name: zIndex === 0 ? 'Ground Floor' : `Floor ${zIndex}`,
      zIndex,
      height: 0,
      isRoofSpace: false,
    }));
}
