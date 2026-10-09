// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DrawingPreview,
  getDrawModeTooltipText,
  getHoverHintText,
  type DrawingPreviewProps,
} from '../DrawingPreview';

vi.mock('react-konva', () => {
  const Group = ({ children }: { children?: React.ReactNode }) => <div data-testid="konva-group">{children}</div>;
  const Line = ({ points, stroke }: { points?: number[]; stroke?: string }) => (
    <div data-testid="konva-line" data-points={JSON.stringify(points ?? [])} data-stroke={stroke ?? ''} />
  );
  const Circle = ({ fill }: { fill?: string }) => <div data-testid="konva-circle" data-fill={fill ?? ''} />;
  const Rect = ({ fill }: { fill?: string }) => <div data-testid="konva-rect" data-fill={fill ?? ''} />;
  const Text = ({ text, fill }: { text?: string; fill?: string }) => (
    <div data-testid="konva-text" data-text={text ?? ''} data-fill={fill ?? ''} />
  );
  return { Group, Line, Circle, Rect, Text };
});

const sharedDrawingPalette = {
  guide: '#ddee63',
  guideFill: 'rgba(221, 238, 99, 0.14)',
  snap: '#1e90ff',
  snapText: '#ffffff',
  handleFill: '#ddee63',
  handleStroke: '#ffffff',
  tooltipBg: 'rgba(18, 31, 34, 0.9)',
  tooltipBorder: 'rgba(255, 255, 255, 0.14)',
  tooltipText: '#ffffff',
  tooltipShadow: 'rgba(0, 0, 0, 0.22)',
};

function previewProps(overrides: Partial<DrawingPreviewProps> = {}): DrawingPreviewProps {
  return {
    drawMode: 'line',
    drawPoints: [{ x: 1, y: 1 }],
    drawCursor: { x: 2, y: 2 },
    drawAngleSnapped: false,
    drawSnapTargetRef: { current: null },
    roomWalls: [],
    orthogonalRoomStart: null,
    orthogonalRoomEnd: null,
    scale: 10,
    panOffset: { x: 0, y: 0 },
    canvasCenter: { x: 0, y: 0 },
    drawElementType: 'BuildingElementOpaque',
    multiDrawModifierHeld: false,
    pvFootprintPreview: null,
    dormerDrawPreviewCutout: null,
    drawingTooltip: { visible: false, text: '', position: { x: 0, y: 0 } },
    segmentLengthPreview: { visible: false, text: '', position: { x: 0, y: 0 } },
    canvasPalette: sharedDrawingPalette,
    ...overrides,
  };
}

describe('DrawingPreview', () => {
  it('uses a shared canvas palette without resolving CSS variables during live render', () => {
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
      getPropertyValue: vi.fn(() => ''),
    }) as any);
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: vi.fn(() => ({ width: 120 })),
      font: '',
    } as any);

    try {
      render(<DrawingPreview {...previewProps()} />);

      expect(getComputedStyleSpy).not.toHaveBeenCalled();
    } finally {
      getComputedStyleSpy.mockRestore();
      getContextSpy.mockRestore();
    }
  });
});

describe('tooltip copy', () => {
  const text = (mode: any, n: number, held: boolean, type: any = 'BuildingElementOpaque') =>
    getDrawModeTooltipText(mode, Array(n).fill({ x: 0, y: 0 }), [], null, null, null, { current: null }, type, held);

  it('keeps the draw-mode strings', () => {
    expect(text('point', 0, false)).toBe('Place object (Alt/Option+Click for multi-draw)');
    expect(text('point', 0, true)).toBe('Place object + continue');
    expect(text('line', 1, false)).toBe('Place final point (Alt/Option+Click for multi-draw)');
    expect(text('line', 1, true)).toBe('Place end point + continue');
    expect(text('tb-plan-line', 1, false)).toBe('Place final point (Alt/Option+Click to keep drawing; P/V/S switches shape)');
    expect(text('tb-plan-line', 1, true)).toBe('Place end point + continue (P/V/S switches shape)');
    expect(text('tb-vertical-line', 0, false)).toBe('Place vertical run (Alt/Option+Click to keep drawing; P/V/S switches shape)');
    expect(text('tb-vertical-line', 0, true)).toBe('Place vertical run + continue (P/V/S switches shape)');
    expect(text('tb-vertical-line', 1, false)).toBe('Create vertical run from current point (Alt/Option+Click to keep drawing; P/V/S switches shape)');
    expect(text('tb-vertical-line', 1, true)).toBe('Create vertical run + continue (P/V/S switches shape)');
    expect(text('tb-slope-line', 1, false)).toBe('Place second point (Alt/Option+Click to keep drawing; P/V/S switches shape)');
    expect(text('tb-slope-line', 1, true)).toBe('Place end point + continue (P/V/S switches shape)');
  });

  it('hover hints', () => {
    expect(getHoverHintText({ kind: 'rotate-grip', dragging: false })).toBe('Drag to rotate');
    expect(getHoverHintText({ kind: 'rotate-grip', dragging: true })).toBeNull();
    expect(getHoverHintText({ kind: 'vertex', dragging: true })).toBe('Shift: no snap');
    expect(getHoverHintText({ kind: 'body', dragging: false })).toBeNull();
  });
});
