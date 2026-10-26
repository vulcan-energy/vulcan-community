// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Element } from '../../../geometry/types';
import { useLiveDrawReport } from '../../../hooks/useDrawingMode';
import { easePointsToward } from '../../../lib/geometryTransform';
import { beginCanvasInteraction, reportLiveDragEdits, type GeometryCanvasLiveEdit } from '../canvasInteractionSession';
import { createDrawingPreviewSignal } from '../drawingPreviewSignal';
import { updateElementShapeNodeRefsFromCoords } from '../elementDragPreview';
import { PeopleControl } from '../ElementsZonesPanel';

const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

describe('easePointsToward (remote cursor interpolation)', () => {
  it('starts a new cursor at its target, eases an existing one, settles, and drops one no longer targeted', () => {
    const displayed = new Map<string, { x: number; y: number }>();
    expect(easePointsToward(displayed, [{ key: 'a', x: 1, y: 2 }], 16, 50)).toBe(false);
    expect(displayed.get('a')).toEqual({ x: 1, y: 2 });

    // A jump of 1 m: part of the way in one frame, nearly all of it by 150 ms.
    expect(easePointsToward(displayed, [{ key: 'a', x: 2, y: 2 }], 16, 50)).toBe(true);
    const afterFrame = displayed.get('a')!.x;
    expect(afterFrame).toBeGreaterThan(1.2);
    expect(afterFrame).toBeLessThan(1.4);
    for (let elapsed = 16; elapsed < 150; elapsed += 16) easePointsToward(displayed, [{ key: 'a', x: 2, y: 2 }], 16, 50);
    expect(displayed.get('a')!.x).toBeGreaterThan(1.95);
    for (let frame = 0; frame < 30; frame += 1) easePointsToward(displayed, [{ key: 'a', x: 2, y: 2 }], 16, 50);
    expect(easePointsToward(displayed, [{ key: 'a', x: 2, y: 2 }], 16, 50)).toBe(false);
    expect(displayed.get('a')).toEqual({ x: 2, y: 2 });

    easePointsToward(displayed, [], 16, 50);
    expect(displayed.size).toBe(0);
  });
});

describe('PeopleControl', () => {
  it('renders nothing when nobody else is here', () => {
    const { container } = render(<PeopleControl people={{ items: [], followingKey: null, onFollow: vi.fn() }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists people with at most one qualifier and follows on click', () => {
    const onFollow = vi.fn();
    render(
      <PeopleControl
        people={{
          items: [
            { key: 'u-alex', name: 'Alex', color: 'red', initials: 'A', qualifier: 'F2' },
            { key: 'u-sam', name: 'Sam', color: 'blue', initials: 'S' },
          ],
          followingKey: 'u-sam',
          onFollow,
        }}
      />,
    );
    const alex = screen.getByRole('button', { name: /Alex/ });
    expect(alex).toHaveTextContent('AAlexF2');
    expect(alex).toHaveAttribute('aria-pressed', 'false');
    const sam = screen.getByRole('button', { name: /Sam/ });
    expect(sam).toHaveTextContent(/^SSam$/);
    expect(sam).toHaveAttribute('aria-pressed', 'true');
    expect(sam).toHaveAttribute('title', 'Following · click to stop');
    fireEvent.click(alex);
    expect(onFollow).toHaveBeenCalledWith('u-alex');
  });
});

describe('live edit reports', () => {
  it('reports a drag\'s previewed elements once a frame, then end on commit or cancel without one', async () => {
    const edits: GeometryCanvasLiveEdit[] = [];
    const stop = reportLiveDragEdits((edit) => edits.push(edit));
    const wall = { id: 'e1', type: 'BuildingElementOpaque', name: 'W1', coordinates: [] } as unknown as Element;
    const preview = (x: number) => updateElementShapeNodeRefsFromCoords({}, wall, [{ x, y: 0 }, { x: x + 2, y: 0 }], 1, { x: 0, y: 0 }, { x: 0, y: 0 });

    const drag = beginCanvasInteraction({ kind: 'selected-shape-drag' })!;
    preview(1);
    preview(2);
    await nextFrame();
    drag.end({ committed: true });
    expect(edits).toEqual([
      { kind: 'drag', phase: 'move', elements: [{ section: 'BuildingElementOpaque', name: 'W1', points: [[2, 0], [4, 0]] }] },
      { kind: 'drag', phase: 'end' },
    ]);

    // Released without a commit: cancel, and the frame's pending move never goes.
    const uncommitted = beginCanvasInteraction({ kind: 'vertex-drag' })!;
    preview(3);
    uncommitted.end({ committed: false });
    await nextFrame();
    expect(edits.slice(2)).toEqual([{ kind: 'drag', phase: 'cancel' }]);

    // A preview outside any gesture (a restore after one) is not an edit.
    preview(4);
    await nextFrame();
    expect(edits).toHaveLength(3);
    stop();
  });

  it('reports a drawing\'s points and snapped cursor, then end when it made an element or cancel when dropped', async () => {
    const signal = createDrawingPreviewSignal();
    const onLiveEdit = vi.fn();
    let count = 5;
    const { rerender } = renderHook(
      ({ points }) => useLiveDrawReport(onLiveEdit, points, signal, () => count),
      { initialProps: { points: [{ x: 0, y: 0 }] } },
    );
    expect(onLiveEdit).toHaveBeenLastCalledWith({ kind: 'draw', phase: 'move', points: [[0, 0]] });
    act(() => signal.set({ drawCursor: { x: 2, y: 1 } }));
    await nextFrame();
    expect(onLiveEdit).toHaveBeenLastCalledWith({ kind: 'draw', phase: 'move', points: [[0, 0]], cursor: [2, 1] });

    count = 6;
    rerender({ points: [] });
    expect(onLiveEdit).toHaveBeenLastCalledWith({ kind: 'draw', phase: 'end' });

    rerender({ points: [{ x: 1, y: 1 }] });
    rerender({ points: [] });
    expect(onLiveEdit).toHaveBeenLastCalledWith({ kind: 'draw', phase: 'cancel' });
  });
});
