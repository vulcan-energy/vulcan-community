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
// hydrate/reset/renderPanel (which mostly don't receive
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
// two elementSupportsGenericElevationControl call sites, and the assembly modal's onApply Ground
// branch) reads floorType/thicknessWallsInput/
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
// readFiniteNumber, parseLiveDecimalInput, formatToTwoDecimals,
// INLINE_FIELD_NOTE_STYLE (now the field-source-note class): RESOLVED in slice-6 STAGE 6 — these tiny pure
// helpers/constants used to be duplicated locally (not exported from
// ElementCreator.tsx; importing them would have created an
// orchestrator<->module import cycle) because they had other callers left
// behind in ElementCreator.tsx that couldn't just move with this module. Now
// all four live in formPrimitives.ts — already a dependency of every
// wall-family module, so cycle-free — and both this module and
// ElementCreator.tsx import the same definition; see formPrimitives.ts's own
// comment for the full writeup.
//
// hasReliableGroundExposedPerimeter: grep-verified its ElementCreator
// definition had ZERO callers outside what moved here, so it DID move
// (deleted from ElementCreator) rather than duplicate.
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
import { roundToTwoDecimals } from '../../geometry/constants';
import { calculatePolygonArea } from '../../lib/polygonSync';
import { getElementShape } from '../../lib/shapeUtils';
import {
  deriveAutomaticGroundTotalAreas,
  groundTotalAreaMismatch,
} from '../../lib/groundFloorArea';
import { GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR } from '../../lib/overrideProvenance';
import {
  computeWeightedExternalWallAssemblyThicknessDetailsForGroundElement,
  computeWeightedExternalWallAssemblyThicknessForGroundElement,
  groundExposedPerimeterManualFlag,
  groundDrawingPerimeter,
  GROUND_EXPOSED_PERIMETER_MANUAL_KEY,
  THICKNESS_WALLS_MANUAL_KEY,
  type SuspendedWallThicknessAutofillResult,
} from '../../lib/groundSuspendedFabricSync';
import {
  GROUND_FLOOR_TYPE_LABELS,
} from '../../lib/groundFloor';
import {
  computeGroundExposedPerimeterDetails,
  type GroundExposedPerimeterDetails,
} from '../../lib/groundExposedPerimeter';
import { groundFloorTypeSupportsViewerElevation } from '../../lib/groundFloorSubtype';
import type { BuildingElementGround, Element } from '../../geometry/types';
import { ResetFieldButton } from '../ResetFieldButton';
import { Readout, SourceNote } from '../FieldSource';
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
// INLINE_FIELD_NOTE_STYLE (now the field-source-note class): RESOLVED in slice-6 STAGE 6 — all four are now
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
  derivedGroundEffectiveArea: number;
  autoDerivedTotalArea: number;
  groundTotalAreaManual: boolean;
  groundTotalAreaWarning: boolean;
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
    !!ctx.selection && (ctx.selection.type === 'element' || ctx.selection.type === 'global');

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

  const commitGroundTotalArea = (value: number | '') => {
    if (!isExistingElementSelection()) return;
    const currentSelection = ctx.selection as ElementFormSelection;
    const current = ctx.getElementById(currentSelection.id);
    if (!current || current.type !== 'BuildingElementGround') return;

    const grounds = Object.values(ctx.elementsById).filter((element): element is BuildingElementGround =>
      element.type === 'BuildingElementGround' && !element.isPlaceholder,
    );
    const autoValue = deriveAutomaticGroundTotalAreas(grounds).get(current.id) ?? current.area;

    if (value === '' || !Number.isFinite(value) || value <= 0) {
      ctx.commitExistingElementDraft({
        total_area: autoValue,
        [GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag]: false,
      } as Partial<Element>);
      return;
    }

    const rounded = roundToTwoDecimals(value);
    ctx.commitExistingElementDraft({
      total_area: rounded,
      [GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag]: groundTotalAreaMismatch(rounded, autoValue),
    } as Partial<Element>);
  };

  const totalAreaInput = useDecimalInput('', commitGroundTotalArea, { commitOnChange: true });
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

  const groundTotalsByElement = useMemo(() => {
    const grounds = Object.values(ctx.elementsById).filter((element): element is BuildingElementGround =>
      element.type === 'BuildingElementGround' && !element.isPlaceholder,
    );
    if (!selectedGroundElement) return deriveAutomaticGroundTotalAreas(grounds);

    const selectedIndex = grounds.findIndex((element) => element.id === selectedGroundElement.id);
    if (selectedIndex >= 0) {
      const liveGrounds = [...grounds];
      liveGrounds[selectedIndex] = { ...liveGrounds[selectedIndex], area: derivedGroundEffectiveArea };
      return deriveAutomaticGroundTotalAreas(liveGrounds);
    }
    return deriveAutomaticGroundTotalAreas([
      ...grounds,
      { ...selectedGroundElement, area: derivedGroundEffectiveArea },
    ]);
  }, [ctx.elementsById, selectedGroundElement, derivedGroundEffectiveArea]);

  const autoDerivedTotalArea = selectedGroundElement
    ? groundTotalsByElement.get(selectedGroundElement.id) ?? derivedGroundEffectiveArea
    : 0;
  const groundTotalAreaManual = selectedGroundElement
    ? selectedGroundElement[GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag] === true
    : false;
  const groundTotalAreaWarning = selectedGroundElement
    ? groundTotalAreaManual && groundTotalAreaMismatch(selectedGroundElement.total_area, autoDerivedTotalArea)
    : false;

  useEffect(() => {
    if (!selectedGroundElement) return;
    const nextTotal = groundTotalAreaManual
      ? selectedGroundElement.total_area
      : autoDerivedTotalArea;
    if (typeof nextTotal === 'number' && Number.isFinite(nextTotal)) {
      totalAreaInputSetValueRef.current(roundToTwoDecimals(nextTotal));
    }
  }, [selectedGroundElement, groundTotalAreaManual, autoDerivedTotalArea]);

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

  // Entered: marked so, or a stated value that differs from the drawing. Older files carry no
  // marker, so differing reads as entered and is never overwritten.
  const groundPerimeterManual = useMemo((): boolean => {
    if (!selectedGroundElement) return false;
    if (groundExposedPerimeterManualFlag(readExtraJsonRecord(selectedGroundElement.extra_json))) return true;
    const stated = readFiniteNumber(selectedGroundElement.perimeter);
    const drawing = groundDrawingPerimeter(ctx.elementsById, selectedGroundElement);
    return stated != null && drawing != null && Math.abs(stated - drawing) > 0.005;
  }, [selectedGroundElement, ctx.elementsById]);

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
    const excludedText = excluded.length > 0 ? ` Left out: ${excluded.join(', ')}.` : '';
    if (hasReliableGroundExposedPerimeter(groundPerimeterDetails)) {
      return exposed.length > 0 ? `From ${exposed.join(', ')}${exposedSuffix}.${excludedText}` : excludedText.trim() || null;
    }
    if (groundPerimeterDetails.linkedLineCount > 0 && excluded.length > 0) {
      return `No external exposed wall runs on this floor outline.${excludedText}`;
    }
    return `No exposed wall runs found on this floor outline. Drawn outline is ${formatConditionalDecimals(groundPerimeterDetails.shapePerimeterM)} m.`;
  }, [selectedGroundElement, groundPerimeterDetails]);

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

  // The wall-driven fields (perimeter, total area, U-value) and the suspended-floor defaults
  // follow edits in the store (`followGroundFabricOnEdit`), never selection.

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
    autoDerivedTotalArea,
    groundTotalAreaManual,
    groundTotalAreaWarning,
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

  renderPanel(state, ctx) {
    const {
      derivedGroundEffectiveArea,
      totalAreaInput,
      autoDerivedTotalArea,
      groundTotalAreaManual,
      groundTotalAreaWarning,
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

    const thicknessFollowsWalls =
      groundWallThicknessAutofill.valueM != null &&
      liveThicknessWallsValue != null &&
      Math.abs(liveThicknessWallsValue - groundWallThicknessAutofill.valueM) <= 1e-5;

    return (
      <>
        {renderFieldLabelWithComparisonIndicator('Area (m²):', elementType, comparisonFieldIndicators.area, 'area', <SourceNote>from the drawing</SourceNote>)}
        <div className="element-input" ref={registerBaseFieldRef('area')}>
          <Readout value={formatToTwoDecimals(derivedGroundEffectiveArea)} unit={fieldUnit('area')} label="Area" />
        </div>
        {renderFieldLabel(
          'Total Area (m²):',
          elementType,
          undefined,
          groundTotalAreaManual ? (
            <ResetFieldButton
              align="note"
              title={`Use the drawing: ${formatConditionalDecimals(autoDerivedTotalArea)} m²`}
              ariaLabel={`Total area: use the drawing, ${formatConditionalDecimals(autoDerivedTotalArea)} m²`}
              label={`Use the drawing: ${formatConditionalDecimals(autoDerivedTotalArea)} m²`}
              onClick={() => {
                const current = ctx.selection?.type === 'element' ? ctx.getElementById(ctx.selection.id) : undefined;
                if (!current || current.type !== 'BuildingElementGround') return;
                ctx.updateElement(current.id, {
                  total_area: autoDerivedTotalArea,
                  [GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag]: false,
                } as Partial<Element>);
              }}
            />
          ) : autoDerivedTotalArea > 0 ? <SourceNote>from the floors drawn</SourceNote> : undefined,
        )}
        <div className="element-input" ref={registerBaseFieldRefs(['totalArea', 'total_area'])}>
          <StandardInput
            {...decimalInputProps(totalAreaInput)}
            unit={fieldUnit('total_area')}
            step="0.01"
            min="0"
            variant="ghost"
            size="md"
            className={groundTotalAreaManual ? 'flex-1' : 'flex-1 field-value--source'}
          />
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('totalArea', totalAreaInput.value)} issue={getFieldValidationIssue('totalArea', totalAreaInput.value) || undefined} />
        </div>
        {groundTotalAreaWarning ? (
          <div className="field-source-note" style={{ color: 'var(--text-warning)' }}>
            Differs from the {formatConditionalDecimals(autoDerivedTotalArea)} m² of floors drawn.
          </div>
        ) : null}
        {renderFieldLabel(
          'Perimeter (m):',
          elementType,
          undefined,
          hasReliableGroundExposedPerimeter(groundPerimeterDetails) ? (
            groundPerimeterManual ? (
              <ResetFieldButton
                align="note"
                title={`Use the drawing: ${formatConditionalDecimals(groundPerimeterDetails?.valueM ?? 0)} m`}
                ariaLabel={`Perimeter: use the drawing, ${formatConditionalDecimals(groundPerimeterDetails?.valueM ?? 0)} m`}
                label={`Use the drawing: ${formatConditionalDecimals(groundPerimeterDetails?.valueM ?? 0)} m`}
                onClick={resetGroundPerimeterToAuto}
              />
            ) : <SourceNote>from the exposed walls</SourceNote>
          ) : undefined,
        )}
        <div className="element-input" ref={registerBaseFieldRefs('perimeter')}>
          <StandardInput
            {...decimalInputProps(perimeterInput)}
            unit={fieldUnit('perimeter')}
            step="0.01"
            min="0"
            variant="ghost"
            size="md"
            className={!groundPerimeterManual && hasReliableGroundExposedPerimeter(groundPerimeterDetails) ? 'flex-1 field-value--source' : 'flex-1'}
          />
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('perimeter', derivedGroundPerimeter)} issue={getFieldValidationIssue('perimeter', derivedGroundPerimeter) || undefined} />
        </div>
        {groundPerimeterBreakdownText ? (
          <div className="field-source-note">
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
            <div className="field-source-note">
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
            options={Object.entries(GROUND_FLOOR_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
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
        {renderFieldLabel(
          'Wall thickness (m):',
          elementType,
          undefined,
          groundWallThicknessAutofill.valueM == null ? undefined : thicknessFollowsWalls ? (
            <SourceNote>from the wall assemblies</SourceNote>
          ) : (
            <ResetFieldButton
              align="note"
              title={`Use the wall assemblies: ${groundWallThicknessAutofill.valueM} m`}
              ariaLabel={`Wall thickness: use the wall assemblies, ${groundWallThicknessAutofill.valueM} m`}
              label={`Use the wall assemblies: ${groundWallThicknessAutofill.valueM} m`}
              onClick={resyncGroundThicknessWallsFromAssemblies}
            />
          ),
        )}
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
          <StandardInput
            {...decimalInputProps(thicknessWallsInput)}
            unit={fieldUnit('thickness_walls')}
            step="0.01"
            min="0"
            variant="ghost"
            size="md"
            className={thicknessFollowsWalls ? 'field-value--source' : undefined}
          />
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
                From{' '}
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
                No wall on this storey has an assembly with a thickness, so enter it.
              </div>
            ) : (
              <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.35 }}>
                No wall on this storey has an assembly with a thickness, so enter it.
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
