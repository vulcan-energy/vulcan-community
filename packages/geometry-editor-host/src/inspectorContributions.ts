// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createContext,
  type ComponentType,
  type ReactNode,
} from 'react';

export type GeometryInspectorSelection = Readonly<{
  id: string;
  type: 'zone' | 'element' | 'global' | 'dormer';
  isPlaceholder?: boolean;
}>;

export type GeometryInspectorEvidenceProviderProps = Readonly<{
  selection: GeometryInspectorSelection;
  documentFileName?: string;
  children: ReactNode;
}>;

export type GeometryInspectorEvidenceSectionContext = Readonly<{
  elementType: string;
  elementSubtype?: string;
  useFHSSchema: boolean;
}>;

export interface GeometryInspectorEvidenceBridge {
  readonly linkedFieldKeys: ReadonlySet<string>;
  renderFieldIndicator(fieldKey: string): ReactNode;
  renderSection(context: GeometryInspectorEvidenceSectionContext): ReactNode;
}

const EMPTY_LINKED_FIELD_KEYS: ReadonlySet<string> = Object.freeze(new Set<string>());

export const unavailableGeometryInspectorEvidenceBridge: GeometryInspectorEvidenceBridge =
  Object.freeze({
    linkedFieldKeys: EMPTY_LINKED_FIELD_KEYS,
    renderFieldIndicator: () => null,
    renderSection: () => null,
  });

export const GeometryInspectorEvidenceContext =
  createContext<GeometryInspectorEvidenceBridge>(
    unavailableGeometryInspectorEvidenceBridge,
  );

export type GeometryInspectorEvidenceContribution = Readonly<{
  Provider: ComponentType<GeometryInspectorEvidenceProviderProps>;
}>;

export type GeometryDetailedJunctionSolverProps = Readonly<{
  elementId: string;
  onAdoptPsi?: (psiWPerMK: number) => void;
  onHostReadinessAction?: (action: Readonly<{
    elementId: string;
    kind: 'assembly_calculator' | 'open_host_element';
  }>) => void;
}>;

export type GeometryDetailedJunctionSolverContribution = Readonly<{
  Control: ComponentType<GeometryDetailedJunctionSolverProps>;
}>;

export type GeometryProductCatalogueSystemContext = Readonly<{
  active: boolean;
  element: unknown;
  elementsById: Readonly<Record<string, unknown>>;
  elementVersion: number;
  onApply(payload: Readonly<{
    subcategory: string;
    extraJson: Record<string, unknown>;
  }>): void;
}>;

export type GeometryProductCatalogueAdvancedHotWaterContext = Readonly<{
  element: unknown;
  elementsById: Readonly<Record<string, unknown>>;
  flat: boolean;
  onPatchExtraJson: (
    update: (current: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
}>;

export type GeometryProductCatalogueContribution = Readonly<{
  hasAppliedSystemData(extraJson: unknown): boolean;
  prefetchSystemSource?(): void;
  renderSystemSource(context: GeometryProductCatalogueSystemContext): ReactNode;
  renderAdvancedHotWaterAction(
    context: GeometryProductCatalogueAdvancedHotWaterContext,
  ): ReactNode;
}>;

export type GeometryConstructionDetailCandidate = Readonly<{
  key: string;
  label: string;
  psiWPerMK: number;
  value: unknown;
}>;

export type GeometryConstructionDetailsContribution = Readonly<{
  isEnabled(): boolean;
  listCandidates(
    profile: unknown,
    junctionType: string,
  ): readonly GeometryConstructionDetailCandidate[];
  selectedCandidateKey(extraJson: unknown): string;
  mergeCandidate(
    extraJson: Record<string, unknown>,
    candidate: GeometryConstructionDetailCandidate | undefined,
  ): Record<string, unknown>;
}>;

export type GeometryInspectorContributions = Readonly<{
  evidence: GeometryInspectorEvidenceContribution | null;
  detailedJunctionSolver: GeometryDetailedJunctionSolverContribution | null;
  productCatalogue: GeometryProductCatalogueContribution | null;
  constructionDetails: GeometryConstructionDetailsContribution | null;
}>;

export function defineGeometryInspectorContributions(
  contributions: Partial<GeometryInspectorContributions>,
): GeometryInspectorContributions {
  return Object.freeze({
    evidence: contributions.evidence ?? null,
    detailedJunctionSolver: contributions.detailedJunctionSolver ?? null,
    productCatalogue: contributions.productCatalogue ?? null,
    constructionDetails: contributions.constructionDetails ?? null,
  });
}

export const emptyGeometryInspectorContributions =
  defineGeometryInspectorContributions({});
