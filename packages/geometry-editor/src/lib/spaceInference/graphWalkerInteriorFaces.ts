// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Half-edge walk over refined planar linework, keeping the bounded-face orientation.
 */
import { refineWallSegments, type RawSeg } from './refineWallSegments';
import { signedShoelaceArea2 } from './signedArea';
import type { InferredPlanarFace, PlanarPoint2, WallSegment2D } from './types';

function absArea(ring: PlanarPoint2[]): number {
  return Math.abs(signedShoelaceArea2(ring));
}

function quantize(p: PlanarPoint2, eps: number): PlanarPoint2 {
  // Bias exact half-grid values onto one side so tiny floating-point differences
  // do not split a single T-junction into adjacent vertices, e.g. -1.1 and -1.2.
  const quant = (value: number) => Math.floor(value / eps + 0.5 + 1e-7) * eps;
  return {
    x: quant(p.x),
    y: quant(p.y),
  };
}

function vertexKey(p: PlanarPoint2, eps: number): string {
  const q = quantize(p, eps);
  return `${q.x.toFixed(8)},${q.y.toFixed(8)}`;
}

type HalfEdge = {
  origin: number;
  dest: number;
  twin: number;
  next: number;
};

function buildHalfEdges(segs: RawSeg[], eps: number): { verts: PlanarPoint2[]; hes: HalfEdge[] } {
  const keyToIndex = new Map<string, number>();
  const verts: PlanarPoint2[] = [];

  const getV = (p: PlanarPoint2): number => {
    const q = quantize(p, eps);
    const k = vertexKey(q, eps);
    let i = keyToIndex.get(k);
    if (i === undefined) {
      i = verts.length;
      verts.push(q);
      keyToIndex.set(k, i);
    }
    return i;
  };

  const hes: HalfEdge[] = [];
  const undirectedSeen = new Set<string>();

  const addEdge = (a: number, b: number): void => {
    const ha = hes.length;
    const hb = hes.length + 1;
    hes.push({ origin: a, dest: b, twin: hb, next: -1 });
    hes.push({ origin: b, dest: a, twin: ha, next: -1 });
  };

  for (const s of segs) {
    const ai = getV({ x: s.ax, y: s.ay });
    const bi = getV({ x: s.bx, y: s.by });
    if (ai === bi) continue;
    const uk = `${Math.min(ai, bi)}|${Math.max(ai, bi)}`;
    if (undirectedSeen.has(uk)) continue;
    undirectedSeen.add(uk);
    addEdge(ai, bi);
  }

  const byOrigin = new Map<number, number[]>();
  for (let hi = 0; hi < hes.length; hi++) {
    const h = hes[hi]!;
    const o = h.origin;
    if (!byOrigin.has(o)) byOrigin.set(o, []);
    byOrigin.get(o)!.push(hi);
  }

  for (const [, hiList] of byOrigin) {
    hiList.sort((ha, hb) => {
      const a = verts[hes[ha]!.dest]!;
      const b = verts[hes[hb]!.dest]!;
      const vo = verts[hes[ha]!.origin]!;
      return (
        Math.atan2(a.y - vo.y, a.x - vo.x) - Math.atan2(b.y - vo.y, b.x - vo.x)
      );
    });
    const n = hiList.length;
    for (let i = 0; i < n; i++) {
      const hi = hiList[i]!;
      const hNext = hiList[(i + 1) % n]!;
      // `hi.twin` enters this vertex; the next face edge must leave from here.
      hes[hes[hi]!.twin]!.next = hNext;
    }
  }

  return { verts, hes };
}

function walkFace(startHe: number, hes: HalfEdge[], verts: PlanarPoint2[]): PlanarPoint2[] | null {
  const ring: PlanarPoint2[] = [];
  let he = startHe;
  const guard = hes.length * 8;
  for (let step = 0; step < guard; step++) {
    const h = hes[he]!;
    if (h.next < 0) return null;
    ring.push({ ...verts[h.origin]! });
    he = h.next;
    if (he === startHe) break;
  }
  if (he !== startHe) return null;
  if (ring.length < 3) return null;
  return ring;
}

/** Faces from half-edge traversal; filter tiny / duplicates by area later. */
function enumerateFaces(hes: HalfEdge[], verts: PlanarPoint2[]): PlanarPoint2[][] {
  const rings: PlanarPoint2[][] = [];
  const used = new Set<number>();
  for (let hi = 0; hi < hes.length; hi++) {
    if (used.has(hi)) continue;
    const ring = walkFace(hi, hes, verts);
    if (!ring) continue;
    let e = hi;
    do {
      used.add(e);
      e = hes[e]!.next;
    } while (e !== hi);
    rings.push(ring);
  }
  return rings;
}

/**
 * Keep faces whose signed-area sign matches the majority across all enumerated rings.
 *
 * For each connected component of a planar subdivision the half-edge walk yields one
 * unbounded face (sign opposite to the bounded ones) and N >= 1 bounded faces. Across
 * a typical wall layout (single component, or several disjoint components) the bounded
 * orientation is therefore the more common sign — so a majority vote selects exactly
 * the rooms and discards the unbounded perimeter walks.
 */
function keepInteriorOrientationFaces(rings: PlanarPoint2[][]): PlanarPoint2[][] {
  if (!rings.length) return [];
  const withSign = rings.map((r) => ({ r, s: signedShoelaceArea2(r) }));
  const pos = withSign.filter((x) => x.s > 0).length;
  const neg = withSign.filter((x) => x.s < 0).length;
  const keepPos = pos >= neg;
  return withSign.filter((x) => (keepPos ? x.s > 0 : x.s < 0)).map((x) => x.r);
}

export function extractInteriorFacesGraphWalker(
  segments: WallSegment2D[],
  eps: number,
  minArea: number,
): InferredPlanarFace[] {
  const refined = refineWallSegments(segments, eps);
  if (!refined.length) return [];

  const { verts, hes } = buildHalfEdges(refined, eps);
  if (!hes.length) return [];

  const rings = keepInteriorOrientationFaces(enumerateFaces(hes, verts));

  const faces: InferredPlanarFace[] = [];
  for (const r of rings) {
    const a = absArea(r);
    if (a < minArea) continue;
    faces.push({
      exteriorRing: r,
      holeRings: [],
      areaM2: a,
    });
  }

  return faces;
}
