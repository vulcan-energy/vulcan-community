// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  beginVertexCanvasInteraction,
  beginVertexDrag,
  cancelVertexCanvasInteraction,
  endVertexCanvasInteraction,
  finalizeVertexDragFromState,
  getVertexDragState,
  isVertexDragActive,
  setVertexDragState,
  type VertexDragState,
} from '../vertexDragSession';
import { ACTIVE_GEOMETRY_DRAG_LAYER_NAME } from '../elementDragPreview';
import {
  getActiveCanvasInteraction,
  readCanvasInteractionSession,
} from '../canvasInteractionSession';
import Konva from 'konva';

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

function makeDragTarget() {
  return {
    getAttr: vi.fn(() => null),
    setAttr: vi.fn(),
  };
}

function createVertexInteractionStage() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const stage = new Konva.Stage({ container, width: 200, height: 120 });
  const mainLayer = new Konva.Layer();
  const activeLayer = new Konva.Layer({ name: ACTIVE_GEOMETRY_DRAG_LAYER_NAME });
  stage.add(mainLayer);
  stage.add(activeLayer);

  const shape = new Konva.Line({ name: 'shape-wall-a', points: [0, 0, 20, 0] });
  const vertex = new Konva.Circle({ name: 'vertex-wall-a-0', x: 0, y: 0, draggable: true });
  mainLayer.add(shape);
  mainLayer.add(vertex);

  return {
    activeLayer,
    container,
    mainLayer,
    shape,
    stage,
    vertex,
    destroy: () => {
      stage.destroy();
      container.remove();
    },
  };
}

function beginWallVertexInteraction(
  vertex: Konva.Circle,
  activeLayer: Konva.Layer,
) {
  return beginVertexCanvasInteraction({
    target: vertex,
    elementId: 'wall-a',
    vertexIndex: 0,
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    elements: [{ elementId: 'wall-a', coordinateCount: 2 }],
    activeLayer,
  });
}

describe('vertex drag session state', () => {
  it('registers vertex drags through the shared canvas interaction controller', () => {
    const contextSpy = installCanvasContextStub();
    const stage = createVertexInteractionStage();

    try {
      const session = beginWallVertexInteraction(stage.vertex, stage.activeLayer);

      expect(session).not.toBeNull();
      expect(getActiveCanvasInteraction()).toMatchObject({
        kind: 'vertex-drag',
        targetId: 'wall-a:0',
      });
      expect(readCanvasInteractionSession(stage.vertex)).toBe(session);
      expect(stage.shape.getParent()).toBe(stage.activeLayer);
      expect(stage.vertex.getParent()).toBe(stage.activeLayer);

      endVertexCanvasInteraction(stage.vertex, { committed: true });

      expect(getActiveCanvasInteraction()).toBeNull();
      expect(readCanvasInteractionSession(stage.vertex)).toBeNull();
      expect(stage.shape.getParent()).toBe(stage.mainLayer);
      expect(stage.vertex.getParent()).toBe(stage.mainLayer);
    } finally {
      stage.destroy();
      contextSpy.mockRestore();
    }
  });

  it('cancels the shared canvas interaction when vertex state is cleared', () => {
    const contextSpy = installCanvasContextStub();
    const stage = createVertexInteractionStage();

    try {
      const session = beginWallVertexInteraction(stage.vertex, stage.activeLayer);
      expect(session).not.toBeNull();

      const state: VertexDragState = {
        elementId: 'wall-a',
        vertexIndex: 0,
        originalPosition: { x: 0, y: 0, z: 0 },
        connectedElements: [],
        lengthPills: [],
        draggedNode: stage.vertex as any,
        connectedElementWorldCoords: new Map([
          ['wall-a-0', { x: 1, y: 2, z: 0 }],
        ]),
      };

      beginVertexDrag();
      setVertexDragState(state);
      setVertexDragState(null);

      expect(getActiveCanvasInteraction()).toBeNull();
      expect(readCanvasInteractionSession(stage.vertex)).toBeNull();
      expect(stage.shape.getParent()).toBe(stage.mainLayer);
      expect(stage.vertex.getParent()).toBe(stage.mainLayer);
      expect(isVertexDragActive()).toBe(false);
    } finally {
      cancelVertexCanvasInteraction(stage.vertex);
      stage.destroy();
      contextSpy.mockRestore();
    }
  });

  it('ends the shared canvas interaction when vertex state finalizes', () => {
    const contextSpy = installCanvasContextStub();
    const stage = createVertexInteractionStage();

    try {
      const session = beginWallVertexInteraction(stage.vertex, stage.activeLayer);
      expect(session).not.toBeNull();

      const state: VertexDragState = {
        elementId: 'wall-a',
        vertexIndex: 0,
        originalPosition: { x: 0, y: 0, z: 0 },
        connectedElements: [],
        lengthPills: [],
        draggedNode: stage.vertex as any,
        connectedElementWorldCoords: new Map([
          ['wall-a-0', { x: 5, y: 6, z: 0 }],
        ]),
      };
      const commit = vi.fn();

      beginVertexDrag();
      setVertexDragState(state);

      expect(finalizeVertexDragFromState(commit)).toBe(true);

      expect(commit).toHaveBeenCalledTimes(1);
      expect(getActiveCanvasInteraction()).toBeNull();
      expect(readCanvasInteractionSession(stage.vertex)).toBeNull();
      expect(stage.shape.getParent()).toBe(stage.mainLayer);
      expect(stage.vertex.getParent()).toBe(stage.mainLayer);
      expect(isVertexDragActive()).toBe(false);
    } finally {
      cancelVertexCanvasInteraction(stage.vertex);
      stage.destroy();
      contextSpy.mockRestore();
    }
  });

  it('finalizes active vertex updates through one commit and clears state', () => {
    const dragTarget = makeDragTarget();
    const state: VertexDragState = {
      elementId: 'wall-a',
      vertexIndex: 0,
      originalPosition: { x: 0, y: 0, z: 0 },
      connectedElements: [{ elementId: 'wall-b', vertexIndex: 1 }],
      lengthPills: [],
      draggedNode: dragTarget as any,
      connectedElementWorldCoords: new Map([
        ['wall-a-0', { x: 1, y: 2, z: 0 }],
        ['wall-b-1', { x: 1, y: 2, z: 0 }],
      ]),
    };
    const commit = vi.fn();
    const clearLengthPills = vi.fn();

    beginVertexDrag();
    setVertexDragState(state);

    expect(isVertexDragActive()).toBe(true);
    expect(getVertexDragState()).toBe(state);

    const didCommit = finalizeVertexDragFromState(commit, clearLengthPills);

    expect(didCommit).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([
      { elementId: 'wall-a', vertexIndex: 0, newPosition: { x: 1, y: 2, z: 0 } },
      { elementId: 'wall-b', vertexIndex: 1, newPosition: { x: 1, y: 2, z: 0 } },
    ]);
    expect(clearLengthPills).toHaveBeenCalledTimes(1);
    expect(getVertexDragState()).toBeNull();
    expect(isVertexDragActive()).toBe(false);
  });

  it('does not run finalization cleanup twice after state is already cleared', () => {
    const state: VertexDragState = {
      elementId: 'wall-a',
      vertexIndex: 0,
      originalPosition: { x: 0, y: 0, z: 0 },
      connectedElements: [],
      lengthPills: [],
      draggedNode: makeDragTarget() as any,
      connectedElementWorldCoords: new Map([
        ['wall-a-0', { x: 5, y: 6, z: 0 }],
      ]),
    };
    const commit = vi.fn();
    const clearLengthPills = vi.fn();

    beginVertexDrag();
    setVertexDragState(state);

    expect(finalizeVertexDragFromState(commit, clearLengthPills)).toBe(true);
    expect(finalizeVertexDragFromState(commit, clearLengthPills)).toBe(false);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(clearLengthPills).toHaveBeenCalledTimes(1);
  });

  it('cancels active vertex state without committing updates', () => {
    const state: VertexDragState = {
      elementId: 'wall-a',
      vertexIndex: 0,
      originalPosition: { x: 0, y: 0, z: 0 },
      connectedElements: [],
      lengthPills: [],
      draggedNode: makeDragTarget() as any,
      connectedElementWorldCoords: new Map([
        ['wall-a-0', { x: 3, y: 4, z: 0 }],
      ]),
    };

    beginVertexDrag();
    setVertexDragState(state);
    setVertexDragState(null);

    expect(getVertexDragState()).toBeNull();
    expect(isVertexDragActive()).toBe(false);
  });
});
