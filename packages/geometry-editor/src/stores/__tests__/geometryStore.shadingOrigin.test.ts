// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGeometryStore } from '../geometryStore';
import type { ContextShading } from '../../geometry/types';

const square = (cx: number, cy: number, half: number) => [
  { x: cx - half, y: cy - half, z: 0 }, { x: cx + half, y: cy - half, z: 0 },
  { x: cx + half, y: cy + half, z: 0 }, { x: cx - half, y: cy + half, z: 0 },
];

/** A loaded model: a 4 m square floor centred on (2, 2) and shadings 10 m north and east of it. */
function loadedStore() {
  const builder = createGeometryStore({ defaultDefaultsPath: null });
  builder.getState().addZone({ name: 'Living', floorArea: 16, height: 2.4, volume: 38.4 });
  const zoneId = builder.getState().zones[0]!.id;
  const shading = (name: string, cx: number, cy: number) => ({
    type: 'ContextShading' as const, name, zoneId, parent_element: 'Ground', shading_type: 'obstacle',
    height: 5, coordinates: square(cx, cy, 0.5),
  });
  builder.getState().addElements([
    { type: 'BuildingElementGround', name: 'Ground', zoneId, parent_element: null, pitch: 180, coordinates: square(2, 2, 2) },
    shading('North', 2, 12),
    shading('East', 12, 2),
  ] as never);
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(builder.getState().generateCSV({ allowUnresolvedMigration: true }));
  return store;
}

type Store = ReturnType<typeof loadedStore>;
const shadingNamed = (store: Store, name: string) =>
  Object.values(store.getState().elementsById).find((element) => element.name === name) as ContextShading;
const derived = (store: Store) => ['North', 'East'].map((name) => {
  const { start_angle, end_angle, distance } = shadingNamed(store, name);
  return { start_angle, end_angle, distance };
});

describe('model shading origin', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('re-derives every shading from the new origin as one undo step, and null returns to the floor centroid', () => {
    const store = loadedStore();
    expect(store.getState().shadingOrigin).toBeNull();
    const centroidValues = derived(store);
    expect(centroidValues).toEqual([
      { start_angle: 356.99, end_angle: 3.01, distance: 10 },
      { start_angle: 86.99, end_angle: 93.01, distance: 10 },
    ]);

    store.getState().setShadingOrigin({ x: 2, y: 2 - 10 });
    expect(derived(store)).toEqual([
      { start_angle: 358.53, end_angle: 1.47, distance: 20 },
      { start_angle: 42.14, end_angle: 47.86, distance: 14.14 },
    ]);

    store.getState().undo();
    expect(store.getState().shadingOrigin).toBeNull();
    expect(derived(store)).toEqual(centroidValues);

    store.getState().redo();
    expect(store.getState().shadingOrigin).toEqual({ x: 2, y: -8 });

    store.getState().setShadingOrigin({ x: 2.123456, y: -8.004 });
    expect(store.getState().shadingOrigin).toEqual({ x: 2.12, y: -8 });

    store.getState().setShadingOrigin(null);
    expect(store.getState().shadingOrigin).toBeNull();
    expect(derived(store)).toEqual(centroidValues);
  });

  it('saves the origin as two Metadata rows only when set, and loads it back', () => {
    const store = loadedStore();
    expect(store.getState().generateCSV({ allowUnresolvedMigration: true })).not.toMatch(/ShadingOrigin/);
    store.getState().setShadingOrigin({ x: 1.5, y: -3.25 });
    const csv = store.getState().generateCSV({ allowUnresolvedMigration: true });
    expect(csv).toMatch(/^ShadingOriginX,1.5,/m);
    expect(csv).toMatch(/^ShadingOriginY,-3.25,/m);

    const reloaded = createGeometryStore({ defaultDefaultsPath: null });
    reloaded.getState().loadFromCSV(csv);
    expect(reloaded.getState().shadingOrigin).toEqual({ x: 1.5, y: -3.25 });
    expect(derived(reloaded)).toEqual(derived(store));

    // New Document forgets it.
    reloaded.getState().clearAll();
    expect(reloaded.getState().shadingOrigin).toBeNull();
  });
});
