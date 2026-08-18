// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { StateCreator } from 'zustand';
import { logGeometryHistory, isGeometryHistoryDebugEnabled } from '../../../lib/geometryHistoryDebug';
import {
  buildHistoryDocumentSnapshotFromState,
  historyDocumentSnapshotsContentEqual,
  type HistoryDocumentSnapshot,
} from '../../../lib/geometryHistorySnapshot';
import type { GeometryState } from '../../geometryStore';
import type { Element, Floor, SpaceLabel, Zone } from '../../../geometry/types';

export interface HistorySlice {
  history: Array<{
    elementsById: Record<string, Element>;
    elementIds: string[];
    zones: Zone[];
    floors: Floor[];
    floorIds: string[];
    currentFloorId: string | null;
    spaceLabelsById?: Record<string, SpaceLabel>;
    spaceLabelIds?: string[];
  }>;
  historyIndex: number;
  maxHistorySize: number;
  canUndo: boolean;
  canRedo: boolean;
  historyDebounceTimeout: NodeJS.Timeout | null;
  saveToHistory: (source?: string) => void;
  saveToHistoryDebounced: () => void;
  undo: () => void;
  redo: () => void;
}

export type GeometryStoreSlice = StateCreator<GeometryState, [], [], HistorySlice>;

/**
 * Stale `saveToHistoryDebounced` timers must not run after an immediate snapshot
 * or after undo/redo, or they re-append the current model and "undo" feels broken.
 */
const cancelPendingHistoryDebounce = (
  get: () => Pick<GeometryState, 'historyDebounceTimeout'>,
  set: (partial: Pick<GeometryState, 'historyDebounceTimeout'>) => void,
  reason: string,
) => {
  const timer = get().historyDebounceTimeout;
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  set({ historyDebounceTimeout: null });
  if (isGeometryHistoryDebugEnabled()) {
    logGeometryHistory('history:cancelPendingDebounce', { reason });
  }
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const jsonContentEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
};

const restoreArrayWithSharing = <T>(snapshotItems: unknown[] | undefined, currentItems: T[]): T[] => {
  const snapshotArray = snapshotItems ?? [];
  let allShared = snapshotArray.length === currentItems.length;
  const restored = snapshotArray.map((snapshotItem, index) => {
    const currentItem = currentItems[index];
    if (jsonContentEqual(snapshotItem, currentItem)) {
      return currentItem;
    }
    allShared = false;
    return cloneJson(snapshotItem) as T;
  });

  return allShared ? currentItems : restored;
};

const restoreStringArrayWithSharing = (
  snapshotItems: unknown[] | undefined,
  currentItems: string[],
): string[] => {
  const snapshotArray = snapshotItems ?? [];
  const same =
    snapshotArray.length === currentItems.length &&
    snapshotArray.every((item, index) => item === currentItems[index]);

  return same ? currentItems : snapshotArray.map(String);
};

const restoreRecordWithSharing = <T>(
  snapshotRecord: Record<string, unknown> | undefined,
  currentRecord: Record<string, T>,
): Record<string, T> => {
  const snapshot = snapshotRecord ?? {};
  const snapshotKeys = Object.keys(snapshot);
  const currentKeys = Object.keys(currentRecord);
  let allShared = snapshotKeys.length === currentKeys.length;
  const restored: Record<string, T> = {};

  for (const key of snapshotKeys) {
    const snapshotValue = snapshot[key];
    const currentValue = currentRecord[key];
    if (jsonContentEqual(snapshotValue, currentValue)) {
      restored[key] = currentValue;
    } else {
      allShared = false;
      restored[key] = cloneJson(snapshotValue) as T;
    }
  }

  return allShared ? currentRecord : restored;
};

const restoreHistoryDocumentSnapshot = (
  snapshot: HistoryDocumentSnapshot,
  current: Pick<
    GeometryState,
    | 'elementsById'
    | 'elementIds'
    | 'zones'
    | 'floors'
    | 'floorIds'
    | 'spaceLabelsById'
    | 'spaceLabelIds'
  >,
) => ({
  elementsById: restoreRecordWithSharing(snapshot.elementsById, current.elementsById) as GeometryState['elementsById'],
  elementIds: restoreStringArrayWithSharing(snapshot.elementIds, current.elementIds),
  zones: restoreArrayWithSharing(snapshot.zones, current.zones) as GeometryState['zones'],
  floors: restoreArrayWithSharing(snapshot.floors, current.floors) as GeometryState['floors'],
  floorIds: restoreStringArrayWithSharing(snapshot.floorIds, current.floorIds),
  currentFloorId: snapshot.currentFloorId || null,
  spaceLabelsById: restoreRecordWithSharing(
    snapshot.spaceLabelsById,
    current.spaceLabelsById,
  ) as GeometryState['spaceLabelsById'],
  spaceLabelIds: restoreStringArrayWithSharing(snapshot.spaceLabelIds, current.spaceLabelIds),
});

export const createHistorySlice: GeometryStoreSlice = (set, get) => ({
  history: [],
  historyIndex: -1,
  maxHistorySize: 50,
  canUndo: false,
  canRedo: false,
  historyDebounceTimeout: null as NodeJS.Timeout | null,
  saveToHistory: (source: string = 'unspecified') => {
    const hadPendingDebounceBefore = get().historyDebounceTimeout != null;
    cancelPendingHistoryDebounce(
      get,
      (partial) => set(partial),
      'immediate-snapshot',
    );
    const state = get();
    if (isGeometryHistoryDebugEnabled()) {
      logGeometryHistory('saveToHistory:before', {
        source,
        hadPendingDebounce: hadPendingDebounceBefore,
        historyIndex: state.historyIndex,
        historyLength: state.history.length,
      });
    }
    const snapshot = buildHistoryDocumentSnapshotFromState(state);

    if (state.historyIndex >= 0) {
      const head = state.history[state.historyIndex] as HistoryDocumentSnapshot | undefined;
      if (head && historyDocumentSnapshotsContentEqual(snapshot, head)) {
        if (isGeometryHistoryDebugEnabled()) {
          logGeometryHistory('saveToHistory:skip-duplicate-of-head', {
            source,
            historyIndex: state.historyIndex,
            historyLength: state.history.length,
          });
        }
        return;
      }
    }

    const newHistory = state.history.slice(0, state.historyIndex + 1);
    // Snapshot matches persisted history entry shape; HistoryDocumentSnapshot uses `unknown` for round-trip safety
    newHistory.push(snapshot as (typeof newHistory)[number]);

    if (newHistory.length > state.maxHistorySize) {
      newHistory.shift();
    }

    const newIndex = newHistory.length - 1;

    set({
      history: newHistory,
      historyIndex: newIndex,
      canUndo: newIndex > 0,
      canRedo: false
    });
    if (isGeometryHistoryDebugEnabled()) {
      const s = get();
      logGeometryHistory('saveToHistory:after', {
        source,
        historyIndex: s.historyIndex,
        historyLength: s.history.length,
        canUndo: s.canUndo,
      });
    }
  },
  saveToHistoryDebounced: () => {
    const state = get();
    const wasPending = state.historyDebounceTimeout != null;
    if (state.historyDebounceTimeout) {
      clearTimeout(state.historyDebounceTimeout);
    }
    if (isGeometryHistoryDebugEnabled()) {
      logGeometryHistory('saveToHistoryDebounced:schedule', {
        clearedPrevious: wasPending,
        delayMs: 300,
        historyIndex: state.historyIndex,
        historyLength: state.history.length,
        note: 'fired from updateElement / updateZone and similar; flush calls save("debounced-flush")',
      });
    }

    const timeout = setTimeout(() => {
      get().saveToHistory('debounced-flush');
      set({ historyDebounceTimeout: null });
    }, 300);

    set({ historyDebounceTimeout: timeout });
  },
  undo: () => {
    cancelPendingHistoryDebounce(get, (partial) => set(partial), 'undo');
    const state = get();
    if (isGeometryHistoryDebugEnabled()) {
      logGeometryHistory('undo:request', {
        fromIndex: state.historyIndex,
        historyLength: state.history.length,
        canUndo: state.canUndo,
      });
    }
    if (state.historyIndex > 0) {
      const newIndex = state.historyIndex - 1;
      const snapshot = state.history[newIndex] as HistoryDocumentSnapshot;
      const restored = restoreHistoryDocumentSnapshot(snapshot, state);

      set({
        ...restored,
        historyIndex: newIndex,
        canUndo: newIndex > 0,
        canRedo: true
      });
      if (isGeometryHistoryDebugEnabled()) {
        const s = get();
        logGeometryHistory('undo:applied', {
          toIndex: s.historyIndex,
          historyLength: s.history.length,
        });
      }
    }
  },
  redo: () => {
    cancelPendingHistoryDebounce(get, (partial) => set(partial), 'redo');
    const state = get();
    if (isGeometryHistoryDebugEnabled()) {
      logGeometryHistory('redo:request', {
        fromIndex: state.historyIndex,
        historyLength: state.history.length,
        canRedo: state.canRedo,
      });
    }
    if (state.historyIndex < state.history.length - 1) {
      const newIndex = state.historyIndex + 1;
      const snapshot = state.history[newIndex] as HistoryDocumentSnapshot;
      const restored = restoreHistoryDocumentSnapshot(snapshot, state);

      set({
        ...restored,
        historyIndex: newIndex,
        canUndo: true,
        canRedo: newIndex < state.history.length - 1
      });
      if (isGeometryHistoryDebugEnabled()) {
        const s = get();
        logGeometryHistory('redo:applied', {
          toIndex: s.historyIndex,
          historyLength: s.history.length,
        });
      }
    }
  },
});
