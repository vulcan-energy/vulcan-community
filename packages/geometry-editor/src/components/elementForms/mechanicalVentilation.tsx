// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// MechanicalVentilation form family, moved verbatim from ElementCreator's five
// inline structures. The legacy element and global hydrate branches were
// byte-identical, so one hydrate covers both.
//
// MechanicalVentilation is the bridging-rule family alongside Vents
// (elementForms/vents.tsx, the precedent this module follows):
// parentElement, pitch, and orientation360 are shared with the not-yet-
// extracted wall family (see elementForms/types.ts's ElementFormSharedCtx doc
// comment) and are read/written only through ctx.shared, captured into this
// module's own returned state during useFormState (same precedent as
// OnSiteGeneration's getCurrentOrientation) so hydrate/reset/buildElementData/
// renderPanel — which the module contract doesn't hand ctx.shared directly —
// can still reach them.
//
// Choosing a parent wall/window makes an *optimistic display write* of that
// parent's pitch/orientation360 into the shared inputs, exactly like Vents —
// but unlike Vents' own inline duplicate of that logic, this module routes
// the write through ctx.shared.applyParentPitchOrientationForDisplay itself
// (rounded the same way the legacy inline handler rounded, so the result is
// unchanged). Manual edits of the orientation/pitch fields, by contrast, use
// the raw ctx.shared.setOrientation360/setPitch setters directly — ventilation
// units never rotate canvas geometry, so this module never calls
// ctx.shared.applyOrientationToGeometry (the wall family's rotate-the-polygon
// path).
//
// elementIds/elementsById/getGlobalOrientationOffset are captured from
// ElementFormStateCtx into this module's own state purely so buildElementData
// (which only receives the narrower ElementFormBuildCtx) can still resolve
// the live parent element and the global plan-rotation offset at save time —
// same precedent as ThermalBridgeLinear/MechanicalVentilationDuctwork
// capturing ctx.serviceLine. renderPanel receives the full
// ElementFormRenderCtx already, so it reads elementIds/elementsById/
// getGlobalOrientationOffset from ctx directly instead.
//
// getParentByName/getParentOrientation360/buildMechanicalVentilationParentPatch
// are pure functions shared with the wall family (still inline in
// ElementCreator.tsx) and now live in lib/parentOrientation.ts — see that
// file's header and the slice-4 brief's decision (f).1.
//
// commitMechanicalVentilationPositionField closes over ctx.selection/
// ctx.getElementById/ctx.commitExistingElementDraft, all already exposed on
// ElementFormStateCtx; isExistingElementSelection is a one-line derivation of
// ctx.selection, reimplemented locally rather than threaded through ctx (it
// has no other callers here).

import { useState, type CSSProperties } from 'react';
import { roundToTwoDecimals } from '../../geometry/constants';
import type { Element } from '../../geometry/types';
import {
  buildMechanicalVentilationParentPatch,
  getParentByName,
  getParentOrientation360,
} from '../../lib/parentOrientation';
import {
  applyMechanicalVentilationCsvPositionColumns,
  canMechanicalVentilationInheritHostPlacement,
  getMechanicalVentilationPositionValues,
} from '../../lib/mechanicalVentilationBranches';
import { ParentElementDropdown } from '../ParentElementDropdown';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { StandardDropdown } from '../StandardDropdown';
import {
  decimalInputProps,
  formatConditionalDecimals,
  readExtraJsonRecord,
  useDecimalInput,
} from './formPrimitives';
import type { ElementFormModule, ElementFormSelection, ElementFormStateCtx } from './types';

const INLINE_FIELD_NOTE_STYLE: CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-secondary)',
  lineHeight: 1.35,
  minWidth: 0,
};

export interface MechanicalVentilationFormState {
  ventType: string;
  setVentType: (value: string) => void;
  commitMechanicalVentilationPositionField: (
    field: 'mid_height_air_flow_path' | 'orientation360' | 'pitch',
  ) => (value: number | '') => void;
  mechanicalVentilationMidHeightInput: ReturnType<typeof useDecimalInput>;
  /** Shared with the wall family — see module header comment. */
  parentElement: string;
  setParentElement: (value: string) => void;
  pitch: number;
  setPitch: (value: number) => void;
  orientation360: number;
  setOrientation360: (value: number) => void;
  applyParentPitchOrientationForDisplay: (pitch: number | undefined, orientation: number | undefined) => void;
  /** Passed through from ElementFormStateCtx so buildElementData (which only
   * receives ElementFormBuildCtx) can still resolve the live parent and the
   * global plan-rotation offset — see module header comment. */
  elementIds: readonly string[];
  elementsById: Record<string, Element>;
  getGlobalOrientationOffset: () => number;
}

function useFormState(ctx: ElementFormStateCtx): MechanicalVentilationFormState {
  const [ventType, setVentType] = useState<string>('');

  const isExistingElementSelection = (): boolean =>
    !!ctx.selection && (ctx.selection.type === 'element' || ctx.selection.type === 'global') && !ctx.selection.isPlaceholder;

  const commitMechanicalVentilationPositionField = (
    field: 'mid_height_air_flow_path' | 'orientation360' | 'pitch',
  ) => (value: number | '') => {
    if (!isExistingElementSelection()) return;
    const currentSelection = ctx.selection as ElementFormSelection;
    const element = ctx.getElementById(currentSelection.id);
    if (!element || element.type !== 'MechanicalVentilation') return;
    const nextExtra = applyMechanicalVentilationCsvPositionColumns(
      readExtraJsonRecord(element.extra_json),
      element.vent_type,
      typeof value === 'number' ? { [field]: value } : {},
      { preservePositionMode: true },
    );
    if (value === '') {
      delete nextExtra[field];
    }
    ctx.commitExistingElementDraft({
      extra_json: Object.keys(nextExtra).length > 0 ? nextExtra : undefined,
    } as Partial<Element>);
  };

  const mechanicalVentilationMidHeightInput = useDecimalInput(
    '',
    commitMechanicalVentilationPositionField('mid_height_air_flow_path'),
    { commitOnChange: true },
  );

  return {
    ventType,
    setVentType,
    commitMechanicalVentilationPositionField,
    mechanicalVentilationMidHeightInput,
    parentElement: ctx.shared.parentElement,
    setParentElement: ctx.shared.setParentElement,
    pitch: ctx.shared.pitch,
    setPitch: ctx.shared.setPitch,
    orientation360: ctx.shared.orientation360,
    setOrientation360: ctx.shared.setOrientation360,
    applyParentPitchOrientationForDisplay: ctx.shared.applyParentPitchOrientationForDisplay,
    elementIds: ctx.elementIds,
    elementsById: ctx.elementsById,
    getGlobalOrientationOffset: ctx.getGlobalOrientationOffset,
  };
}

export const mechanicalVentilationFormModule: ElementFormModule<MechanicalVentilationFormState> = {
  type: 'MechanicalVentilation',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'MechanicalVentilation') return;
    state.setVentType('vent_type' in element ? element.vent_type ?? '' : '');
    state.setParentElement('parent_element' in element ? element.parent_element ?? '' : '');
    const positionValues = getMechanicalVentilationPositionValues(
      readExtraJsonRecord(element.extra_json),
      element.vent_type,
    );
    state.mechanicalVentilationMidHeightInput.setValue(
      typeof positionValues.mid_height_air_flow_path === 'number'
        ? roundToTwoDecimals(positionValues.mid_height_air_flow_path)
        : '',
    );
    if (typeof positionValues.orientation360 === 'number') {
      state.setOrientation360(Math.round(positionValues.orientation360));
    }
    if (typeof positionValues.pitch === 'number') {
      state.setPitch(Math.round(positionValues.pitch));
    }
  },

  reset(state) {
    state.setVentType('');
    state.mechanicalVentilationMidHeightInput.setValue('');
  },

  buildElementData(state, ctx) {
    const parent = getParentByName(state.elementsById, state.elementIds, state.parentElement);
    let extraJson: Record<string, unknown> = {};
    if (typeof state.mechanicalVentilationMidHeightInput.value === 'number') {
      extraJson = applyMechanicalVentilationCsvPositionColumns(
        extraJson,
        state.ventType,
        { mid_height_air_flow_path: state.mechanicalVentilationMidHeightInput.value },
      );
    }
    const draft = {
      ...ctx.baseData,
      type: 'MechanicalVentilation',
      vent_type: state.ventType || undefined,
      parent_element: state.parentElement || null,
      extra_json: Object.keys(extraJson).length > 0 ? extraJson : undefined,
    } as Element;
    const parentPatch = buildMechanicalVentilationParentPatch(
      draft,
      parent,
      state.parentElement,
      state.ventType,
      state.getGlobalOrientationOffset(),
    );
    const nextExtra =
      parentPatch.extra_json ??
      (Object.keys(extraJson).length > 0 ? extraJson : undefined);
    return {
      ...ctx.baseData,
      vent_type: state.ventType || undefined,
      parent_element: parentPatch.parent_element ?? (state.parentElement || null),
      extra_json: nextExtra,
      zoneId: undefined, // Global object
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const {
      ventType,
      setVentType,
      commitMechanicalVentilationPositionField,
      mechanicalVentilationMidHeightInput,
      parentElement,
      setParentElement,
      pitch,
      setPitch,
      orientation360,
      setOrientation360,
      applyParentPitchOrientationForDisplay,
    } = state;
    const {
      elementType,
      elementIds,
      elementsById,
      fieldUnit,
      renderFieldLabel,
      renderFieldLabelWithComparisonIndicator,
      registerBaseFieldRef,
      registerBaseFieldRefs,
      getFieldValidationIssue,
      comparisonFieldIndicators,
      selection,
      getElementById,
      updateElement,
      commitExistingElementDraft,
      getGlobalOrientationOffset,
      renderMvhrDuctAndTerminalManager,
    } = ctx;

    const mechanicalVentilationCanBeHosted = canMechanicalVentilationInheritHostPlacement(ventType);

    return (
      <>
        {renderFieldLabelWithComparisonIndicator('Ventilation Type:', elementType, comparisonFieldIndicators.vent_type)}
        <div className="element-input" ref={registerBaseFieldRef('vent_type')}>
          <StandardDropdown
            value={ventType}
            onChange={(value) => {
              const nextValue = value as any;
              setVentType(nextValue);
              if (!canMechanicalVentilationInheritHostPlacement(nextValue)) {
                setParentElement('');
              }
              if (selection?.type === 'element' || selection?.type === 'global') {
                const current = getElementById(selection.id);
                const parent = getParentByName(elementsById, elementIds, parentElement);
                const parentPatch = buildMechanicalVentilationParentPatch(
                  current,
                  parent,
                  canMechanicalVentilationInheritHostPlacement(nextValue) ? parentElement : '',
                  nextValue,
                  getGlobalOrientationOffset(),
                );
                commitExistingElementDraft({
                  vent_type: nextValue,
                  ...parentPatch,
                } as Partial<Element>);
              }
            }}
            options={[
              { value: 'Intermittent MEV', label: 'Intermittent MEV' },
              { value: 'Centralised continuous MEV', label: 'Centralised continuous MEV' },
              { value: 'Decentralised continuous MEV', label: 'Decentralised continuous MEV' },
              { value: 'MVHR', label: 'MVHR' }
            ]}
            variant="ghost"
            size="md"
          />
        </div>
        {mechanicalVentilationCanBeHosted && (
          <>
            {renderFieldLabel('Parent Element:', elementType, 'parent_element')}
            <div className="element-input" ref={registerBaseFieldRefs(['parentElement', 'parent_element'])}>
              <ParentElementDropdown
                value={parentElement}
                onChange={(value) => {
                  setParentElement(value);
                  const parent = getParentByName(elementsById, elementIds, value);
                  if (parent) {
                    const parentOrientation = getParentOrientation360(
                      parent,
                      getGlobalOrientationOffset(),
                    );
                    const parentPitch = (parent as { pitch?: unknown }).pitch;
                    applyParentPitchOrientationForDisplay(
                      typeof parentPitch === 'number' ? Math.round(parentPitch) : undefined,
                      typeof parentOrientation === 'number' ? Math.round(parentOrientation) : undefined,
                    );
                  }
                  if (selection?.type === 'element' || selection?.type === 'global') {
                    const current = getElementById(selection.id);
                    updateElement(
                      selection.id,
                      buildMechanicalVentilationParentPatch(
                        current,
                        parent,
                        value,
                        ventType,
                        getGlobalOrientationOffset(),
                      ),
                    );
                  }
                }}
                elementType={elementType}
                zoneId=""
                placeholder="Select a parent wall/window element (optional)"
                selfId={selection?.type === 'element' ? selection.id : undefined}
              />
            </div>
            {renderFieldLabel('Mid Height Air Flow Path (m):', elementType, 'mid_height_air_flow_path')}
            <div className="element-input" ref={registerBaseFieldRefs(['mechanicalVentilationMidHeight', 'mid_height_air_flow_path'])}>
              <StandardInput
                {...decimalInputProps(mechanicalVentilationMidHeightInput)}
                unit={fieldUnit('mid_height_air_flow_path')}
                step="0.1"
                min="0"
                variant="ghost"
                size="md"
                className="flex-1"
              />
              <FieldValidationIndicator
                hasIssue={!!getFieldValidationIssue('mid_height_air_flow_path', mechanicalVentilationMidHeightInput.value)}
                issue={getFieldValidationIssue('mid_height_air_flow_path', mechanicalVentilationMidHeightInput.value) || undefined}
              />
            </div>
            {renderFieldLabel('Orientation (degrees):', elementType, 'orientation360')}
            <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRefs('orientation360')}>
              <StandardInput
                type="text"
                inputMode="numeric"
                value={Number.isFinite(orientation360) ? orientation360 : ''}
                unit={fieldUnit('orientation360')}
                onChange={(e) => {
                  const parsed = Math.round(parseFloat(e.target.value) || 0);
                  setOrientation360(parsed);
                  commitMechanicalVentilationPositionField('orientation360')(parsed);
                }}
                step="1"
                min="0"
                max="360"
                readOnly={!!parentElement}
                variant="ghost"
                size="md"
              />
              {parentElement && (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  Inherited from parent: {parentElement}
                </div>
              )}
            </div>
            {renderFieldLabel('Pitch (degrees):', elementType, 'pitch')}
            <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRefs('pitch')}>
              <StandardInput
                type="text"
                inputMode="numeric"
                value={Number.isFinite(pitch) ? formatConditionalDecimals(pitch) : ''}
                unit={fieldUnit('pitch')}
                onChange={(e) => {
                  const parsed = Math.round(parseFloat(e.target.value) || 0);
                  setPitch(parsed);
                  commitMechanicalVentilationPositionField('pitch')(parsed);
                }}
                step="1"
                min="0"
                max="180"
                readOnly={!!parentElement}
                variant="ghost"
                size="md"
              />
              {parentElement && (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  Inherited from parent: {parentElement}
                </div>
              )}
            </div>
          </>
        )}
        {ventType === 'MVHR' ? renderMvhrDuctAndTerminalManager() : null}
      </>
    );
  },

  subtype(state) {
    return state.ventType || undefined;
  },
};
