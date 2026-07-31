// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type GeometrySourceComparisonInfoItem = Readonly<{
  message: string;
  fieldKey?: string;
}>;

export type GeometrySourceComparisonElementInfo = Readonly<{
  items: readonly GeometrySourceComparisonInfoItem[];
  fieldIndicators: Readonly<Record<string, readonly string[]>>;
  derivedBadge?: Readonly<{ label: string }>;
}>;

export type GeometrySourceComparisonZoneInfo = Readonly<{
  items: readonly GeometrySourceComparisonInfoItem[];
  fieldIndicators: Readonly<Record<string, readonly string[]>>;
}>;

export type GeometrySourceComparisonGlobalInfo = Readonly<{
  fieldIndicators: Readonly<Record<string, readonly string[]>>;
  sectionItems: Readonly<Record<string, readonly string[]>>;
}>;

export type GeometrySourceComparisonMissingItem = Readonly<{
  id: string;
  elementType: string;
  name?: string;
  zoneId?: string;
  message: string;
  canAssign: boolean;
  drawMode: 'line' | 'polygon';
}>;

export type GeometrySourceComparisonAssignment = Readonly<{
  label: string;
  sourceName: string;
}>;

export type GeometrySourceComparisonSnapshot = Readonly<{
  revision: number;
  inputRevision: number;
}>;

export interface GeometrySourceComparisonPort {
  readonly availability: 'available' | 'unavailable';
  readonly label: string;
  getSnapshot(): GeometrySourceComparisonSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(defaultsJson: unknown | null): void;
  elementInfo(elementId: string): GeometrySourceComparisonElementInfo | null;
  zoneInfo(zoneId: string): GeometrySourceComparisonZoneInfo | null;
  globalInfo(): GeometrySourceComparisonGlobalInfo | null;
  listMissingItems(query: string): readonly GeometrySourceComparisonMissingItem[];
  candidateElementTypes(itemId: string): readonly string[];
  prefillMissingItem(itemId: string): Readonly<Record<string, unknown>> | null;
  assignMissingItem(itemId: string, elementId: string): Promise<void>;
  assignmentForElement(elementName: string): GeometrySourceComparisonAssignment | null;
  unassignElement(elementName: string): Promise<void>;
}

const EMPTY_SNAPSHOT: GeometrySourceComparisonSnapshot = Object.freeze({
  revision: 0,
  inputRevision: 0,
});

export const unavailableGeometrySourceComparisonPort: GeometrySourceComparisonPort =
  Object.freeze({
    availability: 'unavailable',
    label: 'comparison',
    getSnapshot: () => EMPTY_SNAPSHOT,
    subscribe: () => () => undefined,
    refresh: () => undefined,
    elementInfo: () => null,
    zoneInfo: () => null,
    globalInfo: () => null,
    listMissingItems: () => [],
    candidateElementTypes: () => [],
    prefillMissingItem: () => null,
    assignMissingItem: async () => undefined,
    assignmentForElement: () => null,
    unassignElement: async () => undefined,
  });
