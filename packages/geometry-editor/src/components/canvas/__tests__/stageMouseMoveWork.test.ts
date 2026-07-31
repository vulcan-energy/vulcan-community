// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import {
  canCanvasInteractionUpdateElementHover,
  canCanvasInteractionRunStageMouseMove,
  getStageMouseMoveWork,
} from '../stageMouseMoveWork';

describe('getStageMouseMoveWork', () => {
  it('runs only drawing preview work while draw mode is active', () => {
    expect(getStageMouseMoveWork({
      drawMode: 'line',
      marqueeActive: false,
      selectedPolygonHoverActive: true,
      spaceLabelHoverActive: true,
    })).toEqual({ draw: true, marquee: false, hover: false });
  });

  it('routes orthogonal-room movement through preview and drag-endpoint work', () => {
    expect(getStageMouseMoveWork({
      drawMode: 'orthogonal-room',
      marqueeActive: false,
      selectedPolygonHoverActive: true,
      spaceLabelHoverActive: true,
    })).toEqual({ draw: true, marquee: true, hover: false });
  });

  it('runs only marquee work while marquee is active', () => {
    expect(getStageMouseMoveWork({
      drawMode: 'none',
      marqueeActive: true,
      selectedPolygonHoverActive: true,
      spaceLabelHoverActive: true,
    })).toEqual({ draw: false, marquee: true, hover: false });
  });

  it('runs hover work only when there is hover work to do', () => {
    expect(getStageMouseMoveWork({
      drawMode: 'none',
      marqueeActive: false,
      selectedPolygonHoverActive: true,
      spaceLabelHoverActive: false,
    })).toEqual({ draw: false, marquee: false, hover: true });
  });

  it('skips all work when no stage mousemove path is active', () => {
    expect(getStageMouseMoveWork({
      drawMode: 'none',
      marqueeActive: false,
      selectedPolygonHoverActive: false,
      spaceLabelHoverActive: false,
    })).toEqual({ draw: false, marquee: false, hover: false });
  });

  it('allows stage mousemove only for interactions that own stage movement', () => {
    expect(canCanvasInteractionRunStageMouseMove(null)).toBe(true);
    expect(canCanvasInteractionRunStageMouseMove('drawing-preview')).toBe(true);
    expect(canCanvasInteractionRunStageMouseMove('stage-pan')).toBe(true);
    expect(canCanvasInteractionRunStageMouseMove('marquee')).toBe(true);
    expect(canCanvasInteractionRunStageMouseMove('vertex-drag')).toBe(false);
    expect(canCanvasInteractionRunStageMouseMove('selected-shape-drag')).toBe(false);
  });

  it('allows canvas element hover updates only while no canvas interaction is active', () => {
    expect(canCanvasInteractionUpdateElementHover(null)).toBe(true);
    expect(canCanvasInteractionUpdateElementHover(undefined)).toBe(true);
    expect(canCanvasInteractionUpdateElementHover('marquee')).toBe(false);
    expect(canCanvasInteractionUpdateElementHover('drawing-preview')).toBe(false);
    expect(canCanvasInteractionUpdateElementHover('selected-shape-drag')).toBe(false);
  });
});
