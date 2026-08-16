// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type OverrideDescriptor = {
  /** In-memory flag, for example `_widthUserOverride`. */
  flag: string;
  /** Persisted marker key, for example `_width_user_override`. */
  key: string;
  /** The flag/marker value that means the field is overridden rather than automatic. */
  positiveSense: boolean;
  /** Provenance document version that first made this marker authoritative. */
  since: number;
  /** Whether an authoritative document version makes a missing marker mean automatic. */
  absentIsAuthoritative?: boolean;
};

export type OverrideRecordKind = 'element' | 'zone' | 'floor' | 'spaceLabel';

export const SLOPED_WIDTH_OVERRIDE_DESCRIPTOR = {
  flag: '_widthUserOverride',
  key: '_width_user_override',
  positiveSense: true,
  since: 1,
} as const satisfies OverrideDescriptor;

export const SLOPED_HEIGHT_OVERRIDE_DESCRIPTOR = {
  flag: '_heightUserOverride',
  key: '_height_user_override',
  positiveSense: true,
  since: 1,
} as const satisfies OverrideDescriptor;

export const PV_BASE_HEIGHT_OVERRIDE_DESCRIPTOR = {
  flag: '_baseHeightUserOverride',
  key: '_pv_base_height_user_override',
  positiveSense: true,
  since: 1,
} as const satisfies OverrideDescriptor;

export const PV_PITCH_OVERRIDE_DESCRIPTOR = {
  flag: '_pitchUserOverride',
  key: '_pv_pitch_user_override',
  positiveSense: true,
  since: 1,
} as const satisfies OverrideDescriptor;

export const PV_ORIENTATION_OVERRIDE_DESCRIPTOR = {
  flag: '_orientationUserOverride',
  key: '_pv_orientation_user_override',
  positiveSense: true,
  since: 1,
} as const satisfies OverrideDescriptor;

export const ELEMENT_NAME_AUTO_SYNC_DESCRIPTOR = {
  flag: '_nameAutoSync',
  key: '_name_auto_sync',
  positiveSense: false,
  since: 1,
  absentIsAuthoritative: false,
} as const satisfies OverrideDescriptor;

export const ZONE_FLOOR_AREA_OVERRIDE_DESCRIPTOR = {
  flag: '_floorAreaUserOverride',
  key: '_floor_area_user_override',
  positiveSense: true,
  since: 1,
} as const satisfies OverrideDescriptor;

export const ZONE_HEIGHT_OVERRIDE_DESCRIPTOR = {
  flag: '_heightUserOverride',
  key: '_height_user_override',
  positiveSense: true,
  since: 1,
} as const satisfies OverrideDescriptor;

/** Existing metadata transport; `since: 0` preserves its pre-version authoritative semantics. */
export const FLOOR_HEIGHT_OVERRIDE_DESCRIPTOR = {
  flag: 'heightUserOverride',
  key: 'FloorHeightOverride',
  positiveSense: true,
  since: 0,
} as const satisfies OverrideDescriptor;

/** Existing metadata transport for an explicitly edited floor slab/base elevation. */
export const FLOOR_BASE_HEIGHT_OVERRIDE_DESCRIPTOR = {
  flag: 'baseHeightUserOverride',
  key: 'FloorBaseHeightOverride',
  positiveSense: true,
  since: 0,
} as const satisfies OverrideDescriptor;

export const SPACE_LABEL_NAME_AUTO_SYNC_DESCRIPTOR = {
  flag: '_nameAutoSync',
  key: '_name_auto_sync',
  positiveSense: false,
  since: 1,
  absentIsAuthoritative: false,
} as const satisfies OverrideDescriptor;

/** PV authorship is only decidable once a panel has a host-derived counterpart. */
export const PV_HOST_OVERRIDE_DESCRIPTORS = [
  PV_BASE_HEIGHT_OVERRIDE_DESCRIPTOR,
  PV_PITCH_OVERRIDE_DESCRIPTOR,
  PV_ORIENTATION_OVERRIDE_DESCRIPTOR,
] as const satisfies readonly OverrideDescriptor[];

/** Element markers that can be promoted before host-aware reconstruction runs. */
export const PARSE_PROMOTED_ELEMENT_OVERRIDE_DESCRIPTORS = [
  SLOPED_WIDTH_OVERRIDE_DESCRIPTOR,
  SLOPED_HEIGHT_OVERRIDE_DESCRIPTOR,
  ELEMENT_NAME_AUTO_SYNC_DESCRIPTOR,
] as const satisfies readonly OverrideDescriptor[];

/**
 * Scoped registry: identical flag/key names on different record kinds do not share meaning or
 * transport. Element and Space Label markers live in `extra_json`; Zone and Floor markers are
 * Metadata rows.
 */
export const OVERRIDE_PROVENANCE_REGISTRY = {
  element: [
    SLOPED_WIDTH_OVERRIDE_DESCRIPTOR,
    SLOPED_HEIGHT_OVERRIDE_DESCRIPTOR,
    PV_BASE_HEIGHT_OVERRIDE_DESCRIPTOR,
    PV_PITCH_OVERRIDE_DESCRIPTOR,
    PV_ORIENTATION_OVERRIDE_DESCRIPTOR,
    ELEMENT_NAME_AUTO_SYNC_DESCRIPTOR,
  ],
  zone: [
    ZONE_FLOOR_AREA_OVERRIDE_DESCRIPTOR,
    ZONE_HEIGHT_OVERRIDE_DESCRIPTOR,
  ],
  floor: [FLOOR_HEIGHT_OVERRIDE_DESCRIPTOR, FLOOR_BASE_HEIGHT_OVERRIDE_DESCRIPTOR],
  spaceLabel: [SPACE_LABEL_NAME_AUTO_SYNC_DESCRIPTOR],
} as const satisfies Record<OverrideRecordKind, readonly OverrideDescriptor[]>;

export const PROVENANCE_MARKERS_METADATA_KEY = 'ProvenanceMarkers';

/**
 * Highest authoritative document version. A NEW marker key must declare
 * `since: CURRENT_PROVENANCE_MARKERS_VERSION + 1`; update the registry snapshot test and this
 * version deliberately together so already-saved documents never become authoritative by accident.
 */
export const CURRENT_PROVENANCE_MARKERS_VERSION = Math.max(
  ...Object.values(OVERRIDE_PROVENANCE_REGISTRY).flat().map((descriptor) => descriptor.since),
);

export const EXTRA_JSON_OVERRIDE_MARKER_KEYS = [
  ...new Set([
    ...OVERRIDE_PROVENANCE_REGISTRY.element,
    ...OVERRIDE_PROVENANCE_REGISTRY.spaceLabel,
  ].map((descriptor) => descriptor.key)),
] as readonly string[];

type OverrideFlagRecord = Record<string, unknown>;
type ExtraJsonRecord = { extra_json?: Record<string, unknown> };

export function isOverrideDescriptorAuthoritative(
  descriptor: OverrideDescriptor,
  documentVersion: number | undefined,
): boolean {
  return (documentVersion ?? 0) >= descriptor.since;
}

export function isOverrideActive(
  record: OverrideFlagRecord,
  descriptor: OverrideDescriptor,
): boolean {
  return record[descriptor.flag] === descriptor.positiveSense;
}

/**
 * Copy-on-write projection of typed override flags into `extra_json`. Active overrides write their
 * descriptor's positive-sense value; automatic fields delete stale markers. The original mapping
 * and record references are returned when no marker changes.
 */
export function projectOverrideMarkersForExport<T extends ExtraJsonRecord>(
  recordsById: Readonly<Record<string, T>>,
  descriptors: readonly OverrideDescriptor[],
): Record<string, T> {
  let changed = false;
  const projected: Record<string, T> = { ...recordsById };

  for (const [id, record] of Object.entries(recordsById)) {
    const currentExtraJson = record.extra_json;
    let nextExtraJson = currentExtraJson;
    let recordChanged = false;

    for (const descriptor of descriptors) {
      const hasMarker = !!nextExtraJson
        && Object.prototype.hasOwnProperty.call(nextExtraJson, descriptor.key);
      const active = isOverrideActive(record as OverrideFlagRecord, descriptor);

      if (active) {
        if (!hasMarker || nextExtraJson![descriptor.key] !== descriptor.positiveSense) {
          nextExtraJson = {
            ...nextExtraJson,
            [descriptor.key]: descriptor.positiveSense,
          };
          recordChanged = true;
        }
      } else if (hasMarker) {
        const withoutMarker = { ...nextExtraJson };
        delete withoutMarker[descriptor.key];
        nextExtraJson = Object.keys(withoutMarker).length > 0 ? withoutMarker : undefined;
        recordChanged = true;
      }
    }

    if (recordChanged) {
      projected[id] = {
        ...record,
        extra_json: nextExtraJson,
      };
      changed = true;
    }
  }

  return changed ? projected : recordsById as Record<string, T>;
}

/**
 * Promote persisted markers onto typed in-memory flags. In versioned documents, absence writes the
 * descriptor's automatic value unless that descriptor explicitly degrades to its migration
 * heuristic. In legacy documents, absence leaves the flag untouched so the caller can run that
 * field's existing migration heuristic unchanged. `markers` defaults to the record's `extra_json`
 * but can be supplied from Metadata transports.
 */
export function promoteOverrideMarkersOnImport(
  record: OverrideFlagRecord,
  descriptors: readonly OverrideDescriptor[],
  documentVersion: number | undefined,
  markers: Readonly<Record<string, unknown>> | undefined =
    (record as ExtraJsonRecord).extra_json,
): void {
  for (const descriptor of descriptors) {
    const hasActiveMarker = markers?.[descriptor.key] === descriptor.positiveSense;
    if (hasActiveMarker) {
      record[descriptor.flag] = descriptor.positiveSense;
    } else if (
      descriptor.absentIsAuthoritative !== false
      && isOverrideDescriptorAuthoritative(descriptor, documentVersion)
    ) {
      record[descriptor.flag] = !descriptor.positiveSense;
    }
  }
}
