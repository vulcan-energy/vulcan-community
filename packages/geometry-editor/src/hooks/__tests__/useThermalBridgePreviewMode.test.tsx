// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThermalBridgePreviewMode } from '../useThermalBridgePreviewMode';

function keyDown(key: string, init: KeyboardEventInit = {}, target: HTMLElement = document.body) {
  fireEvent.keyDown(target, { key, bubbles: true, ...init });
}

function keyUp(key: string, init: KeyboardEventInit = {}, target: HTMLElement = document.body) {
  fireEvent.keyUp(target, { key, bubbles: true, ...init });
}

describe('useThermalBridgePreviewMode', () => {
  afterEach(() => {
    document.querySelector('[data-suppress-canvas-keyboard]')?.remove();
    vi.restoreAllMocks();
  });

  it('starts only for an unmodified A press outside editable controls or suppressed modals', () => {
    const { result } = renderHook(() =>
      useThermalBridgePreviewMode({ enabled: true, scopeKey: 'floor-1:2d', blocked: false }),
    );

    keyDown('a', { ctrlKey: true });
    keyDown('a', { metaKey: true });
    keyDown('a', { altKey: true });
    const input = document.createElement('input');
    document.body.append(input);
    keyDown('a', {}, input);
    input.remove();
    const modal = document.createElement('div');
    modal.setAttribute('data-suppress-canvas-keyboard', '');
    document.body.append(modal);
    keyDown('a');
    modal.remove();

    expect(result.current.active).toBe(false);

    keyDown('a');
    expect(result.current).toMatchObject({ active: true, held: true, pinned: false });
  });

  it('ignores repeated keydown work and releases on A keyup', () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useThermalBridgePreviewMode({ enabled: true, scopeKey: 'floor-1:2d', blocked: false });
    });

    keyDown('a');
    const renderCountAtStart = renderCount;
    keyDown('a', { repeat: true });
    expect(renderCount).toBe(renderCountAtStart);
    expect(result.current.held).toBe(true);

    keyUp('a');
    expect(result.current).toMatchObject({ active: false, held: false, pinned: false });
  });

  it('keeps a pin after A is released, then dismisses it with Escape before canvas handlers run', () => {
    const canvasEscapeHandler = vi.fn();
    window.addEventListener('keydown', canvasEscapeHandler);
    const { result } = renderHook(() =>
      useThermalBridgePreviewMode({ enabled: true, scopeKey: 'floor-1:2d', blocked: false }),
    );

    keyDown('a');
    act(() => result.current.pin());
    keyUp('a');
    expect(result.current).toMatchObject({ active: true, held: false, pinned: true });
    canvasEscapeHandler.mockClear();

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => document.body.dispatchEvent(escape));
    window.removeEventListener('keydown', canvasEscapeHandler);
    expect(escape.defaultPrevented).toBe(true);
    expect(canvasEscapeHandler).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ active: false, held: false, pinned: false });
  });

  it('unpins the chooser while keeping an actively held preview', () => {
    const { result } = renderHook(() =>
      useThermalBridgePreviewMode({ enabled: true, scopeKey: 'floor-1:2d', blocked: false }),
    );

    keyDown('a');
    act(() => result.current.pin());
    act(() => result.current.unpin());
    expect(result.current).toMatchObject({ active: true, held: true, pinned: false });

    keyUp('a');
    expect(result.current.active).toBe(false);
  });

  it('clears held and pinned previews on blur or when the document becomes hidden', () => {
    const { result } = renderHook(() =>
      useThermalBridgePreviewMode({ enabled: true, scopeKey: 'floor-1:2d', blocked: false }),
    );

    keyDown('a');
    act(() => result.current.pin());
    act(() => window.dispatchEvent(new Event('blur')));
    expect(result.current).toMatchObject({ active: false, held: false, pinned: false });

    keyDown('a');
    act(() => result.current.pin());
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current).toMatchObject({ active: false, held: false, pinned: false });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('clears all preview state when disabled or blocked', () => {
    const { result, rerender } = renderHook(
      ({ enabled, blocked }) =>
        useThermalBridgePreviewMode({ enabled, blocked, scopeKey: 'floor-1:2d' }),
      { initialProps: { enabled: true, blocked: false } },
    );

    keyDown('a');
    act(() => result.current.pin());
    rerender({ enabled: true, blocked: true });
    expect(result.current).toMatchObject({ active: false, held: false, pinned: false });

    rerender({ enabled: true, blocked: false });
    keyDown('a');
    rerender({ enabled: false, blocked: false });
    expect(result.current).toMatchObject({ active: false, held: false, pinned: false });
  });

  it('drops a pin on scope change while a held preview follows the new floor', () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) =>
        useThermalBridgePreviewMode({ enabled: true, blocked: false, scopeKey }),
      { initialProps: { scopeKey: 'floor-1:2d' } },
    );

    keyDown('a');
    act(() => result.current.pin());
    rerender({ scopeKey: 'floor-2:2d' });
    expect(result.current).toMatchObject({ active: true, held: true, pinned: false });

    keyUp('a');
    keyDown('a');
    act(() => result.current.pin());
    keyUp('a');
    rerender({ scopeKey: 'floor-3:3d' });
    expect(result.current).toMatchObject({ active: false, held: false, pinned: false });
  });
});
