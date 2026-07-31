// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

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
