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
import { fitRoof, type RoofEdgeType, type RoofFit } from './fitRoof';
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
export type RoofUse = 'loft' | 'vaulted';

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
const isWall = (e: Element) => isInferenceWallElement(e) && e.coordinates?.length === 2
  && ((e as { pitch?: number }).pitch === undefined || (e as { pitch?: number }).pitch === 90);

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

/** Fits the roof to the outline with these parameters. */
export function fitRoofPart(outline: StoreyOutline, p: RoofParameters): RoofFit | { problem: string } {
  const mansard = mansardDrawn(p) ? { breakHeight: p.breakHeight, upperPitch: p.upperPitch } : undefined;
  return fitRoof({
    ring: outline.edges.map((e) => e.a),
    edges: roofEdgeTypes(outline, p),
    pitch: roofPitchDegrees(p),
    flat: p.flat,
    ...(given(p.halfHipHeight) ? { halfHipHeight: p.halfHipHeight } : {}),
    ...(mansard ? { mansard } : {}),
    junction: p.junction,
  });
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

/** The members of a fitted roof: one sloped plane per face, its eaves edge first. */
export function buildRoofDraft(input: RoofDraftInput): { bundleId: string; members: HemieBundleMemberDraft[] } {
  const { outline, fit, parameters: p, globalOrientationOffset: offset } = input;
  const stem = input.bundleName ?? uniqueStem(input.existingNames);
  const bundleId = input.bundleId ?? uniqueBundleId(`roof-${p.level}`, input.existingBundleIds);
  const shape = roofShape(outline, p);
  const loft = (p.use ?? 'loft') === 'loft';
  const z = p.level + 1;
  const counts = new Map<string, number>();
  const parameters: RoofParameters = { ...p, outline: outline.edges.map((e) => e.a), eaves: outline.eaves };
  const members = fit.faces.map((face, i): HemieBundleMemberDraft => {
    const wall = outline.edges[face.edge]?.wall || `edge ${face.edge + 1}`;
    const base = `slope:${wall}${face.upper ? ':upper' : ''}`;
    const k = (counts.get(base) ?? 0) + 1;
    counts.set(base, k);
    const role = k > 1 ? `${base}:${k}` : base;
    const label = `${wall}${face.upper ? ' upper' : ''} ${face.pitch === 0 ? 'flat' : 'slope'}${k > 1 ? ` ${k}` : ''}`;
    const coordinates = face.ring.map((q) => ({ x: roundToTwoDecimals(q.x * 10) / 10, y: roundToTwoDecimals(q.y * 10) / 10, z }));
    const [a, b] = coordinates;
    const dims = face.pitch > 0
      ? deriveSlopedElementDimensions({ coordinates, pitch: face.pitch, type: 'BuildingElementOpaque' })
      : null;
    const planArea = Math.abs(coordinates.reduce((s, q, j) => s + cross({ x: 0, y: 0 }, q, coordinates[(j + 1) % coordinates.length]), 0)) / 2;
    const width = dist(a, b);
    return {
      role,
      type: 'BuildingElementOpaque',
      name: input.names?.[role] ?? `${stem} ${label}`,
      parent_element: null,
      updates: {
        ...input.fabric,
        coordinates,
        width: dims?.width ?? roundToTwoDecimals(width),
        height: dims?.height ?? roundToTwoDecimals(planArea / width),
        area: dims?.area ?? roundToTwoDecimals(planArea),
        pitch: Math.round(face.pitch * 100) / 100,
        orientation360: Math.round((orientation360SlopedFromFirstEdge(a.x, a.y, b.x, b.y, offset) ?? 0) * 100) / 100,
        base_height: roundToTwoDecimals(outline.eaves + face.ring[0].z),
        is_unheated_pitched_roof: loft && face.pitch > 0,
        extra_json: {
          ...(input.fabric?.extra_json as Record<string, unknown> | undefined),
          hemie_bundle: {
            kind: 'roof',
            bundle_id: bundleId,
            role,
            shape,
            ...pitchChoiceTag(p),
            ...(i === 0 ? { parameters, bundle_name: stem } : {}),
          },
        },
      },
    };
  });
  return { bundleId, members };
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
  const fabric = agreedFabric(planes.length ? planes : members);
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
  const added = plan.add.length
    ? state.addElements(plan.add.map((m) => ({ ...m.updates, name: m.name, type: m.type, zoneId: all.find((e) => isWall(e))?.zoneId, parent_element: null }) as ElementDraft))
    : [];
  for (const id of plan.remove) state.removeElement(id);
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
  if (shape === 'mansard' || shape === 'gambrel') notes.push(`HEM:EPC takes a ${shape} roof as dual pitch at the mean pitch (interim).`);
  else if (new Set(fit.faces.map((f) => f.edge)).size > 2 && shape !== 'mono') notes.push('HEM:EPC takes a hipped roof as dual pitch, with a notice (interim).');
  if (p.use === 'vaulted') notes.push('HEM:EPC has no vaulted ceiling yet. It is entered as a loft roof with the slopes’ heat loss; the volume under the slopes is not counted.');
  return notes;
}
