// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { createSnapFeedbackSignal } from '../snapFeedbackSignal';

describe('snap feedback signal', () => {
  it('notifies on event change (including position) and stays silent on identical frames', () => {
    const signal = createSnapFeedbackSignal();
    const subscriber = vi.fn();
    signal.subscribe(subscriber);

    signal.set({
      event: {
        kind: 'corner',
        sourceElementId: 'wall-1',
        sourceVertexOrder: 0,
        position: { x: 1, y: 2 },
      },
    });
    expect(subscriber).toHaveBeenCalledTimes(1);

    signal.set({
      event: {
        kind: 'corner',
        sourceElementId: 'wall-1',
        sourceVertexOrder: 0,
        position: { x: 1, y: 2 },
      },
    });
    expect(subscriber).toHaveBeenCalledTimes(1);

    signal.set({
      event: {
        kind: 'corner',
        sourceElementId: 'wall-1',
        sourceVertexOrder: 0,
        position: { x: 1.1, y: 2 },
      },
    });
    expect(subscriber).toHaveBeenCalledTimes(2);

    signal.set({
      event: {
        kind: 'corner',
        sourceElementId: 'wall-2',
        sourceVertexOrder: 0,
        position: { x: 1.1, y: 2 },
      },
    });
    expect(subscriber).toHaveBeenCalledTimes(3);

    signal.set({ event: null });
    expect(subscriber).toHaveBeenCalledTimes(4);
    expect(signal.getSnapshot()).toEqual({ event: null });

    signal.reset();
    expect(subscriber).toHaveBeenCalledTimes(4);
  });
});
