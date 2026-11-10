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
import type { Floor } from '../../geometry/types';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { distPointToSegmentXY } from './tbLinkage';
import { isExternalLineWall } from './proposeExternalCorners';
import {
  ADJACENT_WALL_COINCIDENT_PERP_TOL_M,
  type LineVerticalExtentM,
  opaqueEnvelopeVerticalExtentM,
  planOverlapAdjacentOnWall,
  zonesCompatible,
} from './proposeAdjacentWallJunction';
import { lineFaceEdgesAtPoint } from '../../lib/profileLineFace';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from '../../lib/simplifiedFabricMap';

const MIN_PLAN = 0.05;
const MIN_VERT = 0.05;
const MIN_WALL = 0.05;

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Vertical span of a two-point party wall — reused by party-wall × roof and floor TB proposers. */
export function partyWallVerticalExtentM(
  p: BuildingElementPartyWall,
  floors: Floor[] | undefined,
): LineVerticalExtentM {
  return opaqueEnvelopeVerticalExtentM(p, floors);
}

/** Vertical span of a line at a plan point on it: its face there, above its foot. */
function verticalExtentAtPointM(
  el: BuildingElementOpaque | BuildingElementPartyWall,
  ext: LineVerticalExtentM,
  p: { x: number; y: number },
): { zLo: number; zHi: number } {
  const { bottom, top } = lineFaceEdgesAtPoint(el, p);
  return { zLo: ext.foot + bottom, zHi: ext.foot + top };
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
  wExt: LineVerticalExtentM,
  floors: Floor[] | undefined,
  cornerSeen: Set<string>,
  out: FacadeOpeningTbProposal[],
): void {
  const Pa = party.coordinates[0]!;
  const Pb = party.coordinates[1]!;
  const pExt = partyWallVerticalExtentM(party, floors);

  const tol = ADJACENT_WALL_COINCIDENT_PERP_TOL_M;
  const junctionCode = 'E18';

  const tryEmit = (planX: number, planY: number, source: string) => {
    // Both faces at the junction itself: a shaped wall's height varies along it.
    const w = verticalExtentAtPointM(wall, wExt, { x: planX, y: planY });
    const p = verticalExtentAtPointM(party, pExt, { x: planX, y: planY });
    const zLo = Math.max(w.zLo, p.zLo);
    const zHi = Math.min(w.zHi, p.zHi);
    if (zHi - zLo < MIN_VERT) return;
    const len = zHi - zLo;
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
    const wExt = opaqueEnvelopeVerticalExtentM(wall, floors);

    for (const p of partyWalls) {
      if (!zonesCompatible(wall.zoneId, p.zoneId)) continue;
      const P = p.coordinates;
      const overlap = planOverlapAdjacentOnWall(Wa, Wb, P[0], P[1]);
      if (overlap) {
        const { x, y } = pointOnWallAtT(Wa, Wb, overlap.tMid, overlap.wallLen);
        const wAt = verticalExtentAtPointM(wall, wExt, { x, y });
        const pAt = verticalExtentAtPointM(p, partyWallVerticalExtentM(p, floors), { x, y });
        const zLo = Math.max(wAt.zLo, pAt.zLo);
        const zHi = Math.min(wAt.zHi, pAt.zHi);
        if (zHi - zLo < MIN_VERT) continue;
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
