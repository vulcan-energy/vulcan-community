// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type DrawingPreviewPoint = { x: number; y: number };

export type DrawingPreviewSegment = {
  visible: boolean;
  text: string;
  position: DrawingPreviewPoint;
};

export type DrawingPreviewLiveState = {
  drawCursor: DrawingPreviewPoint | null;
  drawAngleSnapped: boolean;
  segmentLengthPreview: DrawingPreviewSegment;
  /** Bends of a Shift route preview (duct/pipe plan tool): one for an L, two for a dog-leg; empty when straight. */
  drawBends: DrawingPreviewPoint[];
};

export type DrawingPreviewSignal = {
  getSnapshot: () => DrawingPreviewLiveState;
  reset: () => void;
  set: (patch: Partial<DrawingPreviewLiveState>) => void;
  subscribe: (listener: () => void) => () => void;
};

export const EMPTY_SEGMENT_LENGTH_PREVIEW: DrawingPreviewSegment = {
  visible: false,
  text: '',
  position: { x: 0, y: 0 },
};

const EMPTY_DRAWING_PREVIEW: DrawingPreviewLiveState = {
  drawCursor: null,
  drawAngleSnapped: false,
  segmentLengthPreview: EMPTY_SEGMENT_LENGTH_PREVIEW,
  drawBends: [],
};

function samePoint(a: DrawingPreviewPoint | null, b: DrawingPreviewPoint | null): boolean {
  return a === b || (!!a && !!b && a.x === b.x && a.y === b.y);
}

function samePoints(a: DrawingPreviewPoint[], b: DrawingPreviewPoint[]): boolean {
  return a.length === b.length && a.every((p, i) => samePoint(p, b[i]!));
}

function sameSegment(a: DrawingPreviewSegment, b: DrawingPreviewSegment): boolean {
  return (
    a.visible === b.visible &&
    a.text === b.text &&
    samePoint(a.position, b.position)
  );
}

function sameState(a: DrawingPreviewLiveState, b: DrawingPreviewLiveState): boolean {
  return (
    samePoint(a.drawCursor, b.drawCursor) &&
    a.drawAngleSnapped === b.drawAngleSnapped &&
    sameSegment(a.segmentLengthPreview, b.segmentLengthPreview) &&
    samePoints(a.drawBends, b.drawBends)
  );
}

function normalizeState(patch: Partial<DrawingPreviewLiveState>): DrawingPreviewLiveState {
  return {
    drawCursor: patch.drawCursor ?? EMPTY_DRAWING_PREVIEW.drawCursor,
    drawAngleSnapped: patch.drawAngleSnapped ?? EMPTY_DRAWING_PREVIEW.drawAngleSnapped,
    segmentLengthPreview: patch.segmentLengthPreview ?? EMPTY_DRAWING_PREVIEW.segmentLengthPreview,
    drawBends: patch.drawBends ?? EMPTY_DRAWING_PREVIEW.drawBends,
  };
}

export function createDrawingPreviewSignal(
  initial: Partial<DrawingPreviewLiveState> = EMPTY_DRAWING_PREVIEW,
): DrawingPreviewSignal {
  let snapshot = normalizeState(initial);
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => snapshot,
    reset: () => {
      if (sameState(snapshot, EMPTY_DRAWING_PREVIEW)) return;
      snapshot = EMPTY_DRAWING_PREVIEW;
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
