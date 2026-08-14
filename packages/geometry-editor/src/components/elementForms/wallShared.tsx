// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Wall-family shared state — the group of fields ElementCreator's not-yet-
// extracted BuildingElementOpaque/Transparent/Ground/PartyWall/Adjacent-like
// hydrate/reset/build/render code shares with seven already-extracted modules
// (windowShading, contextShading, vents, mechanicalVentilation,
// mechanicalVentilationDuctwork/Terminal, wetEmitter) through
// ElementFormSharedCtx. Slice-6 brief decision 1, STAGE 0: this is the
// "ownership inversion" seam — a single-instance group hook, following the
// serviceLine.tsx precedent (ONE useWallSharedFormState call, not a
// per-family ElementFormModule) — with ZERO behaviour change and ZERO
// changes to the 5 consumer modules or ElementFormSharedCtx's shape.
//
// Moved verbatim from ElementCreator:
// - widthInput/heightInput/areaInput/baseHeightInput (the four
//   useDecimalInput declarations) and their commit callbacks
//   (commitElementWidthField/commitElementHeightField, which read
//   commitExistingElementDraft + elementType + the sloped-polygon check +
//   the two "other dimension" refs directly; areaInput/baseHeightInput commit
//   through the generic commitElementNumericField, threaded in as an arg).
// - isSelectedSlopedFabricPolygon, widthInputValueForCommitRef/
//   heightInputValueForCommitRef and their ref-updater effect line — these
//   exist solely to serve commitElementWidthField/commitElementHeightField,
//   so they move as a private (unexported) implementation detail.
// - parentElement/setParentElement, pitch/setPitch, orientation360/
//   setOrientation360 (all useKeyedState, keyed on selectedDraftKey) plus the
//   selectedDraftElement/selectedDraftKey/selectedDraftPitch/
//   selectedParentElementValue locals that exist only to feed them — grepped
//   before moving, confirmed exclusive to this group.
// - applyOrientationToGeometry and applyParentPitchOrientationForDisplay.
//
// widthInputSetValueRef/heightInputSetValueRef/areaInputSetValueRef and their
// slice of the ref-updater effect also moved (split out of the six-input
// combined effect that also covered midHeightInputSetValueRef/
// maxWindowOpenAreaInputSetValueRef/totalAreaInputSetValueRef, which are
// Transparent/Ground-owned and stay in ElementCreator with their own smaller
// effect of the same shape — the "split the combined effect" precedent
// slice 3 set for serviceLine.tsx). Unlike serviceLine's equivalent refs,
// these three ARE exposed on the return value: ElementCreator's own
// still-inline width/height/area canvas-sync effect (not yet extracted —
// that's stage 1-4's job) reads `.current(...)` directly, the same ref idiom
// used throughout the file to avoid listing a fresh-every-render function in
// a dependency array.
//
// Documented adaptations (verbatim-relocation proof obligation):
// 1. getGlobalOrientationOffset is threaded in as an arg instead of reading
//    `geometryStore.getState().globalOrientationOffset` directly — this
//    module has no `geometryStore` local (that's a per-render value from
//    ElementCreator's own `useGeometryStoreApi()` call, not something a
//    module can import). Same computation either way; already the
//    established ctx-field pattern other extracted modules
//    (contextShading/mechanicalVentilation/onSiteGeneration) use for this
//    exact value.
// 2. getCurrentOrientation is threaded in as an arg (orientation360's initial
//    value) rather than moved — it's also read by
//    ElementFormStateCtx.getCurrentOrientation (OnSiteGeneration's
//    canvas-sync), so it stays orchestrator-owned. ElementCreator relocates
//    its OWN definition earlier in the render body to sit just before this
//    hook's single call site (verified it depends on nothing declared
//    between the old and new position — only `geometryStore` and imported
//    pure functions, both already available at the new position) — every
//    other declaration keeps its original relative order, including the
//    downstream memo/effect block that reads wallShared.widthInput.value
//    etc.
// 3. ADJACENT_LIKE_ELEMENT_TYPES: RESOLVED in slice-6 STAGE 6 — was
//    duplicated here (3 literal element-type strings) rather than imported
//    from ElementCreator.tsx, which would create an orchestrator<->module
//    import cycle; passing it as an 11th hook arg would cross the slice-6
//    brief's own >10-arg stop condition. Now imported from
//    lib/elementArea.ts, a cycle-free shared home (see that file's own
//    comment) — no hook-arg threading needed since it's a plain constant,
//    not per-render state.

import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useKeyedState } from '../../hooks/useKeyedState';
import { roundToTwoDecimals } from '../../geometry/constants';
import {
  applyCompassOrientationToLineCoords,
  applyCompassOrientationToSlopedPolygonCoords,
} from '../../lib/openingSegmentOutward';
import { convertShapeCoordinates, getElementShape } from '../../lib/shapeUtils';
import { VULCAN_UI_PARTY_ELEMENT_KEY } from '../../lib/assemblyMaterialFabric';
import { isOrientationPitchAxis } from '../../lib/slopePitchAxis';
import type { BuildingElementOpaque, BuildingElementTransparent, Element, ElementType } from '../../geometry/types';
// Not formPrimitives' useDecimalInput: that wrapper doesn't forward `syncExternal`, and the
// single-element pitch input needs it (see pitchDraftInput below) so the draft re-syncs from
// `pitch` on selection/preset/dormer changes without threading a `.setValue()` call through
// every one of those call sites — origin/main PR #31 "Let pitch carry decimals: the schemas
// always did". Ported here (rather than left inline in ElementCreator.tsx, where PR #31 added
// it) because this hook is the single-instance call site the wall family's three pitch-field
// copies (Opaque/Transparent/Adjacent-like) all read from — same "only one renders at a time,
// hooks must run unconditionally" reasoning that motivated PR #31's own single call site.
import { useNumericDraftInput } from '../numericDraftInput';
import { readExtraJsonRecord, useDecimalInput, type NumericDraftInputBinding } from './formPrimitives';
import { ADJACENT_LIKE_ELEMENT_TYPES } from '../../lib/elementArea';
import type { ElementFormSelection } from './types';

export interface WallSharedFormGroup {
  widthInput: NumericDraftInputBinding;
  heightInput: NumericDraftInputBinding;
  areaInput: NumericDraftInputBinding;
  baseHeightInput: NumericDraftInputBinding;
  /** Exposed so ElementCreator's own not-yet-extracted width/height/area
   * canvas-sync effect can keep using the ref idiom (see header note). */
  widthInputSetValueRef: MutableRefObject<(value: number | '') => void>;
  heightInputSetValueRef: MutableRefObject<(value: number | '') => void>;
  areaInputSetValueRef: MutableRefObject<(value: number | '') => void>;
  parentElement: string;
  setParentElement: Dispatch<SetStateAction<string>>;
  pitch: number;
  setPitch: Dispatch<SetStateAction<number>>;
  /** Draft-string commit for the typed pitch input, shared by all three wall-family pitch-field
   * copies (Opaque/Transparent/Adjacent-like) via wallPitchField.tsx's renderWallPitchField — see
   * this file's own useNumericDraftInput import comment and commitTypedPitch below. */
  pitchDraftInput: ReturnType<typeof useNumericDraftInput>;
  orientation360: number;
  setOrientation360: Dispatch<SetStateAction<number>>;
  applyOrientationToGeometry: (desiredOrientationDeg: number) => void;
  applyParentPitchOrientationForDisplay: (
    parentPitch: number | undefined,
    parentOrientation: number | undefined,
  ) => void;
}

export function useWallSharedFormState(args: {
  elementType: ElementType;
  selection: ElementFormSelection | null;
  isExistingElementSelection: () => boolean;
  getElementById: (id: string) => Element | undefined;
  commitExistingElementDraft: (overrides?: Partial<Element>) => void;
  commitElementNumericField: (field: string) => (value: number | '') => void;
  selectedElementV: number;
  updateElement: (id: string, updates: Partial<Element>, skipAutoSave?: boolean) => void;
  getGlobalOrientationOffset: () => number;
  getCurrentOrientation: (element: Element) => number;
}): WallSharedFormGroup {
  const {
    elementType,
    selection,
    isExistingElementSelection,
    getElementById,
    commitExistingElementDraft,
    commitElementNumericField,
    selectedElementV,
    updateElement,
    getGlobalOrientationOffset,
    getCurrentOrientation,
  } = args;

  const isSelectedSlopedFabricPolygon = () => {
    if (!isExistingElementSelection()) return false;
    const currentSelection = selection as ElementFormSelection;
    const element = getElementById(currentSelection.id);
    if (!element) return false;
    if (
      element.type !== 'BuildingElementOpaque' &&
      element.type !== 'BuildingElementTransparent' &&
      !ADJACENT_LIKE_ELEMENT_TYPES.includes(element.type as ElementType)
    ) {
      return false;
    }
    return getElementShape(element) === 'sloped-polygon';
  };

  const widthInputValueForCommitRef = useRef<number | ''>('');
  const heightInputValueForCommitRef = useRef<number | ''>('');

  const commitElementWidthField = (value: number | '') => {
    if (value === '') return;
    const width = typeof value === 'number' ? value : undefined;
    const overrides: Record<string, unknown> = { width: value };
    if (
      !isSelectedSlopedFabricPolygon() &&
      (
        elementType === 'BuildingElementOpaque'
        || elementType === 'BuildingElementTransparent'
        || ADJACENT_LIKE_ELEMENT_TYPES.includes(elementType)
      )
    ) {
      const height = typeof heightInputValueForCommitRef.current === 'number'
        ? heightInputValueForCommitRef.current
        : undefined;
      overrides.area = width !== undefined && height !== undefined ? width * height : undefined;
    }
    commitExistingElementDraft(overrides as Partial<Element>);
  };

  const commitElementHeightField = (value: number | '') => {
    if (value === '') return;
    const height = typeof value === 'number' ? value : undefined;
    const overrides: Record<string, unknown> = { height: value };
    if (
      !isSelectedSlopedFabricPolygon() &&
      (
        elementType === 'BuildingElementOpaque'
        || elementType === 'BuildingElementTransparent'
        || ADJACENT_LIKE_ELEMENT_TYPES.includes(elementType)
      )
    ) {
      const width = typeof widthInputValueForCommitRef.current === 'number'
        ? widthInputValueForCommitRef.current
        : undefined;
      overrides.area = width !== undefined && height !== undefined ? width * height : undefined;
    }
    commitExistingElementDraft(overrides as Partial<Element>);
  };

  const widthInput = useDecimalInput('', commitElementWidthField, { commitOnChange: true });
  const heightInput = useDecimalInput('', commitElementHeightField, { commitOnChange: true });
  useEffect(() => {
    widthInputValueForCommitRef.current = widthInput.value;
    heightInputValueForCommitRef.current = heightInput.value;
  }, [heightInput.value, widthInput.value]);
  const areaInput = useDecimalInput('', commitElementNumericField('area'), { commitOnChange: true });

  const selectedDraftElement = selection?.id
    && (selection.type === 'element' || selection.type === 'global')
    ? getElementById(selection.id)
    : undefined;
  const selectedDraftKey = selectedDraftElement
    ? `${selectedDraftElement.id}\0${selectedElementV}`
    : 'new';
  const selectedDraftPitch = selectedDraftElement && 'pitch' in selectedDraftElement
    ? selectedDraftElement.pitch
    : undefined;
  const [pitch, setPitch] = useKeyedState(
    selectedDraftKey,
    typeof selectedDraftPitch === 'number' && Number.isFinite(selectedDraftPitch)
      ? selectedDraftPitch
      : 90,
  );
  // Draft-string commit for the single-element typed pitch input (Opaque/Transparent/
  // Adjacent-like: renderWallPitchField's non-polygon StandardInput branch, for whichever
  // family currently renders, binds to this one instance — see the useNumericDraftInput
  // import comment above). Was previously a plain controlled
  // `<input value={formatConditionalDecimals(pitch)}>` with `parseFloat(e.target.value)`
  // re-deriving the displayed value every keystroke: typing "22." parsed to 22, which snapped
  // the visible field back to "22" mid-type (the trailing "." vanished), so the next keystroke
  // landed on the wrong digit — decimal entry was effectively impossible.
  // `useNumericDraftInput` decouples the *displayed* raw string (`inputValue`) from the
  // *committed* value: the field echoes exactly what was typed while editing, and only
  // reformats (to 2dp) on blur. Values commit at 2dp (roundToTwoDecimals) to match the CSV
  // writer/importer (both round to 2dp), so a save/load/save cycle is idempotent from the
  // first cycle. `syncExternal: true` re-syncs the draft from `pitch` whenever it changes
  // externally (selection change, preset load, dormer/parent inherit, etc.) without threading
  // `.setValue()` through every one of those call sites.
  //
  // The party-floor-key strip below (VULCAN_UI_PARTY_ELEMENT_KEY, on the polygon-confirm
  // "convert to sloped polygon" branch) is gated on `elementType === 'BuildingElementOpaque'`
  // — reproducing this repo's pre-existing Opaque-only scoping (wallPitchField.tsx's
  // `cleansPartyFloorKeyOnConvert` opt, `true` only for Opaque's caller) rather than
  // origin/main's own (PR #31) shape: upstream collapsed what used to be three
  // near-identical inline copies into one shared commit function *without* re-adding the
  // Opaque-only gate that pre-PR31 had (only the Opaque copy carried the strip;
  // Transparent/Adjacent-like's copies never had it) — so PR #31, as merged, silently
  // widened the strip to fire for all three wall-family pitch fields whenever the
  // *actually selected* element resolves to AdjacentConditionedSpace, regardless of which
  // form is displaying it. Judgment call: since this repo's own dedup (wallPitchField.tsx,
  // predating this rebase) already made that Opaque-only scoping an explicit, documented
  // decision — not copy-paste happenstance — this port keeps that decision rather than
  // silently inheriting upstream's incidental widening. Equivalent to gating via
  // wallPitchField.tsx's `opts.cleansPartyFloorKeyOnConvert` per caller, since `elementType`
  // is already threaded into this hook's args and each family's opts value is static (never
  // user-configurable independent of which family is selected) — done here instead because
  // commitTypedPitch itself must be a single, unconditionally-called hook instance (see
  // above), so it is simpler for it to consult the `elementType` it already has than for
  // three render-time callers to each carry a redundant, easy-to-drift copy of the same
  // true/false.
  const commitTypedPitch = (parsed: number | ''): void => {
    if (parsed === '') return;
    const newPitch = roundToTwoDecimals(parsed);

    if (selection?.type === 'element') {
      const currentElement = getElementById(selection.id);
      if (currentElement) {
        const currentShape = getElementShape(currentElement);

        // For polygons: only allow 0° or 180° (horizontal surfaces)
        if (currentShape === 'polygon' && newPitch !== 0 && newPitch !== 180) {
          const ok = window.confirm(
            `Polygon elements should have pitch 0° (horizontal up) or 180° (horizontal down). Convert to sloped polygon shape to use angled pitch ${newPitch}°?`
          );
          if (ok) {
            // Keep same coordinates, just update pitch - sloped-polygon uses same coordinate structure.
            const patch: Partial<Element> = { pitch: newPitch } as Partial<Element>;
            if (elementType === 'BuildingElementOpaque' && currentElement.type === 'BuildingElementAdjacentConditionedSpace') {
              const extra = readExtraJsonRecord(currentElement.extra_json);
              if (VULCAN_UI_PARTY_ELEMENT_KEY in extra) {
                const nextExtra = { ...extra };
                delete nextExtra[VULCAN_UI_PARTY_ELEMENT_KEY];
                patch.extra_json = nextExtra;
              }
            }
            updateElement(currentElement.id, patch);
            setPitch(newPitch);
            return;
          } else {
            // Reset to 0° if user cancels
            setPitch(0);
            updateElement(selection.id, { pitch: 0 });
            return;
          }
        }

        // For lines: suggest polygon conversion for horizontal surfaces
        if (currentShape === 'line' && (newPitch === 0 || newPitch === 180)) {
          const ok = window.confirm(
            `Pitch ${newPitch}° suggests a horizontal surface. Convert to polygon shape?`
          );
          if (ok) {
            const nextCoords = convertShapeCoordinates(currentElement as any, 'polygon');
            updateElement(currentElement.id, { coordinates: nextCoords, pitch: newPitch });
          }
        }
      }
    }

    // Typed pitch passes through at 2dp (exact intent); only drag interactions round to a whole degree.
    setPitch(newPitch);
    // Only update pitch, don't touch coordinates
    if (selection?.type === 'element') {
      updateElement(selection.id, { pitch: newPitch });
    }
  };
  const pitchDraftInput = useNumericDraftInput(pitch, commitTypedPitch, {
    commitOnChange: true,
    formatOnBlur: 'fixed2',
    syncExternal: true,
  });
  const baseHeightInput = useDecimalInput('', commitElementNumericField('base_height'), { commitOnChange: true });

  const selectedParentElementValue = selectedDraftElement && 'parent_element' in selectedDraftElement
    ? String((selectedDraftElement as { parent_element?: string | null }).parent_element ?? '').trim()
    : '';
  const [parentElement, setParentElement] = useKeyedState(
    selectedDraftKey,
    selectedParentElementValue,
  );

  const widthInputSetValueRef = useRef(widthInput.syncValue);
  const heightInputSetValueRef = useRef(heightInput.syncValue);
  const areaInputSetValueRef = useRef(areaInput.syncValue);
  useEffect(() => {
    widthInputSetValueRef.current = widthInput.syncValue;
    heightInputSetValueRef.current = heightInput.syncValue;
    areaInputSetValueRef.current = areaInput.syncValue;
  }, [areaInput.syncValue, heightInput.syncValue, widthInput.syncValue]);

  const [orientation360, setOrientation360] = useKeyedState(
    selectedDraftKey,
    selectedDraftElement ? Math.round(getCurrentOrientation(selectedDraftElement)) : 0,
  );

  // Apply edited orientation360: rotate sloped polygons in plan (first-edge compass), or 2-point lines around the first endpoint
  const applyOrientationToGeometry = (desiredOrientationDeg: number) => {
    if (!selection || selection.type !== 'element') return;
    const el = getElementById(selection.id);
    if (!el || !el.coordinates || el.coordinates.length < 2) return;

    const shape = getElementShape(el as Element);
    if (shape === 'sloped-polygon' && el.coordinates.length >= 3) {
      if (isOrientationPitchAxis(el)) {
        commitElementNumericField('orientation360')(desiredOrientationDeg);
        return;
      }
      const globalOffset = getGlobalOrientationOffset();
      const next = applyCompassOrientationToSlopedPolygonCoords(
        el.coordinates as Array<{ x: number; y: number; z: number }>,
        desiredOrientationDeg,
        globalOffset,
      );
      if (next) {
        updateElement(selection.id, { coordinates: next });
        return;
      }
      commitElementNumericField('orientation360')(desiredOrientationDeg);
      return;
    }

    if (el.coordinates.length !== 2) return;
    const offset = getGlobalOrientationOffset();
    const next = applyCompassOrientationToLineCoords(
      el.coordinates as Array<{ x: number; y: number; z: number }>,
      desiredOrientationDeg,
      offset,
    );
    if (next) updateElement(selection.id, { coordinates: next });
  };

  // Vents' optimistic DISPLAY write when a parent wall/window is chosen — mirrors
  // the parent's pitch/orientation360 into the shared inputs so the panel shows the
  // inherited values immediately, without Vents reading/owning the shared pitch
  // state directly (see ElementFormSharedCtx).
  const applyParentPitchOrientationForDisplay = (
    parentPitch: number | undefined,
    parentOrientation: number | undefined,
  ) => {
    if (typeof parentPitch === 'number') setPitch(parentPitch);
    if (typeof parentOrientation === 'number') setOrientation360(parentOrientation);
  };

  return {
    widthInput,
    heightInput,
    areaInput,
    baseHeightInput,
    widthInputSetValueRef,
    heightInputSetValueRef,
    areaInputSetValueRef,
    parentElement,
    setParentElement,
    pitch,
    setPitch,
    pitchDraftInput,
    orientation360,
    setOrientation360,
    applyOrientationToGeometry,
    applyParentPitchOrientationForDisplay,
  };
}

/** The subset of WallSharedFormGroup that hydrateWallSharedFields needs —
 * satisfied structurally both by useWallSharedFormState's own return value
 * (ElementCreator's still-inline Opaque hydrate branch, Stage 4's job) and
 * by a module's captured ctx.shared fields (buildingElementTransparent.tsx's
 * hydrate(), Stage 3). */
export interface WallSharedHydrateTarget {
  widthInput: NumericDraftInputBinding;
  heightInput: NumericDraftInputBinding;
  areaInput: NumericDraftInputBinding;
  baseHeightInput: NumericDraftInputBinding;
  setParentElement: (value: string) => void;
  setPitch: (value: number) => void;
  setOrientation360: (value: number) => void;
}

/** Slice-6 brief STAGE 3's risky seam: "Opaque↔Transparent hydrate shares
 * code before splitting on type" (width/height/area/pitch/orientation360/
 * base_height derivation, then the four wallShared setter calls) — factored
 * ONCE here, verbatim from ElementCreator's old combined
 * `if (element.type === 'BuildingElementOpaque' || element.type ===
 * 'BuildingElementTransparent')` prefix, rather than duplicated into every
 * wall-family module that needs it. ElementCreator's own (still-inline,
 * Stage 4's job) Opaque hydrate branch calls this with its `wallShared`
 * local; buildingElementTransparent.tsx's hydrate() calls it with its own
 * captured ctx.shared fields — same function, two call sites, zero
 * duplication (the brief's explicit instruction: "do NOT duplicate it
 * silently"). */
export function hydrateWallSharedFields(
  target: WallSharedHydrateTarget,
  // Narrower than `Element`: unlike the callers' own hydrate(state, element)
  // signatures (which must accept the full union per the ElementFormModule
  // contract), this helper's OWN width/height/area/base_height fallback
  // reads (`element.width ?? ''` etc.) only type-check when TS knows every
  // union member being read from actually HAS those fields — true for
  // Opaque/Transparent, not for the wider Element union (e.g.
  // ThermalBridgeLinear has no width/height/area at all). Both call sites
  // already narrow to this pair before calling in (Opaque's inline `if
  // (element.type === 'BuildingElementOpaque')`; Transparent's hydrate()
  // early-returns on any other type).
  element: BuildingElementOpaque | BuildingElementTransparent,
  getCurrentOrientation: (element: Element) => number,
): void {
  const width = 'width' in element && typeof element.width === 'number' ? roundToTwoDecimals(element.width) : (element.width ?? '');
  const height = 'height' in element && typeof element.height === 'number' ? roundToTwoDecimals(element.height) : (element.height ?? '');
  const area = 'area' in element && typeof element.area === 'number' ? roundToTwoDecimals(element.area) : (element.area ?? '');
  const pitch = 'pitch' in element && typeof element.pitch === 'number' ? element.pitch : (element.pitch ?? 90);
  const orientation = Math.round(getCurrentOrientation(element));
  const baseHeight =
    'base_height' in element && typeof element.base_height === 'number'
      ? roundToTwoDecimals(element.base_height)
      : (element.base_height ?? '');

  target.widthInput.setValue(width);
  target.heightInput.setValue(height);
  target.setParentElement('parent_element' in element ? element.parent_element ?? '' : '');
  target.areaInput.setValue(area);
  target.setPitch(pitch);
  target.setOrientation360(orientation);
  target.baseHeightInput.setValue(baseHeight);
}
