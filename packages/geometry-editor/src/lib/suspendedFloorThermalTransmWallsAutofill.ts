// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { BuildingElementOpaque, Element } from '../geometry/types';
import { roundToTwoDecimals } from '../geometry/constants';
import { parseVulcanAssemblyV1FromExtraJson } from './assemblyAppliedUi';
import { effectiveFabricDisplayValues } from './multiSelectAssemblyApply';
import type { DefaultsLookup } from './defaultsCache';
import { GROUND_SLAB_PERIM_LINK_TOL_M } from './suspendedFloorGeometry';

const MIN_GROUND_BOUNDARY_OVERLAP_M = 0.01;
const PARALLEL_GROUND_BOUNDARY_CROSS_TOL = 0.08;

type PointXY = { x: number; y: number };
type SegmentXY = [PointXY, PointXY];

function readTopLevelOpaqueUValue(el: BuildingElementOpaque): number | null {
  const v = (el as { u_value?: unknown }).u_value;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  return null;
}

function isFinitePointXY(point: unknown): point is PointXY {
  return (
    !!point &&
    typeof point === 'object' &&
    typeof (point as PointXY).x === 'number' &&
    Number.isFinite((point as PointXY).x) &&
    typeof (point as PointXY).y === 'number' &&
    Number.isFinite((point as PointXY).y)
  );
}

function segmentLengthM(segment: SegmentXY): number {
  return Math.hypot(segment[1].x - segment[0].x, segment[1].y - segment[0].y);
}

function elementPlanSegmentsXY(
  element: Pick<Element, 'coordinates'>,
  closePolygon: boolean,
): SegmentXY[] {
  const coords = element.coordinates;
  if (!coords || coords.length < 2) return [];

  const points = coords.filter(isFinitePointXY).map((p) => ({ x: p.x, y: p.y }));
  if (points.length < 2) return [];

  const segments: SegmentXY[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const segment: SegmentXY = [points[i]!, points[i + 1]!];
    if (segmentLengthM(segment) > MIN_GROUND_BOUNDARY_OVERLAP_M) {
      segments.push(segment);
    }
  }

  if (closePolygon && points.length >= 3) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const closing: SegmentXY = [last, first];
    if (segmentLengthM(closing) > MIN_GROUND_BOUNDARY_OVERLAP_M) {
      segments.push(closing);
    }
  }

  return segments;
}

function overlapLengthOnBoundaryM(
  line: SegmentXY,
  boundary: SegmentXY,
  toleranceM: number,
): number {
  const [a, b] = line;
  const [edgeA, edgeB] = boundary;
  const edgeDx = edgeB.x - edgeA.x;
  const edgeDy = edgeB.y - edgeA.y;
  const edgeLen = Math.hypot(edgeDx, edgeDy);
  if (edgeLen <= MIN_GROUND_BOUNDARY_OVERLAP_M) return 0;

  const ux = edgeDx / edgeLen;
  const uy = edgeDy / edgeLen;
  const lineDx = b.x - a.x;
  const lineDy = b.y - a.y;
  const lineLen = Math.hypot(lineDx, lineDy);
  if (lineLen <= MIN_GROUND_BOUNDARY_OVERLAP_M) return 0;

  const vx = lineDx / lineLen;
  const vy = lineDy / lineLen;
  const parallelCross = Math.abs(ux * vy - uy * vx);
  if (parallelCross > PARALLEL_GROUND_BOUNDARY_CROSS_TOL) return 0;

  const signedDistanceA = ux * (a.y - edgeA.y) - uy * (a.x - edgeA.x);
  const signedDistanceB = ux * (b.y - edgeA.y) - uy * (b.x - edgeA.x);
  if (Math.abs(signedDistanceA) > toleranceM || Math.abs(signedDistanceB) > toleranceM) return 0;

  const tA = (a.x - edgeA.x) * ux + (a.y - edgeA.y) * uy;
  const tB = (b.x - edgeA.x) * ux + (b.y - edgeA.y) * uy;
  const start = Math.max(0, Math.min(tA, tB));
  const end = Math.min(edgeLen, Math.max(tA, tB));
  return Math.max(0, end - start);
}

function hasPositiveGroundBoundaryOverlap(
  candidate: Pick<Element, 'coordinates'>,
  groundElement: Pick<Element, 'coordinates'>,
): boolean {
  const groundEdges = elementPlanSegmentsXY(groundElement, true);
  if (groundEdges.length === 0) return false;

  const wallSegments = elementPlanSegmentsXY(candidate, candidate.coordinates.length > 2);
  if (wallSegments.length === 0) return false;

  for (const wallSegment of wallSegments) {
    for (const groundEdge of groundEdges) {
      if (
        overlapLengthOnBoundaryM(wallSegment, groundEdge, GROUND_SLAB_PERIM_LINK_TOL_M) >
        MIN_GROUND_BOUNDARY_OVERLAP_M
      ) {
        return true;
      }
    }
  }
  return false;
}

type ThermalTransmAutofillBasis =
  | 'top_level_u_value'
  | 'stored_fabric_u'
  | 'assembly'
  | 'project_default';

export interface SuspendedThermalTransmWallsAutofillSource {
  elementId: string;
  label: string;
  areaM2: number;
  uValue_W_m2K: number;
  basis: ThermalTransmAutofillBasis;
  basisLabel: string;
}

export interface SuspendedThermalTransmWallsAutofillResult {
  value_W_m2K: number | null;
  areaTotalM2: number;
  sources: SuspendedThermalTransmWallsAutofillSource[];
}

function elementStoreyKey(element: Pick<Element, 'floorId' | 'coordinates'>): string | null {
  if (typeof element.floorId === 'string' && element.floorId.trim() !== '') {
    return element.floorId.trim();
  }
  const z = element.coordinates?.[0]?.z;
  return typeof z === 'number' && Number.isFinite(z) ? String(Math.floor(z)) : null;
}

function readStoredFabricOpaqueUValue(el: BuildingElementOpaque): number | null {
  const extra = el.extra_json;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const value = (extra as Record<string, unknown>).u_value;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return null;
}

function resolveOpaqueWallUAutofillSource(
  element: Element,
  defaultsLookup?: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
): {
  uValue_W_m2K: number | null;
  basis: ThermalTransmAutofillBasis | null;
  basisLabel: string | null;
} {
  if (element.type !== 'BuildingElementOpaque') {
    return { uValue_W_m2K: null, basis: null, basisLabel: null };
  }

  const top = readTopLevelOpaqueUValue(element);
  if (top != null) {
    return {
      uValue_W_m2K: top,
      basis: 'top_level_u_value',
      basisLabel: 'wall U-value',
    };
  }

  const storedFabricU = readStoredFabricOpaqueUValue(element);
  if (storedFabricU != null) {
    return {
      uValue_W_m2K: storedFabricU,
      basis: 'stored_fabric_u',
      basisLabel: 'stored fabric U',
    };
  }

  const assembly = parseVulcanAssemblyV1FromExtraJson(element.extra_json);
  const assemblyU =
    typeof assembly?.correctedU_W_m2K === 'number' && Number.isFinite(assembly.correctedU_W_m2K)
      ? assembly.correctedU_W_m2K
      : typeof assembly?.uValueWrittenToElement_W_m2K === 'number' &&
          Number.isFinite(assembly.uValueWrittenToElement_W_m2K)
        ? assembly.uValueWrittenToElement_W_m2K
        : null;
  if (assemblyU != null && assemblyU > 0) {
    return {
      uValue_W_m2K: assemblyU,
      basis: 'assembly',
      basisLabel: 'assembly',
    };
  }

  const effective = effectiveFabricDisplayValues(element, defaultsLookup);
  if (effective.u != null && effective.u > 0 && effective.uIsDefault) {
    return {
      uValue_W_m2K: effective.u,
      basis: 'project_default',
      basisLabel: 'project default',
    };
  }

  return { uValue_W_m2K: null, basis: null, basisLabel: null };
}

/**
 * Effective U for suspended-floor `thermal_transm_walls` autofill: top-level `u_value` when set, otherwise
 * the same merged basis as the fabric table ({@link effectiveFabricDisplayValues}) — `extra_json.u_value`,
 * Vulcan assembly envelope when present, then project defaults for opaque walls.
 */
export function resolveOpaqueWallUValueForThermalTransmAutofill(
  element: Element,
  defaultsLookup?: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
): number | null {
  return resolveOpaqueWallUAutofillSource(element, defaultsLookup).uValue_W_m2K;
}

function isVerticalOpaqueWallInZone(
  candidate: Element,
  zoneId: string | undefined | null,
): candidate is BuildingElementOpaque {
  if (!zoneId) return false;
  if (candidate.type !== 'BuildingElementOpaque') return false;
  if (candidate.zoneId !== zoneId) return false;
  const pitch = candidate.pitch ?? 90;
  return Math.abs(pitch - 90) <= 10;
}

function isVerticalOpaqueWallAdjacentToGroundElement(
  candidate: Element,
  groundElement: Pick<Element, 'zoneId' | 'floorId' | 'coordinates'>,
): candidate is BuildingElementOpaque {
  if (!isVerticalOpaqueWallInZone(candidate, groundElement.zoneId)) return false;
  const groundStorey = elementStoreyKey(groundElement);
  const wallStorey = elementStoreyKey(candidate);
  if (groundStorey && wallStorey && groundStorey !== wallStorey) return false;
  return hasPositiveGroundBoundaryOverlap(candidate, groundElement);
}

export function hasSuspendedFloorThermalTransmWallsAutofillSources(
  elementsById: Record<string, Element>,
  zoneId: string | undefined | null,
): boolean {
  return computeSuspendedThermalTransmWallsAutofillResult(elementsById, zoneId).sources.length > 0;
}

export function hasSuspendedFloorThermalTransmWallsAutofillSourcesForGroundElement(
  elementsById: Record<string, Element>,
  groundElement: Pick<Element, 'zoneId' | 'floorId' | 'coordinates'> | null | undefined,
  defaultsLookup?: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
): boolean {
  return (
    computeSuspendedThermalTransmWallsAutofillResultForGroundElement(
      elementsById,
      groundElement,
      defaultsLookup,
    )
      .sources.length > 0
  );
}

export function computeSuspendedThermalTransmWallsAutofillResult(
  elementsById: Record<string, Element>,
  zoneId: string | undefined | null,
  defaultsLookup?: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
): SuspendedThermalTransmWallsAutofillResult {
  if (!zoneId) {
    return { value_W_m2K: null, areaTotalM2: 0, sources: [] };
  }

  const sources: SuspendedThermalTransmWallsAutofillSource[] = [];
  for (const candidate of Object.values(elementsById)) {
    if (!isVerticalOpaqueWallInZone(candidate, zoneId)) continue;
    const resolved = resolveOpaqueWallUAutofillSource(candidate, defaultsLookup);
    const area =
      typeof candidate.area === 'number' && Number.isFinite(candidate.area) && candidate.area > 0
        ? candidate.area
        : 0;
    if (
      resolved.uValue_W_m2K != null &&
      resolved.uValue_W_m2K > 0 &&
      area > 0 &&
      resolved.basis &&
      resolved.basisLabel
    ) {
      sources.push({
        elementId: candidate.id,
        label: candidate.name?.trim() || candidate.id,
        areaM2: area,
        uValue_W_m2K: resolved.uValue_W_m2K,
        basis: resolved.basis,
        basisLabel: resolved.basisLabel,
      });
    }
  }

  if (sources.length === 0) {
    return { value_W_m2K: null, areaTotalM2: 0, sources: [] };
  }

  const areaTotalM2 = sources.reduce((sum, row) => sum + row.areaM2, 0);
  if (!(areaTotalM2 > 0)) {
    return { value_W_m2K: null, areaTotalM2: 0, sources: [] };
  }

  const value_W_m2K = roundToTwoDecimals(
    sources.reduce((sum, row) => sum + row.uValue_W_m2K * row.areaM2, 0) / areaTotalM2,
  );

  return { value_W_m2K, areaTotalM2, sources };
}

export function computeSuspendedThermalTransmWallsAutofillResultForGroundElement(
  elementsById: Record<string, Element>,
  groundElement: Pick<Element, 'zoneId' | 'floorId' | 'coordinates'> | null | undefined,
  defaultsLookup?: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
): SuspendedThermalTransmWallsAutofillResult {
  if (!groundElement?.zoneId) {
    return { value_W_m2K: null, areaTotalM2: 0, sources: [] };
  }

  const sources: SuspendedThermalTransmWallsAutofillSource[] = [];
  for (const candidate of Object.values(elementsById)) {
    if (!isVerticalOpaqueWallAdjacentToGroundElement(candidate, groundElement)) continue;
    const resolved = resolveOpaqueWallUAutofillSource(candidate, defaultsLookup);
    const area =
      typeof candidate.area === 'number' && Number.isFinite(candidate.area) && candidate.area > 0
        ? candidate.area
        : 0;
    if (
      resolved.uValue_W_m2K != null &&
      resolved.uValue_W_m2K > 0 &&
      area > 0 &&
      resolved.basis &&
      resolved.basisLabel
    ) {
      sources.push({
        elementId: candidate.id,
        label: candidate.name?.trim() || candidate.id,
        areaM2: area,
        uValue_W_m2K: resolved.uValue_W_m2K,
        basis: resolved.basis,
        basisLabel: resolved.basisLabel,
      });
    }
  }

  if (sources.length === 0) {
    return { value_W_m2K: null, areaTotalM2: 0, sources: [] };
  }

  const areaTotalM2 = sources.reduce((sum, row) => sum + row.areaM2, 0);
  if (!(areaTotalM2 > 0)) {
    return { value_W_m2K: null, areaTotalM2: 0, sources: [] };
  }

  const value_W_m2K = roundToTwoDecimals(
    sources.reduce((sum, row) => sum + row.uValue_W_m2K * row.areaM2, 0) / areaTotalM2,
  );

  return { value_W_m2K, areaTotalM2, sources };
}

/** Area-weighted U from vertical opaque walls in the zone, or null if none qualify. */
export function computeWeightedThermalTransmWallsFromZoneExternalWalls(
  elementsById: Record<string, Element>,
  zoneId: string | undefined | null,
  defaultsLookup?: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
): number | null {
  return computeSuspendedThermalTransmWallsAutofillResult(elementsById, zoneId, defaultsLookup).value_W_m2K;
}

export function computeWeightedThermalTransmWallsFromGroundAdjacentWalls(
  elementsById: Record<string, Element>,
  groundElement: Pick<Element, 'zoneId' | 'floorId' | 'coordinates'> | null | undefined,
  defaultsLookup?: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
): number | null {
  return computeSuspendedThermalTransmWallsAutofillResultForGroundElement(
    elementsById,
    groundElement,
    defaultsLookup,
  )
    .value_W_m2K;
}
