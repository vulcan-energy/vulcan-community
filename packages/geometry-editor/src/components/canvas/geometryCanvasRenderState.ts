// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type GeometryCanvasModelRenderState = Readonly<{
  elementIds: readonly unknown[];
  elementsById: unknown;
  floors: readonly unknown[];
  spaceLabelIds: readonly unknown[];
  spaceLabelsById: unknown;
  zones: readonly unknown[];
}>;

export type GeometryCanvasSelectionRenderState = Readonly<{
  selectedElementIds: readonly unknown[];
  selection: unknown;
}>;

export function hasGeometryCanvasModelRenderStateChanged(
  previous: GeometryCanvasModelRenderState,
  next: GeometryCanvasModelRenderState,
): boolean {
  return (
    previous.elementIds !== next.elementIds ||
    previous.elementsById !== next.elementsById ||
    previous.floors !== next.floors ||
    previous.spaceLabelIds !== next.spaceLabelIds ||
    previous.spaceLabelsById !== next.spaceLabelsById ||
    previous.zones !== next.zones
  );
}

function hasGeometryCanvasModelRenderStateContent(
  state: GeometryCanvasModelRenderState,
): boolean {
  return (
    state.elementIds.length > 0 ||
    state.floors.length > 0 ||
    state.spaceLabelIds.length > 0 ||
    state.zones.length > 0
  );
}

export function shouldMarkGeometryCanvasModelRenderState({
  hasObservedModelRenderState,
  previous,
  next,
}: Readonly<{
  hasObservedModelRenderState: boolean;
  previous: GeometryCanvasModelRenderState;
  next: GeometryCanvasModelRenderState;
}>): boolean {
  if (!hasObservedModelRenderState) {
    return hasGeometryCanvasModelRenderStateContent(next);
  }

  return hasGeometryCanvasModelRenderStateChanged(previous, next);
}

export function hasGeometryCanvasSelectionRenderStateChanged(
  previous: GeometryCanvasSelectionRenderState,
  next: GeometryCanvasSelectionRenderState,
): boolean {
  return (
    previous.selectedElementIds !== next.selectedElementIds ||
    previous.selection !== next.selection
  );
}
