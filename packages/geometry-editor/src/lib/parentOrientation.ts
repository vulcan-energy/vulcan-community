// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Parent-lookup and pitch/orientation-inheritance helpers, moved verbatim from
// ElementCreator.tsx per the slice-4 extraction brief's decision (f).1. Two
// families read these: the wall family (BuildingElementOpaque/Transparent's
// applyHostedParentElement, still inline in ElementCreator.tsx) and the
// MechanicalVentilation form module (elementForms/mechanicalVentilation.tsx).
// Neither owns these functions, so they live here instead of in either
// caller.
//
// getParentByName's elementIds parameter is typed `readonly string[]` (the
// legacy inline function took `string[]`) so both a module's
// ElementFormStateCtx.elementIds (readonly) and the orchestrator's own
// mutable elementIds array satisfy it without a cast.

import { deriveWallProperties } from '../stores/geometryStore';
import { roundToFourDecimals } from '../geometry/constants';
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
): Element | undefined {
  if (!parentName) return undefined;
  return elementIds
    .map((id) => elementsById[id])
    .find((element): element is Element => !!element && element.name === parentName);
}

export function getParentOrientation360(
  parent: Element,
  globalOrientationOffset: number,
): number | undefined {
  if (Array.isArray(parent.coordinates) && parent.coordinates.length === 2) {
    try {
      return deriveWallProperties(parent, globalOrientationOffset).orientation360;
    } catch {
      return undefined;
    }
  }
  return 'orientation360' in parent && typeof parent.orientation360 === 'number'
    ? parent.orientation360
    : undefined;
}

export function projectLinearChildOntoParentSegment(
  child: Element,
  parent: Element,
): Array<{ x: number; y: number; z: number }> | null {
  if (!Array.isArray(parent.coordinates) || parent.coordinates.length !== 2) return null;
  if (!Array.isArray(child.coordinates) || child.coordinates.length !== 2) return null;
  return projectSegmentOntoParent(child.coordinates, parent.coordinates).map((coord) => ({
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
