// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { BuildingElementOpaque, Element, OnSiteGeneration } from '../geometry/types';
import { inwardNormal2DForSlopedRoof } from './roofTopElevationAtPlanM';

type Pt2 = { x: number; y: number };

export const PV_PARTY_WALL_CLEARANCE_GUIDANCE_M = 0.75;

export type PvClearanceFeature = 'party-wall';

export interface PvClearanceItem {
  feature: PvClearanceFeature;
  label: string;
  guidanceDistanceM: number;
  distanceM: number;
  status: 'ok' | 'below-guidance';
  panelPoint: Pt2;
  featurePoint: Pt2;
  featureSegment: [Pt2, Pt2];
  featureElementId?: string;
}

export interface PvClearanceGuidance {
  measurementKind: 'plan' | 'roof-surface';
  items: PvClearanceItem[];
  primary: PvClearanceItem | null;
}

interface SurfaceTransform {
  kind: 'plan' | 'roof-surface';
  toMeasure(point: Pt2): Pt2;
  toPlan(point: Pt2): Pt2;
}

function isFinitePoint(point: Pt2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function toPlanRing(coords: ReadonlyArray<{ x: number; y: number }> | undefined): Pt2[] {
  return (coords ?? []).map((p) => ({ x: p.x, y: p.y })).filter(isFinitePoint);
}

function buildRoofSurfaceTransform(roof: BuildingElementOpaque): SurfaceTransform {
  const coords = roof.coordinates ?? [];
  const pitch = roof.pitch;
  if (
    coords.length < 2 ||
    typeof pitch !== 'number' ||
    !Number.isFinite(pitch) ||
    pitch <= 0 ||
    pitch >= 90
  ) {
    return {
      kind: 'plan',
      toMeasure: (point) => point,
      toPlan: (point) => point,
    };
  }

  const a = coords[0]!;
  const b = coords[1]!;
  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const tLen = Math.hypot(tx, ty);
  const inward = inwardNormal2DForSlopedRoof(roof);
  if (!inward || tLen < 1e-9) {
    return {
      kind: 'plan',
      toMeasure: (point) => point,
      toPlan: (point) => point,
    };
  }

  const tangent: [number, number] = [tx / tLen, ty / tLen];
  const cosPitch = Math.cos((pitch * Math.PI) / 180);
  if (cosPitch <= 1e-9) {
    return {
      kind: 'plan',
      toMeasure: (point) => point,
      toPlan: (point) => point,
    };
  }

  return {
    kind: 'roof-surface',
    toMeasure: (point) => {
      const dx = point.x - a.x;
      const dy = point.y - a.y;
      return {
        x: dx * tangent[0] + dy * tangent[1],
        y: (dx * inward[0] + dy * inward[1]) / cosPitch,
      };
    },
    toPlan: (point) => ({
      x: a.x + tangent[0] * point.x + inward[0] * point.y * cosPitch,
      y: a.y + tangent[1] * point.x + inward[1] * point.y * cosPitch,
    }),
  };
}

function edgesOf(ring: Pt2[]): Array<[Pt2, Pt2]> {
  if (ring.length < 2) return [];
  const edges: Array<[Pt2, Pt2]> = [];
  for (let i = 0; i < ring.length; i += 1) {
    edges.push([ring[i]!, ring[(i + 1) % ring.length]!]);
  }
  return edges;
}

function pointOnSegment(point: Pt2, a: Pt2, b: Pt2, tol = 1e-8): boolean {
  const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > tol) return false;
  const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
  if (dot < -tol) return false;
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= len2 + tol;
}

function pointInOrOnPolygon(point: Pt2, ring: Pt2[]): boolean {
  for (const [a, b] of edgesOf(ring)) {
    if (pointOnSegment(point, a, b)) return true;
  }

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const pi = ring[i]!;
    const pj = ring[j]!;
    if ((pi.y > point.y) !== (pj.y > point.y)) {
      const xInt = pi.x + ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y);
      if (point.x < xInt) inside = !inside;
    }
  }
  return inside;
}

function orientation(a: Pt2, b: Pt2, c: Pt2): number {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : 2;
}

function segmentsIntersect(a: Pt2, b: Pt2, c: Pt2, d: Pt2): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && pointOnSegment(c, a, b)) ||
    (o2 === 0 && pointOnSegment(d, a, b)) ||
    (o3 === 0 && pointOnSegment(a, c, d)) ||
    (o4 === 0 && pointOnSegment(b, c, d))
  );
}

function midpoint(a: Pt2, b: Pt2): Pt2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distanceBetween(a: Pt2, b: Pt2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function segmentParallelAlignment(a: Pt2, b: Pt2, c: Pt2, d: Pt2): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = d.x - c.x;
  const vy = d.y - c.y;
  const uLen = Math.hypot(ux, uy);
  const vLen = Math.hypot(vx, vy);
  if (uLen < 1e-12 || vLen < 1e-12) return 0;
  return Math.abs((ux * vx + uy * vy) / (uLen * vLen));
}

function closestPointOnSegment(point: Pt2, a: Pt2, b: Pt2): { point: Pt2; rawT: number } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-12) return { point: a, rawT: 0 };
  const rawT = ((point.x - a.x) * vx + (point.y - a.y) * vy) / len2;
  const t = Math.max(0, Math.min(1, rawT));
  return { point: { x: a.x + t * vx, y: a.y + t * vy }, rawT };
}

function closestPanelEdgeMidpointToFeatureSegment(
  panelRing: Pt2[],
  featureSegment: [Pt2, Pt2],
  transform: SurfaceTransform,
): { distanceM: number; panelPoint: Pt2; featurePoint: Pt2; featureSegment: [Pt2, Pt2] } | null {
  const panelEdges = edgesOf(panelRing).map(([a, b]) => [transform.toMeasure(a), transform.toMeasure(b)] as [Pt2, Pt2]);
  const measuredFeatureSegment = [
    transform.toMeasure(featureSegment[0]),
    transform.toMeasure(featureSegment[1]),
  ] as [Pt2, Pt2];

  let best:
    | {
        distanceM: number;
        panelPoint: Pt2;
        featurePoint: Pt2;
        featureSegment: [Pt2, Pt2];
        isPerpendicularToFeatureSegment: boolean;
        alignmentWithFeatureSegment: number;
      }
    | null = null;

  for (const panelEdge of panelEdges) {
    const measuredPanelMidpoint = midpoint(panelEdge[0], panelEdge[1]);
    const projected = closestPointOnSegment(
      measuredPanelMidpoint,
      measuredFeatureSegment[0],
      measuredFeatureSegment[1],
    );
    const isPerpendicularToFeatureSegment = projected.rawT >= 0 && projected.rawT <= 1;
    const distanceM = distanceBetween(measuredPanelMidpoint, projected.point);
    const candidate = {
      distanceM,
      panelPoint: transform.toPlan(measuredPanelMidpoint),
      featurePoint: transform.toPlan(projected.point),
      featureSegment,
      isPerpendicularToFeatureSegment,
      alignmentWithFeatureSegment: segmentParallelAlignment(
        panelEdge[0],
        panelEdge[1],
        measuredFeatureSegment[0],
        measuredFeatureSegment[1],
      ),
    };
    if (
      !best ||
      candidate.alignmentWithFeatureSegment > best.alignmentWithFeatureSegment + 1e-9 ||
      (Math.abs(candidate.alignmentWithFeatureSegment - best.alignmentWithFeatureSegment) <= 1e-9 &&
        candidate.isPerpendicularToFeatureSegment &&
        !best.isPerpendicularToFeatureSegment) ||
      (Math.abs(candidate.alignmentWithFeatureSegment - best.alignmentWithFeatureSegment) <= 1e-9 &&
        candidate.isPerpendicularToFeatureSegment === best.isPerpendicularToFeatureSegment &&
        candidate.distanceM < best.distanceM)
    ) {
      best = candidate;
    }
  }

  return best;
}

function partyWallSegmentsForHostRoof(elements: readonly Element[], hostRoof: BuildingElementOpaque): Array<{
  elementId: string;
  segment: [Pt2, Pt2];
}> {
  const roofRing = toPlanRing(hostRoof.coordinates);
  const roofEdges = edgesOf(roofRing);
  if (roofRing.length < 3) return [];

  const result: Array<{ elementId: string; segment: [Pt2, Pt2] }> = [];
  for (const element of elements) {
    if (element.type !== 'BuildingElementPartyWall') continue;
    const coords = toPlanRing(element.coordinates);
    if (coords.length < 2) continue;
    for (let i = 0; i < coords.length - 1; i += 1) {
      const segment: [Pt2, Pt2] = [coords[i]!, coords[i + 1]!];
      const associated =
        pointInOrOnPolygon(segment[0], roofRing) ||
        pointInOrOnPolygon(segment[1], roofRing) ||
        roofEdges.some((edge) => segmentsIntersect(segment[0], segment[1], edge[0], edge[1]));
      if (associated) {
        result.push({ elementId: element.id, segment });
      }
    }
  }
  return result;
}

function statusFor(distanceM: number, guidanceDistanceM: number): PvClearanceItem['status'] {
  return distanceM + 1e-9 < guidanceDistanceM ? 'below-guidance' : 'ok';
}

function primaryRank(item: PvClearanceItem): number {
  return item.distanceM / item.guidanceDistanceM;
}

export function computePvRoofClearanceGuidance(
  panel: Pick<OnSiteGeneration, 'coordinates'>,
  hostRoof: BuildingElementOpaque,
  elements: readonly Element[] = [],
): PvClearanceGuidance {
  const panelRing = toPlanRing(panel.coordinates);
  const transform = buildRoofSurfaceTransform(hostRoof);
  const guidance: PvClearanceGuidance = {
    measurementKind: transform.kind,
    items: [],
    primary: null,
  };

  if (panelRing.length < 3) return guidance;

  for (const partyWall of partyWallSegmentsForHostRoof(elements, hostRoof)) {
    const closest = closestPanelEdgeMidpointToFeatureSegment(panelRing, partyWall.segment, transform);
    if (!closest) continue;
    guidance.items.push({
      feature: 'party-wall',
      label: 'Party wall',
      guidanceDistanceM: PV_PARTY_WALL_CLEARANCE_GUIDANCE_M,
      distanceM: closest.distanceM,
      status: statusFor(closest.distanceM, PV_PARTY_WALL_CLEARANCE_GUIDANCE_M),
      panelPoint: closest.panelPoint,
      featurePoint: closest.featurePoint,
      featureSegment: partyWall.segment,
      featureElementId: partyWall.elementId,
    });
  }

  guidance.primary =
    guidance.items.length === 0
      ? null
      : [...guidance.items].sort((a, b) => primaryRank(a) - primaryRank(b) || a.distanceM - b.distanceM)[0]!;

  return guidance;
}
