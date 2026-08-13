// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// BuildingElementTransparent (windows/rooflights) — extracted from
// ElementCreator's five inline structures (slice-6 brief, STAGE 3).
//
// DECISION 6 VERDICT (registerBaseFieldRef singular vs registerBaseFieldRefs
// plural — see wallPitchField.tsx's WallPitchFieldOptions.refRegistrar):
// PRESERVED AS SINGULAR, byte-for-byte, with evidence. registerBaseFieldRefs
// (ElementCreator.tsx) registers a field under BOTH its literal key and
// `toCamelCase(key)` (replacing `_x` with uppercase `X`); registerBaseFieldRef
// registers only the literal key. For the 'pitch' field specifically,
// `toCamelCase('pitch') === 'pitch'` — no underscore, so the "extra" alias
// the plural form adds is the SAME string as the literal key, already a
// no-op duplicate. The one consumer that reads baseFieldNodes by a
// possibly-different-cased key, `focusFieldKey` (ElementCreator.tsx, the
// selection.focusFieldKey effect that scrolls/focuses a field from a
// validation or evidence link), only falls back to `toCamelCase(fieldKey)`
// when the literal key ISN'T already registered — which, per the above, is
// never the gap for 'pitch': `baseFieldNodes.has('pitch')` is true under
// EITHER registration form. There is no demonstrated functionality this
// module's singular registration drops for its pitch field, so it stays
// exactly as legacy had it: `refRegistrar: ctx.registerBaseFieldRef`.
// (Note for future reference, out of this stage's scope: Transparent's OTHER
// fields also register singular throughout its whole legacy panel —
// 'width'/'height' via renderLinearDimensionsFields, 'area', 'freeAreaHeight',
// 'midHeight', 'maxWindowOpenArea', 'frame_area_fraction', 'orientation360',
// 'base_height' — preserved verbatim below for all of them too, since this
// stage's brief scoped the investigation to the pitch field specifically
// (the one wallPitchField.tsx unifies). Unlike 'pitch', 'frame_area_fraction'
// and 'base_height' DO have non-trivial camelCase aliases
// ('frameAreaFraction'/'baseHeight') — if this singular/plural pattern is
// ever audited codebase-wide, those two would be the ones worth checking,
// not 'pitch'.)
//
// Moved verbatim from ElementCreator:
// - freeAreaHeightInput/midHeightInput/maxWindowOpenAreaInput (the three
//   useDecimalInput declarations, each committing through
//   ctx.commitElementNumericField) and their SetValueRef pair
//   (midHeightInputSetValueRef/maxWindowOpenAreaInputSetValueRef + the small
//   ref-updater effect) — same "split the combined effect" precedent
//   wallShared.tsx's header describes (that combined effect covered
//   width/height/area too; this module owns only its own two-input slice of
//   it now).
// - freeAreaFractionInput/commitTransparentFrameAreaFraction — the window's
//   Frame Area Fraction field. Legacy wired its hydrate-time write through
//   `lateNumericInputSettersRef.current.freeAreaFraction`, a late-setter
//   indirection that existed ONLY because freeAreaFractionInput was declared
//   (line ~3824 of the old monolith) far AFTER the hydrate effect (line
//   ~2833) that needed to call its setter. That ordering problem doesn't
//   exist inside a single useFormState call, so this module calls
//   state.freeAreaFractionInput.setValue directly in its own hydrate(); the
//   `freeAreaFraction` key is REMOVED from ElementCreator's
//   lateNumericInputSettersRef (grep-verified zero remaining callers — see
//   ElementCreator.tsx's diff). That ref still serves 8 dormer-exclusive
//   slots (decision 2, orchestrator-retained), so the ref itself stays.
// - derivedWindowMidHeight/derivedWindowMaxOpenArea (the two useMemo
//   calculations) and the auto-sync useEffect that writes them into
//   midHeightInput/maxWindowOpenAreaInput while preserving manual overrides
//   — gated on `ctx.elementType === 'BuildingElementTransparent'` exactly
//   like legacy gated on the orchestrator's own `elementType` local (same
//   "module owns its elementType-gated effect" precedent
//   buildingElementGround.tsx's totalAreaInputSetValueRef effect set).
//   derivedBaseHeight (the base_height fallback for mid-height) is threaded
//   in via ElementFormStateCtx.derivedBaseHeight (new this stage — see
//   types.ts).
// - The element-selection hydrate branch's Transparent-exclusive tail
//   (window-specific fields) AND the shared Opaque/Transparent prefix,
//   factored once into wallShared.tsx's hydrateWallSharedFields (see that
//   file's header for the full "risky seam" writeup — this module is one of
//   its two call sites). The hydrate-time snapshot read that seeds
//   prevDerivedWindowMidHeight/MaxOpenAreaRef is threaded in via
//   ElementFormStateCtx.getTransparentOpeningDerivedValues (new this stage
//   — needs the full floors+elements graph, which no module holds; same
//   "computed orchestrator-side" precedent as getGlobalOrientationOffset).
//   The GLOBAL-selection hydrate branch has no Opaque/Transparent case at
//   all (checked per the brief's item 3 — window elements are always
//   zone-coordinate 'element' selections, never 'global' objects).
// - The reset lines (freeAreaFraction/freeAreaHeight/midHeight/
//   maxWindowOpenArea — all four, matching legacy's four calls exactly).
// - The buildNewElementData case (width/height/area/pitch/orientation360/
//   base_height/parent_element/frame_area_fraction/free_area_height/
//   mid_height/max_window_open_area). No is_unheated_pitched_roof/
//   is_external_door — grep-verified those only ever appear in Opaque's own
//   case (decision/item 7's isExternalDoor carve-out); Transparent's case
//   never emitted them.
// - The renderAttributePanel case: Linked Wall (ParentElementDropdown),
//   width/height (via ctx.renderLinearDimensionsFields), the sloped-opening
//   rebuild button, Area, Free Area Height, Mid Height, Max Window Open
//   Area, Frame Area Fraction, Pitch (now via wallPitchField.tsx's
//   renderWallPitchField — this stage's SECOND caller, converging the
//   dedup's second of three copies per decision 9; Adjacent-like was the
//   first in Stage 2, Opaque will be the third in Stage 4), Orientation,
//   Base Height.
// - selectedSlopedTransparentNeedsRebuild/showSlopedTransparentRebuildOpening/
//   rebuildSelectedSlopedTransparentOpening — all three were Transparent-
//   exclusive (gated on `selectedElement?.type === 'BuildingElementTransparent'`
//   throughout, single render call site). They depended on
//   `selectedSlopedDimensions`, a GENERIC wall-family value Opaque's
//   not-yet-extracted "Use shape-calculated sloped width/height" reset
//   buttons also read — so that one stays orchestrator-computed and joins
//   ElementFormRenderCtx (see types.ts), while these three Transparent-only
//   derivations are now computed inline in renderPanel from it (no useMemo:
//   renderPanel is a plain function, not a hook, called conditionally by
//   ElementCreator's own switch).
// - getElementSubtype: grepped ElementCreator's switch — no
//   BuildingElementTransparent case exists, so this module's optional
//   `subtype()` is simply omitted (matching every other module with no
//   legacy subtype).
//
// NOT moved (checked, deliberately left in ElementCreator.tsx):
// - applyElementPreset/buildPresetJson (the "Element preset selector" —
//   shown generically for Opaque/Transparent/OnSiteGeneration, per the
//   `PRESET_ELEMENT_TYPES` array and the JSX comment at its render site):
//   both read/write Opaque AND OnSiteGeneration fields too, so neither can
//   move without breaking those not-yet-extracted families. They now write
//   this module's moved inputs by reading `buildingElementTransparentFormState`
//   directly (a plain orchestrator local, like every other module's
//   `xFormState`) — same "read the module's own useFormState return value
//   directly" precedent buildingElementGround.tsx's header documents for
//   systemFormState.systemSubcategory / wetEmitterFormState.subcategory /
//   adjacentLikeElementFormState.adjacentViewerBaseHeightInput.
// - syncFloorMoveHeightInputs (generic floor-move sync shared with
//   Opaque/OnSiteGeneration/Adjacent-like) and applyLineProfileHeights
//   (generic "profile top heights" popover apply, shared with Opaque/
//   Adjacent-like line elements) — both special-case
//   `element.type === 'BuildingElementTransparent'` to also patch
//   mid_height, but are themselves generic multi-family orchestrator
//   callbacks; only their one `midHeightInput.setValue(...)` line was
//   redirected to `buildingElementTransparentFormState.midHeightInput.setValue(...)`.
// - applyHostedParentElement (the "Linked Wall" / dormer "Host Roof" picker
//   handler) — shared with Opaque's still-inline dormer host-roof dropdown,
//   closes over elementIds/elementsById/geometryStore/selection/
//   updateElement, none of which a module holds. Threaded through
//   ElementFormRenderCtx (new this stage — see types.ts), same
//   renderLinearDimensionsFields-style render-bridge precedent.
// - getCurrentElementData — still has one OTHER caller (the advanced fields
//   editor's `currentData` prop) besides the orientation-field fallback that
//   moved with this module, so it stays put (same "two other callers, stays"
//   reasoning adjacentLikeElement.tsx's header gives for the same helper).
//   This module reimplements the one line it needs as a small ctx-driven
//   local (renderPanel's `currentElementForOrientationFallback`), same
//   precedent as that module's own getCurrentElementExtraJson
//   reimplementation.
// - The dormer bundle machinery. Grep-verified Transparent's hydrate/
//   buildElementData/renderPanel have ZERO dormer-conditional branches: a
//   dormer's window sibling is a completely ordinary BuildingElementTransparent
//   element (no special dormer flag on it), and selecting it directly hits
//   this module's normal case with no pre-check — unlike Opaque's dispatch
//   site, which ternaries on `selectedIsDormerAnchor` BEFORE reaching its
//   case body. The dormer bundle's own window-parameter draft inputs
//   (dormerWindowWidthInput etc.) are entirely separate orchestrator/dormer-
//   retained state (decision 2) that regenerates the window sibling via
//   direct `updateElement` store writes, orthogonal to this module and to
//   whichever element happens to be selected.
//
// Shared with the wall family via ctx.shared (same precedent as
// windowShading/contextShading/vents/BuildingElementGround/Adjacent-like):
// widthInput, heightInput, areaInput, baseHeightInput (this module's first
// consumer — see types.ts), parentElement/setParentElement, pitch/setPitch,
// orientation360/setOrientation360, applyOrientationToGeometry.

import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { roundToTwoDecimals } from '../../geometry/constants';
import { calculateDerivedWindowMidHeight } from '../../lib/zoneDerivation';
import {
  buildSlopedPolygonRectangleDimensionPatch,
  slopedPolygonNeedsRectangleRebuild,
} from '../../lib/slopedElementDimensions';
import { ParentElementDropdown } from '../ParentElementDropdown';
import { ResetFieldButton } from '../ResetFieldButton';
import { StandardInput } from '../StandardInput';
import { CompactSegmentedControl } from '../WindowDetailControls';
import { FieldValidationIndicator } from '../ValidationIndicator';
import type { Element } from '../../geometry/types';
import {
  decimalInputProps,
  useDecimalInput,
  formatToTwoDecimals,
  INLINE_FIELD_NOTE_STYLE,
  type NumericDraftInputBinding,
} from './formPrimitives';
import { hydrateWallSharedFields } from './wallShared';
import { renderWallPitchField } from './wallPitchField';
import { isOrientationPitchAxis } from '../../lib/slopePitchAxis';
import type {
  ElementFormModule,
  ElementFormStateCtx,
} from './types';

// INLINE_FIELD_NOTE_STYLE/formatToTwoDecimals: RESOLVED in slice-6 STAGE 6 —
// now imported from formPrimitives.ts above instead of duplicated locally;
// see that file's own comment.

export interface BuildingElementTransparentFormState {
  /** Shared with the wall family — see module header comment. */
  widthInput: NumericDraftInputBinding;
  heightInput: NumericDraftInputBinding;
  areaInput: NumericDraftInputBinding;
  baseHeightInput: NumericDraftInputBinding;
  parentElement: string;
  setParentElement: (value: string) => void;
  pitch: number;
  setPitch: (value: number) => void;
  /** Shared with the wall family — see wallShared.tsx's own doc comment
   * (origin/main PR #31 "Let pitch carry decimals" port). */
  pitchDraftInput: NumericDraftInputBinding;
  orientation360: number;
  setOrientation360: (value: number) => void;
  applyOrientationToGeometry: (desiredOrientationDeg: number) => void;
  /** Captured from ElementFormStateCtx so hydrate/renderPanel (which only
   * receive state/ctx-render, not the full state ctx) can still resolve the
   * current orientation — same precedent as adjacentLikeElement.tsx's
   * getGlobalOrientationOffset threading. */
  getCurrentOrientation: (element: Element) => number;
  setSlopePitchAxis: ElementFormStateCtx['setSlopePitchAxis'];
  /** Captured from ElementFormStateCtx so hydrate() can seed
   * prevDerivedWindowMidHeightRef/prevDerivedWindowMaxOpenAreaRef below —
   * same threading precedent as getCurrentOrientation above. */
  getTransparentOpeningDerivedValues: ElementFormStateCtx['getTransparentOpeningDerivedValues'];
  /** Window-exclusive state. */
  freeAreaFractionInput: NumericDraftInputBinding;
  freeAreaHeightInput: NumericDraftInputBinding;
  midHeightInput: NumericDraftInputBinding;
  maxWindowOpenAreaInput: NumericDraftInputBinding;
  derivedWindowMidHeight: number;
  derivedWindowMaxOpenArea: number;
  /** Exposed so hydrate() can seed these on selection change — same
   * "expose the ref on state for module-method access" idiom
   * buildingElementGround.tsx's totalAreaInputSetValueRef uses. */
  prevDerivedWindowMidHeightRef: MutableRefObject<number | null>;
  prevDerivedWindowMaxOpenAreaRef: MutableRefObject<number | null>;
}

function useFormState(ctx: ElementFormStateCtx): BuildingElementTransparentFormState {
  const isExistingElementSelection = (): boolean =>
    !!ctx.selection && (ctx.selection.type === 'element' || ctx.selection.type === 'global') && !ctx.selection.isPlaceholder;

  const commitTransparentFrameAreaFraction = (value: number | '') => {
    if (!isExistingElementSelection()) return;
    ctx.commitExistingElementDraft({
      frame_area_fraction: value === '' ? undefined : value,
    } as Partial<Element>);
  };
  const freeAreaFractionInput = useDecimalInput(
    '',
    commitTransparentFrameAreaFraction,
    { commitOnChange: false, formatOnBlur: 'preserve' },
  );

  const freeAreaHeightInput = useDecimalInput('', ctx.commitElementNumericField('free_area_height'), { commitOnChange: true });
  const midHeightInput = useDecimalInput('', ctx.commitElementNumericField('mid_height'), { commitOnChange: true });
  const maxWindowOpenAreaInput = useDecimalInput('', ctx.commitElementNumericField('max_window_open_area'), { commitOnChange: true });

  const midHeightInputSetValueRef = useRef(midHeightInput.syncValue);
  const maxWindowOpenAreaInputSetValueRef = useRef(maxWindowOpenAreaInput.syncValue);
  useEffect(() => {
    midHeightInputSetValueRef.current = midHeightInput.syncValue;
    maxWindowOpenAreaInputSetValueRef.current = maxWindowOpenAreaInput.syncValue;
  }, [maxWindowOpenAreaInput.syncValue, midHeightInput.syncValue]);

  /** Opening mid-height: base + height/2 (matches HEM / engine convention). */
  const derivedWindowMidHeight = useMemo(() => {
    const h = Number(ctx.shared.heightInput.value) || 0;
    const baseM =
      typeof ctx.shared.baseHeightInput.value === 'number' &&
      ctx.shared.baseHeightInput.value > 0
        ? ctx.shared.baseHeightInput.value
        : ctx.derivedBaseHeight;
    return calculateDerivedWindowMidHeight(baseM, h);
  }, [ctx.derivedBaseHeight, ctx.shared.baseHeightInput.value, ctx.shared.heightInput.value]);

  /** Max openable area from geometry: width x free-area height, capped by total window area. */
  const derivedWindowMaxOpenArea = useMemo(() => {
    const w = Number(ctx.shared.widthInput.value) || 0;
    const h = Number(ctx.shared.heightInput.value) || 0;
    const freeH = Number(freeAreaHeightInput.value) || 0;
    if (w <= 0 || freeH <= 0) return 0;
    const raw = w * freeH;
    const cap = h > 0 ? w * h : raw;
    return roundToTwoDecimals(Math.min(raw, cap));
  }, [freeAreaHeightInput.value, ctx.shared.heightInput.value, ctx.shared.widthInput.value]);

  const prevDerivedWindowMidHeightRef = useRef<number | null>(null);
  const prevDerivedWindowMaxOpenAreaRef = useRef<number | null>(null);

  // Keep derived window fields in sync while preserving manual overrides:
  // auto-update only when the current value still matches the previous
  // derived value (or is empty), so user-entered custom values are not
  // clobbered.
  useEffect(() => {
    if (ctx.elementType !== 'BuildingElementTransparent') {
      prevDerivedWindowMidHeightRef.current = derivedWindowMidHeight;
      prevDerivedWindowMaxOpenAreaRef.current = derivedWindowMaxOpenArea;
      return;
    }

    const nextMid = derivedWindowMidHeight;
    const prevMid = prevDerivedWindowMidHeightRef.current;
    const currentMid = typeof midHeightInput.value === 'number' ? midHeightInput.value : null;
    const shouldSyncMid =
      !midHeightInput.isEditing &&
      (currentMid == null || currentMid <= 0 || prevMid == null || Math.abs(currentMid - prevMid) <= 0.005);
    if (nextMid > 0 && shouldSyncMid && (currentMid == null || Math.abs(currentMid - nextMid) > 0.005)) {
      midHeightInputSetValueRef.current(nextMid);
      // Repair legacy/stale saved values when the editor first opens. Normal edits are already
      // canonicalized in the store, so this branch is otherwise a no-op for existing elements.
      if (isExistingElementSelection()) {
        ctx.commitExistingElementDraft({ mid_height: nextMid });
      }
    }
    prevDerivedWindowMidHeightRef.current = nextMid;

    const nextOpenArea = derivedWindowMaxOpenArea;
    const prevOpenArea = prevDerivedWindowMaxOpenAreaRef.current;
    const currentOpenArea =
      typeof maxWindowOpenAreaInput.value === 'number' ? maxWindowOpenAreaInput.value : null;
    const shouldSyncOpenArea =
      !maxWindowOpenAreaInput.isEditing &&
      (
        currentOpenArea == null ||
        (nextOpenArea > 0 && currentOpenArea <= 0) ||
        prevOpenArea == null ||
        Math.abs(currentOpenArea - prevOpenArea) <= 0.005
      );
    if (
      shouldSyncOpenArea &&
      (currentOpenArea == null || Math.abs(currentOpenArea - nextOpenArea) > 0.005)
    ) {
      maxWindowOpenAreaInputSetValueRef.current(nextOpenArea);
      if (isExistingElementSelection()) {
        ctx.commitExistingElementDraft({ max_window_open_area: nextOpenArea });
      }
    }
    prevDerivedWindowMaxOpenAreaRef.current = nextOpenArea;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx is a fresh object literal every render (see ElementCreator.tsx's elementFormStateCtx); depending on the whole object would defeat memoization for no benefit (same idiom as system.tsx/thermalBridgeLinear.tsx's ctx.* dep arrays). The legacy dep array also listed isExistingElementSelection (a useCallback); dropping it is inert because hydrate() writes the two listed input deps on every selection change, so the effect already re-runs whenever selection observably changes — the only skipped case is a redundant repair-write when consecutive selections share identical derived values.
  }, [
    ctx.elementType,
    derivedWindowMidHeight,
    derivedWindowMaxOpenArea,
    midHeightInput.value,
    maxWindowOpenAreaInput.value,
    midHeightInput.isEditing,
    maxWindowOpenAreaInput.isEditing,
  ]);

  return {
    widthInput: ctx.shared.widthInput,
    heightInput: ctx.shared.heightInput,
    areaInput: ctx.shared.areaInput,
    baseHeightInput: ctx.shared.baseHeightInput,
    parentElement: ctx.shared.parentElement,
    setParentElement: ctx.shared.setParentElement,
    pitch: ctx.shared.pitch,
    setPitch: ctx.shared.setPitch,
    pitchDraftInput: ctx.shared.pitchDraftInput,
    orientation360: ctx.shared.orientation360,
    setOrientation360: ctx.shared.setOrientation360,
    applyOrientationToGeometry: ctx.shared.applyOrientationToGeometry,
    getCurrentOrientation: ctx.getCurrentOrientation,
    setSlopePitchAxis: ctx.setSlopePitchAxis,
    getTransparentOpeningDerivedValues: ctx.getTransparentOpeningDerivedValues,
    freeAreaFractionInput,
    freeAreaHeightInput,
    midHeightInput,
    maxWindowOpenAreaInput,
    derivedWindowMidHeight,
    derivedWindowMaxOpenArea,
    prevDerivedWindowMidHeightRef,
    prevDerivedWindowMaxOpenAreaRef,
  };
}

export const buildingElementTransparentFormModule: ElementFormModule<BuildingElementTransparentFormState> = {
  type: 'BuildingElementTransparent',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'BuildingElementTransparent') return;
    // Shared Opaque/Transparent prefix, factored once — see wallShared.tsx's
    // hydrateWallSharedFields header for the full "risky seam" writeup.
    hydrateWallSharedFields(state, element, state.getCurrentOrientation);

    // Window-specific fields.
    const frameAreaFraction = 'frame_area_fraction' in element && typeof element.frame_area_fraction === 'number'
      ? roundToTwoDecimals(element.frame_area_fraction) : (element.frame_area_fraction ?? '');
    const freeAreaHeight = 'free_area_height' in element && typeof element.free_area_height === 'number'
      ? roundToTwoDecimals(element.free_area_height) : (element.free_area_height ?? '');
    const midHeight = 'mid_height' in element && typeof element.mid_height === 'number'
      ? roundToTwoDecimals(element.mid_height) : (element.mid_height ?? '');
    const maxWindowOpenArea = 'max_window_open_area' in element && typeof element.max_window_open_area === 'number'
      ? roundToTwoDecimals(element.max_window_open_area) : (element.max_window_open_area ?? '');

    state.freeAreaFractionInput.setValue(frameAreaFraction);
    state.freeAreaHeightInput.setValue(freeAreaHeight);
    state.midHeightInput.setValue(midHeight);
    state.maxWindowOpenAreaInput.setValue(maxWindowOpenArea);

    const transparentDerived = state.getTransparentOpeningDerivedValues(element);
    state.prevDerivedWindowMidHeightRef.current = transparentDerived.midHeight;
    state.prevDerivedWindowMaxOpenAreaRef.current = transparentDerived.maxWindowOpenArea;
  },

  reset(state) {
    state.freeAreaFractionInput.setValue('');
    state.freeAreaHeightInput.setValue('');
    state.midHeightInput.setValue('');
    state.maxWindowOpenAreaInput.setValue('');
  },

  buildElementData(state, ctx) {
    const width = state.widthInput.value;
    const height = state.heightInput.value;
    return {
      ...ctx.baseData,
      width,
      height,
      area: typeof width === 'number' && typeof height === 'number' ? width * height : undefined,
      pitch: state.pitch,
      orientation360: Math.round(state.orientation360 ?? 0),
      base_height: state.baseHeightInput.value === '' ? undefined : state.baseHeightInput.value,
      parent_element: state.parentElement,
      frame_area_fraction: state.freeAreaFractionInput.value === '' ? undefined : state.freeAreaFractionInput.value,
      free_area_height: state.freeAreaHeightInput.value,
      mid_height: state.midHeightInput.value,
      max_window_open_area: state.maxWindowOpenAreaInput.value,
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const {
      elementType,
      selection,
      getElementById,
      commitExistingElementDraft,
      renderFieldLabel,
      renderFieldLabelWithComparisonIndicator,
      registerBaseFieldRef,
      getFieldValidationIssue,
      fieldUnit,
      comparisonFieldIndicators,
      selectedElement,
      selectedShape,
      derivedPolygonArea,
      liveRectArea,
      selectedSlopedDimensions,
      renderLinearDimensionsFields,
      applyHostedParentElement,
      elementZoneId,
    } = ctx;

    // ElementCreator's getCurrentElementData has one OTHER call site (the
    // advanced fields editor's currentData prop) besides this module's
    // orientation-field fallback, so it stays orchestrator-owned; this is a
    // small ctx-driven reimplementation of the one line this module needs —
    // see module header note.
    const currentElementForOrientationFallback = (): Element | Record<string, never> => {
      if (selection?.type !== 'element' && selection?.type !== 'global') return {};
      const element = getElementById(selection.id);
      return element || {};
    };

    const showSlopedTransparentRebuildOpening =
      selectedElement?.type === 'BuildingElementTransparent' &&
      selectedShape === 'sloped-polygon' &&
      !!selectedSlopedDimensions &&
      slopedPolygonNeedsRectangleRebuild({
        coordinates: selectedElement.coordinates,
        widthM: selectedSlopedDimensions.width,
        heightM: selectedSlopedDimensions.height,
        pitchDegrees: typeof selectedElement.pitch === 'number' ? selectedElement.pitch : state.pitch,
      });
    const showSlopePitchAxis =
      selectedElement?.type === 'BuildingElementTransparent' &&
      selectedShape === 'sloped-polygon' &&
      !selectedElement.parent_element;
    const orientationPitchAxis = showSlopePitchAxis && isOrientationPitchAxis(selectedElement);
    const rebuildSelectedSlopedTransparentOpening = () => {
      if (
        selectedElement?.type !== 'BuildingElementTransparent' ||
        selectedShape !== 'sloped-polygon' ||
        !selectedSlopedDimensions
      ) return;
      const nextWidth =
        typeof state.widthInput.value === 'number' && state.widthInput.value > 0
          ? state.widthInput.value
          : selectedSlopedDimensions.width;
      const nextHeight =
        typeof state.heightInput.value === 'number' && state.heightInput.value > 0
          ? state.heightInput.value
          : selectedSlopedDimensions.height;
      const patch = buildSlopedPolygonRectangleDimensionPatch({
        coordinates: selectedElement.coordinates,
        widthM: nextWidth,
        heightM: nextHeight,
        pitchDegrees: typeof selectedElement.pitch === 'number' ? selectedElement.pitch : state.pitch,
      });
      if (!patch) return;
      if (typeof patch.width === 'number') state.widthInput.setValue(patch.width);
      if (typeof patch.height === 'number') state.heightInput.setValue(patch.height);
      if (typeof patch.area === 'number') state.areaInput.setValue(patch.area);
      commitExistingElementDraft(patch);
    };

    return (
      <>
        {renderFieldLabel('Linked Wall:', elementType)}
        <div className="element-input">
          <ParentElementDropdown
            value={state.parentElement}
            onChange={(value) => applyHostedParentElement(value, '')}
            elementType={elementType}
            zoneId={elementZoneId}
            placeholder="Select a parent opaque element"
            selfId={selection?.type === 'element' ? selection.id : undefined}
          />
        </div>
        {selectedShape !== 'polygon' && (
          renderLinearDimensionsFields(registerBaseFieldRef, {
            widthStep: '0.01',
            heightStep: '0.01',
            includeProfileTop: true,
          })
        )}
        {showSlopedTransparentRebuildOpening ? (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="btn editor-action-btn editor-action-btn--secondary"
              onClick={rebuildSelectedSlopedTransparentOpening}
            >
              Rebuild opening
            </button>
          </div>
        ) : null}
        {renderFieldLabelWithComparisonIndicator('Area (m²):', elementType, comparisonFieldIndicators.area, 'area')}
        <div className="element-input" ref={registerBaseFieldRef('area')}>
          <StandardInput
            type="text"
            inputMode="numeric"
            value={formatToTwoDecimals(selectedShape === 'polygon' ? derivedPolygonArea : liveRectArea)}
            unit={fieldUnit('area')}
            readOnly
            variant="ghost"
            size="md"
          />
        </div>
        {renderFieldLabel('Free Area Height (m):', elementType)}
        <div
          className="element-input"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          ref={registerBaseFieldRef('freeAreaHeight')}
        >
          <StandardInput
            {...decimalInputProps(state.freeAreaHeightInput)}
            unit={fieldUnit('free_area_height')}
            step="0.01"
            min="0"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('freeAreaHeight', state.freeAreaHeightInput.value)} issue={getFieldValidationIssue('freeAreaHeight', state.freeAreaHeightInput.value) || undefined} />
        </div>
        {renderFieldLabel('Mid Height (m):', elementType)}
        <div
          className="element-input"
          style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}
          ref={registerBaseFieldRef('midHeight')}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', width: '100%' }}>
            <div
              className={
                state.derivedWindowMidHeight > 0 &&
                typeof state.midHeightInput.value === 'number' &&
                Math.abs(state.midHeightInput.value - state.derivedWindowMidHeight) > 0.005
                  ? 'custom-value'
                  : ''
              }
              style={{ flex: 1 }}
            >
              <StandardInput
                {...decimalInputProps(state.midHeightInput)}
                unit={fieldUnit('mid_height')}
                step="0.01"
                min="0"
                variant="ghost"
                size="md"
                className="flex-1"
                placeholder={state.derivedWindowMidHeight > 0 ? String(state.derivedWindowMidHeight) : undefined}
              />
            </div>
            {state.derivedWindowMidHeight > 0 &&
            typeof state.midHeightInput.value === 'number' &&
            Math.abs(state.midHeightInput.value - state.derivedWindowMidHeight) > 0.005 ? (
              <ResetFieldButton
                onClick={() => {
                  state.midHeightInput.setValue(state.derivedWindowMidHeight);
                  commitExistingElementDraft({ mid_height: state.derivedWindowMidHeight });
                }}
                align="inline"
                title={`Reset to ${state.derivedWindowMidHeight} m (base + height/2)`}
                ariaLabel="Reset Mid Height"
                label="Reset"
              />
            ) : null}
            <FieldValidationIndicator
              hasIssue={!!getFieldValidationIssue('midHeight', state.midHeightInput.value)}
              issue={getFieldValidationIssue('midHeight', state.midHeightInput.value) || undefined}
            />
          </div>
          {state.derivedWindowMidHeight > 0 ? (
            <div style={INLINE_FIELD_NOTE_STYLE}>
              Default: {state.derivedWindowMidHeight} m (base_height + height / 2)
            </div>
          ) : null}
        </div>
        {renderFieldLabel('Max Window Open Area (m²):', elementType)}
        <div
          className="element-input"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          ref={registerBaseFieldRef('maxWindowOpenArea')}
        >
          <StandardInput
            {...decimalInputProps(state.maxWindowOpenAreaInput)}
            unit={fieldUnit('max_window_open_area')}
            step="0.01"
            min="0"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          {typeof state.maxWindowOpenAreaInput.value === 'number' &&
          Math.abs(state.maxWindowOpenAreaInput.value - state.derivedWindowMaxOpenArea) > 0.005 ? (
            <button
              type="button"
              onClick={() => {
                state.maxWindowOpenAreaInput.setValue(state.derivedWindowMaxOpenArea);
                commitExistingElementDraft({ max_window_open_area: state.derivedWindowMaxOpenArea });
              }}
              className="btn editor-action-btn editor-action-btn--secondary element-editor-input-action"
              title={`Use suggested ${state.derivedWindowMaxOpenArea} m²`}
              aria-label="Use suggested max window open area"
            >
              Use Suggested
            </button>
          ) : null}
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('maxWindowOpenArea', state.maxWindowOpenAreaInput.value)} issue={getFieldValidationIssue('maxWindowOpenArea', state.maxWindowOpenAreaInput.value) || undefined} />
        </div>
        <div style={INLINE_FIELD_NOTE_STYLE}>
          Suggested from width x free area height (capped by total window area).
        </div>
        {renderFieldLabel('Frame Area Fraction:', elementType)}
        <div className="element-input" ref={registerBaseFieldRef('frame_area_fraction')}>
          <StandardInput
            {...decimalInputProps(state.freeAreaFractionInput)}
            unit={fieldUnit('frame_area_fraction')}
            step="0.01"
            min="0"
            max="1"
            variant="ghost"
            size="md"
          />
        </div>
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
            // DECISION 6 (see module header): preserved singular, byte-for-
            // byte — the plural form's extra camelCase alias is a no-op for
            // 'pitch' (no underscore to convert), so there is nothing this
            // demonstrably drops.
            refRegistrar: registerBaseFieldRef,
          },
        )}
        {showSlopePitchAxis ? (
          <>
            {renderFieldLabel('Pitch axis:')}
            <div className="element-input">
              <CompactSegmentedControl
                value={orientationPitchAxis ? 'orientation' : 'bottom-edge'}
                options={[
                  { value: 'bottom-edge', label: 'Bottom edge' },
                  { value: 'orientation', label: 'Orientation' },
                ]}
                onChange={(axis) => state.setSlopePitchAxis(selectedElement.id, axis)}
                ariaLabel="Pitch axis"
              />
            </div>
          </>
        ) : null}
        {renderFieldLabel('Orientation (degrees):', elementType, 'orientation360')}
        <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRef('orientation360')}>
          <StandardInput
            type="text"
            inputMode="numeric"
            value={Number.isFinite(state.orientation360) ? state.orientation360 : state.getCurrentOrientation(currentElementForOrientationFallback() as Element)}
            unit={fieldUnit('orientation360')}
            onChange={(e) => state.setOrientation360(Math.round(parseFloat(e.target.value) || 0))}
            onBlur={(e) => {
              const parsed = Math.round(parseFloat(e.currentTarget.value) || 0);
              state.setOrientation360(parsed);
              state.applyOrientationToGeometry(parsed);
            }}
            step="1"
            min="0"
            max="360"
            readOnly={!!state.parentElement}
            variant="ghost"
            size="md"
          />
          {state.parentElement && (
            <div style={INLINE_FIELD_NOTE_STYLE}>
              Inherited from parent: {state.parentElement}
            </div>
          )}
        </div>
        {renderFieldLabel('Base Height (m):', elementType, 'base_height')}
        <div className="element-input" ref={registerBaseFieldRef('base_height')}>
          <StandardInput
            {...decimalInputProps(state.baseHeightInput)}
            unit={fieldUnit('base_height')}
            step="0.01"
            min="0"
            variant="ghost"
            size="md"
          />
        </div>
      </>
    );
  },
};
