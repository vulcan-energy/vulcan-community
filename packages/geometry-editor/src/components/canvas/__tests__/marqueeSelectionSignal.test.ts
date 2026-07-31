// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_MARQUEE_SELECTION,
  createMarqueeSelectionSignal,
} from '../marqueeSelectionSignal';

describe('marquee selection signal', () => {
  it('notifies subscribers only when the live marquee rectangle changes', () => {
    const signal = createMarqueeSelectionSignal();
    const subscriber = vi.fn();

    signal.subscribe(subscriber);

    signal.set({
      isActive: true,
      startX: 10,
      startY: 20,
      endX: 10,
      endY: 20,
    });
    signal.set({
      isActive: true,
      startX: 10,
      startY: 20,
      endX: 10,
      endY: 20,
    });
    signal.set({
      isActive: true,
      startX: 10,
      startY: 20,
      endX: 40,
      endY: 60,
    });

    expect(subscriber).toHaveBeenCalledTimes(2);
    expect(signal.getSnapshot()).toEqual({
      isActive: true,
      startX: 10,
      startY: 20,
      endX: 40,
      endY: 60,
    });
  });

  it('resets to the shared empty marquee state', () => {
    const signal = createMarqueeSelectionSignal({
      isActive: true,
      startX: 1,
      startY: 2,
      endX: 3,
      endY: 4,
    });

    signal.reset();

    expect(signal.getSnapshot()).toBe(EMPTY_MARQUEE_SELECTION);
  });
});
