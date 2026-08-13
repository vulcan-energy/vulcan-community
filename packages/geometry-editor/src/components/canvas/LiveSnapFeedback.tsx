// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, useSyncExternalStore } from 'react';
import { Circle, Group, Line } from 'react-konva';
import type { Element } from '../../geometry/types';
import { calculateArrowPoints, calculateDirectionArrow } from '../../lib/directionArrows';
import {
  DRAW_MODE_TOOLTIP_PILL_HEIGHT,
  getDrawModeTooltipPillWidth,
} from '../../lib/drawModeTooltipPill';
import type { SnapEvent } from '../../lib/snapEvent';
import { worldToCanvas } from '../../lib/shapeUtils';
import { renderDrawModeTooltipPill } from './DrawingPreview';
import type { DrawingCanvasPalette } from './drawingPreviewPalette';
import type { CanvasInteractionPalette } from './elementRendererPalette';
import type { SnapFeedbackSignal } from './snapFeedbackSignal';

export interface LiveSnapFeedbackProps {
  previewSignal: SnapFeedbackSignal;
  elementsById: Record<string, Element>;
  activeElementId?: string;
  scale: number;
  panOffset: { x: number; y: number };
  canvasCenter: { x: number; y: number };
  canvasInteractionPalette: CanvasInteractionPalette;
  drawingCanvasPalette: DrawingCanvasPalette;
  globalOrientationOffset: number;
}

type CanvasPoint = { x: number; y: number };

const ANGULAR_KINDS = new Set<SnapEvent['kind']>([
  'neighbour-bearing',
  'edge-normal',
  'angle-step',
  'cardinal',
  'right-angle',
]);

function angularPillText(event: SnapEvent, sourceElement: Element | undefined): string | null {
  if (!ANGULAR_KINDS.has(event.kind)) return null;
  const value = event.kind === 'right-angle' ? 90 : event.value;
  if (value === undefined) return null;
  const rounded = Math.round(value * 10) / 10;
  const sourceLabel = event.sourceElementId
    ? sourceElement?.name || event.sourceElementId
    : null;
  return sourceLabel ? `${rounded}° · ${sourceLabel}` : `${rounded}°`;
}

export const LiveSnapFeedback = memo<LiveSnapFeedbackProps>(function LiveSnapFeedback({
  previewSignal,
  elementsById,
  activeElementId,
  scale,
  panOffset,
  canvasCenter,
  canvasInteractionPalette,
  drawingCanvasPalette,
  globalOrientationOffset,
}) {
  const { event } = useSyncExternalStore(
    previewSignal.subscribe,
    previewSignal.getSnapshot,
    previewSignal.getSnapshot,
  );
  if (!event) return null;

  const sourceElement = event.sourceElementId
    ? elementsById[event.sourceElementId]
    : undefined;
  const toCanvas = (point: { x: number; y: number }) => (
    worldToCanvas(point, scale, panOffset, canvasCenter)
  );

  let cornerAnchor: CanvasPoint | null = null;
  if (
    event.kind === 'corner' &&
    event.sourceVertexOrder !== undefined
  ) {
    const sourceVertex = sourceElement?.coordinates?.[event.sourceVertexOrder];
    if (sourceVertex) cornerAnchor = toCanvas(sourceVertex);
  }

  let segmentPoints: number[] | null = null;
  let segmentAnchor: CanvasPoint | null = null;
  if (
    (event.kind === 'wall-segment' || event.kind === 'parent-edge' || event.kind === 'perp-foot') &&
    sourceElement?.coordinates?.length === 2
  ) {
    const start = toCanvas(sourceElement.coordinates[0]);
    const end = toCanvas(sourceElement.coordinates[1]);
    segmentPoints = [start.x, start.y, end.x, end.y];
    segmentAnchor = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }

  let edgePoints: number[] | null = null;
  let edgeAnchor: CanvasPoint | null = null;
  const sourceCoordinates = sourceElement?.coordinates;
  if (
    event.kind === 'edge-normal' &&
    event.sourceEdgeIndex !== undefined &&
    sourceCoordinates &&
    sourceCoordinates.length > 1
  ) {
    const startCoord = sourceCoordinates[event.sourceEdgeIndex];
    const endCoord = sourceCoordinates[
      (event.sourceEdgeIndex + 1) % sourceCoordinates.length
    ];
    if (startCoord && endCoord) {
      const start = toCanvas(startCoord);
      const end = toCanvas(endCoord);
      edgePoints = [start.x, start.y, end.x, end.y];
      edgeAnchor = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    }
  }

  let neighbourArrow: {
    shaft: number[];
    head: number[];
    tip: CanvasPoint;
  } | null = null;
  if (event.kind === 'neighbour-bearing' && sourceElement) {
    const directionArrow = calculateDirectionArrow(sourceElement, globalOrientationOffset);
    if (directionArrow) {
      const center = toCanvas({ x: directionArrow.centerX, y: directionArrow.centerY });
      const tip = toCanvas({ x: directionArrow.arrowX, y: directionArrow.arrowY });
      const head = calculateArrowPoints({
        centerX: center.x,
        centerY: center.y,
        arrowX: tip.x,
        arrowY: tip.y,
        orientation: directionArrow.orientation,
      });
      neighbourArrow = {
        shaft: [center.x, center.y, tip.x, tip.y],
        head: [
          head.tip.x, head.tip.y,
          head.left.x, head.left.y,
          head.tip.x, head.tip.y,
          head.right.x, head.right.y,
        ],
        tip,
      };
    }
  }

  const activeElement = activeElementId ? elementsById[activeElementId] : undefined;
  const activeArrow = activeElement
    ? calculateDirectionArrow(activeElement, globalOrientationOffset)
    : null;
  const activeArrowTip = activeArrow
    ? toCanvas({ x: activeArrow.arrowX, y: activeArrow.arrowY })
    : null;
  const activeFirstPoint = activeElement?.coordinates?.[0]
    ? toCanvas(activeElement.coordinates[0])
    : null;
  const pillText = angularPillText(event, sourceElement);
  const eventPositionAnchor = event.position ? toCanvas(event.position) : null;
  const pillAnchor = eventPositionAnchor
    ?? activeArrowTip
    ?? edgeAnchor
    ?? neighbourArrow?.tip
    ?? cornerAnchor
    ?? segmentAnchor
    ?? activeFirstPoint;

  return (
    <Group name="snap-feedback" listening={false}>
      {cornerAnchor && (
        <Circle
          name="snap-feedback-corner"
          x={cornerAnchor.x}
          y={cornerAnchor.y}
          radius={9}
          stroke={canvasInteractionPalette.snap}
          strokeWidth={3}
          listening={false}
        />
      )}
      {segmentPoints && (
        <Line
          name="snap-feedback-segment"
          points={segmentPoints}
          stroke={canvasInteractionPalette.snap}
          strokeWidth={4}
          lineCap="round"
          listening={false}
        />
      )}
      {edgePoints && (
        <Line
          name="snap-feedback-edge"
          points={edgePoints}
          stroke={canvasInteractionPalette.snap}
          strokeWidth={4}
          lineCap="round"
          listening={false}
        />
      )}
      {neighbourArrow && (
        <Group name="snap-feedback-neighbour-arrow" listening={false}>
          <Line
            points={neighbourArrow.shaft}
            stroke={canvasInteractionPalette.snap}
            strokeWidth={4}
            lineCap="round"
            listening={false}
          />
          <Line
            points={neighbourArrow.head}
            stroke={canvasInteractionPalette.snap}
            strokeWidth={4}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        </Group>
      )}
      {pillText && pillAnchor && renderDrawModeTooltipPill(
        pillText,
        {
          x: pillAnchor.x - getDrawModeTooltipPillWidth(pillText) / 2,
          y: pillAnchor.y - 15 - DRAW_MODE_TOOLTIP_PILL_HEIGHT,
        },
        drawingCanvasPalette,
      )}
    </Group>
  );
});
