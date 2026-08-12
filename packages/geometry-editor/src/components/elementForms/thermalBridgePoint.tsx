// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// ThermalBridgePoint form family, moved verbatim from ElementCreator's five
// inline structures. Legacy only ever hydrated this family from the
// element-selection chain (there is no ThermalBridgePoint case in the
// global-selection chain), so this module's single hydrate covers it.

import type { Element } from '../../geometry/types';
import { StandardInput } from '../StandardInput';
import { decimalInputProps, useDecimalInput } from './formPrimitives';
import type { ElementFormModule, ElementFormStateCtx } from './types';

export interface ThermalBridgePointFormState {
  heatTransferCoeffInput: ReturnType<typeof useDecimalInput>;
}

function useFormState(ctx: ElementFormStateCtx): ThermalBridgePointFormState {
  const heatTransferCoeffInput = useDecimalInput('', ctx.commitElementNumericField('heat_transfer_coeff'), { commitOnChange: true });
  return { heatTransferCoeffInput };
}

export const thermalBridgePointFormModule: ElementFormModule<ThermalBridgePointFormState> = {
  type: 'ThermalBridgePoint',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'ThermalBridgePoint') return;
    state.heatTransferCoeffInput.setValue('heat_transfer_coeff' in element ? element.heat_transfer_coeff ?? '' : '');
  },

  reset(state) {
    state.heatTransferCoeffInput.setValue('');
  },

  buildElementData(state, ctx) {
    return {
      ...ctx.baseData,
      heat_transfer_coeff: state.heatTransferCoeffInput.value
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const { heatTransferCoeffInput } = state;
    const { elementType, fieldUnit, renderFieldLabel } = ctx;
    return (
      <>
        {renderFieldLabel('Heat Transfer Coefficient (W/K):', elementType)}
        <div className="element-input">
          <StandardInput
            {...decimalInputProps(heatTransferCoeffInput)}
            unit={fieldUnit('heat_transfer_coeff')}
            step="0.01"
            min="0"
            variant="ghost"
            size="md"
          />
        </div>
      </>
    );
  },
};
