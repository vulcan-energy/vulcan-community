// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// The "adjacent-like" trio — BuildingElementPartyWall,
// BuildingElementAdjacentConditionedSpace, and
// BuildingElementAdjacentUnconditionedSpace_Simple — extracted from
// ElementCreator's five inline structures (slice-6 brief, STAGE 2).
//
// *** FIRST MULTI-KEY ElementFormModule IN THE CODEBASE ***
// Unlike every other extracted family, this ONE module is registered in
// ElementCreator's elementFormInstances under all THREE of the trio's
// elementFormInstances keys, bound to a SINGLE shared state instance (one
// `useFormState` call, one `bindElementFormModule` call, the resulting
// instance object assigned to all three keys — verified that
// `bindElementFormModule` tolerates this: it just closures over the given
// state, so re-registering the same instance under multiple keys is safe;
// there is no per-call side effect to duplicate). This is approved by the
// slice-6 brief (decision 4) precisely because the trio already shared one
// merged `case` in every one of ElementCreator's parallel dispatch
// structures — hydrate (`isAdjacentLikeElement` branch), buildNewElementData,
// renderAttributePanel — so three separate modules would have meant three
// copies of identical code. `ElementFormModule.type` (set to
// 'BuildingElementPartyWall' below) is SELF-DOCUMENTATION ONLY — nothing
// reads it; it exists purely so a human skimming this file's exports can
// tell which type the module was originally modelled on. Dispatch is
// entirely driven by which `elementFormInstances` KEY the orchestrator calls
// through, not by this field.
//
// Moved verbatim from ElementCreator:
// - partyWallCavityResistanceInput / commitPartyWallCavityResistance and
//   adjacentViewerBaseHeightInput / commitAdjacentViewerBaseHeight (the two
//   trio-exclusive useDecimalInput declarations and their commit callbacks).
// - The isAdjacentLikeElement hydrate branch (element-selection hydrate
//   only — the GLOBAL-selection hydrate branch has no adjacent-like case at
//   all; adjacent-like elements are always zone-coordinate ('element')
//   selections, never 'global' objects, so there was nothing to find there.
//   Checked per the brief's item 3).
// - The merged buildNewElementData case (KEEPS the legitimate `pitch`
//   emission — unlike BuildingElementGround's dropped phantom pitch, slice-6
//   brief decision 3/buildingElementGround.tsx, Adjacent-like elements DO
//   have a schema `pitch` field that hydrate reads and renderPanel edits;
//   left untouched per the brief's explicit carve-out).
// - The merged renderAttributePanel case (party-wall lining/cavity UI,
//   PARTY_WALL_LINING_REQUIRED_CAVITY_TYPES, the Pitch/Surface-facing field
//   — now via wallPitchField.tsx's shared renderWallPitchField, this stage's
//   first (plain) caller — and the Base Height / viewer-elevation block).
// - PARTY_WALL_LINING_REQUIRED_CAVITY_TYPES itself (grep-verified zero
//   remaining callers in ElementCreator.tsx outside this case — deleted
//   there, moved here).
// - getElementSubtype: grepped ElementCreator's switch — no case for any of
//   the three adjacent-like types exists, so this module's optional
//   `subtype()` method is simply omitted (matching every other module that
//   has no legacy subtype).
//
// NOT moved (checked, deliberately left in ElementCreator.tsx):
// - ADJACENT_LIKE_ELEMENT_TYPES / isAdjacentLikeElement (the array constant
//   and orchestrator-scope type guard): both still have remaining
//   orchestrator consumers outside the per-family dispatch (e.g. the
//   width/height/area sync effect, the horizontal-pitch-healing effect, the
//   sloped-dimension memos, MultiSelectPanel-adjacent validation) — per the
//   brief's item 5, the constant STAYS in ElementCreator.tsx; Stage 6
//   relocates it once no orchestrator consumers remain. This module
//   duplicates its own small type-guard function below instead (see note at
//   its definition) rather than importing ElementCreator's copy, which would
//   create an orchestrator<->module import cycle — the same reasoning
//   wallShared.tsx's header gives for its own ADJACENT_LIKE_ELEMENT_TYPES
//   duplicate.
// - The "heal invalid horizontal-polygon pitch" useLayoutEffect (normalizes
//   a polygon-shape adjacent-like element's pitch to 0/180 on load) and the
//   width/height/area canvas-sync effect: both are generic effects that run
//   unconditionally every render regardless of which family is currently
//   *displayed* (they inspect whatever element is currently *selected* via
//   `isAdjacentLikeElement`/type checks, independent of `elementType`), and
//   neither is named in the brief's item-3 inventory. Left in place —
//   zero-risk, since they don't reference anything this module now owns.
// - getAdjacentPartyWallUiToggleLabel (imported from ../../stores/
//   geometryStore) / VULCAN_UI_PARTY_ELEMENT_KEY /
//   isVulcanUiPartyFloorElement's OWN checkbox-toggle call site (imported
//   from ../../lib/assemblyMaterialFabric): that "Party floor" checkbox UI
//   lives OUTSIDE renderAttributePanel's per-family switch entirely — it's
//   in ElementCreator's own "Advanced Fields Section" JSX, generic across
//   Opaque/Ground/PartyWall/AdjacentUnconditioned/AdjacentConditioned (same
//   orchestrator-retained-wiring precedent as the "Edit Assembly" badge
//   documented in buildingElementGround.tsx's header). Untouched. This
//   module DOES still import isVulcanUiPartyFloorElement for its own,
//   different, in-scope use (the internal-surface-doubling area note);
//   VULCAN_UI_PARTY_ELEMENT_KEY itself is imported by wallShared.tsx's
//   commitTypedPitch (origin/main PR #31 port — see that file's header).
//
// Shared with the wall family via ctx.shared (same precedent as
// windowShading/contextShading/vents/BuildingElementGround): widthInput,
// heightInput, areaInput, parentElement/setParentElement, pitch/setPitch —
// captured into this module's own returned state during useFormState.
// orientation360/setOrientation360/applyOrientationToGeometry/
// applyParentPitchOrientationForDisplay/baseHeightInput are NOT captured:
// grep-verified the adjacent-like renderPanel case never rendered an
// Orientation field, a ParentElementDropdown, or wallShared.baseHeightInput
// — it uses its own exclusive `_base_height`-backed
// adjacentViewerBaseHeightInput instead (see below). `parentElement` itself
// is written by hydrate (preserved verbatim, even though nothing in this
// module's own renderPanel/buildElementData reads it back — legacy
// behaviour, preserved as found).
//
// getCurrentElementExtraJson: ElementCreator's version reads a shared
// `getCurrentElementData()` closure that has two OTHER call sites outside
// the adjacent-like case (the orientation-field fallback and the advanced
// fields editor's `currentData` prop), so that helper itself stays put.
// grep-verified `getCurrentElementExtraJson` has exactly ONE caller (the
// adjacent-like case) — reimplemented here as a small ctx-driven local
// (renderPanel's `getCurrentElementExtraJson`), same computation, adapted to
// read via `ctx.selection`/`ctx.getElementById` instead of the orchestrator
// closure.
//
// syncFloorMoveHeightInputs (ElementCreator.tsx, generic floor-move sync
// shared with Opaque/Transparent/OnSiteGeneration) needed write access to
// adjacentViewerBaseHeightInput after this move — resolved the same way
// buildingElementGround.tsx's header documents for
// systemFormState.systemSubcategory / wetEmitterFormState.subcategory:
// ElementCreator now reads `adjacentLikeElementFormState.
// adjacentViewerBaseHeightInput` directly (a plain local, like every other
// module's `xFormState`) rather than inventing a new ctx bridge for a
// single write-only call site.

import type { CSSProperties } from 'react';
import {
  decimalInputProps,
  formatConditionalDecimals,
  readExtraJsonRecord,
  useDecimalInput,
  type NumericDraftInputBinding,
} from './formPrimitives';
import { roundToTwoDecimals } from '../../geometry/constants';
import { deriveWallProperties } from '../../stores/geometryStore';
import { getElementGrossArea } from '../../lib/elementArea';
import { isAdjacentConditionedInternalFloorDoubled } from '../../lib/polygonSync';
import { isVulcanUiPartyFloorElement } from '../../lib/assemblyMaterialFabric';
import { ResetFieldButton } from '../ResetFieldButton';
import { StandardDropdown } from '../StandardDropdown';
import { StandardInput } from '../StandardInput';
import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementAdjacentUnconditionedSpace_Simple,
  BuildingElementPartyWall,
  Element,
} from '../../geometry/types';
import { renderWallPitchField } from './wallPitchField';
import type {
  ElementFormModule,
  ElementFormSelection,
  ElementFormStateCtx,
} from './types';

type AdjacentLikeElement =
  | BuildingElementAdjacentConditionedSpace
  | BuildingElementAdjacentUnconditionedSpace_Simple
  | BuildingElementPartyWall;

// Duplicated from ElementCreator.tsx's own (orchestrator-scope, still
// multi-consumer) `isAdjacentLikeElement` — see module header note. Same
// three literal type comparisons, just as a locally-scoped, unexported type
// guard rather than importing across the orchestrator<->module boundary.
function isAdjacentLikeElement(element: Element): element is AdjacentLikeElement {
  return (
    element.type === 'BuildingElementAdjacentConditionedSpace'
    || element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple'
    || element.type === 'BuildingElementPartyWall'
  );
}

// Moved from ElementCreator.tsx (grep-verified its only two callers were
// both inside the adjacent-like renderPanel case).
const PARTY_WALL_LINING_REQUIRED_CAVITY_TYPES = new Set([
  'unfilled_unsealed',
  'unfilled_sealed',
  'filled_sealed',
  'filled_unsealed',
]);

// Duplicated from ElementCreator.tsx — see buildingElementGround.tsx's
// header for why these small pure helpers are duplicated per-module rather
// than imported (other callers left behind in ElementCreator.tsx).
function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Duplicated from ElementCreator.tsx — see note above.
const formatToTwoDecimals = (value: number | string | undefined): string => {
  if (value === undefined || value === null || value === '') return '0.00';
  const num = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
};

// Duplicated from ElementCreator.tsx — see note above.
const INLINE_FIELD_NOTE_STYLE: CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-secondary)',
  lineHeight: 1.35,
  minWidth: 0,
};

export interface AdjacentLikeElementFormState {
  partyWallCavityResistanceInput: NumericDraftInputBinding;
  adjacentViewerBaseHeightInput: NumericDraftInputBinding;
  /** Shared with the wall family — see module header comment. */
  widthInput: NumericDraftInputBinding;
  heightInput: NumericDraftInputBinding;
  areaInput: NumericDraftInputBinding;
  parentElement: string;
  setParentElement: (value: string) => void;
  pitch: number;
  setPitch: (value: number) => void;
  /** Shared with the wall family — see wallShared.tsx's own doc comment
   * (origin/main PR #31 "Let pitch carry decimals" port). */
  pitchDraftInput: NumericDraftInputBinding;
  /** Captured from ElementFormStateCtx so hydrate (which only receives
   * state) can still resolve the global plan-rotation offset for
   * line-shape width derivation — same precedent as OnSiteGeneration's
   * canvas-sync / wallShared.tsx's getGlobalOrientationOffset threading. */
  getGlobalOrientationOffset: () => number;
}

function useFormState(ctx: ElementFormStateCtx): AdjacentLikeElementFormState {
  const isExistingElementSelection = (): boolean =>
    !!ctx.selection && (ctx.selection.type === 'element' || ctx.selection.type === 'global') && !ctx.selection.isPlaceholder;

  const commitAdjacentViewerBaseHeight = (value: number | '') => {
    if (value === '') {
      ctx.commitExistingElementDraft({
        _base_height: undefined,
        base_height: undefined,
      } as Partial<Element>);
      return;
    }
    if (typeof value === 'number') {
      ctx.commitExistingElementDraft({
        _base_height: roundToTwoDecimals(value),
        base_height: undefined,
      } as Partial<Element>);
    }
  };
  const adjacentViewerBaseHeightInput = useDecimalInput(
    '',
    commitAdjacentViewerBaseHeight,
    { commitOnChange: true },
  );

  const commitPartyWallCavityResistance = (value: number | '') => {
    if (!isExistingElementSelection()) return;
    const currentSelection = ctx.selection as ElementFormSelection;
    const el = ctx.getElementById(currentSelection.id);
    if (!el || el.type !== 'BuildingElementPartyWall') return;
    const nextExtra = {
      ...readExtraJsonRecord(el.extra_json),
      party_wall_cavity_type: 'defined_resistance',
    } as Record<string, unknown>;
    if (typeof value === 'number' && Number.isFinite(value)) {
      nextExtra.thermal_resistance_cavity = value;
    } else {
      delete nextExtra.thermal_resistance_cavity;
    }
    ctx.commitExistingElementDraft({ extra_json: nextExtra } as Partial<Element>);
  };
  const partyWallCavityResistanceInput = useDecimalInput(
    '',
    commitPartyWallCavityResistance,
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );

  return {
    partyWallCavityResistanceInput,
    adjacentViewerBaseHeightInput,
    widthInput: ctx.shared.widthInput,
    heightInput: ctx.shared.heightInput,
    areaInput: ctx.shared.areaInput,
    parentElement: ctx.shared.parentElement,
    setParentElement: ctx.shared.setParentElement,
    pitch: ctx.shared.pitch,
    setPitch: ctx.shared.setPitch,
    pitchDraftInput: ctx.shared.pitchDraftInput,
    getGlobalOrientationOffset: ctx.getGlobalOrientationOffset,
  };
}

export const adjacentLikeElementFormModule: ElementFormModule<AdjacentLikeElementFormState> = {
  // Self-documentation only — see module header. Registered under all three
  // of the trio's elementFormInstances keys in ElementCreator.tsx.
  type: 'BuildingElementPartyWall',
  useFormState,

  hydrate(state, element) {
    if (!isAdjacentLikeElement(element)) return;
    // Round numeric values to 2dp when loading from file
    const derivedLineWidth =
      element.coordinates?.length === 2
        ? roundToTwoDecimals(
            deriveWallProperties(
              element,
              state.getGlobalOrientationOffset(),
            ).width,
          )
        : '';
    const width =
      'width' in element && typeof element.width === 'number' && element.width > 0
        ? roundToTwoDecimals(element.width)
        : derivedLineWidth;
    const height = typeof element.height === 'number' ? roundToTwoDecimals(element.height) : (element.height ?? '');
    const area = typeof element.area === 'number' ? roundToTwoDecimals(element.area) : (element.area ?? '');
    // 90° = vertical / wall convention in the model when pitch is unknown (line elements). The store/CSV
    // may still hold 90 for an internal floor polygon until the user sets 0/180 in the surface-facing control.
    const pitch = typeof element.pitch === 'number' ? element.pitch : (element.pitch ?? 90);
    const adjacentExtra = readExtraJsonRecord((element as { extra_json?: unknown }).extra_json);
    state.widthInput.setValue(width);
    state.heightInput.setValue(height);
    state.setParentElement('parent_element' in element ? element.parent_element ?? '' : '');
    state.areaInput.setValue(area);
    state.setPitch(pitch);
    const cavityResistance = readFiniteNumber(adjacentExtra.thermal_resistance_cavity);
    state.partyWallCavityResistanceInput.setValue(
      cavityResistance == null ? '' : formatConditionalDecimals(cavityResistance),
    );
    const adj = element as { _base_height?: number; base_height?: number };
    let viewerPlotM: number | '' = '';
    if (typeof adj._base_height === 'number' && Number.isFinite(adj._base_height)) {
      viewerPlotM = roundToTwoDecimals(adj._base_height);
    } else if (typeof adj.base_height === 'number' && Number.isFinite(adj.base_height)) {
      viewerPlotM = roundToTwoDecimals(adj.base_height);
    }
    state.adjacentViewerBaseHeightInput.setValue(viewerPlotM);
  },

  // Legacy resetFormFields never reset partyWallCavityResistanceInput
  // (only adjacentViewerBaseHeightInput) — preserved verbatim, not fixed
  // speculatively; see ElementCreator.tsx's resetFormFields comment at this
  // module's dispatch site.
  reset(state) {
    state.adjacentViewerBaseHeightInput.setValue('');
  },

  buildElementData(state, ctx) {
    const width = state.widthInput.value;
    const height = state.heightInput.value;
    return {
      ...ctx.baseData,
      width,
      height,
      area: typeof width === 'number' && typeof height === 'number' ? width * height : undefined,
      // Legitimate emission — unlike BuildingElementGround's dropped phantom
      // pitch (slice-6 brief decision 3), Adjacent-like elements DO have a
      // schema `pitch` field; do not touch (brief's explicit carve-out).
      pitch: state.pitch,
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const {
      elementType,
      selection,
      getElementById,
      updateElement,
      commitExistingElementDraft,
      renderFieldLabel,
      renderFieldLabelWithComparisonIndicator,
      registerBaseFieldRefs,
      registerBaseFieldRef,
      fieldUnit,
      comparisonFieldIndicators,
      selectedElement,
      selectedShape,
      derivedBaseHeight,
      derivedPolygonArea,
      liveWidthValue,
      liveHeightValue,
      liveRectArea,
      renderLinearDimensionsFields,
    } = ctx;

    // ElementCreator's getCurrentElementExtraJson has two OTHER call sites
    // outside the adjacent-like case, so it stays orchestrator-owned; this
    // is a small ctx-driven reimplementation with this module's one call
    // site — see module header note.
    const getCurrentElementExtraJson = (): Record<string, unknown> => {
      if (selection?.type !== 'element' && selection?.type !== 'global') return {};
      const current = getElementById(selection.id);
      return readExtraJsonRecord(current && 'extra_json' in current ? current.extra_json : undefined);
    };

    const currentExtra = getCurrentElementExtraJson();
    const partyWallCavityType =
      typeof currentExtra.party_wall_cavity_type === 'string' ? currentExtra.party_wall_cavity_type : '';
    const partyWallLiningType =
      typeof currentExtra.party_wall_lining_type === 'string' ? currentExtra.party_wall_lining_type : '';
    const showPartyWallLining =
      elementType === 'BuildingElementPartyWall' &&
      PARTY_WALL_LINING_REQUIRED_CAVITY_TYPES.has(partyWallCavityType);
    const showPartyWallCavityResistance =
      elementType === 'BuildingElementPartyWall' &&
      partyWallCavityType === 'defined_resistance';

    return (
      <>
        {selectedShape !== 'polygon' && (
          renderLinearDimensionsFields(registerBaseFieldRefs, {
            widthStep: '0.01',
            heightStep: '0.01',
            includeProfileTop: true,
          })
        )}
        {renderFieldLabel('Base Height:', elementType, '_base_height')}
        <div
          className="element-input"
          style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}
          ref={registerBaseFieldRefs('_base_height')}
        >
          <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', width: '100%' }}>
            <StandardInput
              {...decimalInputProps(state.adjacentViewerBaseHeightInput)}
              unit={fieldUnit('_base_height')}
              step="0.01"
              min="0"
              variant="ghost"
              size="md"
              className="flex-1"
              placeholder={derivedBaseHeight > 0 ? String(derivedBaseHeight) : undefined}
            />
            {derivedBaseHeight > 0 &&
              typeof state.adjacentViewerBaseHeightInput.value === 'number' &&
              Math.abs(state.adjacentViewerBaseHeightInput.value - derivedBaseHeight) > 0.01 && (
                <ResetFieldButton
                  onClick={() => {
                    state.adjacentViewerBaseHeightInput.setValue(derivedBaseHeight);
                    commitExistingElementDraft({
                      _base_height: derivedBaseHeight,
                      base_height: undefined,
                    } as Partial<Element>);
                  }}
                  align="inline"
                  title="Use cumulative slab height for this storey (default 3D placement)"
                  ariaLabel="Reset base height to slab"
                  label="Reset"
                />
              )}
          </div>
          <div style={INLINE_FIELD_NOTE_STYLE}>
            Optional. Absolute metres above ground for the 3D view only
          </div>
        </div>
        {(() => {
          const showInternalFloorDoubling =
            selectedShape === 'polygon' &&
            !!selectedElement &&
            isAdjacentConditionedInternalFloorDoubled(selectedElement);
          const shownArea = selectedElement
            ? getElementGrossArea({
                ...selectedElement,
                width: liveWidthValue,
                height: liveHeightValue,
                pitch: state.pitch,
              } as Element)
            : selectedShape === 'polygon'
              ? showInternalFloorDoubling
                ? derivedPolygonArea * 2
                : derivedPolygonArea
              : liveRectArea;
          const showInternalSurfaceDoubling =
            !!selectedElement &&
            selectedElement.type === 'BuildingElementAdjacentConditionedSpace' &&
            (selectedShape === 'line' || selectedShape === 'polygon' || selectedShape === 'sloped-polygon') &&
            !isVulcanUiPartyFloorElement(selectedElement);
          return (
            <>
              {renderFieldLabelWithComparisonIndicator('Area (m²):', elementType, comparisonFieldIndicators.area, 'area')}
              <div
                className="element-input"
                style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}
                ref={registerBaseFieldRef('area')}
              >
                <StandardInput
                  type="text"
                  inputMode="numeric"
                  value={formatToTwoDecimals(shownArea)}
                  unit={fieldUnit('area')}
                  readOnly
                  variant="ghost"
                  size="md"
                />
                {showInternalSurfaceDoubling && (
                  <div style={INLINE_FIELD_NOTE_STYLE}>
                    Doubled to account for both sides of the internal element
                  </div>
                )}
              </div>
            </>
          );
        })()}
        {renderWallPitchField(
          {
            pitch: state.pitch,
            setPitch: state.setPitch,
            pitchDraftInput: state.pitchDraftInput,
            parentElement: state.parentElement,
          },
          ctx,
          {
            disabledWhenParented: false,
            refRegistrar: registerBaseFieldRefs,
          },
        )}
        {elementType === 'BuildingElementPartyWall' && (
          <>
            {renderFieldLabel('Party Wall Cavity Type:', elementType, 'party_wall_cavity_type')}
            <div className="element-input">
              <StandardDropdown
                value={partyWallCavityType}
                onChange={(value) => {
                  if (selection?.type !== 'element') return;
                  const nextExtra: Record<string, unknown> = {
                    ...currentExtra,
                    party_wall_cavity_type: value || undefined,
                  };
                  if (!PARTY_WALL_LINING_REQUIRED_CAVITY_TYPES.has(String(value))) {
                    delete nextExtra.party_wall_lining_type;
                  }
                  if (value !== 'defined_resistance') {
                    delete nextExtra.thermal_resistance_cavity;
                    state.partyWallCavityResistanceInput.setValue('');
                  }
                  updateElement(selection.id, { extra_json: nextExtra } as Partial<Element>);
                }}
                options={[
                  { value: 'solid', label: 'Solid' },
                  { value: 'unfilled_unsealed', label: 'Unfilled, unsealed' },
                  { value: 'unfilled_sealed', label: 'Unfilled, sealed' },
                  { value: 'filled_sealed', label: 'Filled, sealed' },
                  { value: 'filled_unsealed', label: 'Filled, unsealed' },
                  { value: 'defined_resistance', label: 'Defined resistance' },
                ]}
                placeholder="Select cavity type..."
                variant="ghost"
                size="md"
              />
            </div>
            {showPartyWallLining && (
              <>
                {renderFieldLabel('Party Wall Lining Type:', elementType, 'party_wall_lining_type')}
                <div className="element-input">
                  <StandardDropdown
                    value={partyWallLiningType}
                    onChange={(value) => {
                      if (selection?.type !== 'element') return;
                      updateElement(selection.id, {
                        extra_json: {
                          ...currentExtra,
                          party_wall_cavity_type: partyWallCavityType || undefined,
                          party_wall_lining_type: value || undefined,
                        },
                      } as Partial<Element>);
                    }}
                    options={[
                      { value: 'wet_plaster', label: 'Wet plaster' },
                      { value: 'dry_lined', label: 'Dry lined' },
                    ]}
                    placeholder="Select lining type..."
                    variant="ghost"
                    size="md"
                  />
                </div>
              </>
            )}
            {showPartyWallCavityResistance && (
              <>
                {renderFieldLabel('Cavity Resistance (m²K/W):', elementType, 'thermal_resistance_cavity')}
                <div className="element-input">
                  <StandardInput
                    {...decimalInputProps(state.partyWallCavityResistanceInput)}
                    unit={fieldUnit('thermal_resistance_cavity')}
                    step="0.01"
                    min="0"
                    variant="ghost"
                    size="md"
                  />
                </div>
              </>
            )}
          </>
        )}
      </>
    );
  },
};
