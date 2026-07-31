// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { normalizeOrientation360Deg } from '../geometry/constants';

/**
 * Opening “outward” in model plan (+X east, +Y north) from a window/wall segment A→B.
 * Matches 2D direction arrows: fixed chirality from coordinate order (not `orientation360`).
 */
export function segmentTangentAndOpeningOutwardModelXY(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { tangent: [number, number]; openingOutward: [number, number] } {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;
  const openingOutward: [number, number] = [ty, -tx];
  return { tangent: [tx, ty], openingOutward };
}

function wrapOrientation360(deg: number): number {
  return normalizeOrientation360Deg(deg);
}

/**
 * Compass bearing of the outward normal implied by the directed first edge A→B.
 * Model plan uses +X east, +Y north. `globalOrientationOffset` is applied after
 * converting the geometric outward normal to compass degrees.
 */
export function orientation360FromSegmentOutwardModelXY(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  globalOrientationOffset = 0,
): number | null {
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return null;
  const { openingOutward } = segmentTangentAndOpeningOutwardModelXY(ax, ay, bx, by);
  const [outwardX, outwardY] = openingOutward;
  const bearing = (Math.atan2(outwardX, outwardY) * 180) / Math.PI;
  return wrapOrientation360(bearing + globalOrientationOffset);
}

/**
 * Plan `orientation360` for sloped PV / sloped roof polygons (first edge A→B = bottom edge).
 *
 * Same outward-facing convention as 2-point walls: compass azimuth of the horizontal
 * outward normal implied by the first edge A→B, then adjusted by the global north offset.
 */
export function orientation360SlopedFromFirstEdge(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  globalOrientationOffset = 0,
): number | null {
  const outward = orientation360FromSegmentOutwardModelXY(ax, ay, bx, by, 0);
  if (outward === null) return null;
  return wrapOrientation360(outward - globalOrientationOffset);
}

/** Shortest signed difference from `fromDeg` to `toDeg`, in [-180, 180]. */
export function shortestSignedCompassDeltaDeg(fromDeg: number, toDeg: number): number {
  let d = toDeg - fromDeg;
  d = ((d + 540) % 360) - 180;
  return d;
}

/**
 * Rotate every vertex in the XY plane around coords[0] by `deltaDegCCW` (counter‑clockwise
 * in model space: +X east, +Y north). Z is preserved.
 */
export function rotatePolygonPlanXYAroundFirstVertex(
  coords: Array<{ x: number; y: number; z: number }>,
  deltaDegCCW: number,
): Array<{ x: number; y: number; z: number }> {
  if (coords.length === 0) return coords;
  const ax = coords[0].x;
  const ay = coords[0].y;
  const rad = (deltaDegCCW * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return coords.map((p) => {
    const x = p.x - ax;
    const y = p.y - ay;
    return {
      x: ax + x * c - y * s,
      y: ay + x * s + y * c,
      z: p.z,
    };
  });
}

/**
 * Rigidly rotate a sloped PV/roof polygon in plan so the first-edge compass orientation
 * (see {@link orientation360SlopedFromFirstEdge}) matches `desiredOrientation360`.
 */
export function applyCompassOrientationToSlopedPolygonCoords(
  coords: Array<{ x: number; y: number; z: number }>,
  desiredOrientation360: number,
  globalOrientationOffset = 0,
): Array<{ x: number; y: number; z: number }> | null {
  if (coords.length < 2) return null;
  const A = coords[0];
  const B = coords[1];
  const current = orientation360SlopedFromFirstEdge(A.x, A.y, B.x, B.y, globalOrientationOffset);
  if (current === null) return null;
  // Positive plan rotation is counter-clockwise in model space, which reduces
  // compass bearing by the same amount. Convert desired compass change to the
  // equivalent model-space rotation by reversing the signed delta.
  const delta = shortestSignedCompassDeltaDeg(desiredOrientation360, current);
  return rotatePolygonPlanXYAroundFirstVertex(coords, delta);
}
