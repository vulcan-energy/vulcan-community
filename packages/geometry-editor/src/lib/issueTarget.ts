// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/** Where a HEM input validation path lands in the editor. */
export type IssueTarget = {
  zoneId?: string;
  elementId?: string;
  fieldKey?: string;
  section?: string;
  /** The object that owns the issue (element, zone-level key or top-level entry), as decoded segments. */
  ownerKey: string;
};

// Zone-level HEM keys whose editor control has a different field key.
const ZONE_FIELD_KEYS: Record<string, string> = { ThermalBridging: 'simplifiedThermalBridging' };

/** Splits a JSON pointer (leading '/' optional) into decoded segments. */
export const issuePathSegments = (path?: string) =>
  (path ?? '').split('/').filter(Boolean).map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

/**
 * Resolves a validation path to the zone/element and field the user should edit.
 * Names match exactly within their zone; array indices after the field are dropped
 * (window_part_list/0 → window_part_list).
 */
export function resolveIssueTarget(
  path: string | undefined,
  model: {
    zones: ReadonlyArray<{ id: string; name?: string }>;
    elements: Iterable<{ id: string; name?: string; zoneId?: string } | undefined>;
  },
): IssueTarget {
  const s = issuePathSegments(path);
  if (s[0] !== 'Zone' || !s[1]) {
    // Top-level entries that are editor elements (e.g. OnSiteGeneration panels) match a unique name.
    const matches = s[1] ? [...model.elements].filter((element) => element?.name === s[1]) : [];
    return {
      section: s[0],
      elementId: matches.length === 1 ? matches[0]!.id : undefined,
      fieldKey: matches.length === 1 ? s[2] : undefined,
      ownerKey: JSON.stringify(s.slice(0, 2)),
    };
  }
  const zone = model.zones.find((candidate) => candidate.name === s[1]);
  if (s[2] === 'BuildingElement' && s[3]) {
    let elementId: string | undefined;
    if (zone) {
      for (const element of model.elements) {
        if (element && element.zoneId === zone.id && element.name === s[3]) {
          elementId = element.id;
          break;
        }
      }
    }
    return { section: 'Zone', zoneId: zone?.id, elementId, fieldKey: s[4], ownerKey: JSON.stringify(s.slice(0, 4)) };
  }
  return {
    section: 'Zone',
    zoneId: zone?.id,
    fieldKey: s[2] && (ZONE_FIELD_KEYS[s[2]] ?? s[2]),
    ownerKey: JSON.stringify(s.slice(0, 3)),
  };
}
