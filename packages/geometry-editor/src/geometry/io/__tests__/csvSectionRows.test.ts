// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { parseCsvSections, stripLegacyBuildingServicesBlocks } from '../csvSectionRows';

describe('csvSectionRows', () => {
  it('stripLegacyBuildingServicesBlocks removes deprecated blocks before the next section', () => {
    const raw = [
      'Zone,,,,,,,,,,,,,',
      'Name,Type,volume,floor_area,height,simplified thermal bridging',
      'Living,Zone,60,25,2.4,FALSE',
      '',
      'Building Services,,,,,,,,,,,,,',
      'Legacy Vent,Living,MechanicalVentilation,,,,,,,,,',
      '',
      'Hot Water Outlets,,,,,,,,',
      'Name,Type,subcategory,flowrate,size,rated_power,allow_low_flowrate,coords',
      'Bath 1,HotWaterDemand,Bath,,180,,,"0,0,0"',
    ].join('\n');

    const stripped = stripLegacyBuildingServicesBlocks(raw);
    expect(stripped).not.toContain('Building Services');
    expect(stripped).not.toContain('Legacy Vent');
    const sections = parseCsvSections(stripped);
    const hw = sections.find((s) => s.name === 'Hot Water Outlets');
    expect(hw?.rows).toHaveLength(1);
    expect(hw?.rows[0]?.data['Name']).toBe('Bath 1');
  });
});
