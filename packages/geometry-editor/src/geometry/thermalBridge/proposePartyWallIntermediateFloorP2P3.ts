// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Table 3.7 **P2** / **P3** — **party wall** × **intermediate conditioned floor** (not external wall).
 *
 * Pairs a vertical **`BuildingElementPartyWall`** segment with a horizontal pitch-**0**
 * **`BuildingElementAdjacentConditionedSpace`** floor footprint (**2-point line or closed polygon**, e.g. internal
 * floor slab) where a boundary segment is **plan-coincident** with the wall, at the slab elevation.
 * **P3** when a polygon floor adjacent carries `_vulcan_ui_party_element`; otherwise **P2**.
 *
 * Party walls drawn on the **ground** storey still participate: the conditioned floor element is the family
 * evidence, and its slab elevation only needs to fall within the wall vertical extent.
 *
 * **E7** remains the dedicated proposer for **party floor × external wall**.
 */
import { isVulcanUiPartyFloorElement } from '../../lib/assemblyMaterialFabric';
import { elementBaseElevationMForTb } from '../../lib/geometry3dMapper';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import type { Floor } from '../../geometry/types';
import type { BuildingElementAdjacentConditionedSpace, BuildingElementPartyWall, Element } from '../types';
import { roundToTwoDecimals } from '../constants';
import {
  adjacentEnvelopeVerticalExtentM,
  horizontalConditionedFloorSlabPlanEdgesForPartyWallTb,
  planOverlapAdjacentOnWall,
  zonesCompatible,
} from './proposeAdjacentWallJunction';
import { partyWallVerticalExtentM, isPartyWallVerticalEnvelopeLine } from './proposePartyWallToExternalE18';
import { partyWallGroundFamilyClaimsElevation } from './proposeWallGroundContinuous';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from './proposeFacadeOpenings';

const MIN_PLAN_OVERLAP_M = 0.05;
const MIN_VERTICAL_OVERLAP_M = 0.05;
const Z_BAND_EPS_M = 0.04;

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointOnSegmentAtT(
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

export function proposePartyWallIntermediateFloorP2P3ThermalBridges(
  elements: Element[],
  floors?: Floor[],
): FacadeOpeningTbProposal[] {
  if (!floors || floors.length === 0) return [];
  floors = withEffectiveStoreyHeights(floors, elements);

  const partyWalls = elements.filter((e): e is BuildingElementPartyWall => isPartyWallVerticalEnvelopeLine(e));
  const conditionedFloors = elements.filter((e): e is BuildingElementAdjacentConditionedSpace => {
    if (e.type !== 'BuildingElementAdjacentConditionedSpace' || e.isPlaceholder) return false;
    return horizontalConditionedFloorSlabPlanEdgesForPartyWallTb(e).length > 0;
  });
  const out: FacadeOpeningTbProposal[] = [];

  for (const pw of partyWalls) {
    const P = pw.coordinates;
    const Pa = P[0]!;
    const Pb = P[1]!;
    const pExt = partyWallVerticalExtentM(pw, floors);

    for (const adj of conditionedFloors) {
      if (!zonesCompatible(pw.zoneId, adj.zoneId)) continue;

      const slabZ = elementBaseElevationMForTb(adj, floors);
      if (slabZ < pExt.zLo - Z_BAND_EPS_M || slabZ > pExt.zHi + Z_BAND_EPS_M) continue;
      // Ground-family precedence, mirroring the continuous-E6 veto: when P1/P6 claims
      // this elevation (linked ground slab under the wall base), a conditioned plate at
      // the same level must not add a coincident P2/P3 for the same run.
      if (partyWallGroundFamilyClaimsElevation(pw, elements, floors, slabZ)) continue;

      const aExt = adjacentEnvelopeVerticalExtentM(adj, floors);
      const zLo = Math.max(pExt.zLo, aExt.zLo);
      const zHi = Math.min(pExt.zHi, aExt.zHi);
      const overlapDepth = zHi - zLo;
      const slabPlaneHitsWall =
        slabZ >= pExt.zLo - Z_BAND_EPS_M && slabZ <= pExt.zHi + Z_BAND_EPS_M;
      if (overlapDepth < MIN_VERTICAL_OVERLAP_M && !slabPlaneHitsWall) continue;

      const junctionCode: 'P2' | 'P3' = isVulcanUiPartyFloorElement(adj) ? 'P3' : 'P2';
      const edges = horizontalConditionedFloorSlabPlanEdgesForPartyWallTb(adj);
      let edgeIdx = 0;
      for (const [[ax, ay], [bx, by]] of edges) {
        const Aa = { x: ax, y: ay };
        const Ab = { x: bx, y: by };
        const overlap = planOverlapAdjacentOnWall(Pa, Pb, Aa, Ab);
        if (!overlap) {
          edgeIdx += 1;
          continue;
        }

        const a = pointOnSegmentAtT(Pa, Pb, overlap.tLo, overlap.wallLen);
        const b = pointOnSegmentAtT(Pa, Pb, overlap.tHi, overlap.wallLen);
        const L = dist2XY(a, b);
        if (L < MIN_PLAN_OVERLAP_M) {
          edgeIdx += 1;
          continue;
        }

        const z = roundToTwoDecimals(slabZ);
        out.push({
          proposalId: `${junctionCode.toLowerCase()}:pw:${pw.id}:${adj.id}:e${edgeIdx}:${roundToTwoDecimals(overlap.tLo)}`,
          openingId: adj.id,
          openingName: `${adj.name} ↔ ${pw.name}`,
          zoneId: pw.zoneId ?? adj.zoneId,
          edgeRole: 'party_wall_junction',
          junctionCode,
          suggestedLengthM: roundToTwoDecimals(L),
          linearThermalTransmittance: psiTable37ForCode(junctionCode),
          reason:
            junctionCode === 'P3'
              ? `P3 party wall × intermediate floor (party element): "${pw.name}" × conditioned floor "${adj.name}" (plan ${roundToTwoDecimals(
                  overlap.overlapLen,
                )} m at ${z} m)`
              : `P2 party wall × intermediate floor: "${pw.name}" × conditioned floor "${adj.name}" (plan ${roundToTwoDecimals(
                  overlap.overlapLen,
                )} m at ${z} m)`,
          coordinates: [
            { x: roundToTwoDecimals(a.x), y: roundToTwoDecimals(a.y), z },
            { x: roundToTwoDecimals(b.x), y: roundToTwoDecimals(b.y), z },
	          ],
	          parentElementForTb: pw.name ?? pw.id,
	          hostElementIds: [pw.id, adj.id],
	        });
        edgeIdx += 1;
      }
    }
  }

  return out;
}
