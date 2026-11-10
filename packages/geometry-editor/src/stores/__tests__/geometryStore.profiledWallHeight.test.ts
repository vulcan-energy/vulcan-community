// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { createGeometryStore } from '../geometryStore';
import type { Element } from '../../geometry/types';

// A shaped wall's height is derived from its face, so a plain height edit is refused.
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

  it('refuses a plain height edit, even on a Flat top', () => {
    for (const top of [[{ t: 0, h: 3 }, { t: 1, h: 3 }], [{ t: 0, h: 3 }, { t: 0.5, h: 4 }, { t: 1, h: 3 }]]) {
      const { store, id } = setup(top);
      expect(() => store.getState().updateElementsBulk({ [id]: { height: 6 } as Partial<Element> }))
        .toThrow('"Shaped wall" has a shaped edge; change its height in the wall shape.');
    }
  });

  it('moves the whole face with the foot', () => {
    const { store, id, wall, face } = setup([{ t: 0, h: 3 }, { t: 1, h: 3 }]);
    store.getState().updateElementsBulk({ [id]: { base_height: 2.5 } as Partial<Element> });
    expect(wall().base_height).toBe(2.5);
    expect(wall().extra_json?.geometry_face).toEqual(face);
  });
});
