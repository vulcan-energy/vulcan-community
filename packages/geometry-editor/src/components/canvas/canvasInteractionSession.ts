// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  beginActiveDragPreviewBackend,
  type ActiveDragPreviewBackend,
  type ActiveDragPreviewBackendSession,
} from './elementDragPreview';

export type CanvasInteractionKind =
  | 'selected-shape-drag'
  | 'selected-point-drag'
  | 'point-element-drag'
  | 'vertex-drag'
  | 'multi-select-drag'
  | 'space-label-vertex-drag'
  | 'drawing-preview'
  | 'guide-overlay-drag'
  | 'orientation-arrow-drag'
  | 'slope-rotate-drag'
  | 'line-rotate-drag'
  | 'stage-pan'
  | 'marquee';

type CanvasInteractionCleanup = (result?: unknown) => void;
type CanvasInteractionTarget = {
  getAttr?: (key: string) => unknown;
  setAttr?: (key: string, value: unknown) => void;
};

const CANVAS_INTERACTION_SESSION_ATTR = '__vulcanCanvasInteractionSession';

export type CanvasInteractionPreviewBackend =
  | ActiveDragPreviewBackend
  | {
      mode: 'signalOnly';
      reset: CanvasInteractionCleanup;
    };

type CanvasInteractionPreviewSession =
  | ActiveDragPreviewBackendSession
  | null;

export type CanvasInteractionSnapshot<TSnapshot = unknown> = {
  id: number;
  kind: CanvasInteractionKind;
  targetId?: string;
  snapshot?: TSnapshot;
  startedAtMs: number;
  perfLabel?: string;
};

export type CanvasInteractionSession<TSnapshot = unknown, TResult = unknown> =
  CanvasInteractionSnapshot<TSnapshot> & {
    previewSession: CanvasInteractionPreviewSession;
    addCleanup(cleanup: CanvasInteractionCleanup): void;
    end(result?: TResult): void;
    cancel(): void;
    isActive(): boolean;
  };

export type BeginCanvasInteractionConfig<TSnapshot = unknown, TResult = unknown> = {
  kind: CanvasInteractionKind;
  targetId?: string;
  snapshot?: TSnapshot;
  preview?: CanvasInteractionPreviewBackend;
  perfLabel?: string;
  cleanup?: CanvasInteractionCleanup;
  onEnd?: (result?: TResult) => void;
  onCancel?: () => void;
};

let nextSessionId = 1;
let activeSession: CanvasInteractionSession | null = null;

export function readCanvasInteractionSession(
  target: CanvasInteractionTarget | null | undefined,
): CanvasInteractionSession | null {
  return (target?.getAttr?.(CANVAS_INTERACTION_SESSION_ATTR) as CanvasInteractionSession | null | undefined) ?? null;
}

export function writeCanvasInteractionSession(
  target: CanvasInteractionTarget | null | undefined,
  session: CanvasInteractionSession | null,
): void {
  target?.setAttr?.(CANVAS_INTERACTION_SESSION_ATTR, session);
}

function attachPreviewBackend(
  backend: CanvasInteractionPreviewBackend | undefined,
): { previewSession: CanvasInteractionPreviewSession; cleanup: CanvasInteractionCleanup | null } | null {
  if (!backend) {
    return { previewSession: null, cleanup: null };
  }

  switch (backend.mode) {
    case 'signalOnly':
      return {
        previewSession: null,
        cleanup: backend.reset,
      };
    default:
      return beginActiveDragPreviewBackend(backend);
  }
}

function throwFirstError(errors: unknown[]): void {
  if (errors.length === 0) return;
  throw errors[0];
}

export function beginCanvasInteraction<TSnapshot = unknown, TResult = unknown>(
  config: BeginCanvasInteractionConfig<TSnapshot, TResult>,
): CanvasInteractionSession<TSnapshot, TResult> | null {
  if (activeSession) return null;

  const attachedPreview = attachPreviewBackend(config.preview);
  if (!attachedPreview) return null;

  const cleanups: CanvasInteractionCleanup[] = [];
  if (attachedPreview.cleanup) cleanups.push(attachedPreview.cleanup);
  if (config.cleanup) cleanups.push(config.cleanup);

  let state: 'active' | 'ended' | 'cancelled' = 'active';
  const session: CanvasInteractionSession<TSnapshot, TResult> = {
    id: nextSessionId,
    kind: config.kind,
    targetId: config.targetId,
    snapshot: config.snapshot,
    startedAtMs: performance.now(),
    perfLabel: config.perfLabel,
    previewSession: attachedPreview.previewSession,
    addCleanup(cleanup) {
      if (state !== 'active') {
        cleanup();
        return;
      }
      cleanups.push(cleanup);
    },
    end(result) {
      completeCanvasInteraction(session, 'end', result);
    },
    cancel() {
      completeCanvasInteraction(session, 'cancel');
    },
    isActive() {
      return activeSession === session && state === 'active';
    },
  };

  nextSessionId += 1;
  activeSession = session as CanvasInteractionSession;

  function completeCanvasInteraction(
    currentSession: CanvasInteractionSession<TSnapshot, TResult>,
    mode: 'end' | 'cancel',
    result?: TResult,
  ): void {
    if (state !== 'active') return;

    state = mode === 'end' ? 'ended' : 'cancelled';
    const callbackErrors: unknown[] = [];
    const cleanupErrors: unknown[] = [];

    try {
      if (mode === 'end') {
        config.onEnd?.(result);
      } else {
        config.onCancel?.();
      }
    } catch (error) {
      callbackErrors.push(error);
    }

    const pendingCleanups = cleanups.splice(0, cleanups.length);
    for (const cleanup of pendingCleanups) {
      try {
        cleanup(mode === 'end' ? result : undefined);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (activeSession === currentSession) {
      activeSession = null;
    }

    throwFirstError(callbackErrors);
    throwFirstError(cleanupErrors);
  }

  return session;
}

export function endCanvasInteraction<TResult = unknown>(
  session: CanvasInteractionSession<unknown, TResult> | null | undefined,
  result?: TResult,
): void {
  session?.end(result);
}

export function cancelCanvasInteraction(
  session: CanvasInteractionSession | null | undefined,
): void {
  session?.cancel();
}

export function getActiveCanvasInteraction(): CanvasInteractionSnapshot | null {
  if (!activeSession) return null;
  const {
    id,
    kind,
    targetId,
    snapshot,
    startedAtMs,
    perfLabel,
  } = activeSession;
  return {
    id,
    kind,
    targetId,
    snapshot,
    startedAtMs,
    perfLabel,
  };
}

export function isCanvasInteractionActive(kind?: CanvasInteractionKind): boolean {
  if (!activeSession) return false;
  return kind ? activeSession.kind === kind : true;
}
