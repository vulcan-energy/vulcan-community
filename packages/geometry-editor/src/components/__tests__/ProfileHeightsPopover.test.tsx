// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProfileHeightsPopover } from '../ProfileHeightsPopover';

describe('ProfileHeightsPopover', () => {
  it('preserves decimal-zero profile top height drafts and applies parsed values', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();

    render(
      <ProfileHeightsPopover
        open
        initialHeights={[1, 2]}
        onApply={onApply}
        onClose={onClose}
        onClear={vi.fn()}
      />
    );

    const firstHeightInput = screen.getByLabelText('Top height at point 1 (metres)') as HTMLInputElement;
    expect(firstHeightInput).toHaveAttribute('type', 'text');

    fireEvent.change(firstHeightInput, { target: { value: '1.0' } });
    expect(firstHeightInput.value).toBe('1.0');

    fireEvent.change(firstHeightInput, { target: { value: '1.05' } });
    expect(firstHeightInput.value).toBe('1.05');

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith([1.05, 2]);
    expect(onClose).toHaveBeenCalled();
  });
});
