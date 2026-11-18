// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createGeometryStore } from '../../stores/geometryStore';
import type { ContextShading } from '../../geometry/types';
import { planContextShadingLineEdit, type ContextShadingLineEdit } from '../contextShadingGeometry';

// An 8 x 6 house with 0.3 m walls (centre (4, 3)) and a 6 m line 4.7 m north of its north wall.
const csv = `Metadata,,
GlobalOrientationOffset,0,
VulcanCsvVersion,3

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone 1,Zone,120,48,2.5,FALSE

Ground Elements,,
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
Floor,Zone 1,BuildingElementGround,48,0,0,28,Slab_no_edge_insulation,,0.3,,"0,0,0|8,0,0|8,6,0|0,6,0",

Context Shading,,
Name,Type,shading_type,start_angle,end_angle,distance,height,parent_element,coords,extra_json
Fence,ContextShading,obstacle,0,0,0,2,DefaultCentre,"1,11,0|7,11,0",
`;

const plan = (edit: ContextShadingLineEdit) => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv);
  const { elementsById, floors, globalOrientationOffset } = store.getState();
  const fence = Object.values(elementsById).find((el) => el.name === 'Fence') as ContextShading;
  return planContextShadingLineEdit(fence, Object.values(elementsById), floors, globalOrientationOffset, edit);
};

it('says in plain words why a line edit is refused', () => {
  expect(plan({ field: 'distance', value: 0 })).toEqual({ refusal: 'Distance must be above 0 m.' });
  expect(plan({ field: 'distance', value: -3 })).toEqual({ refusal: 'Distance must be above 0 m.' });
  // The line is seen from 339 to 21 degrees.
  expect(plan({ field: 'start_angle', value: 21 })).toEqual({ refusal: 'From and To must differ.' });
  expect(plan({ field: 'start_angle', value: 120 })).toEqual({ refusal: "The line doesn't reach that direction from the centre." });
  expect(plan({ field: 'distance', value: 6 })).toHaveProperty('coordinates');
});
