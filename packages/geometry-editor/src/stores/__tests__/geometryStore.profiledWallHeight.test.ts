// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { createGeometryStore } from '../geometryStore';
import type { Element } from '../../geometry/types';

// A shaped wall's height is derived from its face (its average height), so a plain height edit
// (bulk edit, table) must go through the face.
describe('height edits on a shaped wall', () => {
  const setup = (topProfile: Array<{ t: number; h: number }>) => {
    const store = createGeometryStore();
    store.getState().addZone({ name: 'Living', floorArea: 25, height: 2.4, volume: 60 });
    const zoneId = store.getState().zones[0].id;
    const face = {
      kind: 'profiled-line-face',
      top_profile: topProfile,
      bottom_profile: [{ t: 0, h: 0 }, { t: 0.5, h: 1 }, { t: 1, h: 0 }],
    };
    store.getState().addElements([{
      zoneId,
      name: 'Shaped wall',
      type: 'BuildingElementOpaque',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      width: 4,
      height: 2.5,
      area: 10,
      pitch: 90,
      orientation360: 180,
      base_height: 0,
      parent_element: null,
      extra_json: { geometry_face: face },
    }] as Parameters<ReturnType<typeof store.getState>['addElements']>[0]);
    const id = store.getState().elementIds.at(-1)!;
    const wall = () => store.getState().elementsById[id] as Element & { height: number; area: number; base_height: number };
    return { store, id, wall, face };
  };

  it('moves a Flat top to the new height and re-derives the height and area from the face', () => {
    const { store, id, wall } = setup([{ t: 0, h: 3 }, { t: 1, h: 3 }]);
    store.getState().updateElementsBulk({ [id]: { height: 4 } as Partial<Element> });
    expect((wall().extra_json?.geometry_face as { top_profile: unknown }).top_profile).toEqual([{ t: 0, h: 4 }, { t: 1, h: 4 }]);
    // Average of top 4 minus the bottom's 0 → 1 → 0 ridge (average 0.5).
    expect(wall().height).toBe(3.5);
    expect(wall().area).toBe(14);
  });

  it('keeps a Custom top and its derived height', () => {
    const top = [{ t: 0, h: 3 }, { t: 0.5, h: 4 }, { t: 1, h: 3 }];
    const { store, id, wall, face } = setup(top);
    const before = wall().height;
    store.getState().updateElementsBulk({ [id]: { height: 6 } as Partial<Element> });
    expect(wall().extra_json?.geometry_face).toEqual(face);
    expect(wall().height).toBe(before);
  });

  it('moves the whole face with the foot', () => {
    const { store, id, wall, face } = setup([{ t: 0, h: 3 }, { t: 1, h: 3 }]);
    store.getState().updateElementsBulk({ [id]: { base_height: 2.5 } as Partial<Element> });
    expect(wall().base_height).toBe(2.5);
    expect(wall().extra_json?.geometry_face).toEqual(face);
  });
});
