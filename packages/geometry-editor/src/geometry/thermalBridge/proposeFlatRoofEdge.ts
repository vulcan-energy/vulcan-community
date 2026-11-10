// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Linear TB along a **flat roof deck edge** (Table 3.7 E14 or E15): horizontal opaque roof
 * (`pitch === 0°`). Roofs may be a **2-point edge** or a **plan polygon** (≥3 vertices); each polygon
 * boundary edge gets one proposal. Default **E14**; **E15** (parapet) is a user choice in the suggest modal.
 */
import { deriveRoofCutout, flatRoofDeckElevationMForTb, isFlatRoofDeckLineForTb } from '../../lib/roofCutouts';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import type { Floor } from '../../geometry/types';
import type { BuildingElementOpaque, Element } from '../types';
import { roundToTwoDecimals } from '../constants';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from '../../lib/simplifiedFabricMap';
import { trimRoofEdgesInsideCutouts } from './proposeSlopedRoofEavesGable';

export { flatRoofDeckElevationMForTb, isFlatRoofDeckLineForTb };

const MIN_EDGE_LEN_XY_M = 0.05;

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Drop repeated closing vertex when first ≈ last (common closed rings). */
export function flatRoofDeckEffectivePolygonVertexCount(c: Array<{ x: number; y: number }>): number {
  if (c.length < 3) return c.length;
  const a = c[0]!;
  const b = c[c.length - 1]!;
  if (dist2XY(a, b) < MIN_EDGE_LEN_XY_M) return c.length - 1;
  return c.length;
}

export function proposeFlatRoofEdgeThermalBridges(
  elements: Element[],
  floors?: Floor[],
  globalOrientationOffset?: number,
): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const out: FacadeOpeningTbProposal[] = [];
  for (const el of elements) {
    if (el.type !== 'BuildingElementOpaque') continue;
    const o = el as BuildingElementOpaque;
    if (!isFlatRoofDeckLineForTb(o)) continue;
    const c = o.coordinates;
    if (!c || c.length < 2) continue;
    const h = typeof o.height === 'number' && o.height > 0 ? o.height : 0;
    if (h <= 0) continue;
    const z = flatRoofDeckElevationMForTb(o, floors);
    const junctionCode = 'E14';

    if (c.length === 2) {
      const lenM = dist2XY(c[0]!, c[1]!);
      if (lenM < MIN_EDGE_LEN_XY_M) continue;
      const p0 = { x: c[0].x, y: c[0].y, z };
      const p1 = { x: c[1].x, y: c[1].y, z };
      out.push({
        proposalId: `${o.id}:flat_roof_edge:e0`,
        openingId: o.id,
        openingName: o.name,
        zoneId: o.zoneId,
        edgeRole: 'flat_roof_edge',
        junctionCode,
        suggestedLengthM: roundToTwoDecimals(lenM),
        linearThermalTransmittance: psiTable37ForCode(junctionCode),
        reason: `Flat roof (E14) or parapet flat roof (E15) along the drawn edge of "${o.name}" (pitch 0°); choose in the junction list.`,
        coordinates: [p0, p1],
        parentElementForTb: o.name,
      });
      continue;
    }

    const nv = flatRoofDeckEffectivePolygonVertexCount(c);
    for (let i = 0; i < nv; i++) {
      const Ra = c[i]!;
      const Rb = c[(i + 1) % nv]!;
      const lenM = dist2XY(Ra, Rb);
      if (lenM < MIN_EDGE_LEN_XY_M) continue;
      const p0 = { x: Ra.x, y: Ra.y, z };
      const p1 = { x: Rb.x, y: Rb.y, z };
      out.push({
        proposalId: `${o.id}:flat_roof_edge:e${i}`,
        openingId: o.id,
        openingName: o.name,
        zoneId: o.zoneId,
        edgeRole: 'flat_roof_edge',
        junctionCode,
        suggestedLengthM: roundToTwoDecimals(lenM),
        linearThermalTransmittance: psiTable37ForCode(junctionCode),
        reason: `Flat roof (E14) or parapet flat roof (E15) along polygon edge ${i} of "${o.name}" (pitch 0°); choose in the junction list.`,
        coordinates: [p0, p1],
        parentElementForTb: o.name,
      });
    }
  }
  // Under a room built on the deck the deck is a floor inside the dwelling: no roof edge there,
  // and each wall standing on it meets that floor (E6, a floor with heated space above and below).
  for (const el of elements) {
    if (el.type !== 'BuildingElementOpaque' || !isFlatRoofDeckLineForTb(el) || (el.coordinates?.length ?? 0) < 3) continue;
    const cutout = deriveRoofCutout(el, elements, floors ?? [], globalOrientationOffset);
    const z = flatRoofDeckElevationMForTb(el, floors);
    for (const { wall, t0, t1 } of cutout?.standing ?? []) {
      const [A, B] = [wall.coordinates[0]!, wall.coordinates[1]!];
      const at = (t: number) => ({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, z });
      const lenM = dist2XY(A, B) * (t1 - t0);
      if (lenM < MIN_EDGE_LEN_XY_M) continue;
      out.push({
        proposalId: `${el.id}:wall_on_deck:${wall.id}:${roundToTwoDecimals(t0)}`,
        openingId: wall.id,
        openingName: `${el.name} ↔ ${wall.name}`,
        zoneId: wall.zoneId ?? el.zoneId,
        edgeRole: 'wall_intermediate_continuous',
        junctionCode: 'E6',
        suggestedLengthM: roundToTwoDecimals(lenM),
        linearThermalTransmittance: psiTable37ForCode('E6'),
        reason: `E6: wall "${wall.name}" stands on the flat roof "${el.name}", which is a floor inside the dwelling under the room the walls enclose`,
        coordinates: [at(t0), at(t1)],
        parentElementForTb: wall.name,
      });
    }
  }
  return trimRoofEdgesInsideCutouts(out, elements, floors ?? [], globalOrientationOffset);
}
