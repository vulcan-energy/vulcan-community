// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import {
  useGeometryStoreApi,
  type GeometryStoreApi,
} from '../stores/geometryStore';

/**
 * Debounce window between geometry-state changes and the next dirty check.
 * 150ms is short enough that the chip feels responsive after the user stops editing,
 * long enough that we skip recomputes during sustained typing or drag operations.
 */
export const GEOMETRY_DIRTY_RECHECK_DEBOUNCE_MS = 150;

/**
 * Runs one document refresh immediately, then coalesces geometry-store changes.
 * Callers put expensive CSV generation inside `refresh`, never in the Zustand
 * notification itself.
 */
export function subscribeToDebouncedGeometryChanges(
  store: GeometryStoreApi,
  refresh: () => void,
): () => void {
  refresh();

  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = store.subscribe(() => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, GEOMETRY_DIRTY_RECHECK_DEBOUNCE_MS);
  });

  return () => {
    unsubscribe();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      // An unmount must not discard the final coalesced change. This is the
      // only synchronous post-notification refresh; ordinary edits stay on
      // the debounced path.
      refresh();
    }
  };
}

/**
 * `true` when the in-memory geometry would round-trip to a different CSV than the one captured at the
 * last successful save or load. `false` when the model matches its on-disk baseline (or no baseline exists yet —
 * a brand-new draft reads as clean until the user edits it).
 *
 * Implementation note: runs `generateCSV()` and string-compares against `lastSavedCsv` after a debounce.
 * `generateCSV()` is non-trivial on large models; the debounce keeps it off the typing hot path.
 */
export function useGeometryDirty(): boolean {
  const store = useGeometryStoreApi();
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const recompute = () => {
      const state = store.getState();
      if (state.lastSavedCsv === null) {
        setIsDirty(false);
        return;
      }
      try {
        setIsDirty(state.generateCSV() !== state.lastSavedCsv);
      } catch (error) {
        // generateCSV fails loudly when elements reference missing zones; the
        // save flow surfaces that error to the user. For the dirty indicator,
        // an un-exportable model is by definition out of sync with its baseline.
        console.error('[useGeometryDirty] generateCSV failed during dirty check:', error);
        setIsDirty(true);
      }
    };

    return subscribeToDebouncedGeometryChanges(store, recompute);
  }, [store]);

  return isDirty;
}
