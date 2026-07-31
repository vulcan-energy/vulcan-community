// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * External-corner thermal bridge proposals (E16 convex / E17 re-entrant) from **opaque wall
 * intersections in plan** (one zone at a time).
 *
 * ## SAP / BRE alignment (E16 vs E17)
 *
 * **E16** = convex (salient) external corner in plan; **E17** = re-entrant (reflex) plan corner
 * (e.g. bay). Classification matches **standard simple-polygon** vertex types: CCW boundary with
 * interior on the **left**, **left turn** ⇒ convex footprint vertex (E16), **right turn** ⇒ reflex
 * (E17). See BRE S10TP-05 / SAP conventions on junction locations — same geometric meaning as a
 * closed-loop walk; we no longer require a single closed 2-regular graph.
 *
 * ## Rules (implementation)
 *
 * 1. **Vertex merge:** Endpoints closer than `MERGE_VERTEX_XY_M` (3cm) share one node so CSV
 *    micro-gaps (e.g. −4.940 vs −4.920) do not break chains.
 * 2. **Degree-2 vertices:** Choose **A→V→B** vs **B→V→A** by **maximizing** alignment of `orientation360`
 *    outward normals with geometric “exterior to the right” of each directed edge (`orientationAlignmentDot`).
 *    Tie-break with centroid **interior** (left of both edges). No user-facing orientation notes.
 * 3. **Simple path / cycle:** When the graph is a **single open chain** (two degree-1 nodes) or a
 *    **single cycle** (all degree 2), walk it once and classify each turn — same formula as before,
 *    robust to party-wall gaps (open chain).
 * 4. **Degree ≥ 3 (e.g. T-junction):** Not auto-classified — angularly consecutive rays are not
 *    necessarily consecutive along the real façade trace; assessor-added or future boundary walk.
 * 5. **Degree 1:** End of an open chain only — no corner at a lone stub endpoint unless paired
 *    (handled by path walk interior nodes only).
 *
 * **`orientation360`:** Compass bearing of the **external surface normal** in plan
 * `(sin θ, cos θ)` (+Y north, +X east). Used to **resolve** trace direction at degree-2 nodes when
 * two orders are possible. **E16/E17** still come only from **plan turn geometry** (cross product).
 *
 * Limitations: `location === 'internal'` walls excluded; pitched opaque “walls” (`pitch !== 90`)
 * excluded. Party-wall **elements** are not in this set — junctions with party construction are
 * typically **E18**, not E16/E17 (assessor may add separately).
 *
 * **Vertical extent:** Each corner TB spans the **vertical overlap** of the two incident external
 * walls (`max(zBase)` → `min(zBase+height)`). Zone storey height is not used — differing wall heights
 * clip the line to the shared range.
 */

import { isRoofLikeOpaqueElement } from '../../lib/roofElement';
import type { BuildingElementOpaque, Element } from '../types';
import { roundToTwoDecimals } from '../constants';
import type { FacadeOpeningEdgeRole, FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from './proposeFacadeOpenings';

function wallBaseElevationM(w: BuildingElementOpaque): number {
  const coords = w.coordinates;
  const z0 = typeof coords[0]?.z === 'number' && Number.isFinite(coords[0].z) ? coords[0].z : 0;
  const z1 = typeof coords[1]?.z === 'number' && Number.isFinite(coords[1].z) ? coords[1].z : 0;
  const bh = w.base_height;
  if (typeof bh === 'number' && Number.isFinite(bh)) return bh;
  return Math.min(z0, z1);
}

const KEY_PRECISION = 1e4;

/** Merge endpoints within this distance (m) so minor CSV numeric drift still forms one corner node. */
export const MERGE_VERTEX_XY_M = 0.03;

function clusterKeyRaw(x: number, y: number): string {
  const qx = Math.round(x * KEY_PRECISION) / KEY_PRECISION;
  const qy = Math.round(y * KEY_PRECISION) / KEY_PRECISION;
  return `${qx},${qy}`;
}

const MIN_WALL_LEN_XY_M = 0.05;
const MIN_CORNER_VERTICAL_OVERLAP_M = 0.05;

interface WallSeg {
  id: string;
  name: string;
  zoneId: string | undefined;
  k0: string;
  k1: string;
  zBase: number;
  height: number;
  orientation360?: number;
  pitch?: number;
}

/** Exported for wall–floor continuous TB pass; same predicate as corner graph (external vertical line walls). */
export function isExternalLineWall(el: Element): el is BuildingElementOpaque {
  if (el.type !== 'BuildingElementOpaque') return false;
  if (el.isPlaceholder) return false;
  if (isRoofLikeOpaqueElement(el)) return false;
  const w = el;
  const coords = w.coordinates;
  if (!coords || coords.length !== 2) return false;
  const pitch = w.pitch;
  if (typeof pitch === 'number' && Number.isFinite(pitch) && pitch !== 90) return false;
  const loc = (w as { location?: string }).location;
  if (loc === 'internal') return false;
  const dx = coords[1].x - coords[0].x;
  const dy = coords[1].y - coords[0].y;
  if (Math.hypot(dx, dy) < MIN_WALL_LEN_XY_M) return false;
  return true;
}

function collectWallSegments(elements: Element[]): WallSeg[] {
  const out: WallSeg[] = [];
  for (const el of elements) {
    if (!isExternalLineWall(el)) continue;
    const c = el.coordinates;
    const k0 = clusterKeyRaw(c[0].x, c[0].y);
    const k1 = clusterKeyRaw(c[1].x, c[1].y);
    if (k0 === k1) continue;
    const h = typeof el.height === 'number' && el.height > 0 ? el.height : 0;
    if (h <= 0) continue;
    const ori = el.orientation360;
    const pi = el.pitch;
    out.push({
      id: el.id,
      name: el.name,
      zoneId: el.zoneId,
      k0,
      k1,
      zBase: wallBaseElevationM(el),
      height: h,
      orientation360: typeof ori === 'number' && Number.isFinite(ori) ? ori : undefined,
      pitch: typeof pi === 'number' && Number.isFinite(pi) ? pi : undefined,
    });
  }
  return out;
}

/** Union-find merge of keys whose parseKey points are within MERGE_VERTEX_XY_M. */
function mergeCloseVertexKeys(keys: Iterable<string>): Map<string, string> {
  const uniq = [...new Set(keys)];
  const pts = uniq.map((k) => ({ k, ...parseKey(k) }));
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let p = parent.get(k) ?? k;
    if (p !== k) {
      p = find(p);
      parent.set(k, p);
    }
    return p;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i]!;
      const b = pts[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= MERGE_VERTEX_XY_M) {
        union(a.k, b.k);
      }
    }
  }
  const canon = new Map<string, string>();
  for (const p of pts) {
    const r = find(p.k);
    canon.set(p.k, r);
  }
  return canon;
}

function remapSegments(segments: WallSeg[], mergeMap: Map<string, string>): WallSeg[] {
  return segments.map((s) => ({
    ...s,
    k0: mergeMap.get(s.k0) ?? s.k0,
    k1: mergeMap.get(s.k1) ?? s.k1,
  }));
}

/** Canonical key for an undirected segment between merged vertex keys (order-independent). */
function undirectedEdgeKey(k0: string, k1: string): string {
  return k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`;
}

/**
 * Collapse parallel duplicates (same plan edge on multiple storeys) into one logical segment so façade
 * vertices stay degree-2 instead of multi-graph degree 4+. Required for semi-detached shells where
 * ground + upper walls repeat the same footprint within {@link MERGE_VERTEX_XY_M}.
 */
function dedupeParallelWallSegmentsInPlan(segments: WallSeg[]): WallSeg[] {
  const map = new Map<string, WallSeg>();
  for (const s of segments) {
    const key = undirectedEdgeKey(s.k0, s.k1);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...s });
      continue;
    }
    const zTopPrev = prev.zBase + prev.height;
    const zTopS = s.zBase + s.height;
    const zBase = Math.min(prev.zBase, s.zBase);
    const zTop = Math.max(zTopPrev, zTopS);
    map.set(key, {
      ...prev,
      zBase,
      height: zTop - zBase,
      orientation360:
        typeof prev.orientation360 === 'number' && Number.isFinite(prev.orientation360)
          ? prev.orientation360
          : typeof s.orientation360 === 'number' && Number.isFinite(s.orientation360)
            ? s.orientation360
            : prev.orientation360,
      pitch:
        typeof prev.pitch === 'number' && Number.isFinite(prev.pitch)
          ? prev.pitch
          : typeof s.pitch === 'number' && Number.isFinite(s.pitch)
            ? s.pitch
            : prev.pitch,
    });
  }
  return [...map.values()];
}

function segmentsByConnectedComponent(segments: WallSeg[]): WallSeg[][] {
  const seen = new Set<string>();
  const keySegs = new Map<string, WallSeg[]>();
  for (const s of segments) {
    if (!keySegs.has(s.k0)) keySegs.set(s.k0, []);
    if (!keySegs.has(s.k1)) keySegs.set(s.k1, []);
    keySegs.get(s.k0)!.push(s);
    keySegs.get(s.k1)!.push(s);
  }
  const comps: WallSeg[][] = [];
  for (const start of segments) {
    if (seen.has(start.id)) continue;
    const comp: WallSeg[] = [];
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur.id)) continue;
      seen.add(cur.id);
      comp.push(cur);
      for (const n of keySegs.get(cur.k0) ?? []) {
        if (!seen.has(n.id)) stack.push(n);
      }
      for (const n of keySegs.get(cur.k1) ?? []) {
        if (!seen.has(n.id)) stack.push(n);
      }
    }
    comps.push(comp);
  }
  return comps;
}

type AdjEdge = { segId: string; neigh: string };

function buildAdjAll(comp: WallSeg[]): Map<string, AdjEdge[]> {
  const adj = new Map<string, AdjEdge[]>();
  const add = (k: string, e: AdjEdge) => {
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k)!.push(e);
  };
  for (const s of comp) {
    add(s.k0, { segId: s.id, neigh: s.k1 });
    add(s.k1, { segId: s.id, neigh: s.k0 });
  }
  return adj;
}

/** Vertex XY from cluster key string "x,y". */
function parseKey(k: string): { x: number; y: number } {
  const [xs, ys] = k.split(',');
  return { x: Number(xs), y: Number(ys) };
}

function cross2(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** HEM / CSV: compass bearing of external surface normal → plan vector `(sin θ, cos θ)` (+Y north, +X east). */
function outwardNormalFromOrientation360Deg(deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), y: Math.cos(r) };
}

function geometricOutwardRightOfDirectedEdge(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  const tx = to.x - from.x;
  const ty = to.y - from.y;
  const len = Math.hypot(tx, ty);
  if (len < 1e-12) return { x: 0, y: 0 };
  return { x: ty / len, y: -tx / len };
}

function segmentForKeys(comp: WallSeg[], ka: string, kb: string): WallSeg | undefined {
  return comp.find((s) => (s.k0 === ka && s.k1 === kb) || (s.k0 === kb && s.k1 === ka));
}

/**
 * How well `orientation360` (outward normal) aligns with geometric “exterior to the right” of the
 * directed edge from→to along the thermal trace. Used to pick P→V→Q vs Q→V→P when both are geometrically
 * valid; higher is better. Returns 0 if orientation360 is absent.
 */
function orientationAlignmentDot(
  seg: WallSeg | undefined,
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  if (!seg) return 0;
  const pitch = seg.pitch ?? 90;
  if (Math.abs(pitch - 90) > 1) return 0;
  if (typeof seg.orientation360 !== 'number' || !Number.isFinite(seg.orientation360)) return 0;
  const n = outwardNormalFromOrientation360Deg(seg.orientation360);
  const g = geometricOutwardRightOfDirectedEdge(from, to);
  if (g.x === 0 && g.y === 0) return 0;
  return n.x * g.x + n.y * g.y;
}

function componentCentroid(comp: WallSeg[]): { x: number; y: number } {
  const pts: { x: number; y: number }[] = [];
  for (const s of comp) {
    pts.push(parseKey(s.k0), parseKey(s.k1));
  }
  if (pts.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

/** CCW polygon interior: point C is strictly on the left of directed edge A→V (2D). */
function isStrictlyLeftOfDirectedEdge(
  A: { x: number; y: number },
  V: { x: number; y: number },
  C: { x: number; y: number },
): boolean {
  const cross = cross2(V.x - A.x, V.y - A.y, C.x - A.x, C.y - A.y);
  return cross > 1e-9;
}

/**
 * True if C lies in the **interior** half-planes for CCW boundary A→V→B (both edges left of walk).
 * Used to disambiguate A→V→B vs B→V→A when orientation data is missing.
 */
function centroidSupportsCCWOrder(
  A: { x: number; y: number },
  V: { x: number; y: number },
  B: { x: number; y: number },
  C: { x: number; y: number },
): boolean {
  return isStrictlyLeftOfDirectedEdge(A, V, C) && isStrictlyLeftOfDirectedEdge(V, B, C);
}

const COLINEAR_TURN_EPS = 1e-8;

/**
 * Classify turn at V for order P→V→Q. Returns null if ~180° (colinear continuation).
 * convex === true ⇒ E16 (CCW left turn at vertex for simple polygon convention).
 */
function turnSignConvex(
  P: { x: number; y: number },
  V: { x: number; y: number },
  Q: { x: number; y: number },
): { turn: number; convex: boolean } | null {
  const einX = V.x - P.x;
  const einY = V.y - P.y;
  const eoutX = Q.x - V.x;
  const eoutY = Q.y - V.y;
  const turn = cross2(einX, einY, eoutX, eoutY);
  if (Math.abs(turn) < COLINEAR_TURN_EPS) return null;
  /** CCW footprint: left turn ⇒ convex vertex (E16); right turn ⇒ reflex (E17). */
  return { turn, convex: turn > 0 };
}

function pickPQOrderForDegree2(
  Vkey: string,
  ka: string,
  kb: string,
  s1: WallSeg,
  s2: WallSeg,
  comp: WallSeg[],
  centroid: { x: number; y: number },
): { Pkey: string; Qkey: string; segIn: WallSeg | undefined; segOut: WallSeg | undefined } | null {
  const V = parseKey(Vkey);

  const orders: Array<{ Pkey: string; Qkey: string; segIn: WallSeg | undefined; segOut: WallSeg | undefined }> = [
    { Pkey: ka, Qkey: kb, segIn: segmentForKeys(comp, ka, Vkey), segOut: segmentForKeys(comp, Vkey, kb) },
    { Pkey: kb, Qkey: ka, segIn: segmentForKeys(comp, kb, Vkey), segOut: segmentForKeys(comp, Vkey, ka) },
  ];

  const scored = orders.map((o) => {
    const P = parseKey(o.Pkey);
    const Q = parseKey(o.Qkey);
    const align =
      orientationAlignmentDot(o.segIn, P, V) + orientationAlignmentDot(o.segOut, V, Q);
    const cenOk = centroidSupportsCCWOrder(P, V, Q, centroid);
    return { ...o, align, cenOk };
  });

  scored.sort((a, b) => {
    if (a.align !== b.align) return b.align - a.align;
    if (a.cenOk !== b.cenOk) return a.cenOk ? -1 : 1;
    return 0;
  });

  const best = scored[0]!;
  if (best.align <= 0 && !best.cenOk) {
    const fallback = scored.find((s) => s.cenOk);
    if (fallback) return { Pkey: fallback.Pkey, Qkey: fallback.Qkey, segIn: fallback.segIn, segOut: fallback.segOut };
  }
  return { Pkey: best.Pkey, Qkey: best.Qkey, segIn: best.segIn, segOut: best.segOut };
}

/** Walk a simple cycle (all degree 2); returns ordered vertex keys. */
function walkSimpleCycle(sub: WallSeg[], adj: Map<string, AdjEdge[]>): string[] | null {
  if (sub.length < 3) return null;
  const startSeg = sub[0]!;
  const startKey = startSeg.k0;
  let key = startKey;
  let prevSegId: string | null = null;
  const ordered: string[] = [];
  for (;;) {
    const edges = adj.get(key);
    if (!edges || edges.length !== 2) return null;
    const pick = edges.find((e) => e.segId !== prevSegId);
    if (!pick) return null;
    ordered.push(key);
    prevSegId = pick.segId;
    key = pick.neigh;
    if (key === startKey) break;
    if (ordered.length > sub.length + 2) return null;
  }
  if (ordered.length !== sub.length) return null;
  return ordered;
}

/** Walk open chain between two degree-1 vertices (unique simple path). */
function walkOpenChain(sub: WallSeg[], adj: Map<string, AdjEdge[]>): string[] | null {
  const ends = [...adj.entries()].filter(([, es]) => es.length === 1).map(([k]) => k);
  if (ends.length !== 2) return null;
  const endA = ends[0]!;
  const endB = ends[1]!;
  let key = endA;
  let prevKey: string | null = null;
  const ordered: string[] = [];
  for (;;) {
    ordered.push(key);
    if (key === endB && ordered.length > 1) break;
    const edges = adj.get(key);
    if (!edges || edges.length === 0) return null;
    const nextEdge = edges.find((e) => e.neigh !== prevKey);
    if (!nextEdge) return null;
    prevKey = key;
    key = nextEdge.neigh;
    if (ordered.length > sub.length + 2) return null;
  }
  if (ordered.length !== sub.length + 1) return null;
  return ordered;
}

function polygonSignedAreaFromKeys(keys: string[]): number {
  const n = keys.length;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const p = parseKey(keys[i]!);
    const q = parseKey(keys[(i + 1) % n]!);
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Vertical segment where both incident walls exist (plan corner line). */
function verticalOverlapForCornerWallSegs(a: WallSeg, b: WallSeg): { z0: number; z1: number } | null {
  const zTopA = a.zBase + a.height;
  const zTopB = b.zBase + b.height;
  const z0 = Math.max(a.zBase, b.zBase);
  const z1 = Math.min(zTopA, zTopB);
  if (!Number.isFinite(z0) || !Number.isFinite(z1) || z1 - z0 < MIN_CORNER_VERTICAL_OVERLAP_M) {
    return null;
  }
  return { z0, z1 };
}

function cornersFromOrderedPolyline(
  keys: string[],
  isClosed: boolean,
  sub: WallSeg[],
  zoneId: string | undefined,
): FacadeOpeningTbProposal[] {
  const proposals: FacadeOpeningTbProposal[] = [];
  const n = keys.length;
  const lastIdx = isClosed ? n : n - 1;
  const startIdx = isClosed ? 0 : 1;
  for (let i = startIdx; i < lastIdx; i++) {
    const k = keys[i]!;
    const pk = isClosed ? keys[(i - 1 + n) % n]! : keys[i - 1]!;
    const qk = isClosed ? keys[(i + 1) % n]! : keys[i + 1]!;
    const p = parseKey(pk);
    const c = parseKey(k);
    const q = parseKey(qk);
    const cls = turnSignConvex(p, c, q);
    if (!cls) continue;
    const { convex } = cls;
    const role: FacadeOpeningEdgeRole = convex ? 'external_corner_convex' : 'external_corner_reentrant';
    const code = convex ? 'E16' : 'E17';
    const segPk = segmentForKeys(sub, pk, k);
    const segKq = segmentForKeys(sub, k, qk);
    if (!segPk || !segKq) continue;
    const overlap = verticalOverlapForCornerWallSegs(segPk, segKq);
    if (!overlap) continue;
    const { z0, z1 } = overlap;
    const wallName = segPk.name ?? 'Wall';
    proposals.push({
      proposalId: `corner:${zoneId ?? 'nz'}:${k}:${code}:walk`,
      openingId: `corner:${k}`,
      openingName: convex ? `External corner (convex)` : `External corner (re-entrant)`,
      zoneId,
      edgeRole: role,
      junctionCode: code,
      suggestedLengthM: roundToTwoDecimals(z1 - z0),
      linearThermalTransmittance: psiTable37ForCode(code),
      reason: convex
        ? `Convex external corner (CCW left turn) at plan node (${c.x}, ${c.y}) along external wall chain`
        : `Re-entrant external corner (CCW reflex vertex) at plan node (${c.x}, ${c.y}) along external wall chain`,
      coordinates: [
        { x: c.x, y: c.y, z: z0 },
        { x: c.x, y: c.y, z: z1 },
      ],
      parentElementForTb: wallName,
      cornerHostWallIds: [segPk.id, segKq.id],
    });
  }
  return proposals;
}

/**
 * Propose E16/E17 vertical junctions at external opaque wall corners in plan (one proposal per eligible vertex).
 * Vertical extent follows the overlap of the two host walls at each corner (not zone storey height).
 */
export function proposeExternalCornerThermalBridges(elements: Element[]): FacadeOpeningTbProposal[] {
  let segments = collectWallSegments(elements);
  const allKeys = new Set<string>();
  for (const s of segments) {
    allKeys.add(s.k0);
    allKeys.add(s.k1);
  }
  const mergeMap = mergeCloseVertexKeys(allKeys);
  segments = remapSegments(segments, mergeMap);

  const byZone = new Map<string, WallSeg[]>();
  for (const s of segments) {
    const zid = s.zoneId ?? '__no_zone__';
    if (!byZone.has(zid)) byZone.set(zid, []);
    byZone.get(zid)!.push(s);
  }

  const proposals: FacadeOpeningTbProposal[] = [];

  for (const comp of byZone.values()) {
    const dedupedPerimeter = dedupeParallelWallSegmentsInPlan(comp);
    const components = segmentsByConnectedComponent(dedupedPerimeter);
    for (const sub of components) {
      const adj = buildAdjAll(sub);
      const centroid = componentCentroid(sub);
      const zoneId = sub[0]?.zoneId;

      const walkCycle = walkSimpleCycle(sub, adj);
      const walkPath = walkOpenChain(sub, adj);

      if (walkCycle && walkCycle.length >= 3) {
        const keys = [...walkCycle];
        if (polygonSignedAreaFromKeys(keys) < 0) keys.reverse();
        proposals.push(...cornersFromOrderedPolyline(keys, true, sub, zoneId));
        continue;
      }

      if (walkPath && walkPath.length >= 3) {
        const keys = [...walkPath];
        /** Open chain: orient so centroid is to the left of the first interior edge (CCW shell). */
        if (keys.length >= 3) {
          const A = parseKey(keys[0]!);
          const B = parseKey(keys[1]!);
          const C = parseKey(keys[2]!);
          if (!centroidSupportsCCWOrder(A, B, C, centroid)) {
            keys.reverse();
          }
        }
        proposals.push(...cornersFromOrderedPolyline(keys, false, sub, zoneId));
        continue;
      }

      /** Fallback when cycle/open-chain walk fails: degree-2 vertices only (orientation + centroid). Degree ≥3: no corner here — see file header. */
      const seenCorners = new Set<string>();
      for (const [Vkey, edges] of adj) {
        if (edges.length === 2) {
          const other = new Set<string>();
          for (const e of edges) {
            other.add(e.neigh);
          }
          if (other.size !== 2) continue;
          const [ka, kb] = [...other];
          const s1 = segmentForKeys(comp, Vkey, ka);
          const s2 = segmentForKeys(comp, Vkey, kb);
          if (!s1 || !s2) continue;
          const picked = pickPQOrderForDegree2(Vkey, ka, kb, s1, s2, sub, centroid);
          if (!picked) continue;
          const P = parseKey(picked.Pkey);
          const V = parseKey(Vkey);
          const Q = parseKey(picked.Qkey);
          const cls = turnSignConvex(P, V, Q);
          if (!cls) continue;
          const { convex } = cls;
          const sig = `${Vkey}:${convex ? 'E16' : 'E17'}`;
          if (seenCorners.has(sig)) continue;
          seenCorners.add(sig);
          const code = convex ? 'E16' : 'E17';
          const role: FacadeOpeningEdgeRole = convex ? 'external_corner_convex' : 'external_corner_reentrant';
          const overlap = verticalOverlapForCornerWallSegs(s1, s2);
          if (!overlap) continue;
          const { z0, z1 } = overlap;
          proposals.push({
            proposalId: `corner:${zoneId ?? 'nz'}:${Vkey}:${code}:deg2`,
            openingId: `corner:${Vkey}`,
            openingName: convex ? `External corner (convex)` : `External corner (re-entrant)`,
            zoneId,
            edgeRole: role,
            junctionCode: code,
            suggestedLengthM: roundToTwoDecimals(z1 - z0),
            linearThermalTransmittance: psiTable37ForCode(code),
            reason: convex
              ? `Convex external corner (CCW left turn) at plan node (${V.x}, ${V.y})`
              : `Re-entrant external corner (CCW reflex vertex) at plan node (${V.x}, ${V.y})`,
            coordinates: [
              { x: V.x, y: V.y, z: z0 },
              { x: V.x, y: V.y, z: z1 },
            ],
            parentElementForTb: s1.name,
            cornerHostWallIds: [s1.id, s2.id],
          });
        }
      }
    }
  }

  return proposals;
}
