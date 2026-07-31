// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  extraJsonToWindowTreatmentForm,
  getTableTransRed,
  windowTreatmentFormToExtraJson,
  defaultWindowTreatmentFormValues,
} from '../windowTreatment';

describe('windowTreatment', () => {
  it('looks up Table 3.6.b trans_red', () => {
    expect(getTableTransRed('white_venetian', 0, 'inside')).toBe(0.25);
    expect(getTableTransRed('white_venetian', 0, 'outside')).toBe(0.1);
    expect(getTableTransRed('aluminium', 0, 'inside')).toBe(0.2);
  });

  it('serializes table path to WindowTreatment', () => {
    const f = defaultWindowTreatmentFormValues();
    const ser = windowTreatmentFormToExtraJson({
      ...f,
      enabled: true,
      source: 'table',
      category: 'white_venetian',
      tier: 0,
      mounting: 'inside',
      delta_r: '0.12',
      controls: 'manual',
    });
    expect(ser.ok).toBe(true);
    if (!ser.ok) return;
    expect(ser.treatment).toEqual([
      { type: 'blinds', controls: 'manual', delta_r: 0.12, trans_red: 0.25 },
    ]);
    expect(ser.treatmentUi?.source).toBe('table');
  });

  it('serializes custom path', () => {
    const f = defaultWindowTreatmentFormValues();
    const ser = windowTreatmentFormToExtraJson({
      ...f,
      enabled: true,
      source: 'custom',
      custom_type: 'curtains',
      custom_trans_red: '0.5',
      delta_r: '0.1',
      controls: 'auto_motorised',
    });
    expect(ser.ok).toBe(true);
    if (!ser.ok) return;
    expect(ser.treatment).toEqual([
      { type: 'curtains', controls: 'auto_motorised', delta_r: 0.1, trans_red: 0.5 },
    ]);
  });

  it('round-trips _treatment_ui', () => {
    const f = defaultWindowTreatmentFormValues();
    const ser = windowTreatmentFormToExtraJson({
      ...f,
      enabled: true,
      source: 'table',
      category: 'white_curtains',
      tier: 1,
      mounting: 'inside',
      delta_r: '0.05',
      controls: 'manual',
    });
    expect(ser.ok).toBe(true);
    if (!ser.ok) return;
    const back = extraJsonToWindowTreatmentForm(ser.treatment, ser.treatmentUi);
    expect(back.enabled).toBe(true);
    expect(back.category).toBe('white_curtains');
    expect(back.tier).toBe(1);
    expect(back.delta_r).toBe('0.05');
  });
});
