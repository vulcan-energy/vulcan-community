// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { isRoofLikeOpaqueElement } from './roofElement';
import { getPointElementIconNode } from './pointElementIconSpec';
import { getElementColor } from './shapeUtils';
import { isOpaqueExternalDoorLineElement, isUnheatedPitchedRoofPlanAreaElement } from './elementArea';
import { getUnheatedPitchedRoofCeilingElevationM } from './unheatedPitchedRoofCeiling';
import {
  getElementCanvasFloorZValue,
  isElementOnActiveCanvasFloor,
  physicalZUsesFloorId,
} from './elementCanvasFloor';
import { inferThermalBridgeLineModeFromCoordinates, THERMAL_BRIDGE_PLAN_LEN_EPS_M } from './thermalBridgeLinearGeometry';
import type { BuildingElementGround, BuildingElementOpaque, BuildingElementTransparent, Element as GeometryElement, Element, Floor } from '../geometry/types';
import type { WindowVentilation3D } from './geometry3dPrimitivesTypes';
import {
  buildContextShadingSectorPrism,
  buildWindowShadingOrientedBoxes,
} from './shading3dFromElements';
import { groundSlabPolygonEdgesXY, nonBasementGroundSurfaceElevationM } from './suspendedFloorGeometry';
import {
  basementFloorSurfaceElevationM,
  basementGroundElementSurfaceElevationM,
  isBasementGroundElement,
  readUnheatedBasementWallHeightAboveGroundM,
} from './basementGeometry';
import { isOrientationPitchAxis, slopedPolygonPlaneBasis } from './slopePitchAxis';
import { calculateDerivedBaseHeight, withEffectiveStoreyHeights } from './zoneDerivation';
import { getMechanicalVentilationDuctworkRoleStyle } from './mvhrDuctwork';
import { readRootCssVar } from './cssVars';
import type {
  Geometry3DPrimitive,
  PlanarFacePrimitive,
  PointMarkerPrimitive,
  PolygonPrismPrimitive,
  PolygonSlopedPrimitive,
  ThermalBridgeSlopedLinePrimitive,
  ThermalBridgeVerticalLinePrimitive,
  WallSegmentPrimitive,
} from './geometry3dPrimitivesTypes';

export type {
  Geometry3DPrimitive,
  PlanarFacePrimitive,
  WallSegmentPrimitive,
  PolygonPrismPrimitive,
  PolygonSlopedPrimitive,
  PointMarkerPrimitive,
  OrientedBoxPrimitive,
  ThermalBridgeSlopedLinePrimitive,
  ThermalBridgeVerticalLinePrimitive,
} from './geometry3dPrimitivesTypes';

interface BuildGeometry3DPrimitivesOptions {
  elementsById: Record<string, Element>;
  elementIds: string[];
  floors: Floor[];
  currentFloorZ?: number;
  globalOrientationOffset?: number;
}

const WALL_DEFAULT_HEIGHT_M = 2.4;
const WINDOW_DEFAULT_HEIGHT_M = 1.2;
/** Opaque wall segments — thin in 3D preview so openings (and TB cylinders) read clearly without CSG */
const WALL_DEFAULT_THICKNESS_M = 0.05;
/** Slightly thicker than {@link WALL_DEFAULT_THICKNESS_M} so opening boxes aren’t buried inside grey wall */
const OPENING_LINE_THICKNESS_M = 0.15;
const GROUND_DEFAULT_THICKNESS_M = 0.05;
const PLANAR_ELEMENT_THICKNESS_M = 0.08;
const BASEMENT_CONTEXT_BELOW_GROUND_OPACITY = 0.2;
const BASEMENT_CONTEXT_ABOVE_GROUND_OPACITY = 0.14;
const BASEMENT_CONTEXT_MIN_HEIGHT_M = 0.05;
/** Linear thermal bridges: vertical extent of lintel/sill strips in elevation (narrow band, not a deep slab). */
const THERMAL_LINEAR_HEIGHT_M = 0.05;
/** CSV “service” / non-envelope lines (ducts, pipework, shading links, …) */
const SERVICE_LINE_HEIGHT_M = 0.4;
const SERVICE_LINE_THICKNESS_M = 0.045;
const SERVICE_POLYGON_SLAB_M = 0.1;
const POINT_MARKER_RADIUS_THERMAL_M = 0.14;
const POINT_MARKER_RADIUS_SERVICE_M = 0.11;

type ProfilePoint = {
  t: number;
  h: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeProfilePoints(raw: unknown): ProfilePoint[] | null {
  if (!Array.isArray(raw)) return null;

  const sorted = raw
    .filter(
      (point): point is { t: number; h: number } =>
        !!point &&
        typeof point === 'object' &&
        isFiniteNumber((point as Record<string, unknown>).t) &&
        isFiniteNumber((point as Record<string, unknown>).h),
    )
    .map((point) => ({
      t: Math.min(Math.max(point.t, 0), 1),
      h: point.h,
    }))
    .sort((left, right) => left.t - right.t);

  if (sorted.length < 2) return null;

  const deduped: ProfilePoint[] = [];
  for (const point of sorted) {
    if (deduped.length > 0 && Math.abs(deduped[deduped.length - 1].t - point.t) < 1e-9) {
      deduped[deduped.length - 1] = point;
      continue;
    }
    deduped.push(point);
  }

  if (deduped.length < 2) return null;
  if (deduped[0].t > 0) deduped.unshift({ t: 0, h: deduped[0].h });
  if (deduped[deduped.length - 1].t < 1) deduped.push({ t: 1, h: deduped[deduped.length - 1].h });
  deduped[0] = { ...deduped[0], t: 0 };
  deduped[deduped.length - 1] = { ...deduped[deduped.length - 1], t: 1 };
  return deduped;
}

function interpolateProfileHeight(profile: ProfilePoint[], t: number): number {
  if (t <= profile[0].t) return profile[0].h;
  if (t >= profile[profile.length - 1].t) return profile[profile.length - 1].h;

  for (let index = 0; index < profile.length - 1; index += 1) {
    const start = profile[index];
    const end = profile[index + 1];
    if (t < start.t || t > end.t) continue;
    const span = end.t - start.t;
    if (Math.abs(span) < 1e-9) return end.h;
    const ratio = (t - start.t) / span;
    return start.h + (end.h - start.h) * ratio;
  }

  return profile[profile.length - 1].h;
}

function pickWindowVentilation3D(element: Element): WindowVentilation3D | undefined {
  if (element.type !== 'BuildingElementTransparent') return undefined;
  const t = element as BuildingElementTransparent;
  const out: WindowVentilation3D = {};
  if (isFiniteNumber(t.max_window_open_area)) out.max_window_open_area = t.max_window_open_area;
  if (isFiniteNumber(t.free_area_height)) out.free_area_height = t.free_area_height;
  if (isFiniteNumber(t.frame_area_fraction)) out.frame_area_fraction = t.frame_area_fraction;
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizePolygonPoints(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return [];
  const deduped: Array<[number, number]> = [];
  for (const point of points) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) {
      deduped.push(point);
    }
  }
  if (deduped.length >= 2) {
    const first = deduped[0];
    const last = deduped[deduped.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      deduped.pop();
    }
  }
  return deduped.length >= 3 ? deduped : [];
}

/**
 * Cumulative slab elevations per floor zIndex. `floors` must already carry *effective* storey
 * heights (run {@link withEffectiveStoreyHeights} first if the caller has access to elements).
 */
function getFloorElevations(floors: Floor[]): Map<number, number> {
  const byZ = new Map<number, number>();
  for (const floor of floors) {
    byZ.set(floor.zIndex, calculateDerivedBaseHeight(floor.zIndex, floors));
  }
  if (!byZ.has(0)) byZ.set(0, 0);
  return byZ;
}

type FloorZLookup = Pick<Floor, 'id' | 'zIndex'>[];

function getFloorZLookup(floors: Floor[]): FloorZLookup {
  return floors;
}

function getElementFloorZ(element: Element, floorZLookup?: FloorZLookup): number {
  return getElementCanvasFloorZValue(element, floorZLookup) ?? 0;
}

/** Optional viewer elevation (m above ground, absolute) — merged CSV `base_height` → `_base_height`; not sent to HEM. */
function readViewerBaseElevationM(element: Element): number | undefined {
  if (element.type === 'Vents' || element.type === 'MechanicalVentilation') {
    return undefined;
  }
  const e = element as { _base_height?: unknown; base_height?: unknown };
  if (isFiniteNumber(e._base_height)) {
    return e._base_height;
  }
  if (
    element.type === 'BuildingElementAdjacentConditionedSpace' ||
    element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
    element.type === 'BuildingElementPartyWall'
  ) {
    if (isFiniteNumber(e.base_height)) {
      return e.base_height;
    }
  }
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readMechanicalVentilationMidHeightM(element: Element): number | undefined {
  if (element.type !== 'MechanicalVentilation') return undefined;
  const extra = readRecord((element as { extra_json?: unknown }).extra_json);
  if (!extra) return undefined;
  if (isFiniteNumber(extra.mid_height_air_flow_path)) return extra.mid_height_air_flow_path;
  const exhaust = readRecord(extra.position_exhaust);
  if (exhaust && isFiniteNumber(exhaust.mid_height_air_flow_path)) {
    return exhaust.mid_height_air_flow_path;
  }
  return undefined;
}

function readDefaultViewerBaseElevationM(element: Element): number | undefined {
  if (element.type === 'Vents' || element.type === 'MechanicalVentilationTerminal') {
    const midHeight = (element as { mid_height_air_flow_path?: unknown }).mid_height_air_flow_path;
    if (isFiniteNumber(midHeight)) return midHeight;
  }
  return readMechanicalVentilationMidHeightM(element);
}

function isCoordinateZStoreyIndex(value: number, floorZ: number): boolean {
  return Math.abs(value - Math.round(value)) < 1e-6 && Math.round(value) === floorZ;
}

function shouldUseHorizontalServiceLineEndpointZ(z0: number, z1: number, floorZ: number): boolean {
  return !(
    Math.abs(z0 - z1) < 1e-6 &&
    isCoordinateZStoreyIndex(z0, floorZ) &&
    isCoordinateZStoreyIndex(z1, floorZ)
  );
}

function isSchemaBaseHeightElement(element: Element): boolean {
  return (
    element.type === 'BuildingElementOpaque' ||
    element.type === 'BuildingElementTransparent' ||
    element.type === 'OnSiteGeneration'
  );
}

/**
 * Bottom edge elevation (m above ground). For opaque/transparent/PV, HEM `base_height` is absolute when set.
 * Vents / mechanical ventilation use their domain mid-height fields when set. Other elements use optional
 * `_base_height` / legacy adjacent `base_height` when set; otherwise the cumulative slab bottom for the
 * storey from {@link getElementFloorZ} (`floorId` first, else coord z index).
 */
function getElementBaseElevation(
  element: Element,
  floorElevations: Map<number, number>,
  floorZLookup?: FloorZLookup,
): number {
  const floorZ = getElementFloorZ(element, floorZLookup);
  const rawBaseHeight = (element as { base_height?: unknown }).base_height;
  if (isSchemaBaseHeightElement(element) && isFiniteNumber(rawBaseHeight)) {
    return rawBaseHeight;
  }
  const defaultViewer = readDefaultViewerBaseElevationM(element);
  if (defaultViewer !== undefined) return defaultViewer;
  const viewer = readViewerBaseElevationM(element);
  if (viewer !== undefined) return viewer;
  return floorElevations.get(floorZ) ?? 0;
}

/** Elevation of the top of the storey for this floor index (floor plate + floor.height). */
function getTopOfStoreyElevationM(
  floorZ: number,
  floors: Floor[],
  floorElevations: Map<number, number>,
): number {
  const bottom = floorElevations.get(floorZ) ?? 0;
  const floorDef = floors.find((f) => f.zIndex === floorZ);
  return bottom + (floorDef?.height ?? 0);
}

function isRoofLikePlanarOpaque(element: Element, planarByZ: boolean): boolean {
  return planarByZ && isRoofLikeOpaqueElement(element);
}

function isPitchSlopedSurface(element: Element): boolean {
  const pitch = (element as { pitch?: unknown }).pitch;
  return isFiniteNumber(pitch) && pitch > 0 && pitch < 90;
}

/**
 * Horizontal roof polygons often carry base_height=0 in CSV while walls use the same placeholder
 * for "bottom of this floor". For 3D, the flat deck should sit at the top of that storey.
 *
 * Any **planar** pitched opaque (0° < pitch < 90°) uses the storey **floor slab** when `base_height` is
 * missing or placeholder `0`, including renamed elements that no longer match {@link isRoofLikeOpaqueElement}.
 * Flat roof-like decks still use {@link getTopOfStoreyElevationM} when placeholder (CSV convention).
 */
function getOpaquePolygonBaseElevationM(
  element: Element,
  floorElevations: Map<number, number>,
  floors: Floor[],
  planarByZ: boolean,
  floorZLookup?: FloorZLookup,
): number {
  const floorZ = getElementFloorZ(element, floorZLookup);
  const rawBaseHeight = (element as { base_height?: unknown }).base_height;
  const unset = !isFiniteNumber(rawBaseHeight) || rawBaseHeight === 0;

  if (planarByZ && isPitchSlopedSurface(element) && unset) {
    return floorElevations.get(floorZ) ?? 0;
  }

  if (isRoofLikePlanarOpaque(element, planarByZ)) {
    if (unset) {
      return getTopOfStoreyElevationM(floorZ, floors, floorElevations);
    }
    return rawBaseHeight as number;
  }
  return getElementBaseElevation(element, floorElevations, floorZLookup);
}

function getElementHeight(element: Element): number {
  const typedHeight = (element as { height?: unknown }).height;
  if (isFiniteNumber(typedHeight) && typedHeight > 0) return typedHeight;
  if (element.type === 'BuildingElementTransparent') return WINDOW_DEFAULT_HEIGHT_M;
  if (element.type === 'BuildingElementGround') return GROUND_DEFAULT_THICKNESS_M;
  return WALL_DEFAULT_HEIGHT_M;
}

function isWallLikeElementType(element: Element): boolean {
  return (
    element.type === 'BuildingElementOpaque' ||
    element.type === 'BuildingElementAdjacentConditionedSpace' ||
    element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
    element.type === 'BuildingElementPartyWall'
  );
}

function usesFallbackWallHeight(element: Element): boolean {
  const typedHeight = (element as { height?: unknown }).height;
  return isWallLikeElementType(element) && !(isFiniteNumber(typedHeight) && typedHeight > 0);
}

/** Base elevation at eaves for polygon footprint (same rules as prism). */
function getPolygonBaseElevationFor3D(
  element: Element,
  floorElevations: Map<number, number>,
  floors: Floor[],
  planarByZ: boolean,
  floorZLookup?: FloorZLookup,
): number {
  if (element.type === 'BuildingElementGround') {
    const nonBasementSurfaceM = nonBasementGroundSurfaceElevationM(element);
    if (nonBasementSurfaceM !== null) {
      return element.floor_type === 'Suspended_floor'
        ? nonBasementSurfaceM - GROUND_DEFAULT_THICKNESS_M
        : nonBasementSurfaceM;
    }
    const basementSurfaceM = basementGroundElementSurfaceElevationM(element);
    if (basementSurfaceM !== null) {
      return basementSurfaceM - GROUND_DEFAULT_THICKNESS_M;
    }
    return floorElevations.get(getElementFloorZ(element, floorZLookup)) ?? 0;
  }
  if (element.type === 'BuildingElementOpaque') {
    return getOpaquePolygonBaseElevationM(element, floorElevations, floors, planarByZ, floorZLookup);
  }
  if (element.type === 'BuildingElementTransparent') {
    const rawBh = (element as { base_height?: unknown }).base_height;
    const unset = !isFiniteNumber(rawBh) || rawBh === 0;
    if (planarByZ && isPitchSlopedSurface(element) && unset) {
      return floorElevations.get(getElementFloorZ(element, floorZLookup)) ?? 0;
    }
  }
  return getElementBaseElevation(element, floorElevations, floorZLookup);
}

function tryMapPolygonSlopedPrimitive(
  element: Element,
  points: Array<[number, number]>,
  floorElevations: Map<number, number>,
  floors: Floor[],
  planarByZ: boolean,
  floorZLookup: FloorZLookup,
  globalOrientationOffset: number | undefined,
  currentFloorZ?: number,
): PolygonSlopedPrimitive | null {
  if (element.type === 'BuildingElementGround') return null;
  if (!isPitchSlopedSurface(element)) return null;
  const orientationAxis = isOrientationPitchAxis(element);
  if (orientationAxis && !Number.isFinite(globalOrientationOffset)) return null;
  const basis = slopedPolygonPlaneBasis(
    points,
    orientationAxis ? 'orientation' : 'bottom-edge',
    (element as { orientation360?: number }).orientation360 ?? 0,
    globalOrientationOffset ?? 0,
  );
  if (!basis) return null;
  const pitch = (element as { pitch: number }).pitch;
  const baseElevationM = getPolygonBaseElevationFor3D(element, floorElevations, floors, planarByZ, floorZLookup);
  const color = getColorForElement3D(element);
  const opening = isOpeningElement(element);

  return {
    kind: 'polygon-sloped',
    elementId: element.id,
    elementType: element.type,
    floorZ: getElementFloorZ(element, floorZLookup),
    points,
    baseElevationM,
    pitchDeg: pitch,
    hingeAnchorXY: basis.anchorXY,
    pitchAxis: orientationAxis ? 'orientation' : 'bottom-edge',
    inwardNormal2D: basis.upslope2D,
    thicknessM: PLANAR_ELEMENT_THICKNESS_M,
    color,
    isOpening: opening,
    isCurrentFloor: isElementOnActiveCanvasFloor(element, currentFloorZ, floors),
    opacity: isUnheatedPitchedRoofPlanAreaElement(element as GeometryElement) ? 0.3 : undefined,
  };
}

function getElementPlanPolygonPoints(element: Element): Array<[number, number]> {
  if (!Array.isArray(element.coordinates) || element.coordinates.length < 3) return [];
  return sanitizePolygonPoints(
    element.coordinates
      .filter((coord) => isFiniteNumber(coord.x) && isFiniteNumber(coord.y))
      .map((coord) => [coord.x, coord.y] as [number, number]),
  );
}

function mapUnheatedPitchedRoofCeilingFace(
  element: Element,
  points: Array<[number, number]>,
  floors: Floor[],
  floorZLookup: FloorZLookup,
  allElements: Element[],
  currentFloorZ?: number,
): PlanarFacePrimitive | null {
  if (!isUnheatedPitchedRoofPlanAreaElement(element as GeometryElement)) return null;
  if (points.length < 3) return null;

  const baseElevationM = getUnheatedPitchedRoofCeilingElevationM(
    element as BuildingElementOpaque,
    allElements as GeometryElement[],
    floors,
  ).value;
  return {
    kind: 'planar-face',
    elementId: element.id,
    elementType: element.type,
    floorZ: getElementFloorZ(element, floorZLookup),
    isCurrentFloor: isElementOnActiveCanvasFloor(element, currentFloorZ, floors),
    color: getColorForElement3D(element),
    points: points.map(([x, y]) => [x, baseElevationM, y] as [number, number, number]),
    isOpening: false,
  };
}

function isPlanarAtSingleZ(element: Element): boolean {
  if (!Array.isArray(element.coordinates) || element.coordinates.length < 3) return false;
  const zValues = element.coordinates
    .map((coord) => coord?.z)
    .filter((z): z is number => isFiniteNumber(z));
  if (zValues.length < 3) return false;
  const first = zValues[0];
  return zValues.every((z) => Math.abs(z - first) < 1e-6);
}

function isOpeningElement(element: Element): boolean {
  if (element.type === 'BuildingElementTransparent') return true;
  if (isOpaqueExternalDoorLineElement(element as GeometryElement)) {
    return true;
  }
  return false;
}

function getColorForElement3D(element: Element): string {
  if (element.type === 'BuildingElementGround') return readRootCssVar('--canvas-element-ground-stroke', '#2ea043');
  if (element.type === 'BuildingElementTransparent') {
    return readRootCssVar('--canvas-3d-window-edge', readRootCssVar('--canvas-element-window-stroke', '#55b6ff'));
  }
  if (element.type === 'BuildingElementOpaque') {
    if (isOpaqueExternalDoorLineElement(element as GeometryElement)) {
      return readRootCssVar('--canvas-3d-door-edge', readRootCssVar('--canvas-element-door-stroke', '#ff8c42'));
    }
    return readRootCssVar(
      '--canvas-element-external-wall-stroke',
      readRootCssVar('--canvas-element-wall-stroke', '#c6d2dc'),
    );
  }
  if (element.type === 'BuildingElementAdjacentConditionedSpace') {
    return readRootCssVar(
      '--canvas-element-internal-wall-stroke',
      readRootCssVar('--canvas-element-adjacent-stroke', '#8bd3ff'),
    );
  }
  if (element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple') {
    return readRootCssVar(
      '--canvas-element-adjacent-unconditioned-stroke',
      readRootCssVar('--canvas-element-adjacent-stroke', '#fbbf24'),
    );
  }
  if (element.type === 'BuildingElementPartyWall') {
    return readRootCssVar(
      '--canvas-element-party-wall-stroke',
      readRootCssVar('--canvas-element-adjacent-stroke', '#c084fc'),
    );
  }
  if (element.type === 'ThermalBridgeLinear' || element.type === 'ThermalBridgePoint') {
    return readRootCssVar('--canvas-element-thermal-bridge-stroke', '#ea580c');
  }
  // Non-envelope CSV rows (lighting, ducts, PV, systems, …)
  switch (element.type) {
    case 'WindowShading':
      return readRootCssVar('--canvas-element-shading-stroke', '#F4C430');
    case 'Lighting':
      return readRootCssVar('--canvas-element-lighting-stroke', '#FFB347');
    case 'MechanicalVentilationDuctwork':
      return getMechanicalVentilationDuctworkRoleStyle(element).stroke;
    case 'WaterPipework':
      return readRootCssVar('--canvas-element-pipework-stroke', '#38BDF8');
    case 'WetEmitter':
      return readRootCssVar('--canvas-element-emitter-stroke', '#60A5FA');
    case 'Appliance':
      return readRootCssVar('--canvas-element-appliance-stroke', '#CBD5E1');
    case 'HotWaterDemand':
      return readRootCssVar('--canvas-element-hot-water-stroke', '#FB7185');
    case 'ContextShading':
      return readRootCssVar('--canvas-element-context-stroke', '#64748b');
    case 'Vents':
      return readRootCssVar('--canvas-element-vent-stroke', '#22D3EE');
    case 'MechanicalVentilation':
      return readRootCssVar('--canvas-element-mechanical-ventilation-stroke', '#2DD4BF');
    case 'CombustionAppliances':
      return readRootCssVar('--canvas-element-combustion-stroke', '#FF7A3D');
    case 'OnSiteGeneration':
      return readRootCssVar('--canvas-element-onsite-generation-stroke', '#FACC15');
    case 'ElectricBattery':
      return readRootCssVar('--canvas-element-battery-stroke', '#A78BFA');
    case 'System':
      return readRootCssVar('--canvas-element-system-stroke', '#FB923C');
    default:
      return getElementColor(element, false).stroke || '#888888';
  }
}

function buildBasementGroundContextFaces(
  element: BuildingElementGround,
  floorZLookup: FloorZLookup,
  floors: Floor[],
  currentFloorZ?: number,
): PlanarFacePrimitive[] {
  if (!isBasementGroundElement(element)) return [];
  const surfaceM = basementFloorSurfaceElevationM(element);
  if (surfaceM === null || surfaceM >= -BASEMENT_CONTEXT_MIN_HEIGHT_M) return [];

  const edges = groundSlabPolygonEdgesXY(element);
  if (edges.length === 0) return [];

  const floorZ = getElementFloorZ(element, floorZLookup);
  const isCurrentFloor = isElementOnActiveCanvasFloor(element, currentFloorZ, floors);
  const base = {
    kind: 'planar-face' as const,
    elementId: element.id,
    elementType: element.type,
    floorZ,
    isCurrentFloor,
    isOpening: false,
  };
  const belowColor = readRootCssVar('--canvas-3d-basement-wall-below', getColorForElement3D(element));
  const aboveColor = readRootCssVar(
    '--canvas-3d-basement-wall-above',
    readRootCssVar('--canvas-element-adjacent-unconditioned-stroke', getColorForElement3D(element)),
  );

  const faces: PlanarFacePrimitive[] = edges.map(([[ax, ay], [bx, by]]) => ({
    ...base,
    color: belowColor,
    opacity: BASEMENT_CONTEXT_BELOW_GROUND_OPACITY,
    points: [
      [ax, surfaceM, ay],
      [bx, surfaceM, by],
      [bx, 0, by],
      [ax, 0, ay],
    ],
  }));

  const aboveGroundM = readUnheatedBasementWallHeightAboveGroundM(element);
  if (aboveGroundM !== null && aboveGroundM >= BASEMENT_CONTEXT_MIN_HEIGHT_M) {
    for (const [[ax, ay], [bx, by]] of edges) {
      faces.push({
        ...base,
        color: aboveColor,
        opacity: BASEMENT_CONTEXT_ABOVE_GROUND_OPACITY,
        points: [
          [ax, 0, ay],
          [bx, 0, by],
          [bx, aboveGroundM, by],
          [ax, aboveGroundM, ay],
        ],
      });
    }
  }

  return faces;
}

function mapGeometryFaceToPlanarFace(
  element: Element,
  floorElevations: Map<number, number>,
  floorZLookup: FloorZLookup,
  currentFloorZ?: number,
  floors?: Floor[],
): PlanarFacePrimitive | null {
  const rawGeometry = element.extra_json?.geometry_face;
  if (!rawGeometry || typeof rawGeometry !== 'object') return null;

  const geometry = rawGeometry as Record<string, unknown>;
  const floorZ = getElementFloorZ(element, floorZLookup);
  const isCurrentFloor = isElementOnActiveCanvasFloor(element, currentFloorZ, floors);
  const color = getColorForElement3D(element);
  const isOpening = isOpeningElement(element);

  if (geometry.kind === 'profiled-line-face') {
    if (!element.coordinates || element.coordinates.length !== 2) return null;
    const topProfile = normalizeProfilePoints(geometry.top_profile);
    const bottomProfile = normalizeProfilePoints(geometry.bottom_profile);
    if (!topProfile || !bottomProfile) return null;

    const [start, end] = element.coordinates;
    const breakpoints = Array.from(
      new Set([...topProfile.map((point) => point.t), ...bottomProfile.map((point) => point.t)]),
    ).sort((left, right) => left - right);
    if (breakpoints.length < 2) return null;

    const baseElevationM = getElementBaseElevation(element, floorElevations, floorZLookup);
    const toPoint = (t: number, h: number): [number, number, number] => [
      start.x + (end.x - start.x) * t,
      baseElevationM + h,
      start.y + (end.y - start.y) * t,
    ];

    const topPoints = breakpoints.map((t) => toPoint(t, interpolateProfileHeight(topProfile, t)));
    const bottomPoints = breakpoints
      .map((t) => toPoint(t, interpolateProfileHeight(bottomProfile, t)))
      .reverse();

    return {
      kind: 'planar-face',
      elementId: element.id,
      elementType: element.type,
      floorZ,
      isCurrentFloor,
      color,
      points: [...topPoints, ...bottomPoints],
      isOpening,
      opacity: isOpening ? 0.75 : undefined,
      // Opaque profiled-top walls (and gable-dormer front walls, which share this branch) render
      // as solid wall-thickness prisms. Profiled openings must protrude beyond their host wall's
      // prism — the same openings-thicker-than-walls rule line elements use (no CSG cutouts) —
      // or the wall front face would occlude a coplanar zero-thickness window entirely.
      thicknessM: isOpening ? OPENING_LINE_THICKNESS_M : WALL_DEFAULT_THICKNESS_M,
    };
  }

  if (geometry.kind === 'planar-face-3d' && Array.isArray(geometry.points)) {
    const points = geometry.points
      .filter(
        (point): point is { x: number; y: number; z: number } =>
          !!point &&
          typeof point === 'object' &&
          isFiniteNumber((point as Record<string, unknown>).x) &&
          isFiniteNumber((point as Record<string, unknown>).y) &&
          isFiniteNumber((point as Record<string, unknown>).z),
      )
      .map((point) => [point.x, point.z, point.y] as [number, number, number]);
    if (points.length < 3) return null;

    return {
      kind: 'planar-face',
      elementId: element.id,
      elementType: element.type,
      floorZ,
      isCurrentFloor,
      color,
      points,
      isOpening,
      opacity: isOpening ? 0.75 : undefined,
    };
  }

  return null;
}

function mapLineElementToWall(
  element: Element,
  floorElevations: Map<number, number>,
  floorZLookup: FloorZLookup,
  currentFloorZ?: number,
  floors?: Floor[],
): WallSegmentPrimitive | null {
  if (!element.coordinates || element.coordinates.length !== 2) return null;
  const [a, b] = element.coordinates;
  if (!a || !b) return null;
  if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y) || !isFiniteNumber(b.x) || !isFiniteNumber(b.y)) return null;

  const heightM = getElementHeight(element);
  if (heightM <= 0) return null;

  const color = getColorForElement3D(element);
  const opening = isOpeningElement(element);
  const thicknessM = opening ? OPENING_LINE_THICKNESS_M : WALL_DEFAULT_THICKNESS_M;

  return {
    kind: 'wall-segment',
    elementId: element.id,
    elementType: element.type,
    floorZ: getElementFloorZ(element, floorZLookup),
    start: [a.x, a.y],
    end: [b.x, b.y],
    baseElevationM: getElementBaseElevation(element, floorElevations, floorZLookup),
    heightM,
    thicknessM,
    color,
    isOpening: opening,
    isCurrentFloor: isElementOnActiveCanvasFloor(element, currentFloorZ, floors),
    usesFallbackHeight: !opening && usesFallbackWallHeight(element),
    windowVentilation: pickWindowVentilation3D(element),
  };
}

function mapPolygonElementToPrism(
  element: Element,
  floorElevations: Map<number, number>,
  floors: Floor[],
  floorZLookup: FloorZLookup,
  globalOrientationOffset: number | undefined,
  currentFloorZ?: number,
): PolygonPrismPrimitive | PolygonSlopedPrimitive | null {
  if (!element.coordinates || element.coordinates.length < 3) return null;
  const points = sanitizePolygonPoints(
    element.coordinates
      .filter((coord) => isFiniteNumber(coord.x) && isFiniteNumber(coord.y))
      .map((coord) => [coord.x, coord.y] as [number, number]),
  );
  if (points.length < 3) return null;

  const planarByZ = isPlanarAtSingleZ(element);
  const sloped = tryMapPolygonSlopedPrimitive(element, points, floorElevations, floors, planarByZ, floorZLookup, globalOrientationOffset, currentFloorZ);
  if (sloped) return sloped;

  let heightM = getElementHeight(element);
  if (element.type === 'BuildingElementGround') {
    heightM = GROUND_DEFAULT_THICKNESS_M;
  } else if (planarByZ && isPlanarPolygonElementType(element)) {
    // Roof/floor-like polygons should render as slabs, not tall volumetric blocks.
    heightM = PLANAR_ELEMENT_THICKNESS_M;
  }
  if (heightM <= 0) return null;

  const color = getColorForElement3D(element);
  const opening = isOpeningElement(element);

  const baseElevationM = getPolygonBaseElevationFor3D(element, floorElevations, floors, planarByZ, floorZLookup);

  return {
    kind: 'polygon-prism',
    elementId: element.id,
    elementType: element.type,
    floorZ: getElementFloorZ(element, floorZLookup),
    points,
    baseElevationM,
    heightM,
    color,
    isOpening: opening,
    isCurrentFloor: isElementOnActiveCanvasFloor(element, currentFloorZ, floors),
    usesFallbackHeight: !opening && usesFallbackWallHeight(element),
    windowVentilation: pickWindowVentilation3D(element),
  };
}

function isPlanarPolygonElementType(element: Element): boolean {
  if (element.type === 'BuildingElementOpaque') return true;
  if (
    element.type === 'BuildingElementAdjacentConditionedSpace' ||
    element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
    element.type === 'BuildingElementPartyWall'
  ) {
    return true;
  }
  return false;
}

function mapPointMarkerPrimitive(
  element: Element,
  floorElevations: Map<number, number>,
  floorZLookup: FloorZLookup,
  currentFloorZ: number | undefined,
  radiusM: number,
  floors?: Floor[],
): PointMarkerPrimitive | null {
  const c = element.coordinates?.[0];
  if (!c || !isFiniteNumber(c.x) || !isFiniteNumber(c.y)) return null;

  return {
    kind: 'point-marker',
    elementId: element.id,
    elementType: element.type,
    floorZ: getElementFloorZ(element, floorZLookup),
    position: [c.x, c.y],
    baseElevationM:
      element.type === 'ThermalBridgePoint' && isFiniteNumber(c.z)
        ? c.z
        : getElementBaseElevation(element, floorElevations, floorZLookup),
    radiusM,
    color: getColorForElement3D(element),
    isCurrentFloor: isElementOnActiveCanvasFloor(element, currentFloorZ, floors),
    iconNode: getPointElementIconNode(element),
    markerLabel: element.type === 'MechanicalVentilationTerminal'
      ? ((element as { terminal_type?: unknown }).terminal_type === 'exhaust' ? 'OUT' : 'IN')
      : undefined,
  };
}

function mapThermalBridgeLinearToWall(
  element: Element,
  floorElevations: Map<number, number>,
  floorZLookup: FloorZLookup,
  currentFloorZ?: number,
  floors?: Floor[],
): Geometry3DPrimitive[] {
  if (!element.coordinates || element.coordinates.length !== 2) return [];
  const [a, b] = element.coordinates;
  if (!a || !b) return [];
  if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y) || !isFiniteNumber(b.x) || !isFiniteNumber(b.y)) return [];

  const rawBaseHeight = (element as { base_height?: unknown }).base_height;
  const z0 = a.z;
  const z1 = b.z;
  const hasZ = isFiniteNumber(z0) && isFiniteNumber(z1);

  const planLen = Math.hypot(b.x - a.x, b.y - a.y);

  if (planLen < THERMAL_BRIDGE_PLAN_LEN_EPS_M) {
    if (!hasZ) return [];
    const zLo = Math.min(z0 as number, z1 as number);
    const zHi = Math.max(z0 as number, z1 as number);
    if (zHi - zLo < 1e-6) return [];
    const vertical: ThermalBridgeVerticalLinePrimitive = {
      kind: 'thermal-bridge-vertical-line',
      elementId: element.id,
      elementType: 'ThermalBridgeLinear',
      floorZ: getElementFloorZ(element, floorZLookup),
      xy: [a.x, a.y],
      zBottomM: zLo,
      zTopM: zHi,
      color: getColorForElement3D(element),
      isCurrentFloor: isElementOnActiveCanvasFloor(element, currentFloorZ, floors),
    };
    return [vertical];
  }

  if (inferThermalBridgeLineModeFromCoordinates(element.coordinates) === 'slope' && hasZ) {
    const sloped: ThermalBridgeSlopedLinePrimitive = {
      kind: 'thermal-bridge-sloped-line',
      elementId: element.id,
      elementType: 'ThermalBridgeLinear',
      floorZ: getElementFloorZ(element, floorZLookup),
      start: [a.x, z0 as number, a.y],
      end: [b.x, z1 as number, b.y],
      color: getColorForElement3D(element),
      isCurrentFloor: isElementOnActiveCanvasFloor(element, currentFloorZ, floors),
    };
    return [sloped];
  }

  // Horizontal run: coordinate Z carries opening elevation in the canvas. Schema / merges often set
  // base_height to 0 as a placeholder — that must not override finite Z (would snap 3D to ground).
  // Explicit non-zero base_height still wins for CSV-style rows that only set base_height.
  let baseElevationM: number;
  const explicitNonZeroBase =
    isFiniteNumber(rawBaseHeight) && (rawBaseHeight as number) !== 0;
  if (explicitNonZeroBase) {
    baseElevationM = rawBaseHeight as number;
  } else if (hasZ) {
    const zc = ((z0 as number) + (z1 as number)) / 2;
    baseElevationM = zc - THERMAL_LINEAR_HEIGHT_M / 2;
  } else if (isFiniteNumber(rawBaseHeight)) {
    baseElevationM = rawBaseHeight as number;
  } else {
    baseElevationM = getElementBaseElevation(element, floorElevations, floorZLookup);
  }

  const wall: WallSegmentPrimitive = {
    kind: 'wall-segment',
    elementId: element.id,
    elementType: element.type,
    floorZ: getElementFloorZ(element, floorZLookup),
    start: [a.x, a.y],
    end: [b.x, b.y],
    baseElevationM,
    heightM: THERMAL_LINEAR_HEIGHT_M,
    /** Match opening line thickness so TB reads through the wall plane in 3D. */
    thicknessM: OPENING_LINE_THICKNESS_M,
    color: getColorForElement3D(element),
    isOpening: false,
    isCurrentFloor: isElementOnActiveCanvasFloor(element, currentFloorZ, floors),
    renderAboveWallPlane: true,
  };
  return [wall];
}

function mapServiceLineToPrimitives(
  element: Element,
  floorElevations: Map<number, number>,
  floorZLookup: FloorZLookup,
  currentFloorZ?: number,
  floors?: Floor[],
): Geometry3DPrimitive[] {
  if (!element.coordinates || element.coordinates.length !== 2) return [];
  const [a, b] = element.coordinates;
  if (!a || !b) return [];
  if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y) || !isFiniteNumber(b.x) || !isFiniteNumber(b.y)) return [];

  const z0 = a.z;
  const z1 = b.z;
  const hasZ = isFiniteNumber(z0) && isFiniteNumber(z1);
  const planLen = Math.hypot(b.x - a.x, b.y - a.y);
  const floorZ = getElementFloorZ(element, floorZLookup);
  const color = getColorForElement3D(element);
  const isCurrentFloor = isElementOnActiveCanvasFloor(element, currentFloorZ, floors);

  if (planLen < THERMAL_BRIDGE_PLAN_LEN_EPS_M) {
    if (!hasZ) return [];
    const zLo = Math.min(z0 as number, z1 as number);
    const zHi = Math.max(z0 as number, z1 as number);
    if (zHi - zLo < 1e-6) return [];
    return [
      {
        kind: 'thermal-bridge-vertical-line',
        elementId: element.id,
        elementType: element.type,
        floorZ,
        xy: [a.x, a.y],
        zBottomM: zLo,
        zTopM: zHi,
        color,
        isCurrentFloor,
      },
    ];
  }

  if (inferThermalBridgeLineModeFromCoordinates(element.coordinates) === 'slope' && hasZ) {
    return [
      {
        kind: 'thermal-bridge-sloped-line',
        elementId: element.id,
        elementType: element.type,
        floorZ,
        start: [a.x, z0 as number, a.y],
        end: [b.x, z1 as number, b.y],
        color,
        isCurrentFloor,
      },
    ];
  }

  let baseElevationM: number;
  const viewerBaseElevationM = readViewerBaseElevationM(element);
  if (viewerBaseElevationM !== undefined) {
    baseElevationM = viewerBaseElevationM;
  } else if (hasZ && shouldUseHorizontalServiceLineEndpointZ(z0 as number, z1 as number, floorZ)) {
    baseElevationM = ((z0 as number) + (z1 as number)) / 2 - SERVICE_LINE_HEIGHT_M / 2;
  } else {
    baseElevationM = getElementBaseElevation(element, floorElevations, floorZLookup);
  }

  return [{
    kind: 'wall-segment',
    elementId: element.id,
    elementType: element.type,
    floorZ,
    start: [a.x, a.y],
    end: [b.x, b.y],
    baseElevationM,
    heightM: SERVICE_LINE_HEIGHT_M,
    thicknessM: SERVICE_LINE_THICKNESS_M,
    color,
    isOpening: false,
    isCurrentFloor,
  }];
}

function mapServicePolygonToPrism(
  element: Element,
  floorElevations: Map<number, number>,
  floors: Floor[],
  floorZLookup: FloorZLookup,
  globalOrientationOffset: number | undefined,
  currentFloorZ?: number,
): PolygonPrismPrimitive | PolygonSlopedPrimitive | null {
  if (!element.coordinates || element.coordinates.length < 3) return null;
  const points = sanitizePolygonPoints(
    element.coordinates
      .filter((coord) => isFiniteNumber(coord.x) && isFiniteNumber(coord.y))
      .map((coord) => [coord.x, coord.y] as [number, number]),
  );
  if (points.length < 3) return null;

  const planarByZ = isPlanarAtSingleZ(element);
  const sloped = tryMapPolygonSlopedPrimitive(element, points, floorElevations, floors, planarByZ, floorZLookup, globalOrientationOffset, currentFloorZ);
  if (sloped) return sloped;

  return {
    kind: 'polygon-prism',
    elementId: element.id,
    elementType: element.type,
    floorZ: getElementFloorZ(element, floorZLookup),
    points,
    baseElevationM: getElementBaseElevation(element, floorElevations, floorZLookup),
    heightM: SERVICE_POLYGON_SLAB_M,
    color: getColorForElement3D(element),
    isOpening: false,
    isCurrentFloor: isElementOnActiveCanvasFloor(element, currentFloorZ, floors),
  };
}

/** Remaining CSV element types: infer from coordinate count */
function mapNonEnvelopeElementToPrimitives(
  element: Element,
  floorElevations: Map<number, number>,
  floorZLookup: FloorZLookup,
  _floors: Floor[],
  globalOrientationOffset: number | undefined,
  currentFloorZ?: number,
): Geometry3DPrimitive[] {
  const n = element.coordinates?.length ?? 0;
  if (n === 0) return [];

  if (n === 1) {
    const p = mapPointMarkerPrimitive(
      element,
      floorElevations,
      floorZLookup,
      currentFloorZ,
      POINT_MARKER_RADIUS_SERVICE_M,
      _floors,
    );
    return p ? [p] : [];
  }
  if (n === 2) {
    return mapServiceLineToPrimitives(element, floorElevations, floorZLookup, currentFloorZ, _floors);
  }
  const p = mapServicePolygonToPrism(element, floorElevations, _floors, floorZLookup, globalOrientationOffset, currentFloorZ);
  return p ? [p] : [];
}

function mapElementTo3DPrimitives(
  element: Element,
  elementsById: Record<string, Element>,
  floorElevations: Map<number, number>,
  floors: Floor[],
  floorZLookup: FloorZLookup,
  allElements: Element[],
  globalOrientationOffset: number | undefined,
  currentFloorZ?: number,
): Geometry3DPrimitive[] {
  const t = element.type;

  const geometryFace = mapGeometryFaceToPlanarFace(element, floorElevations, floorZLookup, currentFloorZ, floors);
  if (geometryFace) {
    if (isUnheatedPitchedRoofPlanAreaElement(element as GeometryElement)) {
      const planPoints = getElementPlanPolygonPoints(element);
      const ceilingFace = mapUnheatedPitchedRoofCeilingFace(
        element,
        planPoints,
        floors,
        floorZLookup,
        allElements,
        currentFloorZ,
      );
      const translucentRoofFace = { ...geometryFace, opacity: 0.3 };
      return ceilingFace ? [ceilingFace, translucentRoofFace] : [translucentRoofFace];
    }
    return [geometryFace];
  }

  if (t === 'WindowShading') {
    const boxes = buildWindowShadingOrientedBoxes(
      element as Element & { type: 'WindowShading' },
      elementsById,
      floorElevations,
      (targetElement, targetFloorElevations) => getElementBaseElevation(targetElement, targetFloorElevations, floorZLookup),
      (targetElement) => getElementFloorZ(targetElement, floorZLookup),
      (targetElement, targetCurrentFloorZ) =>
        isElementOnActiveCanvasFloor(targetElement, targetCurrentFloorZ, floors),
      currentFloorZ,
      getColorForElement3D(element),
    );
    if (boxes?.length) return boxes;
    return mapNonEnvelopeElementToPrimitives(element, floorElevations, floorZLookup, floors, globalOrientationOffset, currentFloorZ);
  }

  if (t === 'ContextShading') {
    const prism = buildContextShadingSectorPrism(
      element as Element & { type: 'ContextShading' },
      elementsById,
      floorElevations,
      (targetElement, targetFloorElevations) => getElementBaseElevation(targetElement, targetFloorElevations, floorZLookup),
      (targetElement) => getElementFloorZ(targetElement, floorZLookup),
      (targetElement, targetCurrentFloorZ) =>
        isElementOnActiveCanvasFloor(targetElement, targetCurrentFloorZ, floors),
      currentFloorZ,
      getColorForElement3D(element),
    );
    if (prism) return [prism];
    return mapNonEnvelopeElementToPrimitives(element, floorElevations, floorZLookup, floors, globalOrientationOffset, currentFloorZ);
  }

  const coordsLength = element.coordinates?.length ?? 0;
  if (coordsLength === 0) return [];

  // Core envelope (walls, windows, floors, roofs)
  if (t === 'BuildingElementGround' || t === 'BuildingElementOpaque' || t === 'BuildingElementTransparent') {
    if (coordsLength === 2) {
      const p = mapLineElementToWall(element, floorElevations, floorZLookup, currentFloorZ, floors);
      return p ? [p] : [];
    }
    if (coordsLength >= 3) {
      const p = mapPolygonElementToPrism(element, floorElevations, floors, floorZLookup, globalOrientationOffset, currentFloorZ);
      if (!p) return [];
      if (t === 'BuildingElementGround') {
        return [
          p,
          ...buildBasementGroundContextFaces(element as BuildingElementGround, floorZLookup, floors, currentFloorZ),
        ];
      }
      if (p.kind === 'polygon-sloped') {
        const ceilingFace = mapUnheatedPitchedRoofCeilingFace(
          element,
          p.points,
          floors,
          floorZLookup,
          allElements,
          currentFloorZ,
        );
        return ceilingFace ? [ceilingFace, p] : [p];
      }
      return [p];
    }
    return [];
  }

  // Party / adjacent boundaries — same geometry rules as opaque walls
  if (t === 'BuildingElementAdjacentConditionedSpace' || t === 'BuildingElementAdjacentUnconditionedSpace_Simple' || t === 'BuildingElementPartyWall') {
    if (coordsLength === 2) {
      const p = mapLineElementToWall(element, floorElevations, floorZLookup, currentFloorZ, floors);
      return p ? [p] : [];
    }
    if (coordsLength >= 3) {
      const p = mapPolygonElementToPrism(element, floorElevations, floors, floorZLookup, globalOrientationOffset, currentFloorZ);
      return p ? [p] : [];
    }
    return [];
  }

  if (t === 'ThermalBridgeLinear') {
    return mapThermalBridgeLinearToWall(element, floorElevations, floorZLookup, currentFloorZ, floors);
  }

  if (t === 'ThermalBridgePoint') {
    const p = mapPointMarkerPrimitive(
      element,
      floorElevations,
      floorZLookup,
      currentFloorZ,
      POINT_MARKER_RADIUS_THERMAL_M,
      floors,
    );
    return p ? [p] : [];
  }

  // All other CSV / store types (lighting, ducts, PV, systems, …)
  return mapNonEnvelopeElementToPrimitives(element, floorElevations, floorZLookup, floors, globalOrientationOffset, currentFloorZ);
}

export function buildGeometry3DPrimitives({
  elementsById,
  elementIds,
  floors,
  currentFloorZ,
  globalOrientationOffset,
}: BuildGeometry3DPrimitivesOptions): Geometry3DPrimitive[] {
  // Bake wall-derived + user-override storey heights into the floors array once, then thread
  // the effective floors through the renderer. Without this, models authored under the new
  // ensureFloorForZ (height=0) would render every storey at zero elevation.
  const allElements = Object.values(elementsById);
  const effFloors = withEffectiveStoreyHeights(floors, allElements);
  const floorElevations = getFloorElevations(effFloors);
  const floorZLookup = getFloorZLookup(effFloors);
  const primitives: Geometry3DPrimitive[] = [];

  for (const elementId of elementIds) {
    const element = elementsById[elementId];
    if (!element) continue;
    primitives.push(...mapElementTo3DPrimitives(element, elementsById, floorElevations, effFloors, floorZLookup, allElements, globalOrientationOffset, currentFloorZ));
  }

  return primitives;
}

/**
 * Absolute bottom elevation (m above model ground) for façade TB — same rules as {@link getElementBaseElevation}
 * (adjacent types use floor slab only).
 */
/**
 * Element base elevation for TB classification. `floors` must already carry effective storey
 * heights — callers run `withEffectiveStoreyHeights(floors, elements)` once at the top of their
 * proposer to bake in wall-derived heights and user overrides.
 */
export function elementBaseElevationMForTb(element: Element, floors: Floor[]): number {
  const floorElevations = getFloorElevations(floors);
  const floorZLookup = getFloorZLookup(floors);
  return getElementBaseElevation(element, floorElevations, floorZLookup);
}

/** Storey index (0 = ground) for TB classification. Doesn't need effective storey
 * heights since it only consults floor zIndex / id, not height.
 *
 * For fabric elements an explicit `floorId` outranks coordinate `z` — restoring the
 * pre-boundary-move `getElementFloorZ` semantics the TB proposers were written
 * against. Duplicate-storey hosts (the R4 ridge dedupe case: one physical ridge
 * drawn on two floors) share identical coordinates and are distinguishable only by
 * `floorId`, so the canvas resolution — which ignores `floorId` for fabric and
 * reads `coordinates[0].z` — cannot break that tie. Service/TB types stay on the
 * canvas path, which already honours `extra_json.floor_id` then `floorId` for them.
 */
export function elementFloorZIndexForTb(element: Element, floors: Floor[]): number {
  if (!physicalZUsesFloorId(element)) {
    const floorId = element.floorId?.trim();
    if (floorId) {
      const match = floors.find((f) => f.id === floorId);
      if (match) return match.zIndex;
      const numeric = Number(floorId);
      if (Number.isFinite(numeric)) return Math.floor(numeric);
    }
  }
  const floorZLookup = getFloorZLookup(floors);
  return getElementFloorZ(element, floorZLookup);
}

/**
 * Cumulative slab elevation (m) at the bottom of the given storey index. `floors` must already
 * carry effective storey heights (run `withEffectiveStoreyHeights` first).
 */
export function slabElevationMForFloorZ(floorZ: number, floors: Floor[]): number {
  const floorElevations = getFloorElevations(floors);
  return floorElevations.get(floorZ) ?? 0;
}

/**
 * Eaves / bottom elevation for an opaque polygon host — **identical** to sloped / roof prisms in the 3D
 * preview ({@link tryMapPolygonSlopedPrimitive}, {@link getOpaquePolygonBaseElevationM}). Dormer geometry
 * must use this so cutouts and `geometry_face` heights match the host surface for the same `base_height`,
 * roof-like, and `floorId` rules.
 */
export function getOpaqueHostBaseElevationAlignedWith3D(
  host: BuildingElementOpaque,
  floors: Floor[],
  elements: Element[] = [],
): number {
  const eff = withEffectiveStoreyHeights(floors, elements);
  const floorElevations = getFloorElevations(eff);
  const floorZLookup = getFloorZLookup(eff);
  const planarByZ = isPlanarAtSingleZ(host);
  return getOpaquePolygonBaseElevationM(host, floorElevations, eff, planarByZ, floorZLookup);
}
