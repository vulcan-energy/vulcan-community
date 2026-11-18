// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';

// Two ground floors in one zone.
const csv = `Metadata,,
GlobalOrientationOffset,0,
VulcanCsvVersion,3

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone 1,Zone,120,48,2.5,FALSE

Ground Elements,,
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
West,Zone 1,BuildingElementGround,24,0,0,20,Slab_no_edge_insulation,,0.3,,"0,0,0|4,0,0|4,6,0|0,6,0",
East,Zone 1,BuildingElementGround,24,0,0,20,Slab_no_edge_insulation,,0.3,,"4,0,0|8,0,0|8,6,0|4,6,0",
`;

const open = () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv);
  const idOf = (name: string) => store.getState().elementIds.find((id) => store.getState().elementsById[id].name === name)!;
  return { store, idOf };
};

it('undo keeps the selected element under its own id', () => {
  const { store, idOf } = open();
  const west = idOf('West');
  store.getState().setSelection({ type: 'element', id: west });
  store.getState().updateElement(west, { thickness_walls: 0.4 } as never);
  store.getState().saveToHistory('edit');
  store.getState().undo();
  expect(store.getState().elementsById[west]).toMatchObject({ name: 'West', thickness_walls: 0.3 });
  expect(store.getState().selection).toMatchObject({ id: west });
});

it('undo selects the element the step had selected, after names were swapped', () => {
  const { store, idOf } = open();
  const west = idOf('West');
  const east = idOf('East');
  store.getState().setSelection({ type: 'element', id: west });
  store.getState().updateElement(west, { name: 'Spare' });
  store.getState().updateElement(east, { name: 'West' });
  store.getState().updateElement(west, { name: 'East' });
  store.getState().saveToHistory('swap');
  store.getState().undo();
  const selected = store.getState().selection?.id;
  expect(selected && store.getState().elementsById[selected]?.name).toBe('West');
});
