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
import { StandardDropdown } from '../StandardDropdown';
import type { ElementFormModule, ElementFormStateCtx } from './types';

type ApplianceElement = Extract<Element, { type: 'Appliance' }>;

export interface ApplianceFormState {
  applianceKey: string;
  setApplianceKey: (value: string) => void;
  applianceKeyOptions: readonly string[];
}

function useFormState(ctx: ElementFormStateCtx): ApplianceFormState {
  const [applianceKey, setApplianceKey] = useState<string>('');
  if (
    applianceKey !== ''
    && ctx.applianceKeyOptions.length > 0
    && !ctx.applianceKeyOptions.includes(applianceKey)
  ) {
    setApplianceKey('');
  }

  return { applianceKey, setApplianceKey, applianceKeyOptions: ctx.applianceKeyOptions };
}

export const applianceFormModule: ElementFormModule<ApplianceFormState> = {
  type: 'Appliance',
  useFormState,

  hydrate(state, element) {
    if (element.type !== 'Appliance') return;
    const validKeys = state.applianceKeyOptions;
    const incoming = 'appliancekey' in element ? element.appliancekey ?? '' : '';
    state.setApplianceKey(validKeys.includes(incoming) ? incoming : '');
  },

  reset(state) {
    state.setApplianceKey('');
  },

  buildElementData(state, ctx) {
    return {
      ...ctx.baseData,
      appliancekey: state.applianceKey || undefined,
      zoneId: undefined // Global object
    } as Partial<Element>;
  },

  renderPanel(state, ctx) {
    const { applianceKey, setApplianceKey, applianceKeyOptions } = state;
    const { elementType, renderFieldLabel, registerBaseFieldRefs, commitExistingElementDraft } = ctx;
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
              ...applianceKeyOptions.map(key => ({ value: key, label: key })),
            ]}
            variant="ghost"
            size="md"
          />
        </div>
      </>
    );
  },

  subtype(state) {
    return state.applianceKey;
  },
};
