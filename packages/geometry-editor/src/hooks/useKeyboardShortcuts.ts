// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import type { SpaceLabel, Element, ElementType } from '../geometry/types';
import { CANVAS_CONSTANTS } from '../lib/canvasConstants';
import { getDormerBundleAnchorElement, getDormerBundleName } from '../lib/dormerGeometry';
import type { DrawMode } from './useDrawingMode';
import { isServiceLineElementType } from '../lib/serviceLineDrawModes';
import {
  isCanvasKeydownTargetAFormControl,
  isGeometryHistoryKeyboardCombo,
  shouldReserveNativeTextUndoForGeometry,
} from '../lib/canvasGeometryKeyboardPolicy';
import { canDeleteVertexFromElement, getElementShape } from '../lib/shapeUtils';

/**
 * True if this key is one of the shape/draw-mode shortcuts (L/P/O/R/K/Q/J/V) for the
 * current draw element type. Used to blur property inputs and clear selection so the
 * shortcut runs on the canvas instead of in a focused field.
 */
function drawingTypeIncludes(types: readonly ElementType[], type: ElementType): boolean {
  return types.includes(type);
}

/** Draft state a shortcut clears when it switches mode. */
type DrawShortcutReset = 'points' | 'room' | 'orthogonal-room';

type DrawModeShortcut = {
  /** Lowercase keys that trigger it. */
  keys: readonly string[];
  /** The mode for this element type, or null when the type does not support it. */
  resolveMode: (drawElementType: ElementType) => DrawMode | null;
  reset: DrawShortcutReset;
};

/**
 * Single source of truth for the shape shortcuts. `isDrawModeShapeShortcutKey` (used to blur
 * property inputs so the key reaches the canvas) and the keydown handler both read this, so
 * they cannot disagree about which keys are live for an element type.
 *
 * `S` is deliberately absent: it means slope-line for service lines but split-polygon
 * otherwise, so it stays in the handler with its own branch.
 */
const DRAW_MODE_SHORTCUTS: readonly DrawModeShortcut[] = [
  {
    keys: ['l'],
    reset: 'points',
    resolveMode: (type) =>
      drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.LINE, type)
        ? (isServiceLineElementType(type) ? 'tb-plan-line' : 'line')
        : null,
  },
  {
    keys: ['v'],
    reset: 'points',
    resolveMode: (type) => (isServiceLineElementType(type) ? 'tb-vertical-line' : null),
  },
  {
    keys: ['p'],
    reset: 'points',
    resolveMode: (type) =>
      drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.POLYGON, type) ? 'polygon' : null,
  },
  {
    keys: ['o'],
    reset: 'points',
    resolveMode: (type) =>
      drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.POINT, type) ? 'point' : null,
  },
  {
    keys: ['r', 'k'],
    reset: 'room',
    resolveMode: (type) =>
      drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.ROOM, type) ? 'room' : null,
  },
  {
    keys: ['q'],
    reset: 'orthogonal-room',
    resolveMode: (type) =>
      drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.ROOM, type)
        ? 'orthogonal-room'
        : null,
  },
  {
    keys: ['j'],
    reset: 'points',
    resolveMode: (type) =>
      drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.SLOPED_POLYGON, type)
        ? 'sloped-polygon'
        : null,
  },
];

const NUDGE_M = 0.1;
const PAN_PX = 20;

/** Arrow deltas: model nudge when elements are selected, viewport pan otherwise. */
const ARROW_STEPS = {
  ArrowUp: { nudgeM: { x: 0, y: NUDGE_M }, panPx: { x: 0, y: PAN_PX } },
  ArrowDown: { nudgeM: { x: 0, y: -NUDGE_M }, panPx: { x: 0, y: -PAN_PX } },
  ArrowLeft: { nudgeM: { x: -NUDGE_M, y: 0 }, panPx: { x: PAN_PX, y: 0 } },
  ArrowRight: { nudgeM: { x: NUDGE_M, y: 0 }, panPx: { x: -PAN_PX, y: 0 } },
} as const;

function resolveDrawModeShortcut(
  key: string,
  drawElementType: ElementType,
): { mode: DrawMode; reset: DrawShortcutReset } | null {
  const lower = key.toLowerCase();
  for (const shortcut of DRAW_MODE_SHORTCUTS) {
    if (!shortcut.keys.includes(lower)) continue;
    const mode = shortcut.resolveMode(drawElementType);
    return mode ? { mode, reset: shortcut.reset } : null;
  }
  return null;
}

export function isDrawModeShapeShortcutKey(e: KeyboardEvent, drawElementType: ElementType): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key.length !== 1) return false;
  return resolveDrawModeShortcut(e.key, drawElementType) !== null;
}

export type Selection = { type: 'zone' | 'element' | 'global' | 'dormer'; id: string; isPlaceholder?: boolean } | null;

export interface ElementDeleteModalState {
  isOpen: boolean;
  elementId: string | null;
  elementName: string | null;
  isMultiDelete?: boolean;
}

export interface UseKeyboardShortcutsDeps {
  // Selection & multi-select
  setSelection: (selection: Selection) => void;
  clearElementSelection: () => void;
  selectAllElementsOnCurrentFloor: () => void;
  setMarqueeSelection: (value: { isActive: boolean; startX: number; startY: number; endX: number; endY: number } | null) => void;

  // Drawing mode
  drawMode: DrawMode;
  drawElementType: ElementType;
  setDrawMode: (mode: DrawMode) => void;
  setDrawPoints: (points: Array<{ x: number; y: number }> | ((prev: Array<{ x: number; y: number }>) => Array<{ x: number; y: number }>)) => void;
  setDrawCursor: (cursor: { x: number; y: number } | null) => void;
  setRoomWalls: (walls: Array<{ x: number; y: number }> | ((prev: Array<{ x: number; y: number }>) => Array<{ x: number; y: number }>)) => void;
  setRoomWallElements: (elements: string[] | ((prev: string[]) => string[])) => void;
  setOrthogonalRoomStart: (v: { x: number; y: number } | null) => void;
  setOrthogonalRoomEnd: (v: { x: number; y: number } | null) => void;
  resetDrawing: () => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Selection state
  selection: Selection;
  selectedElementIds: string[];
  elementsById: Record<string, Element>;
  updateElement: (id: string, updates: Partial<Element>, skipAutoSave?: boolean) => void;

  // Vertex / hover
  hoverPoint: { x: number; y: number; insertIndex: number } | null;
  setHoverPoint: (v: { x: number; y: number; insertIndex: number } | null) => void;
  selectedVertex: { elementId: string; vertexIndex: number } | null;
  setSelectedVertex: (v: { elementId: string; vertexIndex: number } | null) => void;
  selectedSpaceLabelId?: string | null;
  selectedSpaceLabelVertex?: { labelId: string; vertexIndex: number } | null;
  setSelectedSpaceLabelVertex?: (v: { labelId: string; vertexIndex: number } | null) => void;
  spaceLabelHoverPoint?: { x: number; y: number; insertIndex: number } | null;
  setSpaceLabelHoverPoint?: (v: { x: number; y: number; insertIndex: number } | null) => void;
  spaceLabelsById?: Record<string, SpaceLabel>;
  updateSpaceLabel?: (id: string, updates: Partial<Omit<SpaceLabel, 'id'>>) => void;

  // View
  setScale: (updater: (prev: number) => number) => void;
  setPanOffset: (updater: (prev: { x: number; y: number }) => { x: number; y: number }) => void;
  setZenMode: (value: boolean | ((prev: boolean) => boolean)) => void;

  // Modals
  setElementDeleteModal: (state: ElementDeleteModalState) => void;

  /** Pops the last point while drawing (e.g. polygon path or room wall). Return true if handled. */
  tryPopLastDrawPoint?: () => boolean;
  /** When true, L/P/O/… do not start fabric draw (e.g. Space Labeller is open). */
  fabricDrawShortcutsDisabled?: boolean;
}

/**
 * Registers window/document keyboard shortcuts for the geometry canvas:
 * - Escape: cancel drawing or clear selections
 * - Ctrl/Cmd+A: select all on current floor
 * - Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: undo/redo (also from numeric and select fields; text
 *   fields keep native text undo; see `canvasGeometryKeyboardPolicy` and `data-*` opt-outs)
 * - +/-: zoom
 * - Arrows: move selected elements or pan view
 * - S: split polygon at hover point
 * - Backspace/Delete: pop last point while drawing; with a selected polygon vertex, remove it;
 *   else open delete modal
 * - L, P, O, R/K, Q, J: draw mode shortcuts
 * - Service lines: L = plan line, V = vertical line, S = slope line (S otherwise splits ground)
 */
export function useKeyboardShortcuts(deps: UseKeyboardShortcutsDeps): void {
  const {
    setSelection,
    clearElementSelection,
    selectAllElementsOnCurrentFloor,
    setMarqueeSelection,
    drawMode,
    setDrawMode,
    setDrawPoints,
    setRoomWalls,
    setRoomWallElements,
    setOrthogonalRoomStart,
    setOrthogonalRoomEnd,
    resetDrawing,
    fabricDrawShortcutsDisabled,
  } = deps;

  // First effect: Escape + Ctrl+A (document)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isCanvasKeydownTargetAFormControl(event.target)) {
        return;
      }

      if (event.key === 'Escape') {
        if (drawMode !== 'none') {
          resetDrawing();
          return;
        }
        setSelection(null);
        clearElementSelection();
        setMarqueeSelection(null);
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'a') {
        event.preventDefault();
        selectAllElementsOnCurrentFloor();
        setSelection(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    setSelection,
    clearElementSelection,
    selectAllElementsOnCurrentFloor,
    setMarqueeSelection,
    drawMode,
    resetDrawing,
  ]);

  // Second effect: undo/redo, zoom, arrows, delete, draw mode shortcuts (window)
  const {
    undo,
    redo,
    canUndo,
    canRedo,
    selection,
    elementsById,
    updateElement,
    hoverPoint,
    selectedElementIds,
    selectedVertex,
    selectedSpaceLabelId,
    selectedSpaceLabelVertex,
    setSelectedSpaceLabelVertex,
    spaceLabelHoverPoint,
    setSpaceLabelHoverPoint,
    spaceLabelsById,
    drawElementType,
    setScale,
    setPanOffset,
    setZenMode,
    setElementDeleteModal,
    setHoverPoint,
    setSelectedVertex,
    updateSpaceLabel,
    tryPopLastDrawPoint,
  } = deps;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCanvasKeydownTargetAFormControl(e.target)) {
        if (isGeometryHistoryKeyboardCombo(e)) {
          if (shouldReserveNativeTextUndoForGeometry(e.target)) {
            return;
          }
          // else: fall through to geometry history handler below
        } else {
          return;
        }
      }

      /* Modals (e.g. thermal bridge junction editor) use the same keys; they mount first in DOM */
      if (typeof document !== 'undefined' && document.querySelector('[data-suppress-canvas-keyboard]')) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'z':
          case 'Z':
            e.preventDefault();
            if (e.shiftKey && canRedo) {
              redo();
            } else if (canUndo) {
              undo();
            }
            break;
          case 'y':
          case 'Y':
            e.preventDefault();
            if (canRedo) {
              redo();
            }
            break;
        }
      } else {
        switch (e.key) {
          case '+':
          case '=':
            e.preventDefault();
            setScale((prev) => Math.min(prev * 1.2, CANVAS_CONSTANTS.VIEW.MAX_SCALE));
            break;
          case '-':
            e.preventDefault();
            setScale((prev) => Math.max(prev / 1.2, CANVAS_CONSTANTS.VIEW.MIN_SCALE));
            break;
          case 'ArrowUp':
          case 'ArrowDown':
          case 'ArrowLeft':
          case 'ArrowRight': {
            e.preventDefault();
            // Model +Y maps to screen-up via modelToCanvas2D (canvas Y negated); nudge and pan
            // must both match that.
            const step = ARROW_STEPS[e.key as keyof typeof ARROW_STEPS];
            if (selectedElementIds.length > 0) {
              selectedElementIds.forEach((id) => {
                const element = elementsById[id];
                if (!element?.coordinates?.length) return;
                updateElement(element.id, {
                  coordinates: element.coordinates.map((coord) => ({
                    x: coord.x + step.nudgeM.x,
                    y: coord.y + step.nudgeM.y,
                    z: coord.z,
                  })),
                });
              });
            } else {
              setPanOffset((prev) => ({
                x: prev.x + step.panPx.x,
                y: prev.y + step.panPx.y,
              }));
            }
            break;
          }
          case 's':
          case 'S':
            e.preventDefault();
            if (fabricDrawShortcutsDisabled && isServiceLineElementType(drawElementType)) {
              break;
            }
            if (isServiceLineElementType(drawElementType)) {
              setDrawMode(drawMode === 'tb-slope-line' ? 'none' : 'tb-slope-line');
              setDrawPoints([]);
            } else if (selection?.type === 'element' && hoverPoint) {
              const element = elementsById[selection.id];
              if (element && getElementShape(element) === 'polygon' && element.coordinates && element.coordinates.length >= 3) {
                const newCoordinates = [...element.coordinates];
                newCoordinates.splice(hoverPoint.insertIndex, 0, {
                  x: hoverPoint.x,
                  y: hoverPoint.y,
                  z: element.coordinates[0].z,
                });
                updateElement(element.id, { coordinates: newCoordinates });
                setHoverPoint(null);
              }
            } else if (selectedSpaceLabelId && spaceLabelHoverPoint && spaceLabelsById && updateSpaceLabel) {
              const label = spaceLabelsById[selectedSpaceLabelId];
              if (label?.coordinates?.length >= 3) {
                const newCoordinates = [...label.coordinates];
                newCoordinates.splice(spaceLabelHoverPoint.insertIndex, 0, {
                  x: spaceLabelHoverPoint.x,
                  y: spaceLabelHoverPoint.y,
                  z: label.coordinates[0]?.z ?? 0,
                });
                updateSpaceLabel(label.id, { coordinates: newCoordinates });
                setSpaceLabelHoverPoint?.(null);
              }
            }
            break;
          case 'Delete':
          case 'Backspace':
            e.preventDefault();
            if (tryPopLastDrawPoint?.()) {
              break;
            }
            if (drawMode !== 'none') {
              break;
            }
            if (selectedVertex) {
              const element = elementsById[selectedVertex.elementId];
              if (element && canDeleteVertexFromElement(element)) {
                const newCoordinates = [...(element.coordinates as Array<{ x: number; y: number; z: number }>)];
                newCoordinates.splice(selectedVertex.vertexIndex, 1);
                updateElement(element.id, { coordinates: newCoordinates });
                setSelectedVertex(null);
              }
            } else if (selectedSpaceLabelVertex && spaceLabelsById && updateSpaceLabel) {
              const label = spaceLabelsById[selectedSpaceLabelVertex.labelId];
              if (label?.coordinates?.length > 3) {
                const newCoordinates = [...label.coordinates];
                newCoordinates.splice(selectedSpaceLabelVertex.vertexIndex, 1);
                updateSpaceLabel(label.id, { coordinates: newCoordinates });
                setSelectedSpaceLabelVertex?.(null);
              }
            } else {
              if (selection?.type === 'dormer') {
                const bundleName =
                  getDormerBundleName(getDormerBundleAnchorElement(elementsById, selection.id)) ?? 'Dormer';
                setElementDeleteModal({
                  isOpen: true,
                  elementId: selection.id,
                  elementName: bundleName,
                  isMultiDelete: true,
                });
              } else if (selectedElementIds && selectedElementIds.length > 1) {
                setElementDeleteModal({
                  isOpen: true,
                  elementId: null,
                  elementName: null,
                  isMultiDelete: true,
                });
              } else if (selection?.type === 'element') {
                setElementDeleteModal({
                  isOpen: true,
                  elementId: selection.id,
                  elementName: elementsById[selection.id]?.name || 'Unknown',
                });
              }
            }
            break;
          case 'z':
          case 'Z':
            e.preventDefault();
            setZenMode((prev) => !prev);
            break;
          default: {
            if (fabricDrawShortcutsDisabled) break;
            if (e.key.length !== 1) break;
            const shortcut = resolveDrawModeShortcut(e.key, drawElementType);
            if (!shortcut) break;
            e.preventDefault();
            setDrawMode(drawMode === shortcut.mode ? 'none' : shortcut.mode);
            setDrawPoints([]);
            if (shortcut.reset === 'room' || shortcut.reset === 'orthogonal-room') {
              setRoomWalls([]);
              setRoomWallElements([]);
            }
            if (shortcut.reset === 'orthogonal-room') {
              setOrthogonalRoomStart(null);
              setOrthogonalRoomEnd(null);
            }
            break;
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    undo,
    redo,
    canUndo,
    canRedo,
    selection,
    elementsById,
    updateElement,
    hoverPoint,
    selectedElementIds,
    selectedVertex,
    selectedSpaceLabelId,
    selectedSpaceLabelVertex,
    spaceLabelHoverPoint,
    spaceLabelsById,
    drawMode,
    drawElementType,
    setDrawMode,
    setDrawPoints,
    setRoomWalls,
    setRoomWallElements,
    setOrthogonalRoomStart,
    setOrthogonalRoomEnd,
    setScale,
    setPanOffset,
    setZenMode,
    setElementDeleteModal,
    setHoverPoint,
    setSelectedVertex,
    setSelectedSpaceLabelVertex,
    setSpaceLabelHoverPoint,
    updateSpaceLabel,
    tryPopLastDrawPoint,
    fabricDrawShortcutsDisabled,
  ]);
}
