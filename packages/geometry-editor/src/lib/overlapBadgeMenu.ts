// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { modelToCanvas2D, type CanvasTransform, type ModelPoint2D } from './geometryTransform';

export type OverlapBadgeMenuAnchor = ModelPoint2D & { z?: number };

export interface OverlapBadgeMenuLayerStyle {
  position: 'absolute';
  left: number;
  top: number;
  pointerEvents: 'auto';
}

export const OVERLAP_BADGE_MENU_OFFSET_PX = 8;

export function getOverlapBadgeMenuViewportPosition(
  worldCenter: OverlapBadgeMenuAnchor,
  transform: CanvasTransform,
): ModelPoint2D {
  return modelToCanvas2D(worldCenter, transform);
}

export function getOverlapBadgeMenuLayerStyle(
  worldCenter: OverlapBadgeMenuAnchor,
  transform: CanvasTransform,
): OverlapBadgeMenuLayerStyle {
  const position = getOverlapBadgeMenuViewportPosition(worldCenter, transform);

  return {
    position: 'absolute',
    left: position.x + OVERLAP_BADGE_MENU_OFFSET_PX,
    top: position.y + OVERLAP_BADGE_MENU_OFFSET_PX,
    pointerEvents: 'auto',
  };
}
