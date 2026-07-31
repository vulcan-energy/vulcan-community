// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../../stores/geometryStore';
import {
  findElementShapeNodeRefs,
  type ActiveDragPreviewElement,
  type ElementShapeNodeRefs,
} from './elementDragPreview';
import {
  beginCanvasInteraction,
  cancelCanvasInteraction,
  endCanvasInteraction,
  readCanvasInteractionSession,
  writeCanvasInteractionSession,
  type CanvasInteractionSession,
} from './canvasInteractionSession';
import type Konva from 'konva';

type VertexNodeRef = {
  position: (pos: { x: number; y: number }) => void;
};

type VertexStageNode = {
  findOne: (selector: string) => unknown;
};

type VertexDragTarget = VertexNodeRef & {
  getStage?: () => VertexStageNode | null;
};

export type VertexPositionUpdate = {
  elementId: string;
  vertexIndex: number;
  newPosition: { x: number; y: number; z: number };
};

export type CommitVertexPositionUpdates = (updates: VertexPositionUpdate[], skipAutoSave?: boolean) => void;
export type VertexLengthPill = { elementId: string; length: number; midpoint: { x: number; y: number } };

export type VertexDragState = {
  elementId: string;
  vertexIndex: number;
  originalPosition: { x: number; y: number; z: number };
  connectedElements: Array<{ elementId: string; vertexIndex: number }>;
  lengthPills: Array<{ elementId: string; length: number; midpoint: { x: number; y: number } }>;
  draggedNode?: VertexDragTarget;
  connectedNodes?: Array<{ node: VertexNodeRef; elementId: string; vertexIndex: number }>;
  draggedShapeNodes?: ElementShapeNodeRefs;
  draggedShapeNode?: ElementShapeNodeRefs['shapeNode'];
  draggedShapeStrokeNode?: ElementShapeNodeRefs['shapeStrokeNode'];
  connectedShapeNodes?: Array<ElementShapeNodeRefs & { elementId: string; vertexIndex?: number }>;
  connectedElementWorldCoords?: Map<string, { x: number; y: number; z: number }>;
};

let vertexDragState: VertexDragState | null = null;
let anyVertexDragActive = false;

type CanvasInteractionTargetArg = Parameters<typeof readCanvasInteractionSession>[0];

function toCanvasInteractionTarget(target: unknown): CanvasInteractionTargetArg {
  return target as CanvasInteractionTargetArg;
}

export function beginVertexCanvasInteraction({
  target,
  elementId,
  vertexIndex,
  coordinates,
  elements,
  activeLayer,
}: {
  target: unknown;
  elementId: string;
  vertexIndex: number;
  coordinates?: Array<{ x: number; y: number; z?: number }>;
  elements: ReadonlyArray<ActiveDragPreviewElement>;
  activeLayer?: Konva.Layer | null;
}): CanvasInteractionSession | null {
  const session = beginCanvasInteraction({
    kind: 'vertex-drag',
    targetId: `${elementId}:${vertexIndex}`,
    snapshot: {
      elementId,
      vertexIndex,
      coordinates,
    },
    preview: {
      mode: 'elementNodes',
      target,
      primaryElementId: elementId,
      elements,
      moveDragTarget: true,
      activeLayer,
    },
  });
  writeCanvasInteractionSession(toCanvasInteractionTarget(target), session);
  return session;
}

export function endVertexCanvasInteraction(
  target: unknown,
  result: { committed: boolean } = { committed: true },
): void {
  const canvasTarget = toCanvasInteractionTarget(target);
  endCanvasInteraction(readCanvasInteractionSession(canvasTarget), result);
  writeCanvasInteractionSession(canvasTarget, null);
}

export function cancelVertexCanvasInteraction(target: unknown): void {
  const canvasTarget = toCanvasInteractionTarget(target);
  cancelCanvasInteraction(readCanvasInteractionSession(canvasTarget));
  writeCanvasInteractionSession(canvasTarget, null);
}

export function getVertexDragState(): VertexDragState | null {
  return vertexDragState;
}

export function setVertexDragState(next: VertexDragState | null): void {
  const previousDragTarget = vertexDragState?.draggedNode;
  vertexDragState = next;
  if (!next) {
    endVertexDrag();
    cancelVertexCanvasInteraction(previousDragTarget);
  }
}

export function isVertexDragActive(): boolean {
  return anyVertexDragActive;
}

export function beginVertexDrag(): void {
  anyVertexDragActive = true;
}

export function endVertexDrag(): void {
  anyVertexDragActive = false;
}

export function buildActiveVertexDragUpdates(): VertexPositionUpdate[] {
  return buildVertexDragUpdatesFromState(vertexDragState);
}

export function recordActiveVertexDragWorldPosition(
  elementId: string,
  vertexIndex: number,
  world: { x: number; y: number },
  z: number,
  elementsById: Record<string, Element>,
): void {
  recordVertexDragWorldPosition(vertexDragState, elementId, vertexIndex, world, z, elementsById);
}

export function finalizeVertexDragFromState(
  commit: CommitVertexPositionUpdates | undefined,
  clearLengthPills?: () => void,
): boolean {
  const dragTarget = vertexDragState?.draggedNode;
  if (!vertexDragState) {
    endVertexDrag();
    return false;
  }
  const updates = buildActiveVertexDragUpdates();
  if (updates.length > 0 && commit) {
    commit(updates);
  }
  vertexDragState = null;
  endVertexDrag();
  clearLengthPills?.();
  endVertexCanvasInteraction(dragTarget, { committed: updates.length > 0 });
  return updates.length > 0;
}

export function isVertexDragBuildingElement(element: Element | undefined): boolean {
  return element?.type === 'BuildingElementOpaque' ||
    element?.type === 'BuildingElementTransparent' ||
    element?.type === 'BuildingElementGround' ||
    element?.type === 'BuildingElementAdjacentConditionedSpace' ||
    element?.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
    element?.type === 'BuildingElementPartyWall';
}

export function buildVertexDragStateForElement({
  element,
  vertexIndex,
  elementsById,
  currentFloorZ,
  target,
}: {
  element: Element;
  vertexIndex: number;
  elementsById: Record<string, Element>;
  currentFloorZ?: number;
  target?: VertexDragTarget;
}): VertexDragState | null {
  if (!isVertexDragBuildingElement(element)) return null;
  const vertex = element.coordinates?.[vertexIndex];
  if (!vertex) return null;

  const connectedElements: Array<{ elementId: string; vertexIndex: number }> = [];
  const elementZ = element.coordinates?.[0]?.z ?? 0;
  const floorZ = currentFloorZ !== undefined ? currentFloorZ : elementZ;

  for (const otherId of Object.keys(elementsById)) {
    const other = elementsById[otherId];
    if (!other || other.id === element.id || !isVertexDragBuildingElement(other)) continue;
    if (!other.coordinates) continue;

    const otherZ = other.coordinates[0]?.z ?? 0;
    if (Math.abs(otherZ - floorZ) > 0.5) continue;

    for (let k = 0; k < other.coordinates.length; k++) {
      const otherCoord = other.coordinates[k];
      if (
        vertex.x === otherCoord.x &&
        vertex.y === otherCoord.y &&
        vertex.z === otherCoord.z
      ) {
        connectedElements.push({ elementId: other.id, vertexIndex: k });
        break;
      }
    }
  }

  const baseState = {
    elementId: element.id,
    vertexIndex,
    originalPosition: { ...vertex },
    connectedElements,
    lengthPills: [],
    draggedNode: target,
  };

  const stage = target?.getStage?.();
  if (!stage) {
    return {
      ...baseState,
      connectedNodes: [],
    };
  }

  const connectedNodes: NonNullable<VertexDragState['connectedNodes']> = [];
  const connectedShapeNodes: NonNullable<VertexDragState['connectedShapeNodes']> = [];
  const draggedRefs = findElementShapeNodeRefs(stage, element.id);

  connectedElements.forEach(({ elementId: connectedId, vertexIndex: connectedVertexIndex }) => {
    const node = stage.findOne(`.vertex-${connectedId}-${connectedVertexIndex}`) as VertexNodeRef | null;
    if (node) {
      connectedNodes.push({ node, elementId: connectedId, vertexIndex: connectedVertexIndex });
    }
    const refs = findElementShapeNodeRefs(stage, connectedId);
    if (refs.shapeNode) {
      connectedShapeNodes.push({
        elementId: connectedId,
        vertexIndex: connectedVertexIndex,
        ...refs,
      });
    }
  });

  return {
    ...baseState,
    connectedNodes,
    draggedShapeNodes: draggedRefs,
    draggedShapeNode: draggedRefs.shapeNode,
    draggedShapeStrokeNode: draggedRefs.shapeStrokeNode,
    connectedShapeNodes,
  };
}

export function buildVertexDragUpdatesFromState(state: VertexDragState | null): VertexPositionUpdate[] {
  if (!state?.connectedElementWorldCoords) return [];

  const updates: VertexPositionUpdate[] = [];
  const pushStored = (elementId: string, vertexIndex: number) => {
    const key = `${elementId}-${vertexIndex}`;
    const stored = state.connectedElementWorldCoords?.get(key);
    if (!stored) return;
    if (updates.some((update) => update.elementId === elementId && update.vertexIndex === vertexIndex)) return;
    updates.push({ elementId, vertexIndex, newPosition: stored });
  };

  pushStored(state.elementId, state.vertexIndex);
  for (const { elementId, vertexIndex } of state.connectedElements) {
    pushStored(elementId, vertexIndex);
  }

  return updates;
}

function buildLineLengthPill(
  elementId: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
): VertexLengthPill | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return null;
  return {
    elementId,
    length,
    midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

export function buildVertexLengthPillsFromState(
  state: VertexDragState | null,
  draggedElement: Element,
  draggedWorld: { x: number; y: number },
  elementsById: Record<string, Element>,
): VertexLengthPill[] {
  if (!state) return [];

  const pills: VertexLengthPill[] = [];
  const draggedCoords = draggedElement.coordinates;
  if (draggedCoords?.length === 2) {
    const otherIndex = state.vertexIndex === 0 ? 1 : state.vertexIndex === 1 ? 0 : null;
    const otherCoord = otherIndex !== null ? draggedCoords[otherIndex] : null;
    const pill = otherCoord ? buildLineLengthPill(draggedElement.id, draggedWorld, otherCoord) : null;
    if (pill) pills.push(pill);
  }

  for (const { elementId: connectedId, vertexIndex: connectedVertexIndex } of state.connectedElements) {
    const connectedEl = elementsById[connectedId];
    if (!connectedEl?.coordinates || connectedEl.coordinates.length !== 2) continue;

    const otherIndex = connectedVertexIndex === 0 ? 1 : connectedVertexIndex === 1 ? 0 : null;
    const otherCoord = otherIndex !== null ? connectedEl.coordinates[otherIndex] : null;
    const pill = otherCoord ? buildLineLengthPill(connectedId, draggedWorld, otherCoord) : null;
    if (pill) pills.push(pill);
  }

  return pills;
}

export function recordVertexDragWorldPosition(
  state: VertexDragState | null,
  elementId: string,
  vertexIndex: number,
  world: { x: number; y: number },
  z: number,
  elementsById: Record<string, Element>,
): void {
  if (!state) return;
  if (!state.connectedElementWorldCoords) {
    state.connectedElementWorldCoords = new Map();
  }

  state.connectedElementWorldCoords.set(`${elementId}-${vertexIndex}`, {
    x: world.x,
    y: world.y,
    z,
  });

  for (const { elementId: connectedId, vertexIndex: connectedVertexIndex } of state.connectedElements) {
    const connected = elementsById[connectedId];
    const connectedZ = connected?.coordinates?.[connectedVertexIndex]?.z ?? z;
    state.connectedElementWorldCoords.set(`${connectedId}-${connectedVertexIndex}`, {
      x: world.x,
      y: world.y,
      z: connectedZ,
    });
  }
}
