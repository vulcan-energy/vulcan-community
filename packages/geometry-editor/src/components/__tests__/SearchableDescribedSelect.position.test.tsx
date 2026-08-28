// @vitest-environment jsdom
// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchableDescribedSelect } from '../SearchableDescribedSelect';

const rect = (values: Partial<DOMRect>): DOMRect => ({
  x: values.left ?? 0,
  y: values.top ?? 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
  ...values,
});

describe('SearchableDescribedSelect positioning', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('anchors a short menu immediately above its trigger and clamps the widened menu inside the viewport', () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    });
    vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue(
      rect({
        left: 750,
        right: 950,
        top: 700,
        bottom: 740,
        width: 200,
        height: 40,
      }),
    );

    render(
      <SearchableDescribedSelect
        value=""
        onChange={vi.fn()}
        placeholder="Choose…"
        menuMinWidth={360}
        sections={[
          {
            options: [
              { value: '1', label: 'One' },
              { value: '2', label: 'Two' },
            ],
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    act(() => vi.advanceTimersByTime(20));

    const menu = screen.getByRole('listbox');
    expect(menu).toHaveStyle({
      left: '628px',
      bottom: '108px',
      width: '360px',
    });
    expect(menu.style.top).toBe('');
  });

  it('anchors below when there is room and uses the requested compact trigger size', () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    });
    vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue(
      rect({
        left: 20,
        right: 220,
        top: 100,
        bottom: 140,
        width: 200,
        height: 40,
      }),
    );

    render(
      <SearchableDescribedSelect
        value=""
        onChange={vi.fn()}
        placeholder="Choose…"
        triggerVariant="standard"
        triggerSize="sm"
        menuMinWidth={360}
        sections={[{ options: [{ value: '1', label: 'One' }] }]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Choose…' });
    expect(trigger).toHaveClass('standard-dropdown-sm');
    fireEvent.click(trigger);
    act(() => vi.advanceTimersByTime(20));

    const menu = screen.getByRole('listbox');
    expect(menu).toHaveStyle({ left: '20px', top: '148px', width: '360px' });
    expect(menu.style.bottom).toBe('');
  });
});
