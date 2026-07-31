// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * On-site PV panel footprint in plan: bottom edge (first two vertices) + upslope depth.
 * Reuses the same “bottom edge + slope” convention as sloped-polygon rendering.
 */

export const DEFAULT_PV_FOOTPRINT_M = { width: 1.722, height: 1.134 };

export function getPvFootprintDimensionsFromPreset(
  preset: Record<string, any> | null | undefined
): { longM: number; shortM: number } {
  const w =
    typeof preset?.width === 'number' && preset.width > 0
      ? preset.width
      : DEFAULT_PV_FOOTPRINT_M.width;
  const h =
    typeof preset?.height === 'number' && preset.height > 0
      ? preset.height
      : DEFAULT_PV_FOOTPRINT_M.height;
  return { longM: Math.max(w, h), shortM: Math.min(w, h) };
}

/**
 * Slope-corrected PV panel dimensions from a polygon footprint and panel pitch (degrees).
 *
 * Used as a fallback when the CSV doesn't carry explicit `width`/`height` columns
 * (older saves). The polygon is the plan-projection of the panel array; `width` is
 * the first drawn edge (lowest/eaves edge), and `height` is the upslope dimension
 * corrected from projected plan depth by pitch. Mirrored in the Rust merger
 * (`hem-batch-core/src/csv_pipeline/builder.rs::derive_pv_dimensions_from_coords`)
 * — keep both in sync.
 *
 * Returns null for degenerate polygons (<3 vertices, zero lowest edge or zero area).
 */
export function derivePvDimensionsFromCoords(
  coordinates: ReadonlyArray<{ x: number; y: number }> | undefined,
  pitchDegrees: number | undefined,
): { width: number; height: number } | null {
  if (!coordinates || coordinates.length < 3) return null;
  const a = coordinates[0];
  const b = coordinates[1];
  const width = Math.hypot(b.x - a.x, b.y - a.y);
  if (!Number.isFinite(width) || width <= 0) return null;

  let twiceArea = 0;
  for (let i = 0; i < coordinates.length; i++) {
    const current = coordinates[i];
    const next = coordinates[(i + 1) % coordinates.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  const planArea = Math.abs(twiceArea) / 2;
  if (!Number.isFinite(planArea) || planArea <= 0) return null;
  const projectedDepth = planArea / width;
  const pitch = typeof pitchDegrees === 'number' && Number.isFinite(pitchDegrees) ? pitchDegrees : 0;
  const cosPitch = Math.cos((pitch * Math.PI) / 180);
  const height = pitch > 0 && cosPitch > 1e-9 ? projectedDepth / cosPitch : projectedDepth;
  return { width, height };
}

export function readPvFootprintFlags(extra: Record<string, unknown> | undefined | null): {
  flipUpslope: boolean;
  bottomIsLong: boolean;
} {
  return {
    flipUpslope: !!(extra && extra._pv_footprint_flip === true),
    bottomIsLong: extra?._pv_bottom_is_long !== false,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toPvProjectedDepth(actualDepth: number, pitchDegrees: number | undefined): number {
  const pitch = typeof pitchDegrees === 'number' && Number.isFinite(pitchDegrees) ? pitchDegrees : 0;
  const cosPitch = Math.cos((pitch * Math.PI) / 180);
  return pitch > 0 && cosPitch > 1e-9 ? actualDepth * cosPitch : actualDepth;
}

/**
 * A = start of bottom edge; B_dir = second point (direction only).
 * Builds a closed quad: bottom edge along u with length bottomLen, then depth perpendicular.
 * `longM`/`shortM` are actual module/array dimensions; the upslope side is projected
 * into plan using `pitchDegrees`.
 */
export function buildPvPanelRectangleCoords(args: {
  A: { x: number; y: number };
  B_dir: { x: number; y: number };
  z: number;
  longM: number;
  shortM: number;
  flipUpslope: boolean;
  bottomIsLong: boolean;
  pitchDegrees?: number;
}): Array<{ x: number; y: number; z: number }> {
  const { A, B_dir, z, longM, shortM, flipUpslope, bottomIsLong, pitchDegrees } = args;
  const bottomLen = bottomIsLong ? longM : shortM;
  const actualDepth = bottomIsLong ? shortM : longM;
  const projectedDepth = toPvProjectedDepth(actualDepth, pitchDegrees);

  const dx = B_dir.x - A.x;
  const dy = B_dir.y - A.y;
  const len = Math.hypot(dx, dy);
  const ux = len < 1e-9 ? 1 : dx / len;
  const uy = len < 1e-9 ? 0 : dy / len;

  const B = { x: A.x + ux * bottomLen, y: A.y + uy * bottomLen, z };
  const vx0 = -uy;
  const vy0 = ux;
  const sx = flipUpslope ? -vx0 : vx0;
  const sy = flipUpslope ? -vy0 : vy0;

  const P0 = { x: round2(A.x), y: round2(A.y), z };
  const P1 = { x: round2(B.x), y: round2(B.y), z };
  const P2 = {
    x: round2(B.x + sx * projectedDepth),
    y: round2(B.y + sy * projectedDepth),
    z,
  };
  const P3 = {
    x: round2(A.x + sx * projectedDepth),
    y: round2(A.y + sy * projectedDepth),
    z,
  };
  return [P0, P1, P2, P3];
}

export function buildPvPanelRectangleCoordsFromDimensions(args: {
  A: { x: number; y: number };
  B_dir: { x: number; y: number };
  z: number;
  widthM: number;
  heightM: number;
  flipUpslope: boolean;
  pitchDegrees?: number;
}): Array<{ x: number; y: number; z: number }> {
  return buildPvPanelRectangleCoords({
    A: args.A,
    B_dir: args.B_dir,
    z: args.z,
    longM: args.widthM,
    shortM: args.heightM,
    flipUpslope: args.flipUpslope,
    bottomIsLong: true,
    pitchDegrees: args.pitchDegrees,
  });
}

/**
 * Rebuild rectangle from existing bottom edge endpoints (direction from A to B); uses physical lengths from flags.
 */
export function rebuildPvRectangleFromBottomEdge(
  A: { x: number; y: number; z: number },
  B: { x: number; y: number; z: number },
  longM: number,
  shortM: number,
  flipUpslope: boolean,
  bottomIsLong: boolean,
  pitchDegrees?: number,
): Array<{ x: number; y: number; z: number }> {
  return buildPvPanelRectangleCoords({
    A: { x: A.x, y: A.y },
    B_dir: { x: B.x, y: B.y },
    z: A.z,
    longM,
    shortM,
    flipUpslope,
    bottomIsLong,
    pitchDegrees,
  });
}

/**
 * Rebuild rectangle from existing bottom edge endpoints with explicit PV dimensions:
 * width is the low edge, height is the actual upslope dimension.
 */
export function rebuildPvRectangleFromBottomEdgeDimensions(
  A: { x: number; y: number; z: number },
  B: { x: number; y: number; z: number },
  widthM: number,
  heightM: number,
  flipUpslope: boolean,
  pitchDegrees?: number,
): Array<{ x: number; y: number; z: number }> {
  return buildPvPanelRectangleCoordsFromDimensions({
    A: { x: A.x, y: A.y },
    B_dir: { x: B.x, y: B.y },
    z: A.z,
    widthM,
    heightM,
    flipUpslope,
    pitchDegrees,
  });
}
