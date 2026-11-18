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

import React, { useCallback, useEffect, useMemo, type MutableRefObject, type ReactNode } from 'react';
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
import { outlineSummary, readProfiledLineFace, type ProfilePoint } from '../../lib/profileLineFace';
import { deriveWallEdgeFromRoofs, isRoofSnapshotStale, wallLeavesRoofsAtM } from '../../lib/wallEdgeFromRoofs';
import { getStoreyHeight, isStoreyHeightWall, withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import { fhsFloorCodeForCanvasFloor } from '../../lib/storeySemantics';
import { openFloorPicker } from '../../lib/fieldSource';
import type { GeometryStoreApi } from '../../stores/geometryStore';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { ResetFieldButton } from '../ResetFieldButton';
import { DerivedSource, Readout, SourceNote } from '../FieldSource';
import { WallShapeRows, type WallShapeCommit } from '../WallShapeRows';
import {
  decimalInputProps,
  parseLiveDecimalInput,
  readExtraJsonRecord,
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
  geometryStore: GeometryStoreApi;
  allElements: Element[];
  floors: Floor[];
  commitExistingElementDraftRef: MutableRefObject<(overrides?: Partial<Element>) => void>;
  elementType: ElementType;
  renderFieldLabel: (fieldLabel: string, targetElementType?: string, evidenceFieldKey?: string, source?: ReactNode) => ReactNode;
  fieldUnit: (fieldKey: string) => string | undefined;
  getFieldValidationState: (
    fieldName: string,
    value: unknown,
  ) => { message: string; variant: 'error' | 'warning' } | null;
}) {
  const isExistingSelection = (selection.type === 'element' || selection.type === 'global');
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
    // 90° is the wall/line default; a flat horizontal polygon reads 0 or 180, as parse and export
    // normalise it. Shown, not written: selecting never writes.
    const p = normalizeHorizontalAdjacentPlanPitch((selectedElement as { pitch?: number }).pitch, selectedElement.coordinates);
    if (typeof p === 'number' && Number.isFinite(p)) {
      return Math.round(p);
    }
    return wallShared.pitch;
  }, [selection.type, selectedElement, wallShared.pitch]);

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
  const wallShapeExpanded = wallShapeAvailable && wallShapeOpen;
  // "Outline · Rectangle": a disclosure of the shape rows (Top and Bottom), closed until asked.
  // Closed, it also says when a roof-fitted edge no longer fits its roof (the rows offer Re-fit).
  const roofChanged = !wallShapeExpanded && !!selectedWallFace && (['top', 'bottom'] as const).some((edge) =>
    selectedWallFace[`${edge}_mode`] === 'roof' && isRoofSnapshotStale(
      selectedWallFace[`${edge}_profile`],
      fitWallEdgeToRoofs(edge, edge === 'top' ? selectedWallFace.bottom_profile : selectedWallFace.top_profile)?.profile ?? null,
    ));
  const wallShapeToggle =
    wallShapeAvailable ? (
      <div className="field-source-note">
        <button
          type="button"
          className="btn btn-ghost btn-sm outline-disclosure"
          onClick={() => setWallShapeOpen((open) => !open)}
          aria-expanded={wallShapeExpanded}
        >
          {`Outline · ${outlineSummary(selectedWallFace)}${roofChanged ? ' · roof changed' : ''}`}
          <span aria-hidden="true" className="outline-disclosure-chevron">{wallShapeExpanded ? '▾' : '▸'}</span>
        </button>
      </div>
    ) : null;

  // With an outline the width is the drawn line's (the outline sets the area), so it reads as text.
  const widthReadout = selectedWallFace ? <Readout value={wallShared.widthInput.value} unit="m" label="Width" /> : null;
  // A sloped surface's width and height come from its drawn shape until typed over (authored markers).
  const slopedSource = (dimension: 'width' | 'height') => {
    if (!selectedSlopedDimensions) return undefined;
    const overridden = dimension === 'width' ? showSlopedWidthReset : showSlopedHeightReset;
    if (!overridden) return <SourceNote>from the drawing</SourceNote>;
    const shown = `${selectedSlopedDimensions[dimension]} m`;
    return (
      <ResetFieldButton
        align="note"
        title={`Use the drawing: ${shown}`}
        ariaLabel={`${dimension === 'width' ? 'Width' : 'Height'}: use the drawing, ${shown}`}
        label={`Use the drawing: ${shown}`}
        onClick={dimension === 'width' ? resetSlopedWidthToCanvas : resetSlopedHeightToCanvas}
      />
    );
  };

  // A straight wall's height comes from its storey (the floor picker's Height) until typed over.
  const storeyZ = selectedElement && !selectedSlopedDimensions && isStoreyHeightWall(selectedElement)
    ? Math.floor(selectedElement.coordinates[0]?.z ?? 0)
    : null;
  const storeyHeight = useMemo(
    () => (storeyZ === null || !selectedElement
      ? 0
      : getStoreyHeight(storeyZ, floors, allElements)),
    [storeyZ, selectedElement, floors, allElements],
  );
  const followsStorey = storeyHeight > 0 && Math.abs(liveHeightValue - storeyHeight) <= 0.005;
  const useStoreyHeight = useCallback((height: number) => {
    wallShared.heightInput.setValue(height);
    commitExistingElementDraftRef.current({ height } as Partial<Element>);
  }, [commitExistingElementDraftRef, wallShared.heightInput]);
  const heightSource = slopedSource('height') ?? (storeyZ !== null && storeyHeight > 0 ? (
    <DerivedSource
      derived={storeyHeight}
      current={liveHeightValue}
      info={<SourceNote link={fhsFloorCodeForCanvasFloor(storeyZ)} onGo={openFloorPicker} title="Open the floor picker">from the storey ·</SourceNote>}
      useLabel="Use storey"
      unit="m"
      fieldLabel="Height"
      onUse={useStoreyHeight}
    />
  ) : undefined);

  const renderLinearDimensionsFields = (
    fieldRef: (fieldKey: string) => (el: HTMLDivElement | null) => void,
    options: {
      widthStep: string;
      heightStep: string;
      includeWallShape?: boolean;
      /** A window's sill: width, height and sill share one row. */
      sill?: { label: ReactNode; field: ReactNode };
    },
  ) => {
    const widthValidation = getFieldValidationState('width', liveWidthValue);
    const heightValidation = getFieldValidationState('height', liveHeightValue);
    if (options.sill && !(options.includeWallShape && wallShapeExpanded)) {
      const cell = (key: string, label: ReactNode, field: ReactNode) => (
        <div key={key} style={{ display: 'grid', gap: 4, minWidth: 0 }} ref={fieldRef(key)}>
          {label}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{field}</div>
        </div>
      );
      return (
        <>
          <div data-window-size-row style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            {cell('width', renderFieldLabel('Width (m):', elementType, 'width', selectedWallFace ? <SourceNote>from the drawing</SourceNote> : slopedSource('width')), <>
              {widthReadout ?? <StandardInput {...decimalInputProps(wallShared.widthInput)} unit={fieldUnit('width')} step={options.widthStep} min="0"
                variant="ghost" size="md" className="flex-1" aria-label="Width" />}
              <FieldValidationIndicator hasIssue={!!widthValidation} issue={widthValidation?.message} variant={widthValidation?.variant} />
            </>)}
            {cell('height', renderFieldLabel('Height (m):', elementType, 'height', heightSource), <>
              <StandardInput {...decimalInputProps(wallShared.heightInput)} unit={fieldUnit('height')} step={options.heightStep} min="0"
                variant="ghost" size="md" className="flex-1" aria-label="Height" disabled={!!selectedWallFace} title={selectedWallFace ? 'Set by the outline' : undefined} />
              <FieldValidationIndicator hasIssue={!!heightValidation} issue={heightValidation?.message} variant={heightValidation?.variant} />
            </>)}
            {cell('base_height', options.sill.label, options.sill.field)}
          </div>
          {options.includeWallShape ? wallShapeToggle : null}
        </>
      );
    }
    const heightField = (
      <>
        <StandardInput
          {...decimalInputProps(wallShared.heightInput)}
          unit={fieldUnit('height')}
          step={options.heightStep}
          min="0"
          variant="ghost"
          size="md"
          className={(selectedSlopedDimensions && !showSlopedHeightReset) || followsStorey ? 'flex-1 field-value--source' : 'flex-1'}
          disabled={!!selectedWallFace} title={selectedWallFace ? 'Set by the outline' : undefined}
        />
        <FieldValidationIndicator
          hasIssue={!!heightValidation}
          issue={heightValidation?.message}
          variant={heightValidation?.variant}
        />
      </>
    );
    return (
      <>
        {renderFieldLabel('Width (m):', elementType, 'width', selectedWallFace ? <SourceNote>from the drawing</SourceNote> : slopedSource('width'))}
        <div
          className="element-input"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          ref={fieldRef('width')}
        >
          {widthReadout ?? <StandardInput
            {...decimalInputProps(wallShared.widthInput)}
            unit={fieldUnit('width')}
            step={options.widthStep}
            min="0"
            variant="ghost"
            size="md"
            className={selectedSlopedDimensions && !showSlopedWidthReset ? 'flex-1 field-value--source' : 'flex-1'}
            aria-label="Width"
          />}
          <FieldValidationIndicator
            hasIssue={!!widthValidation}
            issue={widthValidation?.message}
            variant={widthValidation?.variant}
          />
        </div>
        {selectedSlopedDimensionNotes?.width ? (
          <div className="field-source-note">
            {selectedSlopedDimensionNotes.width}
          </div>
        ) : null}
        {options.includeWallShape ? wallShapeToggle : null}
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
            {renderFieldLabel('Height (m):', elementType, 'height', heightSource)}
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
          <div className="field-source-note">
            {selectedSlopedDimensionNotes.height}
          </div>
        ) : null}
        {options.sill ? <>
          {options.sill.label}
          <div className="element-input" style={{ display: 'flex', alignItems: 'center', gap: '8px' }} ref={fieldRef('base_height')}>{options.sill.field}</div>
        </> : null}
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
