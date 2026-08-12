// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Explicit **R10** candidates for roof-to-roof junctions where a dormer roof ties back into
 * its host roof. These are not eaves, gable/rake, ridge, or roof-window edges; Table K1
 * names R10 as "all other roof or room-in-roof junctions".
 */
import type { Floor } from '../../geometry/types';
import type { BuildingElementOpaque, Element } from '../types';
import { computeThermalBridgeLinearRunLengthM } from '../../lib/thermalBridgeLinearGeometry';
import { roofTopElevationAtPlanM } from '../../lib/roofTopElevationAtPlanM';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { roundToTwoDecimals } from '../constants';
import { type FacadeOpeningEdgeRole, type FacadeOpeningTbProposal, psiTable37ForCode } from './proposeFacadeOpenings';
import { isSlopedPitchedRoofElementForEavesGable } from './proposeSlopedRoofEavesGable';
import { zonesCompatible } from './proposeAdjacentWallJunction';

const MIN_LEN_M = 0.05;
const GABLE_PERP_COS = 0.2;
const RIDGE_PARALLEL_COS = 0.85;
const EDGE_ROLE: FacadeOpeningEdgeRole = 'dormer_roof_to_host_roof_r10';

function dormerBundleHostName(roof: BuildingElementOpaque): string | null {
  const b = roof.extra_json?.dormer_bundle;
  if (!b || typeof b !== 'object') return null;
  const n = (b as { host_element_name?: string }).host_element_name;
  if (typeof n !== 'string' || !n.trim()) return null;
  return n.trim();
}

function isDormerRoofPlane(roof: BuildingElementOpaque): boolean {
  const b = roof.extra_json?.dormer_bundle;
  if (!b || typeof b !== 'object') return false;
  const role = (b as { role?: string }).role;
  return role === 'left-roof' || role === 'right-roof' || role === 'roof';
}

function isColdPitchedRoof(roof: BuildingElementOpaque): boolean {
  return !!(roof as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof;
}

function planUnit(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return null;
  return { x: dx / L, y: dy / L };
}

function isOtherDormerRoofEdge(
  c: Array<{ x: number; y: number }>,
  edgeIndex: number,
  eavesUnit: { x: number; y: number },
): boolean {
  if (edgeIndex === 0) return false;
  const a = c[edgeIndex]!;
  const b = c[(edgeIndex + 1) % c.length]!;
  const edgeUnit = planUnit(a, b);
  if (!edgeUnit) return false;
  const dot = Math.abs(eavesUnit.x * edgeUnit.x + eavesUnit.y * edgeUnit.y);
  return dot >= GABLE_PERP_COS && dot <= RIDGE_PARALLEL_COS;
}

export function proposeDormerRoofToHostRoofR10ThermalBridges(
  elements: Element[],
  floors?: Floor[],
): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const roofByName = new Map<string, BuildingElementOpaque>();
  for (const e of elements) {
    if (e.type !== 'BuildingElementOpaque' || e.isPlaceholder) continue;
    const roof = e as BuildingElementOpaque;
    if (!isSlopedPitchedRoofElementForEavesGable(roof)) continue;
    const name = roof.name?.trim();
    if (name) roofByName.set(name, roof);
  }

  const out: FacadeOpeningTbProposal[] = [];
  for (const e of elements) {
    if (e.type !== 'BuildingElementOpaque' || e.isPlaceholder) continue;
    const dormerRoof = e as BuildingElementOpaque;
    if (!isDormerRoofPlane(dormerRoof)) continue;
    if (!isSlopedPitchedRoofElementForEavesGable(dormerRoof)) continue;
    const c = dormerRoof.coordinates;
    if (!Array.isArray(c) || c.length < 4) continue;

    const hostName = dormerBundleHostName(dormerRoof);
    if (!hostName) continue;
    const hostRoof = roofByName.get(hostName);
    if (!hostRoof || !zonesCompatible(dormerRoof.zoneId, hostRoof.zoneId)) continue;
    if (isColdPitchedRoof(hostRoof) || isColdPitchedRoof(dormerRoof)) continue;

    const eavesUnit = planUnit(c[0]!, c[1]!);
    if (!eavesUnit) continue;

    for (let i = 1; i < c.length; i++) {
      if (!isOtherDormerRoofEdge(c, i, eavesUnit)) continue;
      const a = c[i]!;
      const b = c[(i + 1) % c.length]!;
      const z0 = roofTopElevationAtPlanM(hostRoof, a.x, a.y, floors);
      const z1 = roofTopElevationAtPlanM(hostRoof, b.x, b.y, floors);
      if (z0 === null || z1 === null) continue;
      const coords = [
        { x: a.x, y: a.y, z: z0 },
        { x: b.x, y: b.y, z: z1 },
      ] as const;
      const len = computeThermalBridgeLinearRunLengthM([...coords]);
      if (len < MIN_LEN_M) continue;

      out.push({
        proposalId: `dormerroofr10:${hostRoof.id}:${dormerRoof.id}:e${i}:${roundToTwoDecimals(len)}`,
        openingId: dormerRoof.id,
        openingName: `${dormerRoof.name} ↔ ${hostRoof.name}`,
        zoneId: dormerRoof.zoneId ?? hostRoof.zoneId,
        edgeRole: EDGE_ROLE,
        junctionCode: 'R10',
        suggestedLengthM: roundToTwoDecimals(len),
        linearThermalTransmittance: psiTable37ForCode('R10'),
        reason: `R10 all-other roof / room-in-roof junction along edge ${i} of dormer roof "${dormerRoof.name}" where it ties into host roof "${hostRoof.name}"`,
        coordinates: [
          { x: a.x, y: a.y, z: roundToTwoDecimals(z0) },
          { x: b.x, y: b.y, z: roundToTwoDecimals(z1) },
        ],
        parentElementForTb: hostRoof.name,
        hostElementIds: [hostRoof.id, dormerRoof.id],
      });
    }
  }

  return out;
}
