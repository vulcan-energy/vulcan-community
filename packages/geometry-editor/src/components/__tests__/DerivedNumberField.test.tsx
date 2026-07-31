// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DerivedNumberField } from '../DerivedNumberField';

function renderField(props: Partial<React.ComponentProps<typeof DerivedNumberField>> = {}) {
  const onChange = vi.fn();
  render(
    <DerivedNumberField
      label="Ground Floor Area (m²)"
      derivedValue={48.5}
      manualValue={undefined}
      onChange={onChange}
      resetTitle="Reset to derived"
      resetAriaLabel="Reset ground floor area to derived value"
      {...props}
    />,
  );
  return { onChange, input: screen.getByRole('textbox') as HTMLInputElement };
}

describe('DerivedNumberField', () => {
  it('shows the derived value and tags it auto', () => {
    const { input } = renderField();

    expect(input.value).toBe('48.5');
    expect(screen.getByText('(auto)')).toBeTruthy();
    expect(screen.queryByLabelText('Reset ground floor area to derived value')).toBeNull();
  });

  it('shows the override and offers a reset', () => {
    const { onChange } = renderField({ manualValue: 60 });

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('60');
    expect(screen.getByText('(manual override)')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Reset ground floor area to derived value'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('stores a value that differs from the derived one', () => {
    const { onChange, input } = renderField();

    fireEvent.change(input, { target: { value: '60' } });

    expect(onChange).toHaveBeenCalledWith(60);
  });

  it('returns to auto when the typed value matches the derived one', () => {
    const { onChange, input } = renderField({ manualValue: 60 });

    fireEvent.change(input, { target: { value: '48.5' } });

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('returns to auto when cleared or given a non-number', () => {
    const { onChange, input } = renderField({ manualValue: 60 });

    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);

    // The pre-refactor `Math.max(0, parseFloat(raw) || 0)` turned garbage into a real
    // 0 m² ground floor area, which then reaches HEM.
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('returns to auto on a negative rather than clamping it to zero', () => {
    const { onChange, input } = renderField();

    fireEvent.change(input, { target: { value: '-5' } });

    // parseDimensionOverride rejects negatives outright. Clamping would store a real 0,
    // which is indistinguishable from a measured zero.
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('carries min and step through from the call sites', () => {
    const { input } = renderField();

    // Preserved so the rendered DOM matches the three hand-rolled fields this replaced.
    // Both are inert: StandardInput renders type="number" as a draft-safe text input, and
    // min/step do nothing on type="text". parseDimensionOverride is the actual guard.
    expect(input.getAttribute('min')).toBe('0');
    expect(input.getAttribute('step')).toBe('0.01');
    expect(input.getAttribute('type')).toBe('text');
  });

  it('hides the auto/override tag and reset when nothing could be derived', () => {
    renderField({ derivedValue: 0, manualValue: 60, placeholderWhenUnavailable: 'Draw a floor' });

    expect(screen.queryByText('(auto)')).toBeNull();
    expect(screen.queryByText('(manual override)')).toBeNull();
    expect(screen.queryByLabelText('Reset ground floor area to derived value')).toBeNull();
    expect((screen.getByRole('textbox') as HTMLInputElement).placeholder).toBe('Draw a floor');
  });

  it('honours a looser match tolerance', () => {
    const { onChange, input } = renderField({ manualValue: 60, matchTolerance: 0.5 });

    fireEvent.change(input, { target: { value: '48.4' } });

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('renders the label accessory and the derived helper text', () => {
    renderField({
      labelAccessory: <span>evidence</span>,
      helperTextWhenDerived: 'Derived from lowest-Z ground polygons: 48.5 m²',
    });

    expect(screen.getByText('evidence')).toBeTruthy();
    expect(screen.getByText('Derived from lowest-Z ground polygons: 48.5 m²')).toBeTruthy();
  });

  it('shows the unavailable helper text when nothing was derived', () => {
    renderField({
      derivedValue: 0,
      helperTextWhenDerived: 'derived helper',
      helperTextWhenUnavailable: 'Draw ground floor polygons to auto-derive',
    });

    expect(screen.getByText('Draw ground floor polygons to auto-derive')).toBeTruthy();
    expect(screen.queryByText('derived helper')).toBeNull();
  });
});
