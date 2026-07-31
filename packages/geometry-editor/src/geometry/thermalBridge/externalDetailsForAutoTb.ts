// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ExternalDetailProfileLink } from '../../lib/assemblyTypes';
import {
  externalDetailCandidateKey,
  type ExternalDetailCataloguePort,
  type ExternalConstructionDetailCandidate,
  type ExternalConstructionDetailProfile,
} from './externalDetailContracts';
import type { Element } from '../types';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { findHostElementForAutoTbProposal } from './resolveTbHostFloorId';

export type ExternalDetailAutoTbCandidate = ExternalConstructionDetailCandidate;

export interface ExternalDetailAutoTbSuggestion {
  groupKey: string;
  hostElementId: string;
  profile: ExternalConstructionDetailProfile;
  candidates: readonly ExternalDetailAutoTbCandidate[];
  selected?: ExternalDetailAutoTbCandidate;
}

function readExternalDetailProfileLinkFromElement(
  element: Element | undefined,
  catalogue: ExternalDetailCataloguePort,
): ExternalDetailProfileLink | null {
  const extra = (element as { extra_json?: unknown } | undefined)?.extra_json;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const envelope = (extra as Record<string, unknown>).vulcan_assembly_v1;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
  const snapshot = (envelope as Record<string, unknown>).assemblySnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const link = (snapshot as Record<string, unknown>).externalDetailProfile;
  if (!link || typeof link !== 'object' || Array.isArray(link)) return null;
  const source = typeof (link as Record<string, unknown>).source === 'string'
    ? String((link as Record<string, unknown>).source).trim()
    : '';
  const profileId = typeof (link as Record<string, unknown>).profileId === 'string'
    ? String((link as Record<string, unknown>).profileId).trim()
    : '';
  const label = typeof (link as Record<string, unknown>).label === 'string'
    ? String((link as Record<string, unknown>).label).trim()
    : profileId;
  if (!source || !profileId) return null;
  const profile = catalogue.getProfile({ source, profileId, label });
  return profile ? { source, profileId, label } : null;
}

export function externalDetailAutoTbGroupKey(source: string, profileId: string, junctionCode: string): string {
  return `${source}::${profileId}::${junctionCode}`;
}

export function externalDetailThermalBridgeSourceExtraJsonForCandidate(
  selected: ExternalConstructionDetailCandidate | undefined,
): Record<string, unknown> | undefined {
  if (!selected) return undefined;
  const payload = {
    source: selected.profile.source,
    sourceName: selected.profile.sourceName,
    sourceImportedAt: selected.profile.importedAt,
    sourceUrl: selected.profile.sourceUrl,
    documentUrl: selected.detail.documentUrl ?? selected.profile.documentUrl,
    profileId: selected.profile.id,
    profileLabel: selected.profile.label,
    systemName: selected.profile.systemName,
    junctionCode: selected.detail.junctionCode,
    detailKey: externalDetailCandidateKey(selected),
    detailCode: selected.detail.detailCode,
    detailTitle: selected.detail.title,
    psiWPerMK: selected.detail.psiWPerMK,
    fRsi: selected.detail.fRsi,
    sourceTableRef: selected.detail.sourceTableRef,
    inputs: selected.detail.inputs,
    qualityFlags: selected.detail.qualityFlags,
  };
  return {
    psi_source: selected.profile.source,
    external_construction_detail: payload,
    ...(selected.profile.category === 'recognised_details'
      ? { recognised_construction_detail: payload }
      : {}),
  };
}

export function mergeExternalDetailSourceIntoThermalBridgeExtraJson(
  extraJson: Record<string, unknown>,
  selected: ExternalConstructionDetailCandidate | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...extraJson };
  const existingSource =
    next.thermal_bridge_source &&
    typeof next.thermal_bridge_source === 'object' &&
    !Array.isArray(next.thermal_bridge_source)
      ? { ...(next.thermal_bridge_source as Record<string, unknown>) }
      : {};
  delete existingSource.psi_source;
  delete existingSource.external_construction_detail;
  delete existingSource.recognised_construction_detail;

  const sourcePatch = externalDetailThermalBridgeSourceExtraJsonForCandidate(selected);
  const mergedSource = {
    ...existingSource,
    ...(sourcePatch ?? {}),
  };
  if (Object.keys(mergedSource).length > 0) {
    next.thermal_bridge_source = mergedSource;
  } else {
    delete next.thermal_bridge_source;
  }
  return next;
}

export function getExternalDetailSuggestionForAutoProposal(
  proposal: FacadeOpeningTbProposal,
  elementsById: Record<string, Element>,
  selectedDetailKeyByGroup: Record<string, string>,
  catalogue?: ExternalDetailCataloguePort,
  defaultDetailProfile?: ExternalDetailProfileLink | null,
): ExternalDetailAutoTbSuggestion | undefined {
  if (!catalogue) return undefined;
  const host = findHostElementForAutoTbProposal(proposal, elementsById);
  const hostElementId = host?.id?.trim();
  const link = defaultDetailProfile ?? readExternalDetailProfileLinkFromElement(host, catalogue);
  if (!hostElementId || !link) return undefined;
  const candidates = catalogue.getDetailsForJunction(link, proposal.junctionCode);
  if (candidates.length === 0) return undefined;
  const profile = candidates[0]!.profile;
  const groupKey = externalDetailAutoTbGroupKey(profile.source, profile.id, proposal.junctionCode);
  const selectedDetailKey = selectedDetailKeyByGroup[groupKey]?.trim();
  const selected =
    candidates.length === 1
      ? candidates[0]
      : candidates.find((candidate) => externalDetailCandidateKey(candidate) === selectedDetailKey);
  return {
    groupKey,
    hostElementId,
    profile,
    candidates,
    selected,
  };
}

export function externalDetailThermalBridgeSourceExtraJson(
  suggestion: ExternalDetailAutoTbSuggestion | undefined,
): Record<string, unknown> | undefined {
  return externalDetailThermalBridgeSourceExtraJsonForCandidate(suggestion?.selected);
}
