// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// OnSiteGeneration form family, moved verbatim from ElementCreator's five
// inline structures, plus its OnSiteGeneration-only helpers
// (resetOnSiteDimensions / switchOnSiteOrientation / commitOnSiteDimensionField /
// commitOnSiteOrientation / commitOnSitePitchOverride /
// commitOnSiteBaseHeightOverride / resetOnSiteOrientationToHost). The legacy
// element and global hydrate branches were byte-identical (differing only in
// a comment), so one hydrate covers both. Legacy resetFormFields never reset
// this family's state; preserved as-is.
//
// Cross-references: two orchestrator functions outside the five structures
// write into this family's inputs directly — syncFloorMoveHeightInputs
// (floor-move base-height sync, shared across several families) and
// applyElementPreset (element-preset loader, shared across all element
// types). Both now write through onSiteGenerationFormState.<field>.setValue(...)
// instead of a local closure variable.
//
// The legacy commit* helpers were `useCallback`s that read the latest
// commitExistingElementDraft through a ref (commitExistingElementDraftRef) so
// their identity could stay stable without listing it as a dependency. This
// module defines them as plain functions instead (matching the Lighting
// module's precedent of calling ctx.commitExistingElementDraft directly) —
// behaviourally equivalent, since ctx is rebuilt fresh every render already
// and nothing else depends on these functions' identity.

import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Element } from '../../geometry/types';
import { roundToTwoDecimals } from '../../geometry/constants';
import { applyCompassOrientationToSlopedPolygonCoords } from '../../lib/openingSegmentOutward';
import {
  readPvFootprintFlags,
  rebuildPvRectangleFromBottomEdgeDimensions,
  DEFAULT_PV_FOOTPRINT_M,
} from '../../lib/pvPanelFootprint';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { ResetFieldButton } from '../ResetFieldButton';
import {
  decimalInputProps,
  integerInputProps,
  readExtraJsonRecord,
  useDecimalInput,
  useIntegerInput,
} from './formPrimitives';
import type { ElementFormModule, ElementFormStateCtx } from './types';

const INLINE_FIELD_NOTE_STYLE: CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-secondary)',
  lineHeight: 1.35,
  minWidth: 0,
};

function roundToInt(value: number): number {
  return Math.round(value ?? 0);
}

export interface OnSiteGenerationFormState {
  peakPowerInput: ReturnType<typeof useDecimalInput>;
  onSitePitchInput: ReturnType<typeof useDecimalInput>;
  onSiteOrientationInput: ReturnType<typeof useIntegerInput>;
  onSiteBaseHeightInput: ReturnType<typeof useDecimalInput>;
  onSiteWidthInput: ReturnType<typeof useDecimalInput>;
  onSiteHeightInput: ReturnType<typeof useDecimalInput>;
  /** Passed through from ElementFormStateCtx so hydrate (which the module
   * contract calls with no ctx) can still compute orientation the same way
   * the orchestrator's shared getCurrentOrientation does. */
  getCurrentOrientation: (element: Element) => number;
}

function useFormState(ctx: ElementFormStateCtx): OnSiteGenerationFormState {
  const peakPowerInput = useDecimalInput('', ctx.commitElementNumericField('peak_power'), { commitOnChange: true });

  const commitOnSitePitchOverride = (value: number | '') => {
    ctx.commitExistingElementDraft({
      pitch: value,
      _pitchUserOverride: true,
    } as Partial<Element>);
  };
  const onSitePitchInput = useDecimalInput('', commitOnSitePitchOverride, { commitOnChange: true });

  /** Sloped PV/roof: typing orientation rotates the polygon in plan (like walls). Flat or degenerate: store only. */
  const commitOnSiteOrientation = (value: number | '') => {
    if (!ctx.selection?.id || (ctx.selection.type !== 'element' && ctx.selection.type !== 'global')) {
      ctx.commitExistingElementDraft({ orientation360: value } as Partial<Element>);
      return;
    }
    if (value === '') {
      ctx.commitExistingElementDraft({ orientation360: '' } as Partial<Element>);
      return;
    }
    const el = ctx.getElementById(ctx.selection.id);
    if (!el || el.type !== 'OnSiteGeneration') {
      ctx.commitExistingElementDraft({ orientation360: value } as Partial<Element>);
      return;
    }
    const pitch = (el as { pitch?: number }).pitch ?? 0;
    const coords = el.coordinates || [];
    // Manual orientation edits on a hosted panel must mark the field as overridden so the
    // store hook does not re-derive from the host on the coordinate-rotation that follows.
    if (pitch > 0 && pitch < 90 && coords.length >= 3) {
      const globalOffset = ctx.getGlobalOrientationOffset();
      const next = applyCompassOrientationToSlopedPolygonCoords(
        coords as Array<{ x: number; y: number; z: number }>,
        value,
        globalOffset,
      );
      if (next) {
        ctx.updateElement(ctx.selection.id, {
          coordinates: next,
          _orientationUserOverride: true,
        } as Partial<Element>);
        return;
      }
    }
    ctx.commitExistingElementDraft({
      orientation360: value,
      _orientationUserOverride: true,
    } as Partial<Element>);
  };
  const onSiteOrientationInput = useIntegerInput('', commitOnSiteOrientation, { commitOnChange: true });

  const commitOnSiteBaseHeightOverride = (value: number | '') => {
    ctx.commitExistingElementDraft({
      base_height: value,
      _baseHeightUserOverride: true,
    } as Partial<Element>);
  };
  const onSiteBaseHeightInput = useDecimalInput('', commitOnSiteBaseHeightOverride, { commitOnChange: true });

  const commitOnSiteDimensionField = (field: 'width' | 'height') => (value: number | '') => {
    if (!ctx.selection?.id || (ctx.selection.type !== 'element' && ctx.selection.type !== 'global')) {
      return;
    }
    const el = ctx.getElementById(ctx.selection.id) as any;
    if (!el || el.type !== 'OnSiteGeneration') {
      ctx.updateElement(ctx.selection.id, { [field]: value } as Partial<Element>);
      return;
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      ctx.updateElement(ctx.selection.id, { [field]: value } as Partial<Element>);
      return;
    }

    const nextWidth =
      field === 'width'
        ? value
        : typeof onSiteWidthInput.value === 'number' && onSiteWidthInput.value > 0
          ? onSiteWidthInput.value
          : typeof el.width === 'number' && el.width > 0
            ? el.width
            : DEFAULT_PV_FOOTPRINT_M.width;
    const nextHeight =
      field === 'height'
        ? value
        : typeof onSiteHeightInput.value === 'number' && onSiteHeightInput.value > 0
          ? onSiteHeightInput.value
          : typeof el.height === 'number' && el.height > 0
            ? el.height
            : DEFAULT_PV_FOOTPRINT_M.height;
    if (!el.coordinates || el.coordinates.length < 2) {
      ctx.updateElement(ctx.selection.id, {
        width: roundToTwoDecimals(nextWidth),
        height: roundToTwoDecimals(nextHeight),
      } as Partial<Element>);
      return;
    }

    const A = el.coordinates[0];
    const B = el.coordinates[1];
    if (Math.hypot(B.x - A.x, B.y - A.y) < 1e-4) {
      ctx.updateElement(ctx.selection.id, {
        width: roundToTwoDecimals(nextWidth),
        height: roundToTwoDecimals(nextHeight),
      } as Partial<Element>);
      return;
    }

    const roundedWidth = roundToTwoDecimals(nextWidth);
    const roundedHeight = roundToTwoDecimals(nextHeight);
    const flags = readPvFootprintFlags(el.extra_json);
    const coordinates = rebuildPvRectangleFromBottomEdgeDimensions(
      A,
      B,
      roundedWidth,
      roundedHeight,
      flags.flipUpslope,
      typeof el.pitch === 'number' ? el.pitch : undefined,
    );
    const nextExtra =
      el.extra_json && typeof el.extra_json === 'object' ? { ...el.extra_json } : {};
    nextExtra._pv_bottom_is_long = roundedWidth >= roundedHeight;

    ctx.updateElement(ctx.selection.id, {
      coordinates,
      width: roundedWidth,
      height: roundedHeight,
      extra_json: nextExtra,
    } as Partial<Element>);
  };

  const onSiteWidthInput = useDecimalInput('', commitOnSiteDimensionField('width'), { commitOnChange: true });
  const onSiteHeightInput = useDecimalInput('', commitOnSiteDimensionField('height'), { commitOnChange: true });

  // Wall line + OnSiteGeneration: keep orientation fields in sync when coordinates change on canvas (selectedElementV bumps).
  // For OnSiteGeneration we also re-sync pitch and base_height because the store hook may patch
  // them when the panel moves to a different position on the host roof; without this the input
  // value stays stale and the Reset button keeps reappearing on every drag.
  useEffect(() => {
    if (!ctx.selection?.id || (ctx.selection.type !== 'element' && ctx.selection.type !== 'global')) return;
    const el = ctx.getElementById(ctx.selection.id);
    if (!el) return;
    if (el.type === 'OnSiteGeneration') {
      const o = roundToInt(ctx.getCurrentOrientation(el));
      onSiteOrientationInput.syncValue(o);
      const p = (el as { pitch?: number }).pitch;
      if (typeof p === 'number' && Number.isFinite(p)) {
        onSitePitchInput.syncValue(p);
      }
      const bh = (el as { base_height?: number }).base_height;
      if (typeof bh === 'number' && Number.isFinite(bh)) {
        onSiteBaseHeightInput.syncValue(roundToTwoDecimals(bh));
      }
      const w = (el as { width?: number }).width;
      if (typeof w === 'number' && Number.isFinite(w)) {
        onSiteWidthInput.syncValue(roundToTwoDecimals(w));
      }
      const h = (el as { height?: number }).height;
      if (typeof h === 'number' && Number.isFinite(h)) {
        onSiteHeightInput.syncValue(roundToTwoDecimals(h));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only when selection or element version changes
  }, [ctx.selection?.id, ctx.selection?.type, ctx.selectedElementV]);

  return {
    peakPowerInput,
    onSitePitchInput,
    onSiteOrientationInput,
    onSiteBaseHeightInput,
    onSiteWidthInput,
    onSiteHeightInput,
    getCurrentOrientation: ctx.getCurrentOrientation,
  };
}

export const onSiteGenerationFormModule: ElementFormModule<OnSiteGenerationFormState> = {
  type: 'OnSiteGeneration',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'OnSiteGeneration') return;
    // On-site solar (element/global selection — legacy branches were identical)
    const peakPower = 'peak_power' in element && typeof element.peak_power === 'number'
      ? roundToTwoDecimals(element.peak_power)
      : (element.peak_power ?? '');
    const pitch =
      'pitch' in element && typeof element.pitch === 'number'
        ? element.pitch
        : (element.pitch ?? '');
    const orientation = roundToInt(state.getCurrentOrientation(element));
    const baseHeight =
      'base_height' in element && typeof element.base_height === 'number'
        ? roundToTwoDecimals(element.base_height)
        : (element.base_height ?? '');
    const width =
      'width' in element && typeof element.width === 'number'
        ? roundToTwoDecimals(element.width)
        : (element.width ?? '');
    const height =
      'height' in element && typeof element.height === 'number'
        ? roundToTwoDecimals(element.height)
        : (element.height ?? '');

    state.peakPowerInput.setValue(peakPower);
    state.onSitePitchInput.setValue(pitch);
    state.onSiteOrientationInput.setValue(orientation);
    state.onSiteBaseHeightInput.setValue(baseHeight);
    state.onSiteWidthInput.setValue(width);
    state.onSiteHeightInput.setValue(height);
  },

  reset() {
    // Legacy resetFormFields never reset OnSiteGeneration state; preserved as-is.
  },

  buildElementData(state, ctx) {
    // Build element data with main UI fields
    const elementData: Record<string, unknown> = {
      ...ctx.baseData,
      generation_type: 'PhotovoltaicSystem',
      peak_power: state.peakPowerInput.value === '' ? undefined : state.peakPowerInput.value,
      pitch: state.onSitePitchInput.value === '' ? undefined : state.onSitePitchInput.value,
      orientation360: state.onSiteOrientationInput.value === '' ? undefined : state.onSiteOrientationInput.value,
      base_height: state.onSiteBaseHeightInput.value === '' ? undefined : state.onSiteBaseHeightInput.value,
      width: state.onSiteWidthInput.value || undefined,
      height: state.onSiteHeightInput.value || undefined,
      zoneId: ctx.elementZoneId || undefined
    };

    // Auto-remove main UI fields from extra_json to avoid duplication; drop canvas-only _pv_* (not in HEM schema)
    if (elementData.extra_json) {
      const restExtraJson = { ...readExtraJsonRecord(elementData.extra_json) };
      delete restExtraJson.peak_power;
      delete restExtraJson.pitch;
      delete restExtraJson.orientation360;
      delete restExtraJson.base_height;
      delete restExtraJson.width;
      delete restExtraJson.height;
      const withoutPv = Object.fromEntries(
        Object.entries(restExtraJson).filter(([k]) => !k.startsWith('_pv_')),
      );
      elementData.extra_json = Object.keys(withoutPv).length > 0 ? withoutPv : undefined;
    }

    return elementData as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const { peakPowerInput, onSitePitchInput, onSiteOrientationInput, onSiteBaseHeightInput, onSiteWidthInput, onSiteHeightInput } = state;
    const {
      elementType,
      fieldUnit,
      renderFieldLabel,
      renderFieldLabelWithComparisonIndicator,
      registerBaseFieldRefs,
      registerBaseFieldRef,
      getFieldValidationIssue,
      globalComparisonFieldIndicators,
      commitExistingElementDraft,
      selection,
      getElementById,
      updateElement,
      getGlobalOrientationOffset,
      onSiteHostDerivation,
      selectedPvDimensionNotes,
    } = ctx;

    /** Rebuild plan footprint from the bottom edge using current width/height fields */
    const resetOnSiteDimensions = () => {
      if (!selection?.id || (selection.type !== 'element' && selection.type !== 'global')) return;
      const el = getElementById(selection.id) as any;
      if (!el || el.type !== 'OnSiteGeneration' || !el.coordinates || el.coordinates.length < 2) return;
      const A = el.coordinates[0];
      const B = el.coordinates[1];
      if (Math.hypot(B.x - A.x, B.y - A.y) < 1e-4) return;

      const rawW =
        typeof onSiteWidthInput.value === 'number' && onSiteWidthInput.value > 0
          ? onSiteWidthInput.value
          : typeof el.width === 'number' && el.width > 0
            ? el.width
            : DEFAULT_PV_FOOTPRINT_M.width;
      const rawH =
        typeof onSiteHeightInput.value === 'number' && onSiteHeightInput.value > 0
          ? onSiteHeightInput.value
          : typeof el.height === 'number' && el.height > 0
            ? el.height
            : DEFAULT_PV_FOOTPRINT_M.height;

      const flags = readPvFootprintFlags(el.extra_json);
      const roundedWidth = roundToTwoDecimals(rawW);
      const roundedHeight = roundToTwoDecimals(rawH);
      const coords = rebuildPvRectangleFromBottomEdgeDimensions(
        A,
        B,
        roundedWidth,
        roundedHeight,
        flags.flipUpslope,
        typeof el.pitch === 'number' ? el.pitch : undefined,
      );
      const nextExtra =
        el.extra_json && typeof el.extra_json === 'object' ? { ...el.extra_json } : {};
      nextExtra._pv_bottom_is_long = roundedWidth >= roundedHeight;
      updateElement(selection.id, {
        coordinates: coords,
        width: roundedWidth,
        height: roundedHeight,
        extra_json: nextExtra,
      });
    };

    /** Swap width ↔ height and flip which module side runs along the bottom edge */
    const switchOnSiteOrientation = () => {
      if (!selection?.id || (selection.type !== 'element' && selection.type !== 'global')) return;
      const el = getElementById(selection.id) as any;
      if (!el || el.type !== 'OnSiteGeneration' || !el.coordinates || el.coordinates.length < 2) return;
      const A = el.coordinates[0];
      const B = el.coordinates[1];
      if (Math.hypot(B.x - A.x, B.y - A.y) < 1e-4) return;

      const rawW =
        typeof onSiteWidthInput.value === 'number' && onSiteWidthInput.value > 0
          ? onSiteWidthInput.value
          : typeof el.width === 'number' && el.width > 0
            ? el.width
            : DEFAULT_PV_FOOTPRINT_M.width;
      const rawH =
        typeof onSiteHeightInput.value === 'number' && onSiteHeightInput.value > 0
          ? onSiteHeightInput.value
          : typeof el.height === 'number' && el.height > 0
            ? el.height
            : DEFAULT_PV_FOOTPRINT_M.height;

      const newW = rawH;
      const newH = rawW;
      const flags = readPvFootprintFlags(el.extra_json);
      const roundedWidth = roundToTwoDecimals(newW);
      const roundedHeight = roundToTwoDecimals(newH);
      const coords = rebuildPvRectangleFromBottomEdgeDimensions(
        A,
        B,
        roundedWidth,
        roundedHeight,
        flags.flipUpslope,
        typeof el.pitch === 'number' ? el.pitch : undefined,
      );

      onSiteWidthInput.setValue(roundedWidth);
      onSiteHeightInput.setValue(roundedHeight);

      const baseExtra =
        el.extra_json && typeof el.extra_json === 'object' ? { ...el.extra_json } : {};
      baseExtra._pv_bottom_is_long = roundedWidth >= roundedHeight;

      updateElement(selection.id, {
        coordinates: coords,
        width: roundedWidth,
        height: roundedHeight,
        extra_json: baseExtra,
      });
    };

    const resetOnSiteOrientationToHost = (value: number) => {
      if (!selection?.id) return;
      const el = getElementById(selection.id);
      if (!el || el.type !== 'OnSiteGeneration') return;
      const pitch = (el as { pitch?: number }).pitch ?? 0;
      const coords = el.coordinates || [];
      if (pitch > 0 && pitch < 90 && coords.length >= 3) {
        const globalOffset = getGlobalOrientationOffset();
        const next = applyCompassOrientationToSlopedPolygonCoords(
          coords as Array<{ x: number; y: number; z: number }>,
          value,
          globalOffset,
        );
        if (next) {
          updateElement(selection.id, {
            coordinates: next,
            _orientationUserOverride: false,
          } as Partial<Element>);
          return;
        }
      }
      commitExistingElementDraft({
        orientation360: value,
        _orientationUserOverride: false,
      } as Partial<Element>);
    };

    return (
      <>
        {renderFieldLabelWithComparisonIndicator('Peak Power (kWp):', elementType, globalComparisonFieldIndicators.peak_power)}
        <div className="element-input" ref={registerBaseFieldRef('peak_power')}>
          <StandardInput
            {...decimalInputProps(peakPowerInput)}
            unit={fieldUnit('peak_power')}
            step="0.001"
            min="0.001"
            max="100"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('peak_power', peakPowerInput.value)} issue={getFieldValidationIssue('peak_power', peakPowerInput.value) || undefined} />
        </div>
        {(() => {
          const hostName = onSiteHostDerivation?.hostName;
          const renderHostResetRow = (
            fieldKey: 'pitch' | 'orientation360' | 'base_height',
            unitSuffix: string,
            inputJsx: ReactNode,
            currentValue: number | '',
            onReset: (derived: number) => void,
          ) => {
            const derivedValue = onSiteHostDerivation?.derived[fieldKey];
            const hasHostValue = typeof derivedValue === 'number' && Number.isFinite(derivedValue);
            const epsilon = fieldKey === 'base_height' ? 0.01 : 0.5;
            const current = typeof currentValue === 'number' ? currentValue : null;
            const isDivergent =
              hasHostValue && current !== null && Math.abs(current - (derivedValue as number)) > epsilon;
            return (
              <div
                className="element-input"
                style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}
              >
                <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', width: '100%' }}>
                  <div className={isDivergent ? 'custom-value' : ''} style={{ flex: 1 }}>
                    {inputJsx}
                  </div>
                  {isDivergent && hasHostValue ? (
                    <ResetFieldButton
                      onClick={() => onReset(derivedValue as number)}
                      align="inline"
                      title={`Reset to ${derivedValue}${unitSuffix} (from ${hostName ?? 'host roof'})`}
                      ariaLabel="Reset to host value"
                      label="Reset"
                    />
                  ) : null}
                </div>
                {hasHostValue ? (
                  <div style={INLINE_FIELD_NOTE_STYLE}>
                    {isDivergent
                      ? `Default: ${derivedValue}${unitSuffix} · from ${hostName ?? 'host roof'}`
                      : `From ${hostName ?? 'host roof'}`}
                  </div>
                ) : null}
              </div>
            );
          };
          return (
            <>
              {renderFieldLabel('Pitch (degrees):', elementType, 'pitch')}
              <div ref={registerBaseFieldRefs('pitch')}>
                {renderHostResetRow(
                  'pitch',
                  '°',
                  <>
                    <StandardInput
                      {...decimalInputProps(onSitePitchInput)}
                      unit={fieldUnit('pitch')}
                      step="0.5"
                      min="0"
                      max="90"
                      variant="ghost"
                      size="md"
                      className="flex-1"
                    />
                    <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('pitch', onSitePitchInput.value)} issue={getFieldValidationIssue('pitch', onSitePitchInput.value) || undefined} />
                  </>,
                  onSitePitchInput.value,
                  (derived) => {
                    onSitePitchInput.setValue(derived);
                    commitExistingElementDraft({
                      pitch: derived,
                      _pitchUserOverride: false,
                    } as Partial<Element>);
                  },
                )}
              </div>
              {renderFieldLabel('Orientation (degrees):', elementType, 'orientation360')}
              <div ref={registerBaseFieldRefs('orientation360')}>
                {renderHostResetRow(
                  'orientation360',
                  '°',
                  <>
                    <StandardInput
                      {...integerInputProps(onSiteOrientationInput)}
                      unit={fieldUnit('orientation360')}
                      step="1"
                      min="0"
                      max="360"
                      variant="ghost"
                      size="md"
                      className="flex-1"
                    />
                    <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('orientation360', onSiteOrientationInput.value)} issue={getFieldValidationIssue('orientation360', onSiteOrientationInput.value) || undefined} />
                  </>,
                  onSiteOrientationInput.value,
                  (derived) => {
                    onSiteOrientationInput.setValue(Math.round(derived));
                    resetOnSiteOrientationToHost(derived);
                  },
                )}
              </div>
              {renderFieldLabel('Base Height (m):', elementType, 'base_height')}
              <div ref={registerBaseFieldRefs('base_height')}>
                {renderHostResetRow(
                  'base_height',
                  ' m',
                  <>
                    <StandardInput
                      {...decimalInputProps(onSiteBaseHeightInput)}
                      unit={fieldUnit('base_height')}
                      step="0.01"
                      min="0"
                      max="500"
                      variant="ghost"
                      size="md"
                      className="flex-1"
                    />
                    <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('base_height', onSiteBaseHeightInput.value)} issue={getFieldValidationIssue('base_height', onSiteBaseHeightInput.value) || undefined} />
                  </>,
                  onSiteBaseHeightInput.value,
                  (derived) => {
                    onSiteBaseHeightInput.setValue(roundToTwoDecimals(derived));
                    commitExistingElementDraft({
                      base_height: derived,
                      _baseHeightUserOverride: false,
                    } as Partial<Element>);
                  },
                )}
              </div>
            </>
          );
        })()}
        {renderFieldLabel('Width (m):', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs('width')}>
          <StandardInput
            {...decimalInputProps(onSiteWidthInput)}
            unit={fieldUnit('width')}
            step="0.01"
            min="0"
            max="100"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('width', onSiteWidthInput.value)} issue={getFieldValidationIssue('width', onSiteWidthInput.value) || undefined} />
        </div>
        {selectedPvDimensionNotes?.width ? (
          <div style={INLINE_FIELD_NOTE_STYLE}>
            {selectedPvDimensionNotes.width}
          </div>
        ) : null}
        {renderFieldLabel('Height (m):', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs('height')}>
          <StandardInput
            {...decimalInputProps(onSiteHeightInput)}
            unit={fieldUnit('height')}
            step="0.01"
            min="0"
            max="100"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('height', onSiteHeightInput.value)} issue={getFieldValidationIssue('height', onSiteHeightInput.value) || undefined} />
        </div>
        {selectedPvDimensionNotes?.height ? (
          <div style={INLINE_FIELD_NOTE_STYLE}>
            {selectedPvDimensionNotes.height}
          </div>
        ) : null}
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="btn editor-action-btn editor-action-btn--secondary"
            disabled={(() => {
              if (!selection?.id) return true;
              const el = getElementById(selection.id) as any;
              if (!el || el.type !== 'OnSiteGeneration' || !el.coordinates || el.coordinates.length < 2) return true;
              const [p0, p1] = el.coordinates;
              return Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-4;
            })()}
            onClick={resetOnSiteDimensions}
          >
            Rebuild footprint
          </button>
          <button
            type="button"
            className="btn editor-action-btn editor-action-btn--secondary"
            disabled={(() => {
              if (!selection?.id) return true;
              const el = getElementById(selection.id) as any;
              if (!el || el.type !== 'OnSiteGeneration' || !el.coordinates || el.coordinates.length < 2) return true;
              const [p0, p1] = el.coordinates;
              return Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-4;
            })()}
            onClick={switchOnSiteOrientation}
          >
            Switch orientation
          </button>
        </div>
      </>
    );
  },

  subtype() {
    return 'PhotovoltaicSystem';
  },
};
