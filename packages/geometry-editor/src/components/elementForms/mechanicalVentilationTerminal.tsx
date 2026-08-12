// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// MechanicalVentilationTerminal form family, moved verbatim from
// ElementCreator's five inline structures (the Terminal bits used to be
// interleaved with MechanicalVentilationDuctwork's under one mislabeled
// comment block; slice 3 already re-split ductType out — see the slice-4
// brief's decision (f).2). The legacy element and global hydrate branches
// were byte-identical (diffed against community main @ 1677115), so one
// hydrate covers both.
//
// MechanicalVentilationTerminal has no subtype — legacy getElementSubtype had
// no case for it, so this module omits subtype() (slice-4 brief (g).5).
//
// parentElement/setParentElement (the MVHR unit this terminal belongs to) is
// shared with the wall family via ctx.shared, same precedent as Vents/
// MechanicalVentilation — captured into this module's own returned state
// during useFormState so hydrate/reset/buildElementData/renderPanel can still
// reach it. Unlike MechanicalVentilation, Terminal does NOT share pitch/
// orientation360 with the wall family: a manually-positioned terminal's own
// orientation/pitch are dedicated integer inputs (mvhrTerminalOrientationInput
// / mvhrTerminalPitchInput below), never routed through ctx.shared.
//
// terminalType/hostElement are this module's own exclusive state.
// commitMvhrTerminalManualPositionField's side effect — setHostElement('') on
// every manual orientation/pitch commit, clearing the mounted-host binding —
// is preserved exactly; it is legacy behaviour, not new.
//
// MVHR_TERMINAL_MANUAL_POSITION_VALUE (the "manual external position"
// dropdown sentinel) was Terminal-only in ElementCreator.tsx (grep-verified
// against the pre-move file), so it moves here as a module-local const
// instead of staying a shared orchestrator constant.
//
// getCurrentTerminal/findEligibleHost are captured-at-useFormState-time
// helpers (same precedent as Vents' findWallOrWindowParentByName) so
// buildElementData — which only receives the narrower ElementFormBuildCtx,
// without selection/getElementById/elementsById — can still resolve the
// currently selected element and look up a host by name at save time.
// renderPanel receives the full ElementFormRenderCtx already, so it computes
// the equivalent lookups directly from ctx instead of reusing these helpers,
// same split as MechanicalVentilation's module. Both replace the
// orchestrator's old `allElements` local (Object.values(elementsById), NOT
// elementIds.map(id => elementsById[id])) with Object.values(ctx.elementsById)
// so the host dropdown's option order is unchanged.
//
// isMvhrTerminalHost/deriveMechanicalVentilationTerminalPosition/
// MVHR_TERMINAL_ROLES are pure functions that already lived in
// lib/mvhrDuctwork.ts before this slice (shared with GeometryCanvas,
// geometryStore, and validateElement) — not moved, just imported.
// getParentByName is the wall-family lookup moved to lib/parentOrientation.ts
// in this slice's stage 1 (decision (f).1).
//
// Note on ctx.selection's nullability: ElementCreator's own renderAttributePanel
// runs inside ElementCreatorContent, whose `selection` prop type is narrowed to
// NonNullable — so several legacy call sites (e.g. the MVHR-unit dropdown's
// selfId) read `selection.type`/`selection.id` with no optional chaining.
// ElementFormRenderCtx.selection is honestly `ElementFormSelection | null`
// (the module doesn't get that prop-level guarantee), so this module adds `?.`
// at that one call site — no behaviour change, since selection is never
// actually null while this panel renders; same adaptation MechanicalVentilation's
// module already made for its own copy of the MVHR-unit dropdown.
//
// INTENTIONAL BEHAVIOUR FIX (slice-4 brief decision (g).3): legacy
// resetFormFields never reset mvhrTerminalOrientationInput/
// mvhrTerminalPitchInput, so a manually-positioned terminal's orientation/
// pitch leaked into the next new terminal's form. Fixed in this module's
// reset() — see the clearly-marked lines below.

import { useState } from 'react';
import { roundToTwoDecimals } from '../../geometry/constants';
import type { Element } from '../../geometry/types';
import { getParentByName } from '../../lib/parentOrientation';
import {
  deriveMechanicalVentilationTerminalPosition,
  isMvhrTerminalHost,
  MVHR_TERMINAL_ROLES,
} from '../../lib/mvhrDuctwork';
import { ParentElementDropdown } from '../ParentElementDropdown';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { StandardDropdown } from '../StandardDropdown';
import {
  decimalInputProps,
  formatConditionalDecimals,
  integerInputProps,
  useDecimalInput,
  useIntegerInput,
} from './formPrimitives';
import type { ElementFormModule, ElementFormSelection, ElementFormStateCtx } from './types';

/** Mirrors ElementCreator's own local ElementOfType<T> alias (not exported
 * there), used the same way here for the terminal-type dropdown's value cast. */
type ElementOfType<T extends Element['type']> = Extract<Element, { type: T }>;

/** "Manual external position" sentinel for the Mounted-on dropdown —
 * Terminal-only in use (grep-verified against ElementCreator.tsx pre-move). */
const MVHR_TERMINAL_MANUAL_POSITION_VALUE = '__manual_external_position__';

export interface MechanicalVentilationTerminalFormState {
  terminalType: '' | 'intake' | 'exhaust';
  setTerminalType: (value: '' | 'intake' | 'exhaust') => void;
  hostElement: string;
  setHostElement: (value: string) => void;
  commitMvhrTerminalMidHeightAirFlowPath: (value: number | '') => void;
  mvhrTerminalMidHeightAirFlowPathInput: ReturnType<typeof useDecimalInput>;
  commitMvhrTerminalManualPositionField: (
    field: 'orientation360' | 'pitch',
  ) => (value: number | '') => void;
  mvhrTerminalOrientationInput: ReturnType<typeof useIntegerInput>;
  mvhrTerminalPitchInput: ReturnType<typeof useIntegerInput>;
  /** Shared with the wall family — see module header comment. */
  parentElement: string;
  setParentElement: (value: string) => void;
  /** Captured from ElementFormStateCtx so buildElementData (which only
   * receives ElementFormBuildCtx) can still resolve the live selection and an
   * eligible host by name — see module header comment. */
  getCurrentTerminal: () => Element | undefined;
  findEligibleHost: (hostName: string) => Element | undefined;
}

function useFormState(ctx: ElementFormStateCtx): MechanicalVentilationTerminalFormState {
  const [terminalType, setTerminalType] = useState<'' | 'intake' | 'exhaust'>('');
  const [hostElement, setHostElement] = useState<string>('');

  const isExistingElementSelection = (): boolean =>
    !!ctx.selection && (ctx.selection.type === 'element' || ctx.selection.type === 'global') && !ctx.selection.isPlaceholder;

  const commitMvhrTerminalMidHeightAirFlowPath = (value: number | '') => {
    if (!isExistingElementSelection() || typeof value !== 'number') return;
    const currentSelection = ctx.selection as ElementFormSelection;
    const element = ctx.getElementById(currentSelection.id);
    if (!element || element.type !== 'MechanicalVentilationTerminal') return;
    const currentPoint = element.coordinates?.[0] ?? { x: 0, y: 0, z: value };
    ctx.commitExistingElementDraft({
      mid_height_air_flow_path: value,
      coordinates: [{ ...currentPoint, z: value }],
    } as Partial<Element>);
  };
  const mvhrTerminalMidHeightAirFlowPathInput = useDecimalInput(
    '',
    commitMvhrTerminalMidHeightAirFlowPath,
    { commitOnChange: true },
  );

  const commitMvhrTerminalManualPositionField = (
    field: 'orientation360' | 'pitch',
  ) => (value: number | '') => {
    if (!isExistingElementSelection()) return;
    setHostElement('');
    ctx.commitExistingElementDraft({
      host_element: null,
      [field]: typeof value === 'number' ? value : undefined,
    } as Partial<Element>);
  };
  const mvhrTerminalOrientationInput = useIntegerInput(
    '',
    commitMvhrTerminalManualPositionField('orientation360'),
    { commitOnChange: true },
  );
  const mvhrTerminalPitchInput = useIntegerInput(
    '',
    commitMvhrTerminalManualPositionField('pitch'),
    { commitOnChange: true },
  );

  const getCurrentTerminal = (): Element | undefined =>
    ctx.selection?.type === 'element' || ctx.selection?.type === 'global'
      ? ctx.getElementById(ctx.selection.id)
      : undefined;

  const findEligibleHost = (hostName: string): Element | undefined =>
    Object.values(ctx.elementsById).find((element) => element.name === hostName);

  return {
    terminalType,
    setTerminalType,
    hostElement,
    setHostElement,
    commitMvhrTerminalMidHeightAirFlowPath,
    mvhrTerminalMidHeightAirFlowPathInput,
    commitMvhrTerminalManualPositionField,
    mvhrTerminalOrientationInput,
    mvhrTerminalPitchInput,
    parentElement: ctx.shared.parentElement,
    setParentElement: ctx.shared.setParentElement,
    getCurrentTerminal,
    findEligibleHost,
  };
}

export const mechanicalVentilationTerminalFormModule: ElementFormModule<MechanicalVentilationTerminalFormState> = {
  type: 'MechanicalVentilationTerminal',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'MechanicalVentilationTerminal') return;
    state.setTerminalType('terminal_type' in element ? element.terminal_type ?? '' : '');
    state.setParentElement('parent_element' in element ? element.parent_element ?? '' : '');
    state.setHostElement('host_element' in element ? element.host_element ?? '' : '');
    const point = element.coordinates?.[0];
    state.mvhrTerminalMidHeightAirFlowPathInput.setValue(
      point && typeof point.z === 'number' ? roundToTwoDecimals(point.z) : '',
    );
    state.mvhrTerminalOrientationInput.setValue(
      typeof element.orientation360 === 'number' ? Math.round(element.orientation360) : '',
    );
    state.mvhrTerminalPitchInput.setValue(
      typeof element.pitch === 'number' ? Math.round(element.pitch) : '',
    );
  },

  reset(state) {
    state.setTerminalType('');
    state.setHostElement('');
    state.mvhrTerminalMidHeightAirFlowPathInput.setValue('');

    // INTENTIONAL BEHAVIOUR FIX (slice-4 brief decision (g).3): legacy never
    // reset these two inputs (exhaustive grep, no other setValue('') site), so
    // a manually-positioned terminal's orientation/pitch leaked into the next
    // new terminal's form. Reset them here.
    state.mvhrTerminalOrientationInput.setValue('');
    state.mvhrTerminalPitchInput.setValue('');
  },

  buildElementData(state, ctx) {
    const current = state.getCurrentTerminal();
    const selectedHost = state.hostElement ? state.findEligibleHost(state.hostElement) : undefined;
    const eligibleHostName = isMvhrTerminalHost(selectedHost) ? state.hostElement : '';
    const currentPoint = current?.coordinates?.[0] ?? { x: 0, y: 0, z: 2.4 };
    const z =
      typeof state.mvhrTerminalMidHeightAirFlowPathInput.value === 'number'
        ? state.mvhrTerminalMidHeightAirFlowPathInput.value
        : (typeof currentPoint.z === 'number' ? currentPoint.z : 2.4);
    return {
      ...ctx.baseData,
      terminal_type: state.terminalType || undefined,
      parent_element: state.parentElement || null,
      host_element: eligibleHostName || null,
      orientation360: eligibleHostName
        ? undefined
        : (typeof state.mvhrTerminalOrientationInput.value === 'number'
          ? state.mvhrTerminalOrientationInput.value
          : undefined),
      pitch: eligibleHostName
        ? undefined
        : (typeof state.mvhrTerminalPitchInput.value === 'number'
          ? state.mvhrTerminalPitchInput.value
          : undefined),
      mid_height_air_flow_path: z,
      coordinates: [{ ...currentPoint, z }],
      zoneId: undefined,
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const {
      terminalType,
      setTerminalType,
      hostElement,
      setHostElement,
      mvhrTerminalMidHeightAirFlowPathInput,
      mvhrTerminalOrientationInput,
      mvhrTerminalPitchInput,
      parentElement,
      setParentElement,
    } = state;
    const {
      elementType,
      elementZoneId,
      elementIds,
      elementsById,
      fieldUnit,
      renderFieldLabel,
      registerBaseFieldRefs,
      getFieldValidationIssue,
      selection,
      getElementById,
      updateElement,
      commitExistingElementDraft,
    } = ctx;

    const hostOptions = [
      { value: MVHR_TERMINAL_MANUAL_POSITION_VALUE, label: 'Manual external position' },
      ...Object.values(elementsById)
        .filter((candidate) => isMvhrTerminalHost(candidate))
        .map((candidate) => ({ value: candidate.name, label: candidate.name })),
    ];
    const currentTerminal =
      selection?.type === 'element' || selection?.type === 'global'
        ? getElementById(selection.id)
        : undefined;
    const mountedHostCandidate = hostElement
      ? getParentByName(elementsById, elementIds, hostElement)
      : undefined;
    const mountedHost = isMvhrTerminalHost(mountedHostCandidate) ? mountedHostCandidate : undefined;
    const usesManualExternalPosition = !mountedHost;
    const derivedPosition =
      currentTerminal?.type === 'MechanicalVentilationTerminal'
        ? deriveMechanicalVentilationTerminalPosition(currentTerminal, mountedHost)
        : null;

    return (
      <>
        {renderFieldLabel('MVHR unit:', elementType, 'parent_element')}
        <div className="element-input" ref={registerBaseFieldRefs(['parentElement', 'parent_element'])}>
          <ParentElementDropdown
            value={parentElement}
            onChange={(value) => {
              setParentElement(value);
              if (selection && (selection.type === 'element' || selection.type === 'global')) {
                updateElement(selection.id, { parent_element: value || null } as Partial<Element>);
              }
            }}
            elementType={elementType}
            zoneId={elementZoneId}
            placeholder="Select MVHR unit"
            selfId={selection?.type === 'element' ? selection.id : undefined}
          />
        </div>
        {renderFieldLabel('Terminal Type:', elementType, 'terminal_type')}
        <div className="element-input" ref={registerBaseFieldRefs(['terminalType', 'terminal_type'])}>
          <StandardDropdown
            value={terminalType}
            onChange={(value) => {
              const nextValue = value as ElementOfType<'MechanicalVentilationTerminal'>['terminal_type'];
              setTerminalType(nextValue);
              commitExistingElementDraft({ terminal_type: nextValue } as Partial<Element>);
            }}
            options={MVHR_TERMINAL_ROLES.map((role) => ({ value: role, label: role }))}
            variant="ghost"
            size="md"
          />
        </div>
        {renderFieldLabel('Mounted on:', elementType, 'host_element')}
        <div className="element-input" ref={registerBaseFieldRefs(['hostElement', 'host_element'])}>
          <StandardDropdown
            value={usesManualExternalPosition ? MVHR_TERMINAL_MANUAL_POSITION_VALUE : hostElement}
            onChange={(value) => {
              const nextValue = String(value || '');
              const useManualPosition = nextValue === MVHR_TERMINAL_MANUAL_POSITION_VALUE;
              const nextHostElement = useManualPosition ? '' : nextValue;
              setHostElement(nextHostElement);
              if (selection && (selection.type === 'element' || selection.type === 'global')) {
                if (useManualPosition) {
                  const nextOrientation = Math.round(derivedPosition?.orientation360 ?? 0);
                  const nextPitch = Math.round(derivedPosition?.pitch ?? 90);
                  mvhrTerminalOrientationInput.setValue(nextOrientation);
                  mvhrTerminalPitchInput.setValue(nextPitch);
                  updateElement(selection.id, {
                    host_element: null,
                    orientation360: nextOrientation,
                    pitch: nextPitch,
                  } as Partial<Element>);
                } else {
                  mvhrTerminalOrientationInput.setValue('');
                  mvhrTerminalPitchInput.setValue('');
                  updateElement(selection.id, {
                    host_element: nextHostElement || null,
                    orientation360: undefined,
                    pitch: undefined,
                  } as Partial<Element>);
                }
              }
            }}
            options={hostOptions}
            variant="ghost"
            size="md"
          />
        </div>
        {usesManualExternalPosition && (
          <>
            {renderFieldLabel('External orientation (degrees):', elementType, 'orientation360')}
            <div className="element-input" ref={registerBaseFieldRefs('orientation360')}>
              <StandardInput
                {...integerInputProps(mvhrTerminalOrientationInput)}
                unit={fieldUnit('orientation360')}
                min="0"
                max="360"
                step="1"
                variant="ghost"
                size="md"
                className="flex-1"
              />
              <FieldValidationIndicator
                hasIssue={!!getFieldValidationIssue('orientation360', mvhrTerminalOrientationInput.value)}
                issue={getFieldValidationIssue('orientation360', mvhrTerminalOrientationInput.value) || undefined}
              />
            </div>
            {renderFieldLabel('External pitch (degrees):', elementType, 'pitch')}
            <div className="element-input" ref={registerBaseFieldRefs('pitch')}>
              <StandardInput
                {...integerInputProps(mvhrTerminalPitchInput)}
                unit={fieldUnit('pitch')}
                min="0"
                max="180"
                step="1"
                variant="ghost"
                size="md"
                className="flex-1"
              />
              <FieldValidationIndicator
                hasIssue={!!getFieldValidationIssue('pitch', mvhrTerminalPitchInput.value)}
                issue={getFieldValidationIssue('pitch', mvhrTerminalPitchInput.value) || undefined}
              />
            </div>
          </>
        )}
        {renderFieldLabel('mid_height_air_flow_path:', elementType, 'mid_height_air_flow_path')}
        <div className="element-input" ref={registerBaseFieldRefs(['mvhrTerminalMidHeightAirFlowPath', 'mid_height_air_flow_path'])}>
          <StandardInput
            {...decimalInputProps(mvhrTerminalMidHeightAirFlowPathInput)}
            unit={fieldUnit('mid_height_air_flow_path')}
            step="0.1"
            min="0"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          <FieldValidationIndicator
            hasIssue={!!getFieldValidationIssue('mid_height_air_flow_path', mvhrTerminalMidHeightAirFlowPathInput.value)}
            issue={getFieldValidationIssue('mid_height_air_flow_path', mvhrTerminalMidHeightAirFlowPathInput.value) || undefined}
          />
        </div>
        {derivedPosition ? (
          <div className="element-editor-note">
            Export position: mid_height_air_flow_path {formatConditionalDecimals(derivedPosition.mid_height_air_flow_path)} m,
            orientation {Math.round(derivedPosition.orientation360)}°, pitch {Math.round(derivedPosition.pitch)}°.
          </div>
        ) : mountedHost ? (
          <div className="element-editor-note">
            Position will export after the mounted host and terminal point are valid.
          </div>
        ) : (
          <div className="element-editor-note">
            Manual position will export after height, external orientation, and pitch are valid.
          </div>
        )}
      </>
    );
  },
};
