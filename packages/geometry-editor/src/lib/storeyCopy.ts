// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// "Add F3: Copy of F2" in the floor picker: what a storey copy takes, how the copies are named, and
// where only an empty storey makes sense.

import type { Element } from '../geometry/types';
import { getHemieBundle } from './hemieBundles';
import { isRoofLikeOpaqueElement } from './roofElement';
import { fhsFloorCodeForCanvasFloor } from './storeySemantics';
import { isVerticalLineWall } from './zoneDerivation';

/**
 * A storey copy takes the walls, doors, windows, internal walls, emitters, lights and vents. Floors,
 * ceilings, roofs, thermal bridges, systems and bay or conservatory parts stay. A window's shading
 * goes with it.
 */
export function isStoreyCopyElement(element: Element): boolean {
  if (getHemieBundle(element)) return false;
  switch (element.type) {
    case 'BuildingElementOpaque':
      return isVerticalLineWall(element) || (element.is_external_door === true && element.coordinates?.length === 2);
    case 'BuildingElementAdjacentConditionedSpace':
    case 'BuildingElementAdjacentUnconditionedSpace_Simple':
    case 'BuildingElementPartyWall':
      return isVerticalLineWall(element);
    case 'BuildingElementTransparent': {
      const pitch = element.pitch;
      return element.coordinates?.length === 2 && (typeof pitch !== 'number' || pitch === 90);
    }
    case 'WetEmitter':
    case 'Lighting':
    case 'Vents':
      return true;
    default:
      return false;
  }
}

/** "Wall (S) F2" becomes "Wall (S) F3"; a name without the storey gets it: "Wall (S)" becomes "Wall (S) F3". */
export function storeyCopyName(name: string, fromZ: number, toZ: number): string {
  const from = fhsFloorCodeForCanvasFloor(fromZ);
  const to = fhsFloorCodeForCanvasFloor(toZ);
  const pattern = new RegExp(`\\b${from}\\b`);
  return pattern.test(name) ? name.replace(pattern, to) : `${name} ${to}`;
}

type PlanBox = { minX: number; minY: number; maxX: number; maxY: number };

function planBox(points: Array<{ x: number; y: number }>): PlanBox | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * True when a roof over `walls` (overlapping them in plan, more than touching) rises through
 * `baseM`: a storey starting there is the roof space, so only an empty storey is offered. A roof's
 * rise is its up-slope height times the sine of its pitch. A lean-to beside the walls, a roof below
 * the base and a roof with the stored base 0 placeholder do not count.
 */
export function isUnderRoof(baseM: number, elements: Element[], walls: Element[]): boolean {
  const wallBox = planBox(walls.flatMap((wall) => wall.coordinates ?? []));
  if (!wallBox) return false;
  const inset = 0.1;
  return elements.some((element) => {
    if (!isRoofLikeOpaqueElement(element) || element.type !== 'BuildingElementOpaque') return false;
    const { base_height: base, height, pitch } = element;
    if (typeof base !== 'number' || base <= 0 || typeof height !== 'number' || typeof pitch !== 'number' || !(pitch > 0)) return false;
    const top = base + height * Math.sin((pitch * Math.PI) / 180);
    if (!(base <= baseM + 0.05 && top > baseM + 0.05)) return false;
    const roofBox = planBox(element.coordinates ?? []);
    return !!roofBox
      && roofBox.minX + inset <= wallBox.maxX && roofBox.maxX - inset >= wallBox.minX
      && roofBox.minY + inset <= wallBox.maxY && roofBox.maxY - inset >= wallBox.minY;
  });
}
