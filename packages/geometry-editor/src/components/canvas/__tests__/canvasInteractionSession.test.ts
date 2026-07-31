// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import Konva from 'konva';
import { ACTIVE_GEOMETRY_DRAG_LAYER_NAME } from '../elementDragPreview';
import {
  beginCanvasInteraction,
  cancelCanvasInteraction,
  endCanvasInteraction,
  getActiveCanvasInteraction,
  isCanvasInteractionActive,
  readCanvasInteractionSession,
  writeCanvasInteractionSession,
} from '../canvasInteractionSession';

function installCanvasContextStub() {
  const context = {
    scale: vi.fn(),
    translate: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
  } as unknown as CanvasRenderingContext2D;

  return vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context);
}

function createStage() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const stage = new Konva.Stage({ container, width: 200, height: 120 });
  const mainLayer = new Konva.Layer();
  const activeLayer = new Konva.Layer({ name: ACTIVE_GEOMETRY_DRAG_LAYER_NAME });
  stage.add(mainLayer);
  stage.add(activeLayer);

  return {
    activeLayer,
    mainLayer,
    stage,
    destroy: () => {
      stage.destroy();
      container.remove();
    },
  };
}

describe('canvas interaction session controller', () => {
  it('starts an element-node interaction, exposes active state, and restores nodes on end', () => {
    const contextSpy = installCanvasContextStub();
    const stage = createStage();

    try {
      const shape = new Konva.Line({ name: 'shape-wall-a', points: [0, 0, 10, 0] });
      const vertex = new Konva.Circle({ name: 'vertex-wall-a-0', x: 0, y: 0 });
      const dragHandle = new Konva.Circle({ name: 'centroid-wall-a', x: 5, y: 0, draggable: true });
      stage.mainLayer.add(shape);
      stage.mainLayer.add(vertex);
      stage.mainLayer.add(dragHandle);

      const onEnd = vi.fn();
      const onCancel = vi.fn();
      const session = beginCanvasInteraction({
        kind: 'selected-shape-drag',
        targetId: 'wall-a',
        snapshot: { start: { x: 0, y: 0 } },
        preview: {
          mode: 'elementNodes',
          target: dragHandle,
          primaryElementId: 'wall-a',
          elements: [{ elementId: 'wall-a', coordinateCount: 1 }],
          moveDragTarget: true,
          activeLayer: stage.activeLayer,
        },
        onEnd,
        onCancel,
      });

      expect(session).not.toBeNull();
      expect(shape.getParent()).toBe(stage.activeLayer);
      expect(vertex.getParent()).toBe(stage.activeLayer);
      expect(dragHandle.getParent()).toBe(stage.activeLayer);
      expect(getActiveCanvasInteraction()).toMatchObject({
        kind: 'selected-shape-drag',
        targetId: 'wall-a',
        snapshot: { start: { x: 0, y: 0 } },
      });
      expect(isCanvasInteractionActive()).toBe(true);
      expect(isCanvasInteractionActive('selected-shape-drag')).toBe(true);
      expect(isCanvasInteractionActive('vertex-drag')).toBe(false);

      const mainBatchDraw = vi.spyOn(stage.mainLayer, 'batchDraw');
      const activeBatchDraw = vi.spyOn(stage.activeLayer, 'batchDraw');
      mainBatchDraw.mockClear();
      activeBatchDraw.mockClear();

      endCanvasInteraction(session!, { committed: true });
      endCanvasInteraction(session!, { committed: true });

      expect(shape.getParent()).toBe(stage.mainLayer);
      expect(vertex.getParent()).toBe(stage.mainLayer);
      expect(dragHandle.getParent()).toBe(stage.mainLayer);
      expect(activeBatchDraw).toHaveBeenCalled();
      expect(mainBatchDraw).not.toHaveBeenCalled();
      expect(getActiveCanvasInteraction()).toBeNull();
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(onEnd).toHaveBeenCalledWith({ committed: true });
      expect(onCancel).not.toHaveBeenCalled();
    } finally {
      stage.destroy();
      contextSpy.mockRestore();
    }
  });

  it('moves arbitrary nodes through the nodeMove backend and restores them on cancel', () => {
    const contextSpy = installCanvasContextStub();
    const stage = createStage();

    try {
      const spaceShape = new Konva.Line({ name: 'space-label-shape-a', points: [0, 0, 10, 0, 10, 10] });
      const connectedShape = new Konva.Line({ name: 'space-label-shape-b', points: [10, 0, 20, 0, 20, 10] });
      const dragHandle = new Konva.Circle({ name: 'space-label-vertex-a-0', x: 0, y: 0, draggable: true });
      stage.mainLayer.add(spaceShape);
      stage.mainLayer.add(connectedShape);
      stage.mainLayer.add(dragHandle);

      const onCancel = vi.fn();
      const session = beginCanvasInteraction({
        kind: 'space-label-vertex-drag',
        targetId: 'space-a',
        preview: {
          mode: 'nodeMove',
          target: dragHandle,
          nodes: [spaceShape, connectedShape],
          moveDragTarget: true,
          activeLayer: stage.activeLayer,
        },
        onCancel,
      });

      expect(session).not.toBeNull();
      expect(spaceShape.getParent()).toBe(stage.activeLayer);
      expect(connectedShape.getParent()).toBe(stage.activeLayer);
      expect(dragHandle.getParent()).toBe(stage.activeLayer);

      const mainBatchDraw = vi.spyOn(stage.mainLayer, 'batchDraw');
      const activeBatchDraw = vi.spyOn(stage.activeLayer, 'batchDraw');
      mainBatchDraw.mockClear();
      activeBatchDraw.mockClear();

      cancelCanvasInteraction(session!);
      cancelCanvasInteraction(session!);

      expect(spaceShape.getParent()).toBe(stage.mainLayer);
      expect(connectedShape.getParent()).toBe(stage.mainLayer);
      expect(dragHandle.getParent()).toBe(stage.mainLayer);
      expect(activeBatchDraw).toHaveBeenCalled();
      expect(mainBatchDraw).toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(getActiveCanvasInteraction()).toBeNull();
    } finally {
      stage.destroy();
      contextSpy.mockRestore();
    }
  });

  it('clones nodes through the cloneNodes backend without moving source nodes', () => {
    const contextSpy = installCanvasContextStub();
    const stage = createStage();

    try {
      const spaceShape = new Konva.Line({ name: 'space-label-shape-a', points: [0, 0, 10, 0, 10, 10] });
      const dragHandle = new Konva.Circle({ name: 'space-label-vertex-a-0', x: 0, y: 0 });
      stage.mainLayer.add(spaceShape);
      stage.mainLayer.add(dragHandle);

      const session = beginCanvasInteraction({
        kind: 'space-label-vertex-drag',
        targetId: 'space-a',
        preview: {
          mode: 'cloneNodes',
          target: dragHandle,
          nodes: [spaceShape, dragHandle],
          activeLayer: stage.activeLayer,
        },
      });

      expect(session).not.toBeNull();
      expect(spaceShape.getParent()).toBe(stage.mainLayer);
      expect(dragHandle.getParent()).toBe(stage.mainLayer);
      expect(stage.activeLayer.getChildren()).toHaveLength(2);

      cancelCanvasInteraction(session!);

      expect(stage.activeLayer.getChildren()).toHaveLength(0);
      expect(spaceShape.getParent()).toBe(stage.mainLayer);
      expect(dragHandle.getParent()).toBe(stage.mainLayer);
    } finally {
      stage.destroy();
      contextSpy.mockRestore();
    }
  });

  it('clears signal-only interactions once and does not commit on cancel', () => {
    const reset = vi.fn();
    const onEnd = vi.fn();
    const onCancel = vi.fn();

    const session = beginCanvasInteraction({
      kind: 'drawing-preview',
      targetId: 'draw',
      preview: {
        mode: 'signalOnly',
        reset,
      },
      onEnd,
      onCancel,
    });

    expect(session).not.toBeNull();
    expect(isCanvasInteractionActive('drawing-preview')).toBe(true);

    cancelCanvasInteraction(session!);
    endCanvasInteraction(session!, { committed: true });

    expect(reset).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
    expect(getActiveCanvasInteraction()).toBeNull();
  });

  it('rejects overlapping sessions until the active interaction ends', () => {
    const first = beginCanvasInteraction({
      kind: 'stage-pan',
      targetId: 'stage',
      preview: { mode: 'signalOnly', reset: vi.fn() },
    });
    const second = beginCanvasInteraction({
      kind: 'marquee',
      targetId: 'stage',
      preview: { mode: 'signalOnly', reset: vi.fn() },
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(isCanvasInteractionActive('stage-pan')).toBe(true);

    endCanvasInteraction(first!, { committed: false });

    expect(isCanvasInteractionActive()).toBe(false);
  });

  it('stores and clears the session reference on a Konva drag target', () => {
    const target = new Konva.Circle({ name: 'point-a' });
    const session = beginCanvasInteraction({
      kind: 'point-element-drag',
      targetId: 'point-a',
    });

    expect(session).not.toBeNull();
    writeCanvasInteractionSession(target, session);
    expect(readCanvasInteractionSession(target)).toBe(session);

    writeCanvasInteractionSession(target, null);
    expect(readCanvasInteractionSession(target)).toBeNull();
    cancelCanvasInteraction(session!);
  });
});
