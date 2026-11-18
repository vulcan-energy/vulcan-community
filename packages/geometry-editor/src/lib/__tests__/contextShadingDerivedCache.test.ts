// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createGeometryStore } from '../../stores/geometryStore';
import type { ContextShading } from '../../geometry/types';
import { deriveContextShadingCached, labelSource } from '../contextShadingDerivedCache';
import { getSmartLabelPillTexts } from '../labelUtils';
import { DEVELOPMENT_CONTEXT_SHADING_META_KEY } from '../developmentContextShading';

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

it('derives once per change of the object, the elements, the floors or the offset', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv);
  const get = () => {
    const { elementsById, floors, globalOrientationOffset } = store.getState();
    const fence = Object.values(elementsById).find((el) => el.name === 'Fence') as ContextShading;
    return deriveContextShadingCached(fence, elementsById, floors, globalOrientationOffset);
  };
  const first = get();
  expect(first?.derived).toMatchObject({ parts: [{ distance: 4.7 }] });
  expect(get()).toBe(first);
  const id = Object.values(store.getState().elementsById).find((el) => el.name === 'Fence')!.id;
  store.getState().updateElement(id, { height: 3 });
  expect(get()).not.toBe(first);
});

it('drops the stored range and distance of an object that cannot be measured, so its label shows none', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  // A block over the centre of the dwelling, with the angles and distance the last measurable drawing left.
  store.getState().loadFromCSV(csv.replace('Fence,ContextShading,obstacle,0,0,0,2,DefaultCentre,"1,11,0|7,11,0"', 'Fence,ContextShading,obstacle,30,120,12,2,DefaultCentre,"1,1,0|7,1,0|7,5,0|1,5,0"'));
  const { elementsById, floors, globalOrientationOffset } = store.getState();
  const fence = Object.values(elementsById).find((el) => el.name === 'Fence') as ContextShading;
  const shown = labelSource(fence, elementsById, floors, globalOrientationOffset);
  expect(getSmartLabelPillTexts(shown, { showLineDimensions: false })).toEqual([]);
  const away = { ...fence, coordinates: [{ x: 1, y: 11, z: 0 }, { x: 7, y: 11, z: 0 }] } as ContextShading;
  expect(labelSource(away, elementsById, floors, globalOrientationOffset)).toBe(away);
});

it('re-derives when a floor edit changes the wall thickness', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv);
  const get = () => {
    const { elementsById, floors, globalOrientationOffset } = store.getState();
    const fence = Object.values(elementsById).find((el) => el.name === 'Fence') as ContextShading;
    return deriveContextShadingCached(fence, elementsById, floors, globalOrientationOffset);
  };
  expect(get()?.derived).toMatchObject({ parts: [{ distance: 4.7 }] });
  const floorId = Object.values(store.getState().elementsById).find((el) => el.name === 'Floor')!.id;
  store.getState().updateElement(floorId, { thickness_walls: 0.5 } as never);
  expect(get()?.derived).toMatchObject({ parts: [{ distance: 4.5 }] });
});

it('shows a generated neighbour with the parts it keeps, as the sync writes it', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv);
  const id = Object.values(store.getState().elementsById).find((el) => el.name === 'Fence')!.id;
  // An L: its east arm against the east wall (below 0), its north arm 0.7 m off the north wall.
  const coordinates = [[8, 0], [9, 0], [9, 8], [-2, 8], [-2, 7], [8, 7]].map(([x, y]) => ({ x, y, z: 0 }));
  store.getState().updateElement(id, { coordinates } as never);
  const { elementsById, floors, globalOrientationOffset } = store.getState();
  const own = deriveContextShadingCached(elementsById[id] as ContextShading, elementsById, floors, globalOrientationOffset)?.derived;
  expect(own && 'parts' in own && own.parts.some((part) => part.distance <= 0)).toBe(true);
  const generated = {
    ...(elementsById[id] as ContextShading),
    extra_json: { [DEVELOPMENT_CONTEXT_SHADING_META_KEY]: { version: 1, projectId: 'p', activeStem: 'a', sourceStem: 'b' } },
  } as ContextShading;
  const kept = deriveContextShadingCached(generated, elementsById, floors, globalOrientationOffset)?.derived;
  expect(kept && 'parts' in kept && kept.parts.map((part) => part.distance)).toEqual([0.7]);
  expect(store.getState().deriveContextShadingFor(generated)).toMatchObject({ parts: [{ distance: 0.7 }] });
});
