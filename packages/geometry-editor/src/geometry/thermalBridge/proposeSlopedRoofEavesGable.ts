// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **E10 / E11** (eaves) and **E12 / E13** (gable) for **sloped** roof opaques (`0 < pitch < 90`).
 *
 * - **Eaves (first plan edge)**: `coords[0]→coords[1]` is the **low eaves** line, matching the 3D
 *   sloped-polygon convention (`computeSlopedPolygonInwardNormal2D`).
 * - **Gable**: plan edges **nearly perpendicular** to that eaves direction (typical 4+ vertex envelope).
 *   Warm roofs follow the roof top plane; cold unheated pitched roofs use the projected ceiling boundary.
 * - **Cold vs warm roof (insulation line)** — user rule:
 *   - `is_unheated_pitched_roof` = cold roof, insulation at **ceiling** → default **E10** / **E12**
 *   - else (warm) → default **E11** / **E13**
 *   Same line always allows the pair via the junction dropdown.
 *
 * - **2-point** sloped roof: **eaves only** (the drawn segment = eaves line; no gable from geometry).
 */
import { isRoofLikeOpaqueElement } from '../../lib/roofElement';
import { elementBaseElevationMForTb } from '../../lib/geometry3dMapper';
import { computeSlopedPolygonInwardNormal2D } from '../../lib/geometry3dSloped';
import { roofTopElevationAtPlanM } from '../../lib/roofTopElevationAtPlanM';
import { isOrientationPitchAxis } from '../../lib/slopePitchAxis';
import { getUnheatedPitchedRoofCeilingElevationM } from '../../lib/unheatedPitchedRoofCeiling';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { computeThermalBridgeLinearRunLengthM } from '../../lib/thermalBridgeLinearGeometry';
import type { Floor } from '../../geometry/types';
import type { BuildingElementOpaque, Element } from '../types';
import { roundToTwoDecimals } from '../constants';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from './proposeFacadeOpenings';

const MIN_LEN_M = 0.05;
const GABLE_PERP_COS = 0.2;
/** Plan edge **parallel** to eaves (low edge) — typical **ridge** line in a simple gable. */
const RIDGE_PARALLEL_COS = 0.85;

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isPitchSlopedNotFlat(o: BuildingElementOpaque): boolean {
  const p = o.pitch;
  return typeof p === 'number' && Number.isFinite(p) && p > 0 && p < 90;
}

/**
 * True when this is a sloped, roof-line opaque: roof-like (name/flag/pitch) and 0< pitch<90, not a placeholder.
 */
export function isSlopedPitchedRoofElementForEavesGable(o: BuildingElementOpaque): boolean {
  if (o.isPlaceholder) return false;
  if (!isRoofLikeOpaqueElement(o)) return false;
  if (!isPitchSlopedNotFlat(o)) return false;
  if ((o as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof) return true;
  const n = (o.name ?? '').trim().toLowerCase();
  if (n === 'roof' || n.includes('roof')) return true;
  return false;
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
  if (edgeIndex === 0) return false;
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
  const z0 = typeof c[0]?.z === 'number' && Number.isFinite(c[0].z) ? c[0].z : 0;
  const z1 = typeof c[1]?.z === 'number' && Number.isFinite(c[1].z) ? c[1].z : 0;
  const bh = o.base_height;
  if (typeof bh === 'number' && Number.isFinite(bh) && bh >= 0) return bh;
  return Math.min(z0, z1);
}

function pushEavesGableProposals(
  o: BuildingElementOpaque,
  floors: Floor[] | undefined,
  elements: Element[],
  out: FacadeOpeningTbProposal[],
): void {
  if (isOrientationPitchAxis(o)) return;
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
  if (computeSlopedPolygonInwardNormal2D(planPts) === null) return;

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

export function proposeSlopedRoofEavesGableThermalBridges(
  elements: Element[],
  floors?: Floor[],
): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const out: FacadeOpeningTbProposal[] = [];
  for (const el of elements) {
    if (el.type !== 'BuildingElementOpaque' || el.isPlaceholder) continue;
    const o = el as BuildingElementOpaque;
    pushEavesGableProposals(o, floors, elements, out);
  }
  return out;
}
