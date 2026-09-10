// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGeometryStore } from '../../stores/geometryStore';

function seedWindow(hosted: boolean, securityRisk?: boolean) {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const { addFloor, addZone, addElement } = store.getState();
  addFloor('Ground', 2.4);
  addFloor('First', 2.4);
  addZone({ name: 'Zone', floorArea: 20, height: 2.4, volume: 48 });
  const zoneId = store.getState().zones[0].id;
  addElement({
    type: 'BuildingElementOpaque', name: 'Wall', zoneId, height: 2.4,
    width: 4, area: 9.6, pitch: 90, base_height: 0, parent_element: null,
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
  });
  const wallId = store.getState().elementIds.at(-1)!;
  addElement({
    type: 'BuildingElementTransparent', name: 'Window', zoneId, height: 1.2,
    width: 1, area: 1.2, pitch: 90, base_height: 0.8,
    parent_element: hosted ? store.getState().elementsById[wallId].name : null,
    coordinates: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
    extra_json: securityRisk === undefined ? {} : { security_risk: securityRisk },
  });
  return { store, wallId, windowId: store.getState().elementIds.at(-1)! };
}

function seedSparseIntermediateFloorStack() {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const { addFloor, addZone, addElement } = store.getState();
  addFloor('Ground', 2.4, false, 0);
  addFloor('Second', 2.4, false, 2);
  addZone({ name: 'Zone', floorArea: 20, height: 3, volume: 60 });
  const zoneId = store.getState().zones[0].id;
  addElement({
    type: 'BuildingElementOpaque', name: 'Moving wall', zoneId, height: 3,
    width: 4, area: 12, pitch: 90, base_height: 0, parent_element: null,
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
  });
  const movingWallId = store.getState().elementIds.at(-1)!;
  addElement({
    type: 'BuildingElementOpaque', name: 'Higher wall', zoneId, height: 2.4,
    width: 4, area: 9.6, pitch: 90, base_height: 3, parent_element: null,
    coordinates: [{ x: 0, y: 1, z: 2 }, { x: 4, y: 1, z: 2 }],
  });
  const higherWallId = store.getState().elementIds.at(-1)!;
  return { store, movingWallId, higherWallId };
}

describe('floor mutation invariants', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([false, true])('refreshes automatic window security risk when moving floors (hosted: %s)', (hosted) => {
    const { store, wallId, windowId } = seedWindow(hosted);
    expect(store.getState().elementsById[windowId].extra_json?.security_risk).toBe(true);
    store.getState().updateElementsFloor([hosted ? wallId : windowId], 1);
    expect(store.getState().elementsById[windowId].coordinates[0].z).toBe(1);
    expect(store.getState().elementsById[windowId].extra_json?.security_risk).toBe(false);
  });

  it.each([false, true])('preserves a manual window security-risk override (hosted: %s)', (hosted) => {
    const { store, wallId, windowId } = seedWindow(hosted, false);
    store.getState().updateElementsFloor([hosted ? wallId : windowId], 1);
    expect(store.getState().elementsById[windowId].coordinates[0].z).toBe(1);
    expect(store.getState().elementsById[windowId].extra_json?.security_risk).toBe(false);
  });

  it('cascades changes to wall-derived storey heights after a floor move', () => {
    const { store, wallId, windowId } = seedWindow(false);
    store.setState({ floors: store.getState().floors.map((floor) => ({ ...floor, height: 0 })) });
    const window = store.getState().elementsById[windowId];
    store.getState().updateElement(windowId, {
      coordinates: window.coordinates.map((point) => ({ ...point, z: 1 })),
    });
    expect(store.getState().elementsById[windowId]).toMatchObject({ base_height: 3.2 });

    store.getState().updateElementsFloor([wallId], 1);

    expect(store.getState().elementsById[wallId]).toMatchObject({ base_height: 0 });
    expect(store.getState().elementsById[windowId]).toMatchObject({ base_height: 0.8 });
  });

  it.each(['parent-first', 'child-first', 'duplicate-parent'])('moves a host and selected child once (%s)', (order) => {
    const { store, wallId, windowId } = seedWindow(true);
    const previousVersion = store.getState().elementsById[wallId]._v ?? 0;
    const ids = order === 'parent-first' ? [wallId, windowId]
      : order === 'child-first' ? [windowId, wallId] : [wallId, windowId, wallId];
    store.getState().updateElementsFloor(ids, 1);
    expect(store.getState().elementsById[wallId]._v).toBe(previousVersion + 1);
    const moved = store.getState().elementsById[windowId];
    expect(moved.coordinates).toEqual([{ x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }]);
    expect(moved.extra_json?.security_risk).toBe(false);
  });

  it('undoes and redoes a new floor and its element values together', () => {
    const { store, windowId } = seedWindow(false);
    vi.advanceTimersByTime(300);
    store.getState().saveToHistory('before-floor-move');
    store.getState().updateElementsFloor([windowId], 2);
    vi.advanceTimersByTime(300);
    expect(store.getState().floors.some((floor) => floor.zIndex === 2)).toBe(true);
    expect(store.getState().elementsById[windowId].extra_json?.security_risk).toBe(false);

    store.getState().undo();
    expect(store.getState().floors.some((floor) => floor.zIndex === 2)).toBe(false);
    expect(store.getState().elementsById[windowId].coordinates[0].z).toBe(0);
    expect(store.getState().elementsById[windowId].extra_json?.security_risk).toBe(true);

    store.getState().redo();
    expect(store.getState().floors.some((floor) => floor.zIndex === 2)).toBe(true);
    expect(store.getState().elementsById[windowId].coordinates[0].z).toBe(2);
    expect(store.getState().elementsById[windowId].extra_json?.security_risk).toBe(false);
  });

  it.each([['individual', 1], ['bulk', 1], ['individual', -1], ['bulk', -1]] as const)(
    'moves hosted window elevations with the wall (%s to floor %s)', (mode, targetZ) => {
      const { store, wallId, windowId } = seedWindow(true);
      const window = store.getState().elementsById[windowId];
      store.getState().updateElement(windowId, {
        mid_height: 1.4,
        extra_json: { ...window.extra_json, window_part_list: [{ mid_height_air_flow_path: 1.3 }] },
      });
      if (mode === 'bulk') {
        store.getState().updateElementsFloor([wallId], targetZ);
      } else {
        store.getState().updateElement(wallId, {
          coordinates: store.getState().elementsById[wallId].coordinates.map((point) => ({ ...point, z: targetZ })),
        });
      }
      expect(store.getState().elementsById[windowId]).toMatchObject({
        floorId: store.getState().floors.find((floor) => floor.zIndex === targetZ)!.id,
        base_height: targetZ === 1 ? 3.2 : -1.6,
        mid_height: targetZ === 1 ? 3.8 : -1,
        extra_json: { security_risk: false, window_part_list: [{ mid_height_air_flow_path: targetZ === 1 ? 3.7 : -1.1 }] },
      });
  });

  it.each(['individual', 'bulk'])('cascades a newly created intermediate floor through the stack (%s)', (mode) => {
    const { store, movingWallId, higherWallId } = seedSparseIntermediateFloorStack();
    if (mode === 'bulk') {
      store.getState().updateElementsFloor([movingWallId], 1);
    } else {
      store.getState().updateElement(movingWallId, {
        coordinates: store.getState().elementsById[movingWallId].coordinates.map((point) => ({ ...point, z: 1 })),
      });
    }

    expect(store.getState().elementsById[movingWallId]).toMatchObject({
      floorId: store.getState().floors.find((floor) => floor.zIndex === 1)!.id,
      base_height: 2.4,
    });
    expect(store.getState().elementsById[higherWallId]).toMatchObject({ base_height: 5.4 });
  });
});
