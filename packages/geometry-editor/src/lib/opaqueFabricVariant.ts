// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Classifies {@link BuildingElementOpaque} defaults / elements for template and UI default lookup.
 * Matches {@link hem-batch-core} CSV merge rules: external door first, then roof pitch band, else wall.
 */
export type OpaqueFabricVariant = 'external_door' | 'roof' | 'wall';

const WALL_DEG = 90;
const FLOOR_DEG = 180;
const EPS = 1e-3;

/** Same band as hem-batch-core `pitch_degrees_matches_roof_variant`. */
export function pitchDegreesMatchesRoofVariant(deg: number): boolean {
  if (!Number.isFinite(deg)) return false;
  if (Math.abs(deg - WALL_DEG) < EPS || Math.abs(deg - FLOOR_DEG) < EPS) return false;
  return deg >= -EPS && deg <= 180 + EPS;
}

/** Align with hem-batch-core `json_truthy_external_door`. */
export function truthyIsExternalDoor(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') {
    const u = value.trim().toUpperCase();
    return u === 'TRUE' || u === '1' || u === 'YES';
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  return false;
}

export function valueAsPitchDegrees(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Uses explicit `pitch` / `is_external_door` (e.g. defaults template nodes).
 */
export function classifyOpaqueFabricVariant(el: {
  pitch?: unknown;
  is_external_door?: unknown;
}): OpaqueFabricVariant {
  if (truthyIsExternalDoor(el.is_external_door)) return 'external_door';
  const p = valueAsPitchDegrees(el.pitch);
  if (p !== undefined && pitchDegreesMatchesRoofVariant(p)) return 'roof';
  return 'wall';
}

/**
 * Classify from element / store shape. `pitch` and `is_external_door` are read from top-level
 * fields only (CSV columns), never from `extra_json`.
 */
export function classifyOpaqueFabricVariantFromElement(el: Record<string, unknown>): OpaqueFabricVariant {
  return classifyOpaqueFabricVariant({
    pitch: el.pitch,
    is_external_door: el.is_external_door,
  });
}
