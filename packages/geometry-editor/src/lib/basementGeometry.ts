// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { BuildingElementGround, Element } from '../geometry/types';
import { findLinkedGroundSlabForLineElement } from './suspendedFloorGeometry';

type LineGroundHost = {
  zoneId?: string;
  parent_element: string | null;
  coordinates: Array<{ x: number; y: number }>;
};

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function isBasementGroundElement(g: BuildingElementGround): boolean {
  return g.floor_type === 'Heated_basement' || g.floor_type === 'Unheated_basement';
}

export function readBasementDepthFloorM(g: BuildingElementGround): number | null {
  const direct = finitePositiveNumber(g.depth_basement_floor);
  if (direct !== null) return direct;
  const extra = g.extra_json && typeof g.extra_json === 'object' && !Array.isArray(g.extra_json)
    ? (g.extra_json as Record<string, unknown>)
    : undefined;
  return finitePositiveNumber(extra?.depth_basement_floor);
}

export function readUnheatedBasementWallHeightAboveGroundM(g: BuildingElementGround): number | null {
  if (g.floor_type !== 'Unheated_basement') return null;
  const direct = finitePositiveNumber((g as { height_basement_walls?: unknown }).height_basement_walls);
  if (direct !== null) return direct;
  const extra = g.extra_json && typeof g.extra_json === 'object' && !Array.isArray(g.extra_json)
    ? (g.extra_json as Record<string, unknown>)
    : undefined;
  return finitePositiveNumber(extra?.height_basement_walls);
}

/** Upper surface of the basement floor, measured relative to external ground level. */
export function basementFloorSurfaceElevationM(g: BuildingElementGround): number | null {
  const depth = readBasementDepthFloorM(g);
  return depth === null ? null : -depth;
}

/** Surface represented by the HEM ground element in the model view. */
export function basementGroundElementSurfaceElevationM(g: BuildingElementGround): number | null {
  if (g.floor_type === 'Unheated_basement') {
    return readUnheatedBasementWallHeightAboveGroundM(g);
  }
  return basementFloorSurfaceElevationM(g);
}

/** External wall base target for walls linked to a basement ground element. */
export function basementExternalWallBaseHeightTargetM(g: BuildingElementGround): number | null {
  return basementGroundElementSurfaceElevationM(g);
}

export function findLinkedBasementGroundForLineElement(
  line: LineGroundHost,
  elements: Element[],
): { ground: BuildingElementGround; targetBaseHeightM: number } | null {
  const basementGrounds = elements.filter((e): e is BuildingElementGround => {
    return e.type === 'BuildingElementGround' && e.zoneId === line.zoneId && isBasementGroundElement(e);
  });
  const linked = findLinkedGroundSlabForLineElement(line, basementGrounds);
  if (!linked) return null;
  const targetBaseHeightM = basementExternalWallBaseHeightTargetM(linked);
  return targetBaseHeightM === null ? null : { ground: linked, targetBaseHeightM };
}
