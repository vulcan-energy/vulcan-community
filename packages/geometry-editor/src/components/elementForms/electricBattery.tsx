// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// ElectricBattery form family, moved verbatim from ElementCreator's five
// inline structures. The legacy element and global hydrate branches were
// byte-identical, so one hydrate covers both.

import { useState } from 'react';
import type { Element } from '../../geometry/types';
import { roundToTwoDecimals } from '../../geometry/constants';
import { FieldValidationIndicator } from '../ValidationIndicator';
import { StandardInput } from '../StandardInput';
import { StandardDropdown } from '../StandardDropdown';
import { useTargetRules } from '../../hooks/useTargetRules';
import { elementSchemaTakesField } from '../../lib/schemaCache';
import { decimalInputProps, readExtraJsonRecord, useDecimalInput } from './formPrimitives';
import type { ElementFormModule, ElementFormStateCtx } from './types';

type BatteryLocation = '' | 'inside' | 'outside';

export interface ElectricBatteryFormState {
  batteryCapacityInput: ReturnType<typeof useDecimalInput>;
  batteryEfficiencyInput: ReturnType<typeof useDecimalInput>;
  batteryLocation: BatteryLocation;
  setBatteryLocation: (value: BatteryLocation) => void;
  /** The target takes age, grid charging and grid export (TargetRules.batteryGridInputs). */
  gridInputs: boolean;
  /** The target's battery schema takes capacity and efficiency; a HEM Database product states its own. */
  ratingInputs: boolean;
  /** The selected battery's `extra_json`, where age, grid charging and grid export are stored. */
  extra: Record<string, unknown>;
  commitExtra: (key: string, value: unknown) => void;
}

function useFormState(ctx: ElementFormStateCtx): ElectricBatteryFormState {
  const batteryCapacityInput = useDecimalInput('', ctx.commitElementNumericField('capacity'), { commitOnChange: true });
  const batteryEfficiencyInput = useDecimalInput('', ctx.commitElementNumericField('charge_discharge_efficiency_round_trip'), { commitOnChange: true });
  const [batteryLocation, setBatteryLocation] = useState<BatteryLocation>('');
  const gridInputs = useTargetRules().batteryGridInputs;
  const ratingInputs = elementSchemaTakesField(ctx.schemaPort, 'ElectricBattery', 'charge_discharge_efficiency_round_trip');
  const extra = readExtraJsonRecord(ctx.selection ? ctx.getElementById(ctx.selection.id)?.extra_json : undefined);
  const commitExtra = (key: string, value: unknown) => {
    const next = { ...extra };
    if (value === undefined) delete next[key];
    else next[key] = value;
    ctx.commitExistingElementDraft({ extra_json: Object.keys(next).length ? next : undefined } as Partial<Element>);
  };
  return { batteryCapacityInput, batteryEfficiencyInput, batteryLocation, setBatteryLocation, gridInputs, ratingInputs, extra, commitExtra };
}

const yesNo = (value: unknown) => (value === true ? 'TRUE' : value === false ? 'FALSE' : '');
const YES_NO = [{ value: 'TRUE', label: 'Yes' }, { value: 'FALSE', label: 'No' }];

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
      delete restExtraJson.threshold_charges;
      delete restExtraJson.threshold_prices;
      delete restExtraJson.tariff;
      elementData.extra_json = Object.keys(restExtraJson).length > 0 ? restExtraJson : undefined;
    }

    return elementData as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const { batteryCapacityInput, batteryEfficiencyInput, batteryLocation, setBatteryLocation, gridInputs, ratingInputs, extra, commitExtra } = state;
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
    const gridLabels = gridInputs ? {
      age: renderFieldLabel('Battery Age (years):', elementType, 'battery_age'),
      charging: renderFieldLabel('Grid Charging Possible:', elementType, 'grid_charging_possible'),
      exporting: renderFieldLabel('Grid Exporting Possible:', elementType, 'grid_exporting_possible'),
    } : null;
    return (
      <>
        {ratingInputs && <>
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
        </>}
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
            placeholder={gridInputs ? 'Outside (DESNZ-defined default)' : undefined}
            variant="ghost"
            size="md"
          />
        </div>
        {gridLabels && (
          <>
            {gridLabels.age}
            <div className="element-input" ref={registerBaseFieldRefs('battery_age')}>
              <StandardInput
                type="number"
                value={typeof extra.battery_age === 'number' ? String(extra.battery_age) : ''}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  commitExtra('battery_age', value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value));
                }}
                placeholder="5 (DESNZ-defined default)"
                min="0"
                variant="ghost"
                size="md"
                className="flex-1"
              />
            </div>
            {gridLabels.charging}
            <div className="element-input" ref={registerBaseFieldRefs('grid_charging_possible')}>
              <StandardDropdown
                value={yesNo(extra.grid_charging_possible)}
                onChange={(value) => commitExtra('grid_charging_possible', value === '' ? undefined : value === 'TRUE')}
                options={YES_NO}
                placeholder="Yes (DESNZ-defined default)"
                variant="ghost"
                size="md"
              />
            </div>
            {gridLabels.exporting}
            <div className="element-input" ref={registerBaseFieldRefs('grid_exporting_possible')}>
              <StandardDropdown
                value={yesNo(extra.grid_exporting_possible)}
                onChange={(value) => commitExtra('grid_exporting_possible', value === '' ? undefined : value === 'TRUE')}
                options={YES_NO}
                placeholder="No (DESNZ-defined default)"
                variant="ghost"
                size="md"
              />
            </div>
          </>
        )}
      </>
    );
  },
};
