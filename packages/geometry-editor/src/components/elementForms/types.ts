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
import type { NumericDraftInputBinding } from './formPrimitives';

/** Mirrors the orchestrator's locally-defined `Selection` type structurally
 * (that type isn't exported, so modules use this shape instead). */
export interface ElementFormSelection {
  type: 'zone' | 'element' | 'global' | 'dormer';
  id: string;
  isPlaceholder?: boolean;
  focusFieldKey?: string;
}

/** OnSiteGeneration's soft host-roof link: derived pitch/orientation360/
 * base_height from the roof a panel sits on, computed by the orchestrator
 * (it needs the full elementsById + floors graph, not just this module's
 * state) and passed straight through for the "From <roof>" hint + Reset. */
export interface OnSiteHostDerivation {
  hostId: string;
  hostName: string;
  derived: { base_height?: number; pitch?: number; orientation360?: number };
}

/** Bindings onto orchestrator state the wall family (BuildingElementOpaque/
 * Transparent/Ground/PartyWall/Adjacent) still owns directly — it is not extracted
 * into a module yet. WindowShading, ContextShading, and Vents share pieces of this
 * state with the wall family and MUST read/write it only through these bindings;
 * the orchestrator remains the sole owner of the underlying state. Captured once by
 * a module's useFormState (which does receive ctx) and carried in its returned
 * state so hydrate/reset/buildElementData/renderPanel (which mostly don't) can
 * still reach it — the same passthrough precedent as OnSiteGeneration's
 * getCurrentOrientation. */
export interface ElementFormSharedCtx {
  /** WindowShading/ContextShading's editable height field. */
  heightInput: NumericDraftInputBinding;
  /** WindowShading's editable distance field; ContextShading's read-only computed
   * distance display. */
  distanceInput: NumericDraftInputBinding;
  parentElement: string;
  setParentElement: (value: string) => void;
  pitch: number;
  setPitch: (value: number) => void;
  orientation360: number;
  setOrientation360: (value: number) => void;
  /** Commits an edited orientation360, rotating sloped polygons/2-point lines in
   * plan — the same wall-family geometry logic used by Vents' own copy of the
   * pitch/orientation editing UI; stays orchestrator-owned since walls use it too. */
  applyOrientationToGeometry: (desiredOrientationDeg: number) => void;
  /** Vents' optimistic DISPLAY write when a parent wall/window is chosen: mirrors
   * the parent's pitch/orientation360 into the shared inputs so the panel shows the
   * inherited values immediately, without Vents reading or owning the shared pitch
   * state directly. Implemented in the orchestrator as the existing
   * setPitch/setOrientation360 calls. */
  applyParentPitchOrientationForDisplay: (pitch: number | undefined, orientation: number | undefined) => void;
}

export interface ElementFormStateCtx {
  commitElementNumericField: (field: string) => (value: number | '') => void;
  /** Needed by modules (e.g. Lighting's powerInput) whose numeric-input commit
   * callback writes more than a single field and must go through the generic
   * existing-element draft committer instead of commitElementNumericField. */
  commitExistingElementDraft: (overrides?: Partial<Element>) => void;
  /** Appliance's valid-keys list, sourced from the schema port + FHS/core
   * mode — orchestrator-wide concerns this module doesn't own. */
  applianceKeyOptions: readonly string[];
  /** Needed by OnSiteGeneration's commit/sync helpers, which read the
   * currently selected element directly (legacy behaviour). */
  selection: ElementFormSelection | null;
  getElementById: (id: string) => Element | undefined;
  updateElement: (id: string, updates: Partial<Element>, skipAutoSave?: boolean) => void;
  /** OnSiteGeneration's sloped-panel orientation commit needs the current
   * global plan-rotation offset to rotate coordinates in place. */
  getGlobalOrientationOffset: () => number;
  /** OnSiteGeneration's canvas-sync effect needs the shared orientation
   * calculation (walls, roofs, and panels all recompute it the same way);
   * it stays orchestrator-owned since other, non-extracted cases use it too. */
  getCurrentOrientation: (element: Element) => number;
  /** Version counter bumped when the selected element's coordinates change on
   * canvas — drives OnSiteGeneration's re-sync effect. */
  selectedElementV: number;
  /** Wall-family bindings shared with WindowShading/ContextShading/Vents — see
   * ElementFormSharedCtx. */
  shared: ElementFormSharedCtx;
  /** Full element index, needed by WindowShading/ContextShading/Vents' parent-
   * and window-by-name lookups — the same `elementIds.map(id => elementsById[id])`
   * pattern used throughout the orchestrator. */
  elementIds: readonly string[];
  elementsById: Record<string, Element>;
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
  /** Singular variant used verbatim by OnSiteGeneration's legacy render code
   * — unlike registerBaseFieldRefs, it does not also register a camelCase key. */
  registerBaseFieldRef: (fieldKey: string) => (node: HTMLDivElement | null) => void;
  getFieldValidationIssue: (fieldName: string, value: unknown) => string | null;
  globalComparisonFieldIndicators: Record<string, readonly string[]>;
  commitExistingElementDraft: (overrides?: Partial<Element>) => void;
  /** Needed by Lighting's guided-mode helpers and OnSiteGeneration's
   * footprint/orientation helpers, which read the currently selected element
   * directly (legacy behaviour, not routed through state). */
  selection: ElementFormSelection | null;
  getElementById: (id: string) => Element | undefined;
  updateElement: (id: string, updates: Partial<Element>, skipAutoSave?: boolean) => void;
  getGlobalOrientationOffset: () => number;
  onSiteHostDerivation: OnSiteHostDerivation | null;
  selectedPvDimensionNotes: { width: string; height: string } | null;
  /** Selected element's zone, needed by WindowShading's linked-window dropdown to
   * only list windows from the same zone. */
  elementZoneId: string;
  /** Full element index — see ElementFormStateCtx.elementIds/elementsById. */
  elementIds: readonly string[];
  elementsById: Record<string, Element>;
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
  /** This family's case of getElementSubtype, when it has one. Several legacy
   * cases return `x || undefined` rather than a bare string, so this must
   * allow undefined too. */
  subtype?(state: S): string | undefined;
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
