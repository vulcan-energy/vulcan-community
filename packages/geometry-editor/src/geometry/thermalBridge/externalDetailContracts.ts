// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ExternalDetailProfileLink } from '../../lib/assemblyTypes';

export interface ExternalConstructionDetailJunction {
  junctionCode: string;
  detailCode: string;
  title: string;
  psiWPerMK: number;
  fRsi?: number;
  sourceTableRef?: string;
  documentUrl?: string;
  qualityFlags?: string[];
  inputs?: Record<string, unknown>;
}

export interface ExternalConstructionDetailProfile {
  id: string;
  source: string;
  sourceName: string;
  sourceShortName: string;
  sourceUrl: string;
  documentUrl?: string;
  importedAt: string;
  category: 'recognised_details' | 'manufacturer' | string;
  elementType: 'wall' | 'roof' | 'ground_floor' | string;
  systemName: string;
  label: string;
  optionLabel?: string;
  description?: string;
  profileInputs?: Record<string, unknown>;
  junctions: ExternalConstructionDetailJunction[];
}

export interface ExternalConstructionDetailCandidate {
  profile: ExternalConstructionDetailProfile;
  detail: ExternalConstructionDetailJunction;
}

type ExternalDetailKeyParts = {
  detailCode?: unknown;
  sourceTableRef?: unknown;
  psiWPerMK?: unknown;
  title?: unknown;
  detailTitle?: unknown;
};

export interface ExternalDetailCataloguePort {
  listProfiles(): readonly ExternalConstructionDetailProfile[];
  getProfile(
    linkOrProfileId: ExternalDetailProfileLink | string | null | undefined,
  ): ExternalConstructionDetailProfile | undefined;
  getDetailsForJunction(
    linkOrProfileId: ExternalDetailProfileLink | string | null | undefined,
    junctionCode: string,
  ): readonly ExternalConstructionDetailCandidate[];
}

function externalDetailKeyPart(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return encodeURIComponent(String(value).trim());
}

export function externalDetailJunctionKey(detail: ExternalDetailKeyParts): string {
  return [
    externalDetailKeyPart(detail.detailCode),
    externalDetailKeyPart(detail.sourceTableRef),
    externalDetailKeyPart(detail.psiWPerMK),
    externalDetailKeyPart(detail.title ?? detail.detailTitle),
  ].join('|');
}

export function externalDetailCandidateKey(
  candidate: ExternalConstructionDetailCandidate,
): string {
  return externalDetailJunctionKey(candidate.detail);
}
