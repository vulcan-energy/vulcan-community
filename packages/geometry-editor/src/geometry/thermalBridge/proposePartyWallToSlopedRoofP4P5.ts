// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **P4 / P5** (pitched deck only) — `BuildingElementPartyWall` (vertical 2-pt) **plan-coincident** with a **sloped**
 * roof opaque plan **edge** (polygon edge, including eaves). Cold vs warm from `is_unheated_pitched_roof` on the roof.
 *
 * **Flat** (`pitch` 0°) party wall × roof edges use {@link proposePartyWallToFlatRoofP4ThermalBridges} (**P4** only).
 */
import { isRoofLikeOpaqueElement } from '../../lib/roofElement';
import { elementBaseElevationMForTb } from '../../lib/geometry3dMapper';
import { computeSlopedPolygonInwardNormal2D } from '../../lib/geometry3dSloped';
import { getUnheatedPitchedRoofCeilingElevationM } from '../../lib/unheatedPitchedRoofCeiling';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import type { Floor } from '../../stores/geometryStore';
import type { BuildingElementOpaque, Element } from '../types';
import { roundToTwoDecimals } from '../constants';
import { zonesCompatible } from './proposeAdjacentWallJunction';
import { overlapEndpointsOnRoofPlanEdgeForPartyWall } from './partyWallRoofOverlap';
import { isPartyWallVerticalEnvelopeLine } from './proposePartyWallToExternalE18';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from './proposeFacadeOpenings';

function isPitchSlopedNotFlat(o: BuildingElementOpaque): boolean {
  const p = o.pitch;
  return typeof p === 'number' && Number.isFinite(p) && p > 0 && p < 90;
}

function defaultP4P5CodeForRoof(o: BuildingElementOpaque): 'P4' | 'P5' {
  const cold = !!(o as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof;
  return cold ? 'P4' : 'P5';
}

/** Same roof-like + sloped filter as eaves, without “name must contain roof” (party might meet a named roof segment). */
/** Exported for junction host validation alongside {@link isPartyWallVerticalEnvelopeLine}. */
export function isSlopedRoofOpaqueForP4P5(o: BuildingElementOpaque): boolean {
  if (o.isPlaceholder) return false;
  if (!isRoofLikeOpaqueElement(o)) return false;
  return isPitchSlopedNotFlat(o);
}

function zEavesM(o: BuildingElementOpaque, floors: Floor[] | undefined): number {
  if (floors && floors.length > 0) return elementBaseElevationMForTb(o, floors);
  const c = o.coordinates;
  const z0 = typeof c[0]?.z === 'number' && Number.isFinite(c[0].z) ? c[0].z : 0;
  const z1 = typeof c[1]?.z === 'number' && Number.isFinite(c[1].z) ? c[1].z : 0;
  const bh = o.base_height;
  if (typeof bh === 'number' && Number.isFinite(bh) && bh >= 0) return bh;
  return Math.min(z0, z1);
}

export function proposePartyWallToSlopedRoofP4P5ThermalBridges(
  elements: Element[],
  floors?: Floor[] | undefined,
): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const out: FacadeOpeningTbProposal[] = [];
  const partyWalls = elements.filter((e) => isPartyWallVerticalEnvelopeLine(e));

  for (const el of elements) {
    if (el.type !== 'BuildingElementOpaque' || el.isPlaceholder) continue;
    const o = el as BuildingElementOpaque;
    if (!isSlopedRoofOpaqueForP4P5(o)) continue;
    const c = o.coordinates;
    if (!c || c.length < 3) continue;
    const planPts: Array<[number, number]> = c.map((p) => [p.x, p.y] as [number, number]);
    if (computeSlopedPolygonInwardNormal2D(planPts) === null) continue;

    const junctionCode = defaultP4P5CodeForRoof(o);
    const cold = !!(o as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof;
    const zB = cold
      ? getUnheatedPitchedRoofCeilingElevationM(o, elements, floors).value
      : zEavesM(o, floors);

    for (const p of partyWalls) {
      if (!zonesCompatible(o.zoneId, p.zoneId)) continue;

      const n = c.length;
      for (let i = 0; i < n; i++) {
        const Ra = c[i]!;
        const Rb = c[(i + 1) % n]!;
        const hit = overlapEndpointsOnRoofPlanEdgeForPartyWall(Ra, Rb, p);
        if (!hit) continue;
        const { a, b, lenM, ovl } = hit;
        out.push({
          proposalId: `p45:${o.id}:${p.id}:e${i}:${roundToTwoDecimals(ovl.tMid)}`,
          openingId: p.id,
          openingName: `${p.name} ↔ ${o.name} (edge ${i})`,
          zoneId: o.zoneId ?? p.zoneId,
          edgeRole: 'party_wall_to_sloped_roof',
          junctionCode,
          suggestedLengthM: roundToTwoDecimals(lenM),
          linearThermalTransmittance: psiTable37ForCode(junctionCode),
          reason: `${junctionCode} (P4 = ceiling, P5 = rafter) along party line "${p.name}" coincident with roof edge ${i} of "${
            o.name
          }"`,
          coordinates: [
            { x: a.x, y: a.y, z: zB },
            { x: b.x, y: b.y, z: zB },
	          ],
	          parentElementForTb: o.name,
	          hostElementIds: [o.id, p.id],
	        });
      }
    }
  }
  return out;
}
