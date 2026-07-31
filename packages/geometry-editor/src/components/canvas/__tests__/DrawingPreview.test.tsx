// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DrawingPreview, type DrawingPreviewProps } from '../DrawingPreview';

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
