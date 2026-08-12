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
import type {
  GeometryDetailedJunctionSolverContribution,
  GeometryProductCatalogueContribution,
  GeometryWorkspaceResourcePort,
} from '../../../../geometry-editor-host/src';
import type { Element, ElementType } from '../../geometry/types';
import type { NumericDraftInputBinding } from './formPrimitives';
import type { ServiceLineFormGroup } from './serviceLine';

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
  /** The unextracted wall family's (Opaque/Transparent/Ground/adjacent) area
   * field; also WetEmitter's UFH-only area field (elementForms/wetEmitter.tsx),
   * read/written ONLY via ctx.shared — same precedent as heightInput/
   * distanceInput above. */
  areaInput: NumericDraftInputBinding;
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
  /** WetEmitter's selected SpaceHeatSystem name (elementForms/wetEmitter.tsx) —
   * NOT a wall-family field, but bridged here for the same structural reason:
   * ElementFormRenderCtx.renderSpaceHeatSystemPicker (the orchestrator-owned
   * System<->WetEmitter bridge, slice-5 brief decision (f).1) is a zero-arg
   * callback that both displays and writes this value from handlers defined
   * earlier in ElementCreator's render than WetEmitter's module state would
   * exist, so it cannot receive that state as a call-time argument. Keeping
   * spaceHeatSystem as orchestrator state bridged through ctx.shared — same
   * shape as parentElement/pitch/orientation360 above — resolves the seam
   * without changing the picker callback's locked `() => ReactNode` contract.
   * See elementForms/wetEmitter.tsx's header for the full writeup. */
  spaceHeatSystem: string;
  setSpaceHeatSystem: (value: string) => void;
}

export interface ElementFormStateCtx {
  /** The orchestrator's current "active family" UI state (the still-inline
   * ElementTypePicker/hydrate-effect-driven `elementType` local state) — added
   * for System's module (slice-5 stage 3): several of System's moved pieces
   * (systemPresetDirectory's useKeyedState key, selectedSystemElement(+Full),
   * systemSwitchNeedsWarning/requestSystemUiMode's isSystemElementType check)
   * must gate on "is System currently the displayed family", which is this
   * flag, not derivable from selection alone (selection can point at a System
   * element while the user has manually retyped the *displayed* family via
   * ElementTypePicker without an intervening selection change — a real,
   * legacy-preserved edge case). No other extracted module has needed this;
   * System-only consumer. */
  elementType: ElementType;
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
  /** Service-line trio shared form group (TBL/MVD/WP) — single instance created by
   * the orchestrator via useServiceLineFormState; the orchestrator also reads `mode`
   * for the shared shape picker, which is why it is not module-owned. */
  serviceLine: ServiceLineFormGroup;
  /** System's preset IO (readText/list of input/batch_parameters/{dir}/*.json) —
   * the same host-provided port ElementCreator receives as a prop, threaded
   * through so System's module can read/write presets without the
   * orchestrator's `workspaceResourcePort` prop leaking into the generic ctx
   * by any other name. */
  workspaceResourcePort: GeometryWorkspaceResourcePort;
  /** System's `applySystemPresetChange` needs the selected element's zone
   * NAME (not just its id) to seed a preset's `Zone` field — the same
   * orchestrator helper reused verbatim on ElementFormBuildCtx below for
   * buildElementData's equivalent need, rather than exposing the raw
   * zones/getZoneById store surface generically. System-only consumer. */
  getZoneNameForElementZoneId: (zoneId: unknown) => string | null;
}

export interface ElementFormBuildCtx {
  baseData: Record<string, unknown>;
  elementZoneId: string;
  /** System's buildElementData syncs the SpaceHeatSystem zone name into
   * extra_json on save — see ElementFormStateCtx's field of the same name
   * (same underlying orchestrator closure, exposed on both narrow ctx shapes
   * since buildElementData only receives this one). Optional because System
   * is its only consumer; every other family's buildNewElementData call site
   * omits it. */
  getZoneNameForElementZoneId?: (zoneId: unknown) => string | null;
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
  /** Element/global-scoped source-comparison indicators for the CURRENT
   * selection, from `sourceComparisonPort.elementInfo(selection.id)`. Same
   * name as the orchestrator's own local (verbatim-greppability bias) —
   * distinguish by scope, not name: this is per-selection, while
   * globalComparisonFieldIndicators below is workspace-wide. Read by
   * MechanicalVentilation's Ventilation Type field and by several
   * not-yet-extracted wall-family fields (e.g. Area). */
  comparisonFieldIndicators: Record<string, readonly string[]>;
  /** Workspace-wide source-comparison indicators, from
   * `sourceComparisonPort.globalInfo()` — unlike comparisonFieldIndicators
   * above, not scoped to the current selection. */
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
  /** ThermalBridgeLinear's detailed-junction integration. The Control is a host
   * inspector contribution (an ElementCreator prop) and the readiness action drives
   * orchestrator-owned selection/assembly-calculator state, so both stay
   * orchestrator-provided. */
  thermalBridgeJunction: {
    DetailedJunctionControl: GeometryDetailedJunctionSolverContribution['Control'] | undefined;
    onHostReadinessAction: (action: { elementId: string; kind: 'assembly_calculator' | 'open_host_element' }) => void;
  };
  /** Orchestrator-owned MVHR duct/terminal manager: creates Ductwork/Terminal
   * elements and reads store-level state (selectedMvhrUnit, addElement,
   * geometryStore.getState(), generateUniqueElementName, draw-mode props) with
   * no dependency on MechanicalVentilation's own module state, so it stays in
   * ElementCreator and is injected as a callback. Invoked from
   * MechanicalVentilation's panel when the selected unit is an MVHR. */
  renderMvhrDuctAndTerminalManager: () => ReactNode;
  /** The host's product-catalogue contribution (inspectorContributions.
   * productCatalogue) — System's Sample/PCDB source toggle and PCDB apply flow.
   * Same host-contribution precedent as thermalBridgeJunction above;
   * System-only consumer (not-yet-extracted module), nullable because the host
   * may not provide one. */
  productCatalogue: GeometryProductCatalogueContribution | null;
  /** Orchestrator-owned System<->WetEmitter cross-creation bridge (slice-5
   * brief decision (f).1, CONSERVATIVE option): renders WetEmitter's
   * space-heat-system dropdown, including the "Create new SpaceHeatSystem..."
   * option and the edit-jump link to the selected System element. The six
   * underlying handlers stay in ElementCreator (they read/write allElements,
   * addElement, setSelection/setSelectedElementIds — none of which the generic
   * ctx exposes, matching the renderMvhrDuctAndTerminalManager precedent
   * above). Store-level cross-creation consolidation is explicitly out of
   * scope for this slice. Invoked from WetEmitter's panel. */
  renderSpaceHeatSystemPicker: () => ReactNode;
  /** Orchestrator-owned System<->WetEmitter cross-creation bridge, the System
   * side: renders the linked-emitters dropdown (SpaceHeatSystemEmitterDropdown)
   * and its "Create Radiator" action for a selected wet-distribution
   * SpaceHeatSystem. Same decision/precedent as renderSpaceHeatSystemPicker
   * above. Invoked from System's (not-yet-extracted) panel. */
  renderSpaceHeatSystemEmitterManager: () => ReactNode;
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
