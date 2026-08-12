// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { getElementShape } from './shapeUtils';
import type { Element } from '../geometry/types';

/**
 * Base paint order for the plan canvas, shared by the interactive layer and the static
 * pan/zoom preview so the two never disagree about what sits on top.
 *
 * Children paint above parents; then point markers (appliances, systems, …) above lines and
 * polygons, and lines above polygons, so coincident geometry stays clickable.
 * Returns 0 for equal rank, leaving the caller's original order intact.
 */
export function compareElementPaintOrder(a: Element, b: Element): number {
  const aHasParent = (a as { parent_element?: string | null }).parent_element !== null;
  const bHasParent = (b as { parent_element?: string | null }).parent_element !== null;
  if (aHasParent && !bHasParent) return 1;
  if (!aHasParent && bHasParent) return -1;

  const aShape = getElementShape(a);
  const bShape = getElementShape(b);
  const aIsPoint = aShape === 'point';
  const bIsPoint = bShape === 'point';
  const aIsLine = aShape === 'line';
  const bIsLine = bShape === 'line';
  const aIsPolygon = aShape === 'polygon' || aShape === 'sloped-polygon';
  const bIsPolygon = bShape === 'polygon' || bShape === 'sloped-polygon';

  if (aIsPoint && (bIsLine || bIsPolygon)) return 1;
  if (bIsPoint && (aIsLine || aIsPolygon)) return -1;
  if (aIsLine && bIsPolygon) return 1;
  if (aIsPolygon && bIsLine) return -1;

  return 0;
}
