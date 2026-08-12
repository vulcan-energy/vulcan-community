// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// CombustionAppliances form family, moved verbatim from ElementCreator's five
// inline structures. The legacy element and global hydrate branches were
// byte-identical, so one hydrate covers both.

import { useState } from 'react';
import type { Element } from '../../geometry/types';
import { StandardDropdown } from '../StandardDropdown';
import type { ElementFormModule } from './types';

type CombustionAppliancesElement = Extract<Element, { type: 'CombustionAppliances' }>;

type ApplianceType = '' | 'open_fireplace' | 'closed_fireplace' | 'stove' | 'closed_with_fan' | 'open_gas_flue_balancer' | 'open_gas_kitchen_stove' | 'open_gas_fire' | 'closed_fire';
type ExhaustSituation = '' | 'into_room' | 'into_chimney' | 'into_separate_duct' | 'into_mech_vent';
type FuelType = '' | 'wood' | 'gas' | 'oil' | 'coal';
type SupplySituation = '' | 'room_air' | 'outside_air' | 'outside';

export interface CombustionAppliancesFormState {
  applianceType: ApplianceType;
  setApplianceType: (value: ApplianceType) => void;
  exhaustSituation: ExhaustSituation;
  setExhaustSituation: (value: ExhaustSituation) => void;
  fuelType: FuelType;
  setFuelType: (value: FuelType) => void;
  supplySituation: SupplySituation;
  setSupplySituation: (value: SupplySituation) => void;
}

function useFormState(): CombustionAppliancesFormState {
  const [applianceType, setApplianceType] = useState<ApplianceType>('');
  const [exhaustSituation, setExhaustSituation] = useState<ExhaustSituation>('');
  const [fuelType, setFuelType] = useState<FuelType>('');
  const [supplySituation, setSupplySituation] = useState<SupplySituation>('');
  return {
    applianceType,
    setApplianceType,
    exhaustSituation,
    setExhaustSituation,
    fuelType,
    setFuelType,
    supplySituation,
    setSupplySituation,
  };
}

export const combustionAppliancesFormModule: ElementFormModule<CombustionAppliancesFormState> = {
  type: 'CombustionAppliances',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'CombustionAppliances') return;
    state.setApplianceType('appliance_type' in element ? element.appliance_type ?? '' : '');
    state.setExhaustSituation('exhaust_situation' in element ? element.exhaust_situation ?? '' : '');
    state.setFuelType('fuel_type' in element ? element.fuel_type ?? '' : '');
    state.setSupplySituation('supply_situation' in element ? element.supply_situation ?? '' : '');
  },

  reset(state) {
    state.setApplianceType('');
    state.setExhaustSituation('');
    state.setFuelType('');
    state.setSupplySituation('');
  },

  buildElementData(state, ctx) {
    return {
      ...ctx.baseData,
      appliance_type: state.applianceType || undefined,
      exhaust_situation: state.exhaustSituation || undefined,
      fuel_type: state.fuelType || undefined,
      supply_situation: state.supplySituation || undefined,
      zoneId: undefined // Global object
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const { applianceType, setApplianceType, exhaustSituation, setExhaustSituation, fuelType, setFuelType, supplySituation, setSupplySituation } = state;
    const { elementType, renderFieldLabel, registerBaseFieldRefs, commitExistingElementDraft } = ctx;
    return (
      <>
        {renderFieldLabel('Appliance Type:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['applianceType', 'appliance_type'])}>
          <StandardDropdown
            value={applianceType}
            onChange={(value) => {
              const nextValue = value as CombustionAppliancesElement['appliance_type'];
              setApplianceType(nextValue);
              commitExistingElementDraft({ appliance_type: nextValue });
            }}
            options={[
              { value: 'open_fireplace', label: 'Open Fireplace' },
              { value: 'closed_with_fan', label: 'Closed with Fan' },
              { value: 'open_gas_flue_balancer', label: 'Open Gas Flue Balancer' },
              { value: 'open_gas_kitchen_stove', label: 'Open Gas Kitchen Stove' },
              { value: 'open_gas_fire', label: 'Open Gas Fire' },
              { value: 'closed_fire', label: 'Closed Fire' }
            ]}
            variant="ghost"
            size="md"
          />
        </div>
        {renderFieldLabel('Exhaust Situation:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['exhaustSituation', 'exhaust_situation'])}>
          <StandardDropdown
            value={exhaustSituation}
            onChange={(value) => {
              const nextValue = value as CombustionAppliancesElement['exhaust_situation'];
              setExhaustSituation(nextValue);
              commitExistingElementDraft({ exhaust_situation: nextValue });
            }}
            options={[
              { value: 'into_room', label: 'Into Room' },
              { value: 'into_separate_duct', label: 'Into Separate Duct' },
              { value: 'into_mech_vent', label: 'Into Mechanical Ventilation' }
            ]}
            variant="ghost"
            size="md"
          />
        </div>
        {renderFieldLabel('Fuel Type:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['fuelType', 'fuel_type'])}>
          <StandardDropdown
            value={fuelType}
            onChange={(value) => {
              const nextValue = value as CombustionAppliancesElement['fuel_type'];
              setFuelType(nextValue);
              commitExistingElementDraft({ fuel_type: nextValue });
            }}
            options={[
              { value: 'wood', label: 'Wood' },
              { value: 'gas', label: 'Gas' },
              { value: 'oil', label: 'Oil' },
              { value: 'coal', label: 'Coal' }
            ]}
            variant="ghost"
            size="md"
          />
        </div>
        {renderFieldLabel('Supply Situation:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['supplySituation', 'supply_situation'])}>
          <StandardDropdown
            value={supplySituation}
            onChange={(value) => {
              const nextValue = value as CombustionAppliancesElement['supply_situation'];
              setSupplySituation(nextValue);
              commitExistingElementDraft({ supply_situation: nextValue });
            }}
            options={[
              { value: 'room_air', label: 'Room Air' },
              { value: 'outside', label: 'Outside' }
            ]}
            variant="ghost"
            size="md"
          />
        </div>
      </>
    );
  },

  subtype(state) {
    return state.applianceType || undefined;
  },
};
