// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Table 3.7 **P1** / **P6** — **party wall** × **ground floor** at the **`BuildingElementGround`** slab edge in plan
 * (P-series: junction **with a party wall**). Default **P1** (normal); **P6** is the inverted ground-floor party
 * junction — choose in the suggest modal when the detail matches.
 *
 * Requires **`floors`** for storey/slab resolution (returns **[]** if omitted). Uses the same slab linkage rules as
 * continuous **E5** / {@link partyWallLinkedToGroundSlabForP1} and ground-contact storey checks as
 * {@link isGroundContactPartyWallForP1Tb}.
 */
import { elementBaseElevationMForTb } from '../../lib/geometry3dMapper';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { isBasementGroundElement } from '../../lib/basementGeometry';
import { nonBasementGroundSurfaceElevationM } from '../../lib/suspendedFloorGeometry';
import type { Floor } from '../../geometry/types';
import type { BuildingElementGround, BuildingElementPartyWall, Element } from '../types';
import { roundToTwoDecimals } from '../constants';
import { planOverlapAdjacentOnWall, zonesCompatible } from './proposeAdjacentWallJunction';
import {
  groundSlabPolygonEdgesXY,
  isGroundContactPartyWallForP1Tb,
  partyWallLinkedToGroundSlabForP1,
} from './proposeWallGroundContinuous';
import { isPartyWallVerticalEnvelopeLine, partyWallVerticalExtentM } from './proposePartyWallToExternalE18';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from './proposeFacadeOpenings';

const MIN_PLAN_OVERLAP_M = 0.05;
const Z_BAND_EPS_M = 0.04;

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointOnWallAtT(
  Wa: { x: number; y: number },
  Wb: { x: number; y: number },
  t: number,
  wallLen: number,
): { x: number; y: number } {
  const vx = Wb.x - Wa.x;
  const vy = Wb.y - Wa.y;
  if (wallLen < 1e-9) return { x: Wa.x, y: Wa.y };
  const ux = vx / wallLen;
  const uy = vy / wallLen;
  return { x: Wa.x + ux * t, y: Wa.y + uy * t };
}

export function proposePartyWallGroundP1P6ThermalBridges(
  elements: Element[],
  floors?: Floor[],
): FacadeOpeningTbProposal[] {
  if (!floors || floors.length === 0) return [];
  floors = withEffectiveStoreyHeights(floors, elements);

  const partyWalls = elements.filter((e): e is BuildingElementPartyWall => isPartyWallVerticalEnvelopeLine(e));
  const grounds = elements.filter(
    (e): e is BuildingElementGround => e.type === 'BuildingElementGround' && !isBasementGroundElement(e),
  );
  const out: FacadeOpeningTbProposal[] = [];

  for (const pw of partyWalls) {
    if (!isGroundContactPartyWallForP1Tb(pw, floors, elements)) continue;
    if (!partyWallLinkedToGroundSlabForP1(pw, elements)) continue;

    const P = pw.coordinates;
    const Pa = P[0]!;
    const Pb = P[1]!;
    const pExt = partyWallVerticalExtentM(pw, floors);

    for (const g of grounds) {
      if (!zonesCompatible(pw.zoneId, g.zoneId)) continue;
      const slabZElev = nonBasementGroundSurfaceElevationM(g) ?? elementBaseElevationMForTb(g, floors);
      if (slabZElev < pExt.zLo - Z_BAND_EPS_M || slabZElev > pExt.zHi + Z_BAND_EPS_M) continue;

      const edges = groundSlabPolygonEdgesXY(g);
      let edgeIdx = 0;
      for (const [[eax, eay], [ebx, eby]] of edges) {
        const Ea = { x: eax, y: eay };
        const Eb = { x: ebx, y: eby };
        const overlap = planOverlapAdjacentOnWall(Pa, Pb, Ea, Eb);
        if (!overlap) {
          edgeIdx++;
          continue;
        }
        const a = pointOnWallAtT(Pa, Pb, overlap.tLo, overlap.wallLen);
        const b = pointOnWallAtT(Pa, Pb, overlap.tHi, overlap.wallLen);
        const L = dist2XY(a, b);
        if (L < MIN_PLAN_OVERLAP_M) {
          edgeIdx++;
          continue;
        }
        const zSlab = roundToTwoDecimals(slabZElev);
        const junctionCode = 'P1';
        out.push({
          proposalId: `p1:${pw.id}:${g.id}:e${edgeIdx}:${roundToTwoDecimals(overlap.tLo)}`,
          openingId: g.id,
          openingName: `${g.name ?? g.id} ↔ ${pw.name}`,
          zoneId: pw.zoneId ?? g.zoneId,
          edgeRole: 'party_wall_junction',
          junctionCode,
          suggestedLengthM: roundToTwoDecimals(L),
          linearThermalTransmittance: psiTable37ForCode(junctionCode),
          reason: `P1 party wall × ground floor: "${pw.name}" × BuildingElementGround "${g.name ?? g.id}" slab edge (plan ${roundToTwoDecimals(
            overlap.overlapLen,
          )} m at ${zSlab} m); use **P6** if inverted ground-floor junction`,
          coordinates: [
            { x: roundToTwoDecimals(a.x), y: roundToTwoDecimals(a.y), z: zSlab },
            { x: roundToTwoDecimals(b.x), y: roundToTwoDecimals(b.y), z: zSlab },
	          ],
	          parentElementForTb: pw.name ?? pw.id,
	          hostElementIds: [pw.id, g.id],
	        });
        edgeIdx++;
      }
    }
  }

  return out;
}
