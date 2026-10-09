// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, useMemo } from 'react';
import { Circle, Layer, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import { worldToCanvas } from '../../lib/shapeUtils';
import { readRootCssVar } from '../../lib/cssVars';
import type { AutoThermalBridgePreview, ThermalBridgePreviewAnchor } from '../../hooks/useAutoThermalBridgePreview';
import type { DrawingCanvasPalette } from './drawingPreviewPalette';
import { thermalBridgeCandidatesForRender, thermalBridgeIssuesForRender } from './thermalBridgePreviewRenderRows';

type Point = { x: number; y: number };
function distanceToPreviewSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function previewPointer(event: Konva.KonvaEventObject<MouseEvent>): ThermalBridgePreviewAnchor | null {
  return event.target.getStage()?.getPointerPosition() ?? null;
}

export const ThermalBridgePreview2D = memo(function ThermalBridgePreview2D({
  preview, scale, panOffset, canvasCenter, width, height, palette, onInspect, canActivate,
}: {
  preview: AutoThermalBridgePreview;
  scale: number;
  panOffset: Point;
  canvasCenter: Point;
  width: number;
  height: number;
  palette: DrawingCanvasPalette;
  onInspect: (id: string) => void;
  canActivate: () => boolean;
}) {
  const candidatesToRender = thermalBridgeCandidatesForRender(preview.candidates, preview);
  const issuesToRender = thermalBridgeIssuesForRender(preview.issues, preview);
  const projected = useMemo(() => candidatesToRender.map((candidate) => ({
    candidate,
    a: worldToCanvas(candidate.coordinates[0], scale, panOffset, canvasCenter),
    b: worldToCanvas(candidate.coordinates[1], scale, panOffset, canvasCenter),
  })), [candidatesToRender, scale, panOffset, canvasCenter]);
  const hitsAt = (point: Point) => projected.filter(({ a, b }) => distanceToPreviewSegment(point, a, b) <= 8);
  return (
    <Layer name="thermal-bridge-suggestions">
      <Rect width={width} height={height} fill="transparent"
        onMouseMove={(event) => {
          if (preview.pinned || event.evt.buttons !== 0) return;
          const point = previewPointer(event);
          if (point) preview.onHover(hitsAt(point).map(({ candidate }) => candidate.proposalId), point);
        }}
        onClick={(event) => {
          const point = previewPointer(event);
          if (!point || event.evt.button !== 0 || !canActivate()) return;
          event.cancelBubble = true;
          event.evt.stopPropagation();
          preview.onActivate(hitsAt(point).map(({ candidate }) => candidate.proposalId), point);
        }}
      />
      {projected.map(({ candidate, a, b }) => {
        const hovered = preview.hover?.ids.includes(candidate.proposalId);
        const common = { stroke: palette.guide, strokeWidth: hovered ? 4 : 2, listening: false };
        return Math.hypot(b.x - a.x, b.y - a.y) < 2
          ? <Circle key={candidate.proposalId} x={a.x} y={a.y} radius={hovered ? 7 : 5} {...common} />
          : <Line key={candidate.proposalId} points={[a.x, a.y, b.x, b.y]} dash={[7, 5]} {...common} />;
      })}
      {issuesToRender.map((row) => {
        if (row.tb.coordinates.length < 1) return null;
        const a = worldToCanvas(row.tb.coordinates[0], scale, panOffset, canvasCenter);
        const b = worldToCanvas(row.tb.coordinates[row.tb.coordinates.length - 1], scale, panOffset, canvasCenter);
        return <Circle key={row.tb.id} x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} radius={6}
          fill={row.severity === 'error' ? readRootCssVar('--validation-error-text', '#ef4444') : readRootCssVar('--validation-warning-text', '#d99b24')}
          stroke={palette.tooltipBg} strokeWidth={2}
          onMouseEnter={() => preview.onHover([`issue:${row.tb.id}`], { x: a.x, y: a.y })}
          onClick={(event) => {
            if (event.evt.button !== 0 || !canActivate()) return;
            event.cancelBubble = true;
            event.evt.stopPropagation();
            onInspect(row.tb.id);
          }} />;
      })}
    </Layer>
  );
});
