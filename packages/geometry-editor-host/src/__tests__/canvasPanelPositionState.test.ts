// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  pruneUnavailableCanvasPanelPositions,
  readCanvasPanelPosition,
  resetCanvasPanelPosition,
  setCanvasPanelPosition,
} from '../index';

const panelId = 'test-panel';
const defaultPosition = { x: 136, y: 64 };
const draggedPosition = { x: 200, y: 120 };

describe('canvas panel position state', () => {
  it('preserves a dragged position across display-only hide/show', () => {
    const dragged = setCanvasPanelPosition({}, panelId, draggedPosition);

    const displayHidden = pruneUnavailableCanvasPanelPositions(
      dragged,
      new Set([panelId]),
    );
    const displayShown = pruneUnavailableCanvasPanelPositions(
      displayHidden,
      new Set([panelId]),
    );

    expect(displayHidden).toBe(dragged);
    expect(displayShown).toBe(dragged);
    expect(readCanvasPanelPosition(displayShown, panelId, defaultPosition)).toEqual(
      draggedPosition,
    );
  });

  it('prunes position when availability is lost so reavailability uses the default', () => {
    const dragged = setCanvasPanelPosition({}, panelId, draggedPosition);
    const unavailable = pruneUnavailableCanvasPanelPositions(dragged, new Set());

    expect(unavailable).not.toHaveProperty(panelId);
    expect(readCanvasPanelPosition(unavailable, panelId, defaultPosition)).toBe(
      defaultPosition,
    );
  });

  it('returns an explicitly reset panel to its default position', () => {
    const dragged = setCanvasPanelPosition({}, panelId, draggedPosition);
    const reset = resetCanvasPanelPosition(dragged, panelId);

    expect(reset).not.toHaveProperty(panelId);
    expect(readCanvasPanelPosition(reset, panelId, defaultPosition)).toBe(
      defaultPosition,
    );
  });
});
