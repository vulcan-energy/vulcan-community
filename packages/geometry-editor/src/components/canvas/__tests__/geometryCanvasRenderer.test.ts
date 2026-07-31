// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createGeometryCanvasRenderer } from '../geometryCanvasRenderer';

describe('createGeometryCanvasRenderer', () => {
  it('suppresses WebGL context-restore events only during renderer construction', () => {
    let restoreListener: EventListener | null = null;
    const canvas = {
      addEventListener: vi.fn((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
        if (type === 'webglcontextrestored' && options === true) {
          restoreListener = listener;
        }
      }),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;

    const constructionRestoreEvent = {
      stopImmediatePropagation: vi.fn(),
    } as unknown as Event;
    class MockRenderer {
      constructor() {
        restoreListener?.(constructionRestoreEvent);
      }
    }

    const renderer = createGeometryCanvasRenderer(
      { canvas },
      MockRenderer as unknown as typeof THREE.WebGLRenderer,
    );

    expect(renderer).toBeInstanceOf(MockRenderer);
    expect(constructionRestoreEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(canvas.removeEventListener).toHaveBeenCalledWith(
      'webglcontextrestored',
      expect.any(Function),
      true,
    );

    const laterRestoreEvent = {
      stopImmediatePropagation: vi.fn(),
    } as unknown as Event;
    restoreListener?.(laterRestoreEvent);
    expect(laterRestoreEvent.stopImmediatePropagation).not.toHaveBeenCalled();
  });
});
