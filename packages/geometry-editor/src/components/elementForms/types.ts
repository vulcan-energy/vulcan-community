// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Contract for per-element-family form modules extracted from ElementCreator.
// A module owns one family's slice of the five parallel structures the
// orchestrator used to carry inline: state declarations, hydrate-on-select,
// reset, build-new-element payload, and the attribute-panel fields. The
// orchestrator calls every module's useFormState unconditionally on each
// render (hook-rule requirement — matching the old always-declared state) and
// dispatches the other operations through its registry by element type.

import type { ReactNode } from 'react';
import type { Element, ElementType } from '../../stores/geometryStore';

export interface ElementFormStateCtx {
  commitElementNumericField: (field: string) => (value: number | '') => void;
}

export interface ElementFormBuildCtx {
  baseData: Record<string, unknown>;
  elementZoneId: string;
}

export interface ElementFormRenderCtx {
  elementType: ElementType;
  fieldUnit: (fieldKey: string) => string | undefined;
  renderFieldLabel: (fieldLabel: string, targetElementType?: string, evidenceFieldKey?: string) => ReactNode;
  renderFieldLabelWithComparisonIndicator: (
    label: string,
    elementType: string,
    indicatorMessages?: readonly string[],
    evidenceFieldKey?: string,
  ) => ReactNode;
  registerBaseFieldRefs: (fieldKeys: string | string[]) => (node: HTMLDivElement | null) => void;
  getFieldValidationIssue: (fieldName: string, value: unknown) => string | null;
  globalComparisonFieldIndicators: Record<string, readonly string[]>;
  commitExistingElementDraft: (overrides?: Partial<Element>) => void;
}

export interface ElementFormModule<S> {
  type: ElementType;
  /** Hook: must be called unconditionally by the orchestrator every render. */
  useFormState(ctx: ElementFormStateCtx): S;
  /** Populate form state from a selected element. One path for element and
   * global selections — extract separate paths only if the legacy branches
   * genuinely differed for this family. */
  hydrate(state: S, element: Element): void;
  /** This family's share of the legacy resetFormFields. */
  reset(state: S): void;
  /** This family's case of buildNewElementData. */
  buildElementData(state: S, ctx: ElementFormBuildCtx): Partial<Element>;
  /** This family's case of renderAttributePanel. */
  renderPanel(state: S, ctx: ElementFormRenderCtx): ReactNode;
  /** This family's case of getElementSubtype, when it has one. */
  subtype?(state: S): string;
}

/** A module bound to its live state for uniform dispatch by the orchestrator. */
export interface ElementFormInstance {
  hydrate(element: Element): void;
  reset(): void;
  buildElementData(ctx: ElementFormBuildCtx): Partial<Element>;
  renderPanel(ctx: ElementFormRenderCtx): ReactNode;
  subtype(): string | undefined;
}

export function bindElementFormModule<S>(
  module: ElementFormModule<S>,
  state: S,
): ElementFormInstance {
  return {
    hydrate: (element) => module.hydrate(state, element),
    reset: () => module.reset(state),
    buildElementData: (ctx) => module.buildElementData(state, ctx),
    renderPanel: (ctx) => module.renderPanel(state, ctx),
    subtype: () => module.subtype?.(state),
  };
}
