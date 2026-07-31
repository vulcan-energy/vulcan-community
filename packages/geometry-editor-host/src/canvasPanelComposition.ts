// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  resolveCanvasPanelContributions,
  type CanvasPanelContribution,
  type GeometryEditorContributions,
} from './canvasPanelRegistry';

export type CanvasPanelToggleModel = Readonly<{
  id: string;
  label: string;
  hidden: boolean;
}>;

export type CanvasPanelComposition<HostContext, RenderResult> = Readonly<{
  toggles: readonly CanvasPanelToggleModel[];
  availablePanels: readonly CanvasPanelContribution<HostContext, RenderResult>[];
  visiblePanels: readonly CanvasPanelContribution<HostContext, RenderResult>[];
}>;

export function projectCanvasPanelComposition<HostContext, RenderResult>(
  availablePanels: readonly CanvasPanelContribution<HostContext, RenderResult>[],
  hiddenPanelIds: ReadonlySet<string>,
): CanvasPanelComposition<HostContext, RenderResult> {
  const toggles = availablePanels.map((panel) => ({
    id: panel.id,
    label: panel.toggle.label,
    hidden: hiddenPanelIds.has(panel.id),
  }));
  const visiblePanels = availablePanels.filter(
    (panel) => !hiddenPanelIds.has(panel.id),
  );

  return { toggles, availablePanels, visiblePanels };
}

export function resolveCanvasPanelComposition<
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
  hiddenPanelIds: ReadonlySet<string>,
): CanvasPanelComposition<HostContext, RenderResult> {
  const availablePanels = resolveCanvasPanelContributions(contributions, context);
  return projectCanvasPanelComposition(availablePanels, hiddenPanelIds);
}

export type CanvasPanelCompositionHarnessResult<RenderResult> = Readonly<{
  toggles: readonly CanvasPanelToggleModel[];
  availablePanelIds: readonly string[];
  visiblePanelIds: readonly string[];
  renderedPanels: readonly Readonly<{ id: string; output: RenderResult }>[];
}>;

export function runCanvasPanelCompositionHarness<
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
  hiddenPanelIds: ReadonlySet<string>,
): CanvasPanelCompositionHarnessResult<RenderResult> {
  const composition = resolveCanvasPanelComposition(
    contributions,
    context,
    hiddenPanelIds,
  );

  return {
    toggles: composition.toggles,
    availablePanelIds: composition.availablePanels.map((panel) => panel.id),
    visiblePanelIds: composition.visiblePanels.map((panel) => panel.id),
    renderedPanels: composition.visiblePanels.map((panel) => ({
      id: panel.id,
      output: panel.render(context),
    })),
  };
}
