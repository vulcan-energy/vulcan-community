// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { unavailableGeometrySchemaPort } from '../../../../../geometry-editor-host/src/schemaPort';
import type { BuildingElementOpaque, BuildingElementTransparent, Element, Floor } from '../../types';
import { validateElementCore } from '../validateElement';
import { deriveWallEdgeFromRoofs } from '../../../lib/wallEdgeFromRoofs';

const floors: Floor[] = [{ id: 'f0', name: 'Ground', zIndex: 0, height: 5, isRoofSpace: false }];

const validate = (element: Element, elements: Element[]) => validateElementCore(element, {
  schemaPort: unavailableGeometrySchemaPort,
  elementsById: Object.fromEntries(elements.map((e) => [e.id, e])),
  floors,
  globalOrientationOffset: 0,
});
const messages = (items: Array<{ message: string }>) => items.map((i) => i.message);

// A gable 6 m long: 2 m at its ends, 5 m at its middle.
const gable = {
  id: 'gable',
  name: 'Gable wall',
  zoneId: 'z',
  type: 'BuildingElementOpaque',
  pitch: 90,
  width: 6,
  height: 3.5,
  area: 21,
  base_height: 0,
  parent_element: null,
  coordinates: [{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }],
  extra_json: {
    geometry_face: {
      kind: 'profiled-line-face',
      top_profile: [{ t: 0, h: 2 }, { t: 0.5, h: 5 }, { t: 1, h: 2 }],
      bottom_profile: [{ t: 0, h: 0 }, { t: 1, h: 0 }],
    },
  },
} as BuildingElementOpaque;

const gableWindow = (x0: number, x1: number, base: number): BuildingElementTransparent => ({
  id: 'win',
  name: 'Gable window',
  zoneId: 'z',
  type: 'BuildingElementTransparent',
  pitch: 90,
  width: x1 - x0,
  height: 1,
  base_height: base,
  frame_area_fraction: 0.25,
  parent_element: 'Gable wall',
  coordinates: [{ x: x0, y: 0, z: 0 }, { x: x1, y: 0, z: 0 }],
} as BuildingElementTransparent);

describe('openings on a shaped wall', () => {
  it('names an opening that pokes out of the wall shape', () => {
    // At x = 1 the gable is 3 m tall; a window from 2.5 m to 3.5 m sticks out of it.
    const win = gableWindow(1, 2, 2.5);
    expect(messages(validate(win, [gable, win]).issues))
      .toContain('Gable window (BuildingElementTransparent): Opening is not inside the shape of wall "Gable wall". Move it or change its size so it fits the wall.');
  });

  it('accepts an opening inside the wall shape', () => {
    // Under the ridge the gable is 4–5 m tall.
    const win = gableWindow(2.5, 3.5, 2.5);
    expect(messages(validate(win, [gable, win]).issues).some((m) => m.includes('not inside the shape'))).toBe(false);
  });
});

describe('a wall edge fitted to a roof', () => {
  const roof = (pitch: number) => ({
    id: 'roof',
    name: 'Roof',
    zoneId: 'z',
    type: 'BuildingElementOpaque',
    pitch,
    base_height: 2,
    width: 0,
    height: 0,
    area: 0,
    parent_element: null,
    coordinates: [{ x: 0, y: -1, z: 0 }, { x: 6, y: -1, z: 0 }, { x: 6, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }],
  }) as BuildingElementOpaque;

  it('warns when the roof under it has changed since the fit', () => {
    const plain = { ...gable, extra_json: undefined };
    const top = [{ t: 0, h: 5 }, { t: 1, h: 5 }];
    const bottom = deriveWallEdgeFromRoofs(plain, [plain, roof(30)], floors, 0, 'bottom', top)!.profile;
    const onRoof = {
      ...plain,
      extra_json: { geometry_face: { kind: 'profiled-line-face', top_profile: top, bottom_profile: bottom, bottom_mode: 'roof' } },
    } as BuildingElementOpaque;
    const warning = 'Gable wall (BuildingElementOpaque): Roof changed; re-fit the wall shape';
    expect(messages(validate(onRoof, [onRoof, roof(30)]).warnings)).not.toContain(warning);
    expect(messages(validate(onRoof, [onRoof, roof(35)]).warnings)).toContain(warning);
  });
});

// Drawing errors: an opening off its host wall, and a roof past the walls.
const text = (items: Array<{ message: string }>) => items.map((i) => i.message).join('\n');
const wall = (id: string, a: [number, number], b: [number, number]) => ({
  id, name: id, zoneId: 'z', type: 'BuildingElementOpaque', pitch: 90, width: 5, height: 2.5, base_height: 0,
  coordinates: [{ x: a[0], y: a[1], z: 0 }, { x: b[0], y: b[1], z: 0 }],
}) as unknown as Element;
const boxWalls = [wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [5, 4]), wall('w3', [5, 4], [0, 4]), wall('w4', [0, 4], [0, 0])];
const offWindow = (y: number) => ({
  id: 'win', name: 'win', zoneId: 'z', type: 'BuildingElementTransparent', pitch: 90, width: 1, height: 1, base_height: 1,
  frame_area_fraction: 0.25, parent_element: 'w1',
  coordinates: [{ x: 1, y, z: 0 }, { x: 2, y, z: 0 }],
}) as unknown as Element;
const roof = (over: number) => ({
  id: 'roof', name: 'roof', zoneId: 'z', type: 'BuildingElementOpaque', pitch: 30, width: 5, height: 4, base_height: 2.5,
  coordinates: [{ x: -over, y: 0, z: 2.5 }, { x: 5, y: 0, z: 2.5 }, { x: 5, y: 4, z: 2.5 }, { x: -over, y: 4, z: 2.5 }],
}) as unknown as Element;

describe('drawing errors', () => {
  it('names an opening off its host wall', () => {
    const off = offWindow(0.5);
    expect(text(validate(off, [...boxWalls, off]).warnings)).toContain('Not on its host wall');
    const on = offWindow(0);
    expect(text(validate(on, [...boxWalls, on]).issues)).not.toContain('Not on its host wall');
  });

  it('warns on a roof drawn past the walls', () => {
    const past = roof(0.5);
    expect(text(validate(past, [...boxWalls, past]).warnings)).toContain('Draw the roof to the walls');
    const flush = roof(0);
    expect(text(validate(flush, [...boxWalls, flush]).warnings)).not.toContain('Draw the roof to the walls');
  });
});
