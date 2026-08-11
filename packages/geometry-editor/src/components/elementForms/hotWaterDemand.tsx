// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// HotWaterDemand form family, moved verbatim from ElementCreator's five
// inline structures. The legacy element and global hydrate branches were
// byte-identical, so one hydrate covers both.
//
// Cross-references: elementFieldPresentation's constructor and
// getFieldValidationIssue (both orchestrator-owned, not part of this module)
// read hotWaterSubcategory outside the five structures. Those call sites now
// read hotWaterDemandFormState.hotWaterSubcategory instead.

import { useState } from 'react';
import type { Element } from '../../stores/geometryStore';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { StandardDropdown } from '../StandardDropdown';
import { decimalInputProps, useDecimalInput } from './formPrimitives';
import type { ElementFormModule, ElementFormStateCtx } from './types';

type HotWaterDemandElement = Extract<Element, { type: 'HotWaterDemand' }>;
type HotWaterSubcategory = '' | 'MixerShower' | 'Bath' | 'InstantElecShower' | 'OtherWaterUseDetails';

export interface HotWaterDemandFormState {
  hotWaterSubcategory: HotWaterSubcategory;
  setHotWaterSubcategory: (value: HotWaterSubcategory) => void;
  allowLowFlowrate: boolean;
  setAllowLowFlowrate: (value: boolean) => void;
  sizeInput: ReturnType<typeof useDecimalInput>;
  flowrateInput: ReturnType<typeof useDecimalInput>;
  ratedPowerInput: ReturnType<typeof useDecimalInput>;
}

function useFormState(ctx: ElementFormStateCtx): HotWaterDemandFormState {
  const [hotWaterSubcategory, setHotWaterSubcategory] = useState<HotWaterSubcategory>('');
  const [allowLowFlowrate, setAllowLowFlowrate] = useState<boolean>(false);
  const sizeInput = useDecimalInput('', ctx.commitElementNumericField('size'), { commitOnChange: true });
  const flowrateInput = useDecimalInput('', ctx.commitElementNumericField('flowrate'), { commitOnChange: true });
  const ratedPowerInput = useDecimalInput('', ctx.commitElementNumericField('rated_power'), { commitOnChange: true });
  return {
    hotWaterSubcategory,
    setHotWaterSubcategory,
    allowLowFlowrate,
    setAllowLowFlowrate,
    sizeInput,
    flowrateInput,
    ratedPowerInput,
  };
}

export const hotWaterDemandFormModule: ElementFormModule<HotWaterDemandFormState> = {
  type: 'HotWaterDemand',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'HotWaterDemand') return;
    state.setHotWaterSubcategory('subcategory' in element ? element.subcategory ?? '' : '');
    state.setAllowLowFlowrate('allow_low_flowrate' in element ? !!element.allow_low_flowrate : false);
    state.sizeInput.setValue('size' in element ? element.size ?? '' : '');
    state.flowrateInput.setValue('flowrate' in element ? element.flowrate ?? '' : '');
    state.ratedPowerInput.setValue('rated_power' in element ? element.rated_power ?? '' : '');
  },

  reset(state) {
    state.setHotWaterSubcategory('');
    state.setAllowLowFlowrate(false);
    state.sizeInput.setValue('');
    state.flowrateInput.setValue('');
    state.ratedPowerInput.setValue('');
  },

  buildElementData(state, ctx) {
    return {
      ...ctx.baseData,
      subcategory: state.hotWaterSubcategory || undefined,
      allow_low_flowrate: state.hotWaterSubcategory === 'MixerShower' ? state.allowLowFlowrate : undefined,
      size: state.sizeInput.value || undefined,
      flowrate: state.flowrateInput.value || undefined,
      rated_power: state.ratedPowerInput.value || undefined,
      zoneId: undefined // Global object
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const { hotWaterSubcategory, setHotWaterSubcategory, allowLowFlowrate, setAllowLowFlowrate, sizeInput, flowrateInput, ratedPowerInput } = state;
    const { elementType, fieldUnit, renderFieldLabel, registerBaseFieldRefs, getFieldValidationIssue, commitExistingElementDraft } = ctx;
    return (
      <>
        {renderFieldLabel('Subcategory:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs('subcategory')}>
          <StandardDropdown
            value={hotWaterSubcategory}
            onChange={(value) => {
              const nextValue = value as HotWaterDemandElement['subcategory'];
              setHotWaterSubcategory(nextValue);
              commitExistingElementDraft({
                subcategory: nextValue,
                allow_low_flowrate: nextValue === 'MixerShower' ? allowLowFlowrate : undefined,
              });
            }}
            options={[
              { value: 'OtherWaterUseDetails', label: 'Other Water Use Details' },
              { value: 'MixerShower', label: 'Mixer Shower' },
              { value: 'InstantElecShower', label: 'Instant Electric Shower' },
              { value: 'Bath', label: 'Bath' }
            ]}
            variant="ghost"
            size="md"
          />
        </div>
        {hotWaterSubcategory === 'MixerShower' && (
          <>
            {renderFieldLabel('Air Pressure Shower?', elementType, 'allow_low_flowrate')}
            <div
              className="element-input"
              ref={registerBaseFieldRefs('allow_low_flowrate')}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="allow-low-flowrate"
                  checked={allowLowFlowrate === true}
                  onChange={() => {
                    setAllowLowFlowrate(true);
                    commitExistingElementDraft({ allow_low_flowrate: true });
                  }}
                />
                <span>Yes</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="allow-low-flowrate"
                  checked={allowLowFlowrate === false}
                  onChange={() => {
                    setAllowLowFlowrate(false);
                    commitExistingElementDraft({ allow_low_flowrate: false });
                  }}
                />
                <span>No</span>
              </label>
            </div>
          </>
        )}
        {hotWaterSubcategory === 'Bath' && (
          <>
            {renderFieldLabel('Size (L):', elementType)}
            <div className="element-input" ref={registerBaseFieldRefs('size')}>
              <StandardInput
                {...decimalInputProps(sizeInput)}
                unit={fieldUnit('size')}
                step="1"
                min="0"
                required
                variant="ghost"
                size="md"
              />
            </div>
          </>
        )}
        {(hotWaterSubcategory === 'MixerShower' || hotWaterSubcategory === 'OtherWaterUseDetails') && (
          <>
            {renderFieldLabel('Flowrate (L/min):', elementType)}
            <div className="element-input" ref={registerBaseFieldRefs('flowrate')}>
              <StandardInput
                {...decimalInputProps(flowrateInput)}
                unit={fieldUnit('flowrate')}
                step="0.1"
                min="0"
                required
                variant="ghost"
                size="md"
              />
              <FieldValidationIndicator
                hasIssue={!!getFieldValidationIssue('flowrate', flowrateInput.value)}
                issue={getFieldValidationIssue('flowrate', flowrateInput.value) || undefined}
              />
            </div>
          </>
        )}
        {hotWaterSubcategory === 'InstantElecShower' && (
          <>
            {renderFieldLabel('Rated Power:', elementType, 'rated_power')}
            <div className="element-input" ref={registerBaseFieldRefs(['ratedPower', 'rated_power'])}>
              <StandardInput
                {...decimalInputProps(ratedPowerInput)}
                unit={fieldUnit('rated_power')}
                step="1"
                min="0"
                required
                variant="ghost"
                size="md"
              />
            </div>
          </>
        )}
      </>
    );
  },

  subtype(state) {
    return state.hotWaterSubcategory || undefined;
  },
};
