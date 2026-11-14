// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';
import type { ContextShading } from '../../geometry/types';

// A 10 x 6 floor whose east edge carries a bay-like vertex cluster: area centroid (5, 3),
// vertex mean (~7.2, 3). The shading is a point due north of the area centroid, 17 m from
// the north wall.
const csvWithShading = (startAngle: string, endAngle: string, distance: string) => `Metadata,,
GlobalOrientationOffset,0,
VulcanCsvVersion,3

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone 1,Zone,150,60,2.5,FALSE

Ground Elements,,
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
Floor,Zone 1,BuildingElementGround,60,0,0,32,Slab_no_edge_insulation,,,,"0,0,0|10,0,0|10,1,0|10,2,0|10,3,0|10,4,0|10,5,0|10,6,0|0,6,0",

Context Shading,,
Name,Type,shading_type,start_angle,end_angle,distance,height,parent_element,coords,extra_json
Tree,ContextShading,obstacle,${startAngle},${endAngle},${distance},5,Floor,"5,23,0",
`;

const tree = (store: ReturnType<typeof createGeometryStore>) =>
  Object.values(store.getState().elementsById).find((el) => el.name === 'Tree') as ContextShading;

it('re-derives stale context shading angles and distance from the drawing on load, leaving the model unsaved', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const result = store.getState().loadFromCSV(csvWithShading('350', '355', '21.5'));

  expect(result.upgraded).toBe(true);
  expect(tree(store)).toMatchObject({ start_angle: 0, end_angle: 0, distance: 17 });
  expect(store.getState().getDocumentCsv()).not.toBe(store.getState().lastSavedCsv);
});

it('leaves a model whose stored values already match its drawing clean', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const result = store.getState().loadFromCSV(csvWithShading('0', '0', '17'));

  expect(result.upgraded).toBe(false);
  expect(store.getState().getDocumentCsv()).toBe(store.getState().lastSavedCsv);
});
