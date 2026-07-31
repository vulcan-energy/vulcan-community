// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { shouldStartStagePanGesture } from '../stagePanGesture';

describe('shouldStartStagePanGesture', () => {
  it('starts a 2D pan from middle mouse drag even when no drawing tool is active', () => {
    expect(shouldStartStagePanGesture({
      drawMode: 'none',
      mouseButton: 1,
      panModifierHeld: false,
      pointerAvailable: true,
      viewMode: '2d',
    })).toBe(true);
  });

  it('keeps left mouse drag available for marquee selection when not drawing', () => {
    expect(shouldStartStagePanGesture({
      drawMode: 'none',
      mouseButton: 0,
      panModifierHeld: false,
      pointerAvailable: true,
      viewMode: '2d',
    })).toBe(false);
  });

  it('keeps Space drag as a drawing-mode pan shortcut', () => {
    expect(shouldStartStagePanGesture({
      drawMode: 'line',
      mouseButton: 0,
      panModifierHeld: true,
      pointerAvailable: true,
      viewMode: '2d',
    })).toBe(true);
  });

  it('does not start the 2D stage pan while the 3D view is active', () => {
    expect(shouldStartStagePanGesture({
      drawMode: 'none',
      mouseButton: 1,
      panModifierHeld: false,
      pointerAvailable: true,
      viewMode: '3d',
    })).toBe(false);
  });
});
