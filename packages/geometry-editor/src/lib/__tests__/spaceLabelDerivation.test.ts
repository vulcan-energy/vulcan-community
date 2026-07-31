// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { SpaceLabel, Zone } from '../../geometry/types';
import {
  aggregateSpaceLabelsForZone,
  applySpaceLabelsToZonesAndCompliance,
  formatDwellingCountMismatchWarnings,
  fullDwellingCountsCompliancePatch,
  getDwellingCountSpaceLabelMismatchState,
  spaceLabelPlanAreaM2,
} from '../spaceLabelDerivation';

const rect = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z = 0,
): Array<{ x: number; y: number; z: number }> => [
  { x: x0, y: y0, z },
  { x: x1, y: y0, z },
  { x: x1, y: y1, z },
  { x: x0, y: y1, z },
];

describe('spaceLabelDerivation', () => {
  const primaryZone: Zone = {
    id: 'zp',
    name: 'Dwelling',
    floorArea: 999,
    height: 2.5,
    volume: 1000,
    simplifiedThermalBridging: false,
  };

  it('computes plan area for horizontal polygon', () => {
    const sl: SpaceLabel = {
      id: '1',
      name: 'R',
      zoneId: 'zp',
      storey: 0,
      room_type: 'bedroom',
      coordinates: rect(0, 0, 3, 4),
    };
    expect(spaceLabelPlanAreaM2(sl)).toBe(12);
  });

  it('aggregates floor, living/rest split, and bedroom count', () => {
    const labels: SpaceLabel[] = [
      {
        id: 'a',
        name: 'Living',
        zoneId: 'zp',
        storey: 0,
        room_type: 'living_room',
        coordinates: rect(0, 0, 2, 3),
      },
      {
        id: 'b',
        name: 'Bed',
        zoneId: 'zp',
        storey: 0,
        room_type: 'bedroom',
        coordinates: rect(2, 0, 5, 4),
      },
    ];
    const agg = aggregateSpaceLabelsForZone(labels, 'zp');
    expect(agg.totalFloorAreaM2).toBe(18);
    expect(agg.livingAreaM2).toBe(6);
    expect(agg.restAreaM2).toBe(12);
    expect(agg.dwellingCounts.NumberOfBedrooms).toBe(1);
    expect(agg.dwellingCounts.NumberOfHabitableRooms).toBe(2);
  });

  it('hall, circulation and other are rest-of-dwelling and not counted as habitable rooms', () => {
    const labels: SpaceLabel[] = [
      { id: 'a', name: 'Hall', zoneId: 'zp', storey: 0, room_type: 'hall', coordinates: rect(0, 0, 2, 2) },
      { id: 'b', name: 'Land', zoneId: 'zp', storey: 0, room_type: 'circulation', coordinates: rect(2, 0, 4, 2) },
      { id: 'c', name: 'Misc', zoneId: 'zp', storey: 0, room_type: 'other', coordinates: rect(4, 0, 6, 2) },
      { id: 'd', name: 'Bed', zoneId: 'zp', storey: 0, room_type: 'bedroom', coordinates: rect(6, 0, 8, 2) },
    ];
    const agg = aggregateSpaceLabelsForZone(labels, 'zp');
    expect(agg.totalFloorAreaM2).toBe(16);
    expect(agg.livingAreaM2).toBe(0);
    expect(agg.restAreaM2).toBe(16);
    expect(agg.dwellingCounts.NumberOfHabitableRooms).toBe(1);
    expect(agg.dwellingCounts.NumberOfBedrooms).toBe(1);
  });

  it('kitchen contributes to rest of dwelling unless marked open to living room', () => {
    const labels: SpaceLabel[] = [
      { id: 'a', name: 'Kit', zoneId: 'zp', storey: 0, room_type: 'kitchen', coordinates: rect(0, 0, 3, 4) },
      { id: 'b', name: 'Bed', zoneId: 'zp', storey: 0, room_type: 'bedroom', coordinates: rect(3, 0, 6, 4) },
    ];
    const agg = aggregateSpaceLabelsForZone(labels, 'zp');
    expect(agg.totalFloorAreaM2).toBe(24);
    expect(agg.livingAreaM2).toBe(0);
    expect(agg.restAreaM2).toBe(24);
    expect(agg.dwellingCounts.NumberOfHabitableRooms).toBe(1);
    expect(agg.dwellingCounts.NumberOfWetRooms).toBe(1);
    expect(agg.dwellingCounts.NumberOfHotTappedRooms).toBe(1);
  });

  it('open-to-living spaces contribute to living area without changing room counts', () => {
    const labels: SpaceLabel[] = [
      {
        id: 'a',
        name: 'Kitchen',
        zoneId: 'zp',
        storey: 0,
        room_type: 'kitchen',
        coordinates: rect(0, 0, 3, 4),
        extra_json: { open_to_living_room: true },
      },
      { id: 'b', name: 'Bed', zoneId: 'zp', storey: 0, room_type: 'bedroom', coordinates: rect(3, 0, 6, 4) },
    ];
    const agg = aggregateSpaceLabelsForZone(labels, 'zp');
    expect(agg.totalFloorAreaM2).toBe(24);
    expect(agg.livingAreaM2).toBe(12);
    expect(agg.restAreaM2).toBe(12);
    expect(agg.dwellingCounts.NumberOfHabitableRooms).toBe(1);
    expect(agg.dwellingCounts.NumberOfWetRooms).toBe(1);
    expect(agg.dwellingCounts.NumberOfHotTappedRooms).toBe(1);
  });

  it('other_habitable increments NumberOfHabitableRooms but is rest-of-dwelling', () => {
    const labels: SpaceLabel[] = [
      { id: 'a', name: 'Study', zoneId: 'zp', storey: 0, room_type: 'other_habitable', coordinates: rect(0, 0, 3, 3) },
    ];
    const agg = aggregateSpaceLabelsForZone(labels, 'zp');
    expect(agg.totalFloorAreaM2).toBe(9);
    expect(agg.livingAreaM2).toBe(0);
    expect(agg.restAreaM2).toBe(9);
    expect(agg.dwellingCounts.NumberOfHabitableRooms).toBe(1);
  });

  it('excludes overlapping space-label area from floor total and rest-of-dwelling', () => {
    const labels: SpaceLabel[] = [
      {
        id: 'a',
        name: 'Void',
        zoneId: 'zp',
        storey: 0,
        room_type: 'void',
        coordinates: rect(0, 0, 10, 10),
      },
      {
        id: 'b',
        name: 'Bed',
        zoneId: 'zp',
        storey: 0,
        room_type: 'bedroom',
        coordinates: rect(0, 0, 2, 2),
      },
    ];
    const agg = aggregateSpaceLabelsForZone(labels, 'zp');
    expect(agg.totalFloorAreaM2).toBe(96);
    expect(agg.livingAreaM2).toBe(0);
    expect(agg.restAreaM2).toBe(96);
    expect(agg.dwellingCounts.NumberOfBedrooms).toBe(1);
    expect(agg.dwellingCounts.NumberOfHabitableRooms).toBe(1);
    expect(agg.geometryAnalysis?.issues.some((issue) => issue.kind === 'overlap')).toBe(true);
  });

  it('skips unassigned room_type for aggregation', () => {
    const labels: SpaceLabel[] = [
      {
        id: 'a',
        name: 'X',
        zoneId: 'zp',
        storey: 0,
        room_type: '',
        coordinates: rect(0, 0, 10, 10),
      },
      {
        id: 'b',
        name: 'Bed',
        zoneId: 'zp',
        storey: 0,
        room_type: 'bedroom',
        coordinates: rect(0, 0, 2, 2),
      },
    ];
    const agg = aggregateSpaceLabelsForZone(labels, 'zp');
    expect(agg.totalFloorAreaM2).toBe(4);
  });

  it('applySpaceLabelsToZonesAndCompliance updates primary zone and compliance patch', () => {
    const labels: SpaceLabel[] = [
      {
        id: 'a',
        name: 'Living',
        zoneId: 'zp',
        storey: 0,
        room_type: 'living_room',
        coordinates: rect(0, 0, 3, 4),
      },
    ];
    const { zones, compliancePatch } = applySpaceLabelsToZonesAndCompliance(
      [primaryZone],
      labels,
      true,
    );
    expect(zones[0].floorArea).toBe(12);
    expect(zones[0].volume).toBe(30);
    expect(zones[0].livingroom_area).toBe(12);
    expect(zones[0].restofdwelling_area).toBe(0);
    expect(zones[0]._floorAreaUserOverride).toBe(true);
    expect(zones[0]._areaSource).toBe('Space labels');
    expect(compliancePatch.NumberOfHabitableRooms).toBe(1);
    // Fields with no matching labels are written as 0 so strict-mode required-field
    // validation doesn't fire on dwelling-counts derived from space labels.
    expect(compliancePatch.NumberOfUtilityRooms).toBe(0);
    expect(compliancePatch.NumberOfBedrooms).toBe(0);
    expect(compliancePatch.NumberOfBathrooms).toBe(0);
  });

  it('fullDwellingCountsCompliancePatch includes zero-valued dwelling counts', () => {
    const agg = aggregateSpaceLabelsForZone([], 'zp');
    const patch = fullDwellingCountsCompliancePatch(agg.dwellingCounts);
    expect(patch.NumberOfBedrooms).toBe(0);
    expect(patch.NumberOfWetRooms).toBe(0);
  });

  it('getDwellingCountSpaceLabelMismatchState flags stored counts that differ from labels', () => {
    const labels: SpaceLabel[] = [
      {
        id: 'a',
        name: 'Bed',
        zoneId: 'zp',
        storey: 0,
        room_type: 'bedroom',
        coordinates: rect(0, 0, 2, 2),
      },
    ];
    const compliance = { NumberOfBedrooms: 3, NumberOfHabitableRooms: 1 };
    const st = getDwellingCountSpaceLabelMismatchState([primaryZone], ['a'], { a: labels[0] }, compliance);
    expect(st.hasLabelledFootprintsInPrimary).toBe(true);
    expect(st.mismatches.map((m) => m.field)).toContain('NumberOfBedrooms');
    const bed = st.mismatches.find((m) => m.field === 'NumberOfBedrooms');
    expect(bed?.stored).toBe(3);
    expect(bed?.derived).toBe(1);
  });

  it('getDwellingCountSpaceLabelMismatchState returns empty when no labelled footprints', () => {
    const labels: SpaceLabel[] = [
      {
        id: 'a',
        name: 'X',
        zoneId: 'zp',
        storey: 0,
        room_type: '',
        coordinates: rect(0, 0, 2, 2),
      },
    ];
    const st = getDwellingCountSpaceLabelMismatchState([primaryZone], ['a'], { a: labels[0] }, { NumberOfBedrooms: 9 });
    expect(st.hasLabelledFootprintsInPrimary).toBe(false);
    expect(st.mismatches).toEqual([]);
  });

  it('formatDwellingCountMismatchWarnings produces user-facing strings', () => {
    const msgs = formatDwellingCountMismatchWarnings([
      { field: 'NumberOfBedrooms', stored: 2, derived: 1 },
    ]);
    expect(msgs[0]).toContain('Bedrooms');
    expect(msgs[0]).toContain('entered 2');
    expect(msgs[0]).toContain('space labels 1');
  });
});
