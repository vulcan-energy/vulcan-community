// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_SEGMENT_LENGTH_PREVIEW,
  createDrawingPreviewSignal,
} from '../drawingPreviewSignal';

describe('drawing preview signal', () => {
  it('notifies subscribers only when live preview values change', () => {
    const signal = createDrawingPreviewSignal();
    const subscriber = vi.fn();
    const unsubscribe = signal.subscribe(subscriber);

    signal.set({
      drawCursor: { x: 1, y: 2 },
      drawAngleSnapped: true,
      segmentLengthPreview: {
        visible: true,
        text: '1.00m',
        position: { x: 10, y: 20 },
      },
    });

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(signal.getSnapshot()).toEqual({
      drawCursor: { x: 1, y: 2 },
      drawAngleSnapped: true,
      segmentLengthPreview: {
        visible: true,
        text: '1.00m',
        position: { x: 10, y: 20 },
      },
    });

    signal.set({
      drawCursor: { x: 1, y: 2 },
      drawAngleSnapped: true,
      segmentLengthPreview: {
        visible: true,
        text: '1.00m',
        position: { x: 10, y: 20 },
      },
    });

    expect(subscriber).toHaveBeenCalledTimes(1);

    signal.reset();

    expect(subscriber).toHaveBeenCalledTimes(2);
    expect(signal.getSnapshot().drawCursor).toBeNull();

    unsubscribe();
    signal.set({ drawCursor: { x: 2, y: 3 } });

    expect(subscriber).toHaveBeenCalledTimes(2);
  });

  it('reuses the shared empty segment preview when clearing live drawing state', () => {
    const signal = createDrawingPreviewSignal({
      drawCursor: { x: 1, y: 1 },
      segmentLengthPreview: {
        visible: true,
        text: '2.00m',
        position: { x: 10, y: 10 },
      },
    });

    signal.reset();

    expect(signal.getSnapshot().segmentLengthPreview).toBe(EMPTY_SEGMENT_LENGTH_PREVIEW);
  });
});
