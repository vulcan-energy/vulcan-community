// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  roomFloorElementTypeForCanvasFloor,
  useMarqueeSelection,
  type UseMarqueeSelectionDeps,
} from '../useMarqueeSelection';

function renderOrthogonalRoom(currentFloorZ: number) {
  const createPlaceholderElement = vi.fn((_zoneId: string, elementType: string) => `${elementType}-id`);
  const updateElement = vi.fn();
  const deps: UseMarqueeSelectionDeps = {
    scale: 1,
    panOffset: { x: 0, y: 0 },
    canvasCenter: { x: 0, y: 0 },
    elementsById: {},
    elementIds: [],
    drawMode: 'orthogonal-room',
    setSelection: vi.fn(),
    setSelectedElementIds: vi.fn(),
    updateElement,
    currentFloorZ,
    floors: [{ id: `f${currentFloorZ}`, zIndex: currentFloorZ }],
    orthogonalRoomStart: { x: 0, y: 0 },
    orthogonalRoomEnd: { x: 4, y: 3 },
    setOrthogonalRoomStart: vi.fn(),
    setOrthogonalRoomEnd: vi.fn(),
    setOrthogonalRoomEditing: vi.fn(),
    createPlaceholderZone: vi.fn(() => 'new-zone'),
    createPlaceholderElement,
    drawElementType: 'BuildingElementOpaque',
    setDrawMode: vi.fn(),
    setCurrentFloorZ: vi.fn(),
    zones: [{ id: 'z1' }],
  };
  const { result } = renderHook(() => useMarqueeSelection(deps));
  const event = {
    target: {
      getStage: () => ({ getPointerPosition: () => ({ x: 20, y: 30 }) }),
    },
  };

  act(() => result.current.handleMarqueeEnd(event));
  return { createPlaceholderElement, updateElement };
}

describe('roomFloorElementTypeForCanvasFloor', () => {
  it('uses a walkable conditioned floor above ground and ground fabric at or below ground', () => {
    expect(roomFloorElementTypeForCanvasFloor(1)).toBe('BuildingElementAdjacentConditionedSpace');
    expect(roomFloorElementTypeForCanvasFloor(0)).toBe('BuildingElementGround');
    expect(roomFloorElementTypeForCanvasFloor(-1)).toBe('BuildingElementGround');
  });
});

describe('useMarqueeSelection orthogonal-room floor creation', () => {
  it('creates a pitch-180 conditioned floor on z=1', () => {
    const { createPlaceholderElement, updateElement } = renderOrthogonalRoom(1);

    expect(createPlaceholderElement).toHaveBeenLastCalledWith(
      'z1',
      'BuildingElementAdjacentConditionedSpace',
    );
    expect(updateElement).toHaveBeenLastCalledWith(
      'BuildingElementAdjacentConditionedSpace-id',
      expect.objectContaining({ pitch: 180 }),
    );
  });

  it('keeps BuildingElementGround on z=0', () => {
    const { createPlaceholderElement, updateElement } = renderOrthogonalRoom(0);

    expect(createPlaceholderElement).toHaveBeenLastCalledWith('z1', 'BuildingElementGround');
    expect(updateElement).toHaveBeenLastCalledWith(
      'BuildingElementGround-id',
      expect.not.objectContaining({ pitch: 180 }),
    );
  });
});
