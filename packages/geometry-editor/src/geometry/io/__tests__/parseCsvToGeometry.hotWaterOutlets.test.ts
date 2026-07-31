// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { parseCsvToGeometry } from '../parseCsvToGeometry';

describe('parseCsvToGeometry — Hot Water Outlets CSV', () => {
  it('reads coords from the dedicated coords column when allow_low_flowrate is blank', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Hot Water Outlets,,,,,,,,
Name,Type,subcategory,flowrate,size,rated_power,allow_low_flowrate,coords
Bath 1,HotWaterDemand,Bath,,180,,,"12.500,7.250,0.000"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const bath = elements.find((e) => e.type === 'HotWaterDemand' && (e as any).name === 'Bath 1');

    expect(bath).toBeDefined();
    expect((bath as any).subcategory).toBe('Bath');
    expect((bath as any).size).toBe(180);
    expect((bath as any).coordinates).toEqual([{ x: 12.5, y: 7.25, z: 0 }]);
  });

  it('allows legacy exports without allow_low_flowrate column', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Hot Water Outlets,,,,,,,,
Name,Type,subcategory,flowrate,size,rated_power,coords,extra_json
Mixer Shower,HotWaterDemand,MixerShower,8.5,,,"3.000,4.000,1.000",
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const shower = elements.find((e) => e.type === 'HotWaterDemand' && (e as any).name === 'Mixer Shower');

    expect(shower).toBeDefined();
    expect((shower as any).subcategory).toBe('MixerShower');
    expect((shower as any).allow_low_flowrate).toBeUndefined();
    expect((shower as any).flowrate).toBe(8.5);
    expect((shower as any).coordinates).toEqual([{ x: 3, y: 4, z: 1 }]);
  });
});
