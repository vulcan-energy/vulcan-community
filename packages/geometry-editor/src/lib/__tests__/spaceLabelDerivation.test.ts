// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element, SpaceLabel, Zone } from '../../geometry/types';
import { validateSpaceLabels } from '../../geometry/validation/validateSpaceLabels';
import { analyzeSpaceLabelGeometry, analyzeZoneSpaceLabels, getTreatedFloorBoundaryPolygonsForZone } from '../spaceLabelGeometry';
import { calculateDerivedFloorArea, getVolumeCalculationBreakdown, partyElementPitchKeepingSurface } from '../zoneDerivation';
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

describe('treated floor area from floors and space labels', () => {
  const zone: Zone = { id: 'z', name: 'Z', floorArea: 100, height: 2.5, volume: 250, simplifiedThermalBridging: false };
  const element = (id: string, type: string, coordinates: unknown, extra: Record<string, unknown> = {}) =>
    ({ id, name: id, type, zoneId: 'z', coordinates, ...extra }) as unknown as Element;
  const ground = element('ground', 'BuildingElementGround', rect(0, 0, 10, 10));
  const upperWall = element(
    'wall',
    'BuildingElementOpaque',
    [{ x: 0, y: 0, z: 1 }, { x: 10, y: 0, z: 1 }],
    { pitch: 90, height: 2.5, base_height: 2.5 },
  );
  const internal = (id: string, pitch: number, base_height: number) =>
    element(id, 'BuildingElementAdjacentConditionedSpace', rect(0, 0, 10, 10, 1), { pitch, base_height });
  const label = (id: string, storey: number, coordinates: SpaceLabel['coordinates']): SpaceLabel => ({
    id,
    name: id,
    zoneId: 'z',
    storey,
    room_type: 'bedroom',
    coordinates,
  });
  const validate = (labels: SpaceLabel[], elements: Element[], complianceValidationEnabled = false, target = zone) =>
    validateSpaceLabels(Object.fromEntries(labels.map((l) => [l.id, l])), labels.map((l) => l.id), {
      zones: [target],
      elementsById: Object.fromEntries(elements.map((e) => [e.id, e])),
      complianceValidationEnabled,
    });

  it('counts an internal floor at its storey base at either pitch', () => {
    for (const pitch of [0, 180]) {
      const elements = [ground, upperWall, internal('floor', pitch, 2.5)];
      expect(calculateDerivedFloorArea('z', elements).floorArea).toBe(200);
      expect(getTreatedFloorBoundaryPolygonsForZone('z', elements, 1)).toHaveLength(1);
    }
  });

  it('does not count a partition on the lowest storey, or a roof', () => {
    const ceiling = element('ceiling', 'BuildingElementAdjacentConditionedSpace', rect(0, 0, 10, 10), { pitch: 0 });
    const roof = element('roof', 'BuildingElementOpaque', rect(0, 0, 10, 10, 1), { pitch: 0, base_height: 5 });
    expect(calculateDerivedFloorArea('z', [ground, ceiling, upperWall, roof]).floorArea).toBe(100);
  });

  it('does not double-count pitch-0 and pitch-180 internal elements at the same level', () => {
    const elements = [ground, upperWall, internal('floor', 180, 2.5), internal('ceiling-face', 0, 2.5)];
    expect(calculateDerivedFloorArea('z', elements).floorArea).toBe(200);
  });

  it('finds a label\'s floors from its plan level, whatever its storey index', () => {
    const elements = [ground, upperWall, element('deck', 'BuildingElementOpaque', rect(0, 0, 5, 10, 1), { pitch: 180 })];
    const analysis = analyzeZoneSpaceLabels('z', [label('a', 3, rect(0, 0, 10, 10, 1))], elements);
    expect(analysis.effectiveAreasByLabelId.a).toBeCloseTo(50, 6);
  });

  it('does not let a small pitch-0 partition stand in for a storey floor', () => {
    const partition = element('ceiling', 'BuildingElementAdjacentConditionedSpace', rect(0, 0, 2, 2, 1), { pitch: 0 });
    const analysis = analyzeZoneSpaceLabels('z', [label('a', 1, rect(0, 0, 10, 10, 1))], [ground, upperWall, partition]);
    expect(analysis.effectiveAreasByLabelId.a).toBeCloseTo(100, 6);
  });

  it('keeps an element\'s surface when it becomes party', () => {
    const partition = (z: number, pitch: number) =>
      element('p', 'BuildingElementAdjacentConditionedSpace', rect(0, 0, 10, 10, z), { pitch });
    expect(partyElementPitchKeepingSurface(partition(0, 180), [partition(0, 180)])).toBe(180);
    expect(partyElementPitchKeepingSurface(partition(0, 0), [ground])).toBe(0);
    expect(partyElementPitchKeepingSurface(partition(1, 0), [ground])).toBe(180);
  });

  it('keeps room area when a thin bent strip runs around the label', () => {
    const labels = [label('room', 0, rect(0.02, 0, 9.98, 9.98))];
    const analysis = analyzeSpaceLabelGeometry(labels, new Map([[0, [rect(0, 0, 10, 10)]]]));
    expect(analysis.effectiveAreasByLabelId.room).toBeCloseTo(9.96 * 9.98, 3);
    expect(analysis.storeyCoverage.get(0)?.outsideM2 ?? 0).toBeCloseTo(0, 6);
  });

  it('accounts for all labelled area as counted, overlapping or outside', () => {
    const labels = [label('a', 0, rect(0, 0, 6, 10)), label('b', 0, rect(5, 0, 12, 10))];
    const analysis = analyzeSpaceLabelGeometry(labels, new Map([[0, [rect(0, 0, 10, 10)]]]));
    const counted = analysis.effectiveAreasByLabelId.a! + analysis.effectiveAreasByLabelId.b!;
    const coverage = analysis.storeyCoverage.get(0)!;
    expect(coverage.labelledM2).toBeCloseTo(120, 6);
    const overlap = analysis.issues.reduce((sum, issue) => sum + issue.areaM2, 0);
    expect(overlap).toBeCloseTo(10, 6);
    expect(counted + overlap + coverage.outsideM2).toBeCloseTo(coverage.labelledM2, 6);
    expect(coverage.outsideM2).toBeCloseTo(20, 6);
  });

  it('counts an overlap that is only drawing tolerance once, without a warning', () => {
    const labels = [label('a', 0, rect(0, 0, 5.005, 10)), label('b', 0, rect(5, 0, 10, 10))];
    expect(validate(labels, [ground]).warnings).toHaveLength(0);
    const analysis = analyzeSpaceLabelGeometry(labels, new Map([[0, [rect(0, 0, 10, 10)]]]));
    expect(analysis.effectiveAreasByLabelId.a! + analysis.effectiveAreasByLabelId.b!).toBeCloseTo(100, 6);
  });

  it('raises one error per storey for a material area loss and none for rounding', () => {
    const lost = validate([label('a', 0, rect(0, 0, 10, 10)), label('b', 1, rect(0, 0, 10, 10, 1))], [ground, upperWall,
      element('deck', 'BuildingElementOpaque', rect(0, 0, 2, 2, 1), { pitch: 180 })]);
    expect(lost.issues).toHaveLength(1);
    expect(lost.issues[0]!.message).toContain('Z=1: 96.0 m²');
    expect(validate([label('a', 0, rect(0, 0, 10.04, 10))], [ground]).issues).toHaveLength(0);
    expect(validate([label('a', 0, rect(0, 0, 10.04, 10))], [ground]).warnings).toHaveLength(0);
  });

  it('flags a stored FHS area that differs materially from the space labels', () => {
    const stale = { ...zone, floorArea: 60 };
    const labels = [label('a', 0, rect(0, 0, 10, 10))];
    expect(validate(labels, [ground], true, stale).issues[0]!.message).toContain('60.0 m²');
    expect(validate(labels, [ground], false, stale).issues).toHaveLength(0);
    expect(validate(labels, [ground], true).issues).toHaveLength(0);
  });

  it('shows the values the zone actually uses in the volume tooltip', () => {
    expect(getVolumeCalculationBreakdown({ ...zone, floorArea: 95.93, height: 2.46, volume: 235.99 }))
      .toBe('95.93 m² × 2.46 m = 235.99 m³');
  });
});
