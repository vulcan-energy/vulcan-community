// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementGround,
  Element,
} from '../geometry/types';

export const GROUND_SLAB_PERIM_LINK_TOL_M = 0.25;

type LineGroundHost = {
  zoneId?: string;
  parent_element: string | null;
  coordinates: Array<{ x: number; y: number; z?: number }>;
};

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function supportsGroundElevationOffset(g: BuildingElementGround): boolean {
  return (
    g.floor_type === 'Slab_no_edge_insulation' ||
    g.floor_type === 'Slab_edge_insulation' ||
    g.floor_type === 'Suspended_floor'
  );
}

export function readGroundLocalElevationOffsetM(g: BuildingElementGround): number | null {
  if (!supportsGroundElevationOffset(g)) return null;
  const raw = (g as { _base_height?: unknown })._base_height;
  return isFiniteNumber(raw) ? raw : null;
}

function pointToSegmentDistanceM(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const denom = abx * abx + aby * aby;
  const t = denom > 1e-18 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / denom)) : 0;
  const qx = ax + t * abx;
  const qy = ay + t * aby;
  return Math.hypot(px - qx, py - qy);
}

/** Closed-plan edges (XY) for a `BuildingElementGround` polygon. */
export function groundSlabPolygonEdgesXY(g: BuildingElementGround): Array<[[number, number], [number, number]]> {
  const c = g.coordinates;
  if (!c || c.length < 2) return [];
  const out: Array<[[number, number], [number, number]]> = [];
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i]!;
    const b = c[i + 1]!;
    out.push([
      [a.x, a.y],
      [b.x, b.y],
    ]);
  }
  const p0 = c[0]!;
  const pL = c[c.length - 1]!;
  if (
    c.length >= 3 &&
    Math.hypot(p0.x - pL.x, p0.y - pL.y) > 1e-4
  ) {
    out.push([[pL.x, pL.y], [p0.x, p0.y]]);
  }
  return out;
}

/** Closed-plan edges for a horizontal pitch-0 conditioned floor polygon or line. */
export function adjacentConditionedFloorPolygonEdgesXY(
  floor: BuildingElementAdjacentConditionedSpace,
): Array<[[number, number], [number, number]]> {
  if (floor.isPlaceholder || floor.pitch !== 0) return [];
  const c = floor.coordinates;
  if (!c || c.length < 2) return [];
  const z0 = typeof c[0]?.z === 'number' && Number.isFinite(c[0].z) ? c[0].z : 0;
  for (let i = 1; i < c.length; i++) {
    const zi = typeof c[i]?.z === 'number' && Number.isFinite(c[i].z) ? c[i].z : 0;
    if (Math.abs(zi - z0) > 1e-2) return [];
  }

  const out: Array<[[number, number], [number, number]]> = [];
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i]!;
    const b = c[i + 1]!;
    out.push([
      [a.x, a.y],
      [b.x, b.y],
    ]);
  }
  const p0 = c[0]!;
  const pL = c[c.length - 1]!;
  if (c.length >= 3 && Math.hypot(p0.x - pL.x, p0.y - pL.y) > 1e-4) {
    out.push([[pL.x, pL.y], [p0.x, p0.y]]);
  }
  return out;
}

function minDistancePointToEdgesM(px: number, py: number, edges: Array<[[number, number], [number, number]]>): number {
  let minD = Infinity;
  for (const [[ax, ay], [bx, by]] of edges) {
    minD = Math.min(minD, pointToSegmentDistanceM(px, py, ax, ay, bx, by));
  }
  return minD;
}

export function readSuspendedGroundHeightUpperSurfaceM(g: BuildingElementGround): number | null {
  if (g.floor_type !== 'Suspended_floor') return null;
  const raw = g.extra_json?.height_upper_surface;
  return isFiniteNonNegativeNumber(raw) ? raw : null;
}

/**
 * Absolute surface elevation for non-basement ground floors whose HEM surface height may sit above a
 * local site datum. Slab floors only return a value when the editor elevation is explicit; suspended
 * floors add the editor elevation offset to HEM `height_upper_surface`.
 */
export function nonBasementGroundSurfaceElevationM(g: BuildingElementGround): number | null {
  if (!supportsGroundElevationOffset(g)) return null;
  const localElevationOffsetM = readGroundLocalElevationOffsetM(g);
  if (g.floor_type === 'Suspended_floor') {
    const heightUpperSurfaceM = readSuspendedGroundHeightUpperSurfaceM(g);
    if (heightUpperSurfaceM !== null) {
      return (localElevationOffsetM ?? 0) + heightUpperSurfaceM;
    }
    return localElevationOffsetM;
  }
  return localElevationOffsetM;
}

export function findLinkedGroundSlabForLineElement(
  line: LineGroundHost,
  grounds: BuildingElementGround[],
  toleranceM: number = GROUND_SLAB_PERIM_LINK_TOL_M,
): BuildingElementGround | null {
  const sameZoneGrounds = grounds.filter((g) => g.zoneId === line.zoneId);
  if (sameZoneGrounds.length === 0) return null;

  const pe = typeof line.parent_element === 'string' ? line.parent_element.trim() : '';
  if (pe) {
    const named = sameZoneGrounds.find((g) => (g.name ?? '').trim() === pe);
    if (named) return named;
  }

  const c = line.coordinates;
  if (!c || c.length !== 2) return null;
  const a = c[0]!;
  const b = c[1]!;
  const lineStorey = Math.floor(Math.min(
    typeof a.z === 'number' && Number.isFinite(a.z) ? a.z : 0,
    typeof b.z === 'number' && Number.isFinite(b.z) ? b.z : 0,
  ));

  // Stacked same-footprint slabs tie on XY distance, so the storey gap breaks the tie
  // first — otherwise the linked slab (and every elevation gate keyed off it) would
  // depend on element array order.
  let best: { ground: BuildingElementGround; storeyGap: number; distanceM: number } | null = null;
  for (const g of sameZoneGrounds) {
    const edges = groundSlabPolygonEdgesXY(g);
    if (edges.length === 0) continue;
    const dA = minDistancePointToEdgesM(a.x, a.y, edges);
    const dB = minDistancePointToEdgesM(b.x, b.y, edges);
    if (dA > toleranceM || dB > toleranceM) continue;
    const distanceM = Math.max(dA, dB);
    const gz = g.coordinates?.[0]?.z;
    const storeyGap = Math.abs(
      Math.floor(typeof gz === 'number' && Number.isFinite(gz) ? gz : 0) - lineStorey,
    );
    if (
      !best ||
      storeyGap < best.storeyGap ||
      (storeyGap === best.storeyGap && distanceM < best.distanceM)
    ) {
      best = { ground: g, storeyGap, distanceM };
    }
  }
  return best?.ground ?? null;
}

/**
 * Find the horizontal conditioned floor footprint linked to a line by name or plan-boundary proximity.
 * This mirrors {@link findLinkedGroundSlabForLineElement} for pitch-0 floor faces.
 */
export function findLinkedAdjacentConditionedFloorForLineElement(
  line: LineGroundHost,
  floors: BuildingElementAdjacentConditionedSpace[],
  toleranceM: number = GROUND_SLAB_PERIM_LINK_TOL_M,
): BuildingElementAdjacentConditionedSpace | null {
  const sameZoneFloors = floors.filter((floor) => floor.zoneId === line.zoneId);
  if (sameZoneFloors.length === 0) return null;

  const pe = typeof line.parent_element === 'string' ? line.parent_element.trim() : '';
  if (pe) {
    const named = sameZoneFloors.find((floor) => (floor.name ?? '').trim() === pe);
    if (named && adjacentConditionedFloorPolygonEdgesXY(named).length > 0) return named;
  }

  const c = line.coordinates;
  if (!c || c.length !== 2) return null;
  const a = c[0]!;
  const b = c[1]!;

  let best: { floor: BuildingElementAdjacentConditionedSpace; distanceM: number } | null = null;
  for (const floor of sameZoneFloors) {
    const edges = adjacentConditionedFloorPolygonEdgesXY(floor);
    if (edges.length === 0) continue;
    const dA = minDistancePointToEdgesM(a.x, a.y, edges);
    const dB = minDistancePointToEdgesM(b.x, b.y, edges);
    if (dA > toleranceM || dB > toleranceM) continue;
    const distanceM = Math.max(dA, dB);
    if (!best || distanceM < best.distanceM) {
      best = { floor, distanceM };
    }
  }
  return best?.floor ?? null;
}

export function findSuspendedGroundSurfaceForLineElement(
  line: LineGroundHost,
  elements: Element[],
): { ground: BuildingElementGround; surfaceM: number } | null {
  const suspendedGrounds = elements.filter((e): e is BuildingElementGround => {
    if (e.type !== 'BuildingElementGround') return false;
    return readSuspendedGroundHeightUpperSurfaceM(e) !== null;
  });
  const ground = findLinkedGroundSlabForLineElement(line, suspendedGrounds);
  if (!ground) return null;
  const surfaceM = nonBasementGroundSurfaceElevationM(ground);
  return surfaceM === null ? null : { ground, surfaceM };
}

export function findNonBasementGroundSurfaceForLineElement(
  line: LineGroundHost,
  elements: Element[],
): { ground: BuildingElementGround; surfaceM: number } | null {
  const surfaceGrounds = elements.filter((e): e is BuildingElementGround => {
    if (e.type !== 'BuildingElementGround') return false;
    return nonBasementGroundSurfaceElevationM(e) !== null;
  });
  const ground = findLinkedGroundSlabForLineElement(line, surfaceGrounds);
  if (!ground) return null;
  const surfaceM = nonBasementGroundSurfaceElevationM(ground);
  return surfaceM === null ? null : { ground, surfaceM };
}
