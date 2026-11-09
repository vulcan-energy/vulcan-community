// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';
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

export type CanvasDecorationPoint = Readonly<{ x: number; y: number; z?: number }>;
export type CanvasDecorationContext = Readonly<{
  /** World-to-canvas transform shared with the editor's geometry and fast-pan layer. */
  worldToCanvas(point: CanvasDecorationPoint): Readonly<{ x: number; y: number }>;
  /** Active floor elevation; hosts may use it to omit decorations on other floors. */
  currentFloorZ: number;
  scale: number;
  /** Theme-aware canvas colors supplied by the editor host. */
  colors: Readonly<{ stroke: string; selected: string; warning: string; label: string; labelBackground: string }>;
  /** False during drawing, panning, calibration/move, 3D and blocking previews. */
  canSelect: boolean;
  selectedId: string | null;
  selectionScope: string;
  select(id: string): void;
  clearSelection(): void;
}>;

export type CanvasDecorationDetailsContext = Readonly<{
  id: string;
  replaceSelection(id: string): void;
  confirmDeleteRequested: boolean;
  clearDeleteRequest(): void;
  requestDelete(): void;
}>;

/** Host-owned, virtual plan annotations; they do not become geometry-store elements. */
export type CanvasDecorationContribution = Readonly<{
  id: string;
  isAvailable?(): boolean;
  selectionScope?(): string;
  render(context: CanvasDecorationContext): ReactNode;
  /** Screen-reader and keyboard route for canvas marks that are otherwise drawn to a bitmap layer. */
  renderAccessibility?(context: CanvasDecorationContext): ReactNode;
  renderDetails?(context: CanvasDecorationDetailsContext): ReactNode;
}>;

export type GeometryEditorContributions<
  HostContext,
  RenderResult,
  FilenameActionContext = HostContext,
> = Readonly<{
  canvasPanels: readonly CanvasPanelContribution<HostContext, RenderResult>[];
  canvasDecorations?: readonly CanvasDecorationContribution[];
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
    canvasDecorations?: readonly CanvasDecorationContribution[];
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

  const decorationIds = new Set<string>();
  for (const decoration of contributions.canvasDecorations ?? []) {
    if (decorationIds.has(decoration.id)) {
      throw new Error(`Duplicate canvas decoration contribution id: ${decoration.id}`);
    }
    decorationIds.add(decoration.id);
  }

  const { filenameActions } = defineFilenameActionContributions({
    filenameActions: contributions.filenameActions,
  });

  return Object.freeze({
    canvasPanels: Object.freeze(canvasPanels),
    canvasDecorations: Object.freeze([...(contributions.canvasDecorations ?? [])]),
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
