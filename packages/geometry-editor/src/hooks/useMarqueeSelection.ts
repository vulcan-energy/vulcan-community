// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, useRef, useCallback, useEffect } from 'react';
import { segmentIntersectsRect, worldToCanvas, canvasToWorld } from '../lib/shapeUtils';
import type { Element } from '../stores/geometryStore';
import { clearVertexLengthPillPreview } from '../components/canvas/elementDragPreview';
import {
  beginCanvasInteraction,
  cancelCanvasInteraction,
  endCanvasInteraction,
  type CanvasInteractionSession,
} from '../components/canvas/canvasInteractionSession';
import {
  cancelVertexCanvasInteraction,
  endVertexCanvasInteraction,
  finalizeVertexDragFromState,
  getVertexDragState,
  setVertexDragState,
} from '../components/canvas/vertexDragSession';
import type { OrthogonalRoomEditingState } from './useDrawingMode';
import { isElementOnActiveCanvasFloor, type CanvasFloorListEntry } from '../lib/elementCanvasFloor';
import {
  createMarqueeSelectionSignal,
  type MarqueeSelectionPreview,
} from '../components/canvas/marqueeSelectionSignal';

export type MarqueeState = MarqueeSelectionPreview;

export interface UseMarqueeSelectionDeps {
  scale: number;
  panOffset: { x: number; y: number };
  canvasCenter: { x: number; y: number };
  elementsById: Record<string, Element>;
  elementIds: string[];
  drawMode: string;
  setSelection: (sel: any) => void;
  setSelectedElementIds: (ids: string[]) => void;
  updateElement: (id: string, updates: Partial<Element>, skipAutoSave?: boolean) => void;
  currentFloorZ: number;
  floors?: CanvasFloorListEntry[];
  overlayMoveMode?: boolean;
  overlayCalibrateMode?: boolean;
  orthogonalRoomStart: { x: number; y: number } | null;
  orthogonalRoomEnd: { x: number; y: number } | null;
  setOrthogonalRoomStart: (v: { x: number; y: number } | null) => void;
  setOrthogonalRoomEnd: (v: { x: number; y: number } | null) => void;
  setOrthogonalRoomEditing: (v: OrthogonalRoomEditingState) => void;
  createPlaceholderZone: () => string;
  createPlaceholderElement: (zoneId: string, elementType: any, name?: string) => string;
  drawElementType: string;
  setDrawMode: (mode: any) => void;
  setCurrentFloorZ: (z: number) => void;
  zones: Array<{ id: string }>;
  commitVertexPositionUpdates?: (updates: Array<{ elementId: string; vertexIndex: number; newPosition: { x: number; y: number; z: number } }>, skipAutoSave?: boolean) => void;
}

export function useMarqueeSelection(deps: UseMarqueeSelectionDeps) {
  const {
    scale,
    panOffset,
    canvasCenter,
    elementsById,
    drawMode,
    setSelection,
    setSelectedElementIds,
    updateElement,
    currentFloorZ,
    floors,
    overlayMoveMode = false,
    overlayCalibrateMode = false,
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
  } = deps;

  const [marqueeSelection, setMarqueeSelectionState] = useState<MarqueeState | null>(null);
  const marqueeSelectionRef = useRef<MarqueeState | null>(null);
  const [marqueePreviewSignal] = useState(createMarqueeSelectionSignal);
  const marqueeJustCompletedRef = useRef<boolean>(false);
  const marqueeInteractionRef = useRef<CanvasInteractionSession | null>(null);
  const setMarqueeSelection = useCallback((next: MarqueeState | null) => {
    const activeNext = next?.isActive ? next : null;
    marqueeSelectionRef.current = activeNext;
    setMarqueeSelectionState(activeNext);
    marqueePreviewSignal.set(activeNext);
  }, [marqueePreviewSignal]);
  const completeMarqueeInteraction = useCallback((commit: boolean) => {
    const session = marqueeInteractionRef.current;
    marqueeInteractionRef.current = null;
    if (!session) return;
    if (commit) {
      endCanvasInteraction(session, { committed: true });
    } else {
      cancelCanvasInteraction(session);
    }
  }, []);
  useEffect(() => () => {
    completeMarqueeInteraction(false);
  }, [completeMarqueeInteraction]);

  const handleMarqueeStart = useCallback(
    (e: any) => {
      if (overlayMoveMode || overlayCalibrateMode) return;

      if (drawMode === 'orthogonal-room') {
        const stage = e.target.getStage();
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const mouseWorld = canvasToWorld(pointer, scale, panOffset, canvasCenter);
        setOrthogonalRoomStart(mouseWorld);
        setOrthogonalRoomEnd(mouseWorld);
        return;
      }

      if (drawMode !== 'none') return;
      if (e.target !== e.target.getStage()) return;

      const stage = e.target.getStage();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const session = beginCanvasInteraction({
        kind: 'marquee',
        targetId: 'stage',
        preview: {
          mode: 'signalOnly',
          reset: () => {
            setMarqueeSelection(null);
          },
        },
      });
      if (!session) return;
      marqueeInteractionRef.current = session;

      setMarqueeSelection({
        isActive: true,
        startX: pointer.x,
        startY: pointer.y,
        endX: pointer.x,
        endY: pointer.y,
      });
    },
    [drawMode, scale, panOffset, canvasCenter, overlayMoveMode, overlayCalibrateMode, setOrthogonalRoomStart, setOrthogonalRoomEnd, setMarqueeSelection]
  );

  const handleMarqueeMove = useCallback(
    (e: any) => {
      if (drawMode === 'orthogonal-room' && orthogonalRoomStart) {
        const stage = e.target.getStage();
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const mouseWorld = canvasToWorld(pointer, scale, panOffset, canvasCenter);
        setOrthogonalRoomEnd(mouseWorld);
        return;
      }

      const activeMarquee = marqueeSelectionRef.current;
      if (!activeMarquee?.isActive) return;

      const stage = e.target.getStage();
      const pointer = stage.getPointerPosition();
      if (!pointer) {
        completeMarqueeInteraction(false);
        return;
      }

      const next = {
        ...activeMarquee,
        endX: pointer.x,
        endY: pointer.y,
      };
      marqueeSelectionRef.current = next;
      marqueePreviewSignal.set(next);
    },
    [drawMode, orthogonalRoomStart, scale, panOffset, canvasCenter, setOrthogonalRoomEnd, marqueePreviewSignal, completeMarqueeInteraction]
  );

  const handleMarqueeEnd = useCallback(
    (e: any) => {
      const vertexDragState = getVertexDragState();
      const vertexDragTarget = vertexDragState?.draggedNode;

      if (vertexDragState && commitVertexPositionUpdates) {
        finalizeVertexDragFromState(commitVertexPositionUpdates, () => clearVertexLengthPillPreview(vertexDragTarget));
        endVertexCanvasInteraction(vertexDragTarget, { committed: true });
      } else if (vertexDragState) {
        console.warn(
          '[VertexSnapMode] Fallback triggered but commitVertexPositionUpdates not available'
        );
        clearVertexLengthPillPreview(vertexDragTarget);
        setVertexDragState(null);
        cancelVertexCanvasInteraction(vertexDragTarget);
      }

      if (drawMode === 'orthogonal-room' && orthogonalRoomStart && orthogonalRoomEnd) {
        const start = orthogonalRoomStart;
        const end = orthogonalRoomEnd;
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);
        const width = maxX - minX;
        const height = maxY - minY;

        if (width >= 0.1 && height >= 0.1) {
          const elementZ = currentFloorZ;
          const targetZoneId = zones.length > 0 ? zones[0].id : createPlaceholderZone();

          const wallIds: string[] = [];
          const wallCoords = [
            [
              { x: minX, y: minY, z: elementZ },
              { x: maxX, y: minY, z: elementZ },
            ],
            [
              { x: maxX, y: minY, z: elementZ },
              { x: maxX, y: maxY, z: elementZ },
            ],
            [
              { x: maxX, y: maxY, z: elementZ },
              { x: minX, y: maxY, z: elementZ },
            ],
            [
              { x: minX, y: maxY, z: elementZ },
              { x: minX, y: minY, z: elementZ },
            ],
          ];

          wallCoords.forEach((coords) => {
            const wallId = createPlaceholderElement(targetZoneId, drawElementType);
            updateElement(wallId, { coordinates: coords });
            wallIds.push(wallId);
          });

          const floorId = createPlaceholderElement(targetZoneId, 'BuildingElementGround');
          const floorCoords = [
            { x: minX, y: minY, z: elementZ },
            { x: maxX, y: minY, z: elementZ },
            { x: maxX, y: maxY, z: elementZ },
            { x: minX, y: maxY, z: elementZ },
          ];
          updateElement(floorId, { coordinates: floorCoords });

          setCurrentFloorZ(elementZ);

          const stage = e.target.getStage();
          const pointer = stage.getPointerPosition();
          setOrthogonalRoomEditing({
            isOpen: true,
            roomElementIds: [...wallIds, floorId],
            width,
            height,
            x: minX,
            y: minY,
            cursorX: pointer?.x ?? window.innerWidth / 2,
            cursorY: pointer?.y ?? window.innerHeight / 2,
          });

          setOrthogonalRoomStart(null);
          setOrthogonalRoomEnd(null);
          setDrawMode('none');
        } else {
          setOrthogonalRoomStart(null);
          setOrthogonalRoomEnd(null);
          setDrawMode('none');
        }
        return;
      }

      const activeMarquee = marqueeSelectionRef.current;
      if (!activeMarquee?.isActive) return;

      const stage = e.target.getStage();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const minX = Math.min(activeMarquee.startX, pointer.x);
      const maxX = Math.max(activeMarquee.startX, pointer.x);
      const minY = Math.min(activeMarquee.startY, pointer.y);
      const maxY = Math.max(activeMarquee.startY, pointer.y);

      const elementsInMarquee = Object.values(elementsById).filter((element) => {
        if (!element.coordinates || !isElementOnActiveCanvasFloor(element, currentFloorZ, floors)) return false;

        const canvasCoords = element.coordinates.map((coord) =>
          worldToCanvas(coord, scale, panOffset, canvasCenter)
        );

        const hasVertexInside = canvasCoords.some(
          (coord) => coord.x >= minX && coord.x <= maxX && coord.y >= minY && coord.y <= maxY
        );
        if (hasVertexInside) return true;

        for (let i = 0; i < canvasCoords.length; i++) {
          const p1 = canvasCoords[i];
          const p2 = canvasCoords[(i + 1) % canvasCoords.length];
          if (segmentIntersectsRect(p1, p2, { minX, maxX, minY, maxY })) {
            return true;
          }
        }
        return false;
      });

      const elementIds = elementsInMarquee.map((el) => el.id);
      setSelectedElementIds(elementIds);
      marqueeJustCompletedRef.current = true;

      if (elementIds.length === 1) {
        const selectedElement = elementsInMarquee[0];
        const isGlobalObject = [
          'WaterPipework',
          'Appliance',
          'HotWaterDemand',
          'ContextShading',
          'Vents',
          'MechanicalVentilation',
          'CombustionAppliances',
          'System',
        ].includes(selectedElement.type);
        const selectionType = isGlobalObject ? 'global' : 'element';
        setSelection({ type: selectionType, id: selectedElement.id });
      } else {
        setSelection(null);
      }

      setMarqueeSelection(null);
      completeMarqueeInteraction(true);
    },
    [
      drawMode,
      orthogonalRoomStart,
      orthogonalRoomEnd,
      scale,
      panOffset,
      canvasCenter,
      currentFloorZ,
      floors,
      zones,
      createPlaceholderZone,
      drawElementType,
      updateElement,
      setDrawMode,
      setOrthogonalRoomStart,
      setOrthogonalRoomEnd,
      setOrthogonalRoomEditing,
      createPlaceholderElement,
      setCurrentFloorZ,
      setSelectedElementIds,
      setSelection,
      elementsById,
      commitVertexPositionUpdates,
      completeMarqueeInteraction,
      setMarqueeSelection,
    ]
  );

  return {
    marqueeSelection,
    setMarqueeSelection,
    marqueePreviewSignal,
    marqueeJustCompletedRef,
    handleMarqueeStart,
    handleMarqueeMove,
    handleMarqueeEnd,
  };
}
