// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { WallShapeRows, type WallShapeCommit } from '../WallShapeRows';
import type { ProfileLineFace, ProfilePoint } from '../../lib/profileLineFace';
import type { WallRoofEdge } from '../../lib/wallEdgeFromRoofs';

// Stands in for the store: commits become the next props, as they do in ElementCreator.
function Harness({ roof, onCommit }: { roof: { current: ProfilePoint[] | null }; onCommit: (c: WallShapeCommit) => void }) {
  const [state, setState] = useState<{ face: ProfileLineFace | null; height: number }>({ face: null, height: 2.5 });
  const fitRoof = (edge: 'top' | 'bottom'): WallRoofEdge | null =>
    edge === 'bottom' && roof.current ? { profile: roof.current, roofNames: ['Rear roof'] } : null;
  return (
    <WallShapeRows
      widthM={4}
      face={state.face}
      height={state.height}
      roofModes
      fitRoof={fitRoof}
      onCommit={(c) => {
        onCommit(c);
        setState((s) => ('face' in c ? { ...s, face: c.face } : { face: null, height: c.flatHeight }));
      }}
    >
      <input aria-label="Height" readOnly value={state.height} />
    </WallShapeRows>
  );
}

const lastFace = (spy: ReturnType<typeof vi.fn>): ProfileLineFace => {
  const c = spy.mock.calls.at(-1)![0] as WallShapeCommit;
  if (!('face' in c)) throw new Error('expected a face commit');
  return c.face;
};
const edge = (name: 'top' | 'bottom') => within(screen.getByTestId(`wall-shape-${name}`));

describe('WallShapeRows', () => {
  it('adds a point without changing the shape and removes a chosen middle point', () => {
    const onCommit = vi.fn();
    render(<Harness roof={{ current: null }} onCommit={onCommit} />);

    expect(screen.getByLabelText('Height')).toBeTruthy();
    fireEvent.click(edge('top').getByRole('button', { name: 'Custom' }));
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '+ Add point' }));
    // Still flat at 2.5 m, now with three points: stored as a face so the point stays.
    expect(lastFace(onCommit).top_profile).toEqual([{ t: 0, h: 2.5 }, { t: 0.5, h: 2.5 }, { t: 1, h: 2.5 }]);

    fireEvent.click(screen.getByRole('button', { name: '+ Add point' }));
    fireEvent.change(screen.getByLabelText('Top point 3 height above base (m)'), { target: { value: '3' } });
    expect(lastFace(onCommit).top_profile.map((p) => p.h)).toEqual([2.5, 2.5, 3, 2.5]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove top point 2' }));
    expect(lastFace(onCommit).top_profile).toEqual([{ t: 0, h: 2.5 }, { t: 0.5, h: 3 }, { t: 1, h: 2.5 }]);
  });

  it('seeds a custom bottom from the roof line and shows Re-fit when the roof moves', () => {
    const onCommit = vi.fn();
    const roof = { current: [{ t: 0, h: 0 }, { t: 1, h: 1 }] as ProfilePoint[] | null };
    const { rerender } = render(<Harness roof={roof} onCommit={onCommit} />);

    fireEvent.click(edge('bottom').getByRole('button', { name: 'On roof' }));
    expect(lastFace(onCommit)).toMatchObject({ bottom_profile: roof.current, bottom_mode: 'roof' });
    expect(edge('bottom').getByText('Rear roof')).toBeTruthy();
    expect(screen.queryByText('Roof changed')).toBeNull();

    roof.current = [{ t: 0, h: 0 }, { t: 1, h: 1.4 }];
    rerender(<Harness roof={roof} onCommit={onCommit} />);
    expect(screen.getByText('Roof changed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Re-fit' }));
    expect(lastFace(onCommit).bottom_profile).toEqual(roof.current);
    expect(screen.queryByText('Roof changed')).toBeNull();

    fireEvent.click(edge('bottom').getByRole('button', { name: 'Custom' }));
    const face = lastFace(onCommit);
    expect(face.bottom_profile).toEqual(roof.current);
    expect(face.bottom_mode).toBeUndefined();
    expect((screen.getByLabelText('Bottom point 2 height above base (m)') as HTMLInputElement).value).toBe('1.4');
  });

  it('shows an invalid edit and does not commit it', () => {
    const onCommit = vi.fn();
    render(<Harness roof={{ current: null }} onCommit={onCommit} />);
    fireEvent.click(edge('bottom').getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Bottom point 2 height above base (m)'), { target: { value: '3' } });

    expect(screen.getByRole('alert').textContent).toBe('Top must be above bottom (at 4.00 m).');
    expect(onCommit).not.toHaveBeenCalled();
    expect(edge('bottom').getByRole('button', { name: 'On roof' })).toHaveProperty('title', 'No roof under this wall');
  });
});
