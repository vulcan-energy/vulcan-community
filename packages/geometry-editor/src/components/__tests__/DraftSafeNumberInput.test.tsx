// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraftSafeNumberInput } from '../DraftSafeNumberInput';

describe('DraftSafeNumberInput', () => {
  it('preserves decimal-zero drafts when the parent normalizes to a number', () => {
    const NumericHarness = () => {
      const [value, setValue] = useState(1);
      return (
        <DraftSafeNumberInput
          aria-label="Numeric value"
          value={value}
          onChange={(event) => setValue(Number(event.currentTarget.value))}
        />
      );
    };

    render(<NumericHarness />);

    const input = screen.getByLabelText('Numeric value') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'decimal');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1.0' } });

    expect(input.value).toBe('1.0');
  });

  it('forwards refs to the rendered input', () => {
    const RefHarness = () => {
      const inputRef = useRef<HTMLInputElement | null>(null);
      return (
        <>
          <DraftSafeNumberInput ref={inputRef} aria-label="Value" defaultValue="1" />
          <button type="button" onClick={() => inputRef.current?.focus()}>
            Focus
          </button>
        </>
      );
    };

    render(<RefHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));

    expect(screen.getByLabelText('Value')).toHaveFocus();
  });

  it('passes through change and blur events', () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();

    render(
      <DraftSafeNumberInput
        aria-label="Numeric value"
        value="1"
        onChange={onChange}
        onBlur={onBlur}
      />
    );

    const input = screen.getByLabelText('Numeric value');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1.05' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalled();
    expect(onBlur).toHaveBeenCalled();
  });
});
