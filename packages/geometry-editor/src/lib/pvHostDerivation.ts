// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Soft host-link for PV panels: detects which roof a panel sits on (in plan view) and
 * derives base_height / pitch / orientation360 from that host. The link is stored on the
 * panel as `_pvHostRoofId`; per-field `_*UserOverride` flags suppress auto-derivation when
 * the user has manually edited a field.
 */
import type { BuildingElementOpaque, BuildingElementTransparent, Element, OnSiteGeneration } from '../geometry/types';
import type { Floor } from '../stores/geometryStore';
import { elementBaseElevationMForTb } from './geometry3dMapper';
import {
  applyCompassOrientationToSlopedPolygonCoords,
  orientation360SlopedFromFirstEdge,
} from './openingSegmentOutward';
import { isRoofLikeOpaqueElement } from './roofElement';
import { roofTopElevationAtPlanM } from './roofTopElevationAtPlanM';

type Pt2 = { x: number; y: number };

import { isPointInPolygon2D as pointInPolygon2D } from './pointInPolygon';

export { pointInPolygon2D };

export function polygonAreaM2(ring: ReadonlyArray<Pt2>): number {
  const n = ring.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    s += ring[j]!.x * ring[i]!.y - ring[i]!.x * ring[j]!.y;
  }
  return Math.abs(s) * 0.5;
}

function polygonCentroid2D(ring: ReadonlyArray<Pt2>): Pt2 | null {
  const n = ring.length;
  if (n === 0) return null;
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / n, y: cy / n };
}

function isCandidateRoofHost(el: Element): el is BuildingElementOpaque {
  if (el.type !== 'BuildingElementOpaque') return false;
  const coords = (el as BuildingElementOpaque).coordinates;
  if (!Array.isArray(coords) || coords.length < 3) return false;
  const pitch = (el as BuildingElementOpaque).pitch;
  const isSloped = typeof pitch === 'number' && Number.isFinite(pitch) && pitch > 0 && pitch < 90;
  return isSloped || isRoofLikeOpaqueElement(el);
}

/**
 * Smallest roof polygon (by plan-view area) whose footprint contains the panel's centroid.
 * Smallest-containing handles dormers nested inside a main roof.
 */
export function findHostRoofId(
  panel: Pick<OnSiteGeneration | BuildingElementTransparent, 'coordinates'>,
  elementsById: Record<string, Element>,
): string | null {
  const planRing = (panel.coordinates ?? []).map((c) => ({ x: c.x, y: c.y }));
  const centroid = polygonCentroid2D(planRing);
  if (!centroid) return null;

  let bestId: string | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const el of Object.values(elementsById)) {
    if (!isCandidateRoofHost(el)) continue;
    const ring = el.coordinates.map((c) => ({ x: c.x, y: c.y }));
    if (!pointInPolygon2D(centroid, ring)) continue;
    const area = polygonAreaM2(ring);
    if (area > 0 && area < bestArea) {
      bestArea = area;
      bestId = el.id;
    }
  }
  return bestId;
}

export function isPanelFullyOnRoof(
  panel: Pick<OnSiteGeneration | BuildingElementTransparent, 'coordinates'>,
  roof: Pick<BuildingElementOpaque, 'coordinates'>,
): boolean {
  const ring = (roof.coordinates ?? []).map((c) => ({ x: c.x, y: c.y }));
  if (ring.length < 3) return false;
  for (const c of panel.coordinates ?? []) {
    if (!pointInPolygon2D({ x: c.x, y: c.y }, ring)) return false;
  }
  return true;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Derive PV fields from a host roof:
 * - pitch / orientation360 inherited directly from the roof
 * - base_height = lowest 3D elevation of the roof surface across the panel's plan vertices
 *   (matches HEM schema: "distance from ground to lowest edge"). Flat roofs use the roof's
 *   base elevation directly.
 *
 * `floors` must already carry effective storey heights — callers run
 * `withEffectiveStoreyHeights(floors, elements)` first so wall-derived heights are baked in.
 */
export function deriveFromHostRoof(
  panel: Pick<OnSiteGeneration | BuildingElementTransparent, 'coordinates'>,
  roof: BuildingElementOpaque,
  floors: Floor[] | undefined,
): { base_height?: number; pitch?: number; orientation360?: number } {
  const result: { base_height?: number; pitch?: number; orientation360?: number } = {};

  if (typeof roof.pitch === 'number' && Number.isFinite(roof.pitch)) {
    result.pitch = roof.pitch;
  }
  if (typeof roof.orientation360 === 'number' && Number.isFinite(roof.orientation360)) {
    result.orientation360 = roof.orientation360;
  }

  const ringPts = panel.coordinates ?? [];
  if (ringPts.length === 0) return result;

  const isSloped = typeof roof.pitch === 'number' && roof.pitch > 0 && roof.pitch < 90;
  if (isSloped) {
    const elevations: number[] = [];
    for (const p of ringPts) {
      const z = roofTopElevationAtPlanM(roof, p.x, p.y, floors);
      if (typeof z === 'number' && Number.isFinite(z)) elevations.push(z);
    }
    if (elevations.length > 0) {
      result.base_height = round2(Math.min(...elevations));
    }
  } else {
    const baseEl =
      floors && floors.length > 0
        ? elementBaseElevationMForTb(roof, floors)
        : typeof roof.base_height === 'number' && Number.isFinite(roof.base_height)
          ? roof.base_height
          : undefined;
    if (typeof baseEl === 'number' && Number.isFinite(baseEl)) {
      result.base_height = round2(baseEl);
    }
  }
  return result;
}

export function alignHostedSlopedPanelToHostOrientation(
  panel: Pick<OnSiteGeneration | BuildingElementTransparent, 'coordinates'>,
  roof: Pick<BuildingElementOpaque, 'coordinates'>,
  globalOrientationOffset = 0,
): Array<{ x: number; y: number; z: number }> | null {
  const hostCoords = roof.coordinates ?? [];
  if (hostCoords.length < 2) return null;
  const desired = orientation360SlopedFromFirstEdge(
    hostCoords[0]!.x,
    hostCoords[0]!.y,
    hostCoords[1]!.x,
    hostCoords[1]!.y,
    globalOrientationOffset,
  );
  if (desired === null) return null;
  return applyCompassOrientationToSlopedPolygonCoords(
    panel.coordinates as Array<{ x: number; y: number; z: number }>,
    desired,
    globalOrientationOffset,
  );
}

/**
 * Build a partial OnSiteGeneration patch that applies derived values only for fields the user
 * has not manually overridden. Returns an empty object when no fields are due for update.
 */
export function buildHostDerivedPatch(
  panel: OnSiteGeneration,
  derived: { base_height?: number; pitch?: number; orientation360?: number },
): Partial<OnSiteGeneration> {
  const patch: Partial<OnSiteGeneration> = {};
  if (derived.base_height !== undefined && !panel._baseHeightUserOverride) {
    patch.base_height = derived.base_height;
  }
  if (derived.pitch !== undefined && !panel._pitchUserOverride) {
    patch.pitch = derived.pitch;
  }
  if (derived.orientation360 !== undefined && !panel._orientationUserOverride) {
    patch.orientation360 = derived.orientation360;
  }
  return patch;
}

export function buildTransparentHostDerivedPatch(
  opening: BuildingElementTransparent,
  derived: { base_height?: number; pitch?: number; orientation360?: number },
): Partial<BuildingElementTransparent> {
  const patch: Partial<BuildingElementTransparent> = {};
  if (derived.base_height !== undefined) {
    patch.base_height = derived.base_height;
  }
  if (derived.pitch !== undefined) {
    patch.pitch = derived.pitch;
  }
  if (derived.orientation360 !== undefined) {
    patch.orientation360 = derived.orientation360;
  }
  return patch;
}
