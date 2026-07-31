// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StandardDropdown } from '../StandardDropdown';

afterEach(cleanup);

const OPTIONS = [
  { value: '0.25', label: '0.25' },
  { value: '0.5', label: '0.5' },
];

describe('StandardDropdown persistent unit adornment', () => {
  it('keeps the unit display-only while emitting the raw option value', () => {
    const onChange = vi.fn();
    render(
      <StandardDropdown
        label="Efficiency"
        value="0.25"
        unit="fraction"
        options={OPTIONS}
        onChange={onChange}
      />,
    );

    const select = screen.getByLabelText('Efficiency');
    expect(screen.getByText('fraction', { selector: '.standard-control-unit' })).toBeVisible();

    fireEvent.change(select, { target: { value: '0.5' } });

    expect(onChange).toHaveBeenCalledWith('0.5');
    expect(select).toHaveValue('0.25');
  });

  it('associates an accessible unit description with the native select', () => {
    render(
      <StandardDropdown
        aria-label="Air flow"
        value="0.25"
        unit="L/s"
        options={OPTIONS}
        onChange={() => undefined}
      />,
    );

    const select = screen.getByLabelText('Air flow');
    const visualUnit = screen.getByText('L/s', { selector: '.standard-control-unit' });
    expect(visualUnit).toHaveAttribute('aria-hidden', 'true');

    const describedBy = select.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('Unit: L/s');
  });

  it.each([
    ['sm', 'default'],
    ['sm', 'ghost'],
    ['md', 'default'],
    ['md', 'ghost'],
    ['lg', 'default'],
    ['lg', 'ghost'],
  ] as const)('supports %s/%s layout with disabled and error state styling', (size, variant) => {
    const { container } = render(
      <StandardDropdown
        aria-label={`${size}-${variant}`}
        value=""
        unit="°C"
        options={OPTIONS}
        onChange={() => undefined}
        size={size}
        variant={variant}
        disabled
        error="Required"
      />,
    );

    const shell = container.querySelector('.standard-control-shell');
    expect(shell).toHaveClass(`standard-control-shell-${size}`);
    expect(shell).toHaveClass(`standard-control-shell-${variant}`);
    expect(shell).toHaveClass('standard-control-shell-disabled');
    expect(shell).toHaveClass('standard-control-shell-error');
    expect(screen.getByLabelText(`${size}-${variant}`)).toBeDisabled();
    expect(screen.getByText('Required')).toBeVisible();
  });

  it('preserves direct select markup when no unit is supplied', () => {
    const { container } = render(
      <StandardDropdown
        aria-label="Mode"
        value="0.25"
        options={OPTIONS}
        onChange={() => undefined}
      />,
    );

    expect(container.querySelector('.standard-control-shell')).toBeNull();
    expect(screen.getByLabelText('Mode').parentElement).toHaveClass('standard-dropdown-container');
  });
});
