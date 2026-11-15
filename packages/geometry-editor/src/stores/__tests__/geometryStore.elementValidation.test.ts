// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';

import { createGeometryStore } from '../geometryStore';

const csv = `Metadata,,

Zone,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Zone 1,Zone,50,20,2.5,FALSE

Thermal Bridging Elements,,,,,,,,,
Name,Zone,Type,heat_transfer_coeff,length,linear_thermal_transmittance,parent_element,coords,extra_json
TB A,Zone 1,ThermalBridgeLinear,,4,0.05,,"0,0,0|4,0,0","{""junction_type"":""E2""}"
TB B,Zone 1,ThermalBridgeLinear,,4,0.05,,"0,5,0|4,5,0","{""junction_type"":""E2""}"
`;

it('validates each element once per model state, and again when a model-wide input changes', () => {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv);
  const byName = (name: string) => {
    const { elementIds, elementsById } = store.getState();
    return elementsById[elementIds.find((id) => elementsById[id]!.name === name)!]!;
  };
  const overlaps = (name: string) =>
    store.getState().validateElement(byName(name)).issues.some((issue) => issue.message.includes('Overlaps another thermal bridge'));

  const a = byName('TB A');
  const first = store.getState().validateElement(a);
  const context = store.getState().getElementValidationContext();
  // Selecting is a regression guard for the inspector: it reads the canvas's results and rebuilds
  // nothing (a deterministic stand-in for a timing budget, which the shared CI runner makes flaky).
  store.getState().setSelection({ type: 'element', id: a.id });
  expect(store.getState().getElementValidationContext()).toBe(context);
  expect(store.getState().validateElement(a)).toBe(first);
  expect(overlaps('TB A')).toBe(false);

  // Moving B onto A changes the model-wide overlap check, so A (unchanged) is checked again.
  store.getState().updateElement(byName('TB B').id, { coordinates: [{ x: 1, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }] });
  expect(byName('TB A')).toBe(a);
  expect(overlaps('TB A')).toBe(true);
});
