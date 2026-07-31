// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../stores/geometryStore';
import { isPointInPolygon2D } from './pointInPolygon';

/**
 * Dwelling length / width (m) from a 2D ground-floor footprint, following Approved Document
 * style rules: compact footprints use a minimum-area enclosing rectangle; orthogonal L-shapes
 * with a single re-entrant corner use a centreline path along the two arms plus explicit branch
 * thickness for width. Other non-convex shapes fall back to the convex hull rectangle with a
 * warning — users should override when the automation does not match their assessment.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface Vec2 {
  x: number;
  y: number;
}

export type FootprintDimensionMode = 'convex_mbr' | 'orthogonal_l' | 'convex_hull_fallback';

export interface BuildingFootprintDimensions {
  lengthM: number;
  widthM: number;
  mode: FootprintDimensionMode;
  /** Present when the numeric result is a documented approximation or fallback. */
  warning?: string;
}

const EPS = 1e-6;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Signed area / 2; positive ⇒ vertices are CCW. */
function signedAreaTwice(pts: Vec2[]): number {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i]!.x * pts[j]!.y - pts[j]!.x * pts[i]!.y;
  }
  return s / 2;
}

/** Andrew's monotone chain; returns hull CCW without duplicate closing point. */
export function convexHull(points: Vec2[]): Vec2[] {
  const uniq: Vec2[] = [];
  const key = (p: Vec2) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`;
  const seen = new Set<string>();
  for (const p of points) {
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }
  if (uniq.length <= 1) return uniq.slice();

  uniq.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const lower: Vec2[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= EPS) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Vec2[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= EPS) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Minimum-area enclosing rectangle over hull edges (rotating calipers). */
export function minAreaEnclosingRectangle(hull: Vec2[]): { width: number; height: number } {
  if (hull.length === 0) return { width: 0, height: 0 };
  if (hull.length === 1) return { width: 0, height: 0 };
  if (hull.length === 2) {
    const d = dist(hull[0]!, hull[1]!);
    return { width: d, height: 0 };
  }

  let minArea = Infinity;
  let bestW = 0;
  let bestH = 0;
  const n = hull.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p0 = hull[i]!;
    const p1 = hull[j]!;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const elen = Math.hypot(dx, dy);
    if (elen < EPS) continue;
    const ux = dx / elen;
    const uy = dy / elen;
    const vx = -uy;
    const vy = ux;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = p.x * vx + p.y * vy;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (area < minArea - EPS) {
      minArea = area;
      bestW = w;
      bestH = h;
    }
  }

  const a = Math.max(bestW, bestH);
  const b = Math.min(bestW, bestH);
  return { width: b, height: a };
}

function isAxisAlignedEdge(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS;
}

/** True if every edge is horizontal or vertical. */
function isOrthogonalPolygon(pts: Vec2[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    if (!isAxisAlignedEdge(a, b)) return false;
  }
  return true;
}

/** CCW polygon: convex vertex has +ve cross for (prev, cur, next). Reflex ⇒ cross < 0. */
function reflexIndicesCCW(pts: Vec2[]): number[] {
  const n = pts.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const cr = cross(prev, cur, next);
    if (cr < -EPS) out.push(i);
  }
  return out;
}

/**
 * Axis-aligned L (6 verts, 1 reflex): centreline length + branch widths per guidance diagrams.
 * Width = longest branch thickness (short span of each arm). Length = broken axis path along
 * wall midlines through the inner corner between midpoints of the two exposed “cap” edges.
 */
function tryOrthogonalLShapeDimensions(ptsCCW: Vec2[]): { lengthM: number; widthM: number } | null {
  if (ptsCCW.length !== 6 || !isOrthogonalPolygon(ptsCCW)) return null;
  const reflex = reflexIndicesCCW(ptsCCW);
  if (reflex.length !== 1) return null;

  const xs = ptsCCW.map((p) => p.x);
  const ys = ptsCCW.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const inset = 0.2;
  /** Sample points just inside each bbox corner region (toward the footprint interior). */
  const cornerSamples: Vec2[] = [
    { x: minX + inset, y: minY + inset },
    { x: maxX - inset, y: minY + inset },
    { x: maxX - inset, y: maxY - inset },
    { x: minX + inset, y: maxY - inset },
  ];
  const inside = cornerSamples.map((c) => isPointInPolygon2D(c, ptsCCW));

  const ri = reflex[0]!;
  const R = ptsCCW[ri]!;

  /** Thickness of horizontal strip [minX,maxX]×[minY,yR] and vertical strip [minX,xR]×[yR,maxY]. */
  const hArmH = R.y - minY;
  const vArmW = R.x - minX;
  const hArmW = maxX - minX;
  const vArmH = maxY - R.y;

  const w1 = Math.min(hArmW, hArmH);
  const w2 = Math.min(vArmW, vArmH);
  const widthM = Math.max(w1, w2);

  const midBottom: Vec2 = { x: (minX + maxX) / 2, y: minY };
  const midTopBar: Vec2 = { x: (minX + R.x) / 2, y: maxY };
  const midLeft: Vec2 = { x: minX, y: (R.y + maxY) / 2 };

  let polyline: Vec2[];
  if (!inside[2] && inside[0] && inside[1] && inside[3]) {
    // Missing TR — matches guidance diagram: bottom bar + left bar
    polyline = [midBottom, { x: midBottom.x, y: R.y }, { x: midTopBar.x, y: R.y }, midTopBar];
  } else if (!inside[1] && inside[0] && inside[2] && inside[3]) {
    // Missing BR
    polyline = [
      { x: (minX + maxX) / 2, y: maxY },
      { x: (minX + maxX) / 2, y: R.y },
      { x: R.x, y: R.y },
      { x: R.x, y: minY },
    ];
  } else if (!inside[3] && inside[0] && inside[1] && inside[2]) {
    // Missing TL
    polyline = [
      { x: (R.x + maxX) / 2, y: minY },
      { x: R.x, y: minY },
      { x: R.x, y: R.y },
      { x: maxX, y: R.y },
      { x: maxX, y: (R.y + maxY) / 2 },
    ];
  } else if (!inside[0] && inside[1] && inside[2] && inside[3]) {
    // Missing BL
    polyline = [
      midLeft,
      { x: R.x, y: midLeft.y },
      { x: R.x, y: R.y },
      { x: maxX, y: R.y },
      { x: maxX, y: (minY + R.y) / 2 },
    ];
  } else {
    // Fallback: Manhattan tour between extreme midpoints
    polyline = [midBottom, { x: R.x, y: minY }, { x: R.x, y: maxY }, midLeft];
  }

  let len = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    len += dist(polyline[i]!, polyline[i + 1]!);
  }

  return { lengthM: len, widthM };
}

/**
 * Outer ring in CCW order (open ring — first point not repeated at end).
 */
export function buildingLengthWidthFromFootprintRing(outerRing: Vec2[]): BuildingFootprintDimensions {
  if (outerRing.length < 3) {
    return { lengthM: 0, widthM: 0, mode: 'convex_hull_fallback', warning: 'Footprint has fewer than 3 vertices.' };
  }

  const pts = outerRing.slice();
  if (signedAreaTwice(pts) < 0) {
    pts.reverse();
  }

  const lTry = tryOrthogonalLShapeDimensions(pts);
  if (lTry) {
    return {
      lengthM: round2(lTry.lengthM),
      widthM: round2(lTry.widthM),
      mode: 'orthogonal_l',
      warning:
        'Length and width are computed from the ground-floor footprint using L-shaped centreline and branch-thickness rules (Approved Document style). Verify against site measurements where the outline is ambiguous.',
    };
  }

  const hull = convexHull(pts);
  const mar = minAreaEnclosingRectangle(hull);
  const lengthM = round2(mar.height);
  const widthM = round2(mar.width);

  const convex = reflexIndicesCCW(pts).length === 0;
  if (convex) {
    return {
      lengthM,
      widthM,
      mode: 'convex_mbr',
      warning:
        'Length and width use the minimum-area rectangle around the footprint. Confirm for non-rectangular compact dwellings if your assessment requires the official bounding-box convention.',
    };
  }

  return {
    lengthM,
    widthM,
    mode: 'convex_hull_fallback',
    warning:
      'Complex or non-L footprint: using the minimum-area rectangle of the convex hull. Override manually if this does not match guidance for your plan shape.',
  };
}

/** Outer rings (CCW) for each `BuildingElementGround` polygon at the lowest ground Z. */
export function extractGroundFootprintOuterRings(elements: Element[]): Vec2[][] {
  const groundElements = elements.filter((el) => el.type === 'BuildingElementGround');
  if (groundElements.length === 0) return [];

  const minZ = Math.min(
    ...groundElements.map((el) => {
      const c = el.coordinates;
      if (!c || c.length === 0) return Infinity;
      return Math.min(...c.map((p) => p.z));
    }),
  );
  if (!Number.isFinite(minZ)) return [];

  const rings: Vec2[][] = [];
  for (const el of groundElements) {
    const coords = el.coordinates;
    if (!coords || coords.length < 3) continue;
    const elementMinZ = Math.min(...coords.map((c) => c.z));
    if (Math.abs(elementMinZ - minZ) >= 0.1) continue;
    rings.push(coords.map((c) => ({ x: c.x, y: c.y })));
  }
  return rings;
}

/**
 * Horizontal adjacent-conditioned-space polygons at the lowest such level.
 *
 * Flats may have no `BuildingElementGround`: their lowest bounding surface can
 * instead be an internal/party floor. Only near-horizontal polygons are valid
 * footprint candidates, so adjacent walls are deliberately excluded.
 */
export function extractAdjacentConditionedFootprintOuterRings(elements: Element[]): Vec2[][] {
  const horizontalElements = elements.filter((el) => {
    if (el.type !== 'BuildingElementAdjacentConditionedSpace') return false;
    const coords = el.coordinates;
    if (!coords || coords.length < 3) return false;
    const zValues = coords.map((point) => point.z);
    return Math.max(...zValues) - Math.min(...zValues) < 0.1;
  });
  if (horizontalElements.length === 0) return [];

  const minZ = Math.min(
    ...horizontalElements.map((el) => Math.min(...el.coordinates!.map((point) => point.z))),
  );

  return horizontalElements
    .filter((el) => {
      const elementMinZ = Math.min(...el.coordinates!.map((point) => point.z));
      return Math.abs(elementMinZ - minZ) < 0.1;
    })
    .map((el) => el.coordinates!.map((point) => ({ x: point.x, y: point.y })));
}

export function calculateDwellingLengthWidthFromGroundElements(
  elements: Element[],
): BuildingFootprintDimensions & { detail: string } {
  const groundRings = extractGroundFootprintOuterRings(elements);
  const usesFlatFallback = groundRings.length === 0;
  const rings = usesFlatFallback
    ? extractAdjacentConditionedFootprintOuterRings(elements)
    : groundRings;
  if (rings.length === 0) {
    return {
      lengthM: 0,
      widthM: 0,
      mode: 'convex_hull_fallback',
      detail:
        'No BuildingElementGround or horizontal BuildingElementAdjacentConditionedSpace polygons at the lowest level.',
      warning:
        'Draw ground or horizontal adjacent-conditioned-space footprint polygons to derive length and width.',
    };
  }
  if (rings.length === 1) {
    const r = buildingLengthWidthFromFootprintRing(rings[0]!);
    return {
      ...r,
      detail: usesFlatFallback
        ? 'Single horizontal adjacent-conditioned polygon (flat fallback)'
        : 'Single ground polygon',
    };
  }
  const merged: Vec2[] = [];
  for (const r of rings) merged.push(...r);
  const hull = convexHull(merged);
  const r = buildingLengthWidthFromFootprintRing(hull);
  return {
    ...r,
    mode: 'convex_hull_fallback',
    detail: `${rings.length} ${
      usesFlatFallback ? 'horizontal adjacent-conditioned' : 'ground'
    } polygons — vertices merged via convex hull.`,
    warning: `${r.warning ?? ''} Multiple separate ${
      usesFlatFallback ? 'horizontal adjacent-conditioned' : 'ground'
    } footprints: outline union is approximated; override manually if needed.`.trim(),
  };
}
