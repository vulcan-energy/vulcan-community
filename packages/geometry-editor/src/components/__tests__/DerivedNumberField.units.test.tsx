// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DerivedNumberField } from '../DerivedNumberField';

describe('DerivedNumberField persistent units', () => {
  it('renders its supplied unit outside the draft value and exposes it accessibly', () => {
    render(
      <DerivedNumberField
        label="Ground Floor Area"
        unit="m²"
        derivedValue={48.5}
        manualValue={undefined}
        onChange={vi.fn()}
        resetTitle="Reset"
        resetAriaLabel="Reset area"
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('48.5');
    const descriptionId = input.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toContain('Unit: m²');
    expect(screen.getByText('m²').getAttribute('aria-hidden')).toBe('true');
  });
});
