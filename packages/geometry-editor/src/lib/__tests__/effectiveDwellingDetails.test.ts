// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Tests for the unified effective-dwelling-details resolver. Migrating call sites
// (Part F context, ioSlice CSV export, GeometryBuilder UI) all depend on this contract.

import { describe, it, expect } from 'vitest';
import { resolveEffectiveDwellingDetails, resolveEffectiveVentilationBaseHeight, ventilationZoneBaseFrame } from '../effectiveDwellingDetails';
import type { Element, SpaceLabel, Zone } from '../../geometry/types';

const zone = (): Zone => ({
  id: 'zone-1',
  name: 'Zone 1',
  floorArea: 100,
  height: 2.5,
  isPlaceholder: false,
});

const bedroomLabel = (cx: number, cy: number, size = 4): SpaceLabel => ({
  id: `sl-bed-${cx}-${cy}`,
  name: `bedroom-${cx}-${cy}`,
  zoneId: 'zone-1',
  storey: 0,
  room_type: 'bedroom',
  coordinates: [
    { x: cx - size / 2, y: cy - size / 2, z: 0 },
    { x: cx + size / 2, y: cy - size / 2, z: 0 },
    { x: cx + size / 2, y: cy + size / 2, z: 0 },
    { x: cx - size / 2, y: cy + size / 2, z: 0 },
  ],
});

const groundElement = (cx: number, cy: number, size = 4): Element => ({
  id: `ground-${cx}-${cy}`,
  name: 'Ground',
  type: 'BuildingElementGround',
  width: size,
  height: size,
  area: size * size,
  total_area: size * size,
  perimeter: size * 4,
  floor_type: 'Slab_no_edge_insulation',
  parent_element: null,
  coordinates: [
    { x: cx - size / 2, y: cy - size / 2, z: 0 },
    { x: cx + size / 2, y: cy - size / 2, z: 0 },
    { x: cx + size / 2, y: cy + size / 2, z: 0 },
    { x: cx - size / 2, y: cy + size / 2, z: 0 },
  ],
  isPlaceholder: false,
} as Element);

const labelsById = (labels: SpaceLabel[]) => Object.fromEntries(labels.map((l) => [l.id, l]));
const labelIds = (labels: SpaceLabel[]) => labels.map((l) => l.id);
const elementsById = (els: Element[]) => Object.fromEntries(els.map((e) => [e.id, e]));

describe('resolveEffectiveDwellingDetails', () => {
  it('returns space-label-derived counts when complianceSettings has no override', () => {
    const labels = [bedroomLabel(0, 0), bedroomLabel(10, 0)];
    const result = resolveEffectiveDwellingDetails({
      zones: [zone()],
      elementsById: {},
      spaceLabelsById: labelsById(labels),
      spaceLabelIds: labelIds(labels),
      complianceSettings: {},
    });
    expect(result.bedrooms).toBe(2);
    expect(result.overrides.bedrooms).toBe(false);
    expect(result.totalFloorAreaM2).toBeGreaterThan(0);
  });

  it('explicit complianceSettings override wins, override flag set', () => {
    const labels = [bedroomLabel(0, 0)];
    const result = resolveEffectiveDwellingDetails({
      zones: [zone()],
      elementsById: {},
      spaceLabelsById: labelsById(labels),
      spaceLabelIds: labelIds(labels),
      complianceSettings: { NumberOfBedrooms: 5 },
    });
    expect(result.bedrooms).toBe(5);
    expect(result.overrides.bedrooms).toBe(true);
  });

  it('groundFloorArea: derivation > 0 returned; 0 → undefined (CSV export semantics)', () => {
    const noGround = resolveEffectiveDwellingDetails({
      zones: [zone()],
      elementsById: {},
      spaceLabelsById: {},
      spaceLabelIds: [],
      complianceSettings: {},
    });
    expect(noGround.groundFloorAreaM2).toBeUndefined();

    const elements = [groundElement(0, 0)];
    const withGround = resolveEffectiveDwellingDetails({
      zones: [zone()],
      elementsById: elementsById(elements),
      spaceLabelsById: {},
      spaceLabelIds: [],
      complianceSettings: {},
    });
    expect(withGround.groundFloorAreaM2).toBeGreaterThan(0);
  });

  it('buildingLength/Width: zero derivation → undefined (matches legacy ioSlice guard)', () => {
    const result = resolveEffectiveDwellingDetails({
      zones: [zone()],
      elementsById: {},
      spaceLabelsById: {},
      spaceLabelIds: [],
      complianceSettings: {},
    });
    expect(result.buildingLengthM).toBeUndefined();
    expect(result.buildingWidthM).toBeUndefined();
  });

  it('storeys: derived from BuildingElementGround when no override', () => {
    const result = resolveEffectiveDwellingDetails({
      zones: [zone()],
      elementsById: elementsById([groundElement(0, 0)]),
      spaceLabelsById: {},
      spaceLabelIds: [],
      complianceSettings: {},
    });
    expect(result.storeysInDwelling).toBe(1);
    expect(result.buildType).toBe('house'); // ground element present → house
  });

  it('build_type override takes precedence over derivation', () => {
    const result = resolveEffectiveDwellingDetails({
      zones: [zone()],
      elementsById: elementsById([groundElement(0, 0)]),
      spaceLabelsById: {},
      spaceLabelIds: [],
      complianceSettings: { build_type: 'flat' },
    });
    expect(result.buildType).toBe('flat');
    expect(result.overrides.buildType).toBe(true);
  });

  it('passes through KitchenExtractorHoodExternal verbatim (no derivation source)', () => {
    const off = resolveEffectiveDwellingDetails({
      zones: [zone()], elementsById: {}, spaceLabelsById: {}, spaceLabelIds: [],
      complianceSettings: { KitchenExtractorHoodExternal: false },
    });
    expect(off.isKitchenVentExternal).toBe(false);
    const undef = resolveEffectiveDwellingDetails({
      zones: [zone()], elementsById: {}, spaceLabelsById: {}, spaceLabelIds: [],
      complianceSettings: {},
    });
    expect(undef.isKitchenVentExternal).toBeUndefined();
  });

  it('exposes the primary-zone label aggregate for callers that need it', () => {
    const labels = [bedroomLabel(0, 0)];
    const result = resolveEffectiveDwellingDetails({
      zones: [zone()],
      elementsById: {},
      spaceLabelsById: labelsById(labels),
      spaceLabelIds: labelIds(labels),
      complianceSettings: {},
    });
    expect(result.primaryZoneSpaceLabelAggregate).not.toBeNull();
    expect(result.primaryZoneSpaceLabels).toHaveLength(1);
  });

  it('no primary zone (everything placeholder) → null aggregate, undefined counts', () => {
    const result = resolveEffectiveDwellingDetails({
      zones: [{ ...zone(), isPlaceholder: true }],
      elementsById: {},
      spaceLabelsById: {},
      spaceLabelIds: [],
      complianceSettings: {},
    });
    expect(result.primaryZoneSpaceLabelAggregate).toBeNull();
    expect(result.bedrooms).toBeUndefined();
    expect(result.totalFloorAreaM2).toBe(0);
  });
});

describe('resolveEffectiveVentilationBaseHeight', () => {
  it('takes the base of the last Systems row in load order, as the converter merges them', () => {
    const system = (id: string, base: number) => ({
      id, name: id, type: 'System', subcategory: 'InfiltrationVentilation',
      extra_json: { InfiltrationVentilation: { ventilation_zone_base_height: base } },
    }) as unknown as Element;
    // An all-digit id enumerates first in Object.values, ahead of load order.
    const elementsById = { a: system('a', 2.8), 7: system('7', 3.1) };
    expect(resolveEffectiveVentilationBaseHeight({
      zones: [zone()], elementsById, elementIds: ['a', '7'], spaceLabelsById: {}, spaceLabelIds: [], complianceSettings: {},
    })).toBe(3.1);
  });
});

// The converter's ventilation_zone_base_drawing_z gives the same values and the same E069 messages.
describe('ventilationZoneBaseFrame', () => {
  const wall = (id: string, z: number | undefined) => ({
    id, name: id, type: 'BuildingElementOpaque', width: 4, height: 2.8, base_height: z,
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
  }) as unknown as Element;

  it.each([
    ['no wall, base 9', [], 9, 9],
    ['a base within 0.25 m of 0, walls at 0.2', [wall('a', 0.2)], 0, 0],
    ['a base within 0.25 m of 0, walls at 3', [wall('a', 3)], 0.2, 0.2],
    ['drawn at zero on a 9 m base', [wall('a', 0), wall('b', 2.8)], 9, 0],
    ['a wall with no base height is at 0', [wall('a', undefined)], 9, 0],
    ['drawn at its 9 m base', [wall('a', 9.1), wall('b', 11.8)], 9, 9],
    ['a basement drawn at zero, base -2.5', [wall('a', 0)], -2.5, 0],
    ['a basement drawn at its base', [wall('a', -2.5)], -2.5, -2.5],
  ])('%s', (_, elements, base, drawingZ) => {
    expect(ventilationZoneBaseFrame(elements as Element[], base)).toEqual({ drawingZ });
  });

  it('cannot place a base near both 0 and the walls, or near neither', () => {
    expect(ventilationZoneBaseFrame([wall('a', 0.2), wall('b', 3)], 0.4)).toEqual({
      drawingZ: 0.4, problemElementIds: ['a'],
      problem: 'The lowest walls (a) are drawn at 0.2 m, near both 0 and the ventilation zone base height (0.4 m), so heights cannot be measured. Draw the dwelling at 0 or at its base height.',
    });
    expect(ventilationZoneBaseFrame([wall('a', 3), wall('b', 3.1)], 9)).toEqual({
      drawingZ: 9, problemElementIds: ['a', 'b'],
      problem: 'The lowest walls (a, b) are drawn at 3 m, but the ventilation zone base height is 9 m. Draw the dwelling at 0 or at its base height.',
    });
  });
});
