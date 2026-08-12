// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import type { Geometry3DPrimitive } from './geometry3dPrimitivesTypes';
import { elevationAtSlopedVertexM } from './geometry3dSloped';
import { slopeHingeContourSegment } from './slopePitchAxis';
import { getElementShape } from './shapeUtils';
import { projectSegmentOntoParent } from './snapUtils';

export type Geometry3DElevationMode = 'coordinates-z' | 'base_height' | '_base_height' | 'unheated-pitched-roof-ceiling';

export type Geometry3DEditVertexHandle = {
  elementId: string;
  vertexIndex: number;
  modelXY: { x: number; y: number };
  handleElevationM: number;
  supportsElevation: boolean;
  connectedCount: number;
};

export type Geometry3DEditElevationHandle = {
  elementId: string;
  modelXY: { x: number; y: number };
  valueM: number;
  stemBaseElevationM: number;
  capElevationM: number;
  mode: Geometry3DElevationMode;
};

export type Geometry3DEditPitchHandle = {
  elementId: string;
  modelXY: { x: number; y: number };
  elevationM: number;
  eavesModelXY: { x: number; y: number };
  eavesElevationM: number;
  valueDeg: number;
};

export type Geometry3DEditHandleModel = {
  elementId: string;
  modelCenter: { x: number; y: number };
  planHandleElevationM: number;
  vertexHandles: Geometry3DEditVertexHandle[];
  elementElevationHandle: Geometry3DEditElevationHandle | null;
  pitchHandle: Geometry3DEditPitchHandle | null;
  ceilingElevationHandle: Geometry3DEditElevationHandle | null;
};

const SURFACE_PLAN_HANDLE_OFFSET_M = 0.18;
const PITCH_HANDLE_SURFACE_OFFSET_M = 0.24;
const ELEVATION_HANDLE_STEM_OFFSET_M = 0.14;
const ELEVATION_HANDLE_RISE_M = 0.6;

const PHYSICAL_Z_ELEMENT_TYPES = new Set<Element['type']>([
  'ThermalBridgeLinear',
  'ThermalBridgePoint',
  'WaterPipework',
  'MechanicalVentilationDuctwork',
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSlopedPrimitive(
  primitive: Geometry3DPrimitive,
): primitive is Extract<Geometry3DPrimitive, { kind: 'polygon-sloped' }> {
  return primitive.kind === 'polygon-sloped';
}

function isPlanarFacePrimitive(
  primitive: Geometry3DPrimitive,
): primitive is Extract<Geometry3DPrimitive, { kind: 'planar-face' }> {
  return primitive.kind === 'planar-face';
}

export function usesCoordinateZElevation(element: Pick<Element, 'type'>): boolean {
  return PHYSICAL_Z_ELEMENT_TYPES.has(element.type);
}

function editableBaseHeightKey(element: Element): 'base_height' | '_base_height' | null {
  if (usesCoordinateZElevation(element)) return null;

  if (
    element.type === 'BuildingElementOpaque' ||
    element.type === 'BuildingElementTransparent' ||
    element.type === 'OnSiteGeneration'
  ) {
    return 'base_height';
  }

  if (
    element.type === 'BuildingElementGround' ||
    element.type === 'BuildingElementAdjacentConditionedSpace' ||
    element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple'
  ) {
    return '_base_height';
  }

  if (element.type === 'BuildingElementPartyWall') {
    return isFiniteNumber((element as { _base_height?: unknown })._base_height) ? '_base_height' : 'base_height';
  }

  if (isFiniteNumber((element as { base_height?: unknown }).base_height)) return 'base_height';
  if (isFiniteNumber((element as { _base_height?: unknown })._base_height)) return '_base_height';
  return null;
}

function primitiveElevationBounds(primitive: Geometry3DPrimitive): { min: number; max: number } | null {
  if (primitive.kind === 'wall-segment' || primitive.kind === 'polygon-prism') {
    return {
      min: primitive.baseElevationM,
      max: primitive.baseElevationM + primitive.heightM,
    };
  }
  if (primitive.kind === 'point-marker') {
    return {
      min: primitive.baseElevationM,
      max: primitive.baseElevationM + primitive.radiusM * 2,
    };
  }
  if (primitive.kind === 'thermal-bridge-vertical-line') {
    return { min: primitive.zBottomM, max: primitive.zTopM };
  }
  if (primitive.kind === 'thermal-bridge-sloped-line') {
    return {
      min: Math.min(primitive.start[1], primitive.end[1]),
      max: Math.max(primitive.start[1], primitive.end[1]),
    };
  }
  if (primitive.kind === 'oriented-box') {
    return {
      min: primitive.position[1] - primitive.size[1] / 2,
      max: primitive.position[1] + primitive.size[1] / 2,
    };
  }
  if (primitive.kind === 'planar-face') {
    const ys = primitive.points.map((point) => point[1]).filter(isFiniteNumber);
    if (ys.length === 0) return null;
    return { min: Math.min(...ys), max: Math.max(...ys) };
  }
  if (primitive.kind === 'polygon-sloped') {
    const elevations = primitive.points.map((point) => elevationAtSlopedVertexM(
      point,
      primitive.hingeAnchorXY,
      primitive.inwardNormal2D,
      primitive.baseElevationM,
      primitive.pitchDeg,
    ));
    if (elevations.length === 0) return null;
    return { min: Math.min(...elevations), max: Math.max(...elevations) + Math.max(primitive.thicknessM, 0.02) };
  }
  return null;
}

function elementPrimitiveBounds(primitives: Geometry3DPrimitive[]): { min: number; max: number; mid: number } {
  const bounds = primitives
    .map(primitiveElevationBounds)
    .filter((bound): bound is { min: number; max: number } => bound !== null);
  if (bounds.length === 0) return { min: 0, max: 0.2, mid: 0.1 };
  const min = Math.min(...bounds.map((bound) => bound.min));
  const max = Math.max(...bounds.map((bound) => bound.max));
  return { min, max, mid: (min + max) / 2 };
}

function averageCoordinateXY(coords: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (coords.length === 0) return { x: 0, y: 0 };
  const sum = coords.reduce(
    (acc, coord) => ({ x: acc.x + coord.x, y: acc.y + coord.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / coords.length, y: sum.y / coords.length };
}

function averagePointXY(points: Array<[number, number]>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point[0], y: acc.y + point[1] }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function averagePlanarFaceXY(points: Array<[number, number, number]>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point[0], y: acc.y + point[2] }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function averagePlanarFaceElevation(points: Array<[number, number, number]>): number | null {
  const elevations = points.map((point) => point[1]).filter(isFiniteNumber);
  if (elevations.length === 0) return null;
  return elevations.reduce((sum, elevation) => sum + elevation, 0) / elevations.length;
}

function elevationHandleForValue(
  elementId: string,
  modelXY: { x: number; y: number },
  valueM: number,
  mode: Geometry3DElevationMode,
): Geometry3DEditElevationHandle {
  return {
    elementId,
    modelXY,
    valueM,
    stemBaseElevationM: valueM + ELEVATION_HANDLE_STEM_OFFSET_M,
    capElevationM: valueM + ELEVATION_HANDLE_STEM_OFFSET_M + ELEVATION_HANDLE_RISE_M,
    mode,
  };
}

function buildSlopedHandleAnchors(
  primitive: Extract<Geometry3DPrimitive, { kind: 'polygon-sloped' }> | undefined,
): {
  planModelXY: { x: number; y: number };
  planElevationM: number;
  eavesModelXY: { x: number; y: number };
  pitchModelXY: { x: number; y: number };
  pitchElevationM: number;
} | null {
  if (!primitive || primitive.points.length < 2) return null;
  const eavesAnchor = primitive.hingeAnchorXY;
  const planModelXY = averagePointXY(primitive.points);
  const planSurfaceElevationM = elevationAtSlopedVertexM(
    [planModelXY.x, planModelXY.y],
    eavesAnchor,
    primitive.inwardNormal2D,
    primitive.baseElevationM,
    primitive.pitchDeg,
  );
  const distances = primitive.points.map((point) => Math.max(0, (
    (point[0] - eavesAnchor[0]) * primitive.inwardNormal2D[0] +
    (point[1] - eavesAnchor[1]) * primitive.inwardNormal2D[1]
  )));
  const maxDistance = Math.max(...distances);
  const hingeSegment = primitive.pitchAxis === 'orientation'
    ? slopeHingeContourSegment(primitive.points, primitive.hingeAnchorXY, primitive.inwardNormal2D)
      ?? [primitive.points[0], primitive.points[1]] as [[number, number], [number, number]]
    : [primitive.points[0], primitive.points[1]] as [[number, number], [number, number]];
  const eavesModelXY = {
    x: (hingeSegment[0][0] + hingeSegment[1][0]) / 2,
    y: (hingeSegment[0][1] + hingeSegment[1][1]) / 2,
  };
  const pitchModelXY = {
    x: eavesModelXY.x + primitive.inwardNormal2D[0] * maxDistance,
    y: eavesModelXY.y + primitive.inwardNormal2D[1] * maxDistance,
  };
  const pitchSurfaceElevationM = elevationAtSlopedVertexM(
    [pitchModelXY.x, pitchModelXY.y],
    eavesAnchor,
    primitive.inwardNormal2D,
    primitive.baseElevationM,
    primitive.pitchDeg,
  );

  return {
    planModelXY,
    planElevationM: planSurfaceElevationM + SURFACE_PLAN_HANDLE_OFFSET_M,
    eavesModelXY,
    pitchModelXY,
    pitchElevationM: pitchSurfaceElevationM + PITCH_HANDLE_SURFACE_OFFSET_M,
  };
}

function editableElevationValue(element: Element, mode: Geometry3DElevationMode, fallbackM: number): number {
  if (mode === 'coordinates-z') {
    const coords = element.coordinates ?? [];
    const zs = coords.map((coord) => coord.z).filter(isFiniteNumber);
    if (zs.length > 0) return zs.reduce((sum, z) => sum + z, 0) / zs.length;
    return fallbackM;
  }
  const raw = (element as unknown as Record<string, unknown>)[mode];
  return isFiniteNumber(raw) ? raw : fallbackM;
}

export function countCoincidentVertices(
  elementsById: Record<string, Element>,
  elementId: string,
  vertexIndex: number,
): number {
  const element = elementsById[elementId];
  const source = element?.coordinates?.[vertexIndex];
  if (!source) return 1;
  let count = 0;
  for (const candidate of Object.values(elementsById)) {
    const coords = candidate?.coordinates ?? [];
    for (const coord of coords) {
      if (coord.x === source.x && coord.y === source.y && coord.z === source.z) {
        count += 1;
      }
    }
  }
  return Math.max(1, count);
}

export function buildSharedVertexPositionUpdates(
  elementsById: Record<string, Element>,
  elementId: string,
  vertexIndex: number,
  newPosition: { x: number; y: number; z: number },
  mode: 'plan' | 'elevation' | 'all',
): Array<{ elementId: string; vertexIndex: number; newPosition: { x: number; y: number; z: number } }> {
  const element = elementsById[elementId];
  const source = element?.coordinates?.[vertexIndex];
  if (!source) return [];

  const updates: Array<{ elementId: string; vertexIndex: number; newPosition: { x: number; y: number; z: number } }> = [];
  const push = (targetElement: Element, targetVertexIndex: number, current: { x: number; y: number; z: number }) => {
    updates.push({
      elementId: targetElement.id,
      vertexIndex: targetVertexIndex,
      newPosition: {
        x: mode === 'elevation' ? current.x : newPosition.x,
        y: mode === 'elevation' ? current.y : newPosition.y,
        z: mode === 'plan' ? current.z : newPosition.z,
      },
    });
  };

  for (const candidate of Object.values(elementsById)) {
    const coords = candidate?.coordinates ?? [];
    for (let index = 0; index < coords.length; index += 1) {
      const coord = coords[index];
      if (!coord) continue;
      if (coord.x === source.x && coord.y === source.y && coord.z === source.z) {
        push(candidate, index, coord);
      }
    }
  }

  return updates;
}

export function isParentConstrainedLineElement(element: Element | undefined): boolean {
  if (!element?.coordinates || element.coordinates.length !== 2) return false;
  const parentElement = (element as { parent_element?: unknown }).parent_element;
  if (typeof parentElement !== 'string' || parentElement.trim() === '') return false;
  if (element.type === 'BuildingElementTransparent') return true;
  return element.type === 'BuildingElementOpaque' && (element as { is_external_door?: unknown }).is_external_door === true;
}

export function projectParentConstrainedLineCoordinates(
  element: Element,
  coordinates: Array<{ x: number; y: number; z: number }>,
  elementsById: Record<string, Element>,
): Array<{ x: number; y: number; z: number }> {
  if (!isParentConstrainedLineElement(element) || coordinates.length !== 2) return coordinates;
  const parentName = ((element as { parent_element?: unknown }).parent_element as string).trim();
  const parent = Object.values(elementsById).find((candidate) => candidate?.name === parentName);
  if (!parent?.coordinates || parent.coordinates.length !== 2) return coordinates;
  return projectSegmentOntoParent(coordinates, parent.coordinates);
}

export function buildGeometry3DEditHandleModel(
  element: Element | undefined,
  primitives: Geometry3DPrimitive[],
  elementsById: Record<string, Element>,
): Geometry3DEditHandleModel | null {
  if (!element?.coordinates || element.coordinates.length === 0) return null;

  const coords = element.coordinates;
  const shape = getElementShape(element);
  const elementPrimitives = primitives.filter((primitive) => primitive.elementId === element.id);
  const slopedPrimitive = elementPrimitives.find(isSlopedPrimitive);
  const ceilingPrimitive = elementPrimitives.find(isPlanarFacePrimitive);
  const slopedAnchors = buildSlopedHandleAnchors(slopedPrimitive);
  const primitiveBounds = elementPrimitiveBounds(elementPrimitives);
  const physicalZ = usesCoordinateZElevation(element);
  const modelCenter = slopedAnchors?.planModelXY ?? averageCoordinateXY(coords);
  const planHandleElevationM = physicalZ
    ? editableElevationValue(element, 'coordinates-z', primitiveBounds.mid)
    : (slopedAnchors?.planElevationM ?? primitiveBounds.mid);

  const vertexHandles =
    shape === 'line'
      ? coords.map((coord, vertexIndex) => ({
          elementId: element.id,
          vertexIndex,
          modelXY: { x: coord.x, y: coord.y },
          handleElevationM: physicalZ && isFiniteNumber(coord.z) ? coord.z : primitiveBounds.mid,
          supportsElevation: physicalZ,
          connectedCount: countCoincidentVertices(elementsById, element.id, vertexIndex),
        }))
      : [];

  const baseHeightKey = editableBaseHeightKey(element);
  const elevationMode: Geometry3DElevationMode | null = physicalZ
    ? 'coordinates-z'
    : baseHeightKey;
  const elementElevationHandle = elevationMode
    ? slopedAnchors && elevationMode !== 'coordinates-z'
      ? elevationHandleForValue(
          element.id,
          slopedAnchors.eavesModelXY,
          editableElevationValue(element, elevationMode, primitiveBounds.min),
          elevationMode,
        )
      : {
          elementId: element.id,
          modelXY: modelCenter,
          valueM: editableElevationValue(element, elevationMode, primitiveBounds.min),
          stemBaseElevationM: primitiveBounds.max + ELEVATION_HANDLE_STEM_OFFSET_M,
          capElevationM: primitiveBounds.max + ELEVATION_HANDLE_STEM_OFFSET_M + ELEVATION_HANDLE_RISE_M,
          mode: elevationMode,
        }
    : null;
  const pitchHandle = slopedPrimitive && slopedAnchors
    ? {
        elementId: element.id,
        modelXY: slopedAnchors.pitchModelXY,
        elevationM: slopedAnchors.pitchElevationM,
        eavesModelXY: slopedAnchors.eavesModelXY,
        eavesElevationM: slopedPrimitive.baseElevationM + ELEVATION_HANDLE_STEM_OFFSET_M,
        valueDeg: slopedPrimitive.pitchDeg,
      }
    : null;
  const ceilingElevation = ceilingPrimitive ? averagePlanarFaceElevation(ceilingPrimitive.points) : null;
  const ceilingElevationHandle = slopedPrimitive && ceilingPrimitive && ceilingElevation !== null
    ? elevationHandleForValue(
        element.id,
        averagePlanarFaceXY(ceilingPrimitive.points),
        ceilingElevation,
        'unheated-pitched-roof-ceiling',
      )
    : null;

  return {
    elementId: element.id,
    modelCenter,
    planHandleElevationM,
    vertexHandles,
    elementElevationHandle,
    pitchHandle,
    ceilingElevationHandle,
  };
}
