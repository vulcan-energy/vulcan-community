// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Wall-family form state and derived render values (BuildingElementOpaque/
// Transparent and the adjacent-like types) that ElementCreator still held
// inline after the slice-6 per-family modules: the width/height/area
// canvas sync, the horizontal adjacent-polygon pitch and its heal, the live
// and sloped dimensions with their resets, the unheated-pitched-roof ceiling
// suggestion, the wall shape section, and renderLinearDimensionsFields.
// One orchestrator-invoked hook, called unconditionally in the position the
// inline block occupied (same pattern as useServiceLineFormState and
// useMvhrDuctTerminalManager); its effects keep their order relative to
// ElementCreator's other effects.
//
// `selection` is ElementFormSelection, structurally the non-null Selection
// ElementCreatorContent receives. commitExistingElementDraftRef sits in
// dependency arrays only because the lint rule cannot see a ref is stable
// through an argument.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, type MutableRefObject, type ReactNode } from 'react';
import { roundToTwoDecimals } from '../../geometry/constants';
import { normalizeHorizontalAdjacentPlanPitch } from '../../geometry/adjacentPlanPitch';
import type {
  BuildingElementOpaque,
  BuildingElementTransparent,
  Element,
  ElementType,
  Floor,
} from '../../geometry/types';
import { useKeyedState } from '../../hooks/useKeyedState';
import { calculatePolygonArea } from '../../lib/polygonSync';
import type { CanvasShape } from '../../lib/shapeUtils';
import { getElementShape } from '../../lib/shapeUtils';
import { isOrientationPitchAxis } from '../../lib/slopePitchAxis';
import {
  getAreaBasedElementExportGeometry,
  getElementGrossArea,
  getTransparentExportMidHeight,
  ADJACENT_LIKE_ELEMENT_TYPES,
  isAdjacentLikeElement,
  type AdjacentLikeElement,
} from '../../lib/elementArea';
import {
  deriveSlopedElementDimensions,
  getPolygonScalarDimensionSemantics,
} from '../../lib/slopedElementDimensions';
import {
  getUnheatedPitchedRoofCeilingElevationM,
  mergeUnheatedPitchedRoofCeilingElevationExtraJson,
} from '../../lib/unheatedPitchedRoofCeiling';
import { readProfiledLineFace, type ProfilePoint } from '../../lib/profileLineFace';
import { deriveWallEdgeFromRoofs, wallLeavesRoofsAtM } from '../../lib/wallEdgeFromRoofs';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import type { GeometryStoreApi } from '../../stores/geometryStore';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { ResetFieldButton } from '../ResetFieldButton';
import { WallShapeRows, type WallShapeCommit } from '../WallShapeRows';
import {
  decimalInputProps,
  parseLiveDecimalInput,
  readExtraJsonRecord,
  INLINE_FIELD_NOTE_STYLE,
  type NumericDraftInputBinding,
} from './formPrimitives';
import type { ElementFormSelection } from './types';
import type { WallSharedFormGroup } from './wallShared';

type AreaBasedExportElement =
  | BuildingElementOpaque
  | BuildingElementTransparent
  | AdjacentLikeElement;

function isAreaBasedExportElement(element: Element): element is AreaBasedExportElement {
  return (
    element.type === 'BuildingElementOpaque'
    || element.type === 'BuildingElementTransparent'
    || isAdjacentLikeElement(element)
  );
}

export function useWallFamilyFormState({
  selection,
  selectedElement,
  selectedShape,
  wallShared,
  transparentMidHeightInput,
  getElementById,
  updateElement,
  geometryStore,
  allElements,
  floors,
  commitExistingElementDraftRef,
  elementType,
  renderFieldLabel,
  fieldUnit,
  getFieldValidationState,
}: {
  selection: ElementFormSelection;
  selectedElement: Element | null;
  selectedShape: CanvasShape | null;
  wallShared: WallSharedFormGroup;
  transparentMidHeightInput: NumericDraftInputBinding;
  getElementById: (id: string) => Element | undefined;
  updateElement: (id: string, updates: Partial<Element>, skipAutoSave?: boolean) => void;
  geometryStore: GeometryStoreApi;
  allElements: Element[];
  floors: Floor[];
  commitExistingElementDraftRef: MutableRefObject<(overrides?: Partial<Element>) => void>;
  elementType: ElementType;
  renderFieldLabel: (fieldLabel: string, targetElementType?: string, evidenceFieldKey?: string) => ReactNode;
  fieldUnit: (fieldKey: string) => string | undefined;
  getFieldValidationState: (
    fieldName: string,
    value: unknown,
  ) => { message: string; variant: 'error' | 'warning' } | null;
}) {
  const isExistingSelection = (selection.type === 'element' || selection.type === 'global') && !selection.isPlaceholder;
  const [wallShapeOpen, setWallShapeOpen] = useKeyedState(
    selection.id,
    false,
  );

  useEffect(() => {
    if (!selectedElement || (selection.type !== 'element' && selection.type !== 'global')) return;
    if (
      selectedElement.type !== 'BuildingElementOpaque' &&
      selectedElement.type !== 'BuildingElementTransparent' &&
      !isAdjacentLikeElement(selectedElement)
    ) {
      return;
    }

    const width =
      typeof selectedElement.width === 'number'
        ? roundToTwoDecimals(selectedElement.width)
        : (selectedElement.width ?? '');
    const height =
      typeof selectedElement.height === 'number'
        ? roundToTwoDecimals(selectedElement.height)
        : (selectedElement.height ?? '');
    const area =
      typeof selectedElement.area === 'number'
        ? roundToTwoDecimals(selectedElement.area)
        : (selectedElement.area ?? '');
    wallShared.widthInputSetValueRef.current(width);
    wallShared.heightInputSetValueRef.current(height);
    wallShared.areaInputSetValueRef.current(area);
  // wallShared.*SetValueRef are stable ref objects (useRef never changes identity)
  // — listing them is a no-op for when this effect re-runs, but satisfies
  // exhaustive-deps, which (unlike a same-component useRef) can't verify
  // stability through a property access on another hook's return value.
  }, [
    selection.id,
    selection.type,
    selectedElement,
    wallShared.areaInputSetValueRef,
    wallShared.heightInputSetValueRef,
    wallShared.widthInputSetValueRef,
  ]);

  // Surface-facing control must read pitch from the store (`selectedElement`), not only local
  // `pitch` state — they can diverge, which made re-picking 0 a no-op and mis-saved CSV.
  const horizontalPolygonControlPitch = useMemo(() => {
    if (selection.type !== 'element' || !selectedElement) return wallShared.pitch;
    if (!isAdjacentLikeElement(selectedElement) || getElementShape(selectedElement) !== 'polygon') {
      return wallShared.pitch;
    }
    const p = (selectedElement as { pitch?: number }).pitch;
    if (typeof p === 'number' && Number.isFinite(p)) {
      return Math.round(p);
    }
    return wallShared.pitch;
  }, [selection.type, selectedElement, wallShared.pitch]);

  // 90° is the wall/line default; a flat horizontal polygon must be 0 or 180. Heal to match parse/export.
  useLayoutEffect(() => {
    if (selection.type !== 'element' || !selection.id) return;
    const el = getElementById(selection.id);
    if (!el || !isAdjacentLikeElement(el)) return;
    if (getElementShape(el) !== 'polygon') return;
    const p = (el as { pitch?: number }).pitch;
    if (typeof p !== 'number' || !Number.isFinite(p)) return;
    const coords = (el as { coordinates?: Array<{ x: number; y: number; z: number }> }).coordinates;
    const healed = normalizeHorizontalAdjacentPlanPitch(p, coords);
    if (healed !== undefined && healed !== p) {
      updateElement(el.id, { pitch: healed });
    }
  }, [selection.id, selection.type, getElementById, updateElement, selectedElement]);

  const derivedPolygonArea = useMemo((): number => {
    if (!selectedElement?.coordinates || selectedElement.coordinates.length < 3) return 0;
    try { return roundToTwoDecimals(calculatePolygonArea(selectedElement.coordinates)); } catch { return 0; }
  }, [selectedElement]);

  const liveWidthValue = parseLiveDecimalInput(wallShared.widthInput.inputValue);
  const liveHeightValue = parseLiveDecimalInput(wallShared.heightInput.inputValue);
  const liveRectArea = useMemo(
    () => roundToTwoDecimals(liveWidthValue * liveHeightValue),
    [liveWidthValue, liveHeightValue],
  );
  const selectedSlopedDimensions = useMemo(() => {
    if (!selectedElement || selectedShape !== 'sloped-polygon') return null;
    if (
      selectedElement.type !== 'BuildingElementOpaque' &&
      selectedElement.type !== 'BuildingElementTransparent' &&
      !ADJACENT_LIKE_ELEMENT_TYPES.includes(selectedElement.type)
    ) {
      return null;
    }
    return deriveSlopedElementDimensions(
      { ...selectedElement, pitch: wallShared.pitch },
      geometryStore.getState().globalOrientationOffset,
    );
  }, [selectedElement, selectedShape, wallShared.pitch, geometryStore]);
  const selectedSlopedDimensionNotes = useMemo(() => {
    if (!selectedElement || !selectedSlopedDimensions) return null;
    const semantics = getPolygonScalarDimensionSemantics(
      selectedElement.coordinates,
      selectedSlopedDimensions.width,
    );
    if (!isOrientationPitchAxis(selectedElement) && !semantics?.usesEquivalentWidth) return null;
    return {
      width: 'Width is equivalent: surface area divided by height, preserving area for tapered shapes.',
      height: 'Height is the true up-slope length of this sloped shape.',
    };
  }, [selectedElement, selectedSlopedDimensions]);
  const showSlopedWidthReset =
    !!selectedSlopedDimensions &&
    !!selectedElement &&
    (selectedElement as { _widthUserOverride?: boolean })._widthUserOverride === true &&
    Math.abs(liveWidthValue - selectedSlopedDimensions.width) > 0.01;
  const showSlopedHeightReset =
    !!selectedSlopedDimensions &&
    !!selectedElement &&
    (selectedElement as { _heightUserOverride?: boolean })._heightUserOverride === true &&
    Math.abs(liveHeightValue - selectedSlopedDimensions.height) > 0.01;
  const resetSlopedWidthToCanvas = useCallback(() => {
    if (!selectedSlopedDimensions) return;
    wallShared.widthInput.setValue(selectedSlopedDimensions.width);
    commitExistingElementDraftRef.current({
      width: selectedSlopedDimensions.width,
      _widthUserOverride: false,
    } as Partial<Element>);
  }, [commitExistingElementDraftRef, selectedSlopedDimensions, wallShared.widthInput]);
  const resetSlopedHeightToCanvas = useCallback(() => {
    if (!selectedSlopedDimensions) return;
    wallShared.heightInput.setValue(selectedSlopedDimensions.height);
    commitExistingElementDraftRef.current({
      height: selectedSlopedDimensions.height,
      _heightUserOverride: false,
    } as Partial<Element>);
  }, [commitExistingElementDraftRef, selectedSlopedDimensions, wallShared.heightInput]);

  const unheatedPitchedRoofCeilingElevationSuggestion = useMemo(() => {
    if (!selectedElement || selectedElement.type !== 'BuildingElementOpaque') return null;
    const draftRoof = {
      ...selectedElement,
      pitch: wallShared.pitch,
      base_height: typeof wallShared.baseHeightInput.value === 'number'
        ? wallShared.baseHeightInput.value
        : selectedElement.base_height,
      is_unheated_pitched_roof: true,
      extra_json: mergeUnheatedPitchedRoofCeilingElevationExtraJson(selectedElement.extra_json, ''),
    } as BuildingElementOpaque;
    return getUnheatedPitchedRoofCeilingElevationM(
      draftRoof,
      allElements,
      withEffectiveStoreyHeights(floors, allElements),
    );
  }, [selectedElement, wallShared.pitch, wallShared.baseHeightInput.value, allElements, floors]);

  const canUseWallShape = useMemo(() => {
    if (!selectedElement || selectedShape !== 'line') return false;
    const t = selectedElement.type;
    if (
      t !== 'BuildingElementOpaque'
      && t !== 'BuildingElementTransparent'
      && !ADJACENT_LIKE_ELEMENT_TYPES.includes(t)
    ) {
      return false;
    }
    // A dormer anchor carries `dormer_bundle`, so this also excludes it.
    const ex = readExtraJsonRecord(selectedElement.extra_json);
    return !ex.dormer_bundle && readExtraJsonRecord(ex.geometry_face).kind !== 'planar-face-3d';
  }, [selectedElement, selectedShape]);

  const selectedWallFace = useMemo(
    () => (canUseWallShape && selectedElement ? readProfiledLineFace(selectedElement.extra_json) : null),
    [canUseWallShape, selectedElement],
  );

  const fitWallEdgeToRoofs = useCallback(
    (edge: 'top' | 'bottom', limit: ProfilePoint[]) => (selectedElement
      ? deriveWallEdgeFromRoofs(
        selectedElement,
        allElements,
        withEffectiveStoreyHeights(floors, allElements),
        geometryStore.getState().globalOrientationOffset,
        edge,
        limit,
      )
      : null),
    [selectedElement, allElements, floors, geometryStore],
  );

  /** Commits a wall shape edit: a profiled face with its synced scalars, or a plain height. */
  const applyWallShape = useCallback(
    (next: WallShapeCommit) => {
      if (!isExistingSelection) return;
      const el = getElementById(selection.id);
      if (!el) return;
      const extra = { ...readExtraJsonRecord(el.extra_json) };
      if ('face' in next) extra.geometry_face = next.face;
      else delete extra.geometry_face;
      const draft = { ...el, extra_json: extra, ...('flatHeight' in next ? { height: next.flatHeight } : {}) } as Element;
      if (!isAreaBasedExportElement(draft)) return;
      const globalOrientationOffset = geometryStore.getState().globalOrientationOffset;
      const exp = getAreaBasedElementExportGeometry(draft, globalOrientationOffset);
      const patch: Partial<Element> = {
        extra_json: extra,
        width: exp.width,
        height: exp.height,
        area: roundToTwoDecimals(getElementGrossArea(draft, globalOrientationOffset)),
      };
      const midHeight = draft.type === 'BuildingElementTransparent'
        ? getTransparentExportMidHeight(draft as BuildingElementTransparent, globalOrientationOffset)
        : undefined;
      commitExistingElementDraftRef.current(midHeight === undefined ? patch : { ...patch, mid_height: midHeight } as Partial<Element>);
      wallShared.widthInput.setValue(exp.width);
      wallShared.heightInput.setValue(exp.height);
      if (midHeight !== undefined) transparentMidHeightInput.setValue(midHeight);
    },
    [
      commitExistingElementDraftRef,
      selection,
      isExistingSelection,
      getElementById,
      wallShared.widthInput,
      wallShared.heightInput,
      transparentMidHeightInput,
      geometryStore,
    ],
  );

  const wallShapeAvailable = canUseWallShape && isExistingSelection;
  // A wall with a stored face keeps the section open: collapsing it would hide its shape.
  const wallShapeExpanded = wallShapeAvailable && (wallShapeOpen || !!selectedWallFace);
  const wallShapeToggle =
    wallShapeAvailable && !selectedWallFace ? (
      <button
        type="button"
        className="btn btn-ghost btn-sm element-editor-input-action"
        onClick={() => setWallShapeOpen((open) => !open)}
        aria-expanded={wallShapeExpanded}
        style={{ whiteSpace: 'nowrap', alignSelf: 'center' }}
      >
        Shape
      </button>
    ) : null;

  const renderLinearDimensionsFields = (
    fieldRef: (fieldKey: string) => (el: HTMLDivElement | null) => void,
    options: { widthStep: string; heightStep: string; includeWallShape?: boolean },
  ) => {
    const widthValidation = getFieldValidationState('width', liveWidthValue);
    const heightValidation = getFieldValidationState('height', liveHeightValue);
    const heightField = (
      <>
        <StandardInput
          {...decimalInputProps(wallShared.heightInput)}
          unit={fieldUnit('height')}
          step={options.heightStep}
          min="0"
          variant="ghost"
          size="md"
          className="flex-1"
        />
        {showSlopedHeightReset ? (
          <ResetFieldButton
            align="inline"
            title={`Use shape-calculated sloped height (${selectedSlopedDimensions?.height ?? ''} m)`}
            ariaLabel="Use shape calculated height"
            label="Use shape calculated"
            onClick={resetSlopedHeightToCanvas}
          />
        ) : null}
        {options.includeWallShape ? wallShapeToggle : null}
        <FieldValidationIndicator
          hasIssue={!!heightValidation}
          issue={heightValidation?.message}
          variant={heightValidation?.variant}
        />
      </>
    );
    return (
      <>
        {renderFieldLabel('Width (m):', elementType, 'width')}
        <div
          className="element-input"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          ref={fieldRef('width')}
        >
          <StandardInput
            {...decimalInputProps(wallShared.widthInput)}
            unit={fieldUnit('width')}
            step={options.widthStep}
            min="0"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          {showSlopedWidthReset ? (
            <ResetFieldButton
              align="inline"
              title={`Use shape-calculated sloped width (${selectedSlopedDimensions?.width ?? ''} m)`}
              ariaLabel="Use shape calculated width"
              label="Use shape calculated"
              onClick={resetSlopedWidthToCanvas}
            />
          ) : null}
          <FieldValidationIndicator
            hasIssue={!!widthValidation}
            issue={widthValidation?.message}
            variant={widthValidation?.variant}
          />
        </div>
        {selectedSlopedDimensionNotes?.width ? (
          <div style={INLINE_FIELD_NOTE_STYLE}>
            {selectedSlopedDimensionNotes.width}
          </div>
        ) : null}
        {options.includeWallShape && wallShapeExpanded && selectedElement ? (
          <WallShapeRows
            key={selectedElement.id}
            widthM={Math.hypot(
              selectedElement.coordinates[1].x - selectedElement.coordinates[0].x,
              selectedElement.coordinates[1].y - selectedElement.coordinates[0].y,
            )}
            face={selectedWallFace}
            height={(selectedElement as { height?: number }).height ?? 0}
            topRef={fieldRef('height')}
            roofModes={selectedElement.type !== 'BuildingElementTransparent'}
            fitRoof={fitWallEdgeToRoofs}
            roofEndsAtM={wallLeavesRoofsAtM(selectedElement, allElements)}
            onCommit={applyWallShape}
          >
            {heightField}
          </WallShapeRows>
        ) : (
          <>
            {renderFieldLabel('Height (m):', elementType, 'height')}
            <div
              className="element-input"
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              ref={fieldRef('height')}
            >
              {heightField}
            </div>
          </>
        )}
        {selectedSlopedDimensionNotes?.height ? (
          <div style={INLINE_FIELD_NOTE_STYLE}>
            {selectedSlopedDimensionNotes.height}
          </div>
        ) : null}
      </>
    );
  };

  return {
    horizontalPolygonControlPitch,
    derivedPolygonArea,
    liveWidthValue,
    liveHeightValue,
    liveRectArea,
    selectedSlopedDimensions,
    unheatedPitchedRoofCeilingElevationSuggestion,
    renderLinearDimensionsFields,
  };
}
