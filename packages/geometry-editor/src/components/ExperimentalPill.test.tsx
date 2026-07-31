// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExperimentalPill, DEFAULT_EXPERIMENTAL_TOOLTIP } from './ExperimentalPill';

describe('ExperimentalPill', () => {
  it('renders label', () => {
    render(<ExperimentalPill label="Try me" />);
    expect(screen.getByText('Try me')).toBeInTheDocument();
  });

  it('shows tooltip text while hovering (portal to body)', async () => {
    const user = userEvent.setup();
    render(<ExperimentalPill tooltipText="Custom tip for tests." />);
    const pill = screen.getByText('Experimental');
    await user.hover(pill);
    const tips = document.body.querySelectorAll('[role="tooltip"]');
    expect(tips.length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).toContain('Custom tip for tests.');
    await user.unhover(pill);
  });

  it('exports a sensible default tooltip string', () => {
    expect(DEFAULT_EXPERIMENTAL_TOOLTIP.length).toBeGreaterThan(40);
    expect(DEFAULT_EXPERIMENTAL_TOOLTIP.toLowerCase()).toMatch(/review|careful|improved/);
  });
});
