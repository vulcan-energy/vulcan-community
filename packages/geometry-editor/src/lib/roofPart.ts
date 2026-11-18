// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// A roof part: the roof fitted over one storey outline (`fitRoof`), drawn as ordinary sloped
// planes tagged `hemie_bundle` kind 'roof'. The edges come from the walls: a party wall is a
// gable and an edge under a wall of the storey above abuts it; every other edge is eaves until
// the user changes it. The anchor (the first slope) holds the parameters; every member carries
// the shape and the pitch choice, which the converter passes to HEM:EPC.

import polygonClipping, { type Polygon } from 'polygon-clipping';
import type { Element, ElementDraft } from '../geometry/types';
import { roundToTwoDecimals } from '../geometry/constants';
import { fitRoof, type P3, type RoofEdgeType, type RoofFit } from './fitRoof';
import { extractInteriorFaces } from './spaceInference/polygonizeInteriorFaces';
import { isInferenceWallElement } from './spaceInference/types';
import { normalizeStoreyIndex } from './elementCanvasFloor';
import { orientation360SlopedFromFirstEdge } from './openingSegmentOutward';
import { deriveSlopedElementDimensions } from './slopedElementDimensions';
import { isPointInPolygon2D } from './pointInPolygon';
import {
  authoredFields,
  getHemieBundle,
  getHemieBundleMembers,
  planBundleUpdate,
  uniqueBundleId,
  type HemieBundleMemberDraft,
  type HemieBundleStore,
} from './hemieBundles';

type P = { x: number; y: number };
export type RoofPitchCategory = 'Steep' | 'Average' | 'Moderate';
export type RoofShape = 'hipped' | 'gable' | 'half-hip' | 'mono' | 'flat' | 'mansard' | 'gambrel' | 'custom';
export type RoofUse = 'loft' | 'room' | 'vaulted';

/** HEM:EPC's indicative angle for each pitch category. */
export const PITCH_CATEGORY_DEGREES: Record<RoofPitchCategory, number> = { Steep: 55, Average: 45, Moderate: 35 };
/** Drawn at Average's angle until a pitch is picked or typed. */
export const DEFAULT_ROOF_PITCH = PITCH_CATEGORY_DEGREES.Average;

export interface RoofParameters {
  /** The storey whose outline the roof covers. */
  level: number;
  /** A point inside the outline: which outline, on a storey with several. */
  at: P;
  /** Edge types the user set, by wall name; the rest are derived. */
  edges?: Record<string, RoofEdgeType>;
  /** A category, or degrees typed; never both. Absent: Average (default). */
  pitchChoice?: RoofPitchCategory | number;
  flat?: boolean;
  use?: RoofUse;
  /** A room in the roof: the walls at the foot of the slopes. Common: the storey's walls run on up (absent: common). */
  roomWalls?: 'common' | 'set-in';
  /** HEM:EPC's room-in-roof measurements (m): the width between set-in walls, the max ceiling
   * height, the flat ceiling width (blank: none) and the knee wall height (blank: 0). */
  roomWidth?: number;
  maxCeilingHeight?: number;
  ceilingWidth?: number;
  kneeWallHeight?: number;
  halfHipHeight?: number;
  /** A mansard or gambrel: the break above the eaves and the upper pitch. */
  breakHeight?: number;
  upperPitch?: number;
  /** Mansard picked: the break and upper pitch are asked for. */
  mansard?: boolean;
  junction?: number;
  /** The outline and eaves the roof was fitted to: a change shows "Outline changed". */
  outline?: P[];
  eaves?: number;
}

export interface OutlineEdge {
  a: P;
  b: P;
  /** The wall under the edge, by name ('' when none matches). */
  wall: string;
  /** Fixed by the drawing: a party wall (gable) or a wall of the storey above (abuts). */
  fixed: 'party' | 'abuts' | null;
}

export interface StoreyOutline {
  edges: OutlineEdge[];
  eaves: number;
}

const SHORT_EDGE_M = 0.3;
const LINE_TOL_M = 0.3;
const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const dist = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y);
const level = (e: Element) => normalizeStoreyIndex(e.coordinates?.[0]?.z);
// A roof part's own walls (a room in the roof) are not storey walls: the roof is fitted under them.
const isWall = (e: Element) => isInferenceWallElement(e) && e.coordinates?.length === 2
  && ((e as { pitch?: number }).pitch === undefined || (e as { pitch?: number }).pitch === 90)
  && getHemieBundle(e)?.kind !== 'roof';

/** The outline rings of a storey: its walls' rooms, joined. */
function storeyRings(elements: Element[], z: number): P[][] {
  const segments = elements.flatMap((e) => (isWall(e) && level(e) === z && normalizeStoreyIndex(e.coordinates[1].z) === z
    ? [{ a: { x: e.coordinates[0].x, y: e.coordinates[0].y }, b: { x: e.coordinates[1].x, y: e.coordinates[1].y }, wallZIndex: z }]
    : []));
  const faces = extractInteriorFaces(segments, 0.5, { keepWallCoordinates: true });
  if (!faces.length) return [];
  const polys = faces.map((f) => [f.exteriorRing.map((p) => [p.x, p.y])] as Polygon);
  const joined = polygonClipping.union(polys[0], ...polys.slice(1));
  return joined.map((poly) => poly[0].slice(0, -1).map(([x, y]) => ({ x, y })));
}

/** Short jogs merged into the edge beside them; points within 2 cm of a straight line dropped. */
function simplify(ring: P[]): P[] {
  let pts = [...ring];
  for (let guard = 0; guard < 200 && pts.length > 3; guard += 1) {
    const n = pts.length;
    const at = (k: number) => pts[((k % n) + n) % n];
    let straight = -1;
    let i = -1;
    for (let k = 0; k < n; k += 1) {
      if (straight < 0 && Math.abs(cross(at(k - 1), pts[k], at(k + 1))) / dist(at(k - 1), at(k + 1)) < 0.02) straight = k;
      if (i < 0 && dist(pts[k], at(k + 1)) < SHORT_EDGE_M) i = k;
    }
    if (straight >= 0) {
      pts = pts.filter((_, k) => k !== straight);
      continue;
    }
    if (i < 0) break;
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
    const keep = (j: number) => j !== i && j !== (i + 1) % n;
    if (Math.abs(den) > 0.1 * dist(a, b) * dist(c, d)) {
      // The edges either side meet: their corner replaces the short edge.
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
      const corner = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      pts = pts.flatMap((p, j) => (j === i ? [corner] : keep(j) ? [p] : []));
    } else {
      // A jog between parallel edges: the next corner moves onto the line before it.
      const u = { x: (b.x - a.x) / dist(a, b), y: (b.y - a.y) / dist(a, b) };
      const k = (d.x - a.x) * u.x + (d.y - a.y) * u.y;
      const moved = { x: a.x + k * u.x, y: a.y + k * u.y };
      pts = pts.flatMap((p, j) => (!keep(j) ? [] : j === (i + 2) % n ? [moved] : [p]));
    }
  }
  return pts;
}

/** The wall lying along a→b with the longest overlap. */
function wallAlong(a: P, b: P, walls: Element[]): Element | null {
  const len = dist(a, b);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  let best: Element | null = null;
  let bestOverlap = 0.05;
  for (const w of walls) {
    const [p, q] = w.coordinates;
    if (Math.abs(cross(a, b, p)) / len > LINE_TOL_M || Math.abs(cross(a, b, q)) / len > LINE_TOL_M) continue;
    const s = (r: P) => (r.x - a.x) * u.x + (r.y - a.y) * u.y;
    const overlap = Math.min(len, Math.max(s(p), s(q))) - Math.max(0, Math.min(s(p), s(q)));
    if (overlap > bestOverlap) {
      best = w;
      bestOverlap = overlap;
    }
  }
  return best;
}

/**
 * The outline of storey `z` around `at`, less what the storey above covers (a one-storey wing's
 * roof stops at the main wall, which it abuts), with each edge's wall. Null when `at` is outside.
 */
export function storeyOutline(elements: Element[], z: number, at: P): StoreyOutline | null {
  const below = storeyRings(elements, z);
  const above = storeyRings(elements, z + 1);
  const open = above.length
    ? polygonClipping.difference(below.map((r) => [r.map((p) => [p.x, p.y])] as Polygon) as unknown as Polygon, ...above.map((r) => [r.map((p) => [p.x, p.y])] as Polygon))
      .map((poly) => poly[0].slice(0, -1).map(([x, y]) => ({ x, y })))
    : below;
  const ring = open.find((r) => isPointInPolygon2D(at, r));
  if (!ring) return null;
  let pts = simplify(ring);
  if (pts.length < 3) return null;
  // Counter-clockwise, as the fit draws it.
  if (pts.reduce((s, p, i) => s + cross({ x: 0, y: 0 }, p, pts[(i + 1) % pts.length]), 0) < 0) pts = pts.reverse();
  const walls = elements.filter((e) => isWall(e) && level(e) === z);
  const upper = elements.filter((e) => isWall(e) && level(e) === z + 1);
  const edges = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const wall = wallAlong(a, b, walls);
    const fixed: OutlineEdge['fixed'] = wallAlong(a, b, upper) ? 'abuts' : wall?.type === 'BuildingElementPartyWall' ? 'party' : null;
    return { a, b, wall: wall?.name ?? '', fixed };
  });
  const named = new Set(edges.map((e) => e.wall));
  const tops = walls.flatMap((w) => (named.has(w.name) ? [((w as { base_height?: number }).base_height ?? 0) + ((w as { height?: number }).height ?? 0)] : []));
  return { edges, eaves: roundToTwoDecimals(Math.max(0, ...tops)) };
}

/** Each edge's type: the user's, else derived (party: gable; under a wall above: abuts; else eaves). */
export function roofEdgeTypes(outline: StoreyOutline, p: Pick<RoofParameters, 'edges'>): RoofEdgeType[] {
  return outline.edges.map((e) => (e.fixed === 'party' ? 'gable' : e.fixed === 'abuts' ? 'abuts' : p.edges?.[e.wall] ?? 'eaves'));
}

export const roofPitchDegrees = (p: Pick<RoofParameters, 'pitchChoice'>): number => (typeof p.pitchChoice === 'number'
  ? p.pitchChoice
  : PITCH_CATEGORY_DEGREES[p.pitchChoice ?? 'Average']);

const given = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const mansardDrawn = (p: RoofParameters): p is RoofParameters & { breakHeight: number; upperPitch: number } => !!p.mansard && given(p.breakHeight) && given(p.upperPitch);

// Common walls need their knee height: on a hipped roof the knee walls are the room's only walls.
const roomGiven = (p: RoofParameters) => p.use === 'room' && !p.flat && given(p.maxCeilingHeight) && (p.roomWalls === 'set-in' ? given(p.roomWidth) : given(p.kneeWallHeight));

export interface RoofRoom {
  /** Full width across the ridge and length along it (m), from the fit. */
  w: number;
  length: number;
  /** HEM:EPC's measurements: width, max ceiling height, flat ceiling width, knee wall height. */
  wi: number;
  hv: number;
  wc: number;
  hw: number;
  /**
   * The room's pitch from them, and how far its slope sits above (below, when negative) one at
   * that pitch from the eaves. Above: the eaves rise. Below: the eaves stay on the storey's walls
   * and the void behind each knee wall runs straight from the eaves to its top, more gently.
   */
  pitch: number;
  shift: number;
  mono: boolean;
}

/** The main wing's full width across the ridge (the section) and its length along it. */
export function roofSpan(fit: RoofFit): { w: number; length: number } {
  const along = { x: fit.section.b.y - fit.section.a.y, y: fit.section.a.x - fit.section.b.x };
  const proj = fit.wings[0].map((q) => (q.x * along.x + q.y * along.y) / (Math.hypot(along.x, along.y) || 1));
  return { w: dist(fit.section.a, fit.section.b), length: Math.max(...proj) - Math.min(...proj) };
}

/** The least knee wall height (m) when the void kinks at the knee wall tops (set in). */
const MIN_KINKED_KNEE = 0.3;

/**
 * The room in the roof as measured: the physical pitch of the slope from the knee wall top to the
 * flat ceiling's edge, tan θ = 2(h_v − h_w)/(wᵢ − w_c) (one slope: the whole run), and how far
 * the eaves sit above the room's floor so the slope passes over the knee wall tops. This is not
 * HEM:EPC's pitch: the measurements are sent, and HEM:EPC works out its own. Null until the
 * measurements are given.
 */
export function roofRoom(outline: StoreyOutline, p: RoofParameters, fit: RoofFit): RoofRoom | { problem: string } | null {
  if (!roomGiven(p)) return null;
  const mono = roofShape(outline, p) === 'mono';
  const { w, length } = roofSpan(fit);
  const wi = p.roomWalls === 'set-in' ? p.roomWidth! : w;
  const [hv, wc, hw] = [p.maxCeilingHeight!, p.ceilingWidth ?? 0, p.kneeWallHeight ?? 0];
  if (hv <= hw) return { problem: 'Make the max ceiling height more than the knee wall height.' };
  // With no gable and no knee walls the room has no walls, and HEM:EPC would not see it.
  if (hw <= 0 && !roofEdgeTypes(outline, p).some((t) => t === 'gable' || t === 'half-hip')) return { problem: 'A room under a hipped roof needs knee walls: give a knee wall height above 0.' };
  if (wi > w + 0.005 || wi <= wc) return { problem: `Make the width at most the full width (${roundToTwoDecimals(w)} m) and more than the flat ceiling width.` };
  const tan = ((mono ? 1 : 2) * (hv - hw)) / (wi - wc);
  const shift = hw - ((w - wi) / (mono ? 1 : 2)) * tan;
  // The void then runs from the eaves to the knee wall tops: under 0.3 m of knee wall it would be
  // flat or nearly so.
  if (shift < -0.005 && hw < MIN_KINKED_KNEE) return { problem: `The slope from these measurements meets the floor between the room and the storey walls: give a knee wall height of at least ${MIN_KINKED_KNEE} m, or check the width.` };
  return { w, length, wi, hv, wc, hw, pitch: (Math.atan(tan) * 180) / Math.PI, shift: shift < -0.005 ? shift : Math.max(0, shift), mono };
}

/**
 * A height over the storey's walls on the fitted roof, drawn for the room: the room's slope `shift`
 * up (or down); below the knee wall tops, when it is down, the void from the eaves to them.
 */
export function roomHeight(room: RoofRoom, z: number): number {
  return room.shift >= 0 || z + room.shift >= room.hw ? z + room.shift : (z * room.hw) / (room.hw - room.shift);
}

/** The section through the room: the roof's points, with the kink at the knee wall tops. */
export function roomSection(room: RoofRoom, points: Array<{ s: number; z: number }>): Array<{ s: number; z: number }> {
  const kink = room.hw - room.shift;
  return points.flatMap((q, i) => {
    const r = points[i + 1];
    const at = r && room.shift < 0 && (q.z - kink) * (r.z - kink) < 0 ? [{ s: q.s + ((kink - q.z) / (r.z - q.z)) * (r.s - q.s), z: room.hw }] : [];
    return [{ s: q.s, z: roomHeight(room, q.z) }, ...at];
  });
}

/** Fits the roof to the outline with these parameters; a room in the roof sets its pitch. */
export function fitRoofPart(outline: StoreyOutline, p: RoofParameters): RoofFit | { problem: string } {
  const room = roomGiven(p);
  const mansard = mansardDrawn(p) && !room ? { breakHeight: p.breakHeight, upperPitch: p.upperPitch } : undefined;
  const at = (pitch: number) => fitRoof({
    ring: outline.edges.map((e) => e.a),
    edges: roofEdgeTypes(outline, p),
    pitch,
    flat: p.flat,
    ...(given(p.halfHipHeight) ? { halfHipHeight: p.halfHipHeight } : {}),
    ...(mansard ? { mansard } : {}),
    junction: p.junction,
  });
  const fit = at(roofPitchDegrees(p));
  if ('problem' in fit || !room) return fit;
  // Fit at the room's pitch (the width across the ridge does not depend on it).
  const measured = roofRoom(outline, p, fit)!;
  return 'problem' in measured ? measured : at(measured.pitch);
}

/**
 * The shape the edges make, as drawn: a mansard or gambrel only once its break height and upper
 * pitch are given. `picked` is the Shape field's view: mansard as soon as it is picked.
 */
export function roofShape(outline: StoreyOutline, p: RoofParameters, picked = false): RoofShape {
  if (p.flat) return 'flat';
  const free = roofEdgeTypes(outline, p).filter((_, i) => !outline.edges[i].fixed);
  const has = (t: RoofEdgeType) => free.includes(t);
  if (picked ? p.mansard : mansardDrawn(p)) return has('gable') ? 'gambrel' : 'mansard';
  if (free.filter((t) => t === 'eaves').length === 1 && free.length > 1 && !has('half-hip')) return 'mono';
  if (free.every((t) => t === 'eaves')) return 'hipped';
  if (free.every((t) => t === 'eaves' || t === 'gable')) return 'gable';
  if (free.every((t) => t === 'eaves' || t === 'half-hip')) return 'half-hip';
  return 'custom';
}

/** What the roof still needs drawing as picked: a mansard's break height and upper pitch, a half-hip's height. */
export function roofBlankNotice(name: string, outline: StoreyOutline, p: RoofParameters): string | null {
  if (p.flat) return null;
  if (p.mansard) {
    const blank = [given(p.breakHeight) ? '' : 'a break height', given(p.upperPitch) ? '' : 'an upper pitch'].filter(Boolean);
    if (blank.length) return `Give ${name} ${blank.join(' and ')}.`;
  }
  if (roofEdgeTypes(outline, p).includes('half-hip') && !given(p.halfHipHeight)) return `Give ${name} a half-hip height.`;
  if (p.use === 'room') {
    const setIn = p.roomWalls === 'set-in';
    const blank = [setIn && !given(p.roomWidth) ? 'a width' : '', !setIn && !given(p.kneeWallHeight) ? 'a knee wall height' : '', given(p.maxCeilingHeight) ? '' : 'a max ceiling height'].filter(Boolean);
    if (blank.length) return `Give ${name} ${blank.join(' and ')}.`;
  }
  return null;
}

/** The edge types a shape writes: gables or half-hips on each wing's ends; mono, low along the longest free edge. */
export function shapeEdges(outline: StoreyOutline, fit: RoofFit | null, shape: Exclude<RoofShape, 'custom' | 'flat'>): Record<string, RoofEdgeType> {
  const out: Record<string, RoofEdgeType> = {};
  const free = outline.edges.filter((e) => !e.fixed && e.wall);
  if (shape === 'mono') {
    const low = free.reduce<OutlineEdge | null>((best, e) => (!best || dist(e.a, e.b) > dist(best.a, best.b) ? e : best), null);
    for (const e of free) out[e.wall] = e === low ? 'eaves' : 'gable';
    return out;
  }
  const end: RoofEdgeType = shape === 'half-hip' ? 'half-hip' : 'gable';
  for (const e of free) {
    out[e.wall] = shape === 'gable' || shape === 'gambrel' || shape === 'half-hip' ? (isWingEnd(e, fit) ? end : 'eaves') : 'eaves';
  }
  return out;
}

/** An edge across the short side of the wing it bounds. */
function isWingEnd(e: OutlineEdge, fit: RoofFit | null): boolean {
  const wing = fit?.wings.find((w) => w.some((p, i) => {
    const q = w[(i + 1) % w.length];
    return Math.abs(cross(p, q, e.a)) < 1e-3 * dist(p, q) && Math.abs(cross(p, q, e.b)) < 1e-3 * dist(p, q);
  }));
  if (!wing) return false;
  const sides = wing.map((p, i) => ({ p, q: wing[(i + 1) % wing.length] }));
  const longest = sides.reduce((best, s) => (dist(s.p, s.q) > dist(best.p, best.q) ? s : best));
  const u = { x: (longest.q.x - longest.p.x) / dist(longest.p, longest.q), y: (longest.q.y - longest.p.y) / dist(longest.p, longest.q) };
  const v = { x: (e.b.x - e.a.x) / dist(e.a, e.b), y: (e.b.y - e.a.y) / dist(e.a, e.b) };
  return Math.abs(u.x * v.x + u.y * v.y) < 0.2;
}

/**
 * Turn: gable ends move one edge round; a mono roof's low side moves to the next free edge. Only on
 * a single four-edge wing; null there when the roof is fixed, and on any other outline.
 */
export function turnedEdges(outline: StoreyOutline, p: RoofParameters): Record<string, RoofEdgeType> | null {
  if (outline.edges.length !== 4) return null;
  const shape = roofShape(outline, p);
  const types = roofEdgeTypes(outline, p);
  const n = outline.edges.length;
  if (shape === 'mono') {
    const low = types.findIndex((t, i) => t === 'eaves' && !outline.edges[i].fixed);
    for (let k = 1; k < n; k += 1) {
      const next = (low + k) % n;
      if (outline.edges[next].fixed || !outline.edges[next].wall) continue;
      return { ...p.edges, [outline.edges[low].wall]: 'gable', [outline.edges[next].wall]: 'eaves' };
    }
    return null;
  }
  if (outline.edges.some((e) => e.fixed || !e.wall) || !types.some((t) => t === 'gable' || t === 'half-hip')) return null;
  return Object.fromEntries(outline.edges.map((e, i) => [e.wall, types[(i + n - 1) % n]]));
}

const pitchChoiceTag = (p: RoofParameters) => (p.pitchChoice === undefined ? {} : { pitch_choice: p.pitchChoice });

export interface RoofDraftInput {
  outline: StoreyOutline;
  fit: RoofFit;
  parameters: RoofParameters;
  existingNames: Iterable<string>;
  existingBundleIds?: Iterable<string>;
  globalOrientationOffset: number;
  bundleId?: string;
  bundleName?: string;
  names?: Record<string, string>;
  /** What the user set on the hand-drawn planes the fit replaces, when they agree. */
  fabric?: Record<string, unknown>;
}

function uniqueStem(existingNames: Iterable<string>): string {
  const names = [...existingNames];
  for (let i = 1; ; i += 1) {
    const stem = `Roof ${i}`;
    if (!names.some((name) => name === stem || name.startsWith(`${stem} `))) return stem;
  }
}

/** The part of a face where z lies in [lo, hi] (z linear over the face). */
function clipZ(ring: P3[], lo: number, hi: number): P3[] {
  const cut = (poly: P3[], f: (q: P3) => number) => poly.flatMap((q, i) => {
    const r = poly[(i + 1) % poly.length];
    const [fq, fr] = [f(q), f(r)];
    const out = fq <= 0 ? [q] : [];
    if ((fq < 0 && fr > 0) || (fq > 0 && fr < 0)) {
      const t = fq / (fq - fr);
      out.push({ x: q.x + t * (r.x - q.x), y: q.y + t * (r.y - q.y), z: q.z + t * (r.z - q.z) });
    }
    return out;
  });
  return cut(cut(ring, (q) => lo - q.z), (q) => q.z - hi);
}

/** The ring from its lowest level edge: a sloped plane's first edge is its foot. */
function footFirst(ring: P3[]): P3[] {
  const low = Math.min(...ring.map((q) => q.z));
  const i = ring.findIndex((q, k) => Math.abs(q.z - low) < 1e-6 && Math.abs(ring[(k + 1) % ring.length].z - low) < 1e-6);
  return i <= 0 ? ring : [...ring.slice(i), ...ring.slice(0, i)];
}

const planAreaOf = (ring: P[]) => Math.abs(ring.reduce((s, q, j) => s + cross({ x: 0, y: 0 }, q, ring[(j + 1) % ring.length]), 0)) / 2;

/**
 * A room gable's top: the roof's height above the room's floor, capped at the max ceiling height,
 * along the part of the edge where it is at least the knee wall height (between set-in walls).
 */
function roomGable(profile: Array<{ t: number; h: number }>, room: RoofRoom): { t0: number; t1: number; top: Array<{ t: number; h: number }> } | null {
  const raw = profile.map((q) => ({ t: q.t, h: q.h + room.shift }));
  const pts: Array<{ t: number; h: number }> = [];
  raw.forEach((q, i) => {
    pts.push(q);
    const r = raw[i + 1];
    if (!r) return;
    for (const level of [room.hw, room.hv]) {
      if ((q.h - level) * (r.h - level) < 0) pts.push({ t: q.t + ((level - q.h) / (r.h - q.h)) * (r.t - q.t), h: level });
    }
  });
  const kept = pts.filter((q) => q.h >= room.hw - 1e-6).sort((x, y) => x.t - y.t);
  if (kept.length < 2) return null;
  const [t0, t1] = [kept[0].t, kept[kept.length - 1].t];
  if (t1 - t0 < 1e-6) return null;
  const top = kept.map((q) => ({ t: roundToTwoDecimals(((q.t - t0) / (t1 - t0)) * 1000) / 1000, h: roundToTwoDecimals(Math.min(q.h, room.hv)) }));
  return { t0, t1, top };
}

/**
 * The members of a fitted roof: one sloped plane per face, its eaves edge first. A room in the
 * roof splits each slope into the void behind its knee walls, the room and the loft over its flat
 * ceiling, and adds its knee walls and gables on the roof's floor.
 */
export function buildRoofDraft(input: RoofDraftInput): { bundleId: string; members: HemieBundleMemberDraft[] } {
  const { outline, fit, parameters: p, globalOrientationOffset: offset } = input;
  const stem = input.bundleName ?? uniqueStem(input.existingNames);
  const bundleId = input.bundleId ?? uniqueBundleId(`roof-${p.level}`, input.existingBundleIds);
  const shape = roofShape(outline, p);
  const measured = p.use === 'room' ? roofRoom(outline, p, fit) : null;
  const room = measured && !('problem' in measured) ? measured : null;
  const shift = room?.shift ?? 0;
  const z = p.level + 1;
  const counts = new Map<string, number>();
  const unique = (base: string) => {
    const k = (counts.get(base) ?? 0) + 1;
    counts.set(base, k);
    return { role: k > 1 ? `${base}:${k}` : base, k };
  };
  const parameters: RoofParameters = { ...p, outline: outline.edges.map((e) => e.a), eaves: outline.eaves };
  const tag = (role: string, first: boolean) => ({
    hemie_bundle: {
      kind: 'roof',
      bundle_id: bundleId,
      role,
      shape,
      ...pitchChoiceTag(p),
      ...(first ? { parameters, bundle_name: stem } : {}),
    },
  });
  const LABEL = { slope: 'slope', void: 'void slope', over: 'slope over ceiling' } as const;
  const pieces = fit.faces.flatMap((face) => {
    const ring = face.ring.map((q) => ({ ...q, z: q.z + shift }));
    if (!room || face.pitch === 0) return [{ face, ring, kind: 'slope' as const, pitch: face.pitch }];
    // The roof meets the flat ceiling's edge at the max ceiling height.
    const top = room.hv;
    return ([['void', -Infinity, room.hw], ['slope', room.hw, top], ['over', top, Infinity]] as const).flatMap(([kind, lo, hi]) => {
      let part = footFirst(clipZ(ring, lo, hi));
      let pitch = face.pitch;
      // A void under a lowered room slope runs from the eaves to the knee wall top.
      if (kind === 'void' && shift < 0) {
        part = part.map((q) => ({ ...q, z: roomHeight(room, q.z - shift) }));
        pitch = (Math.atan((Math.tan((face.pitch * Math.PI) / 180) * room.hw) / (room.hw - shift)) * 180) / Math.PI;
      }
      return part.length >= 3 && planAreaOf(part) > 0.01 ? [{ face, ring: part, kind, pitch }] : [];
    });
  });
  const slopes = pieces.map(({ face, ring, kind, pitch: piecePitch }, i): HemieBundleMemberDraft => {
    const wall = outline.edges[face.edge]?.wall || `edge ${face.edge + 1}`;
    const { role, k } = unique(`${kind === 'slope' ? 'slope' : kind}:${wall}${face.upper ? ':upper' : ''}`);
    const label = `${wall}${face.upper ? ' upper' : ''} ${face.pitch === 0 ? 'flat' : LABEL[kind]}${k > 1 ? ` ${k}` : ''}`;
    const coordinates = ring.map((q) => ({ x: roundToTwoDecimals(q.x * 10) / 10, y: roundToTwoDecimals(q.y * 10) / 10, z }));
    const [a, b] = coordinates;
    const dims = face.pitch > 0
      ? deriveSlopedElementDimensions({ coordinates, pitch: piecePitch, type: 'BuildingElementOpaque' })
      : null;
    const width = dist(a, b);
    const heated = p.use === 'vaulted' || (!!room && kind === 'slope');
    return {
      role,
      type: 'BuildingElementOpaque',
      name: input.names?.[role] ?? `${stem} ${label}`,
      parent_element: null,
      updates: {
        ...input.fabric,
        coordinates,
        width: dims?.width ?? roundToTwoDecimals(width),
        height: dims?.height ?? roundToTwoDecimals(planAreaOf(coordinates) / width),
        area: dims?.area ?? roundToTwoDecimals(planAreaOf(coordinates)),
        pitch: Math.round(piecePitch * 100) / 100,
        orientation360: Math.round((orientation360SlopedFromFirstEdge(a.x, a.y, b.x, b.y, offset) ?? 0) * 100) / 100,
        base_height: roundToTwoDecimals(outline.eaves + ring[0].z),
        is_unheated_pitched_roof: face.pitch > 0 && !heated,
        extra_json: { ...(input.fabric?.extra_json as Record<string, unknown> | undefined), ...tag(role, i === 0) },
      },
    };
  });
  if (!room) return { bundleId, members: slopes };

  // The room's walls stand on its floor, the storey's wall tops.
  const wall = (base: string, label: string, type: HemieBundleMemberDraft['type'], a: P, b: P, height: number, top?: Array<{ t: number; h: number }>): HemieBundleMemberDraft => {
    const { role, k } = unique(base);
    const width = roundToTwoDecimals(dist(a, b));
    const mean = top ? top.reduce((s, q, i) => (i ? s + ((q.t - top[i - 1].t) * (q.h + top[i - 1].h)) / 2 : s), 0) : height;
    const at = (q: P) => ({ x: roundToTwoDecimals(q.x * 10) / 10, y: roundToTwoDecimals(q.y * 10) / 10, z });
    return {
      role,
      type,
      name: input.names?.[role] ?? `${stem} ${label}${k > 1 ? ` ${k}` : ''}`,
      parent_element: null,
      updates: {
        coordinates: [at(a), at(b)],
        width,
        height: roundToTwoDecimals(height),
        area: roundToTwoDecimals(width * mean),
        pitch: 90,
        orientation360: Math.round((orientation360SlopedFromFirstEdge(a.x, a.y, b.x, b.y, offset) ?? 0) * 100) / 100,
        base_height: outline.eaves,
        extra_json: {
          ...tag(role, false),
          ...(top ? { geometry_face: { kind: 'profiled-line-face', top_profile: top, bottom_profile: [{ t: 0, h: 0 }, { t: 1, h: 0 }] } } : {}),
        },
      },
    };
  };
  const types = roofEdgeTypes(outline, p);
  const setIn = p.roomWalls === 'set-in';
  // Knee walls: common, the storey's eaves walls run on up; set in, sheltered walls where the
  // slope is at their height, the roof void behind them (their own role: the type differs).
  const knees = room.hw <= 0 ? [] : setIn
    ? pieces.flatMap(({ face, ring, kind }) => (kind === 'slope' && face.pitch > 0 && Math.abs(ring[0].z - room.hw) < 1e-6 && Math.abs(ring[1].z - room.hw) < 1e-6
      ? [wall(`knee:${outline.edges[face.edge]?.wall}:set-in`, `${outline.edges[face.edge]?.wall} knee wall`, 'BuildingElementAdjacentUnconditionedSpace_Simple', ring[0], ring[1], room.hw)]
      : []))
    : outline.edges.flatMap((e, i) => (types[i] === 'eaves' ? [wall(`knee:${e.wall}`, `${e.wall} knee wall`, 'BuildingElementOpaque', e.a, e.b, room.hw)] : []));
  const gables = fit.gables.flatMap((g) => {
    const e = outline.edges[g.edge];
    const cut = roomGable(g.profile, room);
    if (!cut) return [];
    const along = (t: number) => ({ x: e.a.x + t * (e.b.x - e.a.x), y: e.a.y + t * (e.b.y - e.a.y) });
    const type = e.fixed === 'party' ? 'BuildingElementPartyWall' : 'BuildingElementOpaque';
    return [wall(`gable:${e.wall}`, `${e.wall} gable`, type, along(cut.t0), along(cut.t1), Math.max(...cut.top.map((q) => q.h)), cut.top)];
  });
  return { bundleId, members: [...slopes, ...knees, ...gables] };
}

/** The roof's anchor: the member holding its parameters. */
export function roofAnchor(members: Element[]): Element | undefined {
  return members.find((m) => getHemieBundle(m)?.parameters);
}

export const roofParameters = (anchor: Element): RoofParameters | null => {
  const tag = getHemieBundle(anchor);
  return tag?.kind === 'roof' && tag.parameters ? (tag.parameters as unknown as RoofParameters) : null;
};

/** Why the roof no longer matches its storey, or null: the outline or the eaves moved since the fit. */
export function roofOutlineChanged(anchor: Element, elements: Element[]): boolean {
  const p = roofParameters(anchor);
  if (!p?.outline) return false;
  const now = storeyOutline(elements, p.level, p.at);
  if (!now || now.edges.length !== p.outline.length || Math.abs(now.eaves - (p.eaves ?? now.eaves)) > 0.005) return true;
  return now.edges.some((e, i) => dist(e.a, p.outline![i]) > 0.005);
}

/** Hand-drawn roof planes over the outline (not part of any part), and the roof windows in them. */
export function handDrawnRoofOver(elements: Element[], outline: StoreyOutline, z: number): Element[] {
  const ring = outline.edges.map((e) => e.a);
  const planes = elements.filter((e) => e.type === 'BuildingElementOpaque' && (e.coordinates?.length ?? 0) >= 3
    && level(e) === z + 1 && !getHemieBundle(e) && !e.extra_json?.dormer_bundle
    && typeof (e as { pitch?: number }).pitch === 'number' && (e as { pitch: number }).pitch < 90
    && isPointInPolygon2D({
      x: e.coordinates.reduce((s, q) => s + q.x, 0) / e.coordinates.length,
      y: e.coordinates.reduce((s, q) => s + q.y, 0) / e.coordinates.length,
    }, ring));
  const names = new Set(planes.map((e) => e.name));
  return [...planes, ...elements.filter((e) => e.type === 'BuildingElementTransparent' && names.has(e.parent_element ?? ''))];
}

type SlopeUpdates = { coordinates: P[]; pitch: number; orientation360: number; base_height: number };

/** A window's pitch, orientation and heights on a slope: its lowest point sits in the slope's plane. */
function onSlope(w: Element, slope: SlopeUpdates): Partial<Element> {
  const [a, b] = slope.coordinates;
  const len = dist(a, b);
  // Inward from the eaves (the slope lies left of its first edge).
  const d = (q: P) => (-(b.y - a.y) * (q.x - a.x) + (b.x - a.x) * (q.y - a.y)) / len;
  const tan = Math.tan((slope.pitch * Math.PI) / 180);
  const foot = roundToTwoDecimals(slope.base_height + tan * Math.max(0, Math.min(...w.coordinates.map(d))));
  const height = (w as { height?: number }).height;
  return {
    pitch: slope.pitch,
    orientation360: slope.orientation360,
    base_height: foot,
    ...(typeof height === 'number' ? { mid_height: roundToTwoDecimals(foot + (height / 2) * Math.sin((slope.pitch * Math.PI) / 180)) } : {}),
  } as Partial<Element>;
}

/** The fabric the hand-drawn planes share (what the user set on them), or null when they differ. */
export function agreedFabric(planes: Element[]): Record<string, unknown> | null {
  const sets = planes.flatMap((e) => (e.type === 'BuildingElementOpaque' ? [authoredFields(e)] : []));
  if (!sets.length) return null;
  const key = (f: Record<string, unknown>) => JSON.stringify(f);
  return sets.every((f) => key(f) === key(sets[0])) ? sets[0] : null;
}

/**
 * Fits and draws a roof part: a new one, or `anchor`'s again (what the user set on a slope stays,
 * by role; a slope the refit adds takes what the others agree on). `replace` are hand-drawn planes
 * and their roof windows the new roof takes the place of: their fabric carries over when they
 * agree, heated planes make the roof vaulted, and each window moves to the new slope under its
 * centre (one under none goes). Returns the anchor's id.
 */
export function drawRoofPart(
  state: HemieBundleStore,
  parameters: RoofParameters,
  anchor?: Element,
  replace: Element[] = [],
): { anchorId: string } | { problem: string } {
  const all = Object.values(state.elementsById);
  const outline = storeyOutline(all, parameters.level, parameters.at);
  if (!outline) return { problem: 'Click inside a storey outline: the roof is fitted to its walls.' };
  const planes = replace.filter((e) => e.type === 'BuildingElementOpaque');
  const windows = replace.filter((e) => e.type === 'BuildingElementTransparent');
  const sloped = planes.filter((e) => ((e as { pitch?: number }).pitch ?? 0) > 0);
  const heated = sloped.length > 0 && sloped.every((e) => (e as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof === false);
  const p: RoofParameters = heated && parameters.use === undefined ? { ...parameters, use: 'vaulted' } : parameters;
  const fit = fitRoofPart(outline, p);
  if ('problem' in fit) return fit;
  const tag = anchor ? getHemieBundle(anchor) : null;
  const members = tag ? getHemieBundleMembers(all, tag.bundle_id) : [];
  // The slopes' fabric (a room's walls have their own).
  const fabric = agreedFabric(planes.length ? planes : members.filter((m) => ((m as { pitch?: number }).pitch ?? 90) < 90));
  const draft = buildRoofDraft({
    outline,
    fit,
    parameters: p,
    existingNames: all.flatMap((e) => (replace.includes(e) ? [] : [e.name])),
    existingBundleIds: all.flatMap((e) => getHemieBundle(e)?.bundle_id ?? []),
    globalOrientationOffset: state.globalOrientationOffset,
    ...(fabric ? { fabric } : {}),
    ...(tag ? { bundleId: tag.bundle_id, bundleName: tag.bundle_name, names: Object.fromEntries(members.map((m) => [getHemieBundle(m)!.role, m.name])) } : {}),
  });
  // A refit keeps the anchor where it is: the parameters move to the first slope.
  const plan = planBundleUpdate(members, draft);
  for (const e of planes) state.removeElement(e.id);
  state.updateElementsBulk(plan.update as Record<string, Partial<Element>>);
  // Members going first: one coming may take its name (a knee wall set in, then common).
  for (const id of plan.remove) state.removeElement(id);
  const added = plan.add.length
    ? state.addElements(plan.add.map((m) => ({ ...m.updates, name: m.name, type: m.type, zoneId: all.find((e) => isWall(e))?.zoneId, parent_element: null }) as ElementDraft))
    : [];
  // Each roof window moves to the slope under its centre, and lies in that slope's plane: its
  // pitch and orientation, and its foot at the slope's height there.
  const slopeUnder = (w: Element) => {
    const c = w.coordinates.reduce((s, q) => ({ x: s.x + q.x / w.coordinates.length, y: s.y + q.y / w.coordinates.length }), { x: 0, y: 0 });
    return draft.members.find((m) => isPointInPolygon2D(c, m.updates.coordinates));
  };
  const rehost: Record<string, Partial<Element>> = {};
  for (const w of windows) {
    const slope = slopeUnder(w);
    if (slope) rehost[w.id] = { parent_element: slope.name, ...onSlope(w, slope.updates as unknown as SlopeUpdates) };
    else state.removeElement(w.id);
  }
  state.updateElementsBulk(rehost);
  // The anchor is the first slope drawn: an existing member kept by role, or one just added.
  const role = draft.members[0].role;
  const kept = members.find((m) => getHemieBundle(m)!.role === role);
  return { anchorId: kept?.id ?? added[plan.add.findIndex((m) => m.role === role)] };
}

/** Dormers on these hand-drawn planes: fitting a roof over them takes their slope away. */
export function dormersOn(elements: Element[], planes: Element[]): number {
  const names = new Set(planes.flatMap((e) => (e.type === 'BuildingElementOpaque' ? [e.name] : [])));
  return new Set(elements.flatMap((e) => {
    const bundle = e.extra_json?.dormer_bundle as { bundle_id?: string; host_element_name?: string } | undefined;
    return bundle?.host_element_name && names.has(bundle.host_element_name) ? [bundle.bundle_id ?? e.id] : [];
  })).size;
}

/** The notes under the fields: what HEM:EPC does with this roof (EPC existing only). */
export function roofEpcNotes({ parameters: p, outline, fit }: { parameters: RoofParameters; outline: StoreyOutline | null; fit: RoofFit | null }): string[] {
  if (!outline || !fit || p.flat) return [];
  const shape = roofShape(outline, p);
  const notes: string[] = [];
  const hipped = new Set(fit.faces.map((f) => f.edge)).size > 2 && shape !== 'mono';
  if (shape === 'mansard' || shape === 'gambrel') notes.push(`HEM:EPC takes a ${shape} roof as dual pitch at the mean pitch (interim).`);
  else if (hipped && p.use === 'room') notes.push('HEM:EPC has no hipped room in the roof. Its slopes cover the hip, and the hip end is entered as a gable wall that loses the same heat as the knee wall under the hip. A knee wall with no U-value gives the gable its construction instead, over the larger gable area. Windows in the knee wall under the hip go on the gable.');
  else if (hipped) notes.push('HEM:EPC takes a hipped roof as dual pitch, with a notice (interim).');
  if (p.use === 'vaulted') notes.push('HEM:EPC has no vaulted ceiling yet. It is entered as a loft roof with the slopes’ heat loss; the volume under the slopes is not counted.');
  return notes;
}
