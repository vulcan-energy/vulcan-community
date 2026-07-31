// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Floor, MechanicalVentilation } from '../geometry/types';
import {
  applyMechanicalVentilationCsvPositionColumns,
  canMechanicalVentilationInheritHostPlacement,
} from './mechanicalVentilationBranches';
import { syncWindowSecurityRiskForStorey } from './windowSecurityRisk';

type ElementCoordinate = { x: number; y: number; z: number };
type CoordinateTranslation = { dx: number; dy: number; dz: number };

export type HostedDescendantCascadeResult = {
  elementsById: Record<string, Element>;
  changedElementIds: Set<string>;
};

const COORDINATE_TRANSLATION_EPSILON = 1e-9;

function normalizedElementName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedParentElementName(element: Element | undefined): string {
  return normalizedElementName((element as { parent_element?: unknown } | undefined)?.parent_element);
}

function parentLinkNames(previousParent: Element | undefined, nextParent: Element | undefined): Set<string> {
  return new Set(
    [previousParent?.name, nextParent?.name]
      .map(normalizedElementName)
      .filter(Boolean),
  );
}

function buildChildrenByParentName(elementsById: Record<string, Element>): Map<string, string[]> {
  const childrenByParentName = new Map<string, string[]>();
  for (const element of Object.values(elementsById)) {
    const parentName = normalizedParentElementName(element);
    if (!parentName) continue;
    const childIds = childrenByParentName.get(parentName) ?? [];
    childIds.push(element.id);
    childrenByParentName.set(parentName, childIds);
  }
  return childrenByParentName;
}

function childIdsForParentNames(
  childrenByParentName: Map<string, string[]>,
  parentNames: Iterable<string>,
): string[] {
  const childIds: string[] = [];
  const seen = new Set<string>();
  for (const parentName of parentNames) {
    const ids = childrenByParentName.get(parentName) ?? [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      childIds.push(id);
    }
  }
  return childIds;
}

function uniformCoordinateTranslation(
  previousElement: Element | undefined,
  nextElement: Element | undefined,
): CoordinateTranslation | null {
  const previousCoords = previousElement?.coordinates as ElementCoordinate[] | undefined;
  const nextCoords = nextElement?.coordinates as ElementCoordinate[] | undefined;
  if (!previousCoords || !nextCoords || previousCoords.length === 0 || previousCoords.length !== nextCoords.length) {
    return null;
  }

  const firstPrevious = previousCoords[0];
  const firstNext = nextCoords[0];
  if (!firstPrevious || !firstNext) return null;

  const dx = firstNext.x - firstPrevious.x;
  const dy = firstNext.y - firstPrevious.y;
  const dz = (firstNext.z ?? 0) - (firstPrevious.z ?? 0);
  if (
    Math.abs(dx) <= COORDINATE_TRANSLATION_EPSILON &&
    Math.abs(dy) <= COORDINATE_TRANSLATION_EPSILON &&
    Math.abs(dz) <= COORDINATE_TRANSLATION_EPSILON
  ) {
    return null;
  }

  for (let index = 1; index < previousCoords.length; index += 1) {
    const previousCoord = previousCoords[index];
    const nextCoord = nextCoords[index];
    if (!previousCoord || !nextCoord) return null;
    if (Math.abs((nextCoord.x - previousCoord.x) - dx) > COORDINATE_TRANSLATION_EPSILON) return null;
    if (Math.abs((nextCoord.y - previousCoord.y) - dy) > COORDINATE_TRANSLATION_EPSILON) return null;
    if (Math.abs(((nextCoord.z ?? 0) - (previousCoord.z ?? 0)) - dz) > COORDINATE_TRANSLATION_EPSILON) return null;
  }

  return { dx, dy, dz };
}

function translateCoordinates(
  coordinates: ElementCoordinate[] | undefined,
  translation: CoordinateTranslation,
): ElementCoordinate[] | null {
  if (!coordinates || coordinates.length === 0) return null;
  return coordinates.map((coord) => {
    const translated = {
      ...coord,
      x: coord.x + translation.dx,
      y: coord.y + translation.dy,
    };
    if (typeof coord.z === 'number') {
      translated.z = coord.z + translation.dz;
    }
    return translated;
  });
}

export function collectHostedDescendantElementIds(
  elementsById: Record<string, Element>,
  parentId: string,
): string[] {
  const childrenByParentName = buildChildrenByParentName(elementsById);
  const descendantIds: string[] = [];
  const queuedParentIds = [parentId];
  const processedParentIds = new Set<string>();
  const seenDescendantIds = new Set<string>();

  while (queuedParentIds.length > 0) {
    const currentParentId = queuedParentIds.shift();
    if (!currentParentId || processedParentIds.has(currentParentId)) continue;
    processedParentIds.add(currentParentId);

    const parent = elementsById[currentParentId];
    if (!parent) continue;
    const parentNames = parentLinkNames(parent, parent);
    if (parentNames.size === 0) continue;

    for (const childId of childIdsForParentNames(childrenByParentName, parentNames)) {
      if (childId === currentParentId || processedParentIds.has(childId) || seenDescendantIds.has(childId)) {
        continue;
      }
      seenDescendantIds.add(childId);
      descendantIds.push(childId);
      queuedParentIds.push(childId);
    }
  }

  return descendantIds;
}

export function shouldSnapToLineParent(element: Element | undefined): boolean {
  if (!element) return false;
  if (element.type === 'BuildingElementTransparent') return true;
  return element.type === 'BuildingElementOpaque' && (element as { is_external_door?: unknown }).is_external_door === true;
}

function isLineHostElement(
  element: Element | undefined,
): element is Element & { orientation360?: number; pitch?: number } {
  return !!element && (element.type === 'BuildingElementOpaque' || element.type === 'BuildingElementTransparent');
}

function isHostedMechanicalVentilationFan(element: Element | undefined): element is MechanicalVentilation {
  return !!element &&
    element.type === 'MechanicalVentilation' &&
    canMechanicalVentilationInheritHostPlacement((element as MechanicalVentilation).vent_type);
}

function isHostedVentPointElement(element: Element | undefined): boolean {
  return !!element && (element.type === 'Vents' || isHostedMechanicalVentilationFan(element));
}

function isDerivedWindowShadingElement(element: Element | undefined): boolean {
  return !!element && element.type === 'WindowShading';
}

function getLineHostCoordinates(parent: Element | undefined): [ElementCoordinate, ElementCoordinate] | null {
  if (!isLineHostElement(parent) || !Array.isArray(parent.coordinates) || parent.coordinates.length !== 2) {
    return null;
  }
  return parent.coordinates as [ElementCoordinate, ElementCoordinate];
}

function pointOnSegmentAtT(
  segment: [ElementCoordinate, ElementCoordinate],
  t: number,
  z?: number,
): ElementCoordinate {
  const [a, b] = segment;
  return {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
    z: z ?? a.z + t * (b.z - a.z),
  };
}

function projectionTOnSegment(point: { x: number; y: number }, segment: [ElementCoordinate, ElementCoordinate]): number {
  const [a, b] = segment;
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const v2 = vx * vx + vy * vy || 1;
  const raw = ((point.x - a.x) * vx + (point.y - a.y) * vy) / v2;
  return Math.max(0, Math.min(1, raw));
}

function childCenterAndLength(child: Element): { center: { x: number; y: number }; length: number } | null {
  const coords = child.coordinates ?? [];
  if (coords.length >= 2) {
    return {
      center: {
        x: (coords[0].x + coords[1].x) / 2,
        y: (coords[0].y + coords[1].y) / 2,
      },
      length: Math.max(0.01, Math.hypot(coords[1].x - coords[0].x, coords[1].y - coords[0].y)),
    };
  }
  if (coords.length === 1) {
    return {
      center: { x: coords[0].x, y: coords[0].y },
      length: 1,
    };
  }
  return null;
}

function coordinatesChanged(a: ElementCoordinate[] | undefined, b: ElementCoordinate[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return a !== b;
  for (let i = 0; i < a.length; i += 1) {
    const ca = a[i];
    const cb = b[i];
    if (!ca || !cb) return true;
    if (Math.abs(ca.x - cb.x) > 1e-9 || Math.abs(ca.y - cb.y) > 1e-9 || Math.abs(ca.z - cb.z) > 1e-9) {
      return true;
    }
  }
  return false;
}

function elementPatchChanged(previous: Element, next: Element): boolean {
  if (coordinatesChanged(previous.coordinates as ElementCoordinate[] | undefined, next.coordinates as ElementCoordinate[] | undefined)) {
    return true;
  }
  if ((previous as { orientation360?: unknown }).orientation360 !== (next as { orientation360?: unknown }).orientation360) return true;
  if ((previous as { pitch?: unknown }).pitch !== (next as { pitch?: unknown }).pitch) return true;
  if (previous.extra_json !== next.extra_json) return true;
  return false;
}

function buildMechanicalVentilationHostPlacementPatch(
  element: MechanicalVentilation,
  parent: Element | undefined,
): Partial<Element> {
  if (!parent || !canMechanicalVentilationInheritHostPlacement(element.vent_type)) return {};

  const columns: Partial<Record<'orientation360' | 'pitch', number>> = {};
  const parentOrientation = (parent as { orientation360?: unknown }).orientation360;
  if (typeof parentOrientation === 'number' && Number.isFinite(parentOrientation)) {
    columns.orientation360 = Math.round(parentOrientation);
  }
  const parentPitch = (parent as { pitch?: unknown }).pitch;
  if (typeof parentPitch === 'number' && Number.isFinite(parentPitch)) {
    columns.pitch = Math.round(parentPitch);
  }

  if (Object.keys(columns).length === 0) return {};
  const extra_json = applyMechanicalVentilationCsvPositionColumns(
    element.extra_json,
    element.vent_type,
    columns,
    { preservePositionMode: true },
  );
  return Object.keys(extra_json).length > 0 ? { extra_json } as Partial<Element> : {};
}

function updateLineOpeningChild(
  child: Element,
  previousChild: Element,
  previousParentCoords: [ElementCoordinate, ElementCoordinate],
  nextParentCoords: [ElementCoordinate, ElementCoordinate],
  floors: Pick<Floor, 'id' | 'zIndex'>[],
): Element | null {
  const geometry = childCenterAndLength(previousChild);
  if (!geometry) return null;
  const t = projectionTOnSegment(geometry.center, previousParentCoords);
  const center = pointOnSegmentAtT(nextParentCoords, t);
  const [a, b] = nextParentCoords;
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const vlen = Math.hypot(vx, vy) || 1;
  const ux = vx / vlen;
  const uy = vy / vlen;
  const half = geometry.length / 2;
  const coordinates = previousChild.coordinates && previousChild.coordinates.length >= 2
    ? [
        { x: center.x - half * ux, y: center.y - half * uy, z: a.z },
        { x: center.x + half * ux, y: center.y + half * uy, z: b.z },
      ]
    : [center];
  const nextChild = {
    ...child,
    coordinates,
    _v: (child._v ?? 0) + 1,
  } as Element;
  const secured = syncWindowSecurityRiskForStorey(nextChild, previousChild, floors);
  return elementPatchChanged(child, secured) ? secured : null;
}

function updateHostedVentChild(
  child: Element,
  previousChild: Element,
  previousParentCoords: [ElementCoordinate, ElementCoordinate],
  nextParent: Element,
  nextParentCoords: [ElementCoordinate, ElementCoordinate],
): Element | null {
  const previousPoint = previousChild.coordinates?.[0] as ElementCoordinate | undefined;
  if (!previousPoint) return null;
  const t = projectionTOnSegment(previousPoint, previousParentCoords);
  const coordinates = [pointOnSegmentAtT(nextParentCoords, t, previousPoint.z)];
  let nextChild: Element;

  if (child.type === 'MechanicalVentilation') {
    const placementPatch = buildMechanicalVentilationHostPlacementPatch(child as MechanicalVentilation, nextParent);
    nextChild = {
      ...child,
      ...placementPatch,
      coordinates,
      _v: (child._v ?? 0) + 1,
    } as Element;
  } else {
    const parentOrientation = (nextParent as { orientation360?: unknown }).orientation360;
    const parentPitch = (nextParent as { pitch?: unknown }).pitch;
    nextChild = {
      ...child,
      ...(typeof parentOrientation === 'number' ? { orientation360: parentOrientation } : {}),
      ...(typeof parentPitch === 'number' ? { pitch: parentPitch } : {}),
      coordinates,
      _v: (child._v ?? 0) + 1,
    } as Element;
  }

  return elementPatchChanged(child, nextChild) ? nextChild : null;
}

export function cascadeHostedDescendantGeometry({
  previousElementsById,
  nextElementsById,
  changedElementIds,
  floors = [],
}: {
  previousElementsById: Record<string, Element>;
  nextElementsById: Record<string, Element>;
  changedElementIds: Iterable<string>;
  floors?: Pick<Floor, 'id' | 'zIndex'>[];
}): HostedDescendantCascadeResult {
  let elementsById = nextElementsById;
  const changedIds = new Set(changedElementIds);
  const queue = Array.from(changedIds);
  const processedParents = new Set<string>();

  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId || processedParents.has(parentId)) continue;
    processedParents.add(parentId);

    const nextParent = elementsById[parentId];
    if (!nextParent) continue;
    const previousParent = previousElementsById[parentId] ?? nextParent;
    const nextParentCoords = getLineHostCoordinates(nextParent);
    if (!nextParentCoords) continue;
    const previousParentCoords = getLineHostCoordinates(previousParent) ?? nextParentCoords;
    const parentNames = parentLinkNames(previousParent, nextParent);
    if (parentNames.size === 0) continue;

    for (const child of Object.values(elementsById)) {
      if (!child || child.id === parentId) continue;
      const parentName = typeof child.parent_element === 'string' ? child.parent_element.trim() : '';
      if (!parentNames.has(parentName)) continue;

      const previousChild = previousElementsById[child.id] ?? child;
      const nextChild = shouldSnapToLineParent(child)
        ? updateLineOpeningChild(child, previousChild, previousParentCoords, nextParentCoords, floors)
        : isHostedVentPointElement(child)
          ? updateHostedVentChild(child, previousChild, previousParentCoords, nextParent, nextParentCoords)
          : null;
      if (!nextChild) {
        if (isDerivedWindowShadingElement(child)) {
          changedIds.add(child.id);
        }
        continue;
      }

      if (elementsById === nextElementsById) {
        elementsById = { ...nextElementsById };
      }
      elementsById[child.id] = nextChild;
      changedIds.add(child.id);
      queue.push(child.id);
    }
  }

  return {
    elementsById,
    changedElementIds: changedIds,
  };
}

export function cascadeHostedDescendantTranslation({
  previousElementsById,
  nextElementsById,
  changedElementIds,
}: {
  previousElementsById: Record<string, Element>;
  nextElementsById: Record<string, Element>;
  changedElementIds: Iterable<string>;
}): HostedDescendantCascadeResult {
  let elementsById = nextElementsById;
  const changedIds = new Set(changedElementIds);
  const childrenByParentName = buildChildrenByParentName(nextElementsById);
  const queue = Array.from(changedIds)
    .map((parentId) => ({
      parentId,
      translation: uniformCoordinateTranslation(
        previousElementsById[parentId],
        nextElementsById[parentId],
      ),
    }))
    .filter((entry): entry is { parentId: string; translation: CoordinateTranslation } => !!entry.translation);
  const processedParents = new Set<string>();

  while (queue.length > 0) {
    const { parentId, translation } = queue.shift()!;
    if (processedParents.has(parentId)) continue;
    processedParents.add(parentId);

    const nextParent = elementsById[parentId];
    if (!nextParent) continue;
    const previousParent = previousElementsById[parentId] ?? nextParent;
    const parentNames = parentLinkNames(previousParent, nextParent);
    if (parentNames.size === 0) continue;

    for (const childId of childIdsForParentNames(childrenByParentName, parentNames)) {
      if (childId === parentId || processedParents.has(childId)) continue;
      const child = elementsById[childId];
      if (!child) continue;

      changedIds.add(childId);
      const previousChild = previousElementsById[childId] ?? child;
      const translatedCoordinates = translateCoordinates(
        previousChild.coordinates as ElementCoordinate[] | undefined,
        translation,
      );
      if (translatedCoordinates && coordinatesChanged(child.coordinates as ElementCoordinate[] | undefined, translatedCoordinates)) {
        if (elementsById === nextElementsById) {
          elementsById = { ...nextElementsById };
        }
        elementsById[childId] = {
          ...child,
          coordinates: translatedCoordinates,
          _v: (child._v ?? 0) + 1,
        } as Element;
      }

      queue.push({ parentId: childId, translation });
    }
  }

  return {
    elementsById,
    changedElementIds: changedIds,
  };
}
