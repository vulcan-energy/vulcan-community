// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { snapEventsEqual, type SnapEvent } from '../../lib/snapEvent';

export type SnapFeedbackState = {
  event: SnapEvent | null;
};

export type SnapFeedbackSignal = {
  getSnapshot: () => SnapFeedbackState;
  reset: () => void;
  set: (patch: Partial<SnapFeedbackState>) => void;
  subscribe: (listener: () => void) => () => void;
};

const EMPTY_SNAP_FEEDBACK: SnapFeedbackState = { event: null };

function sameState(a: SnapFeedbackState, b: SnapFeedbackState): boolean {
  return snapEventsEqual(a.event, b.event);
}

export function createSnapFeedbackSignal(
  initial: Partial<SnapFeedbackState> = EMPTY_SNAP_FEEDBACK,
): SnapFeedbackSignal {
  let snapshot: SnapFeedbackState = { event: initial.event ?? null };
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => snapshot,
    reset: () => {
      if (sameState(snapshot, EMPTY_SNAP_FEEDBACK)) return;
      snapshot = EMPTY_SNAP_FEEDBACK;
      notify();
    },
    set: (patch) => {
      const next = {
        ...snapshot,
        ...patch,
      };
      if (sameState(snapshot, next)) return;
      snapshot = next;
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
