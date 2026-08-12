// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// BuildingElementOpaque (external/internal walls, roofs, floors as opaque
// fabric) — extracted from ElementCreator's five inline structures (slice-6
// brief, STAGE 4). DORMER EXCLUDED (slice-6 brief decision 2, stage 5
// territory) — see the "THE DORMER SEAM" section below.

// THE DORMER SEAM (decision 2)
// ─────────────────────────────
// Legacy's `case 'BuildingElementOpaque':` render branch opened with
// `return selectedIsDormerAnchor ? (<dormer editor JSX>) : (<normal Opaque
// fields>);`. The dormer side writes across the Opaque anchor AND its
// Transparent siblings (regenerateDormerAnchor + the per-sibling loop) and
// reads/writes eight dormer-draft inputs plus dormerAssemblySection/
// selectedDormerType/dormerDepth/dormerRoofIsUnheatedPitchedRoof — none of
// which any module owns or should own (no single module may own dormer
// bundle machinery — it isn't Opaque's alone, it's the anchor+siblings'
// jointly). Per decision 2, that whole branch is now
// `ElementFormRenderCtx.renderDormerBundleEditor: () => ReactNode` — an
// orchestrator-owned callback (same shape as renderMvhrDuctAndTerminalManager
// / renderSpaceHeatSystemPicker) wrapping the *exact* JSX legacy's ternary
// true-branch had, moved verbatim as a closure over the same orchestrator
// locals (dormer draft inputs, commitDormerAnchorChanges, wallShared,
// selection, elementType/elementZoneId) — zero behaviour change, zero of
// those locals touched or deleted (see ElementCreator.tsx's diff for the
// closure body itself).
//
// HOW selectedIsDormerAnchor REACHES THIS MODULE: no new boolean ctx field.
// `isDormerAnchorElement` (lib/dormerGeometry.ts) is already an exported pure
// type-guard predicate, and `ElementFormRenderCtx.selectedElement` already
// carries the exact same value the orchestrator's own `selectedIsDormerAnchor`
// local is computed from (`isDormerAnchorElement(selectedElement)` — see
// ElementCreator.tsx's own definition, unchanged). This module simply calls
// `isDormerAnchorElement(ctx.selectedElement)` itself in renderPanel — same
// value, zero new ctx surface, "thread minimally" per the brief. The
// orchestrator's own `selectedIsDormerAnchor` local stays exactly as-is; it
// has many other consumers unrelated to this module (name-editing guards,
// profile-top gating, the assembly-calculator bridge, etc.).

import { useState, type CSSProperties } from 'react';
import { roundToTwoDecimals } from '../../geometry/constants';
import { isExternalLineWall } from '../../geometry/thermalBridge/proposeExternalCorners';
import {
  getElementGrossArea,
  getOpaqueOpeningArea,
  isUnheatedPitchedRoofPlanAreaElement,
} from '../../lib/elementArea';
import { findLinkedBasementGroundForLineElement } from '../../lib/basementGeometry';
import { findSuspendedGroundSurfaceForLineElement } from '../../lib/suspendedFloorGeometry';
import { isDormerAnchorElement } from '../../lib/dormerGeometry';
import {
  mergeUnheatedPitchedRoofCeilingElevationExtraJson,
  readAuthoredUnheatedPitchedRoofCeilingElevationM,
  UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY,
  type UnheatedPitchedRoofCeilingElevationSource,
} from '../../lib/unheatedPitchedRoofCeiling';
import { ParentElementDropdown } from '../ParentElementDropdown';
import { ResetFieldButton } from '../ResetFieldButton';
import { StandardInput } from '../StandardInput';
import type { Element } from '../../geometry/types';
import {
  decimalInputProps,
  useDecimalInput,
  type NumericDraftInputBinding,
} from './formPrimitives';
import { hydrateWallSharedFields } from './wallShared';
import { renderWallPitchField } from './wallPitchField';
import type {
  ElementFormModule,
  ElementFormSelection,
  ElementFormStateCtx,
} from './types';

// Duplicated from ElementCreator.tsx — see buildingElementGround.tsx's
// header for why these small style/pure-formatting constants are
// duplicated per-module rather than imported (other callers left behind in
// ElementCreator.tsx, so they couldn't just move).
const INLINE_FIELD_NOTE_STYLE: CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-secondary)',
  lineHeight: 1.35,
  minWidth: 0,
};

const formatToTwoDecimals = (value: number | string | undefined): string => {
  if (value === undefined || value === null || value === '') return '0.00';
  const num = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
};

// Opaque's own render-only label formatter for the ceiling-elevation
// suggestion note — moved verbatim from ElementCreator.tsx (its only
// consumer was this module's own field). Pure formatting, no orchestrator
// state.
function unheatedPitchedRoofCeilingElevationSourceLabel(
  source: UnheatedPitchedRoofCeilingElevationSource,
): string {
  switch (source) {
    case 'authored':
      return 'manual';
    case 'wall-top':
      return 'wall tops';
    case 'storey-ceiling':
      return 'floor stack';
    case 'roof-base':
      return 'roof base';
  }
}

export interface BuildingElementOpaqueFormState {
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
  /** Captured from ElementFormStateCtx so hydrate() (which doesn't receive
   * ctx) can still seed orientation360 via hydrateWallSharedFields — same
   * threading precedent as buildingElementTransparent.tsx's
   * getCurrentOrientation. Unlike Transparent, Opaque's own render never
   * falls back to this (legacy's orientation360 display used a bare `0`
   * fallback, not getCurrentOrientation) — hydrate-only consumer here. */
  getCurrentOrientation: (element: Element) => number;
  /** Opaque-exclusive state (slice-6 brief decision 7). */
  isUnheatedPitchedRoof: boolean;
  setIsUnheatedPitchedRoof: (value: boolean) => void;
  isExternalDoor: boolean;
  setIsExternalDoor: (value: boolean) => void;
  unheatedPitchedRoofCeilingElevationInput: NumericDraftInputBinding;
}

function useFormState(ctx: ElementFormStateCtx): BuildingElementOpaqueFormState {
  const isExistingElementSelection = (): boolean =>
    !!ctx.selection && (ctx.selection.type === 'element' || ctx.selection.type === 'global') && !ctx.selection.isPlaceholder;

  const commitUnheatedPitchedRoofCeilingElevation = (value: number | '') => {
    if (!isExistingElementSelection()) return;
    const currentSelection = ctx.selection as ElementFormSelection;
    const element = ctx.getElementById(currentSelection.id);
    if (!element || element.type !== 'BuildingElementOpaque') return;
    ctx.commitExistingElementDraft({
      extra_json: mergeUnheatedPitchedRoofCeilingElevationExtraJson(element.extra_json, value),
    } as Partial<Element>);
  };
  const unheatedPitchedRoofCeilingElevationInput = useDecimalInput(
    '',
    commitUnheatedPitchedRoofCeilingElevation,
    { commitOnChange: true },
  );

  const [isUnheatedPitchedRoof, setIsUnheatedPitchedRoof] = useState<boolean>(false);
  const [isExternalDoor, setIsExternalDoor] = useState<boolean>(false);

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
    isUnheatedPitchedRoof,
    setIsUnheatedPitchedRoof,
    isExternalDoor,
    setIsExternalDoor,
    unheatedPitchedRoofCeilingElevationInput,
  };
}

export const buildingElementOpaqueFormModule: ElementFormModule<BuildingElementOpaqueFormState> = {
  type: 'BuildingElementOpaque',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'BuildingElementOpaque') return;
    // Shared Opaque/Transparent prefix, factored once — see
    // wallShared.tsx's hydrateWallSharedFields header for the full "risky
    // seam" writeup.
    hydrateWallSharedFields(state, element, state.getCurrentOrientation);

    state.setIsUnheatedPitchedRoof(!!element.is_unheated_pitched_roof);
    state.setIsExternalDoor(!!element.is_external_door);
    state.unheatedPitchedRoofCeilingElevationInput.setValue(
      readAuthoredUnheatedPitchedRoofCeilingElevationM(element) ?? '',
    );
    // The dormer-metadata hydrate block (setSelectedDormerType,
    // lateNumericInputSettersRef.current.dormer*, etc.) stays orchestrator-
    // side, called right after this — dormer bundle machinery, decision 2 /
    // stage 5. See ElementCreator.tsx's own selection-hydrate effect.
  },

  reset(state) {
    state.setIsUnheatedPitchedRoof(false);
    state.setIsExternalDoor(false);
    state.unheatedPitchedRoofCeilingElevationInput.setValue('');
  },

  buildElementData(state, ctx) {
    const width = state.widthInput.value;
    const height = state.heightInput.value;
    const coldRoofCeilingExtraJson =
      state.isUnheatedPitchedRoof && typeof state.unheatedPitchedRoofCeilingElevationInput.value === 'number'
        ? mergeUnheatedPitchedRoofCeilingElevationExtraJson(
            undefined,
            state.unheatedPitchedRoofCeilingElevationInput.value,
          )
        : undefined;
    return {
      ...ctx.baseData,
      width,
      height,
      area: typeof width === 'number' && typeof height === 'number' ? width * height : undefined,
      pitch: state.pitch,
      orientation360: Math.round(state.orientation360 ?? 0),
      base_height: state.baseHeightInput.value === '' ? undefined : state.baseHeightInput.value,
      is_unheated_pitched_roof: state.isUnheatedPitchedRoof,
      is_external_door: state.isExternalDoor,
      parent_element: state.parentElement,
      ...(coldRoofCeilingExtraJson ? { extra_json: coldRoofCeilingExtraJson } : {}),
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const {
      elementType,
      selection,
      elementsById,
      elementIds,
      commitExistingElementDraft,
      renderFieldLabel,
      renderFieldLabelWithComparisonIndicator,
      registerBaseFieldRefs,
      registerBaseFieldRef,
      comparisonFieldIndicators,
      fieldUnit,
      selectedElement,
      selectedShape,
      derivedPolygonArea,
      liveRectArea,
      derivedBaseHeight,
      renderLinearDimensionsFields,
      applyHostedParentElement,
      elementZoneId,
      flipElementOrientation,
      unheatedPitchedRoofCeilingElevationSuggestion,
      renderDormerBundleEditor,
    } = ctx;

    // Decision 2's seam: same predicate the orchestrator's own
    // selectedIsDormerAnchor is computed from, reused directly (see module
    // header). The dormer editor itself is entirely orchestrator-owned.
    // Read into a plain boolean rather than branching on the type-guard call
    // directly — isDormerAnchorElement's `element is BuildingElementOpaque`
    // signature would otherwise make TS narrow selectedElement to EXCLUDE
    // BuildingElementOpaque entirely for the rest of this function (a
    // dormer anchor is only a subset of Opaque elements; non-dormer Opaque
    // elements must still fall through below).
    const isDormerAnchor: boolean = isDormerAnchorElement(selectedElement);
    if (isDormerAnchor) {
      return renderDormerBundleEditor();
    }

    // Opaque-exclusive derived render values (decision 7) — computed inline
    // (no useMemo: renderPanel is a plain function, not a hook, called
    // conditionally by ElementCreator's own switch — same precedent
    // buildingElementTransparent.tsx's header documents for its own inline
    // sloped-rebuild derivations).
    const selectedOpaqueAreaSummary = (() => {
      if (!selectedElement || selectedElement.type !== 'BuildingElementOpaque') return null;
      const draftElement = { ...selectedElement, pitch: state.pitch } as Element;
      const grossArea = selectedShape === 'polygon' || selectedShape === 'sloped-polygon'
        ? getElementGrossArea(draftElement)
        : liveRectArea;
      const subtractedArea = getOpaqueOpeningArea(selectedElement, elementsById);
      const clampedNet = Math.max(0, grossArea - subtractedArea);
      return {
        grossArea: roundToTwoDecimals(grossArea),
        netArea: roundToTwoDecimals(clampedNet),
        subtractedArea: roundToTwoDecimals(subtractedArea),
        usesUnheatedPitchedRoofPlanArea: isUnheatedPitchedRoofPlanAreaElement(draftElement),
      };
    })();

    const canMarkUnheatedPitchedRoof = elementType === 'BuildingElementOpaque' && selectedShape === 'sloped-polygon';
    const canMarkExternalDoor = elementType === 'BuildingElementOpaque'
      && selectedShape === 'line'
      && typeof state.pitch === 'number'
      && Number.isFinite(state.pitch)
      && Math.round(state.pitch) === 90;

    // baseHeightResetTarget needs the full element array (for the suspended-
    // floor / basement lookahead helpers) — derived from elementIds/
    // elementsById the same way the orchestrator itself does elsewhere
    // (`elementIds.map(id => elementsById[id])`, per types.ts's own note on
    // that pattern).
    const allElements = elementIds.map((id) => elementsById[id]);
    const baseHeightResetTarget = (() => {
      if (selection?.type === 'element') {
        const el = elementsById[selection.id];
        if (el?.type === 'BuildingElementOpaque' && isExternalLineWall(el)) {
          const suspendedTarget = findSuspendedGroundSurfaceForLineElement(el, allElements);
          if (suspendedTarget) {
            return {
              value: roundToTwoDecimals(suspendedTarget.surfaceM),
              note: 'suspended floor upper surface',
              title: 'Reset to suspended floor upper surface',
            };
          }
          const basementTarget = findLinkedBasementGroundForLineElement(el, allElements);
          if (basementTarget) {
            const isUnheatedBasement = basementTarget.ground.floor_type === 'Unheated_basement';
            return {
              value: roundToTwoDecimals(basementTarget.targetBaseHeightM),
              note: isUnheatedBasement
                ? 'unheated basement wall height above ground'
                : 'basement floor surface',
              title: isUnheatedBasement
                ? 'Reset to unheated basement wall height'
                : 'Reset to basement floor surface',
            };
          }
        }
      }
      return derivedBaseHeight > 0
        ? {
            value: derivedBaseHeight,
            note: 'cumulative floor heights',
            title: 'Reset to height derived from floors below',
          }
        : null;
    })();

    const canFlipSelectedWallOrientation = (() => {
      if (selection?.type !== 'element') return false;
      if (!selectedElement || selectedElement.type !== 'BuildingElementOpaque') return false;
      if (selectedElement.parent_element || selectedElement.is_external_door === true) return false;
      if (selectedShape !== 'line') return false;
      const coordinates = selectedElement.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length !== 2) return false;
      const [start, end] = coordinates;
      return Math.hypot(end.x - start.x, end.y - start.y) > 0.01;
    })();

    return (
      <>
        {renderFieldLabel('Parent Element:', elementType, 'parent_element')}
        <div className="element-input">
          <ParentElementDropdown
            value={state.parentElement}
            onChange={(value) => applyHostedParentElement(value, null)}
            elementType={elementType}
            zoneId={elementZoneId}
            placeholder="Select a parent opaque element (optional)"
            selfId={selection?.type === 'element' ? selection.id : undefined}
          />
        </div>
        {selectedShape !== 'polygon' && (
          renderLinearDimensionsFields(registerBaseFieldRefs, {
            widthStep: '0.1',
            heightStep: '0.1',
            includeProfileTop: true,
          })
        )}
        {renderFieldLabelWithComparisonIndicator('Area (m²):', elementType, comparisonFieldIndicators.area, 'area')}
        <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRef('area')}>
          <StandardInput
            type="text"
            inputMode="numeric"
            value={formatToTwoDecimals(selectedOpaqueAreaSummary ? selectedOpaqueAreaSummary.netArea : (selectedShape === 'polygon' ? derivedPolygonArea : liveRectArea))}
            unit={fieldUnit('area')}
            readOnly
            variant="ghost"
            size="md"
          />
          {selectedOpaqueAreaSummary && (
            <div style={INLINE_FIELD_NOTE_STYLE}>
              Gross area: {formatToTwoDecimals(selectedOpaqueAreaSummary.grossArea)} m²
              {selectedOpaqueAreaSummary.subtractedArea > 0
                ? ` · Linked openings / cutouts subtracted: ${formatToTwoDecimals(selectedOpaqueAreaSummary.subtractedArea)} m²`
                : ' · No linked openings or cutouts subtracted'}
            </div>
          )}
          {selectedOpaqueAreaSummary?.usesUnheatedPitchedRoofPlanArea ? (
            <div style={INLINE_FIELD_NOTE_STYLE}>
              Exported as horizontal ceiling/plan area for this unheated pitched roof; the sloped roof surface is not the heat-loss area.
            </div>
          ) : null}
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
            // DECISION 9's parent-disable pair (see wallPitchField.tsx's
            // header) — Opaque is the only family with disabledWhenParented.
            // The party-floor extra_json cleanup that used to be this
            // caller's own second extra behaviour now lives in
            // wallShared.tsx's single shared commitTypedPitch (origin/main
            // PR #31 port), gated there on `elementType ===
            // 'BuildingElementOpaque'` — equivalent to this caller having
            // passed `cleansPartyFloorKeyOnConvert: true` under the old
            // per-caller design; see that file's header for the full
            // writeup of why the decision moved.
            disabledWhenParented: true,
            refRegistrar: registerBaseFieldRefs,
          },
        )}
        {renderFieldLabel('Orientation (degrees):', elementType, 'orientation360')}
        <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRefs('orientation360')}>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', width: '100%' }}>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <StandardInput
                type="text"
                inputMode="numeric"
                value={Number.isFinite(state.orientation360) ? state.orientation360 : 0}
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
            </div>
            {canFlipSelectedWallOrientation && (
              <button
                type="button"
                className="btn btn-ghost btn-sm element-editor-input-action"
                title="Flip orientation by 180 degrees"
                onClick={() => {
                  if (selection?.type === 'element') {
                    flipElementOrientation(selection.id);
                  }
                }}
                style={{
                  flex: '0 0 auto',
                  whiteSpace: 'nowrap',
                }}
              >
                Flip 180°
              </button>
            )}
          </div>
          {state.parentElement && (
            <div style={INLINE_FIELD_NOTE_STYLE}>
              Inherited from parent: {state.parentElement}
            </div>
          )}
        </div>
        {renderFieldLabel('Base Height (m):', elementType, 'base_height')}
        <div
          className="element-input"
          style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}
          ref={registerBaseFieldRefs('base_height')}
        >
          <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', width: '100%' }}>
            <div
              className={
                baseHeightResetTarget && typeof state.baseHeightInput.value === 'number' && Math.abs(state.baseHeightInput.value - baseHeightResetTarget.value) > 0.01
                  ? 'custom-value'
                  : ''
              }
              style={{ flex: 1 }}
            >
              <StandardInput
                {...decimalInputProps(state.baseHeightInput)}
                unit={fieldUnit('base_height')}
                step="0.01"
                min={baseHeightResetTarget && baseHeightResetTarget.value < 0 ? undefined : '0'}
                variant="ghost"
                size="md"
                className="flex-1"
                placeholder={baseHeightResetTarget ? String(baseHeightResetTarget.value) : undefined}
              />
            </div>
            {baseHeightResetTarget && typeof state.baseHeightInput.value === 'number' && Math.abs(state.baseHeightInput.value - baseHeightResetTarget.value) > 0.01 && (
              <ResetFieldButton
                onClick={() => {
                  state.baseHeightInput.setValue(baseHeightResetTarget.value);
                  commitExistingElementDraft({ base_height: baseHeightResetTarget.value });
                }}
                align="inline"
                title={baseHeightResetTarget.title}
                ariaLabel="Reset Base Height"
                label="Reset"
              />
            )}
          </div>
          {baseHeightResetTarget ? (
            <div style={INLINE_FIELD_NOTE_STYLE}>
              {typeof state.baseHeightInput.value === 'number' && Math.abs(state.baseHeightInput.value - baseHeightResetTarget.value) > 0.01
                ? `Default: ${baseHeightResetTarget.value} m · ${baseHeightResetTarget.note}`
                : `Suggested: ${baseHeightResetTarget.value} m · ${baseHeightResetTarget.note}`}
            </div>
          ) : null}
        </div>
        {canMarkUnheatedPitchedRoof ? (
          <>
            {renderFieldLabel('Unheated Pitched Roof', elementType)}
            <div className="element-input">
              <label className="checkbox-container">
                <input
                  type="checkbox"
                  className="styled-checkbox"
                  checked={!!state.isUnheatedPitchedRoof}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    state.setIsUnheatedPitchedRoof(checked);
                    if (checked) state.setIsExternalDoor(false);
                    commitExistingElementDraft({
                      is_unheated_pitched_roof: checked,
                      ...(checked ? { is_external_door: false } : {}),
                    });
                  }}
                  id="unheated-pitched-roof"
                />
                <span className="checkbox-custom"></span>
              </label>
            </div>
          </>
        ) : null}
        {canMarkUnheatedPitchedRoof && state.isUnheatedPitchedRoof ? (
          <>
            {renderFieldLabel(
              'Ceiling / heat-loss boundary elevation (m):',
              elementType,
              UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY,
            )}
            <div
              className="element-input"
              style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}
              ref={registerBaseFieldRefs([
                UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY,
                'ceiling_elevation',
              ])}
            >
              <StandardInput
                {...decimalInputProps(state.unheatedPitchedRoofCeilingElevationInput)}
                unit={fieldUnit(UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY)}
                step="0.01"
                min="0"
                variant="ghost"
                size="md"
                className="flex-1"
                placeholder={
                  unheatedPitchedRoofCeilingElevationSuggestion
                    ? String(unheatedPitchedRoofCeilingElevationSuggestion.value)
                    : undefined
                }
              />
              {unheatedPitchedRoofCeilingElevationSuggestion ? (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  Blank = automatic {unheatedPitchedRoofCeilingElevationSuggestion.value} m from {unheatedPitchedRoofCeilingElevationSourceLabel(unheatedPitchedRoofCeilingElevationSuggestion.source)}. Used for 3D and auto thermal bridges; HEM base height remains the roof-plane base.
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {canMarkExternalDoor ? (
          <>
            {renderFieldLabel('External Door', elementType)}
            <div className="element-input">
              <label className="checkbox-container">
                <input
                  type="checkbox"
                  className="styled-checkbox"
                  checked={!!state.isExternalDoor}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    state.setIsExternalDoor(checked);
                    if (checked) state.setIsUnheatedPitchedRoof(false);
                    commitExistingElementDraft({
                      is_external_door: checked,
                      ...(checked ? { is_unheated_pitched_roof: false } : {}),
                    });
                  }}
                  id="external-door"
                />
                <span className="checkbox-custom"></span>
              </label>
            </div>
          </>
        ) : null}
      </>
    );
  },
};
