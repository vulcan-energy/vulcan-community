// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { Suspense, useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { Stage, Layer, Rect, Text, Group, Line, Circle } from 'react-konva';
import { Rnd } from 'react-rnd';
import { OrthogonalRoomEditModal } from './OrthogonalRoomEditModal';
import { ElementCreator } from './ElementCreator';
import { MultiSelectPanel } from './MultiSelectPanel';
import { getElementShape, getElementColor, worldToCanvas, canvasToWorld, computePlanViewBoundsCenter, withCanvasAlpha, type ElementCanvasPalette } from '../lib/shapeUtils';
import { findOverlappingElements, getOverlapCenter } from '../lib/overlapDetection';
import { calculateMemoizedLabelPositions, transformCachedLabelPosition, getSmartLabelPillTexts, getSmartLabelLayoutSignature, SMART_LABEL_METRICS, type LabelPosition } from '../lib/labelUtils';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { FilenameBar, type FilenameBarActionContext } from './FilenameBar';
import type {
  GeometryDocumentHostPort,
  GeometryDocumentHostTarget,
} from '../../../geometry-document/src';
import {
  unavailableGeometryProjectContextPort,
  type GeometryProjectContextPort,
} from '../../../geometry-editor-host/src';
import {
  unavailableGeometryWorkspaceResourcePort,
  type GeometryWorkspaceResourcePort,
} from '../../../geometry-editor-host/src/workspaceResourcePort';
import {
  unavailableGeometryCanvasEvidenceContribution,
  type GeometryCanvasEvidenceContribution,
} from '../../../geometry-editor-host/src/canvasEvidenceContribution';
import {
  unavailableGeometryModelSchemaProfilePort,
  type GeometryModelSchemaProfilePort,
} from '../../../geometry-editor-host/src/modelSchemaProfilePort';
import {
  emptyGeometryInspectorContributions,
  type GeometryInspectorContributions,
} from '../../../geometry-editor-host/src/inspectorContributions';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import { useGeometrySourceComparisonPort } from '../../../geometry-editor-host/src/editorServicePorts';
import {
  useGeometryStore,
  useGeometryStoreApi,
  type Element,
  type ElementType,
  type Floor,
  type GeometryStoreApi,
  shouldSnapToParent,
} from '../stores/geometryStore';
import { useThemeStore } from '../stores/themeStore';
import { listElementPresetOptions } from '../geometry/parameterLibraryCatalog';
import {
  calculateDerivedBaseHeight,
  withEffectiveStoreyHeights,
} from '../lib/zoneDerivation';
import { resolveTargetZoneIdForNewCanvasElement } from '../lib/resolveTargetZoneForNewElement';
import { selectionForDrawnElement } from '../lib/drawnElementSelection';
import { isPointInPolygon2D } from '../lib/pointInPolygon';
import { compareElementPaintOrder } from '../lib/canvasPaintOrder';
import { CompassRose } from './CompassRose';
import { useDrawingMode, type DrawMode } from '../hooks/useDrawingMode';
import { useMarqueeSelection } from '../hooks/useMarqueeSelection';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useDocumentSaveShortcut } from '../hooks/useDocumentSaveShortcut';
import {
  usePanelLayout,
  getGeometryCanvasOverlaySafeTopPx,
  type InitialElementsPanelPlacement,
  DETAILS_PANEL_MIN_W,
  DETAILS_PANEL_MIN_H,
  DETAILS_PANEL_DEFAULT_W,
  DETAILS_PANEL_DEFAULT_H,
} from '../hooks/usePanelLayout';
import { useOverlay } from '../hooks/useOverlay';
import { getElementTypeBaseName } from '../lib/displayNames';
import './GeometryCanvas.css';
import {
  buildGeometrySnapCache,
  buildGeometrySnapCacheFromTargets,
  snapCornerToOtherCornersFromCache as utilSnapCornerToOtherCornersFromCache,
  applyAngleSnapIfClose as utilApplyAngleSnapIfClose,
  constrainPointOrthogonally as utilConstrainPointOrthogonally,
  findClosestPointOnPolygon as utilFindClosestPointOnPolygon,
  getExactSnappedVertices as utilGetExactSnappedVertices,
  isAll90DegreeConnections as utilIsAll90DegreeConnections,
  translateShapeToSnapFromCache as utilTranslateShapeToSnapFromCache,
  findNearestWallProjectionFromCache as utilFindNearestWallProjectionFromCache,
  projectSegmentOntoParent as utilProjectSegmentOntoParent,
  resolveOpeningSegmentParentFromCache as utilResolveOpeningSegmentParentFromCache,
  resolveDrawSnapPoint as utilResolveDrawSnapPoint,
  isLineWallElementForSnap,
  type GeometrySnapCache,
  type SnapCornerTarget,
  type SnapWallSegmentTarget,
} from '../lib/snapUtils';
import { CANVAS_CONSTANTS } from '../lib/canvasConstants';
import { writeTbLineMode, type TbLineMode } from '../lib/thermalBridgeLineMode';
import { loadBundledAssemblyLibrary } from '../lib/assemblyLibrary';
import type { ExternalDetailCataloguePort } from '../geometry/thermalBridge/externalDetailContracts';
import { orientation360SlopedFromFirstEdge } from '../lib/openingSegmentOutward';
import {
  buildOutwardRoomWallSegments,
  ensureCounterClockwiseKeepingLeadEdge,
  ensureCounterClockwisePolygon,
} from '../lib/polygonWinding';
import {
  applyServiceLinePlanLengthToCoordinates,
  createServiceLineCoordinates,
  getServiceLineLengthFromCoordinates,
  getServiceLinePlanLengthFromCoordinates,
  inferServiceLineModeFromCoordinates,
  isServiceLineDrawMode,
  isServiceLineElementType,
  serviceLineModeFromDrawMode,
} from '../lib/serviceLineDrawModes';
import { roundToTwoDecimals } from '../geometry/constants';
import {
  getMechanicalVentilationDuctworkRoleStyle,
  getFirstPoint3,
  isMvhrTerminalHost,
  type MvhrDuctRole,
  type MvhrTerminalRole,
} from '../lib/mvhrDuctwork';
import {
  buildPvPanelRectangleCoords,
  getPvFootprintDimensionsFromPreset,
} from '../lib/pvPanelFootprint';
import { findHostRoofId, isPanelFullyOnRoof } from '../lib/pvHostDerivation';
import { computePvRoofClearanceGuidance } from '../lib/pvRoofClearance';
import {
  computeRoofHostedOpeningPlacement,
  moveRoofHostedOpeningToSurfaceDistance,
} from '../lib/roofHostedOpeningPlacement';
import {
  computeLineHostedOpeningClearance,
  isLineHostedOpeningElement,
  moveLineHostedOpeningToClearance,
  type LineOpeningClearanceSide,
  type LineHostedOpeningClearance,
} from '../lib/lineHostedOpeningPlacement';
import { ElementRenderer } from './canvas/ElementRenderer';
import {
  ACTIVE_GEOMETRY_DRAG_LAYER_NAME,
  type ActiveCloneDragPreviewSession,
  updateDraggedElementShapeFromCoords,
  VERTEX_LENGTH_PILLS_GROUP_NAME,
} from './canvas/elementDragPreview';
import {
  beginCanvasInteraction,
  cancelCanvasInteraction,
  endCanvasInteraction,
  getActiveCanvasInteraction,
  isCanvasInteractionActive,
  readCanvasInteractionSession,
  type CanvasInteractionSession,
  writeCanvasInteractionSession,
} from './canvas/canvasInteractionSession';
import { LiveDrawingPreview } from './canvas/LiveDrawingPreview';
import { LiveMarqueeSelection } from './canvas/LiveMarqueeSelection';
import { CanvasLivePreviewLayer } from './canvas/CanvasLivePreviewLayer';
import {
  canCanvasInteractionUpdateElementHover,
  canCanvasInteractionRunStageMouseMove,
  getStageMouseMoveWork,
  type StageMouseMoveWork,
} from './canvas/stageMouseMoveWork';
import { shouldStartStagePanGesture } from './canvas/stagePanGesture';
import {
  readCanvasElementPalette,
  readCanvasInteractionPalette,
} from './canvas/elementRendererPalette';
import { readDrawingCanvasPalette } from './canvas/drawingPreviewPalette';
import {
  EMPTY_SEGMENT_LENGTH_PREVIEW,
  createDrawingPreviewSignal,
  type DrawingPreviewSegment,
} from './canvas/drawingPreviewSignal';
import {
  hasGeometryCanvasSelectionRenderStateChanged,
  shouldMarkGeometryCanvasModelRenderState,
  type GeometryCanvasModelRenderState,
  type GeometryCanvasSelectionRenderState,
} from './canvas/geometryCanvasRenderState';
import { SpaceLabellerPanel } from './spaceLabels/SpaceLabellerPanel';
import { ElementsZonesPanel } from './canvas/ElementsZonesPanel';
import { OverlayPanel } from './canvas/OverlayPanel';
import { OverlayPdfImportModal } from './canvas/OverlayPdfImportModal';
import { DrawToolbar, type CanvasViewMode } from './canvas/DrawToolbar';
import { LazyInlineFallback, LazyModalFallback } from './LazyModuleFallback';
import type { HidePanelKey, HidePanelOption } from './canvas/HidePanelsDropdown';
import {
  defineGeometryEditorContributions,
  pruneUnavailableCanvasPanelPositions,
  projectCanvasPanelComposition,
  readCanvasPanelPosition,
  resolveCanvasPanelContributions,
  resetCanvasPanelPosition,
  setCanvasPanelPosition,
  type CanvasPanelPosition,
  type CanvasPanelPositions,
  type GeometryEditorContributions,
} from '../../../geometry-editor-host/src';
import type { GeometryCanvas3DProps } from './canvas/GeometryCanvas3D';
import { useElementCategoryGhost } from '../hooks/useElementCategoryGhost';
import { useHiddenElementIds } from '../hooks/useHiddenElementIds';
import { useKeyedState } from '../hooks/useKeyedState';
import { elementIsHiddenFromView } from '../lib/elementCategoryVisibility';
import type { BuildErrorItem } from '../types/buildErrors';
import { isElementOnActiveCanvasFloor, mergeServiceLineExtraJsonFloorId } from '../lib/elementCanvasFloor';
import { partitionElementCanvasDataByFloor } from '../lib/geometryCanvasLayerPartition';
import {
  getDrawModeTooltipPillWidth,
  DRAW_MODE_TOOLTIP_PILL_FONT_FAMILY,
  DRAW_MODE_TOOLTIP_PILL_HEIGHT,
  DRAW_MODE_TOOLTIP_PILL_PADDING,
} from '../lib/drawModeTooltipPill';
import {
  buildDormerBundleDraft,
  getDormerBundleAnchorElement,
  getDormerAnchorName,
  getDormerBundleElementIds,
  getDormerBundleInfo,
  getDormerBundleName,
  getDormerDrawPreviewCutoutPolygon,
  isValidDormerHost,
} from '../lib/dormerGeometry';
import {
  cascadeHostedDescendantTranslation,
  collectHostedDescendantElementIds,
} from '../lib/hostedDescendantCascade';
import {
  isLivingRoomSpaceLabel,
  isSpaceLabelOpenToLivingRoom,
  spaceLabelPlanAreaM2,
} from '../lib/spaceLabelDerivation';
import { getSpaceLabelBaseNameForRoomType } from '../lib/spaceLabelNaming';
import type { ContextShading, SpaceLabel } from '../geometry/types';
import { geometryPerf } from '../lib/geometryPerf';
import {
  getDevelopmentContextStems,
  normalizeBaseModelStem,
  parseDevelopmentContextModel,
  resolveDevelopmentContextProject,
  type DevelopmentContextModel,
} from '../lib/developmentContext';
import {
  buildDevelopmentContextModelLabels,
  type DevelopmentContextModelLabel,
} from '../lib/developmentContextCanvasLabels';
import {
  classifyDevelopmentContextVerticalRelation,
  getDevelopmentContextSharedContextShadingId,
  getExplicitContextShadingSharedId,
  isDevelopmentContextGeneratedShading,
  resolveDevelopmentModelVerticalContext,
  type DevelopmentContextVerticalRelation,
} from '../lib/developmentContextShading';
import { validateElementCore, type ValidationContext } from '../geometry/validation/validateElement';
import { findLinearThermalBridgeIssues } from '../geometry/thermalBridge/findLinearThermalBridgeIssues';
import { selectPartFData } from '../geometry/validation/partF/selector';
import { getOverlapBadgeMenuLayerStyle, type OverlapBadgeMenuAnchor } from '../lib/overlapBadgeMenu';

const SPACE_LABEL_CANVAS_FILL = 'rgba(14, 165, 233, 0.22)';
const SPACE_LABEL_CANVAS_STROKE = 'rgba(125, 211, 252, 0.9)';
const SPACE_LABEL_CANVAS_LIVING_FILL = 'rgba(20, 184, 166, 0.26)';
const SPACE_LABEL_CANVAS_LIVING_SELECTED_FILL = 'rgba(20, 184, 166, 0.38)';
const SPACE_LABEL_CANVAS_LIVING_STROKE = 'rgba(45, 212, 191, 0.95)';
const SPACE_LABEL_CANVAS_REST_FILL = 'rgba(148, 163, 184, 0.2)';
const SPACE_LABEL_CANVAS_REST_SELECTED_FILL = 'rgba(148, 163, 184, 0.34)';
const SPACE_LABEL_CANVAS_REST_STROKE = 'rgba(203, 213, 225, 0.9)';
const SPACE_LABEL_CANVAS_SELECTED_FILL = 'rgba(250, 204, 21, 0.28)';
const SPACE_LABEL_CANVAS_SELECTED_STROKE = '#facc15';
const VIEWPORT_PREVIEW_COMMIT_IDLE_MS = 120;
const VIEWPORT_PREVIEW_OVERSCAN_PX = 1200;
const VIEWPORT_CULLING_ELEMENT_THRESHOLD = 500;
const STATIC_PREVIEW_DEVICE_PIXEL_RATIO = 1;
const ENABLE_GEOMETRY_CANVAS_REACT_PROFILER = import.meta.env.DEV;

const loadGeometryCanvas3DModule = () => import('./canvas/GeometryCanvas3D');

const prefetchGeometryCanvas3D = () => {
  void loadGeometryCanvas3DModule();
};

const GeometryCanvas3D = React.lazy(async () => {
  const module = await loadGeometryCanvas3DModule();
  return { default: module.GeometryCanvas3D };
});

const loadAutoThermalBridgePreviewModal = () => import('./AutoThermalBridgePreviewModal');

const prefetchAutoThermalBridgePreviewModal = () => {
  void loadAutoThermalBridgePreviewModal();
};

const AutoThermalBridgePreviewModal = React.lazy(async () => {
  const module = await loadAutoThermalBridgePreviewModal();
  return { default: module.AutoThermalBridgePreviewModal };
});

type DrawToolbarAutoTbSuggestProps = {
  show: boolean;
  onPrefetch: () => void;
  onShow: () => void;
};

const DrawToolbarAutoTbSuggest = React.memo(function DrawToolbarAutoTbSuggest({
  show,
  onPrefetch,
  onShow,
}: DrawToolbarAutoTbSuggestProps) {
  if (!show) return null;

  return (
    <button
      type="button"
      className="draw-button auto-tb-suggest"
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      onMouseDown={onPrefetch}
      onClick={onShow}
      title="Suggest linear thermal bridges (openings, corners, roof windows, party lines, …)"
    >
      Suggest thermal bridges
    </button>
  );
});

const recordGeometryCanvasProfiler: React.ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) => {
  if (!geometryPerf.isEnabled()) return;
  const prefix = `ReactProfiler.${id}.${phase}`;
  geometryPerf.record(`${prefix}.actual`, actualDuration);
  geometryPerf.record(`${prefix}.base`, baseDuration);
  geometryPerf.record(`${prefix}.commitLag`, Math.max(0, commitTime - startTime));
};

function profileGeometryCanvasNode(id: string, node: React.ReactNode): React.ReactNode {
  if (!ENABLE_GEOMETRY_CANVAS_REACT_PROFILER || !geometryPerf.isEnabled()) return node;
  return (
    <React.Profiler id={id} onRender={recordGeometryCanvasProfiler}>
      {node}
    </React.Profiler>
  );
}

/** Match ElementEditor: persist absolute base_height + floorId when drawing envelope polygons. */
function getEnvelopeDrawFloorPatch(
  drawElementType: ElementType,
  elementZ: number,
  floors: Floor[],
  elements: Element[],
  ensureFloorForZ: (z: number) => string,
): { base_height: number; floorId: string } | null {
  if (
    drawElementType !== 'BuildingElementOpaque' &&
    drawElementType !== 'BuildingElementTransparent' &&
    drawElementType !== 'OnSiteGeneration'
  ) {
    return null;
  }
  return {
    base_height: calculateDerivedBaseHeight(elementZ, withEffectiveStoreyHeights(floors, elements)),
    floorId: ensureFloorForZ(elementZ),
  };
}

const FABRIC_LINE_PITCH_ELEMENT_TYPES = new Set<ElementType>([
  'BuildingElementOpaque',
  'BuildingElementTransparent',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
]);

const FLAT_POLYGON_PITCH_ELEMENT_TYPES = new Set<ElementType>([
  'BuildingElementOpaque',
  'BuildingElementTransparent',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
]);

function getDefaultLinePitchPatch(
  drawElementType: ElementType,
  drawPresetProps: Record<string, unknown>,
): { pitch: number } | null {
  if (!FABRIC_LINE_PITCH_ELEMENT_TYPES.has(drawElementType)) return null;
  return typeof drawPresetProps.pitch === 'number' && Number.isFinite(drawPresetProps.pitch)
    ? null
    : { pitch: 90 };
}

function getDefaultFlatPolygonPitchPatch(
  drawElementType: ElementType,
  drawPresetProps: Record<string, unknown>,
): { pitch: number } | null {
  if (!FLAT_POLYGON_PITCH_ELEMENT_TYPES.has(drawElementType)) return null;
  return typeof drawPresetProps.pitch === 'number' && Number.isFinite(drawPresetProps.pitch)
    ? null
    : { pitch: 0 };
}

export type GeometryCanvasSelection = {
  type: 'zone' | 'element' | 'global' | 'dormer';
  id: string;
  isPlaceholder?: boolean;
  focusFieldKey?: string;
} | null;

function isRoofHostableShape(element: Element, coords: Array<{ x: number; y: number; z: number }>): boolean {
  if (coords.length < 3) return false;
  return element.type === 'OnSiteGeneration' || element.type === 'BuildingElementTransparent';
}

function canvasStoreyIndex(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
}

function isSameStoreyOpaqueLineParentCandidate(
  elementId: string,
  childCoords: Array<{ x: number; y: number; z: number }>,
  elementsById: Record<string, Element>,
): boolean {
  const parent = elementsById[elementId];
  if (!parent || parent.type !== 'BuildingElementOpaque' || parent.coordinates?.length !== 2) return false;
  const childStorey = canvasStoreyIndex(childCoords[0]?.z);
  const parentStorey = canvasStoreyIndex(parent.coordinates[0]?.z);
  return childStorey === null || parentStorey === null || childStorey === parentStorey;
}

export type GeometryCanvasPanelContext = Readonly<{
  documentName: string | null;
  isProfileValidationEnabled: boolean;
  defaultPosition: CanvasPanelPosition;
  position: CanvasPanelPosition;
  beginDrag: (
    event: React.MouseEvent<HTMLDivElement>,
    panelElement: HTMLElement | null,
  ) => void;
  resetPosition: () => void;
}>;

export type GeometryCanvasContributions = GeometryEditorContributions<
  GeometryCanvasPanelContext,
  React.ReactNode,
  FilenameBarActionContext
>;

const EMPTY_GEOMETRY_EDITOR_CONTRIBUTIONS = defineGeometryEditorContributions<
  GeometryCanvasPanelContext,
  React.ReactNode,
  FilenameBarActionContext
>({ canvasPanels: [], filenameActions: [] });

export type GeometryCanvasViewportInsets = Readonly<{
  desktopTopPx: number;
  mobileTopPx: number;
}>;

export const NEUTRAL_GEOMETRY_CANVAS_VIEWPORT_INSETS: GeometryCanvasViewportInsets =
  Object.freeze({
    desktopTopPx: 0,
    mobileTopPx: 0,
  });

export interface GeometryCanvasProps {
  selection: GeometryCanvasSelection;
  setSelection: (selection: GeometryCanvasSelection) => void;
  viewportInsets?: GeometryCanvasViewportInsets;
  initialElementsPanelPlacement?: InitialElementsPanelPlacement;
  editorContributions?: GeometryCanvasContributions;
  projectContextPort?: GeometryProjectContextPort;
  workspaceResourcePort?: GeometryWorkspaceResourcePort;
  canvasEvidenceContribution?: GeometryCanvasEvidenceContribution;
  modelSchemaProfilePort?: GeometryModelSchemaProfilePort;
  inspectorContributions?: GeometryInspectorContributions;
  externalDetailCatalogue?: ExternalDetailCataloguePort;
  // File bar controls (threaded from GeometryBuilder)
  fileControls?: {
    documentHost: GeometryDocumentHostPort;
    resolveDocumentTarget: (fileName: string) => GeometryDocumentHostTarget;
    saveStatus: 'idle' | 'saving' | 'success' | 'error';
    saveError: string | null;
    fileNameExtension?: string;
    saveErrorTitle?: string;
    buildError?: string | null;
    buildErrorItems?: readonly BuildErrorItem[];
    onOpenDefaults?: () => void;
    defaultsPath?: string | undefined;
    defaultsInvalid?: boolean;
    globalSettingsIndicator?: { variant: 'error' | 'warning' | 'info'; issues: string[] } | null;
    hostModelName?: string;
    /** Transient development project context for an unsaved New Model draft. */
    draftProjectContextId?: string | null;
  };
}

const COMPASS_PANEL_DEFAULT = { x: 12, y: 64, width: 116, height: 112 };
const COMPASS_FILEBAR_GAP = 8;
/** Default first contributed panel position: right of the compass on the same row. */
const CONTRIBUTED_PANEL_DEFAULT_X =
  COMPASS_PANEL_DEFAULT.x + COMPASS_PANEL_DEFAULT.width + 8;

type OverlayPosition = { x: number; y: number } | null;
const DEFAULT_HIDDEN_PANELS: Partial<Record<HidePanelKey, boolean>> = {
  file: false,
  compass: false,
  drawToolbar: false,
};
const contributionHidePanelKey = (id: string): HidePanelKey => `contribution:${id}`;
type ActiveDrawSegmentEditorState = {
  mode: 'room' | 'polygon' | 'sloped-polygon' | 'space-label-polygon';
  endIndex: number;
  wallElementId?: string;
  value: string;
} | null;
type RoofWindowDistanceEditorState = {
  elementId: string;
  value: string;
  error?: boolean;
} | null;
type LineOpeningDistanceEditorState = {
  elementId: string;
  side: LineOpeningClearanceSide;
  value: string;
  error?: boolean;
} | null;
type LineOpeningClearancePreviewState = {
  parentId: string;
  coordinates: Array<{ x: number; y: number; z: number }>;
} | null;

type DevelopmentContextLoadError = { stem: string; message: string };
type DevelopmentContextCanvasDatum = {
  key: string;
  modelStem: string;
  verticalRelation: DevelopmentContextVerticalRelation;
  element: Element;
  shape: ReturnType<typeof getElementShape>;
  canvasCoords: Array<{ x: number; y: number }>;
};

const DEVELOPMENT_CONTEXT_ELEMENT_TYPES = new Set<ElementType>([
  'BuildingElementOpaque',
  'BuildingElementTransparent',
  'BuildingElementGround',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
  'ContextShading',
  'WindowShading',
  'OnSiteGeneration',
]);

function shouldRenderDevelopmentContextElement(element: Element): boolean {
  if (!DEVELOPMENT_CONTEXT_ELEMENT_TYPES.has(element.type)) return false;
  const shape = getElementShape(element);
  return shape === 'line' || shape === 'polygon' || shape === 'sloped-polygon';
}

function formatDevelopmentContextError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildDevelopmentContextElementId(modelStem: string, elementId: string): string {
  return `development-context:${modelStem}:${elementId}`;
}

function mergeGeometrySnapCaches(primary: GeometrySnapCache, secondary: GeometrySnapCache): GeometrySnapCache {
  const cornerOrderOffset = primary.cornerTargets.reduce((max, target) => Math.max(max, target.order), -1) + 1;
  const wallOrderOffset = primary.wallSegments.reduce((max, target) => Math.max(max, target.order), -1) + 1;
  return buildGeometrySnapCacheFromTargets(
    [
      ...primary.cornerTargets,
      ...secondary.cornerTargets.map((target) => ({
        ...target,
        order: target.order + cornerOrderOffset,
      })),
    ],
    [
      ...primary.wallSegments,
      ...secondary.wallSegments.map((target) => ({
        ...target,
        order: target.order + wallOrderOffset,
      })),
    ],
  );
}

function buildDevelopmentContextSnapCache(
  models: DevelopmentContextModel[],
  currentFloorZ: number,
  floors: Floor[],
): GeometrySnapCache {
  const cornerTargets: SnapCornerTarget[] = [];
  const wallSegments: SnapWallSegmentTarget[] = [];
  let cornerOrder = 0;
  let wallOrder = 0;

  for (const model of models) {
    for (const element of model.elements) {
      if (!shouldRenderDevelopmentContextElement(element)) continue;
      if (!isElementOnActiveCanvasFloor(element, currentFloorZ, floors)) continue;
      const coords = element.coordinates || [];
      if (coords.length < 2) continue;
      const contextElementId = buildDevelopmentContextElementId(model.stem, element.id);
      for (const coord of coords) {
        cornerTargets.push({
          elementId: contextElementId,
          order: cornerOrder++,
          x: coord.x,
          y: coord.y,
          z: coord.z,
        });
      }

      if (!isLineWallElementForSnap(element) || coords.length !== 2) continue;
      wallSegments.push({
        elementId: contextElementId,
        elementName: `${model.stem}:${element.name || element.id}`,
        order: wallOrder++,
        A: coords[0],
        B: coords[1],
      });
    }
  }

  return buildGeometrySnapCacheFromTargets(cornerTargets, wallSegments);
}

// Small helpers for tolerances and pointer conversion
const getProjectDefaults = (store: GeometryStoreApi) => {
  const state = store.getState() as any;
  return {
    snapTol: state.PROJECT_DEFAULTS?.snap_m || 0.1,
    angleTol: state.PROJECT_DEFAULTS?.angle_deg || 2
  };
};

const getMouseWorld = (
  stage: any,
  scale: number,
  panOffset: {x:number,y:number},
  canvasCenter: {x:number,y:number},
  viewportPointerOffset: { x: number; y: number } = { x: 0, y: 0 },
) => {
  const pos = stage.getPointerPosition();
  return canvasToWorld(
    { x: pos.x - viewportPointerOffset.x, y: pos.y - viewportPointerOffset.y },
    scale,
    panOffset,
    canvasCenter,
  );
};

const formatSegmentLength = (length: number) => length.toFixed(3);
const DRAW_SEGMENT_EDITOR_INPUT_MIN_CH = 3;
const DRAW_SEGMENT_EDITOR_INPUT_MAX_CH = 12;

const getDrawSegmentEditorInputWidthCh = (value: string): number => (
  Math.min(
    DRAW_SEGMENT_EDITOR_INPUT_MAX_CH,
    Math.max(DRAW_SEGMENT_EDITOR_INPUT_MIN_CH, value.length || 1),
  )
);

const resizeDrawSegmentEditorInput = (input: HTMLInputElement) => {
  input.style.width = `${getDrawSegmentEditorInputWidthCh(input.value)}ch`;
};

const buildSegmentLengthLabel = (length: number, drawMode: DrawMode) =>
  drawMode === 'sloped-polygon' || drawMode === 'tb-slope-line'
    ? `${formatSegmentLength(length)}m plan`
    : `${formatSegmentLength(length)}m`;

const isDuctOrPipeElementType = (
  type: string,
): type is 'WaterPipework' | 'MechanicalVentilationDuctwork' =>
  type === 'WaterPipework' || type === 'MechanicalVentilationDuctwork';

const formatServiceLineEditorNumber = (value: number | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};

const parseEditorDecimal = (value: string): number | null => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isTextEditingEventTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
};

function createServiceLineCoordinatesWithEndpointZ(
  start: { x: number; y: number },
  end: { x: number; y: number },
  startZ: number,
  endZ: number,
  mode: TbLineMode,
): Array<{ x: number; y: number; z: number }> {
  const coords = createServiceLineCoordinates(start, end, startZ, mode);
  if (mode === 'plan') {
    return coords.map((coord) => ({ ...coord, z: roundToTwoDecimals(startZ) }));
  }
  return [
    { ...coords[0], z: roundToTwoDecimals(startZ) },
    { ...coords[1], z: roundToTwoDecimals(endZ) },
  ];
}

const getDormerBundleSelectionIds = (
  elementId: string,
  elementsById: Record<string, Element>,
): string[] => {
  const seed = elementsById[elementId];
  const bundleInfo = seed ? getDormerBundleInfo(seed) : null;
  if (!bundleInfo) return [elementId];

  const anchorId = getDormerBundleAnchorElement(elementsById, bundleInfo.bundle_id)?.id ?? elementId;
  const bundleIds = getDormerBundleElementIds(elementsById, bundleInfo.bundle_id);

  return Array.from(new Set([anchorId, ...bundleIds]));
};

const getSelectionForElementId = (
  elementId: string,
  elementsById: Record<string, Element>,
): GeometryCanvasSelection => {
  const bundleInfo = getDormerBundleInfo(elementsById[elementId]);
  if (!bundleInfo) return { type: 'element', id: elementId };
  return { type: 'dormer', id: bundleInfo.bundle_id };
};

const translateDormerExtraJson = (
  extraJson: Record<string, any> | undefined,
  dx: number,
  dy: number,
): Record<string, any> | undefined => {
  if (!extraJson || typeof extraJson !== 'object') return extraJson;
  const dormerBundle = extraJson.dormer_bundle;
  if (!dormerBundle || typeof dormerBundle !== 'object') return extraJson;

  const nextBundle = { ...dormerBundle } as Record<string, any>;
  const nextParameters =
    nextBundle.parameters && typeof nextBundle.parameters === 'object'
      ? { ...nextBundle.parameters }
      : undefined;

  if (
    nextParameters?.windowCenterPlanPoint &&
    typeof nextParameters.windowCenterPlanPoint === 'object' &&
    typeof nextParameters.windowCenterPlanPoint.x === 'number' &&
    typeof nextParameters.windowCenterPlanPoint.y === 'number'
  ) {
    nextParameters.windowCenterPlanPoint = {
      x: nextParameters.windowCenterPlanPoint.x + dx,
      y: nextParameters.windowCenterPlanPoint.y + dy,
    };
  }

  if (Array.isArray(nextBundle.cutout_polygon)) {
    nextBundle.cutout_polygon = nextBundle.cutout_polygon.map((point: any) => ({
      ...point,
      x: typeof point?.x === 'number' ? point.x + dx : point?.x,
      y: typeof point?.y === 'number' ? point.y + dy : point?.y,
    }));
  }

  if (nextParameters) {
    nextBundle.parameters = nextParameters;
  }

  return {
    ...extraJson,
    dormer_bundle: nextBundle,
  };
};






// Smart label positioning system
// Small helpers for tolerances and pointer conversion


// Calculate element width in meters

// Render smart label with theme-aware panel styling. Konva renders to canvas, so
// colours must be resolved before drawing rather than passed as CSS variables.
type CanvasLabelTheme = {
  bg: string;
  border: string;
  selectedBorder: string;
  text: string;
  pillBg: string;
  pillBorder: string;
  shadow: string;
};

function readRootCssVar(varName: string, fallback: string, seen = new Set<string>()): string {
  if (typeof window === 'undefined') return fallback;
  if (seen.has(varName)) return fallback;
  seen.add(varName);
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!value || value.includes('color-mix(')) return fallback;
  const varMatch = value.match(/^var\((--[^,\s)]+)(?:,\s*([^)]+))?\)$/);
  if (varMatch) return readRootCssVar(varMatch[1], varMatch[2]?.trim() || fallback, seen);
  return value;
}

function resolveCanvasPaint(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.includes('var(')) return value;
  const match = value.match(/var\((--[^,\s)]+)(?:,\s*([^)]+))?\)/);
  if (!match) return fallback;
  const cssValue = readRootCssVar(match[1], match[2]?.trim() || fallback);
  return cssValue || fallback;
}

function readCanvasLabelTheme(): CanvasLabelTheme {
  return {
    bg: readRootCssVar('--canvas-label-bg', 'rgba(18, 31, 34, 0.9)'),
    border: readRootCssVar('--canvas-label-border', 'rgba(255, 255, 255, 0.14)'),
    selectedBorder: readRootCssVar('--canvas-label-selected-border', readRootCssVar('--accent-primary', '#ddee63')),
    text: readRootCssVar('--canvas-label-text', readRootCssVar('--text-overlay-primary', '#ffffff')),
    pillBg: readRootCssVar('--canvas-label-pill-bg', 'rgba(255, 255, 255, 0.14)'),
    pillBorder: readRootCssVar('--canvas-label-pill-border', 'rgba(255, 255, 255, 0.24)'),
    shadow: readRootCssVar('--canvas-label-shadow', 'rgba(0, 0, 0, 0.22)'),
  };
}

function readStaticPreviewElementPalette(): ElementCanvasPalette {
  const externalWallStroke = readRootCssVar('--canvas-element-external-wall-stroke', readRootCssVar('--canvas-element-wall-stroke', '#cccccc'));
  const internalWallStroke = readRootCssVar('--canvas-element-internal-wall-stroke', readRootCssVar('--canvas-element-adjacent-stroke', '#8BD3FF'));
  const partyWallStroke = readRootCssVar('--canvas-element-party-wall-stroke', readRootCssVar('--canvas-element-adjacent-stroke', '#C084FC'));
  const adjacentUnconditionedStroke = readRootCssVar('--canvas-element-adjacent-unconditioned-stroke', readRootCssVar('--canvas-element-adjacent-stroke', '#FBBF24'));
  return {
    externalWallStroke,
    externalWallFill: withCanvasAlpha(externalWallStroke, '#cccccc', '29'),
    internalWallStroke,
    internalWallFill: withCanvasAlpha(internalWallStroke, '#8BD3FF', '29'),
    partyWallStroke,
    partyWallFill: withCanvasAlpha(partyWallStroke, '#C084FC', '29'),
    adjacentUnconditionedStroke,
    adjacentUnconditionedFill: withCanvasAlpha(adjacentUnconditionedStroke, '#FBBF24', '29'),
    wallStroke: externalWallStroke,
    wallFill: withCanvasAlpha(externalWallStroke, '#cccccc', '29'),
    doorStroke: readRootCssVar('--canvas-element-door-stroke', '#ff8c00'),
    doorFill: readRootCssVar('--canvas-element-door-fill', '#ff8c0022'),
    windowStroke: readRootCssVar('--canvas-element-window-stroke', '#87ceeb'),
    windowFill: readRootCssVar('--canvas-element-window-fill', '#87ceeb22'),
    groundStroke: readRootCssVar('--canvas-element-ground-stroke', '#228b22'),
    groundFill: readRootCssVar('--canvas-element-ground-fill', '#228b2255'),
    adjacentStroke: internalWallStroke,
    adjacentFill: withCanvasAlpha(internalWallStroke, '#8BD3FF', '29'),
    contextStroke: readRootCssVar('--canvas-element-context-stroke', '#808080'),
    contextFill: readRootCssVar('--canvas-element-context-fill', '#80808022'),
    thermalBridgeStroke: readRootCssVar('--canvas-element-thermal-bridge-stroke', '#FF6B35'),
    thermalBridgeSelectedStroke: readRootCssVar('--canvas-element-thermal-bridge-selected-stroke', '#FF7A3D'),
    shadingStroke: readRootCssVar('--canvas-element-shading-stroke', '#F4C430'),
    lightingStroke: readRootCssVar('--canvas-element-lighting-stroke', '#FFB347'),
    ductworkStroke: readRootCssVar('--canvas-element-ductwork-stroke', '#4ADE80'),
    pipeworkStroke: readRootCssVar('--canvas-element-pipework-stroke', '#38BDF8'),
    emitterStroke: readRootCssVar('--canvas-element-emitter-stroke', '#60A5FA'),
    applianceStroke: readRootCssVar('--canvas-element-appliance-stroke', '#CBD5E1'),
    hotWaterStroke: readRootCssVar('--canvas-element-hot-water-stroke', '#FB7185'),
    ventStroke: readRootCssVar('--canvas-element-vent-stroke', '#22D3EE'),
    mechanicalVentilationStroke: readRootCssVar('--canvas-element-mechanical-ventilation-stroke', '#2DD4BF'),
    combustionStroke: readRootCssVar('--canvas-element-combustion-stroke', '#FF7A3D'),
    onsiteGenerationStroke: readRootCssVar('--canvas-element-onsite-generation-stroke', '#FACC15'),
    batteryStroke: readRootCssVar('--canvas-element-battery-stroke', '#A78BFA'),
    systemStroke: readRootCssVar('--canvas-element-system-stroke', '#FB923C'),
  };
}

const renderSmartLabel = (
  element: Element,
  labelPos: LabelPosition,
  isHighlighted: boolean,
  showLineDimensions: boolean,
  theme: CanvasLabelTheme,
) => {
  const {
    labelHeight,
    padding,
    spacing,
    nameFontSize,
    pillFontSize,
    pillHeight,
    nameCharWidth,
    pillCharWidth,
    pillPadding
  } = SMART_LABEL_METRICS;

  // Get base name with truncation for non-highlighted elements
  let baseName: string;
  let displayName: string; // Truncated version for display
  const MAX_LABEL_LENGTH = isHighlighted ? 40 : 20; // Show more when selected

  if ((element as any).isPlaceholder) {
    baseName = '…';
    displayName = '…';
  } else if (element.name && element.name.trim()) {
    baseName = element.name;
    displayName = baseName.length > MAX_LABEL_LENGTH ? baseName.substring(0, MAX_LABEL_LENGTH) + '…' : baseName;
  } else {
    baseName = getElementTypeBaseName(element.type as ElementType);
    displayName = baseName;
  }

  const pillTexts = getSmartLabelPillTexts(element, { showLineDimensions });

  // Calculate dynamic width based on displayed (possibly truncated) name
  const displayNameWidth = displayName.length * nameCharWidth; // Approximate character width
  const pillWidth = (text: string) => text.length * pillCharWidth + pillPadding * 2;

  let totalContentWidth = displayNameWidth;
  for (const text of pillTexts) {
    totalContentWidth += spacing + pillWidth(text);
  }

  const labelWidth = Math.max(
    68,
    totalContentWidth + padding * 2
  );

  // Calculate positions for each element
  let currentX = labelPos.x + padding;
  const baseNameX = currentX;
  currentX += displayNameWidth;
  const pillY = labelPos.y + Math.floor((labelHeight - pillHeight) / 2);
  const pillTextY = pillY + Math.floor((pillHeight - pillFontSize) / 2) - 1;
  const baseNameY = labelPos.y + Math.floor((labelHeight - nameFontSize) / 2) - 1;

  return (
    <Group key={`label-${element.id}`} listening={false}>
      {/* Glass panel background */}
      <Rect
        x={labelPos.x}
        y={labelPos.y}
        width={labelWidth}
        height={labelHeight}
        fill={theme.bg}
        stroke={isHighlighted ? theme.selectedBorder : theme.border}
        strokeWidth={isHighlighted ? 2 : 1}
        cornerRadius={8}
        shadowColor={theme.shadow}
        shadowBlur={4}
        shadowOffset={{ x: 0, y: 2 }}
        listening={false}
      />

      {/* Base name (truncated if needed) */}
      <Text
        x={baseNameX}
        y={baseNameY}
        text={displayName}
        fontSize={nameFontSize}
        fill={theme.text}
        fontStyle="bold"
        listening={false}
      />

      {/* Metric pills */}
      {pillTexts.map((text, idx) => {
        const x = currentX + spacing;
        const width = pillWidth(text);
        currentX += spacing + width;
        return (
          <Group key={`label-pill-${element.id}-${idx}`}>
            <Rect
              x={x}
              y={pillY}
              width={width}
              height={pillHeight}
              fill={theme.pillBg}
              stroke={theme.pillBorder}
              strokeWidth={1}
              cornerRadius={8}
              listening={false}
            />
            <Text
              x={x}
              y={pillTextY}
              text={text}
              fontSize={pillFontSize}
              fill={theme.text}
              fontStyle="normal"
              width={width}
              align="center"
              listening={false}
            />
          </Group>
        );
      })}

    </Group>
  );
};

// Render minimal pill tooltip (white text on blue background)
const renderDrawModeTooltipPill = (
  text: string,
  position: {x: number, y: number}
) => {
  const width = getDrawModeTooltipPillWidth(text);
  const innerW = width - DRAW_MODE_TOOLTIP_PILL_PADDING * 2;

  return (
    <Group key="draw-mode-tooltip-pill">
      {/* Blue pill background */}
      <Rect
        x={position.x}
        y={position.y}
        width={width}
        height={DRAW_MODE_TOOLTIP_PILL_HEIGHT}
        fill={readRootCssVar('--semantic-snap', '#1E90FF')}
        cornerRadius={10}
        listening={false}
      />

      {/* White text */}
      <Text
        x={position.x + DRAW_MODE_TOOLTIP_PILL_PADDING}
        y={position.y + 4}
        text={text}
        fontSize={11}
        fill={readRootCssVar('--semantic-on-color', '#FFFFFF')}
        fontStyle="normal"
        fontFamily={DRAW_MODE_TOOLTIP_PILL_FONT_FAMILY}
        width={innerW}
        align="center"
        listening={false}
      />
    </Group>
  );
};

const renderCanvasMeasurementPill = (
  text: string,
  position: { x: number; y: number },
  fill: string,
) => {
  const width = getDrawModeTooltipPillWidth(text);
  const innerW = width - DRAW_MODE_TOOLTIP_PILL_PADDING * 2;

  return (
    <Group key="canvas-measurement-pill">
      <Rect
        x={position.x}
        y={position.y}
        width={width}
        height={DRAW_MODE_TOOLTIP_PILL_HEIGHT}
        fill={fill}
        cornerRadius={10}
        listening={false}
      />
      <Text
        x={position.x + DRAW_MODE_TOOLTIP_PILL_PADDING}
        y={position.y + 4}
        text={text}
        fontSize={11}
        fill="#FFFFFF"
        fontStyle="normal"
        fontFamily={DRAW_MODE_TOOLTIP_PILL_FONT_FAMILY}
        width={innerW}
        align="center"
        listening={false}
      />
    </Group>
  );
};

const DEFAULT_DRAWN_MVHR_TERMINAL_HEIGHT_M = 2.4;

function projectPlanPointToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number; distance: number } {
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const v2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * vx + (point.y - start.y) * vy) / v2));
  const x = start.x + t * vx;
  const y = start.y + t * vy;
  return { x, y, distance: Math.hypot(point.x - x, point.y - y) };
}

function findMvhrTerminalHostForDrawPoint(
  point: { x: number; y: number },
  elementsById: Record<string, Element>,
  tolerance: number,
): { host: Element; point: { x: number; y: number } } | null {
  let best: { host: Element; point: { x: number; y: number }; distance: number } | null = null;
  for (const host of Object.values(elementsById)) {
    if (!host || !isMvhrTerminalHost(host)) continue;
    const coords = host.coordinates;
    if (!coords || coords.length < 2 || !coords[0] || !coords[1]) continue;
    const projected = projectPlanPointToSegment(point, coords[0], coords[1]);
    if (projected.distance > tolerance) continue;
    if (!best || projected.distance < best.distance) {
      best = { host, point: { x: projected.x, y: projected.y }, distance: projected.distance };
    }
  }
  return best ? { host: best.host, point: best.point } : null;
}

const GeometryCanvasInner: React.FC<GeometryCanvasProps> = ({
  selection,
  setSelection,
  fileControls,
  editorContributions = EMPTY_GEOMETRY_EDITOR_CONTRIBUTIONS,
  projectContextPort = unavailableGeometryProjectContextPort,
  workspaceResourcePort = unavailableGeometryWorkspaceResourcePort,
  canvasEvidenceContribution = unavailableGeometryCanvasEvidenceContribution,
  modelSchemaProfilePort = unavailableGeometryModelSchemaProfilePort,
  inspectorContributions = emptyGeometryInspectorContributions,
  externalDetailCatalogue,
  viewportInsets = NEUTRAL_GEOMETRY_CANVAS_VIEWPORT_INSETS,
  initialElementsPanelPlacement = 'right',
}) => {
  const geometryStore = useGeometryStoreApi();
  const schemaPort = useGeometrySchemaPort();
  const sourceComparisonPort = useGeometrySourceComparisonPort();
  const sourceComparisonSnapshot = useSyncExternalStore(
    sourceComparisonPort.subscribe,
    sourceComparisonPort.getSnapshot,
    sourceComparisonPort.getSnapshot,
  );
  const documentSaveOwnerRootRef = useRef<HTMLDivElement>(null);
  useDocumentSaveShortcut({
    documentHost: fileControls?.documentHost ?? null,
    ownerRootRef: documentSaveOwnerRootRef,
  });
  const documentFileName = fileControls?.documentHost.getSnapshot().document.fileName ?? '';
  const {
    lookupByElement,
    hasLinkedDraft: hasEvidenceDraft,
    uploadOverlayEvidence,
  } = canvasEvidenceContribution.useEvidence(documentFileName);

  const { drawMode, setDrawMode, drawElementType, setDrawElementType, drawPoints, setDrawPoints, drawCursor, setDrawCursor, setDrawAngleSnapped, drawSnapTargetRef, roomWalls, setRoomWalls, roomWallElements, setRoomWallElements, orthogonalRoomStart, setOrthogonalRoomStart, orthogonalRoomEnd, setOrthogonalRoomEnd, orthogonalRoomEditing, setOrthogonalRoomEditing, pendingHostElementCreationRef, drawPreset, setDrawPreset, drawPresetData, setDrawPresetData, resetDrawing } = useDrawingMode();
  const [drawMvhrDuctRole, setDrawMvhrDuctRole] = useState<MvhrDuctRole>('supply');
  const [drawMvhrTerminalRole, setDrawMvhrTerminalRole] = useState<MvhrTerminalRole>('intake');
  const [drawMvhrParentName, setDrawMvhrParentName] = useKeyedState<string | null>(
    drawMode === 'none' ? 'inactive' : 'active',
    null,
  );
  const drawMvhrRolePropsRef = useRef<Record<string, unknown>>({});
  const themeId = useThemeStore((s) => s.themeId);
  const customTheme = useThemeStore((s) => s.customTheme);
  const canvasLabelTheme = useMemo(() => {
    void themeId;
    void customTheme;
    return readCanvasLabelTheme();
  }, [themeId, customTheme]);
  const staticPreviewElementPalette = useMemo(() => {
    void themeId;
    void customTheme;
    return readStaticPreviewElementPalette();
  }, [themeId, customTheme]);
  const canvasElementPalette = useMemo(() => {
    void themeId;
    void customTheme;
    return readCanvasElementPalette();
  }, [themeId, customTheme]);
  const canvasInteractionPalette = useMemo(() => {
    void themeId;
    void customTheme;
    return readCanvasInteractionPalette();
  }, [themeId, customTheme]);
  const drawingCanvasPalette = useMemo(() => {
    void themeId;
    void customTheme;
    return readDrawingCanvasPalette();
  }, [themeId, customTheme]);
  const developmentContextPaint = useMemo(() => {
    void themeId;
    void customTheme;
    return {
    same: {
      stroke: readRootCssVar('--canvas-development-context-stroke', '#7dd3fc'),
      fill: readRootCssVar('--canvas-development-context-fill', 'rgba(125, 211, 252, 0.08)'),
      dash: [6, 5],
      opacity: 0.68,
    },
    above: {
      stroke: '#f59e0b',
      fill: 'rgba(245, 158, 11, 0.07)',
      dash: [3, 4],
      opacity: 0.58,
    },
    below: {
      stroke: '#94a3b8',
      fill: 'rgba(148, 163, 184, 0.06)',
      dash: [10, 6],
      opacity: 0.48,
    },
    };
  }, [themeId, customTheme]);

  const [stageSize, setStageSize] = useState(CANVAS_CONSTANTS.DEFAULTS.STAGE_SIZE);
  const [scale, setScale] = useState(CANVAS_CONSTANTS.DEFAULTS.SCALE); // Zoom scale (1 = 1m = 50px)
  const [panOffset, setPanOffset] = useState(CANVAS_CONSTANTS.DEFAULTS.PAN_OFFSET); // Pan offset in pixels
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [hiddenPanels, setHiddenPanels] = useState<Partial<Record<HidePanelKey, boolean>>>(DEFAULT_HIDDEN_PANELS);
  const [viewMode, setViewMode] = useState<CanvasViewMode>('2d');
  const [hasMountedGeometry3D, setHasMountedGeometry3D] = useState(() => viewMode === '3d');
  const [showAutoTbPreview, setShowAutoTbPreview] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<{x: number, y: number, insertIndex: number} | null>(null);
  const [spaceLabelHoverPoint, setSpaceLabelHoverPoint] = useState<{x: number, y: number, insertIndex: number} | null>(null);
  const spaceLabelHoverPointRef = useRef<{x: number, y: number, insertIndex: number} | null>(null);
  const snapIndicatorsRef = useRef<React.ReactElement[]>([]);
  const [renderCauses] = useState(() => new Set<string>());
  const markNextGeometryCanvasRender = useCallback((cause: string) => {
    if (!geometryPerf.isEnabled()) return;
    renderCauses.add(cause);
  }, [renderCauses]);

  const [selectedVertex, setSelectedVertex] = useState<{elementId: string, vertexIndex: number} | null>(null);
  const [selectedSpaceLabelVertex, setSelectedSpaceLabelVertex] = useState<{labelId: string, vertexIndex: number} | null>(null);

  const [hoveredElementId, setElementHover] = useState<string | null>(null);
  const setCanvasElementHover = useCallback((next: string | null) => {
    if (!canCanvasInteractionUpdateElementHover(getActiveCanvasInteraction()?.kind)) return;
    if (hoveredElementId === next) return;
    markNextGeometryCanvasRender('GeometryCanvas.elementHoverState');
    setElementHover(next);
  }, [hoveredElementId, markNextGeometryCanvasRender, setElementHover]);
  const [overlapBadgeMenu, setOverlapBadgeMenu] = useState<{
    anchor: OverlapBadgeMenuAnchor;
    elementIds: string[];
  } | null>(null);
  const [badgeTextOffsetY, setBadgeTextOffsetY] = useState<number | null>(null);
  const [badgeTextOffsetX, setBadgeTextOffsetX] = useState<number | null>(null);

  // Label visibility mode: 'always' or 'selected'
  const [labelVisibility, setLabelVisibility] = useState<'always' | 'selected'>('selected');
  const [developmentContextStackMenuId, setDevelopmentContextStackMenuId] = useState<string | null>(null);
  const [developmentContextHoveredStem, setDevelopmentContextHoveredStem] = useState<string | null>(null);
  const [showLineDimensions, setShowLineDimensions] = useState(true);
  const [serviceLineDraftStartZ, setServiceLineDraftStartZ] = useState('');
  const [serviceLineDraftEndZ, setServiceLineDraftEndZ] = useState('');
  const serviceLineDraftAnchorKeyRef = useRef<string | null>(null);
  const [orthogonalModifierHeld, setOrthogonalModifierHeld] = useState(false);
  const [multiDrawModifierHeld, setMultiDrawModifierHeld] = useState(false);
  const [panModifierHeld, setPanModifierHeld] = useState(false);
  const [isCanvasPanning, setIsCanvasPanning] = useState(false);
  const orthogonalModifierHeldRef = useRef(false);
  const multiDrawModifierHeldRef = useRef(false);
  const panModifierHeldRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);
  const staticPreviewSurfaceRef = useRef<HTMLDivElement>(null);
  const staticPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const developmentContextChipsLayerRef = useRef<HTMLDivElement>(null);
  const canvasFloatingEditorsLayerRef = useRef<HTMLDivElement>(null);
  const overlapBadgeMenuLayerRef = useRef<HTMLDivElement>(null);
  const activePanGestureRef = useRef<{
    startPointer: { x: number; y: number };
    session: CanvasInteractionSession | null;
  } | null>(null);
  const viewportPreviewTransformRef = useRef({ x: 0, y: 0, scale: 1 });
  const viewportPreviewCommitTimeoutRef = useRef<number | null>(null);
  const viewportPreviewPendingStateCommitRef = useRef(false);
  const suppressStageClickRef = useRef(false);
  const toViewportCanvasPoint = useCallback((point: { x: number; y: number } | null | undefined) => (
    point ? { x: point.x, y: point.y } : null
  ), []);
  const getStageViewportPointer = useCallback((stage: any) => (
    toViewportCanvasPoint(stage?.getPointerPosition?.())
  ), [toViewportCanvasPoint]);
  const getContainerViewportPointer = useCallback((event: MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  // Drawing tooltip state
  const [drawingTooltip, setDrawingTooltip] = useState<{
    visible: boolean;
    text: string;
    position: {x: number, y: number};
  }>({ visible: false, text: '', position: {x: 0, y: 0} });
  const [drawingPreviewSignal] = useState(createDrawingPreviewSignal);
  const drawingPreviewSessionRef = useRef<CanvasInteractionSession | null>(null);
  const beginDrawingPreviewInteraction = useCallback(() => {
    if (drawingPreviewSessionRef.current?.isActive()) return;
    const session = beginCanvasInteraction({
      kind: 'drawing-preview',
      targetId: 'drawing-preview',
      preview: {
        mode: 'signalOnly',
        reset: () => {
          drawingPreviewSignal.reset();
        },
      },
    });
    if (session) {
      drawingPreviewSessionRef.current = session;
    }
  }, [drawingPreviewSignal]);
  const endDrawingPreviewInteraction = useCallback(() => {
    const session = drawingPreviewSessionRef.current;
    drawingPreviewSessionRef.current = null;
    if (session) {
      endCanvasInteraction(session, { committed: false });
      return;
    }
    drawingPreviewSignal.reset();
  }, [drawingPreviewSignal]);
  const setSegmentLengthPreview = useCallback((
    next:
      | DrawingPreviewSegment
      | ((prev: DrawingPreviewSegment) => DrawingPreviewSegment),
  ) => {
    const current = drawingPreviewSignal.getSnapshot().segmentLengthPreview;
    const value = typeof next === 'function' ? next(current) : next;
    drawingPreviewSignal.set({ segmentLengthPreview: value });
  }, [drawingPreviewSignal]);
  const setSegmentLengthPreviewRef = useRef(setSegmentLengthPreview);
  useEffect(() => {
    setSegmentLengthPreviewRef.current = setSegmentLengthPreview;
  }, [setSegmentLengthPreview]);
  useEffect(() => {
    if (drawMode !== 'none') return;
    endDrawingPreviewInteraction();
  }, [drawMode, endDrawingPreviewInteraction]);
  const supportsSegmentEditor = drawMode === 'room'
    || drawMode === 'polygon'
    || drawMode === 'sloped-polygon'
    || drawMode === 'space-label-polygon';
  const [activeSegmentEditor, setActiveSegmentEditor] = useKeyedState<ActiveDrawSegmentEditorState>(
    supportsSegmentEditor ? 'supported' : 'unsupported',
    null,
  );
  const [activeServiceLineElementId, setActiveServiceLineElementId] = useKeyedState<string | null>(
    isServiceLineDrawMode(drawMode) ? 'service-line' : 'inactive',
    null,
  );
  const editorSelectionKey = selection == null ? 'none' : `${selection.type}\0${selection.id}`;
  const [roofWindowDistanceEditorState, setRoofWindowDistanceEditor] = useKeyedState<RoofWindowDistanceEditorState>(
    editorSelectionKey,
    null,
  );
  const [lineOpeningDistanceEditorState, setLineOpeningDistanceEditor] = useKeyedState<LineOpeningDistanceEditorState>(
    editorSelectionKey,
    null,
  );
  const cancelActiveSegmentEditorCommitRef = useRef(false);
  const lastProcessedCanvasViewResetKeyRef = useRef(0);

  const setStageLayerViewportPreview = useCallback((transform: { x: number; y: number; scale: number }) => {
    const surface = staticPreviewSurfaceRef.current;
    const developmentContextChipsLayer = developmentContextChipsLayerRef.current;
    const canvasFloatingEditorsLayer = canvasFloatingEditorsLayerRef.current;
    const overlapBadgeMenuLayer = overlapBadgeMenuLayerRef.current;
    const wrapper = stageRef.current;
    const stage = wrapper && typeof wrapper.getStage === 'function' ? wrapper.getStage() : wrapper;
    const stageContainer =
      stage && typeof stage.container === 'function'
        ? (stage.container() as HTMLElement | null)
        : null;
    const isIdentity = transform.x === 0 && transform.y === 0 && transform.scale === 1;
    const viewportTransformX = transform.x + (transform.scale - 1) * VIEWPORT_PREVIEW_OVERSCAN_PX;
    const viewportTransformY = transform.y + (transform.scale - 1) * VIEWPORT_PREVIEW_OVERSCAN_PX;

    if (surface) {
      surface.style.transformOrigin = '0 0';
      surface.style.willChange = isIdentity ? '' : 'transform';
      surface.style.transform = isIdentity
        ? ''
        : `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`;
    }
    if (stageContainer) {
      stageContainer.style.transformOrigin = '0 0';
      stageContainer.style.opacity = '';
      stageContainer.style.willChange = isIdentity ? '' : 'transform';
      stageContainer.style.transform = isIdentity
        ? ''
        : `translate3d(${viewportTransformX}px, ${viewportTransformY}px, 0) scale(${transform.scale})`;
    }
    for (const overlayLayer of [developmentContextChipsLayer, canvasFloatingEditorsLayer, overlapBadgeMenuLayer]) {
      if (!overlayLayer) continue;
      overlayLayer.style.transformOrigin = '0 0';
      overlayLayer.style.willChange = isIdentity ? '' : 'transform';
      overlayLayer.style.transform = isIdentity
        ? ''
        : `translate3d(${viewportTransformX}px, ${viewportTransformY}px, 0) scale(${transform.scale})`;
    }
  }, []);

  useEffect(() => {
    if (!developmentContextStackMenuId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDevelopmentContextStackMenuId(null);
        setDevelopmentContextHoveredStem(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [developmentContextStackMenuId]);

  const clearViewportPreviewCommitTimeout = useCallback(() => {
    if (viewportPreviewCommitTimeoutRef.current == null) return;
    window.clearTimeout(viewportPreviewCommitTimeoutRef.current);
    viewportPreviewCommitTimeoutRef.current = null;
  }, []);

  const applyViewportPreviewTransform = useCallback((transform: { x: number; y: number; scale: number }) => {
    viewportPreviewTransformRef.current = transform;
    setStageLayerViewportPreview(transform);
  }, [setStageLayerViewportPreview]);

  const applyPanPreviewDelta = useCallback((delta: { x: number; y: number }) => {
    const current = viewportPreviewTransformRef.current;
    const next = { ...current, x: delta.x, y: delta.y };
    applyViewportPreviewTransform(next);
    return next;
  }, [applyViewportPreviewTransform]);

  const applyZoomPreview = useCallback((pointer: { x: number; y: number }, zoom: number) => {
    const current = viewportPreviewTransformRef.current;
    const surfacePointer = {
      x: pointer.x + VIEWPORT_PREVIEW_OVERSCAN_PX,
      y: pointer.y + VIEWPORT_PREVIEW_OVERSCAN_PX,
    };
    const next = {
      scale: current.scale * zoom,
      x: surfacePointer.x + zoom * (current.x - surfacePointer.x),
      y: surfacePointer.y + zoom * (current.y - surfacePointer.y),
    };
    applyViewportPreviewTransform(next);
    return next;
  }, [applyViewportPreviewTransform]);

  const commitViewportPreview = useCallback(() => {
    clearViewportPreviewCommitTimeout();
    const transform = viewportPreviewTransformRef.current;
    if (transform.x === 0 && transform.y === 0 && transform.scale === 1) return;

    viewportPreviewTransformRef.current = { x: 0, y: 0, scale: 1 };
    viewportPreviewPendingStateCommitRef.current = true;
    geometryPerf.markNextFrame('GeometryCanvas.viewportPreview.commitNextFrame');
    const currentCanvasCenter = {
      x: stageSize.width / 2,
      y: stageSize.height / 2,
    };
    const viewportTransformX = transform.x + (transform.scale - 1) * VIEWPORT_PREVIEW_OVERSCAN_PX;
    const viewportTransformY = transform.y + (transform.scale - 1) * VIEWPORT_PREVIEW_OVERSCAN_PX;
    setScale(scale * transform.scale);
    setPanOffset({
      x: transform.scale * (currentCanvasCenter.x + panOffset.x) + viewportTransformX - currentCanvasCenter.x,
      y: transform.scale * (currentCanvasCenter.y + panOffset.y) + viewportTransformY - currentCanvasCenter.y,
    });
  }, [clearViewportPreviewCommitTimeout, panOffset, scale, stageSize.height, stageSize.width]);

  useLayoutEffect(() => {
    if (!viewportPreviewPendingStateCommitRef.current) return;
    viewportPreviewPendingStateCommitRef.current = false;
    setStageLayerViewportPreview({ x: 0, y: 0, scale: 1 });
  }, [panOffset.x, panOffset.y, scale, setStageLayerViewportPreview]);

  const scheduleViewportPreviewCommit = useCallback(() => {
    clearViewportPreviewCommitTimeout();
    viewportPreviewCommitTimeoutRef.current = window.setTimeout(() => {
      viewportPreviewCommitTimeoutRef.current = null;
      if (activePanGestureRef.current) return;
      commitViewportPreview();
    }, VIEWPORT_PREVIEW_COMMIT_IDLE_MS);
  }, [clearViewportPreviewCommitTimeout, commitViewportPreview]);

  useEffect(() => {
    return () => {
      clearViewportPreviewCommitTimeout();
      viewportPreviewTransformRef.current = { x: 0, y: 0, scale: 1 };
      viewportPreviewPendingStateCommitRef.current = false;
      setStageLayerViewportPreview({ x: 0, y: 0, scale: 1 });
    };
  }, [clearViewportPreviewCommitTimeout, setStageLayerViewportPreview]);

  // ── Element presets (loaded from batch_parameters/element_presets/) ──
  const PRESET_DRAW_TYPES = useMemo(
    () => new Set(['BuildingElementOpaque', 'BuildingElementTransparent', 'OnSiteGeneration']),
    [],
  );

  const isMultiDrawActiveForEvent = useCallback((evt?: unknown) => {
    const eventRecord = evt as { altKey?: boolean; nativeEvent?: { altKey?: boolean } } | undefined;
    return multiDrawModifierHeldRef.current || !!eventRecord?.altKey || !!eventRecord?.nativeEvent?.altKey;
  }, []);

  useEffect(() => {
    if (viewMode !== '3d') return;
    // Keep all geometry editing interactions on the 2D plane for v1.
    if (drawMode !== 'none') {
      setDrawMode('none');
    }
    geometryStore.getState().closeSpaceLabeller();
  }, [drawMode, geometryStore, setDrawMode, viewMode]);

  useEffect(() => {
    if (drawMode === 'none') {
      setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
    }
  }, [drawMode, setSegmentLengthPreview]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !isTextEditingEventTarget(event.target) &&
        isDuctOrPipeElementType(drawElementType) &&
        isServiceLineDrawMode(drawMode)
      ) {
        const key = event.key.toLowerCase();
        if (key === 'p' || key === 'v' || key === 's') {
          event.preventDefault();
          setDrawMode(key === 'v' ? 'tb-vertical-line' : key === 's' ? 'tb-slope-line' : 'tb-plan-line');
          setSegmentLengthPreviewRef.current(EMPTY_SEGMENT_LENGTH_PREVIEW);
          setActiveSegmentEditor(null);
          return;
        }
      }
      if (event.key === 'Shift') {
        orthogonalModifierHeldRef.current = true;
        setOrthogonalModifierHeld(true);
      } else if (event.key === 'Alt') {
        multiDrawModifierHeldRef.current = true;
        setMultiDrawModifierHeld(true);
      } else if (event.code === 'Space' && drawMode !== 'none') {
        panModifierHeldRef.current = true;
        setPanModifierHeld(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        orthogonalModifierHeldRef.current = false;
        setOrthogonalModifierHeld(false);
      } else if (event.key === 'Alt') {
        multiDrawModifierHeldRef.current = false;
        setMultiDrawModifierHeld(false);
      } else if (event.code === 'Space') {
        panModifierHeldRef.current = false;
        setPanModifierHeld(false);
      }
    };
    const clearHeldModifiers = () => {
      orthogonalModifierHeldRef.current = false;
      multiDrawModifierHeldRef.current = false;
      panModifierHeldRef.current = false;
      setOrthogonalModifierHeld(false);
      setMultiDrawModifierHeld(false);
      setPanModifierHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeldModifiers);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearHeldModifiers);
    };
  }, [drawElementType, drawMode, setActiveSegmentEditor, setDrawMode]);

  const endCanvasPanGesture = useCallback(() => {
    const session = activePanGestureRef.current?.session ?? null;
    commitViewportPreview();
    activePanGestureRef.current = null;
    setIsCanvasPanning(false);
    endCanvasInteraction(session, { committed: true });
  }, [commitViewportPreview, setIsCanvasPanning]);

  useEffect(() => {
    const handleMouseUp = () => {
      endCanvasPanGesture();
    };
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
    };
  }, [endCanvasPanGesture]);
  const presetOptionsResetKey = PRESET_DRAW_TYPES.has(drawElementType)
    ? drawElementType
    : 'unsupported';
  const emptyElementPresetOptions = useMemo<
    Array<{ value: string; label: string; source: 'system' | 'user' }>
  >(() => [], []);
  const [elementPresetOptions, setElementPresetOptions] = useKeyedState(
    presetOptionsResetKey,
    emptyElementPresetOptions,
  );

  // Build preset options by scanning files. The manifest only marks library-owned files.
  useEffect(() => {
    if (!PRESET_DRAW_TYPES.has(drawElementType)) {
      setElementPresetOptions([]);
      setDrawPreset('');
      setDrawPresetData(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const options = (await listElementPresetOptions(workspaceResourcePort, drawElementType)).map((option) => ({
        value: option.id,
        label: option.label,
        source: option.source === 'library' ? 'system' as const : 'user' as const,
      }));
      if (!cancelled) {
        setElementPresetOptions(options);
        setDrawPreset('');
        setDrawPresetData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [
    drawElementType,
    PRESET_DRAW_TYPES,
    setDrawPreset,
    setDrawPresetData,
    setElementPresetOptions,
    workspaceResourcePort,
  ]);

  // Load preset data on-demand when user selects a preset from the draw toolbar
  useEffect(() => {
    if (!drawPreset) {
      setDrawPresetData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const raw = await workspaceResourcePort.readText(`input/batch_parameters/element_presets/${drawPreset}.json`);
        if (!cancelled) {
          setDrawPresetData(JSON.parse(raw));
        }
      } catch (e) {
        console.warn(`[Presets] Failed to load preset ${drawPreset}`, e);
        if (!cancelled) setDrawPresetData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [drawPreset, setDrawPresetData, workspaceResourcePort]);

  // Derive preset properties (strip metadata fields) for merging into new elements.
  // Persist the preset key in extra_json so the ElementCreator dropdown can restore it.
  const drawPresetProps = useMemo(() => {
    if (
      drawElementType === 'MechanicalVentilationDuctwork' ||
      drawElementType === 'MechanicalVentilationTerminal'
    ) {
      return {};
    }
    if (!drawPresetData || !drawPreset) return {};
    const topProps = { ...(drawPresetData as Record<string, unknown>) };
    const presetExtraJson = topProps.extra_json;
    delete topProps.type;
    delete topProps.label;
    delete topProps.source;
    delete topProps.extra_json;
    return {
      ...topProps,
      extra_json: {
        ...(presetExtraJson && typeof presetExtraJson === 'object' ? presetExtraJson : {}),
        _element_preset: drawPreset,
      },
    };
  }, [drawElementType, drawPresetData, drawPreset]);

  const drawMvhrRoleProps = useMemo((): Record<string, unknown> => {
    if (drawElementType === 'MechanicalVentilationDuctwork') {
      return {
        duct_type: drawMvhrDuctRole,
        ...(drawMvhrParentName ? { parent_element: drawMvhrParentName } : {}),
      };
    }
    if (drawElementType === 'MechanicalVentilationTerminal') {
      return {
        terminal_type: drawMvhrTerminalRole,
        ...(drawMvhrParentName ? { parent_element: drawMvhrParentName } : {}),
      };
    }
    return {};
  }, [drawElementType, drawMvhrDuctRole, drawMvhrParentName, drawMvhrTerminalRole]);

  useEffect(() => {
    drawMvhrRolePropsRef.current = drawMvhrRoleProps;
  }, [drawMvhrRoleProps]);

  const resetMvhrDrawDraft = useCallback(() => {
    setDrawPoints([]);
    setDrawCursor(null);
    setDrawAngleSnapped(false);
    drawSnapTargetRef.current = null;
    setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
    setActiveSegmentEditor(null);
    setActiveServiceLineElementId(null);
    setDrawPreset('');
    setDrawPresetData(null);
  }, [drawSnapTargetRef, setActiveSegmentEditor, setActiveServiceLineElementId, setDrawAngleSnapped, setDrawCursor, setDrawPoints, setDrawPreset, setDrawPresetData, setSegmentLengthPreview]);

  const handleDrawElementTypeFromToolbar = useCallback((type: ElementType) => {
    drawMvhrRolePropsRef.current = {};
    setDrawMvhrParentName(null);
    setActiveServiceLineElementId(null);
    setDrawElementType(type);
  }, [setActiveServiceLineElementId, setDrawElementType, setDrawMvhrParentName]);

  const handleStartMvhrDuctDraw = useCallback(({ role, parentName }: { role: MvhrDuctRole; parentName: string }) => {
    resetMvhrDrawDraft();
    drawMvhrRolePropsRef.current = { duct_type: role, parent_element: parentName };
    setDrawElementType('MechanicalVentilationDuctwork');
    setDrawMvhrDuctRole(role);
    setDrawMvhrParentName(parentName);
    setDrawMode('tb-plan-line');
  }, [resetMvhrDrawDraft, setDrawElementType, setDrawMode, setDrawMvhrParentName]);

  const handleStartMvhrTerminalDraw = useCallback(({ role, parentName }: { role: MvhrTerminalRole; parentName: string }) => {
    resetMvhrDrawDraft();
    drawMvhrRolePropsRef.current = { terminal_type: role, parent_element: parentName };
    setDrawElementType('MechanicalVentilationTerminal');
    setDrawMvhrTerminalRole(role);
    setDrawMvhrParentName(parentName);
    setDrawMode('point');
  }, [resetMvhrDrawDraft, setDrawElementType, setDrawMode, setDrawMvhrParentName]);

  const pvDrawFootprintDims = useMemo(() => {
    if (drawElementType !== 'OnSiteGeneration') return null;
    const dimensions = getPvFootprintDimensionsFromPreset(drawPresetData);
    const presetPitch = drawPresetData?.pitch;
    const pitchDegrees =
      typeof presetPitch === 'number' && Number.isFinite(presetPitch) ? presetPitch : 35;
    return { ...dimensions, pitchDegrees };
  }, [drawElementType, drawPresetData]);

  // Modal state for delete confirmations
  const [zoneDeleteModal, setZoneDeleteModal] = useState<{
    isOpen: boolean;
    zoneId: string | null;
    zoneName: string | null;
    childElements: Array<{ name: string; type: string }>;
  }>({
    isOpen: false,
    zoneId: null,
    zoneName: null,
    childElements: []
  });

  const [elementDeleteModal, setElementDeleteModal] = useState<{
    isOpen: boolean;
    elementId: string | null;
    elementName: string | null;
    isMultiDelete?: boolean;
  }>({
    isOpen: false,
    elementId: null,
    elementName: null,
    isMultiDelete: false
  });

  // Get store state and functions (data via shallow selector, functions individually)
  const {
    zones, elementsById, elementIds,     floors, currentFloorZ,
    spaceLabelsById, spaceLabelIds, spaceLabellerOpen, spaceLabellerZoneId, spaceLabellerSelectedLabelId,
    snapToParent, snapCorners, snapAngles, selectedElementIds, guideOverlay, guideOverlaySource,
    guideOverlayByFloor, guideOverlaySourceByFloor, vertexSnapMode,
    canUndo, canRedo, complianceSettings,
    defaultsPath, defaultsJson, defaultsLoading, defaultsLookup, junctionPsiDefaultsPath, junctionPsiDefaultsMap,
    calculateContextShadingDistance,
    canvasViewResetKey, csvValidationCache,
  } = useGeometryStore(
    useShallow((s) => ({
      zones: s.zones,
      elementsById: s.elementsById,
      elementIds: s.elementIds,
      floors: s.floors,
      currentFloorZ: s.currentFloorZ,
      spaceLabelsById: s.spaceLabelsById,
      spaceLabelIds: s.spaceLabelIds,
      spaceLabellerOpen: s.spaceLabellerOpen,
      spaceLabellerZoneId: s.spaceLabellerZoneId,
      spaceLabellerSelectedLabelId: s.spaceLabellerSelectedLabelId,
      canvasViewResetKey: s.canvasViewResetKey,
      snapToParent: s.snapToParent,
      snapCorners: s.snapCorners,
      snapAngles: s.snapAngles,
      selectedElementIds: s.selectedElementIds,
      guideOverlay: s.guideOverlay,
      guideOverlaySource: s.guideOverlaySource,
      guideOverlayByFloor: s.guideOverlayByFloor,
      guideOverlaySourceByFloor: s.guideOverlaySourceByFloor,
      vertexSnapMode: s.vertexSnapMode,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      complianceSettings: s.complianceSettings,
      defaultsPath: s.defaultsPath,
      defaultsJson: s.defaultsJson,
      defaultsLoading: s.defaultsLoading,
      defaultsLookup: s.getDefaultsLookup(),
      junctionPsiDefaultsPath: s.junctionPsiDefaultsPath,
      junctionPsiDefaultsMap: s.junctionPsiDefaultsMap,
      calculateContextShadingDistance: s.calculateContextShadingDistance,
      csvValidationCache: s.csvValidationCache,
    }))
  );

  const selectedElementIdsKey = selectedElementIds.join('|');
  const transientDragPreviewResetKey = `${selection?.type ?? 'none'}:${selection?.id ?? 'none'}:${selectedElementIdsKey}`;
  /** Host target while dragging the selected-element centroid (line wall, roof polygon, or none). */
  const [shapeDragCentroidHostSnapState, setShapeDragCentroidHostSnap] = useState<{
    resetKey: string;
    value: 'none' | 'wall' | 'roof';
  }>(() => ({ resetKey: transientDragPreviewResetKey, value: 'none' }));
  const shapeDragCentroidHostSnap =
    shapeDragCentroidHostSnapState.resetKey === transientDragPreviewResetKey
      ? shapeDragCentroidHostSnapState.value
      : 'none';
  const setShapeDragCentroidHostSnapIfChanged = useCallback((next: 'none' | 'wall' | 'roof') => {
    if (shapeDragCentroidHostSnap === next) return;
    markNextGeometryCanvasRender('GeometryCanvas.selectedShapeDrag.hostSnapState');
    setShapeDragCentroidHostSnap({ resetKey: transientDragPreviewResetKey, value: next });
  }, [markNextGeometryCanvasRender, shapeDragCentroidHostSnap, transientDragPreviewResetKey]);
  const [lineOpeningClearancePreviewState, setLineOpeningClearancePreview] = useState<{
    resetKey: string;
    value: LineOpeningClearancePreviewState;
  }>(() => ({ resetKey: transientDragPreviewResetKey, value: null }));
  const lineOpeningClearancePreview =
    lineOpeningClearancePreviewState.resetKey === transientDragPreviewResetKey
      ? lineOpeningClearancePreviewState.value
      : null;
  const setLineOpeningClearancePreviewIfChanged = useCallback((next: LineOpeningClearancePreviewState) => {
    const same =
      lineOpeningClearancePreview === next ||
      (
        lineOpeningClearancePreview !== null &&
        next !== null &&
        lineOpeningClearancePreview.parentId === next.parentId &&
        lineOpeningClearancePreview.coordinates.length === next.coordinates.length &&
        lineOpeningClearancePreview.coordinates.every((coord, index) => {
          const nextCoord = next.coordinates[index];
          return (
            nextCoord &&
            coord.x === nextCoord.x &&
            coord.y === nextCoord.y &&
            coord.z === nextCoord.z
          );
        })
      );
    if (same) return;
    markNextGeometryCanvasRender('GeometryCanvas.selectedShapeDrag.clearancePreviewState');
    setLineOpeningClearancePreview({ resetKey: transientDragPreviewResetKey, value: next });
  }, [lineOpeningClearancePreview, markNextGeometryCanvasRender, transientDragPreviewResetKey]);

  const selectedElementIdSet = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);

  // Memoized name -> id lookups (replaces O(N) scans).
  // `nameToId` keeps the last match, as before. `elementIdsByName` keeps every id in
  // `elementsById` order, so a name lookup with a type predicate picks the same element a
  // `Object.values(elementsById).find(...)` scan would (names are unique per zone, not globally).
  const { nameToId, elementIdsByName } = useMemo(() => {
    const byName: Record<string, string> = {};
    const idsByName = new Map<string, string[]>();
    for (const id of Object.keys(elementsById)) {
      const name = (elementsById[id] as { name?: unknown } | undefined)?.name;
      if (typeof name !== 'string' || name === '') continue;
      byName[name] = id;
      const existing = idsByName.get(name);
      if (existing) existing.push(id);
      else idsByName.set(name, [id]);
    }
    return { nameToId: byName, elementIdsByName: idsByName };
  }, [elementsById]);

  const findElementByName = useCallback(
    (name: unknown, predicate?: (element: Element) => boolean): Element | undefined => {
      if (typeof name !== 'string' || name === '') return undefined;
      for (const id of elementIdsByName.get(name) ?? []) {
        const candidate = elementsById[id];
        if (candidate && (!predicate || predicate(candidate))) return candidate;
      }
      return undefined;
    },
    [elementIdsByName, elementsById],
  );

  const geometryModelRenderState = useMemo<GeometryCanvasModelRenderState>(() => ({
    elementIds,
    elementsById,
    floors,
    spaceLabelIds,
    spaceLabelsById,
    zones,
  }), [elementIds, elementsById, floors, spaceLabelIds, spaceLabelsById, zones]);
  const previousGeometryModelRenderStateRef = useRef(geometryModelRenderState);
  const hasObservedGeometryModelRenderStateRef = useRef(false);

  const geometrySelectionRenderState = useMemo<GeometryCanvasSelectionRenderState>(() => ({
    selectedElementIds,
    selection,
  }), [selectedElementIds, selection]);
  const previousGeometrySelectionRenderStateRef = useRef(geometrySelectionRenderState);
  useLayoutEffect(() => {
    if (!geometryPerf.isEnabled()) {
      previousGeometryModelRenderStateRef.current = geometryModelRenderState;
      hasObservedGeometryModelRenderStateRef.current = false;
      previousGeometrySelectionRenderStateRef.current = geometrySelectionRenderState;
      return;
    }

    const causes = [...renderCauses];
    if (shouldMarkGeometryCanvasModelRenderState({
      hasObservedModelRenderState: hasObservedGeometryModelRenderStateRef.current,
      previous: previousGeometryModelRenderStateRef.current,
      next: geometryModelRenderState,
    })) {
      causes.push('GeometryCanvas.modelStateChange');
    }
    if (hasGeometryCanvasSelectionRenderStateChanged(
      previousGeometrySelectionRenderStateRef.current,
      geometrySelectionRenderState,
    )) {
      causes.push('GeometryCanvas.selectionStateChange');
    }
    previousGeometryModelRenderStateRef.current = geometryModelRenderState;
    hasObservedGeometryModelRenderStateRef.current = true;
    previousGeometrySelectionRenderStateRef.current = geometrySelectionRenderState;

    const cause = causes.length > 0 ? causes.sort().join('+') : 'unattributed';
    geometryPerf.record(`GeometryCanvas.render.${cause}`, 1);
    renderCauses.clear();
  }, [geometryModelRenderState, geometrySelectionRenderState, renderCauses]);

  const drawMvhrParentElement = useMemo(() => {
    if (!drawMvhrParentName) return null;
    return findElementByName(
      drawMvhrParentName,
      (element) => element.type === 'MechanicalVentilation',
    ) ?? null;
  }, [drawMvhrParentName, findElementByName]);

  const activeMvhrDrawParentElement = useMemo(() => {
    if (drawMvhrParentElement) return drawMvhrParentElement;
    const parentName =
      typeof drawMvhrRoleProps.parent_element === 'string'
        ? drawMvhrRoleProps.parent_element
        : null;
    if (!parentName) return null;
    return findElementByName(
      parentName,
      (element) => element.type === 'MechanicalVentilation',
    ) ?? null;
  }, [drawMvhrParentElement, drawMvhrRoleProps, findElementByName]);

  const serviceLineDrawBaseZ = useMemo(() => {
    const mvhrDuctUnitPoint =
      drawElementType === 'MechanicalVentilationDuctwork' && activeMvhrDrawParentElement
        ? getFirstPoint3(activeMvhrDrawParentElement)
        : undefined;
    return typeof mvhrDuctUnitPoint?.z === 'number'
      ? mvhrDuctUnitPoint.z
      : calculateDerivedBaseHeight(currentFloorZ, withEffectiveStoreyHeights(floors, Object.values(elementsById)));
  }, [activeMvhrDrawParentElement, currentFloorZ, drawElementType, elementsById, floors]);

  const mvhrDuctDrawFloorId =
    drawElementType === 'MechanicalVentilationDuctwork'
      ? activeMvhrDrawParentElement?.floorId
      : undefined;

  /* eslint-disable react-hooks/set-state-in-effect -- the service-line editor is a draft state machine keyed by anchor and plan/elevation mode. */
  useEffect(() => {
    if (!isDuctOrPipeElementType(drawElementType) || !isServiceLineDrawMode(drawMode)) {
      serviceLineDraftAnchorKeyRef.current = null;
      setServiceLineDraftStartZ('');
      setServiceLineDraftEndZ('');
      return;
    }

    const anchor = drawPoints.length > 0 ? drawPoints[drawPoints.length - 1] : null;
    const selectedElement =
      selection && (selection.type === 'element' || selection.type === 'global')
        ? elementsById[selection.id]
        : undefined;
    const selectedCoords =
      selectedElement &&
      isDuctOrPipeElementType(selectedElement.type) &&
      Array.isArray(selectedElement.coordinates) &&
      selectedElement.coordinates.length === 2
        ? selectedElement.coordinates
        : null;
    const selectedEnd = selectedCoords?.[1];
    const selectedEndMatchesAnchor =
      anchor &&
      selectedEnd &&
      Math.abs(selectedEnd.x - anchor.x) < 1e-6 &&
      Math.abs(selectedEnd.y - anchor.y) < 1e-6;
    const fallbackStartZ =
      selectedEndMatchesAnchor && typeof selectedEnd.z === 'number' && Number.isFinite(selectedEnd.z)
        ? selectedEnd.z
        : serviceLineDrawBaseZ;
    const mode = serviceLineModeFromDrawMode(drawMode);
    const baseKey = [
      anchor ? `${formatServiceLineEditorNumber(anchor.x)},${formatServiceLineEditorNumber(anchor.y)}` : 'no-anchor',
      selectedElement?.id ?? 'none',
      formatServiceLineEditorNumber(fallbackStartZ),
    ].join(':');
    const key = `${baseKey}|${mode}`;
    if (serviceLineDraftAnchorKeyRef.current === key) return;

    const previousBaseKey = serviceLineDraftAnchorKeyRef.current?.split('|')[0] ?? null;
    const preserveExistingDraft = previousBaseKey === baseKey;
    const preservedStartZ = preserveExistingDraft ? parseEditorDecimal(serviceLineDraftStartZ) : null;
    const preservedEndZ = preserveExistingDraft ? parseEditorDecimal(serviceLineDraftEndZ) : null;
    const startZ = preservedStartZ ?? fallbackStartZ;
    const endZ =
      mode === 'plan'
        ? startZ
        : preservedEndZ !== null && Math.abs(preservedEndZ - startZ) > 1e-6
          ? preservedEndZ
          : startZ + 1;

    serviceLineDraftAnchorKeyRef.current = key;
    setServiceLineDraftStartZ(formatServiceLineEditorNumber(startZ));
    setServiceLineDraftEndZ(formatServiceLineEditorNumber(endZ));
  }, [
    drawElementType,
    drawMode,
    drawPoints,
    elementsById,
    selection,
    serviceLineDraftEndZ,
    serviceLineDraftStartZ,
    serviceLineDrawBaseZ,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const getTransparentRoofHostPatch = useCallback(
    (coordinates: Array<{ x: number; y: number; z: number }>): { parent_element: string } | Record<string, never> => {
      const roofId = findHostRoofId({ coordinates }, elementsById as Record<string, Element>);
      const roof = roofId ? elementsById[roofId] : undefined;
      return roof?.name ? { parent_element: roof.name } : {};
    },
    [elementsById],
  );

  const updateElement = useGeometryStore((s) => s.updateElement);
  const updateElementFromElementRenderer = useCallback<typeof updateElement>(
    (id, updates, skipAutoSave) => {
      markNextGeometryCanvasRender('ElementRenderer.updateElement');
      return updateElement(id, updates, skipAutoSave);
    },
    [markNextGeometryCanvasRender, updateElement],
  );
  const removeElement = useGeometryStore((s) => s.removeElement);
  const commitVertexPositionUpdates = useGeometryStore((s) => s.commitVertexPositionUpdates);
  const removeFloor = useGeometryStore((s) => s.removeFloor);
  const updateFloor = useGeometryStore((s) => s.updateFloor);
  const undo = useGeometryStore((s) => s.undo);
  const redo = useGeometryStore((s) => s.redo);
  const createPlaceholderZone = useGeometryStore((s) => s.createPlaceholderZone);
  const createPlaceholderElement = useGeometryStore((s) => s.createPlaceholderElement);
  const setSnapToParent = useGeometryStore((s) => s.setSnapToParent);
  const ensureFloorForZ = useGeometryStore((s) => s.ensureFloorForZ);
  const setCurrentFloorZ = useGeometryStore((s) => s.setCurrentFloorZ);
  const setCurrentFloor = useGeometryStore((s) => s.setCurrentFloor);
  const setSelectedElementIds = useGeometryStore((s) => s.setSelectedElementIds);
  const clearElementSelection = useGeometryStore((s) => s.clearElementSelection);
  const setSpaceLabellerSelectedLabelId = useGeometryStore((s) => s.setSpaceLabellerSelectedLabelId);
  const updateSpaceLabel = useGeometryStore((s) => s.updateSpaceLabel);
  const syncDevelopmentContextShading = useGeometryStore((s) => s.syncDevelopmentContextShading);
  const selectAllElementsOnCurrentFloor = useGeometryStore((s) => s.selectAllElementsOnCurrentFloor);
  const setGuideOverlay = useGeometryStore((s) => s.setGuideOverlay);
  const setGuideOverlaySource = useGeometryStore((s: any) => s.setGuideOverlaySource);
  const updateGuideOverlay = useGeometryStore((s) => s.updateGuideOverlay);
  const clearGuideOverlay = useGeometryStore((s) => s.clearGuideOverlay);
  const resetGuideOverlayForActiveFloor = useGeometryStore((s) => s.resetGuideOverlayForActiveFloor);
  const setVertexSnapMode = useGeometryStore((s) => s.setVertexSnapMode);
  const setDefaultsJson = useGeometryStore((s) => s.setDefaultsJson);
  const setDefaultsLoading = useGeometryStore((s) => s.setDefaultsLoading);
  const setBundledAssemblyLibrary = useGeometryStore((s) => s.setBundledAssemblyLibrary);
  const setBundledAssemblyLibraryLoading = useGeometryStore((s) => s.setBundledAssemblyLibraryLoading);
  const setBundledAssemblyLibraryError = useGeometryStore((s) => s.setBundledAssemblyLibraryError);
  const { elementCategoryGhostState, toggleCategoryGhost } = useElementCategoryGhost();
  const { hiddenElementIds, toggleElementsHidden, unhideElement } = useHiddenElementIds(
    documentFileName,
    elementIds,
  );

  /** Cmd+A selects filtered rows when the elements panel has search or validation filter active. */
  const elementsPanelCmdASelectIdsRef = useRef<(() => string[] | null) | null>(null);

  const selectAllElementsRespectingPanelFilter = useCallback(() => {
    const getFilteredIds = elementsPanelCmdASelectIdsRef.current;
    const filteredIds = getFilteredIds?.() ?? null;
    if (filteredIds === null) {
      selectAllElementsOnCurrentFloor();
      return;
    }
    const onFloor = filteredIds.filter((id) => {
      const el = elementsById[id];
      return el && isElementOnActiveCanvasFloor(el, currentFloorZ, floors);
    });
    setSelectedElementIds(onFloor);
  }, [selectAllElementsOnCurrentFloor, setSelectedElementIds, elementsById, currentFloorZ, floors]);

  const isElementHiddenOnView = useCallback(
    (el: Element) => elementIsHiddenFromView(el, elementCategoryGhostState, hiddenElementIds),
    [elementCategoryGhostState, hiddenElementIds],
  );
  const hoveredElement = hoveredElementId ? elementsById[hoveredElementId] : undefined;
  const elementHover = hoveredElement && !isElementHiddenOnView(hoveredElement)
    ? hoveredElementId
    : null;

  const elementCategoryVisibilityKey = useMemo(
    () =>
      JSON.stringify(elementCategoryGhostState) + '|' + [...hiddenElementIds].sort().join(','),
    [elementCategoryGhostState, hiddenElementIds],
  );

  const projectContextSnapshot = useSyncExternalStore(
    projectContextPort.subscribe,
    projectContextPort.getSnapshot,
    projectContextPort.getSnapshot,
  );
  const workspaceProjects = useMemo(
    () => projectContextSnapshot.status === 'ready' ? projectContextSnapshot.projects : [],
    [projectContextSnapshot],
  );
  const selectedProjectId = projectContextSnapshot.status === 'ready'
    ? projectContextSnapshot.selectedProjectId
    : null;
  const geometryListFilter = projectContextSnapshot.status === 'ready'
    ? projectContextSnapshot.geometryListFilter
    : 'all';
  const currentBaseModelStem = useMemo(
    () => normalizeBaseModelStem(documentFileName),
    [documentFileName],
  );
  const activeDevelopmentProject = useMemo(
    () => resolveDevelopmentContextProject({
      projects: workspaceProjects,
      selectedProjectId,
      geometryListFilter,
      currentStem: currentBaseModelStem,
      draftProjectContextId: fileControls?.draftProjectContextId ?? null,
    }),
    [
      workspaceProjects,
      selectedProjectId,
      geometryListFilter,
      currentBaseModelStem,
      fileControls?.draftProjectContextId,
    ],
  );
  const developmentContextStems = useMemo(
    () => activeDevelopmentProject
      ? getDevelopmentContextStems(activeDevelopmentProject, currentBaseModelStem)
      : [],
    [activeDevelopmentProject, currentBaseModelStem],
  );
  const developmentContextLoadKey = useMemo(
    () => [
      activeDevelopmentProject?.id ?? 'none',
      currentBaseModelStem,
      ...developmentContextStems,
    ].join('\u0000'),
    [activeDevelopmentProject?.id, currentBaseModelStem, developmentContextStems],
  );
  const developmentContextCanLoad = !!activeDevelopmentProject
    && developmentContextStems.length > 0
    && projectContextSnapshot.status === 'ready';
  const developmentContextStateKey = [
    developmentContextLoadKey,
    projectContextSnapshot.status,
  ].join('\0');
  const initialDevelopmentContextState = useMemo(() => ({
    models: [] as DevelopmentContextModel[],
    loadedKey: activeDevelopmentProject && developmentContextStems.length === 0
      ? developmentContextLoadKey
      : null,
  }), [activeDevelopmentProject, developmentContextLoadKey, developmentContextStems.length]);
  const [developmentContextState, setDevelopmentContextState] = useKeyedState(
    developmentContextStateKey,
    initialDevelopmentContextState,
  );
  const developmentContextModels = developmentContextState.models;
  const developmentContextModelsLoadedKey = developmentContextState.loadedKey;

  useEffect(() => {
    let cancelled = false;
    if (!developmentContextCanLoad) return;

    Promise.all(
      developmentContextStems.map(async (stem) => {
        try {
          const csv = await projectContextPort.loadModelText(stem);
          return {
            model: parseDevelopmentContextModel(stem, csv),
            error: null,
          };
        } catch (error) {
          return {
            model: null,
            error: {
              stem,
              message: formatDevelopmentContextError(error),
            },
          };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const models = results
        .map((result) => result.model)
        .filter((model): model is DevelopmentContextModel => Boolean(model));
      const errors = results
        .map((result) => result.error)
        .filter((error): error is DevelopmentContextLoadError => Boolean(error));
      setDevelopmentContextState({ models, loadedKey: developmentContextLoadKey });
      if (errors.length > 0) {
        console.warn('[GeometryCanvas] Failed to load development context models', errors);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeDevelopmentProject,
    developmentContextCanLoad,
    developmentContextLoadKey,
    developmentContextStems,
    projectContextPort,
    projectContextSnapshot.status,
    setDevelopmentContextState,
  ]);

  useEffect(() => {
    if (
      !activeDevelopmentProject ||
      !currentBaseModelStem ||
      developmentContextModelsLoadedKey !== developmentContextLoadKey
    ) {
      return;
    }
    syncDevelopmentContextShading({
      projectId: activeDevelopmentProject.id,
      activeStem: currentBaseModelStem,
      contextModels: developmentContextModels,
    });
  }, [
    activeDevelopmentProject,
    currentBaseModelStem,
    developmentContextModels,
    developmentContextModelsLoadedKey,
    developmentContextLoadKey,
    elementIds,
    elementsById,
    floors,
    zones,
    complianceSettings,
    syncDevelopmentContextShading,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (workspaceResourcePort.availability !== 'available') {
      setBundledAssemblyLibrary(null);
      setBundledAssemblyLibraryError(null);
      setBundledAssemblyLibraryLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setBundledAssemblyLibraryLoading(true);
    setBundledAssemblyLibraryError(null);
    loadBundledAssemblyLibrary(workspaceResourcePort)
      .then((lib) => {
        if (!cancelled) {
          setBundledAssemblyLibrary(lib);
          setBundledAssemblyLibraryError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setBundledAssemblyLibrary(null);
          setBundledAssemblyLibraryError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setBundledAssemblyLibraryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    setBundledAssemblyLibrary,
    setBundledAssemblyLibraryError,
    setBundledAssemblyLibraryLoading,
    workspaceResourcePort,
  ]);

  /** 3D hit-testing updates both selection and `selectedElementIds` so multi-select works in 2D and 3D. */
  const handle3DSelectionChange = useCallback(
    (sel: GeometryCanvasSelection, additive = false) => {
      if ((sel?.type === 'element' || sel?.type === 'dormer') && sel.id) {
        const anchor =
          sel.type === 'dormer'
            ? getDormerBundleAnchorElement(elementsById, sel.id)
            : elementsById[sel.id];
        if (!anchor || !isElementOnActiveCanvasFloor(anchor, currentFloorZ, floors)) {
          return;
        }
        const bundleSelectionIds =
          sel.type === 'dormer'
            ? getDormerBundleElementIds(elementsById, sel.id)
            : getDormerBundleSelectionIds(sel.id, elementsById);
        if (additive) {
          const isFullySelected = bundleSelectionIds.every((id) => selectedElementIds.includes(id));
          const nextSelectedIds = isFullySelected
            ? selectedElementIds.filter((id) => !bundleSelectionIds.includes(id))
            : Array.from(new Set([...selectedElementIds, ...bundleSelectionIds]));
          setSelectedElementIds(nextSelectedIds);
          if (nextSelectedIds.length === 0) {
            setSelection(null);
            return;
          }
          if (isFullySelected) {
            const fallbackId = nextSelectedIds[nextSelectedIds.length - 1];
            setSelection(fallbackId ? getSelectionForElementId(fallbackId, elementsById) : null);
            return;
          }
        } else {
          setSelectedElementIds(bundleSelectionIds);
        }
      } else if (sel === null) {
        clearElementSelection();
      }
      setSelection(sel);
    },
    [clearElementSelection, currentFloorZ, elementsById, floors, selectedElementIds, setSelectedElementIds, setSelection],
  );

  /** Elements panel double-click in 3D — orbit camera to frame the element (2D uses panOffset instead). */
  const [frame3dRequest, setFrame3dRequest] = useState<{ elementId: string; nonce: number } | null>(null);
  const handleFrameElementIn3D = useCallback((elementId: string) => {
    setFrame3dRequest({ elementId, nonce: Date.now() });
  }, []);

  /** Clears 3D “frame element” request after the camera move so edits don’t re-trigger framing. */
  const clearFrame3dRequest = useCallback(() => {
    setFrame3dRequest(null);
  }, []);

  // Load defaults JSON from the user's defaultsPath into the store (shared by all consumers)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (workspaceResourcePort.availability !== 'available') return;
      const candidate = (defaultsPath || '').trim();
      if (!candidate) {
        if (!cancelled) {
          setDefaultsJson(null);
          setDefaultsLoading(false);
        }
        return;
      }
      if (!cancelled) setDefaultsLoading(true);
      try {
        const content = await workspaceResourcePort.readText(candidate);
        if (!cancelled) {
          const parsed = JSON.parse(content);
          setDefaultsJson(parsed);
          setDefaultsLoading(false);
        }
      } catch (error) {
        console.warn('[GeometryCanvas] Failed to load defaults from', candidate, error);
        if (!cancelled) {
          setDefaultsJson(null);
          setDefaultsLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [
    defaultsPath,
    setDefaultsJson,
    setDefaultsLoading,
    workspaceResourcePort,
  ]);

  useEffect(() => {
    sourceComparisonPort.refresh(defaultsJson);
  }, [
    sourceComparisonPort,
    sourceComparisonSnapshot.inputRevision,
    defaultsJson,
    zones,
    complianceSettings,
    elementsById,
    elementIds,
  ]);

  const elementsForValidation = useMemo(() => Object.values(elementsById), [elementsById]);
  const sharedElementValidationContext = useMemo<ValidationContext>(() => {
    const complianceOn = !!complianceSettings?.complianceValidationEnabled;
    return {
      schemaPort,
      elementsById,
      zones,
      floors,
      complianceValidationEnabled: complianceOn,
      complianceSettings,
      numberOfBedrooms: complianceSettings?.NumberOfBedrooms,
      calculateContextShadingDistance,
      defaultsLoading,
      defaultsLookup,
      junctionPsiWorkspaceByType:
        junctionPsiDefaultsPath && junctionPsiDefaultsPath.trim() !== ''
          ? junctionPsiDefaultsMap
          : undefined,
      linearThermalBridgeIssues: findLinearThermalBridgeIssues(elementsForValidation),
      partFFindings: complianceOn
        ? selectPartFData({
            zones,
            elementsById,
            spaceLabelsById,
            spaceLabelIds,
            complianceSettings,
            elements: elementsForValidation,
            defaults: defaultsJson,
            defaultsLookup,
          }).findings
        : undefined,
    };
  }, [
    calculateContextShadingDistance,
    complianceSettings,
    defaultsLoading,
    defaultsJson,
    defaultsLookup,
    elementsById,
    elementsForValidation,
    floors,
    junctionPsiDefaultsMap,
    junctionPsiDefaultsPath,
    schemaPort,
    spaceLabelIds,
    spaceLabelsById,
    zones,
  ]);

  // Deduplicate element validation calls within a geometry state snapshot while reusing
  // model-wide validation inputs that are identical for every element row.
  const validationById = useMemo(
    () => new Map(
      elementIds.map((id) => {
        const element = elementsById[id];
        return [id, validateElementCore(element, sharedElementValidationContext)] as const;
      }),
    ),
    [elementIds, elementsById, sharedElementValidationContext],
  );
  const getValidation = useCallback(
    (el: Element) => validationById.get(el.id) ?? validateElementCore(el, sharedElementValidationContext),
    [sharedElementValidationContext, validationById],
  );

  const overlayFileInputRef = useRef<HTMLInputElement>(null);

  const activeGeometrySnapCache = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.activeGeometrySnapCache', () =>
      buildGeometrySnapCache(elementsById as any),
    );
  }, [elementsById]);

  const developmentContextSnapCache = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.developmentContextSnapCache', () =>
      buildDevelopmentContextSnapCache(developmentContextModels, currentFloorZ, floors),
    );
  }, [developmentContextModels, currentFloorZ, floors]);

  const geometrySnapCache = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.geometrySnapCache', () =>
      mergeGeometrySnapCaches(activeGeometrySnapCache, developmentContextSnapCache),
    );
  }, [activeGeometrySnapCache, developmentContextSnapCache]);

  const spaceLabelSnapCache = useMemo<GeometrySnapCache>(() => {
    if (!spaceLabellerOpen || !spaceLabellerZoneId) return geometrySnapCache;
    const cornerTargets = [...geometrySnapCache.cornerTargets];
    const wallSegments = [...geometrySnapCache.wallSegments];
    let cornerOrder = cornerTargets.length;
    let wallOrder = wallSegments.length;
    for (const slId of spaceLabelIds) {
      const label = spaceLabelsById[slId];
      if (!label || label.zoneId !== spaceLabellerZoneId) continue;
      const coords = label.coordinates ?? [];
      if (coords.length < 2) continue;
      const snapId = `space-label:${label.id}`;
      coords.forEach((coord) => {
        cornerTargets.push({
          elementId: snapId,
          order: cornerOrder++,
          x: coord.x,
          y: coord.y,
          z: coord.z,
        });
      });
      if (coords.length >= 3) {
        for (let i = 0; i < coords.length; i++) {
          wallSegments.push({
            elementId: snapId,
            elementName: label.name,
            order: wallOrder++,
            A: coords[i]!,
            B: coords[(i + 1) % coords.length]!,
          });
        }
      }
    }
    return buildGeometrySnapCacheFromTargets(cornerTargets, wallSegments);
  }, [geometrySnapCache, spaceLabellerOpen, spaceLabellerZoneId, spaceLabelIds, spaceLabelsById]);

  // Konva can keep a stale scene bitmap until the next input (e.g. pan). After category hide/show,
  // force all layers to redraw so 2D visibility updates immediately.
  useLayoutEffect(() => {
    const w = stageRef.current;
    if (!w) return;
    const stage = typeof w.getStage === 'function' ? w.getStage() : w;
    if (!stage || typeof (stage as any).getLayers !== 'function') return;
    for (const layer of (stage as any).getLayers() as Array<{ batchDraw: () => void }>) {
      layer.batchDraw();
    }
  }, [elementCategoryVisibilityKey]);

  const filebarRef = useRef<HTMLDivElement>(null);
  const drawToolbarRef = useRef<HTMLDivElement>(null);
  const overlayGuidePanelRef = useRef<HTMLDivElement>(null);

  const {
    setDetailsMode,
    detailsRect,
    setDetailsRect,
    elementsRect,
    setElementsRect,
    activePanel,
    setActivePanel,
    clampElementsRectToCanvas,
    getElementsDefaultRect,
    clampRectToCanvas,
    getDetailsDefaultRect,
  } = usePanelLayout(stageSize, containerRef, initialElementsPanelPlacement);

  const openSpaceLabellerStore = useGeometryStore((s) => s.openSpaceLabeller);
  const closeSpaceLabellerStore = useGeometryStore((s) => s.closeSpaceLabeller);

  const handleOpenSpaceLabeller = useCallback(
    (zoneId: string) => {
      resetDrawing();
      setDrawMode('none');
      setActivePanel('details');
      setDetailsMode('docked');
      openSpaceLabellerStore(zoneId);
    },
    [resetDrawing, setDrawMode, setActivePanel, setDetailsMode, openSpaceLabellerStore],
  );

  const [spaceLabellerExpandLabelId, setSpaceLabellerExpandLabelId] = useState<string | null>(null);
  const handleSpaceLabellerExpandLabelConsumed = useCallback(() => {
    setSpaceLabellerExpandLabelId(null);
  }, [setSpaceLabellerExpandLabelId]);

  const handleSpaceLabellerClose = useCallback(() => {
    resetDrawing();
    setDrawMode('none');
    setSpaceLabellerExpandLabelId(null);
    closeSpaceLabellerStore();
  }, [resetDrawing, setDrawMode, setSpaceLabellerExpandLabelId, closeSpaceLabellerStore]);

  const handleStartDrawSpaceLabelFootprint = useCallback(() => {
    clearElementSelection();
    setSelection(null);
    setSelectedSpaceLabelVertex(null);
    spaceLabelHoverPointRef.current = null;
    setSpaceLabelHoverPoint(null);
    setDrawPoints([]);
    setDrawMode('space-label-polygon');
  }, [clearElementSelection, setSelection, setSelectedSpaceLabelVertex, setSpaceLabelHoverPoint, setDrawMode, setDrawPoints]);

  const handleCancelDrawSpaceLabelFootprint = useCallback(() => {
    spaceLabelHoverPointRef.current = null;
    setSpaceLabelHoverPoint(null);
    setDrawPoints([]);
    setDrawMode('none');
  }, [setDrawMode, setDrawPoints]);

  const setSpaceLabelHoverPointIfChanged = useCallback((next: { x: number; y: number; insertIndex: number } | null) => {
    const prev = spaceLabelHoverPointRef.current;
    const same =
      (!prev && !next) ||
      (!!prev &&
        !!next &&
        prev.insertIndex === next.insertIndex &&
        Math.hypot(prev.x - next.x, prev.y - next.y) < 0.02);
    if (same) return;
    spaceLabelHoverPointRef.current = next;
    setSpaceLabelHoverPoint(next);
  }, []);

  const resolveSpaceLabelVertexDragPoint = useCallback((
    labelId: string,
    coords: SpaceLabel['coordinates'],
    vertexIndex: number,
    rawWorld: { x: number; y: number },
    orthogonalModifierHeld: boolean,
  ) => {
    const previous = coords[(vertexIndex + coords.length - 1) % coords.length];
    const pd = getProjectDefaults(geometryStore);
    return utilResolveDrawSnapPoint({
      mouseWorld: rawWorld,
      lastPoint: previous ? { x: previous.x, y: previous.y } : null,
      elementsById: elementsById as any,
      snapCache: spaceLabelSnapCache,
      excludeElementId: `space-label:${labelId}`,
      snapTol: pd.snapTol,
      orthogonalModifierHeld,
      angleTolDeg: pd.angleTol,
    }).point;
  }, [elementsById, geometryStore, spaceLabelSnapCache]);

  const getConnectedSpaceLabelVertices = useCallback((
    label: SpaceLabel,
    vertexIndex: number,
  ) => {
    const source = label.coordinates[vertexIndex];
    if (!source) return [];
    const exactTol = 0.005;
    const connected: Array<{
      labelId: string;
      vertexIndex: number;
      coordinates: SpaceLabel['coordinates'];
    }> = [];
    for (const otherId of spaceLabelIds) {
      if (otherId === label.id) continue;
      const other = spaceLabelsById[otherId];
      if (!other || other.zoneId !== label.zoneId || other.coordinates.length < 3) continue;
      for (let i = 0; i < other.coordinates.length; i++) {
        const c = other.coordinates[i];
        if (
          Math.abs((c.z ?? 0) - (source.z ?? 0)) <= 0.05 &&
          Math.hypot(c.x - source.x, c.y - source.y) <= exactTol
        ) {
          connected.push({
            labelId: other.id,
            vertexIndex: i,
            coordinates: other.coordinates,
          });
        }
      }
    }
    return connected;
  }, [spaceLabelIds, spaceLabelsById]);

  const [filebarPosition, setFilebarPosition] = useState<OverlayPosition>(null);

  const [drawToolbarPosition, setDrawToolbarPosition] = useState<OverlayPosition>(null);
  const [compassRect, setCompassRect] = useState(COMPASS_PANEL_DEFAULT);
  const [compassAutoPosition, setCompassAutoPosition] = useState(true);
  const [compassMinY, setCompassMinY] = useState(COMPASS_PANEL_DEFAULT.y);
  const [contributedPanelPositions, setContributedPanelPositions] =
    useState<CanvasPanelPositions>({});

  const getOverlaySafeTopPx = useCallback(() => {
    const canvasEl = (containerRef.current?.closest('.geometry-canvas') as HTMLElement | null) ?? null;
    return getGeometryCanvasOverlaySafeTopPx(canvasEl);
  }, []);

  const clampOverlayPosition = useCallback(
    (overlayEl: HTMLElement | null, position: { x: number; y: number }, minY: number) => {
      const canvasEl = (overlayEl?.closest('.geometry-canvas') as HTMLElement | null) ?? null;
      if (!canvasEl || !overlayEl) {
        return { x: Math.max(0, Math.round(position.x)), y: Math.max(minY, Math.round(position.y)) };
      }
      const containerBounds = canvasEl.getBoundingClientRect();
      const overlayBounds = overlayEl.getBoundingClientRect();
      const maxX = Math.max(0, Math.round(containerBounds.width - overlayBounds.width));
      const maxY = Math.max(minY, Math.round(containerBounds.height - overlayBounds.height));
      return {
        x: Math.max(0, Math.min(Math.round(position.x), maxX)),
        y: Math.max(minY, Math.min(Math.round(position.y), maxY)),
      };
    },
    []
  );

  const beginOverlayDrag = useCallback(
    (
      event: React.MouseEvent<HTMLDivElement>,
      overlayEl: HTMLElement | null,
      setPosition: (position: CanvasPanelPosition) => void,
      minY: number
    ) => {
      if (event.button !== 0 || !overlayEl) return;
      event.preventDefault();
      event.stopPropagation();

      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const startOffsetX = overlayEl.offsetLeft;
      const startOffsetY = overlayEl.offsetTop;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const next = clampOverlayPosition(
          overlayEl,
          {
            x: startOffsetX + (moveEvent.clientX - startClientX),
            y: startOffsetY + (moveEvent.clientY - startClientY),
          },
          minY
        );
        setPosition(next);
      };

      const handleMouseUp = () => {
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [clampOverlayPosition]
  );

  const handleFilebarDragHandleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      beginOverlayDrag(event, filebarRef.current, setFilebarPosition, getOverlaySafeTopPx());
    },
    [beginOverlayDrag, getOverlaySafeTopPx],
  );
  const resetFilebarPosition = useCallback(() => {
    setFilebarPosition(null);
  }, [setFilebarPosition]);

  const drawToolbarStyle = useMemo<React.CSSProperties | undefined>(
    () => (
      drawToolbarPosition
        ? { left: drawToolbarPosition.x, top: drawToolbarPosition.y, bottom: 'auto' }
        : undefined
    ),
    [drawToolbarPosition],
  );
  const handleDrawToolbarDragHandleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => (
      beginOverlayDrag(event, drawToolbarRef.current, setDrawToolbarPosition, 12)
    ),
    [beginOverlayDrag],
  );
  const resetDrawToolbarPosition = useCallback(() => {
    setDrawToolbarPosition(null);
  }, []);
  const showDrawToolbarAutoTbSuggest =
    viewMode === '2d' &&
    (drawElementType === 'ThermalBridgeLinear' || drawElementType === 'ThermalBridgePoint');
  const handleShowAutoTbPreview = useCallback(() => {
    setShowAutoTbPreview(true);
  }, []);
  const drawToolbarDragHandle = (
    <div
      role="button"
      tabIndex={0}
      aria-label="Move draw toolbar"
      className="panel-drag-handle overlay-panel-drag-handle"
      title="Drag to move • Double-click to reset"
      onMouseDown={handleDrawToolbarDragHandleMouseDown}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        resetDrawToolbarPosition();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          resetDrawToolbarPosition();
        }
      }}
    >
      <span className="panel-drag-handle-dots" aria-hidden="true" />
    </div>
  );
  const renderDrawToolbarLeadingAccessory = useCallback(() => (
    <DrawToolbarAutoTbSuggest
      show={showDrawToolbarAutoTbSuggest}
      onPrefetch={prefetchAutoThermalBridgePreviewModal}
      onShow={handleShowAutoTbPreview}
    />
  ), [handleShowAutoTbPreview, showDrawToolbarAutoTbSuggest]);

  const clampCompassPosition = useCallback((position: { x: number; y: number }) => {
    const clamped = clampRectToCanvas({
      x: position.x,
      y: position.y,
      width: COMPASS_PANEL_DEFAULT.width,
      height: COMPASS_PANEL_DEFAULT.height,
    });
    return {
      x: clamped.x,
      y: Math.max(compassMinY, clamped.y),
    };
  }, [clampRectToCanvas, compassMinY]);

  useEffect(() => {
    const updateCompassAnchors = () => {
      if (!containerRef.current || !filebarRef.current) return;
      const filebarBounds = filebarRef.current.getBoundingClientRect();
      const filebarHeight = Math.round(filebarBounds.height);
      const overlaySafeTop = getOverlaySafeTopPx();
      const nextMinY = Math.max(
        overlaySafeTop,
        overlaySafeTop + filebarHeight + COMPASS_FILEBAR_GAP,
      );

      setCompassMinY(nextMinY);
      if (compassAutoPosition) {
        setCompassRect((prev) => ({
          ...prev,
          ...clampCompassPosition({ x: COMPASS_PANEL_DEFAULT.x, y: nextMinY }),
          width: COMPASS_PANEL_DEFAULT.width,
          height: COMPASS_PANEL_DEFAULT.height,
        }));
      } else {
        setCompassRect((prev) => ({
          ...prev,
          ...clampCompassPosition({ x: prev.x, y: prev.y }),
          width: COMPASS_PANEL_DEFAULT.width,
          height: COMPASS_PANEL_DEFAULT.height,
        }));
      }
    };

    updateCompassAnchors();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateCompassAnchors);
      return () => {
        window.removeEventListener('resize', updateCompassAnchors);
      };
    }

    const observer = new ResizeObserver(() => {
      updateCompassAnchors();
    });
    if (containerRef.current) observer.observe(containerRef.current);
    if (filebarRef.current) observer.observe(filebarRef.current);

    return () => {
      observer.disconnect();
    };
  }, [clampCompassPosition, compassAutoPosition, getOverlaySafeTopPx]);

  useEffect(() => {
    if (filebarPosition && filebarRef.current) {
      setFilebarPosition((prev) => {
        if (!prev || !filebarRef.current) return prev;
        const clamped = clampOverlayPosition(filebarRef.current, prev, getOverlaySafeTopPx());
        if (clamped.x === prev.x && clamped.y === prev.y) return prev;
        return clamped;
      });
    }
    if (drawToolbarPosition && drawToolbarRef.current) {
      setDrawToolbarPosition((prev) => {
        if (!prev || !drawToolbarRef.current) return prev;
        const clamped = clampOverlayPosition(drawToolbarRef.current, prev, 12);
        if (clamped.x === prev.x && clamped.y === prev.y) return prev;
        return clamped;
      });
    }
  }, [
    stageSize.width,
    stageSize.height,
    filebarPosition,
    drawToolbarPosition,
    clampOverlayPosition,
    getOverlaySafeTopPx,
  ]);

  // Update stage size when container resizes
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // Fill the container exactly; parent will control viewport size
        setStageSize({
          width: Math.max(0, rect.width),
          height: Math.max(0, rect.height)
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Modal handlers
  const handleZoneDelete = useCallback(() => {
    if (!selection || selection.type !== 'zone' || !selection.id) return;

    const zone = geometryStore.getState().zones.find(z => z.id === selection.id);
    if (!zone) return;

    const childElements = Object.values(geometryStore.getState().elementsById).filter(e => e.zoneId === selection.id);

    setZoneDeleteModal({
      isOpen: true,
      zoneId: selection.id,
      zoneName: zone.name,
      childElements: childElements.map(e => ({ name: e.name, type: e.type }))
    });
  }, [geometryStore, selection]);

  const handleConfirmZoneDelete = useCallback(() => {
    if (!zoneDeleteModal.zoneId) return;

    geometryStore.getState().removeZone(zoneDeleteModal.zoneId);
    setSelection(null);

    setZoneDeleteModal({ isOpen: false, zoneId: null, zoneName: null, childElements: [] });
  }, [geometryStore, setSelection, zoneDeleteModal.zoneId]);

  const handleCancelZoneDelete = useCallback(() => {
    setZoneDeleteModal({ isOpen: false, zoneId: null, zoneName: null, childElements: [] });
  }, []);

  const handleElementDelete = useCallback(() => {
    if (!selection || !selection.id) return;

    if (selection.type === 'dormer') {
      const bundleName =
        getDormerBundleName(getDormerBundleAnchorElement(elementsById, selection.id)) ?? 'Dormer';
      setElementDeleteModal({
        isOpen: true,
        elementId: selection.id,
        elementName: bundleName,
        isMultiDelete: true,
      });
      return;
    }

    if (selection.type !== 'element') return;

    const element = elementsById[selection.id];
    if (!element) return;

    setElementDeleteModal({
      isOpen: true,
      elementId: selection.id,
      elementName: element.name
    });
  }, [elementsById, selection, setElementDeleteModal]);

  const handleConfirmElementDelete = useCallback(() => {
    if (elementDeleteModal.isMultiDelete) {
      const idsToDelete =
        selection?.type === 'dormer' && elementDeleteModal.elementId
          ? getDormerBundleElementIds(elementsById, elementDeleteModal.elementId)
          : selectedElementIds;
      idsToDelete.forEach(id => geometryStore.getState().removeElement(id));
      clearElementSelection();
      setSelection(null);
      setElementDeleteModal({ isOpen: false, elementId: null, elementName: null, isMultiDelete: false });
    } else if (elementDeleteModal.elementId) {
      // Handle single delete
      geometryStore.getState().removeElement(elementDeleteModal.elementId);
      setSelection(null);
      setElementDeleteModal({ isOpen: false, elementId: null, elementName: null, isMultiDelete: false });
    }
  }, [
    clearElementSelection,
    elementDeleteModal.elementId,
    elementDeleteModal.isMultiDelete,
    elementsById,
    geometryStore,
    selectedElementIds,
    selection,
    setElementDeleteModal,
    setSelection,
  ]);

  const handleCancelElementDelete = useCallback(() => {
    setElementDeleteModal({ isOpen: false, elementId: null, elementName: null, isMultiDelete: false });
  }, [setElementDeleteModal]);

  // Close overlap badge menu when clicking outside
  useEffect(() => {
    if (!overlapBadgeMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.overlap-badge-menu')) {
        setOverlapBadgeMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [overlapBadgeMenu]);

  // Calculate canvas center
  const canvasCenter = useMemo(() => ({
    x: stageSize.width / 2,
    y: stageSize.height / 2
  }), [stageSize.width, stageSize.height]);
  const overlapBadgeMenuLayerStyle = overlapBadgeMenu
    ? getOverlapBadgeMenuLayerStyle(overlapBadgeMenu.anchor, { scale, panOffset, canvasCenter })
    : null;

  const {
    showOverlayPanel,
    setShowOverlayPanel,
    overlayMoveMode,
    setOverlayMoveMode,
    overlayCalibrateMode,
    setOverlayCalibrateMode,
    overlayImg,
    overlayMoveRAFRef,
    setOverlayIsDragging,
    overlayHintCanvasPos,
    setOverlayHintCanvasPos,
    overlayCalFirstRef,
    overlayCalSecondCanvas,
    setOverlayCalSecondCanvas,
    overlayCalHoverCanvas,
    setOverlayCalHoverCanvas,
    overlayCalSecondRef,
    overlayCalDistPxRef,
    overlayCalRealM,
    setOverlayCalRealM,
    overlayCalStep,
    setOverlayCalStep,
    overlayHintText,
    handleOverlayFileChosen,
    clearOverlayFiles,
    overlayPdfImportState,
    setOverlayPdfImportPage,
    cancelOverlayPdfImport,
    confirmOverlayPdfImport,
  } = useOverlay({
    workspaceResourcePort,
    guideOverlay,
    guideOverlaySource,
    guideOverlayByFloor,
    guideOverlaySourceByFloor,
    setGuideOverlay,
    setGuideOverlaySource,
    updateGuideOverlay,
    clearGuideOverlayAllFloors: clearGuideOverlay,
    scale,
    panOffset,
    canvasCenter,
    stageSize,
    uploadOverlayEvidence,
    onBeforeEnterCalibrateMode: resetDrawing,
  });
  const guideOverlayCalibrationSessionRef = useRef<CanvasInteractionSession | null>(null);
  const resetGuideOverlayCalibrationPointerState = useCallback(() => {
    overlayCalFirstRef.current = null;
    overlayCalSecondRef.current = null;
    overlayCalDistPxRef.current = null;
    setOverlayCalSecondCanvas(null);
    setOverlayCalHoverCanvas(null);
    setOverlayCalStep(0);
    setOverlayHintCanvasPos(null);
  }, [
    overlayCalDistPxRef,
    overlayCalFirstRef,
    overlayCalSecondRef,
    setOverlayCalHoverCanvas,
    setOverlayCalSecondCanvas,
    setOverlayCalStep,
    setOverlayHintCanvasPos,
  ]);
  const beginGuideOverlayCalibrationInteraction = useCallback(() => {
    if (guideOverlayCalibrationSessionRef.current?.isActive()) return true;
    const session = beginCanvasInteraction({
      kind: 'guide-overlay-drag',
      targetId: 'guide-overlay-calibrate',
      onCancel: resetGuideOverlayCalibrationPointerState,
    });
    if (!session) return false;
    guideOverlayCalibrationSessionRef.current = session;
    return true;
  }, [resetGuideOverlayCalibrationPointerState]);
  const completeGuideOverlayCalibrationInteraction = useCallback((commit: boolean) => {
    const session = guideOverlayCalibrationSessionRef.current;
    guideOverlayCalibrationSessionRef.current = null;
    if (!session) return;
    if (commit) {
      endCanvasInteraction(session, { committed: true });
    } else {
      cancelCanvasInteraction(session);
    }
  }, []);
  useEffect(() => {
    if (overlayCalibrateMode) return;
    completeGuideOverlayCalibrationInteraction(false);
  }, [completeGuideOverlayCalibrationInteraction, overlayCalibrateMode]);

  const contributedPanelDefaultPosition = useMemo(
    () => ({ x: CONTRIBUTED_PANEL_DEFAULT_X, y: compassMinY }),
    [compassMinY],
  );

  const canvasPanelAvailabilityContext = useMemo<GeometryCanvasPanelContext>(
    () => ({
      documentName: documentFileName || null,
      isProfileValidationEnabled: Boolean(complianceSettings?.complianceValidationEnabled),
      defaultPosition: contributedPanelDefaultPosition,
      position: contributedPanelDefaultPosition,
      beginDrag: () => {
        throw new Error('Canvas panel drag is unavailable during contribution resolution');
      },
      resetPosition: () => {
        throw new Error('Canvas panel reset is unavailable during contribution resolution');
      },
    }),
    [
      complianceSettings?.complianceValidationEnabled,
      contributedPanelDefaultPosition,
      documentFileName,
    ],
  );

  const hiddenContributedCanvasPanelIds = useMemo(
    () => new Set(
      editorContributions.canvasPanels
        .filter((panel) => hiddenPanels[contributionHidePanelKey(panel.id)])
        .map((panel) => panel.id),
    ),
    [editorContributions, hiddenPanels],
  );

  const availableContributedCanvasPanels = useMemo(
    () => resolveCanvasPanelContributions(
      editorContributions,
      canvasPanelAvailabilityContext,
    ),
    [canvasPanelAvailabilityContext, editorContributions],
  );

  const contributedCanvasPanelComposition = useMemo(
    () => projectCanvasPanelComposition(
      availableContributedCanvasPanels,
      hiddenContributedCanvasPanelIds,
    ),
    [availableContributedCanvasPanels, hiddenContributedCanvasPanelIds],
  );

  const availableContributedCanvasPanelIds = useMemo(
    () => new Set(availableContributedCanvasPanels.map((panel) => panel.id)),
    [availableContributedCanvasPanels],
  );

  const availableContributedPanelPositions = useMemo(
    () => pruneUnavailableCanvasPanelPositions(
      contributedPanelPositions,
      availableContributedCanvasPanelIds,
    ),
    [availableContributedCanvasPanelIds, contributedPanelPositions],
  );

  const canvasPanelContexts = useMemo(() => {
    const contexts = new Map<string, GeometryCanvasPanelContext>();

    for (const panel of availableContributedCanvasPanels) {
      contexts.set(panel.id, {
        documentName: documentFileName || null,
        isProfileValidationEnabled: Boolean(complianceSettings?.complianceValidationEnabled),
        defaultPosition: contributedPanelDefaultPosition,
        position: readCanvasPanelPosition(
          availableContributedPanelPositions,
          panel.id,
          contributedPanelDefaultPosition,
        ),
        beginDrag: (event, panelElement) => {
          beginOverlayDrag(
            event,
            panelElement,
            (position) => {
              setContributedPanelPositions((current) =>
                setCanvasPanelPosition(current, panel.id, position),
              );
            },
            compassMinY,
          );
        },
        resetPosition: () => {
          setContributedPanelPositions((current) =>
            resetCanvasPanelPosition(current, panel.id),
          );
        },
      });
    }

    return contexts;
  }, [
    availableContributedCanvasPanels,
    availableContributedPanelPositions,
    beginOverlayDrag,
    compassMinY,
    complianceSettings?.complianceValidationEnabled,
    contributedPanelDefaultPosition,
    documentFileName,
    setContributedPanelPositions,
  ]);

  const panelHideOptions = useMemo<HidePanelOption[]>(
    () => [
      { key: 'file', label: 'File' },
      { key: 'compass', label: 'Compass' },
      { key: 'drawToolbar', label: 'Draw toolbar' },
      ...contributedCanvasPanelComposition.toggles.map((toggle) => ({
        key: contributionHidePanelKey(toggle.id),
        label: toggle.label,
      })),
    ],
    [contributedCanvasPanelComposition.toggles],
  );

  const hiddenPanelKeys = useMemo(
    () => new Set(
      (Object.keys(hiddenPanels) as HidePanelKey[]).filter((key) => hiddenPanels[key]),
    ),
    [hiddenPanels],
  );

  const togglePanelHidden = useCallback((key: HidePanelKey) => {
    setHiddenPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const hidePanels = useCallback((keys: readonly HidePanelKey[]) => {
    setHiddenPanels((prev) => {
      const next = { ...prev };
      keys.forEach((key) => {
        next[key] = true;
      });
      return next;
    });
  }, []);

  const showPanels = useCallback((keys: readonly HidePanelKey[]) => {
    setHiddenPanels((prev) => {
      const next = { ...prev };
      keys.forEach((key) => {
        next[key] = false;
      });
      return next;
    });
  }, []);

  // Close overlay guide panel when clicking outside the draw toolbar and the panel itself.
  // While Move or Calibrate is active, clicks target the canvas (outside both refs); do not dismiss.
  useEffect(() => {
    if (!showOverlayPanel) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (overlayMoveMode || overlayCalibrateMode) return;
      if (drawToolbarRef.current?.contains(t)) return;
      if (overlayGuidePanelRef.current?.contains(t)) return;
      setShowOverlayPanel(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [
    showOverlayPanel,
    setShowOverlayPanel,
    overlayMoveMode,
    overlayCalibrateMode,
  ]);

  const {
    marqueeSelection,
    setMarqueeSelection,
    marqueePreviewSignal,
    marqueeJustCompletedRef,
    handleMarqueeStart,
    handleMarqueeMove,
    handleMarqueeEnd,
  } = useMarqueeSelection({
    scale,
    panOffset,
    canvasCenter,
    elementsById,
    elementIds,
    drawMode,
    setSelection,
    setSelectedElementIds,
    updateElement,
    currentFloorZ,
    floors,
    overlayMoveMode,
    overlayCalibrateMode,
    orthogonalRoomStart,
    orthogonalRoomEnd,
    setOrthogonalRoomStart,
    setOrthogonalRoomEnd,
    setOrthogonalRoomEditing,
    createPlaceholderZone,
    createPlaceholderElement,
    drawElementType,
    setDrawMode,
    setCurrentFloorZ,
    zones,
    commitVertexPositionUpdates,
  });

  const tryPopLastDrawPoint = useCallback((): boolean => {
    if (drawMode === 'none' || drawMode === 'dormer' || drawMode === 'orthogonal-room') {
      return false;
    }
    if (drawMode === 'room') {
      if (roomWalls.length === 0) return false;
      if (roomWalls.length >= 2) {
        const lastWallId = roomWallElements[roomWallElements.length - 1];
        if (lastWallId) {
          removeElement(lastWallId);
        }
        setRoomWallElements((prev) => prev.slice(0, -1));
      }
      setRoomWalls((prev) => prev.slice(0, -1));
      setActiveSegmentEditor(null);
      setActiveServiceLineElementId(null);
      setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
      return true;
    }
    if (drawPoints.length === 0) {
      return false;
    }
    setDrawPoints((prev) => prev.slice(0, -1));
    setActiveSegmentEditor(null);
    setActiveServiceLineElementId(null);
    setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
    return true;
  }, [
    drawMode,
    roomWalls,
    roomWallElements,
    drawPoints,
    setDrawPoints,
    setRoomWalls,
    setRoomWallElements,
    removeElement,
    setActiveSegmentEditor,
    setActiveServiceLineElementId,
    setSegmentLengthPreview,
  ]);

  const setZenModeWithPanelCleanup = useCallback((
    value: boolean | ((previous: boolean) => boolean),
  ) => {
    const next = typeof value === 'function' ? value(zenMode) : value;
    if (next) {
      setShowShortcuts(false);
      setShowOverlayPanel(false);
    }
    setZenMode(next);
  }, [setShowOverlayPanel, zenMode]);

  useKeyboardShortcuts({
    setSelection,
    clearElementSelection,
    selectAllElementsOnCurrentFloor: selectAllElementsRespectingPanelFilter,
    setMarqueeSelection,
    drawMode,
    drawElementType,
    setDrawMode,
    setDrawPoints,
    setDrawCursor,
    setRoomWalls,
    setRoomWallElements,
    setOrthogonalRoomStart,
    setOrthogonalRoomEnd,
    resetDrawing,
    undo,
    redo,
    canUndo,
    canRedo,
    selection,
    selectedElementIds,
    elementsById,
    updateElement,
    hoverPoint,
    setHoverPoint,
    selectedVertex,
    setSelectedVertex,
    selectedSpaceLabelId: spaceLabellerSelectedLabelId,
    selectedSpaceLabelVertex,
    setSelectedSpaceLabelVertex,
    spaceLabelHoverPoint,
    setSpaceLabelHoverPoint: setSpaceLabelHoverPointIfChanged,
    spaceLabelsById,
    updateSpaceLabel,
    setScale,
    setPanOffset,
    setZenMode: setZenModeWithPanelCleanup,
    setElementDeleteModal,
    tryPopLastDrawPoint,
    fabricDrawShortcutsDisabled: spaceLabellerOpen,
  });

  // Incremental overlap detection: only recalculate overlaps for changed elements
  // Uses element _v version field to track changes and avoid O(n²) recalculation
  // Performance: O(n) for changed elements instead of O(n²) for all elements
  const previousElementVersionsRef = useRef<Map<string, number> | null>(null);
  const previousOverlapGroupsRef = useRef<Map<string, string[]> | null>(null);

  /* eslint-disable react-hooks/refs -- These refs are component-local incremental render caches; their values do not affect external state. */
  const overlapGroups = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.overlapGroups', () => {
    const snapTol = getProjectDefaults(geometryStore).snapTol;
    const previousElementVersions = previousElementVersionsRef.current ?? new Map<string, number>();
    const previousOverlapGroups = previousOverlapGroupsRef.current ?? new Map<string, string[]>();
    const currentVersions = new Map<string, number>();
    const newGroups = new Map<string, string[]>();
    const changedElementIds = new Set<string>();
    const removedElementIds = new Set<string>();
    const elementsToRecalculate = new Set<string>();

    // Build current version map and identify changed/removed elements
    const currentElementIds = new Set(Object.keys(elementsById));
    const previousElementIds = new Set(previousElementVersions.keys());

    for (const [id, element] of Object.entries(elementsById)) {
      const currentVersion = element._v ?? 0;
      currentVersions.set(id, currentVersion);

      const previousVersion = previousElementVersions.get(id);
      if (previousVersion === undefined || previousVersion !== currentVersion) {
        changedElementIds.add(id);
      }
    }

    // Identify removed elements (in previous but not current)
    for (const id of previousElementIds) {
      if (!currentElementIds.has(id)) {
        removedElementIds.add(id);
      }
    }

    // Identify elements that need recalculation:
    // 1. Changed elements (they might overlap with new elements)
    // 2. Removed elements' previous neighbors (they might no longer overlap)
    // 3. Elements that previously overlapped with changed/removed elements
    for (const changedId of changedElementIds) {
      elementsToRecalculate.add(changedId);

      // Add elements that previously overlapped with this changed element
      const previousOverlaps = previousOverlapGroups.get(changedId);
      if (previousOverlaps) {
        for (const overlappedId of previousOverlaps) {
          if (overlappedId !== changedId && currentElementIds.has(overlappedId)) {
            elementsToRecalculate.add(overlappedId);
          }
        }
      }
    }

    // Handle removed elements: recalculate their previous neighbors
    for (const removedId of removedElementIds) {
      const previousOverlaps = previousOverlapGroups.get(removedId);
      if (previousOverlaps) {
        for (const overlappedId of previousOverlaps) {
          if (overlappedId !== removedId && currentElementIds.has(overlappedId)) {
            elementsToRecalculate.add(overlappedId);
          }
        }
      }
    }

    // Copy unchanged overlaps from previous calculation
    for (const [id, previousGroup] of previousOverlapGroups.entries()) {
      if (!elementsToRecalculate.has(id) && elementsById[id]) {
        // Verify element still exists and hasn't been removed
        // Also verify all overlapped elements still exist
        const validGroup = previousGroup.filter(overlappedId => elementsById[overlappedId]);
        if (validGroup.length > 1) { // At least 2 elements (self + at least one other)
          newGroups.set(id, validGroup);
        }
      }
    }

    // Recalculate overlaps only for changed elements and their neighbors
    for (const elementId of elementsToRecalculate) {
      const element = elementsById[elementId];
      if (!element || !element.coordinates || element.coordinates.length === 0) {
        // Element was removed or has no coordinates, skip
        continue;
      }

      const overlapping = findOverlappingElements(element, elementsById, snapTol);
      if (overlapping.length > 0) {
        newGroups.set(elementId, [elementId, ...overlapping]);
      }
      // Note: if overlapping.length === 0, element no longer overlaps with anything
      // We don't add it to newGroups, effectively removing it
    }

    previousElementVersionsRef.current = currentVersions;
    previousOverlapGroupsRef.current = newGroups;

    return newGroups;
    });
  }, [elementsById, geometryStore]);
  /* eslint-enable react-hooks/refs */

  const activeSegmentEditorGeometry = useMemo(() => {
    if (!activeSegmentEditor || activeSegmentEditor.mode !== drawMode) {
      return null;
    }
    const points = activeSegmentEditor.mode === 'room' ? roomWalls : drawPoints;
    if (activeSegmentEditor.endIndex <= 0 || activeSegmentEditor.endIndex >= points.length) {
      return null;
    }
    const start = points[activeSegmentEditor.endIndex - 1];
    const end = points[activeSegmentEditor.endIndex];
    if (!start || !end) return null;
    return {
      start,
      end,
      midpoint: {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      },
      note: activeSegmentEditor.mode === 'sloped-polygon' ? 'plan m' : 'm',
    };
  }, [activeSegmentEditor, drawMode, roomWalls, drawPoints]);

  const activeSegmentEditorWidth = useMemo(() => {
    if (!activeSegmentEditor || !activeSegmentEditorGeometry) return null;
    const valueText = activeSegmentEditor.value || '';
    const noteText = activeSegmentEditorGeometry.note ? ` ${activeSegmentEditorGeometry.note}` : '';
    return getDrawModeTooltipPillWidth(`${valueText}${noteText}`);
  }, [activeSegmentEditor, activeSegmentEditorGeometry]);

  const applyActiveSegmentEditorLength = useCallback((requestedLength: number) => {
    if (!activeSegmentEditor || !activeSegmentEditorGeometry) return;
    if (!Number.isFinite(requestedLength) || requestedLength <= 0) return;

    const { start, end } = activeSegmentEditorGeometry;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const currentLength = Math.hypot(dx, dy);
    if (currentLength <= Number.EPSILON) return;

    const scaleFactor = requestedLength / currentLength;
    const nextEnd = {
      x: start.x + dx * scaleFactor,
      y: start.y + dy * scaleFactor,
    };

    if (activeSegmentEditor.mode === 'room') {
      const nextWalls = [...roomWalls];
      nextWalls[activeSegmentEditor.endIndex] = nextEnd;
      setRoomWalls(nextWalls);

      if (activeSegmentEditor.wallElementId) {
        updateElement(activeSegmentEditor.wallElementId, {
          coordinates: [
            { x: start.x, y: start.y, z: currentFloorZ },
            { x: nextEnd.x, y: nextEnd.y, z: currentFloorZ },
          ],
        });
      }
      return;
    }

    const nextDrawPoints = [...drawPoints];
    nextDrawPoints[activeSegmentEditor.endIndex] = nextEnd;
    setDrawPoints(nextDrawPoints);
  }, [
    activeSegmentEditor,
    activeSegmentEditorGeometry,
    currentFloorZ,
    drawPoints,
    roomWalls,
    setDrawPoints,
    setRoomWalls,
    updateElement,
  ]);

  const commitActiveSegmentEditor = useCallback((rawValue?: string) => {
    if (!activeSegmentEditor) return;
    if (cancelActiveSegmentEditorCommitRef.current) {
      cancelActiveSegmentEditorCommitRef.current = false;
      setActiveSegmentEditor(null);
      return;
    }
    const requestedLength = Number.parseFloat(rawValue ?? activeSegmentEditor.value);
    if (Number.isFinite(requestedLength) && requestedLength > 0) {
      applyActiveSegmentEditorLength(requestedLength);
    }
    setActiveSegmentEditor(null);
  }, [activeSegmentEditor, applyActiveSegmentEditorLength, setActiveSegmentEditor]);

  const activeServiceLinePillGeometry = useMemo(() => {
    if (viewMode !== '2d' || !isServiceLineDrawMode(drawMode) || !activeServiceLineElementId) {
      return null;
    }
    const element = elementsById[activeServiceLineElementId];
    if (!element || !isDuctOrPipeElementType(element.type)) return null;
    const coordinates = element.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates[0] || !coordinates[1]) {
      return null;
    }
    const [start, end] = coordinates;
    const mode = inferServiceLineModeFromCoordinates(coordinates);
    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
    return {
      element,
      coordinates,
      start,
      end,
      mode,
      startPosition: worldToCanvas(start, scale, panOffset, canvasCenter),
      endPosition: worldToCanvas(end, scale, panOffset, canvasCenter),
      midpointPosition: worldToCanvas(midpoint, scale, panOffset, canvasCenter),
      planLength: getServiceLinePlanLengthFromCoordinates(coordinates),
      actualLength: getServiceLineLengthFromCoordinates(coordinates),
    };
  }, [activeServiceLineElementId, canvasCenter, drawMode, elementsById, panOffset, scale, viewMode]);

  const updateActiveServiceLineCoordinates = useCallback((
    element: Element,
    coordinates: Array<{ x: number; y: number; z: number }>,
  ) => {
    const length = getServiceLineLengthFromCoordinates(coordinates);
    updateElement(element.id, {
      coordinates,
      length,
      isPlaceholder: false,
    } as Partial<Element>);
    const end = coordinates[1];
    if (end && activeServiceLineElementId === element.id && isServiceLineDrawMode(drawMode)) {
      setDrawPoints([{ x: end.x, y: end.y }]);
      setServiceLineDraftStartZ(formatServiceLineEditorNumber(end.z));
      setServiceLineDraftEndZ(formatServiceLineEditorNumber(end.z + 1));
    }
  }, [activeServiceLineElementId, drawMode, setDrawPoints, setServiceLineDraftEndZ, setServiceLineDraftStartZ, updateElement]);

  const commitActiveServiceLinePlanLength = useCallback((rawValue: string) => {
    const editor = activeServiceLinePillGeometry;
    if (!editor || editor.mode === 'vertical') return;
    const requestedPlanLength = parseEditorDecimal(rawValue);
    if (requestedPlanLength === null || requestedPlanLength <= 0) return;
    const coordinates = applyServiceLinePlanLengthToCoordinates(editor.coordinates, requestedPlanLength);
    if (!coordinates) return;
    updateActiveServiceLineCoordinates(editor.element, coordinates);
  }, [activeServiceLinePillGeometry, updateActiveServiceLineCoordinates]);

  const commitActiveServiceLineZ = useCallback((endpoint: 'start' | 'end' | 'both', rawValue: string) => {
    const editor = activeServiceLinePillGeometry;
    if (!editor) return;
    const z = parseEditorDecimal(rawValue);
    if (z === null) return;
    const next = editor.coordinates.map((coord) => ({ ...coord }));
    if (!next[0] || !next[1]) return;
    if (endpoint === 'start' || endpoint === 'both') {
      next[0].z = roundToTwoDecimals(z);
    }
    if (endpoint === 'end' || endpoint === 'both') {
      next[1].z = roundToTwoDecimals(z);
    }
    updateActiveServiceLineCoordinates(editor.element, next);
  }, [activeServiceLinePillGeometry, updateActiveServiceLineCoordinates]);

  const resolveAxisLockedPoint = useCallback((
    moving: { x: number; y: number },
    fixed: { x: number; y: number },
  ) => {
    if (orthogonalModifierHeldRef.current) {
      return utilConstrainPointOrthogonally(moving, fixed);
    }
    return utilApplyAngleSnapIfClose(moving, fixed, getProjectDefaults(geometryStore).angleTol);
  }, [geometryStore]);

  const resolveOverlayCalibrationCanvasPoint = useCallback((
    moving: { x: number; y: number },
    fixed: { x: number; y: number } | null,
  ) => {
    if (!fixed) {
      return { point: moving, snapped: false } as const;
    }
    return resolveAxisLockedPoint(moving, fixed);
  }, [resolveAxisLockedPoint]);

  // Handle mouse move: update draw preview cursor and polygon split hover
  const handleMouseMove = useCallback((e: any) => {
    // For draw preview: track cursor in world coords
    const mousePos = getStageViewportPointer(e.target.getStage());
    if (!mousePos) return;
    const mouseWorld = canvasToWorld(mousePos, scale, panOffset, canvasCenter);
    // Snap preview target when drawing
    if (drawMode !== 'none') {
      beginDrawingPreviewInteraction();
      const activePoints = drawMode === 'room' ? roomWalls : drawPoints;
      const pd = getProjectDefaults(geometryStore);
      const lastPoint =
        activePoints.length > 0 ? activePoints[activePoints.length - 1] : null;
      const snapRes = utilResolveDrawSnapPoint({
        mouseWorld: mouseWorld as { x: number; y: number },
        lastPoint,
        elementsById: elementsById as any,
        snapCache: spaceLabelSnapCache,
        excludeElementId: '__draw__',
        snapTol: pd.snapTol,
        orthogonalModifierHeld: orthogonalModifierHeldRef.current,
        angleTolDeg: pd.angleTol,
      });
      const chosen = snapRes.point;
      const nextDrawAngleSnapped =
        snapRes.geometrySnap || snapRes.cardinalSnap || snapRes.orthogonalAxisLock;
      let nextSegmentLengthPreview: DrawingPreviewSegment = EMPTY_SEGMENT_LENGTH_PREVIEW;
      drawSnapTargetRef.current = chosen as any;

      if (activePoints.length > 0) {
        const lastPoint = activePoints[activePoints.length - 1];
        const verticalServicePreview = drawMode === 'tb-vertical-line';
        const previewPoint = verticalServicePreview ? lastPoint : chosen || mouseWorld;
        const distance = verticalServicePreview
          ? Math.abs(
              (parseEditorDecimal(serviceLineDraftEndZ) ?? serviceLineDrawBaseZ + 1) -
              (parseEditorDecimal(serviceLineDraftStartZ) ?? serviceLineDrawBaseZ),
            )
          : Math.hypot(previewPoint.x - lastPoint.x, previewPoint.y - lastPoint.y);
        const midpointCanvas = worldToCanvas(
          {
            x: (lastPoint.x + previewPoint.x) / 2,
            y: (lastPoint.y + previewPoint.y) / 2,
          },
          scale,
          panOffset,
          canvasCenter,
        );
        nextSegmentLengthPreview = {
          visible: true,
          text: buildSegmentLengthLabel(distance, drawMode),
          position: midpointCanvas,
        };
      }

      drawingPreviewSignal.set({
        drawCursor: chosen as any,
        drawAngleSnapped: nextDrawAngleSnapped,
        segmentLengthPreview: nextSegmentLengthPreview,
      });

      if (drawMode === 'dormer') {
        setDrawAngleSnapped(nextDrawAngleSnapped);
        setDrawCursor(chosen as any);
      }

      if (drawMode !== 'dormer') {
        setDrawingTooltip(prev => prev.visible ? { visible: false, text: '', position: { x: 0, y: 0 } } : prev);
      }
      setHoverPoint(null);
      setSpaceLabelHoverPointIfChanged(null);
      return;
    } else {
      endDrawingPreviewInteraction();
      drawSnapTargetRef.current = null;
      setDrawCursor(null);
      setDrawAngleSnapped(false);
      setDrawingTooltip(prev => prev.visible ? { visible: false, text: '', position: { x: 0, y: 0 } } : prev);
    }

    if (selection?.type === 'element') {
      const element = elementsById[selection.id];
      if (element && getElementShape(element) === 'polygon' && element.coordinates && element.coordinates.length >= 3) {
        const closestPoint = utilFindClosestPointOnPolygon(mouseWorld, element.coordinates);
        setHoverPoint(closestPoint);
      } else {
        setHoverPoint(null);
      }
    } else {
      setHoverPoint(null);
    }

    const viewportPreview = viewportPreviewTransformRef.current;
    const isViewportPreviewActive =
      viewportPreview.x !== 0 || viewportPreview.y !== 0 || viewportPreview.scale !== 1;

    if (
      spaceLabellerOpen &&
      spaceLabellerSelectedLabelId &&
      !activePanGestureRef.current &&
      !isViewportPreviewActive
    ) {
      const label = spaceLabelsById[spaceLabellerSelectedLabelId];
      if (label?.coordinates?.length >= 3) {
        const closest = utilFindClosestPointOnPolygon(mouseWorld, label.coordinates);
        const maxDistance = Math.max(0.25, getProjectDefaults(geometryStore).snapTol * 1.5);
        const nearEdge =
          closest && Math.hypot(mouseWorld.x - closest.x, mouseWorld.y - closest.y) <= maxDistance
            ? closest
            : null;
        setSpaceLabelHoverPointIfChanged(nearEdge);
      } else {
        setSpaceLabelHoverPointIfChanged(null);
      }
    } else {
      setSpaceLabelHoverPointIfChanged(null);
    }
  }, [drawMode, drawPoints, roomWalls, elementsById, geometryStore, spaceLabelSnapCache, selection, scale, panOffset, canvasCenter, spaceLabellerOpen, spaceLabellerSelectedLabelId, spaceLabelsById, setSpaceLabelHoverPointIfChanged, getStageViewportPointer, drawSnapTargetRef, setDrawAngleSnapped, setDrawCursor, setDrawingTooltip, drawingPreviewSignal, beginDrawingPreviewInteraction, endDrawingPreviewInteraction, serviceLineDraftEndZ, serviceLineDraftStartZ, serviceLineDrawBaseZ]);

  // Memoize centerOnElement function to avoid recreating on every render
  const centerOnElement = useCallback((el: Element) => {
    const coords = el.coordinates || [];
    let cx = 0, cy = 0;
    if (coords.length === 2) {
      cx = (coords[0].x + coords[1].x) / 2;
      cy = (coords[0].y + coords[1].y) / 2;
    } else if (coords.length >= 1) {
      const xs = coords.map(c => c.x);
      const ys = coords.map(c => c.y);
      cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    const target = worldToCanvas({ x: cx, y: cy }, scale, { x: 0, y: 0 }, canvasCenter);
    setPanOffset({ x: canvasCenter.x - target.x, y: canvasCenter.y - target.y });
  }, [scale, canvasCenter, setPanOffset]);

  const centerOnSpaceLabelFootprint = useCallback((sl: SpaceLabel) => {
    const coords = sl.coordinates || [];
    if (coords.length < 1) return;
    const xs = coords.map((c) => c.x);
    const ys = coords.map((c) => c.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const target = worldToCanvas({ x: cx, y: cy }, scale, { x: 0, y: 0 }, canvasCenter);
    setPanOffset({ x: canvasCenter.x - target.x, y: canvasCenter.y - target.y });
  }, [scale, canvasCenter, setPanOffset]);

  const centerSpaceLabelFootprintInView = useCallback(
    (labelId: string) => {
      const st = geometryStore.getState();
      const sl = st.spaceLabelsById[labelId];
      if (!sl) return;

      const floorByStorey = st.floors[sl.storey];
      if (floorByStorey) {
        setCurrentFloor(floorByStorey.id);
      } else {
        const z = sl.coordinates[0]?.z;
        const zi = typeof z === 'number' && Number.isFinite(z) ? Math.floor(z) : undefined;
        if (zi !== undefined) {
          const match = st.floors.find((f) => f.zIndex === zi);
          if (match) setCurrentFloor(match.id);
        }
      }

      centerOnSpaceLabelFootprint(sl);
    },
    [centerOnSpaceLabelFootprint, geometryStore, setCurrentFloor],
  );

  // After CSV import (or clear), reset zoom/pan and center on the model so viewport culling
  // and prior pan/zoom do not leave the new geometry off-screen.
  /* eslint-disable react-hooks/set-state-in-effect -- canvasViewResetKey is an explicit import/clear command that resets the viewport store. */
  useEffect(() => {
    if (canvasViewResetKey === 0) return;
    if (lastProcessedCanvasViewResetKeyRef.current === canvasViewResetKey) return;
    lastProcessedCanvasViewResetKeyRef.current = canvasViewResetKey;

    setScale(CANVAS_CONSTANTS.DEFAULTS.SCALE);
    setPanOffset(CANVAS_CONSTANTS.DEFAULTS.PAN_OFFSET);

    const center = computePlanViewBoundsCenter(
      Object.values(geometryStore.getState().elementsById),
    );
    if (!center) return;

    const cc = { x: stageSize.width / 2, y: stageSize.height / 2 };
    const target = worldToCanvas(
      { x: center.x, y: center.y },
      CANVAS_CONSTANTS.DEFAULTS.SCALE,
      { x: 0, y: 0 },
      cc,
    );
    setPanOffset({ x: cc.x - target.x, y: cc.y - target.y });
  }, [canvasViewResetKey, geometryStore, stageSize.width, stageSize.height]);
  /* eslint-enable react-hooks/set-state-in-effect */





  // Elements to render (include placeholders so users can see imported data)
  const renderableElements = useMemo(() => {
    return elementIds
      .map(id => elementsById[id])
      .filter(el => !!el);
  }, [elementIds, elementsById]);

  // Memoize canvas coordinate calculations with viewport culling for performance
  const elementCanvasData = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.elementCanvasData', () => {
    // Keep a generous overscan so deferred pan/zoom previews already have nearby
    // off-screen geometry in the Konva layer instead of popping it in after commit.
    // Note: viewport is in canvas coordinates (0 to stageSize), panOffset is already applied in worldToCanvas
    const useViewportCulling = renderableElements.length > VIEWPORT_CULLING_ELEMENT_THRESHOLD;
    const padding = VIEWPORT_PREVIEW_OVERSCAN_PX;
    const viewportMinX = -padding;
    const viewportMaxX = stageSize.width + padding;
    const viewportMinY = -padding;
    const viewportMaxY = stageSize.height + padding;

    const result: { element: typeof renderableElements[number]; canvasCoords: ReturnType<typeof worldToCanvas>[] }[] = [];
    for (const element of renderableElements) {
      const coords = element.coordinates || [];
      if (coords.length === 0) continue;
      const canvasCoords = new Array(coords.length) as ReturnType<typeof worldToCanvas>[];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < coords.length; i++) {
        const c = worldToCanvas(coords[i], scale, panOffset, canvasCenter);
        canvasCoords[i] = c;
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
      }
      if (
        useViewportCulling &&
        (maxX < viewportMinX || minX > viewportMaxX || maxY < viewportMinY || minY > viewportMaxY)
      ) {
        continue;
      }
      result.push({ element, canvasCoords });
    }
    return result;
    });
  }, [renderableElements, scale, panOffset, canvasCenter, stageSize.width, stageSize.height]);

  const developmentContextVerticalRelationByStem = useMemo(() => {
    if (developmentContextModels.length === 0) return new Map<string, DevelopmentContextVerticalRelation>();
    const activeVertical = resolveDevelopmentModelVerticalContext({
      elements: Object.values(elementsById),
      zones,
      floors,
      complianceSettings,
    });
    return new Map(
      developmentContextModels.map((model) => {
        const contextVertical = resolveDevelopmentModelVerticalContext({
          elements: model.elements,
          zones: model.zones,
          floors: model.floors,
          complianceSettings: model.metadata.complianceSettings,
        });
        return [
          model.stem,
          classifyDevelopmentContextVerticalRelation(activeVertical, contextVertical),
        ] as const;
      }),
    );
  }, [developmentContextModels, elementsById, zones, floors, complianceSettings]);

  const materializedSharedContextShadingIds = useMemo(() => {
    if (!activeDevelopmentProject) return new Set<string>();
    const ids = new Set<string>();
    for (const element of Object.values(elementsById)) {
      if (element?.type !== 'ContextShading') continue;
      const sharedId = getDevelopmentContextSharedContextShadingId(element);
      if (sharedId) ids.add(sharedId);
    }
    return ids;
  }, [activeDevelopmentProject, elementsById]);

  const developmentContextCanvasData = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.developmentContextCanvasData', () => {
      if (developmentContextModels.length === 0) return [] as DevelopmentContextCanvasDatum[];

      const contextElements = developmentContextModels.flatMap((model) =>
        model.elements
          .filter((element) => {
            if (!shouldRenderDevelopmentContextElement(element)) return false;
            if (
              activeDevelopmentProject &&
              element.type === 'ContextShading' &&
              materializedSharedContextShadingIds.has(getExplicitContextShadingSharedId(activeDevelopmentProject.id, element as ContextShading))
            ) {
              return false;
            }
            return true;
          })
          .map((element) => ({
            modelStem: model.stem,
            verticalRelation: developmentContextVerticalRelationByStem.get(model.stem) ?? 'same',
            element,
          })),
      );
      const useViewportCulling = contextElements.length > VIEWPORT_CULLING_ELEMENT_THRESHOLD;
      const padding = VIEWPORT_PREVIEW_OVERSCAN_PX;
      const viewportMinX = -padding;
      const viewportMaxX = stageSize.width + padding;
      const viewportMinY = -padding;
      const viewportMaxY = stageSize.height + padding;
      const result: DevelopmentContextCanvasDatum[] = [];

      for (const { modelStem, verticalRelation, element } of contextElements) {
        if (!isElementOnActiveCanvasFloor(element, currentFloorZ, floors)) continue;
        const coords = element.coordinates || [];
        if (coords.length < 2) continue;
        const canvasCoords = new Array(coords.length) as Array<{ x: number; y: number }>;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < coords.length; i++) {
          const c = worldToCanvas(coords[i], scale, panOffset, canvasCenter);
          canvasCoords[i] = c;
          if (c.x < minX) minX = c.x;
          if (c.x > maxX) maxX = c.x;
          if (c.y < minY) minY = c.y;
          if (c.y > maxY) maxY = c.y;
        }
        if (
          useViewportCulling &&
          (maxX < viewportMinX || minX > viewportMaxX || maxY < viewportMinY || minY > viewportMaxY)
        ) {
          continue;
        }
        result.push({
          key: `${modelStem}:${element.id}`,
          modelStem,
          verticalRelation,
          element,
          shape: getElementShape(element),
          canvasCoords,
        });
      }

      return result;
    });
  }, [
    developmentContextModels,
    developmentContextVerticalRelationByStem,
    activeDevelopmentProject,
    materializedSharedContextShadingIds,
    currentFloorZ,
    floors,
    scale,
    panOffset,
    canvasCenter,
    stageSize.width,
    stageSize.height,
  ]);

  const developmentContextModelLabels = useMemo<DevelopmentContextModelLabel[]>(() => {
    const boundsByStem = new Map<string, {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      verticalRelation: DevelopmentContextVerticalRelation;
    }>();
    for (const item of developmentContextCanvasData) {
      let bounds = boundsByStem.get(item.modelStem);
      if (!bounds) {
        bounds = {
          minX: Infinity,
          minY: Infinity,
          maxX: -Infinity,
          maxY: -Infinity,
          verticalRelation: item.verticalRelation,
        };
        boundsByStem.set(item.modelStem, bounds);
      }
      for (const point of item.canvasCoords) {
        if (point.x < bounds.minX) bounds.minX = point.x;
        if (point.x > bounds.maxX) bounds.maxX = point.x;
        if (point.y < bounds.minY) bounds.minY = point.y;
        if (point.y > bounds.maxY) bounds.maxY = point.y;
      }
    }
    return buildDevelopmentContextModelLabels({
      bounds: Array.from(boundsByStem.entries()).map(([stem, bounds]) => ({
        stem,
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
        verticalRelation: bounds.verticalRelation,
      })),
      contextModels: developmentContextModels,
      csvValidationCache,
      stageWidth: stageSize.width,
      stageHeight: stageSize.height,
    });
  }, [csvValidationCache, developmentContextCanvasData, developmentContextModels, stageSize.width, stageSize.height]);

  const openDevelopmentContextStackLabel = useMemo(() => {
    if (!developmentContextStackMenuId) return null;
    return developmentContextModelLabels.find((label) => label.id === developmentContextStackMenuId && label.isStack) ?? null;
  }, [developmentContextModelLabels, developmentContextStackMenuId]);

  if (developmentContextStackMenuId && !openDevelopmentContextStackLabel) {
    setDevelopmentContextStackMenuId(null);
    setDevelopmentContextHoveredStem(null);
  }

  // Memoize sorted elements to avoid sorting on every render (must be after elementCanvasData)
  const sortedElementCanvasData = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.sortedElementCanvasData', () => {
    const activeSelectionIds = new Set<string>(selectedElementIds);
    const primarySelectionId =
      selection?.type === 'element' || selection?.type === 'global'
        ? selection.id
        : selection?.type === 'dormer'
          ? getDormerBundleAnchorElement(elementsById, selection.id)?.id ?? null
          : null;
    if (selection?.type === 'element' || selection?.type === 'global') {
      activeSelectionIds.add(selection.id);
    } else if (selection?.type === 'dormer') {
      for (const id of getDormerBundleElementIds(elementsById, selection.id)) {
        activeSelectionIds.add(id);
      }
      const dormerAnchorId = getDormerBundleAnchorElement(elementsById, selection.id)?.id;
      if (dormerAnchorId) activeSelectionIds.add(dormerAnchorId);
    }

    return [...elementCanvasData].sort((a, b) => {
      const aRaise = activeSelectionIds.has(a.element.id);
      const bRaise = activeSelectionIds.has(b.element.id);

      // Any selected / multi-selected element renders above non-selected (so stacked picks & drags work).
      if (aRaise && !bRaise) return 1;
      if (!aRaise && bRaise) return -1;
      // Among multiple raised, keep primary selection on top for predictable hit-testing.
      if (aRaise && bRaise && primarySelectionId) {
        if (primarySelectionId === a.element.id && primarySelectionId !== b.element.id) return 1;
        if (primarySelectionId === b.element.id && primarySelectionId !== a.element.id) return -1;
      }

      return compareElementPaintOrder(a.element, b.element);
    });
    });
  }, [elementCanvasData, elementsById, selection, selectedElementIds]);

  const {
    currentFloor: currentFloorElementCanvasData,
    contextFloor: contextFloorElementCanvasData,
  } = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.floorLayerPartition', () =>
      partitionElementCanvasDataByFloor(sortedElementCanvasData, currentFloorZ, floors),
    );
  }, [sortedElementCanvasData, currentFloorZ, floors]);

  const staticPreviewElementCanvasData = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.staticPreviewElementCanvasData', () => {
      return [...elementCanvasData].sort((a, b) =>
        compareElementPaintOrder(a.element, b.element),
      );
    });
  }, [elementCanvasData]);

  // Memoize sorted elements for labels to avoid sorting on every render
  const sortedForLabels = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.sortedForLabels', () => {
    return [...elementCanvasData].sort((a, b) => {
      const azs = a.element.coordinates?.map(c => c.z) || [0];
      const bzs = b.element.coordinates?.map(c => c.z) || [0];
      const az = azs.length ? Math.round(azs.reduce((p, v) => p + v, 0) / azs.length) : 0;
      const bz = bzs.length ? Math.round(bzs.reduce((p, v) => p + v, 0) / bzs.length) : 0;
      if (az !== bz) return az - bz;
      if ((a.element.type || '') !== (b.element.type || '')) return (a.element.type || '').localeCompare(b.element.type || '');
      return (a.element.id || '').localeCompare(b.element.id || '');
    });
    });
  }, [elementCanvasData]);

  useLayoutEffect(() => {
    const canvas = staticPreviewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const paintStartedAt = geometryPerf.isEnabled() ? performance.now() : null;

    const overscan = VIEWPORT_PREVIEW_OVERSCAN_PX;
    const width = Math.max(1, Math.ceil(stageSize.width + overscan * 2));
    const height = Math.max(1, Math.ceil(stageSize.height + overscan * 2));
    const dpr = STATIC_PREVIEW_DEVICE_PIXEL_RATIO;
    const backingWidth = Math.ceil(width * dpr);
    const backingHeight = Math.ceil(height * dpr);

    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    if (canvas.style.width !== `${width}px`) canvas.style.width = `${width}px`;
    if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (guideOverlay?.path && overlayImg) {
      const pxPerM = (typeof guideOverlay.pxPerM === 'number' && Number.isFinite(guideOverlay.pxPerM) && guideOverlay.pxPerM > 0)
        ? guideOverlay.pxPerM
        : 50;
      const pos = guideOverlay.pos_m || { x: 0, y: 0 };
      const canvasPos = worldToCanvas({ x: pos.x, y: pos.y }, scale, panOffset, canvasCenter);
      const widthCanvasPx = (overlayImg.width / pxPerM) * 50 * scale;
      const heightCanvasPx = (overlayImg.height / pxPerM) * 50 * scale;

      ctx.save();
      ctx.globalAlpha = (guideOverlay.opacity01 ?? 0.5) * (spaceLabellerOpen ? 0.42 : 1);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        overlayImg,
        canvasPos.x + overscan,
        canvasPos.y + overscan,
        widthCanvasPx,
        heightCanvasPx,
      );
      ctx.restore();
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const { element, canvasCoords } of staticPreviewElementCanvasData) {
      if (!isElementOnActiveCanvasFloor(element, currentFloorZ, floors)) continue;
      if (canvasCoords.length === 0) continue;

      const hidden = isElementHiddenOnView(element);
      const palette = getElementColor(element, false, staticPreviewElementPalette);
      const stroke = resolveCanvasPaint(palette.stroke, '#cccccc');
      const fill = resolveCanvasPaint(palette.fill, 'rgba(204,204,204,0.12)');
      const shape = getElementShape(element);
      const isThermalBridge = element.type === 'ThermalBridgeLinear' || element.type === 'ThermalBridgePoint';
      const ductRoleStyle = element.type === 'MechanicalVentilationDuctwork'
        ? getMechanicalVentilationDuctworkRoleStyle(element as any)
        : null;
      const coords = canvasCoords.map((point) => ({
        x: point.x + overscan,
        y: point.y + overscan,
      }));

      ctx.save();
      ctx.globalAlpha = hidden ? 0.12 : (isThermalBridge ? 0.94 : 0.78);
      ctx.strokeStyle = stroke;
      ctx.fillStyle = fill;
      ctx.lineWidth = ductRoleStyle?.strokeWidth ?? (isThermalBridge ? (shape === 'point' ? 2.5 : 3) : (shape === 'point' ? 1.5 : 2));
      ctx.setLineDash(ductRoleStyle?.dash ? [...ductRoleStyle.dash] : []);

      if (shape === 'point') {
        const first = coords[0];
        if (first) {
          ctx.beginPath();
          ctx.arc(first.x, first.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else if (shape === 'line') {
        if (coords.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(coords[0].x, coords[0].y);
          for (let index = 1; index < coords.length; index += 1) {
            ctx.lineTo(coords[index].x, coords[index].y);
          }
          ctx.stroke();
        }
      } else if (coords.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(coords[0].x, coords[0].y);
        for (let index = 1; index < coords.length; index += 1) {
          ctx.lineTo(coords[index].x, coords[index].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    }

    if (paintStartedAt !== null) {
      geometryPerf.record('GeometryCanvas.staticPreviewCanvasPaint', performance.now() - paintStartedAt);
    }
  }, [
    staticPreviewElementCanvasData,
    stageSize.width,
    stageSize.height,
    guideOverlay,
    overlayImg,
    scale,
    panOffset,
    canvasCenter,
    spaceLabellerOpen,
    currentFloorZ,
    floors,
    isElementHiddenOnView,
    staticPreviewElementPalette,
  ]);

  const findDormerHostAtPoint = useCallback((point: { x: number; y: number }) => {
    for (let index = sortedElementCanvasData.length - 1; index >= 0; index -= 1) {
      const candidate = sortedElementCanvasData[index]?.element;
      if (!candidate) continue;
      if (!isElementOnActiveCanvasFloor(candidate, currentFloorZ, floors)) continue;
      if (!isValidDormerHost(candidate)) continue;
      if (!isPointInPolygon2D(point, candidate.coordinates)) continue;
      return candidate;
    }

    return null;
  }, [currentFloorZ, floors, sortedElementCanvasData]);

  const dormerDrawPreviewCutout = useMemo(() => {
    if (drawMode !== 'dormer' || !drawCursor) return null;
    const host = findDormerHostAtPoint(drawCursor);
    if (!host) return null;
    return getDormerDrawPreviewCutoutPolygon(host, { x: drawCursor.x, y: drawCursor.y }, floors);
  }, [drawMode, drawCursor, findDormerHostAtPoint, floors]);

  const selectedPointDragTarget = useMemo(() => {
    if (drawMode !== 'none') return null;
    if (!(selection?.type === 'element' || selection?.type === 'global')) return null;
    const target = elementsById[selection.id];
    if (!target) return null;
    if (isDevelopmentContextGeneratedShading(target)) return null;
    if (!isElementOnActiveCanvasFloor(target, currentFloorZ, floors)) return null;
    if (getElementShape(target) !== 'point') return null;
    const coord = target.coordinates?.[0];
    if (!coord) return null;
    return { element: target, coord };
  }, [drawMode, selection, elementsById, currentFloorZ, floors]);

  const selectedShapeDragTarget = useMemo(() => {
    if (drawMode !== 'none') return null;
    if (selectedElementIds.length > 1) return null; // group handle already covers multi-select drag
    if (!(selection?.type === 'element' || selection?.type === 'global')) return null;
    const target = elementsById[selection.id];
    if (!target) return null;
    if (isDevelopmentContextGeneratedShading(target)) return null;
    if (!isElementOnActiveCanvasFloor(target, currentFloorZ, floors)) return null;
    const shape = getElementShape(target);
    if (shape === 'point') return null; // point has dedicated drag overlay
    const coords = target.coordinates ?? [];
    if (coords.length < 2) return null;
    const centroid = coords.reduce(
      (acc, c) => ({ x: acc.x + c.x, y: acc.y + c.y, z: acc.z + c.z }),
      { x: 0, y: 0, z: 0 },
    );
    const count = coords.length;
    return {
      element: target,
      centroid: {
        x: centroid.x / count,
        y: centroid.y / count,
        z: centroid.z / count,
      },
      coords,
    };
  }, [drawMode, selection, selectedElementIds.length, elementsById, currentFloorZ, floors]);

  const selectedPvClearanceGuidance = useMemo(() => {
    if (!(selection?.type === 'element' || selection?.type === 'global')) return null;
    const panel = elementsById[selection.id];
    if (!panel || panel.type !== 'OnSiteGeneration') return null;
    if (!isElementOnActiveCanvasFloor(panel, currentFloorZ, floors)) return null;
    const hostId = (panel as any)._pvHostRoofId;
    if (!hostId) return null;
    const host = elementsById[hostId];
    if (!host || host.type !== 'BuildingElementOpaque') return null;
    return computePvRoofClearanceGuidance(
      panel as any,
      host as any,
      Object.values(elementsById) as Element[],
    );
  }, [selection, elementsById, currentFloorZ, floors]);

  const selectedRoofWindowPlacement = useMemo(() => {
    if (selection?.type !== 'element') return null;
    const opening = elementsById[selection.id];
    if (!opening || opening.type !== 'BuildingElementTransparent') return null;
    if (!isElementOnActiveCanvasFloor(opening, currentFloorZ, floors)) return null;
    const parentName = (opening as any).parent_element;
    if (!parentName) return null;
    const host = findElementByName(
      parentName,
      (element) => element.type === 'BuildingElementOpaque',
    );
    if (!host || host.type !== 'BuildingElementOpaque') return null;
    return computeRoofHostedOpeningPlacement(opening as any, host as any, floors);
  }, [selection, elementsById, findElementByName, currentFloorZ, floors]);
  const roofWindowDistanceEditor = roofWindowDistanceEditorState
    && selection?.type === 'element'
    && selection.id === roofWindowDistanceEditorState.elementId
    && selectedRoofWindowPlacement
      ? roofWindowDistanceEditorState
      : null;

  const beginRoofWindowDistanceEditor = useCallback((event?: any) => {
    if (event) event.cancelBubble = true;
    if (selection?.type !== 'element' || !selectedRoofWindowPlacement) return;
    setRoofWindowDistanceEditor({
      elementId: selection.id,
      value: selectedRoofWindowPlacement.distanceM.toFixed(2),
    });
  }, [selection, selectedRoofWindowPlacement, setRoofWindowDistanceEditor]);

  const commitRoofWindowDistanceEditor = useCallback(() => {
    if (!roofWindowDistanceEditor) return;
    const requestedDistanceM = Number.parseFloat(roofWindowDistanceEditor.value);
    if (!Number.isFinite(requestedDistanceM) || requestedDistanceM < 0) {
      setRoofWindowDistanceEditor((prev) => (prev ? { ...prev, error: true } : prev));
      return;
    }

    const opening = elementsById[roofWindowDistanceEditor.elementId];
    if (!opening || opening.type !== 'BuildingElementTransparent') {
      setRoofWindowDistanceEditor(null);
      return;
    }

    const parentName = (opening as any).parent_element;
    const host = findElementByName(
      parentName,
      (element) => element.type === 'BuildingElementOpaque',
    );
    if (!host || host.type !== 'BuildingElementOpaque') {
      setRoofWindowDistanceEditor(null);
      return;
    }

    const coordinates = moveRoofHostedOpeningToSurfaceDistance(
      opening as any,
      host as any,
      floors,
      requestedDistanceM,
    );
    if (!coordinates || !isPanelFullyOnRoof({ coordinates }, host as any)) {
      setRoofWindowDistanceEditor((prev) => (prev ? { ...prev, error: true } : prev));
      return;
    }

    updateElement(opening.id, { coordinates });
    setRoofWindowDistanceEditor(null);
  }, [roofWindowDistanceEditor, elementsById, findElementByName, floors, setRoofWindowDistanceEditor, updateElement]);

  const roofWindowDistanceEditorGeometry = useMemo(() => {
    if (
      viewMode !== '2d' ||
      !roofWindowDistanceEditor ||
      selection?.type !== 'element' ||
      selection.id !== roofWindowDistanceEditor.elementId ||
      !selectedRoofWindowPlacement
    ) {
      return null;
    }

    const openingPoint = worldToCanvas(selectedRoofWindowPlacement.openingPoint, scale, panOffset, canvasCenter);
    const roofPoint = worldToCanvas(selectedRoofWindowPlacement.roofPoint, scale, panOffset, canvasCenter);
    const labelX = (openingPoint.x + roofPoint.x) / 2 + 8;
    const labelY = (openingPoint.y + roofPoint.y) / 2 - DRAW_MODE_TOOLTIP_PILL_HEIGHT / 2 - 8;
    const labelText = `Up-slope: ${roofWindowDistanceEditor.value || selectedRoofWindowPlacement.distanceM.toFixed(2)}m`;
    const width = Math.max(
      getDrawModeTooltipPillWidth('Up-slope: 0.00m'),
      getDrawModeTooltipPillWidth(labelText),
    );

    return {
      left: labelX + width / 2,
      top: labelY + DRAW_MODE_TOOLTIP_PILL_HEIGHT / 2,
      width,
    };
  }, [
    viewMode,
    roofWindowDistanceEditor,
    selection,
    selectedRoofWindowPlacement,
    scale,
    panOffset,
    canvasCenter,
  ]);

  const selectedLineOpeningClearance = useMemo(() => {
    if (selection?.type !== 'element') return null;
    const opening = elementsById[selection.id];
    if (!isLineHostedOpeningElement(opening)) return null;
    if (!isElementOnActiveCanvasFloor(opening, currentFloorZ, floors)) return null;
    const parentName = (opening as any).parent_element;
    if (!parentName) return null;
    const parent = findElementByName(
      parentName,
      (element) => element.type === 'BuildingElementOpaque',
    );
    if (!parent || parent.type !== 'BuildingElementOpaque' || parent.coordinates?.length !== 2) {
      return null;
    }
    const clearance = computeLineHostedOpeningClearance(opening as any, parent as any);
    return clearance ? { elementId: opening.id, clearance } : null;
  }, [selection, elementsById, findElementByName, currentFloorZ, floors]);
  const lineOpeningDistanceEditor = lineOpeningDistanceEditorState
    && selection?.type === 'element'
    && selection.id === lineOpeningDistanceEditorState.elementId
    && selectedLineOpeningClearance
      ? lineOpeningDistanceEditorState
      : null;

  const lineOpeningClearanceDragPreview = useMemo(() => {
    if (!lineOpeningClearancePreview) return null;
    const parent = elementsById[lineOpeningClearancePreview.parentId];
    if (!parent || parent.type !== 'BuildingElementOpaque' || parent.coordinates?.length !== 2) {
      return null;
    }
    const clearance = computeLineHostedOpeningClearance(
      { coordinates: lineOpeningClearancePreview.coordinates },
      parent as any,
    );
    return clearance ? { elementId: 'line-opening-clearance-preview', clearance } : null;
  }, [lineOpeningClearancePreview, elementsById]);

  const beginLineOpeningDistanceEditor = useCallback((
    side: LineOpeningClearanceSide,
    event?: any,
  ) => {
    if (event) event.cancelBubble = true;
    if (selection?.type !== 'element' || !selectedLineOpeningClearance) return;
    const distanceM =
      side === 'start'
        ? selectedLineOpeningClearance.clearance.startDistanceM
        : selectedLineOpeningClearance.clearance.endDistanceM;
    setLineOpeningDistanceEditor({
      elementId: selection.id,
      side,
      value: Math.max(0, distanceM).toFixed(2),
    });
  }, [selection, selectedLineOpeningClearance, setLineOpeningDistanceEditor]);

  const commitLineOpeningDistanceEditor = useCallback(() => {
    if (!lineOpeningDistanceEditor) return;
    const requestedDistanceM = Number.parseFloat(lineOpeningDistanceEditor.value);
    if (!Number.isFinite(requestedDistanceM) || requestedDistanceM < 0) {
      setLineOpeningDistanceEditor((prev) => (prev ? { ...prev, error: true } : prev));
      return;
    }

    const opening = elementsById[lineOpeningDistanceEditor.elementId];
    if (!isLineHostedOpeningElement(opening)) {
      setLineOpeningDistanceEditor(null);
      return;
    }

    const parentName = (opening as any).parent_element;
    const parent = findElementByName(
      parentName,
      (element) => element.type === 'BuildingElementOpaque',
    );
    if (!parent || parent.type !== 'BuildingElementOpaque' || parent.coordinates?.length !== 2) {
      setLineOpeningDistanceEditor(null);
      return;
    }

    const coordinates = moveLineHostedOpeningToClearance(
      opening as any,
      parent as any,
      lineOpeningDistanceEditor.side,
      requestedDistanceM,
    );
    if (!coordinates) {
      setLineOpeningDistanceEditor((prev) => (prev ? { ...prev, error: true } : prev));
      return;
    }

    updateElement(opening.id, { coordinates } as any);
    setLineOpeningDistanceEditor(null);
  }, [lineOpeningDistanceEditor, elementsById, findElementByName, setLineOpeningDistanceEditor, updateElement]);

  const lineOpeningDistanceEditorGeometry = useMemo(() => {
    if (
      viewMode !== '2d' ||
      !lineOpeningDistanceEditor ||
      selection?.type !== 'element' ||
      selection.id !== lineOpeningDistanceEditor.elementId ||
      !selectedLineOpeningClearance
    ) {
      return null;
    }

    const clearance = selectedLineOpeningClearance.clearance;
    const segment =
      lineOpeningDistanceEditor.side === 'start'
        ? clearance.startGuideSegment
        : clearance.endGuideSegment;
    const a = worldToCanvas(segment[0], scale, panOffset, canvasCenter);
    const b = worldToCanvas(segment[1], scale, panOffset, canvasCenter);
    const distanceText = `${lineOpeningDistanceEditor.value || '0'}m`;
    const width = Math.max(
      getDrawModeTooltipPillWidth('0.00m'),
      getDrawModeTooltipPillWidth(distanceText),
    );

    return {
      left: (a.x + b.x) / 2,
      top: (a.y + b.y) / 2,
      width,
    };
  }, [
    viewMode,
    lineOpeningDistanceEditor,
    selection,
    selectedLineOpeningClearance,
    scale,
    panOffset,
    canvasCenter,
  ]);

  const renderLineOpeningClearanceGuidance = useCallback((
    key: string,
    clearance: LineHostedOpeningClearance,
    editable: boolean,
    opacity = 1,
  ) => {
    const color = clearance.isWithinWall
      ? readRootCssVar('--semantic-snap', '#1E90FF')
      : CANVAS_CONSTANTS.COLORS.VALIDATION_WARNING;

    const renderSide = (side: LineOpeningClearanceSide) => {
      const segment = side === 'start' ? clearance.startGuideSegment : clearance.endGuideSegment;
      const distanceM = side === 'start' ? clearance.startDistanceM : clearance.endDistanceM;
      const a = worldToCanvas(segment[0], scale, panOffset, canvasCenter);
      const b = worldToCanvas(segment[1], scale, panOffset, canvasCenter);
      const measureLen = Math.hypot(b.x - a.x, b.y - a.y);
      const labelText = `${distanceM.toFixed(2)}m`;
      const pillWidth = getDrawModeTooltipPillWidth(labelText);
      const labelX = (a.x + b.x) / 2 - pillWidth / 2;
      const labelY = (a.y + b.y) / 2 - DRAW_MODE_TOOLTIP_PILL_HEIGHT / 2;
      const isEditing =
        editable &&
        lineOpeningDistanceEditor?.elementId === selectedLineOpeningClearance?.elementId &&
        lineOpeningDistanceEditor?.side === side;

      return (
        <Group key={`${key}-${side}`} listening={editable && !isEditing}>
          {measureLen > 2 && (
            <Line
              points={[a.x, a.y, b.x, b.y]}
              stroke={color}
              strokeWidth={2}
              opacity={0.95}
              listening={false}
            />
          )}
          <Circle
            x={a.x}
            y={a.y}
            radius={3}
            fill={color}
            listening={false}
          />
          <Circle
            x={b.x}
            y={b.y}
            radius={3}
            fill={color}
            listening={false}
          />
          {!isEditing && (
            <>
              {renderCanvasMeasurementPill(labelText, { x: labelX, y: labelY }, color)}
              {editable && (
                <Rect
                  x={labelX}
                  y={labelY}
                  width={pillWidth}
                  height={DRAW_MODE_TOOLTIP_PILL_HEIGHT}
                  fill={color}
                  opacity={0}
                  listening
                  onClick={(event) => beginLineOpeningDistanceEditor(side, event)}
                  onTap={(event) => beginLineOpeningDistanceEditor(side, event)}
                />
              )}
            </>
          )}
        </Group>
      );
    };

    return (
      <Group key={key} listening={editable} opacity={opacity}>
        {renderSide('start')}
        {renderSide('end')}
      </Group>
    );
  }, [
    scale,
    panOffset,
    canvasCenter,
    lineOpeningDistanceEditor,
    selectedLineOpeningClearance,
    beginLineOpeningDistanceEditor,
  ]);

  // Memoized snap indicators calculation for performance
  // Only show snap indicators for elements on the current floor
  /* eslint-disable react-hooks/refs -- This ref preserves the last committed snap preview during an active drag without scheduling a render. */
  const snapIndicators = useMemo(() => {
    if (
      isCanvasInteractionActive('selected-shape-drag') ||
      isCanvasInteractionActive('selected-point-drag') ||
      isCanvasInteractionActive('vertex-drag')
    ) {
      return snapIndicatorsRef.current;
    }
    return geometryPerf.measure('GeometryCanvas.snapIndicators', () => {
      const indicators: React.ReactElement[] = [];
      // Extract store access outside loop to avoid calling getState() for every element
      const angleTol = (geometryStore.getState() as any).PROJECT_DEFAULTS?.angle_deg || 5;
      // `readRootCssVar` runs `getComputedStyle(document.documentElement)`, so resolve the
      // indicator paint once per pass rather than once per snapped vertex.
      const snapFill = readRootCssVar('--semantic-snap', '#1E90FF');
      const snapStroke = readRootCssVar('--semantic-on-color', '#FFFFFF');
      const mvhrTerminalBadgeBounds = elementCanvasData
        .filter(({ element, canvasCoords }) =>
          element.type === 'MechanicalVentilationTerminal' &&
          canvasCoords.length > 0 &&
          isElementOnActiveCanvasFloor(element, currentFloorZ, floors) &&
          !isElementHiddenOnView(element)
        )
        .map(({ canvasCoords }) => ({
          x: canvasCoords[0].x,
          y: canvasCoords[0].y,
          halfWidth: 19,
          halfHeight: 12,
        }));
      const overlapsMvhrTerminalBadge = (coord: { x: number; y: number }) =>
        mvhrTerminalBadgeBounds.some((bounds) =>
          Math.abs(coord.x - bounds.x) <= bounds.halfWidth &&
          Math.abs(coord.y - bounds.y) <= bounds.halfHeight
        );

      elementCanvasData.forEach(({ element, canvasCoords }) => {
        // Floor filtering: same rule as ElementRenderer / 3D (normalized storey z)
        if (!isElementOnActiveCanvasFloor(element, currentFloorZ, floors)) return;
        if (isElementHiddenOnView(element)) return;

        const isRegularWallOpaque =
          element.type === 'BuildingElementOpaque' && (element as any).is_external_door !== true;
        const snappedVertices = utilGetExactSnappedVertices(
          element,
          elementsById,
          isRegularWallOpaque
            ? { skipVertexMatchFromOtherTypes: ['BuildingElementTransparent'] }
            : undefined,
        );

        canvasCoords.forEach((coord, index) => {
          if (snappedVertices.has(index)) {
            if (overlapsMvhrTerminalBadge(coord)) return;
            const all90Degree = utilIsAll90DegreeConnections(element, index, elementsById, angleTol);

            if (all90Degree) {
              // Blue square for all-90° connections
              indicators.push(
                <Rect
                  key={`snap-${element.id}-${index}`}
                  x={coord.x - 3}
                  y={coord.y - 3}
                  width={6}
                  height={6}
                  fill={snapFill}
                  stroke={snapStroke}
                  strokeWidth={1}
                  cornerRadius={1}
                  listening={false}
                />
              );
            } else {
              // Blue circle for mixed or non-90° connections
              indicators.push(
                <Circle
                  key={`snap-${element.id}-${index}`}
                  x={coord.x}
                  y={coord.y}
                  radius={3}
                  fill={snapFill}
                  stroke={snapStroke}
                  strokeWidth={1}
                  listening={false}
                />
              );
            }
          }
        });
      });

      snapIndicatorsRef.current = indicators;
      return indicators;
    });
  }, [elementCanvasData, elementsById, currentFloorZ, floors, geometryStore, isElementHiddenOnView]);
  /* eslint-enable react-hooks/refs */

  // Memoized label positions calculation for performance optimization
  // Optimized for 'selected' mode (default) - only calculate positions for visible labels
  // Only calculate label positions for elements that will be visible in 'selected' mode
  // This significantly reduces computation when most labels are hidden
  const elementsForLabelCalculation = useMemo(() => {
    if (labelVisibility === 'always') {
      // In 'always' mode, calculate for all elements
      return renderableElements;
    }
    // In 'selected' mode (default), only calculate for highlighted/hovered elements
    return renderableElements.filter((element) => {
      const isSelected = selection?.type === 'element' && selection.id === element.id;
      const isMultiSelected = selectedElementIdSet.has(element.id);
      const isHovered = elementHover === element.id && !isElementHiddenOnView(element);
      return isSelected || isMultiSelected || isHovered;
    });
  }, [renderableElements, labelVisibility, selection, selectedElementIdSet, elementHover, isElementHiddenOnView]);

  // Create stable hash for elementsForLabelCalculation to use in dependency array
  const elementsForLabelHash = useMemo(() => {
    return elementsForLabelCalculation
      .map(e => getSmartLabelLayoutSignature(e, { showLineDimensions }))
      .join('|');
  }, [elementsForLabelCalculation, showLineDimensions]);

  const labelAvoidRectsHash = useMemo(() => {
    const selectedIds = new Set(selectedElementIds);
    if (
      (selection?.type === 'element' || selection?.type === 'global') &&
      selection.id
    ) {
      selectedIds.add(selection.id);
    }
    const overlapHash = Array.from(overlapGroups.entries())
      .map(([id, group]) => `${id}:${group.join(',')}`)
      .join('|');
    return [
      Array.from(selectedIds).sort().join(','),
      selectedShapeDragTarget?.element.id ?? '',
      selectedPointDragTarget?.element.id ?? '',
      overlapHash,
      currentFloorZ,
    ].join('|');
  }, [
    selectedElementIds,
    selection,
    selectedShapeDragTarget,
    selectedPointDragTarget,
    overlapGroups,
    currentFloorZ,
  ]);

  const memoizedLabelPositions = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.memoizedLabelPositions', () => {
    const canvasBounds = { width: stageSize.width, height: stageSize.height };
    const avoidRects: Array<{ x: number, y: number, width: number, height: number }> = [];
    const addAvoidRect = (point: { x: number, y: number }, halfSize: number) => {
      avoidRects.push({
        x: point.x - halfSize,
        y: point.y - halfSize,
        width: halfSize * 2,
        height: halfSize * 2,
      });
    };

    const selectedIds = new Set(selectedElementIds);
    if (
      (selection?.type === 'element' || selection?.type === 'global') &&
      selection.id
    ) {
      selectedIds.add(selection.id);
    }

    for (const id of selectedIds) {
      const element = elementsById[id];
      if (!element || !isElementOnActiveCanvasFloor(element, currentFloorZ, floors)) continue;
      const coords = element.coordinates ?? [];
      for (const coord of coords) {
        addAvoidRect(worldToCanvas(coord, scale, panOffset, canvasCenter), 14);
      }
      if (coords.length > 1) {
        const centroid = {
          x: coords.reduce((sum, coord) => sum + coord.x, 0) / coords.length,
          y: coords.reduce((sum, coord) => sum + coord.y, 0) / coords.length,
        };
        addAvoidRect(worldToCanvas(centroid, scale, panOffset, canvasCenter), 16);
      }
    }

    if (selectedShapeDragTarget) {
      addAvoidRect(
        worldToCanvas(selectedShapeDragTarget.centroid, scale, panOffset, canvasCenter),
        18,
      );
    }

    if (selectedPointDragTarget) {
      addAvoidRect(
        worldToCanvas(selectedPointDragTarget.coord, scale, panOffset, canvasCenter),
        18,
      );
    }

    const processed = new Set<string>();
    for (const [elementId, group] of overlapGroups.entries()) {
      if (processed.has(elementId)) continue;
      group.forEach((id) => processed.add(id));
      if (group.length <= 1) continue;
      const element = elementsById[elementId];
      if (!element || !isElementOnActiveCanvasFloor(element, currentFloorZ, floors)) continue;
      const overlappingElements = group.slice(1).map((id) => elementsById[id]).filter(Boolean);
      const center = getOverlapCenter(element, overlappingElements);
      if (center) {
        addAvoidRect(worldToCanvas(center, scale, panOffset, canvasCenter), 14);
      }
    }

    return calculateMemoizedLabelPositions(
      elementsForLabelCalculation,
      canvasBounds,
      showLineDimensions,
      worldToCanvas,
      scale,
      panOffset,
      canvasCenter,
      avoidRects
    );
    });
  // Use stable hashes instead of recalculating on every render.
  // Note: not including scale, panOffset, or canvasCenter avoids recalculation on pan/zoom.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    elementsForLabelHash,
    labelAvoidRectsHash,
    stageSize.width,
    stageSize.height,
    showLineDimensions,
  ]);

  // Handle element click - optimized with batched state updates
  const handleElementClick = useCallback((elementId: string, e: any) => {
    e?.evt?.stopPropagation();

    // When overlay Move/Calibrate mode is enabled, block element selection to avoid accidental geometry edits.
    if (overlayMoveMode || overlayCalibrateMode) return;

    // Close overlap badge menu if open
    setOverlapBadgeMenu(null);

    const clickedElement = elementsById[elementId];
    const interactionOwnerName = getDormerAnchorName(clickedElement);
    const interactionOwnerId = interactionOwnerName
      ? findElementByName(interactionOwnerName)?.id ?? elementId
      : elementId;
    const bundleSelectionIds = getDormerBundleSelectionIds(interactionOwnerId, elementsById);

    // Floor awareness: only allow selection of elements on current floor
    const element = elementsById[interactionOwnerId];
    if (element && !isElementOnActiveCanvasFloor(element, currentFloorZ, floors)) {
      // Element is on different floor, prevent selection
      return;
    }

    // Batch state updates for better performance
    if (e?.evt?.shiftKey) {
      const isFullySelected = bundleSelectionIds.every((id) => selectedElementIds.includes(id));
      const nextSelectedIds = isFullySelected
        ? selectedElementIds.filter((id) => !bundleSelectionIds.includes(id))
        : Array.from(new Set([...selectedElementIds, ...bundleSelectionIds]));
      setSelectedElementIds(nextSelectedIds);
      if (nextSelectedIds.length === 0) {
        setSelection(null);
      } else if (!isFullySelected) {
        setSelection(getSelectionForElementId(interactionOwnerId, elementsById));
      } else {
        const fallbackId = nextSelectedIds[nextSelectedIds.length - 1];
        setSelection(fallbackId ? getSelectionForElementId(fallbackId, elementsById) : null);
      }
    } else {
      clearElementSelection();
      setSelectedElementIds(bundleSelectionIds);
      setSelection(getSelectionForElementId(interactionOwnerId, elementsById));
    }

  }, [setSelection, setOverlapBadgeMenu, elementsById, findElementByName, currentFloorZ, floors, selectedElementIds, setSelectedElementIds, clearElementSelection, overlayMoveMode, overlayCalibrateMode]);

  // RAF-throttled stage mousemove wrapper (defined after both handlers to ensure init order)
  const latestMouseEventRef = useRef<any>(null);
  const mouseMoveRafIdRef = useRef<number | null>(null);
  const stageMouseMoveWorkRef = useRef<StageMouseMoveWork>({ draw: false, marquee: false, hover: false });
  const handleStageMouseDown = useCallback((e: any) => {
    setDevelopmentContextStackMenuId(null);
    setDevelopmentContextHoveredStem(null);
    commitViewportPreview();
    const evt = e.evt as MouseEvent;
    const pointer = getContainerViewportPointer(evt);
    const shouldStartStagePan = shouldStartStagePanGesture({
      drawMode,
      mouseButton: evt.button,
      panModifierHeld: panModifierHeldRef.current,
      pointerAvailable: Boolean(pointer),
      viewMode,
    });
    if (shouldStartStagePan && pointer) {
      evt.preventDefault();
      endDrawingPreviewInteraction();
      const session = beginCanvasInteraction({
        kind: 'stage-pan',
        targetId: 'stage',
        preview: {
          mode: 'signalOnly',
          reset: () => {},
        },
      });
      if (!session) return;
      activePanGestureRef.current = {
        startPointer: { x: pointer.x, y: pointer.y },
        session,
      };
      suppressStageClickRef.current = true;
      setIsCanvasPanning(true);
      return;
    }
    handleMarqueeStart(e);
  }, [commitViewportPreview, drawMode, endDrawingPreviewInteraction, getContainerViewportPointer, handleMarqueeStart, setDevelopmentContextHoveredStem, setDevelopmentContextStackMenuId, setIsCanvasPanning, viewMode]);

  const onStageMouseMove = useCallback((e: any) => {
    const activeCanvasInteraction = getActiveCanvasInteraction();
    if (!canCanvasInteractionRunStageMouseMove(activeCanvasInteraction?.kind)) return;
    if (typeof e.target?.isDragging === 'function' && e.target.isDragging()) return;
    const stageForDrag = e.target?.getStage?.();
    if (typeof stageForDrag?.isDragging === 'function' && stageForDrag.isDragging()) return;
    const activePanGesture = activePanGestureRef.current;
    if (activePanGesture) {
      const pointer = getContainerViewportPointer(e.evt as MouseEvent);
      if (!pointer) return;
      geometryPerf.markNextFrame('GeometryCanvas.stagePan.nextFrame');
      geometryPerf.measure('GeometryCanvas.stagePan.preview', () => {
        applyPanPreviewDelta({
          x: pointer.x - activePanGesture.startPointer.x,
          y: pointer.y - activePanGesture.startPointer.y,
        });
        scheduleViewportPreviewCommit();
      });
      return;
    }

    const mouseButtons = Number((e.evt as MouseEvent | undefined)?.buttons ?? 0);
    const targetIsDraggable =
      typeof e.target?.draggable === 'function' &&
      e.target.draggable();
    if (mouseButtons !== 0 && targetIsDraggable) return;

    const selectedElementForHover =
      selection?.type === 'element' ? elementsById[selection.id] : undefined;
    const needsSelectedPolygonHover =
      selectedElementForHover &&
      getElementShape(selectedElementForHover) === 'polygon' &&
      selectedElementForHover.coordinates &&
      selectedElementForHover.coordinates.length >= 3;
    const needsSpaceLabelHover =
      spaceLabellerOpen &&
      Boolean(spaceLabellerSelectedLabelId) &&
      !activePanGestureRef.current;
    const stageMouseMoveWork = getStageMouseMoveWork({
      drawMode,
      marqueeActive: Boolean(marqueeSelection?.isActive),
      selectedPolygonHoverActive: Boolean(needsSelectedPolygonHover),
      spaceLabelHoverActive: Boolean(needsSpaceLabelHover),
    });
    if (!stageMouseMoveWork.draw && !stageMouseMoveWork.marquee && !stageMouseMoveWork.hover) {
      return;
    }

    latestMouseEventRef.current = e;
    stageMouseMoveWorkRef.current = stageMouseMoveWork;
    if (mouseMoveRafIdRef.current == null) {
      const raf = (window.requestAnimationFrame || ((cb: any) => setTimeout(cb, 16)));
      mouseMoveRafIdRef.current = raf(() => {
        geometryPerf.markNextFrame('GeometryCanvas.stageMouseMove.nextFrame');
        geometryPerf.measure('GeometryCanvas.stageMouseMove.raf', () => {
          const evt = latestMouseEventRef.current;
          latestMouseEventRef.current = null;
          mouseMoveRafIdRef.current = null;
          const work = stageMouseMoveWorkRef.current;
          stageMouseMoveWorkRef.current = { draw: false, marquee: false, hover: false };
          if (!evt) return;

          if (work.draw || work.hover) handleMouseMove(evt);
          if (work.marquee) handleMarqueeMove(evt);
        });
      }) as unknown as number;
    }
  }, [
    applyPanPreviewDelta,
    drawMode,
    elementsById,
    getContainerViewportPointer,
    handleMouseMove,
    handleMarqueeMove,
    marqueeSelection,
    scheduleViewportPreviewCommit,
    selection,
    spaceLabellerOpen,
    spaceLabellerSelectedLabelId,
  ]);

  const handleStageMouseUp = useCallback((e: any) => {
    const activePanGesture = activePanGestureRef.current;
    if (activePanGesture) {
      const pointer = getContainerViewportPointer(e.evt as MouseEvent);
      if (pointer) {
        applyPanPreviewDelta({
          x: pointer.x - activePanGesture.startPointer.x,
          y: pointer.y - activePanGesture.startPointer.y,
        });
        scheduleViewportPreviewCommit();
      }
      endCanvasPanGesture();
      return;
    }
    handleMarqueeEnd(e);
  }, [applyPanPreviewDelta, endCanvasPanGesture, getContainerViewportPointer, handleMarqueeEnd, scheduleViewportPreviewCommit]);

  useEffect(() => {
    return () => {
      if (mouseMoveRafIdRef.current != null && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(mouseMoveRafIdRef.current);
      }
      mouseMoveRafIdRef.current = null;
      latestMouseEventRef.current = null;
      stageMouseMoveWorkRef.current = { draw: false, marquee: false, hover: false };
    };
  }, []);

  const resolveDrawTargetZoneId = useCallback(
    () =>
      resolveTargetZoneIdForNewCanvasElement(zones, selection, elementsById, createPlaceholderZone),
    [zones, selection, elementsById, createPlaceholderZone],
  );

  /**
   * Creates the element a draw click commits and consumes any pending host-element creation
   * request, returning the prefill to merge into the element patch.
   *
   * Every draw branch did these two steps inline - the zone call pasted eight times with broken
   * indentation, the pending-request block eight times as an identical ten-line try/catch. That
   * copy-and-paste preamble is how three branches ended up deriving the selection type from a
   * stale `elementsById` snapshot (fixed in #104); one entry point makes that drift much harder.
   */
  const beginDrawnElement = useCallback(
    (
      targetZoneId: string,
      type: ElementType,
      parentName?: string,
    ): { elementId: string; hostPrefill: Record<string, unknown> | undefined } => {
      const elementId = createPlaceholderElement(targetZoneId, type, parentName);
      let hostPrefill: Record<string, unknown> | undefined;
      try {
        const pending = pendingHostElementCreationRef.current;
        if (pending) {
          // Copied and the ref cleared before `onCreated` is dispatched, so a throw there still
          // leaves the prefill intact - exactly what the per-branch copies did.
          hostPrefill = pending.prefill ? { ...pending.prefill } : undefined;
          pendingHostElementCreationRef.current = null;
          void pending.onCreated?.(elementId);
        }
      } catch {
        /* swallow: best-effort, preserved from the previous per-branch behaviour */
      }
      return { elementId, hostPrefill };
    },
    [createPlaceholderElement, pendingHostElementCreationRef],
  );

  // Handle stage click
  const handleStageClick = (e: any) => {
    const stage = e.target.getStage();
    if (suppressStageClickRef.current) {
      suppressStageClickRef.current = false;
      return;
    }
    // While overlay Move/Calibrate is active, do not let stage clicks clear selection or place geometry.
    if (overlayMoveMode || overlayCalibrateMode) return;
    // If a marquee selection just completed, skip clearing selection on this click
    if (marqueeJustCompletedRef.current) {
      marqueeJustCompletedRef.current = false;
      return;
    }
    // Always process draw-mode clicks, regardless of target (shapes may stop propagation)
    if (drawMode !== 'none') {
      // Get pointer position from stage (with snap-to-vertex for draw clicks)
      const mouseWorldRaw = getMouseWorld(stage, scale, panOffset, canvasCenter);
      const activeSnapPoints = drawMode === 'room' ? roomWalls : drawPoints;
      const lastSnapPoint =
        activeSnapPoints.length > 0 ? activeSnapPoints[activeSnapPoints.length - 1] : null;
      const pdSnap = getProjectDefaults(geometryStore);
      const drawSnapClick = utilResolveDrawSnapPoint({
        mouseWorld: mouseWorldRaw,
        lastPoint: lastSnapPoint,
        elementsById: elementsById as any,
        snapCache: spaceLabelSnapCache,
        excludeElementId: '__draw__',
        snapTol: pdSnap.snapTol,
        orthogonalModifierHeld,
        angleTolDeg: pdSnap.angleTol,
      });
      const mouseWorld = drawSnapClick.point;

        if (drawMode === 'dormer') {
          const hostRoof = findDormerHostAtPoint(mouseWorld);
          const pointerPosition = getStageViewportPointer(stage);

          if (!hostRoof) {
            if (pointerPosition) {
              setDrawingTooltip({
                visible: true,
                text: 'Dormers must be placed on a sloped roof polygon',
                position: { x: pointerPosition.x + 10, y: pointerPosition.y - 10 },
              });
            }
            return;
          }

          const targetZoneId = hostRoof.zoneId ?? (zones.length > 0 ? zones[0].id : createPlaceholderZone());
          const existingBundleNames = Object.values(elementsById)
            .map((element) => getDormerBundleName(element))
            .filter((name): name is string => !!name);
          const draft = buildDormerBundleDraft({
            host: hostRoof,
            dormerType: 'mono-pitch',
            windowCenterPlanPoint: { x: mouseWorld.x, y: mouseWorld.y },
            existingNames: Object.values(elementsById).map((element) => element.name),
            existingBundleNames,
            floors,
            globalOrientationOffset: geometryStore.getState().globalOrientationOffset,
          });

          if (!draft) {
            return;
          }

          const frontWallId = createPlaceholderElement(targetZoneId, 'BuildingElementOpaque', hostRoof.name);
          const leftCheekWallId = createPlaceholderElement(targetZoneId, 'BuildingElementOpaque');
          const rightCheekWallId = createPlaceholderElement(targetZoneId, 'BuildingElementOpaque');
          const roofId = createPlaceholderElement(targetZoneId, 'BuildingElementOpaque');
          const windowId = createPlaceholderElement(targetZoneId, 'BuildingElementTransparent', draft.names.frontWall);

          updateElement(frontWallId, {
            name: draft.names.frontWall,
            ...draft.frontWall,
          }, true);
          updateElement(leftCheekWallId, {
            name: draft.names.leftCheekWall,
            ...draft.leftCheekWall,
          }, true);
          updateElement(rightCheekWallId, {
            name: draft.names.rightCheekWall,
            ...draft.rightCheekWall,
          }, true);
          updateElement(roofId, {
            name: draft.names.roofs[0] ?? 'Roof',
            ...draft.roof,
          }, true);
          updateElement(windowId, {
            name: draft.names.window,
            ...draft.window,
          }, true);

          const hostFloorZ = hostRoof.coordinates[0]?.z ?? currentFloorZ;
          const dormerSelectionIds = [
            frontWallId,
            leftCheekWallId,
            rightCheekWallId,
            roofId,
            windowId,
          ];

          setCurrentFloorZ(hostFloorZ);
          setSelection({ type: 'dormer', id: draft.bundleId });
          setSelectedElementIds(dormerSelectionIds);
          setDrawingTooltip({ visible: false, text: '', position: { x: 0, y: 0 } });

          if (!multiDrawModifierHeldRef.current) {
            setDrawMode('none');
          }
          return;
        } else if (drawMode === 'point') {
          // Create point element
          const targetZoneId = resolveDrawTargetZoneId();

          if (drawElementType === 'WindowShading') {
            // Attach to nearest window (BuildingElementTransparent) if within tolerance
            const tol = getProjectDefaults(geometryStore).snapTol * 2;
            let best: { id: string; name: string; proj: { x: number; y: number }; z: number; d: number } | null = null;
            for (const id of elementIds) {
              const el = elementsById[id];
              if (!el || el.type !== 'BuildingElementTransparent') continue;
              const cc = el.coordinates || [];
              if (cc.length !== 2) continue;
              const [A, B] = cc as any;
              const vx = B.x - A.x; const vy = B.y - A.y;
              const v2 = vx * vx + vy * vy; if (v2 === 0) continue;
              const tRaw = ((mouseWorld.x - A.x) * vx + (mouseWorld.y - A.y) * vy) / v2;
              const t = Math.max(0, Math.min(1, tRaw));
              const px = A.x + t * vx; const py = A.y + t * vy;
              const d = Math.hypot(mouseWorld.x - px, mouseWorld.y - py);
              if (d <= tol && (!best || d < best.d)) {
                best = { id, name: el.name || id, proj: { x: px, y: py }, z: A.z, d };
              }
            }

            if (best) {
              const { elementId, hostPrefill } = beginDrawnElement(targetZoneId, drawElementType, best.name);
              const elementZ = typeof best.z === 'number' ? best.z : currentFloorZ;
              updateElement(elementId, {
                ...drawPresetProps,
                coordinates: [{ x: best.proj.x, y: best.proj.y, z: elementZ }],
                parent_element: best.name,
                ...(hostPrefill || {})
              }, true);
              setCurrentFloorZ(elementZ);
              setSelection({ type: 'element', id: elementId });
              // Only clear draw mode if Alt/Option is not held
              if (!multiDrawModifierHeldRef.current) {
                setDrawMode('none');
              }
              return;
            }
            // If no nearby window, fall back to generic point placement
          }

          if (drawElementType === 'MechanicalVentilationTerminal') {
            const { elementId, hostPrefill } = beginDrawnElement(targetZoneId, drawElementType);
            const hostPlacement = findMvhrTerminalHostForDrawPoint(
              mouseWorld,
              elementsById as Record<string, Element>,
              getProjectDefaults(geometryStore).snapTol * 2,
            );
            const terminalPlanPoint = hostPlacement?.point ?? mouseWorld;
            updateElement(elementId, {
              ...drawPresetProps,
              ...drawMvhrRolePropsRef.current,
              extra_json: undefined,
              coordinates: [{
                x: terminalPlanPoint.x,
                y: terminalPlanPoint.y,
                z: DEFAULT_DRAWN_MVHR_TERMINAL_HEIGHT_M,
              }],
              floorId: hostPlacement?.host.floorId ?? ensureFloorForZ(currentFloorZ),
              host_element: hostPlacement?.host.name ?? null,
              ...(hostPrefill || {}),
            } as any, true);
            setCurrentFloorZ(currentFloorZ);
            setSelection({ type: 'global', id: elementId });
            if (!multiDrawModifierHeldRef.current) {
              setDrawMode('none');
            }
            return;
          }

          const { elementId, hostPrefill } = beginDrawnElement(targetZoneId, drawElementType);
          const isThermalBridgePoint = drawElementType === 'ThermalBridgePoint';
          const elementZ = isThermalBridgePoint
            ? calculateDerivedBaseHeight(currentFloorZ, withEffectiveStoreyHeights(floors, Object.values(elementsById)))
            : currentFloorZ;
          const pointFloorId = isThermalBridgePoint ? ensureFloorForZ(currentFloorZ) : undefined;
          updateElement(elementId, {
            ...drawPresetProps,
            ...drawMvhrRolePropsRef.current,
            ...(isThermalBridgePoint ? { floorId: pointFloorId } : {}),
            coordinates: [{ x: mouseWorld.x, y: mouseWorld.y, z: elementZ }],
            ...(hostPrefill || {})
          }, true);

          // Auto-switch to the floor where the element was created
          setCurrentFloorZ(currentFloorZ);
          // Use store state so just-placed elements (e.g. System) resolve for global vs element selection
          setSelection(selectionForDrawnElement(geometryStore, elementId));
          // Only clear draw mode if Alt/Option is not held
          if (!multiDrawModifierHeldRef.current) {
            setDrawMode('none');
          }
        } else if (drawMode === 'line' || isServiceLineDrawMode(drawMode)) {
          const multiDrawActive = isMultiDrawActiveForEvent(e?.evt);
          const serviceLineMode = serviceLineModeFromDrawMode(drawMode);
          const draftStartZ = parseEditorDecimal(serviceLineDraftStartZ) ?? serviceLineDrawBaseZ;
          const draftEndZ =
            serviceLineMode === 'plan'
              ? draftStartZ
              : parseEditorDecimal(serviceLineDraftEndZ) ?? draftStartZ + 1;
          if (
            isServiceLineElementType(drawElementType)
            && drawMode === 'tb-vertical-line'
            && drawPoints.length === 0
          ) {
            const targetZoneId = resolveDrawTargetZoneId();
            const { elementId, hostPrefill } = beginDrawnElement(targetZoneId, drawElementType);
            const elementZ = currentFloorZ;
            const drawFloorId = isServiceLineElementType(drawElementType)
              ? (mvhrDuctDrawFloorId || ensureFloorForZ(currentFloorZ))
              : undefined;
            const extraWithServiceFloor = drawFloorId
              ? mergeServiceLineExtraJsonFloorId(
                  {
                    type: drawElementType,
                    extra_json:
                      drawElementType === 'ThermalBridgeLinear'
                        ? writeTbLineMode((drawPresetProps as { extra_json?: unknown })?.extra_json, 'vertical')
                        : drawElementType === 'MechanicalVentilationDuctwork'
                          ? undefined
                        : (drawPresetProps as { extra_json?: unknown })?.extra_json,
                  } as Element,
                  Math.floor(Number(currentFloorZ)),
                )
              : undefined;
            const verticalCoordinates = createServiceLineCoordinatesWithEndpointZ(
              mouseWorld,
              mouseWorld,
              draftStartZ,
              draftEndZ,
              'vertical',
            );
            updateElement(
              elementId,
              {
                ...drawPresetProps,
                ...drawMvhrRolePropsRef.current,
                ...(drawFloorId ? { floorId: drawFloorId } : {}),
                coordinates: verticalCoordinates,
                length: getServiceLineLengthFromCoordinates(verticalCoordinates),
                isPlaceholder: false,
                ...(hostPrefill || {}),
                ...(extraWithServiceFloor ? { extra_json: extraWithServiceFloor } : {}),
              } as any,
              true,
            );
            setCurrentFloorZ(elementZ);
            setSelection({
              type: drawElementType === 'WaterPipework' || drawElementType === 'MechanicalVentilationDuctwork' ? 'global' : 'element',
              id: elementId,
            });
            const verticalEndPoint = verticalCoordinates[1] ?? verticalCoordinates[0];
            if (multiDrawActive && verticalEndPoint) {
              setDrawPoints([{ x: verticalEndPoint.x, y: verticalEndPoint.y }]);
              setActiveServiceLineElementId(elementId);
            } else {
              setDrawPoints([]);
              setActiveServiceLineElementId(null);
            }
            if (!multiDrawActive) {
              setDrawMode('none');
            }
            serviceLineDraftAnchorKeyRef.current = null;
            setServiceLineDraftStartZ(formatServiceLineEditorNumber(verticalEndPoint?.z ?? draftEndZ));
            setServiceLineDraftEndZ(formatServiceLineEditorNumber((verticalEndPoint?.z ?? draftEndZ) + 1));
            return;
          }
          if (drawPoints.length === 0) {
            // First point (mouseWorld already resolved via resolveDrawSnapPoint at click)
            setDrawPoints([{ x: mouseWorld.x, y: mouseWorld.y }]);
          } else {
            // Second point - create line
            const targetZoneId = resolveDrawTargetZoneId();
            const { elementId, hostPrefill } = beginDrawnElement(targetZoneId, drawElementType);
            const elementZ = currentFloorZ;
            const lastPoint = drawPoints[0];
            const endPoint = { x: mouseWorld.x, y: mouseWorld.y };
            const drawFloorId = isServiceLineElementType(drawElementType)
              ? (mvhrDuctDrawFloorId || ensureFloorForZ(currentFloorZ))
              : undefined;
            const extraWithServiceFloor =
              drawFloorId
                ? mergeServiceLineExtraJsonFloorId(
                    {
                      type: drawElementType,
                      extra_json:
                        drawElementType === 'ThermalBridgeLinear'
                          ? writeTbLineMode((drawPresetProps as { extra_json?: unknown })?.extra_json, serviceLineMode)
                          : drawElementType === 'MechanicalVentilationDuctwork'
                            ? undefined
                          : (drawPresetProps as { extra_json?: unknown })?.extra_json,
                    } as Element,
                    Math.floor(Number(currentFloorZ)),
                  )
                : undefined;
            const lineCoordinates =
              isServiceLineElementType(drawElementType)
                ? createServiceLineCoordinatesWithEndpointZ(
                    lastPoint,
                    endPoint,
                    draftStartZ,
                    draftEndZ,
                    serviceLineMode,
                  )
                : [
                    { x: lastPoint.x, y: lastPoint.y, z: elementZ },
                    { x: endPoint.x, y: endPoint.y, z: elementZ },
                  ];
            const serviceLineLengthPatch = isServiceLineElementType(drawElementType)
              ? { length: getServiceLineLengthFromCoordinates(lineCoordinates), isPlaceholder: false }
              : {};
            const openingParentPatch =
              drawElementType === 'BuildingElementTransparent' && !isServiceLineElementType(drawElementType)
                ? utilResolveOpeningSegmentParentFromCache(
                    lineCoordinates,
                    activeGeometrySnapCache,
                    elementsById as Record<string, Element>,
                    elementId,
                    getProjectDefaults(geometryStore).snapTol,
                  )
                : null;

            updateElement(elementId, {
              ...drawPresetProps,
              ...drawMvhrRolePropsRef.current,
              ...(getDefaultLinePitchPatch(drawElementType, drawPresetProps) ?? {}),
              ...(drawFloorId ? { floorId: drawFloorId } : {}),
              coordinates: openingParentPatch?.coordinates ?? lineCoordinates,
              ...serviceLineLengthPatch,
              ...(openingParentPatch ? { parent_element: openingParentPatch.parentName } : {}),
              ...(hostPrefill || {}),
              ...(extraWithServiceFloor ? { extra_json: extraWithServiceFloor } : {}),

              // If WetEmitter drawn as a line, default to radiator subcategory
              ...(drawElementType === 'WetEmitter' ? { subcategory: 'radiator' as any } : {})
            }, true);

            // Auto-switch to the floor where the element was created
            setCurrentFloorZ(elementZ);
            setSelection({
              type: drawElementType === 'WaterPipework' || drawElementType === 'MechanicalVentilationDuctwork' ? 'global' : 'element',
              id: elementId,
            });
            const placedEndPoint = lineCoordinates[1] ?? { x: endPoint.x, y: endPoint.y, z: draftEndZ };
            setDrawPoints(
              multiDrawActive
                ? [{ x: placedEndPoint.x, y: placedEndPoint.y }]
                : [],
            );
            if (isServiceLineElementType(drawElementType)) {
              setActiveServiceLineElementId(multiDrawActive ? elementId : null);
              serviceLineDraftAnchorKeyRef.current = null;
              setServiceLineDraftStartZ(formatServiceLineEditorNumber(placedEndPoint.z));
              setServiceLineDraftEndZ(formatServiceLineEditorNumber(
                serviceLineMode === 'plan' ? placedEndPoint.z : placedEndPoint.z + 1,
              ));
            } else {
              setActiveServiceLineElementId(null);
            }
            // Only clear draw mode if Alt/Option is not held
            if (!multiDrawActive) {
              setDrawMode('none');
            }
          }
        } else if (drawMode === 'polygon' || drawMode === 'space-label-polygon') {
          const isSpaceLabelPolygon = drawMode === 'space-label-polygon';
          const snappedPoint = mouseWorld;

          if (drawPoints.length === 0) {
            setDrawPoints([{ x: snappedPoint.x, y: snappedPoint.y }]);
            setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
            setActiveSegmentEditor(null);
          } else {
            const firstPoint = drawPoints[0];
            const dist = Math.hypot(snappedPoint.x - firstPoint.x, snappedPoint.y - firstPoint.y);
            if (dist < 0.1 && drawPoints.length >= 3) {
              const elementZ = currentFloorZ;
              const coordinates = drawPoints.map(p => ({ x: p.x, y: p.y, z: elementZ }));

              if (isSpaceLabelPolygon) {
                const g = geometryStore.getState();
                const zid = g.spaceLabellerZoneId;
                if (zid) {
                  const storey = Math.max(0, g.floors.findIndex(f => f.zIndex === g.currentFloorZ));
                  const newLabelId = g.addSpaceLabel({ zoneId: zid, coordinates, storey });
                  if (newLabelId) {
                    setSpaceLabellerExpandLabelId(newLabelId);
                    setSpaceLabellerSelectedLabelId(newLabelId);
                  }
                }
                setCurrentFloorZ(elementZ);
                setDrawPoints([]);
                setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
                setActiveSegmentEditor(null);
                if (!multiDrawModifierHeldRef.current) {
                  setDrawMode('none');
                }
              } else {
                const targetZoneId = resolveDrawTargetZoneId();
                const { elementId, hostPrefill } = beginDrawnElement(targetZoneId, drawElementType);
                const flatPolyFloorPatch = getEnvelopeDrawFloorPatch(
                  drawElementType,
                  elementZ,
                  floors,
                  Object.values(elementsById),
                  ensureFloorForZ,
                );
                updateElement(elementId, {
                  ...drawPresetProps,
                  ...(getDefaultFlatPolygonPitchPatch(drawElementType, drawPresetProps) ?? {}),
                  coordinates,
                  ...(hostPrefill || {}),
                  ...(flatPolyFloorPatch ?? {}),
                  ...(drawElementType === 'BuildingElementTransparent'
                    ? getTransparentRoofHostPatch(coordinates)
                    : {}),
                  ...(drawElementType === 'WetEmitter' ? { subcategory: 'ufh' as any } : {}),
                });
                setCurrentFloorZ(elementZ);
                setSelection(selectionForDrawnElement(geometryStore, elementId));
                setDrawPoints([]);
                setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
                setActiveSegmentEditor(null);
                if (!multiDrawModifierHeldRef.current) {
                  setDrawMode('none');
                }
              }
            } else {
              const nextPoints = [...drawPoints, { x: snappedPoint.x, y: snappedPoint.y }];
              const previousPoint = drawPoints[drawPoints.length - 1];
              setDrawPoints(nextPoints);
              setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
              setActiveSegmentEditor({
                mode: isSpaceLabelPolygon ? 'space-label-polygon' : 'polygon',
                endIndex: nextPoints.length - 1,
                value: formatSegmentLength(
                  Math.hypot(snappedPoint.x - previousPoint.x, snappedPoint.y - previousPoint.y),
                ),
              });
            }
          }
        } else if (drawMode === 'sloped-polygon') {
          const snappedPoint = mouseWorld;

          if (drawElementType === 'OnSiteGeneration') {
            // Two-click PV: bottom edge = module eaves side; rectangle depth from preset/module W×H
            if (drawPoints.length === 0) {
              setDrawPoints([{ x: snappedPoint.x, y: snappedPoint.y }]);
              setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
              setActiveSegmentEditor(null);
            } else if (drawPoints.length === 1) {
              const targetZoneId = resolveDrawTargetZoneId();
              const { elementId, hostPrefill } = beginDrawnElement(targetZoneId, drawElementType);
              const elementZ = currentFloorZ;
              const A = drawPoints[0];
              const B_dir = { x: snappedPoint.x, y: snappedPoint.y };
              const { longM, shortM } = getPvFootprintDimensionsFromPreset(drawPresetData);
              const presetForPv = drawPresetProps as {
                pitch?: number;
                extra_json?: unknown;
              };
              const presetPitch = presetForPv.pitch;
              const pitch =
                typeof presetPitch === 'number' && Number.isFinite(presetPitch) ? presetPitch : 35;
              const coordinates = buildPvPanelRectangleCoords({
                A,
                B_dir,
                z: elementZ,
                longM,
                shortM,
                flipUpslope: false,
                bottomIsLong: true,
                pitchDegrees: pitch,
              });
              const globalOrientationOffset = geometryStore.getState().globalOrientationOffset;
              const orientation360 = orientation360SlopedFromFirstEdge(
                A.x,
                A.y,
                B_dir.x,
                B_dir.y,
                globalOrientationOffset,
              );
              const baseExtra: Record<string, unknown> =
                presetForPv.extra_json && typeof presetForPv.extra_json === 'object'
                  ? { ...(presetForPv.extra_json as Record<string, unknown>) }
                  : {};
              baseExtra._pv_footprint_flip = false;
              baseExtra._pv_bottom_is_long = true;
              const pvFloorPatch = getEnvelopeDrawFloorPatch(
                drawElementType,
                elementZ,
                floors,
                Object.values(elementsById),
                ensureFloorForZ,
              );

              updateElement(elementId, {
                ...drawPresetProps,
                coordinates,
                ...(hostPrefill || {}),
                ...(pvFloorPatch ?? {}),
                orientation360: Math.round((orientation360 ?? 0) * 100) / 100,
                pitch,
                extra_json: baseExtra,
              });

              setCurrentFloorZ(elementZ);
              setSelection(selectionForDrawnElement(geometryStore, elementId));
              setDrawPoints([]);
              setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
              setActiveSegmentEditor(null);
              if (!multiDrawModifierHeldRef.current) {
                setDrawMode('none');
              }
            }
          } else if (drawPoints.length === 0) {
            // First point - start bottom edge
            setDrawPoints([{ x: snappedPoint.x, y: snappedPoint.y }]);
            setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
            setActiveSegmentEditor(null);
          } else if (drawPoints.length === 1) {
            // Second point - complete bottom edge
            const nextPoints = [...drawPoints, { x: snappedPoint.x, y: snappedPoint.y }];
            const previousPoint = drawPoints[drawPoints.length - 1];
            setDrawPoints(nextPoints);
            setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
            setActiveSegmentEditor({
              mode: 'sloped-polygon',
              endIndex: nextPoints.length - 1,
              value: formatSegmentLength(
                Math.hypot(snappedPoint.x - previousPoint.x, snappedPoint.y - previousPoint.y),
              ),
            });
          } else {
            // Check if clicking near first point to complete
            const firstPoint = drawPoints[0];
            const dist = Math.hypot(snappedPoint.x - firstPoint.x, snappedPoint.y - firstPoint.y);
            if (dist < 0.1 && drawPoints.length >= 3) {
              // Complete sloped polygon
              const targetZoneId = resolveDrawTargetZoneId();
              const { elementId, hostPrefill } = beginDrawnElement(targetZoneId, drawElementType);
              const elementZ = currentFloorZ;
              const coordinates = ensureCounterClockwiseKeepingLeadEdge(
                drawPoints.map(p => ({ x: p.x, y: p.y, z: elementZ })),
              );
              const slopedFloorPatch = getEnvelopeDrawFloorPatch(
                drawElementType,
                elementZ,
                floors,
                Object.values(elementsById),
                ensureFloorForZ,
              );

              const globalOrientationOffset = geometryStore.getState().globalOrientationOffset;
              const firstEdgeStart = coordinates[0];
              const firstEdgeEnd = coordinates[1];
              const orientation360 = orientation360SlopedFromFirstEdge(
                firstEdgeStart.x,
                firstEdgeStart.y,
                firstEdgeEnd.x,
                firstEdgeEnd.y,
                globalOrientationOffset,
              );

              updateElement(elementId, {
                ...drawPresetProps,
                coordinates,
                ...(hostPrefill || {}),
                ...(slopedFloorPatch ?? {}),
                ...(drawElementType === 'BuildingElementTransparent'
                  ? getTransparentRoofHostPatch(coordinates)
                  : {}),
                orientation360: Math.round((orientation360 ?? 0) * 100) / 100, // Round to 2 decimal places for data quality
                pitch: 30 // Default pitch for sloped polygon (user can adjust)
              });

              // Auto-switch to the floor where the element was created
              setCurrentFloorZ(elementZ);
              // Determine selection type based on whether element is a global object
              setSelection(selectionForDrawnElement(geometryStore, elementId));
              setDrawPoints([]);
              setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
              setActiveSegmentEditor(null);
              // Only clear draw mode if Alt/Option is not held
              if (!multiDrawModifierHeldRef.current) {
                setDrawMode('none');
              }
            } else {
              // Add slope point
              const nextPoints = [...drawPoints, { x: snappedPoint.x, y: snappedPoint.y }];
              const previousPoint = drawPoints[drawPoints.length - 1];
              setDrawPoints(nextPoints);
              setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
              setActiveSegmentEditor({
                mode: 'sloped-polygon',
                endIndex: nextPoints.length - 1,
                value: formatSegmentLength(
                  Math.hypot(snappedPoint.x - previousPoint.x, snappedPoint.y - previousPoint.y),
                ),
              });
            }
          }
        } else if (drawMode === 'room') {
          if (roomWalls.length === 0) {
            // First point - start room
            setRoomWalls([{ x: mouseWorld.x, y: mouseWorld.y }]);
            setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
            setActiveSegmentEditor(null);
          } else {
            // Check for completion (click near start)
            const firstPoint = roomWalls[0];
            const dist = Math.hypot(mouseWorld.x - firstPoint.x, mouseWorld.y - firstPoint.y);

            if (dist < 0.1 && roomWalls.length >= 3) {
              // Complete room - create final wall segment and floor polygon
              const roomWallSegments = buildOutwardRoomWallSegments(roomWalls, currentFloorZ);
              roomWallElements.forEach((wallId, index) => {
                const segment = roomWallSegments[index];
                if (!segment) return;
                updateElement(wallId, {
                  coordinates: segment,
                });
              });

              // Create final wall segment (from last point to first point)
              const targetZoneId = resolveDrawTargetZoneId();
              const finalWallId = createPlaceholderElement(targetZoneId, drawElementType);

              const finalWallCoordinates = roomWallSegments[roomWallSegments.length - 1] ?? [];

              updateElement(finalWallId, {
                ...drawPresetProps,
                ...(getDefaultLinePitchPatch(drawElementType, drawPresetProps) ?? {}),
                coordinates: finalWallCoordinates,
              });

              // Create floor polygon
              const floorId = createPlaceholderElement(targetZoneId, 'BuildingElementGround');
              const coordinates = ensureCounterClockwisePolygon(
                roomWalls.map(p => ({ x: p.x, y: p.y, z: currentFloorZ })),
              );
              updateElement(floorId, { coordinates });

              // Auto-select first wall element for naming
              if (roomWallElements.length > 0) {
                setSelection({ type: 'element', id: roomWallElements[0] });
              }

              // Auto-switch to the floor where the element was created
              setCurrentFloorZ(currentFloorZ);

              // Reset room state
              setRoomWalls([]);
              setRoomWallElements([]);
              setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
              setActiveSegmentEditor(null);
              // Only clear draw mode if Alt/Option is not held
              if (!multiDrawModifierHeldRef.current) {
                setDrawMode('none');
              }
            } else {
              const startPoint = roomWalls[roomWalls.length - 1];
              const elementZ = currentFloorZ;
              const endPoint = { x: mouseWorld.x, y: mouseWorld.y };

              // Create wall element using selected element type
              const targetZoneId = resolveDrawTargetZoneId();
              const wallId = createPlaceholderElement(targetZoneId, drawElementType);

              const coordinates = [
                { x: startPoint.x, y: startPoint.y, z: elementZ },
                { x: endPoint.x, y: endPoint.y, z: elementZ }
              ];
              updateElement(wallId, {
                ...drawPresetProps,
                ...(getDefaultLinePitchPatch(drawElementType, drawPresetProps) ?? {}),
                coordinates,
              });

              // Update room state with snapped endPoint
              const nextWalls = [...roomWalls, { x: endPoint.x, y: endPoint.y }];
              setRoomWalls(nextWalls);
              setRoomWallElements([...roomWallElements, wallId]);
              setSegmentLengthPreview(EMPTY_SEGMENT_LENGTH_PREVIEW);
              setActiveSegmentEditor({
                mode: 'room',
                endIndex: nextWalls.length - 1,
                wallElementId: wallId,
                value: formatSegmentLength(
                  Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y),
                ),
              });
            }
          }
        }
      return;
    }

    // Non-draw behavior: only clear selection when clicking empty stage
    if (e.target === stage) {
      // De-focus floating panels when clicking empty canvas
      setActivePanel(null);
      // Clear both single and multi-select
      setSelection(null);
      clearElementSelection();
      if (spaceLabellerOpen) setSpaceLabellerSelectedLabelId(null);
    }
  };

  const handleStageClickRef = useRef(handleStageClick);
  useLayoutEffect(() => {
    handleStageClickRef.current = handleStageClick;
  });
  const stableHandleStageClick = useCallback((e: any) => handleStageClickRef.current(e), []);

  const handleStageWheel = useCallback((e: any) => {
    const evt = e.evt as WheelEvent;
    const target = evt.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    evt.preventDefault();

    geometryPerf.markNextFrame('GeometryCanvas.wheel.nextFrame');
    geometryPerf.measure('GeometryCanvas.wheel.preview', () => {
      if (evt.ctrlKey || evt.metaKey) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const pointer = {
          x: evt.clientX - rect.left,
          y: evt.clientY - rect.top,
        };
        const preview = viewportPreviewTransformRef.current;
        const effectiveScale = scale * preview.scale;
        const zoom = Math.exp(-evt.deltaY * 0.0035);
        const nextEffectiveScale = Math.max(
          CANVAS_CONSTANTS.VIEW.MIN_SCALE,
          Math.min(CANVAS_CONSTANTS.VIEW.MAX_SCALE, effectiveScale * zoom),
        );
        const incrementalZoom = effectiveScale === 0 ? 1 : nextEffectiveScale / effectiveScale;
        if (incrementalZoom !== 1) {
          applyZoomPreview(pointer, incrementalZoom);
          scheduleViewportPreviewCommit();
        }
      } else if (evt.deltaX !== 0 || evt.deltaY !== 0) {
        const currentTransform = viewportPreviewTransformRef.current;
        applyPanPreviewDelta({
          x: currentTransform.x - evt.deltaX,
          y: currentTransform.y - evt.deltaY,
        });
        scheduleViewportPreviewCommit();
      }
    });
  }, [applyPanPreviewDelta, applyZoomPreview, scale, scheduleViewportPreviewCommit]);

  const buildElementRendererNodes = useCallback((rows: typeof sortedElementCanvasData) => {
    const selectedIds = new Set(selectedElementIds);
    return rows.map(({ element, canvasCoords }) => {
      const isSelected =
        (selection?.type === 'element' && selection.id === element.id) ||
        (selection?.type === 'global' && selection.id === element.id) ||
        (selection?.type === 'dormer' && getDormerBundleInfo(element)?.bundle_id === selection.id);
      const isMultiSelected = selectedIds.has(element.id);
      const isHighlighted = isSelected || isMultiSelected;

      return (
        <ElementRenderer
          key={element.id}
          element={element}
          canvasCoords={canvasCoords}
          scale={scale}
          panOffset={panOffset}
          canvasCenter={canvasCenter}
          isSelected={isHighlighted}
          updateElement={updateElementFromElementRenderer}
          handleElementClick={handleElementClick}
          elementsById={elementsById}
          elementIds={elementIds}
          nameToId={nameToId}
          categoryGhostOnCanvas={isElementHiddenOnView(element)}
          snapToParent={snapToParent}
          snapCorners={snapCorners}
          snapAngles={snapAngles}
          centerOnElement={centerOnElement}
          selectedVertex={selectedVertex}
          setSelectedVertex={setSelectedVertex}
          drawMode={drawMode}
          setElementHover={setCanvasElementHover}
          elementHover={elementHover}
          overlapBadgeMenu={overlapBadgeMenu}
          currentFloorZ={currentFloorZ}
          floors={floors}
          snapCache={geometrySnapCache}
          canvasElementPalette={canvasElementPalette}
          canvasInteractionPalette={canvasInteractionPalette}
          vertexSnapMode={vertexSnapMode}
          commitVertexPositionUpdates={commitVertexPositionUpdates}
          selection={selection}
          spaceLabellerSuppressFabricInteraction={spaceLabellerOpen}
        />
      );
    });
  }, [
    selectedElementIds,
    selection,
    scale,
    panOffset,
    canvasCenter,
    updateElementFromElementRenderer,
    handleElementClick,
    elementsById,
    elementIds,
    nameToId,
    isElementHiddenOnView,
    snapToParent,
    snapCorners,
    snapAngles,
    centerOnElement,
    selectedVertex,
    setSelectedVertex,
    drawMode,
    setCanvasElementHover,
    elementHover,
    overlapBadgeMenu,
    currentFloorZ,
    floors,
    geometrySnapCache,
    canvasElementPalette,
    canvasInteractionPalette,
    vertexSnapMode,
    commitVertexPositionUpdates,
    spaceLabellerOpen,
  ]);

  const contextFloorElementRendererNodes = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.elementRendererNodes.contextFloor', () =>
      buildElementRendererNodes(contextFloorElementCanvasData),
    );
  }, [buildElementRendererNodes, contextFloorElementCanvasData]);

  const currentFloorElementRendererNodes = useMemo(() => {
    return geometryPerf.measure('GeometryCanvas.elementRendererNodes.currentFloor', () =>
      buildElementRendererNodes(currentFloorElementCanvasData),
    );
  }, [buildElementRendererNodes, currentFloorElementCanvasData]);

  const isElementCategoryGhostFor3D = useCallback<NonNullable<GeometryCanvas3DProps['isElementCategoryGhost']>>(
    (id) => {
      const el = elementsById[id];
      return el ? isElementHiddenOnView(el) : false;
    },
    [elementsById, isElementHiddenOnView],
  );

  const liveGeometryCanvas3DProps = useMemo<GeometryCanvas3DProps>(() => ({
    elementsById,
    elementIds,
    floors,
    currentFloorZ,
    selection,
    selectedElementIds,
    setSelection: handle3DSelectionChange,
    frameRequest: frame3dRequest,
    onFrameRequestConsumed: clearFrame3dRequest,
    snapCache: geometrySnapCache,
    isElementCategoryGhost: isElementCategoryGhostFor3D,
  }), [
    elementsById,
    elementIds,
    floors,
    currentFloorZ,
    selection,
    selectedElementIds,
    handle3DSelectionChange,
    frame3dRequest,
    clearFrame3dRequest,
    geometrySnapCache,
    isElementCategoryGhostFor3D,
  ]);
  const [hiddenGeometryCanvas3DProps, setHiddenGeometryCanvas3DProps] = useState(liveGeometryCanvas3DProps);
  const handleViewModeChange = useCallback((nextViewMode: CanvasViewMode) => {
    if (nextViewMode === '3d') {
      setHasMountedGeometry3D(true);
    }
    if (nextViewMode === '2d') {
      setHiddenGeometryCanvas3DProps(liveGeometryCanvas3DProps);
    }
    setViewMode(nextViewMode);
  }, [liveGeometryCanvas3DProps, setHiddenGeometryCanvas3DProps, setViewMode]);
  const geometryCanvas3DProps = viewMode === '3d'
    ? liveGeometryCanvas3DProps
    : hiddenGeometryCanvas3DProps;
  const shouldMountGeometryCanvas3D = viewMode === '3d' || hasMountedGeometry3D;

  useEffect(() => {
    let cancelled = false;
    const preload = () => {
      if (!cancelled) prefetchGeometryCanvas3D();
    };
    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof win.requestIdleCallback === 'function') {
      const handle = win.requestIdleCallback(preload, { timeout: 5000 });
      return () => {
        cancelled = true;
        win.cancelIdleCallback?.(handle);
      };
    }
    const handle = window.setTimeout(preload, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, []);

  // Render canvas content - always portal for full-screen
  const canvasViewportInsetStyle = {
    '--geometry-canvas-host-top-inset-desktop': `${viewportInsets.desktopTopPx}px`,
    '--geometry-canvas-host-top-inset-mobile': `${viewportInsets.mobileTopPx}px`,
  } as React.CSSProperties;

  const canvasContent = (
    <div
      ref={documentSaveOwnerRootRef}
      className="geometry-canvas geometry-canvas-fullscreen"
      style={canvasViewportInsetStyle}
    >
      <div
        className="canvas-container"
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label="Geometry canvas"
        onMouseDownCapture={() => {
          containerRef.current?.focus();
        }}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        style={{
          cursor: isCanvasPanning
            ? 'grabbing'
            : (drawMode !== 'none' && panModifierHeld)
              ? 'grab'
              : undefined,
        }}
      >
        <div
          ref={staticPreviewSurfaceRef}
          className="geometry-static-preview-surface"
          aria-hidden="true"
          style={{
            width: stageSize.width + VIEWPORT_PREVIEW_OVERSCAN_PX * 2,
            height: stageSize.height + VIEWPORT_PREVIEW_OVERSCAN_PX * 2,
            left: -VIEWPORT_PREVIEW_OVERSCAN_PX,
            top: -VIEWPORT_PREVIEW_OVERSCAN_PX,
            display: viewMode === '2d' ? undefined : 'none',
          }}
        >
          <canvas ref={staticPreviewCanvasRef} className="geometry-static-preview-canvas" />
        </div>
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          onClick={stableHandleStageClick}
          onTap={stableHandleStageClick}
          onMouseMove={onStageMouseMove}
          onMouseDown={handleStageMouseDown}
          onMouseUp={handleStageMouseUp}
          onWheel={handleStageWheel}
          draggable={false}
        >
          <Layer name="geometry-context-layer" listening={false}>
            {developmentContextCanvasData.length > 0 && (
              <Group listening={false} name="development-context-layer">
                {developmentContextCanvasData.map((item) => {
                  const points = item.canvasCoords.flatMap((point) => [point.x, point.y]);
                  const isPolygon = item.shape === 'polygon' || item.shape === 'sloped-polygon';
                  const paint = developmentContextPaint[item.verticalRelation];
                  const isHoveredContextModel = developmentContextHoveredStem === item.modelStem;
                  return (
                    <Line
                      key={item.key}
                      points={points}
                      closed={isPolygon}
                      stroke={paint.stroke}
                      fill={isPolygon ? paint.fill : undefined}
                      strokeWidth={isHoveredContextModel ? (isPolygon ? 2.5 : 3.25) : (isPolygon ? 1.5 : 2.25)}
                      dash={paint.dash}
                      lineCap="round"
                      lineJoin="round"
                      opacity={isHoveredContextModel ? Math.min(1, paint.opacity + 0.26) : paint.opacity}
                      listening={false}
                    />
                  );
                })}
              </Group>
            )}
            {/* Dimmed other-floor geometry is visual context only. */}
            {ENABLE_GEOMETRY_CANVAS_REACT_PROFILER && geometryPerf.isEnabled() ? (
              <React.Profiler id="GeometryCanvas.layer2d.contextElements" onRender={recordGeometryCanvasProfiler}>
                {contextFloorElementRendererNodes}
              </React.Profiler>
            ) : (
              contextFloorElementRendererNodes
            )}
          </Layer>

          <Layer name="main-geometry-layer" listening={true}>
            {/* Current-floor geometry remains interactive; overlays and handles stay above it. */}
            {ENABLE_GEOMETRY_CANVAS_REACT_PROFILER && geometryPerf.isEnabled() ? (
              <React.Profiler id="GeometryCanvas.layer2d.currentElements" onRender={recordGeometryCanvasProfiler}>
                {currentFloorElementRendererNodes}
              </React.Profiler>
            ) : (
              currentFloorElementRendererNodes
            )}

        {/* Selected PV clearance guidance: advisory measurements, no compliance checklist. */}
        {selectedPvClearanceGuidance?.primary && (() => {
          const belowGuidanceItems = selectedPvClearanceGuidance.items.filter((item) => item.status === 'below-guidance');
          const itemsToRender =
            belowGuidanceItems.length > 0
              ? belowGuidanceItems
              : [selectedPvClearanceGuidance.primary];

          return (
            <Group key="selected-pv-clearance-guidance" listening={false}>
              {itemsToRender.map((item, index) => {
                const panelPoint = worldToCanvas(item.panelPoint, scale, panOffset, canvasCenter);
                const featurePoint = worldToCanvas(item.featurePoint, scale, panOffset, canvasCenter);
                const featureA = worldToCanvas(item.featureSegment[0], scale, panOffset, canvasCenter);
                const featureB = worldToCanvas(item.featureSegment[1], scale, panOffset, canvasCenter);
                const color =
                  item.status === 'below-guidance'
                    ? CANVAS_CONSTANTS.COLORS.VALIDATION_WARNING
                    : readRootCssVar('--semantic-snap', '#1E90FF');
                const labelText = `${item.label}: ${item.distanceM.toFixed(2)}m / ${item.guidanceDistanceM.toFixed(2)}m`;
                const measureDx = featurePoint.x - panelPoint.x;
                const measureDy = featurePoint.y - panelPoint.y;
                const measureLen = Math.hypot(measureDx, measureDy);
                const labelOffsetX = measureLen > 2 ? (measureDx / measureLen) * 18 : 8;
                const labelOffsetY = measureLen > 2 ? (measureDy / measureLen) * 18 : -28;
                const labelX = featurePoint.x + labelOffsetX + 8;
                const labelY = featurePoint.y + labelOffsetY - DRAW_MODE_TOOLTIP_PILL_HEIGHT / 2 + index * 6;
                const hasVisibleMeasureLine = measureLen > 2;

                return (
                  <Group key={`${item.feature}-${index}`} listening={false}>
                    <Line
                      points={[featureA.x, featureA.y, featureB.x, featureB.y]}
                      stroke={color}
                      strokeWidth={2}
                      dash={[7, 5]}
                      opacity={0.95}
                      listening={false}
                    />
                    {hasVisibleMeasureLine && (
                      <Line
                        points={[panelPoint.x, panelPoint.y, featurePoint.x, featurePoint.y]}
                        stroke={color}
                        strokeWidth={2}
                        opacity={0.95}
                        listening={false}
                      />
                    )}
                    <Circle
                      x={panelPoint.x}
                      y={panelPoint.y}
                      radius={3}
                      fill={color}
                      listening={false}
                    />
                    <Circle
                      x={featurePoint.x}
                      y={featurePoint.y}
                      radius={3}
                      fill={color}
                      listening={false}
                    />
                    {renderCanvasMeasurementPill(labelText, { x: labelX, y: labelY }, color)}
                  </Group>
                );
              })}
            </Group>
          );
        })()}

        {/* Selected roof-window placement marker: click the pill to edit up-slope distance. */}
        {selectedRoofWindowPlacement && (() => {
          const color = readRootCssVar('--semantic-snap', '#1E90FF');
          const openingPoint = worldToCanvas(selectedRoofWindowPlacement.openingPoint, scale, panOffset, canvasCenter);
          const roofPoint = worldToCanvas(selectedRoofWindowPlacement.roofPoint, scale, panOffset, canvasCenter);
          const roofA = worldToCanvas(selectedRoofWindowPlacement.roofLowEdgeSegment[0], scale, panOffset, canvasCenter);
          const roofB = worldToCanvas(selectedRoofWindowPlacement.roofLowEdgeSegment[1], scale, panOffset, canvasCenter);
          const openingA = worldToCanvas(selectedRoofWindowPlacement.openingEdgeSegment[0], scale, panOffset, canvasCenter);
          const openingB = worldToCanvas(selectedRoofWindowPlacement.openingEdgeSegment[1], scale, panOffset, canvasCenter);
          const measureDx = openingPoint.x - roofPoint.x;
          const measureDy = openingPoint.y - roofPoint.y;
          const measureLen = Math.hypot(measureDx, measureDy);
          const labelX = (openingPoint.x + roofPoint.x) / 2 + 8;
          const labelY = (openingPoint.y + roofPoint.y) / 2 - DRAW_MODE_TOOLTIP_PILL_HEIGHT / 2 - 8;
          const labelText = `Up-slope: ${selectedRoofWindowPlacement.distanceM.toFixed(2)}m`;
          const pillWidth = getDrawModeTooltipPillWidth(labelText);
          const isEditingDistance =
            selection?.type === 'element' &&
            roofWindowDistanceEditor?.elementId === selection.id;

          return (
            <Group key="selected-roof-window-placement-marker" listening={!isEditingDistance}>
              <Line
                points={[roofA.x, roofA.y, roofB.x, roofB.y]}
                stroke={color}
                strokeWidth={2}
                dash={[7, 5]}
                opacity={0.75}
                listening={false}
              />
              <Line
                points={[openingA.x, openingA.y, openingB.x, openingB.y]}
                stroke={color}
                strokeWidth={2}
                opacity={0.95}
                listening={false}
              />
              {measureLen > 2 && (
                <Line
                  points={[roofPoint.x, roofPoint.y, openingPoint.x, openingPoint.y]}
                  stroke={color}
                  strokeWidth={2}
                  opacity={0.95}
                  listening={false}
                />
              )}
              <Circle
                x={roofPoint.x}
                y={roofPoint.y}
                radius={3}
                fill={color}
                listening={false}
              />
              <Circle
                x={openingPoint.x}
                y={openingPoint.y}
                radius={3}
                fill={color}
                listening={false}
              />
              {!isEditingDistance && (
                <>
                  {renderCanvasMeasurementPill(labelText, { x: labelX, y: labelY }, color)}
                  <Rect
                    x={labelX}
                    y={labelY}
                    width={pillWidth}
                    height={DRAW_MODE_TOOLTIP_PILL_HEIGHT}
                    fill={color}
                    opacity={0}
                    listening
                    onClick={beginRoofWindowDistanceEditor}
                    onTap={beginRoofWindowDistanceEditor}
                  />
                </>
              )}
            </Group>
          );
        })()}

        {selectedLineOpeningClearance &&
          renderLineOpeningClearanceGuidance(
            'selected-line-opening-clearance-marker',
            selectedLineOpeningClearance.clearance,
            true,
          )}

        {!selectedLineOpeningClearance && lineOpeningClearanceDragPreview &&
          renderLineOpeningClearanceGuidance(
            'line-opening-clearance-drag-preview',
            lineOpeningClearanceDragPreview.clearance,
            false,
            0.86,
          )}

        {/* Render persistent snap indicators (always visible) */}
        {snapIndicators}
        <Group name={VERTEX_LENGTH_PILLS_GROUP_NAME} listening={false} />

            {/* Render overlap count badges */}
            {!spaceLabellerOpen && (() => {
              // Deduplicate: if A overlaps with B, we only need one badge
              const processed = new Set<string>();
              const badges: Array<{ elementId: string, overlappingIds: string[], center: { x: number, y: number, z: number } }> = [];

              for (const [elementId, group] of overlapGroups.entries()) {
                if (processed.has(elementId)) continue;

                // Mark all in group as processed
                group.forEach(id => processed.add(id));

                const element = elementsById[elementId];
                if (!element) continue;

                // Floor filtering: same rule as ElementRenderer / 3D (normalized storey z)
                if (!isElementOnActiveCanvasFloor(element, currentFloorZ, floors)) continue;

                const overlappingElements = group.slice(1).map(id => elementsById[id]).filter(Boolean);
                const center = getOverlapCenter(element, overlappingElements);

                if (center && group.length > 1) {
                  badges.push({
                    elementId,
                    overlappingIds: group,
                    center
                  });
                }
              }

              return badges.map(({ elementId, overlappingIds, center }) => {
                const canvasPos = worldToCanvas(center, scale, panOffset, canvasCenter);
                const count = overlappingIds.length;

                const overlapBadgeListening = drawMode === 'none';
                return (
                  <Group key={`overlap-badge-${elementId}`} x={canvasPos.x} y={canvasPos.y}>
                    <Circle
                      x={0}
                      y={0}
                      radius={6}
                      fill="rgba(255, 255, 255, 0.1)"
                      stroke="rgba(255, 255, 255, 0.3)"
                      strokeWidth={1.5}
                      listening={overlapBadgeListening}
                      onClick={(e) => {
                        if (!overlapBadgeListening) return;
                        e.cancelBubble = true;
                        setOverlapBadgeMenu({
                          anchor: center,
                          elementIds: overlappingIds,
                        });
                      }}
                      onTap={(e) => {
                        if (!overlapBadgeListening) return;
                        // Also handle tap for mobile
                        e.cancelBubble = true;
                        setOverlapBadgeMenu({
                          anchor: center,
                          elementIds: overlappingIds,
                        });
                      }}
                      onMouseEnter={() => {
                        if (!overlapBadgeListening) return;
                        setCanvasElementHover(elementId);
                      }}
                      onMouseLeave={() => {
                        // Don't clear elementHover - let element geometry handle it
                      }}
                    />
                    <Text
                      x={0}
                      y={0}
                      text={String(count)}
                      fontSize={10}
                      fill="#FFFFFF"
                      fontStyle="bold"
                      align="center"
                      offsetX={badgeTextOffsetX ?? 0}
                      offsetY={badgeTextOffsetY ?? 5}
                      listening={false}
                      ref={(node) => {
                        // Measure text dimensions on first render to calculate proper centering
                        if (node && (badgeTextOffsetY === null || badgeTextOffsetX === null)) {
                          // Get the Konva node instance (react-konva wraps it)
                          const konvaNode = (node as any).getNode ? (node as any).getNode() : node;
                          // Measure text dimensions using getClientRect
                          try {
                            const rect = konvaNode.getClientRect();
                            const textWidth = rect.width;
                            const textHeight = rect.height;

                            // Center horizontally: offsetX should be half the text width
                            if (textWidth > 0 && badgeTextOffsetX === null) {
                              setBadgeTextOffsetX(textWidth / 2);
                            }

                            // Center vertically: offsetY should be half the text height
                            if (textHeight > 0 && badgeTextOffsetY === null) {
                              setBadgeTextOffsetY(textHeight / 2);
                            }
                          } catch {
                            // Fallback to fontSize-based calculation if measurement fails
                            if (badgeTextOffsetX === null) {
                              // Approximate text width: roughly 0.6 * fontSize per character for single digits
                              setBadgeTextOffsetX(10 * 0.6 / 2); // Approximate half width
                            }
                            if (badgeTextOffsetY === null) {
                              setBadgeTextOffsetY(10 * 0.6); // fontSize * 0.6
                            }
                          }
                        }
                      }}
                    />
                  </Group>
                  );
                });
            })()}

        {/* Render smart labels above overlap badges; visual-only so underlying canvas geometry stays interactive. */}
        {!spaceLabellerOpen && (() => {
              return sortedForLabels
                .map(({ element, canvasCoords }) => {
                  const isSelected = selection?.type === 'element' && selection.id === element.id;
                  const isMultiSelected = selectedElementIdSet.has(element.id);
                  const isHighlighted = isSelected || isMultiSelected;
                  const isHovered = elementHover === element.id && !isElementHiddenOnView(element);

                  if (canvasCoords.length === 0) return null;

                  // Floor filtering: same rule as ElementRenderer / 3D (normalized storey z)
                  if (!isElementOnActiveCanvasFloor(element, currentFloorZ, floors)) return null;

                  // Label visibility filtering based on mode
                  // Show label if: highlighted or directly hovered (not overlapping elements)
                  if (labelVisibility === 'selected' && !isHighlighted && !isHovered) return null;

                  // Get cached label position and transform it to current canvas space
                  const cachedData = memoizedLabelPositions.get(element.id);
                  if (!cachedData) return null;

                  const labelRect = transformCachedLabelPosition(
                    cachedData,
                    element,
                    worldToCanvas,
                    scale,
                    panOffset,
                    canvasCenter
                  );

                  return renderSmartLabel(
                    element,
                    { x: labelRect.x, y: labelRect.y, anchor: labelRect.anchor },
                    isHighlighted,
                    showLineDimensions,
                    canvasLabelTheme,
                  );
                });
            })()}

            {/* Space-label footprints (only while Space Labeller is open): above fabric, below draw preview */}
            {spaceLabellerOpen && spaceLabellerZoneId && (() => {
              const zoneId = spaceLabellerZoneId;
              const nodes: React.ReactNode[] = [];
              const visibleSpaceLabelIds = spaceLabelIds
                .filter((slId) => {
                  const label = spaceLabelsById[slId];
                  if (!label || label.zoneId !== zoneId) return false;
                  const coords = label.coordinates;
                  if (!coords || coords.length < 3) return false;
                  const z0 = coords[0]?.z ?? 0;
                  return Math.abs(z0 - currentFloorZ) <= 0.05;
                })
                .sort((a, b) => {
                  if (a === spaceLabellerSelectedLabelId) return 1;
                  if (b === spaceLabellerSelectedLabelId) return -1;
                  return 0;
                });
              for (const slId of visibleSpaceLabelIds) {
                const label = spaceLabelsById[slId];
                if (!label || label.zoneId !== zoneId) continue;
                const coords = label.coordinates;
                const pts: number[] = [];
                for (const c of coords) {
                  const p = worldToCanvas({ x: c.x, y: c.y }, scale, panOffset, canvasCenter);
                  pts.push(p.x, p.y);
                }
                const n = coords.length;
                const cx = coords.reduce((s, c) => s + c.x, 0) / n;
                const cy = coords.reduce((s, c) => s + c.y, 0) / n;
                const labelPos = worldToCanvas({ x: cx, y: cy }, scale, panOffset, canvasCenter);
                const area = spaceLabelPlanAreaM2(label);
                const roomType = label.room_type?.trim() ?? '';
                const displayType = roomType ? getSpaceLabelBaseNameForRoomType(roomType) : 'Unlabelled space';
                const labelText = `${displayType}\n${area.toFixed(2)} m²`;
                const labelTextWidth = 140;
                const labelTextHeight = 28;
                const isSlSelected = spaceLabellerSelectedLabelId === label.id;
                const listenSl = drawMode === 'none';
                const isLivingSpaceLabel = isLivingRoomSpaceLabel(label) || isSpaceLabelOpenToLivingRoom(label);
                const hasRoomType = roomType !== '';
                const spaceLabelPalette = isLivingSpaceLabel
                  ? {
                      fill: SPACE_LABEL_CANVAS_LIVING_FILL,
                      selectedFill: SPACE_LABEL_CANVAS_LIVING_SELECTED_FILL,
                      stroke: SPACE_LABEL_CANVAS_LIVING_STROKE,
                    }
                  : hasRoomType
                    ? {
                        fill: SPACE_LABEL_CANVAS_REST_FILL,
                        selectedFill: SPACE_LABEL_CANVAS_REST_SELECTED_FILL,
                        stroke: SPACE_LABEL_CANVAS_REST_STROKE,
                      }
                    : {
                        fill: SPACE_LABEL_CANVAS_FILL,
                        selectedFill: SPACE_LABEL_CANVAS_SELECTED_FILL,
                        stroke: SPACE_LABEL_CANVAS_STROKE,
                      };
                nodes.push(
                  <Group
                    key={`space-label-${slId}`}
                    listening={listenSl}
                    onClick={(e) => {
                      if (!listenSl) return;
                      e.cancelBubble = true;
                      setSpaceLabellerSelectedLabelId(label.id);
                      setSpaceLabellerExpandLabelId(label.id);
                    }}
                    onDblClick={(e) => {
                      if (!listenSl) return;
                      e.cancelBubble = true;
                      centerSpaceLabelFootprintInView(label.id);
                    }}
                  >
                    <Line
                      name={`space-label-shape-${label.id}`}
                      points={pts}
                      closed
                      stroke={isSlSelected ? SPACE_LABEL_CANVAS_SELECTED_STROKE : spaceLabelPalette.stroke}
                      strokeWidth={isSlSelected ? 3.5 : 1.5}
                      fill={isSlSelected ? spaceLabelPalette.selectedFill : spaceLabelPalette.fill}
                      listening={listenSl}
                      hitStrokeWidth={16}
                      shadowBlur={0}
                      perfectDrawEnabled={false}
                      shadowForStrokeEnabled={false}
                    />
                    {isSlSelected ? (
                      <Text
                        x={labelPos.x - labelTextWidth / 2}
                        y={labelPos.y - labelTextHeight / 2}
                        width={labelTextWidth}
                        text={labelText}
                        fontSize={12}
                        fontFamily={DRAW_MODE_TOOLTIP_PILL_FONT_FAMILY}
                        fill="#f8fafc"
                        align="center"
                        listening={false}
                        shadowColor="rgba(0,0,0,0.85)"
                        shadowBlur={4}
                        perfectDrawEnabled={false}
                      />
                    ) : null}
                    {isSlSelected && drawMode === 'none'
                      ? coords.map((coord, vertexIndex) => {
                          const vertexCanvas = worldToCanvas({ x: coord.x, y: coord.y }, scale, panOffset, canvasCenter);
                          const isVertexSelected =
                            selectedSpaceLabelVertex?.labelId === label.id &&
                            selectedSpaceLabelVertex.vertexIndex === vertexIndex;
                          return (
                            <Circle
                              key={`space-label-${slId}-vertex-${vertexIndex}`}
                              name={`space-label-vertex-${label.id}-${vertexIndex}`}
                              x={vertexCanvas.x}
                              y={vertexCanvas.y}
                              radius={isVertexSelected ? 6 : 5}
                              fill="#38bdf8"
                              stroke={isVertexSelected ? '#facc15' : '#0f172a'}
                              strokeWidth={isVertexSelected ? 3 : 2}
                              onMouseDown={(e) => {
                                e.cancelBubble = true;
                                if ('button' in e.evt && e.evt.button !== 0) return;
                                e.evt.preventDefault();
                                const target = e.target;
                                const stage = target.getStage();
                                const stageContainer = stage?.container?.();
                                const shapeNode = stage?.findOne(`.space-label-shape-${label.id}`) ?? null;
                                if (!stage || !stageContainer || !shapeNode) {
                                  return;
                                }
                                const buildBasePoints = (sourceCoords: SpaceLabel['coordinates']) =>
                                  sourceCoords.flatMap((sourceCoord) => {
                                    const p = worldToCanvas(
                                      { x: sourceCoord.x, y: sourceCoord.y },
                                      scale,
                                      panOffset,
                                      canvasCenter,
                                    );
                                    return [p.x, p.y];
                                  });
                                const connected = getConnectedSpaceLabelVertices(label, vertexIndex)
                                  .map((item) => ({
                                    ...item,
                                    shapeNode: stage.findOne(`.space-label-shape-${item.labelId}`) ?? null,
                                    basePoints: buildBasePoints(item.coordinates),
                                  }));
                                const session = beginCanvasInteraction({
                                  kind: 'space-label-vertex-drag',
                                  targetId: `${label.id}:${vertexIndex}`,
                                  snapshot: {
                                    labelId: label.id,
                                    vertexIndex,
                                    coordinates: coords,
                                  },
                                  preview: {
                                    mode: 'cloneNodes',
                                    target,
                                    nodes: [
                                      shapeNode,
                                      ...connected.map((item) => item.shapeNode),
                                      target,
                                    ],
                                  },
                                });
                                if (!session) {
                                  return;
                                }
                                const cloneSession = session.previewSession as ActiveCloneDragPreviewSession | null;
                                if (!cloneSession?.clonesBySource) {
                                  cancelCanvasInteraction(session);
                                  return;
                                }

                                const previewShapeNode = cloneSession.clonesBySource.get(shapeNode as any) ?? null;
                                const previewVertexNode = cloneSession.clonesBySource.get(target as any) ?? null;
                                const previewConnected = connected.map((item) => ({
                                  ...item,
                                  shapeNode: item.shapeNode
                                    ? cloneSession.clonesBySource.get(item.shapeNode as any) ?? null
                                    : null,
                                }));
                                let latestSnapped = { x: coord.x, y: coord.y };
                                let didMove = false;

                                const updatePreview = (event: MouseEvent) => {
                                  geometryPerf.measure('GeometryCanvas.spaceLabelVertexDrag.onDragMove', () => {
                                    const rect = stageContainer.getBoundingClientRect();
                                    const rawCanvas = {
                                      x: event.clientX - rect.left,
                                      y: event.clientY - rect.top,
                                    };
                                    const rawWorld = canvasToWorld(rawCanvas, scale, panOffset, canvasCenter);
                                    const orthogonalModifierHeld = event.shiftKey;
                                    const snapped = geometryPerf.measure(
                                      'GeometryCanvas.spaceLabelVertexDrag.resolveSnap',
                                      () => resolveSpaceLabelVertexDragPoint(
                                        label.id,
                                        coords,
                                        vertexIndex,
                                        rawWorld,
                                        orthogonalModifierHeld,
                                      ),
                                    );
                                    latestSnapped = snapped;
                                    didMove = true;
                                    const dragPos = worldToCanvas(snapped, scale, panOffset, canvasCenter);
                                    if (previewVertexNode && typeof (previewVertexNode as any).position === 'function') {
                                      (previewVertexNode as any).position(dragPos);
                                    }
                                    const nextPts = buildBasePoints(coords);
                                    nextPts[vertexIndex * 2] = dragPos.x;
                                    nextPts[vertexIndex * 2 + 1] = dragPos.y;
                                    if (previewShapeNode && typeof (previewShapeNode as any).points === 'function') {
                                      (previewShapeNode as any).points(nextPts);
                                    }
                                    for (const item of previewConnected) {
                                      if (!item.shapeNode || typeof (item.shapeNode as any).points !== 'function') continue;
                                      const connectedPts = [...item.basePoints];
                                      connectedPts[item.vertexIndex * 2] = dragPos.x;
                                      connectedPts[item.vertexIndex * 2 + 1] = dragPos.y;
                                      (item.shapeNode as any).points(connectedPts);
                                    }
                                    cloneSession.activeLayer.batchDraw();
                                  });
                                };

                                const commitDrag = () => {
                                  if (!didMove) return;
                                  const nextCoordinates = [...coords];
                                  nextCoordinates[vertexIndex] = {
                                    x: latestSnapped.x,
                                    y: latestSnapped.y,
                                    z: coord.z,
                                  };
                                  updateSpaceLabel(label.id, { coordinates: nextCoordinates });
                                  for (const item of connected) {
                                    const current = geometryStore.getState().spaceLabelsById[item.labelId];
                                    if (!current || !current.coordinates[item.vertexIndex]) continue;
                                    const connectedCoordinates = [...current.coordinates];
                                    connectedCoordinates[item.vertexIndex] = {
                                      ...connectedCoordinates[item.vertexIndex]!,
                                      x: latestSnapped.x,
                                      y: latestSnapped.y,
                                    };
                                    updateSpaceLabel(item.labelId, { coordinates: connectedCoordinates });
                                  }
                                };

                                let completed = false;
                                const onMouseMove = (event: MouseEvent) => {
                                  event.preventDefault();
                                  updatePreview(event);
                                };
                                const onMouseUp = (event: MouseEvent) => {
                                  event.preventDefault();
                                  complete(true);
                                };
                                const onBlur = () => {
                                  complete(false);
                                };
                                const removeWindowListeners = () => {
                                  window.removeEventListener('mousemove', onMouseMove, true);
                                  window.removeEventListener('mouseup', onMouseUp, true);
                                  window.removeEventListener('blur', onBlur, true);
                                  writeCanvasInteractionSession(target, null);
                                };
                                const complete = (commit: boolean) => {
                                  if (completed) return;
                                  completed = true;
                                  if (commit) {
                                    commitDrag();
                                    endCanvasInteraction(session, { committed: didMove });
                                  } else {
                                    cancelCanvasInteraction(session);
                                  }
                                };

                                writeCanvasInteractionSession(target, session);
                                session.addCleanup(removeWindowListeners);
                                window.addEventListener('mousemove', onMouseMove, true);
                                window.addEventListener('mouseup', onMouseUp, true);
                                window.addEventListener('blur', onBlur, true);
                              }}
                              onClick={(e) => {
                                e.cancelBubble = true;
                                setSelectedSpaceLabelVertex((prev) => (
                                  prev?.labelId === label.id && prev.vertexIndex === vertexIndex
                                    ? prev
                                    : { labelId: label.id, vertexIndex }
                                ));
                              }}
                            />
                          );
                        })
                      : null}
                  </Group>,
                );
              }
              return <>{nodes}</>;
            })()}

            {/* Render hover point for ground element splitting */}
            {hoverPoint && (
              <Circle
                x={worldToCanvas({x: hoverPoint.x, y: hoverPoint.y}, scale, panOffset, canvasCenter).x}
                y={worldToCanvas({x: hoverPoint.x, y: hoverPoint.y}, scale, panOffset, canvasCenter).y}
                radius={4}
                fill="transparent"
                stroke="var(--validation-info)"
                strokeWidth={2}
                dash={[4, 4]}
                listening={false}
              />
            )}
            {spaceLabellerOpen && spaceLabelHoverPoint && spaceLabellerSelectedLabelId && drawMode === 'none' && (
              <Circle
                x={worldToCanvas({x: spaceLabelHoverPoint.x, y: spaceLabelHoverPoint.y}, scale, panOffset, canvasCenter).x}
                y={worldToCanvas({x: spaceLabelHoverPoint.x, y: spaceLabelHoverPoint.y}, scale, panOffset, canvasCenter).y}
                radius={4}
                fill="transparent"
                stroke="#38bdf8"
                strokeWidth={2}
                dash={[4, 4]}
                listening={false}
              />
            )}
            {/* Render group center handle for multi-select.
                Hidden when selected-shape drag overlay is active to avoid duplicate centroid handles. */}
            {selectedElementIds.length > 1 && !selectedShapeDragTarget && !spaceLabellerOpen && (() => {
              // Calculate group centroid
              const selectedElements = selectedElementIds.map(id => elementsById[id]).filter(Boolean);
              if (selectedElements.length === 0) return null;

              // Get all coordinates from selected elements
              const allCoords = selectedElements.flatMap(el => el.coordinates || []);
              if (allCoords.length === 0) return null;

              // Calculate centroid
              const centroidX = allCoords.reduce((sum, coord) => sum + coord.x, 0) / allCoords.length;
              const centroidY = allCoords.reduce((sum, coord) => sum + coord.y, 0) / allCoords.length;
              const canvasCentroid = worldToCanvas({x: centroidX, y: centroidY}, scale, panOffset, canvasCenter);
              type GroupCenterInitialPosition = {
                id: string;
                coords: Array<{ x: number; y: number; z: number }>;
              };
              const resolveGroupCenterMove = (node: any) => {
                const newCenter = canvasToWorld({x: node.x(), y: node.y()}, scale, panOffset, canvasCenter);
                const initialCenter = node.initialCenter;
                const initialPositions = node.initialPositions as GroupCenterInitialPosition[] | null | undefined;

                if (!initialCenter || !initialPositions) return null;

                const dx = newCenter.x - initialCenter.x;
                const dy = newCenter.y - initialCenter.y;

                return {
                  dx,
                  dy,
                  updates: initialPositions.map(({ id, coords }: GroupCenterInitialPosition) => ({
                    id,
                    coords: coords.map((coord) => ({
                      x: coord.x + dx,
                      y: coord.y + dy,
                      z: coord.z
                    })),
                  })),
                };
              };
              const previewGroupCenterMove = (node: any) => {
                const resolved = resolveGroupCenterMove(node);
                if (!resolved) return;
                resolved.updates.forEach(({ id, coords }) => {
                  updateDraggedElementShapeFromCoords(
                    node,
                    id,
                    coords,
                    scale,
                    panOffset,
                    canvasCenter,
                    elementsById[id],
                  );
                });
              };
              const commitGroupCenterMove = (
                node: any,
                skipAutoSave: boolean,
              ) => {
                const resolved = resolveGroupCenterMove(node);
                if (!resolved) return;
                resolved.updates.forEach(({ id, coords }) => {
                  const existingElement = elementsById[id];
                  updateElement(id, {
                    coordinates: coords,
                    extra_json: translateDormerExtraJson(
                      existingElement?.extra_json as Record<string, any> | undefined,
                      resolved.dx,
                      resolved.dy,
                    ),
                  }, skipAutoSave);
                });
              };

              return (
                <Circle
                  x={canvasCentroid.x}
                  y={canvasCentroid.y}
                  radius={6}
                  fill={"#FFD93D"}
                  stroke="#FF6B35"
                  strokeWidth={2}
                  draggable={true}
                  onDragStart={(e) => {
                    // Store initial positions for group move
                    const initialPositions: GroupCenterInitialPosition[] = selectedElements.map(el => ({
                      id: el.id,
                      coords: (el.coordinates || []).map((coord) => ({
                        x: coord.x,
                        y: coord.y,
                        z: coord.z ?? 0,
                      })),
                    }));
                    (e.target as any).initialPositions = initialPositions;
                    (e.target as any).initialCenter = { x: centroidX, y: centroidY };
                    const session = beginCanvasInteraction({
                      kind: 'multi-select-drag',
                      targetId: selectedElementIds.join(','),
                      snapshot: {
                        elements: initialPositions,
                      },
                      preview: {
                        mode: 'elementNodes',
                        target: e.target,
                        primaryElementId: selectedElements[0].id,
                        elements: initialPositions.map(({ id, coords }) => ({
                          elementId: id,
                          coordinateCount: coords.length,
                        })),
                        moveDragTarget: true,
                      },
                    });
                    writeCanvasInteractionSession(e.target, session);
                  }}
                  onDragMove={(e) => {
                    previewGroupCenterMove(e.target as any);
                  }}
                  onDragEnd={(e) => {
                    const session = readCanvasInteractionSession(e.target);
                    endCanvasInteraction(session, { committed: true });
                    writeCanvasInteractionSession(e.target, null);
                    commitGroupCenterMove(e.target as any, false);
                    // Clear stored data
                    (e.target as any).initialPositions = null;
                    (e.target as any).initialCenter = null;
                  }}
                />
              );
            })()}
            {selectedPointDragTarget && (() => {
              const pointCanvas = worldToCanvas(
                selectedPointDragTarget.coord,
                scale,
                panOffset,
                canvasCenter,
              );
              const resolveSelectedPointFromCanvas = (canvasPos: { x: number; y: number }) => {
                const newWorld = canvasToWorld(
                  canvasPos,
                  scale,
                  panOffset,
                  canvasCenter,
                );
                const snapTol = getProjectDefaults(geometryStore).snapTol;
                const snappedWorld = utilSnapCornerToOtherCornersFromCache(
                  newWorld,
                  selectedPointDragTarget.element.id,
                  geometrySnapCache,
                  snapTol,
                ) ?? newWorld;
                const existingCoords = selectedPointDragTarget.element.coordinates ?? [];
                if (existingCoords.length === 0) return null;
                const updatedCoords = [...existingCoords];
                updatedCoords[0] = {
                  ...updatedCoords[0],
                  x: snappedWorld.x,
                  y: snappedWorld.y,
                };
                return {
                  updatedCoords,
                  snappedCanvas: worldToCanvas(
                    { x: snappedWorld.x, y: snappedWorld.y },
                    scale,
                    panOffset,
                    canvasCenter,
                  ),
                };
              };
              const previewSelectedPointFromCanvas = (node: any, canvasPos: { x: number; y: number }) => {
                const resolved = resolveSelectedPointFromCanvas(canvasPos);
                if (!resolved) return;
                node.position(resolved.snappedCanvas);
                updateDraggedElementShapeFromCoords(
                  node,
                  selectedPointDragTarget.element.id,
                  resolved.updatedCoords as Array<{ x: number; y: number; z?: number }>,
                  scale,
                  panOffset,
                  canvasCenter,
                  selectedPointDragTarget.element,
                );
              };
              const applySelectedPointFromCanvas = (canvasPos: { x: number; y: number }, skipAutoSave: boolean) => {
                const resolved = resolveSelectedPointFromCanvas(canvasPos);
                if (!resolved) return;
                markNextGeometryCanvasRender('GeometryCanvas.selectedPointDrag.commit');
                updateElement(
                  selectedPointDragTarget.element.id,
                  { coordinates: resolved.updatedCoords as any },
                  skipAutoSave,
                );
              };
              return (
                <Circle
                  x={pointCanvas.x}
                  y={pointCanvas.y}
                  radius={16}
                  fill="rgba(0,0,0,0.001)"
                  strokeEnabled={false}
                  draggable
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    const session = beginCanvasInteraction({
                      kind: 'selected-point-drag',
                      targetId: selectedPointDragTarget.element.id,
                      snapshot: {
                        coordinates: selectedPointDragTarget.element.coordinates,
                      },
                      preview: {
                        mode: 'elementNodes',
                        target: e.target,
                        primaryElementId: selectedPointDragTarget.element.id,
                        elements: [{
                          elementId: selectedPointDragTarget.element.id,
                          coordinateCount: 1,
                        }],
                        moveDragTarget: true,
                      },
                    });
                    writeCanvasInteractionSession(e.target, session);
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    previewSelectedPointFromCanvas(e.target, { x: e.target.x(), y: e.target.y() });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    const session = readCanvasInteractionSession(e.target);
                    endCanvasInteraction(session, { committed: true });
                    writeCanvasInteractionSession(e.target, null);
                    applySelectedPointFromCanvas(
                      { x: e.target.x(), y: e.target.y() },
                      false,
                    );
                  }}
                />
              );
            })()}

            {selectedShapeDragTarget && (() => {
              const centroidCanvas = worldToCanvas(
                selectedShapeDragTarget.centroid,
                scale,
                panOffset,
                canvasCenter,
              );
              const selectedShapeDescendantIds = collectHostedDescendantElementIds(
                elementsById as Record<string, Element>,
                selectedShapeDragTarget.element.id,
              );
              const selectedShapeParentAxisLock =
                shouldSnapToParent(selectedShapeDragTarget.element) &&
                !!(selectedShapeDragTarget.element as any).parent_element &&
                selectedShapeDragTarget.coords.length === 2;

              const projectSelectedShapeCentroidToParentCanvas = (
                pos: { x: number; y: number },
              ): { x: number; y: number } => {
                if (!selectedShapeParentAxisLock) return pos;
                const parentName = (selectedShapeDragTarget.element as any).parent_element as string;
                const parentId = nameToId[parentName];
                const parent = parentId ? elementsById[parentId] : undefined;
                if (!parent?.coordinates || parent.coordinates.length !== 2) return pos;
                const world = canvasToWorld(pos, scale, panOffset, canvasCenter);
                const [pa, pb] = parent.coordinates as Array<{ x: number; y: number; z: number }>;
                const vx = pb.x - pa.x;
                const vy = pb.y - pa.y;
                const v2 = vx * vx + vy * vy;
                if (v2 === 0) return pos;
                const t = Math.max(0, Math.min(1, ((world.x - pa.x) * vx + (world.y - pa.y) * vy) / v2));
                return worldToCanvas(
                  { x: pa.x + t * vx, y: pa.y + t * vy },
                  scale,
                  panOffset,
                  canvasCenter,
                );
              };

              const applySelectedShapeDeltaPx = (
                baseCoords: Array<{ x: number; y: number; z: number }>,
                deltaPx: { x: number; y: number },
                skipAutoSave: boolean,
                isFinal: boolean,
              ): Array<{ x: number; y: number; z: number }> | null => {
                const worldOrigin = canvasToWorld({ x: 0, y: 0 }, scale, panOffset, canvasCenter);
                const worldDelta = canvasToWorld(
                  { x: deltaPx.x, y: deltaPx.y },
                  scale,
                  panOffset,
                  canvasCenter,
                );
                const dx = worldDelta.x - worldOrigin.x;
                const dy = worldDelta.y - worldOrigin.y;
                const translatedCoords = baseCoords.map((coord) => ({
                  ...coord,
                  x: coord.x + dx,
                  y: coord.y + dy,
                }));
                let snappedCoords = translatedCoords as Array<{ x: number; y: number; z: number }>;
                const snapTol = getProjectDefaults(geometryStore).snapTol;
                const dragEl = selectedShapeDragTarget.element;
                const commitSelectedShapeUpdate: typeof updateElement = (id, updates, skip) => {
                  markNextGeometryCanvasRender('GeometryCanvas.selectedShapeDrag.commit');
                  return updateElement(id, updates, skip);
                };
                if (
                  shouldSnapToParent(dragEl) &&
                  (dragEl as any).parent_element &&
                  translatedCoords.length === 2
                ) {
                  const parentName = (dragEl as any).parent_element as string;
                  const parentId = nameToId[parentName];
                  const parent = parentId ? elementsById[parentId] : undefined;
                  if (parent?.coordinates && parent.coordinates.length === 2) {
                    snappedCoords = utilProjectSegmentOntoParent(
                      translatedCoords as any,
                      parent.coordinates as any,
                    ) as any;
                  }
                } else {
                  // Rigid move: translate the whole shape by one snap offset for both the
                  // preview and the commit. Snapping each vertex to its own nearest corner on
                  // drop silently resized the element away from the previewed ghost.
                  snappedCoords = utilTranslateShapeToSnapFromCache(
                    dragEl,
                    translatedCoords as any,
                    geometrySnapCache,
                    () => snapTol,
                  ).coords as any;
                }

                const roofHostId = isRoofHostableShape(dragEl, snappedCoords)
                  ? findHostRoofId({ coordinates: snappedCoords }, elementsById as Record<string, Element>)
                  : null;

                if (!isFinal) {
                  if (shouldSnapToParent(dragEl) && !(dragEl as any).parent_element && snappedCoords.length === 2) {
                    const parentPatch = utilResolveOpeningSegmentParentFromCache(
                      snappedCoords as any,
                      activeGeometrySnapCache,
                      elementsById as Record<string, Element>,
                      dragEl.id,
                      snapTol,
                    );
                    if (parentPatch) {
                      setShapeDragCentroidHostSnapIfChanged('wall');
                      setLineOpeningClearancePreviewIfChanged({
                        parentId: parentPatch.parentId,
                        coordinates: parentPatch.coordinates,
                      });
                    } else {
                      setShapeDragCentroidHostSnapIfChanged('none');
                      setLineOpeningClearancePreviewIfChanged(null);
                    }
                  } else if (
                    shouldSnapToParent(dragEl) &&
                    (dragEl as any).parent_element &&
                    snappedCoords.length === 2
                  ) {
                    const parentName = (dragEl as any).parent_element as string;
                    const parentId = nameToId[parentName];
                    setLineOpeningClearancePreviewIfChanged(
                      parentId
                        ? {
                            parentId,
                            coordinates: snappedCoords,
                          }
                        : null,
                    );
                  } else if (roofHostId) {
                    setShapeDragCentroidHostSnapIfChanged('roof');
                    setLineOpeningClearancePreviewIfChanged(null);
                  } else {
                    setShapeDragCentroidHostSnapIfChanged('none');
                    setLineOpeningClearancePreviewIfChanged(null);
                  }
                  return snappedCoords;
                }

                if (
                  isFinal &&
                  shouldSnapToParent(dragEl) &&
                  !(dragEl as any).parent_element &&
                  snappedCoords.length === 2
                ) {
                  const parentPatch = utilResolveOpeningSegmentParentFromCache(
                    snappedCoords as any,
                    activeGeometrySnapCache,
                    elementsById as Record<string, Element>,
                    dragEl.id,
                    snapTol,
                  );
                  if (parentPatch) {
                    commitSelectedShapeUpdate(
                      dragEl.id,
                      {
                        parent_element: parentPatch.parentName,
                        coordinates: parentPatch.coordinates as any,
                        extra_json: translateDormerExtraJson(
                          (dragEl as any).extra_json as Record<string, any> | undefined,
                          dx,
                          dy,
                        ),
                      } as any,
                      skipAutoSave,
                    );
                    return parentPatch.coordinates as Array<{ x: number; y: number; z: number }>;
                  }

                  const candCenter = {
                    x: (snappedCoords[0].x + snappedCoords[1].x) / 2,
                    y: (snappedCoords[0].y + snappedCoords[1].y) / 2,
                  };
                  const candidates = [candCenter, snappedCoords[0], snappedCoords[1]];
                  let best: { parentName: string; dist: number } | null = null;
                  for (const p of candidates) {
                    const hit = utilFindNearestWallProjectionFromCache(
                      p,
                      activeGeometrySnapCache,
                      dragEl.id,
                      snapTol,
                      {
                        isCandidate: (segment) => isSameStoreyOpaqueLineParentCandidate(
                          segment.elementId,
                          snappedCoords,
                          elementsById as Record<string, Element>,
                        ),
                      },
                    );
                    if (hit?.parentName) {
                      const d = Math.hypot(p.x - hit.proj.x, p.y - hit.proj.y);
                      if (best === null || d < best.dist) {
                        best = { parentName: hit.parentName, dist: d };
                      }
                    }
                  }
                  if (best) {
                    const parent = findElementByName(best.parentName);
                    if (parent?.coordinates && parent.coordinates.length === 2) {
                      snappedCoords = utilProjectSegmentOntoParent(
                        snappedCoords as any,
                        parent.coordinates as any,
                      ) as any;
                    }
                    commitSelectedShapeUpdate(
                      dragEl.id,
                      {
                        parent_element: best.parentName,
                        coordinates: snappedCoords as any,
                        extra_json: translateDormerExtraJson(
                          (dragEl as any).extra_json as Record<string, any> | undefined,
                          dx,
                          dy,
                        ),
                      } as any,
                      skipAutoSave,
                    );
                    return snappedCoords;
                  }
                }

                if (
                  isFinal &&
                  dragEl.type === 'BuildingElementTransparent' &&
                  roofHostId
                ) {
                  const roof = elementsById[roofHostId];
                  if (roof?.name) {
                    commitSelectedShapeUpdate(
                      dragEl.id,
                      {
                        parent_element: roof.name,
                        coordinates: snappedCoords as any,
                        extra_json: translateDormerExtraJson(
                          (dragEl as any).extra_json as Record<string, any> | undefined,
                          dx,
                          dy,
                        ),
                      } as any,
                      skipAutoSave,
                    );
                    return snappedCoords;
                  }
                }

                const shouldUpdateContextAngles =
                  selectedShapeDragTarget.element.type === 'ContextShading' &&
                  Boolean((selectedShapeDragTarget.element as any).parent_element);
                if (shouldUpdateContextAngles) {
                  const parentName = (selectedShapeDragTarget.element as any).parent_element as string;
                  const parentElement = findElementByName(parentName);
                  if (parentElement) {
                    const { calculateShadingAngularRange } = geometryStore.getState();
                    const { start_angle, end_angle } = calculateShadingAngularRange(
                      { ...selectedShapeDragTarget.element, coordinates: snappedCoords } as any,
                      parentElement as any,
                      geometryStore.getState().globalOrientationOffset,
                    );
                    commitSelectedShapeUpdate(
                      selectedShapeDragTarget.element.id,
                      {
                        coordinates: snappedCoords as any,
                        start_angle,
                        end_angle,
                        extra_json: translateDormerExtraJson(
                          selectedShapeDragTarget.element.extra_json as Record<string, any> | undefined,
                          dx,
                          dy,
                        ),
                      },
                      skipAutoSave,
                    );
                    return snappedCoords;
                  }
                }
                commitSelectedShapeUpdate(
                  selectedShapeDragTarget.element.id,
                  {
                    coordinates: snappedCoords as any,
                    extra_json: translateDormerExtraJson(
                      selectedShapeDragTarget.element.extra_json as Record<string, any> | undefined,
                      dx,
                      dy,
                    ),
                  },
                  skipAutoSave,
                );
                return snappedCoords;
              };

              const showCentroidHostSnap = selectedShapeParentAxisLock || shapeDragCentroidHostSnap !== 'none';

              return (
                <Circle
                  x={centroidCanvas.x}
                  y={centroidCanvas.y}
                  radius={7}
                  fill={showCentroidHostSnap ? readRootCssVar('--semantic-snap', '#1E90FF') : '#FFD93D'}
                  stroke={showCentroidHostSnap ? readRootCssVar('--semantic-on-color', '#FFFFFF') : '#FF6B35'}
                  strokeWidth={2}
                  draggable
                  dragBoundFunc={projectSelectedShapeCentroidToParentCanvas}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    setShapeDragCentroidHostSnapIfChanged('none');
                    setLineOpeningClearancePreviewIfChanged(null);
                    e.target.setAttr('startPos', { x: e.target.x(), y: e.target.y() });
                    e.target.setAttr('initialCoords', selectedShapeDragTarget.coords);
                    const session = beginCanvasInteraction({
                      kind: 'selected-shape-drag',
                      targetId: selectedShapeDragTarget.element.id,
                      snapshot: {
                        coordinates: selectedShapeDragTarget.coords,
                      },
                      preview: {
                        mode: 'elementNodes',
                        target: e.target,
                        primaryElementId: selectedShapeDragTarget.element.id,
                        elements: [
                          {
                            elementId: selectedShapeDragTarget.element.id,
                            coordinateCount: selectedShapeDragTarget.coords.length,
                          },
                          ...selectedShapeDescendantIds.map((elementId) => ({
                            elementId,
                            coordinateCount: elementsById[elementId]?.coordinates?.length ?? 0,
                          })),
                        ],
                        moveDragTarget: true,
                      },
                    });
                    writeCanvasInteractionSession(e.target, session);
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const startPos = e.target.getAttr('startPos') as { x: number; y: number } | undefined;
                    const initialCoords = e.target.getAttr('initialCoords') as
                      | Array<{ x: number; y: number; z: number }>
                      | undefined;
                    if (!startPos) return;
                    if (!initialCoords || initialCoords.length === 0) return;
                    const previewCoords = geometryPerf.measure(
                      'GeometryCanvas.selectedShapeDrag.preview',
                      () => applySelectedShapeDeltaPx(
                        initialCoords,
                        { x: e.target.x() - startPos.x, y: e.target.y() - startPos.y },
                        true,
                        false,
                      ),
                    );
                    if (!previewCoords) return;
                    geometryPerf.measure('GeometryCanvas.selectedShapeDrag.updatePreviewNode', () => {
                      updateDraggedElementShapeFromCoords(
                        e.target,
                        selectedShapeDragTarget.element.id,
                        previewCoords,
                        scale,
                        panOffset,
                        canvasCenter,
                        selectedShapeDragTarget.element,
                      );
                      const directPreviewElementsById = {
                        ...(elementsById as Record<string, Element>),
                        [selectedShapeDragTarget.element.id]: {
                          ...selectedShapeDragTarget.element,
                          coordinates: previewCoords as Element['coordinates'],
                        } as Element,
                      };
                      const descendantPreview = cascadeHostedDescendantTranslation({
                        previousElementsById: elementsById as Record<string, Element>,
                        nextElementsById: directPreviewElementsById,
                        changedElementIds: [selectedShapeDragTarget.element.id],
                      });
                      for (const descendantId of descendantPreview.changedElementIds) {
                        if (descendantId === selectedShapeDragTarget.element.id) continue;
                        const descendantElement = descendantPreview.elementsById[descendantId];
                        if (!descendantElement?.coordinates?.length) continue;
                        updateDraggedElementShapeFromCoords(
                          e.target,
                          descendantId,
                          descendantElement.coordinates as Array<{ x: number; y: number; z?: number }>,
                          scale,
                          panOffset,
                          canvasCenter,
                          descendantElement,
                        );
                      }
                    });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    setShapeDragCentroidHostSnapIfChanged('none');
                    setLineOpeningClearancePreviewIfChanged(null);
                    const startPos = e.target.getAttr('startPos') as { x: number; y: number } | undefined;
                    const initialCoords = e.target.getAttr('initialCoords') as
                      | Array<{ x: number; y: number; z: number }>
                      | undefined;
                    const session = readCanvasInteractionSession(e.target);
                    endCanvasInteraction(session, { committed: true });
                    writeCanvasInteractionSession(e.target, null);
                    if (!startPos) return;
                    if (!initialCoords || initialCoords.length === 0) return;
                    applySelectedShapeDeltaPx(
                      initialCoords,
                      { x: e.target.x() - startPos.x, y: e.target.y() - startPos.y },
                      false,
                      true,
                    );
                    e.target.setAttr('startPos', null);
                    e.target.setAttr('initialCoords', null);
                  }}
                />
              );
            })()}

          </Layer>

          <CanvasLivePreviewLayer>
            {profileGeometryCanvasNode(
              'GeometryCanvas.liveMarqueeSelection',
              <LiveMarqueeSelection previewSignal={marqueePreviewSignal} />,
            )}
            {profileGeometryCanvasNode(
              'GeometryCanvas.liveDrawingPreview',
              <LiveDrawingPreview
                previewSignal={drawingPreviewSignal}
                drawMode={drawMode}
                drawPoints={drawPoints}
                drawSnapTargetRef={drawSnapTargetRef}
                roomWalls={roomWalls}
                orthogonalRoomStart={orthogonalRoomStart}
                orthogonalRoomEnd={orthogonalRoomEnd}
                scale={scale}
                panOffset={panOffset}
                canvasCenter={canvasCenter}
                drawElementType={drawElementType}
                multiDrawModifierHeld={multiDrawModifierHeld}
                pvFootprintPreview={pvDrawFootprintDims}
                dormerDrawPreviewCutout={dormerDrawPreviewCutout}
                drawingTooltip={drawingTooltip}
                canvasPalette={drawingCanvasPalette}
              />,
            )}
          </CanvasLivePreviewLayer>

          <Layer name={ACTIVE_GEOMETRY_DRAG_LAYER_NAME} listening={true} />

          {/* Overlay move hit-layer: sits above everything and blocks geometry selection while Move mode is active */}
          {overlayMoveMode && guideOverlay?.path && overlayImg && (
            <Layer listening={true}>
              {(() => {
                const pxPerM = (typeof guideOverlay.pxPerM === 'number' && Number.isFinite(guideOverlay.pxPerM) && guideOverlay.pxPerM > 0)
                  ? guideOverlay.pxPerM
                  : 50;
                const pos = guideOverlay.pos_m || { x: 0, y: 0 };
                const canvasPos = worldToCanvas({ x: pos.x, y: pos.y }, scale, panOffset, canvasCenter);
                const widthCanvasPx = (overlayImg.width / pxPerM) * 50 * scale;
                const heightCanvasPx = (overlayImg.height / pxPerM) * 50 * scale;

                const commitFromCanvasXY = (x: number, y: number) => {
                  const world = canvasToWorld({ x, y }, scale, panOffset, canvasCenter);
                  updateGuideOverlay({ pos_m: { x: world.x, y: world.y } } as any);
                };

                return (
                  <>
                    <Rect
                      x={canvasPos.x}
                      y={canvasPos.y}
                      width={widthCanvasPx}
                      height={heightCanvasPx}
                      fill="rgba(0,0,0,0)"
                      stroke="rgba(255,255,255,0.25)"
                      strokeWidth={1}
                      dash={[6, 4]}
                      draggable={true}
                      onMouseDown={(e) => { e.cancelBubble = true; }}
                      onClick={(e) => { e.cancelBubble = true; }}
                      onMouseMove={(e) => {
                        e.cancelBubble = true;
                        const stage = e.target.getStage();
                        const pointer = getStageViewportPointer(stage);
                        if (!pointer) return;
                        setOverlayHintCanvasPos({ x: pointer.x, y: pointer.y });
                      }}
                      onMouseLeave={() => {
                        setOverlayHintCanvasPos(null);
                      }}
                      onDragStart={(e) => {
                        e.cancelBubble = true;
                        const session = beginCanvasInteraction({
                          kind: 'guide-overlay-drag',
                          targetId: 'guide-overlay-move',
                          preview: {
                            mode: 'signalOnly',
                            reset: () => {
                              setOverlayIsDragging(false);
                            },
                          },
                        });
                        writeCanvasInteractionSession(e.target, session);
                        if (!session) return;
                        setOverlayIsDragging(true);
                      }}
                      onDragMove={(e) => {
                        e.cancelBubble = true;
                        const node = e.target;
                        // Throttle store updates to 1 per frame
                        if (overlayMoveRAFRef.current) return;
                        overlayMoveRAFRef.current = requestAnimationFrame(() => {
                          overlayMoveRAFRef.current = null;
                          commitFromCanvasXY(node.x(), node.y());
                        });
                      }}
                      onDragEnd={(e) => {
                        e.cancelBubble = true;
                        const session = readCanvasInteractionSession(e.target);
                        writeCanvasInteractionSession(e.target, null);
                        endCanvasInteraction(session, { committed: true });
                        setOverlayIsDragging(false);
                        const node = e.target;
                        commitFromCanvasXY(node.x(), node.y());
                      }}
                    />

                    {/* Blue pill guidance near cursor (reuses draw-mode styling) */}
                    {overlayHintCanvasPos && overlayHintText && (
                      <>
                        <Circle
                          x={overlayHintCanvasPos.x}
                          y={overlayHintCanvasPos.y}
                          radius={3}
                          fill={readRootCssVar('--semantic-snap', '#1E90FF')}
                          listening={false}
                        />
                        {(() => {
                          const tooltipOffset = 15;
                          const width = getDrawModeTooltipPillWidth(overlayHintText);
                          return renderDrawModeTooltipPill(
                            overlayHintText,
                            {
                              x: overlayHintCanvasPos.x - width / 2,
                              y: overlayHintCanvasPos.y - tooltipOffset - DRAW_MODE_TOOLTIP_PILL_HEIGHT
                            }
                          );
                        })()}
                      </>
                    )}
                  </>
                );
              })()}
            </Layer>
          )}

          {/* Overlay calibrate hit-layer: capture two clicks on the overlay image to compute pxPerM */}
          {overlayCalibrateMode && guideOverlay?.path && overlayImg && (
            <Layer listening={true}>
              {/* eslint-disable-next-line react-hooks/refs -- the imperative calibration session snapshot drives this marker; nested handlers own all writes. */}
              {(() => {
                const pxPerM = (typeof guideOverlay.pxPerM === 'number' && Number.isFinite(guideOverlay.pxPerM) && guideOverlay.pxPerM > 0)
                  ? guideOverlay.pxPerM
                  : 50;
                const pos = guideOverlay.pos_m || { x: 0, y: 0 };
                const canvasPos = worldToCanvas({ x: pos.x, y: pos.y }, scale, panOffset, canvasCenter);
                const widthCanvasPx = (overlayImg.width / pxPerM) * 50 * scale;
                const heightCanvasPx = (overlayImg.height / pxPerM) * 50 * scale;

                const canvasToImgPx = (p: { x: number; y: number }) => {
                  const rx = (p.x - canvasPos.x) / (widthCanvasPx || 1);
                  const ry = (p.y - canvasPos.y) / (heightCanvasPx || 1);
                  const cx = Math.max(0, Math.min(1, rx));
                  const cy = Math.max(0, Math.min(1, ry));
                  return { x: cx * overlayImg.width, y: cy * overlayImg.height };
                };

                const first = overlayCalFirstRef.current;
                const secondCanvas = overlayCalSecondCanvas;
                const hover = overlayCalHoverCanvas;
                const hasFirst = !!first;
                const hasSecond = !!secondCanvas;
                const resolvedSecond = hasFirst && hasSecond
                  ? resolveOverlayCalibrationCanvasPoint(secondCanvas!, first!.canvas)
                  : null;
                const resolvedHover = hasFirst && !hasSecond && hover
                  ? resolveOverlayCalibrationCanvasPoint(hover, first!.canvas)
                  : null;
                const lineEnd = resolvedSecond?.point ?? resolvedHover?.point ?? null;
                const lineSnapped = !!resolvedSecond?.snapped || !!resolvedHover?.snapped;

                return (
                  <>
                    {/* Transparent hit-rect + subtle outline */}
                    <Rect
                      x={canvasPos.x}
                      y={canvasPos.y}
                      width={widthCanvasPx}
                      height={heightCanvasPx}
                      fill="rgba(0,0,0,0)"
                      stroke="rgba(234,253,90,0.35)"
                      strokeWidth={1}
                      dash={[6, 4]}
                      onMouseDown={(e) => {
                        e.cancelBubble = true;
                        const stage = e.target.getStage();
                        const pointer = getStageViewportPointer(stage);
                        if (!pointer) return;

                        const rawClickCanvas = { x: pointer.x, y: pointer.y };
                        const clickCanvas = overlayCalFirstRef.current && !overlayCalSecondCanvas
                          ? resolveOverlayCalibrationCanvasPoint(rawClickCanvas, overlayCalFirstRef.current.canvas).point
                          : rawClickCanvas;
                        const clickWorld = canvasToWorld(clickCanvas, scale, panOffset, canvasCenter);
                        const clickImgPx = canvasToImgPx(clickCanvas);

                        if (!overlayCalFirstRef.current || overlayCalSecondCanvas) {
                          // Start (or restart) calibration
                          if (!beginGuideOverlayCalibrationInteraction()) return;
                          overlayCalFirstRef.current = { canvas: clickCanvas, world: clickWorld, imgPx: clickImgPx };
                          overlayCalSecondRef.current = null;
                          overlayCalDistPxRef.current = null;
                          setOverlayCalSecondCanvas(null);
                          setOverlayCalHoverCanvas(clickCanvas);
                          setOverlayCalStep(1);
                          return;
                        }

                        // Second click
                        setOverlayCalSecondCanvas(clickCanvas);
                        setOverlayCalHoverCanvas(clickCanvas);

                        const firstLocal = overlayCalFirstRef.current;
                        if (!firstLocal) return;

                        const dx = clickImgPx.x - firstLocal.imgPx.x;
                        const dy = clickImgPx.y - firstLocal.imgPx.y;
                        const distPx = Math.hypot(dx, dy);
                        if (!Number.isFinite(distPx) || distPx < 1) {
                          alert('Calibration points are too close together. Try again with a longer wall.');
                          completeGuideOverlayCalibrationInteraction(false);
                          return;
                        }

                        // Save second point + distance; user will enter real metres and click Apply in the panel.
                        overlayCalSecondRef.current = { canvas: clickCanvas, world: clickWorld, imgPx: clickImgPx };
                        overlayCalDistPxRef.current = distPx;
                        setOverlayCalStep(2);
                        completeGuideOverlayCalibrationInteraction(true);
                      }}
                      onMouseMove={(e) => {
                        e.cancelBubble = true;
                        const stage = e.target.getStage();
                        const pointer = getStageViewportPointer(stage);
                        if (!pointer) return;
                        const rawHoverCanvas = { x: pointer.x, y: pointer.y };
                        if (!overlayCalFirstRef.current || overlayCalSecondCanvas) {
                          setOverlayHintCanvasPos(rawHoverCanvas);
                          return;
                        }
                        const resolvedHoverCanvas = resolveOverlayCalibrationCanvasPoint(rawHoverCanvas, overlayCalFirstRef.current.canvas).point;
                        setOverlayHintCanvasPos(resolvedHoverCanvas);
                        setOverlayCalHoverCanvas(resolvedHoverCanvas);
                      }}
                      onMouseLeave={() => {
                        if (!overlayCalFirstRef.current || overlayCalSecondCanvas) return;
                        setOverlayCalHoverCanvas(null);
                        setOverlayHintCanvasPos(null);
                      }}
                    />

                    {/* First point marker */}
                    {hasFirst && (
                      <Circle
                        x={first!.canvas.x}
                        y={first!.canvas.y}
                        radius={4}
                        fill="#FFD93D"
                        stroke="#FFFFFF"
                        strokeWidth={1}
                        listening={false}
                      />
                    )}

                    {/* Second point marker */}
                    {hasFirst && hasSecond && (
                      <Circle
                        x={resolvedSecond!.point.x}
                        y={resolvedSecond!.point.y}
                        radius={4}
                        fill="#FFD93D"
                        stroke="#FFFFFF"
                        strokeWidth={1}
                        listening={false}
                      />
                    )}

                    {/* Line preview */}
                    {hasFirst && lineEnd && (
                      <Line
                        points={[first!.canvas.x, first!.canvas.y, lineEnd.x, lineEnd.y]}
                        stroke={lineSnapped ? readRootCssVar('--semantic-snap', '#1E90FF') : '#FFD93D'}
                        strokeWidth={2}
                        listening={false}
                      />
                    )}

                    {/* Blue pill guidance near cursor (reuses draw-mode styling) */}
                    {overlayHintCanvasPos && overlayHintText && (
                      <>
                        <Circle
                          x={overlayHintCanvasPos.x}
                          y={overlayHintCanvasPos.y}
                          radius={3}
                          fill={readRootCssVar('--semantic-snap', '#1E90FF')}
                          listening={false}
                        />
                        {(() => {
                          const tooltipOffset = 15;
                          const width = getDrawModeTooltipPillWidth(overlayHintText);
                          return renderDrawModeTooltipPill(
                            overlayHintText,
                            {
                              x: overlayHintCanvasPos.x - width / 2,
                              y: overlayHintCanvasPos.y - tooltipOffset - DRAW_MODE_TOOLTIP_PILL_HEIGHT
                            }
                          );
                        })()}
                      </>
                    )}
                  </>
                );
              })()}
            </Layer>
          )}

        </Stage>
        {viewMode === '2d' && (
          <div
            ref={developmentContextChipsLayerRef}
            className="development-context-chips-layer"
            aria-hidden={developmentContextModelLabels.length === 0}
          >
            {developmentContextModelLabels.map((label) => {
              const isStackOpen = openDevelopmentContextStackLabel?.id === label.id;
              const className = [
                'development-context-model-chip',
                `development-context-model-chip--${label.verticalRelation}`,
                `development-context-model-chip--status-${label.statusState}`,
                label.isStack ? 'development-context-model-chip--stacked' : '',
                isStackOpen ? 'development-context-model-chip--open' : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={`development-context-model-chip:${label.id}`}
                  type="button"
                  className={className}
                  style={{
                    left: label.x,
                    top: label.y,
                    width: label.width,
                  }}
                  title={label.title}
                  aria-label={label.title}
                  aria-haspopup={label.isStack ? 'menu' : undefined}
                  aria-expanded={label.isStack ? isStackOpen : undefined}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseEnter={() => {
                    if (!label.isStack) setDevelopmentContextHoveredStem(label.models[0]?.stem ?? null);
                  }}
                  onMouseLeave={() => {
                    if (!isStackOpen) setDevelopmentContextHoveredStem(null);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (label.isStack) {
                      setDevelopmentContextStackMenuId((current) => current === label.id ? null : label.id);
                      setDevelopmentContextHoveredStem(null);
                      return;
                    }
                    const stem = label.models[0]?.stem;
                    if (stem && fileControls) {
                      void fileControls.documentHost.open({
                        target: fileControls.resolveDocumentTarget(stem),
                      }).catch((error) => {
                        console.error(`[GeometryCanvas] Failed to open "${stem}":`, error);
                      });
                    }
                  }}
                  disabled={!fileControls}
                >
                  <span className="development-context-model-chip__name">{label.primaryText}</span>
                  <span className="development-context-model-chip__floor">{label.floorText}</span>
                  <span className={`development-context-model-chip__status development-context-model-chip__status--${label.statusState}`}>
                    {label.statusText}
                  </span>
                </button>
              );
            })}
            {openDevelopmentContextStackLabel && (
              <div
                className="development-context-stack-popover"
                role="menu"
                style={{
                  left: openDevelopmentContextStackLabel.x,
                  top: openDevelopmentContextStackLabel.y,
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onMouseLeave={() => setDevelopmentContextHoveredStem(null)}
              >
                {openDevelopmentContextStackLabel.models.map((model) => (
                  <button
                    key={`development-context-stack-row:${openDevelopmentContextStackLabel.id}:${model.stem}`}
                    type="button"
                    role="menuitem"
                    className={`development-context-stack-popover__row development-context-stack-popover__row--${model.validationState}`}
                    title={`${model.stem} - ${model.floorTitle} - ${model.validationTitle}`}
                    onMouseEnter={() => setDevelopmentContextHoveredStem(model.stem)}
                    onFocus={() => setDevelopmentContextHoveredStem(model.stem)}
                    onMouseLeave={() => setDevelopmentContextHoveredStem(null)}
                    onClick={() => {
                      if (fileControls) {
                        void fileControls.documentHost.open({
                          target: fileControls.resolveDocumentTarget(model.stem),
                        }).catch((error) => {
                          console.error(
                            `[GeometryCanvas] Failed to open "${model.stem}":`,
                            error,
                          );
                        });
                      }
                      setDevelopmentContextStackMenuId(null);
                      setDevelopmentContextHoveredStem(null);
                    }}
                    disabled={!fileControls}
                  >
                    <span className="development-context-stack-popover__name">{model.stem}</span>
                    <span className="development-context-stack-popover__floor">{model.floorLabel}</span>
                    <span className={`development-context-stack-popover__status development-context-stack-popover__status--${model.validationState}`}>
                      {model.validationText}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Mount 3D lazily, then keep it mounted on return to 2D so OrbitControls/camera state is preserved. */}
        <div
          className={
            'geometry-canvas-3d-overlay' +
            (viewMode === '2d' ? ' geometry-canvas-3d-overlay--hidden' : '')
          }
          aria-hidden={viewMode === '2d'}
        >
          {shouldMountGeometryCanvas3D ? (
            <Suspense fallback={<LazyInlineFallback label="Opening 3D view..." />}>
              {ENABLE_GEOMETRY_CANVAS_REACT_PROFILER && geometryPerf.isEnabled() ? (
                <React.Profiler id="GeometryCanvas.overlay3d.child" onRender={recordGeometryCanvasProfiler}>
                  <GeometryCanvas3D {...geometryCanvas3DProps} />
                </React.Profiler>
              ) : (
                <GeometryCanvas3D {...geometryCanvas3DProps} />
              )}
            </Suspense>
          ) : null}
        </div>
            </div>

      {/* Overlays now mounted at .geometry-canvas level to avoid clipping */}
      {/* Overlay: File bar (top-left) */}
      {!zenMode && !hiddenPanels.file && (
      <div
        ref={filebarRef}
        className="glass-panel overlay-filebar"
        style={filebarPosition ? { left: filebarPosition.x, top: filebarPosition.y } : undefined}
      >
        <span className="controls-label">File</span>
        <div
          id="geometry-filebar-body"
          className="overlay-filebar-body"
        >
          {fileControls ? (
            <FilenameBar
              documentHost={fileControls.documentHost}
              saveStatus={fileControls.saveStatus}
              saveError={fileControls.saveError}
              fileNameExtension={fileControls.fileNameExtension}
              saveErrorTitle={fileControls.saveErrorTitle}
              buildError={fileControls.buildError}
              buildErrorItems={fileControls.buildErrorItems}
              onOpenDefaults={fileControls.onOpenDefaults}
              defaultsPath={fileControls.defaultsPath}
              defaultsInvalid={fileControls.defaultsInvalid}
              globalSettingsIndicator={fileControls.globalSettingsIndicator}
              hostModelName={fileControls.hostModelName}
              filenameActionContributions={editorContributions}
            />
          ) : (
            <>
              <button className="add-button" title="Save">Save</button>
              <input className="input" style={{ padding: 4, borderRadius: 6 }} placeholder="Filename" />
            </>
          )}
        </div>
        <div className="overlay-filebar-controls-right">
          <div
            role="button"
            tabIndex={0}
            aria-label="Move file bar"
            className="panel-drag-handle overlay-panel-drag-handle"
            title="Drag to move • Double-click to reset"
            onMouseDown={handleFilebarDragHandleMouseDown}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              resetFilebarPosition();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                resetFilebarPosition();
              }
            }}
          >
            <span className="panel-drag-handle-dots" aria-hidden="true" />
          </div>
        </div>
      </div>
      )}

      {!zenMode
        ? contributedCanvasPanelComposition.visiblePanels.map((panel) => (
              <React.Fragment key={panel.id}>
                {profileGeometryCanvasNode(
                  `GeometryCanvas.overlay.${panel.id}`,
                  panel.render(canvasPanelContexts.get(panel.id)!),
                )}
              </React.Fragment>
            ))
        : null}

      {/* Overlay: Compass Rose (top-left, under filebar) */}
      {!zenMode && !hiddenPanels.compass && (
      <Rnd
        bounds="parent"
        size={{ width: COMPASS_PANEL_DEFAULT.width, height: COMPASS_PANEL_DEFAULT.height }}
        position={{ x: compassRect.x, y: compassRect.y }}
        enableResizing={false}
        dragHandleClassName="panel-drag-handle"
        cancel="input, textarea, select, button"
        style={{ zIndex: 1000 }}
        onDragStart={() => {
          setCompassAutoPosition(false);
        }}
        onDrag={(_e, d) => {
          setCompassRect((prev) => ({
            ...prev,
            ...clampCompassPosition({ x: d.x, y: d.y }),
            width: COMPASS_PANEL_DEFAULT.width,
            height: COMPASS_PANEL_DEFAULT.height,
          }));
        }}
        onDragStop={(_e, d) => {
          setCompassRect((prev) => ({
            ...prev,
            ...clampCompassPosition({ x: d.x, y: d.y }),
            width: COMPASS_PANEL_DEFAULT.width,
            height: COMPASS_PANEL_DEFAULT.height,
          }));
        }}
      >
        <div className="glass-panel overlay-compass-panel" onClick={(e) => e.stopPropagation()}>
          <CompassRose
            headerAccessory={
              <div
                role="button"
                tabIndex={0}
                aria-label="Move panel"
                className="panel-drag-handle"
                title="Drag to move • Double-click to reset"
                onDoubleClick={(e) => {
                  e.preventDefault();
                  setCompassAutoPosition(true);
                  setCompassRect((prev) => ({
                    ...prev,
                    ...clampCompassPosition({ x: COMPASS_PANEL_DEFAULT.x, y: compassMinY }),
                    width: COMPASS_PANEL_DEFAULT.width,
                    height: COMPASS_PANEL_DEFAULT.height,
                  }));
                }}
              >
                <span className="panel-drag-handle-dots" aria-hidden="true" />
              </div>
            }
          />
        </div>
      </Rnd>
      )}

      {/* Overlay: Elements & Zones menu (top-right) - Side by Side Layout */}
      {!zenMode && (
        profileGeometryCanvasNode(
          'GeometryCanvas.overlay.elementsZones',
          <ElementsZonesPanel
            selection={selection}
            setSelection={setSelection}
            selectedElementIds={selectedElementIds}
            setSelectedElementIds={setSelectedElementIds}
            clearElementSelection={clearElementSelection}
            zones={zones}
            elementsById={elementsById}
            elementIds={elementIds}
            modelSchemaProfilePort={modelSchemaProfilePort}
            currentFloorZ={currentFloorZ}
            getValidation={getValidation}
            elementsRect={elementsRect}
            setElementsRect={setElementsRect}
            activePanel={activePanel}
            setActivePanel={setActivePanel}
            stageSize={stageSize}
            clampElementsRectToCanvas={clampElementsRectToCanvas}
            getElementsDefaultRect={getElementsDefaultRect}
            canvasCenter={canvasCenter}
            scale={scale}
            panOffset={panOffset}
            setPanOffset={setPanOffset}
            createPlaceholderZone={createPlaceholderZone}
            createPlaceholderElement={createPlaceholderElement}
            updateElement={updateElement}
            setCurrentFloorZ={setCurrentFloorZ}
            complianceSettings={complianceSettings}
            sourceComparisonPort={sourceComparisonPort}
            lookupByElement={lookupByElement}
            hasEvidenceDraft={hasEvidenceDraft}
            viewMode={viewMode}
            panelHideOptions={panelHideOptions}
            hiddenPanelKeys={hiddenPanelKeys}
            onTogglePanelHidden={togglePanelHidden}
            onHideAllPanels={hidePanels}
            onShowAllPanels={showPanels}
            onFrameElementIn3D={handleFrameElementIn3D}
            elementCategoryGhost={elementCategoryGhostState}
            onToggleElementCategoryGhost={toggleCategoryGhost}
            hiddenElementIds={hiddenElementIds}
            toggleElementsHidden={toggleElementsHidden}
            unhideElement={unhideElement}
            cmdASelectIdsRef={elementsPanelCmdASelectIdsRef}
          />,
        )
      )}

      {/* Overlay: Draw toolbar (bottom center) */}
      {!zenMode && !hiddenPanels.drawToolbar && (
        profileGeometryCanvasNode(
          'GeometryCanvas.overlay.drawToolbar',
          <DrawToolbar
            drawMode={drawMode}
            setDrawMode={setDrawMode}
            drawElementType={drawElementType}
            setDrawElementType={handleDrawElementTypeFromToolbar}
            showOverlayPanel={showOverlayPanel}
            setShowOverlayPanel={setShowOverlayPanel}
            showShortcuts={showShortcuts}
            setShowShortcuts={setShowShortcuts}
            currentFloorZ={currentFloorZ}
            setCurrentFloorZ={setCurrentFloorZ}
            floors={floors}
            elementsById={elementsById}
            ensureFloorForZ={ensureFloorForZ}
            removeFloor={removeFloor}
            updateFloor={updateFloor}
            setDrawPoints={setDrawPoints}
            setRoomWalls={setRoomWalls}
            setRoomWallElements={setRoomWallElements}
            setOrthogonalRoomStart={setOrthogonalRoomStart}
            setOrthogonalRoomEnd={setOrthogonalRoomEnd}
            drawPreset={drawPreset}
            setDrawPreset={setDrawPreset}
            presetOptions={elementPresetOptions}
            drawMvhrDuctRole={drawMvhrDuctRole}
            setDrawMvhrDuctRole={setDrawMvhrDuctRole}
            drawMvhrTerminalRole={drawMvhrTerminalRole}
            setDrawMvhrTerminalRole={setDrawMvhrTerminalRole}
            viewMode={viewMode}
            setViewMode={handleViewModeChange}
            onPrefetch3DView={prefetchGeometryCanvas3D}
            complianceValidationEnabled={!!complianceSettings?.complianceValidationEnabled}
            wrapperRef={drawToolbarRef}
            style={drawToolbarStyle}
            dragHandle={drawToolbarDragHandle}
            renderLeadingAccessory={renderDrawToolbarLeadingAccessory}
          />,
        )
      )}

      {zenMode && (
        <button
          type="button"
          className="draw-button overlay-zen-exit"
          onClick={() => setZenMode(false)}
          title="Show Panels (Z)"
          aria-label="Show Panels (Z)"
        >
          <span aria-hidden="true">◱</span>
          <span>Show Panels (Z)</span>
        </button>
      )}

      <div ref={canvasFloatingEditorsLayerRef} className="canvas-floating-editors-layer">
      {viewMode === '2d' && activeServiceLinePillGeometry && (() => {
        const editor = activeServiceLinePillGeometry;
        const pillKeyBase = `${editor.element.id}:${editor.mode}:${editor.start.x}:${editor.start.y}:${editor.start.z}:${editor.end.x}:${editor.end.y}:${editor.end.z}`;
        const renderPill = ({
          key,
          position,
          value,
          note,
          ariaLabel,
          offsetX = 0,
          offsetY = 0,
          readOnly = false,
          onCommit,
        }: {
          key: string;
          position: { x: number; y: number };
          value: string;
          note: string;
          ariaLabel: string;
          offsetX?: number;
          offsetY?: number;
          readOnly?: boolean;
          onCommit?: (rawValue: string) => void;
        }) => {
          return (
            <div
              key={key}
              className={`draw-segment-editor${readOnly ? ' draw-segment-editor--readonly' : ''}`}
              style={{
                left: position.x + offsetX,
                top: position.y + offsetY,
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <input
                key={`${pillKeyBase}:${key}`}
                className="draw-segment-editor-input"
                type="text"
                inputMode="decimal"
                defaultValue={value}
                readOnly={readOnly}
                aria-label={ariaLabel}
                spellCheck={false}
                tabIndex={readOnly ? -1 : undefined}
                onBlur={readOnly ? undefined : (event) => onCommit?.(event.currentTarget.value)}
                onInput={(event) => resizeDrawSegmentEditorInput(event.currentTarget)}
                onKeyDown={(event) => {
                  if (readOnly) {
                    event.stopPropagation();
                    return;
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.currentTarget.value = value;
                    resizeDrawSegmentEditorInput(event.currentTarget);
                    event.currentTarget.blur();
                  }
                  event.stopPropagation();
                }}
                style={{
                  width: `${getDrawSegmentEditorInputWidthCh(value)}ch`,
                }}
              />
              <span className="draw-segment-editor-note">{note}</span>
            </div>
          );
        };

        const planLengthValue = formatServiceLineEditorNumber(editor.planLength);
        const actualLengthValue = formatServiceLineEditorNumber(editor.actualLength);
        const startZValue = formatServiceLineEditorNumber(editor.start.z);
        const endZValue = formatServiceLineEditorNumber(editor.end.z);

        if (editor.mode === 'plan') {
          return (
            <>
              {renderPill({
                key: 'plan-length',
                position: editor.midpointPosition,
                value: planLengthValue,
                note: 'plan m',
                ariaLabel: 'Plan length',
                offsetY: -18,
                onCommit: commitActiveServiceLinePlanLength,
              })}
              {renderPill({
                key: 'z',
                position: editor.midpointPosition,
                value: startZValue,
                note: 'z',
                ariaLabel: 'Z',
                offsetY: 18,
                onCommit: (rawValue) => commitActiveServiceLineZ('both', rawValue),
              })}
            </>
          );
        }

        if (editor.mode === 'vertical') {
          return (
            <>
              {renderPill({
                key: 'vertical-length',
                position: editor.midpointPosition,
                value: actualLengthValue,
                note: 'vertical m',
                ariaLabel: 'Vertical length',
                offsetY: -24,
                readOnly: true,
              })}
              {renderPill({
                key: 'start-z',
                position: editor.startPosition,
                value: startZValue,
                note: 'start z',
                ariaLabel: 'Start Z',
                offsetY: 0,
                onCommit: (rawValue) => commitActiveServiceLineZ('start', rawValue),
              })}
              {renderPill({
                key: 'end-z',
                position: editor.endPosition,
                value: endZValue,
                note: 'end z',
                ariaLabel: 'End Z',
                offsetY: 24,
                onCommit: (rawValue) => commitActiveServiceLineZ('end', rawValue),
              })}
            </>
          );
        }

        return (
          <>
            {renderPill({
              key: 'plan-length',
              position: editor.midpointPosition,
              value: planLengthValue,
              note: 'plan m',
              ariaLabel: 'Plan length',
              offsetY: -18,
              onCommit: commitActiveServiceLinePlanLength,
            })}
            {renderPill({
              key: 'actual-length',
              position: editor.midpointPosition,
              value: actualLengthValue,
              note: 'actual m',
              ariaLabel: 'Actual length',
              offsetY: 18,
              readOnly: true,
            })}
            {renderPill({
              key: 'start-z',
              position: editor.startPosition,
              value: startZValue,
              note: 'start z',
              ariaLabel: 'Start Z',
              offsetY: 18,
              onCommit: (rawValue) => commitActiveServiceLineZ('start', rawValue),
            })}
            {renderPill({
              key: 'end-z',
              position: editor.endPosition,
              value: endZValue,
              note: 'end z',
              ariaLabel: 'End Z',
              offsetY: 18,
              onCommit: (rawValue) => commitActiveServiceLineZ('end', rawValue),
            })}
          </>
        );
      })()}

      {viewMode === '2d' && (
        activeSegmentEditorGeometry && (() => {
          const editorCanvasPos = worldToCanvas(
            activeSegmentEditorGeometry.midpoint,
            scale,
            panOffset,
            canvasCenter,
          );
          return (
            <div
              className="draw-segment-editor"
              style={{
                left: editorCanvasPos.x,
                top: editorCanvasPos.y,
                width: activeSegmentEditorWidth ?? undefined,
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <input
                className="draw-segment-editor-input"
                type="text"
                value={activeSegmentEditor?.value ?? ''}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setActiveSegmentEditor((prev) => (prev ? { ...prev, value: nextValue } : prev));
                }}
                onBlur={(event) => commitActiveSegmentEditor(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.blur();
                  } else if (event.key === 'Escape') {
                    cancelActiveSegmentEditorCommitRef.current = true;
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.blur();
                  } else {
                    event.stopPropagation();
                  }
                }}
                inputMode="decimal"
                autoFocus
                aria-label="Segment length"
                spellCheck={false}
                style={{
                  width: `${Math.max(1, (activeSegmentEditor?.value ?? '').length)}ch`,
                }}
              />
              <span className="draw-segment-editor-note">{activeSegmentEditorGeometry.note}</span>
            </div>
          );
        })()
      )}

      {viewMode === '2d' && roofWindowDistanceEditorGeometry && (
        <div
          className={`draw-segment-editor roof-window-distance-editor${roofWindowDistanceEditor?.error ? ' roof-window-distance-editor--error' : ''}`}
          style={{
            left: roofWindowDistanceEditorGeometry.left,
            top: roofWindowDistanceEditorGeometry.top,
            width: roofWindowDistanceEditorGeometry.width,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <input
            className="draw-segment-editor-input"
            type="text"
            value={roofWindowDistanceEditor?.value ?? ''}
            onChange={(event) => {
              const nextValue = event.target.value;
              setRoofWindowDistanceEditor((prev) => (
                prev ? { ...prev, value: nextValue, error: false } : prev
              ));
            }}
            onBlur={() => setRoofWindowDistanceEditor(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                commitRoofWindowDistanceEditor();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setRoofWindowDistanceEditor(null);
              } else {
                event.stopPropagation();
              }
            }}
            inputMode="decimal"
            autoFocus
            aria-label="Up-slope roof-window distance"
            spellCheck={false}
            style={{
              width: `${Math.max(1, (roofWindowDistanceEditor?.value ?? '').length)}ch`,
            }}
          />
          <span className="draw-segment-editor-note">m</span>
        </div>
      )}

      {viewMode === '2d' && lineOpeningDistanceEditorGeometry && (
        <div
          className={`draw-segment-editor line-opening-distance-editor${lineOpeningDistanceEditor?.error ? ' line-opening-distance-editor--error' : ''}`}
          style={{
            left: lineOpeningDistanceEditorGeometry.left,
            top: lineOpeningDistanceEditorGeometry.top,
            width: lineOpeningDistanceEditorGeometry.width,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <input
            className="draw-segment-editor-input"
            type="text"
            value={lineOpeningDistanceEditor?.value ?? ''}
            onChange={(event) => {
              const nextValue = event.target.value;
              setLineOpeningDistanceEditor((prev) => (
                prev ? { ...prev, value: nextValue, error: false } : prev
              ));
            }}
            onBlur={() => setLineOpeningDistanceEditor(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                commitLineOpeningDistanceEditor();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setLineOpeningDistanceEditor(null);
              } else {
                event.stopPropagation();
              }
            }}
            inputMode="decimal"
            autoFocus
            aria-label="Line opening clearance distance"
            spellCheck={false}
            style={{
              width: `${Math.max(1, (lineOpeningDistanceEditor?.value ?? '').length)}ch`,
            }}
          />
          <span className="draw-segment-editor-note">m</span>
        </div>
      )}
      </div>

      {!zenMode && viewMode === '2d' && (
        profileGeometryCanvasNode(
          'GeometryCanvas.overlay.guidePanel',
          <OverlayPanel
            panelRef={overlayGuidePanelRef}
            showOverlayPanel={showOverlayPanel}
            overlayMoveMode={overlayMoveMode}
            setOverlayMoveMode={setOverlayMoveMode}
            overlayCalibrateMode={overlayCalibrateMode}
            setOverlayCalibrateMode={setOverlayCalibrateMode}
            overlayCalRealM={overlayCalRealM}
            setOverlayCalRealM={setOverlayCalRealM}
            overlayCalStep={overlayCalStep}
            setOverlayCalStep={setOverlayCalStep}
            overlayImg={overlayImg}
            overlayCalFirstRef={overlayCalFirstRef}
            overlayCalSecondRef={overlayCalSecondRef}
            overlayCalDistPxRef={overlayCalDistPxRef}
            setOverlayCalSecondCanvas={setOverlayCalSecondCanvas}
            setOverlayCalHoverCanvas={setOverlayCalHoverCanvas}
            guideOverlay={guideOverlay}
            guideOverlaySource={guideOverlaySource}
            guideOverlayByFloor={guideOverlayByFloor}
            currentFloorZ={currentFloorZ}
            updateGuideOverlay={updateGuideOverlay}
            clearGuideOverlay={clearOverlayFiles}
            resetGuideOverlayForActiveFloor={resetGuideOverlayForActiveFloor}
            overlayFileInputRef={overlayFileInputRef}
            handleOverlayFileChosen={handleOverlayFileChosen}
            onResetDrawingState={resetDrawing}
            scale={scale}
            canvasCenter={canvasCenter}
            setPanOffset={setPanOffset}
          />,
        )
      )}

      <OverlayPdfImportModal
        isOpen={overlayPdfImportState.isOpen}
        fileName={overlayPdfImportState.fileName}
        page={overlayPdfImportState.page}
        numPages={overlayPdfImportState.numPages}
        previewUrl={overlayPdfImportState.previewUrl}
        isPreviewLoading={overlayPdfImportState.isPreviewLoading}
        isImporting={overlayPdfImportState.isImporting}
        error={overlayPdfImportState.error}
        onClose={cancelOverlayPdfImport}
        onPageChange={setOverlayPdfImportPage}
        onConfirm={confirmOverlayPdfImport}
      />

      {/* Shortcuts Guide Overlay */}
      {!zenMode && showShortcuts && (
        <div className="glass-panel shortcuts-guide">
          <div className="shortcuts-guide-header">
            <h3>Controls & Shortcuts</h3>
            <button
              className="shortcuts-close"
              onClick={() => setShowShortcuts(false)}
              title="Close guide"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2"/>
              </svg>
                  </button>
            </div>
          <div className="shortcuts-content">
            <div className="shortcuts-section">
              <h4>Drawing</h4>
              <div className="shortcut-item">
                <kbd>L</kbd> <span>Draw line</span>
          </div>
              <div className="shortcut-item">
                <kbd>P</kbd> <span>Draw polygon</span>
        </div>
              <div className="shortcut-item">
                <kbd>O</kbd> <span>Draw object</span>
      </div>
              <div className="shortcut-item">
                <kbd>S</kbd> <span>Add point to polygon</span>
      </div>
              <div className="shortcut-item">
                <kbd>Shift</kbd> <span>Hold to lock drawing or calibration horizontally/vertically</span>
      </div>
              <div className="shortcut-item">
                <kbd>Alt</kbd> / <kbd>Option</kbd> <span>Hold while placing to keep drawing</span>
      </div>
              <div className="shortcut-item">
                <kbd>Space</kbd> <span>Hold to pan while drawing</span>
      </div>
            </div>
            <div className="shortcuts-section">
              <h4>Navigation</h4>
              <div className="shortcut-item">
                <kbd>+</kbd> <span>Zoom in</span>
              </div>
              <div className="shortcut-item">
                <kbd>-</kbd> <span>Zoom out</span>
              </div>
              <div className="shortcut-item">
                <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> <span>Move element</span>
              </div>
            </div>
            <div className="shortcuts-section">
              <h4>Actions</h4>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>Z</kbd> <span>Undo</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>Y</kbd> <span>Redo</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> <span>Redo (alternative)</span>
              </div>
              <div className="shortcut-item">
                <kbd>Backspace</kbd> <span>Remove last point while drawing; or remove selected polygon vertex</span>
              </div>
              <div className="shortcut-item">
                <kbd>Delete</kbd> <span>Delete selected element; or remove selected polygon vertex</span>
              </div>
              <div className="shortcut-item">
                <kbd>Escape</kbd> <span>Cancel drawing / Clear selection</span>
              </div>
              <div className="shortcut-item">
                <kbd>Z</kbd> <span>Toggle zen mode</span>
              </div>
            </div>
            <div className="shortcuts-section">
              <h4>Snap Options</h4>
              <div className="shortcut-item">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <input
                    type="checkbox"
                    checked={!!snapToParent}
                    onChange={(e) => setSnapToParent(e.target.checked)}
                  />
                  <span>Snap to Parent</span>
                </label>
              </div>
              <div className="shortcut-item">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <input
                    type="checkbox"
                    checked={!!snapCorners}
                    onChange={(e) => (geometryStore.getState() as any).setSnapCorners(e.target.checked)}
                  />
                  <span>Snap to Corners</span>
                </label>
              </div>
              <div className="shortcut-item">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <input
                    type="checkbox"
                    checked={!!snapAngles}
                    onChange={(e) => (geometryStore.getState() as any).setSnapAngles(e.target.checked)}
                  />
                  <span>Snap to Right Angles</span>
                </label>
              </div>
              <div className="shortcut-item">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <input
                    type="checkbox"
                    checked={vertexSnapMode}
                    onChange={(e) => setVertexSnapMode(e.target.checked)}
                  />
                  <span>Vertex Snap Mode</span>
                </label>
              </div>
            </div>
            <div className="shortcuts-section">
              <h4>Label Visibility</h4>
              <div className="shortcut-item">
                <label style={{ display: 'flex', gap: 8, width: '100%', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <select
                    value={labelVisibility}
                    onChange={(e) => setLabelVisibility(e.target.value as 'always' | 'selected')}
                    style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.3)', color: 'var(--semantic-on-color)', width: '100%' }}
                  >
                    <option value="always">Always show labels</option>
                    <option value="selected">Show selected + hover</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="shortcuts-section">
              <h4>Display</h4>
              <div className="shortcut-item">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <input
                    type="checkbox"
                    checked={showLineDimensions}
                    onChange={(e) => setShowLineDimensions(e.target.checked)}
                  />
                  <span>Show line dimensions</span>
                </label>
              </div>
            </div>
            <div className="shortcuts-section">
              <h4>Mouse Controls</h4>
              <div className="shortcut-item">
                <span>Space + Drag</span> <span>Pan canvas while drawing</span>
              </div>
              <div className="shortcut-item">
                <span>Middle mouse + Drag</span> <span>Pan canvas</span>
              </div>
              <div className="shortcut-item">
                <span>Scroll / Two-finger swipe</span> <span>Pan canvas</span>
              </div>
              <div className="shortcut-item">
                <span>Ctrl/Cmd + Scroll</span> <span>Zoom around cursor</span>
              </div>
              <div className="shortcut-item">
                <span>Click + Drag (not drawing)</span> <span>Marquee select</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Details panel (single edit + multi edit) */}
      {!zenMode && (() => {
        const selectedPrimaryElement =
          selection?.type === 'dormer' && selection.id
            ? getDormerBundleAnchorElement(elementsById, selection.id)
            : selection?.type === 'element' && selection.id
              ? elementsById[selection.id]
              : null;
        const selectedDormerBundleInfo = getDormerBundleInfo(selectedPrimaryElement);
        const selectionRepresentsSingleDormer =
          selection?.type === 'dormer' ||
          (
            selection?.type === 'element' &&
            !!selectedDormerBundleInfo &&
            selectedElementIds.length > 0 &&
            selectedElementIds.every(
              (id) => getDormerBundleInfo(elementsById[id])?.bundle_id === selectedDormerBundleInfo.bundle_id,
            )
          );

        const showSingle =
          (selection?.type === 'element' || selection?.type === 'global' || selection?.type === 'zone' || selection?.type === 'dormer') &&
          (selectedElementIds.length <= 1 || selectionRepresentsSingleDormer);
        const showMulti = selectedElementIds.length > 1 && !selectionRepresentsSingleDormer;
        const show = showSingle || showMulti || (!!spaceLabellerOpen && !!spaceLabellerZoneId);
        if (!show) return null;

        const editorSelection =
          selection?.type === 'dormer' && selectedPrimaryElement
            ? { type: 'element' as const, id: selectedPrimaryElement.id }
            : selection;

        const reset = () => {
          setDetailsMode('docked');
          setDetailsRect(getDetailsDefaultRect());
        };

        const zIndex = activePanel === 'details' ? 2100 : 1900;

        return (
          <Rnd
            bounds="parent"
            size={{ width: detailsRect.width, height: detailsRect.height }}
            position={{ x: detailsRect.x, y: detailsRect.y }}
            minWidth={DETAILS_PANEL_MIN_W}
            minHeight={DETAILS_PANEL_MIN_H}
            maxWidth={Math.max(DETAILS_PANEL_MIN_W, Math.floor(stageSize.width - 24))}
            maxHeight={Math.max(DETAILS_PANEL_MIN_H, Math.floor(stageSize.height * 0.8))}
            dragHandleClassName="panel-drag-handle"
            cancel="input, textarea, select, button"
            style={{ zIndex }}
            onMouseDown={() => setActivePanel('details')}
            onDragStart={() => {
              setActivePanel('details');
              setDetailsMode('manual');
            }}
            onResizeStart={() => setActivePanel('details')}
            onDragStop={(_e, d) => {
              setDetailsRect(prev => clampRectToCanvas({ ...prev, x: d.x, y: d.y }));
            }}
            onResizeStop={(_e, _dir, ref, _delta, position) => {
              const width = parseInt(ref.style.width, 10) || DETAILS_PANEL_DEFAULT_W;
              const height = parseInt(ref.style.height, 10) || DETAILS_PANEL_DEFAULT_H;
              setDetailsRect(clampRectToCanvas({ x: position.x, y: position.y, width, height }));
            }}
          >
            <div
              className="canvas-panel details-panel"
              // Don't stop propagation on mousedown: react-rnd listens on the wrapper and needs the event to bubble.
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle (overlay, aligned with existing header region) */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Move panel"
                className="panel-drag-handle panel-drag-handle-overlay"
                title="Drag to move • Double-click to reset/dock"
                onDoubleClick={(e) => {
                  e.preventDefault();
                  setActivePanel('details');
                  reset();
                }}
              >
                <span className="panel-drag-handle-dots" aria-hidden="true" />
              </div>

              <div className="details-panel-body">
                {spaceLabellerOpen && spaceLabellerZoneId ? (
                  profileGeometryCanvasNode(
                    'GeometryCanvas.details.spaceLabeller',
                    <SpaceLabellerPanel
                      zoneId={spaceLabellerZoneId}
                      onClose={handleSpaceLabellerClose}
                      expandLabelId={spaceLabellerExpandLabelId}
                      onExpandLabelConsumed={handleSpaceLabellerExpandLabelConsumed}
                      onCenterFootprintForLabel={centerSpaceLabelFootprintInView}
                      onStartDrawFootprint={handleStartDrawSpaceLabelFootprint}
                      onCancelDrawFootprint={handleCancelDrawSpaceLabelFootprint}
                      isDrawingFootprint={drawMode === 'space-label-polygon'}
                    />,
                  )
                ) : showSingle ? (
                  profileGeometryCanvasNode(
                    'GeometryCanvas.details.elementCreator',
                    <ElementCreator
                      selection={editorSelection}
                      selectionContext={selection}
                      setSelection={setSelection}
                      useCard={false}
                      advancedFlat={true}
                      documentFileName={documentFileName}
                      zoneDeleteModal={zoneDeleteModal}
                      elementDeleteModal={elementDeleteModal}
                      onZoneDelete={handleZoneDelete}
                      onConfirmZoneDelete={handleConfirmZoneDelete}
                      onCancelZoneDelete={handleCancelZoneDelete}
                      onElementDelete={handleElementDelete}
                      onConfirmElementDelete={handleConfirmElementDelete}
                      onCancelElementDelete={handleCancelElementDelete}
                      onOpenSpaceLabeller={handleOpenSpaceLabeller}
                      onStartMvhrDuctDraw={handleStartMvhrDuctDraw}
                      onStartMvhrTerminalDraw={handleStartMvhrTerminalDraw}
                      inspectorContributions={inspectorContributions}
                      workspaceResourcePort={workspaceResourcePort}
                      externalDetailCataloguePort={externalDetailCatalogue}
                    />,
                  )
                ) : (
                  profileGeometryCanvasNode(
                    'GeometryCanvas.details.multiSelect',
                    <MultiSelectPanel
                      selectedElementIds={selectedElementIds}
                      workspaceResourcePort={workspaceResourcePort}
                      externalDetailCatalogue={externalDetailCatalogue}
                      onDelete={() => {
                        setElementDeleteModal({
                          isOpen: true,
                          elementId: null,
                          elementName: `${selectedElementIds.length} elements`,
                          isMultiDelete: true
                        });
                      }}
                    />,
                  )
      )}
              </div>
            </div>
          </Rnd>
        );
      })()}

      <div ref={overlapBadgeMenuLayerRef} className="canvas-floating-editors-layer">
        {/* Overlap Badge Menu */}
        {overlapBadgeMenu && overlapBadgeMenuLayerStyle && (
          <div
            className="overlap-badge-menu"
            style={{
              ...overlapBadgeMenuLayerStyle,
              background: 'rgba(26, 52, 55, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '8px',
              padding: '8px',
              minWidth: '150px',
              zIndex: 1000,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button in top right corner */}
            <button
              type="button"
              onClick={() => setOverlapBadgeMenu(null)}
              style={{
                position: 'absolute',
                top: '4px',
                right: '4px',
                width: '20px',
                height: '20px',
                padding: '0',
                background: 'transparent',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255, 255, 255, 0.6)',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
              }}
              title="Close"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>

            <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '6px', fontWeight: 500, paddingRight: '24px' }}>
              {overlapBadgeMenu.elementIds.length} elements:
            </div>
            {overlapBadgeMenu.elementIds.map((id) => {
              const el = elementsById[id];
              if (!el) return null;
              const displayName = el.name || el.type || id;
              const isSelected = selection?.type === 'element' && selection.id === id;
              const isHovered = elementHover === id;

              // Determine background color: hovered > selected > default
              const getBackgroundColor = () => {
                if (isHovered) return 'var(--selected-bg)'; // Highlight hovered element
                if (isSelected) return 'var(--accent-primary-alpha)'; // Selected element
                return 'transparent';
              };

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    handleElementClick(id, { cancelBubble: true } as any);
                    setOverlapBadgeMenu(null);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '6px 8px',
                    marginBottom: '4px',
                    background: getBackgroundColor(),
                    border: isHovered
                      ? '1px solid var(--accent-primary)'
                      : '1px solid var(--border-overlay)',
                    borderRadius: '4px',
                    color: isHovered ? 'var(--accent-primary)' : 'var(--text-overlay-primary)',
                    fontSize: '12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    setElementHover?.(id);
                    e.currentTarget.style.background = 'var(--selected-bg)';
                    e.currentTarget.style.border = '1px solid var(--accent-primary)';
                    e.currentTarget.style.color = 'var(--accent-primary)';
                  }}
                  onMouseLeave={(e) => {
                    setElementHover?.(null);
                    e.currentTarget.style.background = getBackgroundColor();
                    e.currentTarget.style.border = isHovered
                      ? '1px solid var(--accent-primary)'
                      : '1px solid var(--border-overlay)';
                    e.currentTarget.style.color = isHovered ? 'var(--accent-primary)' : 'var(--text-overlay-primary)';
                  }}
                >
                  {displayName}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modals */}
      <DeleteConfirmModal
        isOpen={zoneDeleteModal.isOpen}
        onClose={handleCancelZoneDelete}
        onConfirm={handleConfirmZoneDelete}
        title="Delete Zone"
        message={`This will delete zone '${zoneDeleteModal.zoneName}' and ${zoneDeleteModal.childElements.length} elements. This action cannot be undone.`}
        itemName={zoneDeleteModal.zoneName || undefined}
        itemType="zone"
        childElements={zoneDeleteModal.childElements}
      />

      <DeleteConfirmModal
        isOpen={elementDeleteModal.isOpen}
        onClose={handleCancelElementDelete}
        onConfirm={handleConfirmElementDelete}
        title={elementDeleteModal.isMultiDelete ? "Delete Elements" : "Delete Element"}
        message={elementDeleteModal.isMultiDelete
          ? `This will delete ${selectedElementIds.length} elements.`
          : `This will delete element '${elementDeleteModal.elementName}'.`}
        itemName={elementDeleteModal.isMultiDelete ? undefined : (elementDeleteModal.elementName || undefined)}
        itemType="element"
        childElements={[]}
      />

      {showAutoTbPreview ? (
        <Suspense fallback={<LazyModalFallback label="Opening thermal bridge suggestions..." />}>
          <AutoThermalBridgePreviewModal
            isOpen={showAutoTbPreview}
            onClose={() => setShowAutoTbPreview(false)}
            externalDetailCatalogue={externalDetailCatalogue}
          />
        </Suspense>
      ) : null}

      {/* Orthogonal Room Edit Modal */}
      {orthogonalRoomEditing && (
        <OrthogonalRoomEditModal
          isOpen={orthogonalRoomEditing.isOpen}
          roomElementIds={orthogonalRoomEditing.roomElementIds}
          initialWidth={orthogonalRoomEditing.width}
          initialHeight={orthogonalRoomEditing.height}
          initialX={orthogonalRoomEditing.x}
          initialY={orthogonalRoomEditing.y}
          cursorX={orthogonalRoomEditing.cursorX}
          cursorY={orthogonalRoomEditing.cursorY}
          onFinalize={() => {
            // Select all room elements
            if (orthogonalRoomEditing) {
              // Ensure we're on the correct floor (elements should already be on this floor from creation)
              const firstElement = elementsById[orthogonalRoomEditing.roomElementIds[0]];
              if (firstElement?.coordinates?.[0]?.z !== undefined) {
                const elementZ = firstElement.coordinates[0].z;
                setCurrentFloorZ(elementZ);
              }
              setSelectedElementIds(orthogonalRoomEditing.roomElementIds);
              setSelection(null); // Clear single selection to show multi-select panel
            }
            setOrthogonalRoomEditing(null);
          }}
          onCancel={() => {
            setOrthogonalRoomEditing(null);
          }}
        />
      )}

      {/* Deprecated legacy controls removed after migration */}
    </div>
  );

  // Always render via portal directly to body for full-screen
  if (typeof window !== 'undefined') {
    return ReactDOM.createPortal(canvasContent, document.body);
  }

  // Fallback for SSR (shouldn't happen in this app)
  return canvasContent;
};

export const GeometryCanvas: React.FC<GeometryCanvasProps> = (props) => {
  if (!ENABLE_GEOMETRY_CANVAS_REACT_PROFILER || !geometryPerf.isEnabled()) {
    return <GeometryCanvasInner {...props} />;
  }

  return (
    <React.Profiler id="GeometryCanvas.component" onRender={recordGeometryCanvasProfiler}>
      <GeometryCanvasInner {...props} />
    </React.Profiler>
  );
};
