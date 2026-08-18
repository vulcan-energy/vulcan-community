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
  setSelection: (selection: Selection) => void;
  clearSelection: () => void;
}
export type GeometryStoreSlice = StateCreator<GeometryState, [], [], SelectionSlice>;

export const createSelectionSlice: GeometryStoreSlice = (set) => ({
  setSelection: (selection) => {
    set({ selection });
  },
  clearSelection: () => {
    set({ selection: null });
  },
});
