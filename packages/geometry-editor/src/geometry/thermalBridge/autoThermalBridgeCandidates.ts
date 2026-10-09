// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ExternalDetailProfileLink } from '../../lib/assemblyTypes';
import { THERMAL_BRIDGE_EXTRA_JSON_FLOOR_ID_KEY } from '../../lib/elementCanvasFloor';
import type { Element, ThermalBridgeLinear } from '../types';
import type { Floor } from '../../geometry/types';
import {
  annotateProposalsWithDedupe,
  type AnnotatedFacadeProposal,
  type FacadeOpeningTbProposal,
} from './proposeFacadeOpenings';
import {
  externalDetailThermalBridgeSourceExtraJson,
  getExternalDetailSuggestionForAutoProposal,
  type ExternalDetailAutoTbSuggestion,
} from './externalDetailsForAutoTb';
import type { ExternalDetailCataloguePort } from './externalDetailContracts';
import {
  getEffectiveLinearPsiForFacadeProposal,
  VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY,
} from './linearTbPsi';
import {
  findHostElementForAutoTbProposal,
  resolveFloorStoreyIndexForAutoTbFromHostZ,
  resolveHostFloorIdForTbProposal,
  thermalBridgeSourceExtraJsonForAutoProposal,
} from './resolveTbHostFloorId';
import { junctionOptionsForFacadeEdgeRole } from './proposeFacadeOpenings';

export interface AutoThermalBridgeCandidate extends AnnotatedFacadeProposal {
  /** Supported classifications for this physical candidate, including exclusive variants. */
  junctionOptions: readonly string[];
  /** Canvas storey index persisted in extra_json.floor_id. */
  floorStoreyIndexForTb?: number;
  externalDetailSuggestion?: ExternalDetailAutoTbSuggestion;
  addabilityError?: string;
}

export interface EnrichAutoThermalBridgeCandidatesOptions {
  elements: Element[];
  floors?: Floor[];
  junctionPsiDefaultsMap?: Record<string, number> | null;
  junctionOverrides?: Record<string, string | undefined>;
  externalDetailSelection?: Record<string, string>;
  externalDetailCatalogue?: ExternalDetailCataloguePort;
  defaultDetailProfile?: ExternalDetailProfileLink | null;
}

/**
 * Junction alternatives normally belong to one role. R2 and R11 are the one deliberate cross-role
 * exception: the lower edge of one rooflight can be a sill or a kerb, but cannot be both.
 */
export function junctionOptionsForAutoThermalBridgeCandidate(
  proposal: Pick<FacadeOpeningTbProposal, 'edgeRole'>,
): readonly string[] {
  if (proposal.edgeRole === 'roof_window_sill' || proposal.edgeRole === 'rooflight_kerb') {
    return ['R2', 'R11'];
  }
  return junctionOptionsForFacadeEdgeRole(proposal.edgeRole);
}

export function coerceJunctionCodeForAutoThermalBridgeCandidate(
  proposal: Pick<FacadeOpeningTbProposal, 'edgeRole' | 'junctionCode'>,
  override: string | undefined,
): string {
  const options = junctionOptionsForAutoThermalBridgeCandidate(proposal);
  if (override !== undefined && options.includes(override)) return override;
  if (options.includes(proposal.junctionCode)) return proposal.junctionCode;
  return options[0] ?? proposal.junctionCode;
}

function sameRooflightLowerEdgeVariantPair(
  a: FacadeOpeningTbProposal,
  b: FacadeOpeningTbProposal,
): boolean {
  return a.openingId === b.openingId &&
    ((a.edgeRole === 'roof_window_sill' && b.edgeRole === 'rooflight_kerb') ||
      (a.edgeRole === 'rooflight_kerb' && b.edgeRole === 'roof_window_sill'));
}

/** Collapse the two emitted lower-edge rows to one stable R2-default physical candidate. */
function collapseExclusiveRooflightLowerEdges(
  proposals: readonly FacadeOpeningTbProposal[],
): FacadeOpeningTbProposal[] {
  const out: FacadeOpeningTbProposal[] = [];
  const handledOpeningIds = new Set<string>();
  for (const proposal of proposals) {
    if (proposal.edgeRole !== 'roof_window_sill' && proposal.edgeRole !== 'rooflight_kerb') {
      out.push(proposal);
      continue;
    }
    if (handledOpeningIds.has(proposal.openingId)) continue;
    handledOpeningIds.add(proposal.openingId);
    const sill = proposals.find((candidate) =>
      sameRooflightLowerEdgeVariantPair(proposal, candidate) && candidate.edgeRole === 'roof_window_sill');
    const preferred = sill ?? proposal;
    out.push({
      ...preferred,
      proposalId: `${preferred.openingId}:roof_window_sill`,
      edgeRole: 'roof_window_sill',
      junctionCode: 'R2',
      reason: sill?.reason ?? preferred.reason.replace('R11', 'R2'),
    });
  }
  return out;
}

/** Enriches shared physical candidates for the bulk modal and canvas previews. */
export function enrichAutoThermalBridgeCandidates(
  proposals: readonly FacadeOpeningTbProposal[],
  options: EnrichAutoThermalBridgeCandidatesOptions,
): AutoThermalBridgeCandidate[] {
  const elementsById: Record<string, Element> = {};
  for (const element of options.elements) if (element.id) elementsById[element.id] = element;

  const physicalProposals = collapseExclusiveRooflightLowerEdges(proposals);
  const resolved = physicalProposals.map((proposal) => {
    const openingZoneId = (elementsById[proposal.openingId] as { zoneId?: string } | undefined)?.zoneId;
    const proposalWithZone = {
      ...proposal,
      zoneId: proposal.zoneId?.trim() ? proposal.zoneId : openingZoneId,
    };
    const junctionCode = coerceJunctionCodeForAutoThermalBridgeCandidate(
      proposalWithZone,
      options.junctionOverrides?.[proposalWithZone.proposalId],
    );
    const proposalWithCode = { ...proposalWithZone, junctionCode };
    const externalDetailSuggestion = getExternalDetailSuggestionForAutoProposal(
      proposalWithCode,
      elementsById,
      options.externalDetailSelection ?? {},
      options.externalDetailCatalogue,
      options.defaultDetailProfile,
    );
    return {
      ...proposalWithCode,
      junctionOptions: junctionOptionsForAutoThermalBridgeCandidate(proposalWithCode),
      floorStoreyIndexForTb: proposalWithCode.floorStoreyIndexForTb ??
        resolveFloorStoreyIndexForAutoTbFromHostZ(proposalWithCode, elementsById, options.floors ?? []),
      linearThermalTransmittance:
        externalDetailSuggestion?.selected?.detail.psiWPerMK ??
        getEffectiveLinearPsiForFacadeProposal(
          proposalWithCode,
          options.junctionPsiDefaultsMap,
          elementsById,
        ),
      externalDetailSuggestion,
    };
  });
  return annotateProposalsWithDedupe(resolved, options.elements).map((candidate) => ({
    ...candidate,
    junctionOptions: junctionOptionsForAutoThermalBridgeCandidate(candidate),
    addabilityError: candidate.zoneId?.trim() ? undefined : 'The proposal has no zone association.',
  }));
}

/** Builds an element draft without store mutation so callers can use their normal add/history path. */
export function createThermalBridgeLinearFromAutoProposal(
  candidate: AutoThermalBridgeCandidate,
  elementsById: Record<string, Element>,
  floors: readonly { id: string; zIndex: number }[] = [],
): Omit<ThermalBridgeLinear, 'id'> {
  const openingZoneId = (elementsById[candidate.openingId] as { zoneId?: string } | undefined)?.zoneId;
  const zoneId = candidate.zoneId?.trim() || openingZoneId?.trim();
  if (!zoneId) {
    throw new Error(`Cannot add thermal bridge ${candidate.proposalId}: ${candidate.addabilityError ?? 'the proposal has no zone.'}`);
  }

  const hostRow = {
    openingId: candidate.openingId,
    zoneId: candidate.zoneId,
    parentElementForTb: candidate.parentElementForTb,
  };
  const parentElement = candidate.parentElementForTb !== undefined && candidate.parentElementForTb !== null &&
    String(candidate.parentElementForTb).trim() !== ''
    ? String(candidate.parentElementForTb).trim()
    : candidate.openingName;
  const storeyIndex = candidate.floorStoreyIndexForTb ?? resolveFloorStoreyIndexForAutoTbFromHostZ(
    hostRow,
    elementsById,
    floors,
  );
  const extraJson: Record<string, unknown> = { junction_type: candidate.junctionCode };
  if (storeyIndex !== undefined) extraJson[THERMAL_BRIDGE_EXTRA_JSON_FLOOR_ID_KEY] = storeyIndex;

  const source = thermalBridgeSourceExtraJsonForAutoProposal(
    {
      ...hostRow,
      cornerHostWallIds: candidate.cornerHostWallIds,
      hostElementIds: candidate.hostElementIds,
      roofAdjacentPairIds: candidate.roofAdjacentPairIds,
    },
    elementsById,
  );
  const externalDetailSource = externalDetailThermalBridgeSourceExtraJson(candidate.externalDetailSuggestion);
  if (source || externalDetailSource) {
    extraJson.thermal_bridge_source = { ...(source ?? {}), ...(externalDetailSource ?? {}) };
  }

  if (
    candidate.edgeRole === 'e7_party_floor_external' ||
    candidate.edgeRole === 'party_wall_junction' ||
    candidate.edgeRole === 'unheated_adjacent_wall_junction' ||
    candidate.edgeRole === 'party_to_external_e18' ||
    candidate.edgeRole === 'party_wall_to_sloped_roof' ||
    candidate.edgeRole === 'party_wall_to_flat_roof' ||
    candidate.edgeRole === 'sloped_roof_to_adjacent_wall_r8_r9'
  ) {
    extraJson[VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY] = candidate.openingId;
  }

  const hostFloorId = resolveHostFloorIdForTbProposal(hostRow, elementsById);
  const host = findHostElementForAutoTbProposal(hostRow, elementsById);
  return {
    type: 'ThermalBridgeLinear',
    name: '',
    zoneId,
    length: candidate.suggestedLengthM,
    linear_thermal_transmittance: candidate.linearThermalTransmittance,
    parent_element: parentElement,
    coordinates: [candidate.coordinates[0], candidate.coordinates[1]],
    floorId: hostFloorId ?? host?.floorId,
    extra_json: extraJson,
    isPlaceholder: false,
  } as Omit<ThermalBridgeLinear, 'id'>;
}
