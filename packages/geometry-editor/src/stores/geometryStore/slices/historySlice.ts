// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { StateCreator } from 'zustand';
import { logGeometryHistory } from '../../../lib/geometryHistoryDebug';
import type { GeometryState } from '../../geometryStore';
import type { Floor } from '../../../geometry/types';
import { stripModelVersionRow } from '../../../geometry/io/geometryCsvCanonical';
import { recordProvenance, type ProvenanceSource, type ProvenanceTable } from '../../../lib/provenance';

/**
 * Debounce between geometry-state changes and the next dirty check. Short
 * enough that the chip feels responsive after the user stops editing.
 */
export const GEOMETRY_DIRTY_RECHECK_DEBOUNCE_MS = 150;

/**
 * Quiet window before a change becomes an undo step. Longer than the dirty
 * check so per-keystroke field commits coalesce into one step; the capture
 * reuses the text the dirty check already generated for the same state.
 */
export const HISTORY_CAPTURE_QUIET_MS = 300;

/**
 * One undo step: the document as Save would write it minus the `ModelVersion`
 * row, plus the floor list (Save does not persist empty floors). Entries
 * compare by `csv` only. The version is the base a shared-model push was made
 * from, not content: adopting it after a push is not a step, and undo keeps the
 * live version (`replaceDocumentFromCsv` never changes identity). The dirty
 * check still compares the full text with `lastSavedCsv`, which both carry the
 * row, so only history entries are stripped.
 */
export type HistoryEntry = {
  csv: string;
  floors: Floor[];
  currentFloorId: string | null;
  label: string;
  /**
   * The selection while the document was in this state; undo and redo restore it. A restore
   * re-parses the text, so an element comes back under the id its name matched, not always the
   * one it had: `selectedKeys` names each selected element (zone, type, name) to find it again.
   */
  selection: GeometryState['selection'];
  selectedElementIds: string[];
  selectedKeys: Record<string, string>;
};

const elementKey = (state: Pick<GeometryState, 'zones' | 'elementsById'>, id: string): string | undefined => {
  const element = state.elementsById[id];
  const zone = state.zones.find((candidate) => candidate.id === element?.zoneId);
  return element && `${zone?.name ?? ''}\u0000${element.type}\u0000${element.name}`;
};

/** The selection of `state` as a history entry keeps it. */
const entrySelection = (state: GeometryState): Pick<HistoryEntry, 'selection' | 'selectedElementIds' | 'selectedKeys'> => {
  const ids = state.selection ? [...state.selectedElementIds, state.selection.id] : state.selectedElementIds;
  const selectedKeys: Record<string, string> = {};
  for (const id of ids) {
    const key = elementKey(state, id);
    if (key) selectedKeys[id] = key;
  }
  return { selection: state.selection, selectedElementIds: state.selectedElementIds, selectedKeys };
};

/** The selection a state keeps: ids that no longer exist drop out. */
export function survivingSelection(state: Pick<GeometryState, 'selection' | 'selectedElementIds' | 'zones' | 'elementsById'>) {
  const sel = state.selection;
  const survives =
    !sel ||
    sel.type === 'global' ||
    sel.type === 'dormer' ||
    (sel.type === 'zone' ? state.zones.some((zone) => zone.id === sel.id) : sel.id in state.elementsById);
  return {
    selectedElementIds: state.selectedElementIds.filter((id) => id in state.elementsById),
    selection: survives ? sel : null,
  };
}

/**
 * Who a store write is for. `user` and `preset:<name>` are the user's gesture: they mark the model
 * dirty, become an undo step and record their source for each field they change (`provenance`).
 * `default` and `derived` are the editor's own fills and follow-ups: they neither dirty the model,
 * add a step nor record (see `writeAs`).
 */
export type WriteIntent = 'user' | 'default' | `preset:${string}` | 'derived';

export interface HistorySlice {
  /**
   * The recorded source of element fields the user or a preset changed, kept only where the value
   * cannot tell it. Ask it through `provenanceOf`; saved as the `Provenance` Metadata row.
   */
  provenance: ProvenanceTable;
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
  /**
   * Runs `write` as a write of `intent`. Store actions are user writes unless run here. A `default`
   * or `derived` write, unless nested in a user write, adds no undo step: it joins a pending user
   * step, or else the current one. A model that equalled its saved baseline stays clean: the
   * baseline moves with it. A write that changes nothing does nothing. Writes that `write`
   * schedules for later are not covered.
   */
  writeAs: <T>(intent: WriteIntent, write: () => T) => T;
  /**
   * The intent of the write in progress: `user` outside `writeAs` and document loads. A preset
   * write is the user's gesture and reports `user`.
   */
  writeIntent: () => WriteIntent;
  /**
   * Runs a document load or replace (open, undo, redo, a shared-model update) as a `derived`
   * write that sets its own baseline: nothing is folded or captured, and followers of user edits
   * (`writeIntent`) stay still.
   */
  asDocumentLoad: <T>(load: () => T) => T;
  /**
   * Runs a follower's writes inside the user edit that triggered them, as `derived`: they ride in
   * that edit's step and record no source. No export, so it costs nothing per edit. Only for code
   * that runs while the user's edit is being applied.
   */
  asEditFollowUp: <T>(write: () => T) => T;
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
  // The selection before the document edits now pending a step: it belongs to the step they leave.
  let selectionBeforeEdit: ReturnType<typeof entrySelection> | null = null;
  // Depth of the editor's own writes in progress; the change subscriber starts no capture during them.
  let systemWriteDepth = 0;
  let systemIntent: WriteIntent = 'user';
  // The source user writes record; a preset write names its preset.
  let recordSource: ProvenanceSource = 'user';
  const asSystem = <T>(intent: WriteIntent, run: () => T): T => {
    const outer = systemIntent;
    systemWriteDepth += 1;
    if (systemWriteDepth === 1) systemIntent = intent;
    try {
      return run();
    } finally {
      systemWriteDepth -= 1;
      systemIntent = outer;
    }
  };

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
      csv = stripModelVersionRow(getDocumentCsv());
    } catch (error) {
      // An un-exportable model cannot be a history step; the save flow reports why.
      logGeometryHistory('capture:skip-unexportable', { label, error: String(error) });
      return;
    }
    const state = get();
    const head = state.history[state.historyIndex];
    if (head?.csv === csv) {
      // Same document; an empty floor added or removed since still belongs to this step.
      selectionBeforeEdit = null;
      if (head.floors !== state.floors || head.selection !== state.selection || head.selectedElementIds !== state.selectedElementIds) {
        const history = state.history.slice();
        history[state.historyIndex] = { ...head, floors: state.floors, ...entrySelection(state) };
        setHistory({ history });
      }
      return;
    }
    const kept = state.history.slice(0, state.historyIndex + 1);
    if (head && selectionBeforeEdit) kept[state.historyIndex] = { ...head, ...selectionBeforeEdit };
    selectionBeforeEdit = null;
    const history = [
      ...kept,
      { csv, floors: state.floors, currentFloorId: state.currentFloorId, label, ...entrySelection(state) },
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
      state.replaceDocumentFromCsv(entry.csv, { currentFloorId: entry.currentFloorId, floors: entry.floors });
    } catch (error) {
      console.error('[GeometryHistory] could not restore history entry:', error);
      return;
    }
    const restored = get();
    // The id itself when it still names the same element (the usual case); else the id its key matched.
    let idByKey: Map<string | undefined, string> | null = null;
    const current = (id: string) => {
      const key = entry.selectedKeys[id];
      if (!key || elementKey(restored, id) === key) return id;
      idByKey ??= new Map(restored.elementIds.map((candidate) => [elementKey(restored, candidate), candidate]));
      return idByKey.get(key) ?? id;
    };
    // A step that had a selection brings it back; one that had none keeps what survives.
    set(survivingSelection(entry.selection || entry.selectedElementIds.length > 0 ? {
      ...restored,
      selection: entry.selection && { ...entry.selection, id: current(entry.selection.id) },
      selectedElementIds: entry.selectedElementIds.map(current),
    } : restored));
    // Restoring a step is not an edit: no capture is pending after it.
    if (captureTimer !== null) {
      clearTimeout(captureTimer);
      captureTimer = null;
    }
    // Store the text the editor now emits, so a round-trip difference is not
    // captured later as a new edit that discards the redo stack.
    let csv = entry.csv;
    try {
      csv = stripModelVersionRow(getDocumentCsv());
    } catch { /* keep the entry text */ }
    const history = state.history.slice();
    history[target] = { ...entry, csv, floors: get().floors };
    setHistory({
      history,
      historyIndex: target,
      canUndo: target > 0,
      canRedo: target < history.length - 1,
    });
    logGeometryHistory(index < 0 ? 'undo:applied' : 'redo:applied', { toIndex: target });
  };

  const tryDocumentCsv = (): string | null => {
    try {
      return getDocumentCsv();
    } catch {
      return null;
    }
  };

  const writeAs = <T>(intent: WriteIntent, write: () => T): T => {
    if (intent.startsWith('preset:') && systemWriteDepth === 0) {
      const outer = recordSource;
      recordSource = intent as ProvenanceSource;
      try {
        return write();
      } finally {
        recordSource = outer;
      }
    }
    if (intent === 'user' || systemWriteDepth > 0) return write();
    const previous = get();
    // ponytail: one export before every call (a cache hit when the dirty check ran since the
    // last change); a no-op write pays it too. Track clean state by identity if it shows.
    const before = tryDocumentCsv();
    const result = asSystem(intent, write);
    if (get() === previous) return result;
    const after = tryDocumentCsv();
    if (after === null || after === before) return result;
    const state = get();
    const partial: Partial<HistorySlice> & { lastSavedCsv?: string } = {};
    // A pending capture of a user edit takes the change into that step. Otherwise it joins the head
    // step, also when the pending capture follows a change that left the document as it was (a
    // selection): that capture then finds nothing new.
    const head = state.history[state.historyIndex];
    if (head && (captureTimer === null || (before !== null && stripModelVersionRow(before) === head.csv))) {
      const history = state.history.slice();
      history[state.historyIndex] = { ...head, csv: stripModelVersionRow(after), floors: state.floors };
      partial.history = history;
    }
    if (before !== null && before === state.lastSavedCsv) partial.lastSavedCsv = after;
    asSystem(intent, () => set(partial));
    documentCsvCache = { state: get(), csv: after };
    logGeometryHistory('write:absorbed', { intent, movedBaseline: partial.lastSavedCsv !== undefined });
    return result;
  };

  // Every user change records its fields' source and (re)starts the capture window.
  api.subscribe((state, previous) => {
    if (systemWriteDepth > 0 || isHistoryOnlyChange(state, previous)) return;
    if (state.elementsById !== previous.elementsById) {
      selectionBeforeEdit ??= entrySelection(previous);
      const provenance = recordProvenance(
        state.provenance,
        previous.elementsById,
        state.elementsById,
        recordSource,
        state.fieldSourceOf(),
      );
      if (provenance !== state.provenance) set({ provenance });
    }
    if (captureTimer !== null) clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
      captureTimer = null;
      capture('auto');
    }, HISTORY_CAPTURE_QUIET_MS);
  });

  return {
    provenance: {},
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
    writeAs,
    writeIntent: () => systemIntent,
    asDocumentLoad: (load) => asSystem('derived', load),
    asEditFollowUp: (write) => asSystem('derived', write),
  };
};
