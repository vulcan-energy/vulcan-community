// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createElementNameLookup } from './elementNameRemap';
import { deriveWallProperties } from './openingSegmentOutward';
import { MIN_WALL_SEGMENT, roundToFourDecimals } from '../geometry/constants';
import { projectSegmentOntoParent } from './snapUtils';
import {
  applyMechanicalVentilationCsvPositionColumns,
  canMechanicalVentilationInheritHostPlacement,
} from './mechanicalVentilationBranches';
import type { BuildingElementOpaque, BuildingElementTransparent, Element } from '../geometry/types';

export function getParentByName(
  elementsById: Record<string, Element>,
  elementIds: readonly string[],
  parentName: string,
  zoneId?: string | null,
): Element | undefined {
  return createElementNameLookup(
    elementIds.map((id) => elementsById[id]).filter((element): element is Element => !!element),
  )(parentName, zoneId, (parent) =>
    parent.type === 'BuildingElementOpaque' || (!zoneId && parent.type === 'BuildingElementTransparent'),
  );
}

export function getParentOrientation360(
  parent: Element,
  globalOrientationOffset: number,
): number | undefined {
  // A segment too short to give a bearing falls back to the host's own value, never to 0.
  if (Array.isArray(parent.coordinates) && parent.coordinates.length === 2) {
    const wall = deriveWallProperties(parent, globalOrientationOffset);
    if (wall.width >= MIN_WALL_SEGMENT) return wall.orientation360;
  }
  const orientation = (parent as { orientation360?: unknown }).orientation360;
  return typeof orientation === 'number' && Number.isFinite(orientation) ? orientation : undefined;
}

export function projectLinearChildOntoParentSegment(
  child: Element,
  parent: Element,
): Array<{ x: number; y: number; z: number }> | null {
  if (!Array.isArray(parent.coordinates) || parent.coordinates.length !== 2) return null;
  if (!Array.isArray(child.coordinates) || child.coordinates.length !== 2) return null;
  // Moved to another host, it keeps its place along the line, slid inside the new wall when it fits.
  return clampSegmentInsideParent(projectSegmentOntoParent(child.coordinates, parent.coordinates), parent.coordinates).map((coord) => ({
    x: roundToFourDecimals(coord.x),
    y: roundToFourDecimals(coord.y),
    z: coord.z,
  }));
}

export function buildHostedLinearParentPatch(
  current: Element | undefined | null,
  parent: Element | undefined,
  parentName: string,
  emptyParentValue: string | null,
  globalOrientationOffset: number,
): Partial<Element> {
  const updates: Partial<Element> = { parent_element: parentName || emptyParentValue } as Partial<Element>;
  if (!parentName || !current || !parent) return updates;

  const canInheritHostGeometry =
    current.type === 'BuildingElementTransparent' ||
    (current.type === 'BuildingElementOpaque' && (current as BuildingElementOpaque).is_external_door);
  if (!canInheritHostGeometry) return updates;

  const projectedCoords = projectLinearChildOntoParentSegment(current, parent);
  if (projectedCoords) {
    updates.coordinates = projectedCoords;
  }
  if ('pitch' in parent && typeof parent.pitch === 'number') {
    (updates as Partial<BuildingElementOpaque | BuildingElementTransparent>).pitch = parent.pitch;
  }
  const orientation360 = getParentOrientation360(parent, globalOrientationOffset);
  if (typeof orientation360 === 'number') {
    (updates as Partial<BuildingElementOpaque | BuildingElementTransparent>).orientation360 = orientation360;
  }
  return updates;
}

export function buildMechanicalVentilationParentPatch(
  current: Element | undefined | null,
  parent: Element | undefined,
  parentName: string,
  ventType: unknown,
  globalOrientationOffset: number,
): Partial<Element> {
  const normalizedParentName = parentName || null;
  const updates: Partial<Element> = { parent_element: normalizedParentName } as Partial<Element>;
  if (!current || current.type !== 'MechanicalVentilation') return updates;

  if (!canMechanicalVentilationInheritHostPlacement(ventType)) {
    if (normalizedParentName) return { parent_element: null } as Partial<Element>;
    return updates;
  }
  if (!parent || !normalizedParentName) return updates;

  const columns: Partial<Record<'orientation360' | 'pitch', number>> = {};
  const parentOrientation = getParentOrientation360(parent, globalOrientationOffset);
  if (typeof parentOrientation === 'number' && Number.isFinite(parentOrientation)) {
    columns.orientation360 = Math.round(parentOrientation);
  }
  const parentPitch = (parent as { pitch?: unknown }).pitch;
  if (typeof parentPitch === 'number' && Number.isFinite(parentPitch)) {
    columns.pitch = Math.round(parentPitch);
  }
  if (Object.keys(columns).length === 0) return updates;

  const extraJson = applyMechanicalVentilationCsvPositionColumns(
    current.extra_json,
    ventType,
    columns,
    { preservePositionMode: true },
  );
  updates.extra_json = Object.keys(extraJson).length > 0 ? extraJson : undefined;
  return updates;
}

/** Slides a segment already on the parent's line along it so it lies inside the parent, when it fits. */
function clampSegmentInsideParent(
  coords: Array<{ x: number; y: number; z: number }>,
  parent: Array<{ x: number; y: number; z: number }>,
): Array<{ x: number; y: number; z: number }> {
  const [PA, PB] = parent;
  const vx = PB!.x - PA!.x;
  const vy = PB!.y - PA!.y;
  const wallLength = Math.hypot(vx, vy);
  if (wallLength === 0) return coords;
  const along = (point: { x: number; y: number }) => ((point.x - PA!.x) * vx + (point.y - PA!.y) * vy) / wallLength;
  const t0 = along(coords[0]!);
  const t1 = along(coords[1]!);
  const low = Math.min(t0, t1);
  const high = Math.max(t0, t1);
  if (high - low > wallLength) return coords;
  const shift = low < 0 ? -low : high > wallLength ? wallLength - high : 0;
  if (shift === 0) return coords;
  return coords.map((coord) => ({
    x: roundToFourDecimals(coord.x + (shift * vx) / wallLength),
    y: roundToFourDecimals(coord.y + (shift * vy) / wallLength),
    z: coord.z,
  }));
}

/** A window wider than the line wall it is on: "2.00 m window on a 1.50 m wall". */
export function openingTooWide(opening: Element | undefined, parent: Element | undefined): string | undefined {
  if (opening?.type !== 'BuildingElementTransparent' || parent?.coordinates?.length !== 2) return undefined;
  const width = (opening as BuildingElementTransparent).width;
  const [a, b] = parent.coordinates;
  const wall = Math.hypot(b!.x - a!.x, b!.y - a!.y);
  return typeof width === 'number' && width > wall + 0.005 ? `${width.toFixed(2)} m window on a ${wall.toFixed(2)} m wall` : undefined;
}

/** The line wall a window lies on, on its storey: where "Reattach" puts a window whose wall was deleted. */
export function wallUnderOpening(opening: Element | undefined, elements: readonly Element[]): Element | undefined {
  const line = opening?.type === 'BuildingElementTransparent' ? opening.coordinates : undefined;
  if (line?.length !== 2) return undefined;
  // Its middle on the wall, both ends on the wall's line, on the same storey.
  const distance = (point: { x: number; y: number }, [a, b]: Array<{ x: number; y: number }>, clamp: boolean) => {
    const vx = b!.x - a!.x;
    const vy = b!.y - a!.y;
    const lengthSq = vx * vx + vy * vy;
    if (lengthSq === 0) return Infinity;
    const raw = ((point.x - a!.x) * vx + (point.y - a!.y) * vy) / lengthSq;
    const t = clamp ? Math.min(1, Math.max(0, raw)) : raw;
    return Math.hypot(point.x - (a!.x + t * vx), point.y - (a!.y + t * vy));
  };
  const middle = { x: (line[0]!.x + line[1]!.x) / 2, y: (line[0]!.y + line[1]!.y) / 2 };
  return elements.find((wall) => wall.type === 'BuildingElementOpaque'
    && !(wall as BuildingElementOpaque).is_external_door
    && wall.zoneId === opening!.zoneId
    && wall.coordinates?.length === 2
    && Math.abs((wall.coordinates[0]!.z ?? 0) - (line[0]!.z ?? 0)) < 0.01
    && distance(middle, wall.coordinates, true) < 0.05
    && line.every((point) => distance(point, wall.coordinates, false) < 0.05));
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
/** The nearest of eight compass points for an orientation in degrees (0 = north): "faces S". */
export const compassPoint = (degrees: number): string => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!;
