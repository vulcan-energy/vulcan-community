// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';

const key = '_test_private_host_metadata';

describe('internal-opening CSV metadata', () => {
  it('round-trips versioned opening overrides and suppressions on the host wall extra_json', () => {
    const source = createGeometryStore({ defaultDefaultsPath: null });
    source.getState().addZone({ name: 'Dwelling', floorArea: 16, height: 2.8, volume: 44.8 });
    const zone = source.getState().zones[0]!;
    const metadata = { version: 1, records: [
      { id: 'opening-1', state: 'override', hostAnchor: 'wall:0,0,0|0,4,0', roomAnchors: ['room:a', 'room:b'],
        centerFraction: 0.5, widthM: 0.9, heightM: 2, sillM: 0 },
      { id: 'opening-2', state: 'suppressed', hostAnchor: 'wall:0,0,0|0,4,0', roomAnchors: ['room:c', 'room:d'] },
    ] };
    source.getState().addElements([{
      type: 'BuildingElementAdjacentConditionedSpace', name: 'Internal Wall', zoneId: zone.id,
      area: 11.2, pitch: 90, width: 4, height: 2.8,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }],
      extra_json: { [key]: metadata },
    }] as never);

    const csv = source.getState().generateCSV({ allowUnresolvedMigration: true });
    const loaded = createGeometryStore({ defaultDefaultsPath: null });
    loaded.getState().loadFromCSV(csv);
    const wall = Object.values(loaded.getState().elementsById).find(element => element.name === 'Internal Wall');
    expect(wall?.extra_json).toMatchObject({ [key]: metadata });
  });
});
