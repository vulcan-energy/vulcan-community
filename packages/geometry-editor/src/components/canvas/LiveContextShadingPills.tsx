// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { memo } from 'react';
import { Group, Rect, Text } from 'react-konva';
import type { ContextShading, Element, Floor } from '../../geometry/types';
import { contextShadingPartPill } from '../../lib/contextShadingDrawing';
import { deriveContextShadingInModel } from '../../lib/contextShadingGeometry';
import { DRAW_MODE_TOOLTIP_PILL_FONT_FAMILY, DRAW_MODE_TOOLTIP_PILL_PADDING } from '../../lib/drawModeTooltipPill';
import { worldToCanvas } from '../../lib/shapeUtils';
import { useAnyLiveContextShadingCoordinates } from './contextShadingLiveCoordinates';

export interface LiveContextShadingPillsProps {
  elementsById: Record<string, Element>;
  floors: Floor[];
  globalOrientationOffset: number;
  scale: number;
  panOffset: { x: number; y: number };
  canvasCenter: { x: number; y: number };
  positiveColor: string;
  warningColor: string;
}

/** The distance pills of the Context Shading object whose vertex is being dragged, from its live coordinates. */
export const LiveContextShadingPills = memo<LiveContextShadingPillsProps>(function LiveContextShadingPills({
  elementsById,
  floors,
  globalOrientationOffset,
  scale,
  panOffset,
  canvasCenter,
  positiveColor,
  warningColor,
}) {
  const live = useAnyLiveContextShadingCoordinates();
  const element = live ? elementsById[live.elementId] : undefined;
  if (!live || element?.type !== 'ContextShading') return null;
  const derived = deriveContextShadingInModel({ ...element, coordinates: live.coordinates } as ContextShading, Object.values(elementsById), floors, globalOrientationOffset);
  if (!derived || 'issue' in derived) return null;
  const project = (point: { x: number; y: number }) => worldToCanvas(point, scale, panOffset, canvasCenter);
  return (
    <Group listening={false}>
      {derived.parts.map((part, index) => {
        const { text, positive, rect } = contextShadingPartPill(part, project);
        return (
          // A face can be seen in two parts, so the index keys it too.
          <Group key={`context-shading-part-${live.elementId}-${index}-${part.face}`}>
            <Rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={positive ? positiveColor : warningColor} cornerRadius={10} />
            <Text
              x={rect.x + DRAW_MODE_TOOLTIP_PILL_PADDING}
              y={rect.y + 4}
              text={text}
              fontSize={11}
              fill="#FFFFFF"
              fontFamily={DRAW_MODE_TOOLTIP_PILL_FONT_FAMILY}
              width={rect.width - DRAW_MODE_TOOLTIP_PILL_PADDING * 2}
              align="center"
            />
          </Group>
        );
      })}
    </Group>
  );
});
