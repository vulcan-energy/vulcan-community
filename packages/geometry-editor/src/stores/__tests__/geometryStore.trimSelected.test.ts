// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';

import { createGeometryStore } from '../geometryStore';

const csv = `Metadata,,

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone 1,Zone,50,20,2.5,FALSE

Exposed Elements,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
A,Zone 1,BuildingElementOpaque,12.5,90,5,2.5,180,0,FALSE,FALSE,,"0,0,0|5,0,0","{}"
B,Zone 1,BuildingElementOpaque,10,90,4,2.5,90,0,FALSE,FALSE,,"3,4,0|3,0,0","{}"
C,Zone 1,BuildingElementOpaque,7.5,90,3,2.5,180,0,FALSE,FALSE,,"3,1,0|6,1,0","{}"
`;

// Trimming queries snapped vertices between its own writes; a stale vertex index once moved B's end to C.
it('trims three walls as the queries see each write', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv);
  const { elementIds, elementsById } = store.getState();
  const id = (name: string) => elementIds.find((key) => elementsById[key]!.name === name)!;
  store.getState().trimSelectedElements([id('A'), id('B'), id('C')], 0.05);
  const b = store.getState().elementsById[id('B')]!.coordinates!.map(({ x, y }) => [x, y]);
  expect(b).toEqual([[3, 4], [3, 0]]);
});
