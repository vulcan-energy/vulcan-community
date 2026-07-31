// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../stores/geometryStore';
import type { SpaceLabel } from '../geometry/types';
import { isWalkableFloorHorizontalPolygon } from './zoneDerivation';
import { signedShoelaceArea2 } from './spaceInference/signedArea';
import { refineWallSegments, type RawSeg } from './spaceInference/refineWallSegments';
import type { PlanarPoint2, WallSegment2D } from './spaceInference/types';

const EPS = 0.001;
const MIN_FACE_AREA_M2 = 0.0001;
export const SPACE_LABEL_WARNING_AREA_TOLERANCE_M2 = 0.02;
export const SPACE_LABEL_WARNING_RATIO_TOLERANCE = 0.001;

export type SpaceLabelGeometryIssue =
  | {
      kind: 'overlap';
      labelIds: string[];
      areaM2: number;
    }
  | {
      kind: 'outside_floor';
      labelId: string;
      areaM2: number;
    };

export type SpaceLabelGeometryAnalysis = {
  effectiveAreasByLabelId: Record<string, number>;
  issues: SpaceLabelGeometryIssue[];
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

function buildFaces(segments: WallSegment2D[]): Face[] {
  const refined = refineWallSegments(segments, EPS);
  const { verts, hes } = buildHalfEdges(refined, EPS);
  const rings = enumerateFaces(hes, verts);
  const faces = rings.map((ring) => ({ ring, area: ringArea(ring), netArea: ringArea(ring), sample: centroid(ring) }));

  for (let i = 0; i < faces.length; i++) {
    const parent = faces[i]!;
    const children = faces.filter((candidate, j) => {
      if (i === j || candidate.area >= parent.area) return false;
      return pointInPolygon(centroid(candidate.ring), parent.ring);
    });
    const immediateChildren = children.filter(
      (child) => !children.some((other) => other !== child && other.area < child.area && pointInPolygon(centroid(other.ring), child.ring)),
    );
    parent.netArea = Math.max(0, parent.area - immediateChildren.reduce((s, child) => s + child.area, 0));
    parent.sample = findSamplePoint(parent.ring, immediateChildren.map((child) => child.ring));
  }

  return faces.filter((face) => face.netArea >= MIN_FACE_AREA_M2);
}

export function getTreatedFloorBoundaryPolygonsForZone(
  zoneId: string,
  elements: Element[],
  storeyZ: number,
): PlanarPoint2[][] {
  return elements
    .filter((el) => el.zoneId === zoneId)
    .filter((el) => el.type === 'BuildingElementGround' || isWalkableFloorHorizontalPolygon(el))
    .filter((el) => el.coordinates?.length >= 3)
    .filter((el) => Math.abs(Math.min(...el.coordinates.map((c) => c.z)) - storeyZ) < 0.05)
    .map((el) => el.coordinates.map((c) => ({ x: c.x, y: c.y })));
}

function issueAreaIsMaterial(area: number, relatedAreas: number[]): boolean {
  if (area >= SPACE_LABEL_WARNING_AREA_TOLERANCE_M2) return true;
  const smallest = Math.min(...relatedAreas.filter((a) => a > 0));
  return smallest > 0 && area / smallest >= SPACE_LABEL_WARNING_RATIO_TOLERANCE;
}

export function analyzeSpaceLabelGeometry(
  labels: SpaceLabel[],
  floorBoundariesByStorey: Map<number, PlanarPoint2[][]> = new Map(),
): SpaceLabelGeometryAnalysis {
  const effectiveAreasByLabelId: Record<string, number> = {};
  const issues: SpaceLabelGeometryIssue[] = [];
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
      const relatedAreas = containingLabels.map((label) => ringArea(label.coordinates.map((c) => ({ x: c.x, y: c.y }))));

      if (!inFloor) {
        for (const label of containingLabels) {
          if (issueAreaIsMaterial(face.netArea, relatedAreas)) {
            issues.push({ kind: 'outside_floor', labelId: label.id, areaM2: face.netArea });
          }
        }
        continue;
      }

      if (typedContainingLabels.length > 1) {
        if (issueAreaIsMaterial(face.netArea, relatedAreas)) {
          issues.push({
            kind: 'overlap',
            labelIds: typedContainingLabels.map((label) => label.id),
            areaM2: face.netArea,
          });
        }
        continue;
      }

      if (typedContainingLabels.length === 1) {
        const label = typedContainingLabels[0]!;
        effectiveAreasByLabelId[label.id] = (effectiveAreasByLabelId[label.id] ?? 0) + face.netArea;
      }
    }
  }

  return { effectiveAreasByLabelId, issues };
}
