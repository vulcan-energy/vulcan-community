// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Preview-only proposals for façade opening thermal bridges (E1–E4, plus E5/E6 wall–floor, E19 option).
 * Wall openings only: vertical façade (pitch 90 or unset), 2-point line geometry.
 *
 * **Jambs (`jamb_first` / `jamb_second`)** — One vertical E4 line at each **end of the opening segment**
 * (`coordinates[0]` and `coordinates[1]`). This is **not** “left/right when facing the façade”; reversing
 * the segment swaps which endpoint is “first”. For SAP both jambs use the same default ψ (E4).
 *
 * **Messy geometry** — If the two endpoints have different Z, we still assume a **rectangular** opening:
 * sill level = `min(z0, z1)`, top = sill + `height`. Very skewed or non-vertical openings are not modeled;
 * fix the window line in the canvas rather than inferring complex shapes here.
 *
 * **Elevation** — `base_height` is **absolute** sill height in metres above model ground (same as
 * `geometry3dMapper` / `getElementBaseElevation`). When **`floors`** is passed from the store, wall–floor
 * rows (E5/E6) compare the sill to the **slab elevation** of that storey, or to the linked non-basement
 * ground surface for ground E5.
 * Without `floors`, only **ground** wall–floor (E5) is inferred from coarse Z (no intermediate foot).
 */

import { roundToTwoDecimals } from '../constants';
import {
  elementBaseElevationMForTb,
  elementFloorZIndexForTb,
  slabElevationMForFloorZ,
} from '../../lib/geometry3dMapper';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import type { Floor } from '../../geometry/types';
import type { BuildingElementOpaque, BuildingElementTransparent, Element, ThermalBridgeLinear } from '../types';
import { JUNCTION_TYPE_TO_PSI } from '../../lib/simplifiedFabricMap';
import { dist3, midpoint3 } from './tbLinkage';
import { findNonBasementGroundSurfaceForLineElement } from '../../lib/suspendedFloorGeometry';
import { findLinkedBasementGroundForLineElement } from '../../lib/basementGeometry';

import { DEFAULT_TB_DEDUPE_TOLERANCE_M } from './thermalBridgeTolerances';
/** Re-export for callers importing from facade openings. */
export { DEFAULT_TB_DEDUPE_TOLERANCE_M };

/**
 * Below this sill elevation (m above model zero), we omit **E3** (no separate sill detail) and instead
 * propose **E5** (wall–floor) along the opening foot — see `wall_ground_foot` role.
 */
export const SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M = 0.08;

const Z_MATCH_EPS = 1e-4;

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * Sill elevation (m above ground) for TB geometry: matches 3D window placement — prefer `base_height`
 * when present; otherwise `min` of endpoint Z (metres in free-drawn canvas).
 */
/** Shared by transparent openings and opaque external doors (CSV / canvas). */
export type FacadeOpeningLineLike = Pick<BuildingElementTransparent, 'coordinates' | 'base_height'>;

export function openingSillElevationMForFacadeTb(t: FacadeOpeningLineLike): {
  zBottomM: number;
  zCoord0: number;
  zCoord1: number;
  usedBaseHeight: boolean;
} {
  const coords = t.coordinates;
  const p0 = coords[0];
  const p1 = coords[1];
  const z0 = typeof p0.z === 'number' && Number.isFinite(p0.z) ? p0.z : 0;
  const z1 = typeof p1.z === 'number' && Number.isFinite(p1.z) ? p1.z : 0;
  const bh = t.base_height;
  if (isFiniteNonNegative(bh)) {
    return { zBottomM: bh, zCoord0: z0, zCoord1: z1, usedBaseHeight: true };
  }
  return { zBottomM: Math.min(z0, z1), zCoord0: z0, zCoord1: z1, usedBaseHeight: false };
}

/** Shared by façade and roof-window jamb proposals. */
export function jambReason(
  openingName: string,
  end: 'first' | 'second',
  usedBaseHeight: boolean,
  z0: number,
  z1: number,
): string {
  const which = end === 'first' ? 'first' : 'second';
  if (usedBaseHeight) {
    return `Jamb at ${which} line point of "${openingName}" (sill elevation from base_height)`;
  }
  if (Math.abs(z0 - z1) > Z_MATCH_EPS) {
    return `Jamb at ${which} line point of "${openingName}" (endpoints had different Z; sill = min Z)`;
  }
  return `Jamb at ${which} line point of "${openingName}" (matches opening height)`;
}

export type FacadeOpeningEdgeRole =
  | 'lintel'
  | 'sill'
  /** Wall–floor junction under opening when sill (E3) is skipped — default E5, optional E19 in UI. */
  | 'wall_ground_foot'
  /** Wall–intermediate-floor junction under opening (E6) — sill near that storey’s slab elevation. */
  | 'wall_intermediate_floor_foot'
  | 'jamb_first'
  | 'jamb_second'
  /** Roof window / rooflight (SAP R1–R3): head, sill, jambs — sloped (`pitch` ≠ 90) or flat (`pitch` 0°). */
  | 'roof_window_head'
  | 'roof_window_sill'
  | 'roof_window_jamb_first'
  | 'roof_window_jamb_second'
  /** Roof window / flat rooflight kerb or upstand (R11) — plan line at sill, separate from R2 in assessment if needed. */
  | 'rooflight_kerb'
  /** Closed external-wall loop in plan: convex (E16) vs reflex / re-entrant (E17), CCW positive area. */
  | 'external_corner_convex'
  | 'external_corner_reentrant'
  /** E5 along an external wall run at ground (not under an opening foot already covered by `wall_ground_foot`). */
  | 'wall_ground_continuous'
  /** E6 along an external wall run at an intermediate floor slab (minus `wall_intermediate_floor_foot` spans). */
  | 'wall_intermediate_continuous'
  /**
   * **P2/P3** (auto): `BuildingElementPartyWall` × horizontal pitch-0 conditioned floor adjacent
   * (`proposePartyWallIntermediateFloorP2P3ThermalBridges`). **P1** / **P6** are party-wall floor junctions only;
   * external wall × ground slab uses **`wall_ground_continuous`** (**E5** / **E19**), not this role.
   */
  | 'party_wall_junction'
  /**
   * External wall × horizontal pitch-0 **`BuildingElementAdjacentUnconditionedSpace_Simple`** exposed floor —
   * Table 3.7 **E20** / **E21** (junction with an **external** wall). **P7** / **P8** are the party-wall analogues.
   */
  | 'unheated_adjacent_wall_junction'
  /** Flat horizontal roof deck edge (`pitch` 0°) — E14 default; E15 (parapet) via dropdown, same line. */
  | 'flat_roof_edge'
  /** Party `BuildingElementPartyWall` line meets external wall — E18. */
  | 'party_to_external_e18'
  /** Sloped roof: low eaves line (E10 / E11). */
  | 'sloped_roof_eaves'
  /** Sloped roof: gable end in plan, perpendicular to first edge (E12 / E13). */
  | 'sloped_roof_gable'
  /** Sloped roof: edge nearly parallel to eaves in plan (R4 / R5 ridge). */
  | 'sloped_roof_ridge'
  /** External wall meets horizontal party-**floor** run (E7), pitch 0 with party flag. */
  | 'e7_party_floor_external'
  /** `BuildingElementGround` basement type edge in plan (E22). */
  | 'basement_floor_edge'
  /** Party `BuildingElementPartyWall` colinear with a sloped roof plan edge (P4 / P5). */
  | 'party_wall_to_sloped_roof'
  /** Party wall colinear with a flat (`pitch` 0°) external roof deck edge — **P4** only. */
  | 'party_wall_to_flat_roof'
  /**
   * Sloped roof opaque plan edge × vertical adjacent segment — Table 3.7 **R8** / **R9** (topology inference).
   */
  | 'sloped_roof_to_adjacent_wall_r8_r9'
  /** Dormer roof plane × host roof plane fallback — Table 3.7 **R10**. */
  | 'dormer_roof_to_host_roof_r10';

export interface FacadeOpeningTbProposal {
  proposalId: string;
  openingId: string;
  openingName: string;
  zoneId: string | undefined;
  edgeRole: FacadeOpeningEdgeRole;
  /** User-editable in preview; starts as default for the edge. */
  junctionCode: string;
  suggestedLengthM: number;
  linearThermalTransmittance: number;
  reason: string;
  coordinates: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }];
  /**
   * When set (e.g. wall–floor E5), prefer this for `ThermalBridgeLinear.parent_element` (host wall).
   * Otherwise the preview uses the opening name.
   */
  parentElementForTb?: string | null;
  /** E16/E17: both `BuildingElementOpaque` ids meeting at the plan corner (persisted to `thermal_bridge_source`). */
  cornerHostWallIds?: readonly [string, string];
  /** Generic host pair used when a proposal spans two known fabric elements. */
  hostElementIds?: readonly [string, string];
  /** R8/R9: `[roofElementId, adjacentElementId]` for `thermal_bridge_source` host pairing. */
  roofAdjacentPairIds?: readonly [string, string];
  /** Optional canvas storey membership override; coordinates keep physical metre elevations. */
  floorStoreyIndexForTb?: number;
}

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Default junction code per edge (Table 3.7 codes: E1/E2 lintel, E3 sill, E4 jamb, E5/E6 wall–floor, E16/E17 corners, R1–R3 roof windows, P adjacent). */
export function defaultJunctionCodeForEdge(
  role: FacadeOpeningEdgeRole,
):
  | 'E1'
  | 'E3'
  | 'E4'
  | 'E5'
  | 'E6'
  | 'E10'
  | 'E11'
  | 'E12'
  | 'E13'
  | 'E16'
  | 'E17'
  | 'E7'
  | 'E18'
  | 'E14'
  | 'E22'
  | 'R1'
  | 'R2'
  | 'R3'
  | 'R4'
  | 'R5'
  | 'R11'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'P5'
  | 'E20'
  | 'E21'
  | 'E24'
  | 'R6'
  | 'R7'
  | 'R8'
  | 'R9'
  | 'R10'
  | 'P6'
  | 'P7'
  | 'P8' {
  if (role === 'party_wall_junction') return 'P2';
  if (role === 'unheated_adjacent_wall_junction') return 'E20';
  if (role === 'party_wall_to_sloped_roof') return 'P4';
  if (role === 'party_wall_to_flat_roof') return 'P4';
  if (role === 'roof_window_head') return 'R1';
  if (role === 'roof_window_sill') return 'R2';
  if (role === 'roof_window_jamb_first' || role === 'roof_window_jamb_second') return 'R3';
  if (role === 'rooflight_kerb') return 'R11';
  if (role === 'sloped_roof_ridge') return 'R4';
  if (role === 'lintel') return 'E1';
  if (role === 'sill') return 'E3';
  if (role === 'wall_ground_foot' || role === 'wall_ground_continuous') return 'E5';
  if (role === 'wall_intermediate_floor_foot' || role === 'wall_intermediate_continuous') return 'E6';
  if (role === 'external_corner_convex') return 'E16';
  if (role === 'external_corner_reentrant') return 'E17';
  if (role === 'flat_roof_edge') return 'E14';
  if (role === 'party_to_external_e18') return 'E18';
  if (role === 'sloped_roof_eaves') return 'E10';
  if (role === 'sloped_roof_gable') return 'E12';
  if (role === 'e7_party_floor_external') return 'E7';
  if (role === 'basement_floor_edge') return 'E22';
  if (role === 'sloped_roof_to_adjacent_wall_r8_r9') return 'R8';
  if (role === 'dormer_roof_to_host_roof_r10') return 'R10';
  return 'E4';
}

/** Default ψ (W/m·K) from built-in Table 3.7 for a junction type code. */
export function psiTable37ForCode(code: string): number {
  const v = JUNCTION_TYPE_TO_PSI[code];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Junction codes allowed in the preview dropdown for this edge role. */
export function junctionOptionsForFacadeEdgeRole(role: FacadeOpeningEdgeRole): readonly string[] {
  /** P6 = inverted ground floor (same ψ as P1); chosen on the same auto rows as P1. */
  if (role === 'party_wall_junction') return ['P1', 'P2', 'P3', 'P6', 'P7', 'P8'];
  if (role === 'unheated_adjacent_wall_junction') return ['E20', 'E21'];
  if (role === 'roof_window_head') return ['R1'];
  if (role === 'roof_window_sill') return ['R2'];
  if (role === 'roof_window_jamb_first' || role === 'roof_window_jamb_second') return ['R3'];
  if (role === 'wall_ground_foot' || role === 'wall_ground_continuous') return ['E5', 'E19'];
  if (role === 'wall_intermediate_floor_foot' || role === 'wall_intermediate_continuous') return ['E6'];
  if (role === 'external_corner_convex' || role === 'external_corner_reentrant') return ['E16', 'E17'];
  if (role === 'flat_roof_edge') return ['E14', 'E15'];
  if (role === 'party_to_external_e18') return ['E18'];
  if (role === 'sloped_roof_eaves') return ['E10', 'E11'];
  if (role === 'sloped_roof_gable') return ['E12', 'E13'];
  if (role === 'sloped_roof_ridge') return ['R4', 'R5'];
  if (role === 'e7_party_floor_external') return ['E7'];
  if (role === 'basement_floor_edge') return ['E22'];
  if (role === 'party_wall_to_sloped_roof') return ['P4', 'P5'];
  if (role === 'party_wall_to_flat_roof') return ['P4'];
  if (role === 'rooflight_kerb') return ['R11'];
  if (role === 'sloped_roof_to_adjacent_wall_r8_r9') return ['R8', 'R9'];
  if (role === 'dormer_roof_to_host_roof_r10') return ['R10'];
  return ['E1', 'E2', 'E3', 'E4'];
}

export function coerceJunctionCodeForEdgeRole(
  role: FacadeOpeningEdgeRole,
  proposalDefault: string,
  override: string | undefined,
): string {
  const opts = junctionOptionsForFacadeEdgeRole(role);
  if (override !== undefined && opts.includes(override)) return override;
  if (opts.includes(proposalDefault)) return proposalDefault;
  return opts[0] ?? proposalDefault;
}

/**
 * True if this transparent element is treated as a vertical wall opening (not roof / sloped polygon).
 */
export function isWallFacadeOpening(el: BuildingElementTransparent): boolean {
  if (el.isPlaceholder) return false;
  const coords = el.coordinates;
  if (!coords || coords.length !== 2) return false;

  const pitch = el.pitch;
  if (typeof pitch === 'number' && Number.isFinite(pitch) && pitch !== 90) {
    return false;
  }

  const w = typeof el.width === 'number' && el.width > 0 ? el.width : dist2XY(coords[0], coords[1]);
  const h = typeof el.height === 'number' && el.height > 0 ? el.height : 0;
  if (w <= 0 || h <= 0) return false;

  return true;
}

/**
 * External doors are often modeled as {@link BuildingElementOpaque} with `is_external_door` (not transparent).
 * Same façade TB rules as windows when pitch is vertical (90° or unset) and width/height are set.
 */
export function isExternalDoorFacadeOpening(el: BuildingElementOpaque): boolean {
  if (el.isPlaceholder) return false;
  if (el.is_external_door !== true) return false;
  const coords = el.coordinates;
  if (!coords || coords.length !== 2) return false;

  const pitch = el.pitch;
  if (typeof pitch === 'number' && Number.isFinite(pitch) && pitch !== 90) {
    return false;
  }

  const w = typeof el.width === 'number' && el.width > 0 ? el.width : dist2XY(coords[0], coords[1]);
  const h = typeof el.height === 'number' && el.height > 0 ? el.height : 0;
  if (w <= 0 || h <= 0) return false;

  return true;
}

/** Window/door line openings sharing façade TB geometry fields. */
export type VerticalFacadeOpeningHost = {
  id: string;
  name: string;
  zoneId?: string;
  parent_element: string | null;
  coordinates: BuildingElementTransparent['coordinates'];
  width: number;
  height: number;
  base_height?: number;
};

function linkedGroundSurfaceMForFacadeOpening(
  opening: VerticalFacadeOpeningHost,
  elements: Element[],
): number | null {
  const hostWallName =
    typeof opening.parent_element === 'string' && opening.parent_element.trim() !== ''
      ? opening.parent_element.trim()
      : null;
  if (hostWallName) {
    const hostWall = elements.find(
      (el): el is BuildingElementOpaque =>
        el.type === 'BuildingElementOpaque' &&
        el.zoneId === opening.zoneId &&
        (el.name ?? '').trim() === hostWallName,
    );
    if (hostWall) {
      const target = findNonBasementGroundSurfaceForLineElement(hostWall, elements);
      if (target) return target.surfaceM;
    }
  }

  const directTarget = findNonBasementGroundSurfaceForLineElement(opening, elements);
  return directTarget?.surfaceM ?? null;
}

function linkedBasementGroundForFacadeOpening(
  opening: VerticalFacadeOpeningHost,
  elements: Element[],
): ReturnType<typeof findLinkedBasementGroundForLineElement> {
  const hostWallName =
    typeof opening.parent_element === 'string' && opening.parent_element.trim() !== ''
      ? opening.parent_element.trim()
      : null;
  if (hostWallName) {
    const hostWall = elements.find(
      (el): el is BuildingElementOpaque =>
        el.type === 'BuildingElementOpaque' &&
        el.zoneId === opening.zoneId &&
        (el.name ?? '').trim() === hostWallName,
    );
    if (hostWall) {
      const linked = findLinkedBasementGroundForLineElement(hostWall, elements);
      if (linked) return linked;
    }
  }

  return findLinkedBasementGroundForLineElement(opening, elements);
}

function appendFacadeOpeningThermalBridgeProposalsForHost(
  t: VerticalFacadeOpeningHost,
  elements: Element[],
  floors: Floor[] | undefined,
  useFloors: boolean,
  out: FacadeOpeningTbProposal[],
): void {
  const hostWall =
    typeof t.parent_element === 'string' && t.parent_element.trim() !== '' ? t.parent_element.trim() : null;

  const coords = t.coordinates;
  const p0 = coords[0]!;
  const p1 = coords[1]!;
  const { zBottomM, zCoord0: z0, zCoord1: z1, usedBaseHeight } = openingSillElevationMForFacadeTb(t);
  const zMinCoord = Math.min(z0, z1);

  let zSill: number;
  let useGroundWallFloor: boolean;
  let useIntermediateWallFloor: boolean;
  const linkedGroundSurfaceM = linkedGroundSurfaceMForFacadeOpening(t, elements);
  const linkedBasementGround = linkedBasementGroundForFacadeOpening(t, elements);
  const linkedToBasementGround = linkedBasementGround !== null;
  const unheatedBasementWallFloorTargetM =
    linkedBasementGround?.ground.floor_type === 'Unheated_basement'
      ? linkedBasementGround.targetBaseHeightM
      : null;

  if (useFloors && floors) {
    const sillAbsM = elementBaseElevationMForTb(t as Element, floors);
    const floorZ = elementFloorZIndexForTb(t as Element, floors);
    const slabElevM = slabElevationMForFloorZ(floorZ, floors);
    const groundTargetM = floorZ === 0 && linkedGroundSurfaceM !== null ? linkedGroundSurfaceM : slabElevM;
    const nearSlab = Math.abs(sillAbsM - groundTargetM) <= SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M;
    const nearUnheatedBasementWallFloor =
      unheatedBasementWallFloorTargetM !== null &&
      Math.abs(sillAbsM - unheatedBasementWallFloorTargetM) <= SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M;
    useGroundWallFloor = nearSlab && floorZ === 0 && !linkedToBasementGround;
    useIntermediateWallFloor = (nearSlab && floorZ >= 1) || nearUnheatedBasementWallFloor;
    zSill = nearUnheatedBasementWallFloor
      ? unheatedBasementWallFloorTargetM
      : useGroundWallFloor && linkedGroundSurfaceM !== null
        ? linkedGroundSurfaceM
        : sillAbsM;
  } else {
    const nearLinkedGroundSurface =
      linkedGroundSurfaceM !== null && Math.abs(zBottomM - linkedGroundSurfaceM) <= SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M;
    const nearUnheatedBasementWallFloor =
      unheatedBasementWallFloorTargetM !== null &&
      Math.abs(zBottomM - unheatedBasementWallFloorTargetM) <= SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M;
    zSill = nearUnheatedBasementWallFloor
      ? unheatedBasementWallFloorTargetM
      : nearLinkedGroundSurface
        ? linkedGroundSurfaceM
        : zBottomM;
    useGroundWallFloor =
      !linkedToBasementGround &&
      (nearLinkedGroundSurface || zBottomM <= SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M) &&
      zMinCoord < 1 - 1e-9;
    useIntermediateWallFloor = nearUnheatedBasementWallFloor;
  }

  const geomWidthM = roundToTwoDecimals(dist2XY(p0, p1));
  const width = typeof t.width === 'number' && t.width > 0 ? t.width : geomWidthM;
  const height = typeof t.height === 'number' && t.height > 0 ? t.height : 0;

  const zTop = zSill + height;

  const sillA = { x: p0.x, y: p0.y, z: zSill };
  const sillB = { x: p1.x, y: p1.y, z: zSill };
  const headA = { x: p0.x, y: p0.y, z: zTop };
  const headB = { x: p1.x, y: p1.y, z: zTop };
  const jambFirstBottom = sillA;
  const jambFirstTop = headA;
  const jambSecondBottom = sillB;
  const jambSecondTop = headB;
  const usesUnheatedBasementWallFloor =
    useIntermediateWallFloor &&
    unheatedBasementWallFloorTargetM !== null &&
    Math.abs(zSill - unheatedBasementWallFloorTargetM) <= SKIP_SILL_THERMAL_BRIDGE_BELOW_Z_M;

  const horizontalLengthM = geomWidthM > 0 ? geomWidthM : width;

  const roles: Array<{
    role: FacadeOpeningEdgeRole;
    coords: [typeof sillA, typeof sillB];
    length: number;
    reason: string;
    parentElementForTb?: string | null;
  }> = [
    {
      role: 'lintel',
      coords: [headA, headB],
      length: horizontalLengthM,
      reason: `Lintel run along top of opening "${t.name}" (segment length in plan)`,
    },
    ...(useIntermediateWallFloor
      ? [
          {
            role: 'wall_intermediate_floor_foot' as const,
            coords: [sillA, sillB] as [typeof sillA, typeof sillB],
            length: horizontalLengthM,
            reason: usesUnheatedBasementWallFloor
              ? `Wall–unheated-basement floor junction under "${t.name}" (E6 replaces E3 sill; sill near height_basement_walls)`
              : `Wall–intermediate-floor junction under "${t.name}" (E6 replaces E3 sill; sill near intermediate slab elevation)`,
            parentElementForTb: hostWall,
          },
        ]
      : useGroundWallFloor
        ? [
            {
              role: 'wall_ground_foot' as const,
              coords: [sillA, sillB] as [typeof sillA, typeof sillB],
              length: horizontalLengthM,
              reason: `Wall–floor junction under "${t.name}" (E5 replaces E3 sill where opening meets ground)`,
              parentElementForTb: hostWall,
            },
          ]
        : [
            {
              role: 'sill' as const,
              coords: [sillA, sillB] as [typeof sillA, typeof sillB],
              length: horizontalLengthM,
              reason: `Sill along bottom of opening "${t.name}"`,
            },
          ]),
    {
      role: 'jamb_first',
      coords: [jambFirstBottom, jambFirstTop],
      length: height,
      reason: jambReason(t.name, 'first', usedBaseHeight, z0, z1),
    },
    {
      role: 'jamb_second',
      coords: [jambSecondBottom, jambSecondTop],
      length: height,
      reason: jambReason(t.name, 'second', usedBaseHeight, z0, z1),
    },
  ];

  for (const row of roles) {
    const code = defaultJunctionCodeForEdge(row.role);
    const proposal: FacadeOpeningTbProposal = {
      proposalId: `${t.id}:${row.role}`,
      openingId: t.id,
      openingName: t.name,
      zoneId: t.zoneId,
      edgeRole: row.role,
      junctionCode: code,
      suggestedLengthM: roundToTwoDecimals(row.length),
      linearThermalTransmittance: psiTable37ForCode(code),
      reason: row.reason,
      coordinates: row.coords,
    };
    if (row.parentElementForTb !== undefined) {
      proposal.parentElementForTb = row.parentElementForTb;
    }
    out.push(proposal);
  }
}

/**
 * Build up to four linear TB proposals (lintel, sill, two jambs) for each qualifying wall opening.
 *
 * @param floors — When provided (e.g. from `geometryStore.floors`), E5/E6 wall–floor uses absolute sill vs slab
 *   elevation. Unheated basement wall/floor feet use `height_basement_walls` and E6. When omitted, normal
 *   intermediate-storey E6 is not inferred, but linked unheated-basement E6 can still be inferred.
 */
export function proposeFacadeOpeningThermalBridges(elements: Element[], floors?: Floor[]): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const out: FacadeOpeningTbProposal[] = [];
  const useFloors = Boolean(floors && floors.length > 0);

  for (const el of elements) {
    if (el.type === 'BuildingElementTransparent') {
      const t = el as BuildingElementTransparent;
      if (!isWallFacadeOpening(t)) continue;
      appendFacadeOpeningThermalBridgeProposalsForHost(t, elements, floors, useFloors, out);
    } else if (el.type === 'BuildingElementOpaque') {
      const o = el as BuildingElementOpaque;
      if (!isExternalDoorFacadeOpening(o)) continue;
      appendFacadeOpeningThermalBridgeProposalsForHost(o, elements, floors, useFloors, out);
    }
  }

  return out;
}

export type ProposalDedupeStatus = 'new' | 'duplicate';

export interface AnnotatedFacadeProposal extends FacadeOpeningTbProposal {
  status: ProposalDedupeStatus;
  /** When duplicate, best-matching existing TB id if found. */
  matchedExistingId?: string;
}

/**
 * Tag proposals as duplicate when an existing ThermalBridgeLinear matches junction_type + midpoint proximity.
 */
export function annotateProposalsWithDedupe(
  proposals: FacadeOpeningTbProposal[],
  elements: Element[],
  toleranceM: number = DEFAULT_TB_DEDUPE_TOLERANCE_M,
): AnnotatedFacadeProposal[] {
  const existing = elements.filter((e): e is ThermalBridgeLinear => e.type === 'ThermalBridgeLinear' && !e.isPlaceholder);

  return proposals.map((p) => {
    const jt = p.junctionCode;
    const mid = midpoint3(p.coordinates[0], p.coordinates[1]);

    let matched: ThermalBridgeLinear | undefined;
    for (const tb of existing) {
      const exJt = tb.extra_json?.junction_type as string | undefined;
      if (!exJt || exJt !== jt) continue;
      const c = tb.coordinates;
      if (!c || c.length < 2) continue;
      const exMid = midpoint3(c[0], c[1]);
      if (dist3(mid, exMid) <= toleranceM) {
        matched = tb;
        break;
      }
    }

    if (matched) {
      return {
        ...p,
        status: 'duplicate',
        matchedExistingId: matched.id,
      };
    }
    return { ...p, status: 'new' };
  });
}
