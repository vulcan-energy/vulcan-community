// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type Konva from 'konva';
import type { DrawMode } from '../hooks/useDrawingMode';
import type { ElementType } from '../geometry/types';

/** Horizontal padding inside the blue draw-mode tooltip pill (matches GeometryCanvas). */
export const DRAW_MODE_TOOLTIP_PILL_PADDING = 6;

export const DRAW_MODE_TOOLTIP_PILL_HEIGHT = 20;

export const DRAW_MODE_TOOLTIP_PILL_FONT_FAMILY =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Canvas `font` string aligned with Konva `Text` in `renderDrawModeTooltipPill`. */
const PILL_CANVAS_FONT = `normal 11px ${DRAW_MODE_TOOLTIP_PILL_FONT_FAMILY}`;

let measureCtx: CanvasRenderingContext2D | null | undefined;
const pillWidthCache = new Map<string, number>();

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  if (typeof document === 'undefined') {
    measureCtx = null;
    return null;
  }
  const canvas = document.createElement('canvas');
  measureCtx = canvas.getContext('2d');
  return measureCtx;
}

/** Total pill width so the label fits on one line (canvas-measured when available). */
export function getDrawModeTooltipPillWidth(text: string): number {
  const cached = pillWidthCache.get(text);
  if (cached !== undefined) return cached;

  const ctx = getMeasureCtx();
  let inner: number;
  if (ctx) {
    ctx.font = PILL_CANVAS_FONT;
    inner = Math.ceil(ctx.measureText(text).width) + 2;
  } else {
    inner = Math.ceil(text.length * 8);
  }
  const width = inner + DRAW_MODE_TOOLTIP_PILL_PADDING * 2;
  pillWidthCache.set(text, width);
  return width;
}

// Helper: Check if cursor is near first point (for completion detection)
function isNearFirstPoint(
  cursor: { x: number; y: number } | null,
  firstPoint: { x: number; y: number } | null,
  drawSnapTargetRef: React.RefObject<{ x: number; y: number } | null>,
  tolerance: number = 0.1
): boolean {
  if (!cursor || !firstPoint) return false;

  if (drawSnapTargetRef.current) {
    const snapDist = Math.hypot(
      drawSnapTargetRef.current.x - firstPoint.x,
      drawSnapTargetRef.current.y - firstPoint.y
    );
    if (snapDist < tolerance) return true;
  }

  const dist = Math.hypot(cursor.x - firstPoint.x, cursor.y - firstPoint.y);
  return dist < tolerance;
}

// Modifier suffixes live once: Alt/Option multi-draw and the L/V/S shape switch.
const SHAPE_SWITCH_HINT = 'L/V/S switches shape';
/** `shapeSwitch` is set for service-line tools only; undefined keeps the multi-draw phrasing. */
function withMultiDrawHint(
  held: boolean,
  heldText: string,
  idleText: string,
  shapeSwitch?: boolean,
): string {
  if (held) return shapeSwitch ? `${heldText} (${SHAPE_SWITCH_HINT})` : heldText;
  if (shapeSwitch === undefined) return `${idleText} (Alt/Option+Click for multi-draw)`;
  return `${idleText} (Alt/Option+Click to keep drawing${shapeSwitch ? `; ${SHAPE_SWITCH_HINT}` : ''})`;
}

export type HoverHintTarget = {
  kind: 'rotate-grip' | 'vertex' | 'body' | 'label-vertex';
  dragging: boolean;
  /** Body only: the element has same-network connections that Alt-drag carries along. */
  connected?: boolean;
  altHeld?: boolean;
};

/** Hint for a selected element's drag handle; null means native cursor only. */
export function getHoverHintText(target: HoverHintTarget): string | null {
  if (target.kind === 'rotate-grip') return target.dragging ? null : 'Drag to rotate';
  if (target.kind === 'vertex') return 'Shift: no snap';
  if (target.kind === 'body' && target.connected && (!target.dragging || target.altHeld)) {
    return 'Alt: move connected';
  }
  // label-vertex: Shift is orthogonal lock there, so cursor only.
  return null;
}

// Helper: Get tooltip text based on draw mode and state
export function getDrawModeTooltipText(
  drawMode: DrawMode,
  drawPoints: Array<{ x: number; y: number }>,
  roomWalls: Array<{ x: number; y: number }>,
  orthogonalRoomStart: { x: number; y: number } | null,
  orthogonalRoomEnd: { x: number; y: number } | null,
  drawCursor: { x: number; y: number } | null,
  drawSnapTargetRef: React.RefObject<{ x: number; y: number } | null>,
  drawElementType: ElementType,
  multiDrawModifierHeld: boolean,
  /** Duct/pipe plan tool only: an L (Shift) preview is showing. */
  elbowPreviewActive = false,
): string | null {
  if (drawMode === 'none') return null;

  if (drawMode === 'point') {
    return withMultiDrawHint(multiDrawModifierHeld, 'Place object + continue', 'Place object');
  }

  if (drawMode === 'dormer') {
    return 'Click a sloped roof where the dormer window centre should go';
  }

  // Ducts and pipes skip the shape-switch clause: their dropdown already shows the keys.
  const showShapeSwitch = drawElementType !== 'MechanicalVentilationDuctwork' && drawElementType !== 'WaterPipework';
  if (drawMode === 'line' || drawMode === 'tb-plan-line') {
    if (drawPoints.length === 0) return 'Place first point';
    if (drawPoints.length === 1) {
      if (drawMode === 'tb-plan-line') {
        const base = withMultiDrawHint(multiDrawModifierHeld, 'Place end point + continue', 'Place final point', showShapeSwitch);
        if (showShapeSwitch) return base;
        return `${base} · ${elbowPreviewActive ? 'F: flip bend' : 'Shift: L-bend'}`;
      }
      return withMultiDrawHint(multiDrawModifierHeld, 'Place end point + continue', 'Place final point');
    }
    return null;
  }
  if (drawMode === 'tb-vertical-line') {
    if (drawPoints.length === 0) {
      return withMultiDrawHint(multiDrawModifierHeld, 'Place vertical run + continue', 'Place vertical run', showShapeSwitch);
    }
    return withMultiDrawHint(multiDrawModifierHeld, 'Create vertical run + continue', 'Create vertical run from current point', showShapeSwitch);
  }
  if (drawMode === 'tb-slope-line') {
    if (drawPoints.length === 0) return 'Place first point';
    if (drawPoints.length === 1) {
      return withMultiDrawHint(multiDrawModifierHeld, 'Place end point + continue', 'Place second point', showShapeSwitch);
    }
    return null;
  }

  if (drawMode === 'polygon' || drawMode === 'space-label-polygon') {
    if (drawPoints.length === 0) return 'Place first point';
    const firstPoint = drawPoints[0];
    const isNear = isNearFirstPoint(drawCursor, firstPoint, drawSnapTargetRef, 0.1);
    if (isNear && drawPoints.length >= 3) return 'Complete shape';
    return 'Place another point';
  }

  if (drawMode === 'sloped-polygon') {
    if (drawElementType === 'OnSiteGeneration') {
      if (drawPoints.length === 0) return 'Place first point (bottom edge / eaves side)';
      if (drawPoints.length === 1) return 'Place second point (along bottom; depth from module size)';
      return null;
    }
    if (drawPoints.length === 0) return 'Place first point (bottom edge)';
    if (drawPoints.length === 1) return 'Place second point (bottom edge)';
    const firstPoint = drawPoints[0];
    const isNear = isNearFirstPoint(drawCursor, firstPoint, drawSnapTargetRef, 0.1);
    if (isNear && drawPoints.length >= 3) return 'Complete shape';
    return 'Place another point';
  }

  if (drawMode === 'room') {
    if (roomWalls.length === 0) return 'Place first point, draw anti-clockwise';
    const firstPoint = roomWalls[0];
    const isNear =
      roomWalls.length >= 2 &&
      isNearFirstPoint(drawCursor, firstPoint, drawSnapTargetRef, 0.1);
    if (isNear) return 'Complete shape';
    return 'Place another point';
  }

  if (drawMode === 'orthogonal-room') {
    if (!orthogonalRoomStart) return 'Click and drag to draw room';
    if (orthogonalRoomEnd) return 'Release to finalize';
    return 'Click and drag to draw room';
  }

  return null;
}


/** Konva name of the draggable whole-element handle (`selected-shape-drag`, `selected-point-drag`). */
export const SELECTED_SHAPE_DRAG_HANDLE_NAME = 'selected-shape-drag-handle';

export function classifyHoverHandle(node: Konva.Node | null): HoverHintTarget['kind'] | null {
  // Handles only render for a selected element, and read-only ones are not draggable.
  if (!node?.draggable()) return null;
  const name: string = node.name();
  if (name.startsWith('orientation-arrow-handle-')) return 'rotate-grip';
  if (name.startsWith('vertex-')) return 'vertex';
  if (name.startsWith('space-label-vertex-')) return 'label-vertex';
  if (name === SELECTED_SHAPE_DRAG_HANDLE_NAME) return 'body';
  return null;
}

