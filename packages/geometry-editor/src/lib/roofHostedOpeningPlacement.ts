// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { BuildingElementOpaque, BuildingElementTransparent, Floor } from '../geometry/types';
import { inwardNormal2DForSlopedRoof, roofTopElevationAtPlanM } from './roofTopElevationAtPlanM';

type Pt2 = { x: number; y: number };

export interface RoofHostedOpeningPlacement {
  measurementKind: 'roof-surface';
  distanceM: number;
  planDistanceM: number;
  verticalRiseM: number;
  openingPoint: Pt2;
  roofPoint: Pt2;
  openingEdgeSegment: [Pt2, Pt2];
  roofLowEdgeSegment: [Pt2, Pt2];
}

type OpeningCoordinate = BuildingElementTransparent['coordinates'][number];

function isFinitePoint(point: Pt2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function toPlanRing(coords: ReadonlyArray<{ x: number; y: number }> | undefined): Pt2[] {
  return (coords ?? []).map((p) => ({ x: p.x, y: p.y })).filter(isFinitePoint);
}

function midpoint(a: Pt2, b: Pt2): Pt2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function segmentAlignment(a: Pt2, b: Pt2, c: Pt2, d: Pt2): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = d.x - c.x;
  const vy = d.y - c.y;
  const uLen = Math.hypot(ux, uy);
  const vLen = Math.hypot(vx, vy);
  if (uLen < 1e-12 || vLen < 1e-12) return 0;
  return Math.abs((ux * vx + uy * vy) / (uLen * vLen));
}

function edgesOf(ring: Pt2[]): Array<[Pt2, Pt2]> {
  if (ring.length < 2) return [];
  const edges: Array<[Pt2, Pt2]> = [];
  for (let i = 0; i < ring.length; i += 1) {
    edges.push([ring[i]!, ring[(i + 1) % ring.length]!]);
  }
  return edges;
}

export function computeRoofHostedOpeningPlacement(
  opening: Pick<BuildingElementTransparent, 'coordinates'>,
  roof: BuildingElementOpaque,
  floors: Floor[] | undefined,
): RoofHostedOpeningPlacement | null {
  const pitch = roof.pitch;
  if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch <= 0 || pitch >= 90) {
    return null;
  }

  const openingRing = toPlanRing(opening.coordinates);
  const roofRing = toPlanRing(roof.coordinates);
  if (openingRing.length < 3 || roofRing.length < 2) return null;

  const roofA = roofRing[0]!;
  const roofB = roofRing[1]!;
  const inward = inwardNormal2DForSlopedRoof(roof);
  if (!inward) return null;

  const roofDx = roofB.x - roofA.x;
  const roofDy = roofB.y - roofA.y;
  const roofLen = Math.hypot(roofDx, roofDy);
  if (roofLen < 1e-9) return null;

  const cosPitch = Math.cos((pitch * Math.PI) / 180);
  if (cosPitch <= 1e-9) return null;

  let best:
    | {
        midpoint: Pt2;
        edge: [Pt2, Pt2];
        planDistanceM: number;
        alignment: number;
      }
    | null = null;

  for (const edge of edgesOf(openingRing)) {
    const edgeMid = midpoint(edge[0], edge[1]);
    const planDistanceM = Math.max(
      0,
      (edgeMid.x - roofA.x) * inward[0] + (edgeMid.y - roofA.y) * inward[1],
    );
    const alignment = segmentAlignment(edge[0], edge[1], roofA, roofB);
    if (
      !best ||
      planDistanceM < best.planDistanceM - 1e-9 ||
      (Math.abs(planDistanceM - best.planDistanceM) <= 1e-9 && alignment > best.alignment)
    ) {
      best = {
        midpoint: edgeMid,
        edge,
        planDistanceM,
        alignment,
      };
    }
  }

  if (!best || best.alignment < 0.85) return null;

  const roofPoint = {
    x: best.midpoint.x - inward[0] * best.planDistanceM,
    y: best.midpoint.y - inward[1] * best.planDistanceM,
  };
  const lowElevation = roofTopElevationAtPlanM(roof, roofPoint.x, roofPoint.y, floors);
  const openingElevation = roofTopElevationAtPlanM(roof, best.midpoint.x, best.midpoint.y, floors);
  const fallbackRise = best.planDistanceM * Math.tan((pitch * Math.PI) / 180);
  const verticalRiseM =
    typeof lowElevation === 'number' &&
    Number.isFinite(lowElevation) &&
    typeof openingElevation === 'number' &&
    Number.isFinite(openingElevation)
      ? Math.max(0, openingElevation - lowElevation)
      : fallbackRise;

  return {
    measurementKind: 'roof-surface',
    distanceM: best.planDistanceM / cosPitch,
    planDistanceM: best.planDistanceM,
    verticalRiseM,
    openingPoint: best.midpoint,
    roofPoint,
    openingEdgeSegment: best.edge,
    roofLowEdgeSegment: [roofA, roofB],
  };
}

export function moveRoofHostedOpeningToSurfaceDistance(
  opening: Pick<BuildingElementTransparent, 'coordinates'>,
  roof: BuildingElementOpaque,
  floors: Floor[] | undefined,
  targetDistanceM: number,
): OpeningCoordinate[] | null {
  if (!Number.isFinite(targetDistanceM) || targetDistanceM < 0) return null;

  const placement = computeRoofHostedOpeningPlacement(opening, roof, floors);
  if (!placement) return null;

  const pitch = roof.pitch;
  if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch <= 0 || pitch >= 90) {
    return null;
  }

  const inward = inwardNormal2DForSlopedRoof(roof);
  if (!inward) return null;

  const cosPitch = Math.cos((pitch * Math.PI) / 180);
  if (cosPitch <= 1e-9) return null;

  const targetPlanDistanceM = targetDistanceM * cosPitch;
  const deltaPlanM = targetPlanDistanceM - placement.planDistanceM;

  return (opening.coordinates ?? []).map((point) => ({
    ...point,
    x: point.x + inward[0] * deltaPlanM,
    y: point.y + inward[1] * deltaPlanM,
  }));
}
