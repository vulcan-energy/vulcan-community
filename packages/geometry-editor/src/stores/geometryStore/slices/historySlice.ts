// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { StateCreator } from 'zustand';
import { logGeometryHistory } from '../../../lib/geometryHistoryDebug';
import type { GeometryState } from '../../geometryStore';

/**
 * Debounce between geometry-state changes and the next document pass (history
 * capture and the dirty check). Short enough that the chip feels responsive
 * after the user stops editing, long enough to skip sustained typing or drags.
 */
export const GEOMETRY_DIRTY_RECHECK_DEBOUNCE_MS = 150;

/** One undo step: the document exactly as Save would write it. */
export type HistoryEntry = {
  csv: string;
  currentFloorId: string | null;
  label: string;
};

export interface HistorySlice {
  history: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * The canonical CSV of the current document (`generateCSV` with unresolved
   * migrations allowed), generated at most once per store state. Throws when
   * the model cannot be exported.
   */
  getDocumentCsv: () => string;
  /**
   * Pushes the current document when it differs from the history head.
   * History is captured automatically after every change, so callers only add
   * an immediate, labelled step.
   */
  saveToHistory: (source?: string) => void;
  /** No-op kept for callers; the automatic document pass covers it. */
  saveToHistoryDebounced: () => void;
  /** Internal: make the current document the only history entry (load, New Document). */
  seedHistory: (label: string, csv?: string) => void;
  undo: () => void;
  redo: () => void;
}

export type GeometryStoreSlice = StateCreator<GeometryState, [], [], HistorySlice>;

const HISTORY_KEYS = new Set<string>(['history', 'historyIndex', 'canUndo', 'canRedo']);

/** True when a store notification only moved history bookkeeping; the document is unchanged. */
export function isHistoryOnlyChange(state: GeometryState, previous: GeometryState): boolean {
  for (const key in state) {
    if (!HISTORY_KEYS.has(key) && state[key as keyof GeometryState] !== previous[key as keyof GeometryState]) return false;
  }
  return true;
}

export const createHistorySlice: GeometryStoreSlice = (set, get, api) => {
  // Keyed by state identity: any store change misses, history bookkeeping keeps it.
  let documentCsvCache: { state: GeometryState; csv: string } | null = null;
  let captureTimer: ReturnType<typeof setTimeout> | null = null;

  const getDocumentCsv = (): string => {
    const state = get();
    if (documentCsvCache?.state === state) return documentCsvCache.csv;
    const csv = state.generateCSV({ allowUnresolvedMigration: true });
    documentCsvCache = { state: get(), csv };
    return csv;
  };

  /** History-only writes leave the document unchanged, so the cached text stays valid. */
  const setHistory = (partial: Partial<HistorySlice>) => {
    const cached = documentCsvCache?.state === get() ? documentCsvCache : null;
    set(partial);
    if (cached) documentCsvCache = { state: get(), csv: cached.csv };
  };

  const capture = (label: string) => {
    if (captureTimer !== null) {
      clearTimeout(captureTimer);
      captureTimer = null;
    }
    let csv: string;
    try {
      csv = getDocumentCsv();
    } catch (error) {
      // An un-exportable model cannot be a history step; the save flow reports why.
      logGeometryHistory('capture:skip-unexportable', { label, error: String(error) });
      return;
    }
    const state = get();
    if (state.history[state.historyIndex]?.csv === csv) return;
    const history = [
      ...state.history.slice(0, state.historyIndex + 1),
      { csv, currentFloorId: state.currentFloorId, label },
    ].slice(-state.maxHistorySize);
    setHistory({
      history,
      historyIndex: history.length - 1,
      canUndo: history.length > 1,
      canRedo: false,
    });
    logGeometryHistory('capture:push', { label, historyIndex: history.length - 1 });
  };

  const goTo = (index: number) => {
    // An edit still inside the debounce window is a step of its own.
    capture('auto');
    const state = get();
    const target = state.historyIndex + index;
    const entry = state.history[target];
    if (!entry) return;
    try {
      state.replaceDocumentFromCsv(entry.csv, { currentFloorId: entry.currentFloorId });
    } catch (error) {
      console.error('[GeometryHistory] could not restore history entry:', error);
      return;
    }
    // Store the text the editor now emits, so a round-trip difference is not
    // captured later as a new edit that discards the redo stack.
    let csv = entry.csv;
    try {
      csv = getDocumentCsv();
    } catch { /* keep the entry text */ }
    const history = state.history.slice();
    history[target] = { ...entry, csv };
    setHistory({
      history,
      historyIndex: target,
      canUndo: target > 0,
      canRedo: target < history.length - 1,
    });
    logGeometryHistory(index < 0 ? 'undo:applied' : 'redo:applied', { toIndex: target });
  };

  // The one document pass: every store change schedules a capture.
  api.subscribe((state, previous) => {
    if (isHistoryOnlyChange(state, previous)) return;
    if (captureTimer !== null) clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
      captureTimer = null;
      capture('auto');
    }, GEOMETRY_DIRTY_RECHECK_DEBOUNCE_MS);
  });

  return {
    history: [],
    historyIndex: -1,
    maxHistorySize: 50,
    canUndo: false,
    canRedo: false,
    getDocumentCsv,
    // ponytail: saveToHistory call sites are now optional labels (capture is
    // automatic); delete them in a later pass.
    saveToHistory: (source = 'unspecified') => capture(source),
    saveToHistoryDebounced: () => {},
    seedHistory: (label, csv) => {
      if (captureTimer !== null) {
        clearTimeout(captureTimer);
        captureTimer = null;
      }
      if (csv !== undefined) documentCsvCache = { state: get(), csv };
      setHistory({ history: [], historyIndex: -1, canUndo: false, canRedo: false });
      capture(label);
    },
    undo: () => goTo(-1),
    redo: () => goTo(1),
  };
};
