// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';

it('a new line or polygon element placed at one point is centred on it, and stays there', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const at = { x: 10, y: -4, z: 2.5 };
  for (const type of ['BuildingElementOpaque', 'BuildingElementTransparent', 'BuildingElementGround', 'ContextShading'] as const) {
    const id = store.getState().createPlaceholderElement('', type);
    store.getState().updateElement(id, { coordinates: [at] });
    store.getState().updateElement(id, { name: `${type} placed` });
    const coords = store.getState().elementsById[id]!.coordinates;
    const mean = (axis: 'x' | 'y') => coords.reduce((sum, p) => sum + p[axis], 0) / coords.length;
    expect(coords.length, type).toBeGreaterThan(1);
    expect(mean('x'), type).toBeCloseTo(at.x);
    expect(mean('y'), type).toBeCloseTo(at.y);
    expect(coords.every((p) => p.z === at.z), type).toBe(true);
  }
});

it('a type whose default shape it rejects is not moved by its first edit', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const id = store.getState().createPlaceholderElement('', 'OnSiteGeneration');
  store.getState().updateElement(id, { coordinates: [{ x: 10, y: -4, z: 2.5 }] });
  const placed = store.getState().elementsById[id]!.coordinates;
  store.getState().updateElement(id, { name: 'PV placed' });
  expect(store.getState().elementsById[id]!.coordinates).toEqual(placed);
});
