// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { buildHostedLinearParentPatch, compassPoint, openingTooWide, wallUnderOpening } from '../parentOrientation';
import { createGeometryStore } from '../../stores/geometryStore';
import { unavailableGeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';

const wall = (name: string, coords: Array<[number, number]>, z = 0, over: Record<string, unknown> = {}) => ({
  id: name, name, type: 'BuildingElementOpaque', zoneId: 'z', pitch: 90,
  coordinates: coords.map(([x, y]) => ({ x, y, z })), ...over,
}) as unknown as Element;
const win = (coords: Array<[number, number]>, width: number, z = 0) => ({
  id: 'w', name: 'Window', type: 'BuildingElementTransparent', zoneId: 'z', width, height: 1.2, pitch: 90, parent_element: null,
  coordinates: coords.map(([x, y]) => ({ x, y, z })),
}) as unknown as Element;

describe('moving a window to another wall', () => {
  it('keeps its place along the line, slid inside the new wall, and takes its pitch', () => {
    const north = wall('Wall (N)', [[0, 5], [3, 5]]);
    const patch = buildHostedLinearParentPatch(win([[2.5, 0], [3.5, 0]], 1), north, 'Wall (N)', '', 0);
    expect(patch.coordinates).toEqual([{ x: 2, y: 5, z: 0 }, { x: 3, y: 5, z: 0 }]);
    expect((patch as { pitch?: number }).pitch).toBe(90);
  });

  it('a window wider than the wall is not resized, and says so', () => {
    const short = wall('Wall (E)', [[0, 0], [1.5, 0]]);
    const wide = win([[0, 0], [2, 0]], 2);
    expect(buildHostedLinearParentPatch(wide, short, 'Wall (E)', '', 0).coordinates).toHaveLength(2);
    expect(openingTooWide(wide, short)).toBe('2.00 m window on a 1.50 m wall');
    expect(openingTooWide(win([[0, 0], [1, 0]], 1), short)).toBeUndefined();
  });
});

describe('wallUnderOpening', () => {
  it('finds the wall a detached window lies on, on its storey only', () => {
    const lower = wall('Wall (S)', [[0, 0], [4, 0]], 0);
    const upper = wall('Wall (S) 1', [[0, 0], [4, 0]], 1);
    const door = wall('Door', [[0, 0], [4, 0]], 1, { is_external_door: true });
    expect(wallUnderOpening(win([[1, 0], [2, 0]], 1, 1), [door, lower, upper])?.name).toBe('Wall (S) 1');
    expect(wallUnderOpening(win([[1, 1], [2, 1]], 1, 0), [lower])).toBeUndefined();
  });
});

it('names the compass point a window faces', () => {
  expect([0, 44, 90, 180, 225, 359].map(compassPoint)).toEqual(['N', 'NE', 'E', 'S', 'SW', 'N']);
});

it('deleting a wall detaches its window and remembers the wall until the next save', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: unavailableGeometrySchemaPort });
  const south = wall('Wall (S)', [[0, 0], [4, 0]]);
  const hosted = { ...win([[1, 0], [2, 0]], 1), parent_element: 'Wall (S)' } as Element;
  store.setState({ elementsById: { [south.id]: south, w: hosted }, elementIds: [south.id, 'w'] });
  store.getState().removeElement(south.id);
  expect(store.getState().elementsById.w?.parent_element).toBeNull();
  expect(store.getState().detachedOpenings).toEqual({ w: 'Wall (S)' });
  store.getState().setLastSavedCsv('saved');
  expect(store.getState().detachedOpenings).toEqual({});
});

it('the read-only Area line shows only when the outline is not a plain rectangle', async () => {
  const { areaRepeatsSize } = await import('../profileLineFace');
  const plain = win([[0, 0], [1, 0]], 1);
  expect(areaRepeatsSize(plain, 'line')).toBe(true);
  expect(areaRepeatsSize(plain, 'polygon')).toBe(false);
  expect(areaRepeatsSize(plain, 'sloped-polygon')).toBe(false);
  const shaped = { ...plain, extra_json: { geometry_face: { kind: 'profiled-line-face', top_profile: [{ t: 0, h: 1 }, { t: 1, h: 2 }], bottom_profile: [{ t: 0, h: 0 }, { t: 1, h: 0 }] } } } as Element;
  expect(areaRepeatsSize(shaped, 'line')).toBe(false);
});
