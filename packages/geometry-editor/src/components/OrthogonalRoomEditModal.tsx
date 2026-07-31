// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useCallback, useRef } from 'react';
import { useGeometryStore } from '../stores/geometryStore';
import { StandardInput } from './StandardInput';
import './GlobalButtonSystem.css';
import './GeometryCanvas.css';
import { useKeyedState } from '../hooks/useKeyedState';

const formatToTwoDecimals = (value: number): string => value.toFixed(2);

interface OrthogonalRoomEditModalProps {
  isOpen: boolean;
  roomElementIds: string[];
  initialWidth: number;
  initialHeight: number;
  initialX: number;
  initialY: number;
  cursorX: number;
  cursorY: number;
  onFinalize: () => void;
  onCancel: () => void;
}

export const OrthogonalRoomEditModal: React.FC<OrthogonalRoomEditModalProps> = ({
  isOpen,
  roomElementIds,
  initialWidth,
  initialHeight,
  initialX,
  initialY,
  cursorX,
  cursorY,
  onFinalize,
  onCancel
}) => {
  const { elementsById, updateElement, finalizeRoom, removeElement } = useGeometryStore();
  const resetKey = [
    isOpen ? 'open' : 'closed',
    initialWidth,
    initialHeight,
    initialX,
    initialY,
    cursorX,
    cursorY,
  ].join('\0');
  const [width, setWidth] = useKeyedState(resetKey, formatToTwoDecimals(initialWidth));
  const [height, setHeight] = useKeyedState(resetKey, formatToTwoDecimals(initialHeight));
  const [x, setX] = useKeyedState(resetKey, formatToTwoDecimals(initialX));
  const [y, setY] = useKeyedState(resetKey, formatToTwoDecimals(initialY));
  const [hasUserEdited, setHasUserEdited] = useKeyedState(resetKey, false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useKeyedState(resetKey, { x: cursorX + 20, y: cursorY + 20 });

  // Adjust position to keep panel in viewport
  useEffect(() => {
    if (!isOpen || !panelRef.current) return;

    const panel = panelRef.current;
    const rect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = position.x;
    let adjustedY = position.y;

    // Adjust if panel goes off right edge
    if (rect.right > viewportWidth - 10) {
      adjustedX = cursorX - rect.width - 20;
    }

    // Adjust if panel goes off bottom edge
    if (rect.bottom > viewportHeight - 10) {
      adjustedY = cursorY - rect.height - 20;
    }

    // Ensure panel stays within viewport
    adjustedX = Math.max(10, Math.min(adjustedX, viewportWidth - rect.width - 10));
    adjustedY = Math.max(10, Math.min(adjustedY, viewportHeight - rect.height - 10));

    if (adjustedX !== position.x || adjustedY !== position.y) {
      setPosition({ x: adjustedX, y: adjustedY });
    }
  }, [isOpen, position.x, position.y, cursorX, cursorY, setPosition]);

  const updateRoomGeometry = useCallback(() => {
    const widthNum = parseFloat(width);
    const heightNum = parseFloat(height);
    const xNum = parseFloat(x);
    const yNum = parseFloat(y);

    if (isNaN(widthNum) || isNaN(heightNum) || isNaN(xNum) || isNaN(yNum)) {
      return false;
    }

    if (widthNum < 0.1 || heightNum < 0.1) {
      return false;
    }

    // Get the floor element (last in array)
    const floorId = roomElementIds[roomElementIds.length - 1];
    const wallIds = roomElementIds.slice(0, -1);
    const elementZ = elementsById[floorId]?.coordinates?.[0]?.z || 0;

    // Calculate new rectangle bounds
    const minX = xNum;
    const maxX = xNum + widthNum;
    const minY = yNum;
    const maxY = yNum + heightNum;

    // Update floor polygon
    const floorCoords = [
      { x: minX, y: minY, z: elementZ },
      { x: maxX, y: minY, z: elementZ },
      { x: maxX, y: maxY, z: elementZ },
      { x: minX, y: maxY, z: elementZ }
    ];
    updateElement(floorId, { coordinates: floorCoords });

    // Update 4 wall segments
    const wallCoords = [
      [{ x: minX, y: minY, z: elementZ }, { x: maxX, y: minY, z: elementZ }], // Top
      [{ x: maxX, y: minY, z: elementZ }, { x: maxX, y: maxY, z: elementZ }], // Right
      [{ x: maxX, y: maxY, z: elementZ }, { x: minX, y: maxY, z: elementZ }], // Bottom
      [{ x: minX, y: maxY, z: elementZ }, { x: minX, y: minY, z: elementZ }]  // Left
    ];

    wallIds.forEach((wallId, i) => {
      updateElement(wallId, { coordinates: wallCoords[i] });
    });

    return true;
  }, [width, height, x, y, roomElementIds, elementsById, updateElement]);

  const handleFinalize = useCallback(() => {
    if (!hasUserEdited) {
      finalizeRoom(roomElementIds);
      onFinalize();
      return;
    }

    if (updateRoomGeometry()) {
      finalizeRoom(roomElementIds);
      onFinalize();
    }
  }, [hasUserEdited, updateRoomGeometry, finalizeRoom, roomElementIds, onFinalize]);

  const handleCancel = useCallback(() => {
    // Delete all placeholder elements
    roomElementIds.forEach(id => {
      const element = elementsById[id] as (typeof elementsById)[string] & { isPlaceholder?: boolean } | undefined;
      if (element?.isPlaceholder) {
        removeElement(id);
      }
    });
    onCancel();
  }, [roomElementIds, elementsById, removeElement, onCancel]);

  // Keyboard handlers - Enter to finalize, Escape to cancel
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Only handle Enter if not in an input field (to allow normal input editing)
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          handleFinalize();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleFinalize, handleCancel]);

  // Update geometry on input change (live preview)
  useEffect(() => {
    if (!isOpen || !hasUserEdited) return;
    const timer = setTimeout(() => {
      updateRoomGeometry();
    }, 100); // Debounce updates
    return () => clearTimeout(timer);
  }, [isOpen, hasUserEdited, width, height, x, y, updateRoomGeometry]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop - invisible overlay to catch outside clicks */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          pointerEvents: 'auto'
        }}
        onClick={handleCancel}
      />
      <div
        ref={panelRef}
        className="glass-panel"
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          padding: '12px',
          minWidth: '200px',
          zIndex: 10000,
          pointerEvents: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 8px', alignItems: 'center' }}>
          <label style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.8)' }}>W:</label>
          <StandardInput
            type="number"
            value={width}
            onChange={(e) => {
              setHasUserEdited(true);
              setWidth(e.target.value);
            }}
            step="0.01"
            variant="ghost"
            size="sm"
            placeholder="0.00"
            autoFocus
            style={{ width: '100%' }}
          />
          <label style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.8)' }}>H:</label>
          <StandardInput
            type="number"
            value={height}
            onChange={(e) => {
              setHasUserEdited(true);
              setHeight(e.target.value);
            }}
            step="0.01"
            variant="ghost"
            size="sm"
            placeholder="0.00"
            style={{ width: '100%' }}
          />
          <label style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.8)' }}>X:</label>
          <StandardInput
            type="number"
            value={x}
            onChange={(e) => {
              setHasUserEdited(true);
              setX(e.target.value);
            }}
            step="0.01"
            variant="ghost"
            size="sm"
            placeholder="0.00"
            style={{ width: '100%' }}
          />
          <label style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.8)' }}>Y:</label>
          <StandardInput
            type="number"
            value={y}
            onChange={(e) => {
              setHasUserEdited(true);
              setY(e.target.value);
            }}
            step="0.01"
            variant="ghost"
            size="sm"
            placeholder="0.00"
            style={{ width: '100%' }}
          />
        </div>
      </div>
      </div>
    </>
  );
};
