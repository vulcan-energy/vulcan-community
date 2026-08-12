// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import polygonClipping, { type MultiPolygon, type Pair, type Polygon, type Ring } from 'polygon-clipping';
import type { Element } from '../geometry/types';
import { roundToTwoDecimals } from '../geometry/constants';
import { orientation360SlopedFromFirstEdge } from './openingSegmentOutward';
import { isVulcanUiPartyFloorElement } from './assemblyMaterialFabric';
import { deriveSlopedElementDimensions } from './slopedElementDimensions';
import { derivePvDimensionsFromCoords } from './pvPanelFootprint';
import { ensureCounterClockwisePolygon } from './polygonWinding';

const HEM_UNHEATED_PITCHED_ROOF_MAX_PITCH_DEG = 60;

const elementRecord = (element: Element): Record<string, unknown> =>
  element as unknown as Record<string, unknown>;

const getElementField = (element: Element, key: string): unknown =>
  elementRecord(element)[key];

const getElementNumber = (element: Element, key: string): number | undefined => {
  const value = getElementField(element, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const isElementFieldUnset = (element: Element, key: string): boolean =>
  !(key in element) || getElementField(element, key) === undefined || getElementField(element, key) === null;

/**
 * Calculate the area of a polygon using the shoelace formula (2D)
 */
export function calculatePolygonArea(coords: Array<{x: number, y: number, z: number}>): number {
  if (coords.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    area += coords[i].x * coords[j].y;
    area -= coords[j].x * coords[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Internal floors (`BuildingElementAdjacentConditionedSpace` polygons drawn horizontally,
 * not flagged as Party Element) expose both their top and bottom faces to conditioned space,
 * so HEM needs twice the plan polygon area as the thermal exchange surface.
 */
export function isAdjacentConditionedInternalFloorDoubled(
  element: Pick<Element, 'type' | 'coordinates' | 'extra_json'> & { pitch?: number },
): boolean {
  if (element.type !== 'BuildingElementAdjacentConditionedSpace') return false;
  const coords = element.coordinates;
  if (!coords || coords.length < 3) return false;
  // Effective pitch: undefined defaults to 0 (horizontal) for polygon-shape adjacent fabric.
  const rawPitch = element.pitch;
  const pitch = rawPitch === undefined || rawPitch === null ? 0 : rawPitch;
  if (pitch !== 0 && pitch !== 180) return false;
  if (isVulcanUiPartyFloorElement(element)) return false;
  return true;
}

/**
 * Sync polygon-capable element properties based on coordinates
 * For polygon shapes (3+ coords), calculates area and derives width/height
 */
export function syncPolygonElement(
  element: Element,
  globalOrientationOffset: number,
): Partial<Element> {
  // Using a permissive shape because not all Element variants share these fields
  const updates: Record<string, unknown> = {};

  if (!element.coordinates || element.coordinates.length < 3) {
    return updates;
  }

  const baseArea = calculatePolygonArea(element.coordinates);

  // Adjacent/party fabric with 3+ vertices but zero XY footprint (vertical wall quads): do not overwrite
  // stored width/height/area/pitch from CSV — shoelace area is 0 in plan but the face is still valid.
  const adjacentFabricTypes: Element['type'][] = [
    'BuildingElementAdjacentConditionedSpace',
    'BuildingElementAdjacentUnconditionedSpace_Simple',
    'BuildingElementPartyWall',
  ];
  if (adjacentFabricTypes.includes(element.type) && baseArea < 1e-9) {
    return updates;
  }

  const area = isAdjacentConditionedInternalFloorDoubled(element) ? baseArea * 2 : baseArea;
  const roundedArea = roundToTwoDecimals(area);
  updates.area = roundedArea;

  // For polygon-capable types, derive width/height from area
  const polygonCapableTypes = [
    'BuildingElementOpaque',
    'BuildingElementTransparent',
    'BuildingElementAdjacentConditionedSpace',
    'BuildingElementAdjacentUnconditionedSpace_Simple',
  ];

  if (polygonCapableTypes.includes(element.type)) {
    const slopedDimensions = deriveSlopedElementDimensions(element);
    if (slopedDimensions) {
      const usePlanArea =
        element.type === 'BuildingElementOpaque' &&
        (element as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof === true &&
        typeof (element as { pitch?: unknown }).pitch === 'number' &&
        (element as { pitch: number }).pitch < HEM_UNHEATED_PITCHED_ROOF_MAX_PITCH_DEG;
      if (!usePlanArea) {
        updates.area = element.type === 'BuildingElementAdjacentConditionedSpace' &&
          !isVulcanUiPartyFloorElement(element)
          ? roundToTwoDecimals(slopedDimensions.area * 2)
          : slopedDimensions.area;
      }
      if ((element as { _widthUserOverride?: boolean })._widthUserOverride !== true) {
        updates.width = slopedDimensions.width;
      }
      if ((element as { _heightUserOverride?: boolean })._heightUserOverride !== true) {
        updates.height = slopedDimensions.height;
      }
    } else {
      // Horizontal polygons still use an equivalent square because HEM takes scalar dimensions.
      const dimension = roundToTwoDecimals(Math.sqrt(area));
      if ((element as { _widthUserOverride?: boolean })._widthUserOverride !== true) {
        updates.width = dimension;
      }
      if ((element as { _heightUserOverride?: boolean })._heightUserOverride !== true) {
        updates.height = dimension;
      }
    }

    // Set default pitch for horizontal polygons (0 = external face up)
    if (isElementFieldUnset(element, 'pitch')) {
      updates.pitch = 0;
    }

    // Set neutral orientation for horizontal polygons
    if (isElementFieldUnset(element, 'orientation360')) {
      updates.orientation360 = 0;
    }
  }

  // OnSiteGeneration: actual PV array dimensions from the sloped footprint.
  // First edge is the lowest edge / width; polygon plan depth is corrected by pitch for height.
  if (element.type === 'OnSiteGeneration') {
    const pitch = getElementNumber(element, 'pitch') || 0;
    const coords = element.coordinates;

    const pvDimensions = derivePvDimensionsFromCoords(coords, pitch);
    if (pvDimensions) {
      updates.width = roundToTwoDecimals(pvDimensions.width);
      updates.height = roundToTwoDecimals(pvDimensions.height);
    }

    // Area from polygon (already calculated above)
    // Set default pitch for horizontal polygons (0 = external face up)
    if (isElementFieldUnset(element, 'pitch')) {
      updates.pitch = 0;
    }

    // For sloped solar panels, derive orientation360 from the first edge (bottom edge), corrected
    // for SAP-style compass (see orientation360SlopedFromFirstEdge).
    if (pitch > 0 && element.coordinates.length >= 2) {
      const A = element.coordinates[0];
      const B = element.coordinates[1];
      const orientation360 = orientation360SlopedFromFirstEdge(
        A.x,
        A.y,
        B.x,
        B.y,
        globalOrientationOffset,
      );
      updates.orientation360 = roundToTwoDecimals(orientation360 ?? 0);
    } else if (
      isElementFieldUnset(element, 'orientation360')
    ) {
      // Flat or missing orientation: use neutral orientation
      updates.orientation360 = 0;
    }
  }

  return updates as Partial<Element>;
}

/**
 * Union of ground-floor polygons for "Merge Floors".
 *
 * The result must be a single closed ring with no holes, because `BuildingElementGround`
 * stores exactly one `coordinates` array. Anything else (rooms that do not touch, a union
 * that encloses a void) returns `null` so the caller leaves the rooms alone rather than
 * writing an approximate footprint into the model.
 *
 * Replaces a hand-written Greiner-Hormann implementation that dropped vertices on every
 * non-nested input — two overlapping 4x4 rooms reported 4 m2 instead of 24 — and fell back to
 * a convex hull that bridged real gaps.
 */
export function unionPolygons(
  polygons: Array<Array<{x: number, y: number, z: number}>>
): Array<{x: number, y: number, z: number}> | null {
  if (polygons.length === 0) return null;
  // Copy on the pass-through paths: the caller writes the result onto a new element, and
  // sharing a coordinates array with an existing one aliases two elements' geometry.
  if (polygons.length === 1) return ensureCounterClockwisePolygon(polygons[0]);

  const usable = polygons.filter((polygon) => polygon.length >= 3);
  if (usable.length === 0) return null;
  if (usable.length === 1) return ensureCounterClockwisePolygon(usable[0]);

  const z = usable[0][0]?.z ?? 0;
  const rings: Ring[] = usable.map((polygon) => polygon.map((point) => [point.x, point.y] as Pair));

  let merged: MultiPolygon;
  try {
    merged = polygonClipping.union(
      [rings[0]] as Polygon,
      ...rings.slice(1).map((ring) => [ring] as Polygon),
    );
  } catch (error) {
    console.warn('[polygonSync] Room union failed; leaving the rooms unmerged', error);
    return null;
  }

  // More than one polygon means the rooms are disjoint; more than one ring means a hole.
  if (merged.length !== 1) return null;
  const [outerRing, ...holes] = merged[0];
  if (holes.length > 0) return null;
  if (!outerRing || outerRing.length < 4) return null;

  // polygon-clipping closes rings by repeating the first point; the store keeps them open.
  const closed = outerRing.slice(0, -1);
  if (closed.length < 3) return null;

  return ensureCounterClockwisePolygon(closed.map(([x, y]) => ({ x, y, z })));
}
