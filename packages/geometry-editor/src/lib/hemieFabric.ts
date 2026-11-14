// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';

/**
 * Construction bands: on an existing-building model the converter (vulcan-model-transform
 * `hemie.rs`) takes each element's fabric from the element's own values, else the `HEMIE_` model
 * settings (the age band and a construction per construction type), and fails naming a field
 * neither states. A stated U-value or construction resistance wins over both.
 */
export const HEMIE_AGE_BAND = 'HEMIE_age_band';

// The nation by postcode area (`postcode_region` in `hemie.rs`; keep the two in step): area level,
// because district boundaries cross national borders. Border areas ask the model's stated nation.
const SCOTLAND_AREAS = new Set(['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'ZE']);
const WALES_AREAS = new Set(['CF', 'SA']);
const BORDER_AREAS = new Set(['CA', 'CH', 'HR', 'LD', 'LL', 'NP', 'SY', 'TD']);
/** The Isle of Man and the Channel Islands, outside the UK EPC schemes. */
const OUTSIDE_AREAS = new Set(['IM', 'GY', 'JE']);
const ENGLAND_AREAS = new Set(('AL B BA BB BD BH BL BN BR BS CB CM CO CR CT CV CW DA DE DH DL DN DT DY E EC EN EX FY GL GU HA '
  + 'HD HG HP HU HX IG IP KT L LA LE LN LS LU M ME MK N NE NG NN NR NW OL OX PE PL PO PR RG RH RM S SE SG SK SL SM SN SO '
  + 'SP SR SS ST SW TA TF TN TQ TR TS TW UB W WA WC WD WF WN WR WS WV YO').split(' '));

/** The nation the model states for a postcode in a border area. */
export const HEMIE_NATION = 'HEMIE_nation';
export const NATIONS = ['England', 'Wales', 'Scotland', 'Northern Ireland'] as const;

/** A well-formed postcode's area, else undefined. */
const postcodeArea = (postcode: string | undefined) =>
  /^([A-Z]{1,2})\d[A-Z\d]?\d[A-Z]{2}$/.exec((postcode ?? '').replace(/\s/g, '').toUpperCase())?.[1];

/** The postcode's area when it spans two nations, so the model states the nation. */
export function postcodeBorderArea(postcode: string | undefined): string | undefined {
  const area = postcodeArea(postcode);
  return area && BORDER_AREAS.has(area) ? area : undefined;
}

/** The postcode's area when it is outside the UK EPC schemes. */
export function postcodeOutsideArea(postcode: string | undefined): string | undefined {
  const area = postcodeArea(postcode);
  return area && OUTSIDE_AREAS.has(area) ? area : undefined;
}

/**
 * The region the converter takes (`region` in `hemie.rs`): derived from the postcode area, or in
 * a border area the stated nation; undefined when neither gives one.
 */
export function postcodeRegion(postcode: string | undefined, statedNation?: string): string | undefined {
  const area = postcodeArea(postcode);
  if (!area) return undefined;
  if (BORDER_AREAS.has(area)) return NATIONS.find((nation) => nation === statedNation);
  if (area === 'BT') return 'Northern Ireland';
  if (SCOTLAND_AREAS.has(area)) return 'Scotland';
  if (WALES_AREAS.has(area)) return 'Wales';
  return ENGLAND_AREAS.has(area) ? 'England' : undefined;
}
/**
 * Under construction bands (`TargetRules.constructionBands`) a fabric preset's U-value would be
 * a documented U-value over the bands, so these types take no preset there.
 */
export const FABRIC_PRESET_TYPES: ReadonlySet<string> = new Set(['BuildingElementOpaque', 'BuildingElementTransparent']);

/**
 * Rows older files carry that the converter no longer reads (`RETIRED_SETTINGS` in `hemie.rs`):
 * a load drops each one and says what to do instead.
 */
export const HEMIE_RETIRED_ROWS: Readonly<Record<string, string>> = {
  HEMIE_region: 'the region now comes from the postcode. For a postcode area that spans two nations, choose the Nation under the Postcode in Dwelling Details.',
  HEMIE_front_door: 'mark the front door on the door itself.',
  HEMIE_infiltration_properties: 'an existing building needs an air test. Enter the air test result in Global Settings.',
};

const HEAT_CAPACITY_BANDS = ['Very light', 'Light', 'Medium', 'Heavy', 'Very heavy'] as const;
/**
 * The areal heat capacity bands an existing building's element may state, by the construction
 * type it takes (`Ctx::heat_capacity` in `hemie.rs`; keep the two in step): walls and floors all
 * five, roofs Very light to Medium, doors and windows none (a number only). Undefined for an
 * element the converter takes no construction heat capacity from.
 */
export function hemieHeatCapacityBands(constructionType: string | undefined): readonly string[] | undefined {
  if (!constructionType || constructionType === 'party_floor' || constructionType === 'party_ceiling') return undefined;
  if (['external_wall', 'sheltered_wall', 'party_wall'].includes(constructionType) || constructionType.endsWith('_floor')) return HEAT_CAPACITY_BANDS;
  if (constructionType.endsWith('_roof')) return HEAT_CAPACITY_BANDS.slice(0, 3);
  return [];
}

/**
 * The placeholder of a construction setting field with no default: the pinned HEM:EPC schema
 * requires a door's areal heat capacity, and a window's in a party or sheltered wall.
 */
export function hemieRequiredPlaceholder(constructionType: string, field: string): string | undefined {
  if (field !== 'areal_heat_capacity') return undefined;
  if (constructionType.endsWith('_door')) return 'Required, no default';
  return constructionType === 'window' ? 'Required in a party or sheltered wall' : undefined;
}

/** The door element flag that marks the front door; one door only. */
export const HEMIE_FRONT_DOOR = 'is_front_door';
export const hemieConstructionSetting = (constructionType: string): string => `HEMIE_construction_${constructionType}`;

/**
 * The construction fields offered per construction type: those the converter needs a value for,
 * the roof's insulation location, and the outside colour (a stated solar absorption coefficient
 * wins over it). An element may override them (see `ELEMENT_OVERRIDE_KEYS` and
 * `takes_outside_surface` in `hemie.rs`).
 */
export const HEMIE_CONSTRUCTION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  external_wall: ['wall_construction_type', 'colour'],
  sheltered_wall: ['wall_construction_type'],
  window: ['glazing_type', 'frame_material', 'glazing_gap', 'areal_heat_capacity'],
  external_door: ['areal_heat_capacity', 'colour'],
  party_or_sheltered_door: ['areal_heat_capacity'],
  flat_roof: ['insulation_location', 'colour'],
  unheated_pitched_roof: ['insulation_location', 'colour'],
  heated_pitched_roof: ['colour'],
  above_external_area_floor: ['colour'],
  party_floor: ['construction_weight'],
  party_ceiling: ['construction_weight'],
};

/**
 * Element fields only the existing-building converter reads (`ELEMENT_ONLY_KEYS` in `hemie.rs`);
 * no other input takes them, so another target leaves them out.
 */
export const HEMIE_ELEMENT_KEYS = [
  'age_band', HEMIE_FRONT_DOOR, 'wall_construction_type', 'glazing_type', 'frame_material', 'glazing_gap',
  'insulation_location', 'construction_weight',
] as const;

/** The existing-building fields an element holds in its extra_json. */
export function hemieLeftoverKeys(element: Element): string[] {
  const extra = (element.extra_json ?? {}) as Record<string, unknown>;
  return HEMIE_ELEMENT_KEYS.filter((key) => extra[key] !== undefined && extra[key] !== null && extra[key] !== '');
}

const UNITS: Readonly<Record<string, string>> = { glazing_gap: 'mm', areal_heat_capacity: 'J/m²·K' };
const words = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');

/** "External wall": a construction type as people read it. */
export const hemieConstructionTypeLabel = words;

/** "Glazing gap (mm)": a construction field with its unit. */
export function hemieFieldLabel(field: string): string {
  return UNITS[field] ? `${words(field)} (${UNITS[field]})` : words(field);
}

/** "12 mm", "Wood or PVC": a construction field's value with its unit. */
export function hemieValueLabel(field: string, value: unknown): string {
  return typeof value === 'number' ? `${value}${UNITS[field] ? ` ${UNITS[field]}` : ''}` : words(String(value));
}

const GROUND_FLOOR_CONSTRUCTIONS: Readonly<Record<string, string>> = {
  Slab_no_edge_insulation: 'not_edge_insulated_ground_attached_floor',
  Slab_edge_insulation: 'edge_insulated_ground_attached_floor',
  Suspended_floor: 'suspended_floor',
  Heated_basement: 'heated_basement_floor',
  Unheated_basement: 'unheated_basement_floor',
};

/** A field as the converter reads it: the element's own, else its extra_json. */
export function hemieElementValue(element: Element, key: string): unknown {
  const own = (element as unknown as Record<string, unknown>)[key];
  if (own !== undefined && own !== null && own !== '') return own;
  const extra = element.extra_json as Record<string, unknown> | undefined;
  const value = extra?.[key];
  return value === null || value === '' ? undefined : value;
}

/** The wall an opening is in, by its parent element's name. */
function hostWall(element: Element, elements: readonly Element[]): Element | undefined {
  const host = hemieElementValue(element, 'parent_element');
  return host === undefined ? undefined : elements.find((other) => other.name === host);
}

/**
 * The construction type the converter gives an element, as `hemie.rs` maps it (wall lines by
 * element type, roof planes by pitch, ground floors by floor type, party floors and ceilings,
 * windows, doors by their wall); undefined for an element it takes no construction from.
 */
export function hemieConstructionType(element: Element, elements: readonly Element[] = []): string | undefined {
  const pitch = hemieElementValue(element, 'pitch');
  const line = (element.coordinates?.length ?? 0) === 2;
  switch (element.type) {
    case 'BuildingElementTransparent':
      return 'window';
    case 'BuildingElementPartyWall':
      return line ? 'party_wall' : undefined;
    case 'BuildingElementAdjacentUnconditionedSpace_Simple':
      return line ? 'sheltered_wall' : undefined;
    case 'BuildingElementGround':
      return GROUND_FLOOR_CONSTRUCTIONS[String(hemieElementValue(element, 'floor_type'))];
    case 'BuildingElementAdjacentConditionedSpace':
      if (line || hemieElementValue(element, '_vulcan_ui_party_element') !== true || typeof pitch !== 'number') return undefined;
      return pitch > 90 ? 'party_floor' : 'party_ceiling';
    case 'BuildingElementOpaque':
      if (hemieElementValue(element, 'is_external_door') === true) {
        const wall = hostWall(element, elements)?.type;
        return wall === 'BuildingElementPartyWall' || wall === 'BuildingElementAdjacentUnconditionedSpace_Simple'
          ? 'party_or_sheltered_door' : 'external_door';
      }
      if (line) return 'external_wall';
      if (typeof pitch !== 'number') return undefined;
      if (pitch === 0) return 'flat_roof';
      if (pitch > 90) return 'above_external_area_floor';
      if (pitch < 90) return hemieElementValue(element, 'is_unheated_pitched_roof') === true ? 'unheated_pitched_roof' : 'heated_pitched_roof';
      return undefined;
    default:
      return undefined;
  }
}

/** A construction setting's fields, or undefined when the setting is absent or not a JSON object. */
export function parseHemieConstruction(cell: string | undefined): Record<string, unknown> | undefined {
  if (!cell) return undefined;
  try {
    const value: unknown = JSON.parse(cell);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export type HemieFabric = Readonly<{
  constructionType: string;
  /** The element's age band: its own, its host wall's (an opening), else the Defaults'. */
  band?: string;
  /** An opening's host wall's own age band, which HEMIE gives the opening over the Defaults'. */
  hostBand?: string;
  /** The offered construction fields with a value, each the element's own or the Defaults'. */
  values: Readonly<Record<string, unknown>>;
  /** The element states a U-value or construction resistance, which the converter takes as documented. */
  entered: boolean;
}>;

/** An element's fabric under construction bands; undefined when the converter takes none. */
export function hemieFabric(
  element: Element,
  settings: Readonly<Record<string, string>> | undefined,
  elements: readonly Element[] = [],
): HemieFabric | undefined {
  const constructionType = hemieConstructionType(element, elements);
  if (!constructionType) return undefined;
  const model = parseHemieConstruction(settings?.[hemieConstructionSetting(constructionType)]) ?? {};
  const values: Record<string, unknown> = {};
  for (const key of HEMIE_CONSTRUCTION_FIELDS[constructionType] ?? []) {
    const value = hemieElementValue(element, key) ?? model[key];
    if (value !== undefined && value !== null && value !== '') values[key] = value;
  }
  const opening = element.type === 'BuildingElementTransparent' || constructionType.endsWith('_door');
  const host = opening ? hostWall(element, elements) : undefined;
  const hostBand = host ? hemieElementValue(host, 'age_band') : undefined;
  const band = hemieElementValue(element, 'age_band') ?? hostBand ?? settings?.[HEMIE_AGE_BAND];
  return {
    constructionType,
    ...(band ? { band: String(band) } : {}),
    hostBand: hostBand === undefined ? undefined : String(hostBand),
    values,
    entered: hemieElementValue(element, 'u_value') !== undefined || hemieElementValue(element, 'thermal_resistance_construction') !== undefined,
  };
}

/** "External wall · Band D · Cavity": an element's fabric, as the colour-by-fabric legend lists it. */
export function hemieFabricLabel(fabric: HemieFabric): string {
  const type = hemieConstructionTypeLabel(fabric.constructionType);
  if (fabric.entered) return `${type} · Entered U-value`;
  return [type, fabric.band ? `Band ${fabric.band}` : 'No band', ...Object.entries(fabric.values)
    .flatMap(([key, value]) => (key === 'areal_heat_capacity' ? [] : [hemieValueLabel(key, value)]))].join(' · ');
}

/** Distinct colours that read on both canvas themes; entered U-values are grey. */
const FABRIC_COLOURS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#ef4444', '#84cc16'];
const ENTERED_COLOUR = '#9ca3af';

export type HemieFabricGroup = Readonly<{ label: string; color: string; ids: readonly string[] }>;

/** Elements grouped by fabric label, largest group first, each with its colour. */
export function hemieFabricGroups(elements: readonly Element[], settings: Readonly<Record<string, string>> | undefined): HemieFabricGroup[] {
  const byLabel = new Map<string, string[]>();
  for (const element of elements) {
    const fabric = hemieFabric(element, settings, elements);
    if (!fabric) continue;
    const label = hemieFabricLabel(fabric);
    byLabel.set(label, [...(byLabel.get(label) ?? []), element.id]);
  }
  let next = 0;
  return [...byLabel].sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b)).map(([label, ids]) => ({
    label,
    ids,
    // ponytail: colours repeat past eight groups; add more when models need them.
    color: label.endsWith('Entered U-value') ? ENTERED_COLOUR : FABRIC_COLOURS[next++ % FABRIC_COLOURS.length]!,
  }));
}
