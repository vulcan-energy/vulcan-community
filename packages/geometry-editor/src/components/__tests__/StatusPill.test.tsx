// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusPill } from '../StatusPill';

describe('StatusPill', () => {
  it('applies the tone class and lets it override the type-driven colour class', () => {
    render(<StatusPill type="custom" tone="error" />);

    const pill = screen.getByText('Custom');
    expect(pill).toHaveClass('status-pill-custom');
    expect(pill).toHaveClass('status-pill-tone-error');
  });

  it('renders without a tone class when `tone` is omitted, keeping type-driven colouring', () => {
    render(<StatusPill type="default-used" />);

    const pill = screen.getByText('Default');
    expect(pill.className).not.toMatch(/status-pill-tone-/);
  });

  it('applies the fixed-size class only when `size="fixed"` is set', () => {
    const { rerender } = render(<StatusPill type="calculated" />);
    expect(screen.getByText('Calculated')).not.toHaveClass('status-pill-fixed');

    rerender(<StatusPill type="calculated" size="fixed" />);
    expect(screen.getByText('Calculated')).toHaveClass('status-pill-fixed');
  });

  it('defaults `inline` to true, applying the 8px-left-margin class for every existing caller', () => {
    render(<StatusPill type="no-default-schema" />);

    expect(screen.getByText('Schema')).toHaveClass('status-pill-inline');
  });

  it('opts out of the inline margin class when `inline={false}`', () => {
    render(<StatusPill type="no-default-schema" inline={false} />);

    expect(screen.getByText('Schema')).not.toHaveClass('status-pill-inline');
  });

  it('still merges a caller-supplied className alongside the new modifier classes', () => {
    render(<StatusPill type="custom" tone="success" size="fixed" className="extra-class" />);

    const pill = screen.getByText('Custom');
    expect(pill).toHaveClass('status-pill', 'status-pill-custom', 'status-pill-tone-success', 'status-pill-fixed', 'extra-class');
  });

  it('with `tone` and no `type`, emits no status-pill-<type> class and renders only the label override', () => {
    render(<StatusPill tone="warning" size="fixed" labelOverride="3 issues" />);

    const pill = screen.getByText('3 issues');
    expect(pill).toHaveClass('status-pill', 'status-pill-tone-warning');
    expect(pill.className).not.toMatch(/status-pill-(custom|calculated|default-used|no-default-schema)\b/);
  });

  it('with `tone` and no `type` and no `labelOverride`, renders no fallback word', () => {
    render(<StatusPill tone="neutral" ariaLabel="No default available" />);

    const pill = screen.getByLabelText('No default available');
    expect(pill).toHaveTextContent('');
    expect(pill.className).not.toMatch(/status-pill-(custom|calculated|default-used|no-default-schema)\b/);
  });

  it('applies `ariaLabel` as the chip\'s accessible name', () => {
    render(<StatusPill type="custom" ariaLabel="Custom value, overridden from schema default" />);

    expect(screen.getByLabelText('Custom value, overridden from schema default')).toHaveTextContent('Custom');
  });

  it('omits the aria-label attribute when `ariaLabel` is not given', () => {
    render(<StatusPill type="custom" />);

    expect(screen.getByText('Custom')).not.toHaveAttribute('aria-label');
  });
});
