// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Host predicates aligned with {@link JunctionProposerHostPattern} so TB validation matches auto-TB proposer semantics.
 *
 * Pass {@link junctionType} whenever known so R4/R5/R11 share one pattern but resolve to distinct host checks
 * (see {@link proposeAdjacentWallJunctionThermalBridges}, {@link proposeRoofOpenings}).
 */
import { isRoofLikeOpaqueElement } from '../../lib/roofElement';
import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementGround,
  BuildingElementOpaque,
  BuildingElementTransparent,
  Element,
} from '../types';
import type { JunctionProposerHostPattern } from './junctionContractRegistry';
import {
  horizontalConditionedFloorSlabPlanEdgesForPartyWallTb,
  isHorizontalAdjacentFloorLineForPartyTb,
} from './proposeAdjacentWallJunction';
import { isPartyHorizontalConditionedFloorSlabHost } from './proposeE7PartyFloorExternalWall';
import { isFlatRoofDeckLineForTb } from './proposeFlatRoofEdge';
import { isFlatRoofOpaqueForPartyWallToFlatRoofP4 } from './proposePartyWallToFlatRoofP4';
import { isExternalLineWall } from './proposeExternalCorners';
import { isExternalDoorFacadeOpening, isWallFacadeOpening } from './proposeFacadeOpenings';
import { isRoofWindowOpening } from './proposeRoofOpenings';
import { isPartyWallVerticalEnvelopeLine } from './proposePartyWallToExternalE18';
import { isSlopedRoofOpaqueForP4P5 } from './proposePartyWallToSlopedRoofP4P5';
import { isSlopedPitchedRoofElementForEavesGable } from './proposeSlopedRoofEavesGable';

function isBasementGroundHost(g: BuildingElementGround): boolean {
  return g.floor_type === 'Heated_basement' || g.floor_type === 'Unheated_basement';
}

/** Fabric families valid for E20/E21/P6 manual TB parents (`explicit_ui_hint_polygon_or_edge`). */
const EXPLICIT_UI_HINT_FABRIC_TYPES = new Set<string>([
  'BuildingElementOpaque',
  'BuildingElementTransparent',
  'BuildingElementGround',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
]);

function validateExplicitUiHintHost(host: Element): { ok: boolean; detail: string } {
  if (host.isPlaceholder) {
    return { ok: false, detail: 'Host cannot be a placeholder.' };
  }
  if (!EXPLICIT_UI_HINT_FABRIC_TYPES.has(host.type)) {
    return {
      ok: false,
      detail:
        'Expected a fabric host (opaque, transparent, ground, party wall, or adjacent segment).',
    };
  }
  const c = host.coordinates;
  if (!c || c.length < 2) {
    return { ok: false, detail: 'Expected coordinates with at least two plan points.' };
  }
  return { ok: true, detail: '' };
}

function validateRoofPolygonOrWindowEdge(
  host: Element,
  junctionType: string | undefined,
): { ok: boolean; detail: string } {
  const jt = junctionType?.trim();
  if (jt === 'R4' || jt === 'R5') {
    if (host.type === 'BuildingElementOpaque' && isSlopedPitchedRoofElementForEavesGable(host as BuildingElementOpaque)) {
      return { ok: true, detail: '' };
    }
    return {
      ok: false,
      detail:
        'R4/R5 ridge lines expect a sloped roof opaque host (roof-like fabric, 0° < pitch < 90°), same as the ridge proposer.',
    };
  }
  if (jt === 'R11') {
    if (host.type === 'BuildingElementTransparent' && isRoofWindowOpening(host as BuildingElementTransparent)) {
      return { ok: true, detail: '' };
    }
    return {
      ok: false,
      detail:
        'R11 kerb/upstand expects a qualifying roof window / rooflight (same host rules as R1–R3), not a plain opaque line.',
    };
  }
  if (jt === 'R8' || jt === 'R9') {
    if (host.type === 'BuildingElementOpaque' && isSlopedPitchedRoofElementForEavesGable(host as BuildingElementOpaque)) {
      return { ok: true, detail: '' };
    }
    // Fall through — topology proposer uses sloped opaque; legacy hint/UI parents may use roof window or other roof opaques.
  }
  // Manual and imported R6-R10 rows have historically used either the roof fabric or a roof opening as the
  // parent hint. Keep this broader than the auto proposers; topology-specific checks come from persisted
  // thermal_bridge_source host ids where available.
  if (host.type === 'BuildingElementOpaque' && isRoofLikeOpaqueElement(host as BuildingElementOpaque)) {
    return { ok: true, detail: '' };
  }
  if (host.type === 'BuildingElementTransparent' && isRoofWindowOpening(host as BuildingElementTransparent)) {
    return { ok: true, detail: '' };
  }
  return {
    ok: false,
    detail: 'Expected a roof opaque host or a qualifying roof window opening.',
  };
}

/**
 * P-series floor-host check for `party_wall_plus_floor_segment`, by junction code:
 *
 *  - P1/P6 (party wall × ground floor, normal/inverted — parallel to E5/E19 at an external wall):
 *    the floor is a **non-basement** `BuildingElementGround`. A basement ground is E22's polygon-edge
 *    family, not a party-wall line junction.
 *  - P2/P3 (party wall × intermediate conditioned floor — parallel to E6/E7): the floor is a
 *    `BuildingElementAdjacentConditionedSpace` at pitch 0° (floor) or 180° (ceiling) — the same slab
 *    modelled from either side of the storey.
 *  - P7/P8 and any other code sharing this pattern keep the original broad acceptance (any
 *    `BuildingElementGround`, or {@link isHorizontalAdjacentFloorLineForPartyTb}) — nothing here
 *    narrows their intent enough to tighten safely.
 */
function validatePartyWallPlusFloorSegmentHost(
  host: Element,
  junctionType: string | undefined,
): { ok: boolean; detail: string } {
  const jt = junctionType?.trim();
  if (jt === 'P1' || jt === 'P6') {
    if (host.type === 'BuildingElementGround' && !isBasementGroundHost(host as BuildingElementGround)) {
      return { ok: true, detail: '' };
    }
    return {
      ok: false,
      detail:
        'Expected a party wall segment or a non-basement BuildingElementGround slab, matching P1/P6 party-wall × ground-floor junctions.',
    };
  }
  if (jt === 'P2' || jt === 'P3') {
    // The plan-edge extractor carries the full host bar — placeholder, pitch 0/180,
    // coplanar-Z and non-degenerate-edge checks — for both lines and polygons.
    if (
      host.type === 'BuildingElementAdjacentConditionedSpace' &&
      horizontalConditionedFloorSlabPlanEdgesForPartyWallTb(
        host as BuildingElementAdjacentConditionedSpace,
      ).length > 0
    ) {
      return { ok: true, detail: '' };
    }
    return {
      ok: false,
      detail:
        'Expected a party wall segment or a horizontal party floor/ceiling line (pitch 0° or 180°), matching P2/P3 party-wall × intermediate-floor junctions.',
    };
  }
  if (host.type === 'BuildingElementGround') return { ok: true, detail: '' };
  if (isHorizontalAdjacentFloorLineForPartyTb(host)) return { ok: true, detail: '' };
  return {
    ok: false,
    detail:
      'Expected a party wall segment, BuildingElementGround slab, or horizontal floor line (pitch 0°), matching P7/P8 party-wall junctions.',
  };
}

/**
 * Whether `host` matches what façade / roof / party proposers attach this junction family to.
 * Dual-wall corners (E16/E17) skip this layer — handled only via {@link thermal_bridge_source} walls.
 *
 * @param junctionType Table 3.7 code — required for fine-grained checks when `pattern` is `roof_polygon_or_window_edge`.
 */
export function validateHostForProposerPattern(
  host: Element,
  pattern: JunctionProposerHostPattern,
  junctionType?: string,
): { ok: boolean; detail: string } {
  switch (pattern) {
    case 'general_linear_tb':
      return { ok: true, detail: '' };
    case 'external_wall_corner_two_opaque':
      return { ok: true, detail: '' };
    case 'facade_opening_2pt':
      if (host.type === 'BuildingElementTransparent' && isWallFacadeOpening(host as BuildingElementTransparent)) {
        return { ok: true, detail: '' };
      }
      if (host.type === 'BuildingElementOpaque' && isExternalDoorFacadeOpening(host as BuildingElementOpaque)) {
        return { ok: true, detail: '' };
      }
      return {
        ok: false,
        detail:
          'Expected a façade opening or external door (2-point vertical segment, width/height > 0, pitch unset or 90°).',
      };
    case 'external_opaque_wall_2pt':
      if (isExternalLineWall(host)) return { ok: true, detail: '' };
      return {
        ok: false,
        detail: 'Expected an external opaque wall line (2 points, vertical envelope, non-internal).',
      };
    case 'roof_opaque_polygon_edge':
      if (host.type === 'BuildingElementOpaque' && isSlopedPitchedRoofElementForEavesGable(host as BuildingElementOpaque)) {
        return { ok: true, detail: '' };
      }
      return {
        ok: false,
        detail: 'Expected a sloped roof opaque (roof-like, 0° < pitch < 90°).',
      };
    case 'flat_roof_deck_2pt_or_polygon':
      if (host.type === 'BuildingElementOpaque' && isFlatRoofDeckLineForTb(host as BuildingElementOpaque)) {
        return { ok: true, detail: '' };
      }
      return {
        ok: false,
        detail: 'Expected a flat roof deck host (roof-like opaque with pitch 0°).',
      };
    case 'ground_basement_polygon_edge':
      if (host.type === 'BuildingElementGround' && isBasementGroundHost(host as BuildingElementGround)) {
        return { ok: true, detail: '' };
      }
      return {
        ok: false,
        detail: 'Expected basement ground (Heated_basement or Unheated_basement polygon).',
      };
    case 'roof_window_opening_2pt':
      if (host.type === 'BuildingElementTransparent' && isRoofWindowOpening(host as BuildingElementTransparent)) {
        return { ok: true, detail: '' };
      }
      return {
        ok: false,
        detail:
          'R1–R3 must reference a roof window / rooflight (2-point line, width/height > 0, pitch set and not 90°, including 0°).',
      };
    case 'roof_polygon_or_window_edge':
      return validateRoofPolygonOrWindowEdge(host, junctionType);
    case 'external_wall_plus_adjacent_segment':
      if (isExternalLineWall(host)) return { ok: true, detail: '' };
      if (isHorizontalAdjacentFloorLineForPartyTb(host)) return { ok: true, detail: '' };
      return {
        ok: false,
        detail:
          'Expected an external wall line or horizontal exposed-floor adjacent segment, matching E20/E21 exposed floor × external wall.',
      };
    case 'party_wall_plus_floor_segment':
      if (isPartyWallVerticalEnvelopeLine(host)) return { ok: true, detail: '' };
      return validatePartyWallPlusFloorSegmentHost(host, junctionType);
    case 'party_wall_to_external_line':
      if (isExternalLineWall(host) || isPartyWallVerticalEnvelopeLine(host)) return { ok: true, detail: '' };
      return {
        ok: false,
        detail: 'Expected an external wall line or a vertical party wall segment.',
      };
    case 'party_floor_to_wall':
      if (isExternalLineWall(host) || isPartyHorizontalConditionedFloorSlabHost(host)) return { ok: true, detail: '' };
      return {
        ok: false,
        detail:
          'Expected an external wall line or a horizontal party-floor / party-ceiling adjacent segment (pitch 0°, party UI flag).',
      };
    case 'party_wall_to_roof_plan_edge':
      if (isPartyWallVerticalEnvelopeLine(host)) return { ok: true, detail: '' };
      if (host.type === 'BuildingElementOpaque') {
        const o = host as BuildingElementOpaque;
        if (isSlopedRoofOpaqueForP4P5(o)) return { ok: true, detail: '' };
        if (isFlatRoofOpaqueForPartyWallToFlatRoofP4(o)) return { ok: true, detail: '' };
      }
      return {
        ok: false,
        detail:
          'Expected a vertical party wall or an external roof opaque (pitched or flat pitch 0° deck), matching party-wall × roof P4/P5.',
      };
    case 'explicit_ui_hint_polygon_or_edge':
      return validateExplicitUiHintHost(host);
    case 'balcony_penetration':
      if (isExternalLineWall(host)) return { ok: true, detail: '' };
      return {
        ok: false,
        detail: 'Expected an external opaque wall line suitable for a balcony junction.',
      };
    default: {
      const _exhaustive: never = pattern;
      return _exhaustive;
    }
  }
}
