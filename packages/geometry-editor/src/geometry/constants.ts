// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Utility function for consistent 2 decimal place rounding
// Used to ensure numeric fields match ECaaS requirements and improve data quality
export const roundToTwoDecimals = (value: number): number => {
  return Math.round(value * 100) / 100;
};

/** Use where 2dp would zero small positives (e.g. suspended floor vent rate ~0.0015 m²/m). */
export const roundToFourDecimals = (value: number): number => {
  return Math.round(value * 10000) / 10000;
};

/**
 * When `extra_json.height_upper_surface` is unset on a suspended ground floor, ElementCreator
 * seeds this void height (m) so ISO 13370 suspended-floor U paths have a positive height.
 * JsonForms treats the same value as the schema default for status pills when defaults JSON omits it.
 */
export const SUSPENDED_GROUND_DEFAULT_HEIGHT_UPPER_SURFACE_M = 0.15;

/**
 * Compass degrees in [0, 360). JavaScript `%` keeps the sign of the dividend, so
 * `(angle + 360) % 360` can still be negative when the true angle is below −360°.
 */
export function normalizeOrientation360Deg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const n = deg % 360;
  return n < 0 ? n + 360 : n;
}

// Default neutral zone name suggestions.
export const ZONE_NAME_SUGGESTIONS = [
  'Zone 1',
  'Zone 2',
  'Zone 3',
  'Zone 4',
  'Zone 5',
  'Zone 6',
  'Zone 7',
  'Zone 8',
  'Zone 9',
  'Zone 10'
] as const;
