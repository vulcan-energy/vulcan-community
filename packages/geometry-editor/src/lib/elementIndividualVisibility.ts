// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

const STORAGE_PREFIX = 'hem:hiddenElementIds:v1:';

export function storageKeyForIndividualHidden(filename: string | undefined): string {
  const base = filename && filename.trim() ? filename.trim() : '__untitled__';
  const safe = encodeURIComponent(base).slice(0, 240);
  return `${STORAGE_PREFIX}${safe}`;
}

export function loadHiddenElementIds(storageKey: string): Set<string> {
  if (typeof localStorage === 'undefined') {
    return new Set();
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

export function saveHiddenElementIds(storageKey: string, ids: ReadonlySet<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify([...ids]));
  } catch {
    // ignore quota / private mode
  }
}
