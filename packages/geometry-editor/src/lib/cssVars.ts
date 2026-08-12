// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolve a CSS custom property from `:root`, following `var(--x[, fallback])` indirection
 * chains (using the fallback embedded in the chained value, then `fallback`) and returning
 * `fallback` when the property is empty/unset, forms a cycle (directly or transitively), or
 * resolves to a `color-mix()` expression that canvas/3D consumers (Konva, three.js) cannot use
 * as a literal colour.
 *
 * `seen` accumulates every custom-property name visited on the current resolution path, so a
 * genuine cycle (`--a: var(--b); --b: var(--a);`) is caught the moment it repeats — this is
 * deliberately unbounded-but-cycle-safe rather than depth-capped: a fixed recursion cap can hit
 * its limit mid-chain and return the literal, unresolved `var(--x)` string as though it were a
 * usable colour, which is worse than falling back.
 */
export function readRootCssVar(varName: string, fallback: string, seen = new Set<string>()): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  if (seen.has(varName)) return fallback;
  seen.add(varName);
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!value || value.includes('color-mix(')) return fallback;
  const varMatch = value.match(/^var\((--[^,\s)]+)(?:,\s*([^)]+))?\)$/);
  if (varMatch) return readRootCssVar(varMatch[1], varMatch[2]?.trim() || fallback, seen);
  return value;
}
