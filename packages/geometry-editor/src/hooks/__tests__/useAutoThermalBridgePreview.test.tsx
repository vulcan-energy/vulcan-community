// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import { groupAutoDuctRuns, useAutoDuctPreview, useAutoThermalBridgePreview } from '../useAutoThermalBridgePreview';
import { planAutoDucts } from '../../lib/mvhrDuctwork';
import * as pipeline from '../../geometry/thermalBridge/autoThermalBridgePipeline';
import type { Element, MechanicalVentilation, SpaceLabel } from '../../geometry/types';
const visible: (element: Element) => boolean = () => false;
function setup() {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const floors = [0, 1].map((zIndex) => ({ id: `floor-${zIndex}`, zIndex, name: String(zIndex), height: 2.5, isRoofSpace: false }));
  const windows = [0, 1].map((z): Element => ({
    id: `window-${z}`, name: `Window ${z}`, type: 'BuildingElementTransparent', zoneId: 'zone',
    floorId: `floor-${z}`, parent_element: null, height: 1.2, width: 1, area: 1.2, pitch: 90,
    base_height: .8 + z * 2.5, coordinates: [{ x: 1, y: 0, z }, { x: 2, y: 0, z }],
  } as Element));
  store.setState({ floors, floorIds: floors.map((f) => f.id),
    zones: [{ id: 'zone', name: 'Zone', floorArea: 20, height: 2.5, volume: 50 }],
    elementsById: Object.fromEntries(windows.map((e) => [e.id, e])), elementIds: windows.map((e) => e.id) });
  store.getState().saveToHistory('seed');
  const wrapper = ({ children }: { children: ReactNode }) => <GeometryStoreProvider store={store}>{children}</GeometryStoreProvider>;
  const hook = renderHook(({ floor, hidden }) => useAutoThermalBridgePreview({
    enabled: true, blocked: false, viewMode: '2d', currentFloorZ: floor, isElementHidden: hidden,
  }), { wrapper, initialProps: { floor: 0, hidden: visible } });
  return { store, ...hook };
}
afterEach(() => vi.restoreAllMocks());
describe('auto thermal bridge canvas preview', () => {
  it('adds a multi-option default once, prevents duplicates and supports undo', () => {
    const { result, store } = setup();
    fireEvent.keyDown(document.body, { key: 'a' });
    const row = result.current.candidates.find((c) => c.edgeRole === 'lintel')!;
    expect(row.junctionOptions.length).toBeGreaterThan(1);
    act(() => result.current.onActivate([row.proposalId], { x: 10, y: 10 }));
    expect(result.current.menu).toBeNull();
    const bridges = () => Object.values(store.getState().elementsById).filter((e) => e.type === 'ThermalBridgeLinear');
    expect(bridges()).toHaveLength(1);
    expect(bridges()[0].extra_json?.junction_type).toBe('E1');
    act(() => result.current.add(row.proposalId));
    expect(bridges()).toHaveLength(1);
    act(() => store.getState().undo());
    expect(result.current.candidates.some((c) => c.proposalId === row.proposalId)).toBe(true);
  });
  it('pins physical overlap choices and adds with one row click after releasing A', () => {
    const { result, store } = setup();
    fireEvent.keyDown(document.body, { key: 'a' });
    const ids = result.current.candidates.slice(0, 2).map((r) => r.proposalId);
    act(() => result.current.onActivate(ids, { x: 10, y: 10 }));
    fireEvent.keyUp(document.body, { key: 'a' });
    expect(result.current.menu?.ids).toEqual(ids);
    act(() => result.current.add(ids[0]));
    expect(Object.values(store.getState().elementsById).filter((e) => e.type === 'ThermalBridgeLinear')).toHaveLength(1);
    expect(result.current.active).toBe(false);
  });
  it('counts other floors and closes stale choices on floor change while A remains held', () => {
    const { result, rerender } = setup();
    const ids = result.current.candidates.map((r) => r.proposalId);
    expect(result.current.otherFloorCount).toBeGreaterThan(0);
    fireEvent.keyDown(document.body, { key: 'a' });
    act(() => result.current.configure(ids[0], { x: 10, y: 10 }));
    rerender({ floor: 1, hidden: visible });
    expect(result.current.active).toBe(true);
    expect(result.current.menu).toBeNull();
    expect(result.current.candidates.every((r) => r.floorStoreyIndexForTb === 1 && !ids.includes(r.proposalId))).toBe(true);
  });
  it('does not infer again for hover, held keys or additions to existing floors', () => {
    const propose = vi.spyOn(pipeline, 'proposeAutoThermalBridges');
    const { result } = setup();
    const initial = propose.mock.calls.length;
    fireEvent.keyDown(document.body, { key: 'a' });
    const row = result.current.candidates[0];
    act(() => result.current.onHover([row.proposalId], { x: 10, y: 20 }));
    fireEvent.keyDown(document.body, { key: 'a', repeat: true });
    expect(propose).toHaveBeenCalledTimes(initial);
    act(() => result.current.add(row.proposalId));
    expect(propose).toHaveBeenCalledTimes(initial + 1); // The live commit recheck only.
  });
  it('respects hidden hosts and bridge-category filters', () => {
    const { result, rerender } = setup();
    rerender({ floor: 0, hidden: (e: Element) => e.type === 'ThermalBridgeLinear' });
    expect(result.current.candidates).toHaveLength(0);
    rerender({ floor: 0, hidden: (e: Element) => e.id === 'window-0' });
    expect(result.current.candidates).toHaveLength(0);
  });
});

describe('auto thermal bridge preview host visibility regressions', () => {
  it('keeps continuous-wall and corner candidates when their host is synthetic rather than an element id', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const floor = { id: 'floor-0', zIndex: 0, name: 'Ground', height: 2.5, isRoofSpace: false };
    const walls: Element[] = ['Wall A', 'Wall B'].map((name, index) => ({
      id: `wall-${index}`, name, type: 'BuildingElementOpaque', zoneId: 'zone', floorId: 'floor-0',
      parent_element: null, height: 2.5, area: 10, pitch: 90,
      coordinates: index === 0
        ? [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]
        : [{ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }],
    } as Element));
    store.setState({ floors: [floor], floorIds: [floor.id],
      zones: [{ id: 'zone', name: 'Zone', floorArea: 20, height: 2.5, volume: 50 }],
      elementsById: Object.fromEntries(walls.map((wall) => [wall.id, wall])), elementIds: walls.map((wall) => wall.id) });
    store.getState().saveToHistory('seed');
    vi.spyOn(pipeline, 'proposeAutoThermalBridges').mockReturnValue([
      {
        proposalId: 'wall-ground-continuous', openingId: 'wgcont:wall-0:0', openingName: 'Wall A',
        zoneId: 'zone', edgeRole: 'wall_ground_continuous', junctionCode: 'E5', suggestedLengthM: 2,
        linearThermalTransmittance: 0.5, reason: 'continuous wall-floor junction',
        coordinates: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }], parentElementForTb: 'Wall A',
      },
      {
        proposalId: 'external-corner', openingId: 'corner:vertex-a', openingName: 'Wall A',
        zoneId: 'zone', edgeRole: 'external_corner_convex', junctionCode: 'E16', suggestedLengthM: 2,
        linearThermalTransmittance: 0.5, reason: 'external corner',
        coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }], parentElementForTb: 'Wall A',
        cornerHostWallIds: ['wall-0', 'wall-1'],
      },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => <GeometryStoreProvider store={store}>{children}</GeometryStoreProvider>;
    const { result } = renderHook(() => useAutoThermalBridgePreview({
      enabled: true, blocked: false, viewMode: '2d', currentFloorZ: 0, isElementHidden: visible,
    }), { wrapper });
    expect(result.current.candidates.map((candidate) => candidate.proposalId)).toEqual([
      'wall-ground-continuous', 'external-corner',
    ]);
  });

  it('uses the current visibility predicate when counting suggestions on other floors', () => {
    const { result, rerender } = setup();
    expect(result.current.otherFloorCount).toBeGreaterThan(0);
    rerender({ floor: 0, hidden: (element: Element) => element.id === 'window-1' });
    expect(result.current.otherFloorCount).toBe(0);
  });
});

describe('auto duct canvas preview', () => {
  const floor = { id: 'f0', zIndex: 0, name: '0', height: 2.5, isRoofSpace: false };
  const unit = { id: 'mv', name: 'MV', type: 'MechanicalVentilation', vent_type: 'MVHR', parent_element: null,
    floorId: 'f0', zoneId: 'zone', coordinates: [{ x: 0, y: 0, z: 0 }] } as unknown as MechanicalVentilation;
  const hosts = [['Wall N', 'BuildingElementOpaque', -5, -2, 5, -2], ['Win E', 'BuildingElementTransparent', 7, -5, 7, 5]]
    .map(([name, type, ax, ay, bx, by]) => ({ id: name, name, type, zoneId: 'zone', floorId: 'f0', parent_element: null,
      height: 2.5, width: 1, area: 10, pitch: 90,
      coordinates: [{ x: ax, y: ay, z: 0 }, { x: bx, y: by, z: 0 }] }) as unknown as Element);
  const labels = [['kitchen', 4], ['bathroom', 8], ['living_room', -4]].map(([roomType, x]) => ({
    id: String(roomType), name: String(roomType), zoneId: 'zone', storey: 0, room_type: roomType,
    coordinates: [[0, 0], [2, 0], [2, 2], [0, 2]].map(([dx, dy]) => ({ x: Number(x) + dx, y: 2 + dy, z: 0 })),
  }) as SpaceLabel);

  it('groups the plan into one run per room and per terminal role, terminals with their duct', () => {
    const runs = groupAutoDuctRuns(planAutoDucts(unit, [unit, ...hosts], labels, [floor]), { x: 0, y: 0, z: 0 });
    expect(runs.map((run) => [run.role, run.drafts.map((d) => d.type === 'MechanicalVentilationTerminal' ? 'T' : 'D').join('')]))
      .toEqual([['extract', 'DD'], ['extract', 'DD'], ['supply', 'DD'], ['intake', 'DDT'], ['exhaust', 'DDT']]);
    expect(new Set(runs.map((run) => run.proposalId)).size).toBe(5);
  });

  it('adds a clicked run as one history step and the rest with Add all', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const elements = [unit, ...hosts];
    store.setState({ floors: [floor], floorIds: ['f0'],
      zones: [{ id: 'zone', name: 'Zone', floorArea: 20, height: 2.5, volume: 50 }],
      elementsById: Object.fromEntries(elements.map((e) => [e.id, e])), elementIds: elements.map((e) => e.id),
      spaceLabelsById: Object.fromEntries(labels.map((l) => [l.id, l])), spaceLabelIds: labels.map((l) => l.id) });
    store.getState().saveToHistory('seed');
    const wrapper = ({ children }: { children: ReactNode }) => <GeometryStoreProvider store={store}>{children}</GeometryStoreProvider>;
    const { result } = renderHook(() => useAutoDuctPreview({ enabled: true, blocked: false, currentFloorZ: 0, unitName: null }), { wrapper });
    const count = () => store.getState().elementIds.length;
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(result.current.active).toBe(true);
    const [first, ...rest] = result.current.runs;
    act(() => result.current.onActivate([first!.proposalId]));
    expect(count()).toBe(elements.length + first!.drafts.length);
    expect(result.current.runs.map((run) => run.proposalId)).toEqual(rest.map((run) => run.proposalId));
    act(() => store.getState().undo());
    expect(count()).toBe(elements.length);
    act(() => result.current.addAll());
    expect(count()).toBe(elements.length + [first!, ...rest].reduce((n, run) => n + run.drafts.length, 0));
    expect(result.current.runs).toEqual([]);
  });
});
