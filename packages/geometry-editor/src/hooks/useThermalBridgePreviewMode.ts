// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isCanvasKeydownTargetAFormControl } from '../lib/canvasGeometryKeyboardPolicy';

export interface UseThermalBridgePreviewModeOptions {
  /** The selected thermal bridge is a linear bridge in a supported 2D/3D view. */
  enabled: boolean;
  /** Current floor/view identity. A held preview follows this scope; a pin does not. */
  scopeKey: string;
  /** True while a modal or another UI state owns canvas keyboard input. */
  blocked: boolean;
}

export interface ThermalBridgePreviewMode {
  active: boolean;
  held: boolean;
  pinned: boolean;
  pin: () => void;
  /** Close a pin chooser while keeping the preview active for as long as A is held. */
  unpin: () => void;
  dismiss: () => void;
  /** Release the physical A hold while preserving a pinned preview. */
  release: () => void;
}

interface PreviewModeState {
  held: boolean;
  pinnedScopeKey: string | null;
  lastEnabled: boolean;
  lastBlocked: boolean;
  lastScopeKey: string;
}

/**
 * Tracks the temporary linear thermal-bridge preview gesture without changing
 * drawing mode or any editable geometry state.
 */
export function useThermalBridgePreviewMode({
  enabled,
  scopeKey,
  blocked,
}: UseThermalBridgePreviewModeOptions): ThermalBridgePreviewMode {
  const [modeState, setModeState] = useState<PreviewModeState>(() => ({
    held: false,
    pinnedScopeKey: null,
    lastEnabled: enabled,
    lastBlocked: blocked,
    lastScopeKey: scopeKey,
  }));
  const heldRef = useRef(false);
  const pinnedRef = useRef(false);
  const enabledRef = useRef(enabled);
  const blockedRef = useRef(blocked);
  const scopeKeyRef = useRef(scopeKey);

  let currentMode = modeState;
  if (
    modeState.lastEnabled !== enabled ||
    modeState.lastBlocked !== blocked ||
    modeState.lastScopeKey !== scopeKey
  ) {
    currentMode = {
      ...modeState,
      held: enabled && !blocked ? modeState.held : false,
      pinnedScopeKey:
        !enabled || blocked || modeState.lastScopeKey !== scopeKey
          ? null
          : modeState.pinnedScopeKey,
      lastEnabled: enabled,
      lastBlocked: blocked,
      lastScopeKey: scopeKey,
    };
    setModeState(currentMode);
  }

  const held = enabled && !blocked && currentMode.held;
  const pinned = enabled && !blocked && currentMode.pinnedScopeKey === scopeKey;

  const setHeldState = useCallback((next: boolean) => {
    heldRef.current = next;
    setModeState((previous) => ({ ...previous, held: next }));
  }, [setModeState]);

  const setPinnedState = useCallback((next: boolean) => {
    pinnedRef.current = next;
    setModeState((previous) => ({
      ...previous,
      pinnedScopeKey: next ? scopeKeyRef.current : null,
    }));
  }, [setModeState]);

  const release = useCallback(() => {
    setHeldState(false);
  }, [setHeldState]);

  const dismiss = useCallback(() => {
    setHeldState(false);
    setPinnedState(false);
  }, [setHeldState, setPinnedState]);

  const unpin = useCallback(() => {
    setPinnedState(false);
  }, [setPinnedState]);

  const pin = useCallback(() => {
    if (enabledRef.current && !blockedRef.current && (heldRef.current || pinnedRef.current)) {
      setPinnedState(true);
    }
  }, [setPinnedState]);

  useLayoutEffect(() => {
    enabledRef.current = enabled;
    blockedRef.current = blocked;
    scopeKeyRef.current = scopeKey;
    heldRef.current = held;
    pinnedRef.current = pinned;
  }, [enabled, blocked, scopeKey, held, pinned]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'a' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat ||
        !enabledRef.current ||
        blockedRef.current ||
        isCanvasKeydownTargetAFormControl(event.target) ||
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        document.querySelector('[data-suppress-canvas-keyboard]') ||
        heldRef.current
      ) {
        return;
      }

      setHeldState(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'a') {
        release();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        !(heldRef.current || pinnedRef.current) ||
        !enabledRef.current ||
        blockedRef.current
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
    };

    const clearOnBlur = () => dismiss();
    const clearWhenHidden = () => {
      if (document.hidden) dismiss();
    };
    const dismissWhenModalReceivesFocus = (event: FocusEvent) => {
      if (!(heldRef.current || pinnedRef.current)) return;
      if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"][aria-modal="true"]')) {
        dismiss();
      }
    };

    window.addEventListener('keydown', handleEscape, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearOnBlur);
    document.addEventListener('visibilitychange', clearWhenHidden);
    document.addEventListener('focusin', dismissWhenModalReceivesFocus);

    return () => {
      window.removeEventListener('keydown', handleEscape, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearOnBlur);
      document.removeEventListener('visibilitychange', clearWhenHidden);
      document.removeEventListener('focusin', dismissWhenModalReceivesFocus);
    };
  }, [dismiss, release, setHeldState]);

  return {
    active: held || pinned,
    held,
    pinned,
    pin,
    unpin,
    dismiss,
    release,
  };
}
