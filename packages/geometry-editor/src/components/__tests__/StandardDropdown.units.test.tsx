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

  it('renders a stored value that matches no option as its own disabled entry, and DISPLAYS it', () => {
    // The N1 misread: a native <select> whose value matches no <option> silently
    // shows option index 0, so a stored out-of-enum value rendered as the first
    // legitimate option with nothing flagging the substitution. The stored value
    // must be what the control displays.
    render(
      <StandardDropdown
        aria-label="Mass class"
        value="NOT_A_CLASS"
        options={OPTIONS}
        onChange={() => undefined}
      />,
    );

    const select = screen.getByLabelText('Mass class') as HTMLSelectElement;
    expect(select).toHaveValue('NOT_A_CLASS');
    expect(select.selectedOptions[0]).toHaveTextContent('NOT_A_CLASS (not in list)');
    expect(select.selectedOptions[0]).toBeDisabled();
    // The placeholder is for the EMPTY state and must not coexist with a value.
    expect(screen.queryByText('Select...')).not.toBeInTheDocument();
  });

  it('injects nothing for a matched value, or for the empty value (which keeps the placeholder)', () => {
    const { rerender } = render(
      <StandardDropdown aria-label="Mode" value="0.25" options={OPTIONS} onChange={() => undefined} />,
    );
    expect(screen.queryByText(/\(not in list\)/)).not.toBeInTheDocument();

    rerender(
      <StandardDropdown aria-label="Mode" value="" options={OPTIONS} onChange={() => undefined} />,
    );
    expect(screen.queryByText(/\(not in list\)/)).not.toBeInTheDocument();
    expect(screen.getByText('Select...')).toBeInTheDocument();
  });

  it('lets a real option replace the unmatched value, after which the sentinel entry is gone', () => {
    // Controlled wrapper, deliberately: this repo has already shipped one regression
    // that a static-value harness hid, because a fully controlled component
    // re-renders from the original value and every state looks immortal.
    const seen: string[] = [];
    const Controlled: React.FC = () => {
      const [value, setValue] = React.useState('NOT_A_CLASS');
      return (
        <StandardDropdown
          aria-label="Mass class"
          value={value}
          options={OPTIONS}
          onChange={(next) => {
            seen.push(next);
            setValue(next);
          }}
        />
      );
    };
    render(<Controlled />);

    const select = screen.getByLabelText('Mass class') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '0.5' } });

    expect(seen).toEqual(['0.5']);
    expect(select).toHaveValue('0.5');
    expect(screen.queryByText(/\(not in list\)/)).not.toBeInTheDocument();
  });

  it('a runtime-lied undefined value renders the placeholder alone -- never a malformed sentinel', () => {
    // The prop is typed `string`, but TypeScript lies at runtime boundaries. The
    // sentinel guard and the placeholder guard must agree on what "no value" is, or
    // an undefined smuggled through renders BOTH -- and an <option> with no value
    // attribute falls back to its own text, so " (not in list)" becomes a committable
    // DOM value. Review finding, latent (no live consumer passes a non-string).
    render(
      <StandardDropdown
        aria-label="Mode"
        value={undefined as unknown as string}
        options={OPTIONS}
        onChange={() => undefined}
      />,
    );

    expect(screen.queryByText(/\(not in list\)/)).not.toBeInTheDocument();
    expect(screen.getByText('Select...')).toBeInTheDocument();
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
