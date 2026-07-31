// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Opt-in console logging for geometry undo history (save / debounce / undo).
 * Enable in DevTools: localStorage.setItem('vulcan:debug-geometry-history', '1') then reload.
 * Disable: localStorage.removeItem('vulcan:debug-geometry-history')
 */
export const GEOMETRY_HISTORY_DEBUG_STORAGE_KEY = 'vulcan:debug-geometry-history';

const PREFIX = '[GeometryHistory]';

export function isGeometryHistoryDebugEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return false;
    }
    return localStorage.getItem(GEOMETRY_HISTORY_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function logGeometryHistory(phase: string, payload: Record<string, unknown>): void {
  if (!isGeometryHistoryDebugEnabled()) {
    return;
  }

  console.info(PREFIX, phase, { t: typeof performance !== 'undefined' ? performance.now() : 0, ...payload });
}
