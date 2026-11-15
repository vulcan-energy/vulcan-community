// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createGeometryStore } from '../geometryStore';
import { HISTORY_CAPTURE_QUIET_MS } from '../geometryStore/slices/historySlice';
import { provenanceOf } from '../../lib/provenance';

type Store = ReturnType<typeof createGeometryStore>;

const DEFAULTS = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../../data/defaults/defaults_template.json'), 'utf8'));
const settle = () => vi.advanceTimersByTime(HISTORY_CAPTURE_QUIET_MS);

/** A store holding `csv` with the shipped defaults loaded, as after an open. */
function open(csv: string): Store {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv);
  store.getState().setDefaultsJson(DEFAULTS);
  return store;
}

function model(): string {
  const builder = createGeometryStore({ defaultDefaultsPath: null });
  builder.getState().addZone({ name: 'Living', floorArea: 20, height: 2.4, volume: 48 });
  const zoneId = builder.getState().zones[0]!.id;
  builder.getState().addElements([{
    type: 'BuildingElementOpaque', name: 'Front wall', zoneId, height: 2.4, width: 4, area: 9.6,
    pitch: 90, base_height: 0, parent_element: null, extra_json: { u_value: 0.3 },
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
  }] as never);
  return builder.getState().generateCSV({ allowUnresolvedMigration: true });
}

const idOfName = (store: Store, name: string) => store.getState().elementIds.find((id) => store.getState().elementsById[id]?.name === name)!;
const wallId = (store: Store) => idOfName(store, 'Front wall');
const setU = (store: Store, u_value: number) => {
  const id = wallId(store);
  store.getState().updateElement(id, { extra_json: { ...store.getState().elementsById[id]!.extra_json, u_value } });
};
const defaultU = (store: Store) =>
  store.getState().defaultsLookup.getDefaultValueForElementField('u_value', 'BuildingElementOpaque', 'wall') as number;
const uSource = (store: Store) => {
  const current = store.getState().elementsById[wallId(store)]!.extra_json!.u_value as number;
  return provenanceOf(store.getState().provenance, { kind: 'element', id: wallId(store) }, 'u_value', { source: defaultU(store), current });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('an untouched model saves no Provenance row and stays clean', () => {
  const store = open(model());
  expect(store.getState().getDocumentCsv()).not.toContain('Provenance,');
  expect(store.getState().getDocumentCsv()).toBe(store.getState().lastSavedCsv);
});

it('a value entered equal to its default stays the user\'s through save and reload', () => {
  const store = open(model());
  expect(defaultU(store)).toEqual(expect.any(Number));
  setU(store, defaultU(store));
  expect(uSource(store)).toBe('user');
  const saved = store.getState().getDocumentCsv();
  expect(saved).toContain('Provenance,"{""e:Living/Front wall"":{""u_value"":""user""}}"');

  const reopened = open(saved);
  expect(uSource(reopened)).toBe('user');
  expect(reopened.getState().getDocumentCsv()).toBe(saved);
});

it('keeps only what the value cannot tell: an entry leaves the row once the value differs from its default', () => {
  const store = open(model());
  setU(store, defaultU(store));
  setU(store, 0.25);
  expect(store.getState().provenance).toEqual({});
  expect(store.getState().getDocumentCsv()).not.toContain('Provenance,');
  expect(uSource(store)).toBe('user');
});

it('records a preset by name, follows a rename, and undo restores the table', () => {
  const store = open(model());
  store.getState().writeAs('preset:Cavity', () => setU(store, defaultU(store)));
  settle();
  store.getState().updateElement(wallId(store), { name: 'Back wall' });
  settle();
  expect(store.getState().getDocumentCsv()).toContain('""e:Living/Back wall"":{""u_value"":""preset:Cavity""}');
  store.getState().undo();
  store.getState().undo();
  expect(store.getState().provenance).toEqual({});
  store.getState().redo();
  expect(Object.values(store.getState().provenance)).toEqual([{ u_value: 'preset:Cavity' }]);
});

it('default and derived writes record nothing', () => {
  const store = open(model());
  for (const intent of ['default', 'derived'] as const) store.getState().writeAs(intent, () => setU(store, defaultU(store)));
  expect(store.getState().provenance).toEqual({});
});

it('an unreadable row is reported and dropped', () => {
  const csv = model().replace('Metadata,,,,,,,,,,,,,\n', 'Metadata,,,,,,,,,,,,,\nProvenance,"{""e:Living/Front wall"":{""u_value"":""typed""}}",,,,,,,,,,,,,\n');
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const { warnings } = store.getState().loadFromCSV(csv);
  expect(warnings.join('\n')).toMatch(/Provenance row could not be read/);
  expect(store.getState().provenance).toEqual({});
});

it('drawing an element records nothing: committing a placeholder is its creation', () => {
  const store = open(model());
  const zoneId = store.getState().zones[0]!.id;
  const id = store.getState().createPlaceholderElement(zoneId, 'MechanicalVentilationDuctwork');
  const fill = { duct_type: 'supply', length: 10, internal_diameter_mm: 200 } as const;
  for (const [field, value] of Object.entries(fill)) {
    expect(store.getState().fieldSourceOf()!(store.getState().elementsById[id]!, field), field).toBe(value);
  }
  store.getState().updateElement(id, { ...fill, name: 'Supply duct', coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] } as never);
  expect(store.getState().provenance).toEqual({});
  expect(store.getState().getDocumentCsv()).not.toContain('Provenance,');
});

it('an entry for one of two elements that share a name in a zone is neither saved nor loaded', () => {
  const store = open(model());
  const zoneId = store.getState().zones[0]!.id;
  store.getState().addElements([{
    type: 'BuildingElementOpaque', name: 'Side wall', zoneId, height: 2.4, width: 4, area: 9.6,
    pitch: 90, base_height: 0, parent_element: null, extra_json: { u_value: 0.3 },
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }],
  }] as never);
  setU(store, defaultU(store));
  const saved = store.getState().getDocumentCsv();
  expect(saved).toContain('e:Living/Front wall');

  // A file can name two elements alike (the editor itself refuses it).
  const twins = open(saved.replaceAll('Side wall', 'Front wall'));
  expect(twins.getState().provenance).toEqual({});
  const first = twins.getState().elementIds.find((id) => twins.getState().elementsById[id]?.extra_json?.u_value === 0.3);
  twins.getState().updateElement(first!, { extra_json: { ...twins.getState().elementsById[first!]!.extra_json, u_value: defaultU(twins) } });
  expect(Object.keys(twins.getState().provenance)).toEqual([first]);
  expect(twins.getState().getDocumentCsv()).not.toContain('Provenance,');
});
