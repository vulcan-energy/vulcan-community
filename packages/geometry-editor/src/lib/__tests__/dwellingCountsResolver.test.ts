// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// resolveEffectiveDwellingDetails must resolve room counts dwelling-wide.
// Companion to dwellingCountsAcrossZones.test.ts, at the resolver boundary that
// ioSlice (CSV export), GeometryBuilder and Part F all consume.

import { describe, expect, it } from 'vitest';
import { resolveEffectiveDwellingDetails } from '../effectiveDwellingDetails';
import type { SpaceLabel, Zone } from '../../geometry/types';

const rect = (z = 0) => [
  { x: 0, y: 0, z },
  { x: 3, y: 0, z },
  { x: 3, y: 3, z },
  { x: 0, y: 3, z },
];

const zones: Zone[] = [
  { id: 'z-living', name: 'Living', floorArea: 42.89, height: 2.56, isPlaceholder: false },
  { id: 'z-rest', name: 'Rest of Dwelling', floorArea: 35.03, height: 2.68, isPlaceholder: false },
];

const label = (id: string, zoneId: string, room_type: string, storey = 0): SpaceLabel => ({
  id,
  name: id,
  zoneId,
  storey,
  room_type,
  coordinates: rect(storey),
});

const labels: SpaceLabel[] = [
  label('living', 'z-living', 'living_room'),
  label('kitchen', 'z-living', 'kitchen'),
  label('wc', 'z-living', 'wc'),
  label('bed1', 'z-rest', 'bedroom', 1),
  label('bed2', 'z-rest', 'bedroom', 1),
  label('bed3', 'z-rest', 'bedroom', 1),
  label('bath', 'z-rest', 'bathroom', 1),
];

const resolve = (complianceSettings = {}) =>
  resolveEffectiveDwellingDetails({
    zones,
    elementsById: {},
    spaceLabelsById: Object.fromEntries(labels.map((l) => [l.id, l])),
    spaceLabelIds: labels.map((l) => l.id),
    complianceSettings,
  });

describe('resolveEffectiveDwellingDetails across zones', () => {
  it('derives bedrooms from every zone, not just the first', () => {
    const result = resolve();
    expect(result.bedrooms).toBe(3);
    expect(result.habitableRooms).toBe(4);
    expect(result.wetRooms).toBe(3); // kitchen + wc + bathroom
    expect(result.bathrooms).toBe(1);
  });

  it('still lets an explicit override win over the derivation', () => {
    const result = resolve({ NumberOfBedrooms: 5 });
    expect(result.bedrooms).toBe(5);
    expect(result.overrides.bedrooms).toBe(true);
  });

  it('reports no derived counts when nothing is labelled anywhere', () => {
    const untyped = [label('f1', 'z-living', ''), label('f2', 'z-rest', '', 1)];
    const result = resolveEffectiveDwellingDetails({
      zones,
      elementsById: {},
      spaceLabelsById: Object.fromEntries(untyped.map((l) => [l.id, l])),
      spaceLabelIds: untyped.map((l) => l.id),
      complianceSettings: {},
    });
    expect(result.bedrooms).toBeUndefined();
  });
});
