// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, useMemo } from 'react';
import { Circle, Layer, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import { worldToCanvas } from '../../lib/shapeUtils';
import { readRootCssVar } from '../../lib/cssVars';
import type { CanvasPreview, ThermalBridgePreviewAnchor } from '../../hooks/useAutoThermalBridgePreview';
import { MVHR_DUCT_ROLE_STYLES } from '../../lib/mvhrDuctwork';
import type { AutoThermalBridgeCandidate } from '../../geometry/thermalBridge/autoThermalBridgeCandidates';
import type { DrawingCanvasPalette } from './drawingPreviewPalette';
import { thermalBridgeCandidatesForRender, thermalBridgeIssuesForRender } from './thermalBridgePreviewRenderRows';

type Point = { x: number; y: number };
const NO_CANDIDATES: readonly AutoThermalBridgeCandidate[] = [];
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
  preview: CanvasPreview;
  scale: number;
  panOffset: Point;
  canvasCenter: Point;
  width: number;
  height: number;
  palette: DrawingCanvasPalette;
  onInspect: (id: string) => void;
  canActivate: () => boolean;
}) {
  const candidatesToRender = preview.kind === 'duct' ? NO_CANDIDATES : thermalBridgeCandidatesForRender(preview.candidates, preview);
  const issuesToRender = preview.kind === 'duct' ? [] : thermalBridgeIssuesForRender(preview.issues, preview);
  const runs = preview.kind === 'duct' ? preview.runs : null;
  // A thermal-bridge candidate is one segment; a duct run is several, drawn in its role's style.
  const projected = useMemo(() => runs
    ? runs.flatMap((run) => run.segments.map(([a, b], segment) => ({
        id: run.proposalId, key: `${run.proposalId}:${segment}`, style: MVHR_DUCT_ROLE_STYLES[run.role],
        end: worldToCanvas(run.segments[run.segments.length - 1]![1], scale, panOffset, canvasCenter),
        a: worldToCanvas(a, scale, panOffset, canvasCenter), b: worldToCanvas(b, scale, panOffset, canvasCenter),
      })))
    : candidatesToRender.map((candidate) => ({
        id: candidate.proposalId, key: candidate.proposalId, style: null, end: null,
        a: worldToCanvas(candidate.coordinates[0], scale, panOffset, canvasCenter),
        b: worldToCanvas(candidate.coordinates[1], scale, panOffset, canvasCenter),
      })), [runs, candidatesToRender, scale, panOffset, canvasCenter]);
  // Every run meets at the unit, so hover and click take one run: the nearest, and on a stretch runs
  // share (within half a pixel), the one whose room end is nearest. Overlapping bridges all go to the chooser.
  const hitIds = (point: Point) => {
    const hits = projected.flatMap((row) => {
      const d = distanceToPreviewSegment(point, row.a, row.b);
      return d <= 8 ? [{ id: row.id, d, toEnd: row.end ? Math.hypot(point.x - row.end.x, point.y - row.end.y) : 0 }] : [];
    });
    if (!runs) return hits.map(({ id }) => id);
    return hits.length ? [hits.reduce((best, hit) =>
      (hit.d < best.d - 0.5 || (Math.abs(hit.d - best.d) <= 0.5 && hit.toEnd < best.toEnd) ? hit : best)).id] : [];
  };
  return (
    <Layer name="thermal-bridge-suggestions">
      <Rect width={width} height={height} fill="transparent"
        onMouseMove={(event) => {
          if (preview.pinned || event.evt.buttons !== 0) return;
          const point = previewPointer(event);
          if (point) preview.onHover(hitIds(point), point);
        }}
        onClick={(event) => {
          const point = previewPointer(event);
          if (!point || event.evt.button !== 0 || !canActivate()) return;
          event.cancelBubble = true;
          event.evt.stopPropagation();
          preview.onActivate(hitIds(point), point);
        }}
      />
      {projected.map(({ id, key, style, a, b }) => {
        const hovered = preview.hover?.ids.includes(id);
        if (style) {
          // The candidate colour reads as a suggestion; the role's dash keeps roles apart.
          return <Line key={key} points={[a.x, a.y, b.x, b.y]} stroke={palette.guide}
            strokeWidth={hovered ? 4 : 2} dash={[...style.dash]} listening={false} />;
        }
        const common = { stroke: palette.guide, strokeWidth: hovered ? 4 : 2, listening: false };
        return Math.hypot(b.x - a.x, b.y - a.y) < 2
          ? <Circle key={id} x={a.x} y={a.y} radius={hovered ? 7 : 5} {...common} />
          : <Line key={id} points={[a.x, a.y, b.x, b.y]} dash={[7, 5]} {...common} />;
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
