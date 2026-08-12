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
import type { BuildingElementTransparent, Element, ElementType } from '../../geometry/types';
import type { CanvasShape } from '../../lib/shapeUtils';
import type { SlopedElementDimensions } from '../../lib/slopedElementDimensions';
import type { TransparentOpeningDerivedValues } from '../../lib/transparentOpeningDerivedFields';
import type { UnheatedPitchedRoofCeilingElevation } from '../../lib/unheatedPitchedRoofCeiling';
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
  /** WindowShading/ContextShading's editable height field; also
   * BuildingElementGround's hydrate/buildElementData (elementForms/
   * buildingElementGround.tsx) — Ground never renders it, but preserves the
   * legacy hydrate write for byte-identical behaviour. */
  heightInput: NumericDraftInputBinding;
  /** WindowShading's editable distance field; ContextShading's read-only computed
   * distance display. */
  distanceInput: NumericDraftInputBinding;
  /** The unextracted wall family's (Opaque/Transparent/adjacent) width field;
   * also BuildingElementGround's (elementForms/buildingElementGround.tsx) —
   * Ground is the first ctx.shared consumer to need this one (the five
   * earlier consumers never did). */
  widthInput: NumericDraftInputBinding;
  /** The unextracted wall family's (Opaque/Transparent/Ground/adjacent) area
   * field; also WetEmitter's UFH-only area field (elementForms/wetEmitter.tsx),
   * read/written ONLY via ctx.shared — same precedent as heightInput/
   * distanceInput above. */
  areaInput: NumericDraftInputBinding;
  /** The wall family's (Opaque/Transparent) Base Height (m) schema field —
   * Transparent's first ctx.shared consumer (elementForms/
   * buildingElementTransparent.tsx, slice-6 brief STAGE 3). Distinct from
   * Adjacent-like's own exclusive `_base_height`-backed
   * adjacentViewerBaseHeightInput (see adjacentLikeElement.tsx's header) and
   * from Ground, which has no schema base_height field at all. */
  baseHeightInput: NumericDraftInputBinding;
  parentElement: string;
  setParentElement: (value: string) => void;
  pitch: number;
  setPitch: (value: number) => void;
  /** Draft-string commit for the typed pitch input (origin/main PR #31 "Let pitch carry
   * decimals") — one shared instance owned by wallShared.tsx, bridged the same way as
   * `pitch`/`setPitch` above so wallPitchField.tsx's renderWallPitchField (and any future
   * consumer) can read it via ctx.shared without each wall-family module standing up its
   * own useNumericDraftInput call (which would violate Rules of Hooks: only one of
   * Opaque/Transparent/Adjacent-like's build()/renderPanel() runs per render). */
  pitchDraftInput: NumericDraftInputBinding;
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
  setSlopePitchAxis: (id: string, axis: 'bottom-edge' | 'orientation') => void;
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
  /** Derived base_height from the selected floor's Z-level and cumulative
   * storey heights below (effective storey heights bake in wall-derived
   * heights + user overrides) — orchestrator-owned because it closes over
   * elementFloorId/floors/allElements, none of which a module holds.
   * Transparent's hydrate-time auto-sync effect (elementForms/
   * buildingElementTransparent.tsx, slice-6 brief STAGE 3) uses it as the
   * base_height fallback for deriving the window's mid-height when no
   * explicit base_height is set — same underlying local already exposed at
   * render time via ElementFormRenderCtx.derivedBaseHeight below (stage 2),
   * now also needed at hook time. Transparent-only consumer as of this
   * stage. */
  derivedBaseHeight: number;
  /** Transparent's hydrate needs the derived opening mid-height/max-open-
   * area (computed from the full floors + elements graph via
   * geometryStore.getState(), not the reactive per-render locals — same
   * hydrate-time-freshness reasoning as legacy) to seed the refs its own
   * render-time auto-sync effect guards against clobbering manual overrides
   * with. Orchestrator-owned because it needs that full graph, same
   * "computed orchestrator-side, threaded as a callback" precedent as
   * getGlobalOrientationOffset/getCurrentOrientation above. Transparent-only
   * consumer. */
  getTransparentOpeningDerivedValues: (element: BuildingElementTransparent) => TransparentOpeningDerivedValues;
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
  /** Generic "change the current selection" capability — BuildingElementGround's
   * panel (elementForms/buildingElementGround.tsx) uses it so clicking a source
   * wall's name in the "From assemblies" thickness breakdown jumps selection to
   * it. Not assembly-calculator-specific; any module may use it to navigate. */
  setSelection: (selection: ElementFormSelection) => void;
  getGlobalOrientationOffset: () => number;
  /** Orchestrator-wide "Elevation above model ground" field (every family's
   * generic elevation control, see elementSupportsGenericElevationControl).
   * BuildingElementGround's panel clears its draft value when a newly-picked
   * floor type no longer supports a viewer elevation — same legacy behaviour,
   * write-only use. */
  elementElevationInput: NumericDraftInputBinding;
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
  /** Wall-family generic derived render values — computed once per render
   * from the current selection/coordinates and shared by Opaque/Transparent
   * (still inline) and Adjacent-like (elementForms/adjacentLikeElement.tsx,
   * slice-6 brief STAGE 2 — its first consumer). Read-only, render-time-only
   * values, so they live here rather than on ElementFormStateCtx.shared
   * (which is for state multiple modules read AND write). */
  selectedElement: Element | null;
  selectedShape: CanvasShape | null;
  /** Derived from the selected floor + cumulative storey heights below —
   * also read by Opaque's (still inline) base-height reset-target helper. */
  derivedBaseHeight: number;
  derivedPolygonArea: number;
  liveWidthValue: number;
  liveHeightValue: number;
  liveRectArea: number;
  /** Surface-facing dropdown's pitch value for horizontal (0deg/180deg)
   * polygons — reads from the STORE element when possible (they can diverge
   * from local pitch state), not just `pitch`, so re-picking 0deg isn't a
   * no-op. See the orchestrator's own comment at its definition. */
  horizontalPolygonControlPitch: number;
  /** Opaque/Transparent's (still inline) and Adjacent-like's shared Width +
   * Height input pair (with sloped-shape "Use shape calculated" resets and
   * validation). Orchestrator-owned because it closes over several
   * not-yet-extracted locals (getFieldValidationState,
   * selectedSlopedDimensions, profileTopControl, etc.) — same render-bridge
   * precedent as renderMvhrDuctAndTerminalManager above. */
  renderLinearDimensionsFields: (
    fieldRef: (fieldKey: string) => (node: HTMLDivElement | null) => void,
    options: { widthStep: string; heightStep: string; includeProfileTop?: boolean },
  ) => ReactNode;
  /** Sloped-polygon rectangle dimensions derived from the selected element's
   * coordinates + pitch (null when not a sloped-polygon or dimensions can't
   * be derived) — generic wall-family value, joining the group above in
   * slice-6 brief STAGE 3. NOT Transparent-exclusive (Opaque's not-yet-
   * extracted "Use shape-calculated sloped width/height" reset buttons read
   * the same orchestrator local), but Transparent's sloped-opening
   * rebuild-opening button (elementForms/buildingElementTransparent.tsx) is
   * its first extracted-module consumer — same "generic value, first module
   * consumer" precedent derivedBaseHeight itself set in stage 2. */
  selectedSlopedDimensions: SlopedElementDimensions | null;
  /** Sets the shared parentElement/pitch/orientation360 from a chosen host
   * element by name, then patches the selected element's own coordinates/
   * pitch/orientation to match (BuildingHostedLinearParentPatch). Used by
   * Opaque's dormer host-roof picker (still inline) and Transparent's
   * "Linked Wall" picker (elementForms/buildingElementTransparent.tsx,
   * slice-6 brief STAGE 3) — orchestrator-owned because it closes over
   * elementIds/elementsById/geometryStore/selection, none of which a module
   * holds; same renderLinearDimensionsFields-style render-bridge precedent
   * above. */
  applyHostedParentElement: (value: string, emptyParentValue: string | null) => void;
  /** Orchestrator-owned dormer bundle machinery (slice-6 brief decision 2):
   * renders Opaque's dormer-anchor editing fields (host roof, dormer shape/
   * dimensions, roof pitches, window parameters). Dormers write across the
   * Opaque anchor AND its Transparent siblings (regenerateDormerAnchor + the
   * per-sibling regeneration loop) — no single module may own that, so this
   * stays a zero-arg callback closing over the dormer draft inputs/
   * commitDormerAnchorChanges/etc., same renderMvhrDuctAndTerminalManager /
   * renderSpaceHeatSystemPicker precedent. Invoked from Opaque's module
   * (elementForms/buildingElementOpaque.tsx, slice-6 brief STAGE 4) when
   * `isDormerAnchorElement(selectedElement)` is true — see that module's
   * header for how the dormer-anchor check itself reaches the module
   * (reusing selectedElement above, not a new boolean field). Stage 5
   * (dormer bundle proper) still owns everything this callback closes over. */
  renderDormerBundleEditor: () => ReactNode;
  /** Opaque's "Flip 180°" wall-orientation action (elementForms/
   * buildingElementOpaque.tsx, slice-6 brief STAGE 4) — a dedicated
   * geometry-aware store action (rotates coordinates, not a plain field
   * patch), so it can't be reconstructed from the generic `updateElement`
   * patcher above. Opaque-only consumer as of this stage. */
  flipElementOrientation: (elementId: string) => void;
  /** Opaque's "Ceiling / heat-loss boundary elevation" suggestion
   * (elementForms/buildingElementOpaque.tsx, slice-6 brief STAGE 4) —
   * orchestrator-computed because it needs the full floors + elements graph
   * (via withEffectiveStoreyHeights), which no module holds — same
   * "computed orchestrator-side, threaded as a plain render-time value"
   * precedent as onSiteHostDerivation/selectedPvDimensionNotes above (not a
   * callback: already fully resolved for the current selection by render
   * time). Opaque-only consumer. */
  unheatedPitchedRoofCeilingElevationSuggestion: UnheatedPitchedRoofCeilingElevation | null;
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
