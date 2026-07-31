// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **E18** (party wall between dwellings): **vertical** junction where a
 * `BuildingElementPartyWall` line is plan-coincident (within the same tolerance as
 * P1–P3) with an **external** opaque wall, with positive vertical overlap. Table 3.7
 * describes this as party wall to external. **P2/P3** are party wall × intermediate floor
 * ({@link proposePartyWallIntermediateFloorP2P3ThermalBridges}), not external wall.
 */
import { roundToTwoDecimals } from '../constants';
import type { BuildingElementOpaque, BuildingElementPartyWall, Element } from '../types';
import type { Floor } from '../../stores/geometryStore';
import { elementBaseElevationMForTb } from '../../lib/geometry3dMapper';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { distPointToSegmentXY } from './tbLinkage';
import { isExternalLineWall } from './proposeExternalCorners';
import {
  ADJACENT_WALL_COINCIDENT_PERP_TOL_M,
  planOverlapAdjacentOnWall,
  zonesCompatible,
} from './proposeAdjacentWallJunction';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from './proposeFacadeOpenings';

const MIN_PLAN = 0.05;
const MIN_VERT = 0.05;
const MIN_WALL = 0.05;

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function partyBaseLegacy(p: BuildingElementPartyWall): number {
  const c = p.coordinates;
  const z0 = typeof c[0]?.z === 'number' && Number.isFinite(c[0].z) ? c[0].z : 0;
  const z1 = typeof c[1]?.z === 'number' && Number.isFinite(c[1].z) ? c[1].z : 0;
  const bh = p.base_height;
  if (typeof bh === 'number' && Number.isFinite(bh) && bh >= 0) return bh;
  return Math.min(z0, z1);
}

/** Vertical span of a two-point party wall — reused by party-wall × roof TB proposers. */
export function partyWallVerticalExtentM(
  p: BuildingElementPartyWall,
  floors: Floor[] | undefined,
): { zLo: number; zHi: number } {
  const h = typeof p.height === 'number' && p.height > 0 ? p.height : 0;
  if (floors && floors.length > 0) {
    const zLo = elementBaseElevationMForTb(p, floors);
    return { zLo, zHi: zLo + h };
  }
  const zLo = partyBaseLegacy(p);
  return { zLo, zHi: zLo + h };
}

/** Two-point vertical party wall (pitch unset or 90°), for TB pairing with an external wall. */
export function isPartyWallVerticalEnvelopeLine(el: Element): el is BuildingElementPartyWall {
  if (el.type !== 'BuildingElementPartyWall') return false;
  if (el.isPlaceholder) return false;
  const coords = el.coordinates;
  if (!coords || coords.length !== 2) return false;
  const pitch = el.pitch;
  if (typeof pitch === 'number' && Number.isFinite(pitch) && pitch !== 90) return false;
  if (dist2XY(coords[0], coords[1]) < MIN_WALL) return false;
  if (typeof el.height !== 'number' || el.height < MIN_PLAN) return false;
  return true;
}

function wallVerticalExtentM(
  wall: BuildingElementOpaque,
  floors: Floor[] | undefined,
): { zLo: number; zHi: number } {
  const h = typeof wall.height === 'number' && wall.height > 0 ? wall.height : 0;
  if (floors && floors.length > 0) {
    const zLo = elementBaseElevationMForTb(wall, floors);
    return { zLo, zHi: zLo + h };
  }
  const c = wall.coordinates;
  const z0 = typeof c[0]?.z === 'number' && Number.isFinite(c[0].z) ? c[0].z : 0;
  const z1 = typeof c[1]?.z === 'number' && Number.isFinite(c[1].z) ? c[1].z : 0;
  const bh = wall.base_height;
  const zLo = typeof bh === 'number' && Number.isFinite(bh) && bh >= 0 ? bh : Math.min(z0, z1);
  return { zLo, zHi: zLo + h };
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

function appendPartyExternalCornerE18WhenNoColinearOverlap(
  wall: BuildingElementOpaque,
  party: BuildingElementPartyWall,
  Wa: { x: number; y: number },
  Wb: { x: number; y: number },
  wallLen: number,
  wExt: { zLo: number; zHi: number },
  floors: Floor[] | undefined,
  cornerSeen: Set<string>,
  out: FacadeOpeningTbProposal[],
): void {
  const Pa = party.coordinates[0]!;
  const Pb = party.coordinates[1]!;
  const pExt = partyWallVerticalExtentM(party, floors);
  const zLo = Math.max(wExt.zLo, pExt.zLo);
  const zHi = Math.min(wExt.zHi, pExt.zHi);
  if (zHi - zLo < MIN_VERT) return;

  const tol = ADJACENT_WALL_COINCIDENT_PERP_TOL_M;
  const junctionCode = 'E18';
  const len = zHi - zLo;

  const tryEmit = (planX: number, planY: number, source: string) => {
    const sig = `${wall.id}:${party.id}:${roundToTwoDecimals(planX)}:${roundToTwoDecimals(planY)}`;
    if (cornerSeen.has(sig)) return;
    cornerSeen.add(sig);
    out.push({
      proposalId: `e18corner:${wall.id}:${party.id}:${source}:${sig}`,
      openingId: party.id,
      openingName: `${party.name} ↔ ${wall.name}`,
      zoneId: wall.zoneId ?? party.zoneId,
      edgeRole: 'party_to_external_e18',
      junctionCode,
      suggestedLengthM: roundToTwoDecimals(len),
      linearThermalTransmittance: psiTable37ForCode(junctionCode),
      reason: `E18 (party wall between dwellings) at perpendicular junction of party line "${party.name}" with external wall "${wall.name}" (${source}; vertical overlap ${roundToTwoDecimals(len)} m)`,
      coordinates: [
        { x: planX, y: planY, z: zLo },
        { x: planX, y: planY, z: zHi },
	      ],
	      parentElementForTb: wall.name,
	      hostElementIds: [wall.id, party.id],
	    });
	  };

  const partyEndpointOnWall = (px: number, py: number) => {
    const d = distPointToSegmentXY(px, py, Wa.x, Wa.y, Wb.x, Wb.y);
    if (d.dist > tol || d.segLen < 1e-9) return;
    const tAlong = d.t * d.segLen;
    const { x, y } = pointOnWallAtT(Wa, Wb, tAlong, wallLen);
    tryEmit(x, y, 'party endpoint on external wall line');
  };

  partyEndpointOnWall(Pa.x, Pa.y);
  partyEndpointOnWall(Pb.x, Pb.y);

  const wallEndpointOnParty = (wx: number, wy: number) => {
    const d = distPointToSegmentXY(wx, wy, Pa.x, Pa.y, Pb.x, Pb.y);
    if (d.dist > tol || d.segLen < 1e-9) return;
    const tAlong = d.t * d.segLen;
    const vx = Pb.x - Pa.x;
    const vy = Pb.y - Pa.y;
    if (d.segLen < 1e-9) return;
    const ux = vx / d.segLen;
    const uy = vy / d.segLen;
    const x = Pa.x + ux * tAlong;
    const y = Pa.y + uy * tAlong;
    tryEmit(x, y, 'external wall endpoint on party line');
  };

  wallEndpointOnParty(Wa.x, Wa.y);
  wallEndpointOnParty(Wb.x, Wb.y);
}

export function proposePartyWallToExternalE18(
  elements: Element[],
  floors?: Floor[],
): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const walls = elements.filter((e): e is BuildingElementOpaque => isExternalLineWall(e));
  const partyWalls = elements.filter((e): e is BuildingElementPartyWall => isPartyWallVerticalEnvelopeLine(e));
  const out: FacadeOpeningTbProposal[] = [];
  const cornerSeen = new Set<string>();

  for (const wall of walls) {
    const W = wall.coordinates;
    const Wa = W[0];
    const Wb = W[1];
    const wallLen = dist2XY(Wa, Wb);
    const wExt = wallVerticalExtentM(wall, floors);

    for (const p of partyWalls) {
      if (!zonesCompatible(wall.zoneId, p.zoneId)) continue;
      const P = p.coordinates;
      const overlap = planOverlapAdjacentOnWall(Wa, Wb, P[0], P[1]);
      if (overlap) {
        const pExt = partyWallVerticalExtentM(p, floors);
        const zLo = Math.max(wExt.zLo, pExt.zLo);
        const zHi = Math.min(wExt.zHi, pExt.zHi);
        if (zHi - zLo < MIN_VERT) continue;
        const { x, y } = pointOnWallAtT(Wa, Wb, overlap.tMid, overlap.wallLen);
        const len = zHi - zLo;
        const junctionCode = 'E18';
        out.push({
          proposalId: `e18:${wall.id}:${p.id}:${roundToTwoDecimals(overlap.tMid)}`,
          openingId: p.id,
          openingName: `${p.name} ↔ ${wall.name}`,
          zoneId: wall.zoneId ?? p.zoneId,
          edgeRole: 'party_to_external_e18',
          junctionCode,
          suggestedLengthM: roundToTwoDecimals(len),
          linearThermalTransmittance: psiTable37ForCode(junctionCode),
          reason: `E18 (party wall between dwellings) along coincident run of party line "${p.name}" with external wall "${wall.name}" (plan overlap ${roundToTwoDecimals(overlap.overlapLen)} m; vertical overlap ${roundToTwoDecimals(len)} m)`,
          coordinates: [
            { x, y, z: zLo },
            { x, y, z: zHi },
	          ],
	          parentElementForTb: wall.name,
	          hostElementIds: [wall.id, p.id],
	        });
      } else {
        appendPartyExternalCornerE18WhenNoColinearOverlap(wall, p, Wa, Wb, wallLen, wExt, floors, cornerSeen, out);
      }
    }
  }
  return out;
}
