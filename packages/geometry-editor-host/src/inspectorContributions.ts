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

export type GeometryProductCandidate = Readonly<{
  id: number;
  label: string;
  technology_type: string;
  radiator_type?: string;
  height?: string;
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
  /** What the slot falls back to when the element's own pick is removed. */
  default_source?: 'single_product' | 'model_setting' | null;
  /** Every product the slot accepts; radiators carry their type and height. */
  candidates: readonly GeometryProductCandidate[];
  /** Name of the Geometry CSV row the system comes from. */
  row?: string;
  /** Model path of that row's own object; `path` is below it. */
  row_path?: string;
}>;

/** Plain words for the HEM Database technology types, for chips and pickers. */
const PRODUCT_TECHNOLOGY_LABELS: Readonly<Record<string, string>> = {
  'Air Powered Showers': 'Air-powered shower',
  'Air Source Heat Pump': 'Air source heat pump',
  'Booster Heat Pump': 'Booster heat pump',
  'Centralised MEV': 'Centralised MEV',
  'Centralised MV': 'Centralised MV',
  'Centralised MVHR': 'Centralised MVHR',
  'Column Radiator': 'Column radiator',
  'Combi Boiler': 'Combi boiler',
  'Convector Radiator': 'Convector radiator',
  'Cooker boiler': 'Cooker boiler',
  'Decentralised MEV': 'Decentralised MEV',
  'Direct Electric': 'Direct electric heater',
  'Electric Battery': 'Electric battery',
  'Electric Boiler': 'Electric boiler',
  'Exhaust Air MEV Heat Pump': 'Exhaust air heat pump (MEV)',
  'Exhaust Air MVHR Heat Pump': 'Exhaust air heat pump (MVHR)',
  'Exhaust Air Mixed Heat Pump': 'Exhaust air heat pump (mixed)',
  'Fan Coils': 'Fan coil',
  'Flue Gas Heat Recovery System': 'Flue gas heat recovery',
  'Ground Source Heat Pump': 'Ground source heat pump',
  'Heat Battery DryCore': 'Dry-core heat battery',
  'Heat Battery PCM': 'PCM heat battery',
  'Heat Interface Unit': 'Heat interface unit',
  'Heat Network': 'Heat network',
  'Hot Water Only Heat Pump': 'Hot-water-only heat pump',
  'Hybrid Heat Pump': 'Hybrid heat pump',
  'Instantaneous WWHRS': 'Instantaneous WWHRS',
  'Primary Thermal Store': 'Primary thermal store',
  'Regular Boiler': 'Regular boiler',
  'Room Heater': 'Room heater',
  'Smart Hot Water Tank': 'Smart hot water tank',
  'Solar Thermal': 'Solar thermal collector',
  'Solid Fuel Boiler': 'Solid fuel boiler',
  'Storage Heaters': 'Storage heater',
  UnderfloorHeating: 'Underfloor heating',
  'Warm Air Heaters': 'Warm air heater',
  'Water Source Heat Pump': 'Water source heat pump',
};

/** A technology type in plain words; a type this table lacks shows as the data names it. */
export const productTechnologyLabel = (type: string): string => PRODUCT_TECHNOLOGY_LABELS[type] ?? type;

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

/**
 * Host fields shown on a glazed element directly under Max Window Open Area. A field marks
 * its row with `data-host-field-key` so validation rows can focus it.
 */
export type GeometryInspectorOpeningFieldsContribution = Readonly<{
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
  openingFields: GeometryInspectorOpeningFieldsContribution | null;
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
    openingFields: contributions.openingFields ?? null,
    spaceLabelFields: contributions.spaceLabelFields ?? null,
  });
}

export const emptyGeometryInspectorContributions =
  defineGeometryInspectorContributions({});
