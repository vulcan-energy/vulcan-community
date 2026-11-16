// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { createGeometryStore } from '../../stores/geometryStore';
import { unavailableGeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { calculateDerivedWindowMidHeight } from '../zoneDerivation';
import { deriveTransparentOpeningDerivedValues, buildTransparentOpeningNumericPatch } from '../transparentOpeningDerivedFields';
import { getTransparentExportMidHeight } from '../elementArea';
import {
  WINDOW_OPENING_PART_KEY,
  buildAddWindowOpeningPatch,
  buildRemainingOpeningPatch,
  buildWindowOpeningFieldPatch,
  classifyWindowOpenings,
  windowOpeningPart,
  withWindowOpeningPart,
  type WindowOpeningSource,
} from '../windowOpenings';

// A 1.2 m window on a 0.8 m sill: head 2.0 m, centre 1.4 m. Its top-hung vent is 0.3 m high.
const top = { [WINDOW_OPENING_PART_KEY]: 'top' };
const columns = { free_area_height: 0.3, mid_height: 1.4, max_window_open_area: 0.27 };
const window = (extra: Record<string, unknown> | undefined, row: Record<string, unknown> = columns) => ({
  id: 'w', name: 'W', type: 'BuildingElementTransparent', zoneId: 'z', floorId: '0', parent_element: null,
  coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0.9, y: 0, z: 0 }],
  width: 0.9, height: 1.2, area: 1.08, pitch: 90, orientation360: 180, base_height: 0.8,
  ...row,
  ...(extra ? { extra_json: extra } : {}),
}) as unknown as Element;
const source = (element: Element) => element as unknown as WindowOpeningSource;

describe('part that opens: mid height', () => {
  it('is the centre of the free area: head − free ÷ 2 for top, sill + free ÷ 2 for bottom', () => {
    expect(calculateDerivedWindowMidHeight(0.8, 1.2)).toBe(1.4);
    expect(calculateDerivedWindowMidHeight(0.8, 1.2, 'top', 0.3)).toBe(1.85);
    expect(calculateDerivedWindowMidHeight(0.8, 1.2, 'bottom', 0.3)).toBe(0.95);
  });

  it('takes a blank or oversized free height as the whole window', () => {
    expect(calculateDerivedWindowMidHeight(0.8, 1.2, 'top')).toBe(1.4);
    expect(calculateDerivedWindowMidHeight(0.8, 1.2, 'bottom', 2)).toBe(1.4);
  });
});

describe('part that opens: storage shapes', () => {
  it('reads Whole from a file without the key', () => {
    expect(windowOpeningPart(source(window(undefined)))).toBe('whole');
    expect(windowOpeningPart(source(window({ window_part_list: [{ mid_height_air_flow_path: 1.4 }] })))).toBe('whole');
  });

  it('reads the key on single-opening columns and on a one-row part list', () => {
    expect(windowOpeningPart(source(window(top)))).toBe('top');
    expect(windowOpeningPart(source(window({ ...top, window_part_list: [{ mid_height_air_flow_path: 1.85 }] })))).toBe('top');
    const oneRow = window({ [WINDOW_OPENING_PART_KEY]: 'bottom', window_part_list: [columns] }, {});
    expect(windowOpeningPart(source(oneRow))).toBe('bottom');
  });

  it('ignores the key on a window with several openings, where each part has its own mid height', () => {
    expect(windowOpeningPart(source(window({ ...top, window_part_list: [columns, columns] })))).toBe('whole');
  });

  it('Whole removes the key, so the window is as it was', () => {
    expect(withWindowOpeningPart(source(window({ note: 'keep', ...top })), 'whole')).toEqual({ note: 'keep' });
    expect(withWindowOpeningPart(source(window({ note: 'keep' })), 'bottom')).toEqual({ note: 'keep', [WINDOW_OPENING_PART_KEY]: 'bottom' });
  });

  it('moves onto part 1 when a part is added, and back when one is left', () => {
    const single = window({ ...top, window_part_list: [{ mid_height_air_flow_path: 1.85 }] }, { ...columns, mid_height: 1.85 });
    const added = buildAddWindowOpeningPatch(source(single));
    const parts = added.extra_json!.window_part_list as Record<string, unknown>[];
    expect(added.extra_json).not.toHaveProperty(WINDOW_OPENING_PART_KEY);
    expect(parts[0]).toMatchObject({ [WINDOW_OPENING_PART_KEY]: 'top', mid_height: 1.85 });
    const removed = buildRemainingOpeningPatch(source({ ...single, ...added } as Element), parts[0] as never);
    expect(removed.extra_json).toMatchObject(top);
  });
});

describe('part that opens: derived values follow the drawing', () => {
  it('derives the top mid height and keeps an automatic one in step with free height edits', () => {
    const element = window(top, { ...columns, mid_height: 1.85 }) as Extract<Element, { type: 'BuildingElementTransparent' }>;
    expect(deriveTransparentOpeningDerivedValues(element).midHeight).toBe(1.85);
    expect(buildTransparentOpeningNumericPatch(element, { free_area_height: 0.5 })).toMatchObject({ mid_height: 1.75 });
    expect(buildTransparentOpeningNumericPatch(element, { base_height: 1 })).toMatchObject({ mid_height: 2.05 });
  });

  it('keeps a typed mid height, and Whole ignores free height as before', () => {
    const typed = window(top, { ...columns, mid_height: 1.6 }) as Extract<Element, { type: 'BuildingElementTransparent' }>;
    expect(buildTransparentOpeningNumericPatch(typed, { free_area_height: 0.5 })).not.toHaveProperty('mid_height');
    const whole = window(undefined) as Extract<Element, { type: 'BuildingElementTransparent' }>;
    expect(buildTransparentOpeningNumericPatch(whole, { free_area_height: 0.5 })).not.toHaveProperty('mid_height');
  });

  it('a wall shape edit places the mid height by the part', () => {
    expect(getTransparentExportMidHeight(window(top) as never)).toBe(1.85);
    expect(getTransparentExportMidHeight(window(undefined) as never)).toBe(1.4);
  });
});

describe('part that opens: store and export', () => {
  const physicalPort = {
    ...unavailableGeometrySchemaPort,
    availability: 'available' as const,
    getElementSubschema: () => ({ properties: { window_part_list: { type: 'array', items: { properties: { mid_height: {} } } } } }),
    getRootSchema: () => ({}),
    getSchemaSubtypeForElementData: () => undefined,
    getStrictestIntegerKeysForElementType: () => new Set<string>(),
  };
  const setup = (element: Element, schemaPort?: typeof physicalPort) => {
    const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort });
    store.getState().addZone({ name: 'Living', floorArea: 25, height: 2.4, volume: 60 });
    const zoneId = store.getState().zones[0].id;
    store.setState({ elementsById: { w: { ...element, zoneId } as Element }, elementIds: ['w'] });
    const get = () => store.getState().elementsById.w as Element & { mid_height: number; extra_json: Record<string, unknown> };
    const windowRow = () => store.getState().getDocumentCsv().split('\n').find((line) => line.startsWith('W,'))!.split(',');
    return { store, get, windowRow };
  };

  it('a8/a9: a free height edit moves an automatic top mid height and the list the converter reads', () => {
    const element = window({ ...top, window_part_list: [{ mid_height_air_flow_path: 1.85 }] }, { ...columns, mid_height: 1.85 });
    const { store, get } = setup(element, physicalPort);
    store.getState().updateElement('w', buildWindowOpeningFieldPatch(source(get()), 'free_area_height', 0.5) as Partial<Element>);
    expect(get().mid_height).toBe(1.75);
    expect(classifyWindowOpenings(source(get()))).toMatchObject({ kind: 'rows', rows: [{ mid_height: 1.75 }] });
  });

  it('exports the top mid height, and keeps it when the drawing changes', () => {
    const { store, get, windowRow } = setup(window(top, { ...columns, mid_height: 1.85 }));
    const midColumn = 12;
    expect(windowRow()[midColumn]).toBe('1.85');
    store.getState().updateElement('w', { height: 1.4 } as Partial<Element>);
    expect(get().mid_height).toBe(2.05);
    expect(windowRow()[midColumn]).toBe('2.05');
  });

  it('exports a window without the key exactly as before: the centre', () => {
    const { windowRow } = setup(window(undefined));
    expect(windowRow()[12]).toBe('1.4');
  });
});
