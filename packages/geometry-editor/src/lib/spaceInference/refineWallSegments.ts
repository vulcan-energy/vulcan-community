// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { PlanarPoint2, WallSegment2D } from './types';

const MIN_SEG_LEN2 = 1e-12;

function hypotSq(dx: number, dy: number): number {
  return dx * dx + dy * dy;
}

function near(a: PlanarPoint2, b: PlanarPoint2, eps: number): boolean {
  return hypotSq(a.x - b.x, a.y - b.y) <= eps * eps;
}

export type RawSeg = { ax: number; ay: number; bx: number; by: number };

/** Canonical direction so collinear merge groups opposite wall draws together. */
function orientRawSeg(s: RawSeg): RawSeg {
  const { ax, ay, bx, by } = s;
  if (bx > ax + 1e-12) return s;
  if (bx < ax - 1e-12) return { ax: bx, ay: by, bx: ax, by: ay };
  if (by > ay + 1e-12) return s;
  if (by < ay - 1e-12) return { ax: bx, ay: by, bx: ax, by: ay };
  return s;
}

function segDir(ax: number, ay: number, bx: number, by: number): { dx: number; dy: number; L2: number } {
  const dx = bx - ax;
  const dy = by - ay;
  return { dx, dy, L2: dx * dx + dy * dy };
}

function pointOnClosedSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
  eps: number,
): boolean {
  const { dx, dy, L2 } = segDir(ax, ay, bx, by);
  if (L2 < MIN_SEG_LEN2) return hypotSq(px - ax, py - ay) <= eps * eps;
  const t = ((px - ax) * dx + (py - ay) * dy) / L2;
  if (t < -eps || t > 1 + eps) return false;
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return hypotSq(px - qx, py - qy) <= eps * eps;
}

/** Proper + endpoint intersections; returns unique points. */
function segmentIntersectionPoints(s1: RawSeg, s2: RawSeg, eps: number): PlanarPoint2[] {
  const { ax, ay, bx, by } = s1;
  const { ax: cx, ay: cy, bx: dx, by: dy } = s2;
  const out: PlanarPoint2[] = [];

  const rpx = bx - ax;
  const rpy = by - ay;
  const spx = dx - cx;
  const spy = dy - cy;
  const denom = rpx * spy - rpy * spx;

  const dedupeEps = Math.min(1e-4, eps * 1e-4);
  const pushPt = (p: PlanarPoint2) => {
    if (!out.some((q) => near(q, p, dedupeEps))) out.push(p);
  };

  const ends1: PlanarPoint2[] = [
    { x: ax, y: ay },
    { x: bx, y: by },
  ];
  const ends2: PlanarPoint2[] = [
    { x: cx, y: cy },
    { x: dx, y: dy },
  ];
  for (const p of ends1) {
    if (pointOnClosedSegment(cx, cy, dx, dy, p.x, p.y, eps)) pushPt(p);
  }
  for (const p of ends2) {
    if (pointOnClosedSegment(ax, ay, bx, by, p.x, p.y, eps)) pushPt(p);
  }

  if (Math.abs(denom) < 1e-12) {
    return out;
  }

  const qx = cx - ax;
  const qy = cy - ay;
  const t = (qx * spy - qy * spx) / denom;
  const u = (qx * rpy - qy * rpx) / denom;
  if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
    pushPt({ x: ax + t * rpx, y: ay + t * rpy });
  }
  return out;
}

function collectSplitParams(ax: number, ay: number, bx: number, by: number, points: PlanarPoint2[], eps: number): number[] {
  const { dx, dy, L2 } = segDir(ax, ay, bx, by);
  if (L2 < MIN_SEG_LEN2) return [];
  const segLen = Math.sqrt(L2);
  const ts: number[] = [0, 1];
  for (const p of points) {
    if (!pointOnClosedSegment(ax, ay, bx, by, p.x, p.y, eps)) continue;
    const t = ((p.x - ax) * dx + (p.y - ay) * dy) / L2;
    if (!Number.isFinite(t)) continue;
    ts.push(Math.min(1, Math.max(0, t)));
  }
  ts.sort((a, b) => a - b);
  const merged: number[] = [];
  const minArcDistToMergeM = Math.min(1e-4, eps * 1e-3);
  for (const t of ts) {
    const prev = merged[merged.length - 1];
    const arcDist = merged.length ? Math.abs(t - prev) * segLen : Infinity;
    const terminalT = t <= 1e-9 || t >= 1 - 1e-9;
    if (!merged.length || terminalT || arcDist > minArcDistToMergeM) merged.push(t);
  }
  return merged;
}

/**
 * Split wall segments at pairwise intersections and T-junctions (ε-tolerant).
 * Output feeds UnaryUnion + Polygonizer — not a separate face-walking algorithm.
 */
export function refineWallSegments(raw: WallSegment2D[], eps: number): RawSeg[] {
  const n = raw.length;
  const base: RawSeg[] = raw.map((s) =>
    orientRawSeg({ ax: s.a.x, ay: s.a.y, bx: s.b.x, by: s.b.y }),
  );
  const refined: RawSeg[] = [];

  for (let i = 0; i < n; i++) {
    const s = base[i];
    const pts: PlanarPoint2[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      for (const p of segmentIntersectionPoints(s, base[j], eps)) {
        pts.push(p);
      }
    }
    const ts = collectSplitParams(s.ax, s.ay, s.bx, s.by, pts, eps * 0.5);
    const { dx, dy, L2 } = segDir(s.ax, s.ay, s.bx, s.by);
    if (L2 < MIN_SEG_LEN2) continue;
    const segLen = Math.sqrt(L2);
    for (let k = 0; k < ts.length - 1; k++) {
      const t0 = ts[k];
      const t1 = ts[k + 1];
      if ((t1 - t0) * segLen <= eps * 1e-3) continue;
      const p0 = { x: s.ax + t0 * dx, y: s.ay + t0 * dy };
      const p1 = { x: s.ax + t1 * dx, y: s.ay + t1 * dy };
      refined.push({ ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y });
    }
  }

  return refined;
}
