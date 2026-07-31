// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **P4** — `BuildingElementPartyWall` (vertical 2-point) **plan-coincident** with an edge of a **flat**
 * external roof `BuildingElementOpaque` (`pitch === 0°`): 2-point deck line or polygon boundary (same
 * geometry pass as {@link proposeFlatRoofEdgeThermalBridges}). Cold deck / insulation above the line is
 * the usual SAP reading; the preview fixes junction **P4** (no **P5** on horizontal decks — that remains
 * pitched-roof only in {@link proposePartyWallToSlopedRoofP4P5ThermalBridges}).
 */
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import type { Floor } from '../../stores/geometryStore';
import type { BuildingElementOpaque, BuildingElementPartyWall, Element } from '../types';
import { roundToTwoDecimals } from '../constants';
import {
  flatRoofDeckEffectivePolygonVertexCount,
  flatRoofDeckElevationMForTb,
  isFlatRoofDeckLineForTb,
} from './proposeFlatRoofEdge';
import { zonesCompatible } from './proposeAdjacentWallJunction';
import {
  isPartyWallVerticalEnvelopeLine,
  partyWallVerticalExtentM,
} from './proposePartyWallToExternalE18';
import {
  dist2XYPlan,
  overlapEndpointsOnRoofPlanEdgeForPartyWall,
} from './partyWallRoofOverlap';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from './proposeFacadeOpenings';

const Z_BAND_M = 0.04;

function partyWallContainsDeckZM(
  p: BuildingElementPartyWall,
  floors: Floor[] | undefined,
  deckZ: number,
): boolean {
  const { zLo, zHi } = partyWallVerticalExtentM(p, floors);
  return deckZ >= zLo - Z_BAND_M && deckZ <= zHi + Z_BAND_M;
}

/** Same roof predicate as flat deck edges, plus positive slab depth (matches {@link proposeFlatRoofEdgeThermalBridges}). */
export function isFlatRoofOpaqueForPartyWallToFlatRoofP4(o: BuildingElementOpaque): boolean {
  if (!isFlatRoofDeckLineForTb(o)) return false;
  const h = typeof o.height === 'number' && o.height > 0 ? o.height : 0;
  return h > 0;
}

export function proposePartyWallToFlatRoofP4ThermalBridges(
  elements: Element[],
  floors?: Floor[] | undefined,
): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const out: FacadeOpeningTbProposal[] = [];
  const partyWalls = elements.filter((e): e is BuildingElementPartyWall => isPartyWallVerticalEnvelopeLine(e));

  for (const el of elements) {
    if (el.type !== 'BuildingElementOpaque' || el.isPlaceholder) continue;
    const o = el as BuildingElementOpaque;
    if (!isFlatRoofOpaqueForPartyWallToFlatRoofP4(o)) continue;
    const c = o.coordinates;
    if (!c || c.length < 2) continue;

    const deckZ = flatRoofDeckElevationMForTb(o, floors);
    const junctionCode = 'P4';

    const emitEdge = (Ra: { x: number; y: number }, Rb: { x: number; y: number }, edgeIdx: number) => {
      if (dist2XYPlan(Ra, Rb) < 1e-4) return;
      for (const p of partyWalls) {
        if (!zonesCompatible(o.zoneId, p.zoneId)) continue;
        if (!partyWallContainsDeckZM(p, floors, deckZ)) continue;
        const hit = overlapEndpointsOnRoofPlanEdgeForPartyWall(Ra, Rb, p);
        if (!hit) continue;
        const { a, b, lenM, ovl } = hit;
        out.push({
          proposalId: `p4flat:${o.id}:${p.id}:e${edgeIdx}:${roundToTwoDecimals(ovl.tMid)}`,
          openingId: p.id,
          openingName: `${p.name} ↔ ${o.name} (flat roof edge ${edgeIdx})`,
          zoneId: o.zoneId ?? p.zoneId,
          edgeRole: 'party_wall_to_flat_roof',
          junctionCode,
          suggestedLengthM: roundToTwoDecimals(lenM),
          linearThermalTransmittance: psiTable37ForCode(junctionCode),
          reason: `P4 along party line "${p.name}" coincident with flat roof edge ${edgeIdx} of "${o.name}" (pitch 0°).`,
          coordinates: [
            { x: a.x, y: a.y, z: deckZ },
            { x: b.x, y: b.y, z: deckZ },
	          ],
	          parentElementForTb: o.name,
	          hostElementIds: [o.id, p.id],
	        });
      }
    };

    if (c.length === 2) {
      emitEdge(c[0]!, c[1]!, 0);
      continue;
    }

    const nv = flatRoofDeckEffectivePolygonVertexCount(c);
    for (let i = 0; i < nv; i++) {
      emitEdge(c[i]!, c[(i + 1) % nv]!, i);
    }
  }

  return out;
}
