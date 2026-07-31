// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Unified resolver for dwelling-detail values that combine an explicit complianceSettings
// override with a geometry-derived fallback.
//
// Rationale: `complianceSettings.X` is intentionally `undefined` in the store when the
// user's value matches what the geometry would derive — this keeps CSV round-trips stable
// (see ioSlice.ts:213-220 and the trim-on-import block at ioSlice.ts:1106-1130). Reading
// those fields directly without honouring the fallback chain treats valid models as if
// they're missing data and caused the missing-count "no Part F pills" regression.
//
// Three call sites used to inline this logic:
//   - GeometryBuilder.tsx — many `?? derivation` reads in the UI editor
//   - ioSlice.ts          — `effective()` local helper for CSV export
//   - partFEffectiveContext.ts — Part F validation
// All now consume `resolveEffectiveDwellingDetails(state)` instead.

import {
  calculateDwellingDetailsSuggestion,
  calculateGroundFloorArea,
} from './zoneDerivation';
import { calculateDwellingLengthWidthFromGroundElements } from './buildingFootprintDimensions';
import {
  aggregateDwellingCounts,
  aggregateSpaceLabelsForZone,
  dwellingCountZoneIds,
  type SpaceLabelAggregate,
} from './spaceLabelDerivation';
import type { Element, SpaceLabel, Zone } from '../geometry/types';

export interface EffectiveDwellingDetailsInputs {
  zones: Zone[];
  elementsById: Record<string, Element>;
  spaceLabelsById: Record<string, SpaceLabel>;
  spaceLabelIds: string[];
  /** All optional override fields the store tracks. */
  complianceSettings: Partial<{
    NumberOfBedrooms: number;
    NumberOfHabitableRooms: number;
    NumberOfWetRooms: number;
    NumberOfHotTappedRooms: number;
    NumberOfBathrooms: number;
    NumberOfUtilityRooms: number;
    NumberOfSanitaryAccommodations: number;
    storeys_in_dwelling: number;
    storey_of_dwelling: number;
    build_type: 'house' | 'flat';
    GroundFloorArea: number;
    BuildingLength: number;
    BuildingWidth: number;
    KitchenExtractorHoodExternal: boolean;
  }>;
}

export interface EffectiveDwellingDetails {
  // Counts (from space-label aggregate when no override).
  bedrooms: number | undefined;
  habitableRooms: number | undefined;
  wetRooms: number | undefined;
  hotTappedRooms: number | undefined;
  bathrooms: number | undefined;
  utilityRooms: number | undefined;
  sanitaryAccommodations: number | undefined;

  // Form (from geometry derivation when no override).
  storeysInDwelling: number | undefined;
  storeyOfDwelling: number | undefined;
  buildType: 'house' | 'flat' | undefined;
  groundFloorAreaM2: number | undefined;
  buildingLengthM: number | undefined;
  buildingWidthM: number | undefined;

  // Carried through verbatim — no derivation source.
  isKitchenVentExternal: boolean | undefined;

  /** Total treated floor area from labelled spaces (used by Part F flow-rate threshold). */
  totalFloorAreaM2: number;
  /** Living-room / rest-of-dwelling split for FHS. */
  livingAreaM2: number;
  restAreaM2: number;

  /** Per-field override flags — UI uses these to render "manual" vs "derived" indicators. */
  overrides: {
    bedrooms: boolean;
    habitableRooms: boolean;
    wetRooms: boolean;
    hotTappedRooms: boolean;
    bathrooms: boolean;
    utilityRooms: boolean;
    sanitaryAccommodations: boolean;
    storeysInDwelling: boolean;
    storeyOfDwelling: boolean;
    buildType: boolean;
    groundFloorArea: boolean;
    buildingLength: boolean;
    buildingWidth: boolean;
  };

  /** Pass-through for callers that need the raw aggregate (Part F space-labels listing). */
  primaryZoneSpaceLabelAggregate: SpaceLabelAggregate | null;
  /** Pass-through for callers that want the labels themselves (e.g. placement). */
  primaryZoneSpaceLabels: SpaceLabel[];
}

const pickNumber = (override: number | undefined, derived: number | undefined): number | undefined => {
  if (typeof override === 'number' && Number.isFinite(override)) return override;
  if (typeof derived === 'number' && Number.isFinite(derived)) return derived;
  return undefined;
};

export function resolveEffectiveDwellingDetails(
  input: EffectiveDwellingDetailsInputs,
): EffectiveDwellingDetails {
  const cs = input.complianceSettings;
  const allElements = Object.values(input.elementsById);

  const derivedDD = calculateDwellingDetailsSuggestion(allElements);
  const derivedGFA = calculateGroundFloorArea(allElements);
  const derivedLW = calculateDwellingLengthWidthFromGroundElements(allElements);

  const allLabels = input.spaceLabelIds
    .map((lid) => input.spaceLabelsById[lid])
    .filter((sl): sl is SpaceLabel => !!sl);
  const primaryZone = input.zones.find((z) => !z.isPlaceholder);
  const primaryLabels = primaryZone
    ? allLabels.filter((sl) => sl.zoneId === primaryZone.id)
    : [];
  const hasLabelledFootprints = primaryLabels.some(
    (l) => String(l.room_type ?? '').trim() !== '',
  );
  const labelAgg: SpaceLabelAggregate | null =
    primaryZone && hasLabelledFootprints
      ? aggregateSpaceLabelsForZone(primaryLabels, primaryZone.id)
      : null;

  // Areas above are per-zone (each zone carries its own living/rest split); room
  // counts below describe the dwelling and must span every non-placeholder zone.
  const dwellingWide = aggregateDwellingCounts(allLabels, dwellingCountZoneIds(input.zones));
  const counts = dwellingWide.hasLabelledFootprints ? dwellingWide.dwellingCounts : null;

  return {
    bedrooms: pickNumber(cs.NumberOfBedrooms, counts?.NumberOfBedrooms),
    habitableRooms: pickNumber(cs.NumberOfHabitableRooms, counts?.NumberOfHabitableRooms),
    wetRooms: pickNumber(cs.NumberOfWetRooms, counts?.NumberOfWetRooms),
    hotTappedRooms: pickNumber(cs.NumberOfHotTappedRooms, counts?.NumberOfHotTappedRooms),
    bathrooms: pickNumber(cs.NumberOfBathrooms, counts?.NumberOfBathrooms),
    utilityRooms: pickNumber(cs.NumberOfUtilityRooms, counts?.NumberOfUtilityRooms),
    sanitaryAccommodations: pickNumber(
      cs.NumberOfSanitaryAccommodations,
      counts?.NumberOfSanitaryAccommodations,
    ),

    storeysInDwelling: pickNumber(cs.storeys_in_dwelling, derivedDD.storeysInDwelling),
    storeyOfDwelling: pickNumber(cs.storey_of_dwelling, derivedDD.storeyOfDwelling),
    buildType: cs.build_type ?? derivedDD.buildType,
    groundFloorAreaM2: pickNumber(cs.GroundFloorArea, derivedGFA > 0 ? derivedGFA : undefined),
    // BuildingLength/Width: derivation returns 0 when no ground elements exist; treat that
    // as "not derivable" (legacy ioSlice shape). pickNumber lets explicit `0` overrides through
    // — those should be unusual but are not pre-filtered here.
    buildingLengthM: pickNumber(cs.BuildingLength, derivedLW.lengthM > 0 ? derivedLW.lengthM : undefined),
    buildingWidthM: pickNumber(cs.BuildingWidth, derivedLW.widthM > 0 ? derivedLW.widthM : undefined),

    isKitchenVentExternal: cs.KitchenExtractorHoodExternal,

    totalFloorAreaM2: labelAgg?.totalFloorAreaM2 ?? 0,
    livingAreaM2: labelAgg?.livingAreaM2 ?? 0,
    restAreaM2: labelAgg?.restAreaM2 ?? 0,

    overrides: {
      bedrooms: cs.NumberOfBedrooms !== undefined,
      habitableRooms: cs.NumberOfHabitableRooms !== undefined,
      wetRooms: cs.NumberOfWetRooms !== undefined,
      hotTappedRooms: cs.NumberOfHotTappedRooms !== undefined,
      bathrooms: cs.NumberOfBathrooms !== undefined,
      utilityRooms: cs.NumberOfUtilityRooms !== undefined,
      sanitaryAccommodations: cs.NumberOfSanitaryAccommodations !== undefined,
      storeysInDwelling: cs.storeys_in_dwelling !== undefined,
      storeyOfDwelling: cs.storey_of_dwelling !== undefined,
      buildType: cs.build_type !== undefined,
      groundFloorArea: cs.GroundFloorArea !== undefined,
      buildingLength: cs.BuildingLength !== undefined,
      buildingWidth: cs.BuildingWidth !== undefined,
    },

    primaryZoneSpaceLabelAggregate: labelAgg,
    primaryZoneSpaceLabels: primaryLabels,
  };
}
