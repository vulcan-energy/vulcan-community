// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// MechanicalVentilationDuctwork (MVD) form family, moved verbatim from
// ElementCreator's five inline structures. MVD's element-selection and
// global-selection hydrate branches were byte-identical, so one hydrate
// covers both.
//
// MVD's length/Z0/Z1 fields belong to the service-line group shared with
// ThermalBridgeLinear and WaterPipework (elementForms/serviceLine.tsx) — a
// single instance created by the orchestrator via useServiceLineFormState and
// captured here from ctx.serviceLine at useFormState time (same precedent as
// ThermalBridgeLinear's own capture, elementForms/thermalBridgeLinear.tsx), so
// hydrate/reset/buildElementData/renderPanel (which the module contract
// doesn't hand ctx.serviceLine directly) can still reach it.
//
// parentElement/setParentElement is shared with the wall family (and Vents/
// ContextShading/WindowShading) via ctx.shared and is captured the same way
// (vents.tsx precedent) — MVD reads/writes it only through these bindings;
// the orchestrator remains the sole owner of the underlying state.
//
// terminalType/hostElement belong to MechanicalVentilationTerminal, a
// separate element family that stays inline in ElementCreator for now.

import { useState } from 'react';
import { DUCT_TYPES, type DuctType, type Element } from '../../stores/geometryStore';
import { ParentElementDropdown } from '../ParentElementDropdown';
import { StandardDropdown } from '../StandardDropdown';
import {
  hydrateServiceLineFromElement,
  renderServiceLineCoreFields,
  resetServiceLine,
  type ServiceLineFormGroup,
} from './serviceLine';
import type { ElementFormModule, ElementFormStateCtx } from './types';

/** Mirrors ElementCreator's own local ElementOfType<T> alias (not exported
 * there), used the same way here for the duct-type dropdown's value cast. */
type ElementOfType<T extends Element['type']> = Extract<Element, { type: T }>;

export interface MechanicalVentilationDuctworkFormState {
  ductType: '' | DuctType;
  setDuctType: (value: '' | DuctType) => void;
  /** Shared with the wall family — see module header comment. */
  parentElement: string;
  setParentElement: (value: string) => void;
  /** Shared with ThermalBridgeLinear/WaterPipework — see module header comment. */
  serviceLine: ServiceLineFormGroup;
}

function useFormState(ctx: ElementFormStateCtx): MechanicalVentilationDuctworkFormState {
  const [ductType, setDuctType] = useState<'' | DuctType>('');

  return {
    ductType,
    setDuctType,
    parentElement: ctx.shared.parentElement,
    setParentElement: ctx.shared.setParentElement,
    serviceLine: ctx.serviceLine,
  };
}

export const mechanicalVentilationDuctworkFormModule: ElementFormModule<MechanicalVentilationDuctworkFormState> = {
  type: 'MechanicalVentilationDuctwork',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'MechanicalVentilationDuctwork') return;
    state.setDuctType('duct_type' in element ? element.duct_type ?? '' : '');
    hydrateServiceLineFromElement(state.serviceLine, element);
    state.setParentElement('parent_element' in element ? element.parent_element ?? '' : '');
  },

  reset(state) {
    state.setDuctType('');
    resetServiceLine(state.serviceLine);
  },

  buildElementData(state, ctx) {
    return {
      ...ctx.baseData,
      duct_type: state.ductType || undefined,
      length: state.serviceLine.lengthInput.value,
      parent_element: state.parentElement,
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const { ductType, setDuctType, parentElement, setParentElement, serviceLine } = state;
    const {
      elementType,
      elementZoneId,
      selection,
      updateElement,
      commitExistingElementDraft,
      registerBaseFieldRefs,
      renderFieldLabel,
    } = ctx;

    return (
      <>
        {renderFieldLabel('MVHR unit:', elementType, 'parent_element')}
        <div className="element-input">
          <ParentElementDropdown
            value={parentElement}
            onChange={(value) => {
              setParentElement(value);
              // Update the element in the store with the new parent_element (both placeholder and non-placeholder)
              if (selection && (selection.type === 'element' || selection.type === 'global')) {
                updateElement(selection.id, { parent_element: value });
              }
            }}
            elementType={elementType}
            zoneId={elementZoneId}
            placeholder="Select a Mechanical Ventilation system"
            selfId={selection?.type === 'element' ? selection.id : undefined}
          />
        </div>
        {renderFieldLabel('Duct Type:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['ductType', 'duct_type'])}>
          <StandardDropdown
            value={ductType}
            onChange={(value) => {
              const nextValue = value as ElementOfType<'MechanicalVentilationDuctwork'>['duct_type'];
              setDuctType(nextValue);
              commitExistingElementDraft({ duct_type: nextValue });
            }}
            options={DUCT_TYPES.map(type => ({ value: type, label: type }))}
            variant="ghost"
            size="md"
          />
        </div>
        {renderServiceLineCoreFields(serviceLine, ctx, {
          lengthLabel: (mode) => (mode === 'vertical' ? 'Vertical Length (m):' : 'Plan Length (m):'),
          lengthReadOnlyWhenVertical: true,
          zRefKeys: ['service_line_z0', 'service_line_z1'],
          showActualLengthWhenSlope: true,
        })}
      </>
    );
  },
};
