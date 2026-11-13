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

/** A system that needs a product, as the selected target's conversion reports it. */
export type GeometryProductSlot = Readonly<{
  /** Model path of the system object in the converted model. */
  path: string;
  system_type: string;
  product_id?: number | null;
  /** `product`: picked on the element or by a model setting; `default`: chosen by a rule. */
  source: 'product' | 'default';
  label?: string | null;
  /** How the product was chosen, or what the user must pick. */
  rule: string;
  technology_types: readonly string[];
  /** The slot keeps a product when the element's own pick is removed. */
  has_default?: boolean;
  /** Name of the Geometry CSV row the system comes from. */
  row?: string;
}>;

export type GeometryProductSlotContext = Readonly<{
  slot: GeometryProductSlot;
  element: Readonly<Record<string, unknown>>;
  /** Merge a change into the element's existing extra_json. */
  onPatchExtraJson(
    update: (current: Record<string, unknown>) => Record<string, unknown>,
  ): void;
}>;

export type GeometryProductCatalogueContribution = Readonly<{
  hasAppliedSystemData(extraJson: unknown): boolean;
  /** The picker a product slot's source chip opens; without it the chip only informs. */
  renderProductSlot?(context: GeometryProductSlotContext): ReactNode;
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

export type GeometryInspectorElementFieldsContext = Readonly<{
  /** The one element currently shown in the Details inspector. */
  element: Readonly<Record<string, unknown>>;
  /** Merge a host-owned field into the element's existing extra_json. */
  onPatchExtraJson(
    update: (current: Record<string, unknown>) => Record<string, unknown>,
  ): void;
}>;

export type GeometryInspectorElementFieldsContribution = Readonly<{
  /** Element types for which this host-provided Details field is relevant. */
  elementTypes: readonly string[];
  render: ComponentType<GeometryInspectorElementFieldsContext>;
}>;

export type GeometrySpaceLabelFieldsContext = Readonly<{
  /** The Space Labeller row this field belongs to. */
  label: Readonly<{ id: string; name: string; room_type: string; extra_json?: Record<string, unknown> }>;
  /** Merge a host-owned field into the label's existing extra_json. */
  onPatchExtraJson(
    update: (current: Record<string, unknown>) => Record<string, unknown>,
  ): void;
}>;

export type GeometrySpaceLabelFieldsContribution = Readonly<{
  render: ComponentType<GeometrySpaceLabelFieldsContext>;
}>;

export type GeometryInspectorContributions = Readonly<{
  evidence: GeometryInspectorEvidenceContribution | null;
  detailedJunctionSolver: GeometryDetailedJunctionSolverContribution | null;
  productCatalogue: GeometryProductCatalogueContribution | null;
  constructionDetails: GeometryConstructionDetailsContribution | null;
  elementFields: GeometryInspectorElementFieldsContribution | null;
  spaceLabelFields: GeometrySpaceLabelFieldsContribution | null;
}>;

export function defineGeometryInspectorContributions(
  contributions: Partial<GeometryInspectorContributions>,
): GeometryInspectorContributions {
  return Object.freeze({
    evidence: contributions.evidence ?? null,
    detailedJunctionSolver: contributions.detailedJunctionSolver ?? null,
    productCatalogue: contributions.productCatalogue ?? null,
    constructionDetails: contributions.constructionDetails ?? null,
    elementFields: contributions.elementFields ?? null,
    spaceLabelFields: contributions.spaceLabelFields ?? null,
  });
}

export const emptyGeometryInspectorContributions =
  defineGeometryInspectorContributions({});
