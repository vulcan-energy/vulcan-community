// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type FilenameActionContribution<HostContext, RenderResult> = Readonly<{
  id: string;
  order?: number;
  isAvailable?: (context: HostContext) => boolean;
  render: (context: HostContext) => RenderResult;
}>;

export type FilenameActionContributions<HostContext, RenderResult> = Readonly<{
  filenameActions: readonly FilenameActionContribution<HostContext, RenderResult>[];
}>;

function assertValidFilenameActions<HostContext, RenderResult>(
  filenameActions: readonly FilenameActionContribution<HostContext, RenderResult>[],
): void {
  const ids = new Set<string>();

  for (const action of filenameActions) {
    if (action.id.trim().length === 0) {
      throw new Error('Expected non-empty filename action contribution id');
    }
    if (action.order !== undefined && !Number.isFinite(action.order)) {
      throw new Error(
        `Expected finite filename action contribution order for id: ${action.id}`,
      );
    }
    if (ids.has(action.id)) {
      throw new Error(`Duplicate filename action contribution id: ${action.id}`);
    }
    ids.add(action.id);
  }
}

export function defineFilenameActionContributions<HostContext, RenderResult>(
  contributions: {
    filenameActions?: readonly FilenameActionContribution<HostContext, RenderResult>[];
  },
): FilenameActionContributions<HostContext, RenderResult> {
  const configuredActions = contributions.filenameActions ?? [];
  assertValidFilenameActions(configuredActions);
  const filenameActions = configuredActions.map((action) =>
    Object.freeze({ ...action }),
  );

  return Object.freeze({ filenameActions: Object.freeze(filenameActions) });
}

export function resolveFilenameActionContributions<HostContext, RenderResult>(
  contributions: FilenameActionContributions<HostContext, RenderResult>,
  context: HostContext,
): readonly FilenameActionContribution<HostContext, RenderResult>[] {
  const configuredActions = contributions.filenameActions;
  assertValidFilenameActions(configuredActions);
  const resolved = configuredActions
    .map((action, declarationIndex) => ({ action, declarationIndex }))
    .filter(({ action }) => action.isAvailable?.(context) ?? true)
    .sort(
      (left, right) =>
        (left.action.order ?? 0) - (right.action.order ?? 0) ||
        left.declarationIndex - right.declarationIndex,
    )
    .map(({ action }) => action);

  return Object.freeze(resolved);
}
