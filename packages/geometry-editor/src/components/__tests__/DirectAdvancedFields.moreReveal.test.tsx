// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectAdvancedFields } from '../DirectAdvancedFields';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';

const store = createGeometryStore();
const Fields = (props: Partial<React.ComponentProps<typeof DirectAdvancedFields>>) => (
  <GeometryStoreProvider store={store}>
    <DirectAdvancedFields schema={schema} data={{}} config={config} onDataChange={() => {}} {...props} />
  </GeometryStoreProvider>
);

const schema = {
  type: 'object',
  properties: { shown: { type: 'number' }, tucked: { type: 'number' } },
};
const config = { elementType: 'BuildingElementOpaque', collapsedEngineFields: new Set(['tucked']) };
const tuckedField = (container: HTMLElement) => container.querySelector('[data-field-key="tucked"]');

describe('"More" opens for a field the user is sent to', () => {
  afterEach(cleanup);

  it('stays closed with nothing to show, and opens for a focus request naming a field inside it', () => {
    const view = render(<Fields />);
    expect(tuckedField(view.container)).toBeNull();

    view.rerender(<Fields focusFieldKey="tucked" focusFieldVersion={1} />);
    expect(tuckedField(view.container)).not.toBeNull();
  });

  it('stays open once the field it opened for is filled', () => {
    const view = render(<Fields focusFieldKey="tucked" focusFieldVersion={1} />);
    view.rerender(<Fields focusFieldKey="tucked" focusFieldVersion={1} data={{ tucked: 1 }} />);
    expect(tuckedField(view.container)).not.toBeNull();
  });
});

describe('a product the target chooses', () => {
  afterEach(cleanup);
  const productSchema = { type: 'object', properties: { product_id: { type: 'string' } }, required: ['product_id'] };

  it('is not "Required, no default" while the product rule decides it', () => {
    const missing = render(<Fields schema={productSchema} config={{ elementType: 'System' }} />);
    expect(missing.container.textContent).toContain('Required, no default');
    cleanup();
    const ruled = render(<Fields schema={productSchema} config={{ elementType: 'System', productRule: true }} />);
    expect(ruled.container.textContent).not.toContain('Required, no default');
  });
});

describe('a laid-out "More" (a cylinder\'s coil)', () => {
  afterEach(cleanup);
  const coilSchema = {
    type: 'object',
    properties: { coil: { type: 'object', required: ['flow', 'rate'], properties: { flow: { type: 'number' }, rate: { type: 'number' }, position: { type: 'number' } } } },
  };
  const scope = (key: string) => `#/properties/coil/properties/${key}`;
  const layout = { type: 'VerticalLayout' as const, elements: ['flow', 'rate', 'position'].map((key) => ({ type: 'Control' as const, scope: scope(key), label: `Coil · ${key}` })) };
  const coilConfig = { elementType: 'System', collapsedEngineFields: new Set(['flow', 'rate', 'position']), collapsedStatedRequired: true };
  const shown = (container: HTMLElement, key: string) => container.querySelector(`[data-field-key="${key}"]`) !== null;

  it('takes a required field the data states, stays closed for it, and names the part it belongs to', () => {
    const view = render(<Fields schema={coilSchema} layout={layout} config={coilConfig} data={{ coil: { flow: 10, rate: 300 } }} />);
    expect(shown(view.container, 'flow')).toBe(false);
    expect(shown(view.container, 'rate')).toBe(false);
    expect(view.container.textContent).toContain('coil');
    expect(view.container.textContent).not.toContain('flow, rate');
  });

  it('opens while a required field is empty, and keeps the field in place as it is filled', () => {
    const empty = render(<Fields schema={coilSchema} layout={layout} config={coilConfig} data={{ coil: { rate: 300 } }} />);
    const flow = empty.container.querySelector('[data-field-key="flow"]');
    expect(flow?.closest('details')).not.toBeNull();
    fireEvent.focus(flow!.querySelector('input')!);
    empty.rerender(<Fields schema={coilSchema} layout={layout} config={coilConfig} data={{ coil: { flow: 5, rate: 300 } }} />);
    expect(empty.container.querySelector('[data-field-key="flow"]')).toBe(flow);
    cleanup();
    const stated = render(<Fields schema={coilSchema} layout={layout} config={coilConfig} data={{ coil: { flow: 10, rate: 300, position: 0.2 } }} />);
    expect(shown(stated.container, 'position')).toBe(false);
  });
});
