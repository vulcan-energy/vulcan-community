// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Linear TB along a **flat roof deck edge** (Table 3.7 E14 or E15): horizontal opaque roof
 * (`pitch === 0°`). Roofs may be a **2-point edge** or a **plan polygon** (≥3 vertices); each polygon
 * boundary edge gets one proposal. Default **E14**; **E15** (parapet) is a user choice in the suggest modal.
 */
import { elementBaseElevationMForTb } from '../../lib/geometry3dMapper';
import { isRoofLikeOpaqueElement } from '../../lib/roofElement';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import type { Floor } from '../../geometry/types';
import type { BuildingElementOpaque, Element } from '../types';
import { roundToTwoDecimals } from '../constants';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from './proposeFacadeOpenings';

const MIN_EDGE_LEN_XY_M = 0.05;

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * True for a **horizontal flat roof** line: roof-like, pitch exactly 0, and we can tell it is a roof
 * (name or HEM unheated-pitched flag), not an arbitrary pitch-0 opaque.
 */
export function isFlatRoofDeckLineForTb(o: BuildingElementOpaque): boolean {
  if (o.isPlaceholder) return false;
  if (!isRoofLikeOpaqueElement(o)) return false;
  if (o.pitch !== 0) return false;
  if ((o as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof) return true;
  const n = (o.name ?? '').trim().toLowerCase();
  return n === 'roof' || n.includes('roof');
}

/** Deck elevation (m) for flat roof TB geometry — shared with party-wall × flat-roof P4 proposals. */
export function flatRoofDeckElevationMForTb(o: BuildingElementOpaque, floors: Floor[] | undefined): number {
  if (floors && floors.length > 0) {
    return elementBaseElevationMForTb(o, floors);
  }
  const c = o.coordinates;
  const bh = o.base_height;
  if (typeof bh === 'number' && Number.isFinite(bh) && bh >= 0) return bh;
  let maxZ = -Infinity;
  for (const p of c ?? []) {
    if (typeof p?.z === 'number' && Number.isFinite(p.z)) maxZ = Math.max(maxZ, p.z);
  }
  if (maxZ !== -Infinity) return maxZ;
  return 0;
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
  return out;
}
