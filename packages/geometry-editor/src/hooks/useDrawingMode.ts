// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, useRef, useCallback } from 'react';
import { CANVAS_CONSTANTS } from '../lib/canvasConstants';
import type { ElementType } from '../stores/geometryStore';

export type DrawMode =
  | 'none'
  | 'line'
  | 'tb-plan-line'
  | 'tb-vertical-line'
  | 'tb-slope-line'
  | 'polygon'
  | 'space-label-polygon'
  | 'point'
  | 'room'
  | 'orthogonal-room'
  | 'sloped-polygon'
  | 'dormer';

export type OrthogonalRoomEditingState = {
  isOpen: boolean;
  roomElementIds: string[];
  width: number;
  height: number;
  x: number;
  y: number;
  cursorX: number;
  cursorY: number;
} | null;

export type PendingHostElementCreation = Readonly<{
  prefill?: Readonly<Record<string, unknown>>;
  onCreated?: (elementId: string) => void | Promise<void>;
}>;

export function useDrawingMode() {
  const [drawModeInternal, setDrawModeInternal] = useState<DrawMode>('none');
  const pendingHostElementCreationRef = useRef<PendingHostElementCreation | null>(null);

  const setDrawMode = useCallback((newMode: DrawMode) => {
    setDrawModeInternal(newMode);
    if (newMode === 'none') {
      pendingHostElementCreationRef.current = null;
    }
  }, []);

  const drawMode = drawModeInternal;

  const [drawElementType, setDrawElementType] = useState<ElementType>(CANVAS_CONSTANTS.DEFAULTS.DRAW_ELEMENT_TYPE);
  const [drawPoints, setDrawPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [drawCursor, setDrawCursor] = useState<{ x: number; y: number } | null>(null);
  const [drawAngleSnapped, setDrawAngleSnapped] = useState(false);
  const drawSnapTargetRef = useRef<{ x: number; y: number } | null>(null);

  const [roomWalls, setRoomWalls] = useState<Array<{ x: number; y: number }>>([]);
  const [roomWallElements, setRoomWallElements] = useState<string[]>([]);

  const [orthogonalRoomStart, setOrthogonalRoomStart] = useState<{ x: number; y: number } | null>(null);
  const [orthogonalRoomEnd, setOrthogonalRoomEnd] = useState<{ x: number; y: number } | null>(null);
  const [orthogonalRoomEditing, setOrthogonalRoomEditing] = useState<OrthogonalRoomEditingState>(null);

  // Element preset state – selected preset filename ('' = none) and its loaded data
  const [drawPreset, setDrawPreset] = useState<string>('');
  const [drawPresetData, setDrawPresetData] = useState<Record<string, any> | null>(null);

  const resetDrawing = useCallback(() => {
    setDrawModeInternal('none');
    pendingHostElementCreationRef.current = null;
    setDrawPoints([]);
    setDrawCursor(null);
    setDrawAngleSnapped(false);
    if (drawSnapTargetRef.current !== null) {
      drawSnapTargetRef.current = null;
    }
    setRoomWalls([]);
    setRoomWallElements([]);
    setOrthogonalRoomStart(null);
    setOrthogonalRoomEnd(null);
    setOrthogonalRoomEditing(null);
    setDrawPreset('');
    setDrawPresetData(null);
  }, []);

  return {
    drawMode,
    setDrawMode,
    drawElementType,
    setDrawElementType,
    drawPoints,
    setDrawPoints,
    drawCursor,
    setDrawCursor,
    drawAngleSnapped,
    setDrawAngleSnapped,
    drawSnapTargetRef,
    roomWalls,
    setRoomWalls,
    roomWallElements,
    setRoomWallElements,
    orthogonalRoomStart,
    setOrthogonalRoomStart,
    orthogonalRoomEnd,
    setOrthogonalRoomEnd,
    orthogonalRoomEditing,
    setOrthogonalRoomEditing,
    pendingHostElementCreationRef,
    drawPreset,
    setDrawPreset,
    drawPresetData,
    setDrawPresetData,
    resetDrawing,
  };
}
