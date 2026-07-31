// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **E22** (basement floor): one linear TB per **edge** of a `BuildingElementGround` polygon where
 * `floor_type` is `Heated_basement` or `Unheated_basement`. Edges sit at the basement-floor upper surface
 * (`-depth_basement_floor`) when the HEM basement depth is available.
 */
import { elementBaseElevationMForTb } from '../../lib/geometry3dMapper';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { basementFloorSurfaceElevationM, isBasementGroundElement } from '../../lib/basementGeometry';
import type { Floor } from '../../stores/geometryStore';
import type { BuildingElementGround, Element } from '../types';
import { roundToTwoDecimals } from '../constants';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { psiTable37ForCode } from './proposeFacadeOpenings';

const MIN_EDGE = 0.05;

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function basementE22ElevationM(g: BuildingElementGround, floors?: Floor[]): number {
  const fromDepth = basementFloorSurfaceElevationM(g);
  if (fromDepth !== null) return fromDepth;
  if (floors && floors.length > 0) return elementBaseElevationMForTb(g, floors);
  return Math.min(
    ...g.coordinates.map((p) => (typeof p.z === 'number' && Number.isFinite(p.z) ? p.z : 0)),
  );
}

function basementTbFloorStoreyIndex(g: BuildingElementGround, zB: number): number | undefined {
  if (zB < -1e-6) {
    const firstZ = g.coordinates?.[0]?.z;
    if (
      typeof firstZ === 'number' &&
      Number.isFinite(firstZ) &&
      firstZ < 0 &&
      Math.abs(firstZ - Math.round(firstZ)) < 1e-6
    ) {
      return Math.floor(firstZ);
    }
    return -1;
  }
  return undefined;
}

export function proposeBasementGroundE22ThermalBridges(
  elements: Element[],
  floors?: Floor[] | undefined,
): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const out: FacadeOpeningTbProposal[] = [];

  for (const el of elements) {
    if (el.type !== 'BuildingElementGround' || el.isPlaceholder) continue;
    const g = el as BuildingElementGround;
    if (!isBasementGroundElement(g)) continue;
    const c = g.coordinates;
    if (!c || c.length < 3) continue;
    const zB = roundToTwoDecimals(basementE22ElevationM(g, floors));
    const floorStoreyIndexForTb = basementTbFloorStoreyIndex(g, zB);
    const n = c.length;
    for (let i = 0; i < n; i++) {
      const a = c[i]!;
      const b = c[(i + 1) % n]!;
      const L = dist2XY(a, b);
      if (L < MIN_EDGE) continue;
      const junctionCode = 'E22';
      out.push({
        proposalId: `e22:${g.id}:e${i}`,
        openingId: g.id,
        openingName: g.name,
        zoneId: g.zoneId,
        edgeRole: 'basement_floor_edge',
        junctionCode,
        suggestedLengthM: roundToTwoDecimals(L),
        linearThermalTransmittance: psiTable37ForCode(junctionCode),
        reason: `E22 (basement floor) along edge ${i} of ground "${g.name}" (${g.floor_type})`,
        coordinates: [
          { x: a.x, y: a.y, z: zB },
          { x: b.x, y: b.y, z: zB },
        ],
        parentElementForTb: g.name,
        floorStoreyIndexForTb,
      });
    }
  }
  return out;
}
