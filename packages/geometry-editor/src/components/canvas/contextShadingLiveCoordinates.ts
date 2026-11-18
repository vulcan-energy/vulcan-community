// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useSyncExternalStore } from 'react';

type Coordinates = Array<{ x: number; y: number; z: number }>;
type Live = { elementId: string; coordinates: Coordinates } | null;

let live: Live = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/**
 * The coordinates of the Context Shading object whose vertex is being dragged. The drag moves Konva
 * nodes without touching the store, so the rays and distance pills read these until the drop.
 */
export function setLiveContextShadingCoordinates(next: Live): void {
  if (live === null && next === null) return;
  live = next;
  listeners.forEach((listener) => listener());
}

/** The live coordinates of `elementId`, or null when it is not being dragged or no id is given. */
export function useLiveContextShadingCoordinates(elementId: string | undefined): Live {
  return useSyncExternalStore(subscribe, () => (elementId && live?.elementId === elementId ? live : null));
}

/** The live coordinates of whichever Context Shading object is being dragged, or null. */
export function useAnyLiveContextShadingCoordinates(): Live {
  return useSyncExternalStore(subscribe, () => live);
}

/** The id of the Context Shading object being dragged: changes at the start and end of a drag, not per move. */
export function useDraggedContextShadingId(): string | null {
  return useSyncExternalStore(subscribe, () => live?.elementId ?? null);
}
