// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * **Junction contract layer** — single registry keyed by Table 3.7 `junction_type`, linking:
 * - **Validation intent** (what `findLinearThermalBridgeIssues` enforces)
 * - **Proposer** edge roles (`FacadeOpeningEdgeRole`) that emit each code
 *
 * **Note:** This registry does **not** list or invoke the `propose*` functions — those are wired in
 * `AutoThermalBridgePreviewModal` (and tests). Here we record which codes exist and
 * which edge roles map to which junction codes so validation (`junctionHostPredicates`) stays aligned.
 * Detailed-solver metadata is intentionally kept in the private solver package so
 * topology validation cannot acquire an import path to the solver implementation.
 */
import { JUNCTION_TYPE_ENUM } from '../../lib/simplifiedFabricMap';
import { isJunctionAutoSuggestedByFacadeTool } from './facadeAutoTbScope';
import {
  defaultJunctionCodeForEdge,
  junctionOptionsForFacadeEdgeRole,
  type FacadeOpeningEdgeRole,
} from './proposeFacadeOpenings';

/** Typical host geometry the façade auto proposers attach this code to (documentation + routing). */
export type JunctionProposerHostPattern =
  | 'facade_opening_2pt'
  | 'external_opaque_wall_2pt'
  | 'roof_opaque_polygon_edge'
  | 'flat_roof_deck_2pt_or_polygon'
  | 'ground_basement_polygon_edge'
  | 'external_wall_corner_two_opaque'
  | 'roof_window_opening_2pt'
  | 'roof_polygon_or_window_edge'
  | 'external_wall_plus_adjacent_segment'
  /** Party wall line × ground / intermediate / exposed floor segment (Table 3.7 P1/P2/P3/P6/P7/P8). */
  | 'party_wall_plus_floor_segment'
  | 'party_wall_to_external_line'
  /** Horizontal party floor or party ceiling adjacent line × external wall (E7). */
  | 'party_floor_to_wall'
  /** Party wall line × plan edge of sloped or flat external roof (Table 3.7 P4 / P5). */
  | 'party_wall_to_roof_plan_edge'
  /** Manual linear TB / polygon edge hosts for junction codes without a dedicated auto proposer pattern. */
  | 'explicit_ui_hint_polygon_or_edge'
  | 'balcony_penetration'
  | 'general_linear_tb';

/** What the issue finder applies for this code (E16/E17 runtime path also uses resolved wall ids). */
export interface JunctionValidationContract {
  usesDualWallCornerRules: boolean;
  usesRoofWindowParentRule: boolean;
  usesSingleParentOutlineChecks: boolean;
  summary: string;
}

export interface JunctionContractEntry {
  junctionType: string;
  validation: JunctionValidationContract;
  proposerHostPattern: JunctionProposerHostPattern;
  proposerEdgeRoles: readonly FacadeOpeningEdgeRole[];
  inFacadeAutoSuggestSet: boolean;
}

const ALL_FACADE_EDGE_ROLES: readonly FacadeOpeningEdgeRole[] = [
  'lintel',
  'sill',
  'wall_ground_foot',
  'wall_intermediate_floor_foot',
  'jamb_first',
  'jamb_second',
  'roof_window_head',
  'roof_window_sill',
  'roof_window_jamb_first',
  'roof_window_jamb_second',
  'rooflight_kerb',
  'external_corner_convex',
  'external_corner_reentrant',
  'wall_ground_continuous',
  'wall_intermediate_continuous',
  'party_wall_junction',
  'unheated_adjacent_wall_junction',
  'flat_roof_edge',
  'party_to_external_e18',
  'sloped_roof_eaves',
  'sloped_roof_gable',
  'sloped_roof_ridge',
  'e7_party_floor_external',
  'basement_floor_edge',
  'party_wall_to_sloped_roof',
  'party_wall_to_flat_roof',
  'sloped_roof_to_adjacent_wall_r8_r9',
  'dormer_roof_to_host_roof_r10',
] as const;

function buildEdgeRolesByJunctionCode(): Map<string, FacadeOpeningEdgeRole[]> {
  const m = new Map<string, FacadeOpeningEdgeRole[]>();
  for (const role of ALL_FACADE_EDGE_ROLES) {
    const codes = junctionOptionsForFacadeEdgeRole(role);
    for (const code of codes) {
      const cur = m.get(code) ?? [];
      if (!cur.includes(role)) cur.push(role);
      m.set(code, cur);
    }
    const defCode = defaultJunctionCodeForEdge(role) as string;
    const cur = m.get(defCode) ?? [];
    if (!cur.includes(role)) cur.push(role);
    m.set(defCode, cur);
  }
  return m;
}

const EDGE_ROLES_BY_JUNCTION_CODE = buildEdgeRolesByJunctionCode();

function proposerHostPatternFor(jt: string): JunctionProposerHostPattern {
  if (['E1', 'E2', 'E3', 'E4'].includes(jt)) return 'facade_opening_2pt';
  if (['E5', 'E6', 'E19'].includes(jt)) return 'external_opaque_wall_2pt';
  if (jt === 'E7') return 'party_floor_to_wall';
  if (['E8', 'E9', 'E23'].includes(jt)) return 'balcony_penetration';
  if (['E10', 'E11', 'E12', 'E13', 'E24'].includes(jt)) return 'roof_opaque_polygon_edge';
  if (['E14', 'E15'].includes(jt)) return 'flat_roof_deck_2pt_or_polygon';
  if (jt === 'E16' || jt === 'E17') return 'external_wall_corner_two_opaque';
  if (jt === 'E18') return 'party_wall_to_external_line';
  if (jt === 'E22') return 'ground_basement_polygon_edge';
  if (['E20', 'E21'].includes(jt)) return 'external_wall_plus_adjacent_segment';
  if (jt === 'E25') return 'general_linear_tb';
  if (jt === 'P4' || jt === 'P5') return 'party_wall_to_roof_plan_edge';
  if (['P1', 'P2', 'P3', 'P6', 'P7', 'P8'].includes(jt)) return 'party_wall_plus_floor_segment';
  if (jt === 'R1' || jt === 'R2' || jt === 'R3') return 'roof_window_opening_2pt';
  if (['R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11'].includes(jt)) return 'roof_polygon_or_window_edge';
  return 'general_linear_tb';
}

function validationSummaryFor(jt: string): string {
  switch (jt) {
    case 'E1':
      return 'Steel lintel on façade opening; solver vertical section BR 497 opening wall.';
    case 'E2':
      return 'Other lintel; same solver family as E1.';
    case 'E3':
      return 'Sill on façade opening.';
    case 'E4':
      return 'Jamb on façade opening; solver plan section.';
    case 'E5':
      return 'Wall–ground floor; solver horizontal section, wall+floor hosts, BR solid-ground FEM domain / soil.';
    case 'E6':
      return 'Wall–intermediate floor slab.';
    case 'E7':
      return 'Party floor or party ceiling line (horizontal conditioned adjacent, party UI flag) to external wall.';
    case 'E8':
      return 'Balcony within dwelling (wall insulation continuous).';
    case 'E9':
      return 'Balcony between dwellings.';
    case 'E10':
    case 'E11':
      return 'Sloped roof eaves (cold vs warm deck).';
    case 'E12':
    case 'E13':
      return 'Sloped roof gable.';
    case 'E14':
    case 'E15':
      return 'Flat roof / parapet edge.';
    case 'E16':
      return 'External convex corner; two walls + plan-corner FEM / ψ split.';
    case 'E17':
      return 'External re-entrant corner; two walls + plan-corner FEM.';
    case 'E18':
      return 'Party wall to external wall.';
    case 'E19':
      return 'Inverted ground floor.';
    case 'E20':
    case 'E21':
      return 'Exposed floor (normal / inverted).';
    case 'E22':
      return 'Basement floor perimeter on ground polygon.';
    case 'E23':
      return 'Balcony support penetration.';
    case 'E24':
      return 'Inverted eaves.';
    case 'E25':
      return 'Table 3.7 E25.';
    case 'P1':
      return 'Party wall × ground floor (Table 3.7 P-series).';
    case 'P2':
    case 'P3':
      return 'Party wall × intermediate conditioned floor line.';
    case 'P4':
      return 'Party wall to roof — pitched deck (with P5 where applicable) or flat external roof opaque (P4).';
    case 'P5':
      return 'Party wall to pitched roof edge (warm deck); not used for horizontal flat decks.';
    case 'P6':
      return 'Party wall × ground floor inverted (P-series; parallel to E19 at external wall).';
    case 'P7':
    case 'P8':
      return 'Exposed floor (normal / inverted) at party wall (parallel to E20/E21 at external wall).';
    case 'R1':
    case 'R2':
    case 'R3':
      return 'Roof window head/sill/jamb — parent must be qualifying roof opening.';
    case 'R4':
    case 'R5':
      return 'Sloped roof ridge.';
    case 'R6':
    case 'R7':
      return 'Roof junction (typically manual linear TB where no auto row applies).';
    case 'R10':
      return 'All other roof or room-in-roof junctions; auto-suggested for dormer roof tie-back edges where topology matches.';
    case 'R8':
    case 'R9':
      return 'Room-in-roof roof opaque × adjacent wall (auto-suggested where topology matches).';
    case 'R11':
      return 'Rooflight kerb / upstand.';
    default:
      return `Table 3.7 ${jt}: align linear TB with host geometry; extend solver detail registry when FEM added.`;
  }
}

function validationContractFor(jt: string): JunctionValidationContract {
  const dual = jt === 'E16' || jt === 'E17';
  const r123 = jt === 'R1' || jt === 'R2' || jt === 'R3';
  return {
    usesDualWallCornerRules: dual,
    usesRoofWindowParentRule: r123,
    usesSingleParentOutlineChecks: true,
    summary: validationSummaryFor(jt),
  };
}

function buildEntry(jt: string): JunctionContractEntry {
  const roles = EDGE_ROLES_BY_JUNCTION_CODE.get(jt) ?? [];
  return {
    junctionType: jt,
    validation: validationContractFor(jt),
    proposerHostPattern: proposerHostPatternFor(jt),
    proposerEdgeRoles: [...roles],
    inFacadeAutoSuggestSet: isJunctionAutoSuggestedByFacadeTool(jt),
  };
}

const CONTRACT_BY_CODE: ReadonlyMap<string, JunctionContractEntry> = new Map(
  JUNCTION_TYPE_ENUM.map((jt) => [jt, buildEntry(jt)]),
);

/** Full contract for a Table 3.7 code, or undefined if not in enum. */
export function getJunctionContract(junctionType: string | undefined): JunctionContractEntry | undefined {
  if (!junctionType || typeof junctionType !== 'string') return undefined;
  return CONTRACT_BY_CODE.get(junctionType.trim());
}

/** All contracts in enum order. */
export function listJunctionContracts(): readonly JunctionContractEntry[] {
  return JUNCTION_TYPE_ENUM.map((jt) => CONTRACT_BY_CODE.get(jt)!);
}

/** True when every {@link JUNCTION_TYPE_ENUM} entry has a built contract (CI guard). */
export function assertFullJunctionContractCoverage(): void {
  for (const jt of JUNCTION_TYPE_ENUM) {
    if (!CONTRACT_BY_CODE.has(jt)) {
      throw new Error(`Missing junction contract for ${jt}`);
    }
  }
}
