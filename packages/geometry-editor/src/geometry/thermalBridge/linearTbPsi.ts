// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Single place for **linear** TB ψ: Table 3.7, workspace sparse CSV overlay, and shared-junction
 * apportioning where the party junction line is split across dwellings.
 */
import { isVulcanUiPartyFloorElement } from '../../lib/assemblyMaterialFabric';
import { getEffectiveLinearPsiFromWorkspaceSparseMap } from '../../lib/junctionPsiDefaultsCsv';
import type { Element } from '../types';
import {
  psiTable37ForCode,
  type FacadeOpeningEdgeRole,
  type FacadeOpeningTbProposal,
} from './proposeFacadeOpenings';

const SHARED_PARTY_TB_ROLES: ReadonlySet<FacadeOpeningEdgeRole> = new Set([
  'e7_party_floor_external',
  'party_wall_junction',
  'party_to_external_e18',
  'party_wall_to_sloped_roof',
  'party_wall_to_flat_roof',
]);

const SHARED_PARTY_JUNCTION = new Set(['E7', 'E18', 'E25', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);

/**
 * Suggest-TB and reload round-trip: link to the `BuildingElementAdjacent*` or party line used for
 * P1–P3 apportioning. Stripped before HEM merge (see `EXTRA_JSON_UI_KEYS`).
 */
export const VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY = '_vulcan_ui_tb_adjacent_element_id' as const;

export function readVulcanUiTbAdjacentElementIdFromExtraJson(extra_json: unknown): string | undefined {
  if (!extra_json || typeof extra_json !== 'object' || Array.isArray(extra_json)) return undefined;
  const v = (extra_json as Record<string, unknown>)[VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Party junctions describe a junction shared with another dwelling. Where the model marks adjacent fabric as
 * `BuildingElementPartyWall` or conditioned-adjacent with the UI “party wall” half-canvas flag, the
 * dwelling’s share of ψ is half the tabulated value. Unheated adjacent and plain conditioned
 * adjacency without that flag use the full table value.
 */
export function apportionmentDivisorForPartyAdjacentP(
  adjacentOrPartyElement: Element | null | undefined,
): 1 | 2 {
  if (!adjacentOrPartyElement) return 1;
  if (adjacentOrPartyElement.type === 'BuildingElementPartyWall') return 2;
  if (
    isVulcanUiPartyFloorElement(adjacentOrPartyElement)
  ) {
    return 2;
  }
  return 1;
}

/** Table 3.7 (and duplicate codes) with workspace overlay when present. */
export function baseLinearPsiForJunction(
  junctionCode: string,
  workspaceMap: Record<string, number> | null | undefined,
): number {
  const w = getEffectiveLinearPsiFromWorkspaceSparseMap(junctionCode, workspaceMap);
  if (w !== undefined && Number.isFinite(w)) return w;
  return psiTable37ForCode(junctionCode);
}

/**
 * Linear ψ (W/m·K) for a “Suggest thermal bridges” row: base ψ plus shared party apportioning when
 * the proposal carries the adjacent/party element id in `openingId`.
 */
export function getEffectiveLinearPsiForFacadeProposal(
  proposal: FacadeOpeningTbProposal,
  workspaceMap: Record<string, number> | null | undefined,
  elementsById: Record<string, Element>,
): number {
  const base = baseLinearPsiForJunction(proposal.junctionCode, workspaceMap);
  if (!SHARED_PARTY_TB_ROLES.has(proposal.edgeRole)) return base;
  const adj = elementsById[proposal.openingId];
  return base / apportionmentDivisorForPartyAdjacentP(adj);
}

/**
 * If `extra_json` has {@link VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY} and the linked element requires
 * party apportioning (same rule as `apportionmentDivisorForPartyAdjacentP`), return **ψ/2** for
 * the element editor. Otherwise `undefined` — use table / workspace shortcuts.
 */
export function getPApportionedLinearPsiForEditor(
  junctionCode: string,
  workspaceMap: Record<string, number> | null | undefined,
  elementsById: Record<string, Element>,
  extra_json: unknown,
): number | undefined {
  const jt = (junctionCode || '').trim();
  if (!SHARED_PARTY_JUNCTION.has(jt)) return undefined;
  const adjId = readVulcanUiTbAdjacentElementIdFromExtraJson(extra_json);
  if (!adjId) return undefined;
  const base = baseLinearPsiForJunction(jt, workspaceMap);
  const d = apportionmentDivisorForPartyAdjacentP(elementsById[adjId]);
  if (d === 1) return undefined;
  return base / d;
}
