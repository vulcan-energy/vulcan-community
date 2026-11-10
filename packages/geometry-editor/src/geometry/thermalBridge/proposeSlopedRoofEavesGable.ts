// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **E10 / E11** (eaves) and **E12 / E13** (gable) for **sloped** roof opaques (`0 < pitch < 90`).
 *
 * - **Bottom-edge axis**: `coords[0]→coords[1]` is the **low eaves** line, matching the 3D
 *   sloped-polygon convention (`computeSlopedPolygonInwardNormal2D`).
 * - **Orientation axis**: contour-parallel low boundary edges are eaves; non-eaves edges nearly
 *   perpendicular to that contour direction are gables (typical 4+ vertex envelope).
 *   Warm roofs follow the roof top plane; cold unheated pitched roofs use the projected ceiling boundary.
 * - **Cold vs warm roof (insulation line)** — user rule:
 *   - `is_unheated_pitched_roof` = cold roof, insulation at **ceiling** → default **E10** / **E12**
 *   - else (warm) → default **E11** / **E13**
 *   Same line always allows the pair via the junction dropdown.
 *
 * - **2-point** sloped roof: **eaves only** (the drawn segment = eaves line; no gable from geometry).
 */
import { isSlopedPitchedRoofElementForEavesGable } from '../../lib/roofElement';
export { isSlopedPitchedRoofElementForEavesGable } from '../../lib/roofElement';
import { elementBaseElevationMForTb } from '../../lib/geometry3dMapper';
import { computeSlopedPolygonInwardNormal2D } from '../../lib/geometry3dSloped';
import { roofTopElevationAtPlanM } from '../../lib/roofTopElevationAtPlanM';
import { isOrientationPitchAxis, slopedPolygonPlaneBasis } from '../../lib/slopePitchAxis';
import { getUnheatedPitchedRoofCeilingElevationM } from '../../lib/unheatedPitchedRoofCeiling';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { computeThermalBridgeLinearRunLengthM } from '../../lib/thermalBridgeLinearGeometry';
import type { Floor } from '../../geometry/types';
import type { BuildingElementOpaque, Element } from '../types';
import { roundToTwoDecimals } from '../constants';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from '../../lib/simplifiedFabricMap';
import { zonesCompatible } from './proposeAdjacentWallJunction';
import { overlapEndpointsOnRoofPlanEdgeForPartyWall } from './partyWallRoofOverlap';
import { isPartyWallVerticalEnvelopeLine } from './proposePartyWallToExternalE18';
import type { MultiPolygon } from 'polygon-clipping';
import { deriveRoofCutout, modelMayHaveRoofCutouts } from '../../lib/roofCutouts';
import { isPointInPolygon2D } from '../../lib/pointInPolygon';
import { FACADE_PROPOSAL_SUBSTANTIAL_OVERLAP_FRAC } from './thermalBridgeTolerances';

const MIN_LEN_M = 0.05;
const GABLE_PERP_COS = 0.2;
/** Plan edge **parallel** to eaves (low edge) — typical **ridge** line in a simple gable. */
const RIDGE_PARALLEL_COS = 0.85;

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eavesGableJunctionCodes(o: BuildingElementOpaque): { eaves: 'E10' | 'E11'; gable: 'E12' | 'E13' } {
  const cold = !!(o as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof;
  if (cold) {
    return { eaves: 'E10', gable: 'E12' };
  }
  return { eaves: 'E11', gable: 'E13' };
}

/**
 * Ridge default **R4** vs **R5**: use the same cold/warm roof cue as eaves (**E10** / **E11**) —
 * cold loft (`is_unheated_pitched_roof`) → **R5** (ridge / inverted-ceiling row family); warm roof → **R4**
 * (vaulted-ceiling ridge row). Table 3.7 ψ may match; assessors override when the detail does not follow this split.
 */
function defaultRidgeCodeForRoof(o: BuildingElementOpaque): 'R4' | 'R5' {
  const cold = !!(o as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof;
  return cold ? 'R5' : 'R4';
}

function planUnit(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return null;
  return { x: dx / L, y: dy / L };
}

/** Edge from c[i]→c[(i+1)%n] is nearly perpendicular in plan to the eaves direction. */
function isGableEdgeRelativeToEaves(
  c: Array<{ x: number; y: number }>,
  n: number,
  edgeIndex: number,
  eavesUnit: { x: number; y: number },
): boolean {
  if (n < 4) return false;
  const a = c[edgeIndex]!;
  const b = c[(edgeIndex + 1) % n]!;
  const e = planUnit(a, b);
  if (!e) return false;
  const cDot = Math.abs(eavesUnit.x * e.x + eavesUnit.y * e.y);
  return cDot < GABLE_PERP_COS;
}

/** Edge i is nearly **parallel** to the eaves direction (e.g. opposite/ridge in a 4-vertex gable), not the eaves edge (i≠0). */
function isRidgeEdgeRelativeToEaves(
  c: Array<{ x: number; y: number }>,
  n: number,
  edgeIndex: number,
  eavesUnit: { x: number; y: number },
): boolean {
  if (n < 4) return false;
  const a = c[edgeIndex]!;
  const b = c[(edgeIndex + 1) % n]!;
  const e = planUnit(a, b);
  if (!e) return false;
  const cDot = Math.abs(eavesUnit.x * e.x + eavesUnit.y * e.y);
  return cDot > RIDGE_PARALLEL_COS;
}

function zEavesM(o: BuildingElementOpaque, floors: Floor[] | undefined): number {
  if (floors && floors.length > 0) {
    return elementBaseElevationMForTb(o, floors);
  }
  const c = o.coordinates;
  const bh = o.base_height;
  if (typeof bh === 'number' && Number.isFinite(bh) && bh >= 0) return bh;
  if (isOrientationPitchAxis(o)) {
    // The first edge is not the hinge in Orientation state; take the lowest stored z.
    const zs = c.map((p) => (typeof p?.z === 'number' && Number.isFinite(p.z) ? p.z : 0));
    return zs.length > 0 ? Math.min(...zs) : 0;
  }
  const z0 = typeof c[0]?.z === 'number' && Number.isFinite(c[0].z) ? c[0].z : 0;
  const z1 = typeof c[1]?.z === 'number' && Number.isFinite(c[1].z) ? c[1].z : 0;
  return Math.min(z0, z1);
}

function pushEavesGableProposals(
  o: BuildingElementOpaque,
  floors: Floor[] | undefined,
  elements: Element[],
  out: FacadeOpeningTbProposal[],
  globalOrientationOffset?: number,
): void {
  const c = o.coordinates;
  if (!c || c.length < 2) return;
  if (!isSlopedPitchedRoofElementForEavesGable(o)) return;
  const { eaves, gable } = eavesGableJunctionCodes(o);
  const cold = !!(o as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof;
  const zB = cold
    ? getUnheatedPitchedRoofCeilingElevationM(o, elements, floors).value
    : zEavesM(o, floors);

  const n = c.length;
  if (n === 2) {
    const a = c[0]!;
    const b = c[1]!;
    const L = dist2XY(a, b);
    if (L < MIN_LEN_M) return;
    out.push({
      proposalId: `${o.id}:eaves2`,
      openingId: o.id,
      openingName: o.name,
      zoneId: o.zoneId,
      edgeRole: 'sloped_roof_eaves',
      junctionCode: eaves,
      suggestedLengthM: roundToTwoDecimals(L),
      linearThermalTransmittance: psiTable37ForCode(eaves),
      reason: `Eaves ${eaves} (or ${eaves === 'E10' ? 'E11' : 'E10'} via dropdown) along drawn eaves of "${o.name}" (2-point sloped roof)`,
      coordinates: [
        { x: a.x, y: a.y, z: zB },
        { x: b.x, y: b.y, z: zB },
      ],
      parentElementForTb: o.name,
    });
    return;
  }

  const planPts: Array<[number, number]> = c.map((p) => [p.x, p.y] as [number, number]);
  const orientationAxis = isOrientationPitchAxis(o);
  const basis = orientationAxis
    ? slopedPolygonPlaneBasis(
        planPts,
        'orientation',
        o.orientation360 ?? 0,
        globalOrientationOffset as number,
      )
    : null;
  if (orientationAxis ? basis === null : computeSlopedPolygonInwardNormal2D(planPts) === null) return;

  if (orientationAxis && basis) {
    const eavesUnit = { x: basis.upslope2D[1], y: -basis.upslope2D[0] };
    const rises = c.map((p) =>
      (p.x - basis.anchorXY[0]) * basis.upslope2D[0] +
      (p.y - basis.anchorXY[1]) * basis.upslope2D[1]);
    const riseMax = Math.max(...rises);
    // Snap and float noise in an authored bearing lifts contour-parallel edges
    // slightly off the exact contour; classify "at the bottom/top" within 1% of the
    // plane's total rise so a near-aligned low edge stays eaves instead of drifting
    // into the ridge bucket (a wrong-but-plausible junction). Edges parallel to the
    // contour but mid-slope match neither band and emit nothing, per the plan.
    const contourRiseTol = Math.max(1e-6, riseMax * 0.01);
    const eavesEdgeIndexes = new Set<number>();
    for (let i = 0; i < n; i++) {
      const p0 = c[i]!;
      const p1 = c[(i + 1) % n]!;
      const edgeUnit = planUnit(p0, p1);
      if (!edgeUnit) continue;
      const parallel = Math.abs(eavesUnit.x * edgeUnit.x + eavesUnit.y * edgeUnit.y);
      const p0Rise = rises[i]!;
      const p1Rise = rises[(i + 1) % n]!;
      if (parallel <= RIDGE_PARALLEL_COS || p0Rise > contourRiseTol || p1Rise > contourRiseTol) continue;
      const length = dist2XY(p0, p1);
      if (length < MIN_LEN_M) continue;
      eavesEdgeIndexes.add(i);
      out.push({
        proposalId: `${o.id}:eaves:${i}`,
        openingId: o.id,
        openingName: o.name,
        zoneId: o.zoneId,
        edgeRole: 'sloped_roof_eaves',
        junctionCode: eaves,
        suggestedLengthM: roundToTwoDecimals(length),
        linearThermalTransmittance: psiTable37ForCode(eaves),
        reason: `Eaves ${eaves} along edge ${i} on the authored low contour of "${o.name}"; E11 = warm, E10 = cold`,
        coordinates: [
          { x: p0.x, y: p0.y, z: zB },
          { x: p1.x, y: p1.y, z: zB },
        ],
        parentElementForTb: o.name,
      });
    }

    if (n < 4) return;
    for (let i = 0; i < n; i++) {
      if (eavesEdgeIndexes.has(i) || !isGableEdgeRelativeToEaves(c, n, i, eavesUnit)) continue;
      const p0 = c[i]!;
      const p1 = c[(i + 1) % n]!;
      const gLenPlan = dist2XY(p0, p1);
      if (gLenPlan < MIN_LEN_M) continue;
      const z0 = cold ? zB : roofTopElevationAtPlanM(o, p0.x, p0.y, floors, globalOrientationOffset);
      const z1 = cold ? zB : roofTopElevationAtPlanM(o, p1.x, p1.y, floors, globalOrientationOffset);
      if (z0 === null || z1 === null) continue;
      const gCoords = [
        { x: p0.x, y: p0.y, z: z0 },
        { x: p1.x, y: p1.y, z: z1 },
      ] as const;
      const gLen3d = cold ? gLenPlan : computeThermalBridgeLinearRunLengthM([...gCoords]);
      out.push({
        proposalId: `${o.id}:gable:${i}`,
        openingId: o.id,
        openingName: o.name,
        zoneId: o.zoneId,
        edgeRole: 'sloped_roof_gable',
        junctionCode: gable,
        suggestedLengthM: roundToTwoDecimals(gLen3d),
        linearThermalTransmittance: psiTable37ForCode(gable),
        reason: cold
          ? `Gable ${gable} on edge ${i} of "${o.name}" (cold roof; projected ceiling boundary, plan length)`
          : `Gable ${gable} on edge ${i} of "${o.name}" (perpendicular to the authored low contour; roof-plane line; E12 cold / E13 warm)`,
        coordinates: [
          { x: p0.x, y: p0.y, z: roundToTwoDecimals(z0) },
          { x: p1.x, y: p1.y, z: roundToTwoDecimals(z1) },
        ],
        parentElementForTb: o.name,
      });
    }
    if (cold) return;
    for (let i = 0; i < n; i++) {
      if (
        eavesEdgeIndexes.has(i) ||
        !isRidgeEdgeRelativeToEaves(c, n, i, eavesUnit) ||
        isGableEdgeRelativeToEaves(c, n, i, eavesUnit) ||
        rises[i]! < riseMax - contourRiseTol ||
        rises[(i + 1) % n]! < riseMax - contourRiseTol
      ) continue;
      const p0 = c[i]!;
      const p1 = c[(i + 1) % n]!;
      const rLenPlan = dist2XY(p0, p1);
      if (rLenPlan < MIN_LEN_M) continue;
      const zR0 = roofTopElevationAtPlanM(o, p0.x, p0.y, floors, globalOrientationOffset);
      const zR1 = roofTopElevationAtPlanM(o, p1.x, p1.y, floors, globalOrientationOffset);
      if (zR0 === null || zR1 === null) continue;
      const ridgeCoords = [
        { x: p0.x, y: p0.y, z: zR0 },
        { x: p1.x, y: p1.y, z: zR1 },
      ] as const;
      const junctionCode = defaultRidgeCodeForRoof(o);
      const alt = junctionCode === 'R4' ? 'R5' : 'R4';
      out.push({
        proposalId: `${o.id}:ridge:${i}`,
        openingId: o.id,
        openingName: o.name,
        zoneId: o.zoneId,
        edgeRole: 'sloped_roof_ridge',
        junctionCode,
        suggestedLengthM: roundToTwoDecimals(computeThermalBridgeLinearRunLengthM([...ridgeCoords])),
        linearThermalTransmittance: psiTable37ForCode(junctionCode),
        reason: `${junctionCode} ridge on edge ${i} of "${o.name}" (parallel to the authored low contour, roof-top plane; cold loft → R5 / warm roof → R4 — choose **${alt}** if the junction detail differs)`,
        coordinates: [
          { x: p0.x, y: p0.y, z: roundToTwoDecimals(zR0) },
          { x: p1.x, y: p1.y, z: roundToTwoDecimals(zR1) },
        ],
        parentElementForTb: o.name,
      });
    }
    return;
  }

  const a0 = c[0]!;
  const a1 = c[1]!;
  const eavesLen = dist2XY(a0, a1);
  if (eavesLen < MIN_LEN_M) return;
  const eavesUnit = planUnit(a0, a1);
  if (!eavesUnit) return;

  out.push({
    proposalId: `${o.id}:eaves:0`,
    openingId: o.id,
    openingName: o.name,
    zoneId: o.zoneId,
    edgeRole: 'sloped_roof_eaves',
    junctionCode: eaves,
    suggestedLengthM: roundToTwoDecimals(eavesLen),
    linearThermalTransmittance: psiTable37ForCode(eaves),
    reason: `Eaves ${eaves} along first plan edge of "${o.name}" (convention: coords[0]→[1] = low eaves); E11 = warm, E10 = cold`,
    coordinates: [
      { x: a0.x, y: a0.y, z: zB },
      { x: a1.x, y: a1.y, z: zB },
    ],
    parentElementForTb: o.name,
  });

  if (n < 4) return;
  for (let i = 1; i < n; i++) {
    if (!isGableEdgeRelativeToEaves(c, n, i, eavesUnit)) continue;
    const p0 = c[i]!;
    const p1 = c[(i + 1) % n]!;
    const gLenPlan = dist2XY(p0, p1);
    if (gLenPlan < MIN_LEN_M) continue;
    let z0 = cold ? zB : roofTopElevationAtPlanM(o, p0.x, p0.y, floors);
    let z1 = cold ? zB : roofTopElevationAtPlanM(o, p1.x, p1.y, floors);
    if (z0 === null) z0 = zB;
    if (z1 === null) z1 = zB;
    const gCoords = [
      { x: p0.x, y: p0.y, z: z0 },
      { x: p1.x, y: p1.y, z: z1 },
    ] as const;
    const gLen3d = cold ? gLenPlan : computeThermalBridgeLinearRunLengthM([...gCoords]);
    out.push({
      proposalId: `${o.id}:gable:${i}`,
      openingId: o.id,
      openingName: o.name,
      zoneId: o.zoneId,
      edgeRole: 'sloped_roof_gable',
      junctionCode: gable,
      suggestedLengthM: roundToTwoDecimals(gLen3d),
      linearThermalTransmittance: psiTable37ForCode(gable),
      reason: cold
        ? `Gable ${gable} on edge ${i} of "${o.name}" (cold roof; projected ceiling boundary, plan length)`
        : `Gable ${gable} on edge ${i} of "${o.name}" (perpendicular in plan to eaves; roof-plane line; E12 cold / E13 warm)`,
      coordinates: [
        { x: p0.x, y: p0.y, z: roundToTwoDecimals(z0) },
        { x: p1.x, y: p1.y, z: roundToTwoDecimals(z1) },
      ],
      parentElementForTb: o.name,
    });
  }
  if (cold) return;
  for (let i = 1; i < n; i++) {
    if (!isRidgeEdgeRelativeToEaves(c, n, i, eavesUnit)) continue;
    if (isGableEdgeRelativeToEaves(c, n, i, eavesUnit)) continue;
    const p0 = c[i]!;
    const p1 = c[(i + 1) % n]!;
    const rLenPlan = dist2XY(p0, p1);
    if (rLenPlan < MIN_LEN_M) continue;
    let zR0 = roofTopElevationAtPlanM(o, p0.x, p0.y, floors);
    let zR1 = roofTopElevationAtPlanM(o, p1.x, p1.y, floors);
    if (zR0 === null) zR0 = zB;
    if (zR1 === null) zR1 = zB;
    const ridgeCoords = [
      { x: p0.x, y: p0.y, z: zR0 },
      { x: p1.x, y: p1.y, z: zR1 },
    ] as const;
    const rLen3d = computeThermalBridgeLinearRunLengthM([...ridgeCoords]);
    const junctionCode = defaultRidgeCodeForRoof(o);
    const alt = junctionCode === 'R4' ? 'R5' : 'R4';
    out.push({
      proposalId: `${o.id}:ridge:${i}`,
      openingId: o.id,
      openingName: o.name,
      zoneId: o.zoneId,
      edgeRole: 'sloped_roof_ridge',
      junctionCode,
      suggestedLengthM: roundToTwoDecimals(rLen3d),
      linearThermalTransmittance: psiTable37ForCode(junctionCode),
      reason: `${junctionCode} ridge on edge ${i} of "${o.name}" (parallel in plan to first edge, roof-top plane; cold loft → R5 / warm roof → R4 — choose **${alt}** if the junction detail differs)`,
      coordinates: [
        { x: p0.x, y: p0.y, z: roundToTwoDecimals(zR0) },
        { x: p1.x, y: p1.y, z: roundToTwoDecimals(zR1) },
      ],
      parentElementForTb: o.name,
    });
  }
}

/**
 * Drops the parts of eaves, verge, ridge and flat-roof edge lines that lie inside the part of their
 * roof covered by walls standing on it (roofCutouts.ts): that edge is inside the dwelling. A line on
 * the footprint boundary counts as inside, since the wall standing there has its own junction (R8/R9
 * on a pitched roof, E6 on a flat roof deck).
 */
export function trimRoofEdgesInsideCutouts(
  proposals: FacadeOpeningTbProposal[],
  elements: Element[],
  floors: Floor[],
  globalOrientationOffset: number | undefined,
): FacadeOpeningTbProposal[] {
  if (!modelMayHaveRoofCutouts(elements)) return proposals;
  const cutouts = new Map<string, MultiPolygon>();
  const cutoutFor = (roofId: string) => {
    if (!cutouts.has(roofId)) {
      const roof = elements.find((e) => e.id === roofId);
      cutouts.set(roofId, (roof && deriveRoofCutout(roof, elements, floors, globalOrientationOffset)?.polygons) || []);
    }
    return cutouts.get(roofId)!;
  };
  const roofEdgeRoles = new Set(['sloped_roof_eaves', 'sloped_roof_gable', 'sloped_roof_ridge', 'flat_roof_edge']);
  return proposals.flatMap((p) => {
    if (!roofEdgeRoles.has(p.edgeRole)) return [p];
    const polygons = cutoutFor(p.openingId);
    if (polygons.length === 0) return [p];
    const [a, b] = p.coordinates as [{ x: number; y: number; z: number }, { x: number; y: number; z: number }];
    const pieces = segmentPartsOutsidePolygons(a, b, polygons);
    if (pieces.length === 1 && pieces[0]![0] === 0 && pieces[0]![1] === 1) return [p];
    const at = (u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: roundToTwoDecimals(a.z + (b.z - a.z) * u) });
    return pieces.flatMap(([u0, u1], k) => ((u1 - u0) * dist2XY(a, b) < MIN_LEN_M ? [] : [{
      ...p,
      proposalId: `${p.proposalId}:cut${k}`,
      suggestedLengthM: roundToTwoDecimals(p.suggestedLengthM * (u1 - u0)),
      reason: `${p.reason}; part outside the walls standing on the roof`,
      coordinates: [at(u0), at(u1)],
    }]));
  });
}

/** Parameter ranges (0..1) of segment a→b outside the polygons in plan; a point on a boundary is inside. */
function segmentPartsOutsidePolygons(
  a: { x: number; y: number },
  b: { x: number; y: number },
  polygons: MultiPolygon,
): Array<[number, number]> {
  const TOL = 0.1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return [];
  const us = new Set([0, 1]);
  const rings = polygons.flat();
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [px, py] = ring[i]!;
      const [qx, qy] = ring[i + 1]!;
      // A vertex projection bounds any stretch that runs along a boundary edge.
      const u = ((px - a.x) * dx + (py - a.y) * dy) / len2;
      if (u > 0 && u < 1) us.add(u);
      const ex = qx - px;
      const ey = qy - py;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((px - a.x) * ey - (py - a.y) * ex) / den;
      const v = ((px - a.x) * dy - (py - a.y) * dx) / den;
      if (t > 0 && t < 1 && v >= 0 && v <= 1) us.add(t);
    }
  }
  const covered = (p: { x: number; y: number }) => polygons.some((polygon) => {
    const ringPts = (r: Array<[number, number]>) => r.map(([x, y]) => ({ x, y }));
    const onBoundary = polygon.some((r) => r.some(([px, py], i) => {
      if (i === r.length - 1) return false;
      const [qx, qy] = r[i + 1]!;
      const ex = qx - px;
      const ey = qy - py;
      const l2 = ex * ex + ey * ey;
      const w = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - px) * ex + (p.y - py) * ey) / l2));
      return Math.hypot(p.x - px - ex * w, p.y - py - ey * w) <= TOL;
    }));
    return onBoundary || (isPointInPolygon2D(p, ringPts(polygon[0]!)) && !polygon.slice(1).some((hole) => isPointInPolygon2D(p, ringPts(hole))));
  });
  const sorted = [...us].sort((m, n) => m - n);
  const parts: Array<[number, number]> = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const u0 = sorted[i]!;
    const u1 = sorted[i + 1]!;
    if (covered({ x: a.x + dx * ((u0 + u1) / 2), y: a.y + dy * ((u0 + u1) / 2) })) continue;
    const prev = parts[parts.length - 1];
    if (prev && prev[1] === u0) prev[1] = u1;
    else parts.push([u0, u1]);
  }
  return parts;
}

export function proposeSlopedRoofEavesGableThermalBridges(
  elements: Element[],
  floors?: Floor[],
  globalOrientationOffset?: number,
): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const out: FacadeOpeningTbProposal[] = [];
  for (const el of elements) {
    if (el.type !== 'BuildingElementOpaque' || el.isPlaceholder) continue;
    const o = el as BuildingElementOpaque;
    pushEavesGableProposals(o, floors, elements, out, globalOrientationOffset);
  }
  // A roof edge on a party wall is P4/P5 (BR 497 §4.1.3/§4.1.6), not an eaves or gable to outside.
  // Party walls may be split along the edge, so measure the plan length they cover together.
  // ponytail: drops the whole edge when party walls cover most of it; trim the remainder if a
  // party wall ever covers only part of a gable.
  const partyWalls = elements.filter(isPartyWallVerticalEnvelopeLine);
  return trimRoofEdgesInsideCutouts(out, elements, floors ?? [], globalOrientationOffset).filter((p) => {
    const [a, b] = p.coordinates;
    const spans = partyWalls
      .flatMap((pw) => {
        if (!zonesCompatible(p.zoneId, pw.zoneId)) return [];
        const hit = overlapEndpointsOnRoofPlanEdgeForPartyWall(a!, b!, pw);
        return hit ? [hit.ovl] : [];
      })
      .sort((m, n) => m.tLo - n.tLo);
    let covered = 0;
    let end = -Infinity;
    for (const { tLo, tHi } of spans) {
      covered += Math.max(0, tHi - Math.max(tLo, end));
      end = Math.max(end, tHi);
    }
    return covered < FACADE_PROPOSAL_SUBSTANTIAL_OVERLAP_FRAC * dist2XY(a!, b!);
  });
}
