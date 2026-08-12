// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// BuildingElementGround form family, extracted from ElementCreator's five
// inline structures (slice-6 brief, STAGE 1). Ground is the wall family's
// first extracted member — the other four (Opaque/Transparent/PartyWall/
// Adjacent-like) remain inline until later stages.
//
// Beyond the five ElementFormModule methods, Ground owned a cluster of
// derived useMemo/useCallback/useEffect hooks in ElementCreator that exist
// solely to feed those five methods (the perimeter/area derivations, the
// U-value/extra_json autofill sync effect, and the "sync thickness_walls
// from adjacent wall assemblies" feature). Per the OnSiteGeneration/System
// precedent (arbitrary hooks live inside a module's own useFormState, not
// just the five contract methods), all of that moved into useFormState here
// rather than staying split across ElementCreator.
//
// width/height/area/parentElement are shared with the wall family via
// ctx.shared (same precedent as windowShading/contextShading/vents) —
// captured into this module's own returned state during useFormState so
// hydrate/reset/buildElementData/renderPanel (which mostly don't receive
// ctx) can still reach them. Ground is the first ctx.shared consumer that
// needs `widthInput` (the other five consumers never did), so
// ElementFormSharedCtx gained that one field — see types.ts.
//
// No assembly-calculator bridge was needed. Ground's own attribute panel has
// no assembly-calculator-modal interaction at all: the "Edit Assembly" badge
// used by Opaque/Ground/PartyWall/AdjacentUnconditioned is rendered
// generically in ElementCreator's own JSX body (outside any per-family
// case), reading only `elementType` — untouched by this move. The
// "Use Assembly" wall-thickness sync feature inside Ground's own panel
// (resyncGroundThicknessWallsFromAssemblies/groundWallThicknessAutofill)
// needed no bridge either — it only reads generic ctx capabilities
// (selection/getElementById/elementsById/updateElement), already exposed.
//
// A handful of ElementCreator's OWN still-inline, orchestrator-retained code
// (elementFieldPresentation's `floorType` prop, the three
// assemblyModalPitchDeg/ElementMode/GroundFloorType helpers that feed the
// still-orchestrator-owned <AssemblyCalculatorModal> per decision 10, the
// two elementSupportsGenericElevationControl call sites, buildNewElementData's
// generic viewerElevationPatch, and the assembly modal's onApply Ground
// branch) reads floorType/thicknessWallsInput/derivedGroundArea/
// derivedGroundPerimeter. Rather than inventing a bridge for these, this
// module reuses the existing "read the module's own useFormState return
// value directly from orchestrator code" precedent already established for
// systemFormState.systemSubcategory / wetEmitterFormState.subcategory
// (ElementCreator keeps `buildingElementGroundFormState` as a plain local,
// exactly like every other module's `xFormState`) — zero new
// ElementFormStateCtx/ElementFormSharedCtx fields were needed for this.
//
// Two small, genuinely new ElementFormRenderCtx fields WERE needed, both for
// things only reachable at render time and only used inside Ground's own
// panel:
// - `setSelection`: the "From assemblies" breakdown lets the user click a
//   source wall's name to jump selection to it (legacy `onClick={() =>
//   setSelection({ type: 'element', id: source.elementId })}`). No prior
//   module needed this, so it's new — a plain, generic "change the current
//   selection" capability, not assembly-calculator-specific.
// - `elementElevationInput`: the floor-type dropdown clears the *shared*
//   generic elevation input's draft value when the newly-picked floor type
//   no longer supports a viewer elevation. This input is orchestrator-wide
//   (every family's "Elevation above model ground" field), so only write
//   access via the renderPanel ctx was needed; kept as the full binding for
//   symmetry with heightInput/areaInput on ElementFormSharedCtx.
//
// INTENTIONAL BEHAVIOUR FIX (slice-6 brief decision 3, plan-doc latent bug
// (a)): buildElementData drops the legacy `pitch: wallShared.pitch` emission
// — see the comment at its call site below for the full writeup and the
// precondition-grep result.
//
// readFiniteNumber, parseLiveDecimalInput, formatToTwoDecimals,
// INLINE_FIELD_NOTE_STYLE: RESOLVED in slice-6 STAGE 6 — these tiny pure
// helpers/constants used to be duplicated locally (not exported from
// ElementCreator.tsx; importing them would have created an
// orchestrator<->module import cycle) because they had other callers left
// behind in ElementCreator.tsx that couldn't just move with this module. Now
// all four live in formPrimitives.ts — already a dependency of every
// wall-family module, so cycle-free — and both this module and
// ElementCreator.tsx import the same definition; see formPrimitives.ts's own
// comment for the full writeup.
//
// hasReliableGroundExposedPerimeter, numbersClose: grep-verified their
// ElementCreator definitions had ZERO callers outside what moved here, so
// these DID move (deleted from ElementCreator) rather than duplicate;
// `numbersClose` was a stateless `useCallback(fn, [])` there — demoted to
// a plain module-scope function here, since it closes over nothing and a
// hook wrapper was never buying it anything.
//
// selectedGroundElement/selectedGroundShape are local, Ground-narrowed
// re-derivations of ElementCreator's own generic `selectedElement`/
// `selectedShape` (used by every family, so they stay orchestrator-side) —
// same computation (selection + selectedElementV -> getElementById; then
// getElementShape), just independently computed here instead of threaded
// in. Likewise `derivedGroundArea`'s polygon branch inlines the same
// calculatePolygonArea computation as the orchestrator's generic
// `derivedPolygonArea` (also multi-family, stays put) rather than adding a
// second intermediate memo for a value only Ground's line-vs-polygon branch
// consumes.
//
// latestElementsByIdRef.current (used by the legacy commitGroundPerimeter)
// is replaced with ctx.elementsById: both hold the same current-render
// elementsById snapshot — the ref exists in ElementCreator so effects and
// stored callbacks avoid a stale closure, but useFormState already reruns
// with a fresh ctx every render, so ctx.elementsById is exactly as current.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SUSPENDED_GROUND_DEFAULT_HEIGHT_UPPER_SURFACE_M, roundToFourDecimals, roundToTwoDecimals } from '../../geometry/constants';
import { calculatePolygonArea } from '../../lib/polygonSync';
import { getElementShape } from '../../lib/shapeUtils';
import {
  computeWeightedExternalWallAssemblyThicknessDetailsForGroundElement,
  computeWeightedExternalWallAssemblyThicknessForGroundElement,
  applyComputedGroundUValueAutofill,
  groundExposedPerimeterManualFlag,
  GROUND_EXPOSED_PERIMETER_MANUAL_KEY,
  THICKNESS_WALLS_MANUAL_KEY,
  type SuspendedWallThicknessAutofillResult,
} from '../../lib/groundSuspendedFabricSync';
import {
  computeGroundUValueFromElementModel,
  defaultSuspendedAreaPerPerimeterVent,
  parseWindShieldLocation,
} from '../../lib/groundUValueCalculator';
import {
  computeGroundExposedPerimeterDetails,
  type GroundExposedPerimeterDetails,
} from '../../lib/groundExposedPerimeter';
import { groundFloorTypeSupportsViewerElevation } from '../../lib/groundFloorSubtype';
import type { BuildingElementGround, Element } from '../../geometry/types';
import { ResetFieldButton } from '../ResetFieldButton';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { StandardDropdown } from '../StandardDropdown';
import {
  decimalInputProps,
  formatConditionalDecimals,
  readExtraJsonRecord,
  useDecimalInput,
  readFiniteNumber,
  parseLiveDecimalInput,
  formatToTwoDecimals,
  INLINE_FIELD_NOTE_STYLE,
  type NumericDraftInputBinding,
} from './formPrimitives';
import type { ElementFormModule, ElementFormSelection, ElementFormStateCtx } from './types';

const GROUND_LINE_HEIGHT_EXTRA_KEY = '_ground_line_height_m';

type GroundFloorType =
  | ''
  | 'Heated_basement'
  | 'Slab_no_edge_insulation'
  | 'Slab_edge_insulation'
  | 'Suspended_floor'
  | 'Unheated_basement';

// readFiniteNumber/parseLiveDecimalInput/formatToTwoDecimals/
// INLINE_FIELD_NOTE_STYLE: RESOLVED in slice-6 STAGE 6 — all four are now
// imported from formPrimitives.ts (imported above) instead of duplicated
// locally; see that file's own comment for the full writeup.

// Moved verbatim from ElementCreator.tsx (grep-verified zero other callers).
function hasReliableGroundExposedPerimeter(
  details: GroundExposedPerimeterDetails | null | undefined,
): boolean {
  if (!details) return false;
  if (details.valueM > 0) return true;
  return details.shapePerimeterM > 0 && details.linkedBoundaryPerimeterM >= Math.max(0, details.shapePerimeterM - 0.05);
}

// Moved verbatim from ElementCreator.tsx (grep-verified zero other callers;
// was a stateless `useCallback(fn, [])` there — see module header note).
function numbersClose(a: number | null | undefined, b: number | null | undefined, eps = 1e-6): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= eps;
}

const EMPTY_WALL_THICKNESS_AUTOFILL: SuspendedWallThicknessAutofillResult = {
  valueM: null,
  areaTotalM2: 0,
  sources: [],
  candidateCount: 0,
};

export interface BuildingElementGroundFormState {
  floorType: GroundFloorType;
  setFloorType: (value: GroundFloorType) => void;
  totalAreaInput: NumericDraftInputBinding;
  perimeterInput: NumericDraftInputBinding;
  depthBasementFloorInput: NumericDraftInputBinding;
  thicknessWallsInput: NumericDraftInputBinding;
  groundLineHeightInput: NumericDraftInputBinding;
  /** Shared with the wall family — see module header comment. */
  widthInput: NumericDraftInputBinding;
  heightInput: NumericDraftInputBinding;
  areaInput: NumericDraftInputBinding;
  parentElement: string;
  setParentElement: (value: string) => void;
  derivedGroundArea: number;
  derivedGroundEffectiveArea: number;
  derivedGroundPerimeter: number;
  groundPerimeterDetails: GroundExposedPerimeterDetails | null;
  groundPerimeterManual: boolean;
  groundPerimeterBreakdownText: string | null;
  resetGroundPerimeterToAuto: () => void;
  resyncGroundThicknessWallsFromAssemblies: () => void;
  groundWallThicknessAutofill: SuspendedWallThicknessAutofillResult;
  liveThicknessWallsValue: number | null;
  selectedGroundShape: ReturnType<typeof getElementShape> | null;
  /** Captured from ElementFormStateCtx so subtype() (which only receives
   * state) can still resolve the currently selected element's persisted
   * floor_type — same precedent as MechanicalVentilationTerminal's
   * getCurrentTerminal. */
  getPersistedFloorType: () => string | undefined;
}

function useFormState(ctx: ElementFormStateCtx): BuildingElementGroundFormState {
  const [floorType, setFloorType] = useState<GroundFloorType>('');

  const isExistingElementSelection = (): boolean =>
    !!ctx.selection && (ctx.selection.type === 'element' || ctx.selection.type === 'global') && !ctx.selection.isPlaceholder;

  const commitGroundPerimeter = (value: number | '') => {
    if (!isExistingElementSelection()) return;
    const currentSelection = ctx.selection as ElementFormSelection;
    const element = ctx.getElementById(currentSelection.id);
    if (!element || element.type !== 'BuildingElementGround') {
      ctx.commitExistingElementDraft({ perimeter: value } as Partial<Element>);
      return;
    }

    const extra = readExtraJsonRecord(element.extra_json);
    const nextExtra = { ...extra };
    const autoDetails = computeGroundExposedPerimeterDetails(ctx.elementsById, element);
    const autoValue = hasReliableGroundExposedPerimeter(autoDetails) ? autoDetails.valueM : null;

    if (value === '') {
      delete nextExtra[GROUND_EXPOSED_PERIMETER_MANUAL_KEY];
      ctx.commitExistingElementDraft({
        ...(autoValue != null ? { perimeter: autoValue } : {}),
        extra_json: nextExtra,
      } as Partial<Element>);
      return;
    }

    const rounded = roundToTwoDecimals(value);
    if (autoValue != null && Math.abs(rounded - autoValue) <= 0.01) {
      delete nextExtra[GROUND_EXPOSED_PERIMETER_MANUAL_KEY];
    } else {
      nextExtra[GROUND_EXPOSED_PERIMETER_MANUAL_KEY] = true;
    }
    ctx.commitExistingElementDraft({
      perimeter: rounded,
      extra_json: nextExtra,
    } as Partial<Element>);
  };

  const totalAreaInput = useDecimalInput('', ctx.commitElementNumericField('total_area'), { commitOnChange: true });
  const perimeterInput = useDecimalInput('', commitGroundPerimeter, { commitOnChange: true });
  const depthBasementFloorInput = useDecimalInput('', ctx.commitElementNumericField('depth_basement_floor'), { commitOnChange: true });
  const thicknessWallsInput = useDecimalInput('', ctx.commitElementNumericField('thickness_walls'), { commitOnChange: true });
  const groundLineHeightInput = useDecimalInput('', (value) => {
    const element = ctx.selection?.type === 'element' ? ctx.getElementById(ctx.selection.id) : null;
    if (!element || element.type !== 'BuildingElementGround') return;
    const extra = readExtraJsonRecord(element.extra_json);
    ctx.updateElement(element.id, {
      extra_json: {
        ...extra,
        [GROUND_LINE_HEIGHT_EXTRA_KEY]: typeof value === 'number' ? value : undefined,
      },
    } as Partial<Element>);
  }, { commitOnChange: true });

  // Keep suspended-ground wall thickness input aligned with the store when `updateElement` bumps `_v`
  // (auto-sync from assemblies, "Use assembly", etc.). The main selection loader intentionally avoids
  // re-running on every selected-element mutation, so we mirror only `thickness_walls` here.
  const thicknessWallsSetValueRef = useRef(thicknessWallsInput.syncValue);
  useEffect(() => {
    thicknessWallsSetValueRef.current = thicknessWallsInput.syncValue;
  }, [thicknessWallsInput.syncValue]);
  useEffect(() => {
    if (ctx.selection?.type !== 'element' || !ctx.selection.id) return;
    const el = ctx.getElementById(ctx.selection.id);
    if (!el || el.type !== 'BuildingElementGround') return;
    const tw =
      'thickness_walls' in el && typeof el.thickness_walls === 'number' && Number.isFinite(el.thickness_walls)
        ? roundToTwoDecimals(el.thickness_walls)
        : '';
    thicknessWallsSetValueRef.current(tw);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx is a fresh object literal every render (see ElementCreator.tsx's elementFormStateCtx); depending on the whole object would defeat memoization for no benefit (same idiom as system.tsx/thermalBridgeLinear.tsx's ctx.* dep arrays).
  }, [ctx.selection?.id, ctx.selection?.type, ctx.selectedElementV, ctx.getElementById]);

  // Split out of ElementCreator's combined widthInput/heightInput/areaInput
  // ref-updater effect (which also covers midHeightInput/maxWindowOpenAreaInput,
  // Transparent-owned and left behind) — same "split the combined effect"
  // precedent slice 3 set for serviceLine.tsx / wallShared.tsx.
  const totalAreaInputSetValueRef = useRef(totalAreaInput.syncValue);
  useEffect(() => {
    totalAreaInputSetValueRef.current = totalAreaInput.syncValue;
  }, [totalAreaInput.syncValue]);

  // Auto-calculate total_area for BuildingElementGround when area changes
  useEffect(() => {
    if (ctx.elementType === 'BuildingElementGround' && ctx.shared.areaInput.value && ctx.shared.areaInput.value > 0) {
      totalAreaInputSetValueRef.current(ctx.shared.areaInput.value);
    }
  }, [ctx.elementType, ctx.shared.areaInput.value]);

  // Ground-narrowed re-derivation of ElementCreator's own generic
  // selectedElement/selectedShape — see module header note.
  const selectedGroundElement = useMemo((): BuildingElementGround | null => {
    void ctx.selectedElementV;
    if (!ctx.selection?.id) return null;
    const el = ctx.getElementById(ctx.selection.id);
    return el && el.type === 'BuildingElementGround' ? el : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx is a fresh object literal every render (see ElementCreator.tsx's elementFormStateCtx); depending on the whole object would defeat memoization for no benefit (same idiom as system.tsx/thermalBridgeLinear.tsx's ctx.* dep arrays).
  }, [ctx.selection?.id, ctx.getElementById, ctx.selectedElementV]);

  const selectedGroundShape = useMemo(() => {
    return selectedGroundElement ? getElementShape(selectedGroundElement) : null;
  }, [selectedGroundElement]);

  const derivedGroundArea = useMemo((): number => {
    if (!selectedGroundElement) return 0;
    if (selectedGroundShape === 'line' && selectedGroundElement.coordinates?.length === 2) {
      const [a, b] = selectedGroundElement.coordinates;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const lineHeight = typeof groundLineHeightInput.value === 'number' && Number.isFinite(groundLineHeightInput.value)
        ? Math.max(0, groundLineHeightInput.value)
        : 0;
      return roundToTwoDecimals(length * lineHeight);
    }
    // Same computation as ElementCreator's generic derivedPolygonArea (also
    // used by Opaque/Transparent/Adjacent-like, so it stays orchestrator-side)
    // — inlined rather than threaded, see module header note.
    if (!selectedGroundElement.coordinates || selectedGroundElement.coordinates.length < 3) return 0;
    try {
      return roundToTwoDecimals(calculatePolygonArea(selectedGroundElement.coordinates));
    } catch {
      return 0;
    }
  }, [selectedGroundElement, selectedGroundShape, groundLineHeightInput.value]);

  const derivedGroundEffectiveArea = useMemo((): number => {
    if (!selectedGroundElement) return 0;
    if (selectedGroundShape === 'line') return derivedGroundArea;
    if (typeof selectedGroundElement.area === 'number' && Number.isFinite(selectedGroundElement.area) && selectedGroundElement.area > 0) {
      return roundToTwoDecimals(selectedGroundElement.area);
    }
    return derivedGroundArea;
  }, [selectedGroundElement, selectedGroundShape, derivedGroundArea]);

  const derivedGroundShapePerimeter = useMemo((): number => {
    if (!selectedGroundElement?.coordinates || selectedGroundElement.coordinates.length < 2) {
      return 0;
    }
    if (selectedGroundShape === 'line' && selectedGroundElement.coordinates.length === 2) {
      const [a, b] = selectedGroundElement.coordinates;
      return roundToTwoDecimals(Math.hypot(b.x - a.x, b.y - a.y));
    }
    if (selectedGroundElement.coordinates.length < 3) return 0;
    let perimeter = 0;
    for (let i = 0; i < selectedGroundElement.coordinates.length; i++) {
      const current = selectedGroundElement.coordinates[i];
      const next = selectedGroundElement.coordinates[(i + 1) % selectedGroundElement.coordinates.length];
      perimeter += Math.hypot(next.x - current.x, next.y - current.y);
    }
    return roundToTwoDecimals(perimeter);
  }, [selectedGroundElement, selectedGroundShape]);

  const groundPerimeterDetails = useMemo(() => {
    if (!selectedGroundElement) return null;
    return computeGroundExposedPerimeterDetails(ctx.elementsById, selectedGroundElement);
  }, [selectedGroundElement, ctx.elementsById]);

  const groundPerimeterManual = useMemo((): boolean => {
    if (!selectedGroundElement) return false;
    return groundExposedPerimeterManualFlag(readExtraJsonRecord(selectedGroundElement.extra_json));
  }, [selectedGroundElement]);

  const derivedGroundPerimeter = useMemo((): number => {
    if (!selectedGroundElement) return 0;
    if (
      groundPerimeterManual &&
      typeof selectedGroundElement.perimeter === 'number' &&
      Number.isFinite(selectedGroundElement.perimeter) &&
      selectedGroundElement.perimeter >= 0
    ) {
      return roundToTwoDecimals(selectedGroundElement.perimeter);
    }
    const details = groundPerimeterDetails;
    if (details && hasReliableGroundExposedPerimeter(details)) {
      return details.valueM;
    }
    return derivedGroundShapePerimeter;
  }, [selectedGroundElement, groundPerimeterManual, groundPerimeterDetails, derivedGroundShapePerimeter]);

  const groundPerimeterBreakdownText = useMemo((): string | null => {
    if (!selectedGroundElement || !groundPerimeterDetails) return null;
    const exposed = groundPerimeterDetails.exposedRuns
      .slice(0, 3)
      .map((run) => `${run.label} ${formatConditionalDecimals(run.lengthM)} m`);
    const exposedSuffix =
      groundPerimeterDetails.exposedRuns.length > exposed.length
        ? ` +${groundPerimeterDetails.exposedRuns.length - exposed.length} more`
        : '';
    const excluded = groundPerimeterDetails.excludedRuns
      .slice(0, 2)
      .map((run) => `${run.label}${run.reason ? ` (${run.reason})` : ''} ${formatConditionalDecimals(run.lengthM)} m`);
    const excludedText = excluded.length > 0 ? ` Excluded: ${excluded.join(', ')}.` : '';
    if (hasReliableGroundExposedPerimeter(groundPerimeterDetails)) {
      const sourceText = exposed.length > 0 ? ` from ${exposed.join(', ')}${exposedSuffix}` : '';
      return `${groundPerimeterManual ? 'Manual override.' : 'Auto exposed perimeter:'} ${formatConditionalDecimals(groundPerimeterDetails.valueM)} m${sourceText}.${excludedText}`;
    }
    if (groundPerimeterDetails.linkedLineCount > 0 && excluded.length > 0) {
      return `No external exposed wall runs on this floor outline.${excludedText}`;
    }
    return `No exposed wall runs found on this floor outline. Drawn outline is ${formatConditionalDecimals(groundPerimeterDetails.shapePerimeterM)} m.`;
  }, [selectedGroundElement, groundPerimeterDetails, groundPerimeterManual]);

  const resetGroundPerimeterToAuto = useCallback(() => {
    const details = groundPerimeterDetails;
    if (!selectedGroundElement || !details || !hasReliableGroundExposedPerimeter(details)) {
      return;
    }
    const extra = { ...readExtraJsonRecord(selectedGroundElement.extra_json) };
    delete extra[GROUND_EXPOSED_PERIMETER_MANUAL_KEY];
    ctx.updateElement(selectedGroundElement.id, {
      perimeter: details.valueM,
      extra_json: extra,
    } as Partial<Element>);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx is a fresh object literal every render (see ElementCreator.tsx's elementFormStateCtx); depending on the whole object would defeat memoization for no benefit (same idiom as system.tsx/thermalBridgeLinear.tsx's ctx.* dep arrays).
  }, [selectedGroundElement, groundPerimeterDetails, ctx.updateElement]);

  // Keep U-value / extra_json autofills (suspended-floor defaults, computed
  // u_value) and the total_area/perimeter/area store sync aligned with the
  // live derived values.
  useEffect(() => {
    if (ctx.selection?.type !== 'element') return;
    const current = ctx.getElementById(ctx.selection.id);
    if (!current || current.type !== 'BuildingElementGround') return;

    const floorTypeForCalc = floorType || current.floor_type || undefined;
    const extra = readExtraJsonRecord(current.extra_json);
    let nextExtra: Record<string, unknown> = { ...extra };
    let changed = false;

    if (floorTypeForCalc === 'Suspended_floor') {
      // Defaults only when fields are missing (JsonForms often stores numbers as strings — use readFiniteNumber).
      if (readFiniteNumber(nextExtra.height_upper_surface) == null) {
        nextExtra.height_upper_surface = SUSPENDED_GROUND_DEFAULT_HEIGHT_UPPER_SURFACE_M;
        changed = true;
      }
      const parsedShield = parseWindShieldLocation(nextExtra.shield_fact_location);
      if (nextExtra.shield_fact_location !== parsedShield) {
        nextExtra.shield_fact_location = parsedShield;
        changed = true;
      }
      // Treat 0 as unset: JsonForms often shows 0 while the field was never meaningfully filled; Part F default should apply.
      const apv = readFiniteNumber(nextExtra.area_per_perimeter_vent);
      if (apv == null || apv === 0) {
        const derivedDefault = defaultSuspendedAreaPerPerimeterVent(derivedGroundArea, derivedGroundPerimeter);
        if (derivedDefault != null) {
          // Must not use roundToTwoDecimals: 0.0015 m²/m (Part F minimum) rounds to 0 and retriggers this effect forever.
          const roundedVent = roundToFourDecimals(derivedDefault);
          if (!numbersClose(apv, roundedVent)) {
            nextExtra.area_per_perimeter_vent = roundedVent;
            changed = true;
          }
        }
      }
    }

    const depthBasementFloor = readFiniteNumber(current.depth_basement_floor);
    const thicknessWalls = typeof thicknessWallsInput.value === 'number' && Number.isFinite(thicknessWallsInput.value)
      ? thicknessWallsInput.value
      : readFiniteNumber(current.thickness_walls) ?? 0;

    const needsBasementDepth =
      floorTypeForCalc === 'Heated_basement' || floorTypeForCalc === 'Unheated_basement';
    const basementDepthOk =
      !needsBasementDepth
      || (depthBasementFloor != null && Number.isFinite(depthBasementFloor) && depthBasementFloor > 0);

    const uComputed =
      derivedGroundArea > 0 && derivedGroundPerimeter > 0 && thicknessWalls > 0 && basementDepthOk
        ? computeGroundUValueFromElementModel(current, nextExtra, floorTypeForCalc, {
            totalArea: derivedGroundArea,
            perimeter: derivedGroundPerimeter,
            thicknessWalls,
            ...(needsBasementDepth && depthBasementFloor != null ? { depthBasementFloorM: depthBasementFloor } : {}),
          })
        : null;

    const uSync = applyComputedGroundUValueAutofill(nextExtra, uComputed);
    if (uSync.changed) {
      nextExtra = uSync.extra;
      changed = true;
    }

    const syncAreaForLine = selectedGroundShape === 'line' ? derivedGroundArea : null;
    const needsGroundSync =
      !numbersClose(readFiniteNumber(current.total_area), derivedGroundArea)
      || !numbersClose(readFiniteNumber(current.perimeter), derivedGroundPerimeter)
      || (syncAreaForLine != null && !numbersClose(readFiniteNumber(current.area), syncAreaForLine));

    if (!changed && !needsGroundSync) return;

    ctx.updateElement(current.id, {
      ...(needsGroundSync ? {
        total_area: derivedGroundArea,
        perimeter: derivedGroundPerimeter,
        ...(syncAreaForLine != null ? { area: syncAreaForLine } : {}),
      } : {}),
      ...(changed ? { extra_json: nextExtra } : {}),
    } as Partial<Element>);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx is a fresh object literal every render (see ElementCreator.tsx's elementFormStateCtx); depending on the whole object would defeat memoization for no benefit (same idiom as system.tsx/thermalBridgeLinear.tsx's ctx.* dep arrays). numbersClose is a module-scope pure function (stable identity), listed for fidelity with the legacy ElementCreator effect this was moved from.
  }, [
    ctx.selection,
    ctx.selectedElementV,
    ctx.getElementById,
    ctx.updateElement,
    floorType,
    thicknessWallsInput.value,
    derivedGroundArea,
    derivedGroundPerimeter,
    selectedGroundShape,
    numbersClose,
  ]);

  const resyncGroundThicknessWallsFromAssemblies = useCallback(() => {
    if (ctx.selection?.type !== 'element') return;
    const current = ctx.getElementById(ctx.selection.id);
    if (!current || current.type !== 'BuildingElementGround') return;
    const th = computeWeightedExternalWallAssemblyThicknessForGroundElement(ctx.elementsById, current);
    if (th == null) return;
    const ex = readExtraJsonRecord(current.extra_json);
    const rest = { ...ex };
    delete rest[THICKNESS_WALLS_MANUAL_KEY];
    ctx.updateElement(current.id, {
      thickness_walls: th,
      extra_json: rest,
    } as Partial<Element>);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx is a fresh object literal every render (see ElementCreator.tsx's elementFormStateCtx); depending on the whole object would defeat memoization for no benefit (same idiom as system.tsx/thermalBridgeLinear.tsx's ctx.* dep arrays).
  }, [ctx.selection, ctx.getElementById, ctx.elementsById, ctx.updateElement]);

  const groundWallThicknessAutofill = useMemo((): SuspendedWallThicknessAutofillResult => {
    if (ctx.selection?.type !== 'element') return EMPTY_WALL_THICKNESS_AUTOFILL;
    const current = ctx.getElementById(ctx.selection.id);
    if (!current || current.type !== 'BuildingElementGround') {
      return EMPTY_WALL_THICKNESS_AUTOFILL;
    }
    return computeWeightedExternalWallAssemblyThicknessDetailsForGroundElement(ctx.elementsById, current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx is a fresh object literal every render (see ElementCreator.tsx's elementFormStateCtx); depending on the whole object would defeat memoization for no benefit (same idiom as system.tsx/thermalBridgeLinear.tsx's ctx.* dep arrays).
  }, [ctx.selection, ctx.getElementById, ctx.elementsById]);

  const liveThicknessWallsValue = (() => {
    const raw = thicknessWallsInput.inputValue.trim();
    if (raw === '') return null;
    const parsed = parseLiveDecimalInput(raw);
    return Number.isFinite(parsed) ? parsed : null;
  })();

  const getPersistedFloorType = (): string | undefined => {
    if (ctx.selection?.type !== 'element' && ctx.selection?.type !== 'global') return undefined;
    const el = ctx.getElementById(ctx.selection.id);
    return el && typeof (el as { floor_type?: string }).floor_type === 'string'
      ? (el as { floor_type: string }).floor_type
      : undefined;
  };

  return {
    floorType,
    setFloorType,
    totalAreaInput,
    perimeterInput,
    depthBasementFloorInput,
    thicknessWallsInput,
    groundLineHeightInput,
    widthInput: ctx.shared.widthInput,
    heightInput: ctx.shared.heightInput,
    areaInput: ctx.shared.areaInput,
    parentElement: ctx.shared.parentElement,
    setParentElement: ctx.shared.setParentElement,
    derivedGroundArea,
    derivedGroundEffectiveArea,
    derivedGroundPerimeter,
    groundPerimeterDetails,
    groundPerimeterManual,
    groundPerimeterBreakdownText,
    resetGroundPerimeterToAuto,
    resyncGroundThicknessWallsFromAssemblies,
    groundWallThicknessAutofill,
    liveThicknessWallsValue,
    selectedGroundShape,
    getPersistedFloorType,
  };
}

export const buildingElementGroundFormModule: ElementFormModule<BuildingElementGroundFormState> = {
  type: 'BuildingElementGround',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'BuildingElementGround') return;
    // Round numeric values to 2dp when loading from file
    const width = 'width' in element && typeof element.width === 'number' ? roundToTwoDecimals(element.width) : (element.width ?? '');
    const height = 'height' in element && typeof element.height === 'number' ? roundToTwoDecimals(element.height) : (element.height ?? '');
    const area = 'area' in element && typeof element.area === 'number' ? roundToTwoDecimals(element.area) : (element.area ?? '');
    const totalArea = 'total_area' in element && typeof element.total_area === 'number' ? roundToTwoDecimals(element.total_area) : (element.total_area ?? '');
    const perimeter = 'perimeter' in element && typeof element.perimeter === 'number' ? roundToTwoDecimals(element.perimeter) : (element.perimeter ?? '');
    const depthBasementFloor = 'depth_basement_floor' in element && typeof element.depth_basement_floor === 'number'
      ? roundToTwoDecimals(element.depth_basement_floor) : (element.depth_basement_floor ?? '');
    const thicknessWalls = 'thickness_walls' in element && typeof element.thickness_walls === 'number'
      ? roundToTwoDecimals(element.thickness_walls) : (element.thickness_walls ?? '');
    const extra = readExtraJsonRecord((element as { extra_json?: unknown }).extra_json);
    const groundLineHeight = readFiniteNumber(extra[GROUND_LINE_HEIGHT_EXTRA_KEY]) ?? '';

    state.widthInput.setValue(width);
    state.heightInput.setValue(height);
    state.setParentElement('parent_element' in element ? element.parent_element ?? '' : '');
    state.areaInput.setValue(area);
    state.totalAreaInput.setValue(totalArea);
    state.perimeterInput.setValue(perimeter);
    state.setFloorType('floor_type' in element ? element.floor_type ?? '' : '');
    state.depthBasementFloorInput.setValue(depthBasementFloor);
    state.thicknessWallsInput.setValue(thicknessWalls);
    state.groundLineHeightInput.setValue(groundLineHeight);
  },

  reset(state) {
    state.totalAreaInput.setValue('');
    state.perimeterInput.setValue('');
    state.setFloorType('');
    state.groundLineHeightInput.setValue('');
    state.depthBasementFloorInput.setValue('');
    state.thicknessWallsInput.setValue('');
  },

  buildElementData(state, ctx) {
    const derivedArea = state.derivedGroundArea;
    const derivedPerimeter = state.derivedGroundPerimeter;
    const extraJsonGround = typeof state.groundLineHeightInput.value === 'number'
      ? { [GROUND_LINE_HEIGHT_EXTRA_KEY]: state.groundLineHeightInput.value }
      : undefined;
    return {
      ...ctx.baseData,
      width: state.widthInput.value,
      area: derivedArea,
      // INTENTIONAL BEHAVIOUR FIX (slice-6 brief decision 3, plan-doc latent
      // bug (a)): legacy also emitted `pitch: wallShared.pitch` here, even
      // though BuildingElementGround has no `pitch` field
      // (geometry/types.ts:176-189), no pitch UI, and hydrate above never
      // reads one — the value silently persisted into the store and
      // round-tripped through save/load with no effect on anything, since
      // nothing downstream reads it (Adjacent-like's own `pitch` emission a
      // few cases over IS legitimate — untouched).
      //
      // Precondition grep (this slice's Stage 1 requirement) before landing:
      // crates/vulcan-model-transform/src/builder.rs scopes `pitch` to
      // Opaque/Transparent/Adjacent-like/PartyWall only — Ground's own
      // schema branch (both data/schemas/input_fhs.schema.json and
      // core-input.schema.json) never lists `pitch` among Ground's
      // properties, and the CSV-row-driven `element_context.insert("pitch",
      // ...)` only fires when the CSV row itself has a `pitch` column, which
      // Ground rows never do. crates/vulcan-csv-codec has zero `pitch`
      // references at all. On the TS side, geometry/io/geometryCsvLayouts.ts'
      // 'Ground Elements' column list omits `pitch`, and
      // stores/geometryStore/slices/ioSlice.ts's `generateCSV` Ground row
      // builder enumerates fields explicitly without `element.pitch`. (One
      // surprise worth recording: core-input.schema.json's
      // BuildingElementGround*  variants DO require `pitch` — but the Rust
      // builder always seeds Ground elements from
      // data/defaults/defaults_template.json, which already bakes in
      // `"pitch": 180` for the Ground template, so this required field is
      // satisfied independently of anything the editor persists.) Dropped
      // here.
      total_area: derivedArea,
      perimeter: derivedPerimeter,
      floor_type: state.floorType || undefined,
      depth_basement_floor: state.depthBasementFloorInput.value === '' ? undefined : state.depthBasementFloorInput.value,
      thickness_walls: state.thicknessWallsInput.value === '' ? undefined : state.thicknessWallsInput.value,
      extra_json: extraJsonGround,
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const {
      derivedGroundEffectiveArea,
      derivedGroundArea,
      perimeterInput,
      groundPerimeterManual,
      groundPerimeterDetails,
      resetGroundPerimeterToAuto,
      derivedGroundPerimeter,
      groundPerimeterBreakdownText,
      selectedGroundShape,
      groundLineHeightInput,
      floorType,
      setFloorType,
      depthBasementFloorInput,
      thicknessWallsInput,
      groundWallThicknessAutofill,
      liveThicknessWallsValue,
      resyncGroundThicknessWallsFromAssemblies,
    } = state;
    const {
      elementType,
      comparisonFieldIndicators,
      registerBaseFieldRef,
      registerBaseFieldRefs,
      fieldUnit,
      renderFieldLabel,
      renderFieldLabelWithComparisonIndicator,
      getFieldValidationIssue,
      commitExistingElementDraft,
      elementElevationInput,
      setSelection,
    } = ctx;

    return (
      <>
        {renderFieldLabelWithComparisonIndicator('Area (m²):', elementType, comparisonFieldIndicators.area, 'area')}
        <div className="element-input" ref={registerBaseFieldRef('area')}>
          <StandardInput
            type="text"
            inputMode="numeric"
            value={formatToTwoDecimals(derivedGroundEffectiveArea)}
            unit={fieldUnit('area')}
            readOnly
            variant="ghost"
            size="md"
          />
        </div>
        {renderFieldLabel('Total Area (m²):', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['totalArea', 'total_area'])}>
          <StandardInput
            type="text"
            inputMode="numeric"
            value={formatConditionalDecimals(derivedGroundArea)}
            unit={fieldUnit('total_area')}
            readOnly
            step="0.01"
            min="0"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('totalArea', derivedGroundArea)} issue={getFieldValidationIssue('totalArea', derivedGroundArea) || undefined} />
        </div>
        {renderFieldLabel('Perimeter (m):', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs('perimeter')}>
          <StandardInput
            {...decimalInputProps(perimeterInput)}
            unit={fieldUnit('perimeter')}
            step="0.01"
            min="0"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          {groundPerimeterManual && hasReliableGroundExposedPerimeter(groundPerimeterDetails) ? (
            <ResetFieldButton
              align="inline"
              title="Set perimeter to the exposed wall-linked perimeter"
              ariaLabel="Use exposed perimeter"
              label="Use exposed"
              onClick={resetGroundPerimeterToAuto}
            />
          ) : null}
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('perimeter', derivedGroundPerimeter)} issue={getFieldValidationIssue('perimeter', derivedGroundPerimeter) || undefined} />
        </div>
        {groundPerimeterBreakdownText ? (
          <div style={INLINE_FIELD_NOTE_STYLE}>
            {groundPerimeterBreakdownText}
          </div>
        ) : null}
        {selectedGroundShape === 'line' && (
          <>
            {renderFieldLabel('Ground Wall Height (m):', elementType)}
            <div className="element-input">
              <StandardInput
                {...decimalInputProps(groundLineHeightInput)}
                unit={fieldUnit('height')}
                step="0.01"
                min="0"
                variant="ghost"
                size="md"
              />
            </div>
            <div style={INLINE_FIELD_NOTE_STYLE}>
              Ground wall area is derived as line length x height.
            </div>
          </>
        )}
        {renderFieldLabel('Floor Type:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['floorType', 'floor_type'])}>
          <StandardDropdown
            value={floorType}
            onChange={(value) => {
              const nextValue = value as GroundFloorType;
              setFloorType(nextValue);
              const patch = {
                floor_type: nextValue || undefined,
                ...(!groundFloorTypeSupportsViewerElevation(nextValue) ? { _base_height: undefined } : {}),
              } as Partial<Element>;
              if (!groundFloorTypeSupportsViewerElevation(nextValue)) {
                elementElevationInput.setValue('');
              }
              commitExistingElementDraft(patch);
            }}
            options={[
              { value: 'Heated_basement', label: 'Heated Basement' },
              { value: 'Slab_no_edge_insulation', label: 'Slab No Edge Insulation' },
              { value: 'Slab_edge_insulation', label: 'Slab Edge Insulation' },
              { value: 'Suspended_floor', label: 'Suspended Floor' },
              { value: 'Unheated_basement', label: 'Unheated Basement' }
            ]}
            variant="ghost"
            size="md"
          />
        </div>
        {/* Only show depth_basement_floor for Heated_basement and Unheated_basement */}
        {(floorType === 'Heated_basement' || floorType === 'Unheated_basement') && (
          <>
        {renderFieldLabel('Depth Basement Floor (m):', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['depthBasementFloor', 'depth_basement_floor'])}>
          <StandardInput
            {...decimalInputProps(depthBasementFloorInput)}
            unit={fieldUnit('depth_basement_floor')}
            step="0.01"
            min="0"
            variant="ghost"
            size="md"
          />
        </div>
          </>
        )}
        {renderFieldLabel('Thickness Walls (m):', elementType)}
        <div
          className="element-input"
          ref={registerBaseFieldRefs(['thicknessWalls', 'thickness_walls'])}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', width: '100%', minWidth: 0 }}>
            <StandardInput
              {...decimalInputProps(thicknessWallsInput)}
              unit={fieldUnit('thickness_walls')}
              step="0.01"
              min="0"
              variant="ghost"
              size="md"
              className={
                groundWallThicknessAutofill.valueM != null ||
                groundWallThicknessAutofill.candidateCount > 0
                  ? 'flex-1'
                  : undefined
              }
            />
            {groundWallThicknessAutofill.valueM != null &&
            liveThicknessWallsValue != null &&
            Math.abs(liveThicknessWallsValue - groundWallThicknessAutofill.valueM) > 1e-5 ? (
              <ResetFieldButton
                align="inline"
                title="Set thickness to the area-weighted assembly solid thickness from adjacent walls on this storey"
                ariaLabel="Use Assembly wall thickness"
                label="Use Assembly"
                onClick={resyncGroundThicknessWallsFromAssemblies}
              />
            ) : null}
          </div>
          {groundWallThicknessAutofill.sources.length > 0 ? (
              <div
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  lineHeight: 1.45,
                  minWidth: 0,
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                }}
              >
                From assemblies:{' '}
                {Array.from(
                  groundWallThicknessAutofill.sources.reduce((groups, source) => {
                    const key = source.thicknessM.toFixed(2);
                    const existing = groups.get(key);
                    if (existing) existing.push(source);
                    else groups.set(key, [source]);
                    return groups;
                  }, new Map<string, typeof groundWallThicknessAutofill.sources>()),
                ).map(([thicknessKey, group], groupIndex) => (
                  <Fragment key={thicknessKey}>
                    {groupIndex > 0 ? ' · ' : null}
                    {group.map((source, index) => (
                      <Fragment key={source.elementId}>
                        {index > 0 ? ', ' : null}
                        <button
                          type="button"
                          onClick={() => setSelection({ type: 'element', id: source.elementId })}
                          style={{
                            border: 'none',
                            background: 'none',
                            padding: 0,
                            color: 'var(--accent-blue)',
                            cursor: 'pointer',
                            font: 'inherit',
                            textDecoration: 'underline',
                          }}
                          title={`${source.label}: ${source.areaM2.toFixed(2)} m², assembly solid thickness ${source.thicknessM.toFixed(2)} m`}
                        >
                          {source.label}
                        </button>
                      </Fragment>
                    ))}
                    {': '}
                    {thicknessKey} m
                  </Fragment>
                ))}
              </div>
            ) : groundWallThicknessAutofill.candidateCount > 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.35 }}>
                Adjacent walls found on this storey, but none have an applied wall assembly thickness.
              </div>
            ) : (
              <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.35 }}>
                No adjacent wall assembly thickness available on this storey.
              </div>
            )}
        </div>
      </>
    );
  },

  subtype(state) {
    // Persisted `floor_type` on the element (store) is authoritative; local `floorType` can lag after updates.
    return state.getPersistedFloorType() || state.floorType || undefined;
  },
};
