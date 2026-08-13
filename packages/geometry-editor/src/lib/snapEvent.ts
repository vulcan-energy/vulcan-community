// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type SnapEventKind =
  | 'corner'
  | 'right-angle'
  | 'cardinal'
  | 'ortho-lock'
  | 'parent-edge'
  | 'perp-foot'
  | 'wall-segment'
  | 'neighbour-bearing'
  | 'edge-normal'
  | 'angle-step';

export type SnapEvent = {
  kind: SnapEventKind;
  sourceElementId?: string;
  sourceVertexOrder?: number;
  sourceEdgeIndex?: number;
  value?: number;
  position?: { x: number; y: number }; // snapped control point in model coordinates
};

export function snapEventsEqual(a: SnapEvent | null, b: SnapEvent | null): boolean {
  return a === b || (
    a !== null &&
    b !== null &&
    a.kind === b.kind &&
    a.sourceElementId === b.sourceElementId &&
    a.sourceVertexOrder === b.sourceVertexOrder &&
    a.sourceEdgeIndex === b.sourceEdgeIndex &&
    a.value === b.value &&
    a.position?.x === b.position?.x &&
    a.position?.y === b.position?.y
  );
}
