// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **R8** / **R9** where a vertical wall bears on a sloped roof surface inside the roof's plan:
 * - a **dormer** wall (cheek or front) on its **host** roof, resolved by
 *   `extra_json.dormer_bundle.host_element_name`;
 * - an external wall whose shaped bottom edge stands on a roof ("On roof" in the wall shape rows),
 *   along each stretch of the bottom edge that lies on a roof plane.
 * {@link proposeRoomInRoofRoofToWallR8R9ThermalBridges} only pairs roof **polygon boundary** edges
 * with walls; these lines usually lie **inside** the roof plan, so they are added here.
 */
import type { Floor } from '../../geometry/types';
import type { BuildingElementOpaque, Element } from '../types';
import { computeThermalBridgeLinearRunLengthM } from '../../lib/thermalBridgeLinearGeometry';
import { roofTopElevationAtPlanM } from '../../lib/roofTopElevationAtPlanM';
import { getUnheatedPitchedRoofCeilingElevationM } from '../../lib/unheatedPitchedRoofCeiling';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { roundToTwoDecimals } from '../constants';
import { opaqueEnvelopeVerticalExtentM, zonesCompatible } from './proposeAdjacentWallJunction';
import { type FacadeOpeningEdgeRole, type FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from '../../lib/simplifiedFabricMap';
import { bottomEdgeRoofRuns, pitchedRoofsForWalls } from '../../lib/roofCutouts';
import { isExternalLineWall } from './proposeExternalCorners';

const MIN_WALL_PLAN_LEN_M = 0.05;
const ROOF_WALL_Z_OVERLAP_PAD_M = 0.45;

const EDGE_ROLE: FacadeOpeningEdgeRole = 'sloped_roof_to_adjacent_wall_r8_r9';

function dormerBundleHostName(w: BuildingElementOpaque): string | null {
  const b = w.extra_json?.dormer_bundle;
  if (!b || typeof b !== 'object') return null;
  const n = (b as { host_element_name?: string }).host_element_name;
  if (typeof n !== 'string' || !n.trim()) return null;
  return n.trim();
}

function isDormerVerticalWallForHostMeet(w: BuildingElementOpaque): boolean {
  if (w.isPlaceholder) return false;
  const b = w.extra_json?.dormer_bundle;
  if (!b || typeof b !== 'object') return false;
  const role = (b as { role?: string }).role;
  if (typeof role !== 'string') return false;
  if (role !== 'front-wall-anchor' && role !== 'left-cheek-wall' && role !== 'right-cheek-wall') {
    return false;
  }
  const pitch = w.pitch;
  if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch !== 90) return false;
  const c = w.coordinates;
  if (!c || c.length !== 2) return false;
  if (Math.hypot(c[1]!.x - c[0]!.x, c[1]!.y - c[0]!.y) < MIN_WALL_PLAN_LEN_M) return false;
  const h = typeof w.height === 'number' && w.height > 0 ? w.height : 0;
  return h > 0;
}

function junctionR8OrR9ForRoof(roof: BuildingElementOpaque): 'R8' | 'R9' {
  const cold = !!(roof as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof;
  return cold ? 'R9' : 'R8';
}

function coldPitchedRoofBoundaryZM(
  roof: BuildingElementOpaque,
  elements: Element[],
  floors: Floor[] | undefined,
): number {
  return getUnheatedPitchedRoofCeilingElevationM(roof, elements, floors).value;
}

export function proposeDormerWallToHostRoofR8R9ThermalBridges(
  elements: Element[],
  floors?: Floor[],
  globalOrientationOffset?: number,
): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const roofs = pitchedRoofsForWalls(elements, globalOrientationOffset);
  const roofByName = new Map<string, BuildingElementOpaque>();
  for (const o of roofs) {
    const n = (o.name ?? '').trim();
    if (n) roofByName.set(n, o);
  }

  const out: FacadeOpeningTbProposal[] = [];
  const pushWallOnRoof = (
    w: BuildingElementOpaque,
    roof: BuildingElementOpaque,
    A: { x: number; y: number },
    B: { x: number; y: number },
    run: string | null,
  ): void => {
    const cold = !!(roof as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof;
    const coldBoundaryZM = cold ? coldPitchedRoofBoundaryZM(roof, elements, floors) : null;
    const z0 = coldBoundaryZM ?? roofTopElevationAtPlanM(roof, A.x, A.y, floors, globalOrientationOffset);
    const z1 = coldBoundaryZM ?? roofTopElevationAtPlanM(roof, B.x, B.y, floors, globalOrientationOffset);
    if (z0 === null || z1 === null) return;

    const wExt = opaqueEnvelopeVerticalExtentM(w, floors);
    const rLo = Math.min(z0, z1) - ROOF_WALL_Z_OVERLAP_PAD_M;
    const rHi = Math.max(z0, z1) + ROOF_WALL_Z_OVERLAP_PAD_M;
    if (wExt.zHi < rLo || wExt.zLo > rHi) return;

    const c0 = { x: A.x, y: A.y, z: z0 };
    const c1 = { x: B.x, y: B.y, z: z1 };
    const planLen = Math.hypot(B.x - A.x, B.y - A.y);
    const len = cold ? planLen : computeThermalBridgeLinearRunLengthM([c0, c1]);
    if (len < MIN_WALL_PLAN_LEN_M) return;

    const junctionCode = junctionR8OrR9ForRoof(roof);
    const ins = cold
      ? 'cold roof (insulation at ceiling line)'
      : 'warm roof (insulation at rafter line)';
    const dz = Math.abs(z1 - z0);

    out.push({
      proposalId: run === null
        ? `dormerhostr89:${roof.id}:${w.id}:${roundToTwoDecimals(len)}`
        : `onroofr89:${roof.id}:${w.id}:${run}`,
      openingId: w.id,
      openingName: `${roof.name}${run === null ? ' (host)' : ''} ↔ ${w.name}`,
      zoneId: roof.zoneId ?? w.zoneId,
      edgeRole: EDGE_ROLE,
      junctionCode,
      suggestedLengthM: roundToTwoDecimals(len),
      linearThermalTransmittance: psiTable37ForCode(junctionCode),
      reason: `Table 3.7 ${junctionCode} (${ins}): ${run === null ? 'dormer wall' : 'wall'} "${w.name}" on ${run === null ? '**host** roof' : 'roof'} "${roof.name}" (${cold ? 'projected ceiling boundary' : 'footprint on roof plane'}; plan ${roundToTwoDecimals(planLen)} m; |Δz| ${roundToTwoDecimals(dz)} m; 3D length ${roundToTwoDecimals(len)} m)`,
      coordinates: [c0, c1],
      parentElementForTb: roof.name,
      roofAdjacentPairIds: [roof.id, w.id],
    });
  };

  for (const el of elements) {
    if (el.type !== 'BuildingElementOpaque' || el.isPlaceholder) continue;
    const w = el as BuildingElementOpaque;
    if (isDormerVerticalWallForHostMeet(w)) {
      const hostName = dormerBundleHostName(w);
      const roof = hostName ? roofByName.get(hostName) : undefined;
      if (!roof || !zonesCompatible(w.zoneId, roof.zoneId)) continue;
      pushWallOnRoof(w, roof, w.coordinates[0]!, w.coordinates[1]!, null);
    } else if (isExternalLineWall(w)) {
      const [A, B] = [w.coordinates[0]!, w.coordinates[1]!];
      const at = (t: number) => ({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
      for (const run of bottomEdgeRoofRuns(w, roofs, floors, globalOrientationOffset)) {
        pushWallOnRoof(w, run.roof, at(run.t0), at(run.t1), `${roundToTwoDecimals(run.t0)}`);
      }
    }
  }

  return out;

}
