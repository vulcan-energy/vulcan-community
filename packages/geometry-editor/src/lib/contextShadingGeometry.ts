// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { roundToTwoDecimals } from '../geometry/constants';
import type { ContextShading, ContextShadingPart, Element, Floor } from '../geometry/types';
import { isPointInPolygon2D } from './pointInPolygon';
import { assemblyTotalThicknessMFromOpaqueElement } from './groundSuspendedFabricSync';
import { hasSelfIntersectingPolygonEdges } from './slopedElementDimensions';
import { calculatePolygonArea } from './polygonSync';
import { elementBaseElevationMForTb } from './geometry3dMapper';
import { isWalkableFloorHorizontalPolygon, withEffectiveStoreyHeights } from './zoneDerivation';
import { getElementCanvasFloorZValue } from './elementCanvasFloor';

type PlanPoint = { x: number; y: number };

/**
 * A point as the CSV writes it (formatCoords, 3 dp). Every derivation reads coordinates this way,
 * so the stored values of a drawing are the ones its saved file re-derives on open.
 */
const asWritten = <T extends PlanPoint>(p: T): T => ({ ...p, x: Number(p.x.toFixed(3)), y: Number(p.y.toFixed(3)) });

const normalizeDegrees = (angle: number): number => ((angle % 360) + 360) % 360;

function openRing(coords: readonly PlanPoint[]): PlanPoint[] {
  const last = coords[coords.length - 1];
  return coords.length > 1 && last.x === coords[0].x && last.y === coords[0].y ? coords.slice(0, -1) : [...coords];
}

/** The open ring with consecutive duplicate vertices removed. */
function distinctRing(coords: readonly PlanPoint[]): PlanPoint[] {
  return openRing(coords).filter((p, i, all) => {
    const prev = all[(i + all.length - 1) % all.length];
    return all.length === 1 || p.x !== prev.x || p.y !== prev.y;
  });
}

export function getPlanCenter(coords: PlanPoint[] | undefined): PlanPoint | null {
  if (!coords || coords.length === 0) return null;
  const ring = openRing(coords);
  // Sum relative to the first vertex so large (e.g. grid) coordinates keep their precision.
  const { x: x0, y: y0 } = ring[0];
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const ax = ring[i].x - x0;
    const ay = ring[i].y - y0;
    const bx = ring[(i + 1) % ring.length].x - x0;
    const by = ring[(i + 1) % ring.length].y - y0;
    const cross = ax * by - bx * ay;
    twiceArea += cross;
    cx += (ax + bx) * cross;
    cy += (ay + by) * cross;
  }
  if (Math.abs(twiceArea) > 1e-9) {
    return { x: x0 + cx / (3 * twiceArea), y: y0 + cy / (3 * twiceArea) };
  }
  // A point, line or zero-area shape has no area centroid; its centre is the vertex mean.
  return {
    x: ring.reduce((sum, coord) => sum + coord.x, 0) / ring.length,
    y: ring.reduce((sum, coord) => sum + coord.y, 0) / ring.length,
  };
}

function pointAzimuthDeg(point: PlanPoint, origin: PlanPoint): number {
  const mathematicalDeg = Math.atan2(point.y - origin.y, point.x - origin.x) * 180 / Math.PI;
  return normalizeDegrees(90 - mathematicalDeg);
}

type Segment = [PlanPoint, PlanPoint];

/** Edges of a drawn shape: a point is one zero-length face, a line one face, a polygon its closed edges. */
function faces(coords: readonly PlanPoint[]): Segment[] {
  const ring = openRing(coords);
  if (ring.length <= 2) return [[ring[0], ring[ring.length - 1]]];
  return ring.map((point, i) => [point, ring[(i + 1) % ring.length]]);
}

/** The point of a-b nearest p. */
function closestPointOnSegment(p: PlanPoint, [a, b]: Segment): PlanPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function pointSegmentDistance(p: PlanPoint, segment: Segment): number {
  const q = closestPointOnSegment(p, segment);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

const midpoint = ([a, b]: Segment): PlanPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// Endpoint distances only, so crossing segments do not read 0: the wall choice ranks by this, and
// `segmentsMeet` decides whether an object crosses a wall.
function segmentDistance(s: Segment, t: Segment): number {
  return Math.min(
    pointSegmentDistance(s[0], t), pointSegmentDistance(s[1], t),
    pointSegmentDistance(t[0], s), pointSegmentDistance(t[1], s),
  );
}

const turn = (o: PlanPoint, a: PlanPoint, b: PlanPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** True when two segments cross, touch, or overlap along one line. */
function segmentsMeet(s: Segment, t: Segment): boolean {
  const crosses = Math.sign(turn(t[0], t[1], s[0])) * Math.sign(turn(t[0], t[1], s[1])) < 0 &&
    Math.sign(turn(s[0], s[1], t[0])) * Math.sign(turn(s[0], s[1], t[1])) < 0;
  return crosses || segmentDistance(s, t) <= 1e-9;
}

// Wall lines and floor edges are drawn separately, so allow a small drafting offset.
const WALL_ON_EDGE_TOLERANCE_M = 0.05;

type ModelElement = Pick<Element, 'type' | 'coordinates'> & { pitch?: number; floorId?: string; thickness_walls?: number; name?: string };

/** True when every vertex of a wall lies on the edge's line and the wall covers most of the edge. */
function edgeCarriesWall([a, b]: Segment, wall: readonly PlanPoint[]): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  if (wall.some((p) => Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux) > WALL_ON_EDGE_TOLERANCE_M)) return false;
  const along = wall.map((p) => (p.x - a.x) * ux + (p.y - a.y) * uy);
  return Math.min(Math.max(...along), length) - Math.max(Math.min(...along), 0) > length / 2;
}

const storeyOf = (element: { floorId?: string; coordinates?: readonly { z?: number }[] }) =>
  element.floorId?.trim() || String(Math.floor(element.coordinates?.[0]?.z ?? 0));

/** A vertical wall: a plan line, or an element pitched within 10 degrees of vertical. */
const isVerticalWall = (element: ModelElement) =>
  element.coordinates.length === 2 || (Number.isFinite(element.pitch) && Math.abs(element.pitch! - 90) <= 10);

/** Where the outside-face offset of the closest wall came from. */
export type ContextShadingWallThickness =
  | { thicknessM: number; source: 'wall_layers'; name: string }
  | { thicknessM: number; source: 'floor' }
  | { thicknessM: number; source: 'ground_floor'; name: string }
  | { thicknessM: 0; source: 'none' };

/**
 * The floor-level fallback when the wall itself has no construction layers: the floor's own
 * `thickness_walls`, otherwise that of a ground floor under it, otherwise none (the internal
 * line, which validation reports).
 */
function floorWallThickness(
  parentElement: Pick<Element, 'coordinates'> & { thickness_walls?: number },
  elements: readonly ModelElement[],
): ContextShadingWallThickness {
  if (Number.isFinite(parentElement.thickness_walls)) return { thicknessM: parentElement.thickness_walls!, source: 'floor' };
  const centre = getPlanCenter(parentElement.coordinates);
  const ground = centre && elements.find((element) => element.type === 'BuildingElementGround' &&
    Number.isFinite(element.thickness_walls) && isPointInPolygon2D(centre, element.coordinates));
  return ground
    ? { thicknessM: ground.thickness_walls!, source: 'ground_floor', name: ground.name || 'unnamed' }
    : { thicknessM: 0, source: 'none' };
}

export type ContextShadingDistanceDetails = {
  /** Rounded to 2 dp: the value stored and sent to HEM. */
  distance: number;
  thickness: ContextShadingWallThickness;
  /** On the closest wall's outside-face line, perpendicular from `to`. */
  from: PlanPoint;
  /** Midpoint of the object's closest face. `from`–`to` is the measured distance. */
  to: PlanPoint;
  /** The measured wall: the stretch of its outside-face line the distance runs from. */
  wall: Segment;
};

/** A floor plate the dwelling's walls are measured from. */
export type ContextShadingPlate = Pick<Element, 'coordinates'> & { thickness_walls?: number; floorId?: string; name?: string };

type Wall = { face: Segment; normal: PlanPoint; thickness: ContextShadingWallThickness };

/** True when a point is inside the dwelling's outside faces: on a plate, or within a wall's thickness. */
function insideDwelling(p: PlanPoint, walls: readonly Wall[], plates: readonly (readonly PlanPoint[])[]): boolean {
  return plates.some((ring) => ring.length >= 3 && isPointInPolygon2D(p, ring)) || walls.some(({ face: [a, b], normal, thickness }) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const along = length === 0 ? 0 : ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length;
    const perpendicular = (p.x - a.x) * normal.x + (p.y - a.y) * normal.y;
    return along >= -1e-9 && along <= length + 1e-9 && perpendicular <= 1e-9 && perpendicular >= -thickness.thicknessM - 1e-9;
  });
}

// Floating-point guard for "on the same line" between two plates' edges, in metres.
const SAME_LINE_GUARD_M = 1e-6;

/** The spans along `edge` (metres from its start) that no collinear edge of another plate covers: those are outside walls. */
function unsharedSpans([a, b]: Segment, others: readonly Segment[]): [number, number][] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const offLine = (p: PlanPoint) => Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux) > SAME_LINE_GUARD_M;
  const along = (p: PlanPoint) => (p.x - a.x) * ux + (p.y - a.y) * uy;
  const covered = others.flatMap(([c, d]) => {
    if (offLine(c) || offLine(d)) return [];
    const lo = Math.max(0, Math.min(along(c), along(d)));
    const hi = Math.min(length, Math.max(along(c), along(d)));
    return hi > lo ? [[lo, hi]] : [];
  }).sort((p, q) => p[0] - q[0]);
  const spans: [number, number][] = [];
  let t = 0;
  for (const [lo, hi] of covered) {
    if (lo - t > SAME_LINE_GUARD_M) spans.push([t, lo]);
    t = Math.max(t, hi);
  }
  if (length - t > SAME_LINE_GUARD_M) spans.push([t, length]);
  return spans;
}

/** Where two offset lines (point + direction) meet; null when they are parallel. */
function lineIntersection(p: PlanPoint, d: PlanPoint, q: PlanPoint, e: PlanPoint): PlanPoint | null {
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-12) return null;
  const s = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den;
  return { x: p.x + d.x * s, y: p.y + d.y * s };
}

/**
 * The dwelling's walls: every plate edge moved out by its wall's thickness (the wall element's
 * construction layers, else `floorWallThickness`). An edge two plates share is inside the
 * dwelling and is left out. Where two outside walls of a plate meet, their outside faces are
 * joined at the corner, so neighbouring walls meet as the built walls do.
 */
function dwellingWalls(plates: readonly ContextShadingPlate[], elements: readonly ModelElement[]): Wall[] {
  const rings = plates.map((plate) => distinctRing(plate.coordinates ?? []));
  const edges = rings.map((ring) => (ring.length < 3 ? [] : faces(ring)));
  const walls: Wall[] = [];
  plates.forEach((plate, i) => {
    const ring = rings[i];
    if (ring.length < 3) return;
    const winding = Math.sign(ring.reduce((sum, a, k) => {
      const b = ring[(k + 1) % ring.length];
      return sum + a.x * b.y - b.x * a.y;
    }, 0));
    const fallback = floorWallThickness(plate, elements);
    const storey = storeyOf(plate);
    // Only an opaque wall carries construction layers.
    const layeredWalls = elements.filter((element) => element.type === 'BuildingElementOpaque' &&
      (element.coordinates?.length ?? 0) >= 2 && isVerticalWall(element) && storeyOf(element) === storey);
    const others = edges.filter((_, j) => j !== i).flat();
    const sides = edges[i].map((edge) => {
      const [a, b] = edge;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      let thickness = fallback;
      for (const wall of layeredWalls) {
        const layersM = edgeCarriesWall(edge, wall.coordinates.map(asWritten)) ? assemblyTotalThicknessMFromOpaqueElement(wall as Element) : null;
        if (layersM != null) {
          thickness = { thicknessM: layersM, source: 'wall_layers', name: wall.name || 'unnamed' };
          break;
        }
      }
      const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
      // Outward normal: right of the edge direction for an anticlockwise ring.
      const normal = { x: winding * u.y, y: -winding * u.x };
      const t = thickness.thicknessM;
      const at = (s: number): PlanPoint => ({ x: a.x + u.x * s + normal.x * t, y: a.y + u.y * s + normal.y * t });
      return { length, u, normal, thickness, at, spans: unsharedSpans(edge, others) };
    });
    const n = sides.length;
    // The joined corner at the start of side k, when the outside walls on both sides reach it.
    const corner = (k: number): PlanPoint | null => {
      const prev = sides[(k + n - 1) % n];
      const side = sides[k];
      const prevReaches = prev.spans.length > 0 && prev.spans[prev.spans.length - 1][1] === prev.length;
      const reaches = side.spans.length > 0 && side.spans[0][0] === 0;
      return prevReaches && reaches ? lineIntersection(prev.at(0), prev.u, side.at(0), side.u) : null;
    };
    // ponytail: no mitre limit; a very sharp plate corner joins far out.
    sides.forEach((side, k) => {
      for (const [lo, hi] of side.spans) {
        const start = (lo === 0 && corner(k)) || side.at(lo);
        const end = (hi === side.length && corner((k + 1) % n)) || side.at(hi);
        walls.push({ face: [start, end], normal: side.normal, thickness: side.thickness });
      }
    });
  });
  return walls;
}

const unit = ([a, b]: Segment): PlanPoint => {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length === 0 ? { x: 0, y: 0 } : { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
};

/**
 * Context shading distance, measured at right angles from a wall of the dwelling to the object's
 * nearest face. Every wall counts, whatever is on its far side: an obstacle facing a party wall or
 * a wall to an adjacent space is still entered.
 *
 * For each wall the face is the one nearest it; between faces equally near, the one whose midpoint
 * is nearer the wall's line. The wall nearest its face wins; between walls equally near, one the
 * face is in front of (above 0) over one it is behind, then the one most nearly parallel to the face, then the one that faces the object most squarely. The distance
 * runs at right angles from that wall's outside-face line, which may be past the wall's end. When
 * the nearest point is an outside corner, where two walls meet equally near (owner decision 18 Nov),
 * the distance is the straight line from that corner to the object's nearest point. A result of 0
 * or less means the object touches or overlaps that wall.
 */
function measureFromWalls(
  coordinates: readonly PlanPoint[],
  walls: readonly Wall[],
  plates: readonly (readonly PlanPoint[])[],
): ContextShadingDistanceDetails | null {
  const objectFaces = faces(coordinates);
  const objectCenter = getPlanCenter([...coordinates])!;
  type Candidate = { gap: number; parallel: number; facing: number; distance: number; wall: Wall; to: PlanPoint };
  const beats = (c: Candidate, best: Candidate | null) => {
    if (!best) return true;
    if (c.gap < best.gap - 1e-9) return true;
    if (c.gap > best.gap + 1e-9) return false;
    // Equally near (a convex corner): the wall the object is in front of beats one it is behind.
    if ((c.distance > 0) !== (best.distance > 0)) return c.distance > 0;
    return c.parallel < best.parallel - 1e-9 || (c.parallel < best.parallel + 1e-9 && c.facing > best.facing);
  };
  let best: Candidate | null = null;
  const candidates: Candidate[] = [];
  for (const wall of walls) {
    const n = wall.normal;
    const [wa] = wall.face;
    const w = unit(wall.face);
    const wallMid = midpoint(wall.face);
    const perpendicular = (p: PlanPoint) => (p.x - wa.x) * n.x + (p.y - wa.y) * n.y;
    let face: { gap: number; offset: number; distance: number; mid: PlanPoint; side: Segment } | null = null;
    for (const candidate of objectFaces) {
      const gap = segmentDistance(wall.face, candidate);
      const mid = midpoint(candidate);
      const distance = perpendicular(mid);
      const offset = Math.abs(distance);
      if (!face || gap < face.gap - 1e-9 || (gap < face.gap + 1e-9 && offset < face.offset)) {
        face = { gap, offset, distance, mid, side: candidate };
      }
    }
    if (!face) continue;
    const f = unit(face.side);
    const candidate: Candidate = {
      gap: face.gap,
      parallel: Math.abs(w.x * f.y - w.y * f.x),
      facing: perpendicular(objectCenter) / (Math.hypot(objectCenter.x - wallMid.x, objectCenter.y - wallMid.y) || 1),
      distance: face.distance,
      wall,
      to: face.mid,
    };
    candidates.push(candidate);
    if (beats(candidate, best)) best = candidate;
  }
  if (!best) return null;
  let { to, distance, wall } = best;
  // The outside corner the gap ties at: an end of the chosen wall that another, non-parallel wall
  // also ends at, as near the object as the chosen wall is. An object that touches the walls or
  // reads behind the chosen wall keeps the reading above, for the overlap rule below.
  const chosen = best;
  const near = (p: PlanPoint, q: PlanPoint) => Math.hypot(p.x - q.x, p.y - q.y) <= 1e-9;
  const corner = chosen.gap > 1e-9 && chosen.distance > 0 ? chosen.wall.face.find((c) =>
    Math.abs(Math.min(...objectFaces.map((side) => pointSegmentDistance(c, side))) - chosen.gap) <= 1e-9 &&
    candidates.some((o) => {
      const [u, v] = [unit(o.wall.face), unit(chosen.wall.face)];
      return o !== chosen && Math.abs(o.gap - chosen.gap) <= 1e-9 && o.wall.face.some((p) => near(p, c)) && Math.abs(u.x * v.y - u.y * v.x) > 1e-6;
    })) : undefined;
  let from: PlanPoint | null = null;
  if (corner) {
    to = objectFaces.map((side) => closestPointOnSegment(corner, side))
      .reduce((a, b) => (Math.hypot(b.x - corner.x, b.y - corner.y) < Math.hypot(a.x - corner.x, a.y - corner.y) ? b : a));
    distance = chosen.gap;
    from = corner;
  }
  // The rule above measures to a midpoint, so an object across a wall's outside face, or inside the
  // dwelling, can still read above 0. Such an object reads min(perpendicular at each end, 0) from
  // the wall it meets, else from the wall chosen above when it lies inside.
  if (distance > 0) {
    const perpendicular = (p: PlanPoint, w: Wall) => (p.x - w.face[0].x) * w.normal.x + (p.y - w.face[0].y) * w.normal.y;
    const deepest = (points: readonly PlanPoint[], w: Wall) =>
      points.reduce((a, b) => (perpendicular(b, w) < perpendicular(a, w) ? b : a));
    let overlap: { distance: number; wall: Wall; to: PlanPoint } | null = null;
    for (const w of walls) {
      for (const side of objectFaces) {
        if (!segmentsMeet(side, w.face)) continue;
        const end = deepest(side, w);
        const d = Math.min(perpendicular(end, w), 0);
        if (!overlap || d > overlap.distance) overlap = { distance: d, wall: w, to: end };
      }
    }
    if (!overlap && coordinates.some((p) => insideDwelling(p, walls, plates))) {
      const end = deepest(coordinates, wall);
      overlap = { distance: Math.min(perpendicular(end, wall), 0), wall, to: end };
    }
    if (overlap) {
      ({ distance, wall, to } = overlap);
      from = null;
    }
  }
  return {
    distance: roundToTwoDecimals(distance),
    thickness: wall.thickness,
    from: from ?? { x: to.x - wall.normal.x * distance, y: to.y - wall.normal.y * distance },
    to,
    wall: wall.face,
  };
}

/** {@link measureFromWalls} with one floor's edges standing in for the walls. */
export function contextShadingDistanceDetails(
  contextShading: Pick<ContextShading, 'coordinates'>,
  parentElement: ContextShadingPlate,
  elements: readonly ModelElement[],
): ContextShadingDistanceDetails | null {
  if (!contextShading.coordinates?.length || (parentElement.coordinates?.length ?? 0) < 3) return null;
  return measureFromWalls(contextShading.coordinates, dwellingWalls([parentElement], elements), [distinctRing(parentElement.coordinates)]);
}

/** Where every Context Shading object in a model is measured from. */
export type ContextShadingCentre = {
  /** The area-weighted centroid of the plates: the origin of every direction. */
  point: PlanPoint;
  /** The floor plates whose outside edges are the dwelling's walls. */
  plates: readonly ContextShadingPlate[];
};

/** The centre of a set of floor plates, with their coordinates as written: their area-weighted centroid. */
export function contextShadingCentre(drawnPlates: readonly ContextShadingPlate[]): ContextShadingCentre {
  const plates = drawnPlates.map((plate) => (plate.coordinates ? { ...plate, coordinates: plate.coordinates.map(asWritten) } : plate));
  let area = 0;
  let x = 0;
  let y = 0;
  for (const plate of plates) {
    const ring = openRing(plate.coordinates ?? []);
    const c = getPlanCenter(ring);
    if (!c) continue;
    const a = Math.abs(ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0)) / 2;
    area += a;
    x += a * c.x;
    y += a * c.y;
  }
  const point = area > 0 ? { x: x / area, y: y / area } : getPlanCenter(plates.flatMap((p) => openRing(p.coordinates ?? []))) ?? { x: 0, y: 0 };
  return { point, plates };
}

/**
 * The Metadata row that lets the converter join neighbouring parts of an object at the nearer
 * distance when the model needs more shaded segments than HEM takes. The converter's over-limit
 * error names it, so a fix action can key on {@link isContextShadingJoinPartsError}.
 */
export const CONTEXT_SHADING_JOIN_PARTS_METADATA_KEY = 'ContextShadingJoinParts';

/** True for the converter's over-limit error that offers joining parts. */
export const isContextShadingJoinPartsError = (message: string | undefined): boolean =>
  !!message?.includes(`${CONTEXT_SHADING_JOIN_PARTS_METADATA_KEY} to TRUE`);

/** Plates within this height of each other are on one storey. */
export const SAME_FLOOR_TOLERANCE_M = 0.25;

/** A ground floor, or a walkable horizontal floor polygon: an element the dwelling stands on. */
export function isFloorPlate(element: Element): boolean {
  return element.type === 'BuildingElementGround' || isWalkableFloorHorizontalPolygon(element);
}

export type FloorPlate = { element: Element; areaM2: number; baseM: number };

/** Every floor plate with an area, and its base height. */
export function floorPlates(elements: Element[], floors: Floor[]): FloorPlate[] {
  const effectiveFloors = withEffectiveStoreyHeights(floors, elements) ?? [];
  return elements.flatMap((element) => {
    if (element.isPlaceholder || !isFloorPlate(element) || (element.coordinates?.length ?? 0) < 3) return [];
    const areaM2 = Math.abs(calculatePolygonArea(element.coordinates));
    return areaM2 > 0 ? [{ element, areaM2, baseM: elementBaseElevationMForTb(element, effectiveFloors) }] : [];
  });
}

/** The floor plates of the dwelling's lowest occupied storey, largest first. */
export function lowestOccupiedPlates(elements: Element[], floors: Floor[]): FloorPlate[] {
  const plates = floorPlates(elements, floors);
  const lowestBase = Math.min(...plates.map((plate) => plate.baseM));
  const near = plates.filter((plate) => plate.baseM - lowestBase <= SAME_FLOOR_TOLERANCE_M);
  // Storeys with no height yet share a base: the lowest storey index decides.
  const storey = (plate: FloorPlate) => getElementCanvasFloorZValue(plate.element, floors) ?? 0;
  const lowestStorey = Math.min(...near.map(storey));
  return near
    .filter((plate) => storey(plate) === lowestStorey)
    .sort((a, b) => b.areaM2 - a.areaM2);
}

export const CONTEXT_SHADING_PARENT_NOT_FLOOR = 'The shading centre must be a floor of the dwelling.';

/**
 * The `parent_element` value that means the model's default shading centre: every floor plate of
 * the lowest occupied storey. An element may not take this name. A blank parent is not the
 * default: the object keeps the values it states and nothing is derived (files written before
 * the default centre existed open unchanged).
 */
export const CONTEXT_SHADING_DEFAULT_CENTRE = 'DefaultCentre';

export const CONTEXT_SHADING_RESERVED_NAME = `${CONTEXT_SHADING_DEFAULT_CENTRE} is kept for the default shading centre. Rename this element.`;

/**
 * The model's shading centre. {@link CONTEXT_SHADING_DEFAULT_CENTRE} is every floor plate of the
 * lowest occupied storey; a floor's name is that floor alone. Null for a blank parent, or for the
 * default when the model has no floor plate.
 */
export function resolveContextShadingCentre(
  elements: Element[],
  floors: Floor[],
  parentName: string | null | undefined,
): ContextShadingCentre | { issue: string } | null {
  if (!parentName) return null;
  if (parentName === CONTEXT_SHADING_DEFAULT_CENTRE) {
    const plates = lowestOccupiedPlates(elements, floors);
    return plates.length > 0 ? contextShadingCentre(plates.map((plate) => plate.element)) : null;
  }
  const parent = elements.find((element) => element.name === parentName);
  return parent && floorPlates([parent], floors).length > 0
    ? contextShadingCentre([parent])
    : { issue: CONTEXT_SHADING_PARENT_NOT_FLOOR };
}

export type ContextShadingDerivedPart = ContextShadingPart & {
  /** Index of the object's edge this part sees (from the first coordinate). */
  face: number;
  /** The measured points: on the wall's outside face, and on the visible face. */
  from: PlanPoint;
  to: PlanPoint;
  /** The measured wall's outside-face stretch. */
  wall: Segment;
  /** The stretch of the face the centre sees, from the part's start to its end. */
  stretch: Segment;
  thickness: ContextShadingWallThickness;
};

export type ContextShadingDerivation =
  | {
    /** The envelope, as the row stores it: first part's start and last part's end (2 dp), nearest distance. */
    start_angle: number;
    end_angle: number;
    distance: number;
    parts: ContextShadingDerivedPart[];
  }
  | { issue: string };

export const CONTEXT_SHADING_CROSSES_ITSELF = 'The outline crosses itself. Redraw it so that no edges cross.';
export const CONTEXT_SHADING_COVERS_CENTRE = "The object covers the shading centre. Draw it outside the dwelling.";
export const CONTEXT_SHADING_NO_WALLS = "The dwelling's floor has no outside edge to measure the distance from. Check the floor outline.";
export const CONTEXT_SHADING_TOO_NARROW = "This object is narrower than 1° seen from the shading centre, so HEM can't take it.";

const direction = (azimuth: number): PlanPoint => ({ x: Math.sin(azimuth * Math.PI / 180), y: Math.cos(azimuth * Math.PI / 180) });

/** Where the ray from `o` at `azimuth` meets the line through a-b: the ray length and the position along a-b. */
function rayLine(o: PlanPoint, azimuth: number, [a, b]: Segment): { t: number; u: number } | null {
  const d = direction(azimuth);
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-12) return null;
  return {
    t: ((a.x - o.x) * ey - (a.y - o.y) * ex) / den,
    u: ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den,
  };
}

/** A stored angle: raw azimuth less the north offset, in [0, 360), to 2 dp. */
const storedAngle = (azimuth: number, offsetDeg: number) => {
  const angle = roundToTwoDecimals(normalizeDegrees(azimuth - offsetDeg));
  return angle === 360 ? 0 : angle;
};

/**
 * Splits a Context Shading object into one part per face the centre sees.
 *
 * Every vertex's azimuth from the centre bounds a slice; the ray at a slice's mid-angle meets the
 * nearest edge, the face seen there. Consecutive slices on the same face join. A part's distance is
 * the visible stretch of its face measured as a one-face object. Angles lose the north offset and
 * round to whole degrees; a part whose rounded ends are equal is dropped. Parts run clockwise from
 * the object's start. The envelope is the first part's start, the last part's end and the smallest
 * distance. Returns null for an object with no coordinates.
 */
export function deriveContextShading(
  contextShading: Pick<ContextShading, 'coordinates'>,
  centre: ContextShadingCentre,
  elements: readonly ModelElement[],
  offsetDeg = 0,
): ContextShadingDerivation | null {
  if (!contextShading.coordinates?.length) return null;
  const ring = distinctRing(contextShading.coordinates.map(asWritten));
  const o = centre.point;
  if (ring.length >= 3 && hasSelfIntersectingPolygonEdges(ring)) return { issue: CONTEXT_SHADING_CROSSES_ITSELF };
  const edges: Segment[] = ring.length === 2 ? [[ring[0], ring[1]]] : ring.length > 2 ? faces(ring) : [];
  // Inside, or an edge through it (a line drawn across the dwelling).
  if ((ring.length >= 3 && isPointInPolygon2D(o, ring)) || edges.some((edge) => pointSegmentDistance(o, edge) <= 1e-9)) {
    return { issue: CONTEXT_SHADING_COVERS_CENTRE };
  }

  const bounds = ring.map((p) => pointAzimuthDeg(p, o)).sort((a, b) => a - b)
    .filter((a, i, all) => i === 0 || a - all[i - 1] > 1e-9);
  // Each slice: the face its mid-angle ray meets first, or -1 for none.
  const slices = bounds.map((from, i) => {
    const to = i + 1 < bounds.length ? bounds[i + 1] : bounds[0] + 360;
    let face = -1;
    let nearest = Infinity;
    edges.forEach((edge, k) => {
      const hit = rayLine(o, (from + to) / 2, edge);
      if (hit && hit.t > 1e-9 && hit.u >= -1e-9 && hit.u <= 1 + 1e-9 && hit.t < nearest) {
        nearest = hit.t;
        face = k;
      }
    });
    return { from, to, face };
  });
  // Start after the slice that sees nothing: the object's start, clockwise.
  const open = slices.findIndex((slice) => slice.face < 0);
  const ordered = [...slices.slice(open + 1), ...slices.slice(0, open + 1)].filter((slice) => slice.face >= 0);
  const runs: { from: number; to: number; face: number }[] = [];
  for (const slice of ordered) {
    const last = runs[runs.length - 1];
    if (last && last.face === slice.face) last.to += slice.to - slice.from;
    else runs.push({ ...slice });
  }
  // Seen all round: the last run continues into the first across its start.
  if (open < 0 && runs.length > 1 && runs[0].face === runs[runs.length - 1].face) {
    runs[0].from = runs.pop()!.from - 360;
  }

  const walls = dwellingWalls(centre.plates, elements);
  const plateRings = centre.plates.map((plate) => distinctRing(plate.coordinates ?? []));
  const parts: ContextShadingDerivedPart[] = [];
  const seen: { from: number; to: number }[] = [];
  for (const run of runs) {
    const start = Math.round(storedAngle(run.from, offsetDeg)) % 360;
    const end = Math.round(storedAngle(run.to, offsetDeg)) % 360;
    if (start === end) continue;
    const edge = edges[run.face];
    const at = (azimuth: number): PlanPoint => {
      const hit = rayLine(o, azimuth, edge);
      const u = hit ? Math.max(0, Math.min(1, hit.u)) : 0;
      return { x: edge[0].x + (edge[1].x - edge[0].x) * u, y: edge[0].y + (edge[1].y - edge[0].y) * u };
    };
    const stretch: Segment = [at(run.from), at(run.to)];
    const measured = measureFromWalls(stretch, walls, plateRings);
    if (!measured) return { issue: CONTEXT_SHADING_NO_WALLS };
    parts.push({
      start_angle: start,
      end_angle: end,
      distance: measured.distance,
      face: run.face,
      from: measured.from,
      to: measured.to,
      wall: measured.wall,
      thickness: measured.thickness,
      stretch,
    });
    seen.push(run);
  }
  if (parts.length === 0) return { issue: CONTEXT_SHADING_TOO_NARROW };
  return {
    start_angle: storedAngle(seen[0].from, offsetDeg),
    end_angle: storedAngle(seen[seen.length - 1].to, offsetDeg),
    distance: Math.min(...parts.map((part) => part.distance)),
    parts,
  };
}

/**
 * The stored fields a derivation gives an element: the envelope, and `parts` only when there are
 * two or more (undefined clears a stale list).
 */
export function contextShadingStoredFields(
  derived: Exclude<ContextShadingDerivation, { issue: string }>,
): Pick<ContextShading, 'start_angle' | 'end_angle' | 'distance' | 'parts'> {
  return {
    start_angle: derived.start_angle,
    end_angle: derived.end_angle,
    distance: derived.distance,
    parts: derived.parts.length > 1
      ? derived.parts.map(({ start_angle, end_angle, distance }) => ({ start_angle, end_angle, distance }))
      : undefined,
  };
}

/**
 * A generated Development neighbour's derivation: only the parts HEM can take, those with a distance
 * above 0 (a part at or below 0 stands beside the dwelling). Null when none is left. The sync, the
 * load, the store, validation, the form and the plan all use it, so a neighbour reads as the sync
 * wrote it.
 */
export function generatedNeighbourDerivation(
  derived: Exclude<ContextShadingDerivation, { issue: string }>,
): Exclude<ContextShadingDerivation, { issue: string }> | null {
  const kept = derived.parts.filter((part) => part.distance > 0);
  if (kept.length === 0) return null;
  if (kept.length === derived.parts.length) return derived;
  return {
    start_angle: kept[0].start_angle,
    end_angle: kept[kept.length - 1].end_angle,
    distance: Math.min(...kept.map((part) => part.distance)),
    parts: kept,
  };
}

/** The stored fields of a generated Development neighbour ({@link generatedNeighbourDerivation}). */
export function generatedNeighbourStoredFields(
  derived: Exclude<ContextShadingDerivation, { issue: string }>,
): ReturnType<typeof contextShadingStoredFields> | null {
  const kept = generatedNeighbourDerivation(derived);
  return kept && contextShadingStoredFields(kept);
}

/**
 * Derives a Context Shading element from its drawing and the model's centre for its parent.
 * Null when there is nothing to derive from (no coordinates, or no floor); `{ issue }` when the
 * drawing or the parent cannot give parts.
 */
export function deriveContextShadingInModel(
  contextShading: Pick<ContextShading, 'coordinates' | 'parent_element'>,
  elements: Element[],
  floors: Floor[],
  offsetDeg: number,
): ContextShadingDerivation | null {
  if (!contextShading.coordinates?.length) return null;
  const centre = resolveContextShadingCentre(elements, floors, contextShading.parent_element);
  if (!centre || 'issue' in centre) return centre;
  return deriveContextShading(contextShading, centre, elements, offsetDeg);
}

/** A typed edit to a 2-point line object: its distance, or the direction of its start or end. */
export type ContextShadingLineEdit = { field: 'distance' | 'start_angle' | 'end_angle'; value: number };

/**
 * The coordinates that give a 2-point line object the typed value: Distance moves the whole line
 * along its measured wall's outward normal; Start or End moves that endpoint along the line until
 * its direction from the centre is the value. A `refusal` in plain words, changing nothing, when the
 * object is not a line, the move is impossible, or re-derivation does not return the typed value
 * with one valid part.
 */
export function planContextShadingLineEdit(
  contextShading: Pick<ContextShading, 'coordinates' | 'parent_element'>,
  elements: Element[],
  floors: Floor[],
  offsetDeg: number,
  edit: ContextShadingLineEdit,
): { coordinates: ContextShading['coordinates'] } | { refusal: string } {
  const coords = contextShading.coordinates ?? [];
  if (coords.length !== 2 || !Number.isFinite(edit.value)) return { refusal: 'This object is not a line.' };
  if (edit.field === 'distance' && !(edit.value > 0)) return { refusal: 'Distance must be above 0 m.' };
  const unmeasurable = { refusal: "This line can't be measured from the shading centre." };
  const centre = resolveContextShadingCentre(elements, floors, contextShading.parent_element);
  if (!centre || 'issue' in centre) return unmeasurable;
  const derived = deriveContextShading(contextShading, centre, elements, offsetDeg);
  if (!derived || 'issue' in derived || derived.parts.length !== 1) return unmeasurable;
  const [a, b] = coords;
  let next: ContextShading['coordinates'];
  if (edit.field === 'distance') {
    const { wall, from, to } = derived.parts[0];
    const w = unit(wall);
    let n = { x: w.y, y: -w.x };
    // Outward: away from the centre.
    if ((centre.point.x - wall[0].x) * n.x + (centre.point.y - wall[0].y) * n.y > 0) n = { x: -n.x, y: -n.y };
    const delta = edit.value - ((to.x - from.x) * n.x + (to.y - from.y) * n.y);
    next = coords.map((p) => ({ ...p, x: p.x + n.x * delta, y: p.y + n.y * delta }));
  } else {
    const other = edit.field === 'start_angle' ? derived.end_angle : derived.start_angle;
    // Whole degrees, as the edit is stored.
    if (normalizeDegrees(edit.value) === normalizeDegrees(Math.round(other))) return { refusal: 'From and To must differ.' };
    // The endpoint seen at the part's start is the line's start.
    const startIndex = Math.abs(normalizeDegrees(pointAzimuthDeg(a, centre.point) - offsetDeg - derived.start_angle + 180) - 180) <
      Math.abs(normalizeDegrees(pointAzimuthDeg(b, centre.point) - offsetDeg - derived.start_angle + 180) - 180) ? 0 : 1;
    const moved = edit.field === 'start_angle' ? startIndex : 1 - startIndex;
    const hit = rayLine(centre.point, edit.value + offsetDeg, [a, b]);
    if (!hit || !(hit.t > 1e-9)) return { refusal: "The line doesn't reach that direction from the centre." };
    const point = { ...coords[moved], x: a.x + (b.x - a.x) * hit.u, y: a.y + (b.y - a.y) * hit.u };
    next = moved === 0 ? [point, b] : [a, point];
  }
  const result = deriveContextShading({ coordinates: next }, centre, elements, offsetDeg);
  if (!result || 'issue' in result || result.parts.length !== 1) return { refusal: 'That would move the line through the dwelling.' };
  const typed = edit.field === 'distance' ? roundToTwoDecimals(edit.value) : storedAngle(edit.value, 0);
  return result[edit.field] === typed ? { coordinates: next } : { refusal: "That value can't be reached without changing which wall the line is measured from." };
}

/** The coordinates {@link planContextShadingLineEdit} gives, or null when it refuses. */
export function moveContextShadingLine(
  ...args: Parameters<typeof planContextShadingLineEdit>
): ContextShading['coordinates'] | null {
  const plan = planContextShadingLineEdit(...args);
  return 'coordinates' in plan ? plan.coordinates : null;
}

const sameParts = (a: ContextShading['parts'], b: ContextShading['parts']) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Re-derives every drawn Context Shading's angles, distance and parts from its drawing and the
 * model's centre, so stored values always match the drawing. A row without coordinates keeps
 * what it states. Returns the input array unchanged when nothing differs.
 *
 * `typed` applies the target's numeric typing (integer angles on some targets), as the load does
 * to the stored values: a value the target stores rounded is not a change. `generated` marks a
 * Development neighbour, which keeps only its parts above 0 as the sync writes it; one with none
 * left is kept as stored for the next sync to remove.
 */
export function rederiveContextShadingFromDrawing<T extends Element>(
  elements: readonly T[],
  floors: Floor[],
  globalOffsetDeg: number,
  typed: (element: T) => T = (element) => element,
  generated: (element: T) => boolean = () => false,
): T[] {
  let changed = false;
  const next = elements.map((element) => {
    if (element.type !== 'ContextShading') return element;
    const shading = element as unknown as ContextShading;
    const derived = deriveContextShadingInModel(shading, elements as unknown as Element[], floors, globalOffsetDeg);
    if (!derived || 'issue' in derived) return element;
    const fields = generated(element) ? generatedNeighbourStoredFields(derived) : contextShadingStoredFields(derived);
    if (!fields) return element;
    // A copy down to extra_json: the typing coerces in place.
    const copy = { ...element, ...fields, extra_json: element.extra_json && { ...element.extra_json } } as unknown as ContextShading;
    if (!copy.parts) delete copy.parts;
    const candidate = typed(copy as unknown as T) as unknown as ContextShading;
    if (candidate.start_angle === shading.start_angle && candidate.end_angle === shading.end_angle &&
        candidate.distance === shading.distance && sameParts(candidate.parts, shading.parts)) {
      return element;
    }
    changed = true;
    return candidate as unknown as T;
  });
  return changed ? next : (elements as T[]);
}
