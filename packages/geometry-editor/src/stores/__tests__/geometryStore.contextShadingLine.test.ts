// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';
import type { ContextShading } from '../../geometry/types';
import { contextShadingSplitRefusal } from '../../lib/developmentContextShading';
import { editStoredRow } from '../../lib/contextShadingDrawing';

// An 8 x 6 house with 0.3 m walls (centre (4, 3)) and a 6 m line 4.7 m north of its north wall.
const csv = (coords: string) => `Metadata,,
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
Fence,ContextShading,obstacle,0,0,0,2,DefaultCentre,"${coords}",
`;

const headLabel = (store: ReturnType<typeof createGeometryStore>) => store.getState().history[store.getState().historyIndex]?.label;

const open = (coords = '1,11,0|7,11,0') => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv(coords));
  const id = Object.values(store.getState().elementsById).find((el) => el.name === 'Fence')!.id;
  const fence = () => store.getState().elementsById[id] as ContextShading;
  return { store, id, fence };
};

describe('editing a 2-point line Context Shading object', () => {
  it('moves the line so the derived distance is the typed one', () => {
    const { store, id, fence } = open();
    expect(fence()).toMatchObject({ distance: 4.7 });
    expect(store.getState().editContextShadingLine(id, { field: 'distance', value: 6 })).toBe(true);
    expect(fence()).toMatchObject({ distance: 6 });
    expect(fence().coordinates.map((p) => Math.round(p.y * 1000) / 1000)).toEqual([12.3, 12.3]);
  });

  it('moves an end along the line so its direction is the typed one', () => {
    const { store, id, fence } = open();
    expect(store.getState().editContextShadingLine(id, { field: 'start_angle', value: 330 })).toBe(true);
    expect(fence().start_angle).toBe(330);
    expect(store.getState().editContextShadingLine(id, { field: 'end_angle', value: 30 })).toBe(true);
    expect(fence()).toMatchObject({ start_angle: 330, end_angle: 30, distance: 4.7 });
  });

  it('changes nothing when the value cannot be reached', () => {
    const { store, id, fence } = open();
    const before = fence();
    // A line 8 m north cannot be seen at 120 degrees.
    expect(store.getState().editContextShadingLine(id, { field: 'start_angle', value: 120 })).toBe(false);
    // Moved 10 m in, the line would cover the dwelling.
    expect(store.getState().editContextShadingLine(id, { field: 'distance', value: -6 })).toBe(false);
    expect(fence()).toBe(before);
  });

  it('refuses a polygon: its directions come from the drawing', () => {
    const { store, id, fence } = open('1,11,0|7,11,0|7,12,0|1,12,0');
    const before = fence();
    expect(store.getState().editContextShadingLine(id, { field: 'distance', value: 6 })).toBe(false);
    expect(fence()).toBe(before);
  });

  it('is one undo step', () => {
    const { store, id, fence } = open();
    const before = fence().coordinates;
    store.getState().editContextShadingLine(id, { field: 'distance', value: 6 });
    expect(headLabel(store)).toBe('editContextShadingLine');
    store.getState().undo();
    expect(fence().coordinates).toEqual(before);
  });

  it('sets the centre of every object as one undo step', () => {
    const { store, fence } = open();
    store.getState().setContextShadingCentre('Floor');
    expect(fence().parent_element).toBe('Floor');
    expect(headLabel(store)).toBe('setContextShadingCentre');
    store.getState().undo();
    expect(fence().parent_element).toBe('DefaultCentre');
  });
});

// The U block round the house's north side (three parts), and an L block (two parts, distinct distances).
const U = '-10,-2,0|-4,-2,0|-4,10,0|12,10,0|12,-2,0|18,-2,0|18,16,0|-10,16,0';
const L = '9,5,0|20,5,0|20,6,0|10,6,0|10,20,0|9,20,0';
// What the converter sends for an element: one arc per part, or the row's rounded envelope.
const arcs = (shading: ContextShading) => shading.parts?.map((p) => [p.start_angle, p.end_angle, p.distance])
  ?? [[Math.round(shading.start_angle) % 360, Math.round(shading.end_angle) % 360, shading.distance]];

describe('splitting a polygon Context Shading object into lines', () => {
  for (const [label, coords, offset, count] of [['U block', U, 0, 3], ['L block', L, 0, 2], ['U block, offset 17.4', U, 17.4, 3]] as const) {
    it(`gives lines that send HEM the same arcs and distances: ${label}`, () => {
      const { store, id, fence } = open(coords);
      store.getState().setGlobalOrientationOffset(offset);
      const before = arcs(fence());
      expect(before).toHaveLength(count);
      const ids = store.getState().splitContextShadingIntoLines(id)!;
      expect(ids).toHaveLength(before.length);
      const lines = ids.map((lineId) => store.getState().elementsById[lineId] as ContextShading);
      expect(lines.flatMap(arcs)).toEqual(before);
      if (label === 'L block') expect(new Set(before.map((arc) => arc[2])).size).toBe(2);
      for (const line of lines) {
        expect(line).toMatchObject({ shading_type: 'obstacle', height: 2, parent_element: 'DefaultCentre' });
        expect(line.coordinates).toHaveLength(2);
        expect(line.parts).toBeUndefined();
      }
      expect(store.getState().elementsById[id]).toBeUndefined();
      expect(store.getState().selectedElementIds).toEqual(ids);
      expect(lines.map((line) => line.name)).toEqual(lines.map((_, i) => `Fence ${i + 1}`));
    });
  }

  it('numbers the lines past a name another element already has', () => {
    const { store, id } = open(U);
    const floor = Object.values(store.getState().elementsById).find((el) => el.name === 'Floor')!.id;
    store.getState().updateElement(floor, { name: 'Fence 2' });
    const ids = store.getState().splitContextShadingIntoLines(id)!;
    expect(ids.map((lineId) => store.getState().elementsById[lineId].name)).toEqual(['Fence 1', 'Fence 3', 'Fence 4']);
  });

  it('splits a single-part polygon into one line, and is one undo step', () => {
    const { store, id } = open('1,11,0|7,11,0|7,12,0|1,12,0');
    const before = store.getState().getDocumentCsv();
    expect(store.getState().splitContextShadingIntoLines(id)).toHaveLength(1);
    expect(headLabel(store)).toBe('splitContextShadingIntoLines');
    store.getState().undo();
    expect(store.getState().getDocumentCsv()).toBe(before);
  });

  it('refuses a line, a generated Development neighbour and an object shared across the development, saying why', () => {
    const { store, id, fence } = open();
    expect(contextShadingSplitRefusal(fence())).toBe('A line is already one direction.');
    expect(store.getState().splitContextShadingIntoLines(id)).toBeNull();
    const poly = open(U);
    poly.store.getState().updateElement(poly.id, { extra_json: { development_context_shading: { version: 1, projectId: 'p', activeStem: 'a', sourceStem: 'b' } } } as never);
    expect(contextShadingSplitRefusal(poly.fence())).toBe('This object comes from a neighbouring model. Change it there.');
    expect(poly.store.getState().splitContextShadingIntoLines(poly.id)).toBeNull();
    const shared = open(U);
    shared.store.getState().updateElement(shared.id, { extra_json: { development_context_shading: { sharedId: 'ctx-1', projectId: 'p' } } } as never);
    expect(contextShadingSplitRefusal(shared.fence()))
      .toBe('This object is shared with the other models in the development, so it cannot be split into lines.');
    const before = shared.fence();
    expect(shared.store.getState().splitContextShadingIntoLines(shared.id)).toBeNull();
    expect(shared.fence()).toBe(before);
    expect(contextShadingSplitRefusal(open(U).fence())).toBeNull();
  });
});

describe('undo and redo of Split into lines', () => {
  it('selects the restored polygon as it was before the split, and the lines again on redo', () => {
    const { store, id } = open(U);
    store.getState().setSelection({ type: 'global', id });
    store.getState().setSelectedElementIds([id]);
    const ids = store.getState().splitContextShadingIntoLines(id)!;
    store.getState().undo();
    const restored = Object.values(store.getState().elementsById).find((el) => el.name === 'Fence')!.id;
    expect(store.getState().selection).toEqual({ type: 'global', id: restored });
    expect(store.getState().selectedElementIds).toEqual([restored]);
    store.getState().redo();
    expect(store.getState().selectedElementIds).toHaveLength(ids.length);
    expect(store.getState().selectedElementIds.every((lineId) => store.getState().elementsById[lineId]?.coordinates.length === 2)).toBe(true);
    expect(store.getState().selectedElementIds.map((lineId) => store.getState().elementsById[lineId].name)).toEqual(['Fence 1', 'Fence 2', 'Fence 3']);
    expect(store.getState().selection).toBeNull();
  });
});

describe('the hovered Context Shading part', () => {
  it('clears when the selection changes or its element is deleted or undone away', () => {
    const { store, id } = open();
    const hover = () => store.getState().hoveredContextShadingPart;
    store.getState().setSelection({ type: 'element', id });
    store.getState().setHoveredContextShadingPart({ elementId: id, index: 0 });
    // The same element with a field focus is not a change of selection.
    store.getState().setSelection({ type: 'element', id, focusFieldKey: 'height' });
    expect(hover()).not.toBeNull();
    store.getState().clearSelection();
    expect(hover()).toBeNull();

    store.getState().setHoveredContextShadingPart({ elementId: id, index: 0 });
    store.getState().removeElement(id);
    expect(hover()).toBeNull();
  });
});

// A hand-written row with typed values and no drawing, with or without a centre and parts.
const typedRow = (parent: string, parts = '') => `Metadata,,
GlobalOrientationOffset,0,
VulcanCsvVersion,3

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone 1,Zone,120,48,2.5,FALSE

Ground Elements,,
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
Floor,Zone 1,BuildingElementGround,48,0,0,28,Slab_no_edge_insulation,,0.3,,"0,0,0|8,0,0|8,6,0|0,6,0",

Context Shading,,
Name,Type,shading_type,start_angle,end_angle,distance,parts,height,parent_element,coords,extra_json
Block,ContextShading,obstacle,30,120,12,${parts},5,${parent},,
`;

describe('editing a typed Context Shading row with no drawing', () => {
  for (const [label, parent, parts] of [
    ['no centre', '', ''],
    ['a centre', 'Floor', ''],
    ['stored parts', 'Floor', '30:60:12;70:120:15'],
  ] as const) {
    it(`keeps the row without coordinates: ${label}`, () => {
      const store = createGeometryStore({ defaultDefaultsPath: null });
      store.getState().loadFromCSV(typedRow(parent, parts));
      const id = Object.values(store.getState().elementsById).find((el) => el.name === 'Block')!.id;
      const block = () => store.getState().elementsById[id] as ContextShading;
      expect(block().coordinates ?? []).toEqual([]);
      const csvBefore = store.getState().getDocumentCsv();
      for (const [field, value] of [['start_angle', 35], ['end_angle', 55], ['distance', 14]] as const) {
        // What the form sends for the first part's cell.
        store.getState().updateElement(id, editStoredRow(block(), 0, field, value)!);
        expect(block().parts?.[0]?.[field] ?? block()[field]).toBe(value);
        expect(block().coordinates ?? []).toEqual([]);
        expect(block().parent_element ?? '').toBe(parent);
      }
      expect(store.getState().getDocumentCsv()).not.toBe(csvBefore);
      // It saves and reopens as the same coordinate-less row.
      const reopened = createGeometryStore({ defaultDefaultsPath: null });
      reopened.getState().loadFromCSV(store.getState().getDocumentCsv());
      const again = Object.values(reopened.getState().elementsById).find((el) => el.name === 'Block') as ContextShading;
      expect(again).toMatchObject({ start_angle: block().start_angle, end_angle: block().end_angle, distance: block().distance });
      expect(again.parts).toEqual(block().parts);
      expect(again.coordinates ?? []).toEqual([]);
    });
  }
});

// The Elements list, the canvas and the draw tools select External shading as 'global'.
const selectFromList = (store: ReturnType<typeof createGeometryStore>, id: string) => {
  store.getState().clearElementSelection();
  store.getState().setSelectedElementIds([id]);
  store.getState().setSelection({ type: 'global', id });
};

describe('External shading selected as the Elements list selects it', () => {
  it('keeps the global selection through each action and its undo and redo', () => {
    const { store, id } = open();
    selectFromList(store, id);
    const selected = { type: 'global', id };
    store.getState().editContextShadingLine(id, { field: 'distance', value: 6 });
    expect(store.getState().selection).toEqual(selected);
    store.getState().setContextShadingCentre('Floor');
    expect(store.getState().selection).toEqual(selected);
    store.getState().undo();
    expect(store.getState().selection).toMatchObject({ type: 'global' });
    store.getState().undo();
    expect(store.getState().selection).toMatchObject({ type: 'global' });
    store.getState().redo();
    expect(store.getState().selection).toMatchObject({ type: 'global' });
    expect(store.getState().selectedElementIds).toEqual([store.getState().selection!.id]);
  });

  it('restores the polygon as a global selection on undo of a split', () => {
    const { store, id } = open(U);
    selectFromList(store, id);
    store.getState().splitContextShadingIntoLines(id);
    store.getState().undo();
    const restored = Object.values(store.getState().elementsById).find((el) => el.type === 'ContextShading')!.id;
    expect(store.getState().selection).toEqual({ type: 'global', id: restored });
    expect(store.getState().selectedElementIds).toEqual([restored]);
  });

  it('clears the hovered part when another object is selected, not when a field takes focus', () => {
    const { store, id } = open();
    const hover = () => store.getState().hoveredContextShadingPart;
    selectFromList(store, id);
    store.getState().setHoveredContextShadingPart({ elementId: id, index: 0 });
    store.getState().setSelection({ type: 'global', id, focusFieldKey: 'height' } as never);
    expect(hover()).not.toBeNull();
    const floor = Object.values(store.getState().elementsById).find((el) => el.name === 'Floor')!.id;
    selectFromList(store, floor);
    expect(hover()).toBeNull();
  });
});
