// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Appliance form family, moved verbatim from ElementCreator's five inline
// structures. The legacy element and global hydrate branches were
// byte-identical, so one hydrate covers both.
//
// applianceKeyOptions is computed by the orchestrator (it depends on the
// schema port and the FHS/core mode, neither of which this module owns) and
// passed in through ElementFormStateCtx; this module carries it through in
// its own state object so hydrate — which the module contract calls with no
// ctx — can still read the same valid-keys list the legacy code used.

import { useState } from 'react';
import type { Element } from '../../geometry/types';
import { applianceRequiresEnergySupply } from '../../lib/schemaCache';
import { useGeometryStore } from '../../stores/geometryStore';
import { StandardDropdown } from '../StandardDropdown';
import { readExtraJsonRecord } from './formPrimitives';
import type { ElementFormModule, ElementFormStateCtx } from './types';

type ApplianceElement = Extract<Element, { type: 'Appliance' }>;

export interface ApplianceFormState {
  applianceKey: string;
  setApplianceKey: (value: string) => void;
  applianceKeyOptions: readonly string[];
  /** `extra_json.EnergySupply`, asked for only where the target's schema requires it (HEM:EPC cooking). */
  energySupply: string;
  setEnergySupply: (value: string) => void;
  requiresEnergySupply: (applianceKey: string) => boolean;
  energySupplyNames: readonly string[];
}

function useFormState(ctx: ElementFormStateCtx): ApplianceFormState {
  const [applianceKey, setApplianceKey] = useState<string>('');
  const [energySupply, setEnergySupply] = useState<string>('');
  // The model's supplies are the defaults file's EnergySupply entries.
  const defaultsJson = useGeometryStore((s) => s.defaultsJson);
  const supplies = readExtraJsonRecord(readExtraJsonRecord(defaultsJson).EnergySupply);
  const root = ctx.schemaPort.availability === 'available' ? ctx.schemaPort.getRootSchema(ctx.schemaMode) : null;
  return {
    applianceKey,
    setApplianceKey,
    applianceKeyOptions: ctx.applianceKeyOptions,
    energySupply,
    setEnergySupply,
    requiresEnergySupply: (key) => applianceRequiresEnergySupply(root, key),
    energySupplyNames: Object.keys(supplies),
  };
}

export const applianceFormModule: ElementFormModule<ApplianceFormState> = {
  type: 'Appliance',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'Appliance') return;
    state.setApplianceKey(element.appliancekey ?? '');
    const supply = readExtraJsonRecord(element.extra_json).EnergySupply;
    state.setEnergySupply(typeof supply === 'string' ? supply : '');
  },

  reset(state) {
    state.setApplianceKey('');
    state.setEnergySupply('');
  },

  buildElementData(state, ctx) {
    const extra = readExtraJsonRecord(ctx.baseData.extra_json);
    return {
      ...ctx.baseData,
      ...(state.energySupply ? { extra_json: { ...extra, EnergySupply: state.energySupply } } : {}),
      appliancekey: state.applianceKey || undefined,
      zoneId: undefined // Global object
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const { applianceKey, setApplianceKey, applianceKeyOptions, energySupply, setEnergySupply, energySupplyNames } = state;
    const { elementType, renderFieldLabel, registerBaseFieldRefs, commitExistingElementDraft, selection, getElementById } = ctx;
    const supplyLabel = state.requiresEnergySupply(applianceKey) ? renderFieldLabel('Energy supply:', elementType, 'EnergySupply') : null;
    return (
      <>
        {renderFieldLabel('Appliance Key:', elementType)}
        <div className="element-input" ref={registerBaseFieldRefs(['applianceKey', 'appliancekey', 'appliance_key'])}>
          <StandardDropdown
            value={applianceKey}
            onChange={(value) => {
              const nextValue = value as ApplianceElement['appliancekey'] | '';
              setApplianceKey(nextValue);
              commitExistingElementDraft({ appliancekey: nextValue || undefined });
            }}
            options={[
              { value: '', label: 'Select appliance' },
              ...(applianceKey && !applianceKeyOptions.includes(applianceKey)
                ? [{ value: applianceKey, label: `${applianceKey} (unavailable in this version)`, disabled: true }] : []),
              ...applianceKeyOptions.map(key => ({ value: key, label: key })),
            ]}
            variant="ghost"
            size="md"
          />
        </div>
        {supplyLabel && (
          <>
            {supplyLabel}
            <div className="element-input" ref={registerBaseFieldRefs('EnergySupply')}>
              <StandardDropdown
                value={energySupply}
                onChange={(value) => {
                  setEnergySupply(value);
                  const extra = { ...readExtraJsonRecord(selection ? getElementById(selection.id)?.extra_json : undefined) };
                  if (value) extra.EnergySupply = value;
                  else delete extra.EnergySupply;
                  commitExistingElementDraft({ extra_json: Object.keys(extra).length ? extra : undefined } as Partial<Element>);
                }}
                options={[
                  ...(energySupply && !energySupplyNames.includes(energySupply) ? [{ value: energySupply, label: energySupply }] : []),
                  ...energySupplyNames.map((name) => ({ value: name, label: name })),
                ]}
                placeholder="Select energy supply"
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
    return state.applianceKey;
  },
};
