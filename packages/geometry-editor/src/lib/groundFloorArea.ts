// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

type ElementCoordinate = { x: number; y: number; z: number };

type GroundAreaElement = {
  id: string;
  area: number;
  zoneId?: string;
  floorId?: string;
  coordinates?: ElementCoordinate[];
};

function groundFloorGroupKey(element: GroundAreaElement): string {
  const floorId = typeof element.floorId === 'string' ? element.floorId.trim() : '';
  if (floorId) return `floor:${floorId}`;
  const z = element.coordinates?.[0]?.z;
  return typeof z === 'number' && Number.isFinite(z) ? `z:${Math.floor(z)}` : 'z:0';
}

/**
 * HEM's automatic value is the area of this ground object. If the same
 * physical object is divided between zones, users author the whole-object
 * total explicitly on each zone fragment.
 */
export function deriveAutomaticGroundTotalArea(element: Pick<GroundAreaElement, 'area'>): number {
  return Number.isFinite(element.area) && element.area > 0
    ? Math.round(element.area * 100) / 100
    : 0;
}

/**
 * A one-zone model cannot contain cross-zone fragments, so every object's
 * automatic total is its own area. In a multi-zone model, rows on the same
 * physical storey are treated as fragments of the dwelling-wide floor.
 */
export function deriveAutomaticGroundTotalAreas(
  elements: readonly GroundAreaElement[],
): Map<string, number> {
  const zoneIds = new Set(elements.map((element) => element.zoneId?.trim()).filter(Boolean));
  if (zoneIds.size <= 1) {
    return new Map(elements.map((element) => [element.id, deriveAutomaticGroundTotalArea(element)]));
  }

  const totalsByFloor = new Map<string, number>();
  for (const element of elements) {
    const key = groundFloorGroupKey(element);
    totalsByFloor.set(key, (totalsByFloor.get(key) ?? 0) + deriveAutomaticGroundTotalArea(element));
  }
  return new Map(elements.map((element) => [
    element.id,
    Math.round((totalsByFloor.get(groundFloorGroupKey(element)) ?? 0) * 100) / 100,
  ]));
}

export function groundTotalAreaMismatch(value: number | null | undefined, autoValue: number, tolerance = 0.01): boolean {
  return typeof value !== 'number'
    || !Number.isFinite(value)
    || Math.abs(value - autoValue) > tolerance;
}
