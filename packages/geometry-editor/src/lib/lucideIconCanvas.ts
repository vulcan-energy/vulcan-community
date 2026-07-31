// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { IconNode } from 'lucide';

export type PaintIconOnCanvasOptions = {
  /** Stroke colour for the icon strokes (e.g. white). */
  stroke: string;
  /** Stroke width in Lucide 24×24 units before scaling. */
  strokeWidth: number;
  /** Pixel size of the 24×24 icon box. */
  sizePx: number;
  /** Optional glow / halo in a second pass (e.g. type colour). */
  haloStroke?: string;
  haloStrokeWidth?: number;
};

function num(v: string | number | undefined, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function strokeOneSvgNode(
  ctx: CanvasRenderingContext2D,
  entry: IconNode[number],
  passStroke: string,
  passWidth: number,
): void {
  const [tag, attrs] = entry;
  ctx.strokeStyle = passStroke;
  ctx.lineWidth = passWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'transparent';

  if (tag === 'path') {
    const d = attrs.d;
    if (typeof d === 'string' && d.length > 0) {
      try {
        ctx.stroke(new Path2D(d));
      } catch {
        /* ignore */
      }
    }
  } else if (tag === 'circle') {
    const r = num(attrs.r);
    const x = num(attrs.cx);
    const y = num(attrs.cy);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  } else if (tag === 'ellipse') {
    const x = num(attrs.cx);
    const y = num(attrs.cy);
    const rx = num(attrs.rx);
    const ry = num(attrs.ry);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (tag === 'rect') {
    const x = num(attrs.x);
    const y = num(attrs.y);
    const w = num(attrs.width);
    const h = num(attrs.height);
    const rx = num(attrs.rx);
    const ry = num(attrs.ry, rx);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function' && rx > 0) {
      ctx.roundRect(x, y, w, h, rx || ry);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.stroke();
  } else if (tag === 'line') {
    ctx.beginPath();
    ctx.moveTo(num(attrs.x1), num(attrs.y1));
    ctx.lineTo(num(attrs.x2), num(attrs.y2));
    ctx.stroke();
  } else if (tag === 'polyline' || tag === 'polygon') {
    const pts = typeof attrs.points === 'string' ? attrs.points.trim().split(/\s+/) : [];
    if (pts.length >= 2) {
      ctx.beginPath();
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const px = Number(pts[i]);
        const py = Number(pts[i + 1]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      if (tag === 'polygon' && pts.length >= 4) ctx.closePath();
      ctx.stroke();
    }
  }
}

/**
 * Paints a Lucide {@link IconNode} centred in a square canvas of {@link PaintIconOnCanvasOptions.sizePx}.
 * Uses Canvas 2D so the same icon can back a Three.js texture.
 */
export function paintLucideIconOnCanvas(
  ctx: CanvasRenderingContext2D,
  node: IconNode,
  opts: PaintIconOnCanvasOptions,
): void {
  const { sizePx, stroke, strokeWidth, haloStroke, haloStrokeWidth } = opts;
  const s = sizePx / 24;
  const cx = sizePx / 2;
  const cy = sizePx / 2;
  const halo = haloStroke && haloStrokeWidth && haloStrokeWidth > 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-12, -12);

  for (const entry of node) {
    if (halo) strokeOneSvgNode(ctx, entry, haloStroke!, haloStrokeWidth!);
    strokeOneSvgNode(ctx, entry, stroke, strokeWidth);
  }

  ctx.restore();
}
