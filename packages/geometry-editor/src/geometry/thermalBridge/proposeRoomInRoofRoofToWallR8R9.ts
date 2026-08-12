// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Table 3.7 **R8** / **R9** — roof to wall (rafter vs flat ceiling level): inferred where a vertical
 * envelope segment is **plan-coincident** with an edge of a **sloped** roof opaque (`0° < pitch < 90°`),
 * with vertical overlap between roof and wall envelopes. Segments may be `BuildingElementAdjacent*`,
 * or vertical **`BuildingElementOpaque`** walls that are external envelope lines. Dormer walls with a
 * `dormer_bundle.host_element_name` are handled by the dormer-specific host-roof proposer instead.
 * with vertical overlap between roof and adjacent envelopes (typical room-in-roof knee / cheek wall).
 *
 * **Geometry** — Warm roofs follow the **roof plane** along the shared plan edge. Cold unheated
 * pitched roofs use the projected ceiling boundary at plan length, because the insulation line is
 * the limit of the heated space rather than the sloped roof surface.
 *
 * - **`is_unheated_pitched_roof`** on the roof opaque → cold deck, insulation at ceiling line → **R9**.
 * - Otherwise → warm deck, insulation following rafters → **R8**.
 *
 * Parent TB host is the **roof** opaque (`parent_element`); adjacent element id is carried on the
 * proposal for linkage (`openingId` + `roofAdjacentPairIds`).
 *
 * **Overlap with other passes** — E10/E11 use **eaves base Z**; **E12/E13** (gable) follow the **roof plane**
 * like R8/R9. R8/R9 here follow the **roof surface** along **inner** (or any)
 * edge where an adjacent vertical meets the roof; same **plan edge** can conceptually coincide with
 * an eaves/gable proposal only if the model duplicates geometry — assessors should avoid counting twice.
 */
import type { Floor } from '../../geometry/types';
import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementAdjacentUnconditionedSpace_Simple,
  BuildingElementOpaque,
  Element,
} from '../types';
import { isExternalLineWall } from './proposeExternalCorners';
import { computeThermalBridgeLinearRunLengthM } from '../../lib/thermalBridgeLinearGeometry';
import { inwardNormal2DForSlopedRoof, roofTopElevationAtPlanM } from '../../lib/roofTopElevationAtPlanM';
import { getUnheatedPitchedRoofCeilingElevationM } from '../../lib/unheatedPitchedRoofCeiling';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { roundToTwoDecimals } from '../constants';
import {
  adjacentEnvelopeVerticalExtentM,
  isAdjacentVerticalEnvelopeLine,
  opaqueEnvelopeVerticalExtentM,
  planOverlapAdjacentOnWall,
  zonesCompatible,
} from './proposeAdjacentWallJunction';
import { isSlopedPitchedRoofElementForEavesGable } from './proposeSlopedRoofEavesGable';
import type { FacadeOpeningEdgeRole, FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from './proposeFacadeOpenings';

const MIN_VERT_OVERLAP_M = 0.05;
const MIN_WALL_PLAN_LEN_XY_M = 0.05;
const COLD_ROOF_CEILING_OVERLAP_PAD_M = 0.1;

function isDormerOpaqueWallForRoofR89(w: BuildingElementOpaque): boolean {
  const bundle = w.extra_json?.dormer_bundle;
  if (!bundle || typeof bundle !== 'object') return false;
  const role = (bundle as { role?: string }).role;
  if (typeof role !== 'string') return false;
  return (
    role === 'front-wall-anchor' || role === 'left-cheek-wall' || role === 'right-cheek-wall'
  );
}

function hasDormerHostRoofName(w: BuildingElementOpaque): boolean {
  const bundle = w.extra_json?.dormer_bundle;
  if (!bundle || typeof bundle !== 'object') return false;
  const hostName = (bundle as { host_element_name?: string }).host_element_name;
  return typeof hostName === 'string' && hostName.trim().length > 0;
}

/** Vertical 2-point opaque wall segment suitable for R8/R9 pairing with sloped roof plan edges. */
function isVerticalOpaqueWallForRoofR89(w: BuildingElementOpaque): boolean {
  if (w.isPlaceholder) return false;
  if (isSlopedPitchedRoofElementForEavesGable(w)) return false;
  const c = w.coordinates;
  if (!c || c.length !== 2) return false;
  const pitch = w.pitch;
  if (typeof pitch === 'number' && Number.isFinite(pitch) && pitch !== 90) return false;
  const planLen = Math.hypot(c[1]!.x - c[0]!.x, c[1]!.y - c[0]!.y);
  if (planLen < MIN_WALL_PLAN_LEN_XY_M) return false;
  const h = typeof w.height === 'number' && w.height > 0 ? w.height : 0;
  if (h <= 0) return false;
  if (isDormerOpaqueWallForRoofR89(w) && hasDormerHostRoofName(w)) return false;
  return isExternalLineWall(w as Element) || isDormerOpaqueWallForRoofR89(w);
}

function pointOnSegmentAtT(
  Wa: { x: number; y: number },
  Wb: { x: number; y: number },
  t: number,
  segLen: number,
): { x: number; y: number } {
  const vx = Wb.x - Wa.x;
  const vy = Wb.y - Wa.y;
  if (segLen < 1e-9) return { x: Wa.x, y: Wa.y };
  const ux = vx / segLen;
  const uy = vy / segLen;
  return { x: Wa.x + ux * t, y: Wa.y + uy * t };
}

function junctionR8OrR9ForRoof(roof: BuildingElementOpaque): 'R8' | 'R9' {
  const cold = !!(roof as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof;
  return cold ? 'R9' : 'R8';
}

function roofPlanEdgesXY(c: Array<{ x: number; y: number }>): Array<[{ x: number; y: number }, { x: number; y: number }]> {
  const n = c.length;
  if (n < 2) return [];
  if (n === 2) return [[c[0]!, c[1]!]];
  const out: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
  for (let i = 0; i < n; i++) {
    out.push([c[i]!, c[(i + 1) % n]!]);
  }
  return out;
}

function coldPitchedRoofBoundaryZM(
  roof: BuildingElementOpaque,
  elements: Element[],
  floors: Floor[] | undefined,
): number {
  return getUnheatedPitchedRoofCeilingElevationM(roof, elements, floors).value;
}

const EDGE_ROLE: FacadeOpeningEdgeRole = 'sloped_roof_to_adjacent_wall_r8_r9';

export function proposeRoomInRoofRoofToWallR8R9ThermalBridges(
  elements: Element[],
  floors?: Floor[],
): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const roofs = elements.filter((e): e is BuildingElementOpaque => {
    if (e.type !== 'BuildingElementOpaque' || e.isPlaceholder) return false;
    return isSlopedPitchedRoofElementForEavesGable(e);
  });

  const adjacents = elements.filter(
    (e): e is BuildingElementAdjacentConditionedSpace | BuildingElementAdjacentUnconditionedSpace_Simple =>
      isAdjacentVerticalEnvelopeLine(e),
  );

  const opaqueVerticalWalls = elements.filter(
    (e): e is BuildingElementOpaque => e.type === 'BuildingElementOpaque' && isVerticalOpaqueWallForRoofR89(e),
  );

  const out: FacadeOpeningTbProposal[] = [];

  for (const roof of roofs) {
    const coords = roof.coordinates;
    if (!coords || coords.length < 2) continue;

    const inward = inwardNormal2DForSlopedRoof(roof);
    if (!inward) continue;

    const junctionCode = junctionR8OrR9ForRoof(roof);
    const cold = !!(roof as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof;
    const coldBoundaryZM = cold ? coldPitchedRoofBoundaryZM(roof, elements, floors) : null;
    const roofSurfaceExt = opaqueEnvelopeVerticalExtentM(roof, floors);
    const roofExt = coldBoundaryZM === null
      ? roofSurfaceExt
      : {
          zLo: coldBoundaryZM - COLD_ROOF_CEILING_OVERLAP_PAD_M,
          zHi: coldBoundaryZM + COLD_ROOF_CEILING_OVERLAP_PAD_M,
        };
    const ins = cold
      ? 'cold roof (insulation at ceiling line)'
      : 'warm roof (insulation at rafter line)';

    const xyOnly = coords.map((p) => ({ x: p.x, y: p.y }));
    const edges = roofPlanEdgesXY(xyOnly);

    for (let ei = 0; ei < edges.length; ei++) {
      const [Wa, Wb] = edges[ei]!;
      for (const adj of adjacents) {
        if (!zonesCompatible(roof.zoneId, adj.zoneId)) continue;

        const A = adj.coordinates;
        const overlap = planOverlapAdjacentOnWall(Wa, Wb, A[0]!, A[1]!);
        if (!overlap) continue;

        const adjExt = adjacentEnvelopeVerticalExtentM(adj, floors);
        const zLoWorld = Math.max(roofExt.zLo, adjExt.zLo);
        const zHiWorld = Math.min(roofExt.zHi, adjExt.zHi);
        if (zHiWorld - zLoWorld < MIN_VERT_OVERLAP_M) continue;

        const pLo = pointOnSegmentAtT(Wa, Wb, overlap.tLo, overlap.wallLen);
        const pHi = pointOnSegmentAtT(Wa, Wb, overlap.tHi, overlap.wallLen);

        const z0 = coldBoundaryZM ?? roofTopElevationAtPlanM(roof, pLo.x, pLo.y, floors);
        const z1 = coldBoundaryZM ?? roofTopElevationAtPlanM(roof, pHi.x, pHi.y, floors);
        if (z0 === null || z1 === null) continue;

        const c0 = { x: pLo.x, y: pLo.y, z: z0 };
        const c1 = { x: pHi.x, y: pHi.y, z: z1 };
        const len = cold ? overlap.overlapLen : computeThermalBridgeLinearRunLengthM([c0, c1]);

        const planLen = overlap.overlapLen;
        const dz = Math.abs(z1 - z0);
        out.push({
          proposalId: `r89:${roof.id}:${adj.id}:e${ei}:${roundToTwoDecimals(overlap.tLo)}:${roundToTwoDecimals(overlap.tHi)}`,
          openingId: adj.id,
          openingName: `${roof.name} ↔ ${adj.name}`,
          zoneId: roof.zoneId ?? adj.zoneId,
          edgeRole: EDGE_ROLE,
          junctionCode,
          suggestedLengthM: roundToTwoDecimals(len),
          linearThermalTransmittance: psiTable37ForCode(junctionCode),
          reason: `Table 3.7 ${junctionCode} (${ins}): adjacent "${adj.name}" along roof edge ${ei} of "${roof.name}" — ${cold ? 'projected ceiling boundary' : 'junction on roof plane'} (plan ${roundToTwoDecimals(
            planLen,
          )} m, |Δz| ${roundToTwoDecimals(dz)} m; 3D length ${roundToTwoDecimals(len)} m; vertical envelope overlap ${roundToTwoDecimals(
            zHiWorld - zLoWorld,
          )} m)`,
          coordinates: [c0, c1],
          parentElementForTb: roof.name,
          roofAdjacentPairIds: [roof.id, adj.id],
        });
      }

      for (const ow of opaqueVerticalWalls) {
        if (!zonesCompatible(roof.zoneId, ow.zoneId)) continue;

        const A = ow.coordinates;
        const overlap = planOverlapAdjacentOnWall(Wa, Wb, A[0]!, A[1]!);
        if (!overlap) continue;

        const owExt = opaqueEnvelopeVerticalExtentM(ow, floors);
        const zLoWorld = Math.max(roofExt.zLo, owExt.zLo);
        const zHiWorld = Math.min(roofExt.zHi, owExt.zHi);
        if (zHiWorld - zLoWorld < MIN_VERT_OVERLAP_M) continue;

        const pLo = pointOnSegmentAtT(Wa, Wb, overlap.tLo, overlap.wallLen);
        const pHi = pointOnSegmentAtT(Wa, Wb, overlap.tHi, overlap.wallLen);

        const z0 = coldBoundaryZM ?? roofTopElevationAtPlanM(roof, pLo.x, pLo.y, floors);
        const z1 = coldBoundaryZM ?? roofTopElevationAtPlanM(roof, pHi.x, pHi.y, floors);
        if (z0 === null || z1 === null) continue;

        const c0w = { x: pLo.x, y: pLo.y, z: z0 };
        const c1w = { x: pHi.x, y: pHi.y, z: z1 };
        const lenW = cold ? overlap.overlapLen : computeThermalBridgeLinearRunLengthM([c0w, c1w]);

        const planLenW = overlap.overlapLen;
        const dzW = Math.abs(z1 - z0);
        out.push({
          proposalId: `r89:${roof.id}:${ow.id}:opaque:e${ei}:${roundToTwoDecimals(overlap.tLo)}:${roundToTwoDecimals(overlap.tHi)}`,
          openingId: ow.id,
          openingName: `${roof.name} ↔ ${ow.name}`,
          zoneId: roof.zoneId ?? ow.zoneId,
          edgeRole: EDGE_ROLE,
          junctionCode,
          suggestedLengthM: roundToTwoDecimals(lenW),
          linearThermalTransmittance: psiTable37ForCode(junctionCode),
          reason: `Table 3.7 ${junctionCode} (${ins}): opaque wall "${ow.name}" along roof edge ${ei} of "${roof.name}" — ${cold ? 'projected ceiling boundary' : 'junction on roof plane'} (plan ${roundToTwoDecimals(
            planLenW,
          )} m, |Δz| ${roundToTwoDecimals(dzW)} m; 3D length ${roundToTwoDecimals(lenW)} m; vertical envelope overlap ${roundToTwoDecimals(
            zHiWorld - zLoWorld,
          )} m)`,
          coordinates: [c0w, c1w],
          parentElementForTb: roof.name,
          roofAdjacentPairIds: [roof.id, ow.id],
        });
      }
    }
  }

  return out;
}
