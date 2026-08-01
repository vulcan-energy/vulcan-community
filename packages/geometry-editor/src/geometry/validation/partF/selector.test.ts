// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Tests for the effective-context resolver. Critical because the store stores
// dwelling counts as `undefined` when they match the geometry-derived value
// (intentional pattern from ioSlice.ts), and reading them directly would suppress
// Part F findings on every model that didn't have manual Dwelling Details.

import { describe, it, expect } from 'vitest';
import { resolveEffectivePartFContext, selectPartFData } from './selector';
import type { Element, SpaceLabel, Zone } from '../../types';
import { __resetDefaultsCacheForTests, __setDefaultsObjectForTests } from '../../../lib/defaultsCache';

const zone = (): Zone => ({
  id: 'zone-1',
  name: 'Zone 1',
  floorArea: 100,
  height: 2.5,
  isPlaceholder: false,
});

const bedroomLabel = (cx: number, cy: number, size = 4): SpaceLabel => ({
  id: `sl-${cx}-${cy}`,
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

const bathroomLabel = (cx: number, cy: number, size = 3): SpaceLabel => ({
  id: `sl-bath-${cx}-${cy}`,
  name: `bathroom-${cx}-${cy}`,
  zoneId: 'zone-1',
  storey: 0,
  room_type: 'bathroom',
  coordinates: [
    { x: cx - size / 2, y: cy - size / 2, z: 0 },
    { x: cx + size / 2, y: cy - size / 2, z: 0 },
    { x: cx + size / 2, y: cy + size / 2, z: 0 },
    { x: cx - size / 2, y: cy + size / 2, z: 0 },
  ],
});

const labelsById = (labels: SpaceLabel[]) => Object.fromEntries(labels.map((l) => [l.id, l]));
const labelIds = (labels: SpaceLabel[]) => labels.map((l) => l.id);

describe('resolveEffectivePartFContext', () => {
  it('falls back to space-label aggregate when complianceSettings counts are undefined', () => {
    // Missing-count scenario: complianceSettings has no explicit dwelling counts; space labels do.
    const labels = [bedroomLabel(0, 0), bedroomLabel(10, 0), bathroomLabel(20, 0)];
    const ctx = resolveEffectivePartFContext({
      zones: [zone()],
      elementsById: {},
      spaceLabelsById: labelsById(labels),
      spaceLabelIds: labelIds(labels),
      complianceSettings: {}, // every count undefined
    });
    expect(ctx.bedrooms).toBe(2);    // 2 bedroom labels → bedrooms = 2
    expect(ctx.bathrooms).toBe(1);   // 1 bathroom label
    expect(ctx.totalFloorAreaM2).toBeGreaterThan(0);
  });

  it('explicit complianceSettings override beats space-label derivation', () => {
    const labels = [bedroomLabel(0, 0)];
    const ctx = resolveEffectivePartFContext({
      zones: [zone()],
      elementsById: {},
      spaceLabelsById: labelsById(labels),
      spaceLabelIds: labelIds(labels),
      complianceSettings: { NumberOfBedrooms: 5 },
    });
    expect(ctx.bedrooms).toBe(5); // override wins
  });

  it('storeys derives from floor geometry when complianceSettings.storeys_in_dwelling is undefined', () => {
    // Two floors: a ground-contact floor at z=0 and an upstairs walkable floor at z=2.5.
    // calculateDwellingDetailsSuggestion only counts BuildingElementGround / walkable floor
    // horizontal polygons — walls don't contribute.
    const elements: Element[] = [
      {
        id: 'ground',
        name: 'Ground',
        type: 'BuildingElementGround',
        width: 4, height: 4, area: 16, total_area: 16,
        perimeter: 16,
        floor_type: 'Slab_no_edge_insulation',
        parent_element: null,
        coordinates: [
          { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 },
          { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 },
        ],
        isPlaceholder: false,
      } as Element,
      {
        id: 'upstairs-floor',
        name: 'UpstairsFloor',
        type: 'BuildingElementOpaque',
        width: 4, height: 4, area: 16,
        pitch: 180, // walkable floor (face-up horizontal polygon)
        parent_element: null,
        coordinates: [
          { x: 0, y: 0, z: 2.5 }, { x: 4, y: 0, z: 2.5 },
          { x: 4, y: 4, z: 2.5 }, { x: 0, y: 4, z: 2.5 },
        ],
        isPlaceholder: false,
      } as Element,
    ];
    const ctx = resolveEffectivePartFContext({
      zones: [zone()],
      elementsById: Object.fromEntries(elements.map((e) => [e.id, e])),
      spaceLabelsById: {},
      spaceLabelIds: [],
      complianceSettings: {},
    });
    expect(ctx.storeys).toBe(2);
  });

  it('returns undefined for counts when neither override nor derivation has them', () => {
    const ctx = resolveEffectivePartFContext({
      zones: [zone()],
      elementsById: {},
      spaceLabelsById: {},
      spaceLabelIds: [],
      complianceSettings: {},
    });
    expect(ctx.bedrooms).toBeUndefined();
    expect(ctx.habitableRooms).toBeUndefined();
    expect(ctx.totalFloorAreaM2).toBe(0);
  });

  it('passes through KitchenExtractorHoodExternal as-is (no derivation)', () => {
    const ctx = resolveEffectivePartFContext({
      zones: [zone()],
      elementsById: {},
      spaceLabelsById: {},
      spaceLabelIds: [],
      complianceSettings: { KitchenExtractorHoodExternal: false },
    });
    expect(ctx.isKitchenVentExternal).toBe(false);
  });
});

describe('selectPartFData defaults isolation', () => {
  beforeEach(() => {
    __resetDefaultsCacheForTests();
  });

  it('uses the caller defaults instead of the ambient compatibility cache', () => {
    const blankVent = (id: string): Element => ({
      id,
      name: id,
      type: 'Vents',
      area_cm2: 0,
      mid_height_air_flow_path: 1.5,
      parent_element: '',
      coordinates: [{ x: 0, y: 0, z: 0 }],
      isPlaceholder: false,
    } as Element);
    const elements: Element[] = [
      blankVent('vent-1'),
      blankVent('vent-2'),
      {
        id: 'cmev',
        name: 'cmev',
        type: 'MechanicalVentilation',
        vent_type: 'Centralised continuous MEV',
        parent_element: null,
        coordinates: [{ x: 0, y: 0, z: 0 }],
        isPlaceholder: false,
        extra_json: { design_outdoor_air_flow_rate: 200 },
      } as Element,
    ];
    const input = {
      zones: [zone()],
      elementsById: Object.fromEntries(elements.map((element) => [element.id, element])),
      spaceLabelsById: {},
      spaceLabelIds: [],
      complianceSettings: {
        NumberOfBedrooms: 0,
        NumberOfHabitableRooms: 2,
        NumberOfWetRooms: 1,
        NumberOfBathrooms: 1,
        NumberOfUtilityRooms: 0,
        NumberOfSanitaryAccommodations: 0,
        storeys_in_dwelling: 1,
        KitchenExtractorHoodExternal: true,
      },
      elements,
    };
    const adequateDefaults = {
      InfiltrationVentilation: {
        Vents: { vent: { type: 'Vents', area_cm2: 100 } },
      },
    };
    const inadequateDefaults = {
      InfiltrationVentilation: {
        Vents: { vent: { type: 'Vents', area_cm2: 1 } },
      },
    };
    __setDefaultsObjectForTests({
      InfiltrationVentilation: {
        Vents: { official: { type: 'Vents', area_cm2: 1 } },
      },
    });

    type ExplicitDefaultsInput = typeof input & { defaults: unknown };
    const selectWithExplicitDefaults = selectPartFData as (
      value: ExplicitDefaultsInput,
    ) => ReturnType<typeof selectPartFData>;
    const adequate = selectWithExplicitDefaults({ ...input, defaults: adequateDefaults });
    const inadequate = selectWithExplicitDefaults({ ...input, defaults: inadequateDefaults });

    expect(adequate.findings.some((finding) => finding.rule === 'background_area_continuous')).toBe(false);
    expect(inadequate.findings.some((finding) => finding.rule === 'background_area_continuous')).toBe(true);
  });
});
