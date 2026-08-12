// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Floor } from '../../geometry/types';
import type { ValidationIssue, ValidationResult } from '../../geometry/validation/types';
import { getElementCanvasFloorZValue, isElementOnActiveCanvasFloor } from '../../lib/elementCanvasFloor';

export type ElementsPanelEntry = {
  representative: Element;
  memberIds: string[];
  members: Element[];
  isDormerBundle: boolean;
};

export type ElementsPanelEntrySummary = {
  key: string;
  validation: ValidationResult;
  hasComparisonInfo: boolean;
  elementFloorZ: number;
  isCurrentFloor: boolean;
};

export type ElementsPanelSelection =
  | { type: 'zone' | 'element' | 'global' | 'dormer'; id: string; isPlaceholder?: boolean }
  | null;

export function getElementEntryKey(entry: Pick<ElementsPanelEntry, 'memberIds'>): string {
  return entry.memberIds.join(':');
}

export function hasSelectedEntryMember(
  entry: Pick<ElementsPanelEntry, 'memberIds'>,
  selectedElementIdSet: ReadonlySet<string>,
): boolean {
  return entry.memberIds.some((id) => selectedElementIdSet.has(id));
}

export function areAllEntryMembersSelected(
  entry: Pick<ElementsPanelEntry, 'memberIds'>,
  selectedElementIdSet: ReadonlySet<string>,
): boolean {
  return entry.memberIds.every((id) => selectedElementIdSet.has(id));
}

export function removeEntryMembersFromSelection(
  selectedElementIds: readonly string[],
  entry: Pick<ElementsPanelEntry, 'memberIds'>,
): string[] {
  const memberIdSet = new Set(entry.memberIds);
  return selectedElementIds.filter((id) => !memberIdSet.has(id));
}

export function getElementEntrySelectionState(
  entry: Pick<ElementsPanelEntry, 'memberIds'>,
  selection: ElementsPanelSelection,
  selectedElementIdSet: ReadonlySet<string>,
  dormerBundleId: string | null,
): boolean {
  return (
    (selection?.type === 'element' && entry.memberIds.includes(selection.id)) ||
    (selection?.type === 'dormer' && dormerBundleId === selection.id) ||
    hasSelectedEntryMember(entry, selectedElementIdSet)
  );
}

export function sortElementEntriesForCurrentFloor(
  entries: readonly ElementsPanelEntry[],
  currentFloorZ: number,
  floors: Floor[],
): ElementsPanelEntry[] {
  return [...entries].sort((entryA, entryB) => {
    const isCurrentFloorA = isElementOnActiveCanvasFloor(entryA.representative, currentFloorZ, floors);
    const isCurrentFloorB = isElementOnActiveCanvasFloor(entryB.representative, currentFloorZ, floors);
    if (isCurrentFloorA && !isCurrentFloorB) return -1;
    if (!isCurrentFloorA && isCurrentFloorB) return 1;
    return 0;
  });
}

export function summarizeElementEntry(
  entry: ElementsPanelEntry,
  {
    currentFloorZ,
    elementHasComparisonInfo,
    floors,
    getValidation,
  }: {
    currentFloorZ: number;
    elementHasComparisonInfo: (element: Element) => boolean;
    floors: Floor[];
    getValidation: (element: Element) => ValidationResult;
  },
): ElementsPanelEntrySummary {
  const validation = entry.members.reduce(
    (acc, member) => {
      const next = getValidation(member);
      if (next.hasIssues) {
        acc.hasIssues = true;
        acc.issues.push(...next.issues);
      }
      if (next.hasWarnings) {
        acc.hasWarnings = true;
        acc.warnings.push(...next.warnings);
      }
      return acc;
    },
    { hasIssues: false, hasWarnings: false, issues: [] as ValidationIssue[], warnings: [] as ValidationIssue[] },
  );

  return {
    key: getElementEntryKey(entry),
    validation,
    hasComparisonInfo: entry.members.some((member) => elementHasComparisonInfo(member)),
    elementFloorZ: getElementCanvasFloorZValue(entry.representative, floors) ?? 0,
    isCurrentFloor: isElementOnActiveCanvasFloor(entry.representative, currentFloorZ, floors),
  };
}
