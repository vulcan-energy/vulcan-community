// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { deriveForExport, MVHR_FIXED_ENERGY_SUPPLY } from '../deriveForExport';

const mv = (vent_type: string, extra: Record<string, unknown> = {}) =>
  ({ id: vent_type, name: vent_type, type: 'MechanicalVentilation', vent_type, extra_json: extra }) as unknown as Element;

describe('deriveForExport', () => {
  it('gives an MVHR its fixed energy supply on a target without products, and nothing else', () => {
    const elements = { MVHR: mv('MVHR', { EnergySupply: 'other' }), 'Intermittent MEV': mv('Intermittent MEV') };
    const derived = deriveForExport(elements, { hemDatabaseProducts: false });
    expect((derived.MVHR!.extra_json as Record<string, unknown>).EnergySupply).toBe(MVHR_FIXED_ENERGY_SUPPLY);
    expect(derived['Intermittent MEV']).toBe(elements['Intermittent MEV']);
  });

  it('returns the same record when nothing changes or the target references products', () => {
    const fixed = { MVHR: mv('MVHR', { EnergySupply: MVHR_FIXED_ENERGY_SUPPLY }) };
    expect(deriveForExport(fixed, { hemDatabaseProducts: false })).toBe(fixed);
    const unset = { MVHR: mv('MVHR') };
    expect(deriveForExport(unset, { hemDatabaseProducts: true })).toBe(unset);
  });
});
