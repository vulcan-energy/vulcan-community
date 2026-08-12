// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { memo, useState, useCallback, useMemo } from 'react';
import { Group, Line, Circle, Rect, Text } from 'react-konva';
import { getPointElementIconNode } from '../../lib/pointElementIconSpec';
import { lucideIconNodeToKonva } from '../../lib/lucideIconKonva';
import { getElementShape, getElementColor, worldToCanvas, canvasToWorld } from '../../lib/shapeUtils';
import {
  useGeometryStoreApi,
  type Element,
  type Floor,
  type GeometryStoreApi,
  generateDefaultCoordinates,
  shouldSnapToParent,
} from '../../stores/geometryStore';
import { calculateDirectionArrow, calculateArrowPoints } from '../../lib/directionArrows';
import type { DrawMode } from '../../hooks/useDrawingMode';
import { segmentTangentAndOpeningOutwardModelXY } from '../../lib/openingSegmentOutward';
import { CANVAS_CONSTANTS } from '../../lib/canvasConstants';
import { CATEGORY_GHOST_OPACITY_FACTOR } from '../../lib/elementCategoryVisibility';
import { getDormerBundleInfo } from '../../lib/dormerGeometry';
import { isElementOnActiveCanvasFloor } from '../../lib/elementCanvasFloor';
import { resolveThermalBridgeLineMode } from '../../lib/thermalBridgeLinearGeometry';
import { isDevelopmentContextGeneratedShading } from '../../lib/developmentContextShading';
import {
  cascadeHostedDescendantGeometry,
  collectHostedDescendantElementIds,
} from '../../lib/hostedDescendantCascade';
import {
  beginVertexCanvasInteraction,
  beginVertexDrag,
  endVertexCanvasInteraction,
  recordActiveVertexDragWorldPosition as recordVertexDragWorldPosition,
  buildVertexDragStateForElement,
  buildVertexLengthPillsFromState,
  endVertexDrag,
  finalizeVertexDragFromState,
  getVertexDragState,
  setVertexDragState,
  type CommitVertexPositionUpdates,
  type VertexLengthPill,
  type VertexDragState,
} from './vertexDragSession';
import {
  clearVertexLengthPillPreview,
  updateDraggedElementShapeFromCoords,
  updateElementShapeNodeRefsForVertex,
  updateVertexLengthPillPreview,
} from './elementDragPreview';
import {
  beginCanvasInteraction,
  endCanvasInteraction,
  readCanvasInteractionSession,
  writeCanvasInteractionSession,
} from './canvasInteractionSession';
import {
  type CanvasElementRendererPalette,
  type CanvasInteractionPalette,
} from './elementRendererPalette';
import { readRootCssVar } from '../../lib/cssVars';
import {
  snapCornerToOtherCornersFromCache as utilSnapCornerToOtherCornersFromCache,
  applyAngleSnapIfClose as utilApplyAngleSnapIfClose,
  projectSegmentOntoParent as utilProjectSegmentOntoParent,
  findNearestWallProjectionFromCache as utilFindNearestWallProjectionFromCache,
  getExactSnappedVertices as utilGetExactSnappedVertices,
  getWallSupportedSnappedVertices as utilGetWallSupportedSnappedVertices,
  findPerpendicularFootOnWallInfiniteFromCache as utilFindPerpFootOnWallInfiniteFromCache,
  findClosestSnapCorner as utilFindClosestSnapCorner,
  getNearbySnapWallSegments as utilGetNearbySnapWallSegments,
  type GeometrySnapCache,
} from '../../lib/snapUtils';
import { tryAxisAlignedRightAngleSnapForVertex } from '../../lib/vertexEditSnap';
import { geometryPerf } from '../../lib/geometryPerf';
import { getMechanicalVentilationDuctworkRoleStyle } from '../../lib/mvhrDuctwork';

type LineVertexDragHint = { handle: 0 | 1; wallSnap: boolean; vertexSnap: boolean };

type ElementCoordinate = { x: number; y: number; z: number };
type DragPreviewTarget = Parameters<typeof updateDraggedElementShapeFromCoords>[0];

function canPreviewLineHostedDescendants(element: Element | undefined): boolean {
  return !!element &&
    (element.type === 'BuildingElementOpaque' || element.type === 'BuildingElementTransparent') &&
    Array.isArray(element.coordinates) &&
    element.coordinates.length === 2;
}

/** True when an unparented window/door vertex is within wall-line snap range (matches dragBoundFunc). */
function hasWallLineSnapForOpening(
  element: Element,
  world: { x: number; y: number },
  snapCache: GeometrySnapCache,
  snapTol: number,
): boolean {
  if (!shouldSnapToParent(element) || (element as any).parent_element) return false;
  return utilFindNearestWallProjectionFromCache(world, snapCache, element.id, snapTol) != null;
}

function isBuildingElementForSnapFloor(el: Element | undefined): boolean {
  return typeof el?.type === 'string' && el.type.startsWith('BuildingElement');
}

function canvasStoreyIndex(z: unknown): number | null {
  const n = Number(z);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function isSameSnapFloor(
  source: Element,
  sourceZ: unknown,
  target: Element | undefined,
  targetZ: unknown,
): boolean {
  if (!isBuildingElementForSnapFloor(source) || !isBuildingElementForSnapFloor(target)) return true;
  const a = canvasStoreyIndex(sourceZ);
  const b = canvasStoreyIndex(targetZ);
  return a !== null && b !== null && a === b;
}

/**
 * Storey-gated: unlike the 3D vertex-drag snap (`GeometryCanvas3D.snap3DPlanPoint`), this skips
 * a candidate corner unless it is on the same floor as the dragged vertex (for `BuildingElement*`
 * pairs) — the shared snap cache spans every floor, and the 2D plan view needs that gate to avoid
 * snapping to a corner that is only coincidentally at the same XY on another storey.
 */
function findCornerVertexSnapTarget(
  element: Element,
  vertexIndex: number,
  world: { x: number; y: number },
  elementsById: Record<string, Element>,
  snapCache: GeometrySnapCache,
  snapTol: number,
): { x: number; y: number } | null {
  const sourceZ = element.coordinates?.[vertexIndex]?.z;
  const best = utilFindClosestSnapCorner(world, snapCache, snapTol, {
    isExcluded: (target) => target.elementId === element.id,
    isEligible: (target) => isSameSnapFloor(element, sourceZ, elementsById[target.elementId], target.z),
  });
  return best ? { x: best.x, y: best.y } : null;
}

function findWallSegmentVertexSnapTarget(
  element: Element,
  vertexIndex: number,
  world: { x: number; y: number },
  elementsById: Record<string, Element>,
  snapCache: GeometrySnapCache,
  snapTol: number,
): { x: number; y: number } | null {
  const sourceZ = element.coordinates?.[vertexIndex]?.z;
  let best: { x: number; y: number } | null = null;
  let bestDSq = Infinity;
  let bestOrder = Infinity;
  const snapTolSq = snapTol * snapTol;

  for (const segment of utilGetNearbySnapWallSegments(snapCache, world, snapTol)) {
    if (segment.elementId === element.id) continue;
    const targetElement = elementsById[segment.elementId];
    const targetCoords = targetElement?.coordinates;
    if (!targetElement || targetCoords?.length !== 2) continue;
    if (
      !isSameSnapFloor(element, sourceZ, targetElement, targetCoords[0]?.z) ||
      !isSameSnapFloor(element, sourceZ, targetElement, targetCoords[1]?.z)
    ) {
      continue;
    }

    const { A, B } = segment;
    const vx = B.x - A.x;
    const vy = B.y - A.y;
    const v2 = vx * vx + vy * vy;
    if (v2 === 0) continue;
    const tRaw = ((world.x - A.x) * vx + (world.y - A.y) * vy) / v2;
    const t = Math.max(0, Math.min(1, tRaw));
    const proj = { x: A.x + t * vx, y: A.y + t * vy };
    const dx = world.x - proj.x;
    const dy = world.y - proj.y;
    const dSq = dx * dx + dy * dy;
    if (dSq > snapTolSq) continue;
    if (dSq < bestDSq || (dSq === bestDSq && segment.order < bestOrder)) {
      bestDSq = dSq;
      bestOrder = segment.order;
      best = proj;
    }
  }

  return best;
}

const getProjectDefaults = (store: GeometryStoreApi) => {
  const state = store.getState() as any;
  return {
    snapTol: state.PROJECT_DEFAULTS?.snap_m || 0.1,
    angleTol: state.PROJECT_DEFAULTS?.angle_deg || 2
  };
};

/** Enforce ~axis-aligned 90° corners; skips when the segment is parent-constrained. */
function applyPlanVertexRightAngleSnap(
  w: { x: number; y: number },
  element: Element,
  vertexIndex: number,
  elementsById: Record<string, Element>,
  store: GeometryStoreApi,
): { x: number; y: number } {
  if (shouldSnapToParent(element) && (element as any).parent_element) {
    return w;
  }
  const d = getProjectDefaults(store);
  const matchTol = Math.max(0.12, d.snapTol * 3);
  return tryAxisAlignedRightAngleSnapForVertex(
    w,
    element,
    vertexIndex,
    elementsById,
    d.angleTol,
    matchTol,
  ) ?? w;
}

/**
 * Snap pipeline for dragging one end of a two-point line: nearest corner, then angle snap
 * against the opposite endpoint, then the axis-aligned right-angle rule.
 *
 * Both endpoints must run the same steps. `onDragEnd` angle-snaps either endpoint, so an
 * endpoint that skips angle snap while dragging shows an unsnapped ghost and jumps on release.
 */
function resolveLineVertexDragWorld(
  world: { x: number; y: number },
  element: Element,
  vertexIndex: number,
  elementsById: Record<string, Element>,
  snapCache: GeometrySnapCache,
  store: GeometryStoreApi,
  options: { snapCorners: boolean; snapAngles: boolean },
): { x: number; y: number } {
  const coordinates = element.coordinates ?? [];
  const defaults = getProjectDefaults(store);
  let next = world;

  if (options.snapCorners) {
    const best = perfMeasure('snapCornerToOtherCorners-line-vertex', () =>
      findCornerVertexSnapTarget(
        element,
        vertexIndex,
        next,
        elementsById,
        snapCache,
        defaults.snapTol,
      ),
    );
    if (best) next = best;
  }

  if (options.snapAngles && coordinates.length === 2) {
    const other = coordinates[vertexIndex === 0 ? 1 : 0];
    if (other) {
      const angleSnapped = utilApplyAngleSnapIfClose(
        next,
        { x: other.x, y: other.y },
        defaults.angleTol,
      );
      if (angleSnapped.snapped) next = angleSnapped.point;
    }
  }

  return applyPlanVertexRightAngleSnap(next, element, vertexIndex, elementsById, store);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getWindowShadingObjectScreenGeometry(
  element: Element,
  elementsById: Record<string, Element>,
  nameToId: Record<string, string>,
) {
  if (element.type !== 'WindowShading' || (element as any).shading_type !== 'object' || !(element as any).parent_element) {
    return null;
  }
  const parentId = nameToId[(element as any).parent_element as string];
  const parent = parentId ? elementsById[parentId] : undefined;
  if (!parent || parent.type !== 'BuildingElementTransparent' || !parent.coordinates || parent.coordinates.length !== 2) {
    return null;
  }

  const [a, b] = parent.coordinates as Array<{ x: number; y: number; z: number }>;
  const { tangent, openingOutward } = segmentTangentAndOpeningOutwardModelXY(a.x, a.y, b.x, b.y);
  const width = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  const fallbackDistance = (() => {
    const coord = element.coordinates?.[0];
    if (!coord) return 0.4;
    const dx = coord.x - midpoint.x;
    const dy = coord.y - midpoint.y;
    return Math.max(0.1, (dx * openingOutward[0]) + (dy * openingOutward[1]));
  })();
  const distance = isFiniteNumber((element as any).distance) && (element as any).distance > 0
    ? (element as any).distance
    : fallbackDistance;

  const center = {
    x: midpoint.x + openingOutward[0] * distance,
    y: midpoint.y + openingOutward[1] * distance,
  };
  const halfWidth = width / 2;
  const start = {
    x: center.x - tangent[0] * halfWidth,
    y: center.y - tangent[1] * halfWidth,
  };
  const end = {
    x: center.x + tangent[0] * halfWidth,
    y: center.y + tangent[1] * halfWidth,
  };

  return { parent, midpoint, center, start, end, tangent, openingOutward, width, distance };
}

const UNSNAPPED_VERTEX_CHIP_TEXT = 'Unsnapped vertex';
const UNSNAPPED_VERTEX_CHIP_FONT_SIZE = 11;
const UNSNAPPED_VERTEX_CHIP_HEIGHT = 20;
const UNSNAPPED_VERTEX_CHIP_PADDING_X = 8;
const UNSNAPPED_VERTEX_CHIP_CHAR_WIDTH = 6.2;
const UNSNAPPED_VERTEX_CHIP_OFFSET_Y = 10;

const LINE_WALL_VERTEX_GUIDANCE_TYPES = new Set<string>([
  'BuildingElementOpaque',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
]);

const POLYGON_VERTEX_GUIDANCE_TYPES = new Set<string>([
  ...LINE_WALL_VERTEX_GUIDANCE_TYPES,
  'BuildingElementGround',
]);

function shouldShowUnsnappedVertexGuidance(element: Element, shape: string): boolean {
  if (shape === 'line' && element.coordinates?.length === 2) {
    if (element.type === 'BuildingElementOpaque' && (element as any).is_external_door) return false;
    return LINE_WALL_VERTEX_GUIDANCE_TYPES.has(element.type);
  }

  if (shape === 'polygon' && !!element.coordinates && element.coordinates.length >= 3) {
    return POLYGON_VERTEX_GUIDANCE_TYPES.has(element.type);
  }

  return false;
}

function renderUnsnappedVertexChip(
  position: { x: number; y: number },
  handleRadius: number,
  key: string,
): React.ReactNode {
  const width = (UNSNAPPED_VERTEX_CHIP_TEXT.length * UNSNAPPED_VERTEX_CHIP_CHAR_WIDTH) + (UNSNAPPED_VERTEX_CHIP_PADDING_X * 2);
  const x = position.x - (width / 2);
  const y = position.y - handleRadius - UNSNAPPED_VERTEX_CHIP_HEIGHT - UNSNAPPED_VERTEX_CHIP_OFFSET_Y;

  return (
    <Group key={key} listening={false}>
      <Rect
        x={x}
        y={y}
        width={width}
        height={UNSNAPPED_VERTEX_CHIP_HEIGHT}
        fill={CANVAS_CONSTANTS.COLORS.VALIDATION_WARNING}
        stroke={CANVAS_CONSTANTS.COLORS.VALIDATION_WARNING_BORDER}
        strokeWidth={1}
        cornerRadius={10}
        listening={false}
      />
      <Text
        x={x + UNSNAPPED_VERTEX_CHIP_PADDING_X}
        y={y + 4}
        width={width - (UNSNAPPED_VERTEX_CHIP_PADDING_X * 2)}
        text={UNSNAPPED_VERTEX_CHIP_TEXT}
        fontSize={UNSNAPPED_VERTEX_CHIP_FONT_SIZE}
        fill={CANVAS_CONSTANTS.COLORS.TEXT}
        align="center"
        listening={false}
      />
    </Group>
  );
}

function formatTbZChipText(label: 'z1' | 'z2', z: number | undefined) {
  const t = typeof z === 'number' && Number.isFinite(z) ? z.toFixed(2) : '—';
  return `${label} ${t}m`;
}

function renderTbSlopeZPill(
  position: { x: number; y: number },
  text: string,
  key: string,
): React.ReactNode {
  const charW = 6.5;
  const padX = 6;
  const h = 18;
  const w = Math.max(40, text.length * charW + padX * 2);
  const x = position.x - w / 2;
  const y = position.y - 6 - 22;
  return (
    <Group key={key} listening={false}>
      <Rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={readRootCssVar('--semantic-snap', '#1E90FF')}
        stroke={readRootCssVar('--border-overlay', 'rgba(255, 255, 255, 0.2)')}
        strokeWidth={1}
        cornerRadius={8}
        listening={false}
      />
      <Text
        x={x + padX}
        y={y + 3}
        width={w - padX * 2}
        text={text}
        fontSize={11}
        fontStyle="bold"
        fill={readRootCssVar('--semantic-on-color', '#FFFFFF')}
        align="center"
        listening={false}
      />
    </Group>
  );
}

// RAF-based throttling for live drag preview work.
let pillUpdateRAF: number | null = null;

// Measure function execution time with minimal overhead
function perfMeasure<T>(
  name: string,
  fn: () => T,
  sampleRate = 1,
): T {
  return geometryPerf.measure(name, fn, { sampleRate });
}

// Props interface for ElementRenderer component
export interface ElementRendererProps {
  element: Element;
  scale: number;
  panOffset: {x: number, y: number};
  canvasCenter: {x: number, y: number};
  isSelected: boolean;
  updateElement: (id: string, updates: Partial<Element>, skipAutoSave?: boolean) => void;
  handleElementClick: (elementId: string, e: any) => void;
  elementsById: Record<string, Element>;
  elementIds: string[];
  nameToId: Record<string, string>;
  snapToParent: boolean;
  snapCorners?: boolean;
  snapAngles?: boolean;
  centerOnElement?: (el: Element) => void;
  selectedVertex?: {elementId: string, vertexIndex: number} | null;
  setSelectedVertex?: (v: {elementId: string, vertexIndex: number} | null) => void;
  drawMode?: DrawMode;
  setElementHover?: (id: string | null) => void;
  elementHover?: string | null;
  overlapBadgeMenu?: { elementIds: string[] } | null;
  currentFloorZ?: number;
  vertexSnapMode?: boolean;
  commitVertexPositionUpdates?: CommitVertexPositionUpdates;
  selection?: { type: 'zone' | 'element' | 'global' | 'dormer'; id: string; isPlaceholder?: boolean } | null;
  floors: Floor[];
  snapCache: GeometrySnapCache;
  canvasElementPalette: CanvasElementRendererPalette;
  canvasInteractionPalette: CanvasInteractionPalette;
  /** 2D/3D: fully hidden on canvas (opacity 0) and non-interactive; list/inspector unchanged. */
  categoryGhostOnCanvas?: boolean;
  /** Space Labeller mode: dim fabric on the active floor and block hits so footprints stay the focus. */
  spaceLabellerSuppressFabricInteraction?: boolean;
  /** Pre-projected canvas coords from the parent's elementCanvasData. Skips a redundant worldToCanvas pass per element per render. */
  canvasCoords?: Array<{ x: number; y: number }>;
}

function getDormerCutoutPolygonsForHost(
  hostElement: Element,
  elementsById: Record<string, Element>,
  selection: { type: 'zone' | 'element' | 'global' | 'dormer'; id: string; isPlaceholder?: boolean } | null | undefined,
): Array<Array<{ x: number; y: number; z: number }>> {
  if (hostElement.type !== 'BuildingElementOpaque' || !selection) return [];
  const showAllHostCutouts = selection.type === 'element' && selection.id === hostElement.id;
  const selectedDormerBundleId = selection.type === 'dormer' ? selection.id : null;
  if (!showAllHostCutouts && !selectedDormerBundleId) return [];

  return Object.values(elementsById).flatMap((candidate) => {
    const bundleInfo = getDormerBundleInfo(candidate);
    if (!bundleInfo || bundleInfo.role !== 'front-wall-anchor') return [];
    if (bundleInfo.host_element_name !== hostElement.name) return [];
    if (selectedDormerBundleId && bundleInfo.bundle_id !== selectedDormerBundleId) return [];
    if (bundleInfo.cutout_polygon.length < 3) return [];
    return [bundleInfo.cutout_polygon];
  });
}

// Render element based on its coordinates - converted to component for React.memo optimization
const ElementRendererComponent: React.FC<ElementRendererProps> = ({
  element,
  scale,
  panOffset,
  canvasCenter,
  isSelected,
  updateElement,
  handleElementClick,
  elementsById,
  elementIds,
  nameToId,
  snapCorners,
  snapAngles,
  centerOnElement,
  selectedVertex,
  setSelectedVertex,
  drawMode,
  setElementHover,
  elementHover,
  overlapBadgeMenu,
  currentFloorZ,
  vertexSnapMode = false,
  commitVertexPositionUpdates,
  selection,
  floors,
  snapCache,
  canvasElementPalette,
  canvasInteractionPalette,
  categoryGhostOnCanvas = false,
  spaceLabellerSuppressFabricInteraction = false,
  canvasCoords: canvasCoordsProp,
}) => {
  const geometryStore = useGeometryStoreApi();
  const coordinates = element.coordinates || [];
  const isReadOnlyDevelopmentContextShading = isDevelopmentContextGeneratedShading(element);
  const [lineVertexDragHintState, setLineVertexDragHint] = useState<{
    elementId: string;
    value: LineVertexDragHint | null;
  }>(() => ({ elementId: element.id, value: null }));
  const lineVertexDragHint =
    lineVertexDragHintState.elementId === element.id ? lineVertexDragHintState.value : null;
  const setLineVertexDragHintIfChanged = useCallback((next: LineVertexDragHint | null) => {
    setLineVertexDragHint((prevState) => {
      const prev = prevState.elementId === element.id ? prevState.value : null;
      if (
        prev === next ||
        (
          prev !== null &&
          next !== null &&
          prev.handle === next.handle &&
          prev.wallSnap === next.wallSnap &&
          prev.vertexSnap === next.vertexSnap
        )
      ) {
        return prevState;
      }
      return { elementId: element.id, value: next };
    });
  }, [element.id]);
  const updateLengthPillPreview = useCallback(
    (target: unknown, pills: VertexLengthPill[]) => {
      updateVertexLengthPillPreview(
        target,
        pills,
        scale,
        panOffset,
        canvasCenter,
        {
          fill: canvasInteractionPalette.snap,
          text: readRootCssVar('--semantic-on-color', '#FFFFFF'),
        },
      );
    },
    [scale, panOffset, canvasCenter, canvasInteractionPalette.snap],
  );
  const clearLengthPillPreview = useCallback((target: unknown) => {
    clearVertexLengthPillPreview(target);
  }, []);
  const getLineHostedDescendantPreviewParentIds = useCallback(() => {
    const parentIds: string[] = [];
    const seen = new Set<string>();
    const vertexDragState = getVertexDragState();
    const addParentId = (elementId: string) => {
      if (seen.has(elementId)) return;
      const candidate = elementId === element.id ? element : elementsById[elementId];
      if (!canPreviewLineHostedDescendants(candidate)) return;
      seen.add(elementId);
      parentIds.push(elementId);
    };

    addParentId(element.id);
    for (const connected of vertexDragState?.connectedElements ?? []) {
      addParentId(connected.elementId);
    }

    return parentIds;
  }, [element, elementsById]);
  const beginActiveVertexPreview = useCallback((target: unknown, vertexIndex: number) => {
    const vertexDragState = getVertexDragState();
    const previewCoordinates = element.coordinates;
    const descendantElementIds = new Set<string>();
    for (const parentId of getLineHostedDescendantPreviewParentIds()) {
      for (const descendantId of collectHostedDescendantElementIds(elementsById, parentId)) {
        descendantElementIds.add(descendantId);
      }
    }
    const elementsForPreview = [
      { elementId: element.id, coordinateCount: previewCoordinates?.length ?? 0 },
      ...((vertexDragState?.connectedElements ?? []).map(({ elementId }) => ({
        elementId,
        coordinateCount: elementsById[elementId]?.coordinates?.length,
      }))),
      ...Array.from(descendantElementIds).map((elementId) => ({
        elementId,
        coordinateCount: elementsById[elementId]?.coordinates?.length,
      })),
    ];
    beginVertexCanvasInteraction({
      target,
      elementId: element.id,
      vertexIndex,
      coordinates: previewCoordinates,
      elements: elementsForPreview,
    });
  }, [element.coordinates, element.id, elementsById, getLineHostedDescendantPreviewParentIds]);
  const cleanupVertexInteractionAfterDragEnd = useCallback((target: DragPreviewTarget) => {
    if (getVertexDragState()) {
      finalizeVertexDragFromState(undefined, () => clearLengthPillPreview(target));
    }
    endVertexCanvasInteraction(target, { committed: true });
  }, [clearLengthPillPreview]);
  const previewLineHostedDescendantsForChangedElements = useCallback((
    target: DragPreviewTarget,
    nextElementsById: Record<string, Element>,
    changedElementIds: string[],
  ) => {
    const changedLineParentIds = changedElementIds.filter((elementId) => (
      canPreviewLineHostedDescendants(nextElementsById[elementId] ?? elementsById[elementId])
    ));
    if (changedLineParentIds.length === 0) return;

    const cascade = cascadeHostedDescendantGeometry({
      previousElementsById: elementsById,
      nextElementsById,
      changedElementIds: changedLineParentIds,
      floors: floors ?? [],
    });
    const directIds = new Set(changedElementIds);

    for (const changedId of cascade.changedElementIds) {
      if (directIds.has(changedId)) continue;
      const changedElement = cascade.elementsById[changedId];
      if (!changedElement?.coordinates?.length) continue;
      updateDraggedElementShapeFromCoords(
        target,
        changedId,
        changedElement.coordinates as Array<{ x: number; y: number; z?: number }>,
        scale,
        panOffset,
        canvasCenter,
        changedElement,
      );
    }
  }, [canvasCenter, elementsById, floors, panOffset, scale]);
  const previewLineHostedDescendantsForCoords = useCallback((
    target: DragPreviewTarget,
    elementId: string,
    previewCoords: Array<{ x: number; y: number; z?: number }>,
  ) => {
    const previewElement = elementId === element.id ? element : elementsById[elementId];
    if (!canPreviewLineHostedDescendants(previewElement)) return;
    const nextElement = {
      ...previewElement,
      coordinates: previewCoords as Element['coordinates'],
    } as Element;
    previewLineHostedDescendantsForChangedElements(
      target,
      {
        ...elementsById,
        [elementId]: nextElement,
      },
      [elementId],
    );
  }, [element, elementsById, previewLineHostedDescendantsForChangedElements]);
  const previewLineHostedDescendantsForVertexState = useCallback((
    target: DragPreviewTarget,
    state: VertexDragState | null,
    draggedElement: Element,
    draggedVertexIndex: number,
    draggedWorld: { x: number; y: number },
  ) => {
    let nextElementsById: Record<string, Element> | null = null;
    const changedElementIds: string[] = [];

    const applyVertexPreview = (
      elementId: string,
      vertexIndex: number,
      world: { x: number; y: number },
    ) => {
      const sourceElementsById = nextElementsById ?? elementsById;
      const sourceElement = elementId === draggedElement.id ? draggedElement : sourceElementsById[elementId];
      if (!canPreviewLineHostedDescendants(sourceElement)) return;
      const sourceCoordinates = sourceElement.coordinates as ElementCoordinate[];
      if (!sourceCoordinates[vertexIndex]) return;
      const coordinates = sourceCoordinates.map((coord, index) => (
        index === vertexIndex
          ? { ...coord, x: world.x, y: world.y }
          : coord
      ));
      if (!nextElementsById) {
        nextElementsById = { ...elementsById };
      }
      nextElementsById[elementId] = {
        ...sourceElement,
        coordinates,
      } as Element;
      if (!changedElementIds.includes(elementId)) {
        changedElementIds.push(elementId);
      }
    };

    applyVertexPreview(draggedElement.id, draggedVertexIndex, draggedWorld);

    if (state?.connectedElementWorldCoords) {
      for (const { elementId, vertexIndex } of state.connectedElements) {
        const connectedWorld = state.connectedElementWorldCoords.get(`${elementId}-${vertexIndex}`);
        if (!connectedWorld) continue;
        applyVertexPreview(elementId, vertexIndex, connectedWorld);
      }
    }

    if (!nextElementsById || changedElementIds.length === 0) return;
    previewLineHostedDescendantsForChangedElements(target, nextElementsById, changedElementIds);
  }, [elementsById, previewLineHostedDescendantsForChangedElements]);
  const applyLineVertexSnapHint = useCallback(
    (handle: 0 | 1, world: { x: number; y: number }) => {
      const snapTol = getProjectDefaults(geometryStore).snapTol;
      const wallSnap = hasWallLineSnapForOpening(
        element,
        world,
        snapCache,
        snapTol,
      );
      const vertexSnap =
        !!snapCorners &&
        findCornerVertexSnapTarget(element, handle, world, elementsById, snapCache, snapTol) !== null;
      setLineVertexDragHintIfChanged({ handle, wallSnap, vertexSnap });
    },
    [element, elementsById, geometryStore, setLineVertexDragHintIfChanged, snapCache, snapCorners],
  );

  const updateVertexSnapPreview = useCallback(
    (
      state: VertexDragState,
      draggedElement: Element,
      draggedVertexIndex: number,
      world: { x: number; y: number },
    ) => {
      if (!state.connectedElementWorldCoords) {
        state.connectedElementWorldCoords = new Map();
      }

      const canvas = worldToCanvas(world, scale, panOffset, canvasCenter);
      const draggedZ = draggedElement.coordinates?.[draggedVertexIndex]?.z ?? 0;
      state.connectedElementWorldCoords.set(`${draggedElement.id}-${draggedVertexIndex}`, {
        x: world.x,
        y: world.y,
        z: draggedZ,
      });

      state.connectedNodes?.forEach(({ node }) => {
        node.position(canvas);
      });

      const connectedShapeNodesByElementId = new Map<
        string,
        NonNullable<VertexDragState['connectedShapeNodes']>[number]
      >();
      for (const shapeNodeRefs of state.connectedShapeNodes ?? []) {
        if (!connectedShapeNodesByElementId.has(shapeNodeRefs.elementId)) {
          connectedShapeNodesByElementId.set(shapeNodeRefs.elementId, shapeNodeRefs);
        }
      }

      for (const { elementId: connectedId, vertexIndex: connectedVertexIndex } of state.connectedElements) {
        const connectedEl = elementsById[connectedId];
        if (!connectedEl?.coordinates) continue;

        state.connectedElementWorldCoords.set(`${connectedId}-${connectedVertexIndex}`, {
          x: world.x,
          y: world.y,
          z: connectedEl.coordinates[connectedVertexIndex]?.z ?? draggedZ,
        });

        const cachedShape = connectedShapeNodesByElementId.get(connectedId);
        if (cachedShape) {
          updateElementShapeNodeRefsForVertex(
            cachedShape,
            connectedEl,
            connectedVertexIndex,
            world,
            scale,
            panOffset,
            canvasCenter,
          );
        }
      }

      updateElementShapeNodeRefsForVertex(
        state.draggedShapeNodes ?? {
          shapeNode: state.draggedShapeNode ?? null,
          shapeStrokeNode: state.draggedShapeStrokeNode ?? null,
        },
        draggedElement,
        draggedVertexIndex,
        world,
        scale,
        panOffset,
        canvasCenter,
      );

      return canvas;
    },
    [canvasCenter, elementsById, panOffset, scale],
  );
  // Floor-aware opacity: elements on current floor are fully visible, others are 20% opacity
  const isCurrentFloor = isElementOnActiveCanvasFloor(element, currentFloorZ, floors);
  // Only elements on the current floor should be interactive; others are visual-only context.
  // `categoryGhostOnCanvas`: category is fully hidden on canvas (opacity 0) and does not take hits.
  const isInteractive =
    isCurrentFloor && !categoryGhostOnCanvas && !spaceLabellerSuppressFabricInteraction;
  const baseFloorOpacity = isCurrentFloor
    ? CANVAS_CONSTANTS.OPACITY.CURRENT_FLOOR
    : CANVAS_CONSTANTS.OPACITY.OTHER_FLOORS;
  const spaceLabellerDim =
    spaceLabellerSuppressFabricInteraction && isCurrentFloor && !categoryGhostOnCanvas ? 0.34 : 1;
  const opacity =
    baseFloorOpacity * spaceLabellerDim * (categoryGhostOnCanvas ? CATEGORY_GHOST_OPACITY_FACTOR : 1);

  const shape = getElementShape(element as any);
  const showDirectSelectionHandles = isSelected && getDormerBundleInfo(element) === null;
  const isRegularWallOpaque =
    element.type === 'BuildingElementOpaque' && (element as any).is_external_door !== true;
  const useWallSupportedPolygonSnaps =
    shape === 'polygon' &&
    !!element.coordinates &&
    element.coordinates.length >= 3 &&
    POLYGON_VERTEX_GUIDANCE_TYPES.has(element.type);
  // Memo: snapped-vertex detection is O(coords × n × otherCoords). Only the selected
  // element runs it, but pan/zoom otherwise re-renders that element every frame.
  const snappedVertices = useMemo(() => {
    if (!(showDirectSelectionHandles || isSelected)) return null;
    const getSnappedVertices = useWallSupportedPolygonSnaps
      ? utilGetWallSupportedSnappedVertices
      : utilGetExactSnappedVertices;
    return getSnappedVertices(
      element,
      elementsById,
      isRegularWallOpaque
        ? { skipVertexMatchFromOtherTypes: ['BuildingElementTransparent'] }
        : undefined,
    );
  }, [showDirectSelectionHandles, isSelected, useWallSupportedPolygonSnaps, element, elementsById, isRegularWallOpaque]);
  // Memo: dormer cutouts iterate all elements; reproject only when geometry or view changes.
  const dormerCutoutCanvasPolygons = useMemo(
    () => getDormerCutoutPolygonsForHost(element, elementsById, selection).map((polygon) =>
      polygon.map((point) => worldToCanvas(point, scale, panOffset, canvasCenter)),
    ),
    [element, elementsById, selection, scale, panOffset, canvasCenter],
  );

  if (coordinates.length === 0) {
    // Generate default coordinates for elements without them
    const defaultCoords = generateDefaultCoordinates(element);
    if (defaultCoords.length > 0) {
      const elementWithCoords = { ...element, coordinates: defaultCoords };
      const store = geometryStore.getState() as any;
      // Recursively render with generated coordinates
      return (
        <ElementRenderer
          element={elementWithCoords}
          scale={scale}
          panOffset={panOffset}
          canvasCenter={canvasCenter}
          isSelected={isSelected}
          updateElement={updateElement}
          handleElementClick={handleElementClick}
          elementsById={elementsById}
          elementIds={elementIds}
          nameToId={nameToId}
          snapToParent={store.snapToParent}
          snapCorners={store.snapCorners}
          snapAngles={store.snapAngles}
          centerOnElement={centerOnElement}
          selectedVertex={undefined}
          setSelectedVertex={undefined}
          drawMode={drawMode}
          setElementHover={setElementHover}
          elementHover={elementHover}
          overlapBadgeMenu={overlapBadgeMenu}
          currentFloorZ={currentFloorZ}
          vertexSnapMode={vertexSnapMode}
          commitVertexPositionUpdates={commitVertexPositionUpdates}
          floors={floors}
          snapCache={snapCache}
          canvasElementPalette={canvasElementPalette}
          canvasInteractionPalette={canvasInteractionPalette}
          categoryGhostOnCanvas={categoryGhostOnCanvas}
          spaceLabellerSuppressFabricInteraction={spaceLabellerSuppressFabricInteraction}
        />
      );
    }
    return null;
  }

  const canvasCoords = canvasCoordsProp && canvasCoordsProp.length === coordinates.length
    ? canvasCoordsProp
    : coordinates.map(coord => worldToCanvas(coord, scale, panOffset, canvasCenter));

  // Only highlight when hovering menu items (not general hover)
  const isHoveredFromMenu = elementHover === element.id && overlapBadgeMenu !== null;
  const typeColor = getElementColor(element as any, isSelected, canvasElementPalette);
  const elementColor = typeColor.stroke || CANVAS_CONSTANTS.COLORS.WALL;
  const elementFill = typeColor.fill || elementColor;
  const hoverStroke = isHoveredFromMenu ? canvasElementPalette.hover : elementColor;
  const showUnsnappedVertexGuidance = drawMode === 'none' && shouldShowUnsnappedVertexGuidance(element, shape);

  // Render point elements (single coordinate)
  if (shape === 'point') {
    const windowObjectScreen = getWindowShadingObjectScreenGeometry(element, elementsById, nameToId);
    const displayPoint = windowObjectScreen
      ? worldToCanvas(windowObjectScreen.center, scale, panOffset, canvasCenter)
      : canvasCoords[0];
    const typeStroke = getElementColor(element as any, isSelected, canvasElementPalette).stroke;
    const isMvhrTerminal = element.type === 'MechanicalVentilationTerminal';
    const mvhrTerminalRole =
      isMvhrTerminal && (element as { terminal_type?: unknown }).terminal_type === 'exhaust'
        ? 'exhaust'
        : 'intake';
    const mvhrTerminalLabel = mvhrTerminalRole === 'exhaust' ? 'OUT' : 'IN';
    const mvhrTerminalStyle = isMvhrTerminal
      ? getMechanicalVentilationDuctworkRoleStyle({ duct_type: mvhrTerminalRole })
      : null;
    const iconNode = getPointElementIconNode(element as any);
    const iconPx = isSelected ? 22 : 18;
    const iconScale = iconPx / 24;
    const lucideStrokeW = isSelected ? 2.15 : 1.85;
    const haloW = isSelected ? 4.2 : 3.4;
    const projectVentPointToParent = (world: { x: number; y: number; z?: number }) => {
      if (element.type !== 'Vents' || !(element as any).parent_element) return null;
      const parentId = nameToId[(element as any).parent_element as string];
      const parent = parentId ? elementsById[parentId] : undefined;
      if (!parent || !parent.coordinates || parent.coordinates.length !== 2) return null;
      const [PA, PB] = parent.coordinates as Array<{x:number,y:number,z:number}>;
      const vx = PB.x - PA.x;
      const vy = PB.y - PA.y;
      const v2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((world.x - PA.x) * vx + (world.y - PA.y) * vy) / v2));
      return { x: PA.x + t * vx, y: PA.y + t * vy, z: world.z ?? PA.z };
    };
    return (
      <Group
        key={element.id}
        opacity={opacity}
        visible={!categoryGhostOnCanvas}
        listening={isInteractive}
        onClick={isInteractive ? (e) => {
          if (drawMode !== 'none') return;
          e.cancelBubble = true;
          handleElementClick(element.id, e);
        } : undefined}
        onDblClick={isInteractive ? (e) => {
          e.cancelBubble = true;
          centerOnElement?.(element);
        } : undefined}
        onMouseEnter={isInteractive ? (() => {
          if (isSelected) return;
          setElementHover?.(element.id);
        }) : undefined}
        onMouseLeave={isInteractive ? (() => {
          if (isSelected) return;
          setElementHover?.(null);
        }) : undefined}
      >
        {windowObjectScreen ? (
          (() => {
            const screenStart = worldToCanvas(windowObjectScreen.start, scale, panOffset, canvasCenter);
            const screenEnd = worldToCanvas(windowObjectScreen.end, scale, panOffset, canvasCenter);
            const windowMid = worldToCanvas(windowObjectScreen.midpoint, scale, panOffset, canvasCenter);
            const transparency = isFiniteNumber((element as any).transparency) ? (element as any).transparency : 0;
            const screenOpacity = Math.max(0.35, 0.9 - (0.45 * Math.max(0, Math.min(1, transparency))));
            return (
              <>
                <Line
                  points={[screenStart.x, screenStart.y, screenEnd.x, screenEnd.y]}
                  stroke={getElementColor(element as any, isSelected, canvasElementPalette).stroke}
                  strokeWidth={isSelected ? 10 : 8}
                  opacity={screenOpacity}
                  lineCap="round"
                  listening={false}
                />
                <Line
                  points={[windowMid.x, windowMid.y, displayPoint.x, displayPoint.y]}
                  stroke={canvasInteractionPalette.warningGuide}
                  strokeWidth={1.5}
                  dash={[4, 4]}
                  listening={false}
                />
              </>
            );
          })()
        ) : null}
        <Group
          name={`point-${element.id}`}
          x={displayPoint.x}
          y={displayPoint.y}
          draggable={isSelected && !isReadOnlyDevelopmentContextShading}
          dragBoundFunc={(pos) => {
            // Constrain WindowShading to its parent window axis when parent is set
            try {
              if (windowObjectScreen) {
                const world = canvasToWorld({ x: pos.x, y: pos.y }, scale, panOffset, canvasCenter);
                const dx = world.x - windowObjectScreen.midpoint.x;
                const dy = world.y - windowObjectScreen.midpoint.y;
                const distance = Math.max(
                  0.1,
                  (dx * windowObjectScreen.openingOutward[0]) + (dy * windowObjectScreen.openingOutward[1]),
                );
                const next = {
                  x: windowObjectScreen.midpoint.x + (windowObjectScreen.openingOutward[0] * distance),
                  y: windowObjectScreen.midpoint.y + (windowObjectScreen.openingOutward[1] * distance),
                };
                const canvas = worldToCanvas(next, scale, panOffset, canvasCenter);
                return { x: canvas.x, y: canvas.y };
              }
              if (element.type === 'WindowShading' && (element as any).parent_element && (element as any).shading_type !== 'object') {
                const parentId = nameToId[(element as any).parent_element as string];
                const parent = parentId ? elementsById[parentId] : undefined;
                if (parent && parent.type === 'BuildingElementTransparent' && parent.coordinates && parent.coordinates.length === 2) {
                  const world = canvasToWorld({ x: pos.x, y: pos.y }, scale, panOffset, canvasCenter);
                  const [PA, PB] = parent.coordinates as Array<{x:number,y:number,z:number}>;
                  const vx = PB.x - PA.x; const vy = PB.y - PA.y; const v2 = vx*vx + vy*vy || 1;
                  const t = Math.max(0, Math.min(1, ((world.x-PA.x)*vx + (world.y-PA.y)*vy) / v2));
                  const proj = { x: PA.x + t*vx, y: PA.y + t*vy };
                  const canvas = worldToCanvas(proj, scale, panOffset, canvasCenter);
                  return { x: canvas.x, y: canvas.y };
                }
              }
              if (element.type === 'Vents' && (element as any).parent_element) {
                const world = canvasToWorld({ x: pos.x, y: pos.y }, scale, panOffset, canvasCenter);
                const projected = projectVentPointToParent(world);
                if (projected) {
                  const canvas = worldToCanvas(projected, scale, panOffset, canvasCenter);
                  return { x: canvas.x, y: canvas.y };
                }
              }
            } catch { /* swallow: best-effort */ }
            return pos;
          }}
          onDragStart={(e) => {
            const session = beginCanvasInteraction({
              kind: 'point-element-drag',
              targetId: element.id,
              snapshot: {
                coordinates,
              },
              preview: {
                mode: 'elementNodes',
                target: e.target,
                primaryElementId: element.id,
                elements: [{
                  elementId: element.id,
                  coordinateCount: 1,
                }],
                moveDragTarget: true,
              },
            });
            writeCanvasInteractionSession(e.target, session);
          }}
          onDragMove={() => {
            // IMPERATIVE DRAG: Update Konva node directly, no React re-renders!
            // No store updates during drag - only visual updates
            // Angle calculations deferred to drag end
          }}
          onDragEnd={(e) => {
            const session = readCanvasInteractionSession(e.target);
            endCanvasInteraction(session, { committed: true });
            writeCanvasInteractionSession(e.target, null);
            const newWorld = canvasToWorld({ x: e.target.x(), y: e.target.y() }, scale, panOffset, canvasCenter);
            const updated = [...coordinates];
            updated[0] = { ...updated[0], x: newWorld.x, y: newWorld.y } as any;

            // Auto-calculate angles and distance for ContextShading with parent
            if (element.type === 'ContextShading' && (element as any).parent_element) {
              const parentId = nameToId[(element as any).parent_element as string];
              const parentElement = parentId ? elementsById[parentId] : undefined;
              if (parentElement) {
                const { calculateShadingAngularRange, calculateContextShadingDistance } = geometryStore.getState();
                const { start_angle, end_angle } = calculateShadingAngularRange(
                  { ...element, coordinates: updated },
                  parentElement,
                  geometryStore.getState().globalOrientationOffset,
                );
                const distance = calculateContextShadingDistance({ ...element, coordinates: updated }, parentElement);
                updateElement(element.id, { coordinates: updated, start_angle, end_angle, distance });
              } else {
                updateElement(element.id, { coordinates: updated });
              }
            } else if (windowObjectScreen) {
              const dx = newWorld.x - windowObjectScreen.midpoint.x;
              const dy = newWorld.y - windowObjectScreen.midpoint.y;
              const distance = Math.max(
                0.1,
                (dx * windowObjectScreen.openingOutward[0]) + (dy * windowObjectScreen.openingOutward[1]),
              );
              const center = {
                x: windowObjectScreen.midpoint.x + (windowObjectScreen.openingOutward[0] * distance),
                y: windowObjectScreen.midpoint.y + (windowObjectScreen.openingOutward[1] * distance),
                z: updated[0].z,
              };
              updateElement(element.id, { coordinates: [center], distance });
            } else if (element.type === 'WindowShading' && (element as any).parent_element && (element as any).shading_type !== 'object') {
              // Final re-project on drop to ensure exact axis placement
              const parentId = nameToId[(element as any).parent_element as string];
              const parent = parentId ? elementsById[parentId] : undefined;
              if (parent && parent.type === 'BuildingElementTransparent' && parent.coordinates && parent.coordinates.length === 2) {
                const [PA, PB] = parent.coordinates as Array<{x:number,y:number,z:number}>;
                const vx = PB.x - PA.x; const vy = PB.y - PA.y; const v2 = vx*vx + vy*vy || 1;
                const t = Math.max(0, Math.min(1, ((updated[0].x-PA.x)*vx + (updated[0].y-PA.y)*vy) / v2));
                const proj = { x: PA.x + t*vx, y: PA.y + t*vy, z: updated[0].z };
                updateElement(element.id, { coordinates: [proj] });
              } else {
                updateElement(element.id, { coordinates: updated });
              }
            } else {
              const projectedVentPoint = projectVentPointToParent(updated[0] as any);
              updateElement(element.id, { coordinates: projectedVentPoint ? [projectedVentPoint] : updated });
            }
          }}
        >
          {isMvhrTerminal ? (
            (() => {
              const boxW = mvhrTerminalLabel === 'OUT' ? 34 : 28;
              const boxH = 18;
              const stroke = isSelected ? typeStroke : mvhrTerminalStyle?.stroke ?? typeStroke;
              return (
                <Group>
                  <Rect
                    x={-16}
                    y={-16}
                    width={32}
                    height={32}
                    fill="rgba(0,0,0,0.001)"
                    listening={isInteractive}
                  />
                  <Rect
                    x={-(boxW / 2)}
                    y={-(boxH / 2)}
                    width={boxW}
                    height={boxH}
                    fill="rgba(8, 28, 25, 0.96)"
                    stroke={stroke}
                    strokeWidth={isSelected ? 2.5 : 2}
                    cornerRadius={4}
                    listening={false}
                  />
                  <Text
                    x={-(boxW / 2)}
                    y={-(boxH / 2)}
                    width={boxW}
                    height={boxH}
                    text={mvhrTerminalLabel}
                    fontSize={10}
                    fontStyle="bold"
                    fill="#FFFFFF"
                    align="center"
                    verticalAlign="middle"
                    listening={false}
                  />
                </Group>
              );
            })()
          ) : (
            <Group scaleX={iconScale} scaleY={iconScale}>
              <Group x={-12} y={-12}>
              <Rect
                x={0}
                y={0}
                width={24}
                height={24}
                fill="rgba(0,0,0,0.001)"
                listening={isInteractive}
              />
              {lucideIconNodeToKonva(iconNode, {
                stroke: readRootCssVar('--canvas-label-text', '#ffffff'),
                strokeWidth: lucideStrokeW,
                keyPrefix: `${element.id}-pticon`,
                listening: false,
                hitStrokeWidth: 0,
                haloStroke: typeStroke,
                haloStrokeWidth: haloW,
              })}
              </Group>
            </Group>
          )}
        </Group>
        {/* Inline name removed for point elements; smart label will represent the name consistently */}
      </Group>
    );
  }

  // Render based on detected shape, with specializations per type when needed
  if (shape === 'line') {
    // Any element with 2-point coords renders as a line
    if (coordinates.length === 2) {
      const [start, end] = canvasCoords;
      const isThermalBridgeLine = element.type === 'ThermalBridgeLinear';
      const ductRoleStyle = element.type === 'MechanicalVentilationDuctwork'
        ? getMechanicalVentilationDuctworkRoleStyle(element as any)
        : null;
      const selectedThermalBridgeHaloStroke = isSelected && isThermalBridgeLine
        ? canvasElementPalette.selected
        : null;

      return (
        <Group
          key={element.id}
          opacity={opacity}
          visible={!categoryGhostOnCanvas}
          listening={isInteractive}
          onClick={isInteractive ? ((e) => {
            if ((geometryStore.getState() as any) && (geometryStore.getState() as any).selection) {
              // no-op
            }
            if (drawMode !== 'none') {
              // Allow draw mode to consume clicks on geometry: do not cancelBubble
              return;
            }
            e.cancelBubble = true;
            handleElementClick(element.id, e);
          }) : undefined}
          onDblClick={isInteractive ? ((e) => {
            e.cancelBubble = true;
            centerOnElement?.(element);
          }) : undefined}
          onMouseEnter={isInteractive ? (() => {
            if (isSelected) return;
            setElementHover?.(element.id);
          }) : undefined}
          onMouseLeave={isInteractive ? (() => {
            if (isSelected) return;
            setElementHover?.(null);
          }) : undefined}
        >
          {selectedThermalBridgeHaloStroke && (
            <Line
              points={[start.x, start.y, end.x, end.y]}
              stroke={selectedThermalBridgeHaloStroke}
              strokeWidth={10}
              opacity={0.92}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )}
          {/* Main line */}
          <Line
            name={`shape-${element.id}`}
            points={[start.x, start.y, end.x, end.y]}
            stroke={hoverStroke}
            strokeWidth={
              ductRoleStyle
                ? (isSelected ? 4 : ductRoleStyle.strokeWidth)
                : isThermalBridgeLine
                ? (isSelected ? 5 : (isHoveredFromMenu ? 5 : 4))
                : (isSelected ? 6 : (isHoveredFromMenu ? 5 : 4))
            }
            hitStrokeWidth={12}
            lineCap="round"
            lineJoin="round"
            dash={(() => {
              // Special line styles for different element types
              if (ductRoleStyle) return ductRoleStyle.dash.length > 0 ? [...ductRoleStyle.dash] : undefined;
              if (element.type === 'BuildingElementAdjacentConditionedSpace' ||
                        element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
                        element.type === 'BuildingElementPartyWall') {
                return [6, 3]; // Dashed for adjacent elements
              }
              return undefined; // Solid line for other elements
            })()}
            listening={isInteractive}
            onClick={isInteractive ? ((e) => {
              if (drawMode !== 'none') return; // let stage handle draw-mode clicks
              e.cancelBubble = true;
              handleElementClick(element.id, e);
            }) : undefined}
          />
          {isSelected
            && element.type === 'ThermalBridgeLinear'
            && resolveThermalBridgeLineMode(element as any) === 'slope'
            && (() => {
              const wz = (i: 0 | 1) => coordinates[i]?.z;
              return (
                <>
                  {renderTbSlopeZPill(start, formatTbZChipText('z1', wz(0)), `tb-zchip-${element.id}-0`)}
                  {renderTbSlopeZPill(end, formatTbZChipText('z2', wz(1)), `tb-zchip-${element.id}-1`)}
                </>
              );
            })()}

          {/* Labels will be rendered separately with smart positioning */}

          {/* Selection handles */}
          {showDirectSelectionHandles && (() => {
            const startSnapped = snappedVertices?.has(0) ?? false;
            const endSnapped = snappedVertices?.has(1) ?? false;
            const isOpening = element.type === 'BuildingElementTransparent';
            const isExternalDoorOpaque = element.type === 'BuildingElementOpaque' && (element as any).is_external_door === true;
            const parentAxisLocked = !isOpening && shouldSnapToParent(element) && !!(element as any).parent_element;
            // Openings: snap-to-wall feedback is on the centroid (GeometryCanvas), not the segment endpoints.
            // External doors: keep "on parent" emphasis at endpoints when parent is set.
            const snapTargetAtVertex =
              !isOpening && lineVertexDragHint && (lineVertexDragHint.wallSnap || lineVertexDragHint.vertexSnap)
                ? lineVertexDragHint
                : null;
            const startHandleBlue =
              startSnapped ||
              (isExternalDoorOpaque ? parentAxisLocked : false) ||
              (snapTargetAtVertex?.handle === 0 &&
                (snapTargetAtVertex.wallSnap || snapTargetAtVertex.vertexSnap));
            const endHandleBlue =
              endSnapped ||
              (isExternalDoorOpaque ? parentAxisLocked : false) ||
              (snapTargetAtVertex?.handle === 1 &&
                (snapTargetAtVertex.wallSnap || snapTargetAtVertex.vertexSnap));

            return (
              <>
                {showUnsnappedVertexGuidance && !startSnapped && renderUnsnappedVertexChip(start, 6, `unsnapped-chip-${element.id}-0`)}
                <Circle
                  name={`vertex-${element.id}-0`}
                  x={start.x}
                  y={start.y}
                  radius={6}
                  fill={startHandleBlue ? canvasInteractionPalette.snap : canvasInteractionPalette.handleFill}
                  stroke={startHandleBlue ? canvasInteractionPalette.handleStrokeOnSnap : canvasInteractionPalette.handleStroke}
                  strokeWidth={2}
                  draggable={!isReadOnlyDevelopmentContextShading}
                  onDragStart={(e) => {
                    beginVertexDrag();
                    setVertexDragState(
                      vertexSnapMode
                        ? buildVertexDragStateForElement({
                            element,
                            vertexIndex: 0,
                            elementsById,
                            currentFloorZ,
                            target: e.target,
                          })
                        : null,
                    );
                    beginActiveVertexPreview(e.target, 0);
                    clearLengthPillPreview(e.target);
                  }}
                dragBoundFunc={(pos) => {
                  return perfMeasure('dragBoundFunc-line-start', () => {
                  // Center-based snapping to nearest wall when no parent set
                  const world = canvasToWorld({ x: pos.x, y: pos.y }, scale, panOffset, canvasCenter);
                  const snapTol = (geometryStore.getState() as any).PROJECT_DEFAULTS?.snap_m || 0.1;
                  if (!(element as any).parent_element) {
                      const hit = perfMeasure('findNearestWallProjection-line-start', () =>
                        utilFindNearestWallProjectionFromCache(world, snapCache, element.id, snapTol)
                      );
                    if (hit) {
                      const canvas = worldToCanvas(hit.proj, scale, panOffset, canvasCenter);
                      return { x: canvas.x, y: canvas.y };
                    }
                    return pos;
                  }
                  // If already parented, keep axis projection visual during drag
                  if (shouldSnapToParent(element) && (element as any).parent_element) {
                    const parentId = nameToId[(element as any).parent_element as string];
                    const parent = parentId ? elementsById[parentId] : undefined;
                    if (!parent || !parent.coordinates || parent.coordinates.length !== 2) return pos;
                    const [PA, PB] = parent.coordinates as Array<{x:number,y:number,z:number}>;
                    const vx = PB.x - PA.x; const vy = PB.y - PA.y; const v2 = vx*vx + vy*vy || 1;
                    const t = Math.max(0, Math.min(1, ((world.x-PA.x)*vx + (world.y-PA.y)*vy) / v2));
                    const proj = { x: PA.x + t*vx, y: PA.y + t*vy };
                    const canvas = worldToCanvas(proj, scale, panOffset, canvasCenter);
                    return { x: canvas.x, y: canvas.y };
                  }
                  return pos;
                  });
                }}
                onDragMove={(e) => {
                  // IMPERATIVE DRAG: Update Konva nodes directly, no React re-renders!
                  const draggedNode = e.target;
                  const vertexDragState = getVertexDragState();

                  // Same snap pipeline as the end vertex, applied before either branch so the
                  // ghost matches what `onDragEnd` will commit.
                  const finalWorldPos = resolveLineVertexDragWorld(
                    canvasToWorld(draggedNode.position(), scale, panOffset, canvasCenter),
                    element,
                    0,
                    elementsById,
                    snapCache,
                    geometryStore,
                    { snapCorners: !!snapCorners, snapAngles: !!snapAngles },
                  );
                  const snappedCanvas = worldToCanvas(finalWorldPos, scale, panOffset, canvasCenter);
                  draggedNode.position({ x: snappedCanvas.x, y: snappedCanvas.y });
                  applyLineVertexSnapHint(0, { x: finalWorldPos.x, y: finalWorldPos.y });

                  // IMPERATIVE: Update connected nodes directly if vertex snap mode is active
                  if (vertexSnapMode && vertexDragState && vertexDragState.elementId === element.id && vertexDragState.vertexIndex === 0) {
                    updateVertexSnapPreview(vertexDragState, element, 0, finalWorldPos);
                    previewLineHostedDescendantsForVertexState(
                      draggedNode,
                      vertexDragState,
                      element,
                      0,
                      finalWorldPos,
                    );

                    // Draw the vertex/connected-shape preview once; the pill preview draws in its RAF.
                    const layer = draggedNode.getLayer();
                    layer?.batchDraw();

                    // Throttle pill calculations and update their Konva preview without a React parent render.
                    if (!pillUpdateRAF) {
                      pillUpdateRAF = requestAnimationFrame(() => {
                        pillUpdateRAF = null;
                        const vertexDragState = getVertexDragState();
                        if (!vertexDragState || vertexDragState.elementId !== element.id) return;

                        const currentWorld = canvasToWorld({ x: draggedNode.x(), y: draggedNode.y() }, scale, panOffset, canvasCenter);
                        const pills = buildVertexLengthPillsFromState(vertexDragState, element, currentWorld, elementsById);
                        vertexDragState.lengthPills = pills;
                        updateLengthPillPreview(draggedNode, pills);
                      });
                    }

                  } else {
                    // Normal drag: keep the shape visually in sync without invalidating the store per frame.
                    const updatedCoords = [...coordinates];
                    updatedCoords[0] = { ...updatedCoords[0], x: finalWorldPos.x, y: finalWorldPos.y };
                    let previewCoords = updatedCoords;
                    if (shouldSnapToParent(element) && (element as any).parent_element) {
                      const parentId = nameToId[(element as any).parent_element as string];
                      const parent = parentId ? elementsById[parentId] : undefined;
                      if (parent && parent.coordinates && parent.coordinates.length === 2) {
                        previewCoords = utilProjectSegmentOntoParent(updatedCoords as any, parent.coordinates as any) as any;
                      }
                    }
                      updateDraggedElementShapeFromCoords(
                        draggedNode,
                        element.id,
                        previewCoords,
                        scale,
                        panOffset,
                        canvasCenter,
                        element,
                      );
                    previewLineHostedDescendantsForCoords(draggedNode, element.id, previewCoords);
                  }
                }}
                onDragEnd={(e) => {
                  endVertexDrag();
                  setLineVertexDragHintIfChanged(null);
                  // IMPERATIVE DRAG END: Sync final positions from Konva nodes to store
                  const draggedNode = e.target;
                  let newWorld = canvasToWorld({x: draggedNode.x(), y: draggedNode.y()}, scale, panOffset, canvasCenter);
                  const snapTol = getProjectDefaults(geometryStore).snapTol;

                  // Re-snap on drop for precision with precedence: perp-to-wall (infinite) -> corner -> angle
                  if (!(shouldSnapToParent(element) && (element as any).parent_element)) {
                    const other = { x: coordinates[1].x, y: coordinates[1].y };
                    const perp = perfMeasure('findPerpFootOnWallInfinite-line-start', () =>
                      utilFindPerpFootOnWallInfiniteFromCache(other as any, newWorld as any, snapCache, element.id, snapTol)
                    );
                    if (perp) {
                      newWorld = perp.foot as any;
                    } else if (snapCorners) {
                      const best = perfMeasure('snapCornerToOtherCorners-onDragEnd-line-start', () =>
                        findCornerVertexSnapTarget(element, 0, newWorld, elementsById, snapCache, snapTol)
                      );
                      if (best) newWorld = best as any;
                      else {
                        const res = utilApplyAngleSnapIfClose(newWorld as any, other as any, getProjectDefaults(geometryStore).angleTol);
                        newWorld = res.point as any;
                      }
                    } else {
                      const res = utilApplyAngleSnapIfClose(newWorld as any, other as any, getProjectDefaults(geometryStore).angleTol);
                      newWorld = res.point as any;
                    }
                    newWorld = applyPlanVertexRightAngleSnap(
                      { x: (newWorld as { x: number }).x, y: (newWorld as { y: number }).y },
                      element,
                      0,
                      elementsById,
                      geometryStore,
                    ) as any;
                  } else {
                    if (snapCorners) {
                      const best = perfMeasure('snapCornerToOtherCorners-onDragEnd-line-start-parented', () =>
                        findCornerVertexSnapTarget(element, 0, newWorld, elementsById, snapCache, snapTol)
                      );
                      if (best) newWorld = best as any;
                    }
                  }

                  // Update dragged node position if snapped
                  const finalCanvasPos = worldToCanvas(newWorld, scale, panOffset, canvasCenter);
                  draggedNode.position({ x: finalCanvasPos.x, y: finalCanvasPos.y });
                  const vertexDragState = getVertexDragState();

                  if (vertexSnapMode && vertexDragState && vertexDragState.elementId === element.id && vertexDragState.vertexIndex === 0) {
                    recordVertexDragWorldPosition(element.id, 0, newWorld, coordinates[0]?.z ?? 0, elementsById);
                    finalizeVertexDragFromState(commitVertexPositionUpdates, () => clearLengthPillPreview(draggedNode));
                  } else {
                    // Normal update (no snap mode): Sync dragged node position to store
                    const finalNodePos = draggedNode.position();
                    const finalWorldPos = canvasToWorld({ x: finalNodePos.x, y: finalNodePos.y }, scale, panOffset, canvasCenter);
                  const updatedCoords = [...coordinates];
                    updatedCoords[0] = { ...updatedCoords[0], x: finalWorldPos.x, y: finalWorldPos.y };

                  let finalCoords = updatedCoords;
                  if (shouldSnapToParent(element) && (element as any).parent_element) {
                    const parentId = nameToId[(element as any).parent_element as string];
                    const parent = parentId ? elementsById[parentId] : undefined;
                    if (parent && parent.coordinates && parent.coordinates.length === 2) {
                      finalCoords = utilProjectSegmentOntoParent(updatedCoords as any, parent.coordinates as any) as any;
                    }
                  }
                  updateElement(element.id, { coordinates: finalCoords });
                  }

                  cleanupVertexInteractionAfterDragEnd(draggedNode);
                }}
              />
                {showUnsnappedVertexGuidance && !endSnapped && renderUnsnappedVertexChip(end, 6, `unsnapped-chip-${element.id}-1`)}
                <Circle
                  name={`vertex-${element.id}-1`}
                  x={end.x}
                  y={end.y}
                  radius={6}
                  fill={endHandleBlue ? canvasInteractionPalette.snap : canvasInteractionPalette.handleFill}
                  stroke={endHandleBlue ? canvasInteractionPalette.handleStrokeOnSnap : canvasInteractionPalette.handleStroke}
                  strokeWidth={2}
                  draggable={!isReadOnlyDevelopmentContextShading}
                  onDragStart={(e) => {
                    beginVertexDrag();
                    setVertexDragState(
                      vertexSnapMode
                        ? buildVertexDragStateForElement({
                            element,
                            vertexIndex: 1,
                            elementsById,
                            currentFloorZ,
                            target: e.target,
                          })
                        : null,
                    );
                    beginActiveVertexPreview(e.target, 1);
                    clearLengthPillPreview(e.target);
                  }}
                dragBoundFunc={(pos) => {
                  return perfMeasure('dragBoundFunc-line-end', () => {
                  const world = canvasToWorld({ x: pos.x, y: pos.y }, scale, panOffset, canvasCenter);
                  const snapTol = (geometryStore.getState() as any).PROJECT_DEFAULTS?.snap_m || 0.1;
                  if (!(element as any).parent_element) {
                      const hit = perfMeasure('findNearestWallProjection-line-end', () =>
                        utilFindNearestWallProjectionFromCache(world, snapCache, element.id, snapTol)
                      );
                    if (hit) {
                      const canvas = worldToCanvas(hit.proj, scale, panOffset, canvasCenter);
                      return { x: canvas.x, y: canvas.y };
                    }
                    return pos;
                  }
                  if (shouldSnapToParent(element) && (element as any).parent_element) {
                    const parentId = nameToId[(element as any).parent_element as string];
                    const parent = parentId ? elementsById[parentId] : undefined;
                    if (!parent || !parent.coordinates || parent.coordinates.length !== 2) return pos;
                    const [PA, PB] = parent.coordinates as Array<{x:number,y:number,z:number}>;
                    const vx = PB.x - PA.x; const vy = PB.y - PA.y; const v2 = vx*vx + vy*vy || 1;
                    const t = Math.max(0, Math.min(1, ((world.x-PA.x)*vx + (world.y-PA.y)*vy) / v2));
                    const proj = { x: PA.x + t*vx, y: PA.y + t*vy };
                    const canvas = worldToCanvas(proj, scale, panOffset, canvasCenter);
                    return { x: canvas.x, y: canvas.y };
                  }
                  return pos;
                  });
                }}
                onDragMove={(e) => {
                  return perfMeasure('onDragMove-line-end', () => {
                    // IMPERATIVE DRAG: Update Konva nodes directly, no React re-renders!
                    const draggedNode = e.target;
                    const vertexDragState = getVertexDragState();

                    // Same snap pipeline as the start vertex.
                    const newWorld = resolveLineVertexDragWorld(
                      canvasToWorld(draggedNode.position(), scale, panOffset, canvasCenter),
                      element,
                      1,
                      elementsById,
                      snapCache,
                      geometryStore,
                      { snapCorners: !!snapCorners, snapAngles: !!snapAngles },
                    );
                    const snappedCanvas = worldToCanvas(newWorld, scale, panOffset, canvasCenter);
                    draggedNode.position({ x: snappedCanvas.x, y: snappedCanvas.y });
                    applyLineVertexSnapHint(1, { x: newWorld.x, y: newWorld.y });

                  // IMPERATIVE: Update connected nodes directly if vertex snap mode is active
                  if (vertexSnapMode && vertexDragState && vertexDragState.elementId === element.id && vertexDragState.vertexIndex === 1) {
                    const finalWorldPos = newWorld;

                    updateVertexSnapPreview(vertexDragState, element, 1, finalWorldPos);
                    previewLineHostedDescendantsForVertexState(
                      draggedNode,
                      vertexDragState,
                      element,
                      1,
                      finalWorldPos,
                    );

                    const pills = buildVertexLengthPillsFromState(vertexDragState, element, finalWorldPos, elementsById);
                    vertexDragState.lengthPills = pills;
                    updateLengthPillPreview(draggedNode, pills);


                    // Single batchDraw() call at the end (removed redundant calls)
                    const layer = draggedNode.getLayer();
                    layer?.batchDraw();
                  } else {
                    // Normal drag: keep the shape visually in sync without invalidating the store per frame.
                    const updatedCoords = [...coordinates];
                  updatedCoords[1] = { ...updatedCoords[1], x: newWorld.x, y: newWorld.y };
                  let previewCoords = updatedCoords;
                  if (shouldSnapToParent(element) && (element as any).parent_element) {
                    const parentId = nameToId[(element as any).parent_element as string];
                    const parent = parentId ? elementsById[parentId] : undefined;
                    if (parent && parent.coordinates && parent.coordinates.length === 2) {
                      previewCoords = utilProjectSegmentOntoParent(updatedCoords as any, parent.coordinates as any) as any;
                    }
                  }
                    updateDraggedElementShapeFromCoords(
                      draggedNode,
                      element.id,
                      previewCoords,
                      scale,
                      panOffset,
                      canvasCenter,
                      element,
                    );
                    previewLineHostedDescendantsForCoords(draggedNode, element.id, previewCoords);
                  }
                  });
                }}
                onDragEnd={(e) => {
                  endVertexDrag();
                  setLineVertexDragHintIfChanged(null);
                  // IMPERATIVE DRAG END: Sync final positions from Konva nodes to store
                  const draggedNode = e.target;
                  let newWorld = canvasToWorld({x: draggedNode.x(), y: draggedNode.y()}, scale, panOffset, canvasCenter);
                  const snapTol = getProjectDefaults(geometryStore).snapTol;

                  // Re-snap on drop for precision with precedence: perp-to-wall (infinite) -> corner -> angle
                  if (!(shouldSnapToParent(element) && (element as any).parent_element)) {
                    const other = { x: coordinates[0].x, y: coordinates[0].y };
                    const perp = utilFindPerpFootOnWallInfiniteFromCache(other as any, newWorld as any, snapCache, element.id, snapTol);
                    if (perp) {
                      newWorld = perp.foot as any;
                    } else if (snapCorners) {
                      const best = findCornerVertexSnapTarget(element, 1, newWorld, elementsById, snapCache, snapTol);
                      if (best) newWorld = best as any;
                      else {
                        const res = utilApplyAngleSnapIfClose(newWorld as any, other as any, getProjectDefaults(geometryStore).angleTol);
                        newWorld = res.point as any;
                      }
                    } else {
                      const res = utilApplyAngleSnapIfClose(newWorld as any, other as any, getProjectDefaults(geometryStore).angleTol);
                      newWorld = res.point as any;
                    }
                    newWorld = applyPlanVertexRightAngleSnap(
                      { x: (newWorld as { x: number }).x, y: (newWorld as { y: number }).y },
                      element,
                      1,
                      elementsById,
                      geometryStore,
                    ) as any;
                  } else {
                    if (snapCorners) {
                      const best = findCornerVertexSnapTarget(element, 1, newWorld, elementsById, snapCache, snapTol);
                      if (best) newWorld = best as any;
                    }
                  }

                  // Update dragged node position if snapped
                  const finalCanvasPos = worldToCanvas(newWorld, scale, panOffset, canvasCenter);
                  draggedNode.position({ x: finalCanvasPos.x, y: finalCanvasPos.y });
                  const vertexDragState = getVertexDragState();

                  if (vertexSnapMode && vertexDragState && vertexDragState.elementId === element.id && vertexDragState.vertexIndex === 1) {
                    recordVertexDragWorldPosition(element.id, 1, newWorld, coordinates[1]?.z ?? 0, elementsById);
                    finalizeVertexDragFromState(commitVertexPositionUpdates, () => clearLengthPillPreview(draggedNode));
                  } else {
                    // Normal update (no snap mode): Sync dragged node position to store
                    const finalNodePos = draggedNode.position();
                    const finalWorldPos = canvasToWorld({ x: finalNodePos.x, y: finalNodePos.y }, scale, panOffset, canvasCenter);
                  const updatedCoords = [...coordinates];
                    updatedCoords[1] = { ...updatedCoords[1], x: finalWorldPos.x, y: finalWorldPos.y };

                  let finalCoords = updatedCoords;
                  if (shouldSnapToParent(element) && (element as any).parent_element) {
                    const parentId = nameToId[(element as any).parent_element as string];
                    const parent = parentId ? elementsById[parentId] : undefined;
                    if (parent && parent.coordinates && parent.coordinates.length === 2) {
                      finalCoords = utilProjectSegmentOntoParent(updatedCoords as any, parent.coordinates as any) as any;
                    }
                  }
                  updateElement(element.id, { coordinates: finalCoords });
                  }

                  cleanupVertexInteractionAfterDragEnd(draggedNode);
                }}
              />
              </>
            );
          })()}

          {/* Direction arrow for line elements with orientation360 */}
          {(() => {
            const directionArrow = calculateDirectionArrow(element);
            if (!directionArrow) return null;

            // Convert world coordinates to canvas coordinates
            const centerCanvas = worldToCanvas({ x: directionArrow.centerX, y: directionArrow.centerY }, scale, panOffset, canvasCenter);
            const arrowCanvas = worldToCanvas({ x: directionArrow.arrowX, y: directionArrow.arrowY }, scale, panOffset, canvasCenter);

            // Calculate arrowhead points
            const arrowPoints = calculateArrowPoints({
              centerX: centerCanvas.x,
              centerY: centerCanvas.y,
              arrowX: arrowCanvas.x,
              arrowY: arrowCanvas.y,
              orientation: directionArrow.orientation
            });

            return (
              <>
                {/* Arrow line */}
                <Line
                  name={`arrow-line-${element.id}`}
                  points={[centerCanvas.x, centerCanvas.y, arrowCanvas.x, arrowCanvas.y]}
                  stroke={elementColor}
                  strokeWidth={isSelected ? 3 : 2}
                  lineCap="round"
                  listening={false}
                />

                {/* Arrowhead */}
                <Line
                  name={`arrow-head-${element.id}`}
                  points={[
                    arrowPoints.tip.x, arrowPoints.tip.y,
                    arrowPoints.left.x, arrowPoints.left.y,
                    arrowPoints.tip.x, arrowPoints.tip.y,
                    arrowPoints.right.x, arrowPoints.right.y
                  ]}
                  stroke={elementColor}
                  strokeWidth={isSelected ? 3 : 2}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              </>
            );
          })()}
        </Group>
      );
    }
  } else if (shape === 'polygon') {
    // Any polygon-capable element renders as polygon when it has 3+ points
    if (coordinates.length >= 3) {
      return (
        <Group
          key={element.id}
          opacity={opacity}
          visible={!categoryGhostOnCanvas}
          listening={isInteractive}
          onClick={isInteractive ? ((e) => {
            if (drawMode !== 'none') return; // let stage consume when drawing
            e.cancelBubble = true;
            handleElementClick(element.id, e);
          }) : undefined}
          onDblClick={isInteractive ? ((e) => {
            e.cancelBubble = true;
            centerOnElement?.(element);
          }) : undefined}
          onMouseEnter={isInteractive ? (() => {
            if (isSelected) return;
            setElementHover?.(element.id);
          }) : undefined}
          onMouseLeave={isInteractive ? (() => {
            if (isSelected) return;
            setElementHover?.(null);
          }) : undefined}
        >
          {dormerCutoutCanvasPolygons.map((polygon, index) => (
            <Line
              key={`dormer-cutout-${element.id}-${index}`}
              points={polygon.flatMap((point) => [point.x, point.y])}
              closed
              stroke={canvasInteractionPalette.dormerGuide}
              strokeWidth={2}
              dash={[8, 5]}
              opacity={0.95}
              listening={false}
            />
          ))}
          {/* Polygon fill - clickable for selection (especially important for floors) */}
          <Line
            name={`shape-${element.id}`}
            points={canvasCoords.flatMap(coord => [coord.x, coord.y])}
            stroke={hoverStroke}
            strokeWidth={isSelected ? 3 : (isHoveredFromMenu ? 3 : 2)}
            closed={true}
            fill={elementFill}
            opacity={typeColor.fill ? 1 : 0.3}
            listening={isInteractive}
            dash={(() => {
              // Special line styles for different element types
              if (element.type === 'BuildingElementAdjacentConditionedSpace' ||
                        element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
                        element.type === 'BuildingElementPartyWall') {
                return [6, 3]; // Dashed for adjacent elements
              }
              return undefined; // Solid line for other elements
            })()}
            onClick={isInteractive ? ((e) => {
              if (drawMode !== 'none') return; // draw mode: let stage process
              e.cancelBubble = true;
              handleElementClick(element.id, e);
            }) : undefined}
          />
          {/* Polygon stroke - non-interactive, Group onClick handles selection */}
          <Line
            name={`shape-stroke-${element.id}`}
            points={canvasCoords.flatMap(coord => [coord.x, coord.y])}
            stroke={elementColor}
            strokeWidth={isSelected ? 3 : 2}
            closed={true}
            fill={undefined}
            listening={false}
            dash={(() => {
              // Special line styles for different element types
              if (element.type === 'BuildingElementAdjacentConditionedSpace' ||
                        element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
                        element.type === 'BuildingElementPartyWall') {
                return [6, 3]; // Dashed for adjacent elements
              }
              return undefined; // Solid line for other elements
            })()}
          />

          {/* Labels will be rendered separately with smart positioning */}

          {/* Selection handles for each coordinate */}
          {isSelected && canvasCoords.map((coord, index) => {
            const isVertexSelected = selectedVertex?.elementId === element.id && selectedVertex?.vertexIndex === index;
            const isSnapped = snappedVertices?.has(index) ?? false;
            const isHostedPolygonOpening =
              element.type === 'BuildingElementTransparent' &&
              !!(element as { parent_element?: string | null }).parent_element &&
              coordinates.length >= 3;
            const isHandleHostSnapped = isSnapped || isHostedPolygonOpening;
            const handleRadius = isVertexSelected ? 6 : 4;

            return (
              <React.Fragment key={index}>
                {showUnsnappedVertexGuidance && !isHandleHostSnapped && renderUnsnappedVertexChip(coord, handleRadius, `unsnapped-chip-${element.id}-${index}`)}
                <Circle
                  name={`vertex-${element.id}-${index}`}
                  x={coord.x}
                  y={coord.y}
                  radius={handleRadius}
                  fill={isHandleHostSnapped ? canvasInteractionPalette.snap : canvasInteractionPalette.handleFill}
                  stroke={isHandleHostSnapped ? canvasInteractionPalette.handleStrokeOnSnap : canvasInteractionPalette.handleStroke}
                  strokeWidth={isVertexSelected ? 3 : 2}
                  draggable={!isReadOnlyDevelopmentContextShading}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    setSelectedVertex?.({ elementId: element.id, vertexIndex: index });
                  }}
                  onDragStart={(e) => {
                    beginVertexDrag();
                    setVertexDragState(
                      vertexSnapMode
                        ? buildVertexDragStateForElement({
                            element,
                            vertexIndex: index,
                            elementsById,
                            currentFloorZ,
                            target: e.target,
                          })
                        : null,
                    );
                    beginActiveVertexPreview(e.target, index);
                    clearLengthPillPreview(e.target);
                  }}
                onDragMove={(e) => {
                  return perfMeasure('onDragMove-polygon-vertex', () => {
                    // IMPERATIVE DRAG: Update Konva nodes directly, no React re-renders!
                    const draggedNode = e.target;
                    const newCanvasPos = { x: draggedNode.x(), y: draggedNode.y() };
                    let newWorld = canvasToWorld(newCanvasPos, scale, panOffset, canvasCenter);
                    const vertexDragState = getVertexDragState();

                    // Corner-to-corner snapping to any other element's corners
                  const snapTol = (geometryStore.getState() as any).PROJECT_DEFAULTS?.snap_m || 0.1;
                    let didSnap = perfMeasure('snapCornerToOtherCorners-polygon-inline', () => {
                  const best = utilSnapCornerToOtherCornersFromCache(
                    newWorld,
                    element.id,
                    snapCache,
                    snapTol,
                    { minDistance: 1e-6 },
                  );
                      if (best) {
                        newWorld = best as {x:number,y:number};
                        const snappedCanvas = worldToCanvas(newWorld, scale, panOffset, canvasCenter);
                        draggedNode.position({ x: snappedCanvas.x, y: snappedCanvas.y });
                        return true;
                      }
                      return false;
                    });

                    let didWallSegmentSnap = false;
                    if (!didSnap) {
                      const wallTarget = findWallSegmentVertexSnapTarget(
                        element,
                        index,
                        newWorld,
                        elementsById,
                        snapCache,
                        snapTol,
                      );
                      if (wallTarget) {
                        newWorld = wallTarget;
                        didSnap = true;
                        didWallSegmentSnap = true;
                        const snappedCanvas = worldToCanvas(newWorld, scale, panOffset, canvasCenter);
                        draggedNode.position({ x: snappedCanvas.x, y: snappedCanvas.y });
                      }
                    }

                    if (!didWallSegmentSnap) {
                      const rightWorld = applyPlanVertexRightAngleSnap(
                        { x: newWorld.x, y: newWorld.y },
                        element,
                        index,
                        elementsById,
                        geometryStore,
                      );
                      if (rightWorld.x !== newWorld.x || rightWorld.y !== newWorld.y) {
                        newWorld = rightWorld;
                        didSnap = true;
                        const snappedCanvas = worldToCanvas(newWorld, scale, panOffset, canvasCenter);
                        draggedNode.position({ x: snappedCanvas.x, y: snappedCanvas.y });
                      }
                    }

                    // Visual: change handle color while snapped (no batchDraw here - will batch at end)
                    try {
                      const circleNode = draggedNode as any;
                      circleNode.fill(didSnap ? canvasInteractionPalette.snap : canvasInteractionPalette.handleFill);
                    } catch { /* swallow: best-effort */ }

                    // IMPERATIVE: Update connected nodes directly if vertex snap mode is active
                    if (vertexSnapMode && vertexDragState && vertexDragState.elementId === element.id && vertexDragState.vertexIndex === index) {
                      const finalCanvasPos = draggedNode.position();
                      const finalWorldPos = canvasToWorld(
                        { x: finalCanvasPos.x, y: finalCanvasPos.y },
                        scale,
                        panOffset,
                        canvasCenter,
                      );

                      updateVertexSnapPreview(vertexDragState, element, index, finalWorldPos);


                      // Single batchDraw() call at the end (removed redundant calls)
                      const layer = draggedNode.getLayer();
                      layer?.batchDraw();
                    } else {
                      // Normal drag: keep the polygon visually in sync without invalidating the store per frame.
                  const updatedCoords = [...coordinates];
                  updatedCoords[index] = { ...updatedCoords[index], x: newWorld.x, y: newWorld.y };

                  // Auto-calculate angles and distance for ContextShading with parent
                  if (element.type === 'ContextShading' && (element as any).parent_element) {
                    const parentElement = elementIds
                .map(id => elementsById[id])
                .find(el => el && el.name === (element as any).parent_element);
                    if (parentElement) {
                      const { calculateShadingAngularRange, calculateContextShadingDistance } = geometryStore.getState();
                      const { start_angle, end_angle } = calculateShadingAngularRange(
                        { ...element, coordinates: updatedCoords },
                        parentElement,
                        geometryStore.getState().globalOrientationOffset,
                      );
                      const distance = calculateContextShadingDistance({ ...element, coordinates: updatedCoords }, parentElement);
                      e.target.setAttr('__vulcanPendingDragUpdates', { start_angle, end_angle, distance });
                    } else {
                      e.target.setAttr('__vulcanPendingDragUpdates', null);
                    }
                  } else {
                    e.target.setAttr('__vulcanPendingDragUpdates', null);
                  }
                    updateDraggedElementShapeFromCoords(
                      draggedNode,
                      element.id,
                      updatedCoords,
                      scale,
                      panOffset,
                      canvasCenter,
                      element,
                    );
                    }
                  });
                }}
                onDragEnd={(e) => {
                  endVertexDrag();
                  // IMPERATIVE DRAG END: Sync final positions from Konva nodes to store
                  const draggedNode = e.target;
                  try {
                    const circleNode = draggedNode as any;
                    circleNode.fill(canvasInteractionPalette.handleFill);
                    // No batchDraw here - will be handled by store update or final sync
                  } catch { /* swallow: best-effort */ }

                  let newWorld = canvasToWorld({x: draggedNode.x(), y: draggedNode.y()}, scale, panOffset, canvasCenter);
                  // Re-snap on drop for precision
                  const snapTol = getProjectDefaults(geometryStore).snapTol;
                  const best = utilSnapCornerToOtherCornersFromCache(newWorld, element.id, snapCache, snapTol);
                  let didWallSegmentSnap = false;
                  if (best) {
                    newWorld = best;
                  } else {
                    const wallTarget = findWallSegmentVertexSnapTarget(
                      element,
                      index,
                      newWorld,
                      elementsById,
                      snapCache,
                      snapTol,
                    );
                    if (wallTarget) {
                      newWorld = wallTarget;
                      didWallSegmentSnap = true;
                    }
                  }
                  if (!didWallSegmentSnap) {
                    newWorld = applyPlanVertexRightAngleSnap(
                      { x: newWorld.x, y: newWorld.y },
                      element,
                      index,
                      elementsById,
                      geometryStore,
                    );
                  }

                  const finalCanvasPos = worldToCanvas(newWorld, scale, panOffset, canvasCenter);
                  draggedNode.position({ x: finalCanvasPos.x, y: finalCanvasPos.y });
                  const vertexDragState = getVertexDragState();

                  if (vertexSnapMode && vertexDragState && vertexDragState.elementId === element.id && vertexDragState.vertexIndex === index) {
                    recordVertexDragWorldPosition(element.id, index, newWorld, coordinates[index]?.z ?? 0, elementsById);
                    finalizeVertexDragFromState(commitVertexPositionUpdates, () => clearLengthPillPreview(draggedNode));
                  } else {
                    // Normal update (no snap mode): Sync dragged node position to store
                    const finalNodePos = draggedNode.position();
                    const finalWorldPos = canvasToWorld({ x: finalNodePos.x, y: finalNodePos.y }, scale, panOffset, canvasCenter);
                  const updated = [...coordinates];
                    updated[index] = { ...updated[index], x: finalWorldPos.x, y: finalWorldPos.y };

                  // Auto-calculate angles and distance for ContextShading with parent
                  if (element.type === 'ContextShading' && (element as any).parent_element) {
                    const parentElement = elementIds
                .map(id => elementsById[id])
                .find(el => el && el.name === (element as any).parent_element);
                    if (parentElement) {
                      const { calculateShadingAngularRange, calculateContextShadingDistance } = geometryStore.getState();
                      const { start_angle, end_angle } = calculateShadingAngularRange(
                        { ...element, coordinates: updated },
                        parentElement,
                        geometryStore.getState().globalOrientationOffset,
                      );
                      const distance = calculateContextShadingDistance({ ...element, coordinates: updated }, parentElement);
                      updateElement(element.id, { coordinates: updated, start_angle, end_angle, distance });
                    } else {
                      updateElement(element.id, { coordinates: updated });
                    }
                  } else {
                    updateElement(element.id, { coordinates: updated });
                  }
                  }

                  cleanupVertexInteractionAfterDragEnd(draggedNode);
                  }}
                />
              </React.Fragment>
            );
          })}

          {/* ContextShading Visual Arc */}
          {isSelected && element.type === 'ContextShading' && (element as any).parent_element && (
            (() => {
              const contextShading = elementsById[element.id] as any; // Get current element data from store
              const parentElement = elementIds
                .map(id => elementsById[id])
                .find(el => el && el.name === contextShading.parent_element);
              if (!parentElement || !parentElement.coordinates) return null;

              // Calculate parent center
              const parentCoords = parentElement.coordinates;
              const parentCenter = {
                x: parentCoords.reduce((sum: number, coord: any) => sum + coord.x, 0) / parentCoords.length,
                y: parentCoords.reduce((sum: number, coord: any) => sum + coord.y, 0) / parentCoords.length
              };
              const parentCenterCanvas = worldToCanvas(parentCenter, scale, panOffset, canvasCenter);

              // Calculate ContextShading center using current coordinates (real-time during drag)
              const contextCenter = {
                x: coordinates.reduce((sum: number, coord: any) => sum + coord.x, 0) / coordinates.length,
                y: coordinates.reduce((sum: number, coord: any) => sum + coord.y, 0) / coordinates.length
              };
              const contextCenterCanvas = worldToCanvas(contextCenter, scale, panOffset, canvasCenter);

              // Calculate distance
              const distance = Math.hypot(contextCenter.x - parentCenter.x, contextCenter.y - parentCenter.y);

              // Calculate angles in real-time using current coordinates
              const { calculateShadingAngularRange } = geometryStore.getState();
              const { start_angle, end_angle } = calculateShadingAngularRange({ ...element, coordinates }, parentElement);

              // Use raw azimuth for geometry (visual arc should reflect real-world position)
              // Convert azimuth (0°=N) to canvas angle (0°=E) by rotating -90° (+270°)
              const canvasStartDeg = (start_angle + 270) % 360;
              let canvasEndDeg = (end_angle + 270) % 360;
              // Normalize sweep so end >= start for rendering a positive arc
              if (canvasEndDeg < canvasStartDeg) canvasEndDeg += 360;
              const startAngleRad = (canvasStartDeg * Math.PI) / 180;
              const endAngleRad = (canvasEndDeg * Math.PI) / 180;

              const maxDistance = Math.max(...coordinates.map((coord: any) =>
                Math.hypot(coord.x - parentCenter.x, coord.y - parentCenter.y)
              ));

              // Match worldToCanvas' metres-to-pixels scale.
              const arcRadius = maxDistance * 50 * scale;

              // Calculate start and end points of the arc.
              const startX = parentCenterCanvas.x + Math.cos(startAngleRad) * arcRadius;
              const startY = parentCenterCanvas.y + Math.sin(startAngleRad) * arcRadius;
              const endX = parentCenterCanvas.x + Math.cos(endAngleRad) * arcRadius;
              const endY = parentCenterCanvas.y + Math.sin(endAngleRad) * arcRadius;

              // Debug logs removed

              return (
                <Group key={`context-shading-arc-${element.id}`}>
                  {/* Parent center highlight */}
                  <Circle
                    x={parentCenterCanvas.x}
                    y={parentCenterCanvas.y}
                    radius={8}
                    fill={canvasInteractionPalette.guideFill}
                    stroke={canvasInteractionPalette.guide}
                    strokeWidth={2}
                    listening={false}
                  />

                  {/* Reference lines at start/end angles */}
                  <Line
                    points={[parentCenterCanvas.x, parentCenterCanvas.y, startX, startY]}
                    stroke="var(--error-text)"
                    strokeWidth={4}
                    dash={[10, 5]}
                    listening={false}
                  />
                  <Line
                    points={[parentCenterCanvas.x, parentCenterCanvas.y, endX, endY]}
                    stroke="var(--error-text)"
                    strokeWidth={4}
                    dash={[10, 5]}
                    listening={false}
                  />

                  {/* Shading arc segment - simple arc between start and end angles */}
                  {(() => {
                    const arcPoints = [];
                    const numSegments = Math.max(16, Math.abs(endAngleRad - startAngleRad) * 20);
                    for (let i = 0; i <= numSegments; i++) {
                      const angle = startAngleRad + (endAngleRad - startAngleRad) * (i / numSegments);
                      const x = parentCenterCanvas.x + Math.cos(angle) * arcRadius;
                      const y = parentCenterCanvas.y + Math.sin(angle) * arcRadius;
                      arcPoints.push(x, y);
                    }
                    return (
                      <Line
                        points={arcPoints}
                        stroke={canvasInteractionPalette.guide}
                        strokeWidth={8}
                        lineCap="round"
                        lineJoin="round"
                        listening={false}
                      />
                    );
                  })()}

                  {/* Distance line to ContextShading center */}
                  <Line
                    points={[parentCenterCanvas.x, parentCenterCanvas.y, contextCenterCanvas.x, contextCenterCanvas.y]}
                    stroke={canvasInteractionPalette.guide}
                    strokeWidth={2}
                    dash={[5, 5]}
                    listening={false}
                  />

                  {/* Distance label */}
                  <Text
                    x={parentCenterCanvas.x + 15}
                    y={parentCenterCanvas.y - 15}
                    text={`${distance.toFixed(1)}m`}
                    fontSize={12}
                    fill={canvasInteractionPalette.guide}
                    fontStyle="bold"
                    listening={false}
                  />
                </Group>
              );
            })()
          )}

        </Group>
      );
    }
  } else if (shape === 'sloped-polygon') {
    // Sloped polygon rendering: solid bottom edge + dashed slope edges + orientation arrow
    if (coordinates.length >= 3) {
      // First two coordinates define the bottom edge
      const bottomEdgeCoords = canvasCoords.slice(0, 2);
      const slopeEdgeCoords = canvasCoords.slice(2);

      return (
        <Group key={element.id}
          opacity={opacity}
          visible={!categoryGhostOnCanvas}
          listening={isInteractive}
          onClick={isInteractive ? (e) => {
            if (drawMode !== 'none') return; // let stage consume when drawing
            e.cancelBubble = true;
            handleElementClick(element.id, e);
          } : undefined}
          onDblClick={isInteractive ? (e) => { e.cancelBubble = true; centerOnElement?.(element); } : undefined}
        >
          {dormerCutoutCanvasPolygons.map((polygon, index) => (
            <Line
              key={`dormer-cutout-${element.id}-${index}`}
              points={polygon.flatMap((point) => [point.x, point.y])}
              closed
              stroke={canvasInteractionPalette.dormerGuide}
              strokeWidth={2}
              dash={[8, 5]}
              opacity={0.95}
              listening={false}
            />
          ))}
          {/* Polygon fill */}
          <Line
            name={`shape-${element.id}`}
            points={canvasCoords.flatMap(coord => [coord.x, coord.y])}
            stroke={hoverStroke}
            strokeWidth={isSelected ? 3 : (isHoveredFromMenu ? 3 : 2)}
            closed={true}
            fill={elementFill}
            opacity={typeColor.fill ? 1 : 0.3}
            onClick={(e) => {
              if (drawMode !== 'none') return; // draw mode: let stage process
              e.cancelBubble = true;
              handleElementClick(element.id, e);
            }}
          />

          {/* Solid bottom edge (first two coordinates) */}
          <Line
            name={`slope-bottom-${element.id}`}
            points={bottomEdgeCoords.flatMap(coord => [coord.x, coord.y])}
            stroke={elementColor}
            strokeWidth={isSelected ? 4 : 3}
            onClick={(e) => {
              if (drawMode !== 'none') return;
              e.cancelBubble = true;
              handleElementClick(element.id, e);
            }}
          />

          {/* Dashed slope edges (remaining coordinates) */}
          {slopeEdgeCoords.length > 0 && (
            <Line
              name={`slope-edges-${element.id}`}
              points={[...bottomEdgeCoords.slice(-1), ...slopeEdgeCoords, bottomEdgeCoords[0]].flatMap(coord => [coord.x, coord.y])}
              stroke={elementColor}
              strokeWidth={isSelected ? 3 : 2}
              dash={[6, 3]}
              onClick={(e) => {
                if (drawMode !== 'none') return;
                e.cancelBubble = true;
                handleElementClick(element.id, e);
              }}
            />
          )}

          {/* Orientation arrow on bottom edge */}
          {(() => {
            const directionArrow = calculateDirectionArrow(element);
            if (!directionArrow) return null;

            // Convert world coordinates to canvas coordinates
            const centerCanvas = worldToCanvas({ x: directionArrow.centerX, y: directionArrow.centerY }, scale, panOffset, canvasCenter);
            const arrowCanvas = worldToCanvas({ x: directionArrow.arrowX, y: directionArrow.arrowY }, scale, panOffset, canvasCenter);

            // Calculate arrowhead points
            const arrowPoints = calculateArrowPoints({
              centerX: centerCanvas.x,
              centerY: centerCanvas.y,
              arrowX: arrowCanvas.x,
              arrowY: arrowCanvas.y,
              orientation: directionArrow.orientation
            });

            return (
              <>
                {/* Arrow line */}
                <Line
                  name={`arrow-line-${element.id}`}
                  points={[centerCanvas.x, centerCanvas.y, arrowCanvas.x, arrowCanvas.y]}
                  stroke={elementColor}
                  strokeWidth={isSelected ? 3 : 2}
                  listening={false}
                />

                {/* Arrowhead */}
                <Line
                  name={`arrow-head-${element.id}`}
                  points={[
                    arrowPoints.tip.x, arrowPoints.tip.y,
                    arrowPoints.left.x, arrowPoints.left.y,
                    arrowPoints.tip.x, arrowPoints.tip.y,
                    arrowPoints.right.x, arrowPoints.right.y
                  ]}
                  stroke={elementColor}
                  strokeWidth={isSelected ? 3 : 2}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              </>
            );
          })()}

          {/* Selection handles for each coordinate */}
          {isSelected && canvasCoords.map((coord, index) => {
            const isVertexSelected = selectedVertex?.elementId === element.id && selectedVertex?.vertexIndex === index;
            const isSnapped = snappedVertices?.has(index) ?? false;
            const isHostedPolygonOpening =
              element.type === 'BuildingElementTransparent' &&
              !!(element as { parent_element?: string | null }).parent_element &&
              coordinates.length >= 3;
            const isHandleHostSnapped = isSnapped || isHostedPolygonOpening;
            const handleRadius = isVertexSelected ? 6 : 4;

            return (
              <React.Fragment key={index}>
                {showUnsnappedVertexGuidance && !isHandleHostSnapped && renderUnsnappedVertexChip(coord, handleRadius, `unsnapped-chip-${element.id}-${index}`)}
                <Circle
                  name={`vertex-${element.id}-${index}`}
                  x={coord.x}
                  y={coord.y}
                  radius={handleRadius}
                  fill={isHandleHostSnapped ? canvasInteractionPalette.snap : canvasInteractionPalette.handleFill}
                  stroke={isHandleHostSnapped ? canvasInteractionPalette.handleStrokeOnSnap : canvasInteractionPalette.handleStroke}
                  strokeWidth={isVertexSelected ? 3 : 2}
                  draggable={!isReadOnlyDevelopmentContextShading}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    setSelectedVertex?.({ elementId: element.id, vertexIndex: index });
                  }}
                  onDragStart={(e) => {
                    beginVertexDrag();
                    setVertexDragState(
                      vertexSnapMode
                        ? buildVertexDragStateForElement({
                            element,
                            vertexIndex: index,
                            elementsById,
                            currentFloorZ,
                            target: e.target,
                          })
                        : null,
                    );
                    beginActiveVertexPreview(e.target, index);
                    clearLengthPillPreview(e.target);
                  }}
                  onDragMove={(e) => {
                    let newWorld = canvasToWorld({x: e.target.x(), y: e.target.y()}, scale, panOffset, canvasCenter);
                    const vertexDragState = getVertexDragState();
                    // Corner-to-corner snapping to any other element's corners (no segment projection, no self-snap)
                    const snapTol = (geometryStore.getState() as any).PROJECT_DEFAULTS?.snap_m || 0.1;
                    const best = utilSnapCornerToOtherCornersFromCache(
                      newWorld,
                      element.id,
                      snapCache,
                      snapTol,
                      { minDistance: 1e-6 },
                    );
                    let didSnap = !!best;
                    if (didSnap) { newWorld = best as {x:number,y:number}; }
                    const rightWorld = applyPlanVertexRightAngleSnap(
                      { x: newWorld.x, y: newWorld.y },
                      element,
                      index,
                      elementsById,
                      geometryStore,
                    );
                    if (rightWorld.x !== newWorld.x || rightWorld.y !== newWorld.y) {
                      newWorld = rightWorld;
                      didSnap = true;
                    }
                    const snappedCanvas = worldToCanvas(newWorld, scale, panOffset, canvasCenter);
                    e.target.position({ x: snappedCanvas.x, y: snappedCanvas.y });
                    try { (e.target as any).attrs.fill = didSnap ? canvasInteractionPalette.snap : canvasInteractionPalette.handleFill; (e.target as any).getLayer()?.batchDraw?.(); } catch { /* swallow: best-effort */ }

                    // If vertex snap mode is active, calculate length pills for LINE elements
                    if (vertexSnapMode && vertexDragState && vertexDragState.elementId === element.id && vertexDragState.vertexIndex === index) {
                      updateVertexSnapPreview(vertexDragState, element, index, newWorld);

                      const pills = buildVertexLengthPillsFromState(vertexDragState, element, newWorld, elementsById);
                      vertexDragState.lengthPills = pills;
                      updateLengthPillPreview(e.target, pills);
                    }

                    // Move only this vertex (don't update connected elements yet)
                    const updatedCoords = [...coordinates];
                    updatedCoords[index] = { ...updatedCoords[index], x: newWorld.x, y: newWorld.y };
                    updateDraggedElementShapeFromCoords(
                      e.target,
                      element.id,
                      updatedCoords,
                      scale,
                      panOffset,
                      canvasCenter,
                      element,
                    );
                  }}
                  onDragEnd={(e) => {
                    endVertexDrag();
                    try { (e.target as any).attrs.fill = canvasInteractionPalette.handleFill; (e.target as any).getLayer()?.batchDraw?.(); } catch { /* swallow: best-effort */ }
                    // Re-snap on drop for precision
                    let newWorld = canvasToWorld({x: e.target.x(), y: e.target.y()}, scale, panOffset, canvasCenter);
                    const best = utilSnapCornerToOtherCornersFromCache(newWorld, element.id, snapCache, getProjectDefaults(geometryStore).snapTol);
                    if (best) newWorld = best;
                    newWorld = applyPlanVertexRightAngleSnap(
                      { x: newWorld.x, y: newWorld.y },
                      element,
                      index,
                      elementsById,
                      geometryStore,
                    );
                    const finalCanvasPos = worldToCanvas(newWorld, scale, panOffset, canvasCenter);
                    e.target.position({ x: finalCanvasPos.x, y: finalCanvasPos.y });
                    const vertexDragState = getVertexDragState();

                    if (vertexSnapMode && vertexDragState && vertexDragState.elementId === element.id && vertexDragState.vertexIndex === index) {
                      recordVertexDragWorldPosition(element.id, index, newWorld, coordinates[index]?.z ?? 0, elementsById);
                      finalizeVertexDragFromState(commitVertexPositionUpdates, () => clearLengthPillPreview(e.target));
                    } else {
                      // Normal update (no snap mode)
                      const updated = [...coordinates];
                      updated[index] = { ...updated[index], x: newWorld.x, y: newWorld.y };
                      updateElement(element.id, { coordinates: updated });
                    }

                    cleanupVertexInteractionAfterDragEnd(e.target);
                  }}
                />
              </React.Fragment>
            );
          })}

        </Group>
      );
    }
  }

  return null;
};

const usesSnapCacheInRenderedInteraction = (props: ElementRendererProps): boolean => (
  props.isSelected ||
  props.selectedVertex?.elementId === props.element.id
);

const dormerCutoutSelectionKey = (props: ElementRendererProps): string => {
  const { element, selection, elementsById } = props;
  if (!selection || element.type !== 'BuildingElementOpaque') return '';
  if (selection.type === 'element' && selection.id === element.id) return `host:${element.id}`;
  if (selection.type !== 'dormer') return '';

  for (const candidate of Object.values(elementsById)) {
    const bundleInfo = getDormerBundleInfo(candidate);
    if (
      bundleInfo?.role === 'front-wall-anchor' &&
      bundleInfo.bundle_id === selection.id &&
      bundleInfo.host_element_name === element.name &&
      bundleInfo.cutout_polygon.length >= 3
    ) {
      return `dormer:${selection.id}`;
    }
  }
  return '';
};

// Memoized ElementRenderer component with custom comparison function
// Only re-renders when element actually changes (using _v version field) or relevant props change
export const ElementRenderer = memo(ElementRendererComponent, (prevProps, nextProps) => {
  // Use element version field for change detection (primary optimization)
  if (prevProps.element.id !== nextProps.element.id) return false; // Different element
  if (prevProps.element._v !== nextProps.element._v) return false; // Element was updated

  // Check if coordinates changed (even if _v didn't change, coordinates might have)
  const prevCoords = prevProps.element.coordinates || [];
  const nextCoords = nextProps.element.coordinates || [];
  if (prevCoords.length !== nextCoords.length) return false;
  // Quick check: if coordinates array reference changed, likely coordinates changed
  if (prevCoords !== nextCoords) {
    for (let i = 0; i < prevCoords.length; i++) {
      if (prevCoords[i].x !== nextCoords[i].x ||
          prevCoords[i].y !== nextCoords[i].y ||
          prevCoords[i].z !== nextCoords[i].z) {
        return false;
      }
    }
  }

  // Check other critical props that should trigger re-render
  if (prevProps.isSelected !== nextProps.isSelected) return false;
  if (prevProps.scale !== nextProps.scale) return false; // Zoom changes require re-render
  if (prevProps.panOffset.x !== nextProps.panOffset.x || prevProps.panOffset.y !== nextProps.panOffset.y) return false; // Pan changes require re-render
  if (prevProps.canvasCenter.x !== nextProps.canvasCenter.x || prevProps.canvasCenter.y !== nextProps.canvasCenter.y) return false;
  if (prevProps.currentFloorZ !== nextProps.currentFloorZ) return false;
  if (prevProps.floors !== nextProps.floors) return false;
  if (prevProps.canvasElementPalette !== nextProps.canvasElementPalette) return false;
  if (prevProps.canvasInteractionPalette !== nextProps.canvasInteractionPalette) return false;
  if (
    prevProps.snapCache !== nextProps.snapCache &&
    (usesSnapCacheInRenderedInteraction(prevProps) || usesSnapCacheInRenderedInteraction(nextProps))
  ) {
    return false;
  }
  if (prevProps.drawMode !== nextProps.drawMode) return false;
  if (prevProps.snapCorners !== nextProps.snapCorners) return false;
  if (prevProps.snapAngles !== nextProps.snapAngles) return false;
  if (
    (
      prevProps.selection?.type !== nextProps.selection?.type ||
      prevProps.selection?.id !== nextProps.selection?.id
    ) &&
    dormerCutoutSelectionKey(prevProps) !== dormerCutoutSelectionKey(nextProps)
  ) {
    return false;
  }
  if (prevProps.elementHover !== nextProps.elementHover) {
    const wasHovered = prevProps.elementHover === prevProps.element.id;
    const isHovered = nextProps.elementHover === nextProps.element.id;
    if (wasHovered !== isHovered) return false;
  }

  // Check selected vertex
  if (prevProps.selectedVertex?.elementId !== nextProps.selectedVertex?.elementId ||
      prevProps.selectedVertex?.vertexIndex !== nextProps.selectedVertex?.vertexIndex) return false;

  // Check overlap badge menu (affects hover highlighting)
  if (prevProps.overlapBadgeMenu !== nextProps.overlapBadgeMenu) {
    // If menu state changed, check if it affects this element
    const prevAffects = prevProps.overlapBadgeMenu?.elementIds.includes(prevProps.element.id);
    const nextAffects = nextProps.overlapBadgeMenu?.elementIds.includes(nextProps.element.id);
    if (prevAffects !== nextAffects) return false;
  }

  // Check vertex snap mode (affects drag behavior)
  if (prevProps.vertexSnapMode !== nextProps.vertexSnapMode) return false;
  // Category hide/show from Elements panel (useElementCategoryGhost) — not part of store element
  if (prevProps.categoryGhostOnCanvas !== nextProps.categoryGhostOnCanvas) return false;
  if (prevProps.spaceLabellerSuppressFabricInteraction !== nextProps.spaceLabellerSuppressFabricInteraction)
    return false;

  // All relevant props are the same - skip re-render (performance optimization)
  return true;
});
