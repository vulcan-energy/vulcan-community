// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { Path, Circle, Rect, Ellipse, Line } from 'react-konva';
import type { IconNode } from 'lucide';

export type LucideIconKonvaOptions = {
  stroke: string;
  strokeWidth: number;
  keyPrefix: string;
  listening?: boolean;
  /** Wider invisible hit region for thin strokes. */
  hitStrokeWidth?: number;
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

/** Renders a Lucide {@link IconNode} as Konva vector shapes (24×24 origin top-left). */
export function lucideIconNodeToKonva(node: IconNode, opts: LucideIconKonvaOptions): React.ReactNode[] {
  const {
    stroke,
    strokeWidth,
    keyPrefix,
    listening = false,
    hitStrokeWidth = 10,
    haloStroke,
    haloStrokeWidth,
  } = opts;
  const out: React.ReactNode[] = [];
  let idx = 0;

  const halo = haloStroke && haloStrokeWidth && haloStrokeWidth > 0;

  for (const [tag, attrs] of node) {
    const hKey = `${keyPrefix}-h-${idx}`;
    const mKey = `${keyPrefix}-${idx}`;
    idx += 1;

    if (tag === 'path') {
      const d = typeof attrs.d === 'string' ? attrs.d : '';
      if (!d) continue;
      if (halo) {
        out.push(
          <Path
            key={hKey}
            data={d}
            stroke={haloStroke}
            strokeWidth={haloStrokeWidth}
            lineCap="round"
            lineJoin="round"
            fill="transparent"
            listening={false}
          />,
        );
      }
      out.push(
        <Path
          key={mKey}
          data={d}
          stroke={stroke}
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
          fill="transparent"
          listening={listening}
          hitStrokeWidth={hitStrokeWidth}
        />,
      );
    } else if (tag === 'circle') {
      const x = num(attrs.cx);
      const y = num(attrs.cy);
      const r = num(attrs.r);
      if (halo) {
        out.push(
          <Circle
            key={hKey}
            x={x}
            y={y}
            radius={r}
            stroke={haloStroke}
            strokeWidth={haloStrokeWidth}
            fill="transparent"
            listening={false}
          />,
        );
      }
      out.push(
        <Circle
          key={mKey}
          x={x}
          y={y}
          radius={r}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="transparent"
          listening={listening}
          hitStrokeWidth={hitStrokeWidth}
        />,
      );
    } else if (tag === 'ellipse') {
      const x = num(attrs.cx);
      const y = num(attrs.cy);
      const rx = num(attrs.rx);
      const ry = num(attrs.ry);
      if (halo) {
        out.push(
          <Ellipse
            key={hKey}
            x={x}
            y={y}
            radiusX={rx}
            radiusY={ry}
            stroke={haloStroke}
            strokeWidth={haloStrokeWidth}
            fill="transparent"
            listening={false}
          />,
        );
      }
      out.push(
        <Ellipse
          key={mKey}
          x={x}
          y={y}
          radiusX={rx}
          radiusY={ry}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="transparent"
          listening={listening}
          hitStrokeWidth={hitStrokeWidth}
        />,
      );
    } else if (tag === 'rect') {
      const x = num(attrs.x);
      const y = num(attrs.y);
      const w = num(attrs.width);
      const h = num(attrs.height);
      const rx = num(attrs.rx);
      if (halo) {
        out.push(
          <Rect
            key={hKey}
            x={x}
            y={y}
            width={w}
            height={h}
            cornerRadius={rx > 0 ? rx : 0}
            stroke={haloStroke}
            strokeWidth={haloStrokeWidth}
            fill="transparent"
            listening={false}
          />,
        );
      }
      out.push(
        <Rect
          key={mKey}
          x={x}
          y={y}
          width={w}
          height={h}
          cornerRadius={rx > 0 ? rx : 0}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="transparent"
          listening={listening}
          hitStrokeWidth={hitStrokeWidth}
        />,
      );
    } else if (tag === 'line') {
      const pts = [num(attrs.x1), num(attrs.y1), num(attrs.x2), num(attrs.y2)];
      if (halo) {
        out.push(
          <Line
            key={hKey}
            points={pts}
            stroke={haloStroke}
            strokeWidth={haloStrokeWidth}
            lineCap="round"
            listening={false}
          />,
        );
      }
      out.push(
        <Line
          key={mKey}
          points={pts}
          stroke={stroke}
          strokeWidth={strokeWidth}
          lineCap="round"
          listening={listening}
          hitStrokeWidth={hitStrokeWidth}
        />,
      );
    } else if (tag === 'polyline' || tag === 'polygon') {
      const raw = typeof attrs.points === 'string' ? attrs.points.trim().split(/\s+/) : [];
      const pts: number[] = [];
      for (let i = 0; i + 1 < raw.length; i += 2) {
        pts.push(Number(raw[i]), Number(raw[i + 1]));
      }
      if (pts.length < 4) continue;
      const linePts = tag === 'polygon' ? [...pts, pts[0]!, pts[1]!] : pts;
      if (halo) {
        out.push(
          <Line
            key={hKey}
            points={linePts}
            stroke={haloStroke}
            strokeWidth={haloStrokeWidth}
            lineCap="round"
            lineJoin="round"
            closed={tag === 'polygon'}
            listening={false}
          />,
        );
      }
      out.push(
        <Line
          key={mKey}
          points={linePts}
          stroke={stroke}
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
          closed={tag === 'polygon'}
          listening={listening}
          hitStrokeWidth={hitStrokeWidth}
        />,
      );
    }
  }

  return out;
}
