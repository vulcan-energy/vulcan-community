// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../stores/geometryStore';

const MIN_EDGE_LEN = 1e-5;

export type PointXY = { x: number; y: number };

/**
 * All distinct neighbour positions (other ends of edges incident to B) for vertex drag,
 * in plan. Includes ring prev/next, other end of 2-pt line, and other elements sharing B (within tolerance).
 */
export function getIncidentNeighborPointsXY(
  element: Element,
  vertexIndex: number,
  b: PointXY,
  elementsById: Record<string, Element | undefined>,
  positionMatchTol: number,
): PointXY[] {
  const c = element.coordinates;
  if (!c || c.length < 2) return [];

  const out: PointXY[] = [];
  const addUnique = (p: PointXY) => {
    if (!out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-8)) {
      out.push({ x: p.x, y: p.y });
    }
  };

  const n = c.length;
  if (n === 2) {
    addUnique({ x: c[1 - vertexIndex].x, y: c[1 - vertexIndex].y });
  } else {
    const prevI = (vertexIndex - 1 + n) % n;
    const nextI = (vertexIndex + 1) % n;
    addUnique({ x: c[prevI].x, y: c[prevI].y });
    addUnique({ x: c[nextI].x, y: c[nextI].y });
  }

  for (const oid of Object.keys(elementsById)) {
    if (oid === element.id) continue;
    const o = elementsById[oid];
    if (!o?.coordinates) continue;
    for (let i = 0; i < o.coordinates.length; i++) {
      const pt = o.coordinates[i]!;
      if (Math.hypot(pt.x - b.x, pt.y - b.y) > positionMatchTol) continue;
      if (o.coordinates.length === 2) {
        const otherI = 1 - i;
        const q = o.coordinates[otherI]!;
        addUnique({ x: q.x, y: q.y });
      } else {
        const m = o.coordinates.length;
        const pI = (i - 1 + m) % m;
        const nI = (i + 1) % m;
        addUnique({ x: o.coordinates[pI]!.x, y: o.coordinates[pI]!.y });
        addUnique({ x: o.coordinates[nI]!.x, y: o.coordinates[nI]!.y });
      }
    }
  }

  return out;
}

/** Is segment B→A (plan) within angleTol of horizontal or vertical in world? */
function segmentAxisHV(
  a: PointXY,
  b: PointXY,
  angleTolDeg: number,
): 'H' | 'V' | null {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const len = Math.hypot(dx, dy);
  if (len < MIN_EDGE_LEN) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const norm = ((deg % 180) + 180) % 180;
  const dHoriz = Math.min(norm, 180 - norm);
  const dVert = Math.abs(norm - 90);
  if (dHoriz <= angleTolDeg) return 'H';
  if (dVert <= angleTolDeg) return 'V';
  return null;
}

/** Smaller interior angle 0..180 at B between (A-B) and (C-B) */
function smallerAngleAtB(b: PointXY, a: PointXY, c: PointXY): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < MIN_EDGE_LEN || lv < MIN_EDGE_LEN) return NaN;
  const cos = (ux * vx + uy * vy) / (lu * lv);
  const ang = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  return ang;
}

/**
 * If two axis-aligned meeting edges (plan) form ~90° at B, return the unique rect corner.
 */
function rectCornerForHVPair(
  b: PointXY,
  a: PointXY,
  c: PointXY,
  axisA: 'H' | 'V',
  axisC: 'H' | 'V',
): PointXY | null {
  if (axisA === axisC) return null;
  if (axisA === 'V' && axisC === 'H') {
    return { x: a.x, y: c.y };
  }
  if (axisA === 'H' && axisC === 'V') {
    return { x: c.x, y: a.y };
  }
  return null;
}

/**
 * If proposed vertex B and pair (A, C) give ~90° and both edges B–A, B–C are axis-aligned,
 * snap to the exact rect corner. Tries all neighbour pairs; picks candidate closest to `b`.
 * Returns null if nothing qualifies (interior angle not within `angleTolDeg` of 90, or not H+V, etc.)
 */
export function tryAxisAlignedRightAngleSnap(
  b: PointXY,
  neighborPoints: PointXY[],
  angleTolDeg: number,
): PointXY | null {
  if (neighborPoints.length < 2) return null;

  let best: PointXY | null = null;
  let bestD = Infinity;

  for (let i = 0; i < neighborPoints.length; i++) {
    for (let j = i + 1; j < neighborPoints.length; j++) {
      const a = neighborPoints[i]!;
      const c = neighborPoints[j]!;

      const intAngle = smallerAngleAtB(b, a, c);
      if (!Number.isFinite(intAngle) || Math.abs(intAngle - 90) > angleTolDeg) continue;

      const axisA = segmentAxisHV(a, b, angleTolDeg);
      const axisC = segmentAxisHV(c, b, angleTolDeg);
      if (axisA === null || axisC === null) continue;
      if (axisA === axisC) continue;

      const p = rectCornerForHVPair(b, a, c, axisA, axisC);
      if (!p) continue;

      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }

  return best;
}

/**
 * Convenience: neighbour discovery + right-angle snap.
 * `positionMatchTol` should be a few × snap_m so shared vertices on other elements are found during drag.
 */
export function tryAxisAlignedRightAngleSnapForVertex(
  b: PointXY,
  element: Element,
  vertexIndex: number,
  elementsById: Record<string, Element | undefined>,
  angleTolDeg: number,
  positionMatchTol: number,
): PointXY | null {
  const neighbors = getIncidentNeighborPointsXY(
    element,
    vertexIndex,
    b,
    elementsById,
    positionMatchTol,
  );
  if (neighbors.length < 2) return null;
  return tryAxisAlignedRightAngleSnap(b, neighbors, angleTolDeg);
}
