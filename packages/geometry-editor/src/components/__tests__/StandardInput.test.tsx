// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StandardInput } from '../StandardInput';

describe('StandardInput', () => {
  it('should auto-select text when focused', () => {
    const mockSelect = vi.fn();
    
    // Mock the select method on HTMLInputElement
    Object.defineProperty(HTMLInputElement.prototype, 'select', {
      value: mockSelect,
      writable: true,
    });
    
    render(
      <StandardInput
        value="test value"
        onChange={() => {}}
      />
    );
    
    const input = screen.getByDisplayValue('test value');
    
    // Focus the input
    fireEvent.focus(input);
    
    // Verify that select was called
    expect(mockSelect).toHaveBeenCalled();
  });

  it('should call original onFocus handler if provided', () => {
    const mockSelect = vi.fn();
    const mockOnFocus = vi.fn();
    
    // Mock the select method on HTMLInputElement
    Object.defineProperty(HTMLInputElement.prototype, 'select', {
      value: mockSelect,
      writable: true,
    });
    
    render(
      <StandardInput
        value="test value"
        onChange={() => {}}
        onFocus={mockOnFocus}
      />
    );
    
    const input = screen.getByDisplayValue('test value');
    
    // Focus the input
    fireEvent.focus(input);
    
    // Verify that both select and the original onFocus were called
    expect(mockSelect).toHaveBeenCalled();
    expect(mockOnFocus).toHaveBeenCalled();
  });

  it('should render with label', () => {
    render(
      <StandardInput
        label="Test Label"
        value="test value"
        onChange={() => {}}
      />
    );
    
    expect(screen.getByText('Test Label')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test value')).toBeInTheDocument();
  });

  it('should render with error message', () => {
    render(
      <StandardInput
        value="test value"
        onChange={() => {}}
        error="Test error"
      />
    );
    
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('should render with helper text', () => {
    render(
      <StandardInput
        value="test value"
        onChange={() => {}}
        helperText="Test helper text"
      />
    );
    
    expect(screen.getByText('Test helper text')).toBeInTheDocument();
  });

  it('keeps decimal-zero drafts visible for numeric callers that normalize values', () => {
    const NumericHarness = () => {
      const [value, setValue] = useState(1);
      return (
        <StandardInput
          label="Height"
          type="number"
          value={value}
          onChange={(event) => setValue(Number(event.target.value))}
        />
      );
    };

    render(<NumericHarness />);

    const input = screen.getByLabelText('Height') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'decimal');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1.0' } });

    expect(input.value).toBe('1.0');
  });
});
