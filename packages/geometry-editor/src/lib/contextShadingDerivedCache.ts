// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ContextShading, Element, Floor } from '../geometry/types';
import {
  deriveContextShading,
  generatedNeighbourDerivation,
  resolveContextShadingCentre,
  type ContextShadingCentre,
  type ContextShadingDerivation,
} from './contextShadingGeometry';
import { isContextGeneratedElement } from './developmentContextShading';

export type ContextShadingDerivedInModel = { centre: ContextShadingCentre; derived: ContextShadingDerivation };

type Entry = { elementsById: Record<string, Element>; floors: Floor[]; offsetDeg: number; result: ContextShadingDerivedInModel | null };

// Keyed by the stored object, which is replaced when it changes; the other inputs are compared by identity.
const cache = new WeakMap<ContextShading, Entry>();

/**
 * What an object's derivation shows: a generated Development neighbour's kept parts, as the sync
 * writes it ({@link generatedNeighbourDerivation}); every part when none is kept, until the next
 * sync removes it.
 */
export function keptDerivation(shading: ContextShading, derived: ContextShadingDerivation): ContextShadingDerivation;
export function keptDerivation(shading: ContextShading, derived: ContextShadingDerivation | null): ContextShadingDerivation | null;
export function keptDerivation(shading: ContextShading, derived: ContextShadingDerivation | null): ContextShadingDerivation | null {
  if (!derived || 'issue' in derived || !isContextGeneratedElement(shading)) return derived;
  return generatedNeighbourDerivation(derived) ?? derived;
}

/**
 * The centre and parts of a stored Context Shading object, derived once per change of the object,
 * the model's elements, its floors or the north offset, so every canvas render and every pill
 * reads the same result. Null when there is nothing to derive from or the centre has an issue.
 */
export function deriveContextShadingCached(
  shading: ContextShading,
  elementsById: Record<string, Element>,
  floors: Floor[],
  offsetDeg: number,
): ContextShadingDerivedInModel | null {
  const hit = cache.get(shading);
  if (hit && hit.elementsById === elementsById && hit.floors === floors && hit.offsetDeg === offsetDeg) return hit.result;
  const elements = Object.values(elementsById);
  const centre = shading.coordinates?.length ? resolveContextShadingCentre(elements, floors, shading.parent_element) : null;
  const result = centre && !('issue' in centre)
    ? { centre, derived: keptDerivation(shading, deriveContextShading(shading, centre, elements, offsetDeg) as ContextShadingDerivation) }
    : null;
  cache.set(shading, { elementsById, floors, offsetDeg, result });
  return result;
}

/**
 * What the object's plan label reads from: the object itself, or, when its drawing cannot be measured
 * from the centre (it covers the centre, crosses itself), without the stored range and distance, which
 * are stale. A row with no drawing or no centre keeps what it stores.
 */
export function labelSource<T extends Element>(element: T, elementsById: Record<string, Element>, floors: Floor[], offsetDeg: number): T {
  if (element.type !== 'ContextShading' || (element.coordinates?.length ?? 0) < 2 || !element.parent_element?.trim()) return element;
  const shared = deriveContextShadingCached(element, elementsById, floors, offsetDeg);
  if (shared && !('issue' in shared.derived)) return element;
  const stripped = { ...element } as Partial<ContextShading>;
  delete stripped.start_angle;
  delete stripped.end_angle;
  delete stripped.distance;
  delete stripped.parts;
  return stripped as unknown as T;
}
