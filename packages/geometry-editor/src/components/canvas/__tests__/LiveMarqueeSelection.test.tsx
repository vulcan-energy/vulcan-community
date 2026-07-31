// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMarqueeSelectionSignal } from '../marqueeSelectionSignal';
import { LiveMarqueeSelection } from '../LiveMarqueeSelection';

const konvaMock = vi.hoisted(() => {
  const batchDraw = vi.fn();
  return {
    batchDraw,
    rectRenderCount: 0,
    rectNode: {
      setAttrs: vi.fn(),
      getLayer: () => ({ batchDraw }),
    },
  };
});

vi.mock('react-konva', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react');
  return {
    Rect: ReactActual.forwardRef(function MockRect(props: Record<string, unknown>, ref) {
      konvaMock.rectRenderCount += 1;
      ReactActual.useImperativeHandle(ref, () => konvaMock.rectNode);
      return (
        <div
          data-testid="konva-marquee-rect"
          data-name={String(props.name ?? '')}
          data-visible={String(props.visible ?? '')}
        />
      );
    }),
  };
});

beforeEach(() => {
  konvaMock.batchDraw.mockClear();
  konvaMock.rectNode.setAttrs.mockClear();
  konvaMock.rectRenderCount = 0;
});

describe('LiveMarqueeSelection', () => {
  it('updates the Konva rect imperatively without rerendering on signal changes', () => {
    const signal = createMarqueeSelectionSignal();

    render(<LiveMarqueeSelection previewSignal={signal} />);

    expect(screen.getByTestId('konva-marquee-rect')).toHaveAttribute(
      'data-name',
      'marquee-selection-preview',
    );
    expect(konvaMock.rectRenderCount).toBe(1);

    act(() => {
      signal.set({
        isActive: true,
        startX: 10,
        startY: 20,
        endX: 40,
        endY: 70,
      });
      signal.set({
        isActive: true,
        startX: 10,
        startY: 20,
        endX: 60,
        endY: 90,
      });
    });

    expect(konvaMock.rectRenderCount).toBe(1);
    expect(konvaMock.rectNode.setAttrs).toHaveBeenLastCalledWith({
      x: 10,
      y: 20,
      width: 50,
      height: 70,
      visible: true,
    });
    expect(konvaMock.batchDraw).toHaveBeenCalled();
  });
});
