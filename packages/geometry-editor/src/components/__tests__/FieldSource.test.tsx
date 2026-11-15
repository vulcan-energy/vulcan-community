// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DerivedSource, Readout, SourceNote } from '../FieldSource';

afterEach(cleanup);

const note = <SourceNote>from the drawing</SourceNote>;

describe('DerivedSource', () => {
  it('shows nothing while the drawing is incomplete (nothing to derive)', () => {
    const { container } = render(<DerivedSource derived={null} current={2} note={note} onUse={vi.fn()} fieldLabel="Base height" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the note while the value follows the drawing, and "Use the drawing" once it differs', () => {
    const onUse = vi.fn();
    const { rerender } = render(<DerivedSource derived={1.65} current={1.65} note={note} onUse={onUse} unit="m" fieldLabel="Mid height" />);
    expect(screen.getByText('from the drawing')).toBeInTheDocument();
    rerender(<DerivedSource derived={1.65} current={2} note={note} onUse={onUse} unit="m" fieldLabel="Mid height" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mid height: use the drawing, 1.65 m' }));
    expect(onUse).toHaveBeenCalledWith(1.65);
  });

  it('keeps an authored value equal to the drawing as yours when the caller has a marker', () => {
    render(<DerivedSource derived={3} current={3} overridden note={note} onUse={vi.fn()} unit="m" fieldLabel="Height" />);
    expect(screen.getByRole('button', { name: 'Height: use the drawing, 3 m' })).toBeInTheDocument();
  });
});

describe('Readout', () => {
  it('is labelled text, selectable, and a dash when the drawing gives nothing', () => {
    const { rerender } = render(<Readout value="6.65" unit="m²" label="Area" />);
    const out = screen.getByRole('status', { name: 'Area' });
    expect(out.tagName).toBe('OUTPUT');
    expect(out).toHaveTextContent('6.65m²');
    expect(screen.queryByRole('textbox')).toBeNull();
    rerender(<Readout value="" unit="m²" label="Area" />);
    expect(screen.getByRole('status', { name: 'Area' })).toHaveTextContent('—');
  });
});
