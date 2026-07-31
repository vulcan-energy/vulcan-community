// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StandardInput } from '../StandardInput';

afterEach(cleanup);

function visibleUnit(text: string): HTMLElement {
  return screen.getByText(text, { selector: '.standard-control-unit' });
}

describe('StandardInput persistent unit adornment', () => {
  it('keeps a normalized unit through focus, decimal drafting, blur, and external updates', () => {
    const onRawChange = vi.fn();

    function Harness() {
      const [value, setValue] = useState<number | string>(0.25);
      return (
        <>
          <StandardInput
            label="Frame area"
            type="number"
            value={value}
            unit="fraction"
            onChange={(event) => {
              onRawChange(event.currentTarget.value);
              setValue(event.currentTarget.value);
            }}
            onBlur={() => setValue((current) => Number(current))}
          />
          <button type="button" onClick={() => setValue(1.5)}>External update</button>
        </>
      );
    }

    render(<Harness />);

    const input = screen.getByLabelText('Frame area') as HTMLInputElement;
    expect(input.value).toBe('0.25');
    expect(visibleUnit('fraction')).toBeVisible();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0.' } });
    expect(input.value).toBe('0.');
    expect(onRawChange).toHaveBeenLastCalledWith('0.');
    expect(visibleUnit('fraction')).toBeVisible();

    fireEvent.blur(input);
    expect(input.value).toBe('0');
    expect(visibleUnit('fraction')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'External update' }));
    expect(input.value).toBe('1.5');
    expect(visibleUnit('fraction')).toBeVisible();
  });

  it('associates one accessible unit description while hiding the visual duplicate', () => {
    render(<StandardInput label="Width" value="2.4" unit="m" onChange={() => undefined} />);

    const input = screen.getByLabelText('Width');
    const visual = visibleUnit('m');
    expect(visual).toHaveAttribute('aria-hidden', 'true');

    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('Unit: m');
  });

  it.each([
    ['sm', 'default'],
    ['sm', 'ghost'],
    ['md', 'default'],
    ['md', 'ghost'],
    ['lg', 'default'],
    ['lg', 'ghost'],
  ] as const)('keeps stable %s/%s adornment layout', (size, variant) => {
    const { container } = render(
      <StandardInput
        aria-label={`${size}-${variant}`}
        value="12"
        unit="W/m²·K"
        size={size}
        variant={variant}
        onChange={() => undefined}
      />,
    );

    const shell = container.querySelector('.standard-control-shell');
    expect(shell).toHaveClass(`standard-control-shell-${size}`);
    expect(shell).toHaveClass(`standard-control-shell-${variant}`);
    expect(visibleUnit('W/m²·K')).toBeVisible();
  });

  it('retains the unit for empty, disabled, read-only, and error states', () => {
    const { rerender } = render(
      <StandardInput aria-label="Derived length" value="" unit="m" disabled onChange={() => undefined} />,
    );
    expect(visibleUnit('m')).toBeVisible();
    expect(screen.getByLabelText('Derived length')).toBeDisabled();

    rerender(
      <StandardInput aria-label="Derived length" value="3" unit="m" readOnly error="Invalid" onChange={() => undefined} />,
    );
    expect(visibleUnit('m')).toBeVisible();
    expect(screen.getByLabelText('Derived length')).toHaveAttribute('readonly');
    expect(screen.getByText('Invalid')).toBeVisible();
  });

  it('preserves the existing direct-input markup when no adornment is supplied', () => {
    const { container } = render(
      <StandardInput aria-label="Name" value="Example" onChange={() => undefined} />,
    );

    expect(container.querySelector('.standard-control-shell')).toBeNull();
    expect(screen.getByLabelText('Name').parentElement).toHaveClass('standard-input-container');
  });
});
