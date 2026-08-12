// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Continuous **E6** along **intermediate-storey** external opaque wall segments in plan (slab line),
 * mirroring `proposeWallGroundContinuous` / opening `wall_intermediate_floor_foot` rules.
 *
 * Standard intermediate slabs require **`floors`** (same elevation rules as `geometry3dMapper`). Unheated
 * basement tops use the HEM `height_basement_walls` elevation instead; this represents the floor at the
 * bottom of the heated space over the unheated basement and is still Table 3.7 **E6**.
 *
 * As with **E5** and ground slabs, continuous **E6** requires a **proven link** to the relevant footprint:
 * a same-storey intermediate `BuildingElementGround` / horizontal `BuildingElementAdjacentConditionedSpace`,
 * or a linked unheated-basement ground element.
 */

import {
  elementBaseElevationMForTb,
  elementFloorZIndexForTb,
  slabElevationMForFloorZ,
} from '../../lib/geometry3dMapper';
import { findLinkedBasementGroundForLineElement } from '../../lib/basementGeometry';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import type { Floor } from '../../geometry/types';
import { roundToTwoDecimals } from '../constants';
import type { BuildingElementOpaque, Element } from '../types';
import { isExternalLineWall } from './proposeExternalCorners';
import {
  type FacadeOpeningTbProposal,
  psiTable37ForCode,
  SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M,
} from './proposeFacadeOpenings';
import {
  footIntervalOnWallForRole,
  gapIntervalsAlongWall,
  isGroundContactExternalWallForContinuousTb,
  wallHasPositiveFabricExtent,
  wallLinkedToIntermediateFloorSlabForContinuousE6,
} from './proposeWallGroundContinuous';

const MIN_SEGMENT_M = 0.05;

function opaqueWallBaseElevationMForBasementE6(w: BuildingElementOpaque, floors?: Floor[]): number {
  if (floors && floors.length > 0) return elementBaseElevationMForTb(w, floors);
  const raw = w.base_height;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const coords = w.coordinates;
  const z0 = typeof coords[0]?.z === 'number' && Number.isFinite(coords[0].z) ? coords[0].z : 0;
  const z1 = typeof coords[1]?.z === 'number' && Number.isFinite(coords[1].z) ? coords[1].z : 0;
  return Math.min(z0, z1);
}

export function unheatedBasementWallFloorElevationTargetMForContinuousE6(
  w: BuildingElementOpaque,
  elements: Element[],
): number | null {
  if (!isExternalLineWall(w)) return null;
  const linked = findLinkedBasementGroundForLineElement(w, elements);
  if (!linked || linked.ground.floor_type !== 'Unheated_basement') return null;
  return linked.targetBaseHeightM;
}

export function isUnheatedBasementWallForContinuousE6(
  w: BuildingElementOpaque,
  elements: Element[],
  floors?: Floor[],
): boolean {
  const targetM = unheatedBasementWallFloorElevationTargetMForContinuousE6(w, elements);
  if (targetM === null) return false;
  const baseEl = opaqueWallBaseElevationMForBasementE6(w, floors);
  return Math.abs(baseEl - targetM) <= SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M;
}

/**
 * Intermediate-slab perimeter wall: external line wall on storey index ≥ 1, wall base near that storey’s slab,
 * and not the ground continuous-E5 case.
 */
export function isIntermediateSlabExternalWallForContinuousTb(w: BuildingElementOpaque, floors?: Floor[]): boolean {
  if (!floors || floors.length === 0) return false;
  if (!isExternalLineWall(w)) return false;
  if (isGroundContactExternalWallForContinuousTb(w, floors)) return false;
  const floorZ = elementFloorZIndexForTb(w, floors);
  if (floorZ < 1) return false;
  const baseEl = elementBaseElevationMForTb(w, floors);
  const slabElev = slabElevationMForFloorZ(floorZ, floors);
  return Math.abs(baseEl - slabElev) <= SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M;
}

/**
 * E6 along external intermediate-slab wall runs, minus spans already taken by `wall_intermediate_floor_foot`.
 */
export function proposeWallIntermediateContinuous(
  elements: Element[],
  openingProposals: FacadeOpeningTbProposal[],
  floors?: Floor[],
): FacadeOpeningTbProposal[] {
  const effectiveFloors = floors && floors.length > 0 ? withEffectiveStoreyHeights(floors, elements) : undefined;
  const feet = openingProposals.filter((p) => p.edgeRole === 'wall_intermediate_floor_foot');
  const out: FacadeOpeningTbProposal[] = [];

  for (const el of elements) {
    if (el.type !== 'BuildingElementOpaque') continue;
    const w = el as BuildingElementOpaque;
    if (!wallHasPositiveFabricExtent(w)) continue;

    const basementTargetM = unheatedBasementWallFloorElevationTargetMForContinuousE6(w, elements);
    const useUnheatedBasementE6 =
      basementTargetM !== null && isUnheatedBasementWallForContinuousE6(w, elements, effectiveFloors);

    if (!useUnheatedBasementE6) {
      if (!effectiveFloors) continue;
      if (!isIntermediateSlabExternalWallForContinuousTb(w, effectiveFloors)) continue;
      if (!wallLinkedToIntermediateFloorSlabForContinuousE6(w, elements, effectiveFloors)) continue;
    }

    const c = w.coordinates;
    const Wa = { x: c[0].x, y: c[0].y };
    const Wb = { x: c[1].x, y: c[1].y };
    const wallLen = Math.hypot(Wb.x - Wa.x, Wb.y - Wa.y);
    if (wallLen < MIN_SEGMENT_M) continue;

    const covered: [number, number][] = [];
    for (const foot of feet) {
      const iv = footIntervalOnWallForRole(w, foot, 'wall_intermediate_floor_foot');
      if (iv) covered.push(iv);
    }

    const gaps = gapIntervalsAlongWall(wallLen, covered);
    const zTargetM = useUnheatedBasementE6
      ? basementTargetM
      : effectiveFloors
        ? slabElevationMForFloorZ(elementFloorZIndexForTb(w, effectiveFloors), effectiveFloors)
        : null;
    if (zTargetM === null) continue;
    const z = roundToTwoDecimals(zTargetM);
    const ux = (Wb.x - Wa.x) / wallLen;
    const uy = (Wb.y - Wa.y) / wallLen;

    gaps.forEach(([t0, t1], segIdx) => {
      const len = t1 - t0;
      if (len < MIN_SEGMENT_M) return;
      const ax = Wa.x + ux * t0;
      const ay = Wa.y + uy * t0;
      const bx = Wa.x + ux * t1;
      const by = Wa.y + uy * t1;
      const code = 'E6';
      out.push({
        proposalId: useUnheatedBasementE6 ? `wicont:${w.id}:basement:${segIdx}` : `wicont:${w.id}:${segIdx}`,
        openingId: useUnheatedBasementE6 ? `wicont:${w.id}:basement:${segIdx}` : `wicont:${w.id}:${segIdx}`,
        openingName: `Wall–intermediate floor (continuous): ${w.name || w.id}`,
        zoneId: w.zoneId,
        edgeRole: 'wall_intermediate_continuous',
        junctionCode: code,
        suggestedLengthM: roundToTwoDecimals(len),
        linearThermalTransmittance: psiTable37ForCode(code),
        reason: useUnheatedBasementE6
          ? `Unheated basement wall–floor junction along "${w.name || w.id}" (E6) at the floor over the basement, excluding opening foot spans on the same wall line`
          : `Intermediate wall–floor junction along "${w.name || w.id}" (E6), excluding opening foot spans on the same wall line; wall must have positive height or area and link to a same-storey intermediate floor slab`,
        coordinates: [
          { x: roundToTwoDecimals(ax), y: roundToTwoDecimals(ay), z },
          { x: roundToTwoDecimals(bx), y: roundToTwoDecimals(by), z },
        ],
        parentElementForTb: w.name || undefined,
      });
    });
  }

  return out;
}
