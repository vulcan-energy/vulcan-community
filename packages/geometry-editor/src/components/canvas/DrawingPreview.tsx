// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { memo } from 'react';
import { Group, Line, Circle, Rect, Text } from 'react-konva';
import {
  getDrawModeTooltipPillWidth,
  DRAW_MODE_TOOLTIP_PILL_HEIGHT,
  DRAW_MODE_TOOLTIP_PILL_FONT_FAMILY,
  DRAW_MODE_TOOLTIP_PILL_PADDING,
} from '../../lib/drawModeTooltipPill';
import { worldToCanvas } from '../../lib/shapeUtils';
import { calculateDrawingPreviewArrow, calculateArrowPoints } from '../../lib/directionArrows';
import { buildPvPanelRectangleCoords } from '../../lib/pvPanelFootprint';
import type { DrawMode } from '../../hooks/useDrawingMode';
import type { ElementType } from '../../stores/geometryStore';
import type { DrawingCanvasPalette } from './drawingPreviewPalette';

// Blue dot + hint pill track snap/cursor while drawing; fall back to a committed
// vertex only when the pointer is unavailable (e.g. cursor left the stage).
function getPlacementStartPoint(
  drawMode: DrawMode,
  drawPoints: Array<{ x: number; y: number }>,
  _roomWalls: Array<{ x: number; y: number }>,
  orthogonalRoomStart: { x: number; y: number } | null,
  drawCursor: { x: number; y: number } | null,
  drawSnapTargetRef: React.RefObject<{ x: number; y: number } | null>
): { x: number; y: number } | null {
  if (drawMode === 'none') return null;

  const snapOrCursor = drawSnapTargetRef.current || drawCursor || null;

  if (drawMode === 'point' || drawMode === 'room' || drawMode === 'dormer') {
    return snapOrCursor;
  }

  if (drawMode === 'line' || drawMode === 'tb-plan-line' || drawMode === 'tb-vertical-line' || drawMode === 'tb-slope-line') {
    if (snapOrCursor) return snapOrCursor;
    if (drawPoints.length === 1) return drawPoints[0];
    return null;
  }

  if (drawMode === 'polygon' || drawMode === 'space-label-polygon' || drawMode === 'sloped-polygon') {
    if (snapOrCursor) return snapOrCursor;
    if (drawPoints.length > 0) return drawPoints[drawPoints.length - 1];
    return null;
  }

  if (drawMode === 'orthogonal-room') {
    if (snapOrCursor) return snapOrCursor;
    if (orthogonalRoomStart) return orthogonalRoomStart;
    return null;
  }

  return null;
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

// Helper: Get tooltip text based on draw mode and state
function getDrawModeTooltipText(
  drawMode: DrawMode,
  drawPoints: Array<{ x: number; y: number }>,
  roomWalls: Array<{ x: number; y: number }>,
  orthogonalRoomStart: { x: number; y: number } | null,
  orthogonalRoomEnd: { x: number; y: number } | null,
  drawCursor: { x: number; y: number } | null,
  drawSnapTargetRef: React.RefObject<{ x: number; y: number } | null>,
  drawElementType: ElementType,
  multiDrawModifierHeld: boolean,
): string | null {
  if (drawMode === 'none') return null;

  if (drawMode === 'point') {
    return multiDrawModifierHeld
      ? 'Place object + continue'
      : 'Place object (Alt/Option+Click for multi-draw)';
  }

  if (drawMode === 'dormer') {
    return 'Click a sloped roof where the dormer window centre should go';
  }

  if (drawMode === 'line' || drawMode === 'tb-plan-line') {
    if (drawPoints.length === 0) return 'Place first point';
    if (drawPoints.length === 1) {
      if (drawMode === 'tb-plan-line') {
        return multiDrawModifierHeld
          ? 'Place end point + continue (P/V/S switches shape)'
          : 'Place final point (Alt/Option+Click to keep drawing; P/V/S switches shape)';
      }
      return multiDrawModifierHeld
        ? 'Place end point + continue'
        : 'Place final point (Alt/Option+Click for multi-draw)';
    }
    return null;
  }
  if (drawMode === 'tb-vertical-line') {
    if (drawPoints.length === 0) {
      return multiDrawModifierHeld
        ? 'Place vertical run + continue (P/V/S switches shape)'
        : 'Place vertical run (Alt/Option+Click to keep drawing; P/V/S switches shape)';
    }
    return multiDrawModifierHeld
      ? 'Create vertical run + continue (P/V/S switches shape)'
      : 'Create vertical run from current point (Alt/Option+Click to keep drawing; P/V/S switches shape)';
  }
  if (drawMode === 'tb-slope-line') {
    if (drawPoints.length === 0) return 'Place first point';
    if (drawPoints.length === 1) {
      return multiDrawModifierHeld
        ? 'Place end point + continue (P/V/S switches shape)'
        : 'Place second point (Alt/Option+Click to keep drawing; P/V/S switches shape)';
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

// Render drawing tooltip with the same high-contrast surface as canvas labels.
function renderDrawingTooltip(
  text: string,
  position: { x: number; y: number },
  palette: DrawingCanvasPalette,
) {
  const tooltipWidth = Math.max(60, text.length * 8 + 16);
  const tooltipHeight = 24;

  return (
    <Group key="drawing-tooltip">
      <Rect
        x={position.x}
        y={position.y}
        width={tooltipWidth}
        height={tooltipHeight}
        fill={palette.tooltipBg}
        stroke={palette.tooltipBorder}
        strokeWidth={1}
        cornerRadius={8}
        shadowColor={palette.tooltipShadow}
        shadowBlur={4}
        shadowOffset={{ x: 0, y: 2 }}
        listening={false}
      />
      <Text
        x={position.x + 8}
        y={position.y + 6}
        text={text}
        fontSize={12}
        fill={palette.tooltipText}
        fontStyle="bold"
        width={tooltipWidth - 16}
        ellipsis={true}
        listening={false}
      />
    </Group>
  );
}

function renderDrawModeTooltipPill(
  text: string,
  position: { x: number; y: number },
  palette: DrawingCanvasPalette,
) {
  const width = getDrawModeTooltipPillWidth(text);
  const innerW = width - DRAW_MODE_TOOLTIP_PILL_PADDING * 2;

  return (
    <Group key="draw-mode-tooltip-pill">
      <Rect
        x={position.x}
        y={position.y}
        width={width}
        height={DRAW_MODE_TOOLTIP_PILL_HEIGHT}
        fill={palette.snap}
        cornerRadius={10}
        listening={false}
      />
      <Text
        x={position.x + DRAW_MODE_TOOLTIP_PILL_PADDING}
        y={position.y + 4}
        text={text}
        fontSize={11}
        fill={palette.snapText}
        fontStyle="normal"
        fontFamily={DRAW_MODE_TOOLTIP_PILL_FONT_FAMILY}
        width={innerW}
        align="center"
        listening={false}
      />
    </Group>
  );
}

export interface DrawingPreviewProps {
  drawMode: DrawMode;
  drawPoints: Array<{ x: number; y: number }>;
  drawCursor: { x: number; y: number } | null;
  drawAngleSnapped: boolean;
  drawSnapTargetRef: React.RefObject<{ x: number; y: number } | null>;
  roomWalls: Array<{ x: number; y: number }>;
  orthogonalRoomStart: { x: number; y: number } | null;
  orthogonalRoomEnd: { x: number; y: number } | null;
  scale: number;
  panOffset: { x: number; y: number };
  canvasCenter: { x: number; y: number };
  drawElementType: ElementType;
  multiDrawModifierHeld: boolean;
  /** Preset/module long×short (m) for PV ghost footprint while drawing */
  pvFootprintPreview: { longM: number; shortM: number; pitchDegrees?: number } | null;
  /** Resolved plan cutout (mono-pitch defaults) while hovering a valid sloped host in dormer draw mode */
  dormerDrawPreviewCutout: Array<{ x: number; y: number; z: number }> | null;
  drawingTooltip: { visible: boolean; text: string; position: { x: number; y: number } };
  segmentLengthPreview: { visible: boolean; text: string; position: { x: number; y: number } };
  canvasPalette: DrawingCanvasPalette;
}

export const DrawingPreview = memo<DrawingPreviewProps>(function DrawingPreview({
  drawMode,
  drawPoints,
  drawCursor,
  drawAngleSnapped,
  drawSnapTargetRef,
  roomWalls,
  orthogonalRoomStart,
  orthogonalRoomEnd,
  scale,
  panOffset,
  canvasCenter,
  drawElementType,
  multiDrawModifierHeld,
  pvFootprintPreview,
  dormerDrawPreviewCutout,
  drawingTooltip,
  segmentLengthPreview,
  canvasPalette,
}) {
  const w2c = (p: { x: number; y: number }) => worldToCanvas(p, scale, panOffset, canvasCenter);
  const isPvSlopedDraw = drawMode === 'sloped-polygon' && drawElementType === 'OnSiteGeneration';
  const palette = canvasPalette;

  return (
    <Group>
      {/* Line draw mode: preview from first point to cursor */}
      {(drawMode === 'line' || drawMode === 'tb-plan-line' || drawMode === 'tb-slope-line') && drawPoints.length === 1 && drawCursor && (
        <>
          <Line
            points={[
              w2c(drawPoints[0]).x,
              w2c(drawPoints[0]).y,
              w2c(drawCursor).x,
              w2c(drawCursor).y,
            ]}
            stroke={drawAngleSnapped ? palette.snap : palette.guide}
            strokeWidth={2}
            dash={[4, 4]}
            listening={false}
          />
          {drawElementType !== 'BuildingElementOpaque' && drawElementType !== 'BuildingElementTransparent' ? null : (() => {
            const previewArrow = calculateDrawingPreviewArrow(
              drawPoints[0],
              drawCursor,
              0,
              scale
            );
            if (!previewArrow) return null;
            const dx = drawCursor.x - drawPoints[0].x;
            const dy = drawCursor.y - drawPoints[0].y;
            const wallDirection = (Math.atan2(dy, dx) * 180) / Math.PI;
            const normalDirection = wallDirection + 90;
            const orientation360 = (90 + normalDirection + 360) % 360;
            const arrow = calculateDrawingPreviewArrow(
              drawPoints[0],
              drawCursor,
              orientation360,
              scale
            );
            if (!arrow) return null;
            const centerCanvas = w2c({ x: arrow.centerX, y: arrow.centerY });
            const arrowCanvas = w2c({ x: arrow.arrowX, y: arrow.arrowY });
            const arrowPoints = calculateArrowPoints({
              centerX: centerCanvas.x,
              centerY: centerCanvas.y,
              arrowX: arrowCanvas.x,
              arrowY: arrowCanvas.y,
              orientation: arrow.orientation,
            });
            return (
              <>
                <Line
                  points={[centerCanvas.x, centerCanvas.y, arrowCanvas.x, arrowCanvas.y]}
                  stroke={palette.guide}
                  strokeWidth={2}
                  lineCap="round"
                  listening={false}
                />
                <Line
                  points={[
                    arrowPoints.tip.x, arrowPoints.tip.y,
                    arrowPoints.left.x, arrowPoints.left.y,
                    arrowPoints.tip.x, arrowPoints.tip.y,
                    arrowPoints.right.x, arrowPoints.right.y,
                  ]}
                  stroke={palette.guide}
                  strokeWidth={2}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              </>
            );
          })()}
        </>
      )}

      {/* Unified blue dot and tooltip pill for all draw modes */}
      {(() => {
        const placementPoint = getPlacementStartPoint(
          drawMode,
          drawPoints,
          roomWalls,
          orthogonalRoomStart,
          drawCursor,
          drawSnapTargetRef
        );
        if (!placementPoint) return null;
        const tooltipText = getDrawModeTooltipText(
          drawMode,
          drawPoints,
          roomWalls,
          orthogonalRoomStart,
          orthogonalRoomEnd,
          drawCursor,
          drawSnapTargetRef,
          drawElementType,
          multiDrawModifierHeld,
        );
        const canvasPos = w2c(placementPoint);
        const tooltipWidth = tooltipText ? getDrawModeTooltipPillWidth(tooltipText) : 0;
        return (
          <Group key="draw-mode-indicator">
            <Circle
              name="drawing-preview-cursor"
              x={canvasPos.x}
              y={canvasPos.y}
              radius={3}
              fill={palette.snap}
              listening={false}
            />
            {tooltipText &&
              renderDrawModeTooltipPill(tooltipText, {
                x: canvasPos.x - tooltipWidth / 2,
                y: canvasPos.y - 15 - DRAW_MODE_TOOLTIP_PILL_HEIGHT,
              }, palette)}
          </Group>
        );
      })()}

      {/* Dormer draw mode: roof footprint + outward arrow (matches mono-pitch default placement) */}
      {drawMode === 'dormer' &&
        dormerDrawPreviewCutout &&
        dormerDrawPreviewCutout.length >= 3 &&
        (() => {
          const poly = dormerDrawPreviewCutout;
          const flat = poly.flatMap((p) => [w2c(p).x, w2c(p).y]);
          const p0 = poly[0];
          const p1 = poly[1];
          const arrow =
            p0 && p1 ? calculateDrawingPreviewArrow(
              { x: p0.x, y: p0.y },
              { x: p1.x, y: p1.y },
              0,
              scale,
            ) : null;
          return (
            <>
              <Line
                points={flat}
                stroke={palette.guide}
                strokeWidth={2}
                dash={[6, 4]}
                closed
                fill={palette.guideFill}
                listening={false}
              />
              {p0 && p1 && (
                <Line
                  points={[w2c(p0).x, w2c(p0).y, w2c(p1).x, w2c(p1).y]}
                  stroke={palette.guide}
                  strokeWidth={3}
                  listening={false}
                />
              )}
              {arrow &&
                (() => {
                  const centerCanvas = w2c({ x: arrow.centerX, y: arrow.centerY });
                  const arrowCanvas = w2c({ x: arrow.arrowX, y: arrow.arrowY });
                  const arrowPoints = calculateArrowPoints({
                    centerX: centerCanvas.x,
                    centerY: centerCanvas.y,
                    arrowX: arrowCanvas.x,
                    arrowY: arrowCanvas.y,
                    orientation: arrow.orientation,
                  });
                  return (
                    <>
                      <Line
                        points={[centerCanvas.x, centerCanvas.y, arrowCanvas.x, arrowCanvas.y]}
                        stroke={palette.guide}
                        strokeWidth={2}
                        listening={false}
                      />
                      <Line
                        points={[
                          arrowPoints.tip.x,
                          arrowPoints.tip.y,
                          arrowPoints.left.x,
                          arrowPoints.left.y,
                          arrowPoints.tip.x,
                          arrowPoints.tip.y,
                          arrowPoints.right.x,
                          arrowPoints.right.y,
                        ]}
                        stroke={palette.guide}
                        strokeWidth={2}
                        lineCap="round"
                        lineJoin="round"
                        listening={false}
                      />
                    </>
                  );
                })()}
            </>
          );
        })()}

      {/* Sloped-polygon draw mode preview */}
      {drawMode === 'sloped-polygon' && drawPoints.length > 0 && (
        <>
          {drawPoints.length === 1 && drawCursor && isPvSlopedDraw && pvFootprintPreview && (() => {
            const quad = buildPvPanelRectangleCoords({
              A: drawPoints[0],
              B_dir: drawCursor,
              z: 0,
              longM: pvFootprintPreview.longM,
              shortM: pvFootprintPreview.shortM,
              flipUpslope: false,
              bottomIsLong: true,
              pitchDegrees: pvFootprintPreview.pitchDegrees,
            });
            const c0 = w2c({ x: quad[0].x, y: quad[0].y });
            const c1 = w2c({ x: quad[1].x, y: quad[1].y });
            const c2 = w2c({ x: quad[2].x, y: quad[2].y });
            const c3 = w2c({ x: quad[3].x, y: quad[3].y });
            const dx = drawCursor.x - drawPoints[0].x;
            const dy = drawCursor.y - drawPoints[0].y;
            const wallDirection = (Math.atan2(dy, dx) * 180) / Math.PI;
            const orientation360 = (90 + wallDirection + 90 + 360) % 360;
            const arrow = calculateDrawingPreviewArrow(drawPoints[0], drawCursor, orientation360, scale);
            return (
              <>
                <Line
                  points={[c0.x, c0.y, c1.x, c1.y]}
                  stroke={palette.guide}
                  strokeWidth={3}
                  listening={false}
                />
                <Line
                  points={[c1.x, c1.y, c2.x, c2.y, c3.x, c3.y, c0.x, c0.y]}
                  stroke={palette.guide}
                  strokeWidth={2}
                  dash={[6, 4]}
                  listening={false}
                  closed
                />
                {arrow &&
                  (() => {
                    const centerCanvas = w2c({ x: arrow.centerX, y: arrow.centerY });
                    const arrowCanvas = w2c({ x: arrow.arrowX, y: arrow.arrowY });
                    const arrowPoints = calculateArrowPoints({
                      centerX: centerCanvas.x,
                      centerY: centerCanvas.y,
                      arrowX: arrowCanvas.x,
                      arrowY: arrowCanvas.y,
                      orientation: arrow.orientation,
                    });
                    return (
                      <>
                        <Line points={[centerCanvas.x, centerCanvas.y, arrowCanvas.x, arrowCanvas.y]} stroke={palette.guide} strokeWidth={2} listening={false} />
                        <Line points={[arrowPoints.tip.x, arrowPoints.tip.y, arrowPoints.left.x, arrowPoints.left.y]} stroke={palette.guide} strokeWidth={2} listening={false} />
                        <Line points={[arrowPoints.tip.x, arrowPoints.tip.y, arrowPoints.right.x, arrowPoints.right.y]} stroke={palette.guide} strokeWidth={2} listening={false} />
                      </>
                    );
                  })()}
              </>
            );
          })()}
          {drawPoints.length === 1 && drawCursor && !isPvSlopedDraw && (
            <>
              <Line
                points={[
                  w2c(drawPoints[0]).x, w2c(drawPoints[0]).y,
                  w2c(drawCursor).x, w2c(drawCursor).y,
                ]}
                stroke={drawAngleSnapped ? palette.snap : palette.guide}
                strokeWidth={2}
                dash={[4, 4]}
                listening={false}
              />
              {(() => {
                const previewArrow = calculateDrawingPreviewArrow(
                  drawPoints[0], drawCursor, 0, scale
                );
                if (!previewArrow) return null;
                const dx = drawCursor.x - drawPoints[0].x;
                const dy = drawCursor.y - drawPoints[0].y;
                const wallDirection = (Math.atan2(dy, dx) * 180) / Math.PI;
                const orientation360 = (90 + wallDirection + 90 + 360) % 360;
                const arrow = calculateDrawingPreviewArrow(
                  drawPoints[0], drawCursor, orientation360, scale
                );
                if (!arrow) return null;
                const centerCanvas = w2c({ x: arrow.centerX, y: arrow.centerY });
                const arrowCanvas = w2c({ x: arrow.arrowX, y: arrow.arrowY });
                const arrowPoints = calculateArrowPoints({
                  centerX: centerCanvas.x, centerY: centerCanvas.y,
                  arrowX: arrowCanvas.x, arrowY: arrowCanvas.y,
                  orientation: arrow.orientation,
                });
                return (
                  <>
                    <Line points={[centerCanvas.x, centerCanvas.y, arrowCanvas.x, arrowCanvas.y]} stroke={palette.guide} strokeWidth={2} listening={false} />
                    <Line points={[arrowPoints.tip.x, arrowPoints.tip.y, arrowPoints.left.x, arrowPoints.left.y]} stroke={palette.guide} strokeWidth={2} listening={false} />
                    <Line points={[arrowPoints.tip.x, arrowPoints.tip.y, arrowPoints.right.x, arrowPoints.right.y]} stroke={palette.guide} strokeWidth={2} listening={false} />
                  </>
                );
              })()}
            </>
          )}
          {drawPoints.length === 1 && drawCursor && isPvSlopedDraw && !pvFootprintPreview && (
            <>
              <Line
                points={[
                  w2c(drawPoints[0]).x, w2c(drawPoints[0]).y,
                  w2c(drawCursor).x, w2c(drawCursor).y,
                ]}
                stroke={drawAngleSnapped ? palette.snap : palette.guide}
                strokeWidth={2}
                dash={[4, 4]}
                listening={false}
              />
            </>
          )}
          {drawPoints.length >= 2 && !isPvSlopedDraw && (
            <>
              <Line
                points={[
                  w2c(drawPoints[0]).x, w2c(drawPoints[0]).y,
                  w2c(drawPoints[1]).x, w2c(drawPoints[1]).y,
                ]}
                stroke={palette.guide}
                strokeWidth={3}
                listening={false}
              />
              {(() => {
                const previewArrow = calculateDrawingPreviewArrow(
                  drawPoints[0], drawPoints[1], 0, scale
                );
                if (!previewArrow) return null;
                const dx = drawPoints[1].x - drawPoints[0].x;
                const dy = drawPoints[1].y - drawPoints[0].y;
                const wallDirection = (Math.atan2(dy, dx) * 180) / Math.PI;
                const orientation360 = (90 + wallDirection + 90 + 360) % 360;
                const arrow = calculateDrawingPreviewArrow(
                  drawPoints[0], drawPoints[1], orientation360, scale
                );
                if (!arrow) return null;
                const centerCanvas = w2c({ x: arrow.centerX, y: arrow.centerY });
                const arrowCanvas = w2c({ x: arrow.arrowX, y: arrow.arrowY });
                const arrowPoints = calculateArrowPoints({
                  centerX: centerCanvas.x, centerY: centerCanvas.y,
                  arrowX: arrowCanvas.x, arrowY: arrowCanvas.y,
                  orientation: arrow.orientation,
                });
                return (
                  <>
                    <Line points={[centerCanvas.x, centerCanvas.y, arrowCanvas.x, arrowCanvas.y]} stroke={palette.guide} strokeWidth={2} listening={false} />
                    <Line points={[arrowPoints.tip.x, arrowPoints.tip.y, arrowPoints.left.x, arrowPoints.left.y]} stroke={palette.guide} strokeWidth={2} listening={false} />
                    <Line points={[arrowPoints.tip.x, arrowPoints.tip.y, arrowPoints.right.x, arrowPoints.right.y]} stroke={palette.guide} strokeWidth={2} listening={false} />
                  </>
                );
              })()}
            </>
          )}
          {drawPoints.length >= 3 && !isPvSlopedDraw && (
            <Line
              points={drawPoints.flatMap((p) => [w2c(p).x, w2c(p).y])}
              stroke={palette.guide}
              strokeWidth={2}
              closed={false}
              dash={[6, 3]}
              listening={false}
            />
          )}
          {drawCursor && drawPoints.length > 0 && (!isPvSlopedDraw || drawPoints.length >= 2) && (
            <Line
              points={[
                w2c(drawPoints[drawPoints.length - 1]).x, w2c(drawPoints[drawPoints.length - 1]).y,
                w2c(drawCursor).x, w2c(drawCursor).y,
              ]}
              stroke={drawAngleSnapped ? palette.snap : palette.guide}
              strokeWidth={2}
              dash={[4, 4]}
              listening={false}
            />
          )}
          {drawPoints.map((point, i) => (
            <Circle
              key={i}
              x={w2c(point).x}
              y={w2c(point).y}
              radius={4}
              fill={palette.handleFill}
              stroke={palette.handleStroke}
              strokeWidth={2}
              listening={false}
            />
          ))}
        </>
      )}

      {/* Polygon draw mode preview */}
      {(drawMode === 'polygon' || drawMode === 'space-label-polygon') && drawPoints.length > 0 && (
        <>
          <Line
            points={drawPoints.flatMap((p) => [w2c(p).x, w2c(p).y])}
            stroke={palette.guide}
            strokeWidth={2}
            dash={[4, 4]}
            listening={false}
          />
          {drawCursor && drawPoints.length > 0 && (
            <Line
              points={[
                w2c(drawPoints[drawPoints.length - 1]).x, w2c(drawPoints[drawPoints.length - 1]).y,
                w2c(drawCursor).x, w2c(drawCursor).y,
              ]}
              stroke={drawAngleSnapped ? palette.snap : palette.guide}
              strokeWidth={2}
              dash={[4, 4]}
              listening={false}
            />
          )}
          {drawSnapTargetRef.current && (
            <Circle
              x={w2c(drawSnapTargetRef.current).x}
              y={w2c(drawSnapTargetRef.current).y}
              radius={3}
              fill={palette.snap}
              listening={false}
            />
          )}
          {drawPoints.map((point, index) => (
            <Circle
              key={index}
              x={w2c(point).x}
              y={w2c(point).y}
              radius={3}
              fill={palette.handleFill}
              stroke={palette.handleStroke}
              strokeWidth={1}
              listening={false}
            />
          ))}
        </>
      )}

      {/* Orthogonal room drawing preview */}
      {drawMode === 'orthogonal-room' && orthogonalRoomStart && orthogonalRoomEnd && (
        (() => {
          const start = orthogonalRoomStart;
          const end = orthogonalRoomEnd;
          const minX = Math.min(start.x, end.x);
          const maxX = Math.max(start.x, end.x);
          const minY = Math.min(start.y, end.y);
          const maxY = Math.max(start.y, end.y);
          const width = maxX - minX;
          const height = maxY - minY;
          const topLeft = w2c({ x: minX, y: minY });
          const bottomRight = w2c({ x: maxX, y: maxY });
          const rectWidth = bottomRight.x - topLeft.x;
          const rectHeight = bottomRight.y - topLeft.y;
          return (
            <>
              <Rect
                x={topLeft.x}
                y={topLeft.y}
                width={rectWidth}
                height={rectHeight}
                stroke={palette.guide}
                strokeWidth={2}
                dash={[4, 4]}
                fill={palette.guideFill}
                listening={false}
              />
              <Text
                x={topLeft.x + rectWidth / 2}
                y={topLeft.y - 20}
                text={`${width.toFixed(2)}m`}
                fontSize={12}
                fill={palette.guide}
                align="center"
                listening={false}
              />
              <Text
                x={topLeft.x - 50}
                y={topLeft.y + rectHeight / 2}
                text={`${height.toFixed(2)}m`}
                fontSize={12}
                fill={palette.guide}
                align="center"
                listening={false}
              />
            </>
          );
        })()
      )}

      {/* Room drawing preview - hybrid wall segments + perimeter */}
      {drawMode === 'room' && roomWalls.length > 0 && (
        <>
          <Line
            points={roomWalls.flatMap((p) => [w2c(p).x, w2c(p).y])}
            stroke={palette.guide}
            strokeWidth={2}
            dash={[4, 4]}
            listening={false}
          />
          {roomWalls.length > 1 &&
            roomWalls.map((wall, i) => {
              if (i === 0) return null;
              const prevWall = roomWalls[i - 1];
              return (
                <Line
                  key={`wall-${i}`}
                  points={[
                    w2c(prevWall).x, w2c(prevWall).y,
                    w2c(wall).x, w2c(wall).y,
                  ]}
                  stroke={palette.guide}
                  strokeWidth={3}
                  dash={[2, 2]}
                  listening={false}
                />
              );
            })}
          {drawCursor && roomWalls.length > 0 && (
            <>
              <Line
                points={[
                  w2c(roomWalls[roomWalls.length - 1]).x, w2c(roomWalls[roomWalls.length - 1]).y,
                  w2c(drawCursor).x, w2c(drawCursor).y,
                ]}
                stroke={drawAngleSnapped ? palette.snap : palette.guide}
                strokeWidth={2}
                dash={[4, 4]}
                listening={false}
              />
              {(() => {
                const lastWall = roomWalls[roomWalls.length - 1];
                const previewArrow = calculateDrawingPreviewArrow(
                  lastWall, drawCursor, 0, scale
                );
                if (!previewArrow) return null;
                const dx = drawCursor.x - lastWall.x;
                const dy = drawCursor.y - lastWall.y;
                const wallDirection = (Math.atan2(dy, dx) * 180) / Math.PI;
                const orientation360 = (90 + wallDirection + 90 + 360) % 360;
                const arrow = calculateDrawingPreviewArrow(
                  lastWall, drawCursor, orientation360, scale
                );
                if (!arrow) return null;
                const centerCanvas = w2c({ x: arrow.centerX, y: arrow.centerY });
                const arrowCanvas = w2c({ x: arrow.arrowX, y: arrow.arrowY });
                const arrowPoints = calculateArrowPoints({
                  centerX: centerCanvas.x, centerY: centerCanvas.y,
                  arrowX: arrowCanvas.x, arrowY: arrowCanvas.y,
                  orientation: arrow.orientation,
                });
                return (
                  <>
                    <Line points={[centerCanvas.x, centerCanvas.y, arrowCanvas.x, arrowCanvas.y]} stroke={palette.guide} strokeWidth={2} lineCap="round" listening={false} />
                    <Line
                      points={[
                        arrowPoints.tip.x, arrowPoints.tip.y,
                        arrowPoints.left.x, arrowPoints.left.y,
                        arrowPoints.tip.x, arrowPoints.tip.y,
                        arrowPoints.right.x, arrowPoints.right.y,
                      ]}
                      stroke={palette.guide}
                      strokeWidth={2}
                      lineCap="round"
                      listening={false}
                    />
                  </>
                );
              })()}
            </>
          )}
          {drawSnapTargetRef.current && (
            <Circle
              x={w2c(drawSnapTargetRef.current).x}
              y={w2c(drawSnapTargetRef.current).y}
              radius={3}
              fill={palette.snap}
              listening={false}
            />
          )}
          {roomWalls.map((point, index) => (
            <Circle
              key={index}
              x={w2c(point).x}
              y={w2c(point).y}
              radius={3}
              fill={palette.handleFill}
              stroke={palette.handleStroke}
              strokeWidth={1}
              listening={false}
            />
          ))}
        </>
      )}

      {/* Drawing measurement tooltip */}
      {segmentLengthPreview.visible &&
        (() => {
          const width = getDrawModeTooltipPillWidth(segmentLengthPreview.text);
          return renderDrawModeTooltipPill(segmentLengthPreview.text, {
            x: segmentLengthPreview.position.x - width / 2,
            y: segmentLengthPreview.position.y - DRAW_MODE_TOOLTIP_PILL_HEIGHT / 2,
          }, palette);
        })()}

      {/* Pointer-following helper tooltip */}
      {drawingTooltip.visible &&
        renderDrawingTooltip(drawingTooltip.text, drawingTooltip.position, palette)}
    </Group>
  );
});
