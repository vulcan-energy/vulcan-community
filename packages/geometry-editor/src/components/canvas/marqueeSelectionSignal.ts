// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type MarqueeSelectionPreview = {
  isActive: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

export type MarqueeSelectionSignal = {
  getSnapshot: () => MarqueeSelectionPreview;
  reset: () => void;
  set: (next: MarqueeSelectionPreview | null) => void;
  subscribe: (listener: () => void) => () => void;
};

export const EMPTY_MARQUEE_SELECTION: MarqueeSelectionPreview = {
  isActive: false,
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0,
};

function normalizeMarquee(next: MarqueeSelectionPreview | null): MarqueeSelectionPreview {
  return next ?? EMPTY_MARQUEE_SELECTION;
}

function sameMarquee(a: MarqueeSelectionPreview, b: MarqueeSelectionPreview): boolean {
  return (
    a.isActive === b.isActive &&
    a.startX === b.startX &&
    a.startY === b.startY &&
    a.endX === b.endX &&
    a.endY === b.endY
  );
}

export function createMarqueeSelectionSignal(
  initial: MarqueeSelectionPreview | null = EMPTY_MARQUEE_SELECTION,
): MarqueeSelectionSignal {
  let snapshot = normalizeMarquee(initial);
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => snapshot,
    reset: () => {
      if (sameMarquee(snapshot, EMPTY_MARQUEE_SELECTION)) return;
      snapshot = EMPTY_MARQUEE_SELECTION;
      notify();
    },
    set: (next) => {
      const normalized = normalizeMarquee(next);
      if (sameMarquee(snapshot, normalized)) return;
      snapshot = normalized;
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
