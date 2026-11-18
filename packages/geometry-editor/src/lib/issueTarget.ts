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

type IssueModel = {
  zones: ReadonlyArray<{ id: string; name?: string }>;
  elements: Iterable<{ id: string; name?: string; zoneId?: string; extra_json?: unknown } | undefined>;
};

/** A System row's plant sits under its own key: `extra_json.HotWaterSource['hw cylinder']`. */
const holdsPlant = (extra: unknown, section: string, key: string) => {
  const plants = (extra as Record<string, unknown> | undefined)?.[section];
  return typeof plants === 'object' && plants !== null && Object.prototype.hasOwnProperty.call(plants, key);
};

/**
 * Resolves a validation path to the zone/element and field the user should edit.
 * Names match exactly within their zone; array indices after the field are dropped
 * (window_part_list/0 → window_part_list). A row whose path names no element goes to the
 * first element its `message` names in single quotes ("The walls 'Wall (N) 2' do not join"),
 * when exactly one element (in the row's zone, if it has one) has that name. Failing both, a
 * top-level plant path goes to the unique Systems row holding that plant key, and the hot water
 * demand as a whole to the unique hot water system.
 */
export function resolveIssueTarget(path: string | undefined, model: IssueModel, message?: string): IssueTarget {
  const target = resolvePath(path, model);
  if (target.elementId) return target;
  const elements = [...model.elements].filter((element) => element && (!target.zoneId || element.zoneId === target.zoneId));
  // The message's row first: an emitter or pipe error names its own row, not its system's.
  for (const [, name] of message?.matchAll(/'([^']+)'/g) ?? []) {
    const matches = elements.filter((element) => element!.name === name);
    if (matches.length === 1) return { ...target, elementId: matches[0]!.id, fieldKey: undefined };
  }
  const s = issuePathSegments(path);
  // The hot water demand as a whole belongs to the hot water system it is drawn from.
  if (s[0] === 'HotWaterDemand' && !s[1]) {
    const systems = elements.filter((element) => {
      const sources = (element!.extra_json as Record<string, unknown> | undefined)?.HotWaterSource;
      return typeof sources === 'object' && sources !== null;
    });
    return systems.length === 1 ? { ...target, elementId: systems[0]!.id } : target;
  }
  if (s[0] === 'Zone' || !s[1]) return target;
  const holders = elements.filter((element) => holdsPlant(element!.extra_json, s[0]!, s[1]!));
  // A deeper path (a heat source inside the plant) has no control of its own on the row.
  return holders.length === 1 ? { ...target, elementId: holders[0]!.id, fieldKey: s.length === 3 ? s[2] : undefined } : target;
}

function resolvePath(path: string | undefined, model: IssueModel): IssueTarget {
  const s = issuePathSegments(path);
  if (s[0] === 'InfiltrationVentilation' && s[1] === 'MechanicalVentilation' && s[2]) {
    const matches = [...model.elements].filter((element) => element?.name === s[2]);
    return {
      section: s[0],
      elementId: matches.length === 1 ? matches[0]!.id : undefined,
      // Deeper paths and `ductwork` have no control on the fan: its ducts are separate elements.
      fieldKey: matches.length === 1 && s.length === 4 && s[3] !== 'ductwork' ? s[3] : undefined,
      ownerKey: JSON.stringify(s.slice(0, 3)),
    };
  }
  if (s[0] !== 'Zone' || !s[1]) {
    // Top-level entries that are editor elements (e.g. OnSiteGeneration panels) match a unique name.
    const matches = s[1] ? [...model.elements].filter((element) => element?.name === s[1]) : [];
    return {
      section: s[0],
      elementId: matches.length === 1 ? matches[0]!.id : undefined,
      // An existing building's panel fields sit under panels/<n> (/OnSiteGeneration/PV/panels/0/mounting_type).
      fieldKey: matches.length !== 1 ? undefined : s[2] === 'panels' && s[4] ? s[4] : s[2],
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
