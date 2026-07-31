// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { CanvasInteractionKind } from './canvasInteractionSession';

export type StageMouseMoveWorkInput = {
  drawMode: string;
  marqueeActive: boolean;
  selectedPolygonHoverActive: boolean;
  spaceLabelHoverActive: boolean;
};

export type StageMouseMoveWork = {
  draw: boolean;
  marquee: boolean;
  hover: boolean;
};

export function canCanvasInteractionRunStageMouseMove(
  kind: CanvasInteractionKind | null | undefined,
): boolean {
  return (
    kind == null ||
    kind === 'drawing-preview' ||
    kind === 'stage-pan' ||
    kind === 'marquee'
  );
}

export function canCanvasInteractionUpdateElementHover(
  kind: CanvasInteractionKind | null | undefined,
): boolean {
  return kind == null;
}

export function getStageMouseMoveWork(input: StageMouseMoveWorkInput): StageMouseMoveWork {
  if (input.drawMode === 'orthogonal-room') {
    return { draw: true, marquee: true, hover: false };
  }

  if (input.drawMode !== 'none') {
    return { draw: true, marquee: false, hover: false };
  }

  if (input.marqueeActive) {
    return { draw: false, marquee: true, hover: false };
  }

  return {
    draw: false,
    marquee: false,
    hover: input.selectedPolygonHoverActive || input.spaceLabelHoverActive,
  };
}
