// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { GeometryProductSlot } from '../../../../geometry-editor-host/src/inspectorContributions';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import { ProductSlotChips } from '../ProductSlotChips';

afterEach(cleanup);

const slot = (row: string, slot: Partial<GeometryProductSlot>): GeometryProductSlot => ({
  path: `/HeatSourceWet/${row}`, system_type: 'HeatPump', source: 'product', rule: 'picked on the element',
  technology_types: ['Air Source Heat Pump'], candidates: [], row, ...slot,
});

function renderChips(name: string, slots: GeometryProductSlot[] | undefined, withPicker = true) {
  const store = createGeometryStore();
  store.getState().setTargetValidation({ hemVersion: '0.13.2', items: [], productSlots: slots });
  const productCatalogue = {
    hasAppliedSystemData: () => false,
    renderSystemSource: () => null,
    renderAdvancedHotWaterAction: () => null,
    ...(withPicker && { renderProductSlot: ({ slot }: { slot: GeometryProductSlot }) => <div>picker for {slot.path}</div> }),
  };
  return render(
    <GeometryStoreProvider store={store}>
      <ProductSlotChips element={{ name }} productCatalogue={productCatalogue} onPatchExtraJson={() => {}} />
    </GeometryStoreProvider>,
  );
}

it('renders nothing when the conversion reports no slot for the element', () => {
  expect(renderChips('Heat pump', undefined).container.innerHTML).toBe('');
  expect(renderChips('Heat pump', [slot('Other', { product_id: 1 })]).container.innerHTML).toBe('');
});

it('names the source, gives the product and rule on hover, and opens the picker', () => {
  renderChips('Heat pump', [slot('Heat pump', { product_id: 600001, source: 'default', label: 'HEM Default MEV', rule: 'the only CentralisedMev product' })]);
  const chip = screen.getByRole('button', { name: 'Default: HEM Default MEV' });
  expect(chip.title).toBe('HEM Default MEV. The only CentralisedMev product.');
  expect(screen.queryByText(/picker for/)).toBeNull();
  fireEvent.click(chip);
  expect(screen.getByText('picker for /HeatSourceWet/Heat pump')).toBeTruthy();
});

it('shows a picked product as Product', () => {
  renderChips('Heat pump', [slot('Heat pump', { product_id: 693003, label: 'HEM Default ASHP 6kW' })]);
  expect(screen.getByRole('button', { name: 'HEM Default ASHP 6kW' }).title).toBe('HEM Default ASHP 6kW. Picked on the element.');
});

it('shows a needed pick as an error naming what to pick, and informs only without a picker', () => {
  renderChips('Heat pump', [slot('Heat pump', { product_id: null, rule: 'pick the heat-pump size' })], false);
  const chip = screen.getByRole('button', { name: 'Pick a product: Air source heat pump' });
  expect(chip.title).toBe('Pick the heat-pump size.');
  fireEvent.click(chip);
  expect(screen.queryByText(/picker for/)).toBeNull();
});
