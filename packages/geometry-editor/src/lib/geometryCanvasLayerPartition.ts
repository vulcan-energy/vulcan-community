// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import { isElementOnActiveCanvasFloor, type CanvasFloorListEntry } from './elementCanvasFloor';

export type GeometryCanvasLayerDatum = {
  element: Element;
};

export function partitionElementCanvasDataByFloor<T extends GeometryCanvasLayerDatum>(
  rows: readonly T[],
  currentFloorZ: number | undefined,
  floors?: CanvasFloorListEntry[],
): { currentFloor: T[]; contextFloor: T[] } {
  const currentFloor: T[] = [];
  const contextFloor: T[] = [];

  for (const row of rows) {
    if (isElementOnActiveCanvasFloor(row.element, currentFloorZ, floors)) {
      currentFloor.push(row);
    } else {
      contextFloor.push(row);
    }
  }

  return { currentFloor, contextFloor };
}
