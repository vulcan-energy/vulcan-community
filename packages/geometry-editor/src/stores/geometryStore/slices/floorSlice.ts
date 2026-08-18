// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { StateCreator } from 'zustand';
import type { Floor } from '../../../geometry/types';
import { getElementCanvasFloorZValue } from '../../../lib/elementCanvasFloor';
import {
  cascadeFloorStackChange,
  deriveZoneProperties,
  getCumulativeBaseHeightsByFloorId,
  withEffectiveStoreyHeights,
} from '../../../lib/zoneDerivation';
import {
  resolveGuideOverlayForFloor,
  resolveGuideOverlaySourceForFloor,
} from '../../../geometry/guideOverlayByFloor';
import type { GeometryState } from '../../geometryStore';

const generateId = () => Math.random().toString(36).substr(2, 9);

export interface FloorSlice {
  floors: Floor[];
  floorIds: string[];
  currentFloorId: string | null;
  currentFloorZ: number;
  addFloor: (name: string, height: number, isRoofSpace?: boolean, zIndex?: number) => string;
  updateFloor: (id: string, updates: Partial<Floor>) => void;
  removeFloor: (id: string) => void;
  setCurrentFloor: (id: string) => void;
  setCurrentFloorZ: (z: number) => void;
  getCurrentFloor: () => Floor | null;
  ensureFloorForZ: (z: number) => string;
}

export type GeometryStoreSlice = StateCreator<GeometryState, [], [], FloorSlice>;

export const createFloorSlice: GeometryStoreSlice = (set, get) => ({
  floors: [],
  floorIds: [],
  currentFloorId: null,
  currentFloorZ: 0, // Internal ground floor; displayed as F1.
  addFloor: (name: string, height: number, isRoofSpace: boolean = false, zIndex?: number) => {
    const id = generateId();
    const actualZIndex = zIndex !== undefined ? zIndex : get().floors.length;

    set((state) => {
      const newFloor = { id, name, zIndex: actualZIndex, height, isRoofSpace };
      const allFloors = [...state.floors, newFloor];

      const maxZIndex = Math.max(...allFloors.map(f => f.zIndex));
      const updatedFloors = allFloors.map(floor => ({
        ...floor,
        isRoofSpace: floor.zIndex === maxZIndex && floor.zIndex > 0
      }));

      return {
        floors: updatedFloors,
        floorIds: [...state.floorIds, id],
        currentFloorId: state.currentFloorId || id
      };
    });

    return id;
  },
  updateFloor: (id: string, updates: Partial<Floor>) => {
    let anyFieldChanged = false;
    set((state) => {
      const prevFloor = state.floors.find((floor) => floor.id === id);
      if (!prevFloor) return state;

      const nextFloor = { ...prevFloor, ...updates };
      anyFieldChanged = (Object.keys(updates) as Array<keyof Floor>).some(
        (key) => nextFloor[key] !== prevFloor[key],
      );
      if (!anyFieldChanged) return state;

      const nextFloors = state.floors.map((floor) =>
        floor.id === id ? nextFloor : floor,
      );

      // The cascade fires when the *effective* storey heights change, which happens for either:
      //   - a Floor.height edit (user override flow), or
      //   - a heightUserOverride flip (snap to walls vs decouple from walls).
      // Renames and isRoofSpace toggles do not affect effective heights, so they skip the cascade.
      const elements = Object.values(state.elementsById);
      const oldEff = withEffectiveStoreyHeights(state.floors, elements);
      const newEff = withEffectiveStoreyHeights(nextFloors, elements);
      const effectiveChanged = oldEff.some((f, i) => f.height !== newEff[i]?.height);
      const oldBases = getCumulativeBaseHeightsByFloorId(state.floors, elements);
      const newBases = getCumulativeBaseHeightsByFloorId(nextFloors, elements);
      const baseChanged = state.floors.some((floor) => oldBases.get(floor.id) !== newBases.get(floor.id));
      if (!effectiveChanged && !baseChanged) return { floors: nextFloors };

      const patches = cascadeFloorStackChange(oldEff, newEff, elements);
      if (patches.length === 0) return { floors: nextFloors };

      const nextElementsById = { ...state.elementsById };
      for (const { elementId, patch } of patches) {
        const el = nextElementsById[elementId];
        if (!el) continue;
        nextElementsById[elementId] = {
          ...el,
          ...patch,
          _v: (el._v ?? 0) + 1,
        } as typeof el;
      }
      return { floors: nextFloors, elementsById: nextElementsById };
    });
    // History captures both `floors` and `elementsById` in one snapshot, so a single
    // saveToHistory call gives atomic undo for the Floor.height edit + element cascade.
    // Deferred to the next tick so Zustand has applied the `set` above before we snapshot.
    if (anyFieldChanged) {
      setTimeout(() => {
        get().saveToHistory('updateFloor');
      }, 0);
    }
  },
  removeFloor: (id: string) => {
    set((state) => {
      const floorToRemove = state.floors.find((floor) => floor.id === id);
      if (!floorToRemove) return state;

      const remainingFloors = state.floors.filter((floor) => floor.id !== id);
      const maxRemainingZ = remainingFloors.length > 0 ? Math.max(...remainingFloors.map((floor) => floor.zIndex)) : undefined;
      const updatedFloors = remainingFloors.map((floor) => ({
        ...floor,
        isRoofSpace: maxRemainingZ !== undefined && floor.zIndex === maxRemainingZ && floor.zIndex > 0,
      }));
      const removedElementIds = new Set(
        state.elementIds.filter((elementId) => {
          const element = state.elementsById[elementId];
          if (!element) return false;
          const elementFloorZ = getElementCanvasFloorZValue(element, state.floors);
          return elementFloorZ === floorToRemove.zIndex || element.floorId === floorToRemove.id;
        }),
      );
      const removedElementNames = new Set(
        Array.from(removedElementIds)
          .map((elementId) => state.elementsById[elementId]?.name)
          .filter((name): name is string => typeof name === 'string' && name.trim().length > 0),
      );
      const remainingElementsById = Object.fromEntries(
        Object.entries(state.elementsById).filter(([elementId]) => !removedElementIds.has(elementId)),
      );
      const newElementIds = state.elementIds.filter((elementId) => !removedElementIds.has(elementId));

      for (const elementId of newElementIds) {
        const element = remainingElementsById[elementId];
        if (element && element.parent_element && removedElementNames.has(element.parent_element)) {
          remainingElementsById[elementId] = { ...element, parent_element: null };
        }
      }

      const remainingSelectedElementIds = state.selectedElementIds.filter((elementId) => !removedElementIds.has(elementId));
      const selectionRemoved =
        (state.selection?.type === 'element' &&
          typeof state.selection.id === 'string' &&
          removedElementIds.has(state.selection.id)) ||
        (state.selection?.type !== 'zone' && remainingSelectedElementIds.length !== state.selectedElementIds.length);
      const affectedZoneIds = new Set(
        Array.from(removedElementIds)
          .map((elementId) => state.elementsById[elementId]?.zoneId)
          .filter((zoneId): zoneId is string => typeof zoneId === 'string' && zoneId.length > 0),
      );
      const remainingElements = Object.values(remainingElementsById);
      const updatedZones =
        affectedZoneIds.size > 0
          ? state.zones.map((zone) =>
              affectedZoneIds.has(zone.id) ? { ...zone, ...deriveZoneProperties(zone, remainingElements) } : zone,
            )
          : state.zones;

      const activeFloorWasRemoved = state.currentFloorZ === floorToRemove.zIndex || state.currentFloorId === floorToRemove.id;
      const fallbackFloor =
        updatedFloors
          .filter((floor) => floor.zIndex < floorToRemove.zIndex)
          .sort((a, b) => b.zIndex - a.zIndex)[0] ??
        [...updatedFloors].sort((a, b) => a.zIndex - b.zIndex)[0] ??
        null;
      const nextCurrentFloorZ = activeFloorWasRemoved ? fallbackFloor?.zIndex ?? 0 : state.currentFloorZ;
      const nextCurrentFloorId =
        updatedFloors.find((floor) => floor.zIndex === nextCurrentFloorZ)?.id ??
        (activeFloorWasRemoved ? fallbackFloor?.id ?? null : state.currentFloorId === floorToRemove.id ? null : state.currentFloorId);

      return {
        floors: updatedFloors,
        floorIds: state.floorIds.filter((floorId) => floorId !== id),
        currentFloorId: nextCurrentFloorId,
        currentFloorZ: nextCurrentFloorZ,
        elementsById: remainingElementsById,
        elementIds: newElementIds,
        zones: updatedZones,
        selectedElementIds: remainingSelectedElementIds,
        selection: selectionRemoved ? null : state.selection,
        guideOverlay: resolveGuideOverlayForFloor(state.guideOverlayByFloor, nextCurrentFloorZ).value,
        guideOverlaySource: resolveGuideOverlaySourceForFloor(state.guideOverlaySourceByFloor, nextCurrentFloorZ).value,
      };
    });
    setTimeout(() => {
      get().saveToHistory('removeFloor');
    }, 0);
  },
  setCurrentFloor: (id: string) => {
    const state = get();
    const floor = state.floors.find(f => f.id === id);
    const nextZ = floor?.zIndex ?? 0;
    set({
      currentFloorId: id,
      currentFloorZ: nextZ,
      guideOverlay: resolveGuideOverlayForFloor(state.guideOverlayByFloor, nextZ).value,
      guideOverlaySource: resolveGuideOverlaySourceForFloor(state.guideOverlaySourceByFloor, nextZ).value,
    });
  },
  setCurrentFloorZ: (z: number) => {
    const state = get();
    set({
      currentFloorZ: z,
      guideOverlay: resolveGuideOverlayForFloor(state.guideOverlayByFloor, z).value,
      guideOverlaySource: resolveGuideOverlaySourceForFloor(state.guideOverlaySourceByFloor, z).value,
    });
  },
  getCurrentFloor: () => {
    const state = get();
    return state.floors.find(f => f.id === state.currentFloorId) || null;
  },
  ensureFloorForZ: (z: number) => {
    const state = get();
    const zIndex = Math.floor(z);

    const existingFloor = state.floors.find(f => f.zIndex === zIndex);
    if (existingFloor) {
      return existingFloor.id;
    }

    const floorName = String(zIndex);
    // Stored `height` starts at 0; the effective storey height is derived live from walls
    // (or inherited from the closest floor below with walls). The dropdown sets a real value
    // here only when the user explicitly types one in (via the override path).
    return get().addFloor(floorName, 0, false, zIndex);
  },
});
