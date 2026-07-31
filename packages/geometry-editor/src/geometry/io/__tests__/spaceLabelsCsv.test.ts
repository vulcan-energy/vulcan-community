// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { parseCsvToGeometry } from '../parseCsvToGeometry';
import { validateGeometrySectionHeaders } from '../geometryCsvLayouts';

describe('Space Labels CSV section', () => {
  it('validates canonical Space Labels headers', () => {
    validateGeometrySectionHeaders('Space Labels', [
      'Name',
      'Zone',
      'storey',
      'room_type',
      'coords',
      'height_override',
      'extra_json',
    ]);
  });

  it('ingests Space Labels after Zone and preserves footprint', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,
,,,,,,,,,,,,,
Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging,,,,,,,
Dwelling,Zone,100,40,2.5,FALSE,,,,,,,
,,,,,,,,,,,,,
Space Labels,,,,,,,,,,,,,
Name,Zone,storey,room_type,coords,height_override,extra_json,,,,,,,
Bed 1,Dwelling,0,bedroom,"0.000,0.000,0.000|3.000,0.000,0.000|3.000,4.000,0.000|0.000,4.000,0.000",,,
,,,,,,,,,,,,,
`.trim();

    const { zones, spaceLabels } = parseCsvToGeometry(csv);
    expect(zones).toHaveLength(1);
    expect(zones[0].name).toBe('Dwelling');
    expect(spaceLabels).toHaveLength(1);
    expect(spaceLabels[0].name).toBe('Bed 1');
    expect(spaceLabels[0].room_type).toBe('bedroom');
    expect(spaceLabels[0].storey).toBe(0);
    expect(spaceLabels[0].coordinates).toHaveLength(4);
    expect(spaceLabels[0].coordinates[1]).toEqual({ x: 3, y: 0, z: 0 });
  });

  it('ingests open-to-living marker from Space Label extra_json', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,
,,,,,,,,,,,,,
Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging,,,,,,,
Dwelling,Zone,100,40,2.5,FALSE,,,,,,,
,,,,,,,,,,,,,
Space Labels,,,,,,,,,,,,,
Name,Zone,storey,room_type,coords,height_override,extra_json,,,,,,,
Kitchen,Dwelling,0,kitchen,"0.000,0.000,0.000|3.000,0.000,0.000|3.000,4.000,0.000|0.000,4.000,0.000",,"{""open_to_living_room"":true}",
,,,,,,,,,,,,,
`.trim();

    const { spaceLabels } = parseCsvToGeometry(csv);

    expect(spaceLabels).toHaveLength(1);
    expect(spaceLabels[0].extra_json?.open_to_living_room).toBe(true);
  });
});
