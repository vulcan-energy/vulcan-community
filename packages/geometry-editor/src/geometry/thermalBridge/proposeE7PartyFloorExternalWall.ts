// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **E7** — party **floor or party ceiling** between dwellings (horizontal junction), meeting an **external** wall:
 * a **horizontal** `BuildingElementAdjacentConditionedSpace` slab (**closed polygon**) with the UI
 * party flag (`_vulcan_ui_party_element`), pitch **0**, plan edge **coincident** with the external wall, at slab
 * elevation **Z** within the wall’s vertical extent.
 *
 * Use the same element pattern for party intermediate slabs and party ceilings; polygon footprints use each
 * boundary segment that overlaps the wall (same edge extraction as **P2** / **P3**).
 *
 * This is **not** party wall × roof (see {@link proposePartyWallToSlopedRoofP4P5ThermalBridges} or
 * {@link proposePartyWallToFlatRoofP4ThermalBridges} for P4/P5) and not vertical party lines (**P1** / **P6**, **P2** / **P3**, **E18**).
 */
import { isVulcanUiPartyFloorElement } from '../../lib/assemblyMaterialFabric';
import { elementBaseElevationMForTb } from '../../lib/geometry3dMapper';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import type { Floor } from '../../geometry/types';
import type { BuildingElementAdjacentConditionedSpace, BuildingElementOpaque, Element } from '../types';
import { roundToTwoDecimals } from '../constants';
import { isExternalLineWall } from './proposeExternalCorners';
import {
  horizontalConditionedFloorSlabPlanEdgesForPartyWallTb,
  planOverlapAdjacentOnWall,
  zonesCompatible,
} from './proposeAdjacentWallJunction';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from './proposeFacadeOpenings';

const Z_BAND_EPS = 0.04;

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Party-flag horizontal conditioned slab host for **E7**: pitch **0**, coplanar footprint, line or polygon with at
 * least one usable plan edge.
 */
export function isPartyHorizontalConditionedFloorSlabHost(
  el: Element,
): el is BuildingElementAdjacentConditionedSpace {
  if (el.type !== 'BuildingElementAdjacentConditionedSpace' || el.isPlaceholder) return false;
  if (!isVulcanUiPartyFloorElement(el)) return false;
  return horizontalConditionedFloorSlabPlanEdgesForPartyWallTb(el).length > 0;
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
  const bh = (wall as { base_height?: number }).base_height;
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

export function proposeE7PartyFloorToExternalWallThermalBridges(
  elements: Element[],
  floors?: Floor[],
): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const walls = elements.filter((e): e is BuildingElementOpaque => isExternalLineWall(e));
  const partyFloors = elements.filter((e): e is BuildingElementAdjacentConditionedSpace =>
    isPartyHorizontalConditionedFloorSlabHost(e),
  );
  const out: FacadeOpeningTbProposal[] = [];

  for (const wall of walls) {
    const W = wall.coordinates;
    if (!W || W.length < 2) continue;
    const Wa = W[0]!;
    const Wb = W[1]!;
    const wExt = wallVerticalExtentM(wall, floors);

    for (const adj of partyFloors) {
      if (!zonesCompatible(wall.zoneId, adj.zoneId)) continue;
      const slabZ =
        floors && floors.length > 0
          ? elementBaseElevationMForTb(adj, floors)
          : (() => {
              const c = adj.coordinates;
              let zMin = Infinity;
              for (const p of c ?? []) {
                const z = typeof p?.z === 'number' && Number.isFinite(p.z) ? p.z : 0;
                zMin = Math.min(zMin, z);
              }
              return Number.isFinite(zMin) ? zMin : 0;
            })();
      if (slabZ < wExt.zLo - Z_BAND_EPS || slabZ > wExt.zHi + Z_BAND_EPS) continue;

      const edges = horizontalConditionedFloorSlabPlanEdgesForPartyWallTb(adj);
      let edgeIdx = 0;
      for (const [[eax, eay], [ebx, eby]] of edges) {
        const overlap = planOverlapAdjacentOnWall(Wa, Wb, { x: eax, y: eay }, { x: ebx, y: eby });
        if (!overlap) {
          edgeIdx++;
          continue;
        }

        const tLo = overlap.tLo;
        const tHi = overlap.tHi;
        const wlen = overlap.wallLen;
        const a = pointOnWallAtT(Wa, Wb, tLo, wlen);
        const b = pointOnWallAtT(Wa, Wb, tHi, wlen);
        const L = dist2XY(a, b);
        if (L < 0.05) {
          edgeIdx++;
          continue;
        }
        const junctionCode = 'E7';
        const zOut = roundToTwoDecimals(slabZ);
        out.push({
          proposalId: `e7:${wall.id}:${adj.id}:e${edgeIdx}:${roundToTwoDecimals(overlap.tMid)}`,
          openingId: adj.id,
          openingName: `${adj.name} ↔ ${wall.name}`,
          zoneId: wall.zoneId ?? adj.zoneId,
          edgeRole: 'e7_party_floor_external',
          junctionCode,
          suggestedLengthM: roundToTwoDecimals(L),
          linearThermalTransmittance: psiTable37ForCode(junctionCode),
          reason: `E7 (party floor or party ceiling between dwellings) at ${zOut} m along external wall "${wall.name}" and party slab "${adj.name}" (plan overlap ${roundToTwoDecimals(
            overlap.overlapLen,
          )} m; edge ${edgeIdx})`,
          coordinates: [
            { x: roundToTwoDecimals(a.x), y: roundToTwoDecimals(a.y), z: zOut },
            { x: roundToTwoDecimals(b.x), y: roundToTwoDecimals(b.y), z: zOut },
          ],
          parentElementForTb: wall.name,
          hostElementIds: [wall.id, adj.id],
        });
        edgeIdx++;
      }
    }
  }
  return out;
}
