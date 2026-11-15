// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { deriveForExport, MVHR_FIXED_ENERGY_SUPPLY } from '../deriveForExport';
import { createGeometryStore } from '../../stores/geometryStore';

const mv = (vent_type: string, extra: Record<string, unknown> = {}) =>
  ({ id: vent_type, name: vent_type, type: 'MechanicalVentilation', vent_type, extra_json: extra }) as unknown as Element;

describe('deriveForExport', () => {
  it('gives an MVHR its fixed energy supply on a target without products, and nothing else', () => {
    const elements = { MVHR: mv('MVHR', { EnergySupply: 'other' }), 'Intermittent MEV': mv('Intermittent MEV') };
    const derived = deriveForExport(elements, false);
    expect((derived.MVHR!.extra_json as Record<string, unknown>).EnergySupply).toBe(MVHR_FIXED_ENERGY_SUPPLY);
    expect(derived['Intermittent MEV']).toBe(elements['Intermittent MEV']);
  });

  it('reads the vent type from extra_json when the column is blank', () => {
    const derived = deriveForExport({ MVHR: mv('', { vent_type: 'MVHR' }) }, false);
    expect((derived.MVHR!.extra_json as Record<string, unknown>).EnergySupply).toBe(MVHR_FIXED_ENERGY_SUPPLY);
  });

  it('returns the same record when nothing changes, the target references products, or the pin is unknown', () => {
    const fixed = { MVHR: mv('MVHR', { EnergySupply: MVHR_FIXED_ENERGY_SUPPLY }) };
    expect(deriveForExport(fixed, false)).toBe(fixed);
    const unset = { MVHR: mv('MVHR', { EnergySupply: 'mains gas' }) };
    expect(deriveForExport(unset, true)).toBe(unset);
    expect(deriveForExport(unset, undefined)).toBe(unset);
  });
});

describe('deriveForExport in the store', () => {
  const csv = (pin: string) => `Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,
TargetBundleId,${pin},,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Ventilation Systems,,,,,,,,,,,,,
Name,Type,length,duct_type,parent_element,mid_height_air_flow_path,area_cm2,orientation360,pitch,vent_type,coords,extra_json
Unit,MechanicalVentilation,,,,,,,,MVHR,"2.000,3.000,0.000","{""EnergySupply"":""mains gas""}"
`;
  it("follows each document's own pin, whichever store exports", () => {
    const options = { defaultDefaultsPath: null, hemDatabaseProductsForTarget: (id: string | undefined) => id === 'epc-pin' };
    const epc = createGeometryStore(options);
    const fhs = createGeometryStore(options);
    epc.getState().loadFromCSV(csv('epc-pin'));
    fhs.getState().loadFromCSV(csv('fhs-pin'));
    expect(epc.getState().generateCSV({ allowUnresolvedMigration: true })).toContain('mains gas');
    expect(fhs.getState().generateCSV({ allowUnresolvedMigration: true })).toContain(MVHR_FIXED_ENERGY_SUPPLY);
  });

  it('exports an MVHR that already holds the fixed supply byte for byte as without the derivation', () => {
    const fixed = csv('fhs-pin').replace('mains gas', MVHR_FIXED_ENERGY_SUPPLY);
    const exportWith = (hemDatabaseProductsForTarget: () => boolean | undefined) => {
      const store = createGeometryStore({ defaultDefaultsPath: null, hemDatabaseProductsForTarget });
      store.getState().loadFromCSV(fixed);
      return store.getState().generateCSV({ allowUnresolvedMigration: true });
    };
    expect(exportWith(() => false)).toBe(exportWith(() => undefined));
  });
});
