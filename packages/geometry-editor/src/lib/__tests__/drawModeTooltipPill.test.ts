// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('draw mode tooltip pill width', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('caches canvas text measurements by label', async () => {
    const measureText = vi.fn((text: string) => ({ width: text.length * 6 }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText,
    } as unknown as CanvasRenderingContext2D);

    const { getDrawModeTooltipPillWidth } = await import('../drawModeTooltipPill');

    const first = getDrawModeTooltipPillWidth('2.40m');
    const second = getDrawModeTooltipPillWidth('2.40m');
    const third = getDrawModeTooltipPillWidth('12.30m');

    expect(second).toBe(first);
    expect(third).not.toBe(first);
    expect(measureText).toHaveBeenCalledTimes(2);
  });
});
