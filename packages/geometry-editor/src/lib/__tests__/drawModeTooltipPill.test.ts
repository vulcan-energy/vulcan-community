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

describe('vertex guidance chips', () => {
  const identity = (point: { x: number; y: number }) => ({ x: point.x, y: point.y });

  it('labels a selected loose duct run "Disconnected" at its free end nearest the unit', async () => {
    const { getSelectedVertexGuidance, getVertexGuidanceChips } = await import('../drawModeTooltipPill');
    const unit = { type: 'MechanicalVentilation', id: 'mv', name: 'MV', vent_type: 'MVHR', coordinates: [{ x: 0, y: 0, z: 0 }] };
    const duct = {
      type: 'MechanicalVentilationDuctwork', id: 'duct-a', name: 'duct-a', parent_element: 'MV', duct_type: 'supply',
      coordinates: [{ x: 300, y: 0, z: 0 }, { x: 50, y: 50, z: 0 }],
    };
    const elementsById = { mv: unit, 'duct-a': duct } as never;

    const chips = getVertexGuidanceChips(duct as never, getSelectedVertexGuidance(duct as never, elementsById, []), identity, null);

    expect(chips.map((chip) => chip.text)).toEqual(['Disconnected']);
    // Centred above the (50, 50) end, the one nearer the unit.
    expect(chips[0].rect.x + chips[0].rect.width / 2).toBe(50);
    expect(chips[0].rect.y).toBeLessThan(50);
  });

  it('labels a selected wall\'s unsnapped ends "Unsnapped vertex"', async () => {
    const { getSelectedVertexGuidance, getVertexGuidanceChips } = await import('../drawModeTooltipPill');
    const wall = {
      type: 'BuildingElementOpaque', id: 'wall-a', name: 'Wall A', parent_element: null,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
    };

    const chips = getVertexGuidanceChips(wall as never, getSelectedVertexGuidance(wall as never, { 'wall-a': wall } as never, []), identity, null);

    expect(chips.map((chip) => [chip.key, chip.text])).toEqual([
      ['unsnapped-chip-wall-a-0', 'Unsnapped vertex'],
      ['unsnapped-chip-wall-a-1', 'Unsnapped vertex'],
    ]);
  });
});
