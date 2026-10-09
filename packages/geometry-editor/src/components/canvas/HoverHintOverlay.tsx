// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, useEffect, useState } from 'react';
import { Group } from 'react-konva';
import {
  getDrawModeTooltipPillWidth,
} from '../../lib/drawModeTooltipPill';
import { getHoverHintText, renderDrawModeTooltipPill } from './DrawingPreview';
import type { HoverHintTarget } from './DrawingPreview';
import type { DrawingCanvasPalette } from './drawingPreviewPalette';

/** Konva name of the draggable whole-shape handle (see `selected-shape-drag`). */
export const SELECTED_SHAPE_DRAG_HANDLE_NAME = 'selected-shape-drag-handle';

type Point = { x: number; y: number };
type Hover = HoverHintTarget & { pos: Point };

function classify(node: any): HoverHintTarget['kind'] | null {
  // Handles only render for a selected element, and read-only ones are not draggable.
  if (!node?.draggable?.()) return null;
  const name: string = node.name?.() ?? '';
  if (name.startsWith('orientation-arrow-handle-')) return 'rotate-grip';
  if (name.startsWith('vertex-')) return 'vertex';
  if (name === SELECTED_SHAPE_DRAG_HANDLE_NAME) return 'body';
  return null;
}

/**
 * Cursor + hint for the drag handles of the selected element. Hover state lives
 * here (own state, listeners on the Konva stage), so a mousemove never re-renders
 * the canvas; only handle enter/leave and drag start/end/move re-render this pill.
 */
export const HoverHintOverlay = memo<{
  stageRef: { current: any };
  enabled: boolean;
  palette: DrawingCanvasPalette;
}>(function HoverHintOverlay({ stageRef, enabled, palette }) {
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    const wrapper = stageRef.current;
    const stage = wrapper && typeof wrapper.getStage === 'function' ? wrapper.getStage() : wrapper;
    if (!enabled || !stage) return;
    const container: HTMLElement = stage.container();
    let node: any = null;
    let dragging = false;

    const pointer = (): Point => stage.getPointerPosition() ?? { x: 0, y: 0 };
    const sync = (kind: HoverHintTarget['kind'] | null) => {
      container.style.cursor =
        kind === null ? '' : kind === 'vertex' ? 'move' : dragging ? 'grabbing' : 'grab';
      setHover(kind === null ? null : { kind, dragging, pos: pointer() });
    };
    const kindOf = () => classify(node);
    const onDragStart = () => { dragging = true; sync(kindOf()); };
    const onDragMove = () => sync(kindOf());
    const onDragEnd = () => {
      dragging = false;
      if (stage.getIntersection(pointer()) === node) { sync(kindOf()); return; }
      leave();
    };
    const leave = () => {
      node?.off('.hoverhint');
      node = null;
      dragging = false;
      sync(null);
    };
    const onOver = (e: any) => {
      if (dragging) return;
      const kind = classify(e.target);
      if (!kind) return;
      node = e.target;
      node.on('dragstart.hoverhint', onDragStart);
      node.on('dragmove.hoverhint', onDragMove);
      node.on('dragend.hoverhint', onDragEnd);
      sync(kind);
    };
    const onOut = (e: any) => {
      if (e.target === node && !dragging) leave();
    };

    stage.on('mouseover.hoverhint', onOver);
    stage.on('mouseout.hoverhint', onOut);
    return () => {
      stage.off('.hoverhint');
      node?.off('.hoverhint');
      container.style.cursor = '';
      setHover(null);
    };
  }, [stageRef, enabled]);

  const text = hover ? getHoverHintText(hover) : null;
  if (!hover || !text) return null;
  // Below the cursor so it never stacks on the snap pill, which sits above the snap point.
  return (
    <Group listening={false}>
      {renderDrawModeTooltipPill(
        text,
        {
          x: hover.pos.x - getDrawModeTooltipPillWidth(text) / 2,
          y: hover.pos.y + 18,
        },
        palette,
        'hover-hint-pill',
      )}
    </Group>
  );
});
