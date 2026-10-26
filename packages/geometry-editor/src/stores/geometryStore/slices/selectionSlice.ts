// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { StateCreator } from 'zustand';
import type { GeometryState } from '../../geometryStore';

export type Selection = {
  type: 'zone' | 'element' | 'global' | 'dormer';
  id: string;
  isPlaceholder?: boolean;
  focusFieldKey?: string;
} | null;

export interface SelectionSlice {
  /** The element the pointer is over on the canvas or in a list naming it: highlighted on the canvas. */
  hoveredElementId: string | null;
  setHoveredElementId: (id: string | null) => void;
  setSelection: (selection: Selection) => void;
  clearSelection: () => void;
}
export type GeometryStoreSlice = StateCreator<GeometryState, [], [], SelectionSlice>;

export const createSelectionSlice: GeometryStoreSlice = (set) => ({
  hoveredElementId: null,
  setHoveredElementId: (hoveredElementId) => {
    set((state) => (state.hoveredElementId === hoveredElementId ? state : { hoveredElementId }));
  },
  setSelection: (selection) => {
    set({ selection });
  },
  clearSelection: () => {
    set({ selection: null });
  },
});
