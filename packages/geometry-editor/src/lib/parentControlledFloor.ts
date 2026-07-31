// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Floor } from '../geometry/types';
import { getElementCanvasFloorZValue } from './elementCanvasFloor';
import { canMechanicalVentilationInheritHostPlacement } from './mechanicalVentilationBranches';
import { isMvhrTerminalHost } from './mvhrDuctwork';

function normalizedFloorControlParentName(element: Element): string {
  const value = element.type === 'MechanicalVentilationTerminal'
    ? (element as { host_element?: unknown }).host_element
    : (element as { parent_element?: unknown }).parent_element;
  return typeof value === 'string' ? value.trim() : '';
}

function isWallOrWindow(element: Element): boolean {
  return element.type === 'BuildingElementOpaque' || element.type === 'BuildingElementTransparent';
}

function isFloorControlledChildOf(element: Element, parent: Element): boolean {
  switch (element.type) {
    case 'BuildingElementTransparent':
      return parent.type === 'BuildingElementOpaque';
    case 'BuildingElementOpaque':
      return (element as { is_external_door?: unknown }).is_external_door === true &&
        parent.type === 'BuildingElementOpaque';
    case 'WindowShading':
      return parent.type === 'BuildingElementTransparent';
    case 'Vents':
      return isWallOrWindow(parent);
    case 'MechanicalVentilation':
      return canMechanicalVentilationInheritHostPlacement(
        (element as { vent_type?: unknown }).vent_type,
      ) && isWallOrWindow(parent);
    case 'MechanicalVentilationDuctwork':
      return parent.type === 'MechanicalVentilation';
    case 'MechanicalVentilationTerminal':
      return isMvhrTerminalHost(parent);
    default:
      return false;
  }
}

export function getFloorControlParentElement(
  element: Element | undefined,
  elementsById: Record<string, Element>,
): Element | null {
  if (!element) return null;
  const parentName = normalizedFloorControlParentName(element);
  if (!parentName) return null;
  const parent = Object.values(elementsById).find((candidate) => candidate.name === parentName);
  if (!parent || parent.id === element.id) return null;
  return isFloorControlledChildOf(element, parent) ? parent : null;
}

export function isElementFloorControlledByParent(
  element: Element | undefined,
  elementsById: Record<string, Element>,
): boolean {
  return getFloorControlParentElement(element, elementsById) !== null;
}

export function preservesCoordinateZForParentControlledFloor(element: Element | undefined): boolean {
  return !!element && (
    element.type === 'Vents' ||
    element.type === 'MechanicalVentilation' ||
    element.type === 'MechanicalVentilationDuctwork' ||
    element.type === 'MechanicalVentilationTerminal'
  );
}

export function getParentControlledFloorZ(
  element: Element | undefined,
  elementsById: Record<string, Element>,
  floors?: Pick<Floor, 'id' | 'zIndex'>[],
): number | undefined {
  const parent = getFloorControlParentElement(element, elementsById);
  return parent ? getElementCanvasFloorZValue(parent, floors) : undefined;
}
