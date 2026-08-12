// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { roundToTwoDecimals } from '../geometry/constants';
import { calculatePolygonArea } from './polygonSync';
import { isVulcanUiPartyFloorElement } from './assemblyMaterialFabric';
import { getElementShape } from './shapeUtils';
import {
  deriveSlopedElementDimensions,
  getSlopedPolygonSurfaceArea,
} from './slopedElementDimensions';
import type {
  Element,
  ElementType,
  BuildingElementOpaque,
  BuildingElementTransparent,
  BuildingElementAdjacentConditionedSpace,
  BuildingElementAdjacentUnconditionedSpace_Simple,
  BuildingElementPartyWall,
} from '../geometry/types';

type ProfilePoint = {
  t: number;
  h: number;
};

type FaceExportGeometry = {
  width: number;
  grossArea: number;
  equivalentHeight: number;
  equivalentBaseHeight: number;
};

type PlanarFace3DPoint = {
  x: number;
  y: number;
  z: number;
};

type PolygonPoint3D = {
  x: number;
  y: number;
  z: number;
};

type AreaBasedElement =
  | BuildingElementOpaque
  | BuildingElementTransparent
  | BuildingElementAdjacentConditionedSpace
  | BuildingElementAdjacentUnconditionedSpace_Simple
  | BuildingElementPartyWall;

// The "adjacent-like" trio (slice-6 brief decision 4). Until slice-6 STAGE 6,
// this constant/type/guard were duplicated verbatim in four places —
// ElementCreator.tsx, elementForms/wallShared.tsx,
// elementForms/adjacentLikeElement.tsx, and elementForms/contextShading.tsx —
// each with a header comment explaining that a module cannot import
// ElementCreator.tsx's copy without creating an orchestrator<->module import
// cycle. This file already has zero imports from components/ and is already
// a dependency of the orchestrator and of adjacentLikeElement.tsx
// (getElementGrossArea) and buildingElementOpaque.tsx, so it's cycle-free for
// every consumer; the four duplicates now import from here instead.
export const ADJACENT_LIKE_ELEMENT_TYPES: ElementType[] = [
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
];

export type AdjacentLikeElement =
  | BuildingElementAdjacentConditionedSpace
  | BuildingElementAdjacentUnconditionedSpace_Simple
  | BuildingElementPartyWall;

export function isAdjacentLikeElement(element: Element): element is AdjacentLikeElement {
  return (
    element.type === 'BuildingElementAdjacentConditionedSpace'
    || element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple'
    || element.type === 'BuildingElementPartyWall'
  );
}

export const HEM_UNHEATED_PITCHED_ROOF_MAX_PITCH_DEG = 60;

/** Opaque/transparent carry base_height; adjacent-space types do not in the type system. */
function getAreaBasedBaseHeight(element: AreaBasedElement): number {
  if (element.type === 'BuildingElementOpaque' || element.type === 'BuildingElementTransparent') {
    return element.base_height ?? 0;
  }
  return 0;
}

/** For planar faces: use typed base_height when finite; otherwise lowest vertex z. */
function baseHeightForPlanarFace(element: AreaBasedElement, fallbackMinZ: number): number {
  if (element.type === 'BuildingElementOpaque' || element.type === 'BuildingElementTransparent') {
    const bh = element.base_height;
    if (isFiniteNumber(bh)) return bh;
  }
  return fallbackMinZ;
}

const isAreaBasedBuildingElement = (
  element: Element
): element is BuildingElementOpaque | BuildingElementTransparent | BuildingElementAdjacentConditionedSpace | BuildingElementAdjacentUnconditionedSpace_Simple | BuildingElementPartyWall =>
  element.type === 'BuildingElementOpaque'
  || element.type === 'BuildingElementTransparent'
  || element.type === 'BuildingElementAdjacentConditionedSpace'
  || element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple'
  || element.type === 'BuildingElementPartyWall';

export const isUnheatedPitchedRoofPlanAreaElement = (
  element: Element,
): element is BuildingElementOpaque =>
  element.type === 'BuildingElementOpaque'
  && element.is_unheated_pitched_roof === true
  && getElementShape(element) === 'sloped-polygon'
  && element.coordinates.length >= 3
  && typeof element.pitch === 'number'
  && Number.isFinite(element.pitch)
  && element.pitch < HEM_UNHEATED_PITCHED_ROOF_MAX_PITCH_DEG;

export const getUnheatedPitchedRoofPlanArea = (
  element: BuildingElementOpaque,
): number => roundToTwoDecimals(calculatePolygonArea(element.coordinates));

export const isOpaqueExternalDoorLineElement = (
  element: Element,
): element is BuildingElementOpaque => {
  if (element.type !== 'BuildingElementOpaque' || element.is_external_door !== true) return false;
  const coordinates = Array.isArray(element.coordinates) ? element.coordinates : [];
  const hasEquivalentRectangle =
    coordinates.length === 0 &&
    typeof element.width === 'number' &&
    Number.isFinite(element.width) &&
    element.width > 0 &&
    typeof element.height === 'number' &&
    Number.isFinite(element.height) &&
    element.height > 0;
  if (getElementShape(element) !== 'line' && !hasEquivalentRectangle) return false;
  const pitch = element.pitch;
  return typeof pitch !== 'number' || !Number.isFinite(pitch) || Math.round(pitch) === 90;
};

const parsePolygonPoints = (raw: unknown): PolygonPoint3D[] => {
  if (!Array.isArray(raw)) return [];

  return raw.filter(
    (point): point is PolygonPoint3D =>
      !!point &&
      typeof point === 'object' &&
      isFiniteNumber((point as Record<string, unknown>).x) &&
      isFiniteNumber((point as Record<string, unknown>).y) &&
      isFiniteNumber((point as Record<string, unknown>).z),
  );
};

const getDormerNettingAreaOverride = (
  parentElement: BuildingElementOpaque,
  childElement: Element,
): number | null => {
  const dormerBundle = childElement.extra_json?.dormer_bundle;
  if (!dormerBundle || typeof dormerBundle !== 'object') return null;

  const bundle = dormerBundle as Record<string, unknown>;
  if (isFiniteNumber(bundle.host_cutout_surface_area) && bundle.host_cutout_surface_area >= 0) {
    return roundToTwoDecimals(bundle.host_cutout_surface_area);
  }

  const cutoutPolygon = parsePolygonPoints(bundle.cutout_polygon);
  if (cutoutPolygon.length < 3) return null;

  return getSlopedPolygonSurfaceArea(cutoutPolygon, parentElement);
};

const getParentNettingAreaOverride = (
  parentElement: BuildingElementOpaque,
  childElement: Element,
): number | null => {
  const dormerOverride = getDormerNettingAreaOverride(parentElement, childElement);
  if (dormerOverride !== null) return dormerOverride;

  const rawValue = childElement.extra_json?.parent_netting_area;
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue < 0) {
    return null;
  }

  return roundToTwoDecimals(rawValue);
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const getLineWidth = (element: { coordinates: Array<{ x: number; y: number; z: number }> }): number => {
  const [start, end] = element.coordinates;
  return Math.hypot(end.x - start.x, end.y - start.y);
};

const internalAdjacentConditionedAreaMultiplier = (element: AreaBasedElement): 1 | 2 => {
  if (element.type !== 'BuildingElementAdjacentConditionedSpace') return 1;
  if (isVulcanUiPartyFloorElement(element)) return 1;

  const shape = getElementShape(element);
  if (shape === 'line' || shape === 'polygon' || shape === 'sloped-polygon') return 2;
  return 1;
};

const interpolateProfileHeight = (profile: ProfilePoint[], t: number): number => {
  if (profile.length === 0) return 0;
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
};

const normalizeProfilePoints = (raw: unknown): ProfilePoint[] | null => {
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

  const first = deduped[0];
  const last = deduped[deduped.length - 1];

  if (first.t > 0) {
    deduped.unshift({ t: 0, h: first.h });
  } else {
    deduped[0] = { ...first, t: 0 };
  }

  if (last.t < 1) {
    deduped.push({ t: 1, h: last.h });
  } else {
    deduped[deduped.length - 1] = { ...last, t: 1 };
  }

  return deduped;
};

const getProfiledLineFaceGeometry = (
  element: AreaBasedElement,
): FaceExportGeometry | null => {
  if (element.coordinates.length !== 2) return null;

  const rawGeometry = element.extra_json?.geometry_face;
  if (!rawGeometry || typeof rawGeometry !== 'object') return null;

  const geometry = rawGeometry as Record<string, unknown>;
  if (geometry.kind !== 'profiled-line-face') return null;

  const topProfile = normalizeProfilePoints(geometry.top_profile);
  const bottomProfile = normalizeProfilePoints(geometry.bottom_profile);
  if (!topProfile || !bottomProfile) return null;

  const breakpoints = Array.from(
    new Set([...topProfile.map((point) => point.t), ...bottomProfile.map((point) => point.t)]),
  ).sort((left, right) => left - right);

  if (breakpoints.length < 2) return null;

  const topPolyline = breakpoints.map((t) => ({ t, h: interpolateProfileHeight(topProfile, t) }));
  const bottomPolyline = breakpoints.map((t) => ({ t, h: interpolateProfileHeight(bottomProfile, t) }));
  const polygon = [...topPolyline, ...[...bottomPolyline].reverse()];

  let signedAreaTwice = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    signedAreaTwice += current.t * next.h - next.t * current.h;
  }

  const signedArea = signedAreaTwice / 2;
  if (Math.abs(signedArea) < 1e-9) return null;

  const averageHeight = Math.abs(signedArea);

  const width = getLineWidth(element);
  if (width < 1e-9) return null;

  const grossArea = width * averageHeight;
  // Scalar export height/area still come from the profile polygon; base_height stays the element foot
  // (absolute bottom), not a centroid-adjusted fictitious bottom.
  const equivalentBaseHeight = roundToTwoDecimals(getAreaBasedBaseHeight(element));

  return {
    width: roundToTwoDecimals(width),
    grossArea: roundToTwoDecimals(grossArea),
    equivalentHeight: roundToTwoDecimals(averageHeight),
    equivalentBaseHeight,
  };
};

const getPlanarFace3DGeometry = (
  element: AreaBasedElement,
): FaceExportGeometry | null => {
  const rawGeometry = element.extra_json?.geometry_face;
  if (!rawGeometry || typeof rawGeometry !== 'object') return null;

  const geometry = rawGeometry as Record<string, unknown>;
  if (geometry.kind !== 'planar-face-3d' || !Array.isArray(geometry.points)) return null;

  const points = geometry.points.filter(
    (point): point is PlanarFace3DPoint =>
      !!point &&
      typeof point === 'object' &&
      isFiniteNumber((point as Record<string, unknown>).x) &&
      isFiniteNumber((point as Record<string, unknown>).y) &&
      isFiniteNumber((point as Record<string, unknown>).z),
  );
  if (points.length < 3) return null;

  const origin = points[0];
  let grossArea = 0;
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
    grossArea += 0.5 * Math.hypot(cross.x, cross.y, cross.z);
  }

  const width = roundToTwoDecimals(element.width || 0);
  const equivalentHeight = roundToTwoDecimals(
    element.height || (width > 0 ? grossArea / width : 0),
  );

  const minVertexZ = Math.min(...points.map((point) => point.z));
  return {
    width,
    grossArea: roundToTwoDecimals(element.area || grossArea),
    equivalentHeight,
    equivalentBaseHeight: roundToTwoDecimals(baseHeightForPlanarFace(element, minVertexZ)),
  };
};

const getAreaBasedFaceGeometry = (
  element: AreaBasedElement,
): FaceExportGeometry | null => {
  return getProfiledLineFaceGeometry(element) ?? getPlanarFace3DGeometry(element);
};

export const getAreaBasedElementExportGeometry = (
  element: AreaBasedElement,
): { width: number; height: number; baseHeight: number } => {
  const faceGeometry = getAreaBasedFaceGeometry(element);
  if (faceGeometry) {
    return {
      width: faceGeometry.width,
      height: faceGeometry.equivalentHeight,
      baseHeight: faceGeometry.equivalentBaseHeight,
    };
  }

  if (element.coordinates.length === 2) {
    return {
      width: roundToTwoDecimals(getLineWidth(element)),
      height: roundToTwoDecimals(element.height || 0),
      baseHeight: roundToTwoDecimals(getAreaBasedBaseHeight(element)),
    };
  }

  const slopedDimensions = deriveSlopedElementDimensions(element);
  if (slopedDimensions) {
    const widthUserOverride = (element as { _widthUserOverride?: boolean })._widthUserOverride === true;
    const heightUserOverride = (element as { _heightUserOverride?: boolean })._heightUserOverride === true;
    return {
      width: widthUserOverride ? roundToTwoDecimals(element.width || 0) : slopedDimensions.width,
      height: heightUserOverride ? roundToTwoDecimals(element.height || 0) : slopedDimensions.height,
      baseHeight: roundToTwoDecimals(getAreaBasedBaseHeight(element)),
    };
  }

  return {
    width: roundToTwoDecimals(element.width || 0),
    height: roundToTwoDecimals(element.height || 0),
    baseHeight: roundToTwoDecimals(getAreaBasedBaseHeight(element)),
  };
};

export const getOpaqueElementExportGeometry = (
  element: BuildingElementOpaque,
) => getAreaBasedElementExportGeometry(element);

/** Mid-height for CSV / engine: centre of the equivalent rectangle (base + height/2). */
export const getTransparentExportMidHeight = (element: BuildingElementTransparent): number => {
  const { baseHeight, height } = getAreaBasedElementExportGeometry(element);
  return roundToTwoDecimals(baseHeight + height / 2);
};

export const getElementGrossArea = (element: Element): number => {
  if (isAreaBasedBuildingElement(element)) {
    const shape = getElementShape(element);
    const factor = internalAdjacentConditionedAreaMultiplier(element);

    if (isUnheatedPitchedRoofPlanAreaElement(element)) {
      return roundToTwoDecimals(getUnheatedPitchedRoofPlanArea(element) * factor);
    }

    const faceGeometry = getAreaBasedFaceGeometry(element);
    if (faceGeometry) {
      return roundToTwoDecimals(faceGeometry.grossArea * factor);
    }

    if (shape === 'sloped-polygon' && element.coordinates.length >= 3) {
      const surfaceArea = getSlopedPolygonSurfaceArea(element.coordinates, element)
        ?? roundToTwoDecimals(calculatePolygonArea(element.coordinates));
      return roundToTwoDecimals(surfaceArea * factor);
    }

    if (shape === 'polygon' && element.coordinates.length >= 3) {
      const base = calculatePolygonArea(element.coordinates);
      return roundToTwoDecimals(base * factor);
    }

    if (shape === 'line' && element.coordinates.length === 2) {
      return roundToTwoDecimals(getLineWidth(element) * (element.height || 0) * factor);
    }

    return roundToTwoDecimals((element.width || 0) * (element.height || 0) * factor);
  }

  if (element.type === 'BuildingElementGround') {
    if (element.coordinates.length >= 3) {
      return roundToTwoDecimals(calculatePolygonArea(element.coordinates));
    }
    return roundToTwoDecimals(element.area || 0);
  }

  if (element.type === 'WetEmitter') {
    return roundToTwoDecimals(element.area || 0);
  }

  if (element.type === 'ThermalBridgeLinear') {
    return roundToTwoDecimals(element.length || 0);
  }

  if (element.type === 'ThermalBridgePoint') {
    return roundToTwoDecimals(element.heat_transfer_coeff || 0);
  }

  return 0;
};

export const getOpaqueOpeningArea = (
  element: BuildingElementOpaque,
  elementsById: Record<string, Element>
): number => {
  const openingArea = Object.values(elementsById).reduce((sum, child) => {
    if (
      child.zoneId === element.zoneId &&
      child.parent_element === element.name
    ) {
      const parentNettingAreaOverride = getParentNettingAreaOverride(element, child);
      if (parentNettingAreaOverride !== null) {
        return sum + parentNettingAreaOverride;
      }

      if (
        child.type === 'BuildingElementTransparent' ||
        isOpaqueExternalDoorLineElement(child)
      ) {
        return sum + getElementGrossArea(child);
      }
    }
    return sum;
  }, 0);

  return roundToTwoDecimals(openingArea);
};

export const getElementEffectiveArea = (
  element: Element,
  elementsById: Record<string, Element>
): number => {
  const grossArea = getElementGrossArea(element);

  if (element.type === 'BuildingElementOpaque') {
    return roundToTwoDecimals(Math.max(0, grossArea - getOpaqueOpeningArea(element, elementsById)));
  }

  return grossArea;
};
