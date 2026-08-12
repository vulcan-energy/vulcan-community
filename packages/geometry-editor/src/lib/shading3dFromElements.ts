// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Builds 3D primitives for WindowShading and ContextShading from parent geometry
 * and CSV dimensions (not Three.js lighting).
 *
 * WindowShading horizontal “outward” matches the 2D canvas opening arrow (`openingSegmentOutward.ts`), not `orientation360`.
 */
import * as THREE from 'three';
import type { BuildingElementOpaque, BuildingElementTransparent, Element } from '../geometry/types';
import { modelXYToThreeXZ } from './geometryTransform';
import { frameInsetFromFrameAreaFraction } from './geometryVentilationOverlay';
import type { OrientedBoxPrimitive, PolygonPrismPrimitive } from './geometry3dPrimitivesTypes';
import { segmentTangentAndOpeningOutwardModelXY } from './openingSegmentOutward';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * HEM / CSV: `orientation360` is compass bearing of the **external surface** (direction the façade faces: N=0, E=90,
 * S=180, W=270, clockwise from north). Model plan uses +Y = north, +X = east; this maps bearing to outward unit
 * vector in that frame (sin θ, cos θ) with θ in degrees clockwise from north.
 */
export function outwardNormalModelFromOrientation360(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

function findTransparentByNameOrId(
  elementsById: Record<string, Element>,
  nameOrId: string | null,
  zoneId?: string,
): BuildingElementTransparent | null {
  if (!nameOrId) return null;
  const candidates = Object.values(elementsById);
  for (const el of candidates) {
    if (el.type !== 'BuildingElementTransparent') continue;
    if (el.id === nameOrId) return el;
  }
  for (const el of candidates) {
    if (el.type !== 'BuildingElementTransparent') continue;
    if (el.name === nameOrId && (!zoneId || el.zoneId === zoneId)) return el;
  }
  return null;
}

function findElementByNameOrId(
  elementsById: Record<string, Element>,
  nameOrId: string | null,
): Element | null {
  if (!nameOrId) return null;
  for (const el of Object.values(elementsById)) {
    if (el.id === nameOrId) return el;
  }
  for (const el of Object.values(elementsById)) {
    if (el.name === nameOrId) return el;
  }
  return null;
}

function polygonCentroid2D(coords: Array<{ x: number; y: number }>): [number, number] {
  if (coords.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const c of coords) {
    sx += c.x;
    sy += c.y;
  }
  return [sx / coords.length, sy / coords.length];
}

/** Same rules as geometry3dMapper — closed ring without duplicate closing vertex. */
function sanitizeClosedPolygonRing(points: Array<[number, number]>): Array<[number, number]> {
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
 * Resolve degrees to use for “outward” from window + model. Host opaque wall (`parent_element` / CSV `linked_wall`)
 * is preferred when present so canvas 3D matches the wall the opening sits in.
 */
export function getOutwardOrientationDegreesForWindow(
  windowEl: BuildingElementTransparent,
  elementsById: Record<string, Element>,
): number | null {
  const wallKey = windowEl.parent_element;
  if (wallKey) {
    const wall = findElementByNameOrId(elementsById, wallKey);
    if (wall?.type === 'BuildingElementOpaque') {
      const o = (wall as BuildingElementOpaque).orientation360;
      if (isFiniteNumber(o)) return o;
    }
  }
  const w = windowEl.orientation360;
  if (isFiniteNumber(w)) return w;
  const coerced = Number(w);
  return isFiniteNumber(coerced) ? coerced : null;
}

/**
 * Unit outward normal **in the wall plane** from `orientation360`: compass outward from `outwardNormalModelFromOrientation360`,
 * minus the component along the wall tangent (projection onto the façade normal). Same result as choosing the
 * segment’s left vs right normal when the compass vector is already perpendicular to the wall.
 */
export function wallPlaneOutwardUnitFromOrientation360(
  orientationDeg: number,
  tangent: [number, number],
): [number, number] | null {
  const [hx, hy] = outwardNormalModelFromOrientation360(orientationDeg);
  const tx = tangent[0];
  const ty = tangent[1];
  const along = hx * tx + hy * ty;
  const px = hx - along * tx;
  const py = hy - along * ty;
  const len = Math.hypot(px, py);
  if (len < 1e-10) return null;
  return [px / len, py / len];
}

/** @deprecated Prefer {@link wallPlaneOutwardUnitFromOrientation360}; kept for tests — equivalent when hem ⊥ wall. */
export function pickOutwardNormalMatchingOrientation(
  orientationDeg: number,
  nLeft: [number, number],
  nRight: [number, number],
): [number, number] {
  const [ox, oy] = outwardNormalModelFromOrientation360(orientationDeg);
  const dotL = ox * nLeft[0] + oy * nLeft[1];
  const dotR = ox * nRight[0] + oy * nRight[1];
  return dotL >= dotR ? nLeft : nRight;
}

/**
 * Local box axes: X = along opening, Y = vertical slab thickness, Z = depth toward 2D opening-arrow / segment sense (horizontal).
 * `makeBasis(tangent, up, outward)` is often a **reflection** (det −1) when outward lies in the XZ plane with
 * tangent and world-up — `Quaternion.setFromRotationMatrix` then yields a wrong / mirrored orientation and the
 * overhang appears on the wrong side. Force a **proper** rotation in SO(3) by flipping the tangent column when needed
 * (width is symmetric).
 */
export function buildWindowShadingBoxQuaternion(
  tangentXz: THREE.Vector3,
  up: THREE.Vector3,
  outwardXz: THREE.Vector3,
): [number, number, number, number] {
  const x = tangentXz.clone().normalize();
  const y = up.clone().normalize();
  const z = outwardXz.clone().normalize();
  const m = new THREE.Matrix4();
  m.makeBasis(x, y, z);
  if (m.determinant() < 0) {
    x.negate();
    m.makeBasis(x, y, z);
  }
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  return [q.x, q.y, q.z, q.w];
}

const WINDOW_SHADING_COLOR = '#38bdf8';
const CONTEXT_SHADING_COLOR = '#64748b';
const DEFAULT_OVERHANG_DEPTH_M = 0.35;
const DEFAULT_SLAB_THICKNESS_M = 0.08;
const FIN_THICKNESS_M = 0.06;
const OBJECT_SCREEN_THICKNESS_M = 0.04;
const SPLIT_REVEAL_MATCH_EPSILON_M = 1e-6;

type WindowShadingElement = Element & {
  type: 'WindowShading';
  shading_type?: string;
  depth?: number;
  distance?: number;
  parent_element?: string | null;
};

function resolveWindowShadingDepthForMatch(shading: WindowShadingElement): number {
  return isFiniteNumber(shading.depth) && shading.depth > 0 ? shading.depth : DEFAULT_OVERHANG_DEPTH_M;
}

function resolveWindowShadingDistanceForMatch(shading: WindowShadingElement): number {
  return isFiniteNumber(shading.distance) ? shading.distance : 0;
}

function sameResolvedShadingSpec(
  shading: WindowShadingElement,
  depth: number,
  distance: number,
): boolean {
  return (
    Math.abs(resolveWindowShadingDepthForMatch(shading) - depth) <= SPLIT_REVEAL_MATCH_EPSILON_M &&
    Math.abs(resolveWindowShadingDistanceForMatch(shading) - distance) <= SPLIT_REVEAL_MATCH_EPSILON_M
  );
}

function hasMatchingWindowShadingSibling(
  shading: WindowShadingElement,
  elementsById: Record<string, Element>,
  shadingType: 'overhang' | 'sidefinleft' | 'sidefinright',
  depth: number,
  distance: number,
): boolean {
  return Object.values(elementsById).some((candidate): candidate is WindowShadingElement => (
    candidate.id !== shading.id &&
    candidate.type === 'WindowShading' &&
    (candidate as WindowShadingElement).shading_type === shadingType &&
    (candidate as WindowShadingElement).parent_element === shading.parent_element &&
    candidate.zoneId === shading.zoneId &&
    sameResolvedShadingSpec(candidate as WindowShadingElement, depth, distance)
  ));
}

function resolveGlazedAperture(
  windowEl: BuildingElementTransparent,
  fullWidth: number,
  fullHeight: number,
  sill: number,
): { width: number; height: number; sill: number; head: number } | null {
  const frameFrac = isFiniteNumber(windowEl.frame_area_fraction)
    ? windowEl.frame_area_fraction
    : 0;
  const inset = frameFrac > 0
    ? frameInsetFromFrameAreaFraction(frameFrac, fullWidth, fullHeight)
    : 0;
  const width = fullWidth - 2 * inset;
  const height = fullHeight - 2 * inset;
  if (width <= 1e-6 || height <= 1e-6) return null;
  const glassSill = sill + inset;
  return {
    width,
    height,
    sill: glassSill,
    head: glassSill + height,
  };
}

export function buildWindowShadingOrientedBoxes(
  shading: Element & { type: 'WindowShading' },
  elementsById: Record<string, Element>,
  floorElevations: Map<number, number>,
  getElementBaseElevation: (el: Element, fe: Map<number, number>) => number,
  getElementFloorZ: (el: Element) => number,
  isElementOnCurrentFloor: (el: Element, cf?: number) => boolean,
  currentFloorZ?: number,
  color = WINDOW_SHADING_COLOR,
): OrientedBoxPrimitive[] | null {
  const parent = findTransparentByNameOrId(
    elementsById,
    shading.parent_element,
    shading.zoneId,
  );
  if (!parent?.coordinates || parent.coordinates.length !== 2) return null;

  const [a, b] = parent.coordinates;
  if (!a || !b) return null;
  const { tangent, openingOutward: outward } = segmentTangentAndOpeningOutwardModelXY(a.x, a.y, b.x, b.y);

  const winW = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;

  const winHeight = isFiniteNumber((parent as BuildingElementTransparent).height)
    ? (parent as BuildingElementTransparent).height
    : 1.2;
  // Same sill as wall-segment windows: getElementBaseElevation already applies base_height
  // (absolute m above ground per HEM), so do not add base_height again.
  const sill = getElementBaseElevation(parent, floorElevations);
  const glass = resolveGlazedAperture(parent as BuildingElementTransparent, winW, winHeight, sill);
  if (!glass) return null;

  const depth = isFiniteNumber(shading.depth) && shading.depth! > 0 ? shading.depth! : DEFAULT_OVERHANG_DEPTH_M;
  const distance = isFiniteNumber(shading.distance) ? shading.distance! : 0;

  const up = new THREE.Vector3(0, 1, 0);
  const [tax, taz] = modelXYToThreeXZ([tangent[0], tangent[1]]);
  const tangentXz = new THREE.Vector3(tax, 0, taz).normalize();
  const [oax, oaz] = modelXYToThreeXZ(outward);
  const outwardXz = new THREE.Vector3(oax, 0, oaz).normalize();
  const q = buildWindowShadingBoxQuaternion(tangentXz, up, outwardXz);

  const isCurrent = isElementOnCurrentFloor(shading, currentFloorZ);
  const floorZ = getElementFloorZ(shading);

  const boxes: OrientedBoxPrimitive[] = [];

  const pushBox = (
    centerModelX: number,
    centerModelY: number,
    centerYM: number,
    size: [number, number, number],
    boxOpacity: number = 0.92,
  ) => {
    const [cx, cz] = modelXYToThreeXZ([centerModelX, centerModelY]);
    boxes.push({
      kind: 'oriented-box',
      elementId: shading.id,
      elementType: 'WindowShading',
      floorZ,
      position: [cx, centerYM, cz],
      quaternion: q,
      size,
      color,
      opacity: boxOpacity,
      isCurrentFloor: isCurrent,
    });
  };

  switch (shading.shading_type) {
    case 'overhang': {
      const t = DEFAULT_SLAB_THICKNESS_M;
      const gap = Math.max(0, distance);
      const hasLeftFin = hasMatchingWindowShadingSibling(shading, elementsById, 'sidefinleft', depth, distance);
      const hasRightFin = hasMatchingWindowShadingSibling(shading, elementsById, 'sidefinright', depth, distance);
      const leftExtension = hasLeftFin ? gap + FIN_THICKNESS_M : 0;
      const rightExtension = hasRightFin ? gap + FIN_THICKNESS_M : 0;
      const tangentShift = (rightExtension - leftExtension) / 2;
      const centerPlanX = midX + tangent[0] * tangentShift + outward[0] * (depth / 2);
      const centerPlanY = midY + tangent[1] * tangentShift + outward[1] * (depth / 2);
      const centerY = glass.head + Math.max(0, distance) + t / 2;
      pushBox(centerPlanX, centerPlanY, centerY, [glass.width + leftExtension + rightExtension, t, depth]);
      break;
    }
    case 'sidefinleft': {
      const finD = depth;
      const hasOverhang = hasMatchingWindowShadingSibling(shading, elementsById, 'overhang', depth, distance);
      const lateralOffset = glass.width / 2 + Math.max(0, distance) + FIN_THICKNESS_M / 2;
      const leftMidX = midX - tangent[0] * lateralOffset;
      const leftMidY = midY - tangent[1] * lateralOffset;
      const cx = leftMidX + outward[0] * (finD / 2);
      const cy = leftMidY + outward[1] * (finD / 2);
      const finHeight = hasOverhang
        ? glass.height + Math.max(0, distance) + DEFAULT_SLAB_THICKNESS_M
        : glass.height;
      const centerY = glass.sill + finHeight / 2;
      pushBox(cx, cy, centerY, [FIN_THICKNESS_M, finHeight, finD]);
      break;
    }
    case 'sidefinright': {
      const finD = depth;
      const hasOverhang = hasMatchingWindowShadingSibling(shading, elementsById, 'overhang', depth, distance);
      const lateralOffset = glass.width / 2 + Math.max(0, distance) + FIN_THICKNESS_M / 2;
      const rightMidX = midX + tangent[0] * lateralOffset;
      const rightMidY = midY + tangent[1] * lateralOffset;
      const cx = rightMidX + outward[0] * (finD / 2);
      const cy = rightMidY + outward[1] * (finD / 2);
      const finHeight = hasOverhang
        ? glass.height + Math.max(0, distance) + DEFAULT_SLAB_THICKNESS_M
        : glass.height;
      const centerY = glass.sill + finHeight / 2;
      pushBox(cx, cy, centerY, [FIN_THICKNESS_M, finHeight, finD]);
      break;
    }
    case 'reveal': {
      const revealD = depth;
      const gap = Math.max(0, distance);
      const sideT = FIN_THICKNESS_M;
      const topT = DEFAULT_SLAB_THICKNESS_M;
      const centerPlanX = midX + outward[0] * (revealD / 2);
      const centerPlanY = midY + outward[1] * (revealD / 2);

      pushBox(
        centerPlanX,
        centerPlanY,
        glass.head + gap + topT / 2,
        [glass.width + 2 * gap + 2 * sideT, topT, revealD],
        0.82,
      );

      const sideHeight = glass.height + gap + topT;
      const sideCenterY = glass.sill + sideHeight / 2;
      const leftMidX = midX - tangent[0] * (glass.width / 2 + gap + sideT / 2);
      const leftMidY = midY - tangent[1] * (glass.width / 2 + gap + sideT / 2);
      pushBox(
        leftMidX + outward[0] * (revealD / 2),
        leftMidY + outward[1] * (revealD / 2),
        sideCenterY,
        [sideT, sideHeight, revealD],
        0.82,
      );

      const rightMidX = midX + tangent[0] * (glass.width / 2 + gap + sideT / 2);
      const rightMidY = midY + tangent[1] * (glass.width / 2 + gap + sideT / 2);
      pushBox(
        rightMidX + outward[0] * (revealD / 2),
        rightMidY + outward[1] * (revealD / 2),
        sideCenterY,
        [sideT, sideHeight, revealD],
        0.82,
      );
      break;
    }
    case 'object': {
      const objH = isFiniteNumber(shading.height) && shading.height! > 0 ? shading.height! : glass.height * 0.8;
      const dist = distance > 0 ? distance : 0.4;
      const transparency = isFiniteNumber(shading.transparency) ? shading.transparency! : 0;
      const cx = midX + outward[0] * (dist + OBJECT_SCREEN_THICKNESS_M / 2);
      const cy = midY + outward[1] * (dist + OBJECT_SCREEN_THICKNESS_M / 2);
      const centerY = objH / 2;
      const opacity = Math.max(0.35, 0.9 - (0.45 * Math.max(0, Math.min(1, transparency))));
      pushBox(cx, cy, centerY, [glass.width, objH, OBJECT_SCREEN_THICKNESS_M], opacity);
      break;
    }
    default:
      return null;
  }

  return boxes.length > 0 ? boxes : null;
}

/**
 * Context shading 3D:
 * - **Polygon mode (matches 2D):** when `coordinates` has a closed ring (≥3 vertices), extrude
 *   that footprint by `height`. This is what the canvas draws as the red shaded area.
 * - **Fallback:** if there is no usable polygon (e.g. CSV-only / placeholder), build a horizontal
 *   sector from start/end angle and `distance` relative to the parent or shading centroid.
 *
 * Important: `distance` in the model is often “center-to-center” vs the parent for labels — it must
 * **not** be used as a sector radius when the user has already drawn an explicit polygon.
 */
export function buildContextShadingSectorPrism(
  shading: Element & { type: 'ContextShading' },
  elementsById: Record<string, Element>,
  floorElevations: Map<number, number>,
  getElementBaseElevation: (el: Element, fe: Map<number, number>) => number,
  getElementFloorZ: (el: Element) => number,
  isElementOnCurrentFloor: (el: Element, cf?: number) => boolean,
  currentFloorZ?: number,
  color = CONTEXT_SHADING_COLOR,
): PolygonPrismPrimitive | null {
  const heightM = isFiniteNumber(shading.height) && shading.height > 0 ? shading.height : 2;
  const floorZ = getElementFloorZ(shading);

  if (shading.coordinates && shading.coordinates.length >= 3) {
    const raw = shading.coordinates
      .filter((c) => isFiniteNumber(c.x) && isFiniteNumber(c.y))
      .map((c) => [c.x, c.y] as [number, number]);
    const points = sanitizeClosedPolygonRing(raw);
    if (points.length >= 3) {
      const baseElevationM = getElementBaseElevation(shading, floorElevations);
      return {
        kind: 'polygon-prism',
        elementId: shading.id,
        elementType: 'ContextShading',
        floorZ,
        points,
        baseElevationM,
        heightM,
        color,
        isOpening: false,
        isCurrentFloor: isElementOnCurrentFloor(shading, currentFloorZ),
      };
    }
  }

  const dist = isFiniteNumber(shading.distance) && shading.distance > 0 ? shading.distance : 2;
  let ox: number;
  let oy: number;

  const parent = shading.parent_element
    ? findElementByNameOrId(elementsById, shading.parent_element)
    : null;
  if (parent?.coordinates && parent.coordinates.length >= 3) {
    const pts = parent.coordinates.map((c) => ({ x: c.x, y: c.y }));
    [ox, oy] = polygonCentroid2D(pts);
  } else if (shading.coordinates?.length) {
    [ox, oy] = polygonCentroid2D(shading.coordinates.map((c) => ({ x: c.x, y: c.y })));
  } else {
    return null;
  }

  const startDeg = isFiniteNumber(shading.start_angle) ? shading.start_angle : 0;
  const endDeg = isFiniteNumber(shading.end_angle) ? shading.end_angle : 45;
  let a0 = (startDeg * Math.PI) / 180;
  let a1 = (endDeg * Math.PI) / 180;
  if (a1 < a0) [a0, a1] = [a1, a0];

  const segments = Math.max(8, Math.ceil((a1 - a0) / ((15 * Math.PI) / 180)));
  const points: Array<[number, number]> = [[ox, oy]];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const a = a0 + t * (a1 - a0);
    const x = ox + dist * Math.sin(a);
    const y = oy + dist * Math.cos(a);
    points.push([x, y]);
  }

  const baseElevationM = getElementBaseElevation(shading, floorElevations);

  return {
    kind: 'polygon-prism',
    elementId: shading.id,
    elementType: 'ContextShading',
    floorZ,
    points,
    baseElevationM,
    heightM,
    color,
    isOpening: false,
    isCurrentFloor: isElementOnCurrentFloor(shading, currentFloorZ),
  };
}
