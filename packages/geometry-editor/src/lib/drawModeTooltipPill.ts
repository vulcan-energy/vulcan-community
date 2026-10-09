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

// Modifier suffixes live once: Alt/Option multi-draw and the P/V/S shape switch.
const PVS_HINT = 'P/V/S switches shape';
function withMultiDrawHint(
  held: boolean,
  heldText: string,
  idleText: string,
  withShapeSwitch = false,
): string {
  if (held) return withShapeSwitch ? `${heldText} (${PVS_HINT})` : heldText;
  return withShapeSwitch
    ? `${idleText} (Alt/Option+Click to keep drawing; ${PVS_HINT})`
    : `${idleText} (Alt/Option+Click for multi-draw)`;
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
    return 'Alt moves connected';
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

  if (drawMode === 'line' || drawMode === 'tb-plan-line') {
    if (drawPoints.length === 0) return 'Place first point';
    if (drawPoints.length === 1) {
      if (drawMode === 'tb-plan-line') {
        const base = withMultiDrawHint(multiDrawModifierHeld, 'Place end point + continue', 'Place final point', true);
        if (drawElementType !== 'MechanicalVentilationDuctwork' && drawElementType !== 'WaterPipework') return base;
        return `${base} · ${elbowPreviewActive ? 'F flip' : 'Shift L'}`;
      }
      return withMultiDrawHint(multiDrawModifierHeld, 'Place end point + continue', 'Place final point');
    }
    return null;
  }
  if (drawMode === 'tb-vertical-line') {
    if (drawPoints.length === 0) {
      return withMultiDrawHint(multiDrawModifierHeld, 'Place vertical run + continue', 'Place vertical run', true);
    }
    return withMultiDrawHint(multiDrawModifierHeld, 'Create vertical run + continue', 'Create vertical run from current point', true);
  }
  if (drawMode === 'tb-slope-line') {
    if (drawPoints.length === 0) return 'Place first point';
    if (drawPoints.length === 1) {
      return withMultiDrawHint(multiDrawModifierHeld, 'Place end point + continue', 'Place second point', true);
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


/** Konva name of the draggable whole-shape handle (see `selected-shape-drag`). */
export const SELECTED_SHAPE_DRAG_HANDLE_NAME = 'selected-shape-drag-handle';

export function classifyHoverHandle(node: Konva.Node | null): HoverHintTarget['kind'] | null {
  // Handles only render for a selected element, and read-only ones are not draggable.
  if (!node?.draggable()) return null;
  const name: string = node.name();
  if (name.startsWith('orientation-arrow-handle-')) return 'rotate-grip';
  if (name.startsWith('vertex-')) return 'vertex';
  if (name.startsWith('space-label-vertex-')) return 'label-vertex';
  if (name === SELECTED_SHAPE_DRAG_HANDLE_NAME || name.startsWith('point-')) return 'body';
  return null;
}

/** The drag handle under a hovered node: the node itself, or the selected point group it sits in. */
export function resolveHoverHandle(node: Konva.Node | null): Konva.Node | null {
  if (!node || node.draggable()) return node;
  return node.findAncestor((n: Konva.Node) => n.draggable() && n.name().startsWith('point-')) ?? null;
}

