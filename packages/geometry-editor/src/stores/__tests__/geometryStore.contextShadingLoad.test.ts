// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';
import type { ContextShading } from '../../geometry/types';

// A 10 x 6 floor whose east edge carries a bay-like vertex cluster: area centroid (5, 3),
// vertex mean (~7.2, 3). The shading is a 2 m line centred due north of the area centroid,
// 17 m from the north wall.
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
Tree,ContextShading,obstacle,${startAngle},${endAngle},${distance},5,Floor,"4,23,0|6,23,0",
`;

const tree = (store: ReturnType<typeof createGeometryStore>) =>
  Object.values(store.getState().elementsById).find((el) => el.name === 'Tree') as ContextShading;

it('re-derives stale context shading angles and distance from the drawing on load, leaving the model unsaved', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const result = store.getState().loadFromCSV(csvWithShading('350', '355', '21.5'));

  expect(result.upgraded).toBe(true);
  expect(tree(store)).toMatchObject({ start_angle: 357.14, end_angle: 2.86, distance: 17 });
  expect(store.getState().getDocumentCsv()).not.toBe(store.getState().lastSavedCsv);
});

it('names the External shading objects whose values the drawing changed on open', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const result = store.getState().loadFromCSV(csvWithShading('350', '355', '21.5'));
  expect(result.notices).toContain(
    'Opening the model updated 1 External shading object from its drawing. Save to keep it.\nTree: directions 350°–355° → 357.14°–2.86°, distance 21.5 m → 17 m.',
  );
  const clean = createGeometryStore({ defaultDefaultsPath: null }).getState().loadFromCSV(csvWithShading('357.14', '2.86', '17'));
  expect(clean.notices.filter((notice) => notice.includes('External shading'))).toEqual([]);
});

it('leaves a model whose stored values already match its drawing clean', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const result = store.getState().loadFromCSV(csvWithShading('357.14', '2.86', '17'));

  expect(result.upgraded).toBe(false);
  expect(store.getState().getDocumentCsv()).toBe(store.getState().lastSavedCsv);
});

// An 8 x 6 house with 0.3 m walls and a U-shaped block round its north side, 4 m off.
const csvWithU = (row: string, partsColumn = true) => `Metadata,,
GlobalOrientationOffset,0,
VulcanCsvVersion,3

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone 1,Zone,120,48,2.5,FALSE

Ground Elements,,
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
Floor,Zone 1,BuildingElementGround,48,0,0,28,Slab_no_edge_insulation,,0.3,,"0,0,0|8,0,0|8,6,0|0,6,0",

Context Shading,,
Name,Type,shading_type,start_angle,end_angle,${partsColumn ? 'distance,parts' : 'distance'},height,parent_element,coords,extra_json
${row}
`;
const U_COORDS = '"-10,-2,0|-4,-2,0|-4,10,0|12,10,0|12,-2,0|18,-2,0|18,16,0|-10,16,0"';

it('stores a block seen as three faces with its parts, and opens it again unchanged', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csvWithU(`U,ContextShading,obstacle,0,0,0,,6,DefaultCentre,${U_COORDS},`));
  const u = Object.values(store.getState().elementsById).find((el) => el.name === 'U') as ContextShading;
  expect(u.parts).toEqual([
    { start_angle: 238, end_angle: 311, distance: 3.7 },
    { start_angle: 311, end_angle: 49, distance: 3.7 },
    { start_angle: 49, end_angle: 122, distance: 3.7 },
  ]);
  expect(u).toMatchObject({ distance: 3.7 });
  const saved = store.getState().getDocumentCsv();
  expect(saved).toContain('Context Shading,,,,,,,,,,,\nName,Type,shading_type,start_angle,end_angle,distance,parts,height');
  expect(saved).toContain(',3.7,238:311:3.7;311:49:3.7;49:122:3.7,6,');
  // The converter's envelope rule, on the text written: rounded ends match the first and last part, distance the nearest.
  const [start, end, distance, cell] = saved.split('\n').find((line) => line.startsWith('U,'))!.split(',').slice(3, 7);
  const written = cell.split(';').map((part) => part.split(':').map(Number));
  expect(Math.round(Number(start)) % 360).toBe(written[0][0]);
  expect(Math.round(Number(end)) % 360).toBe(written[written.length - 1][1]);
  expect(Number(distance)).toBe(Math.min(...written.map((part) => part[2])));

  const reopened = createGeometryStore({ defaultDefaultsPath: null });
  expect(reopened.getState().loadFromCSV(saved).upgraded).toBe(false);
  expect(reopened.getState().getDocumentCsv()).toBe(saved);
});

it('keeps the values a drawn object with a blank parent states: opening writes nothing', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const row = `Old,ContextShading,obstacle,300,60,12,,6,,${U_COORDS},`;
  expect(store.getState().loadFromCSV(csvWithU(row)).upgraded).toBe(false);
  expect(Object.values(store.getState().elementsById).find((el) => el.name === 'Old')).toMatchObject({ start_angle: 300, end_angle: 60, distance: 12 });
  expect(store.getState().getDocumentCsv()).toBe(store.getState().lastSavedCsv);
});

it('writes no parts column when no object has parts', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csvWithShading('357.14', '2.86', '17'));
  expect(store.getState().getDocumentCsv()).toContain('Context Shading,,,,,,,,,,\nName,Type,shading_type,start_angle,end_angle,distance,height,');
});

it('keeps the parts a row without coordinates states', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const row = 'Typed,ContextShading,obstacle,220,335,0.28,220:264:4.97;264:335:0.28,6,,,';
  expect(store.getState().loadFromCSV(csvWithU(row)).upgraded).toBe(false);
  const typed = Object.values(store.getState().elementsById).find((el) => el.name === 'Typed') as ContextShading;
  expect(typed.parts).toEqual([{ start_angle: 220, end_angle: 264, distance: 4.97 }, { start_angle: 264, end_angle: 335, distance: 0.28 }]);
  expect(store.getState().getDocumentCsv()).toContain(row);
});

it('writes back an unreadable parts cell as typed', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const row = 'Typed,ContextShading,obstacle,220,335,0.28,220-264 at 4.97,6,,,';
  store.getState().loadFromCSV(csvWithU(row));
  const typed = Object.values(store.getState().elementsById).find((el) => el.name === 'Typed') as ContextShading;
  expect(typed.parts).toBeUndefined();
  expect(store.getState().getDocumentCsv()).toContain(row);
});

it('keeps the ContextShadingJoinParts row a file states', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csvWithShading('357.14', '2.86', '17').replace('VulcanCsvVersion,3', 'VulcanCsvVersion,3\nContextShadingJoinParts,true'));
  expect(store.getState().complianceSettings.ContextShadingJoinParts).toBe(true);
  expect(store.getState().getDocumentCsv()).toMatch(/^ContextShadingJoinParts,TRUE,/m);
});

// A 4 x 4 house (centre (2, 2)); a neighbour beside it across the east party wall, with a recess
// south of that wall. Its west face is on the party wall line (0 m, left out); the recess face at
// x = 6 is 2 m off.
const neighbourHouse = `Metadata,,
GlobalOrientationOffset,0,
VulcanCsvVersion,3

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone 1,Zone,40,16,2.5,FALSE

Ground Elements,,
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
Floor,Zone 1,BuildingElementGround,16,0,0,16,Slab_no_edge_insulation,,,,"0,0,0|4,0,0|4,4,0|0,4,0",
`;
const syncedNeighbour = () => {
  const at = (points: number[][]) => points.map(([x, y]) => ({ x, y, z: 0 }));
  const neighbour = [{ id: 'ng', name: 'Neighbour Ground', type: 'BuildingElementGround', coordinates: at([[4, 4], [4, 1], [6, 1], [6, -2], [10, -2], [10, 4]]) }] as never[];
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(neighbourHouse);
  store.getState().syncDevelopmentContextShading({
    projectId: 'p', activeStem: 'a',
    contextModels: [{ stem: 'b', elements: neighbour, zones: [{ id: 'z', name: 'Living', floorArea: 20, height: 2.4, volume: 48 }] as never }],
  });
  return store;
};
const generatedIn = (store: ReturnType<typeof createGeometryStore>) =>
  Object.values(store.getState().elementsById).find((el) => el.name === 'Project context - b') as ContextShading;

it('opens a generated Development neighbour as the sync wrote it: parts at 0 m stay left out', () => {
  const store = syncedNeighbour();
  const generated = generatedIn(store);
  expect(generated).toMatchObject({ distance: 2 });
  expect(generated.parts).toBeUndefined();
  const saved = store.getState().getDocumentCsv();

  const reopened = createGeometryStore({ defaultDefaultsPath: null });
  expect(reopened.getState().loadFromCSV(saved).upgraded).toBe(false);
  const reread = Object.values(reopened.getState().elementsById).find((el) => el.name === 'Project context - b') as ContextShading;
  expect(reread).toMatchObject({ start_angle: generated.start_angle, end_angle: generated.end_angle, distance: 2 });
  expect(reread.parts).toBeUndefined();
});

it('keeps a generated neighbour without its parts at 0 m when the north offset or the centre changes', () => {
  const store = syncedNeighbour();
  store.getState().setGlobalOrientationOffset(10);
  expect(generatedIn(store)).toMatchObject({ distance: 2 });
  expect(generatedIn(store).parts).toBeUndefined();
  store.getState().setContextShadingCentre('Floor');
  expect(generatedIn(store)).toMatchObject({ distance: 2, parent_element: 'Floor' });
  expect(generatedIn(store).parts).toBeUndefined();
});

it('keeps a typed row with parts consistent with its envelope when the north offset changes', () => {
  for (const offset of [0.3, 0.6, 359.5]) {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().loadFromCSV(csvWithU('Typed,ContextShading,obstacle,220.6,334.6,0.28,221:264:4.97;264:335:0.28,6,,,'));
    store.getState().setGlobalOrientationOffset(offset);
    const typed = Object.values(store.getState().elementsById).find((el) => el.name === 'Typed') as ContextShading;
    const parts = typed.parts!;
    // The converter's envelope rule.
    expect(Math.round(typed.start_angle) % 360).toBe(parts[0].start_angle);
    expect(Math.round(typed.end_angle) % 360).toBe(parts[parts.length - 1].end_angle);
  }
});

it('re-derives drawn objects when the dwelling changes under them, in the same undo step', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csvWithU(`U,ContextShading,obstacle,0,0,0,,6,DefaultCentre,${U_COORDS},`));
  const u = () => Object.values(store.getState().elementsById).find((el) => el.name === 'U') as ContextShading;
  const floorId = Object.values(store.getState().elementsById).find((el) => el.name === 'Floor')!.id;
  expect(u().parts?.map((part) => part.distance)).toEqual([3.7, 3.7, 3.7]);

  store.getState().updateElement(floorId, { thickness_walls: 0.5 } as never);
  expect(u().parts?.map((part) => part.distance)).toEqual([3.5, 3.5, 3.5]);
  expect(u().distance).toBe(3.5);
  store.getState().saveToHistory('thickness');

  // The plate moves 1 m north: the U's inside faces are 1 m nearer.
  const moved = [[0, 1], [8, 1], [8, 7], [0, 7]].map(([x, y]) => ({ x, y, z: 0 }));
  store.getState().updateElement(floorId, { coordinates: moved } as never);
  expect(u().distance).toBeLessThan(3.5);
  store.getState().saveToHistory('move');

  store.getState().undo();
  expect(u().distance).toBe(3.5);
  store.getState().undo();
  expect(u().parts?.map((part) => part.distance)).toEqual([3.7, 3.7, 3.7]);
});

const shadingNotices = (notices: string[]) => notices.filter((notice) => notice.includes('External shading'));

it('opens a model saved after a drag to sub-millimetre coordinates with no notice and clean', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csvWithU(`U,ContextShading,obstacle,0,0,0,,6,DefaultCentre,${U_COORDS},`));
  const id = Object.values(store.getState().elementsById).find((el) => el.name === 'U')!.id;
  const floorId = Object.values(store.getState().elementsById).find((el) => el.name === 'Floor')!.id;
  // A drag: unrounded plan coordinates on the object and on the dwelling.
  const dragged = [[-10.01234567, -2.00071234], [-4.00049876, -2.00051111], [-3.99951234, 9.99948888], [12.00049999, 10.00051234],
    [12.00048765, -1.99950123], [18.00051111, -2.00049876], [18.00049999, 16.00051234], [-10.00048765, 15.99951111]];
  store.getState().updateElement(id, { coordinates: dragged.map(([x, y]) => ({ x, y, z: 0 })) } as never);
  store.getState().updateElement(floorId, { coordinates: [[0.00049, 0.00051], [8.00051, -0.00049], [7.99949, 6.00049], [0.00051, 5.99951]].map(([x, y]) => ({ x, y, z: 0 })) } as never);
  const saved = store.getState().getDocumentCsv();

  const reopened = createGeometryStore({ defaultDefaultsPath: null });
  const result = reopened.getState().loadFromCSV(saved);
  expect(shadingNotices(result.notices)).toEqual([]);
  expect(result.upgraded).toBe(false);
  expect(reopened.getState().getDocumentCsv()).toBe(reopened.getState().lastSavedCsv);
});

it('opens a file with 4 dp coordinates, then opens its saved copy with no notice', () => {
  // An L-shaped floor and an L block drawn at 4 dp. The coordinates write at 3 dp, so the values
  // the first open derives must be the ones the saved copy re-derives.
  const fourDp = `Metadata,,
GlobalOrientationOffset,0,
VulcanCsvVersion,3

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone 1,Zone,215.4,86.16,2.5,FALSE

Ground Elements,,
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,parent_element,coords,extra_json
Floor,Zone 1,BuildingElementGround,86.16,5,18,52,Slab_no_edge_insulation,,0.3,,"12.1154,-1.8077,0|17.1154,-1.8077,0|17.1154,-8.4615,0|18.4615,-8.4615,0|18.4615,-21.0385,0|14.8077,-21.0385,0|14.8077,-11.0385,0|12.1154,-11.0385,0",

Context Shading,,
Name,Type,shading_type,start_angle,end_angle,distance,height,parent_element,coords,extra_json
L block,ContextShading,obstacle,0,0,0,8,DefaultCentre,"2.1923,-1.8077,0|11.5385,-1.8077,0|11.5385,-11.0385,0|6.8462,-11.0385,0|6.8462,-21.0385,0|2.1923,-21.0385,0",
`;
  const store = createGeometryStore({ defaultDefaultsPath: null });
  expect(shadingNotices(store.getState().loadFromCSV(fourDp).notices)).toHaveLength(1);
  const saved = store.getState().getDocumentCsv();

  const reopened = createGeometryStore({ defaultDefaultsPath: null });
  const result = reopened.getState().loadFromCSV(saved);
  expect(shadingNotices(result.notices)).toEqual([]);
  expect(result.upgraded).toBe(false);
  expect(reopened.getState().getDocumentCsv()).toBe(reopened.getState().lastSavedCsv);
});

it('names several updated objects as updated from their drawings', () => {
  const two = csvWithU(`A,ContextShading,obstacle,0,0,0,,6,DefaultCentre,${U_COORDS},\nB,ContextShading,obstacle,0,0,0,,6,DefaultCentre,"1,11,0|7,11,0",`);
  const notices = shadingNotices(createGeometryStore({ defaultDefaultsPath: null }).getState().loadFromCSV(two).notices);
  expect(notices[0]).toMatch(/^Opening the model updated 2 External shading objects from their drawings\. Save to keep them\./);
});
