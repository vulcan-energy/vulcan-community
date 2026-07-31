// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../../stores/geometryStore';
import { calculateArrowPoints, calculateDirectionArrow } from '../../lib/directionArrows';
import { worldToCanvas } from '../../lib/shapeUtils';
import Konva from 'konva';
import {
  DRAW_MODE_TOOLTIP_PILL_FONT_FAMILY,
  DRAW_MODE_TOOLTIP_PILL_HEIGHT,
  DRAW_MODE_TOOLTIP_PILL_PADDING,
  getDrawModeTooltipPillWidth,
} from '../../lib/drawModeTooltipPill';
import { geometryPerf } from '../../lib/geometryPerf';

type PreviewLayerNode = {
  batchDraw?: () => void;
};

type PreviewLineNode = {
  points?: (points: number[]) => void;
  getLayer?: () => PreviewLayerNode | null;
};

type PreviewPositionNode = {
  position?: (position: { x: number; y: number }) => void;
  x?: (x: number) => void;
  y?: (y: number) => void;
  getLayer?: () => PreviewLayerNode | null;
};

type PreviewStageNode = {
  findOne?: (selector: string) => unknown;
};

type PreviewDragTarget = {
  getStage?: () => PreviewStageNode | null;
  getLayer?: () => Konva.Layer | null;
  getParent?: () => Konva.Container | null;
  getZIndex?: () => number;
  moveTo?: (container: Konva.Container) => void;
  moveToTop?: () => void;
  setZIndex?: (index: number) => void;
  listening?: (listening?: boolean) => boolean | void;
  setAttr?: (key: string, value: unknown) => void;
  getAttr?: (key: string) => unknown;
};

type PreviewLengthPill = {
  elementId: string;
  length: number;
  midpoint: { x: number; y: number };
};

export const VERTEX_LENGTH_PILLS_GROUP_NAME = 'vertex-length-pills-layer';
export const ACTIVE_GEOMETRY_DRAG_LAYER_NAME = 'active-geometry-drag-layer';
const ACTIVE_DRAG_PREVIEW_SESSION_ATTR = '__vulcanActiveDragPreviewSession';
const ACTIVE_NODE_DRAG_PREVIEW_SESSION_ATTR = '__vulcanActiveNodeDragPreviewSession';
const ACTIVE_CLONE_DRAG_PREVIEW_SESSION_ATTR = '__vulcanActiveCloneDragPreviewSession';

export type ElementShapeNodeRefs = {
  shapeNode: PreviewLineNode | null;
  shapeStrokeNode: PreviewLineNode | null;
  slopeBottomNode: PreviewLineNode | null;
  slopeEdgesNode: PreviewLineNode | null;
  arrowLineNode: PreviewLineNode | null;
  arrowHeadNode: PreviewLineNode | null;
  pointNode?: PreviewPositionNode | null;
  vertexNodes: Array<PreviewPositionNode | null>;
};

export type ActiveDragPreviewElement = {
  elementId: string;
  coordinateCount?: number;
};

type MovablePreviewNode = Konva.Node & {
  getLayer?: () => Konva.Layer | null;
  listening?: (listening?: boolean) => boolean | void;
};

type MovedPreviewNode = {
  node: MovablePreviewNode;
  parent: Konva.Container;
  zIndex: number;
  listening: boolean | null;
  sourceLayer: Konva.Layer | null;
  isDragTarget: boolean;
};

export type ActiveElementDragPreviewSession = {
  activeLayer: Konva.Layer;
  primaryElementId: string;
  elementRefsById: Map<string, ElementShapeNodeRefs>;
  movedNodes: MovedPreviewNode[];
};

export type ActiveNodeDragPreviewSession = {
  activeLayer: Konva.Layer;
  movedNodes: MovedPreviewNode[];
};

export type ActiveCloneDragPreviewSession = {
  activeLayer: Konva.Layer;
  clonesBySource: Map<Konva.Node, Konva.Node>;
};

export type ActiveDragPreviewBackend =
  | {
      mode: 'elementNodes';
      target: unknown;
      primaryElementId: string;
      elements?: ReadonlyArray<ActiveDragPreviewElement>;
      moveDragTarget?: boolean;
      activeLayer?: Konva.Layer | null;
    }
  | {
      mode: 'nodeMove';
      target: unknown;
      nodes: ReadonlyArray<unknown>;
      moveDragTarget?: boolean;
      activeLayer?: Konva.Layer | null;
    }
  | {
      mode: 'cloneNodes';
      target: unknown;
      nodes: ReadonlyArray<unknown>;
      activeLayer?: Konva.Layer | null;
    };

export type ActiveDragPreviewBackendSession =
  | ActiveElementDragPreviewSession
  | ActiveNodeDragPreviewSession
  | ActiveCloneDragPreviewSession;

export type ActiveDragPreviewBackendAttachment = {
  previewSession: ActiveDragPreviewBackendSession;
  cleanup: (result?: unknown) => void;
};

function isCommittedCleanupResult(result: unknown): boolean {
  return !!result &&
    typeof result === 'object' &&
    (result as { committed?: unknown }).committed === true;
}

function withKonvaAutoDrawSuppressed<T>(suppress: boolean, action: () => T): T {
  if (!suppress) return action();
  const previousAutoDrawEnabled = Konva.autoDrawEnabled;
  Konva.autoDrawEnabled = false;
  try {
    return action();
  } finally {
    Konva.autoDrawEnabled = previousAutoDrawEnabled;
  }
}

function findPreviewLineNode(stage: PreviewStageNode | null | undefined, name: string): PreviewLineNode | null {
  return (stage?.findOne?.(`.${name}`) as PreviewLineNode | null | undefined) ?? null;
}

function findPreviewPositionNode(stage: PreviewStageNode | null | undefined, name: string): PreviewPositionNode | null {
  return (stage?.findOne?.(`.${name}`) as PreviewPositionNode | null | undefined) ?? null;
}

function toPreviewDragTarget(value: unknown): PreviewDragTarget | null {
  return value && typeof value === 'object' ? value as PreviewDragTarget : null;
}

function toMovablePreviewNode(value: unknown): MovablePreviewNode | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as Partial<MovablePreviewNode>;
  return typeof node.moveTo === 'function' && typeof node.getParent === 'function'
    ? value as MovablePreviewNode
    : null;
}

function toCloneablePreviewNode(value: unknown): Konva.Node | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as Partial<Konva.Node>;
  return typeof node.clone === 'function' ? value as Konva.Node : null;
}

function readListening(node: MovablePreviewNode): boolean | null {
  if (typeof node.listening !== 'function') return null;
  const value = node.listening();
  return typeof value === 'boolean' ? value : null;
}

function writeListening(node: MovablePreviewNode, value: boolean | null): void {
  if (value === null || typeof node.listening !== 'function') return;
  node.listening(value);
}

function findLengthPillsGroup(container: PreviewStageNode | Konva.Container | null | undefined): Konva.Group | null {
  return (container?.findOne?.(`.${VERTEX_LENGTH_PILLS_GROUP_NAME}`) as Konva.Group | null | undefined) ?? null;
}

function getActiveDragPreviewSession(targetValue: unknown): ActiveElementDragPreviewSession | null {
  const target = toPreviewDragTarget(targetValue);
  return (target?.getAttr?.(ACTIVE_DRAG_PREVIEW_SESSION_ATTR) as ActiveElementDragPreviewSession | null | undefined) ?? null;
}

function getActiveNodeDragPreviewSession(targetValue: unknown): ActiveNodeDragPreviewSession | null {
  const target = toPreviewDragTarget(targetValue);
  return (target?.getAttr?.(ACTIVE_NODE_DRAG_PREVIEW_SESSION_ATTR) as ActiveNodeDragPreviewSession | null | undefined) ?? null;
}

function getActiveCloneDragPreviewSession(targetValue: unknown): ActiveCloneDragPreviewSession | null {
  const target = toPreviewDragTarget(targetValue);
  return (target?.getAttr?.(ACTIVE_CLONE_DRAG_PREVIEW_SESSION_ATTR) as ActiveCloneDragPreviewSession | null | undefined) ?? null;
}

function findActiveDragLayer(
  target: PreviewDragTarget | null | undefined,
  explicitLayer?: Konva.Layer | null,
): Konva.Layer | null {
  if (explicitLayer) return explicitLayer;
  const stage = target?.getStage?.();
  const layer = stage?.findOne?.(`.${ACTIVE_GEOMETRY_DRAG_LAYER_NAME}`) as Konva.Layer | null | undefined;
  return layer && typeof layer.add === 'function' ? layer : null;
}

function getOrCreateLengthPillsGroupInLayer(layer: Konva.Layer): Konva.Group {
  const existing = findLengthPillsGroup(layer);
  if (existing) return existing;

  const group = new Konva.Group({
    name: VERTEX_LENGTH_PILLS_GROUP_NAME,
    listening: false,
  });
  layer.add(group);
  group.moveToTop();
  return group;
}

function getOrCreateLengthPillsGroup(targetValue: unknown): Konva.Group | null {
  const target = toPreviewDragTarget(targetValue);
  const activeSession = getActiveDragPreviewSession(target);
  if (activeSession) {
    return getOrCreateLengthPillsGroupInLayer(activeSession.activeLayer);
  }

  const stage = target?.getStage?.();
  const existing = findLengthPillsGroup(stage);
  if (existing) return existing;

  const layer = target?.getLayer?.();
  if (!layer) return null;
  return getOrCreateLengthPillsGroupInLayer(layer);
}

export function clearVertexLengthPillPreview(targetValue: unknown): void {
  const target = toPreviewDragTarget(targetValue);
  const activeSession = getActiveDragPreviewSession(target);
  const group = activeSession
    ? findLengthPillsGroup(activeSession.activeLayer)
    : findLengthPillsGroup(target?.getStage?.());
  if (!group) return;
  group.destroyChildren();
  group.getLayer()?.batchDraw();
}

export function updateVertexLengthPillPreview(
  targetValue: unknown,
  pills: ReadonlyArray<PreviewLengthPill>,
  scale: number,
  panOffset: { x: number; y: number },
  canvasCenter: { x: number; y: number },
  colors: { fill: string; text: string },
): void {
  const group = getOrCreateLengthPillsGroup(targetValue);
  if (!group) return;
  group.destroyChildren();

  for (const [index, pill] of pills.entries()) {
    const canvasPos = worldToCanvas(pill.midpoint, scale, panOffset, canvasCenter);
    const text = `${pill.length.toFixed(2)}m`;
    const width = getDrawModeTooltipPillWidth(text);
    const innerWidth = width - DRAW_MODE_TOOLTIP_PILL_PADDING * 2;
    const pillGroup = new Konva.Group({
      name: `length-pill-${pill.elementId}-${index}`,
      listening: false,
    });
    pillGroup.add(
      new Konva.Rect({
        x: canvasPos.x,
        y: canvasPos.y,
        width,
        height: DRAW_MODE_TOOLTIP_PILL_HEIGHT,
        fill: colors.fill,
        cornerRadius: 10,
        listening: false,
      }),
    );
    pillGroup.add(
      new Konva.Text({
        x: canvasPos.x + DRAW_MODE_TOOLTIP_PILL_PADDING,
        y: canvasPos.y + 4,
        text,
        fontSize: 11,
        fill: colors.text,
        fontStyle: 'normal',
        fontFamily: DRAW_MODE_TOOLTIP_PILL_FONT_FAMILY,
        width: innerWidth,
        align: 'center',
        listening: false,
      }),
    );
    group.add(pillGroup);
  }

  if (group.getParent()) group.moveToTop();
  group.getLayer()?.batchDraw();
}

function findElementVertexNodeRefs(
  stage: PreviewStageNode | null | undefined,
  elementId: string,
  coordinateCount?: number,
): Array<PreviewPositionNode | null> {
  const maxCount = coordinateCount ?? 64;
  const nodes: Array<PreviewPositionNode | null> = [];
  for (let index = 0; index < maxCount; index += 1) {
    const node = findPreviewPositionNode(stage, `vertex-${elementId}-${index}`);
    if (!node && coordinateCount == null && index > 0) break;
    nodes.push(node);
  }
  return nodes;
}

export function findElementShapeNodeRefs(
  stage: PreviewStageNode | null | undefined,
  elementId: string,
  coordinateCount?: number,
): ElementShapeNodeRefs {
  return {
    shapeNode: findPreviewLineNode(stage, `shape-${elementId}`),
    shapeStrokeNode: findPreviewLineNode(stage, `shape-stroke-${elementId}`),
    slopeBottomNode: findPreviewLineNode(stage, `slope-bottom-${elementId}`),
    slopeEdgesNode: findPreviewLineNode(stage, `slope-edges-${elementId}`),
    arrowLineNode: findPreviewLineNode(stage, `arrow-line-${elementId}`),
    arrowHeadNode: findPreviewLineNode(stage, `arrow-head-${elementId}`),
    pointNode: findPreviewPositionNode(stage, `point-${elementId}`),
    vertexNodes: findElementVertexNodeRefs(stage, elementId, coordinateCount),
  };
}

function uniqueElementRequests(
  primaryElementId: string,
  elements: ReadonlyArray<ActiveDragPreviewElement> | undefined,
): ActiveDragPreviewElement[] {
  const byId = new Map<string, ActiveDragPreviewElement>();
  byId.set(primaryElementId, { elementId: primaryElementId });
  for (const element of elements ?? []) {
    const previous = byId.get(element.elementId);
    byId.set(element.elementId, {
      elementId: element.elementId,
      coordinateCount: element.coordinateCount ?? previous?.coordinateCount,
    });
  }
  return [...byId.values()];
}

function refsToMovableNodes(refs: ElementShapeNodeRefs): unknown[] {
  return [
    refs.shapeNode,
    refs.shapeStrokeNode,
    refs.slopeBottomNode,
    refs.slopeEdgesNode,
    refs.arrowLineNode,
    refs.arrowHeadNode,
    refs.pointNode,
    ...refs.vertexNodes,
  ];
}

function moveNodeToActiveLayer(
  session: ActiveElementDragPreviewSession | ActiveNodeDragPreviewSession,
  nodeValue: unknown,
  dragTargetNode: MovablePreviewNode | null,
): void {
  const node = toMovablePreviewNode(nodeValue);
  if (!node || node === session.activeLayer) return;
  if (session.movedNodes.some((entry) => entry.node === node)) return;

  const parent = node.getParent();
  if (!parent || parent === session.activeLayer) return;

  const isDragTarget = node === dragTargetNode;
  const listening = readListening(node);
  const sourceLayer = typeof node.getLayer === 'function' ? node.getLayer() : null;

  session.movedNodes.push({
    node,
    parent,
    zIndex: typeof node.getZIndex === 'function' ? node.getZIndex() : parent.getChildren().indexOf(node),
    listening,
    sourceLayer,
    isDragTarget,
  });

  if (!isDragTarget) {
    writeListening(node, false);
  }
  node.moveTo(session.activeLayer);
  node.moveToTop();
}

function restoreMovedNodes(session: ActiveElementDragPreviewSession | ActiveNodeDragPreviewSession): void {
  const moved = [...session.movedNodes].reverse();
  for (const entry of moved) {
    if (entry.node.getParent() !== session.activeLayer) {
      writeListening(entry.node, entry.listening);
      continue;
    }
    entry.node.moveTo(entry.parent);
    try {
      entry.node.setZIndex(Math.max(0, entry.zIndex));
    } catch {
      entry.node.moveToTop();
    }
    writeListening(entry.node, entry.listening);
  }
}

function setDraggedElementAttrs(
  target: PreviewDragTarget | null | undefined,
  refs: ElementShapeNodeRefs | undefined,
): void {
  target?.setAttr?.('__vulcanDraggedShapeNode', refs?.shapeNode ?? null);
  target?.setAttr?.('__vulcanDraggedShapeStrokeNode', refs?.shapeStrokeNode ?? null);
  target?.setAttr?.('__vulcanDraggedSlopeBottomNode', refs?.slopeBottomNode ?? null);
  target?.setAttr?.('__vulcanDraggedSlopeEdgesNode', refs?.slopeEdgesNode ?? null);
  target?.setAttr?.('__vulcanDraggedArrowLineNode', refs?.arrowLineNode ?? null);
  target?.setAttr?.('__vulcanDraggedArrowHeadNode', refs?.arrowHeadNode ?? null);
  target?.setAttr?.('__vulcanDraggedPointNode', refs?.pointNode ?? null);
  target?.setAttr?.('__vulcanDraggedVertexNodes', refs?.vertexNodes ?? []);
}

function beginActiveElementDragPreviewSession(
  targetValue: unknown,
  options: {
    primaryElementId: string;
    elements?: ReadonlyArray<ActiveDragPreviewElement>;
    moveDragTarget?: boolean;
    activeLayer?: Konva.Layer | null;
  },
): ActiveElementDragPreviewSession | null {
  const startedAt = geometryPerf.isEnabled() ? performance.now() : 0;
  const target = toPreviewDragTarget(targetValue);
  const stage = target?.getStage?.();
  const activeLayer = findActiveDragLayer(target, options.activeLayer);
  if (!target || !stage || !activeLayer) return null;

  clearActiveElementDragPreviewSession(target);

  const session: ActiveElementDragPreviewSession = {
    activeLayer,
    primaryElementId: options.primaryElementId,
    elementRefsById: new Map(),
    movedNodes: [],
  };
  const dragTargetNode = options.moveDragTarget ? toMovablePreviewNode(target) : null;

  for (const element of uniqueElementRequests(options.primaryElementId, options.elements)) {
    const refs = findElementShapeNodeRefs(stage, element.elementId, element.coordinateCount);
    session.elementRefsById.set(element.elementId, refs);
    for (const node of refsToMovableNodes(refs)) {
      moveNodeToActiveLayer(session, node, dragTargetNode);
    }
  }

  if (dragTargetNode) {
    moveNodeToActiveLayer(session, dragTargetNode, dragTargetNode);
  }

  setDraggedElementAttrs(target, session.elementRefsById.get(options.primaryElementId));
  target.setAttr?.(ACTIVE_DRAG_PREVIEW_SESSION_ATTR, session);
  activeLayer.batchDraw();
  const sourceLayers = new Set(session.movedNodes.map((entry) => entry.sourceLayer).filter(Boolean));
  sourceLayers.forEach((layer) => layer?.batchDraw());

  if (startedAt > 0) {
    geometryPerf.record('ActiveDragLayer.beginSession', performance.now() - startedAt);
  }

  return session;
}

function beginActiveNodeDragPreviewSession(
  targetValue: unknown,
  options: {
    nodes: ReadonlyArray<unknown>;
    moveDragTarget?: boolean;
    activeLayer?: Konva.Layer | null;
  },
): ActiveNodeDragPreviewSession | null {
  const startedAt = geometryPerf.isEnabled() ? performance.now() : 0;
  const target = toPreviewDragTarget(targetValue);
  const activeLayer = findActiveDragLayer(target, options.activeLayer);
  if (!target || !activeLayer) return null;

  clearActiveNodeDragPreviewSession(target);

  const session: ActiveNodeDragPreviewSession = {
    activeLayer,
    movedNodes: [],
  };
  const dragTargetNode = options.moveDragTarget ? toMovablePreviewNode(target) : null;

  for (const node of options.nodes) {
    moveNodeToActiveLayer(session, node, dragTargetNode);
  }

  if (dragTargetNode) {
    moveNodeToActiveLayer(session, dragTargetNode, dragTargetNode);
  }

  target.setAttr?.(ACTIVE_NODE_DRAG_PREVIEW_SESSION_ATTR, session);
  activeLayer.batchDraw();
  const sourceLayers = new Set(session.movedNodes.map((entry) => entry.sourceLayer).filter(Boolean));
  sourceLayers.forEach((layer) => layer?.batchDraw());

  if (startedAt > 0) {
    geometryPerf.record('ActiveDragLayer.beginNodeSession', performance.now() - startedAt);
  }

  return session;
}

function beginActiveCloneDragPreviewSession(
  targetValue: unknown,
  options: {
    nodes: ReadonlyArray<unknown>;
    activeLayer?: Konva.Layer | null;
  },
): ActiveCloneDragPreviewSession | null {
  const startedAt = geometryPerf.isEnabled() ? performance.now() : 0;
  const target = toPreviewDragTarget(targetValue);
  const activeLayer = findActiveDragLayer(target, options.activeLayer);
  if (!target || !activeLayer) return null;

  clearActiveCloneDragPreviewSession(target);

  const session: ActiveCloneDragPreviewSession = {
    activeLayer,
    clonesBySource: new Map(),
  };

  for (const nodeValue of options.nodes) {
    const source = toCloneablePreviewNode(nodeValue);
    if (!source || session.clonesBySource.has(source)) continue;
    const clone = source.clone({ listening: false });
    activeLayer.add(clone);
    clone.moveToTop();
    session.clonesBySource.set(source, clone);
  }

  target.setAttr?.(ACTIVE_CLONE_DRAG_PREVIEW_SESSION_ATTR, session);
  activeLayer.batchDraw();

  if (startedAt > 0) {
    geometryPerf.record('ActiveDragLayer.beginCloneSession', performance.now() - startedAt);
  }

  return session;
}

function clearActiveCloneDragPreviewSession(targetValue: unknown): void {
  const startedAt = geometryPerf.isEnabled() ? performance.now() : 0;
  const target = toPreviewDragTarget(targetValue);
  const session = getActiveCloneDragPreviewSession(target);
  if (!target || !session) return;

  for (const clone of session.clonesBySource.values()) {
    clone.destroy();
  }
  target.setAttr?.(ACTIVE_CLONE_DRAG_PREVIEW_SESSION_ATTR, null);
  session.activeLayer.batchDraw();

  if (startedAt > 0) {
    geometryPerf.record('ActiveDragLayer.clearCloneSession', performance.now() - startedAt);
  }
}

function clearActiveNodeDragPreviewSession(targetValue: unknown, result?: unknown): void {
  const startedAt = geometryPerf.isEnabled() ? performance.now() : 0;
  const target = toPreviewDragTarget(targetValue);
  const session = getActiveNodeDragPreviewSession(target);
  if (!target || !session) return;

  const sourceLayers = new Set(session.movedNodes.map((entry) => entry.sourceLayer).filter(Boolean));
  const committedCleanup = isCommittedCleanupResult(result);
  withKonvaAutoDrawSuppressed(committedCleanup, () => {
    restoreMovedNodes(session);
    target.setAttr?.(ACTIVE_NODE_DRAG_PREVIEW_SESSION_ATTR, null);
  });
  session.activeLayer.batchDraw();
  if (!committedCleanup) {
    sourceLayers.forEach((layer) => layer?.batchDraw());
  }

  if (startedAt > 0) {
    geometryPerf.record('ActiveDragLayer.clearNodeSession', performance.now() - startedAt);
  }
}

function clearActiveElementDragPreviewSession(targetValue: unknown, result?: unknown): void {
  const startedAt = geometryPerf.isEnabled() ? performance.now() : 0;
  const target = toPreviewDragTarget(targetValue);
  const session = getActiveDragPreviewSession(target);
  if (!target || !session) return;

  const sourceLayers = new Set(session.movedNodes.map((entry) => entry.sourceLayer).filter(Boolean));
  const committedCleanup = isCommittedCleanupResult(result);
  withKonvaAutoDrawSuppressed(committedCleanup, () => {
    restoreMovedNodes(session);
    const activePillGroup = findLengthPillsGroup(session.activeLayer);
    activePillGroup?.destroyChildren();
    setDraggedElementAttrs(target, undefined);
    target.setAttr?.(ACTIVE_DRAG_PREVIEW_SESSION_ATTR, null);
  });
  session.activeLayer.batchDraw();
  if (!committedCleanup) {
    sourceLayers.forEach((layer) => layer?.batchDraw());
  }

  if (startedAt > 0) {
    geometryPerf.record('ActiveDragLayer.clearSession', performance.now() - startedAt);
  }
}

export function beginActiveDragPreviewBackend(
  backend: ActiveDragPreviewBackend,
): ActiveDragPreviewBackendAttachment | null {
  switch (backend.mode) {
    case 'elementNodes': {
      const previewSession = beginActiveElementDragPreviewSession(backend.target, {
        primaryElementId: backend.primaryElementId,
        elements: backend.elements,
        moveDragTarget: backend.moveDragTarget,
        activeLayer: backend.activeLayer,
      });
      if (!previewSession) return null;
      return {
        previewSession,
        cleanup: (result?: unknown) => clearActiveElementDragPreviewSession(backend.target, result),
      };
    }
    case 'nodeMove': {
      const previewSession = beginActiveNodeDragPreviewSession(backend.target, {
        nodes: backend.nodes,
        moveDragTarget: backend.moveDragTarget,
        activeLayer: backend.activeLayer,
      });
      if (!previewSession) return null;
      return {
        previewSession,
        cleanup: (result?: unknown) => clearActiveNodeDragPreviewSession(backend.target, result),
      };
    }
    case 'cloneNodes': {
      const previewSession = beginActiveCloneDragPreviewSession(backend.target, {
        nodes: backend.nodes,
        activeLayer: backend.activeLayer,
      });
      if (!previewSession) return null;
      return {
        previewSession,
        cleanup: () => clearActiveCloneDragPreviewSession(backend.target),
      };
    }
  }
}

export function cacheDraggedElementShapeNodes(
  target: PreviewDragTarget | null | undefined,
  elementId: string,
  coordinateCount?: number,
): void {
  const stage = target?.getStage?.();
  if (!stage) return;
  const refs = findElementShapeNodeRefs(stage, elementId, coordinateCount);
  target?.setAttr?.('__vulcanDraggedShapeNode', refs.shapeNode);
  target?.setAttr?.('__vulcanDraggedShapeStrokeNode', refs.shapeStrokeNode);
  target?.setAttr?.('__vulcanDraggedSlopeBottomNode', refs.slopeBottomNode);
  target?.setAttr?.('__vulcanDraggedSlopeEdgesNode', refs.slopeEdgesNode);
  target?.setAttr?.('__vulcanDraggedArrowLineNode', refs.arrowLineNode);
  target?.setAttr?.('__vulcanDraggedArrowHeadNode', refs.arrowHeadNode);
  target?.setAttr?.('__vulcanDraggedPointNode', refs.pointNode ?? null);
  target?.setAttr?.('__vulcanDraggedVertexNodes', refs.vertexNodes);
}

export function updateElementShapeNodeRefsFromCoords(
  refs: Partial<ElementShapeNodeRefs>,
  element: Element | undefined,
  coords: Array<{ x: number; y: number; z?: number }>,
  scale: number,
  panOffset: { x: number; y: number },
  canvasCenter: { x: number; y: number },
): PreviewLayerNode | null {
  const points = coords.flatMap((coord) => {
    const canvas = worldToCanvas(coord, scale, panOffset, canvasCenter);
    return [canvas.x, canvas.y];
  });
  refs.shapeNode?.points?.(points);
  refs.shapeStrokeNode?.points?.(points);

  const canvasCoords = coords.map((coord) => worldToCanvas(coord, scale, panOffset, canvasCenter));
  const pointCoord = canvasCoords[0];
  if (pointCoord && refs.pointNode) {
    if (typeof refs.pointNode.position === 'function') {
      refs.pointNode.position({ x: pointCoord.x, y: pointCoord.y });
    } else {
      refs.pointNode.x?.(pointCoord.x);
      refs.pointNode.y?.(pointCoord.y);
    }
  }

  if (canvasCoords.length >= 3) {
    refs.slopeBottomNode?.points?.(canvasCoords.slice(0, 2).flatMap((coord) => [coord.x, coord.y]));
    refs.slopeEdgesNode?.points?.(
      [canvasCoords[1], ...canvasCoords.slice(2), canvasCoords[0]].flatMap((coord) => [coord.x, coord.y]),
    );
  }

  canvasCoords.forEach((coord, index) => {
    const vertexNode = refs.vertexNodes?.[index];
    if (!vertexNode) return;
    if (typeof vertexNode.position === 'function') {
      vertexNode.position({ x: coord.x, y: coord.y });
      return;
    }
    vertexNode.x?.(coord.x);
    vertexNode.y?.(coord.y);
  });

  if ((refs.arrowLineNode?.points || refs.arrowHeadNode?.points) && element) {
    const directionArrow = calculateDirectionArrow({ ...element, coordinates: coords as Element['coordinates'] } as Element);
    if (directionArrow) {
      const centerCanvas = worldToCanvas({ x: directionArrow.centerX, y: directionArrow.centerY }, scale, panOffset, canvasCenter);
      const arrowCanvas = worldToCanvas({ x: directionArrow.arrowX, y: directionArrow.arrowY }, scale, panOffset, canvasCenter);
      const arrowPoints = calculateArrowPoints({
        centerX: centerCanvas.x,
        centerY: centerCanvas.y,
        arrowX: arrowCanvas.x,
        arrowY: arrowCanvas.y,
        orientation: directionArrow.orientation,
      });
      refs.arrowLineNode?.points?.([centerCanvas.x, centerCanvas.y, arrowCanvas.x, arrowCanvas.y]);
      refs.arrowHeadNode?.points?.([
        arrowPoints.tip.x, arrowPoints.tip.y,
        arrowPoints.left.x, arrowPoints.left.y,
        arrowPoints.tip.x, arrowPoints.tip.y,
        arrowPoints.right.x, arrowPoints.right.y,
      ]);
    }
  }

  return refs.shapeStrokeNode?.getLayer?.()
    ?? refs.shapeNode?.getLayer?.()
    ?? refs.slopeEdgesNode?.getLayer?.()
    ?? refs.slopeBottomNode?.getLayer?.()
    ?? refs.arrowLineNode?.getLayer?.()
    ?? refs.arrowHeadNode?.getLayer?.()
    ?? refs.pointNode?.getLayer?.()
    ?? refs.vertexNodes?.find((node) => node?.getLayer)?.getLayer?.()
    ?? null;
}

export function updateElementShapeNodeRefsForVertex(
  refs: Partial<ElementShapeNodeRefs>,
  element: Element | undefined,
  vertexIndex: number,
  world: { x: number; y: number },
  scale: number,
  panOffset: { x: number; y: number },
  canvasCenter: { x: number; y: number },
): PreviewLayerNode | null {
  const coords = element?.coordinates?.map((coord, index) => (
    index === vertexIndex
      ? { ...coord, x: world.x, y: world.y }
      : coord
  ));
  if (!coords) return null;
  return updateElementShapeNodeRefsFromCoords(refs, element, coords, scale, panOffset, canvasCenter);
}

export function updateDraggedElementShapeFromCoords(
  target: PreviewDragTarget | null | undefined,
  elementId: string,
  coords: Array<{ x: number; y: number; z?: number }>,
  scale: number,
  panOffset: { x: number; y: number },
  canvasCenter: { x: number; y: number },
  element?: Element,
): void {
  const activeSessionRefs = getActiveDragPreviewSession(target)?.elementRefsById.get(elementId);
  let refs: ElementShapeNodeRefs = activeSessionRefs ?? {
    shapeNode: (target?.getAttr?.('__vulcanDraggedShapeNode') as PreviewLineNode | null | undefined) ?? null,
    shapeStrokeNode: (target?.getAttr?.('__vulcanDraggedShapeStrokeNode') as PreviewLineNode | null | undefined) ?? null,
    slopeBottomNode: (target?.getAttr?.('__vulcanDraggedSlopeBottomNode') as PreviewLineNode | null | undefined) ?? null,
    slopeEdgesNode: (target?.getAttr?.('__vulcanDraggedSlopeEdgesNode') as PreviewLineNode | null | undefined) ?? null,
    arrowLineNode: (target?.getAttr?.('__vulcanDraggedArrowLineNode') as PreviewLineNode | null | undefined) ?? null,
    arrowHeadNode: (target?.getAttr?.('__vulcanDraggedArrowHeadNode') as PreviewLineNode | null | undefined) ?? null,
    pointNode: (target?.getAttr?.('__vulcanDraggedPointNode') as PreviewPositionNode | null | undefined) ?? null,
    vertexNodes: (target?.getAttr?.('__vulcanDraggedVertexNodes') as Array<PreviewPositionNode | null> | undefined) ?? [],
  };
  if (
    !activeSessionRefs &&
    !refs.shapeNode &&
    !refs.slopeBottomNode &&
    !refs.slopeEdgesNode &&
    !refs.pointNode &&
    refs.vertexNodes.length === 0
  ) {
    cacheDraggedElementShapeNodes(target, elementId, coords.length);
    refs = {
      shapeNode: (target?.getAttr?.('__vulcanDraggedShapeNode') as PreviewLineNode | null | undefined) ?? null,
      shapeStrokeNode: (target?.getAttr?.('__vulcanDraggedShapeStrokeNode') as PreviewLineNode | null | undefined) ?? null,
      slopeBottomNode: (target?.getAttr?.('__vulcanDraggedSlopeBottomNode') as PreviewLineNode | null | undefined) ?? null,
      slopeEdgesNode: (target?.getAttr?.('__vulcanDraggedSlopeEdgesNode') as PreviewLineNode | null | undefined) ?? null,
      arrowLineNode: (target?.getAttr?.('__vulcanDraggedArrowLineNode') as PreviewLineNode | null | undefined) ?? null,
      arrowHeadNode: (target?.getAttr?.('__vulcanDraggedArrowHeadNode') as PreviewLineNode | null | undefined) ?? null,
      pointNode: (target?.getAttr?.('__vulcanDraggedPointNode') as PreviewPositionNode | null | undefined) ?? null,
      vertexNodes: (target?.getAttr?.('__vulcanDraggedVertexNodes') as Array<PreviewPositionNode | null> | undefined) ?? [],
    };
  }
  if (
    !refs.shapeNode?.points &&
    !refs.slopeBottomNode?.points &&
    !refs.slopeEdgesNode?.points &&
    !refs.pointNode &&
    refs.vertexNodes.length === 0
  ) return;
  updateElementShapeNodeRefsFromCoords(refs, element, coords, scale, panOffset, canvasCenter)?.batchDraw?.();
}
