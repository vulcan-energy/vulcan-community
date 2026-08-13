// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **R8** / **R9** where a vertical **dormer** wall (cheek or front) bears on the **host** main sloped roof
 * surface. {@link proposeRoomInRoofRoofToWallR8R9ThermalBridges} only pairs roof **polygon boundary** edges
 * with walls; the cut line under a dormer usually lies **inside** the host roof plan, so it is added here
 * using `extra_json.dormer_bundle.host_element_name` to resolve the host opaque.
 */
import type { Floor } from '../../geometry/types';
import type { BuildingElementOpaque, Element } from '../types';
import { computeThermalBridgeLinearRunLengthM } from '../../lib/thermalBridgeLinearGeometry';
import { inwardNormal2DForSlopedRoof, roofTopElevationAtPlanM } from '../../lib/roofTopElevationAtPlanM';
import { getUnheatedPitchedRoofCeilingElevationM } from '../../lib/unheatedPitchedRoofCeiling';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { roundToTwoDecimals } from '../constants';
import { opaqueEnvelopeVerticalExtentM, zonesCompatible } from './proposeAdjacentWallJunction';
import { isSlopedPitchedRoofElementForEavesGable } from './proposeSlopedRoofEavesGable';
import { isOrientationPitchAxis } from '../../lib/slopePitchAxis';
import { type FacadeOpeningEdgeRole, type FacadeOpeningTbProposal, psiTable37ForCode } from './proposeFacadeOpenings';

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
  const roofByName = new Map<string, BuildingElementOpaque>();
  for (const e of elements) {
    if (e.type !== 'BuildingElementOpaque' || e.isPlaceholder) continue;
    const o = e as BuildingElementOpaque;
    if (isOrientationPitchAxis(o) && !inwardNormal2DForSlopedRoof(o, globalOrientationOffset)) continue;
    if (!isSlopedPitchedRoofElementForEavesGable(o)) continue;
    const n = (o.name ?? '').trim();
    if (n) roofByName.set(n, o);
  }

  const out: FacadeOpeningTbProposal[] = [];

  for (const el of elements) {
    if (el.type !== 'BuildingElementOpaque' || el.isPlaceholder) continue;
    const w = el as BuildingElementOpaque;
    if (!isDormerVerticalWallForHostMeet(w)) continue;

    const hostName = dormerBundleHostName(w);
    if (!hostName) continue;

    const roof = roofByName.get(hostName);
    if (!roof || !zonesCompatible(w.zoneId, roof.zoneId)) continue;

    const c = w.coordinates;
    if (!c || c.length !== 2) continue;
    const A = c[0]!;
    const B = c[1]!;

    const cold = !!(roof as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof;
    const coldBoundaryZM = cold ? coldPitchedRoofBoundaryZM(roof, elements, floors) : null;
    const z0 = coldBoundaryZM ?? roofTopElevationAtPlanM(roof, A.x, A.y, floors, globalOrientationOffset);
    const z1 = coldBoundaryZM ?? roofTopElevationAtPlanM(roof, B.x, B.y, floors, globalOrientationOffset);
    if (z0 === null || z1 === null) continue;

    const wExt = opaqueEnvelopeVerticalExtentM(w, floors);
    const rLo = Math.min(z0, z1) - ROOF_WALL_Z_OVERLAP_PAD_M;
    const rHi = Math.max(z0, z1) + ROOF_WALL_Z_OVERLAP_PAD_M;
    if (wExt.zHi < rLo || wExt.zLo > rHi) continue;

    const c0 = { x: A.x, y: A.y, z: z0 };
    const c1 = { x: B.x, y: B.y, z: z1 };
    const planLen = Math.hypot(B.x - A.x, B.y - A.y);
    const len = cold ? planLen : computeThermalBridgeLinearRunLengthM([c0, c1]);
    if (len < MIN_WALL_PLAN_LEN_M) continue;

    const junctionCode = junctionR8OrR9ForRoof(roof);
    const ins = cold
      ? 'cold roof (insulation at ceiling line)'
      : 'warm roof (insulation at rafter line)';
    const dz = Math.abs(z1 - z0);

    out.push({
      proposalId: `dormerhostr89:${roof.id}:${w.id}:${roundToTwoDecimals(len)}`,
      openingId: w.id,
      openingName: `${roof.name} (host) ↔ ${w.name}`,
      zoneId: roof.zoneId ?? w.zoneId,
      edgeRole: EDGE_ROLE,
      junctionCode,
      suggestedLengthM: roundToTwoDecimals(len),
      linearThermalTransmittance: psiTable37ForCode(junctionCode),
      reason: `Table 3.7 ${junctionCode} (${ins}): dormer wall "${w.name}" on **host** roof "${roof.name}" (${cold ? 'projected ceiling boundary' : 'footprint on roof plane'}; plan ${roundToTwoDecimals(planLen)} m; |Δz| ${roundToTwoDecimals(dz)} m; 3D length ${roundToTwoDecimals(len)} m)`,
      coordinates: [c0, c1],
      parentElementForTb: roof.name,
      roofAdjacentPairIds: [roof.id, w.id],
    });
  }

  return out;
}
