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

import { resolveFieldLabelContent } from '../../lib/schemaDescriptionOverrides';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
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
import { DerivedSource, SourceNote } from '../FieldSource';
import { StandardDropdown } from '../StandardDropdown';
import { dereferenceSchemaNodeInRoot } from '../../lib/subschemaCache';
import { readRecord } from '../../lib/jsonTypes';
import {
  decimalInputProps,
  integerInputProps,
  useDecimalInput,
  useIntegerInput,
} from './formPrimitives';
import type { ElementFormModule, ElementFormMore, ElementFormRenderCtx, ElementFormStateCtx } from './types';
import { compassPoint } from '../../lib/parentOrientation';
import { useKeyedState } from '../../hooks/useKeyedState';

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
  /** The panel's ventilation strategies, from the target schema (empty when the schema has none). */
  ventilationStrategies: string[];
  /** An existing building's roof-given pitch or orientation the user opened to edit. */
  hostFieldEditing: 'pitch' | 'orientation360' | null;
  setHostFieldEditing: (value: 'pitch' | 'orientation360' | null) => void;
}

/** The existing-building PV mounting types (schema `PhotovoltaicMountingType`). */
const PV_MOUNTING_TYPES = [
  { value: 'rail-mounted', label: 'Rail-mounted' },
  { value: 'integrated', label: 'Integrated into the roof' },
  { value: 'ground-mounted', label: 'Ground-mounted' },
];

/** HEM:EPC's inverter: its type and whether it is inside, one choice; blank takes the defaults. */
const PV_INVERTERS = [
  { value: 'string_inverter|inside', label: 'String, inside' },
  { value: 'string_inverter|outside', label: 'String, outside' },
  { value: 'optimised_inverter|inside', label: 'Optimised, inside' },
  { value: 'optimised_inverter|outside', label: 'Optimised, outside' },
];

/** The inverter choice the PV states: blank when it states neither its type nor where it is. */
export function inverterChoice(extra: Readonly<Record<string, unknown>>): string {
  if (extra.inverter_type === undefined && extra.inverter_is_inside === undefined) return '';
  return `${extra.inverter_type === 'optimised_inverter' ? 'optimised_inverter' : 'string_inverter'}|${extra.inverter_is_inside === false ? 'outside' : 'inside'}`;
}

/** The PV's data with this inverter choice; blank removes both fields for the defaults. */
export function withInverterChoice(extra: Readonly<Record<string, unknown>>, choice: string): Record<string, unknown> {
  const rest = Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'inverter_type' && key !== 'inverter_is_inside'));
  if (!choice) return rest;
  const [type, place] = choice.split('|');
  return { ...rest, inverter_type: type, inverter_is_inside: place === 'inside' };
}

const VENTILATION_STRATEGY_LABELS: Record<string, string> = {
  unventilated: 'Unventilated',
  moderately_ventilated: 'Moderately ventilated',
  strongly_or_forced_ventilated: 'Strongly or forced ventilated',
  rear_surface_free: 'Rear surface free',
};

function panelVentilationStrategies(ctx: ElementFormStateCtx): string[] {
  if (ctx.schemaPort.availability !== 'available') return [];
  const root = ctx.schemaPort.getRootSchema(ctx.schemaMode);
  const panel = Object.values(readRecord(readRecord(root).$defs)).map(readRecord).find((def) => 'ventilation_strategy' in readRecord(def.properties));
  const strategy = readRecord(dereferenceSchemaNodeInRoot(readRecord(readRecord(panel?.properties).ventilation_strategy), root));
  return Array.isArray(strategy.enum) ? strategy.enum.filter((value): value is string => typeof value === 'string') : [];
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

  const [hostFieldEditing, setHostFieldEditing] = useKeyedState<'pitch' | 'orientation360' | null>(ctx.selection?.id ?? '', null);

  return {
    hostFieldEditing,
    setHostFieldEditing,
    peakPowerInput,
    onSitePitchInput,
    onSiteOrientationInput,
    onSiteBaseHeightInput,
    onSiteWidthInput,
    onSiteHeightInput,
    getCurrentOrientation: ctx.getCurrentOrientation,
    ventilationStrategies: panelVentilationStrategies(ctx),
  };
}

/** The PV panel's fields, and on an existing building those that sit under "More". */
function pvView(state: OnSiteGenerationFormState, ctx: ElementFormRenderCtx): { main: ReactNode; more: ElementFormMore | null } {
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
      setSelection,
      hemDatabaseProducts,
      existingBuilding,
    } = ctx;

    const pvElement = selection?.id ? getElementById(selection.id) : undefined;
    const ventilationStrategy = readRecord(pvElement?.extra_json).ventilation_strategy;
    // An existing building's PV takes its simpler form: mounting type and panel count, with the
    // peak power and inverter defaulted unless stated; the mounting type gives the ventilation.
    const existingPv = hemDatabaseProducts && existingBuilding;
    const pvExtra = readRecord(pvElement?.extra_json);
    const panelCount = typeof pvExtra.panel_count === 'number' ? pvExtra.panel_count : undefined;
    const patchPvExtra = (key: string, value: unknown) => {
      if (pvElement) updateElement(pvElement.id, { extra_json: { ...readRecord(pvElement.extra_json), [key]: value } } as Partial<Element>);
    };

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
          <div className={hasHostValue && !isDivergent ? 'field-value--source' : ''} style={{ display: 'flex', gap: '4px', alignItems: 'center', width: '100%' }}>
            {inputJsx}
          </div>
          {hasHostValue ? (
            <div>
              <DerivedSource
                derived={derivedValue}
                current={currentValue}
                tolerance={epsilon}
                info={<SourceNote>from {hostName ?? 'the roof'}</SourceNote>}
                useLabel={`Use ${hostName ? hostName.replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase()) : 'the roof'}`}
                unit={unitSuffix.trim() || undefined}
                fieldLabel={fieldKey === 'base_height' ? 'Base height' : fieldKey === 'pitch' ? 'Pitch' : 'Orientation'}
                onUse={onReset}
              />
            </div>
          ) : null}
        </div>
      );
    };
    const pitchInput = (autoFocus = false) => (
      <>
        <StandardInput
          {...decimalInputProps(onSitePitchInput)}
          autoFocus={autoFocus}
          unit={fieldUnit('pitch')}
          step="0.5"
          min="0"
          max="90"
          variant="ghost"
          size="md"
          className="flex-1"
        />
        <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('pitch', onSitePitchInput.value)} issue={getFieldValidationIssue('pitch', onSitePitchInput.value) || undefined} />
      </>
    );
    const usePitch = (derived: number) => {
      onSitePitchInput.setValue(derived);
      commitExistingElementDraft({
        pitch: derived,
        _pitchUserOverride: false,
      } as Partial<Element>);
    };
    const orientationInput = (autoFocus = false) => (
      <>
        <StandardInput
          {...integerInputProps(onSiteOrientationInput)}
          autoFocus={autoFocus}
          unit={fieldUnit('orientation360')}
          step="1"
          min="0"
          max="360"
          variant="ghost"
          size="md"
          className="flex-1"
        />
        <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('orientation360', onSiteOrientationInput.value)} issue={getFieldValidationIssue('orientation360', onSiteOrientationInput.value) || undefined} />
      </>
    );
    const useOrientation = (derived: number) => {
      onSiteOrientationInput.setValue(Math.round(derived));
      resetOnSiteOrientationToHost(derived);
    };
    const baseHeightRows = (
      <>
        {renderFieldLabel(`${resolveFieldLabelContent('base_height')} (m):`, elementType, 'base_height')}
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
    const footprintDisabled = (() => {
      if (!selection?.id) return true;
      const el = getElementById(selection.id) as any;
      if (!el || el.type !== 'OnSiteGeneration' || !el.coordinates || el.coordinates.length < 2) return true;
      const [p0, p1] = el.coordinates;
      return Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-4;
    })();
    const sizeRows = (
      <>
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
          <div className="field-source-note">
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
          <div className="field-source-note">
            {selectedPvDimensionNotes.height}
          </div>
        ) : null}
      </>
    );

    const footprintButtons = (
      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="btn editor-action-btn editor-action-btn--secondary" disabled={footprintDisabled} onClick={resetOnSiteDimensions}>
          Rebuild footprint
        </button>
        <button type="button" className="btn editor-action-btn editor-action-btn--secondary" disabled={footprintDisabled} onClick={switchOnSiteOrientation}>
          Switch orientation
        </button>
      </div>
    );

    if (existingPv && pvElement) {
      // A value the roof gives reads as text with its source; clicking it edits it. Off a roof, or
      // once it differs, it is an input (with "Use <roof>" while on one).
      const derived = onSiteHostDerivation?.derived;
      const followsHost = (key: 'pitch' | 'orientation360', value: number | '') =>
        typeof derived?.[key] === 'number' && typeof value === 'number' && Math.abs(value - derived[key]!) <= 0.5 && state.hostFieldEditing !== key;
      const hostLink = onSiteHostDerivation ? (
        <span className="field-source-note">from <button type="button" className="field-source-note__link" onClick={() => setSelection({ type: 'element', id: onSiteHostDerivation.hostId })}>{onSiteHostDerivation.hostName}</button></span>
      ) : null;
      const hostField = (key: 'pitch' | 'orientation360', label: string, value: number | '', text: string, input: (autoFocus: boolean) => ReactNode, onUse: (derived: number) => void) => (
        <div ref={registerBaseFieldRefs(key)} style={{ minWidth: 0 }}>
          <div className="element-label" style={{ display: 'flex', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>{label}{followsHost(key, value) ? hostLink : null}</div>
          {followsHost(key, value)
            // As tall as an input, so a value beside one being edited sits on its line.
            ? <button type="button" className="field-source-note__link" style={{ textDecoration: 'none', fontSize: 'var(--font-size-sm, 13px)', color: 'var(--text-primary)', minHeight: 'var(--form-input-height)', display: 'flex', alignItems: 'center' }} aria-label={`${label} ${text}, from ${onSiteHostDerivation?.hostName ?? 'the roof'}. Edit`} title="Edit" onClick={() => state.setHostFieldEditing(key)}>{text}</button>
            : renderHostResetRow(key, '°', input(state.hostFieldEditing === key), value, (next) => { state.setHostFieldEditing(null); onUse(next); })}
        </div>
      );
      const inverter = inverterChoice(pvExtra);
      const orientation = onSiteOrientationInput.value;
      const peakPowerLabel = renderFieldLabel('Peak power', elementType, 'peak_power');
      const inverterLabel = renderFieldLabel('Inverter', elementType, 'inverter_type');
      return {
        main: (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <div>
                <div className="element-label">Panels</div>
                <div className="element-input">
                  {/* Blank, the drawn area gives the array size; a count replaces it (`hemie_systems.rs`). */}
                  <StandardInput
                    type="number"
                    min="1"
                    step="1"
                    aria-label="Panels"
                    value={panelCount === undefined ? '' : String(panelCount)}
                    placeholder="from drawn area"
                    onChange={(e) => {
                      const count = Number.parseInt(e.target.value, 10);
                      patchPvExtra('panel_count', Number.isFinite(count) && count > 0 ? count : undefined);
                    }}
                    variant="ghost"
                    size="md"
                    className="flex-1"
                  />
                </div>
              </div>
              <div>
                <div className="element-label">Mounting</div>
                <div className="element-input">
                  <StandardDropdown
                    aria-label="Mounting"
                    value={typeof pvExtra.mounting_type === 'string' ? pvExtra.mounting_type : ''}
                    onChange={(value) => patchPvExtra('mounting_type', value || undefined)}
                    options={PV_MOUNTING_TYPES}
                    placeholder="Required"
                    variant="ghost"
                    size="md"
                  />
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {hostField('pitch', 'Pitch', onSitePitchInput.value, typeof onSitePitchInput.value === 'number' ? `${Math.round(onSitePitchInput.value * 10) / 10}°` : '', pitchInput, usePitch)}
              {hostField('orientation360', 'Faces', orientation, typeof orientation === 'number' ? `${compassPoint(orientation)} · ${orientation}°` : '', orientationInput, useOrientation)}
            </div>
            {peakPowerLabel}
            <div className="element-input" ref={registerBaseFieldRef('peak_power')}>
              <StandardInput
                {...decimalInputProps(peakPowerInput)}
                aria-label="Peak power"
                placeholder={panelCount === undefined ? 'default from the drawn area' : `default for ${panelCount} panel${panelCount === 1 ? '' : 's'}`}
                unit="kWp"
                step="0.001"
                min="0.001"
                max="100"
                variant="ghost"
                size="md"
                className="flex-1"
              />
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('peak_power', peakPowerInput.value)} issue={getFieldValidationIssue('peak_power', peakPowerInput.value) || undefined} />
            </div>
            {inverterLabel}
            <div className="element-input">
              <StandardDropdown
                aria-label="Inverter"
                value={inverter}
                onChange={(value) => updateElement(pvElement.id, { extra_json: withInverterChoice(pvExtra, value || '') } as Partial<Element>)}
                options={PV_INVERTERS}
                placeholder="String, inside"
                variant="ghost"
                size="md"
              />
            </div>
            <div className="field-source-note">{inverter
              ? <button type="button" className="field-source-note__link" onClick={() => updateElement(pvElement.id, { extra_json: withInverterChoice(pvExtra, '') } as Partial<Element>)}>Use default</button>
              : 'default'}</div>
          </>
        ),
        more: {
          fields: <>{baseHeightRows}{sizeRows}{footprintButtons}</>,
          labels: ['base height', 'width', 'height'],
          keys: ['base_height', 'width', 'height'],
          // Open while the base height is the user's own rather than the roof's.
          stated: (pvElement as { _baseHeightUserOverride?: boolean })._baseHeightUserOverride === true,
        },
      };
    }

    return {
      main: (
        <>
          {renderFieldLabelWithComparisonIndicator('Peak Power (kWp):', elementType, globalComparisonFieldIndicators.peak_power, 'peak_power')}
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
          {renderFieldLabel('Pitch (degrees):', elementType, 'pitch')}
          <div ref={registerBaseFieldRefs('pitch')}>
            {renderHostResetRow('pitch', '°', pitchInput(), onSitePitchInput.value, usePitch)}
          </div>
          {renderFieldLabel('Orientation (degrees):', elementType, 'orientation360')}
          <div ref={registerBaseFieldRefs('orientation360')}>
            {renderHostResetRow('orientation360', '°', orientationInput(), onSiteOrientationInput.value, useOrientation)}
          </div>
          {baseHeightRows}
          {sizeRows}
          {/* A products target's PV root has no such field, and the panel needs one: it is stated here. */}
          {hemDatabaseProducts && state.ventilationStrategies.length > 0 && pvElement ? (
            <>
              <div className="element-label">Panel ventilation</div>
              <div className="element-input">
                <StandardDropdown
                  value={typeof ventilationStrategy === 'string' ? ventilationStrategy : ''}
                  onChange={(value) => updateElement(pvElement.id, { extra_json: { ...readRecord(pvElement.extra_json), ventilation_strategy: value || undefined } } as Partial<Element>)}
                  options={state.ventilationStrategies.map((value) => ({ value, label: VENTILATION_STRATEGY_LABELS[value] ?? value }))}
                  placeholder="Select…"
                  variant="ghost"
                  size="md"
                />
              </div>
            </>
          ) : null}
          {footprintButtons}
        </>
      ),
      more: null,
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

  renderPanel(state, ctx) {
    return pvView(state, ctx).main;
  },

  renderMore(state, ctx) {
    return pvView(state, ctx).more;
  },

  subtype() {
    return 'PhotovoltaicSystem';
  },
};
