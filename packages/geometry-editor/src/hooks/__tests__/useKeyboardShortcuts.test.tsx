// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Element } from '../../geometry/types';
import {
  useKeyboardShortcuts,
  type UseKeyboardShortcutsDeps,
} from '../useKeyboardShortcuts';

function buildDeps(overrides: Partial<UseKeyboardShortcutsDeps> = {}): UseKeyboardShortcutsDeps {
  return {
    setSelection: vi.fn(),
    clearElementSelection: vi.fn(),
    selectAllElementsOnCurrentFloor: vi.fn(),
    setMarqueeSelection: vi.fn(),
    drawMode: 'none',
    drawElementType: 'BuildingElementOpaque',
    setDrawMode: vi.fn(),
    setDrawPoints: vi.fn(),
    setDrawCursor: vi.fn(),
    setRoomWalls: vi.fn(),
    setRoomWallElements: vi.fn(),
    setOrthogonalRoomStart: vi.fn(),
    setOrthogonalRoomEnd: vi.fn(),
    resetDrawing: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    selection: null,
    selectedElementIds: [],
    elementsById: {},
    updateElement: vi.fn(),
    hoverPoint: null,
    setHoverPoint: vi.fn(),
    selectedVertex: null,
    setSelectedVertex: vi.fn(),
    setScale: vi.fn(),
    setPanOffset: vi.fn(),
    setZenMode: vi.fn(),
    setElementDeleteModal: vi.fn(),
    ...overrides,
  };
}

const press = (key: string) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('useKeyboardShortcuts global element selection', () => {
  it.each([
    'WaterPipework',
    'Appliance',
    'HotWaterDemand',
    'ContextShading',
    'MechanicalVentilation',
    'CombustionAppliances',
    'Vents',
    'MechanicalVentilationDuctwork',
    'MechanicalVentilationTerminal',
    'OnSiteGeneration',
    'ElectricBattery',
    'System',
  ])('opens delete confirmation for %s', (type) => {
    const setElementDeleteModal = vi.fn();
    const element = {
      id: `${type}-1`,
      name: type,
      type,
      coordinates: [{ x: 0, y: 0, z: 0 }],
    } as Element;

    renderHook(() =>
      useKeyboardShortcuts(buildDeps({
        selection: { type: 'global', id: element.id },
        elementsById: { [element.id]: element },
        setElementDeleteModal,
      })),
    );

    press('Delete');

    expect(setElementDeleteModal).toHaveBeenCalledWith({
      isOpen: true,
      elementId: element.id,
      elementName: element.name,
    });
  });

  it('inserts a vertex into selected Context Shading polygons', () => {
    const updateElement = vi.fn();
    const setHoverPoint = vi.fn();
    const element = {
      id: 'ContextShading-1',
      name: 'Context Shading',
      type: 'ContextShading',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 3, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
    } as Element;

    renderHook(() =>
      useKeyboardShortcuts(buildDeps({
        selection: { type: 'global', id: element.id },
        elementsById: { [element.id]: element },
        hoverPoint: { x: 2, y: 0, insertIndex: 1 },
        updateElement,
        setHoverPoint,
      })),
    );

    press('s');

    expect(updateElement).toHaveBeenCalledWith(element.id, {
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 3, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
    });
    expect(setHoverPoint).toHaveBeenCalledWith(null);
  });
});
