// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// WetEmitter form family, moved verbatim from ElementCreator's five inline
// structures (slice-5 brief: System + WetEmitter). WetEmitter has NO global
// hydrate branch — legacy code only ever populated it from the element
// branch — so unlike most already-extracted siblings this module's hydrate()
// has no second branch to reconcile; it is simply the one path that existed.
//
// SEAM RESOLUTION — spaceHeatSystem (read this before touching the space-heat-
// system dropdown): the six System<->WetEmitter cross-creation/jump handlers
// stay orchestrator-owned by slice-5 brief decision (f).1 (the CONSERVATIVE
// option), injected as ElementFormRenderCtx.renderSpaceHeatSystemPicker() — see
// that field's doc comment in elementForms/types.ts. That callback's dropdown
// both DISPLAYS and WRITES `spaceHeatSystem`, and its "Create new
// SpaceHeatSystem..." path (createSpaceHeatSystemForCurrentEmitter) writes it
// too. Because the callback is a zero-arg `() => ReactNode` (matching the
// locked ctx contract and the renderMvhrDuctAndTerminalManager precedent), it
// cannot receive this module's state as a call-time argument, and it is
// defined/depended-on (by the spaceHeatSystemOptions/
// selectedSpaceHeatSystemForEmitter memos and the six handlers themselves)
// well before this module's useFormState result would exist in ElementCreator's
// render order. So `spaceHeatSystem` is resolved the same way heightInput/
// distanceInput/parentElement/pitch/orientation360 already are for Vents/
// MechanicalVentilation/WindowShading/ContextShading: it stays an
// orchestrator-owned useState, bridged to this module through
// ElementFormSharedCtx (see that interface's doc comment), captured into this
// module's own returned state during useFormState so hydrate/buildElementData
// (which the module contract doesn't hand ctx.shared directly) can still reach
// it — NOT moved into a module-local useState despite being listed as
// "exclusive state" in the slice-5 brief's per-family breakdown. Matching the
// wall-family precedent (see ElementFormSharedCtx's doc comment on
// parentElement), resetting spaceHeatSystem to '' stays centralized in the
// orchestrator's resetFormFields, not delegated to this module's reset() —
// this module's reset() only clears subcategory/unitNumberInput, its genuinely
// exclusive state.
//
// spaceHeatSystemOptions (the dropdown's option list, including the
// "(missing)" fallback and the CREATE_SPACE_HEAT_SYSTEM_OPTION sentinel) and
// selectedSpaceHeatSystemForEmitter (the "Edit" link's target) stay
// orchestrator-owned too, for the same reason: both are consumed ONLY by
// renderSpaceHeatSystemPicker, never by this module's own renderPanel — the
// picker's JSX moved into that callback, not here.
//
// areaInput is the UFH-only area field, shared with the not-yet-extracted wall
// family (Opaque/Transparent/Ground/adjacent) — read/written ONLY via
// ctx.shared, same precedent as Vents/MechanicalVentilation's parentElement.
//
// The UFH<->polygon and radiator/fancoil<->line window.confirm() shape-
// conversion prompts in hydrate() move verbatim, including the try/swallow —
// legacy behaviour, not new. hydrate() needs updateElement for that side
// effect, so it is captured into this module's own state during useFormState
// (same precedent as MechanicalVentilation/MechanicalVentilationTerminal
// capturing elementIds/elementsById/getGlobalOrientationOffset for
// buildElementData) — the first WetEmitter/System-family module whose
// hydrate(), not just buildElementData()/renderPanel(), needs a captured ctx
// value, since the module contract's hydrate(state, element) receives no ctx.

import { useState } from 'react';
import { getElementShape, convertShapeCoordinates } from '../../lib/shapeUtils';
import type { Element } from '../../geometry/types';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { StandardDropdown } from '../StandardDropdown';
import {
  decimalInputProps,
  integerInputProps,
  useIntegerInput,
  type NumericDraftInputBinding,
} from './formPrimitives';
import type { ElementFormModule, ElementFormStateCtx } from './types';

/** ElementCreator's own local ElementOfType<T> alias (not exported there) had
 * exactly one remaining caller — the subcategory dropdown's value cast below —
 * so it moved here with it (grep-verified zero other callers in
 * ElementCreator.tsx), rather than staying behind as a mirrored copy like
 * MechanicalVentilationTerminal's. */
type ElementOfType<T extends Element['type']> = Extract<Element, { type: T }>;

export interface WetEmitterFormState {
  subcategory: '' | 'radiator' | 'ufh' | 'fancoil';
  setSubcategory: (value: '' | 'radiator' | 'ufh' | 'fancoil') => void;
  unitNumberInput: ReturnType<typeof useIntegerInput>;
  /** Shared with the orchestrator-owned System<->WetEmitter bridge — see the
   * module header's "SEAM RESOLUTION" note. */
  spaceHeatSystem: string;
  setSpaceHeatSystem: (value: string) => void;
  /** Shared with the not-yet-extracted wall family — see module header comment. */
  areaInput: NumericDraftInputBinding;
  /** Captured for hydrate()'s shape-conversion window.confirm() prompts — see
   * module header comment. */
  updateElement: ElementFormStateCtx['updateElement'];
}

function useFormState(ctx: ElementFormStateCtx): WetEmitterFormState {
  const [subcategory, setSubcategory] = useState<'' | 'radiator' | 'ufh' | 'fancoil'>('');
  const unitNumberInput = useIntegerInput('', ctx.commitElementNumericField('unit_number'), { commitOnChange: true });

  return {
    subcategory,
    setSubcategory,
    unitNumberInput,
    spaceHeatSystem: ctx.shared.spaceHeatSystem,
    setSpaceHeatSystem: ctx.shared.setSpaceHeatSystem,
    areaInput: ctx.shared.areaInput,
    updateElement: ctx.updateElement,
  };
}

export const wetEmitterFormModule: ElementFormModule<WetEmitterFormState> = {
  type: 'WetEmitter',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'WetEmitter') return;
    state.setSubcategory('subcategory' in element ? element.subcategory ?? '' : '');
    state.setSpaceHeatSystem('space_heat_system' in element ? (element.space_heat_system ?? '') : '');
    state.areaInput.setValue('area' in element ? element.area ?? '' : '');
    state.unitNumberInput.setValue(
      'unit_number' in element
        ? (typeof element.unit_number === 'number' ? Math.round(element.unit_number) : (element.unit_number ?? ''))
        : ''
    );
    try {
      const currentElement = element as any;
      const coords = currentElement.coordinates || [];
      const shape = getElementShape(currentElement);
      if (currentElement.subcategory === 'ufh' && shape !== 'polygon' && coords.length >= 2) {
        const ok = window.confirm('Underfloor heating works best as a polygon. Convert this to a polygon now?');
        if (ok) {
          const next = convertShapeCoordinates(currentElement as any, 'polygon');
          state.updateElement(currentElement.id, { coordinates: next });
        }
      } else if ((currentElement.subcategory === 'radiator' || currentElement.subcategory === 'fancoil') && shape !== 'line' && coords.length >= 1) {
        const ok = window.confirm('Radiator/Fan coil works best as a line. Convert this to a line now?');
        if (ok) {
          const next = convertShapeCoordinates(currentElement as any, 'line');
          state.updateElement(currentElement.id, { coordinates: next });
        }
      }
    } catch { /* swallow: best-effort */ }
  },

  reset(state) {
    state.setSubcategory('');
    state.unitNumberInput.setValue('');
    // spaceHeatSystem is shared with the orchestrator-owned System<->WetEmitter
    // bridge (see ElementFormSharedCtx) and is reset directly by the
    // orchestrator's resetFormFields, like parentElement/distanceInput above —
    // see module header's "SEAM RESOLUTION" note. areaInput is shared with the
    // wall family and is likewise reset directly by resetFormFields.
  },

  buildElementData(state, ctx) {
    return {
      ...ctx.baseData,
      subcategory: state.subcategory || undefined,
      area: state.areaInput.value || undefined,
      unit_number: state.unitNumberInput.value || undefined,
      space_heat_system: state.spaceHeatSystem || undefined,
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const { subcategory, setSubcategory, unitNumberInput, areaInput } = state;
    const {
      elementType,
      fieldUnit,
      renderFieldLabel,
      renderFieldLabelWithComparisonIndicator,
      registerBaseFieldRefs,
      getFieldValidationIssue,
      comparisonFieldIndicators,
      commitExistingElementDraft,
      renderSpaceHeatSystemPicker,
    } = ctx;

    return (
      <>
        {renderFieldLabel('Subcategory:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs('subcategory')}>
          <StandardDropdown
            value={subcategory}
            onChange={(value) => {
              const nextValue = value as ElementOfType<'WetEmitter'>['subcategory'];
              setSubcategory(nextValue);
              commitExistingElementDraft({ subcategory: nextValue });
            }}
            options={[
              { value: 'radiator', label: 'Radiator' },
              { value: 'ufh', label: 'Underfloor Heating' },
              { value: 'fancoil', label: 'Fan Coil' }
            ]}
            variant="ghost"
            size="md"
          />
        </div>
        {renderSpaceHeatSystemPicker()}
        {subcategory === 'ufh' && (
          <>
            {renderFieldLabelWithComparisonIndicator('Area (m²):', elementType, comparisonFieldIndicators.area, 'area')}
            <div className="element-input" ref={registerBaseFieldRefs('area')}>
              <StandardInput
                {...decimalInputProps(areaInput)}
                unit={fieldUnit('area')}
                step="0.01"
                min="0"
                required
                variant="ghost"
                size="md"
              />
            </div>
          </>
        )}
        {(subcategory === 'radiator' || subcategory === 'fancoil') && (
          <>
            {renderFieldLabel('Unit Number:', elementType)}
            <div className="element-input" ref={registerBaseFieldRefs(['unitNumber', 'unit_number'])}>
              <StandardInput
                {...integerInputProps(unitNumberInput)}
                unit={fieldUnit('unit_number')}
                step="1"
                min="0"
                required
                variant="ghost"
                size="md"
                className="flex-1"
              />
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('unitNumber', unitNumberInput.value)} issue={getFieldValidationIssue('unitNumber', unitNumberInput.value) || undefined} />
            </div>
          </>
        )}
      </>
    );
  },

  subtype(state) {
    return state.subcategory || undefined;
  },
};
