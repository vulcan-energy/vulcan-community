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
    // The empty document is the only history entry: Undo has nowhere earlier to go.
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);
    expect(store.getState().defaultsLoading).toBe(false);

    store.getState().undo();
    expect(store.getState().elementIds).toEqual([]);
    expect(store.getState().zones).toEqual([]);
  });

  it('does not carry the previous model\'s compliance settings or orientation into the new one', () => {
    const store = createGeometryStore();
    store.getState().setComplianceSettings({ scenariosBaseModelEnabled: false, NumberOfBedrooms: 4 });
    store.getState().setGlobalOrientationOffset(30);
    store.getState().clearAll();
    expect(store.getState().complianceSettings.scenariosBaseModelEnabled).toBeUndefined();
    expect(store.getState().complianceSettings.NumberOfBedrooms).not.toBe(4);
    expect(store.getState().globalOrientationOffset).toBe(0);
  });
});
