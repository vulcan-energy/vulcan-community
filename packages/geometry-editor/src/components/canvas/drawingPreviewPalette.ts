// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readRootCssVar } from './elementRendererPalette';

export type DrawingCanvasPalette = {
  guide: string;
  guideFill: string;
  snap: string;
  snapText: string;
  handleFill: string;
  handleStroke: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipShadow: string;
};

export function readDrawingCanvasPalette(): DrawingCanvasPalette {
  return {
    guide: readRootCssVar('--canvas-drawing-guide', '#DDEE63'),
    guideFill: readRootCssVar('--canvas-drawing-guide-fill', 'rgba(221, 238, 99, 0.14)'),
    snap: readRootCssVar('--semantic-snap', '#1E90FF'),
    snapText: readRootCssVar('--semantic-on-color', '#FFFFFF'),
    handleFill: readRootCssVar('--canvas-drawing-handle-fill', '#DDEE63'),
    handleStroke: readRootCssVar('--canvas-drawing-handle-stroke', '#FFFFFF'),
    tooltipBg: readRootCssVar('--canvas-drawing-tooltip-bg', 'rgba(18, 31, 34, 0.9)'),
    tooltipBorder: readRootCssVar('--canvas-drawing-tooltip-border', 'rgba(255, 255, 255, 0.14)'),
    tooltipText: readRootCssVar('--canvas-drawing-tooltip-text', '#FFFFFF'),
    tooltipShadow: readRootCssVar('--canvas-drawing-tooltip-shadow', 'rgba(0, 0, 0, 0.22)'),
  };
}
