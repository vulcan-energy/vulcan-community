// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { SpaceLabel, Element } from '../geometry/types';
import { getTreatedFloorElements } from './zoneDerivation';
import { signedShoelaceArea2 } from './spaceInference/signedArea';
import { refineWallSegments, type RawSeg } from './spaceInference/refineWallSegments';
import type { PlanarPoint2, WallSegment2D } from './spaceInference/types';

const EPS = 0.001;
const MIN_FACE_AREA_M2 = 0.0001;
/** Below this, an overlap is drawing tolerance and counts once. Above it, the area is excluded and warned. */
const SPACE_LABEL_OVERLAP_WARNING_M2 = 0.1;

/** A treated-area difference this large is an error; smaller ones are label rounding. */
export function isMaterialTreatedAreaDifference(differenceM2: number, referenceM2: number): boolean {
  return differenceM2 > 1 && differenceM2 / referenceM2 > 0.01;
}

export type SpaceLabelGeometryIssue = {
  kind: 'overlap';
  labelIds: string[];
  areaM2: number;
};

export type SpaceLabelStoreyCoverage = {
  labelledM2: number;
  outsideM2: number;
  outsideLabelIds: Set<string>;
};

export type SpaceLabelGeometryAnalysis = {
  effectiveAreasByLabelId: Record<string, number>;
  issues: SpaceLabelGeometryIssue[];
  storeyCoverage: Map<number, SpaceLabelStoreyCoverage>;
};

type HalfEdge = {
  origin: number;
  dest: number;
  twin: number;
  next: number;
};

type Face = {
  ring: PlanarPoint2[];
  area: number;
  netArea: number;
  sample: PlanarPoint2;
};

function ringArea(ring: PlanarPoint2[]): number {
  return Math.abs(signedShoelaceArea2(ring));
}

function quantize(p: PlanarPoint2, eps: number): PlanarPoint2 {
  return {
    x: Math.round(p.x / eps) * eps,
    y: Math.round(p.y / eps) * eps,
  };
}

function vertexKey(p: PlanarPoint2, eps: number): string {
  const q = quantize(p, eps);
  return `${q.x.toFixed(8)},${q.y.toFixed(8)}`;
}

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
    if (!byOrigin.has(h.origin)) byOrigin.set(h.origin, []);
    byOrigin.get(h.origin)!.push(hi);
  }

  for (const hiList of byOrigin.values()) {
    hiList.sort((ha, hb) => {
      const a = verts[hes[ha]!.dest]!;
      const b = verts[hes[hb]!.dest]!;
      const o = verts[hes[ha]!.origin]!;
      return Math.atan2(a.y - o.y, a.x - o.x) - Math.atan2(b.y - o.y, b.x - o.x);
    });
    const n = hiList.length;
    for (let i = 0; i < n; i++) {
      const hi = hiList[i]!;
      const hPrev = hiList[(i - 1 + n) % n]!;
      hes[hi]!.next = hes[hPrev]!.twin;
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
  if (he !== startHe || ring.length < 3) return null;
  return ring;
}

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
  return rings.filter((ring) => signedShoelaceArea2(ring) > 0 && ringArea(ring) >= MIN_FACE_AREA_M2);
}

import { isPointInPolygon2D as pointInPolygon } from './pointInPolygon';

export { pointInPolygon };

function centroid(ring: PlanarPoint2[]): PlanarPoint2 {
  return {
    x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
    y: ring.reduce((s, p) => s + p.y, 0) / ring.length,
  };
}

function findSamplePoint(ring: PlanarPoint2[], childRings: PlanarPoint2[][]): PlanarPoint2 {
  const candidates: PlanarPoint2[] = [centroid(ring)];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    candidates.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    candidates.push(a);
  }
  for (const p of candidates) {
    if (!pointInPolygon(p, ring)) continue;
    if (childRings.some((child) => pointInPolygon(p, child))) continue;
    return p;
  }
  return candidates[0]!;
}

function polygonSegments(ring: Array<{ x: number; y: number }>, wallZIndex: number): WallSegment2D[] {
  const out: WallSegment2D[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    out.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, wallZIndex });
  }
  return out;
}

/**
 * True only for a disconnected island inside `parent`. Adjacent faces never qualify: a bent strip's
 * vertex average can land inside its neighbour, so every vertex must be strictly inside.
 */
function isNestedFace(candidate: Face, parent: Face): boolean {
  if (candidate.area >= parent.area) return false;
  const parentVertices = new Set(parent.ring.map((vertex) => vertexKey(vertex, EPS)));
  return candidate.ring.every(
    (vertex) => !parentVertices.has(vertexKey(vertex, EPS)) && pointInPolygon(vertex, parent.ring),
  );
}

function buildFaces(segments: WallSegment2D[]): Face[] {
  const refined = refineWallSegments(segments, EPS);
  const { verts, hes } = buildHalfEdges(refined, EPS);
  const rings = enumerateFaces(hes, verts);
  const faces = rings.map((ring) => ({ ring, area: ringArea(ring), netArea: ringArea(ring), sample: centroid(ring) }));

  for (let i = 0; i < faces.length; i++) {
    const parent = faces[i]!;
    const children = faces.filter((candidate, j) => i !== j && isNestedFace(candidate, parent));
    const immediateChildren = children.filter(
      (child) => !children.some((other) => other !== child && isNestedFace(child, other)),
    );
    parent.netArea = Math.max(0, parent.area - immediateChildren.reduce((s, child) => s + child.area, 0));
    parent.sample = findSamplePoint(parent.ring, immediateChildren.map((child) => child.ring));
  }

  return faces.filter((face) => face.netArea >= MIN_FACE_AREA_M2);
}

function treatedFloorElementsAtLevel(zoneId: string, elements: Element[], storeyZ: number): Element[] {
  return getTreatedFloorElements(elements.filter((el) => el.zoneId === zoneId))
    .filter((el) => Math.abs(Math.min(...el.coordinates.map((c) => c.z)) - storeyZ) < 0.05);
}

const planRing = (coordinates: ReadonlyArray<{ x: number; y: number }>): PlanarPoint2[] =>
  coordinates.map((c) => ({ x: c.x, y: c.y }));

export function getTreatedFloorBoundaryPolygonsForZone(
  zoneId: string,
  elements: Element[],
  storeyZ: number,
): PlanarPoint2[][] {
  return treatedFloorElementsAtLevel(zoneId, elements, storeyZ).map((el) => planRing(el.coordinates));
}

export function analyzeSpaceLabelGeometry(
  labels: SpaceLabel[],
  floorBoundariesByStorey: Map<number, PlanarPoint2[][]> = new Map(),
): SpaceLabelGeometryAnalysis {
  const effectiveAreasByLabelId: Record<string, number> = {};
  const issues: SpaceLabelGeometryIssue[] = [];
  const storeyCoverage = new Map<number, SpaceLabelStoreyCoverage>();
  for (const label of labels) effectiveAreasByLabelId[label.id] = 0;

  const storeys = new Set(labels.map((label) => label.storey));
  for (const storey of storeys) {
    const labelsOnStorey = labels.filter((label) => label.storey === storey && label.coordinates.length >= 3);
    const floorBoundaries = floorBoundariesByStorey.get(storey) ?? [];
    const segments = [
      ...labelsOnStorey.flatMap((label) => polygonSegments(label.coordinates, storey)),
      ...floorBoundaries.flatMap((ring) => polygonSegments(ring, storey)),
    ];
    if (segments.length === 0) continue;
    const faces = buildFaces(segments);

    for (const face of faces) {
      const containingLabels = labelsOnStorey.filter((label) =>
        pointInPolygon(face.sample, label.coordinates.map((c) => ({ x: c.x, y: c.y }))),
      );
      if (containingLabels.length === 0) continue;

      const inFloor =
        floorBoundaries.length === 0 ||
        floorBoundaries.some((boundary) => pointInPolygon(face.sample, boundary));
      const typedContainingLabels = containingLabels.filter((label) => String(label.room_type || '').trim() !== '');

      if (typedContainingLabels.length > 0) {
        const coverage = storeyCoverage.get(storey) ?? { labelledM2: 0, outsideM2: 0, outsideLabelIds: new Set<string>() };
        storeyCoverage.set(storey, coverage);
        coverage.labelledM2 += face.netArea;
        if (!inFloor) {
          coverage.outsideM2 += face.netArea;
          typedContainingLabels.forEach((label) => coverage.outsideLabelIds.add(label.id));
        }
      }

      if (!inFloor) continue;

      if (typedContainingLabels.length > 1 && face.netArea >= SPACE_LABEL_OVERLAP_WARNING_M2) {
        issues.push({
          kind: 'overlap',
          labelIds: typedContainingLabels.map((label) => label.id),
          areaM2: face.netArea,
        });
        continue;
      }

      const countingLabel = typedContainingLabels[0];
      if (countingLabel) {
        effectiveAreasByLabelId[countingLabel.id] = (effectiveAreasByLabelId[countingLabel.id] ?? 0) + face.netArea;
      }
    }
  }

  return { effectiveAreasByLabelId, issues, storeyCoverage };
}

/**
 * The one analysis behind every treated-area figure. Each label's own plan level finds its floors:
 * `label.storey` is only an index, and the editor and a parsed CSV can hold different floor lists.
 */
export function analyzeZoneSpaceLabels(
  zoneId: string,
  labels: SpaceLabel[],
  elements: Element[],
): SpaceLabelGeometryAnalysis {
  const zoneLabels = labels.filter((label) => label.zoneId === zoneId);
  const floorBoundariesByStorey = new Map<number, PlanarPoint2[][]>();
  for (const storey of new Set(zoneLabels.map((label) => label.storey))) {
    const storeyLabels = zoneLabels.filter((label) => label.storey === storey && label.coordinates.length >= 3);
    const level = storeyLabels[0]?.coordinates[0]?.z;
    if (level === undefined) continue;
    const floors = treatedFloorElementsAtLevel(zoneId, elements, level);
    const rings = floors.map((el) => planRing(el.coordinates));
    // ponytail: size test. A pitch-0 partition covering under half the labels reads as a ceiling, so the storey stays unclipped.
    const onlyPitchZeroPartitions = floors.every(
      (el) => el.type !== 'BuildingElementGround' && (el as { pitch?: number }).pitch !== 180,
    );
    const floorArea = rings.reduce((sum, ring) => sum + ringArea(ring), 0);
    const labelledArea = storeyLabels.reduce((sum, label) => sum + ringArea(planRing(label.coordinates)), 0);
    if (rings.length > 0 && !(onlyPitchZeroPartitions && floorArea < labelledArea / 2)) {
      floorBoundariesByStorey.set(storey, rings);
    }
  }
  return analyzeSpaceLabelGeometry(zoneLabels, floorBoundariesByStorey);
}
