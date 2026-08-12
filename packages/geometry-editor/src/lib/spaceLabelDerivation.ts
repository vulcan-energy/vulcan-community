// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { calculatePolygonArea } from './polygonSync';
import { roundToTwoDecimals } from '../geometry/constants';
import type { SpaceLabel, Zone } from '../geometry/types';
import { analyzeSpaceLabelGeometry, type SpaceLabelGeometryAnalysis } from './spaceLabelGeometry';

export type LivingBucket = 'living' | 'rest' | 'none';

export const SPACE_LABEL_OPEN_TO_LIVING_ROOM_KEY = 'open_to_living_room';

/** How a room_type contributes to floor area, living/rest split, and dwelling counts. */
export interface SpaceLabelRoomRule {
  /** When true, polygon area is excluded from treated floor total (e.g. open-to-below void). */
  excludeFromFloorArea: boolean;
  /** Living vs rest-of-dwelling attribution for FHS split (`none` → excluded or neutral; see registry). */
  livingBucket: LivingBucket;
  /** Added per labelled polygon (typically 1 per room). */
  increments: Partial<{
    NumberOfBedrooms: number;
    NumberOfWetRooms: number;
    NumberOfHotTappedRooms: number;
    NumberOfUtilityRooms: number;
    NumberOfBathrooms: number;
    NumberOfSanitaryAccommodations: number;
    NumberOfHabitableRooms: number;
  }>;
}

/**
 * Default registry — extend over time. Keys are normalised to lower-case.
 * Unknown slugs fall back to {@link FALLBACK_UNKNOWN_ROOM_RULE} (still counted; flagged in validation).
 */
export const DEFAULT_SPACE_LABEL_ROOM_REGISTRY: Record<string, SpaceLabelRoomRule> = {
  // Voids count toward treated floor area and the rest-of-dwelling split, but contribute no
  // dwelling-count increments (they are not a habitable room).
  void: { excludeFromFloorArea: false, livingBucket: 'rest', increments: {} },
  bedroom: {
    excludeFromFloorArea: false,
    livingBucket: 'rest',
    increments: { NumberOfBedrooms: 1, NumberOfHabitableRooms: 1 },
  },
  living_room: {
    excludeFromFloorArea: false,
    livingBucket: 'living',
    increments: { NumberOfHabitableRooms: 1 },
  },
  kitchen: {
    excludeFromFloorArea: false,
    livingBucket: 'rest',
    increments: {
      NumberOfWetRooms: 1,
      NumberOfHotTappedRooms: 1,
    },
  },
  bathroom: {
    excludeFromFloorArea: false,
    livingBucket: 'rest',
    increments: {
      NumberOfBathrooms: 1,
      NumberOfWetRooms: 1,
      NumberOfHotTappedRooms: 1,
    },
  },
  wc: {
    excludeFromFloorArea: false,
    livingBucket: 'rest',
    increments: {
      NumberOfSanitaryAccommodations: 1,
      NumberOfWetRooms: 1,
    },
  },
  utility: {
    excludeFromFloorArea: false,
    livingBucket: 'rest',
    increments: { NumberOfUtilityRooms: 1, NumberOfWetRooms: 1 },
  },
  hall: {
    excludeFromFloorArea: false,
    livingBucket: 'rest',
    increments: {},
  },
  circulation: {
    excludeFromFloorArea: false,
    livingBucket: 'rest',
    increments: {},
  },
  other: {
    excludeFromFloorArea: false,
    livingBucket: 'rest',
    increments: {},
  },
  other_habitable: {
    excludeFromFloorArea: false,
    livingBucket: 'rest',
    increments: { NumberOfHabitableRooms: 1 },
  },
};

/** Unknown non-empty slugs: area counts; no automatic dwelling increments (validation warns). */
export const FALLBACK_UNKNOWN_ROOM_RULE: SpaceLabelRoomRule = {
  excludeFromFloorArea: false,
  livingBucket: 'rest',
  increments: {},
};

export function normaliseRoomTypeSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

export function resolveRoomTypeRule(rawRoomType: string): { rule: SpaceLabelRoomRule; known: boolean } {
  const trimmed = rawRoomType.trim();
  if (!trimmed) return { rule: FALLBACK_UNKNOWN_ROOM_RULE, known: false };
  const key = normaliseRoomTypeSlug(trimmed);
  const rule = DEFAULT_SPACE_LABEL_ROOM_REGISTRY[key];
  return rule ? { rule, known: true } : { rule: FALLBACK_UNKNOWN_ROOM_RULE, known: false };
}

export function isLivingRoomSpaceLabel(label: SpaceLabel): boolean {
  return normaliseRoomTypeSlug(label.room_type ?? '') === 'living_room';
}

export function canSpaceLabelBeMarkedOpenToLivingRoom(label: SpaceLabel): boolean {
  const roomType = normaliseRoomTypeSlug(label.room_type ?? '');
  return roomType !== '' && roomType !== 'living_room' && roomType !== 'void';
}

export function isSpaceLabelOpenToLivingRoom(label: SpaceLabel): boolean {
  return (
    canSpaceLabelBeMarkedOpenToLivingRoom(label) &&
    label.extra_json?.[SPACE_LABEL_OPEN_TO_LIVING_ROOM_KEY] === true
  );
}

export function spaceLabelPlanAreaM2(label: SpaceLabel): number {
  const coords = label.coordinates;
  if (!coords || coords.length < 3) return 0;
  return roundToTwoDecimals(calculatePolygonArea(coords));
}

export type DwellingCountField =
  | 'NumberOfBedrooms'
  | 'NumberOfWetRooms'
  | 'NumberOfHotTappedRooms'
  | 'NumberOfUtilityRooms'
  | 'NumberOfBathrooms'
  | 'NumberOfSanitaryAccommodations'
  | 'NumberOfHabitableRooms';

/** Stable iteration order for dwelling count fields (CSV / compliance). */
export const DWELLING_COUNT_FIELDS: DwellingCountField[] = [
  'NumberOfBedrooms',
  'NumberOfWetRooms',
  'NumberOfHabitableRooms',
  'NumberOfHotTappedRooms',
  'NumberOfUtilityRooms',
  'NumberOfBathrooms',
  'NumberOfSanitaryAccommodations',
];

export const DWELLING_COUNT_FIELD_LABELS: Record<DwellingCountField, string> = {
  NumberOfBedrooms: 'Bedrooms',
  NumberOfWetRooms: 'Wet rooms',
  NumberOfHabitableRooms: 'Habitable rooms',
  NumberOfHotTappedRooms: 'Hot-tapped rooms',
  NumberOfUtilityRooms: 'Utility rooms',
  NumberOfBathrooms: 'Bathrooms',
  NumberOfSanitaryAccommodations: 'Sanitary accommodations',
};

export type DwellingCountMismatch = { field: DwellingCountField; derived: number; stored: number };

function emptyDwellingCounts(): Record<DwellingCountField, number> {
  return {
    NumberOfBedrooms: 0,
    NumberOfWetRooms: 0,
    NumberOfHotTappedRooms: 0,
    NumberOfUtilityRooms: 0,
    NumberOfBathrooms: 0,
    NumberOfSanitaryAccommodations: 0,
    NumberOfHabitableRooms: 0,
  };
}

/** Zone ids whose space labels contribute to dwelling-level room counts. */
export function dwellingCountZoneIds(zones: Zone[]): string[] {
  return zones.filter((z) => !z.isPlaceholder).map((z) => z.id);
}

/**
 * Room counts for the whole dwelling.
 *
 * Counts describe the *dwelling*, not a zone. A two-zone FHS model
 * ("Living" downstairs, "Rest of Dwelling" upstairs) keeps its bedrooms in the
 * second zone, and the exporter merges both into a single HEM `Zone` anyway —
 * so aggregating only the primary zone silently dropped every upstairs room and
 * exported `NumberOfBedrooms: 0`, which the FHS wrapper rejects outright.
 *
 * Floor area and the living/rest split stay per-zone: each zone carries its own
 * `livingroom_area` / `restofdwelling_area`. See {@link aggregateSpaceLabelsForZone}.
 *
 * `hasLabelledFootprints` is false when no counted footprint carries a room type.
 * Callers must not write derived counts in that case — the zeros would be
 * indistinguishable from "this dwelling has no bedrooms" and would overwrite
 * values the user entered by hand.
 */
export function aggregateDwellingCounts(
  labels: SpaceLabel[],
  zoneIds: readonly string[],
): { dwellingCounts: Record<DwellingCountField, number>; hasLabelledFootprints: boolean } {
  const counted = new Set(zoneIds);
  const dwellingCounts = emptyDwellingCounts();
  let hasLabelledFootprints = false;

  for (const label of labels) {
    if (!counted.has(label.zoneId)) continue;
    const rawType = label.room_type?.trim() ?? '';
    if (!rawType) continue;
    hasLabelledFootprints = true;
    const { rule } = resolveRoomTypeRule(rawType);
    for (const [k, v] of Object.entries(rule.increments)) {
      const key = k as DwellingCountField;
      dwellingCounts[key] += typeof v === 'number' && Number.isFinite(v) ? v : 0;
    }
  }

  return { dwellingCounts, hasLabelledFootprints };
}

/**
 * When the dwelling has at least one labelled footprint, compare stored dwelling counts
 * to {@link aggregateDwellingCounts} increments. Undefined stored fields are skipped.
 */
export function getDwellingCountSpaceLabelMismatchState(
  zones: Zone[],
  spaceLabelIds: string[],
  spaceLabelsById: Record<string, SpaceLabel | undefined>,
  complianceSettings: ComplianceSettingsShape,
): { hasLabelledFootprintsInPrimary: boolean; mismatches: DwellingCountMismatch[] } {
  const labels = spaceLabelIds
    .map((id) => spaceLabelsById[id])
    .filter((sl): sl is SpaceLabel => !!sl);
  const { dwellingCounts, hasLabelledFootprints } = aggregateDwellingCounts(
    labels,
    dwellingCountZoneIds(zones),
  );
  if (!hasLabelledFootprints) {
    return { hasLabelledFootprintsInPrimary: false, mismatches: [] };
  }
  const mismatches: DwellingCountMismatch[] = [];
  for (const field of DWELLING_COUNT_FIELDS) {
    const derived = Math.max(0, Math.round(dwellingCounts[field]));
    const raw = complianceSettings[field];
    if (raw === undefined || raw === null) continue;
    const stored = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(stored)) continue;
    if (stored !== derived) mismatches.push({ field, derived, stored });
  }
  return { hasLabelledFootprintsInPrimary: hasLabelledFootprints, mismatches };
}

export function formatDwellingCountMismatchWarnings(mismatches: DwellingCountMismatch[]): string[] {
  return mismatches.map((m) => {
    const short = DWELLING_COUNT_FIELD_LABELS[m.field];
    return `${short}: entered ${m.stored}, space labels ${m.derived} — use “Use space labels” to sync.`;
  });
}

export type SpaceLabelAggregate = {
  totalFloorAreaM2: number;
  livingAreaM2: number;
  restAreaM2: number;
  dwellingCounts: Record<DwellingCountField, number>;
  geometryAnalysis?: SpaceLabelGeometryAnalysis;
};

export function aggregateSpaceLabelsForZone(
  labels: SpaceLabel[],
  primaryZoneId: string,
  registry: Record<string, SpaceLabelRoomRule> = DEFAULT_SPACE_LABEL_ROOM_REGISTRY,
  geometryAnalysis?: SpaceLabelGeometryAnalysis,
): SpaceLabelAggregate {
  void registry;
  const dwellingCounts: Record<DwellingCountField, number> = emptyDwellingCounts();

  let totalFloorAreaM2 = 0;
  let livingAreaM2 = 0;

  const analysis = geometryAnalysis ?? analyzeSpaceLabelGeometry(labels.filter((label) => label.zoneId === primaryZoneId));

  for (const label of labels) {
    if (label.zoneId !== primaryZoneId) continue;
    const rawType = label.room_type?.trim() ?? '';
    if (!rawType) continue;
    const { rule } = resolveRoomTypeRule(rawType);
    const area = roundToTwoDecimals(analysis.effectiveAreasByLabelId[label.id] ?? spaceLabelPlanAreaM2(label));
    if (!rule.excludeFromFloorArea && area > 0) {
      totalFloorAreaM2 += area;
      if (rule.livingBucket === 'living' || isSpaceLabelOpenToLivingRoom(label)) livingAreaM2 += area;
    }

    for (const [k, v] of Object.entries(rule.increments)) {
      const key = k as DwellingCountField;
      const inc = typeof v === 'number' && Number.isFinite(v) ? v : 0;
      dwellingCounts[key] += inc;
    }
  }

  totalFloorAreaM2 = roundToTwoDecimals(totalFloorAreaM2);
  livingAreaM2 = roundToTwoDecimals(Math.min(livingAreaM2, totalFloorAreaM2));
  const restAreaM2 = roundToTwoDecimals(totalFloorAreaM2 - livingAreaM2);

  return { totalFloorAreaM2, livingAreaM2, restAreaM2, dwellingCounts, geometryAnalysis: analysis };
}

export type ComplianceSettingsShape = Partial<{
  NumberOfBedrooms: number;
  NumberOfWetRooms: number;
  NumberOfHotTappedRooms: number;
  NumberOfUtilityRooms: number;
  NumberOfBathrooms: number;
  NumberOfSanitaryAccommodations: number;
  NumberOfHabitableRooms: number;
}>;

/** Dwelling count fields including zeros — used when UI edits drive compliance from Space labels. */
export function fullDwellingCountsCompliancePatch(counts: SpaceLabelAggregate['dwellingCounts']): ComplianceSettingsShape {
  const patch: ComplianceSettingsShape = {};
  (Object.entries(counts) as [DwellingCountField, number][]).forEach(([key, value]) => {
    patch[key] = Math.max(0, Math.round(value));
  });
  return patch;
}

/** Shared with ioSlice.ts's CSV-vs-geometry override reconstruction so the two stay aligned. */
export const FLOOR_AREA_MATCH_EPSILON_M2 = 0.005;

/**
 * Apply Space label metrics to the primary (first non-placeholder) zone and optionally FHS split.
 * Sets floor area driven by labels so geometry derivation does not overwrite until user clears override behaviour.
 *
 * `preserveManualFloorAreaOverride`: import-only escape hatch (see stores/geometryStore/slices/ioSlice.ts
 * `loadFromCSV`). CSV-vs-geometry reconstruction (which runs before this) can mark the primary zone's
 * floor area as a genuine user override; without this flag, a hand-typed floor area that happens to
 * differ from the label aggregate would be silently replaced by that aggregate on every import even
 * though the user never touched a label. When set, and the primary zone is already flagged as a user
 * override with a floor area that does not match the label aggregate, the floor area / volume are left
 * alone (the aggregate is still recorded in `_derivedFloorArea` / `_areaSource` for the reset button).
 * In-session label edits (stores/geometryStore.ts `syncDerivedValuesFromSpaceLabels`) never pass this —
 * there, editing a label IS the user's intent, so the aggregate should always win, matching prior
 * behaviour exactly.
 */
export function applySpaceLabelsToZonesAndCompliance(
  zones: Zone[],
  labels: SpaceLabel[],
  complianceValidationEnabled: boolean,
  geometryAnalysis?: SpaceLabelGeometryAnalysis,
  options?: { preserveManualFloorAreaOverride?: boolean },
): { zones: Zone[]; compliancePatch: ComplianceSettingsShape } {
  const primary = zones.find((z) => !z.isPlaceholder);
  const compliancePatch: ComplianceSettingsShape = {};
  if (!primary || labels.length === 0) {
    return { zones, compliancePatch };
  }

  const agg = aggregateSpaceLabelsForZone(labels, primary.id, DEFAULT_SPACE_LABEL_ROOM_REGISTRY, geometryAnalysis);
  const counts = aggregateDwellingCounts(labels, dwellingCountZoneIds(zones));
  const hasFloor = agg.totalFloorAreaM2 > 0;
  if (!hasFloor && !counts.hasLabelledFootprints) {
    return { zones, compliancePatch };
  }

  // Write zeros (not just positive counts) so strict-mode required-field validation does not
  // leave fields like NumberOfUtilityRooms blank when labels are present but imply none.
  // Gated on hasLabelledFootprints: with no room types assigned anywhere, the zeros carry no
  // information and would overwrite counts the user entered by hand.
  if (counts.hasLabelledFootprints) {
    Object.assign(compliancePatch, fullDwellingCountsCompliancePatch(counts.dwellingCounts));
  }

  const height = primary.height || 0;

  const keepManualFloorAreaOverride =
    options?.preserveManualFloorAreaOverride === true &&
    hasFloor &&
    primary._floorAreaUserOverride === true &&
    Math.abs((primary.floorArea || 0) - agg.totalFloorAreaM2) > FLOOR_AREA_MATCH_EPSILON_M2;

  const volume =
    hasFloor && height > 0 && !keepManualFloorAreaOverride
      ? roundToTwoDecimals(agg.totalFloorAreaM2 * height)
      : primary.volume;

  const updatedPrimary: Zone = {
    ...primary,
    ...(hasFloor
      ? {
          ...(keepManualFloorAreaOverride
            ? {}
            : {
                floorArea: agg.totalFloorAreaM2,
                volume: volume && volume > 0 ? volume : primary.volume,
              }),
          _derivedFloorArea: agg.totalFloorAreaM2,
          _areaSource: 'Space labels',
          _floorAreaUserOverride: true,
        }
      : {}),
    // The FHS split areas follow the same keep decision as the floor area: validateZone requires
    // living + rest to sum to floorArea, so rewriting the splits from the aggregate while
    // preserving a hand-typed floor area would manufacture a hard FHS issue at import and
    // discard CSV-carried split corrections.
    ...(complianceValidationEnabled && hasFloor && !keepManualFloorAreaOverride
      ? {
          livingroom_area: agg.livingAreaM2,
          restofdwelling_area: agg.restAreaM2,
        }
      : {}),
  };

  return {
    zones: zones.map((z) => (z.id === primary.id ? updatedPrimary : z)),
    compliancePatch,
  };
}
