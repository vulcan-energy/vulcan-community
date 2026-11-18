// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it } from 'vitest';
import { canonicalGeometrySchemaPort } from '../geometrySchemaPort';
import { createGeometryStore } from '../../stores/geometryStore';
import { changeWithUndo, dismissUndoToast, undoOfferedChange } from '../undoToast';

afterEach(dismissUndoToast);

const setup = () => {
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: canonicalGeometrySchemaPort });
  store.getState().addZone({ name: 'Dwelling', floorArea: 16, height: 2.8, volume: 44.8 });
  const zoneId = store.getState().zones[0]!.id;
  store.getState().seedHistory('load');
  store.getState().addElement({ name: 'Wall', type: 'BuildingElementOpaque', zoneId, pitch: 90, coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }] } as never);
  const id = store.getState().elementIds[0]!;
  return { store, id, pitch: () => (store.getState().elementsById[id] as { pitch?: number }).pitch };
};

it('the change is its own step: Undo takes back only it, as a refusal would have', () => {
  const { store, id } = setup();
  store.getState().updateElement(id, { pitch: 180 } as never);
  changeWithUndo(store, 'Changed to a flat surface', () => store.getState().updateElement(id, { name: 'Flat' } as never));
  undoOfferedChange();
  // Undo reloads the document, so the wall is found again by what it is.
  const [wall] = Object.values(store.getState().elementsById);
  expect(wall).toMatchObject({ name: 'Wall', pitch: 180 });
});

it('a later edit makes the offer stale: Undo then changes nothing', () => {
  const { store, id, pitch } = setup();
  changeWithUndo(store, 'Changed', () => store.getState().updateElement(id, { name: 'Flat' } as never));
  store.getState().updateElement(id, { pitch: 45 } as never);
  undoOfferedChange();
  expect(store.getState().elementsById[id]?.name).toBe('Flat');
  expect(pitch()).toBe(45);
});

it('a full history still offers Undo, and a later edit still makes it stale', () => {
  const { store, id } = setup();
  for (let n = 0; n < store.getState().maxHistorySize + 2; n += 1) {
    store.getState().updateElement(id, { pitch: 10 + n } as never);
    store.getState().saveToHistory('fill');
  }
  changeWithUndo(store, 'Changed', () => store.getState().updateElement(id, { name: 'Flat' } as never));
  store.getState().updateElement(id, { pitch: 45 } as never);
  undoOfferedChange();
  expect(store.getState().elementsById[id]?.name).toBe('Flat');
  expect((store.getState().elementsById[id] as { pitch?: number }).pitch).toBe(45);

  changeWithUndo(store, 'Changed', () => store.getState().updateElement(id, { name: 'Flat again' } as never));
  undoOfferedChange();
  expect(Object.values(store.getState().elementsById)[0]).toMatchObject({ name: 'Flat', pitch: 45 });
});
