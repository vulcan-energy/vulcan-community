// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Service-line state shared by exactly three element families —
// ThermalBridgeLinear (TBL), MechanicalVentilationDuctwork (MVD), and
// WaterPipework (WP) — extracted verbatim from ElementCreator alongside those
// families' own modules. Unlike the rest of elementForms/*, this file is not
// itself an ElementFormModule: the orchestrator creates exactly ONE instance
// via useServiceLineFormState (the "single-instance preservation" the legacy
// component already relied on) and still reads `mode` itself for the shared
// shape picker, so the hook is called directly by ElementCreator and bridged
// to the trio's modules through ElementFormStateCtx.serviceLine.
// hydrateServiceLineFromElement/resetServiceLine/renderServiceLineCoreFields
// are plain exported helpers the three modules call from their own
// hydrate/reset/renderPanel.
//
// Moved verbatim from ElementCreator:
// - commitServiceLineEndpointZ, including its ThermalBridgeLinear-only
//   branches (resolveThermalBridgeLineMode /
//   syncThermalBridgeLinearLengthFromCoordinates).
// - The three useDecimalInput declarations (lengthInput/tbZ0Input/
//   tbZ1Input), their syncValue refs, and the updater-effect lines for just
//   those three — kept as this hook's own small effect with the same ref
//   idiom ElementCreator uses for its own not-yet-extracted inputs (refs
//   updated in an effect, not read as direct deps, so the canvas-sync effect
//   below can use them without re-running on every keystroke).
// - The mode/metrics memos (formerly selectedServiceLineMode/
//   selectedServiceLineMetrics on the orchestrator). The
//   selectedTbLineMode alias was dropped in the move; callers read `mode`
//   directly.
// - The canvas-sync effect, EXCEPT its ThermalBridgeLinear transmittance
//   lines: linearThermalTransmittanceInput is TBL-only, not part of this
//   shared group, and stays owned by ElementCreator until it moves into
//   thermalBridgeLinear.tsx. ElementCreator keeps a small effect of its own
//   for just those lines in the meantime, with the same dep shape and ref
//   idiom as here.
//
// commitServiceLineLength's coordinate-rescale branch moved here from
// ElementCreator's generic commitElementNumericField because lengthInput
// (this group's) was that branch's only caller.

import { useCallback, useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import { roundToTwoDecimals } from '../../geometry/constants';
import type { ThermalBridgeLinear, Element } from '../../geometry/types';
import {
  resolveThermalBridgeLineMode,
  syncThermalBridgeLinearLengthFromCoordinates,
} from '../../lib/thermalBridgeLinearGeometry';
import {
  applyServiceLinePlanLengthToCoordinates,
  getServiceLineLengthFromCoordinates,
  getServiceLinePlanLengthFromCoordinates,
  inferServiceLineModeFromCoordinates,
  isServiceLineElementType,
} from '../../lib/serviceLineDrawModes';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { decimalInputProps, useDecimalInput, type NumericDraftInputBinding } from './formPrimitives';
import type { ElementFormRenderCtx, ElementFormSelection } from './types';

export interface ServiceLineFormGroup {
  lengthInput: NumericDraftInputBinding;
  tbZ0Input: NumericDraftInputBinding;
  tbZ1Input: NumericDraftInputBinding;
  mode: 'plan' | 'vertical' | 'slope';
  actualLength: number;
}

export function useServiceLineFormState(args: {
  commitElementNumericField: (field: string) => (value: number | '') => void;
  selection: ElementFormSelection | null;
  isExistingElementSelection: () => boolean;
  getElementById: (id: string) => Element | undefined;
  commitExistingElementDraftRef: MutableRefObject<(overrides?: Partial<Element>) => void>;
  selectedElementV: number;
}): ServiceLineFormGroup {
  const {
    commitElementNumericField,
    selection,
    isExistingElementSelection,
    getElementById,
    commitExistingElementDraftRef,
    selectedElementV,
  } = args;

  const commitServiceLineEndpointZ = useCallback(
    (endpointIndex: 0 | 1) => (value: number | '') => {
      if (!isExistingElementSelection()) return;
      const currentSelection = selection as ElementFormSelection;
      const el = getElementById(currentSelection.id);
      if (!el || !isServiceLineElementType(el.type)) return;
      const c = el.coordinates;
      if (!Array.isArray(c) || c.length !== 2) return;
      const [a, b] = c;
      const mode =
        el.type === 'ThermalBridgeLinear'
          ? resolveThermalBridgeLineMode(el as ThermalBridgeLinear)
          : inferServiceLineModeFromCoordinates(c);
      const prevZ = endpointIndex === 0 ? a.z : b.z;
      const z =
        typeof value === 'number' && Number.isFinite(value)
          ? roundToTwoDecimals(value)
          : typeof prevZ === 'number' && Number.isFinite(prevZ)
            ? roundToTwoDecimals(prevZ)
            : 0;
      const nextCoords =
        mode === 'plan'
          ? [
              { ...a, z },
              { ...b, z },
            ]
          : endpointIndex === 0
            ? [{ ...a, z }, { ...b }]
            : [{ ...a }, { ...b, z }];
      const len =
        el.type === 'ThermalBridgeLinear'
          ? syncThermalBridgeLinearLengthFromCoordinates({ ...el, coordinates: nextCoords } as ThermalBridgeLinear)
          : getServiceLineLengthFromCoordinates(nextCoords);
      commitExistingElementDraftRef.current({
        coordinates: nextCoords,
        length: len,
      } as Partial<Element>);
    },
    [selection, isExistingElementSelection, getElementById, commitExistingElementDraftRef],
  );

  const commitServiceLineLength = useCallback(
    (value: number | '') => {
      if (isExistingElementSelection()) {
        const currentSelection = selection as ElementFormSelection;
        const el = getElementById(currentSelection.id);
        if (
          el &&
          (el.type === 'WaterPipework' || el.type === 'MechanicalVentilationDuctwork') &&
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value > 0
        ) {
          const mode = inferServiceLineModeFromCoordinates(el.coordinates);
          if (mode !== 'vertical') {
            const nextCoords = applyServiceLinePlanLengthToCoordinates(el.coordinates, value);
            if (nextCoords) {
              commitExistingElementDraftRef.current({
                coordinates: nextCoords,
                length: getServiceLineLengthFromCoordinates(nextCoords),
              } as Partial<Element>);
              return;
            }
          }
        }
      }
      commitElementNumericField('length')(value);
    },
    [selection, isExistingElementSelection, getElementById, commitExistingElementDraftRef, commitElementNumericField],
  );

  const lengthInput = useDecimalInput('', commitServiceLineLength, { commitOnChange: true });
  const tbZ0Input = useDecimalInput(0, commitServiceLineEndpointZ(0), { commitOnChange: true });
  const tbZ1Input = useDecimalInput(0, commitServiceLineEndpointZ(1), { commitOnChange: true });

  const lengthInputSetValueRef = useRef(lengthInput.syncValue);
  const tbZ0InputSetValueRef = useRef(tbZ0Input.syncValue);
  const tbZ1InputSetValueRef = useRef(tbZ1Input.syncValue);
  useEffect(() => {
    lengthInputSetValueRef.current = lengthInput.syncValue;
    tbZ0InputSetValueRef.current = tbZ0Input.syncValue;
    tbZ1InputSetValueRef.current = tbZ1Input.syncValue;
  }, [lengthInput.syncValue, tbZ0Input.syncValue, tbZ1Input.syncValue]);

  const mode = useMemo<'plan' | 'vertical' | 'slope'>(() => {
    void selectedElementV;
    if (!selection || (selection.type !== 'element' && selection.type !== 'global')) return 'plan';
    const el = getElementById(selection.id);
    if (!el || !isServiceLineElementType(el.type)) return 'plan';
    if (el.type === 'ThermalBridgeLinear') return resolveThermalBridgeLineMode(el as ThermalBridgeLinear);
    return inferServiceLineModeFromCoordinates(el.coordinates);
  }, [selection, getElementById, selectedElementV]);

  const actualLength = useMemo(() => {
    void selectedElementV;
    if (!selection || (selection.type !== 'element' && selection.type !== 'global')) return 0;
    const el = getElementById(selection.id);
    if (!el || !isServiceLineElementType(el.type)) return 0;
    return getServiceLineLengthFromCoordinates(el.coordinates);
  }, [selection, getElementById, selectedElementV]);

  useEffect(() => {
    void selectedElementV;
    if (selection?.type !== 'element' && selection?.type !== 'global') return;
    const el = getElementById(selection.id);
    if (!el || !isServiceLineElementType(el.type)) return;
    if (el.type === 'WaterPipework' || el.type === 'MechanicalVentilationDuctwork') {
      const lineMode = inferServiceLineModeFromCoordinates(el.coordinates);
      lengthInputSetValueRef.current(
        lineMode === 'slope'
          ? getServiceLinePlanLengthFromCoordinates(el.coordinates)
          : getServiceLineLengthFromCoordinates(el.coordinates),
      );
    } else {
      lengthInputSetValueRef.current('length' in el ? el.length ?? '' : '');
    }
    const coords = el.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
      tbZ0InputSetValueRef.current(typeof coords[0]?.z === 'number' ? roundToTwoDecimals(coords[0].z) : 0);
      tbZ1InputSetValueRef.current(typeof coords[1]?.z === 'number' ? roundToTwoDecimals(coords[1].z) : 0);
    }
  }, [selection?.type, selection?.id, selectedElementV, getElementById]);

  return { lengthInput, tbZ0Input, tbZ1Input, mode, actualLength };
}

/** Shared hydrate lines for the trio's length + Z0/Z1 fields (the block the
 * legacy component repeated verbatim across TBL/MVD/WP's element- and
 * global-selection hydrate branches), called from each module's hydrate. */
export function hydrateServiceLineFromElement(group: ServiceLineFormGroup, element: Element): void {
  group.lengthInput.setValue('length' in element ? element.length ?? '' : '');
  const cz = element.coordinates;
  if (Array.isArray(cz) && cz.length === 2) {
    group.tbZ0Input.setValue(typeof cz[0]?.z === 'number' ? roundToTwoDecimals(cz[0].z) : 0);
    group.tbZ1Input.setValue(typeof cz[1]?.z === 'number' ? roundToTwoDecimals(cz[1].z) : 0);
  } else {
    group.tbZ0Input.setValue(0);
    group.tbZ1Input.setValue(0);
  }
}

/** Idempotent — each trio module calls it from its own reset(), so the
 * orchestrator's instances loop resets the shared group up to three times
 * per resetFormFields, matching the legacy unconditional reset. */
export function resetServiceLine(group: ServiceLineFormGroup): void {
  group.lengthInput.setValue('');
  group.tbZ0Input.setValue(0);
  group.tbZ1Input.setValue(0);
}

export interface ServiceLineCoreFieldsOptions {
  lengthLabel: (mode: 'plan' | 'vertical' | 'slope') => string;
  lengthReadOnlyWhenVertical: boolean;
  zRefKeys: [string, string];
  showActualLengthWhenSlope: boolean;
}

/** The panel JSX duplicated across TBL/MVD/WP's attribute panels: length
 * field + Z0 + conditional Z1 (+ optional slope actual-length block). TBL
 * passes lengthReadOnlyWhenVertical: false (its length field is always
 * editable); MVD/WP pass true (their length field is read-only, with
 * onChange/onBlur undefined, while mode === 'vertical' — coordinates alone
 * drive length then). Called from each module's renderPanel; the legacy
 * MVD/WP copies differed only in prop order, so this single form is the
 * canonical one. */
export function renderServiceLineCoreFields(
  group: ServiceLineFormGroup,
  ctx: ElementFormRenderCtx,
  opts: ServiceLineCoreFieldsOptions,
): ReactNode {
  const { lengthInput, tbZ0Input, tbZ1Input, mode, actualLength } = group;
  const { elementType, fieldUnit, renderFieldLabel, registerBaseFieldRefs, getFieldValidationIssue } = ctx;
  const [z0Key, z1Key] = opts.zRefKeys;
  const lengthReadOnly = opts.lengthReadOnlyWhenVertical && mode === 'vertical';

  return (
    <>
      {renderFieldLabel(opts.lengthLabel(mode), elementType)}
      <div className="element-input" ref={registerBaseFieldRefs('length')}>
        <StandardInput
          {...decimalInputProps(lengthInput)}
          unit={fieldUnit('length')}
          onChange={lengthReadOnly ? undefined : lengthInput.handleInputChange}
          onBlur={lengthReadOnly ? undefined : lengthInput.handleBlur}
          readOnly={lengthReadOnly}
          step="0.01"
          min="0"
          variant="ghost"
          size="md"
          className="flex-1"
        />
        <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('length', lengthInput.value)} issue={getFieldValidationIssue('length', lengthInput.value) || undefined} />
      </div>
      {renderFieldLabel(mode === 'plan' ? 'Z (m):' : 'Z at line start (m):', elementType)}
      <div className="element-input" ref={registerBaseFieldRefs(z0Key)}>
        <StandardInput
          {...decimalInputProps(tbZ0Input)}
          unit={fieldUnit(z0Key)}
          step="0.01"
          variant="ghost"
          size="md"
          className="flex-1"
        />
      </div>
      {mode !== 'plan' && (
        <>
          {renderFieldLabel('Z at line end (m):', elementType)}
          <div className="element-input" ref={registerBaseFieldRefs(z1Key)}>
            <StandardInput
              {...decimalInputProps(tbZ1Input)}
              unit={fieldUnit(z1Key)}
              step="0.01"
              variant="ghost"
              size="md"
              className="flex-1"
            />
          </div>
        </>
      )}
      {opts.showActualLengthWhenSlope && mode === 'slope' && (
        <>
          {renderFieldLabel('Actual Length (m):', elementType)}
          <div className="element-input">
            <StandardInput
              type="text"
              inputMode="numeric"
              value={actualLength}
              unit={fieldUnit('length')}
              readOnly
              step="0.01"
              variant="ghost"
              size="md"
              className="flex-1"
            />
          </div>
        </>
      )}
    </>
  );
}
