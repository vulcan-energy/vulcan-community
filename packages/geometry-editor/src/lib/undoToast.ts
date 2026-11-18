// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useSyncExternalStore } from 'react';
import type { GeometryStoreApi } from '../stores/geometryStore';
import type { HistoryEntry } from '../stores/geometryStore/slices/historySlice';

/**
 * The change the editor made for the user and can take back: its message and its undo step. The
 * step is the history entry itself, not its index: a full history keeps the index at its cap.
 */
type UndoToast = { message: string; step: HistoryEntry; store: GeometryStoreApi };

/** The history entry the document is at now. */
export const headStep = (state: { history: HistoryEntry[]; historyIndex: number }): HistoryEntry | undefined =>
  state.history[state.historyIndex];

let current: UndoToast | null = null;
const listeners = new Set<() => void>();
const publish = (next: UndoToast | null) => {
  current = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/**
 * Makes a change the user's edit implies (a shape conversion) as its own undo step and offers Undo
 * for it, in place of asking first. Edits still pending are sealed before it, so Undo returns to
 * exactly the state a refusal would have left. A change that changes nothing offers nothing.
 */
export function changeWithUndo(store: GeometryStoreApi, message: string, change: () => void): void {
  store.getState().saveToHistory(`before: ${message}`);
  const before = headStep(store.getState());
  change();
  store.getState().saveToHistory(message);
  const step = headStep(store.getState());
  if (step && step !== before) publish({ message, step, store });
}

/** Undoes the offered change while it is still the latest step; a later edit makes the offer stale. */
export function undoOfferedChange(): void {
  const toast = current;
  if (!toast) return;
  publish(null);
  // An edit still inside the capture window becomes its own step first, so it is never undone here.
  toast.store.getState().saveToHistory('auto');
  if (headStep(toast.store.getState()) === toast.step) toast.store.getState().undo();
}

export const dismissUndoToast = (): void => publish(null);

export function useUndoToast(): UndoToast | null {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
