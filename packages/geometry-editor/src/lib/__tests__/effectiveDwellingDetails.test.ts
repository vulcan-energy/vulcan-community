// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Tests for the unified effective-dwelling-details resolver. Migrating call sites
// (Part F context, ioSlice CSV export, GeometryBuilder UI) all depend on this contract.

import { describe, it, expect } from 'vitest';
import { resolveEffectiveDwellingDetails } from '../effectiveDwellingDetails';
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
