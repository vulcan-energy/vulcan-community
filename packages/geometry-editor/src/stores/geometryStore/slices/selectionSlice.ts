// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { StateCreator } from 'zustand';
import type { GeometryState } from '../../geometryStore';

export type Selection = {
  type: 'zone' | 'element' | 'global' | 'dormer';
  id: string;
  isPlaceholder?: boolean;
  focusFieldKey?: string;
  /** Kept while "Edit all N windows" has every window of this one's kind selected: leaving that
   * multi-select (a click on empty canvas) comes back to this window. */
  editAll?: boolean;
} | null;

export interface SelectionSlice {
  /** The element the pointer is over on the canvas or in a list naming it: highlighted on the canvas. */
  hoveredElementId: string | null;
  setHoveredElementId: (id: string | null) => void;
  /** Elements a control is about to select (the inspector's "Select this part"): highlighted on the canvas as a selection is. */
  hoveredElementIds: readonly string[];
  setHoveredElementIds: (ids: readonly string[]) => void;
  /** The Context Shading part the pointer is over, in the Directions table or on the plan pill. */
  hoveredContextShadingPart: { elementId: string; index: number } | null;
  setHoveredContextShadingPart: (part: { elementId: string; index: number } | null) => void;
  setSelection: (selection: Selection) => void;
  clearSelection: () => void;
}
export type GeometryStoreSlice = StateCreator<GeometryState, [], [], SelectionSlice>;

export const createSelectionSlice: GeometryStoreSlice = (set) => ({
  hoveredElementId: null,
  setHoveredElementId: (hoveredElementId) => {
    set((state) => (state.hoveredElementId === hoveredElementId ? state : { hoveredElementId }));
  },
  hoveredElementIds: [],
  setHoveredElementIds: (hoveredElementIds) => {
    set((state) => (state.hoveredElementIds.length === 0 && hoveredElementIds.length === 0 ? state : { hoveredElementIds }));
  },
  hoveredContextShadingPart: null,
  setHoveredContextShadingPart: (part) => {
    set((state) => {
      const current = state.hoveredContextShadingPart;
      return current?.elementId === part?.elementId && current?.index === part?.index ? state : { hoveredContextShadingPart: part };
    });
  },
  setSelection: (selection) => {
    set({ selection });
  },
  clearSelection: () => {
    set({ selection: null });
  },
});
