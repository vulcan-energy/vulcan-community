// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  useGeometryStore,
} from '../stores/geometryStore';

interface CompassRoseProps {
  headerAccessory?: React.ReactNode;
}

export const CompassRose: React.FC<CompassRoseProps> = ({ headerAccessory }) => {
  const dialRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const currentOffset = useGeometryStore((state) => state.globalOrientationOffset);
  const setGlobalOrientationOffset = useGeometryStore(
    (state) => state.setGlobalOrientationOffset,
  );
  const [inputValue, setInputValue] = useState(() => String(Math.round(currentOffset)));

  const syncOffset = useCallback((nextOffset: number) => {
    setInputValue(String(Math.round(nextOffset)));
  }, []);

  const updateOffsetFromPointer = useCallback((clientX: number, clientY: number) => {
    const dial = dialRef.current;
    if (!dial) return;

    const rect = dial.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const angle = Math.atan2(clientY - centerY, clientX - centerX);
    const nextOffset = (angle * 180 / Math.PI + 90 + 360) % 360;
    setGlobalOrientationOffset(nextOffset);
  }, [setGlobalOrientationOffset]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    updateOffsetFromPointer(e.clientX, e.clientY);
  }, [updateOffsetFromPointer]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleWindowMouseMove = (event: MouseEvent) => {
      updateOffsetFromPointer(event.clientX, event.clientY);
    };

    const handleWindowMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isDragging, updateOffsetFromPointer]);

  const commitInputValue = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed === '') {
      syncOffset(currentOffset);
      return;
    }
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) {
      syncOffset(currentOffset);
      return;
    }
    setGlobalOrientationOffset(parsed);
  }, [currentOffset, inputValue, setGlobalOrientationOffset, syncOffset]);

  const arrowColor = isDragging ? 'var(--accent-primary)' : 'var(--text-overlay-primary)';
  const cursorStyle = isDragging ? 'grabbing' : 'grab';

  return (
    <div className="compass-rose-control">
      <div className="compass-rose-header">
        <div
          className="controls-label compass-rose-title"
        >
          Compass
        </div>
        {headerAccessory ? (
          <div className="compass-rose-header-accessory">
            {headerAccessory}
          </div>
        ) : null}
      </div>
      <div
        ref={dialRef}
        data-testid="compass-rose-dial"
        className="compass-rose"
        style={{
          width: '84px',
          height: '84px',
          position: 'relative',
          cursor: cursorStyle,
          userSelect: 'none',
          borderRadius: '18px',
          background: 'var(--surface-control)',
          border: '1px solid var(--border-overlay)',
        }}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseUp}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: '12px',
            borderRadius: '999px',
            border: '1px solid var(--surface-control-active)',
            background: 'var(--surface-control)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `rotate(${currentOffset}deg)`,
            transformOrigin: 'center',
            pointerEvents: 'none',
          }}
        >
          {/* Arrow shaft */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: '4px',
              height: '26px',
              backgroundColor: arrowColor,
              transformOrigin: 'bottom center',
              transform: 'translate(-50%, -100%)',
              borderRadius: '999px'
            }}
          />

          {/* Arrow head */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: '0',
              height: '0',
              borderLeft: '10px solid transparent',
              borderRight: '10px solid transparent',
              borderBottom: `15px solid ${arrowColor}`,
              transformOrigin: 'bottom center',
              transform: 'translate(-50%, -100%)',
              marginTop: '-26px'
            }}
          />
        </div>

        <input
          aria-label="Global orientation offset"
          type="text"
          inputMode="decimal"
          value={isEditing ? inputValue : String(Math.round(currentOffset))}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={(e) => {
            syncOffset(currentOffset);
            setIsEditing(true);
            e.currentTarget.select();
          }}
          onBlur={() => {
            setIsEditing(false);
            commitInputValue();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              syncOffset(currentOffset);
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1,
            width: '50px',
            height: '50px',
            padding: '0',
            boxSizing: 'border-box',
            borderRadius: '999px',
            border: isEditing ? '1px solid var(--accent-primary)' : '1px solid transparent',
            background: isEditing ? 'var(--surface-control-hover)' : 'transparent',
            color: 'var(--text-overlay-primary)',
            fontSize: '14px',
            fontWeight: 500,
            lineHeight: '1',
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'center',
            cursor: 'text',
            outline: 'none',
            boxShadow: isEditing ? '0 0 0 2px var(--focus-outline)' : 'none',
            textShadow: 'none',
          }}
        />
      </div>
    </div>
  );
};
