// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import { EnumControl, NumberControl } from '../jsonformsRenderers';

afterEach(cleanup);

const schemaPort: GeometrySchemaPort = {
  availability: 'available',
  preload: async () => undefined,
  getRootSchema: () => ({}),
  getElementSubschema: () => ({}),
  getBaseFieldsForElementType: () => [],
  getApplianceKeys: () => [],
  getStrictestIntegerKeysForElementType: () => new Set(),
  getSchemaSubtypeForElementData: () => undefined,
  getConditionalRequiredFields: () => [],
  validateProperty: () => ({ valid: true }),
  findParameter: () => null,
};

function renderControl(
  Control: typeof NumberControl | typeof EnumControl,
  {
    data = 0.25,
    path = 'field',
    label = 'Field',
    schema = { type: 'number', units: 'm' },
    uischema = { type: 'Control', scope: '#/properties/field' },
    config = {},
    enabled = true,
    handleChange = vi.fn(),
  }: {
    data?: unknown;
    path?: string;
    label?: string;
    schema?: Record<string, unknown>;
    uischema?: Record<string, unknown>;
    config?: Record<string, unknown>;
    enabled?: boolean;
    handleChange?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const props = {
    data,
    path,
    label,
    schema,
    uischema,
    config: {
      advancedEditor: true,
      elementType: 'TestElement',
      schemaPort,
      ...config,
    },
    handleChange,
    enabled,
    errors: '',
    id: `control-${path}`,
    required: false,
    visible: true,
    rootSchema: schema,
  };

  return {
    handleChange,
    ...render(
      <GeometryStoreProvider store={store}>
        <Control {...props as never} />
      </GeometryStoreProvider>,
    ),
  };
}

function expectUnit(unit: string): HTMLElement {
  return screen.getByText(unit, { selector: '.standard-control-unit' });
}

describe('advanced numeric field presentations', () => {
  it.each([
    ['plain', { type: 'number', units: 'm' }],
    ['integer', { type: 'integer', units: 'm3/h' }],
    ['nullable', { anyOf: [{ type: 'number' }, { type: 'null' }], units: 'l/s' }],
  ])('renders a normalized unit for a %s number control', (_kind, schema) => {
    renderControl(NumberControl, { schema });
    expect(expectUnit(schema.units === 'm3/h' ? 'm³/h' : schema.units === 'l/s' ? 'L/s' : 'm')).toBeVisible();
  });

  it('uses the active conditional schema override for both label and adornment', () => {
    renderControl(NumberControl, {
      label: 'Flow temperature (degrees C)',
      schema: { type: 'number', units: 'K' },
      uischema: {
        type: 'Control',
        scope: '#/properties/field',
        options: { schemaOverride: { type: 'number', units: 'degrees C' } },
      },
    });

    expect(expectUnit('°C')).toBeVisible();
    expect(screen.getByText('Flow temperature')).toBeVisible();
    expect(screen.queryByText('Flow temperature (degrees C)')).not.toBeInTheDocument();
  });

  it('keeps a fraction numeric-enum value unchanged', () => {
    const handleChange = vi.fn();
    renderControl(EnumControl, {
      path: 'frame_area_fraction',
      label: 'Frame area fraction',
      schema: { type: 'number', enum: [0.25, 0.5] },
      config: { elementType: 'BuildingElementTransparent' },
      handleChange,
    });

    expect(expectUnit('fraction')).toBeVisible();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0.5' } });
    expect(handleChange).toHaveBeenCalledWith('frame_area_fraction', 0.5);
  });

  it('keeps the adornment on a read-only numeric enum', () => {
    renderControl(EnumControl, {
      schema: { type: 'number', enum: [0.25, 0.5], units: 'fraction' },
      enabled: false,
    });

    expect(expectUnit('fraction')).toBeVisible();
    expect(screen.getByText('0.25')).toHaveAttribute('aria-readonly', 'true');
  });

  it.each([
    [
      'Calculate R_u',
      'thermal_resistance_unconditioned_space',
      'BuildingElementAdjacentUnconditionedSpace_Simple',
      { openRuCalculator: vi.fn() },
    ],
    [
      'Calc U',
      'u_value',
      'BuildingElementGround',
      { openGroundUCalculator: vi.fn() },
    ],
  ])('uses the shared field-action sizing for %s', (buttonName, path, elementType, actionConfig) => {
    renderControl(NumberControl, {
      data: null,
      path,
      label: path,
      config: { elementType, ...actionConfig },
    });

    const button = screen.getByRole('button', { name: buttonName });
    expect(button).toHaveClass('element-editor-input-action');
    expect(button).not.toHaveClass('btn-nav');
    expect(button).not.toHaveAttribute('style');
  });

  // Ported from the deleted web jsonformsRenderers.test.tsx's "R_u field action
  // button" describe block (parent repo, R4.5) -- the it.each above only covers the
  // no-value ("Calculate R_u") branch and only asserts CSS classes; this is the
  // has-value label flip, asserted on the button's actual text.
  it('shows Edit R_u once the unheated-space resistance field has a value', () => {
    renderControl(NumberControl, {
      data: 0.45,
      path: 'thermal_resistance_unconditioned_space',
      label: 'thermal_resistance_unconditioned_space',
      config: {
        elementType: 'BuildingElementAdjacentUnconditionedSpace_Simple',
        openRuCalculator: vi.fn(),
      },
    });

    const button = screen.getByRole('button', { name: 'Edit R_u' });
    expect(button.textContent).toBe('Edit R_u');
    expect(button).toHaveAttribute('title', 'Edit calculated R_u');
  });

  // Ported from the deleted web jsonformsRenderers.test.tsx's "JsonForms Renderers -
  // Number Draft Editing" describe block (parent repo, R4.5): schema `minimum`/
  // `maximum` map to `min`/`max`, and with no `multipleOf` the step stays the generic
  // `'any'` -- `numericInputAttributesFromSchema` must not invent a precision the
  // schema never declared.
  it('maps schema number ranges to input constraints without inventing precision', () => {
    renderControl(NumberControl, {
      data: 0.16,
      path: 'psi_wall_floor_junc',
      label: 'psi_wall_floor_junc',
      schema: { type: 'number', minimum: 0, maximum: 2 },
      config: { elementType: 'BuildingElementGround' },
    });

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.getAttribute('min')).toBe('0');
    expect(input.getAttribute('max')).toBe('2');
    expect(input.getAttribute('step')).toBe('any');
  });
});
