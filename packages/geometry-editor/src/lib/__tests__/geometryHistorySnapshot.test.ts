// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  buildHistoryDocumentSnapshotFromState,
  historyDocumentSnapshotsContentEqual,
} from '../geometryHistorySnapshot';

describe('geometryHistorySnapshot', () => {
  it('treats snapshots as equal when only element _v differs', () => {
    const a = buildHistoryDocumentSnapshotFromState({
      elementsById: { e1: { id: 'e1', name: 'W', type: 'BuildingElementOpaque', _v: 1, coordinates: [] } },
      elementIds: ['e1'],
      zones: [],
      floors: [],
      floorIds: [],
      currentFloorId: null,
    });
    const b = buildHistoryDocumentSnapshotFromState({
      elementsById: { e1: { id: 'e1', name: 'W', type: 'BuildingElementOpaque', _v: 99, coordinates: [] } },
      elementIds: ['e1'],
      zones: [],
      floors: [],
      floorIds: [],
      currentFloorId: null,
    });
    expect(historyDocumentSnapshotsContentEqual(a, b)).toBe(true);
  });

  it('distinguishes real element changes from _v', () => {
    const a = buildHistoryDocumentSnapshotFromState({
      elementsById: { e1: { id: 'e1', name: 'W', type: 'BuildingElementOpaque', _v: 1, coordinates: [{ x: 0, y: 0, z: 0 }] } },
      elementIds: ['e1'],
      zones: [],
      floors: [],
      floorIds: [],
      currentFloorId: null,
    });
    const b = buildHistoryDocumentSnapshotFromState({
      elementsById: { e1: { id: 'e1', name: 'W', type: 'BuildingElementOpaque', _v: 1, coordinates: [{ x: 1, y: 0, z: 0 }] } },
      elementIds: ['e1'],
      zones: [],
      floors: [],
      floorIds: [],
      currentFloorId: null,
    });
    expect(historyDocumentSnapshotsContentEqual(a, b)).toBe(false);
  });
});
