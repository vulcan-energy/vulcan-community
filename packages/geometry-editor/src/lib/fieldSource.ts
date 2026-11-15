// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Helpers behind the one source treatment in components/FieldSource.tsx.

// ponytail: the Defaults tab is reached through any key its section owns; phase 3 renames the tab.
const DEFAULTS_TAB_FIELD = 'DefaultAssembly';

/** Opens Global Settings on the Defaults tab (the host listens for this event). */
export function openDefaultsTab(): void {
  window.dispatchEvent(new CustomEvent('open-global-settings', { detail: { field: DEFAULTS_TAB_FIELD } }));
}

/** Rounds for display only: at most three decimals, no trailing zeros. */
export function formatSourceValue(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** True when a stated number differs from its source. Blank follows the source. */
export function isOverridden(derived: number | null | undefined, current: number | '' | null | undefined, tolerance = 0.005): boolean {
  if (derived === null || derived === undefined || !Number.isFinite(derived)) return false;
  return typeof current === 'number' && Number.isFinite(current) && Math.abs(current - derived) > tolerance;
}
