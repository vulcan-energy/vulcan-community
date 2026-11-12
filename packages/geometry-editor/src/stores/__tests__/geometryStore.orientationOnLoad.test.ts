// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';
import type { Element } from '../../geometry/types';
import { buildHostedLinearParentPatch } from '../../lib/parentOrientation';

// A blank orientation360 cell on an element whose bearing the editor derives from its coordinates
// loads with the bearing that drawing the element gives. An authored value is kept.
const csv = (offset: number) => `Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,${offset},,,,,,,,,,,,,
VulcanCsvVersion,3,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging,livingroom_area,restofdwelling_area
Dwelling,Zone,179.2,64,2.8,FALSE,20,44

Exposed Elements,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
Front wall,Dwelling,BuildingElementOpaque,22.4,90,8,2.8,,0,,FALSE,,"0,0,0|8,0,0",
Back wall,Dwelling,BuildingElementOpaque,22.4,90,8,2.8,,0,,FALSE,,"8,8,0|0,8,0",
Side wall,Dwelling,BuildingElementOpaque,22.4,90,8,2.8,123,0,,FALSE,,"8,0,0|8,8,0",
Entry door,Dwelling,BuildingElementOpaque,2,90,1,2,,0,,TRUE,Front wall,"0.5,0,0|1.5,0,0",
Tiny wall,Dwelling,BuildingElementOpaque,0.01,90,0.001,2.8,,0,,FALSE,,"4,4,0|4.001,4,0",
Tiny door,Dwelling,BuildingElementOpaque,2,90,1,2,,0,,TRUE,Tiny wall,"3.5,4,0|4.5,4,0",

Window Elements,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,linked_wall,frame_area_fraction,free_area_height,mid_height,max_window_open_area,coords,extra_json
North window,Dwelling,BuildingElementTransparent,1.2,90,1,1.2,,0.8,Back wall,0.25,1.2,1.4,0.5,"1.5,8,0|2.5,8,0",
`;

let lastWarnings: string[] = [];
const orientationByName = (offset: number) => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  lastWarnings = store.getState().loadFromCSV(csv(offset)).warnings;
  return Object.fromEntries(
    Object.values(store.getState().elementsById).map((e) => [e.name, (e as { orientation360?: number }).orientation360]),
  );
};

// Placing the wall's points in the editor derives its bearing.
const placedWallOrientation = (offset: number, coordinates: Element['coordinates']) => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().setGlobalOrientationOffset(offset, { recompute: false });
  store.getState().addZone({ name: 'Dwelling', floorArea: 64, height: 2.8, volume: 179.2 });
  const [id] = store.getState().addElements([{
    type: 'BuildingElementOpaque', name: 'Placed', zoneId: store.getState().zones[0]!.id,
    area: 2.8, pitch: 90, width: 1, height: 2.8, base_height: 0,
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
  }] as never);
  store.getState().updateElement(id!, { coordinates });
  const orientation = (store.getState().elementsById[id!] as { orientation360?: number }).orientation360;
  expect(orientation).toBeTypeOf('number');
  return orientation;
};

describe('blank orientation360 on load', () => {
  it.each([0, 30])('derives two-point walls as placing them does (offset %i), keeps authored values', (offset) => {
    const loaded = orientationByName(offset);
    expect(loaded['Front wall']).toBe(placedWallOrientation(offset, [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }]));
    expect(loaded['Back wall']).toBe(placedWallOrientation(offset, [{ x: 8, y: 8, z: 0 }, { x: 0, y: 8, z: 0 }]));
    expect(loaded['Front wall']).toBe((180 - offset + 360) % 360);
    expect(loaded['Side wall']).toBe(123);
  });

  it('gives hosted openings their host wall bearing, as hosting them does', () => {
    const loaded = orientationByName(30);
    expect(loaded['Back wall']).toBe(330);
    expect(loaded['Entry door']).toBe(loaded['Front wall']);
    // The window's own coordinates run against the host; hosting takes the host bearing.
    expect(loaded['North window']).toBe(loaded['Back wall']);
  });

  it('leaves a bearing blank when the host segment is too short to give one', () => {
    const loaded = orientationByName(30);
    expect(loaded['Tiny wall']).toBeUndefined();
    expect(loaded['Tiny door']).toBeUndefined();
    expect(lastWarnings.join()).not.toMatch(/Tiny (door|wall) orientation360/);
    const tinyWall = { type: 'BuildingElementOpaque', coordinates: [{ x: 4, y: 4, z: 0 }, { x: 4.001, y: 4, z: 0 }] } as Element;
    const door = { type: 'BuildingElementOpaque', is_external_door: true, coordinates: [{ x: 3.5, y: 4, z: 0 }, { x: 4.5, y: 4, z: 0 }] } as Element;
    expect(buildHostedLinearParentPatch(door, tinyWall, 'Tiny wall', null, 0)).not.toHaveProperty('orientation360');
  });
});
