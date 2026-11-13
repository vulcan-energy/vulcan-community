// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { calculateBaseHeightPatchForFloorMove } from '../zoneDerivation';
import { buildGeometry3DPrimitives } from '../geometry3dMapper';
import { convertGroundRelativeWindowExtraJsonForCsv, parseCsvToGeometry } from '../../geometry/io/parseCsvToGeometry';
import type { Element, Floor } from '../../geometry/types';
import { createGeometryStore } from '../../stores/geometryStore';
import { unavailableGeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import {
  closeShadingKindOf,
  closeShadingOptions,
  buildAddWindowOpeningPatch,
  windowOpeningBulkEditBlocked,
  windowPartsCopyBlocked,
  windowPartsCopyColumns,
  buildConvertToSingleOpeningPatch,
  buildSingleOpeningPatch,
  buildWindowOpeningFieldPatch,
  classifyWindowOpenings,
  syncWindowPartListToMidHeight,
} from '../windowOpenings';

const columns = { free_area_height: 0.95, mid_height: 1.65, max_window_open_area: 0.8 };
const part = (mid: number) => ({ free_area_height: 0.5, mid_height: mid, max_window_open_area: 0.4 });
const legacy = (mid: number) => ({ mid_height_air_flow_path: mid });
const withList = (list: unknown, row: Record<string, unknown> = columns) => ({
  ...row,
  extra_json: { window_part_list: list, note: 'keep' },
});

describe('classifyWindowOpenings mirrors map_window', () => {
  it.each([
    ['A consistent legacy list', withList([legacy(1.65)]), { kind: 'rows', source: 'legacy' }],
    ['A2 legacy height wins over the column', withList([legacy(1.5)]), { kind: 'rows', source: 'legacy', rows: [{ ...columns, mid_height: 1.5 }] }],
    ['B one new-style part wins over columns', withList([part(1.2)]), { kind: 'rows', source: 'parts', rows: [part(1.2)] }],
    ['C new-style part with blank columns', withList([part(1.2)], {}), { kind: 'rows', source: 'parts' }],
    ['D two new-style parts', withList([part(1.2), part(2)]), { kind: 'rows', source: 'parts' }],
    ['E conflicting legacy heights', withList([legacy(1.3), legacy(2)]), { kind: 'repair', reason: 'conflicting_heights' }],
    ['E2 equal legacy heights', withList([legacy(1.65), legacy(1.65)]), { kind: 'rows', source: 'legacy' }],
    ['F no list with columns', columns, { kind: 'rows', source: 'columns', rows: [columns] }],
    ['G free blank and area 0 is not a deliberate closure', { max_window_open_area: 0, mid_height: 1 }, { kind: 'needs_input', missing: ['free_area_height'] }],
    ['G with free height set and area 0', { ...columns, max_window_open_area: 0 }, { kind: 'closed' }],
    ['G2 no list and blank columns', {}, { kind: 'needs_input', missing: ['free_area_height', 'mid_height', 'max_window_open_area'] }],
    ['H empty list', withList([]), { kind: 'closed' }],
    ['I partial new-style row', withList([{ free_area_height: 1, mid_height: 1 }]), { kind: 'repair', reason: 'incomplete_parts', partIssues: ['Part 1 needs max open area'] }],
    ['J empty row', withList([{}]), { kind: 'repair', reason: 'incomplete_parts', partIssues: ['Part 1 needs free height, mid height and max open area'] }],
    ['K mixed list', withList([legacy(1), part(1)]), { kind: 'repair', reason: 'unsupported_list' }],
    ['non-array list', withList({ a: 1 }), { kind: 'repair', reason: 'unsupported_list' }],
    ['legacy row with an extra key', withList([{ mid_height_air_flow_path: 1, other: 2 }]), { kind: 'repair', reason: 'unsupported_list' }],
    ['partial columns', { free_area_height: 1, mid_height: 1 }, { kind: 'needs_input', missing: ['max_window_open_area'] }],
    ['new-style list wins over a zero area column', withList([part(1.2)], { ...columns, max_window_open_area: 0 }), { kind: 'rows', source: 'parts' }],
    ['legacy list with zero area', withList([legacy(1)], { ...columns, max_window_open_area: 0 }), { kind: 'closed' }],
  ])('%s', (_name, row, expected) => {
    expect(classifyWindowOpenings(row)).toMatchObject(expected);
  });

  it('reads columns from extra_json when the row has none, like the converter', () => {
    expect(classifyWindowOpenings({ extra_json: columns })).toMatchObject({ kind: 'rows', source: 'columns' });
  });
});

describe('window opening write path', () => {
  it('patches only the edited column on a consistent legacy list', () => {
    expect(buildWindowOpeningFieldPatch(withList([legacy(1.5)]), 'free_area_height', 0.7)).toEqual({ free_area_height: 0.7 });
  });

  it('keeps list length when mid height changes on a consistent legacy list', () => {
    expect(buildWindowOpeningFieldPatch(withList([legacy(1.65), legacy(1.65)]), 'mid_height', 1.2)).toEqual({
      mid_height: 1.2,
      extra_json: { note: 'keep', window_part_list: [legacy(1.2), legacy(1.2)] },
    });
  });

  it('materialises the single legacy entry on the first edit of a window with no list', () => {
    expect(buildWindowOpeningFieldPatch(columns, 'max_window_open_area', 0.6)).toEqual({
      max_window_open_area: 0.6,
      extra_json: { window_part_list: [legacy(1.65)] },
    });
  });

  it('moves a new-style part into the normal form so the edit takes effect', () => {
    const patch = buildWindowOpeningFieldPatch(withList([part(1.2)]), 'free_area_height', 0.7);
    expect(patch).toEqual({
      free_area_height: 0.7,
      mid_height: 1.2,
      max_window_open_area: 0.4,
      extra_json: { note: 'keep', window_part_list: [legacy(1.2)] },
    });
    expect(classifyWindowOpenings({ ...withList([part(1.2)]), ...patch })).toMatchObject({
      kind: 'rows', source: 'legacy', rows: [{ free_area_height: 0.7, mid_height: 1.2, max_window_open_area: 0.4 }],
    });
  });

  it.each([
    ['empty', []],
    ['mixed', [legacy(1), part(1)]],
    ['malformed', 'x'],
  ])('rewrites a %s list to one opening', (_name, list) => {
    expect(buildWindowOpeningFieldPatch(withList(list), 'free_area_height', 0.7)).toEqual({
      free_area_height: 0.7,
      extra_json: { note: 'keep', window_part_list: [legacy(1.65)] },
    });
  });

  it('leaves conflicting legacy divisions unless the user sets one mid height', () => {
    const conflicting = withList([legacy(1.3), legacy(2)]);
    expect(buildWindowOpeningFieldPatch(conflicting, 'free_area_height', 0.7)).toEqual({ free_area_height: 0.7 });
    expect(buildWindowOpeningFieldPatch(conflicting, 'mid_height', 1.4)).toEqual({
      mid_height: 1.4,
      extra_json: { note: 'keep', window_part_list: [legacy(1.4)] },
    });
  });

  it('removes the list when mid height is cleared, so the window asks for input', () => {
    const patch = buildWindowOpeningFieldPatch(withList([legacy(1.65)]), 'mid_height', '');
    expect(patch).toEqual({ mid_height: '', extra_json: { note: 'keep' } });
  });

  it('reduces a remaining table row to the normal form', () => {
    expect(buildSingleOpeningPatch(withList([part(1.2), part(2)]), part(2))).toEqual({
      ...part(2),
      extra_json: { note: 'keep', window_part_list: [legacy(2)] },
    });
  });

  it('converts to part 1 of a new-style list and to the column height for divisions', () => {
    expect(buildConvertToSingleOpeningPatch(withList([part(1.2), part(2)]))).toEqual({
      ...part(1.2),
      extra_json: { note: 'keep', window_part_list: [legacy(1.2)] },
    });
    expect(buildConvertToSingleOpeningPatch(withList([legacy(1.3), legacy(2)]))).toEqual({
      mid_height: 1.65,
      extra_json: { note: 'keep', window_part_list: [legacy(1.65)] },
    });
  });

  it('moves a list only while it still matches the previous mid height', () => {
    expect(syncWindowPartListToMidHeight(withList([legacy(1.65)]), 1.65, 1.9)).toEqual({
      note: 'keep', window_part_list: [legacy(1.9)],
    });
    expect(syncWindowPartListToMidHeight(withList([legacy(1.5)]), 1.65, 1.9)).toBeNull();
    expect(syncWindowPartListToMidHeight(withList([part(1.65)]), 1.65, 1.9)).toBeNull();
  });
});

describe('new-style part heights stay ground-relative in the editor', () => {
  const physicalPart = { free_area_height: 0.4, mid_height: 1.234, max_window_open_area: 0.3 };
  const csv = (versionRow: string, midHeight: number) => `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0,,,,,,,,,,,,,
${versionRow}
Ventilation_ventilation_zone_base_height,2.4,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Window Elements,,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,linked_wall,frame_area_fraction,free_area_height,mid_height,max_window_open_area,coords,extra_json
Window 1,Living,BuildingElementTransparent,1.2,90,1,1.2,0,3.2,,0.1,0.4,1.4,0.4,"0.000,0.000,1.000|1.000,0.000,1.000","{""window_part_list"":[{""free_area_height"":0.4,""mid_height"":${midHeight},""max_window_open_area"":0.3}]}"
`.trim();
  const importedPart = (versionRow: string) => {
    const window = parseCsvToGeometry(csv(versionRow, 1.234)).elements.find((element) => element.type === 'BuildingElementTransparent');
    return (window?.extra_json as { window_part_list: Array<Record<string, number>> }).window_part_list[0];
  };

  it.each([
    ['version 3', 'VulcanCsvVersion,3,,,,,,,,,,,,,'],
    ['version 1, which the builder reads as zone-relative', ''],
  ])('adds the zone base on import, %s', (_name, versionRow) => {
    expect(importedPart(versionRow).mid_height).toBe(3.634);
  });

  it('round-trips on export without rounding authored values', () => {
    const extra = { window_part_list: [{ ...physicalPart, mid_height: 3.634 }] };
    expect(convertGroundRelativeWindowExtraJsonForCsv(extra, 2.4)).toEqual({ window_part_list: [physicalPart] });
  });

  it('moves once with the floor', () => {
    const floors: Floor[] = [
      { id: '0', name: 'G', zIndex: 0, height: 2.4, isRoofSpace: false },
      { id: '1', name: 'F', zIndex: 1, height: 2.4, isRoofSpace: false },
    ];
    const element = {
      id: 'w', type: 'BuildingElementTransparent', coordinates: [{ x: 0, y: 0, z: 0 }],
      base_height: 1, mid_height: 1.6, extra_json: { window_part_list: [physicalPart] },
    } as unknown as Element;
    expect(calculateBaseHeightPatchForFloorMove(element, 1, floors)?.extra_json).toEqual({
      window_part_list: [{ ...physicalPart, mid_height: 3.634 }],
    });
  });
});

describe('store keeps a following list in step on a8/a9 only', () => {
  const physicalPort = {
    ...unavailableGeometrySchemaPort,
    availability: 'available' as const,
    getElementSubschema: () => ({ properties: { window_part_list: { type: 'array', items: { properties: { mid_height: {} } } } } }),
    getRootSchema: () => ({}),
    getSchemaSubtypeForElementData: () => undefined,
    getStrictestIntegerKeysForElementType: () => new Set<string>(),
  };
  const windowRow = {
    id: 'w', name: 'W', type: 'BuildingElementTransparent', zoneId: 'z', floorId: '0', parent_element: null,
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    width: 1, height: 1, area: 1, pitch: 90, base_height: 1, mid_height: 1.5,
    free_area_height: 0.5, max_window_open_area: 0.5,
    extra_json: { window_part_list: [{ mid_height_air_flow_path: 1.5 }] },
  } as unknown as Element;
  const moved = (schemaPort?: typeof physicalPort) => {
    const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort });
    store.setState({ elementsById: { w: windowRow }, elementIds: ['w'] });
    store.getState().updateElement('w', { base_height: 2 } as Partial<Element>);
    return store.getState().elementsById.w as Element & { mid_height: number };
  };

  it('moves the list with an automatic mid height', () => {
    expect(moved(physicalPort)).toMatchObject({
      mid_height: 2.5,
      extra_json: { window_part_list: [{ mid_height_air_flow_path: 2.5 }] },
    });
  });

  it('leaves a7 lists to WindowPartListControl so they do not move twice', () => {
    expect(moved()).toMatchObject({
      mid_height: 2.5,
      extra_json: { window_part_list: [{ mid_height_air_flow_path: 1.5 }] },
    });
  });
});

describe('review findings: write-path faults', () => {
  it('clearing mid height on a single physical part takes effect', () => {
    const row = { ...columns, mid_height: 2, extra_json: { window_part_list: [part(1.2)] } };
    const patch = buildWindowOpeningFieldPatch(row, 'mid_height', '');
    expect(patch.mid_height).toBe('');
    expect(patch.extra_json).toEqual({});
    expect(classifyWindowOpenings({ ...row, ...patch })).toMatchObject({ kind: 'needs_input', missing: ['mid_height'] });
  });

  it('keeps a partial single part when adding an opening', () => {
    expect(buildAddWindowOpeningPatch({ extra_json: { window_part_list: [{ free_area_height: 0.5 }] } })).toEqual({
      extra_json: { window_part_list: [{ free_area_height: 0.5 }, {}] },
    });
  });
});

describe('review findings: bulk edit and copy on a8/a9', () => {
  it.each([
    ['table after Add opening', withList([part(1), {}])],
    ['empty list with stale columns', withList([])],
    ['malformed list', withList('x')],
    ['incomplete single part', withList([{ free_area_height: 1 }])],
    ['conflicting legacy list', withList([legacy(1.3), legacy(2)])],
    ['one physical part', withList([part(1)])],
  ])('skips %s', (_name, row) => {
    expect(windowOpeningBulkEditBlocked(row, true)).toBe(true);
  });

  it.each([
    ['no list', columns],
    ['consistent legacy list', withList([legacy(1.65)])],
    ['zero area with columns', { ...columns, max_window_open_area: 0 }],
  ])('edits %s', (_name, row) => {
    expect(windowOpeningBulkEditBlocked(row, true)).toBe(false);
  });

  it('leaves a7 bulk edits alone apart from physical parts', () => {
    expect(windowOpeningBulkEditBlocked(withList([]), false)).toBe(false);
    expect(windowOpeningBulkEditBlocked(withList([legacy(1.3), legacy(2)]), false)).toBe(false);
    expect(windowOpeningBulkEditBlocked(withList([part(1)]), false)).toBe(true);
  });

  it('blocks copying a source that cannot run on a8/a9', () => {
    expect(windowPartsCopyBlocked({ free_area_height: 0.5 }, true)).toBe(true);
    expect(windowPartsCopyBlocked(withList([]), true)).toBe(true);
    expect(windowPartsCopyBlocked(columns, true)).toBe(false);
    expect(windowPartsCopyBlocked({ free_area_height: 0.5 }, false)).toBe(false);
  });

  it('copies the run values and never undefined', () => {
    const row = { free_area_height: 0.5, max_window_open_area: 0.4, extra_json: { window_part_list: [legacy(1.2)] } };
    expect(windowPartsCopyColumns(row)).toEqual({ free_area_height: 0.5, mid_height: 1.2, max_window_open_area: 0.4 });
  });
});

describe('review findings: base-height edits on a8/a9', () => {
  const physicalPort = {
    ...unavailableGeometrySchemaPort,
    availability: 'available' as const,
    getElementSubschema: () => ({ properties: { window_part_list: { type: 'array', items: { properties: { mid_height: {} } } } } }),
    getRootSchema: () => ({}),
    getSchemaSubtypeForElementData: () => undefined,
    getStrictestIntegerKeysForElementType: () => new Set<string>(),
  };
  const twoParts = {
    id: 'w', name: 'W', type: 'BuildingElementTransparent', zoneId: 'z', floorId: '0', parent_element: null,
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    width: 1, height: 1, area: 1, pitch: 90, base_height: 1, mid_height: 1.5,
    extra_json: { window_part_list: [part(1.2), { free_area_height: 0.5, mid_height: 1.8 }] },
  } as unknown as Element;
  const update = (updates: Partial<Element>, schemaPort?: typeof physicalPort) => {
    const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort });
    store.setState({ elementsById: { w: twoParts }, elementIds: ['w'] });
    store.getState().updateElement('w', updates);
    return (store.getState().elementsById.w as Element & { extra_json: { window_part_list: Array<{ mid_height: number }> } }).extra_json.window_part_list.map((row) => row.mid_height);
  };

  it('moves every physical part by the same delta, once', () => {
    expect(update({ base_height: 1.5 } as Partial<Element>, physicalPort)).toEqual([1.7, 2.3]);
  });

  it('does not move parts on a7', () => {
    expect(update({ base_height: 1.5 } as Partial<Element>)).toEqual([1.2, 1.8]);
  });

  it('ends at the same height when the base is cleared and retyped', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: physicalPort });
    store.setState({ elementsById: { w: twoParts }, elementIds: ['w'], floors: [{ id: '0', name: 'G', zIndex: 0, height: 2.4, isRoofSpace: false }] });
    store.getState().updateElement('w', { base_height: '' } as unknown as Partial<Element>);
    store.getState().updateElement('w', { base_height: 3 } as Partial<Element>);
    const parts = (store.getState().elementsById.w as Element & { extra_json: { window_part_list: Array<{ mid_height: number }> } }).extra_json.window_part_list;
    expect(parts.map((row) => row.mid_height)).toEqual([3.2, 3.8]);
  });

  it('leaves a list the update already moved', () => {
    expect(update({
      base_height: 1.5,
      extra_json: { window_part_list: [part(5), part(6)] },
    } as Partial<Element>, physicalPort)).toEqual([5, 6]);
  });
});

describe('3D window overlay', () => {
  it('draws the part a single-part window runs, not its stale columns', () => {
    const element = {
      id: 'w', name: 'W', type: 'BuildingElementTransparent', zoneId: 'z', parent_element: null,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      width: 1, height: 1, area: 1, pitch: 90, base_height: 1,
      free_area_height: 0.9, max_window_open_area: 0.9,
      extra_json: { window_part_list: [part(1.2)] },
    } as unknown as Element;
    const floors: Floor[] = [{ id: '0', name: 'G', zIndex: 0, height: 2.4, isRoofSpace: false }];
    const [primitive] = buildGeometry3DPrimitives({
      elementsById: { w: element },
      elementIds: ['w'],
      floors,
      currentFloorZ: 0,
    }) as unknown as Array<{ windowVentilation?: unknown }>;
    expect(primitive.windowVentilation).toMatchObject({ free_area_height: 0.5, max_window_open_area: 0.4 });
  });
});

describe('window close shading', () => {
  it('a drawn overhang picks the canopy band by its size; the kind stays a choice', () => {
    const values = (depth?: number) => closeShadingOptions('overhang', depth).map((option) => option.value);
    expect(values(0.6)).toEqual(['common roof', 'common open porch', 'small fixed canopy', 'balcony']);
    expect(values(2)).toEqual(['common roof', 'common open porch', 'large canopy', 'balcony']);
    expect(values()).toEqual(['common roof', 'common open porch', 'small fixed canopy', 'large canopy', 'balcony']);
  });

  it('maps drawn Window Shading types to the window field beside them', () => {
    expect(closeShadingKindOf('sidefinleft')).toBe('side_fin_left');
    expect(closeShadingKindOf('')).toBe('obstacle');
    expect(closeShadingKindOf('reveal')).toBeUndefined();
  });
});
