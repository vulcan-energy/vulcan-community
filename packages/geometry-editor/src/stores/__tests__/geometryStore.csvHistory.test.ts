// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGeometryStore } from '../geometryStore';
import { GEOMETRY_DIRTY_RECHECK_DEBOUNCE_MS, HISTORY_CAPTURE_QUIET_MS } from '../geometryStore/slices/historySlice';

type Store = ReturnType<typeof createGeometryStore>;

/** A loaded two-zone document: history holds exactly the loaded entry. */
function loadedStore(options: { twins?: boolean } = {}): Store {
  const builder = createGeometryStore({ defaultDefaultsPath: null });
  const { addZone, addElements } = builder.getState();
  addZone({ name: 'Living', floorArea: 20, height: 2.4, volume: 48 });
  addZone({ name: 'Annex', floorArea: 10, height: 2.4, volume: 24 });
  const [living, annex] = builder.getState().zones;
  const wall = (name: string, zoneId: string, x: number) => ({
    type: 'BuildingElementOpaque' as const, name, zoneId, height: 2.4, width: 4, area: 9.6,
    pitch: 90, base_height: 0, parent_element: null,
    coordinates: [{ x, y: 0, z: 0 }, { x: x + 4, y: 0, z: 0 }],
  });
  addElements([wall('Living wall', living!.id, 0), wall('Annex wall', annex!.id, 10)] as never);
  if (options.twins) {
    addElements([wall('Twin', living!.id, 20)] as never);
    addElements([wall('Twin', annex!.id, 30)] as never);
  }
  builder.getState().addSpaceLabel({ zoneId: annex!.id, name: 'Store', room_type: 'other' });

  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(builder.getState().generateCSV({ allowUnresolvedMigration: true }));
  return store;
}

const settle = () => vi.advanceTimersByTime(HISTORY_CAPTURE_QUIET_MS);
const idOf = (store: Store, name: string) =>
  store.getState().elementIds.find((id) => store.getState().elementsById[id]?.name === name)!;

describe('CSV document history', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('seeds exactly one entry on load and on New Document', () => {
    const store = loadedStore();
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().history[0]!.csv).toBe(store.getState().lastSavedCsv);
    settle();
    expect(store.getState().history).toHaveLength(1);
    store.getState().clearAll();
    settle();
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().canUndo).toBe(false);
  });

  it('captures every saved change automatically and restores it on undo and redo', () => {
    const store = loadedStore();
    const steps: Array<[string, () => void, () => unknown]> = [
      ['compliance', () => store.getState().setComplianceSettings({ ColdWaterSource: 'header tank' }),
        () => store.getState().complianceSettings.ColdWaterSource],
      ['target bundle', () => store.getState().setTargetBundleId('hem-test-bundle'),
        () => store.getState().targetBundleId],
      ['defaults path', () => store.getState().setDefaultsPath('resources/other_defaults.json'),
        () => store.getState().defaultsPath],
      ['guide overlay', () => store.getState().setGuideOverlay({ path: 'overlays/plan.png', opacity01: 0.5, pos_m: { x: 1, y: 2 } }),
        () => store.getState().guideOverlayByFloor],
    ];
    for (const [label, change, read] of steps) {
      const before = read();
      change();
      settle();
      const after = read();
      expect(after, label).not.toEqual(before);
      store.getState().undo();
      expect(read(), label).toEqual(before);
      store.getState().redo();
      expect(read(), label).toEqual(after);
    }
    expect(store.getState().history).toHaveLength(steps.length + 1);
  });

  it('restores the orientation offset and the element orientations it rewrote together', () => {
    const store = loadedStore();
    const wallId = idOf(store, 'Living wall');
    const orientation = store.getState().elementsById[wallId]!.orientation360;
    store.getState().setGlobalOrientationOffset(30);
    settle();
    expect(store.getState().elementsById[wallId]!.orientation360).not.toBe(orientation);
    store.getState().undo();
    expect(store.getState().globalOrientationOffset).toBe(0);
    expect(store.getState().elementsById[wallId]!.orientation360).toBe(orientation);
  });

  it('brings back a deleted zone with its elements and space labels', () => {
    const store = loadedStore();
    const annex = store.getState().zones.find((zone) => zone.name === 'Annex')!;
    store.getState().removeZone(annex.id);
    settle();
    expect(store.getState().zones.map((zone) => zone.name)).toEqual(['Living']);
    store.getState().undo();
    expect(store.getState().zones.find((zone) => zone.name === 'Annex')?.id).toBe(annex.id);
    expect(store.getState().elementsById[idOf(store, 'Annex wall')]?.zoneId).toBe(annex.id);
    expect(Object.values(store.getState().spaceLabelsById).map((label) => [label.name, label.zoneId]))
      .toEqual([['Store', annex.id]]);
  });

  it('pushes nothing for a change that leaves the saved text identical', () => {
    const store = loadedStore();
    store.getState().setSpaceLabelsOverlayExpanded(true);
    settle();
    store.getState().saveToHistory('no-op');
    expect(store.getState().history).toHaveLength(1);
  });

  it('keeps the newest 50 entries', () => {
    const store = loadedStore();
    for (let bedrooms = 1; bedrooms <= 55; bedrooms += 1) {
      store.getState().setComplianceSettings({ NumberOfBedrooms: bedrooms });
      store.getState().saveToHistory(`bedrooms-${bedrooms}`);
    }
    const { history } = store.getState();
    expect(history).toHaveLength(50);
    expect(history[0]!.label).toBe('bedrooms-6');
    expect(history.at(-1)!.label).toBe('bedrooms-55');
  });

  it('keeps a surviving selection, drops a vanished one, and leaves view and baseline alone', () => {
    const store = loadedStore();
    const wallId = idOf(store, 'Living wall');
    const { canvasViewResetKey, lastSavedCsv } = store.getState();
    const coldWater = store.getState().complianceSettings.ColdWaterSource;
    store.getState().setComplianceSettings({ ColdWaterSource: 'header tank' });
    store.getState().addElement({
      type: 'BuildingElementOpaque', name: 'New wall', zoneId: store.getState().zones[0]!.id,
      height: 2.4, width: 2, area: 4.8, pitch: 90, base_height: 0, parent_element: null,
      coordinates: [{ x: 0, y: 5, z: 0 }, { x: 2, y: 5, z: 0 }],
    } as never);
    settle();
    const newId = idOf(store, 'New wall');
    store.getState().setSelectedElementIds([wallId, newId]);
    store.getState().setSelection({ type: 'element', id: newId });

    store.getState().undo();
    expect(store.getState().complianceSettings.ColdWaterSource).toBe(coldWater);
    expect(store.getState().selectedElementIds).toEqual([wallId]);
    expect(store.getState().selection).toBeNull();
    expect(store.getState().canvasViewResetKey).toBe(canvasViewResetKey);
    expect(store.getState().lastSavedCsv).toBe(lastSavedCsv);

    store.getState().redo();
    expect(store.getState().getDocumentCsv()).not.toBe(lastSavedCsv);
    store.getState().undo();
    // Undo to the loaded entry reproduces the saved text; dirtiness is the text comparison.
    expect(store.getState().getDocumentCsv()).toBe(lastSavedCsv);
  });

  it('captures an edit still inside the debounce window before undoing', () => {
    const store = loadedStore();
    const coldWater = store.getState().complianceSettings.ColdWaterSource;
    store.getState().setComplianceSettings({ ColdWaterSource: 'header tank' });
    store.getState().undo();
    expect(store.getState().complianceSettings.ColdWaterSource).toBe(coldWater);
    store.getState().redo();
    expect(store.getState().complianceSettings.ColdWaterSource).toBe('header tank');
  });

  it('keeps the ids of same-named elements in different zones', () => {
    const store = loadedStore({ twins: true });
    const twinIdIn = (zoneName: string) => {
      const zoneId = store.getState().zones.find((zone) => zone.name === zoneName)!.id;
      return store.getState().elementIds.find((id) => {
        const element = store.getState().elementsById[id]!;
        return element.name === 'Twin' && element.zoneId === zoneId;
      });
    };
    const before = [twinIdIn('Living'), twinIdIn('Annex')];
    expect(before.every(Boolean) && before[0] !== before[1]).toBe(true);
    store.getState().setComplianceSettings({ ColdWaterSource: 'header tank' });
    settle();
    store.getState().undo();
    expect([twinIdIn('Living'), twinIdIn('Annex')]).toEqual(before);
  });

  it('keeps an empty floor across an unrelated undo and brings it back on redo', () => {
    const store = loadedStore();
    const loftId = store.getState().addFloor('Loft', 2.4, false, 4);
    settle();
    store.getState().setComplianceSettings({ ColdWaterSource: 'header tank' });
    settle();
    store.getState().undo();
    expect(store.getState().floors.find((floor) => floor.zIndex === 4)?.id).toBe(loftId);

    store.getState().removeFloor(loftId);
    settle();
    expect(store.getState().floors.some((floor) => floor.zIndex === 4)).toBe(false);
    store.getState().redo();
    expect(store.getState().complianceSettings.ColdWaterSource).toBe('header tank');
    expect(store.getState().floors.find((floor) => floor.zIndex === 4)?.id).toBe(loftId);
  });

  it('turns keystrokes inside the quiet window into one step', () => {
    const store = loadedStore();
    for (const value of ['1', '11', '110']) {
      store.getState().setComplianceSettings({ ColdWaterSource: value });
      // Longer than the dirty debounce, shorter than the capture window: one step, not three.
      vi.advanceTimersByTime(GEOMETRY_DIRTY_RECHECK_DEBOUNCE_MS + 50);
    }
    settle();
    expect(store.getState().history).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().complianceSettings.ColdWaterSource).not.toBe('11');
  });

  it('does not leave currentFloorId dangling after undoing a new document\'s first wall', () => {
    const store = createGeometryStore();
    store.getState().clearAll();
    settle();
    store.getState().addZone({ name: 'Living', floorArea: 25, height: 2.4, volume: 60 });
    const zoneId = store.getState().zones[0].id;
    store.getState().addElements([{
      zoneId, name: 'wall1', type: 'BuildingElementOpaque', width: 5, height: 2.4, area: 12,
      pitch: 90, orientation360: 180, base_height: 0, parent_element: null,
    }] as Parameters<ReturnType<typeof store.getState>['addElements']>[0]);
    settle();
    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    const { currentFloorId, floors } = store.getState();
    expect(currentFloorId === null || floors.some((floor) => floor.id === currentFloorId)).toBe(true);
  });

  it('keeps the space labeller selection across undo', () => {
    const store = loadedStore();
    const labelId = store.getState().spaceLabelIds[0]!;
    store.getState().setSpaceLabellerSelectedLabelId(labelId);
    store.getState().setComplianceSettings({ ColdWaterSource: 'header tank' });
    settle();
    store.getState().undo();
    expect(store.getState().spaceLabelIds).toEqual([labelId]);
    expect(store.getState().spaceLabellerSelectedLabelId).toBe(labelId);
  });

  it('keeps thermal-bridge host links on reused ids across undo and redo', () => {
    const builder = createGeometryStore({ defaultDefaultsPath: null });
    builder.getState().addZone({ name: 'Living', floorArea: 20, height: 2.4, volume: 48 });
    const zoneId = builder.getState().zones[0]!.id;
    builder.getState().addElements([{
      type: 'BuildingElementOpaque', name: 'Host wall', zoneId, height: 2.4, width: 4, area: 9.6,
      pitch: 90, base_height: 0, parent_element: null,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
    }] as never);
    const builderWallId = builder.getState().elementIds[0]!;
    builder.getState().addElements([{
      type: 'ThermalBridgeLinear', name: 'Host junction', zoneId, length: 4,
      linear_thermal_transmittance: 0.1, parent_element: null,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      extra_json: { junction_type: 'E2', thermal_bridge_source: { host_wall_id: builderWallId } },
    }] as never);
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().loadFromCSV(builder.getState().generateCSV({ allowUnresolvedMigration: true }));
    const wallId = idOf(store, 'Host wall');
    const hostOf = () => {
      const bridge = store.getState().elementsById[idOf(store, 'Host junction')]!;
      return (bridge.extra_json?.thermal_bridge_source as { host_wall_id?: string } | undefined)?.host_wall_id;
    };
    expect(hostOf()).toBe(wallId);

    store.getState().setComplianceSettings({ ColdWaterSource: 'header tank' });
    settle();
    store.getState().undo();
    expect(idOf(store, 'Host wall')).toBe(wallId);
    expect(hostOf()).toBe(wallId);
    // Back at the loaded entry: the document is clean against its saved baseline.
    expect(store.getState().getDocumentCsv()).toBe(store.getState().lastSavedCsv);

    store.getState().redo();
    expect(idOf(store, 'Host wall')).toBe(wallId);
    expect(hostOf()).toBe(wallId);
    store.getState().undo();
    expect(hostOf()).toBe(wallId);
    expect(store.getState().getDocumentCsv()).toBe(store.getState().lastSavedCsv);
  });
});
