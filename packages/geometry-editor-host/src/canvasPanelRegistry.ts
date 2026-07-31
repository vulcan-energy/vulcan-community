// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  defineFilenameActionContributions,
  type FilenameActionContribution,
} from './filenameActionRegistry';

export type CanvasPanelToggle = Readonly<{
  label: string;
}>;

export type CanvasPanelContribution<HostContext, RenderResult> = Readonly<{
  id: string;
  toggle: CanvasPanelToggle;
  isAvailable?: (context: HostContext) => boolean;
  render: (context: HostContext) => RenderResult;
}>;

export type GeometryEditorContributions<
  HostContext,
  RenderResult,
  FilenameActionContext = HostContext,
> = Readonly<{
  canvasPanels: readonly CanvasPanelContribution<HostContext, RenderResult>[];
  filenameActions: readonly FilenameActionContribution<
    FilenameActionContext,
    RenderResult
  >[];
}>;

export type CanvasPanelPosition = Readonly<{
  x: number;
  y: number;
}>;

export type CanvasPanelPositions = Record<string, CanvasPanelPosition>;

export function defineGeometryEditorContributions<
  HostContext,
  RenderResult,
  FilenameActionContext = HostContext,
>(
  contributions: {
    canvasPanels?: readonly CanvasPanelContribution<HostContext, RenderResult>[];
    filenameActions?: readonly FilenameActionContribution<
      FilenameActionContext,
      RenderResult
    >[];
  },
): GeometryEditorContributions<HostContext, RenderResult, FilenameActionContext> {
  const canvasPanels = [...(contributions.canvasPanels ?? [])];
  const ids = new Set<string>();

  for (const panel of canvasPanels) {
    if (ids.has(panel.id)) {
      throw new Error(`Duplicate canvas panel contribution id: ${panel.id}`);
    }
    ids.add(panel.id);
  }

  const { filenameActions } = defineFilenameActionContributions({
    filenameActions: contributions.filenameActions,
  });

  return Object.freeze({
    canvasPanels: Object.freeze(canvasPanels),
    filenameActions,
  });
}

export function resolveCanvasPanelContributions<
  HostContext,
  RenderResult,
  FilenameActionContext,
>(
  contributions: GeometryEditorContributions<
    HostContext,
    RenderResult,
    FilenameActionContext
  >,
  context: HostContext,
): readonly CanvasPanelContribution<HostContext, RenderResult>[] {
  return contributions.canvasPanels.filter(
    (panel) => panel.isAvailable?.(context) ?? true,
  );
}

export function readCanvasPanelPosition(
  positions: CanvasPanelPositions,
  panelId: string,
  defaultPosition: CanvasPanelPosition,
): CanvasPanelPosition {
  return positions[panelId] ?? defaultPosition;
}

export function setCanvasPanelPosition(
  positions: CanvasPanelPositions,
  panelId: string,
  position: CanvasPanelPosition,
): CanvasPanelPositions {
  return { ...positions, [panelId]: position };
}

export function resetCanvasPanelPosition(
  positions: CanvasPanelPositions,
  panelId: string,
): CanvasPanelPositions {
  if (!(panelId in positions)) return positions;

  const next = { ...positions };
  delete next[panelId];
  return next;
}

export function pruneUnavailableCanvasPanelPositions(
  positions: CanvasPanelPositions,
  availablePanelIds: ReadonlySet<string>,
): CanvasPanelPositions {
  const unavailableIds = Object.keys(positions).filter(
    (panelId) => !availablePanelIds.has(panelId),
  );
  if (unavailableIds.length === 0) return positions;

  const next = { ...positions };
  unavailableIds.forEach((panelId) => delete next[panelId]);
  return next;
}
