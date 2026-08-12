// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Linear TB suggestions where an **external** opaque wall meets a **non-ground** host along a shared plan run
 * at **slab elevation** (plan overlap).
 *
 * **External wall × `BuildingElementGround`** is **E5** — see {@link proposeWallGroundContinuous}, not **P1**.
 *
 * **Unheated horizontal exposed floor × external wall** is **E20** / **E21** (Table 3.7 **E**-series — junction with an
 * **external** wall), not **P7** / **P8** (those are the same physical junction types but at a **party wall**).
 *
 * - **P2** / **P3** — **`BuildingElementPartyWall` × intermediate conditioned floor** — see
 *   {@link proposePartyWallIntermediateFloorP2P3ThermalBridges} (never external wall).
 *
 * Vertical adjacent envelope lines (**pitch** 90°) are **not** used here for auto suggestions (see **R8/R9**, hints).
 *
 * **`zonesCompatible`:** skip if both have `zoneId` and they differ.
 */

import { roundToTwoDecimals } from '../constants';
import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementAdjacentUnconditionedSpace_Simple,
  BuildingElementOpaque,
  Element,
} from '../types';
import type { Floor } from '../../geometry/types';
import { elementBaseElevationMForTb, elementFloorZIndexForTb } from '../../lib/geometry3dMapper';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { isExternalLineWall } from './proposeExternalCorners';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from './proposeFacadeOpenings';
import { ADJACENT_WALL_COINCIDENT_PERP_TOL_M } from './thermalBridgeTolerances';

/** Re-export for party-wall passes. */
export { ADJACENT_WALL_COINCIDENT_PERP_TOL_M };

const MIN_PLAN_OVERLAP_M = 0.05;
const MIN_VERTICAL_OVERLAP_M = 0.05;
const MIN_WALL_LEN_XY_M = 0.05;
/** Slab Z must lie within the wall’s vertical fabric span (same band as {@link proposeE7PartyFloorToExternalWall}). */
const Z_BAND_EPS_M = 0.04;

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function zonesCompatible(a: string | undefined, b: string | undefined): boolean {
  if (a !== undefined && b !== undefined && a !== b) return false;
  return true;
}

function projectOnWallLine(
  Wa: { x: number; y: number },
  Wb: { x: number; y: number },
  p: { x: number; y: number },
): { t: number; perp: number; wallLen: number } {
  const vx = Wb.x - Wa.x;
  const vy = Wb.y - Wa.y;
  const wallLen = Math.hypot(vx, vy);
  if (wallLen < 1e-9) {
    return { t: 0, perp: Math.hypot(p.x - Wa.x, p.y - Wa.y), wallLen: 0 };
  }
  const ux = vx / wallLen;
  const uy = vy / wallLen;
  const t = (p.x - Wa.x) * ux + (p.y - Wa.y) * uy;
  const perp = Math.abs(-uy * (p.x - Wa.x) + ux * (p.y - Wa.y));
  return { t, perp, wallLen };
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

/**
 * Overlap of adjacent segment AB onto infinite wall line Wa→Wb, clamped to wall segment [0, wallLen].
 * Returns null if not parallel/coincident enough or overlap too short.
 */
export function planOverlapAdjacentOnWall(
  Wa: { x: number; y: number },
  Wb: { x: number; y: number },
  Aa: { x: number; y: number },
  Ab: { x: number; y: number },
  perpTol: number = ADJACENT_WALL_COINCIDENT_PERP_TOL_M,
): { tMid: number; wallLen: number; overlapLen: number; tLo: number; tHi: number } | null {
  const pWa = projectOnWallLine(Wa, Wb, Wa);
  const wallLen = pWa.wallLen;
  if (wallLen < MIN_WALL_LEN_XY_M) return null;

  const pa = projectOnWallLine(Wa, Wb, Aa);
  const pb = projectOnWallLine(Wa, Wb, Ab);
  if (pa.perp > perpTol || pb.perp > perpTol) return null;

  const tA0 = pa.t;
  const tA1 = pb.t;
  const tLo = Math.max(0, Math.min(tA0, tA1));
  const tHi = Math.min(wallLen, Math.max(tA0, tA1));
  if (tHi - tLo < MIN_PLAN_OVERLAP_M) return null;

  return {
    tMid: (tLo + tHi) / 2,
    wallLen,
    overlapLen: tHi - tLo,
    tLo,
    tHi,
  };
}

function opaqueWallBaseElevationLegacy(w: BuildingElementOpaque): number {
  const coords = w.coordinates;
  const z0 = typeof coords[0]?.z === 'number' && Number.isFinite(coords[0].z) ? coords[0].z : 0;
  const z1 = typeof coords[1]?.z === 'number' && Number.isFinite(coords[1].z) ? coords[1].z : 0;
  const bh = w.base_height;
  if (typeof bh === 'number' && Number.isFinite(bh) && bh >= 0) return bh;
  return Math.min(z0, z1);
}

function adjacentBaseElevationLegacy(
  a: BuildingElementAdjacentConditionedSpace | BuildingElementAdjacentUnconditionedSpace_Simple,
): number {
  const coords = a.coordinates;
  const z0 = typeof coords[0]?.z === 'number' && Number.isFinite(coords[0].z) ? coords[0].z : 0;
  const z1 = typeof coords[1]?.z === 'number' && Number.isFinite(coords[1].z) ? coords[1].z : 0;
  return Math.min(z0, z1);
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
  const zLo = opaqueWallBaseElevationLegacy(wall);
  return { zLo, zHi: zLo + h };
}

function adjacentVerticalExtentM(
  adj: BuildingElementAdjacentConditionedSpace | BuildingElementAdjacentUnconditionedSpace_Simple,
  floors: Floor[] | undefined,
): { zLo: number; zHi: number } {
  const h = typeof adj.height === 'number' && adj.height > 0 ? adj.height : 0;
  if (floors && floors.length > 0) {
    const zLo = elementBaseElevationMForTb(adj, floors);
    return { zLo, zHi: zLo + h };
  }
  const zLo = adjacentBaseElevationLegacy(adj);
  return { zLo, zHi: zLo + h };
}

/** Vertical span for a 2-point opaque envelope line — shared with {@link proposeRoomInRoofRoofToWallR8R9ThermalBridges}. */
export function opaqueEnvelopeVerticalExtentM(
  wall: BuildingElementOpaque,
  floors: Floor[] | undefined,
): { zLo: number; zHi: number } {
  return wallVerticalExtentM(wall, floors);
}

/** Vertical span for a vertical adjacent segment — shared with roof × adjacent R8/R9 pairing. */
export function adjacentEnvelopeVerticalExtentM(
  adj: BuildingElementAdjacentConditionedSpace | BuildingElementAdjacentUnconditionedSpace_Simple,
  floors: Floor[] | undefined,
): { zLo: number; zHi: number } {
  return adjacentVerticalExtentM(adj, floors);
}

function horizontalConditionedFloorPitchOk(el: BuildingElementAdjacentConditionedSpace): boolean {
  const p = el.pitch;
  return typeof p === 'number' && Number.isFinite(p) && (p === 0 || p === 180);
}

function horizontalUnconditionedFloorPitchOk(el: BuildingElementAdjacentUnconditionedSpace_Simple): boolean {
  const p = el.pitch;
  return typeof p === 'number' && Number.isFinite(p) && p === 0;
}

function closedHorizontalFloorPlanRingEdgesXY(
  c: Array<{ x: number; y: number }>,
): Array<[[number, number], [number, number]]> {
  if (!c || c.length < 2) return [];
  const out: Array<[[number, number], [number, number]]> = [];
  if (c.length === 2) {
    if (dist2XY(c[0]!, c[1]!) < MIN_WALL_LEN_XY_M) return [];
    return [[[c[0]!.x, c[0]!.y], [c[1]!.x, c[1]!.y]]];
  }
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i]!;
    const b = c[i + 1]!;
    out.push([[a.x, a.y], [b.x, b.y]]);
  }
  const p0 = c[0]!;
  const pL = c[c.length - 1]!;
  if (c.length >= 3 && Math.hypot(p0.x - pL.x, p0.y - pL.y) > 1e-4) {
    out.push([[pL.x, pL.y], [p0.x, p0.y]]);
  }
  return out.filter(([[ax, ay], [bx, by]]) => Math.hypot(bx - ax, by - ay) >= MIN_WALL_LEN_XY_M);
}

/**
 * Closed XY edges for a horizontal (`pitch` 0° or 180°) conditioned floor — **line or polygon** slab footprint.
 * Used for party-wall **P2/P3** pairing along each coincident boundary segment.
 */
export function horizontalConditionedFloorSlabPlanEdgesForPartyWallTb(
  el: BuildingElementAdjacentConditionedSpace,
): Array<[[number, number], [number, number]]> {
  if (el.isPlaceholder) return [];
  const c = el.coordinates;
  if (!c || c.length < 2) return [];
  if (!horizontalConditionedFloorPitchOk(el)) return [];
  const z0 = typeof c[0]?.z === 'number' && Number.isFinite(c[0].z) ? c[0].z : 0;
  for (let i = 1; i < c.length; i++) {
    const zi = typeof c[i]?.z === 'number' && Number.isFinite(c[i].z) ? c[i].z : 0;
    if (Math.abs(zi - z0) > 1e-2) return [];
  }
  return closedHorizontalFloorPlanRingEdgesXY(c);
}

/** Horizontal pitch-0 or pitch-180 floor line (two plan points, same Z) — conditioned host for P2/P3. */
export function isHorizontalConditionedFloorAdjacentLine(el: Element): el is BuildingElementAdjacentConditionedSpace {
  if (el.type !== 'BuildingElementAdjacentConditionedSpace' || el.isPlaceholder) return false;
  const c = el.coordinates;
  if (!c || c.length !== 2) return false;
  if (!horizontalConditionedFloorPitchOk(el as BuildingElementAdjacentConditionedSpace)) return false;
  if (dist2XY(c[0]!, c[1]!) < MIN_WALL_LEN_XY_M) return false;
  const z0 = typeof c[0]!.z === 'number' && Number.isFinite(c[0]!.z) ? c[0]!.z : 0;
  const z1 = typeof c[1]!.z === 'number' && Number.isFinite(c[1]!.z) ? c[1]!.z : 0;
  return Math.abs(z0 - z1) <= 1e-2;
}

/** Horizontal pitch-0 exposed floor line — paired with external wall for **E20** / **E21**. */
export function isHorizontalUnconditionedFloorAdjacentLine(
  el: Element,
): el is BuildingElementAdjacentUnconditionedSpace_Simple {
  if (el.type !== 'BuildingElementAdjacentUnconditionedSpace_Simple' || el.isPlaceholder) return false;
  const c = el.coordinates;
  if (!c || c.length !== 2) return false;
  if (!horizontalUnconditionedFloorPitchOk(el as BuildingElementAdjacentUnconditionedSpace_Simple)) return false;
  if (dist2XY(c[0]!, c[1]!) < MIN_WALL_LEN_XY_M) return false;
  const z0 = typeof c[0]!.z === 'number' && Number.isFinite(c[0]!.z) ? c[0]!.z : 0;
  const z1 = typeof c[1]!.z === 'number' && Number.isFinite(c[1]!.z) ? c[1]!.z : 0;
  return Math.abs(z0 - z1) <= 1e-2;
}

/** Host predicate: horizontal conditioned or unconditioned floor line for Table 3.7 P-series floor junctions. */
export function isHorizontalAdjacentFloorLineForPartyTb(
  el: Element,
): el is BuildingElementAdjacentConditionedSpace | BuildingElementAdjacentUnconditionedSpace_Simple {
  return isHorizontalConditionedFloorAdjacentLine(el) || isHorizontalUnconditionedFloorAdjacentLine(el);
}

/**
 * True when this is a **vertical** `BuildingElementAdjacent*` envelope strip (legacy R8/R9, validation).
 */
export function isAdjacentVerticalEnvelopeLine(
  el: Element,
): el is BuildingElementAdjacentConditionedSpace | BuildingElementAdjacentUnconditionedSpace_Simple {
  if (
    el.type !== 'BuildingElementAdjacentConditionedSpace' &&
    el.type !== 'BuildingElementAdjacentUnconditionedSpace_Simple'
  ) {
    return false;
  }
  if (el.isPlaceholder) return false;
  const coords = el.coordinates;
  if (!coords || coords.length !== 2) return false;
  const pitch = el.pitch;
  if (typeof pitch === 'number' && Number.isFinite(pitch) && pitch !== 90) return false;
  const w = dist2XY(coords[0], coords[1]);
  const h = typeof el.height === 'number' && el.height > 0 ? el.height : 0;
  if (w < MIN_WALL_LEN_XY_M || h <= 0) return false;
  return true;
}

/**
 * **E20** / **E21** auto suggestions: external wall × horizontal `BuildingElementAdjacentUnconditionedSpace_Simple`
 * exposed-floor line (inverted **E21** via dropdown).
 * **Ground** external wall × `BuildingElementGround` is **not** emitted here — use **E5** from
 * {@link proposeWallGroundContinuous}.
 * Requires **`floors`** for storey / slab heights (returns **[]** if omitted).
 */
export function proposeAdjacentWallJunctionThermalBridges(
  elements: Element[],
  floors?: Floor[],
): FacadeOpeningTbProposal[] {
  if (!floors || floors.length === 0) return [];
  // Bake wall-derived storey heights + user overrides so downstream slab/base elevations match
  // what the floor picker and 3D viewer display.
  floors = withEffectiveStoreyHeights(floors, elements);

  const walls = elements.filter((e): e is BuildingElementOpaque => isExternalLineWall(e));
  const unconditionedFloors = elements.filter(isHorizontalUnconditionedFloorAdjacentLine);
  const out: FacadeOpeningTbProposal[] = [];

  // —— E20 (default) / E21: exposed unconditioned horizontal floor × external wall (Table 3.7 E-series).
  for (const wall of walls) {
    const fz = elementFloorZIndexForTb(wall, floors);
    if (fz < 0) continue;

    const W = wall.coordinates;
    const Wa = W[0]!;
    const Wb = W[1]!;
    const wExt = wallVerticalExtentM(wall, floors);

    for (const adj of unconditionedFloors) {
      if (!zonesCompatible(wall.zoneId, adj.zoneId)) continue;
      if (elementFloorZIndexForTb(adj, floors) !== fz) continue;

      const A = adj.coordinates;
      const overlap = planOverlapAdjacentOnWall(Wa, Wb, A[0]!, A[1]!);
      if (!overlap) continue;

      const slabZ = elementBaseElevationMForTb(adj, floors);
      if (slabZ < wExt.zLo - Z_BAND_EPS_M || slabZ > wExt.zHi + Z_BAND_EPS_M) continue;

      const aExt = adjacentVerticalExtentM(adj, floors);
      const zLo = Math.max(wExt.zLo, aExt.zLo);
      const zHi = Math.min(wExt.zHi, aExt.zHi);
      if (zHi - zLo < MIN_VERTICAL_OVERLAP_M) continue;

      const a = pointOnWallAtT(Wa, Wb, overlap.tLo, overlap.wallLen);
      const b = pointOnWallAtT(Wa, Wb, overlap.tHi, overlap.wallLen);
      const L = dist2XY(a, b);
      if (L < MIN_PLAN_OVERLAP_M) continue;

      const z = roundToTwoDecimals(slabZ);
      const junctionCode = 'E20';
      out.push({
        proposalId: `e20:${wall.id}:${adj.id}:${roundToTwoDecimals(overlap.tLo)}`,
        openingId: adj.id,
        openingName: `${adj.name} ↔ ${wall.name}`,
        zoneId: wall.zoneId ?? adj.zoneId,
        edgeRole: 'unheated_adjacent_wall_junction',
        junctionCode,
        suggestedLengthM: roundToTwoDecimals(L),
        linearThermalTransmittance: psiTable37ForCode(junctionCode),
        reason: `E20 exposed floor (normal) with external wall: unheated horizontal run "${adj.name}" × "${wall.name}" (plan ${roundToTwoDecimals(
          overlap.overlapLen,
        )} m at ${z} m); use E21 if inverted`,
        coordinates: [
          { x: roundToTwoDecimals(a.x), y: roundToTwoDecimals(a.y), z },
          { x: roundToTwoDecimals(b.x), y: roundToTwoDecimals(b.y), z },
	        ],
	        parentElementForTb: wall.name,
	        hostElementIds: [wall.id, adj.id],
	      });
    }
  }

  return out;
}
