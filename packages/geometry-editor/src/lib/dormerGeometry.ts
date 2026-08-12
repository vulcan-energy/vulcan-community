// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  BuildingElementOpaque,
  BuildingElementTransparent,
  Element,
  Floor,
} from '../geometry/types';
import { getOpaqueHostBaseElevationAlignedWith3D } from './geometry3dMapper';
import { normalizeOrientation360Deg, roundToTwoDecimals } from '../geometry/constants';
import { calculatePolygonArea } from './polygonSync';
import {
  computeSlopedPolygonInwardNormal2D,
  elevationAtSlopedVertexM,
} from './geometry3dSloped';
import { orientation360FromSegmentOutwardModelXY, orientation360SlopedFromFirstEdge } from './openingSegmentOutward';

export type DormerType = 'mono-pitch' | 'gable-front' | 'hip';
export type DormerBundleRole =
  | 'front-wall-anchor'
  | 'left-cheek-wall'
  | 'right-cheek-wall'
  | 'roof'
  | 'left-roof'
  | 'right-roof'
  | 'front-roof'
  | 'window';

export interface DormerPlacementDefaults {
  dormerWidth: number;
  dormerDepth: number;
  frontWallHeight: number;
  dormerRoofPitch: number;
  gableRoofPitch: number;
  windowWidth: number;
  windowHeight: number;
  windowSillHeight: number;
  frameAreaFraction: number;
  isUnheatedPitchedRoof: boolean;
}

export interface DormerPlanPoint {
  x: number;
  y: number;
}

export interface DormerHostBasis {
  uAxis: [number, number];
  vAxis: [number, number];
  eavesStart: [number, number];
  eavesEnd: [number, number];
}

export interface DormerCutoutParams {
  dormerType: DormerType;
  windowCenterPlanPoint: DormerPlanPoint;
  dormerWidth: number;
  dormerDepth: number;
}

export interface DormerBundleNames {
  frontWall: string;
  leftCheekWall: string;
  rightCheekWall: string;
  roofs: string[];
  window: string;
}

export interface DormerBundleMemberDraft {
  role: DormerBundleRole;
  name: string;
  type: 'BuildingElementOpaque' | 'BuildingElementTransparent';
  parent: string | null;
  updates: Partial<BuildingElementOpaque> | Partial<BuildingElementTransparent>;
}

export interface DormerBundleDraft {
  bundleId: string;
  bundleName: string;
  dormerType: DormerType;
  cutoutPolygon: Array<{ x: number; y: number; z: number }>;
  hostCutoutProjectedArea: number;
  hostCutoutSurfaceArea: number;
  names: DormerBundleNames;
  members: DormerBundleMemberDraft[];
  frontWall: Partial<BuildingElementOpaque>;
  leftCheekWall: Partial<BuildingElementOpaque>;
  rightCheekWall: Partial<BuildingElementOpaque>;
  roof: Partial<BuildingElementOpaque>;
  roofs: Array<{ role: DormerBundleRole; name: string; element: Partial<BuildingElementOpaque> }>;
  window: Partial<BuildingElementTransparent>;
}

export interface DormerBundleParameters extends DormerPlacementDefaults {
  dormerType: DormerType;
  windowCenterPlanPoint: DormerPlanPoint;
}

export type DormerThermalSectionKey =
  | 'front_wall'
  | 'cheek_walls'
  | 'roofs'
  | 'window';

export interface DormerThermalOverrides {
  front_wall?: Record<string, unknown>;
  cheek_walls?: Record<string, unknown>;
  roofs?: Record<string, unknown>;
  window?: Record<string, unknown>;
}

export interface DormerBundleInfo {
  kind: 'dormer';
  role: DormerBundleRole;
  bundle_id: string;
  bundle_name: string | null;
  host_element_name: string;
  anchor_name: string | null;
  roof_name: string | null;
  roof_names: string[] | null;
  window_name: string | null;
  cheek_wall_names: [string, string] | null;
  cutout_polygon: Array<{ x: number; y: number; z: number }>;
  host_cutout_projected_area: number;
  host_cutout_surface_area: number;
  parameters: Partial<DormerBundleParameters>;
  thermal_overrides: DormerThermalOverrides;
}

export interface DormerBundleMetadata extends DormerBundleParameters {
  kind: 'dormer';
  role: 'front-wall-anchor';
  bundle_id: string;
  bundle_name: string;
  host_element_name: string;
  roof_name: string;
  roof_names: string[];
  window_name: string;
  cheek_wall_names: [string, string];
  cutout_polygon: Array<{ x: number; y: number; z: number }>;
  host_cutout_projected_area: number;
  host_cutout_surface_area: number;
  thermal_overrides: DormerThermalOverrides;
}

export interface DormerResolvedGeometry {
  dormerType: DormerType;
  host: BuildingElementOpaque;
  hostBasis: DormerHostBasis;
  windowCenterPlanPoint: DormerPlanPoint;
  hostBaseElevationM: number;
  cutoutPolygon: Array<{ x: number; y: number; z: number }>;
  hostCutoutProjectedArea: number;
  hostCutoutSurfaceArea: number;
  frontLeft: { x: number; y: number; z: number };
  frontRight: { x: number; y: number; z: number };
  backRight: { x: number; y: number; z: number };
  backLeft: { x: number; y: number; z: number };
  frontBaseHeight: number;
  rearBaseHeight: number;
  frontWallHeight: number;
  roofFrontBaseHeight: number;
  dormerRoofPitch: number;
  gableRoofPitch: number;
  dormerWidth: number;
  dormerDepth: number;
  ridgeHeight: number;
  ridgeFront: { x: number; y: number; z: number } | null;
  ridgeBack: { x: number; y: number; z: number } | null;
  roofSideHeight: number;
  frontRoofPolygon: Array<{ x: number; y: number; z: number }>;
  leftRoofPolygon: Array<{ x: number; y: number; z: number }>;
  rightRoofPolygon: Array<{ x: number; y: number; z: number }>;
  leftRoofFacePoints: Array<{ x: number; y: number; z: number }>;
  rightRoofFacePoints: Array<{ x: number; y: number; z: number }>;
  windowWidth: number;
  windowHeight: number;
  windowSillHeight: number;
  frameAreaFraction: number;
  windowLine: Array<{ x: number; y: number; z: number }>;
  windowBaseHeight: number;
  backIntersectionLeft: { x: number; y: number; z: number; elevation: number };
  backIntersectionRight: { x: number; y: number; z: number; elevation: number };
  leftValleyPoint: { x: number; y: number; z: number; elevation: number };
  rightValleyPoint: { x: number; y: number; z: number; elevation: number };
}

const DORMER_PLACEMENT_DEFAULTS: DormerPlacementDefaults = {
  dormerWidth: 2.0,
  dormerDepth: 1.5,
  frontWallHeight: 1.2,
  dormerRoofPitch: 15,
  gableRoofPitch: 35,
  windowWidth: 1.2,
  windowHeight: 1.0,
  windowSillHeight: 0.6,
  frameAreaFraction: 0.25,
  isUnheatedPitchedRoof: false,
};

const MIN_FRONT_WALL_HEIGHT_M = 0.1;
const MIN_ROOF_RISE_M = 0.12;
const MIN_WINDOW_WIDTH_M = 0.25;
const MIN_WINDOW_HEIGHT_M = 0.25;
const MIN_WINDOW_SILL_M = 0.05;
const WINDOW_SIDE_CLEARANCE_M = 0.1;
const WINDOW_HEAD_CLEARANCE_M = 0.15;
const MIN_DORMER_DEPTH_M = 0.2;
const HIP_FRONT_RIDGE_RATIO = 0.35;

function generateUniqueName(baseName: string, existingNames: Set<string>): string {
  if (!existingNames.has(baseName)) {
    existingNames.add(baseName);
    return baseName;
  }

  let suffix = 2;
  let candidate = `${baseName} ${suffix}`;
  while (existingNames.has(candidate)) {
    suffix += 1;
    candidate = `${baseName} ${suffix}`;
  }
  existingNames.add(candidate);
  return candidate;
}

function generateUniqueIndexedName(baseName: string, existingNames: Set<string>): string {
  let suffix = 1;
  let candidate = `${baseName} ${suffix}`;
  while (existingNames.has(candidate)) {
    suffix += 1;
    candidate = `${baseName} ${suffix}`;
  }
  existingNames.add(candidate);
  return candidate;
}

function slugifyDormerType(dormerType: DormerType): string {
  return dormerType.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundToThreeDecimals(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const DORMER_STRUCTURAL_EXTRA_JSON_KEYS = new Set(['dormer_bundle', 'geometry_face', 'parent_netting_area']);

function sanitizeDormerThermalExtraJson(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const cleaned = Object.fromEntries(
    Object.entries(record).filter(([key, entryValue]) => {
      if (DORMER_STRUCTURAL_EXTRA_JSON_KEYS.has(key)) return false;
      return entryValue !== undefined;
    }),
  );
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function parseDormerThermalOverrides(value: unknown): DormerThermalOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  return {
    front_wall: sanitizeDormerThermalExtraJson(record.front_wall),
    cheek_walls: sanitizeDormerThermalExtraJson(record.cheek_walls),
    roofs: sanitizeDormerThermalExtraJson(record.roofs),
    window: sanitizeDormerThermalExtraJson(record.window),
  };
}

function mergeDormerStructuralAndThermalExtraJson(
  structural: Record<string, unknown>,
  thermalOverride?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...thermalOverride,
    ...structural,
  };
}

export function getDormerThermalOverrideExtraJson(
  extraJson: Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined {
  return sanitizeDormerThermalExtraJson(extraJson);
}

function calculatePlanarFaceArea3D(points: Array<{ x: number; y: number; z: number }>): number {
  if (points.length < 3) return 0;
  const origin = points[0];
  let area = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const ab = { x: a.x - origin.x, y: a.y - origin.y, z: a.z - origin.z };
    const ac = { x: b.x - origin.x, y: b.y - origin.y, z: b.z - origin.z };
    const cross = {
      x: ab.y * ac.z - ab.z * ac.y,
      y: ab.z * ac.x - ab.x * ac.z,
      z: ab.x * ac.y - ab.y * ac.x,
    };
    area += 0.5 * Math.hypot(cross.x, cross.y, cross.z);
  }
  return roundToThreeDecimals(area);
}

type DormerLinePoint = { x: number; y: number; z: number };

type ProfilePoint = { t: number; h: number };

type ProfiledLineFaceGeometry = {
  kind: 'profiled-line-face';
  top_profile: ProfilePoint[];
  bottom_profile: ProfilePoint[];
};

type PlanarFace3DGeometry = {
  kind: 'planar-face-3d';
  points: Array<{ x: number; y: number; z: number }>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function cross2D(a: [number, number], b: [number, number]): number {
  return a[0] * b[1] - a[1] * b[0];
}

function getDormerInteriorPlanPoint(resolved: DormerResolvedGeometry): DormerPlanPoint {
  const [vx, vy] = resolved.hostBasis.vAxis;
  return {
    x: resolved.windowCenterPlanPoint.x + vx * (resolved.dormerDepth / 2),
    y: resolved.windowCenterPlanPoint.y + vy * (resolved.dormerDepth / 2),
  };
}

function shouldFlipSegmentAwayFromInterior(
  coordinates: [DormerLinePoint, DormerLinePoint],
  interiorPoint: DormerPlanPoint,
): boolean {
  const [start, end] = coordinates;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return false;

  const centerX = (start.x + end.x) / 2;
  const centerY = (start.y + end.y) / 2;
  const outwardX = dy / length;
  const outwardY = -dx / length;
  const toInteriorX = interiorPoint.x - centerX;
  const toInteriorY = interiorPoint.y - centerY;

  return (outwardX * toInteriorX) + (outwardY * toInteriorY) > 0;
}

/** Same convention as {@link deriveWallProperties} for 2-point walls (math wall direction minus global offset). */
function deriveOrientationFromLine(
  coordinates: [DormerLinePoint, DormerLinePoint],
  globalOrientationOffset: number,
): number {
  const [start, end] = coordinates;
  const outward = orientation360FromSegmentOutwardModelXY(start.x, start.y, end.x, end.y, 0);
  const orientation360 = normalizeOrientation360Deg((outward ?? 0) - globalOrientationOffset);
  return roundToTwoDecimals(orientation360);
}

/** Sloped roof faces: same as sloped PV / {@link polygonSync} (uses global orientation offset). */
function deriveOrientationFromSegmentOutwardNormal(
  points: DormerLinePoint[],
  globalOrientationOffset: number,
): number {
  if (points.length < 2) return 0;
  const [start, end] = points;
  const o = orientation360SlopedFromFirstEdge(
    start.x,
    start.y,
    end.x,
    end.y,
    globalOrientationOffset,
  );
  return roundToTwoDecimals(o ?? 0);
}

function reverseProfilePoints(points: ProfilePoint[]): ProfilePoint[] {
  return points
    .map((point) => ({ t: 1 - point.t, h: point.h }))
    .reverse();
}

function reverseProfiledLineFaceGeometry(
  geometry: ProfiledLineFaceGeometry,
): ProfiledLineFaceGeometry {
  return {
    kind: 'profiled-line-face',
    top_profile: reverseProfilePoints(geometry.top_profile),
    bottom_profile: reverseProfilePoints(geometry.bottom_profile),
  };
}

function canonicalizeDormerSegment(
  coordinates: [DormerLinePoint, DormerLinePoint],
  interiorPoint: DormerPlanPoint,
  globalOrientationOffset: number,
  geometryFace?: ProfiledLineFaceGeometry,
): {
  coordinates: [DormerLinePoint, DormerLinePoint];
  orientation360: number;
  geometryFace?: ProfiledLineFaceGeometry;
} {
  const shouldFlip = shouldFlipSegmentAwayFromInterior(coordinates, interiorPoint);
  const nextCoordinates = shouldFlip
    ? [coordinates[1], coordinates[0]] as [DormerLinePoint, DormerLinePoint]
    : coordinates;

  return {
    coordinates: nextCoordinates,
    orientation360: deriveOrientationFromLine(nextCoordinates, globalOrientationOffset),
    geometryFace: geometryFace
      ? (shouldFlip ? reverseProfiledLineFaceGeometry(geometryFace) : geometryFace)
      : undefined,
  };
}

function pointsMatch(
  left: DormerLinePoint,
  right: DormerLinePoint,
): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function buildDormerCheekFaceGeometry(
  coordinates: [DormerLinePoint, DormerLinePoint],
  frontPoint: DormerLinePoint,
  frontBaseElevation: number,
  frontTopElevation: number,
  cheekEndElevation: number,
): PlanarFace3DGeometry {
  const [first, second] = coordinates;
  const firstIsFront = pointsMatch(first, frontPoint);
  const front = firstIsFront ? first : second;
  const cheekEnd = firstIsFront ? second : first;
  const frontBottom = { x: front.x, y: front.y, z: frontBaseElevation };
  const frontTop = { x: front.x, y: front.y, z: frontTopElevation };
  const apex = { x: cheekEnd.x, y: cheekEnd.y, z: cheekEndElevation };

  return {
    kind: 'planar-face-3d',
    points: firstIsFront
      ? [frontBottom, frontTop, apex]
      : [apex, frontBottom, frontTop],
  };
}

function reversePolygonKeepingLeadEdge<T>(points: T[]): T[] {
  if (points.length < 2) return points.slice();
  return [points[1], points[0], ...points.slice(2).reverse()];
}

function offsetPointAlongAxis(
  point: DormerLinePoint,
  axis: [number, number],
  distance: number,
): DormerLinePoint {
  return {
    x: point.x + axis[0] * distance,
    y: point.y + axis[1] * distance,
    z: point.z,
  };
}

function canonicalizeDormerPolygonLeadEdge<T extends DormerLinePoint>(
  points: T[],
  interiorPoint: DormerPlanPoint,
): T[] {
  if (points.length < 2) return points.slice();
  const leadEdge: [DormerLinePoint, DormerLinePoint] = [points[0], points[1]];
  return shouldFlipSegmentAwayFromInterior(leadEdge, interiorPoint)
    ? reversePolygonKeepingLeadEdge(points)
    : points.slice();
}

function distanceAlongDirectionToPolygonBoundary(
  origin: [number, number],
  direction: [number, number],
  polygon: Array<[number, number]>,
): number | null {
  if (polygon.length < 3) return null;
  let best: number | null = null;

  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const segment: [number, number] = [b[0] - a[0], b[1] - a[1]];
    const delta: [number, number] = [a[0] - origin[0], a[1] - origin[1]];
    const denom = cross2D(direction, segment);
    if (Math.abs(denom) < 1e-9) continue;

    const t = cross2D(delta, segment) / denom;
    const u = cross2D(delta, direction) / denom;
    if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) {
      if (best === null || t < best) best = t;
    }
  }

  return best;
}

function buildDormerBundleNames(
  existingNames: Set<string>,
  hostName: string,
  dormerType: DormerType,
): DormerBundleNames {
  const hostLabel = hostName.trim() || 'Dormer';
  const typeLabel =
    dormerType === 'gable-front' ? 'Gable Dormer' : dormerType === 'hip' ? 'Hip Dormer' : 'Dormer';
  const roofNames =
    dormerType === 'mono-pitch'
      ? [generateUniqueName(`${hostLabel} ${typeLabel} Roof`, existingNames)]
      : dormerType === 'gable-front'
        ? [
            generateUniqueName(`${hostLabel} ${typeLabel} Left Roof`, existingNames),
            generateUniqueName(`${hostLabel} ${typeLabel} Right Roof`, existingNames),
          ]
        : [
            generateUniqueName(`${hostLabel} ${typeLabel} Front Roof`, existingNames),
            generateUniqueName(`${hostLabel} ${typeLabel} Left Roof`, existingNames),
            generateUniqueName(`${hostLabel} ${typeLabel} Right Roof`, existingNames),
          ];

  return {
    frontWall: generateUniqueName(`${hostLabel} ${typeLabel} Front Wall`, existingNames),
    leftCheekWall: generateUniqueName(`${hostLabel} ${typeLabel} Left Cheek`, existingNames),
    rightCheekWall: generateUniqueName(`${hostLabel} ${typeLabel} Right Cheek`, existingNames),
    roofs: roofNames,
    window: generateUniqueName(`${hostLabel} ${typeLabel} Window`, existingNames),
  };
}

function buildDormerBundleDisplayName(
  existingBundleNames: Set<string>,
  hostName: string,
): string {
  const hostLabel = hostName.trim() || 'Dormer';
  return generateUniqueIndexedName(`${hostLabel} Dormer`, existingBundleNames);
}

function getHostPlanPoints(host: BuildingElementOpaque): Array<[number, number]> {
  return host.coordinates.map(({ x, y }) => [x, y]);
}

function normalize2D(x: number, y: number): [number, number] | null {
  const len = Math.hypot(x, y);
  if (len < 1e-9) return null;
  return [x / len, y / len];
}

function parseDormerParameters(raw: unknown): Partial<DormerBundleParameters> {
  if (!raw || typeof raw !== 'object') return {};
  const params = raw as Record<string, unknown>;
  const windowCenterPlanPoint =
    params.windowCenterPlanPoint &&
    typeof params.windowCenterPlanPoint === 'object' &&
    isFiniteNumber((params.windowCenterPlanPoint as Record<string, unknown>).x) &&
    isFiniteNumber((params.windowCenterPlanPoint as Record<string, unknown>).y)
      ? {
          x: (params.windowCenterPlanPoint as Record<string, number>).x,
          y: (params.windowCenterPlanPoint as Record<string, number>).y,
        }
      : undefined;

  return {
    dormerType:
      params.dormerType === 'gable-front' || params.dormerType === 'hip' || params.dormerType === 'mono-pitch'
        ? params.dormerType
        : undefined,
    windowCenterPlanPoint,
    dormerWidth: isFiniteNumber(params.dormerWidth) ? params.dormerWidth : undefined,
    dormerDepth: isFiniteNumber(params.dormerDepth) ? params.dormerDepth : undefined,
    frontWallHeight: isFiniteNumber(params.frontWallHeight) ? params.frontWallHeight : undefined,
    dormerRoofPitch: isFiniteNumber(params.dormerRoofPitch) ? params.dormerRoofPitch : undefined,
    gableRoofPitch: isFiniteNumber(params.gableRoofPitch) ? params.gableRoofPitch : undefined,
    windowWidth: isFiniteNumber(params.windowWidth) ? params.windowWidth : undefined,
    windowHeight: isFiniteNumber(params.windowHeight) ? params.windowHeight : undefined,
    windowSillHeight: isFiniteNumber(params.windowSillHeight) ? params.windowSillHeight : undefined,
    frameAreaFraction: isFiniteNumber(params.frameAreaFraction) ? params.frameAreaFraction : undefined,
    isUnheatedPitchedRoof:
      typeof params.isUnheatedPitchedRoof === 'boolean'
        ? params.isUnheatedPitchedRoof
        : undefined,
  };
}

function parseDormerPolygon(raw: unknown): Array<{ x: number; y: number; z: number }> {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (point): point is { x: number; y: number; z: number } =>
      !!point &&
      typeof point === 'object' &&
      isFiniteNumber((point as Record<string, unknown>).x) &&
      isFiniteNumber((point as Record<string, unknown>).y) &&
      isFiniteNumber((point as Record<string, unknown>).z),
  );
}

export function getDormerPlacementDefaults(): DormerPlacementDefaults {
  return { ...DORMER_PLACEMENT_DEFAULTS };
}

/**
 * Plan cutout for dormer draw-mode hover preview: same inputs as a click placement (mono-pitch, default
 * dimensions, host base elevation from `floors`). Returns null when geometry cannot be resolved.
 */
export function getDormerDrawPreviewCutoutPolygon(
  host: BuildingElementOpaque,
  windowCenterPlanPoint: DormerPlanPoint,
  floors: Floor[] = [],
): Array<{ x: number; y: number; z: number }> | null {
  const resolved = resolveDormerGeometry({
    host,
    dormerType: 'mono-pitch',
    windowCenterPlanPoint,
    placementDefaults: getDormerPlacementDefaults(),
    hostBaseElevationM: getDormerHostBaseElevationM(host, floors),
  });
  if (!resolved?.cutoutPolygon?.length) return null;
  return resolved.cutoutPolygon;
}

/**
 * Reference elevation (m) at the host eaves / bottom edge of the sloped plane — same rules as the 3D
 * preview for that opaque. Callers pass the current host + floors whenever the host’s `base_height`,
 * name (roof-like), or storey binding changes so dormer solids stay aligned with the host surface.
 */
export function getDormerHostBaseElevationM(host: BuildingElementOpaque, floors: Floor[] = []): number {
  return getOpaqueHostBaseElevationAlignedWith3D(host, floors);
}

export function getDormerBundleInfo(element: Element | null | undefined): DormerBundleInfo | null {
  const raw = element?.extra_json?.dormer_bundle;
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record.kind !== 'dormer') return null;
  if (typeof record.bundle_id !== 'string' || typeof record.host_element_name !== 'string') return null;

  const role = record.role;
  if (
    role !== 'front-wall-anchor' &&
    role !== 'left-cheek-wall' &&
    role !== 'right-cheek-wall' &&
    role !== 'roof' &&
    role !== 'left-roof' &&
    role !== 'right-roof' &&
    role !== 'front-roof' &&
    role !== 'window'
  ) {
    return null;
  }

  const cheekNames =
    Array.isArray(record.cheek_wall_names) &&
    record.cheek_wall_names.length === 2 &&
    typeof record.cheek_wall_names[0] === 'string' &&
    typeof record.cheek_wall_names[1] === 'string'
      ? [record.cheek_wall_names[0], record.cheek_wall_names[1]] as [string, string]
      : null;
  const roofNames =
    Array.isArray(record.roof_names) && record.roof_names.every((name) => typeof name === 'string')
      ? record.roof_names as string[]
      : typeof record.roof_name === 'string'
        ? [record.roof_name]
        : null;

  return {
    kind: 'dormer',
    role,
    bundle_id: record.bundle_id,
    bundle_name: typeof record.bundle_name === 'string' ? record.bundle_name : null,
    host_element_name: record.host_element_name,
    anchor_name: typeof record.anchor_name === 'string' ? record.anchor_name : null,
    roof_name: typeof record.roof_name === 'string' ? record.roof_name : roofNames?.[0] ?? null,
    roof_names: roofNames,
    window_name: typeof record.window_name === 'string' ? record.window_name : null,
    cheek_wall_names: cheekNames,
    cutout_polygon: parseDormerPolygon(record.cutout_polygon),
    host_cutout_projected_area: isFiniteNumber(record.host_cutout_projected_area)
      ? record.host_cutout_projected_area
      : 0,
    host_cutout_surface_area: isFiniteNumber(record.host_cutout_surface_area)
      ? record.host_cutout_surface_area
      : isFiniteNumber(record.host_cutout_projected_area)
        ? record.host_cutout_projected_area
        : 0,
    parameters: parseDormerParameters(record.parameters),
    thermal_overrides: parseDormerThermalOverrides(record.thermal_overrides),
  };
}

export function getDormerAnchorName(element: Element | null | undefined): string | null {
  const bundleInfo = getDormerBundleInfo(element);
  if (!bundleInfo) return null;
  if (bundleInfo.role === 'front-wall-anchor') return element?.name?.trim() || null;
  return bundleInfo.anchor_name?.trim() || null;
}

export function getDormerBundleName(element: Element | null | undefined): string | null {
  const bundleInfo = getDormerBundleInfo(element);
  if (!bundleInfo) return null;

  const explicitName = bundleInfo.bundle_name?.trim();
  if (explicitName) return explicitName;

  const anchorName = getDormerAnchorName(element)?.trim();
  if (anchorName) return anchorName;

  const hostLabel = bundleInfo.host_element_name.trim() || 'Dormer';
  return `${hostLabel} Dormer`;
}

// Whether `name` matches the auto-generated dormer bundle pattern for `hostName`:
// either the bare "<host> Dormer" fallback or the indexed "<host> Dormer N".
export function looksLikeAutoDormerBundleName(name: string, hostName: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const hostLabel = hostName.trim() || 'Dormer';
  const base = `${hostLabel} Dormer`;
  if (trimmed === base) return true;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped} \\d+$`).test(trimmed);
}

// Dormers have no `_nameAutoSync` flag (every bundle stores an explicit name), so
// auto-vs-manual is inferred from the name pattern, mirroring element naming.
export function isDormerBundleNameManual(element: Element | null | undefined): boolean {
  const bundleInfo = getDormerBundleInfo(element);
  if (!bundleInfo) return false;
  const name = getDormerBundleName(element);
  if (!name) return false;
  return !looksLikeAutoDormerBundleName(name, bundleInfo.host_element_name);
}

// The canonical automatic bundle name for `element`'s dormer, with a unique index
// allocated against the names of all *other* dormer bundles in the model.
export function computeAutoDormerBundleName(
  element: Element | null | undefined,
  elementsById: Record<string, Element>,
): string | null {
  const bundleInfo = getDormerBundleInfo(element);
  if (!bundleInfo) return null;
  const otherBundleNames = new Set<string>();
  for (const candidate of Object.values(elementsById)) {
    const candidateInfo = getDormerBundleInfo(candidate);
    if (!candidateInfo || candidateInfo.role !== 'front-wall-anchor') continue;
    if (candidateInfo.bundle_id === bundleInfo.bundle_id) continue;
    const candidateName = getDormerBundleName(candidate);
    if (candidateName) otherBundleNames.add(candidateName);
  }
  return buildDormerBundleDisplayName(otherBundleNames, bundleInfo.host_element_name);
}

export function getDormerBundleElementIds(
  elementsById: Record<string, Element>,
  bundleId: string,
): string[] {
  return Object.values(elementsById)
    .filter((element) => getDormerBundleInfo(element)?.bundle_id === bundleId)
    .map((element) => element.id);
}

export function getDormerBundleAnchorElement(
  elementsById: Record<string, Element>,
  bundleId: string,
): Element | null {
  const members = Object.values(elementsById).filter(
    (element) => getDormerBundleInfo(element)?.bundle_id === bundleId,
  );
  if (members.length === 0) return null;

  return (
    members.find((element) => getDormerBundleInfo(element)?.role === 'front-wall-anchor') ??
    members.find((element) => {
      const anchorName = getDormerAnchorName(element);
      return !!anchorName && element.name === anchorName;
    }) ??
    members[0] ??
    null
  );
}

export function getDormerBundleMetadata(element: Element | null | undefined): DormerBundleMetadata | null {
  const bundleInfo = getDormerBundleInfo(element);
  if (!bundleInfo || bundleInfo.role !== 'front-wall-anchor') return null;
  if (!bundleInfo.roof_name || !bundleInfo.roof_names?.length || !bundleInfo.window_name || !bundleInfo.cheek_wall_names) {
    return null;
  }

  const params = bundleInfo.parameters;
  if (
    !params.dormerType ||
    !params.windowCenterPlanPoint ||
    !isFiniteNumber(params.dormerWidth) ||
    !isFiniteNumber(params.dormerDepth) ||
    !isFiniteNumber(params.frontWallHeight) ||
    !isFiniteNumber(params.dormerRoofPitch) ||
    !isFiniteNumber(params.windowWidth) ||
    !isFiniteNumber(params.windowHeight) ||
    !isFiniteNumber(params.windowSillHeight) ||
    !isFiniteNumber(params.frameAreaFraction)
  ) {
    return null;
  }

  return {
    kind: 'dormer',
    role: 'front-wall-anchor',
    bundle_id: bundleInfo.bundle_id,
    bundle_name: getDormerBundleName(element) ?? element?.name?.trim() ?? 'Dormer',
    host_element_name: bundleInfo.host_element_name,
    roof_name: bundleInfo.roof_name,
    roof_names: bundleInfo.roof_names,
    window_name: bundleInfo.window_name,
    cheek_wall_names: bundleInfo.cheek_wall_names,
    cutout_polygon: bundleInfo.cutout_polygon,
    host_cutout_projected_area: bundleInfo.host_cutout_projected_area,
    host_cutout_surface_area: bundleInfo.host_cutout_surface_area,
    thermal_overrides: bundleInfo.thermal_overrides,
    dormerType: params.dormerType,
    windowCenterPlanPoint: params.windowCenterPlanPoint,
    dormerWidth: params.dormerWidth,
    dormerDepth: params.dormerDepth,
    frontWallHeight: params.frontWallHeight,
    dormerRoofPitch: params.dormerRoofPitch,
    gableRoofPitch: isFiniteNumber(params.gableRoofPitch)
      ? params.gableRoofPitch
      : DORMER_PLACEMENT_DEFAULTS.gableRoofPitch,
    windowWidth: params.windowWidth,
    windowHeight: params.windowHeight,
    windowSillHeight: params.windowSillHeight,
    frameAreaFraction: params.frameAreaFraction,
    isUnheatedPitchedRoof: params.isUnheatedPitchedRoof ?? false,
  };
}

export function isDormerAnchorElement(element: Element | null | undefined): element is BuildingElementOpaque {
  return element?.type === 'BuildingElementOpaque' && getDormerBundleMetadata(element) !== null;
}

export function isValidDormerHost(element: Element): element is BuildingElementOpaque {
  if (element.type !== 'BuildingElementOpaque') return false;
  if (!Array.isArray(element.coordinates) || element.coordinates.length < 3) return false;
  const pitch = element.pitch;
  if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch <= 0 || pitch >= 90) return false;

  const pts = getHostPlanPoints(element);
  const eavesStart = pts[0];
  const eavesEnd = pts[1];
  if (!eavesStart || !eavesEnd) return false;
  if (!normalize2D(eavesEnd[0] - eavesStart[0], eavesEnd[1] - eavesStart[1])) return false;

  return computeSlopedPolygonInwardNormal2D(pts) !== null;
}

export function deriveDormerHostBasis(host: BuildingElementOpaque): DormerHostBasis | null {
  if (!isValidDormerHost(host)) return null;

  const pts = getHostPlanPoints(host);
  const [ax, ay] = pts[0];
  const [bx, by] = pts[1];
  const uAxis = normalize2D(bx - ax, by - ay);
  const vAxis = computeSlopedPolygonInwardNormal2D(pts);

  if (!uAxis || !vAxis) return null;

  return {
    uAxis,
    vAxis,
    eavesStart: [ax, ay],
    eavesEnd: [bx, by],
  };
}

export function buildDormerCutoutPolygon(
  host: BuildingElementOpaque,
  params: DormerCutoutParams,
): Array<{ x: number; y: number; z: number }> | null {
  const basis = deriveDormerHostBasis(host);
  if (!basis) return null;

  const { windowCenterPlanPoint, dormerWidth, dormerDepth } = params;
  if (!(dormerWidth > 0) || !(dormerDepth > 0)) return null;

  const [ux, uy] = basis.uAxis;
  const [vx, vy] = basis.vAxis;
  const halfWidth = dormerWidth / 2;
  const z = host.coordinates[0]?.z ?? 0;

  const frontLeft = {
    x: windowCenterPlanPoint.x - ux * halfWidth,
    y: windowCenterPlanPoint.y - uy * halfWidth,
    z,
  };
  const frontRight = {
    x: windowCenterPlanPoint.x + ux * halfWidth,
    y: windowCenterPlanPoint.y + uy * halfWidth,
    z,
  };
  const backRight = {
    x: frontRight.x + vx * dormerDepth,
    y: frontRight.y + vy * dormerDepth,
    z,
  };
  const backLeft = {
    x: frontLeft.x + vx * dormerDepth,
    y: frontLeft.y + vy * dormerDepth,
    z,
  };

  return [frontLeft, frontRight, backRight, backLeft];
}

export function getDormerCutoutProjectedArea(
  polygon: Array<{ x: number; y: number; z: number }>,
): number {
  return calculatePolygonArea(polygon);
}

export function getDormerCutoutSurfaceArea(
  host: BuildingElementOpaque,
  polygon: Array<{ x: number; y: number; z: number }>,
): number {
  if (polygon.length < 3) return 0;
  const hostBasis = deriveDormerHostBasis(host);
  const hostPitch = host.pitch;
  if (!hostBasis || !isFiniteNumber(hostPitch) || hostPitch <= 0 || hostPitch >= 90) {
    return getDormerCutoutProjectedArea(polygon);
  }

  const liftedCutout = polygon.map((point) => ({
    x: point.x,
    y: point.y,
    z: elevationAtSlopedVertexM(
      [point.x, point.y],
      hostBasis.eavesStart,
      hostBasis.vAxis,
      0,
      hostPitch,
    ),
  }));

  return roundToThreeDecimals(calculatePlanarFaceArea3D(liftedCutout));
}

export function resolveDormerGeometry(params: {
  host: BuildingElementOpaque;
  dormerType: DormerType;
  windowCenterPlanPoint: DormerPlanPoint;
  placementDefaults?: Partial<DormerPlacementDefaults>;
  hostBaseElevationM?: number;
}): DormerResolvedGeometry | null {
  const {
    host,
    dormerType,
    windowCenterPlanPoint,
    placementDefaults = {},
    hostBaseElevationM,
  } = params;

  const requested: DormerPlacementDefaults = {
    ...DORMER_PLACEMENT_DEFAULTS,
    ...placementDefaults,
  };

  const hostBasis = deriveDormerHostBasis(host);
  if (!hostBasis) return null;

  const dormerWidth = Math.max(0.2, requested.dormerWidth);
  const [ux, uy] = hostBasis.uAxis;
  const [vx, vy] = hostBasis.vAxis;
  const halfWidth = dormerWidth / 2;
  const z = host.coordinates[0]?.z ?? 0;
  const frontLeft = {
    x: windowCenterPlanPoint.x - ux * halfWidth,
    y: windowCenterPlanPoint.y - uy * halfWidth,
    z,
  };
  const frontRight = {
    x: windowCenterPlanPoint.x + ux * halfWidth,
    y: windowCenterPlanPoint.y + uy * halfWidth,
    z,
  };

  const resolvedHostBaseElevationM = isFiniteNumber(hostBaseElevationM)
    ? hostBaseElevationM
    : getDormerHostBaseElevationM(host);
  const hostPitchDeg = isFiniteNumber(host.pitch) ? host.pitch : 0;
  if (hostPitchDeg <= 0.5) return null;
  const frontBaseHeight = elevationAtSlopedVertexM(
    [frontLeft.x, frontLeft.y],
    hostBasis.eavesStart,
    hostBasis.vAxis,
    resolvedHostBaseElevationM,
    hostPitchDeg,
  );
  const hostPlanPoints = getHostPlanPoints(host);
  const availableDepthLeft = distanceAlongDirectionToPolygonBoundary(
    [frontLeft.x, frontLeft.y],
    hostBasis.vAxis,
    hostPlanPoints,
  );
  const availableDepthRight = distanceAlongDirectionToPolygonBoundary(
    [frontRight.x, frontRight.y],
    hostBasis.vAxis,
    hostPlanPoints,
  );
  const maxAvailableDepth = Math.min(
    availableDepthLeft ?? Number.POSITIVE_INFINITY,
    availableDepthRight ?? Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(maxAvailableDepth) || maxAvailableDepth <= MIN_DORMER_DEPTH_M) return null;

  const desiredDormerRoofPitch = clamp(requested.dormerRoofPitch, 0, Math.max(0, hostPitchDeg - 0.5));
  const desiredGableRoofPitch = clamp(requested.gableRoofPitch, 5, 85);
  const hostPitchTan = Math.tan((hostPitchDeg * Math.PI) / 180);
  const requestedFrontWallHeight = Math.max(MIN_FRONT_WALL_HEIGHT_M, requested.frontWallHeight);
  const frontCenter = {
    x: windowCenterPlanPoint.x,
    y: windowCenterPlanPoint.y,
    z,
  };

  let dormerDepth = MIN_DORMER_DEPTH_M;
  let roofFrontBaseHeight = frontBaseHeight + requestedFrontWallHeight;
  let frontWallHeight = requestedFrontWallHeight;
  let dormerRoofPitch = roundToThreeDecimals(desiredDormerRoofPitch);
  let gableRoofPitch = roundToThreeDecimals(desiredGableRoofPitch);

  if (dormerType === 'mono-pitch') {
    const dormerPitchTan = Math.tan((desiredDormerRoofPitch * Math.PI) / 180);
    const pitchGap = hostPitchTan - dormerPitchTan;
    if (pitchGap <= 1e-6) return null;
    const requestedDepthFromPitch = requestedFrontWallHeight / pitchGap;
    dormerDepth = clamp(requestedDepthFromPitch, MIN_DORMER_DEPTH_M, maxAvailableDepth);
  } else {
    const gableRise = Math.tan((desiredGableRoofPitch * Math.PI) / 180) * (dormerWidth / 2);
    const targetRidgeHeight = frontBaseHeight + requestedFrontWallHeight + gableRise;
    const requestedDepthFromRidge = (targetRidgeHeight - frontBaseHeight) / hostPitchTan;
    dormerDepth = clamp(requestedDepthFromRidge, MIN_DORMER_DEPTH_M, maxAvailableDepth);
  }

  const backRight = {
    x: frontRight.x + vx * dormerDepth,
    y: frontRight.y + vy * dormerDepth,
    z,
  };
  const backLeft = {
    x: frontLeft.x + vx * dormerDepth,
    y: frontLeft.y + vy * dormerDepth,
    z,
  };
  const rearBaseHeight = elevationAtSlopedVertexM(
    [backLeft.x, backLeft.y],
    hostBasis.eavesStart,
    hostBasis.vAxis,
    resolvedHostBaseElevationM,
    hostPitchDeg,
  );
  const backCenter = {
    x: frontCenter.x + vx * dormerDepth,
    y: frontCenter.y + vy * dormerDepth,
    z,
  };
  const valleyDepth = clamp(frontWallHeight / hostPitchTan, 0, dormerDepth);
  const leftValleyPlanPoint = offsetPointAlongAxis(frontLeft, hostBasis.vAxis, valleyDepth);
  const rightValleyPlanPoint = offsetPointAlongAxis(frontRight, hostBasis.vAxis, valleyDepth);
  const valleyElevation = elevationAtSlopedVertexM(
    [leftValleyPlanPoint.x, leftValleyPlanPoint.y],
    hostBasis.eavesStart,
    hostBasis.vAxis,
    resolvedHostBaseElevationM,
    hostPitchDeg,
  );
  const leftValleyPoint = {
    ...leftValleyPlanPoint,
    elevation: roundToThreeDecimals(valleyElevation),
  };
  const rightValleyPoint = {
    ...rightValleyPlanPoint,
    elevation: roundToThreeDecimals(valleyElevation),
  };
  const cutoutPolygon =
    dormerType === 'mono-pitch'
      ? [frontLeft, frontRight, backRight, backLeft]
      : [frontLeft, frontRight, rightValleyPlanPoint, backCenter, leftValleyPlanPoint];

  let ridgeHeight = rearBaseHeight;
  let ridgeFront: { x: number; y: number; z: number } | null = null;
  let ridgeBack: { x: number; y: number; z: number } | null = null;
  let roofSideHeight = 0;
  let frontRoofPolygon: Array<{ x: number; y: number; z: number }> = [];
  let leftRoofPolygon: Array<{ x: number; y: number; z: number }> = [];
  let rightRoofPolygon: Array<{ x: number; y: number; z: number }> = [];
  let leftRoofFacePoints: Array<{ x: number; y: number; z: number }> = [];
  let rightRoofFacePoints: Array<{ x: number; y: number; z: number }> = [];

  if (dormerType === 'mono-pitch') {
    const dormerPitchTan = Math.tan((desiredDormerRoofPitch * Math.PI) / 180);
    roofFrontBaseHeight = rearBaseHeight - dormerPitchTan * dormerDepth;
    frontWallHeight = roofFrontBaseHeight - frontBaseHeight;
    if (frontWallHeight <= MIN_FRONT_WALL_HEIGHT_M) return null;
    const roofRise = rearBaseHeight - roofFrontBaseHeight;
    if (roofRise < 0) return null;
    dormerRoofPitch = roofRise <= 1e-6
      ? 0
      : roundToThreeDecimals((Math.atan2(roofRise, dormerDepth) * 180) / Math.PI);
    ridgeHeight = rearBaseHeight;
  } else {
    roofFrontBaseHeight = frontBaseHeight + requestedFrontWallHeight;
    frontWallHeight = requestedFrontWallHeight;
    const computedGableRise = ridgeHeight - roofFrontBaseHeight;
    if (computedGableRise <= MIN_ROOF_RISE_M) return null;
    gableRoofPitch = roundToThreeDecimals(
      (Math.atan2(computedGableRise, dormerWidth / 2) * 180) / Math.PI,
    );
    roofSideHeight = roundToThreeDecimals(
      Math.hypot(dormerDepth, dormerWidth / 2) > 0
        ? ((dormerDepth * frontWallHeight) + (dormerDepth * computedGableRise)) / dormerDepth
        : 0,
    );
    ridgeBack = backCenter;

    if (dormerType === 'gable-front') {
      ridgeFront = frontCenter;
      leftRoofPolygon = [frontLeft, leftValleyPlanPoint, backCenter, frontCenter];
      rightRoofPolygon = [frontRight, rightValleyPlanPoint, backCenter, frontCenter];
      leftRoofFacePoints = [
        { x: frontLeft.x, y: frontLeft.y, z: roofFrontBaseHeight },
        { x: leftValleyPlanPoint.x, y: leftValleyPlanPoint.y, z: valleyElevation },
        { x: backCenter.x, y: backCenter.y, z: ridgeHeight },
        { x: frontCenter.x, y: frontCenter.y, z: ridgeHeight },
      ];
      rightRoofFacePoints = [
        { x: frontRight.x, y: frontRight.y, z: roofFrontBaseHeight },
        { x: rightValleyPlanPoint.x, y: rightValleyPlanPoint.y, z: valleyElevation },
        { x: backCenter.x, y: backCenter.y, z: ridgeHeight },
        { x: frontCenter.x, y: frontCenter.y, z: ridgeHeight },
      ];
    } else {
      const hipInsetDepth = clamp(
        dormerDepth * HIP_FRONT_RIDGE_RATIO,
        0.2,
        Math.max(0.2, dormerDepth - 0.2),
      );
      ridgeFront = {
        x: frontCenter.x + vx * hipInsetDepth,
        y: frontCenter.y + vy * hipInsetDepth,
        z,
      };
      frontRoofPolygon = [frontLeft, frontRight, ridgeFront];
      leftRoofPolygon = [frontLeft, leftValleyPlanPoint, backCenter, ridgeFront];
      rightRoofPolygon = [frontRight, rightValleyPlanPoint, backCenter, ridgeFront];
      leftRoofFacePoints = [
        { x: frontLeft.x, y: frontLeft.y, z: roofFrontBaseHeight },
        { x: leftValleyPlanPoint.x, y: leftValleyPlanPoint.y, z: valleyElevation },
        { x: backCenter.x, y: backCenter.y, z: ridgeHeight },
        { x: ridgeFront.x, y: ridgeFront.y, z: ridgeHeight },
      ];
      rightRoofFacePoints = [
        { x: frontRight.x, y: frontRight.y, z: roofFrontBaseHeight },
        { x: rightValleyPlanPoint.x, y: rightValleyPlanPoint.y, z: valleyElevation },
        { x: backCenter.x, y: backCenter.y, z: ridgeHeight },
        { x: ridgeFront.x, y: ridgeFront.y, z: ridgeHeight },
      ];
    }
  }

  const maxWindowWidth = Math.max(MIN_WINDOW_WIDTH_M, dormerWidth - WINDOW_SIDE_CLEARANCE_M * 2);
  const windowWidth = clamp(requested.windowWidth, MIN_WINDOW_WIDTH_M, maxWindowWidth);
  const maxWindowHeight = Math.max(
    MIN_WINDOW_HEIGHT_M,
    frontWallHeight - MIN_WINDOW_SILL_M - WINDOW_HEAD_CLEARANCE_M,
  );
  const windowHeight = clamp(requested.windowHeight, MIN_WINDOW_HEIGHT_M, maxWindowHeight);
  const maxWindowSillHeight = Math.max(
    MIN_WINDOW_SILL_M,
    frontWallHeight - WINDOW_HEAD_CLEARANCE_M - windowHeight,
  );
  const windowSillHeight = clamp(requested.windowSillHeight, MIN_WINDOW_SILL_M, maxWindowSillHeight);

  const halfWindowWidth = windowWidth / 2;
  const windowLine = [
    {
      x: windowCenterPlanPoint.x - ux * halfWindowWidth,
      y: windowCenterPlanPoint.y - uy * halfWindowWidth,
      z: frontLeft.z,
    },
    {
      x: windowCenterPlanPoint.x + ux * halfWindowWidth,
      y: windowCenterPlanPoint.y + uy * halfWindowWidth,
      z: frontRight.z,
    },
  ];

  return {
    dormerType,
    host,
    hostBasis,
    windowCenterPlanPoint,
    hostBaseElevationM: resolvedHostBaseElevationM,
    cutoutPolygon,
    hostCutoutProjectedArea: getDormerCutoutProjectedArea(cutoutPolygon),
    hostCutoutSurfaceArea: getDormerCutoutSurfaceArea(host, cutoutPolygon),
    frontLeft,
    frontRight,
    backRight,
    backLeft,
    frontBaseHeight: roundToThreeDecimals(frontBaseHeight),
    rearBaseHeight: roundToThreeDecimals(rearBaseHeight),
    frontWallHeight: roundToThreeDecimals(frontWallHeight),
    roofFrontBaseHeight: roundToThreeDecimals(roofFrontBaseHeight),
    dormerRoofPitch,
    gableRoofPitch,
    dormerWidth: roundToThreeDecimals(dormerWidth),
    dormerDepth: roundToThreeDecimals(dormerDepth),
    ridgeHeight: roundToThreeDecimals(ridgeHeight),
    ridgeFront,
    ridgeBack,
    roofSideHeight,
    frontRoofPolygon,
    leftRoofPolygon,
    rightRoofPolygon,
    leftRoofFacePoints,
    rightRoofFacePoints,
    windowWidth: roundToThreeDecimals(windowWidth),
    windowHeight: roundToThreeDecimals(windowHeight),
    windowSillHeight: roundToThreeDecimals(windowSillHeight),
    frameAreaFraction: clamp(requested.frameAreaFraction, 0, 1),
    windowLine,
    windowBaseHeight: roundToThreeDecimals(frontBaseHeight + windowSillHeight),
    backIntersectionLeft: {
      x: backLeft.x,
      y: backLeft.y,
      z: backLeft.z,
      elevation: roundToThreeDecimals(rearBaseHeight),
    },
    backIntersectionRight: {
      x: backRight.x,
      y: backRight.y,
      z: backRight.z,
      elevation: roundToThreeDecimals(rearBaseHeight),
    },
    leftValleyPoint,
    rightValleyPoint,
  };
}

export function buildDormerBundleDraft(params: {
  host: BuildingElementOpaque;
  dormerType: DormerType;
  windowCenterPlanPoint: DormerPlanPoint;
  existingNames?: Iterable<string>;
  existingBundleNames?: Iterable<string>;
  placementDefaults?: Partial<DormerPlacementDefaults>;
  names?: DormerBundleNames;
  bundleName?: string;
  bundleId?: string;
  /** When omitted, derived from `floors` (if provided) using the same rules as 3D host meshes. */
  hostBaseElevationM?: number;
  /** When set and `hostBaseElevationM` is omitted, elevation matches {@link getDormerHostBaseElevationM}(host, floors). */
  floors?: Floor[];
  thermalOverrides?: DormerThermalOverrides;
  globalOrientationOffset: number;
}): DormerBundleDraft | null {
  const {
    host,
    dormerType,
    windowCenterPlanPoint,
    existingNames = [],
    existingBundleNames = [],
    placementDefaults = {},
    names: providedNames,
    bundleName: providedBundleName,
    bundleId: providedBundleId,
    hostBaseElevationM,
    floors,
    thermalOverrides = {},
    globalOrientationOffset,
  } = params;

  const requested: DormerPlacementDefaults = {
    ...DORMER_PLACEMENT_DEFAULTS,
    ...placementDefaults,
  };

  const effectiveHostBaseElevationM =
    hostBaseElevationM ??
    (floors !== undefined ? getDormerHostBaseElevationM(host, floors) : undefined);

  const resolved = resolveDormerGeometry({
    host,
    dormerType,
    windowCenterPlanPoint,
    placementDefaults,
    hostBaseElevationM: effectiveHostBaseElevationM,
  });
  if (!resolved) return null;

  const nameSet = new Set(existingNames);
  const bundleNameSet = new Set(existingBundleNames);
  const generatedNames = buildDormerBundleNames(nameSet, host.name, dormerType);
  const names = providedNames
    ? {
        frontWall: providedNames.frontWall,
        leftCheekWall: providedNames.leftCheekWall,
        rightCheekWall: providedNames.rightCheekWall,
        roofs: [
          ...providedNames.roofs.slice(0, generatedNames.roofs.length),
          ...generatedNames.roofs.slice(providedNames.roofs.length),
        ].slice(0, generatedNames.roofs.length),
        window: providedNames.window,
      }
    : generatedNames;
  const bundleName = providedBundleName?.trim() || buildDormerBundleDisplayName(bundleNameSet, host.name);
  const bundleId = providedBundleId ?? `${slugifyDormerType(dormerType)}-${host.name || 'roof'}-${nameSet.size}`;

  const sharedBundleMeta = {
    kind: 'dormer' as const,
    bundle_id: bundleId,
    bundle_name: bundleName,
    host_element_name: host.name,
    parameters: {
      dormerType,
      windowCenterPlanPoint,
      dormerWidth: resolved.dormerWidth,
      dormerDepth: resolved.dormerDepth,
      frontWallHeight: resolved.frontWallHeight,
      dormerRoofPitch: resolved.dormerRoofPitch,
      gableRoofPitch: resolved.gableRoofPitch,
      windowWidth: resolved.windowWidth,
      windowHeight: resolved.windowHeight,
      windowSillHeight: resolved.windowSillHeight,
      frameAreaFraction: resolved.frameAreaFraction,
      isUnheatedPitchedRoof: requested.isUnheatedPitchedRoof,
    },
    thermal_overrides: thermalOverrides,
  };

  const isMonoPitchDormer = resolved.dormerType === 'mono-pitch';
  const leftCheekEnd = isMonoPitchDormer ? resolved.backLeft : resolved.leftValleyPoint;
  const rightCheekEnd = isMonoPitchDormer ? resolved.backRight : resolved.rightValleyPoint;
  const leftCheekSpan = Math.hypot(
    leftCheekEnd.x - resolved.frontLeft.x,
    leftCheekEnd.y - resolved.frontLeft.y,
  );
  const rightCheekSpan = Math.hypot(
    rightCheekEnd.x - resolved.frontRight.x,
    rightCheekEnd.y - resolved.frontRight.y,
  );
  const dormerInteriorPoint = getDormerInteriorPlanPoint(resolved);
  const frontWallGeometry = canonicalizeDormerSegment(
    [resolved.frontLeft, resolved.frontRight],
    dormerInteriorPoint,
    globalOrientationOffset,
  );
  const leftCheekGeometry = canonicalizeDormerSegment(
    [resolved.frontLeft, leftCheekEnd],
    dormerInteriorPoint,
    globalOrientationOffset,
  );
  const rightCheekGeometry = canonicalizeDormerSegment(
    [resolved.frontRight, rightCheekEnd],
    dormerInteriorPoint,
    globalOrientationOffset,
  );
  const leftCheekFaceGeometry = buildDormerCheekFaceGeometry(
    leftCheekGeometry.coordinates,
    resolved.frontLeft,
    resolved.frontBaseHeight,
    resolved.roofFrontBaseHeight,
    isMonoPitchDormer ? resolved.rearBaseHeight : resolved.leftValleyPoint.elevation,
  );
  const rightCheekFaceGeometry = buildDormerCheekFaceGeometry(
    rightCheekGeometry.coordinates,
    resolved.frontRight,
    resolved.frontBaseHeight,
    resolved.roofFrontBaseHeight,
    isMonoPitchDormer ? resolved.rearBaseHeight : resolved.rightValleyPoint.elevation,
  );
  const windowGeometry = canonicalizeDormerSegment(
    [resolved.windowLine[0], resolved.windowLine[1]],
    dormerInteriorPoint,
    globalOrientationOffset,
  );
  const monoRoofSlopeLength = roundToThreeDecimals(
    resolved.dormerDepth / Math.cos((resolved.dormerRoofPitch * Math.PI) / 180),
  );
  const frontWallArea = roundToThreeDecimals(
    resolved.dormerType === 'gable-front'
      ? (resolved.dormerWidth * resolved.frontWallHeight)
        + (resolved.dormerWidth * (resolved.ridgeHeight - resolved.roofFrontBaseHeight)) / 2
      : resolved.dormerWidth * resolved.frontWallHeight,
  );
  const windowArea = roundToThreeDecimals(resolved.windowWidth * resolved.windowHeight);
  const roofNames = names.roofs;

  const frontWallStructuralExtraJson: Record<string, unknown> = {
    dormer_bundle: {
      ...sharedBundleMeta,
      role: 'front-wall-anchor',
      roof_name: roofNames[0],
      roof_names: roofNames,
      window_name: names.window,
      cheek_wall_names: [names.leftCheekWall, names.rightCheekWall] as [string, string],
      cutout_polygon: resolved.cutoutPolygon,
      host_cutout_projected_area: resolved.hostCutoutProjectedArea,
      host_cutout_surface_area: resolved.hostCutoutSurfaceArea,
    },
    parent_netting_area: resolved.hostCutoutSurfaceArea,
  };
  if (resolved.dormerType === 'gable-front') {
    frontWallStructuralExtraJson.geometry_face = {
      kind: 'profiled-line-face',
      top_profile: [
        { t: 0, h: resolved.frontWallHeight },
        { t: 0.5, h: resolved.ridgeHeight - resolved.frontBaseHeight },
        { t: 1, h: resolved.frontWallHeight },
      ],
      bottom_profile: [
        { t: 0, h: 0 },
        { t: 1, h: 0 },
      ],
    };
  }

  const frontWall: Partial<BuildingElementOpaque> = {
    coordinates: frontWallGeometry.coordinates,
    width: resolved.dormerWidth,
    height: resolved.frontWallHeight,
    area: frontWallArea,
    pitch: 90,
    orientation360: frontWallGeometry.orientation360,
    base_height: resolved.frontBaseHeight,
    extra_json: mergeDormerStructuralAndThermalExtraJson(
      frontWallStructuralExtraJson,
      thermalOverrides.front_wall,
    ),
  };
  const leftCheekWall: Partial<BuildingElementOpaque> = {
    coordinates: leftCheekGeometry.coordinates,
    width: roundToThreeDecimals(leftCheekSpan),
    height: resolved.frontWallHeight,
    area: roundToThreeDecimals((leftCheekSpan * resolved.frontWallHeight) / 2),
    pitch: 90,
    orientation360: leftCheekGeometry.orientation360,
    base_height: resolved.frontBaseHeight,
    extra_json: mergeDormerStructuralAndThermalExtraJson({
      dormer_bundle: {
        ...sharedBundleMeta,
        role: 'left-cheek-wall',
        anchor_name: names.frontWall,
      },
      geometry_face: leftCheekFaceGeometry,
    }, thermalOverrides.cheek_walls),
  };
  const rightCheekWall: Partial<BuildingElementOpaque> = {
    coordinates: rightCheekGeometry.coordinates,
    width: roundToThreeDecimals(rightCheekSpan),
    height: resolved.frontWallHeight,
    area: roundToThreeDecimals((rightCheekSpan * resolved.frontWallHeight) / 2),
    pitch: 90,
    orientation360: rightCheekGeometry.orientation360,
    base_height: resolved.frontBaseHeight,
    extra_json: mergeDormerStructuralAndThermalExtraJson({
      dormer_bundle: {
        ...sharedBundleMeta,
        role: 'right-cheek-wall',
        anchor_name: names.frontWall,
      },
      geometry_face: rightCheekFaceGeometry,
    }, thermalOverrides.cheek_walls),
  };

  const leftRoofArea = calculatePlanarFaceArea3D(resolved.leftRoofFacePoints);
  const rightRoofArea = calculatePlanarFaceArea3D(resolved.rightRoofFacePoints);
  const hipFrontRoofPoints = resolved.ridgeFront
    ? [
        { x: resolved.frontLeft.x, y: resolved.frontLeft.y, z: resolved.roofFrontBaseHeight },
        { x: resolved.frontRight.x, y: resolved.frontRight.y, z: resolved.roofFrontBaseHeight },
        { x: resolved.ridgeFront.x, y: resolved.ridgeFront.y, z: resolved.ridgeHeight },
      ]
    : [];
  const hipFrontRoofArea = calculatePlanarFaceArea3D(hipFrontRoofPoints);

  const roofs: Array<{ role: DormerBundleRole; name: string; element: Partial<BuildingElementOpaque> }> =
    resolved.dormerType === 'mono-pitch'
      ? [
          {
            role: 'roof',
            name: roofNames[0],
            element: {
              coordinates: canonicalizeDormerPolygonLeadEdge(resolved.cutoutPolygon, dormerInteriorPoint),
              width: resolved.dormerWidth,
              height: monoRoofSlopeLength,
              area: roundToThreeDecimals(resolved.dormerWidth * monoRoofSlopeLength),
              pitch: resolved.dormerRoofPitch,
              orientation360: deriveOrientationFromSegmentOutwardNormal(
                canonicalizeDormerPolygonLeadEdge(resolved.cutoutPolygon, dormerInteriorPoint),
                globalOrientationOffset,
              ),
              base_height: resolved.roofFrontBaseHeight,
              is_unheated_pitched_roof: requested.isUnheatedPitchedRoof,
              extra_json: mergeDormerStructuralAndThermalExtraJson({
                dormer_bundle: {
                  ...sharedBundleMeta,
                  role: 'roof',
                  anchor_name: names.frontWall,
                },
              }, thermalOverrides.roofs),
            },
          },
        ]
      : resolved.dormerType === 'gable-front'
        ? [
            {
              role: 'left-roof',
              name: roofNames[0],
              element: {
                coordinates: canonicalizeDormerPolygonLeadEdge(
                  resolved.leftRoofPolygon,
                  dormerInteriorPoint,
                ),
                width: resolved.dormerDepth,
                height: roundToThreeDecimals(leftRoofArea / resolved.dormerDepth),
                area: leftRoofArea,
                pitch: resolved.gableRoofPitch,
                orientation360: deriveOrientationFromSegmentOutwardNormal(
                  canonicalizeDormerPolygonLeadEdge(
                    resolved.leftRoofPolygon,
                    dormerInteriorPoint,
                  ),
                  globalOrientationOffset,
                ),
                base_height: resolved.roofFrontBaseHeight,
                is_unheated_pitched_roof: requested.isUnheatedPitchedRoof,
                extra_json: mergeDormerStructuralAndThermalExtraJson({
                  dormer_bundle: {
                    ...sharedBundleMeta,
                    role: 'left-roof',
                    anchor_name: names.frontWall,
                  },
                  geometry_face: {
                    kind: 'planar-face-3d',
                    points: canonicalizeDormerPolygonLeadEdge(
                      resolved.leftRoofFacePoints,
                      dormerInteriorPoint,
                    ),
                  },
                }, thermalOverrides.roofs),
              },
            },
            {
              role: 'right-roof',
              name: roofNames[1],
              element: {
                coordinates: canonicalizeDormerPolygonLeadEdge(
                  resolved.rightRoofPolygon,
                  dormerInteriorPoint,
                ),
                width: resolved.dormerDepth,
                height: roundToThreeDecimals(rightRoofArea / resolved.dormerDepth),
                area: rightRoofArea,
                pitch: resolved.gableRoofPitch,
                orientation360: deriveOrientationFromSegmentOutwardNormal(
                  canonicalizeDormerPolygonLeadEdge(
                    resolved.rightRoofPolygon,
                    dormerInteriorPoint,
                  ),
                  globalOrientationOffset,
                ),
                base_height: resolved.roofFrontBaseHeight,
                is_unheated_pitched_roof: requested.isUnheatedPitchedRoof,
                extra_json: mergeDormerStructuralAndThermalExtraJson({
                  dormer_bundle: {
                    ...sharedBundleMeta,
                    role: 'right-roof',
                    anchor_name: names.frontWall,
                  },
                  geometry_face: {
                    kind: 'planar-face-3d',
                    points: canonicalizeDormerPolygonLeadEdge(
                      resolved.rightRoofFacePoints,
                      dormerInteriorPoint,
                    ),
                  },
                }, thermalOverrides.roofs),
              },
            },
          ]
        : [
            {
              role: 'front-roof',
              name: roofNames[0],
              element: {
                coordinates: canonicalizeDormerPolygonLeadEdge([
                  resolved.frontLeft,
                  resolved.frontRight,
                  resolved.ridgeFront!,
                ], dormerInteriorPoint),
                width: resolved.dormerWidth,
                height: roundToThreeDecimals(hipFrontRoofArea / resolved.dormerWidth),
                area: hipFrontRoofArea,
                pitch: resolved.dormerRoofPitch,
                orientation360: deriveOrientationFromSegmentOutwardNormal(
                  canonicalizeDormerPolygonLeadEdge([
                    resolved.frontLeft,
                    resolved.frontRight,
                    resolved.ridgeFront!,
                  ], dormerInteriorPoint),
                  globalOrientationOffset,
                ),
                base_height: resolved.roofFrontBaseHeight,
                is_unheated_pitched_roof: requested.isUnheatedPitchedRoof,
                extra_json: mergeDormerStructuralAndThermalExtraJson({
                  dormer_bundle: {
                    ...sharedBundleMeta,
                    role: 'front-roof',
                    anchor_name: names.frontWall,
                  },
                  geometry_face: {
                    kind: 'planar-face-3d',
                    points: canonicalizeDormerPolygonLeadEdge(hipFrontRoofPoints, dormerInteriorPoint),
                  },
                }, thermalOverrides.roofs),
              },
            },
            {
              role: 'left-roof',
              name: roofNames[1],
              element: {
                coordinates: canonicalizeDormerPolygonLeadEdge(
                  resolved.leftRoofPolygon,
                  dormerInteriorPoint,
                ),
                width: resolved.dormerDepth,
                height: roundToThreeDecimals(leftRoofArea / resolved.dormerDepth),
                area: leftRoofArea,
                pitch: resolved.gableRoofPitch,
                orientation360: deriveOrientationFromSegmentOutwardNormal(
                  canonicalizeDormerPolygonLeadEdge(
                    resolved.leftRoofPolygon,
                    dormerInteriorPoint,
                  ),
                  globalOrientationOffset,
                ),
                base_height: resolved.roofFrontBaseHeight,
                is_unheated_pitched_roof: requested.isUnheatedPitchedRoof,
                extra_json: mergeDormerStructuralAndThermalExtraJson({
                  dormer_bundle: {
                    ...sharedBundleMeta,
                    role: 'left-roof',
                    anchor_name: names.frontWall,
                  },
                  geometry_face: {
                    kind: 'planar-face-3d',
                    points: canonicalizeDormerPolygonLeadEdge(
                      resolved.leftRoofFacePoints,
                      dormerInteriorPoint,
                    ),
                  },
                }, thermalOverrides.roofs),
              },
            },
            {
              role: 'right-roof',
              name: roofNames[2],
              element: {
                coordinates: canonicalizeDormerPolygonLeadEdge(
                  resolved.rightRoofPolygon,
                  dormerInteriorPoint,
                ),
                width: resolved.dormerDepth,
                height: roundToThreeDecimals(rightRoofArea / resolved.dormerDepth),
                area: rightRoofArea,
                pitch: resolved.gableRoofPitch,
                orientation360: deriveOrientationFromSegmentOutwardNormal(
                  canonicalizeDormerPolygonLeadEdge(
                    resolved.rightRoofPolygon,
                    dormerInteriorPoint,
                  ),
                  globalOrientationOffset,
                ),
                base_height: resolved.roofFrontBaseHeight,
                is_unheated_pitched_roof: requested.isUnheatedPitchedRoof,
                extra_json: mergeDormerStructuralAndThermalExtraJson({
                  dormer_bundle: {
                    ...sharedBundleMeta,
                    role: 'right-roof',
                    anchor_name: names.frontWall,
                  },
                  geometry_face: {
                    kind: 'planar-face-3d',
                    points: canonicalizeDormerPolygonLeadEdge(
                      resolved.rightRoofFacePoints,
                      dormerInteriorPoint,
                    ),
                  },
                }, thermalOverrides.roofs),
              },
            },
          ];

  const window: Partial<BuildingElementTransparent> = {
    coordinates: windowGeometry.coordinates,
    width: resolved.windowWidth,
    height: resolved.windowHeight,
    area: windowArea,
    pitch: 90,
    orientation360: windowGeometry.orientation360,
    base_height: resolved.windowBaseHeight,
    frame_area_fraction: resolved.frameAreaFraction,
    free_area_height: resolved.windowHeight,
    mid_height: roundToThreeDecimals(resolved.windowBaseHeight + resolved.windowHeight / 2),
    max_window_open_area: windowArea,
    extra_json: mergeDormerStructuralAndThermalExtraJson({
      dormer_bundle: {
        ...sharedBundleMeta,
        role: 'window',
        anchor_name: names.frontWall,
      },
    }, thermalOverrides.window),
  };

  const members: DormerBundleMemberDraft[] = [
    { role: 'front-wall-anchor', name: names.frontWall, type: 'BuildingElementOpaque', parent: host.name, updates: frontWall },
    { role: 'left-cheek-wall', name: names.leftCheekWall, type: 'BuildingElementOpaque', parent: names.frontWall, updates: leftCheekWall },
    { role: 'right-cheek-wall', name: names.rightCheekWall, type: 'BuildingElementOpaque', parent: names.frontWall, updates: rightCheekWall },
    ...roofs.map((roof) => ({ role: roof.role, name: roof.name, type: 'BuildingElementOpaque' as const, parent: null, updates: roof.element })),
    { role: 'window', name: names.window, type: 'BuildingElementTransparent', parent: names.frontWall, updates: window },
  ];

  return {
    bundleId,
    bundleName,
    dormerType,
    cutoutPolygon: resolved.cutoutPolygon,
    hostCutoutProjectedArea: resolved.hostCutoutProjectedArea,
    hostCutoutSurfaceArea: resolved.hostCutoutSurfaceArea,
    names,
    members,
    frontWall,
    leftCheekWall,
    rightCheekWall,
    roof: roofs[0]?.element ?? {},
    roofs,
    window,
  };
}
