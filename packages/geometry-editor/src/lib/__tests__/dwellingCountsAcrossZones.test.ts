// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Dwelling room counts are a property of the DWELLING, not of one zone.
//
// Regression: a two-zone FHS model ("Living" downstairs, "Rest of Dwelling"
// upstairs) exported NumberOfBedrooms=0 because the derivation only aggregated
// the first non-placeholder zone, silently dropping every upstairs bedroom.
// The merged HEM JSON collapses those zones into one anyway, so scoping the
// counts to one zone was never right.
//
// Fixture captures the split-storey, split-zone dwelling-count regression.

import { describe, expect, it } from 'vitest';
import type { SpaceLabel, Zone } from '../../geometry/types';
import {
  aggregateDwellingCounts,
  aggregateSpaceLabelsForZone,
  dwellingCountZoneIds,
} from '../spaceLabelDerivation';

const rect = (x0: number, y0: number, x1: number, y1: number, z = 0) => [
  { x: x0, y: y0, z },
  { x: x1, y: y0, z },
  { x: x1, y: y1, z },
  { x: x0, y: y1, z },
];

const zoneLiving: Zone = {
  id: 'z-living',
  name: 'Living',
  floorArea: 42.89,
  height: 2.56,
  volume: 109.8,
  isPlaceholder: false,
};
const zoneRest: Zone = {
  id: 'z-rest',
  name: 'Rest of Dwelling',
  floorArea: 35.03,
  height: 2.68,
  volume: 93.88,
  isPlaceholder: false,
};

// Footprints must not overlap: analyzeSpaceLabelGeometry treats a fully
// contained polygon as nested and zeroes its effective area.
let nextSlot = 0;
const label = (
  id: string,
  zoneId: string,
  room_type: string,
  storey = 0,
): SpaceLabel => {
  const x0 = nextSlot++ * 4;
  return {
    id,
    name: id,
    zoneId,
    storey,
    room_type,
    coordinates: rect(x0, 0, x0 + 3, 3, storey),
  };
};

/** Ground floor in "Living", first floor in "Rest of Dwelling". */
const splitZoneDwellingLabels = (): SpaceLabel[] => {
  nextSlot = 0;
  return [
    label('Living Room', 'z-living', 'living_room'),
    label('Kitchen', 'z-living', 'kitchen'),
    label('Circulation', 'z-living', 'circulation'),
    label('Wc', 'z-living', 'wc'),
    label('Bedroom 1', 'z-rest', 'bedroom', 1),
    label('Bedroom', 'z-rest', 'bedroom', 1),
    label('Bedroom 2', 'z-rest', 'bedroom', 1),
    label('Bathroom', 'z-rest', 'bathroom', 1),
    label('Other', 'z-rest', 'other', 1),
    label('Utility', 'z-rest', 'utility', 1),
  ];
};

describe('dwelling counts span every non-placeholder zone', () => {
  it('counts rooms across both zones of a split-storey dwelling', () => {
    const zoneIds = dwellingCountZoneIds([zoneLiving, zoneRest]);
    const { dwellingCounts } = aggregateDwellingCounts(splitZoneDwellingLabels(), zoneIds);

    expect(dwellingCounts).toEqual({
      NumberOfBedrooms: 3,
      NumberOfHabitableRooms: 4, // living room + 3 bedrooms
      NumberOfWetRooms: 4, // kitchen + wc + bathroom + utility
      NumberOfHotTappedRooms: 2, // kitchen + bathroom
      NumberOfBathrooms: 1,
      NumberOfUtilityRooms: 1,
      NumberOfSanitaryAccommodations: 1,
    });
  });

  it('primary-zone-only aggregation is what produced the 0 (documents the old behaviour)', () => {
    const agg = aggregateSpaceLabelsForZone(splitZoneDwellingLabels(), 'z-living');
    // Every count the broken export wrote, reproduced exactly.
    expect(agg.dwellingCounts.NumberOfBedrooms).toBe(0);
    expect(agg.dwellingCounts.NumberOfWetRooms).toBe(2);
    expect(agg.dwellingCounts.NumberOfHabitableRooms).toBe(1);
  });

  it('ignores labels belonging to placeholder zones', () => {
    const placeholder: Zone = { ...zoneRest, id: 'z-ghost', isPlaceholder: true };
    const zoneIds = dwellingCountZoneIds([zoneLiving, placeholder]);
    const labels = [
      label('Living Room', 'z-living', 'living_room'),
      label('Ghost Bedroom', 'z-ghost', 'bedroom'),
    ];
    const { dwellingCounts } = aggregateDwellingCounts(labels, zoneIds);
    expect(dwellingCounts.NumberOfBedrooms).toBe(0);
  });

  it('reports whether any counted footprint carries a room type', () => {
    const zoneIds = dwellingCountZoneIds([zoneLiving, zoneRest]);

    expect(aggregateDwellingCounts(splitZoneDwellingLabels(), zoneIds).hasLabelledFootprints).toBe(true);

    const untyped = [label('Footprint 1', 'z-living', ''), label('Footprint 2', 'z-rest', '  ')];
    const result = aggregateDwellingCounts(untyped, zoneIds);
    expect(result.hasLabelledFootprints).toBe(false);
    expect(result.dwellingCounts.NumberOfBedrooms).toBe(0);
  });

  it('keeps floor area per-zone while counts go dwelling-wide', () => {
    // Areas are legitimately zone-scoped (each zone carries its own
    // livingroom_area / restofdwelling_area), so this must NOT change.
    const living = aggregateSpaceLabelsForZone(splitZoneDwellingLabels(), 'z-living');
    const rest = aggregateSpaceLabelsForZone(splitZoneDwellingLabels(), 'z-rest');
    expect(living.totalFloorAreaM2).toBe(36); // 4 labels x 9 m2
    expect(rest.totalFloorAreaM2).toBe(54); // 6 labels x 9 m2
  });
});
