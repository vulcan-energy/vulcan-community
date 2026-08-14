// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import { isGlobalObject, type GeometryStoreApi } from '../stores/geometryStore';

export type DrawnElementSelection = {
  type: 'element' | 'global';
  id: string;
};

export function selectionForElement(element: Element): DrawnElementSelection {
  return {
    type: isGlobalObject(element) ? 'global' : 'element',
    id: element.id,
  };
}

/**
 * Selection for an element the canvas has just created.
 *
 * Must read the element back from the store: the `elementsById` a render closure captured
 * cannot contain an element created during that same tick, so deriving the type from it always
 * falls through to `'element'` — which mis-typed drawn `OnSiteGeneration` and `ContextShading`
 * (both global objects).
 */
export function selectionForDrawnElement(
  store: GeometryStoreApi,
  elementId: string,
): DrawnElementSelection {
  const created = store.getState().elementsById[elementId];
  return created ? selectionForElement(created) : { type: 'element', id: elementId };
}
