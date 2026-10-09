// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { AutoThermalBridgeCandidate } from '../../geometry/thermalBridge/autoThermalBridgeCandidates';
import type { ThermalBridgeInventoryRow } from '../../geometry/thermalBridge/thermalBridgeInventory';

type PinnedPreviewState = {
  pinned: boolean;
  held: boolean;
  menu: { ids: string[] } | null;
};

function pinnedPreviewIds(preview: PinnedPreviewState): Set<string> | null {
  return preview.pinned && !preview.held && preview.menu
    ? new Set(preview.menu.ids)
    : null;
}

/** Keep the held overlay broad; after A release, show only rows represented by the pinned chooser. */
export function thermalBridgeCandidatesForRender(
  candidates: readonly AutoThermalBridgeCandidate[],
  preview: PinnedPreviewState,
): readonly AutoThermalBridgeCandidate[] {
  const ids = pinnedPreviewIds(preview);
  return ids ? candidates.filter((candidate) => ids.has(candidate.proposalId)) : candidates;
}

export function thermalBridgeIssuesForRender<T extends ThermalBridgeInventoryRow>(
  issues: readonly T[],
  preview: PinnedPreviewState,
): readonly T[] {
  const ids = pinnedPreviewIds(preview);
  return ids ? issues.filter((issue) => ids.has(`issue:${issue.tb.id}`)) : issues;
}

