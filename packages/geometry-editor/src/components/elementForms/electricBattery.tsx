// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// ElectricBattery form family, moved verbatim from ElementCreator's five
// inline structures. The legacy element and global hydrate branches were
// byte-identical, so one hydrate covers both.

import { useState } from 'react';
import { roundToTwoDecimals, type Element } from '../../stores/geometryStore';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { StandardDropdown } from '../StandardDropdown';
import { decimalInputProps, readExtraJsonRecord, useDecimalInput } from './formPrimitives';
import type { ElementFormModule, ElementFormStateCtx } from './types';

type BatteryLocation = '' | 'inside' | 'outside';

export interface ElectricBatteryFormState {
  batteryCapacityInput: ReturnType<typeof useDecimalInput>;
  batteryEfficiencyInput: ReturnType<typeof useDecimalInput>;
  batteryLocation: BatteryLocation;
  setBatteryLocation: (value: BatteryLocation) => void;
}

function useFormState(ctx: ElementFormStateCtx): ElectricBatteryFormState {
  const batteryCapacityInput = useDecimalInput('', ctx.commitElementNumericField('capacity'), { commitOnChange: true });
  const batteryEfficiencyInput = useDecimalInput('', ctx.commitElementNumericField('charge_discharge_efficiency_round_trip'), { commitOnChange: true });
  const [batteryLocation, setBatteryLocation] = useState<BatteryLocation>('');
  return { batteryCapacityInput, batteryEfficiencyInput, batteryLocation, setBatteryLocation };
}

export const electricBatteryFormModule: ElementFormModule<ElectricBatteryFormState> = {
  type: 'ElectricBattery',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'ElectricBattery') return;
    const capacity =
      'capacity' in element && typeof element.capacity === 'number'
        ? roundToTwoDecimals(element.capacity)
        : (element.capacity ?? '');
    const efficiency =
      'charge_discharge_efficiency_round_trip' in element &&
      typeof element.charge_discharge_efficiency_round_trip === 'number'
        ? roundToTwoDecimals(element.charge_discharge_efficiency_round_trip)
        : (element.charge_discharge_efficiency_round_trip ?? '');

    state.batteryCapacityInput.setValue(capacity);
    state.batteryEfficiencyInput.setValue(efficiency);
    state.setBatteryLocation(
      'battery_location' in element && element.battery_location
        ? element.battery_location
        : ''
    );
  },

  reset() {
    // Legacy resetFormFields never reset battery state; preserved as-is.
  },

  buildElementData(state, ctx) {
    // Build element data with main UI fields
    const elementData: Record<string, unknown> = {
      ...ctx.baseData,
      capacity: state.batteryCapacityInput.value === '' ? undefined : state.batteryCapacityInput.value,
      charge_discharge_efficiency_round_trip: state.batteryEfficiencyInput.value === '' ? undefined : state.batteryEfficiencyInput.value,
      battery_location: state.batteryLocation || undefined,
      zoneId: ctx.elementZoneId || undefined
    };

    // Auto-remove main UI fields from extra_json to avoid duplication
    if (elementData.extra_json) {
      const restExtraJson = { ...readExtraJsonRecord(elementData.extra_json) };
      delete restExtraJson.capacity;
      delete restExtraJson.charge_discharge_efficiency_round_trip;
      delete restExtraJson.battery_location;
      delete restExtraJson.grid_charging_possible;
      delete restExtraJson.threshold_charges;
      delete restExtraJson.threshold_prices;
      delete restExtraJson.tariff;
      elementData.extra_json = Object.keys(restExtraJson).length > 0 ? restExtraJson : undefined;
    }

    return elementData as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const { batteryCapacityInput, batteryEfficiencyInput, batteryLocation, setBatteryLocation } = state;
    const {
      elementType,
      fieldUnit,
      renderFieldLabel,
      renderFieldLabelWithComparisonIndicator,
      registerBaseFieldRefs,
      getFieldValidationIssue,
      globalComparisonFieldIndicators,
      commitExistingElementDraft,
    } = ctx;
    return (
      <>
        {renderFieldLabelWithComparisonIndicator('Capacity (kWh):', elementType, globalComparisonFieldIndicators.capacity)}
        <div className="element-input" ref={registerBaseFieldRefs('capacity')}>
          <StandardInput
            {...decimalInputProps(batteryCapacityInput)}
            unit={fieldUnit('capacity')}
            step="0.1"
            min="0"
            max="50"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('capacity', batteryCapacityInput.value)} issue={getFieldValidationIssue('capacity', batteryCapacityInput.value) || undefined} />
        </div>
        {renderFieldLabel('Charge/Discharge Efficiency (Round Trip):', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs('charge_discharge_efficiency_round_trip')}>
          <StandardInput
            {...decimalInputProps(batteryEfficiencyInput)}
            unit={fieldUnit('charge_discharge_efficiency_round_trip')}
            step="0.01"
            min="0"
            max="1"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('charge_discharge_efficiency_round_trip', batteryEfficiencyInput.value)} issue={getFieldValidationIssue('charge_discharge_efficiency_round_trip', batteryEfficiencyInput.value) || undefined} />
        </div>
        {renderFieldLabel('Battery Location:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['batteryLocation', 'battery_location'])}>
          <StandardDropdown
            value={batteryLocation}
            onChange={(value) => {
              const nextValue = value as 'inside' | 'outside';
              setBatteryLocation(nextValue);
              commitExistingElementDraft({ battery_location: nextValue });
            }}
            options={[
              { value: 'inside', label: 'Inside' },
              { value: 'outside', label: 'Outside' }
            ]}
            variant="ghost"
            size="md"
          />
        </div>
      </>
    );
  },
};
