// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// WaterPipework (WP) form family, moved verbatim from ElementCreator's five
// inline structures. WP's element-selection and global-selection hydrate
// branches were byte-identical, so one hydrate covers both.
//
// WP's length/Z0/Z1 fields belong to the service-line group shared with
// ThermalBridgeLinear and MechanicalVentilationDuctwork
// (elementForms/serviceLine.tsx) — a single instance created by the
// orchestrator via useServiceLineFormState and captured here from
// ctx.serviceLine at useFormState time (same precedent as
// ThermalBridgeLinear's and MechanicalVentilationDuctwork's own capture), so
// hydrate/reset/buildElementData/renderPanel (which the module contract
// doesn't hand ctx.serviceLine directly) can still reach it.
//
// WP does not use ctx.shared (unlike MVD's parentElement) — it has no
// parent-element field.

import { useState } from 'react';
import type { Element } from '../../stores/geometryStore';
import { StandardDropdown } from '../StandardDropdown';
import {
  hydrateServiceLineFromElement,
  renderServiceLineCoreFields,
  resetServiceLine,
  type ServiceLineFormGroup,
} from './serviceLine';
import type { ElementFormModule, ElementFormStateCtx } from './types';

/** Mirrors ElementCreator's own local ElementOfType<T> alias (not exported
 * there), used the same way here for the location dropdown's value cast. */
type ElementOfType<T extends Element['type']> = Extract<Element, { type: T }>;

export interface WaterPipeworkFormState {
  location: '' | 'internal' | 'external';
  setLocation: (value: '' | 'internal' | 'external') => void;
  /** Shared with ThermalBridgeLinear/MechanicalVentilationDuctwork — see
   * module header comment. */
  serviceLine: ServiceLineFormGroup;
}

function useFormState(ctx: ElementFormStateCtx): WaterPipeworkFormState {
  const [location, setLocation] = useState<'' | 'internal' | 'external'>('');

  return {
    location,
    setLocation,
    serviceLine: ctx.serviceLine,
  };
}

export const waterPipeworkFormModule: ElementFormModule<WaterPipeworkFormState> = {
  type: 'WaterPipework',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'WaterPipework') return;
    state.setLocation('location' in element ? element.location ?? '' : '');
    hydrateServiceLineFromElement(state.serviceLine, element);
  },

  reset(state) {
    state.setLocation('');
    resetServiceLine(state.serviceLine);
  },

  buildElementData(state, ctx) {
    return {
      ...ctx.baseData,
      simplified_pipework: false,
      location: state.location || undefined,
      pipework_type: 'primary',
      length: state.serviceLine.lengthInput.value,
      zoneId: undefined, // Global object
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const { location, setLocation, serviceLine } = state;
    const { elementType, renderFieldLabel, registerBaseFieldRefs, commitExistingElementDraft } = ctx;

    return (
      <>
        {renderFieldLabel('Location:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs('location')}>
          <StandardDropdown
            value={location}
            onChange={(value) => {
              const nextValue = value as ElementOfType<'WaterPipework'>['location'];
              setLocation(nextValue);
              commitExistingElementDraft({ location: nextValue });
            }}
            options={[
              { value: 'internal', label: 'Internal' },
              { value: 'external', label: 'External' },
            ]}
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
