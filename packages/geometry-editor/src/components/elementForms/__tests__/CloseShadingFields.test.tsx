// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Element } from '../../../geometry/types';
import { CloseShadingFields } from '../CloseShadingFields';

const window1 = (extra: Record<string, unknown> = {}) => ({
  id: 'w', name: 'Window 1', type: 'BuildingElementTransparent', zoneId: 'z', extra_json: extra,
}) as unknown as Element;
const drawnOverhang = { id: 's', name: 'Window 1 overhang', type: 'WindowShading', parent_element: 'Window 1', shading_type: 'overhang', depth: 0.4 } as unknown as Element;

describe('Shading close to the window', () => {
  it('reads None, and a side fin adds both fins until one is removed', () => {
    const updateElement = vi.fn();
    render(<CloseShadingFields windowName="Window 1" elementsById={{ w: window1() }} updateElement={updateElement} />);
    expect(screen.getByText('None')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Side fin' }));
    expect(screen.queryByText('None')).toBeNull();
    expect(screen.getByText('Left side fin')).toBeInTheDocument();
    expect(screen.getByText('Right side fin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Side fin' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the left side fin' }));
    expect(screen.queryByText('Left side fin')).toBeNull();
    // Nothing was stated, so nothing is written.
    expect(updateElement).not.toHaveBeenCalled();
  });

  it('shows a stated kind, and ✕ clears it in one write', () => {
    const updateElement = vi.fn();
    render(<CloseShadingFields windowName="Window 1" elementsById={{ w: window1({ overhang: 'common open porch', security_risk: true }) }} updateElement={updateElement} />);
    expect(screen.getByText('Overhang')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the overhang' }));
    expect(updateElement).toHaveBeenCalledTimes(1);
    expect(updateElement).toHaveBeenCalledWith('w', { extra_json: { security_risk: true } });
  });

  it('a drawn feature always shows its kind, with the drawing as the placeholder', () => {
    render(<CloseShadingFields windowName="Window 1" elementsById={{ w: window1(), s: drawnOverhang }} updateElement={vi.fn()} />);
    expect(screen.getByText('Overhang')).toBeInTheDocument();
    expect(screen.getByText('from the drawing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove the overhang' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Overhang' })).toBeNull();
  });

  it('beside a drawn feature, its one kind always shows, even before the drawing matches', () => {
    render(<CloseShadingFields windowName="Window 1" kinds={['overhang']} elementsById={{ w: window1() }} updateElement={vi.fn()} />);
    expect(screen.getByText('Window overhang')).toBeInTheDocument();
    expect(screen.getByLabelText('Window 1 overhang')).toBeInTheDocument();
    expect(screen.queryByText('Shading close to the window')).toBeNull();
  });
});
