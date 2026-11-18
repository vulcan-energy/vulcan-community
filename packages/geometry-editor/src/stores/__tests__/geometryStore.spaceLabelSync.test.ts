// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createGeometryStore } from '../geometryStore';

type Store = ReturnType<typeof createGeometryStore>;

const square = (x: number, size: number) => [
  { x, y: 0, z: 0 }, { x: x + size, y: 0, z: 0 }, { x: x + size, y: size, z: 0 }, { x, y: size, z: 0 },
];

/** A model drawn from scratch: drawing the first wall makes the zone it goes in. */
function drawn(): { store: Store; zoneId: string } {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const zoneId = store.getState().createPlaceholderZone();
  store.getState().addElements([{
    type: 'BuildingElementOpaque', name: 'Wall (S)', zoneId, height: 2.4, width: 8, area: 19.2,
    pitch: 90, base_height: 0, parent_element: null,
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }],
  }] as never);
  return { store, zoneId };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('a drawn zone is a real zone, so its space labels give its living room area', () => {
  const { store, zoneId } = drawn();
  expect(store.getState().zones.find((zone) => zone.id === zoneId)?.isPlaceholder).toBe(false);

  store.getState().addSpaceLabel({ zoneId, room_type: 'living_room', coordinates: square(0, 4) });
  store.getState().addSpaceLabel({ zoneId, room_type: 'bedroom', coordinates: square(4, 4) });

  const zone = store.getState().zones.find((candidate) => candidate.id === zoneId)!;
  expect(zone.livingroom_area).toBe(16);
  expect(zone.restofdwelling_area).toBe(16);
});

it('labelling spaces fills the room counts nobody typed and keeps the ones the user typed', () => {
  const { store, zoneId } = drawn();
  // A new model's bedroom and wet room counts are initial values, not typed.
  store.getState().setComplianceSettings({ NumberOfHabitableRooms: 5, NumberOfHotTappedRooms: 3 });

  store.getState().addSpaceLabel({ zoneId, room_type: 'living_room', coordinates: square(0, 4) });
  store.getState().addSpaceLabel({ zoneId, room_type: 'bedroom', coordinates: square(4, 4) });

  const counts = store.getState().complianceSettings;
  expect(counts.NumberOfBedrooms).toBe(1);
  expect(counts.NumberOfWetRooms).toBe(0);
  expect(counts.NumberOfHabitableRooms).toBe(5);
  expect(counts.NumberOfHotTappedRooms).toBe(3);

  // A count that still holds what the labels gave follows them.
  store.getState().addSpaceLabel({ zoneId, room_type: 'bedroom', coordinates: square(8, 4) });
  expect(store.getState().complianceSettings.NumberOfBedrooms).toBe(2);
  expect(store.getState().complianceSettings.NumberOfHabitableRooms).toBe(5);
});
