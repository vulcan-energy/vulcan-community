// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { createGeometryStore } from '../geometryStore';

describe('clearAll history boundary', () => {
  it('does not let Undo after New Document restore the previous model', () => {
    const store = createGeometryStore();
    store.getState().saveToHistory('test-baseline');
    store.getState().addZone({ name: 'Living', floorArea: 25, height: 2.4, volume: 60 });
    const zoneId = store.getState().zones[0].id;
    // addElements saves history synchronously (addElement defers it).
    store.getState().addElements([{
      zoneId,
      name: 'wall1',
      type: 'BuildingElementOpaque',
      width: 5,
      height: 2.4,
      area: 12,
      pitch: 90,
      orientation360: 180,
      base_height: 0,
      parent_element: null,
    }] as Parameters<ReturnType<typeof store.getState>['addElements']>[0]);
    expect(store.getState().canUndo).toBe(true);

    store.getState().clearAll();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);

    store.getState().undo();
    expect(store.getState().elementIds).toEqual([]);
    expect(store.getState().zones).toEqual([]);
  });
});
